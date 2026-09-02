"""
Core BACnet helpers: value serialization, object-list retrieval, bulk property
reads, polling and writes. Kept separate from the HTTP layer so it can be
tested directly against real hardware.
"""
from __future__ import annotations

import asyncio
import datetime
import math
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from bacpypes3.pdu import Address
from bacpypes3.basetypes import ErrorType
from bacpypes3.apdu import ErrorRejectAbortNack
from bacpypes3.primitivedata import Enumerated, Boolean, BitString, Null

# bacpypes3 raises BACnet-level failures (Error / Reject / Abort PDUs) as
# ErrorRejectAbortNack, which derives from BaseException rather than
# Exception. A plain `except Exception` therefore does NOT catch a device
# replying "property unknown" or "segmentation not supported", and the
# error escapes all the way out. Always catch this tuple instead.
COMM_ERRORS = (Exception, ErrorRejectAbortNack)

# Properties fetched for every object during a bulk load. Deliberately small:
# every extra property shrinks how many objects fit in one ReadPropertyMultiple
# response, and most devices cannot segment responses (see read_objects_bulk).
# Kept to three: measured against a controller with 1300 points, adding
# description and status-flags to the same request doubled the load time
# (2.0 s -> 4.6 s per 300 objects). They are fetched afterwards instead, so
# the table appears at once and fills in.
BULK_PROPS = ["object-name", "present-value", "units"]
EXTRA_PROPS = ["description", "status-flags"]

# Richer set fetched lazily for a single object when the user inspects it.
DETAIL_PROPS_COMMON = [
    "object-name",
    "present-value",
    "description",
    "status-flags",
    "out-of-service",
    "event-state",
    "reliability",
]
DETAIL_PROPS_BY_TYPE = {
    "analog-input": ["units", "min-pres-value", "max-pres-value", "resolution", "cov-increment"],
    "analog-output": ["units", "min-pres-value", "max-pres-value", "relinquish-default", "priority-array"],
    "analog-value": ["units", "relinquish-default", "priority-array"],
    "binary-input": ["inactive-text", "active-text", "polarity"],
    "binary-output": ["inactive-text", "active-text", "polarity", "relinquish-default", "priority-array"],
    "binary-value": ["inactive-text", "active-text", "relinquish-default", "priority-array"],
    "multi-state-input": ["number-of-states", "state-text"],
    "multi-state-output": ["number-of-states", "state-text", "relinquish-default", "priority-array"],
    "multi-state-value": ["number-of-states", "state-text", "relinquish-default", "priority-array"],
}

ANALOG_TYPES = {"analog-input", "analog-output", "analog-value"}
BINARY_TYPES = {"binary-input", "binary-output", "binary-value"}
MULTISTATE_TYPES = {"multi-state-input", "multi-state-output", "multi-state-value"}

# Object types that carry a live present-value worth showing/polling.
VALUE_TYPES = ANALOG_TYPES | BINARY_TYPES | MULTISTATE_TYPES


def is_error(value: Any) -> bool:
    """True if bacpypes3 returned an ErrorType placeholder for a property."""
    return isinstance(value, ErrorType)


def serialize(value: Any) -> Any:
    """Convert a bacpypes3 value into something json.dumps can handle."""
    if value is None or is_error(value):
        return None
    # BACnet Null is a value in its own right - a schedule entry holding it
    # means "stop commanding here". It is a sequence type in bacpypes3, so
    # without this it came back as an empty list and read as a blank.
    if isinstance(value, Null):
        return None
    # Order matters: bacpypes3 Enumerated and Boolean both subclass int, so
    # they must be handled before the numeric branch or units come back as
    # 62 instead of "degrees-celsius" and booleans as 0/1.
    if isinstance(value, Enumerated):
        return str(value)
    if isinstance(value, Boolean):
        return bool(int(value))
    if isinstance(value, BitString):
        return [f for f in str(value).replace(";", ",").split(",") if f.strip()]
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        # Unconfigured or faulted points commonly report NaN/Inf. Those are
        # not valid JSON, and letting them through makes the whole response
        # fail to encode, so they are surfaced as "no value" instead.
        return value if math.isfinite(value) else None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", "replace")
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    if isinstance(value, dict):
        return {str(k): serialize(v) for k, v in value.items()}
    # A schedule's present-value arrives wrapped in AnyAtomic, which has no
    # useful __str__ - it was reaching the UI as
    # "<bacpypes3.constructeddata.AnyAtomic object at 0x...>". Unwrap it and
    # serialise whatever is inside.
    getter = getattr(value, "get_value", None)
    if callable(getter):
        try:
            indre = getter()
            if indre is not value:
                return serialize(indre)
        except Exception:
            pass

    # Enumerations, bit strings, object identifiers and friends all render
    # usefully via str(); this keeps units as "degrees-celsius" rather than
    # an opaque <EngineeringUnits: ...> repr.
    return str(value)


# Short display symbols for the units that actually turn up in building
# automation. Anything not listed falls back to the raw BACnet name.
UNIT_SYMBOLS = {
    "degrees-celsius": "°C",
    "degrees-fahrenheit": "°F",
    "degrees-kelvin": "K",
    "percent": "%",
    "percent-relative-humidity": "%RH",
    "pascals": "Pa",
    "kilopascals": "kPa",
    "bars": "bar",
    "cubic-meters-per-hour": "m³/h",
    "liters-per-second": "l/s",
    "liters-per-hour": "l/h",
    "meters-per-second": "m/s",
    "watts": "W",
    "kilowatts": "kW",
    "kilowatt-hours": "kWh",
    "megawatt-hours": "MWh",
    "volts": "V",
    "amperes": "A",
    "hertz": "Hz",
    "parts-per-million": "ppm",
    "seconds": "s",
    "minutes": "min",
    "hours": "h",
    "no-units": "",
}


def unit_symbol(unit_name: Optional[str]) -> str:
    if not unit_name:
        return ""
    return UNIT_SYMBOLS.get(unit_name, unit_name)


def serialize_priority_array(value: Any) -> List[Optional[Any]]:
    """
    priority-array comes back as 16 opaque PriorityValue wrappers. Each holds
    exactly one populated field (null / real / boolean / integer ...), so pull
    out whichever one is set. Slot 1 is highest priority, 16 lowest.
    """
    out: List[Optional[Any]] = []
    for entry in (value or []):
        found = None
        for attr in ("null", "real", "boolean", "integer", "unsigned",
                     "enumerated", "double", "characterString"):
            try:
                candidate = getattr(entry, attr, None)
            except COMM_ERRORS:
                candidate = None
            if candidate is None:
                continue
            if attr == "null":
                found = None
                break
            found = serialize(candidate)
            break
        out.append(found)
    return out


def status_flags_to_list(value: Any) -> List[str]:
    """StatusFlags renders as e.g. '' or 'in-alarm,fault'; normalise to a list."""
    if value is None or is_error(value):
        return []
    text = str(value).strip()
    if not text:
        return []
    return [p for p in text.replace(";", ",").split(",") if p.strip()]


def object_type_of(objid: Any) -> str:
    try:
        return str(objid[0])
    except Exception:
        return str(objid).split(",")[0]


def object_instance_of(objid: Any) -> Optional[int]:
    try:
        return int(objid[1])
    except Exception:
        return None


def objid_str(objid: Any) -> str:
    t = object_type_of(objid)
    i = object_instance_of(objid)
    return f"{t},{i}"


async def read_retry(app, addr: Address, objid: str, prop: str,
                     array_index: Optional[int] = None,
                     attempts: int = 3, timeout: float = 5.0,
                     backoff: float = 0.25) -> Any:
    """
    A single read, retried.

    Over a VPN a lone dropped datagram is normal, and BACnet is UDP with no
    retransmission of its own. Anything read exactly once is therefore a
    coin flip on a lossy link - which is why a device could report an empty
    object list on one attempt and 1400 objects on the next.
    """
    last = None
    for i in range(attempts):
        try:
            if array_index is None:
                return await asyncio.wait_for(
                    app.read_property(addr, objid, prop), timeout=timeout)
            return await asyncio.wait_for(
                app.read_property(addr, objid, prop, array_index=array_index),
                timeout=timeout)
        except COMM_ERRORS as e:
            last = e
            if i + 1 < attempts:
                await asyncio.sleep(backoff * (i + 1))
    raise last if last else RuntimeError("read failed")


async def _objlist_batch(app, addr: Address, device_objid: str,
                         indices: Sequence[int], timeout: float):
    """
    Fetch many object-list entries in one ReadPropertyMultiple.

    A controller with 2000 objects answered ~50 array indices per request in
    under 0.2 s here, so this replaces two thousand individual reads with a
    few dozen - both far faster and far less exposed to packet loss.
    Returns None if the request itself failed.
    """
    props = [f"object-list[{i}]" for i in indices]
    try:
        raw = await asyncio.wait_for(
            app.read_property_multiple(addr, [device_objid, props]), timeout=timeout)
    except COMM_ERRORS:
        return None
    out: Dict[int, Any] = {}
    for _objid, _prop, array_index, value in raw:
        if array_index is not None and not is_error(value):
            out[int(array_index)] = value
    return out


async def read_object_list(app, addr: Address, device_objid: str, concurrency: int = 8,
                           per_request_timeout: float = 5.0,
                           batch: int = 80, progress=None, gate=None) -> List[str]:
    """
    Return the device's object-list as ["analog-input,10000", ...].

    Strategy: read the array length, then pull the entries in batches via
    ReadPropertyMultiple, falling back to single reads only for batches a
    device refuses. Every read is retried - a lone dropped reply used to
    abort the whole load with "empty object list".

    80 per request, measured. An object-list entry is just an identifier, so
    far more fit in one response than the objects themselves do: 80 beat 40
    on every controller tested (1.80 -> 1.23 s on a JCI, 0.98 -> 0.44 s on a
    Tridium), and 120 and up were worse again on all of them. This is the
    first thing that happens on every device, so it is most of the wait
    before the table can show anything.
    """
    try:
        length = await read_retry(app, addr, device_objid, "object-list",
                                  array_index=0, attempts=4,
                                  timeout=per_request_timeout + 3)
    except COMM_ERRORS:
        return []
    length = int(length or 0)
    if length <= 0:
        return []

    if progress:
        progress(0, length)

    found: Dict[int, Any] = {}
    sem = asyncio.Semaphore(max(1, concurrency))
    done = 0

    def tick(n: int):
        nonlocal done
        # Clamp: when a batch is refused it is split and retried, and each
        # half used to report its own slice on top of the parent's, pushing
        # the reported progress past 100%.
        done = min(done + n, length)
        if progress:
            progress(done, length)

    async def handle(indices: List[int]):
        async with sem:
            if gate is not None:
                await gate()
            data = await _objlist_batch(app, addr, device_objid, indices, per_request_timeout)
        if data is not None:
            found.update(data)
            tick(len(indices))
            return
        if len(indices) > 1:
            mid = len(indices) // 2
            await asyncio.gather(handle(indices[:mid]), handle(indices[mid:]))
            return
        # Single index left: fall back to a plain read.
        async with sem:
            if gate is not None:
                await gate()
            try:
                found[indices[0]] = await read_retry(
                    app, addr, device_objid, "object-list",
                    array_index=indices[0], attempts=3, timeout=per_request_timeout)
            except COMM_ERRORS:
                pass
        tick(1)

    all_idx = list(range(1, length + 1))
    chunks = [all_idx[i:i + batch] for i in range(0, len(all_idx), batch)]
    await asyncio.gather(*[handle(c) for c in chunks])

    if progress:
        progress(length, length)
    return [objid_str(found[i]) for i in sorted(found) if found[i] is not None]


async def _rpm_chunk(app, addr: Address, objids: Sequence[str], props: Sequence[str],
                     timeout: float) -> Optional[Dict[str, Dict[str, Any]]]:
    """One ReadPropertyMultiple call. Returns None if the call itself failed."""
    params: List[Any] = []
    for oid in objids:
        params.extend([oid, list(props)])
    try:
        raw = await asyncio.wait_for(app.read_property_multiple(addr, params), timeout=timeout)
    except COMM_ERRORS:
        return None

    out: Dict[str, Dict[str, Any]] = {}
    for objid, prop, _array_index, value in raw:
        key = objid_str(objid)
        out.setdefault(key, {})[str(prop)] = value
    return out


async def _read_single(app, addr: Address, objid: str, props: Sequence[str],
                       timeout: float) -> Dict[str, Any]:
    """
    Fallback for devices without ReadPropertyMultiple.

    The properties are read concurrently rather than one after the other:
    serialising five properties across a few hundred objects is thousands of
    sequential round trips, which is what made a non-RPM controller appear to
    hang rather than merely be slow.
    """
    async def one(prop: str):
        try:
            return prop, await asyncio.wait_for(
                app.read_property(addr, objid, prop), timeout=timeout
            )
        except COMM_ERRORS:
            return prop, None

    pairs = await asyncio.gather(*[one(p) for p in props])
    return dict(pairs)


# ---------------------------------------------------------------- capabilities
# Remembered per device address. Re-discovering "this controller has no
# ReadPropertyMultiple" on every load is what made a Regin Corrigo take
# minutes: each batch was attempted, split, re-attempted and only then fell
# back to single reads.
DEVICE_CAPS: Dict[str, Dict[str, Any]] = {}


def caps_for(key: str) -> Dict[str, Any]:
    return DEVICE_CAPS.setdefault(key, {"rpm": None, "batch": None})


def forget_caps(key: Optional[str] = None) -> None:
    if key is None:
        DEVICE_CAPS.clear()
    else:
        DEVICE_CAPS.pop(key, None)


# Below this many objects the calibration cannot pay for itself.
CALIBRATE_MIN_OBJECTS = 300
BATCH_LARGE = 12
BATCH_SMALL = 6


async def probe_capabilities(app, addr: Address, sample_objids: Sequence[str],
                             timeout: float = 6.0) -> Dict[str, Any]:
    """
    Learn how to talk to this controller before reading it in bulk, rather
    than failing our way to the same conclusion once per batch.

    Two things are settled here. First, whether it answers
    ReadPropertyMultiple at all. Second, how many objects to put in one
    request - which is not a constant, because it depends on the device's
    maximum APDU and on how long its object names are. Measured on one site:
    a 12-object request came back in 112 ms on a Tridium controller but was
    refused outright by a JCI and a WAGO, whose 6-object requests answered in
    ~100 ms. The refusal is what used to cost the time: every oversized batch
    was split and retried down the tree, which is why reading 1300 points
    took 9.4 s at batch 12 and 4.8 s at batch 6 on that JCI.

    So: time one request at each size and keep the larger only if it is not
    disproportionately more expensive. That is two requests, not two passes.
    """
    key = str(addr)
    caps = caps_for(key)
    if caps["rpm"] is not None:
        return caps

    probe = list(sample_objids[:2])
    if not probe:
        caps["rpm"] = False
        caps["batch"] = 1
        return caps

    # Sample from the middle: the first objects of a device are often its
    # oddest ones, and typical name length is what this is measuring.
    mid = max(0, len(sample_objids) // 2)
    small = list(sample_objids[mid:mid + BATCH_SMALL]) or probe
    large = list(sample_objids[mid:mid + BATCH_LARGE]) or probe

    t = time.perf_counter()
    d_small = await _rpm_chunk(app, addr, small, BULK_PROPS, timeout)
    t_small = time.perf_counter() - t

    caps["rpm"] = d_small is not None
    if not caps["rpm"]:
        # One more try with the two-object probe before giving up on RPM -
        # a device may refuse six objects and still support the service.
        d_tiny = await _rpm_chunk(app, addr, probe, ["object-name"], timeout)
        caps["rpm"] = d_tiny is not None
        caps["batch"] = BATCH_SMALL if caps["rpm"] else 1
        return caps

    # On a small device the whole read is over in well under a second either
    # way, so the extra request would be the only thing anyone noticed.
    caps["batch"] = BATCH_LARGE
    if len(sample_objids) < CALIBRATE_MIN_OBJECTS or len(large) <= len(small):
        return caps

    t = time.perf_counter()
    d_large = await _rpm_chunk(app, addr, large, BULK_PROPS, timeout)
    t_large = time.perf_counter() - t
    if d_large is None or t_large > 2.0 * max(t_small, 0.001):
        caps["batch"] = BATCH_SMALL
    return caps


async def read_objects_bulk(app, addr: Address, objids: Sequence[str],
                            props: Sequence[str] = tuple(BULK_PROPS),
                            batch_size: int = 12, concurrency: int = 6,
                            timeout: float = 8.0,
                            progress=None, use_caps: bool = True,
                            out: Optional[Dict[str, Dict[str, Any]]] = None,
                            gate=None) -> Dict[str, Dict[str, Any]]:
    """
    Read `props` for many objects, batching via ReadPropertyMultiple.

    If a batch fails (typically 'segmentation-not-supported' because the
    response exceeded one APDU) it is split in half and retried, down to
    single objects, and finally falls back to individual ReadProperty calls
    for devices that do not implement RPM at all.
    """
    # `out` lets the caller watch the results accumulate rather than waiting
    # for the return value, so a long read can be shown while it is running.
    results: Dict[str, Dict[str, Any]] = {} if out is None else out
    sem = asyncio.Semaphore(max(1, concurrency))
    done = 0
    total = len(objids)

    def tick(n: int):
        nonlocal done
        done = min(done + n, total)
        if progress:
            progress(done, total)

    caps = caps_for(str(addr)) if use_caps else {"rpm": None}
    rpm_ok = caps.get("rpm")
    if rpm_ok is False:
        batch_size = 1
    elif use_caps and caps.get("batch") and "object-name" in props:
        # What probe_capabilities measured on this specific device beats the
        # generic default; without this the calibration was recorded and
        # then ignored.
        #
        # Only for reads that carry object-name. Long names are what fills a
        # response and forces the small batch, so applying that size to the
        # description pass or to a present-value poll would just double the
        # number of requests for no reason - measured 2.0 s at batch 12
        # against 3.4 s at 18 for the description pass on the same device
        # that needs batch 6 for names.
        batch_size = caps["batch"]

    async def handle(chunk: List[str]):
        if rpm_ok is not False:
            async with sem:
                # Inside the semaphore, not before it: every chunk is turned
                # into a task up front, so a check before acquiring is passed
                # by all of them in the first pass through the event loop and
                # gates nothing. Here it is reached immediately before the
                # request actually goes out, which is the point that matters.
                if gate is not None:
                    await gate()
                data = await _rpm_chunk(app, addr, chunk, props, timeout)
            if data is not None:
                results.update(data)
                tick(len(chunk))
                return
            if len(chunk) > 1:
                mid = len(chunk) // 2
                await asyncio.gather(handle(chunk[:mid]), handle(chunk[mid:]))
                return
        async with sem:
            if gate is not None:
                await gate()
            results[chunk[0]] = await _read_single(app, addr, chunk[0], props, timeout)
        tick(1)

    chunks = [list(objids[i:i + batch_size]) for i in range(0, len(objids), batch_size)]
    await asyncio.gather(*[handle(c) for c in chunks])
    return results


def shape_point(objid: str, values: Dict[str, Any]) -> Dict[str, Any]:
    """Turn raw property values into the flat record the UI consumes."""
    otype = objid.split(",")[0]
    try:
        instance = int(objid.split(",")[1])
    except Exception:
        instance = None

    present = values.get("present-value")
    units_name = serialize(values.get("units"))
    record = {
        "objid": objid,
        "type": otype,
        "instance": instance,
        "name": serialize(values.get("object-name")),
        "value": serialize(present),
        "description": serialize(values.get("description")),
        "units": units_name,
        "unit_symbol": unit_symbol(units_name if isinstance(units_name, str) else None),
        "status": status_flags_to_list(values.get("status-flags")),
        "writable": otype in (
            "analog-output", "analog-value",
            "binary-output", "binary-value",
            "multi-state-output", "multi-state-value",
        ),
        "numeric": isinstance(present, (int, float)) and not isinstance(present, bool),
    }
    return record


def detail_props_for(otype: str) -> List[str]:
    return list(DETAIL_PROPS_COMMON) + list(DETAIL_PROPS_BY_TYPE.get(otype, []))


async def read_object_detail(app, addr: Address, objid: str,
                             timeout: float = 8.0) -> Dict[str, Any]:
    """Read the full property set for one object (used by the inspector)."""
    otype = objid.split(",")[0]
    props = detail_props_for(otype)

    data = await _rpm_chunk(app, addr, [objid], props, timeout)
    if data is None:
        values = await _read_single(app, addr, objid, props, timeout)
    else:
        values = data.get(objid, {})

    out: Dict[str, Any] = {}
    for prop in props:
        if prop not in values or is_error(values[prop]):
            continue
        if prop == "priority-array":
            out[prop] = serialize_priority_array(values[prop])
        else:
            out[prop] = serialize(values[prop])
    if "units" in out:
        out["units_symbol"] = unit_symbol(out["units"])
    return out


async def poll_values(app, addr: Address, objids: Sequence[str],
                      batch_size: int = 20, concurrency: int = 4,
                      timeout: float = 6.0) -> Dict[str, Any]:
    """
    Fast present-value-only read for live updating. Only one property per
    object, so batches can be much larger than a full bulk load.
    """
    raw = await read_objects_bulk(
        app, addr, objids, props=("present-value",),
        batch_size=batch_size, concurrency=concurrency, timeout=timeout,
    )
    return {
        oid: serialize(vals.get("present-value"))
        for oid, vals in raw.items()
    }


async def write_value(app, addr: Address, objid: str, value: Any,
                      prop: str = "present-value",
                      priority: Optional[int] = None,
                      timeout: float = 8.0) -> Dict[str, Any]:
    """
    Write a property. `value` of None writes Null, which releases the
    given priority slot (the standard way to hand control back to the
    controller's own logic).
    """
    # Releasing a priority means writing BACnet Null, not Python None -
    # passing None straight through makes bacpypes3 raise TypeError and the
    # slot stays commanded.
    if value is None:
        value = Null(())
    try:
        if priority is not None:
            await asyncio.wait_for(
                app.write_property(addr, objid, prop, value, None, priority),
                timeout=timeout,
            )
        else:
            await asyncio.wait_for(
                app.write_property(addr, objid, prop, value),
                timeout=timeout,
            )
        return {"status": "done"}
    except COMM_ERRORS as e:
        return {"status": "error", "error": f"{type(e).__name__}: {e}"}


def bacnet_datetime(date_v, time_v):
    """BACnet Date is [year-1900, month, day, weekday], Time is [h, m, s, hundredths].

    Any field may be 255 for "unspecified", which is not an error - it just
    means the device will not say. Returns None unless a full date and time
    are present.
    """
    try:
        d = list(date_v) if not isinstance(date_v, str) else None
        t = list(time_v) if not isinstance(time_v, str) else None
        if d is None or t is None or len(d) < 3 or len(t) < 3:
            return None
        year, month, day = int(d[0]), int(d[1]), int(d[2])
        hour, minute, sec = int(t[0]), int(t[1]), int(t[2])
        if 255 in (year, month, day, hour, minute, sec):
            return None
        # A Date year is stored as an offset from 1900; some stacks send the
        # full year instead, so accept both rather than producing year 3926.
        if year < 200:
            year += 1900
        return datetime.datetime(year, month, day, hour, minute, sec)
    except (TypeError, ValueError, IndexError):
        return None


# Below this the difference is round-trip time and rounding, not a real
# problem. Above it, schedules run at the wrong hour and trend timestamps
# cannot be trusted - which is exactly the sort of fault nobody looks for.


async def sync_clock(app, addr: Address, naa=None,
                     timeout: float = 8.0) -> Dict[str, Any]:
    """
    Set one controller's clock from this PC.

    Sent unicast, to the address given and nothing else. TimeSynchronization is
    an unconfirmed service and is normally broadcast - which would set the clock
    on every device on the wire, including ones belonging to a system that is
    not ours. That is not something a button labelled "fix this controller"
    should do, so the request carries a single destination.

    Being unconfirmed, the device never answers. The clock is therefore read
    before and after, and what comes back is the drift that actually remains -
    not the fact that a packet left the building.
    """
    from bacpypes3.apdu import TimeSynchronizationRequest
    from bacpypes3.basetypes import DateTime
    from bacpypes3.primitivedata import Date, Time

    try:
        dev_id = await asyncio.wait_for(
            app.read_property(addr, "device,4194303", "object-identifier"),
            timeout=timeout)
        dev_inst = object_instance_of(dev_id)
    except COMM_ERRORS as e:
        return {"status": "error", "error": f"Fant ikke enheten: {e}"}
    if dev_inst is None:
        return {"status": "error", "error": "Enheten oppga ingen device-instans"}

    objid = f"device,{dev_inst}"

    async def les_klokke():
        try:
            d = await asyncio.wait_for(
                app.read_property(addr, objid, "local-date"), timeout=timeout)
            t = await asyncio.wait_for(
                app.read_property(addr, objid, "local-time"), timeout=timeout)
            return bacnet_datetime(d, t)
        except COMM_ERRORS:
            return None

    foer = await les_klokke()
    naa = naa or datetime.datetime.now()

    dt = DateTime(
        date=Date((naa.year - 1900, naa.month, naa.day, naa.isoweekday())),
        time=Time((naa.hour, naa.minute, naa.second, naa.microsecond // 10000)),
    )
    apdu = TimeSynchronizationRequest(time=dt)
    apdu.pduDestination = addr
    try:
        app.request(apdu)
    except COMM_ERRORS as e:
        return {"status": "error", "error": f"{type(e).__name__}: {e}"}

    await asyncio.sleep(1.5)
    etter = await les_klokke()

    def avvik(t):
        return None if t is None else round((t - datetime.datetime.now()).total_seconds())

    ut = {
        "status": "done",
        "device_instance": dev_inst,
        "sendt": naa.isoformat(timespec="seconds"),
        "for": foer.isoformat(timespec="seconds") if foer else None,
        "etter": etter.isoformat(timespec="seconds") if etter else None,
        "avvik_for": avvik(foer),
        "avvik_etter": avvik(etter),
    }
    if etter is None:
        ut["advarsel"] = "Klokka kunne ikke leses tilbake - vet ikke om den ble satt"
    elif ut["avvik_etter"] is not None and abs(ut["avvik_etter"]) > 5:
        ut["advarsel"] = (f"Enheten star fortsatt {ut['avvik_etter']} s feil - "
                          "den godtar kanskje ikke tidssynkronisering")
    return ut


# ------------------------------------------------------- schedules / trend logs
WEEKDAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"]


def _time_str(t: Any) -> str:
    """BACnet Time renders as h:m:s.hundredths; trim to what a schedule needs."""
    s = str(t)
    parts = s.split(":")
    if len(parts) >= 2:
        return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"
    return s


def decode_weekly_schedule(ws: Any) -> List[Dict[str, Any]]:
    """
    weekly-schedule is 7 DailySchedule entries, each holding a
    SequenceOfTimeValue of {time, value} pairs. Index 0 is Monday.
    """
    out: List[Dict[str, Any]] = []
    for i, day in enumerate(ws or []):
        entries = []
        for tv in (getattr(day, "daySchedule", None) or []):
            entries.append({
                "time": _time_str(getattr(tv, "time", "")),
                "value": serialize(getattr(tv, "value", None)),
            })
        out.append({
            "day": WEEKDAYS[i] if i < len(WEEKDAYS) else str(i),
            "entries": entries,
        })
    return out


async def read_schedules(app, addr: Address, objids: Sequence[str],
                         timeout: float = 8.0) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for objid in objids:
        item: Dict[str, Any] = {"objid": objid}
        for prop, key in (("object-name", "name"), ("description", "description"),
                          ("present-value", "value"), ("priority-for-writing", "priority")):
            try:
                item[key] = serialize(await asyncio.wait_for(
                    app.read_property(addr, objid, prop), timeout=timeout))
            except COMM_ERRORS:
                item[key] = None
        try:
            ws = await asyncio.wait_for(
                app.read_property(addr, objid, "weekly-schedule"), timeout=timeout)
            item["weekly"] = decode_weekly_schedule(ws)
        except COMM_ERRORS:
            item["weekly"] = []
        item["entry_count"] = sum(len(d["entries"]) for d in item["weekly"])
        out.append(item)
    return out


_MND = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,
        "jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12}


def _log_ts(ts: Any) -> str:
    """
    BACnet DateTime renders as "2026-4-30 thu 00:00:00.00". Sortable and
    pasteable matters more than faithful, so it comes out as
    "2026-04-30 00:00:00" - which Excel also reads as a time.
    """
    s = str(ts).strip()
    biter = s.split()
    if len(biter) < 2:
        return s
    dato, klokke = biter[0], biter[-1]
    d = dato.split("-")
    if len(d) == 3:
        aar, mnd, dag = d
        if not mnd.isdigit():
            mnd = str(_MND.get(mnd[:3].lower(), 0))
        try:
            dato = f"{int(aar):04d}-{int(mnd):02d}-{int(dag):02d}"
        except ValueError:
            dato = biter[0]
    if klokke.count(":") == 3:          # h:m:s:hundredths
        klokke = ":".join(klokke.split(":")[:3])
    if klokke.endswith(".00"):
        klokke = klokke[:-3]
    kb = klokke.split(":")
    if len(kb) == 3:
        try:
            klokke = f"{int(kb[0]):02d}:{int(kb[1]):02d}:{int(float(kb[2])):02d}"
        except ValueError:
            pass
    return f"{dato} {klokke}"


async def write_weekly_schedule(app, addr: Address, objid: str,
                                dager: Sequence[Sequence[Dict[str, Any]]],
                                timeout: float = 12.0) -> Dict[str, Any]:
    """
    Replace a Schedule's weekly-schedule with seven days of transitions.

    `dager` is seven lists of {"time": "HH:MM", "value": <str>}, Monday first.

    The value type is not ours to choose. A schedule whose entries are
    Enumerated must be written back as Enumerated - write an Unsigned into it
    and the controller answers invalid-data-type, or worse, accepts it and the
    plant runs on something the operator never entered. So the current
    weekly-schedule is read first and its own value class is reused; a schedule
    that is empty falls back to the type of its present-value.
    """
    from bacpypes3.basetypes import DailySchedule, TimeValue
    from bacpypes3.primitivedata import Time, Unsigned, Real, Integer

    if len(dager) != 7:
        return {"status": "error", "error": "Ukeprogram ma ha sju dager"}

    # ---- finn hvilken type verdiene skal ha ----------------------------
    mal = None
    try:
        naa = await asyncio.wait_for(
            app.read_property(addr, objid, "weekly-schedule"), timeout=timeout)
        for dag in (naa or []):
            for tv in (getattr(dag, "daySchedule", None) or []):
                if getattr(tv, "value", None) is not None:
                    mal = tv.value
                    break
            if mal is not None:
                break
    except COMM_ERRORS:
        pass
    if mal is None:
        try:
            mal = await asyncio.wait_for(
                app.read_property(addr, objid, "present-value"), timeout=timeout)
        except COMM_ERRORS:
            mal = None

    # AnyAtomic wraps the real thing; unwrap before asking what class it is.
    getter = getattr(mal, "get_value", None)
    if callable(getter):
        try:
            mal = getter()
        except Exception:
            pass
    klasse = type(mal) if mal is not None else Unsigned

    def lag_verdi(v):
        # A schedule entry may hold Null, which means the schedule stops
        # commanding at that time rather than commanding a value. It has to
        # travel as BACnet Null, not as the string "None".
        if v is None:
            return Null(())
        tekst = str(v).strip()
        if klasse in (Real,):
            return klasse(float(tekst))
        if klasse in (Unsigned, Integer, Enumerated):
            return klasse(int(float(tekst)))
        if klasse is Boolean:
            return klasse(tekst.lower() in ("1", "true", "active", "on"))
        try:
            return klasse(tekst)
        except (TypeError, ValueError):
            return Unsigned(int(float(tekst)))

    # ---- bygg de sju dagene --------------------------------------------
    ukeprogram = []
    for dag in dager:
        tv_liste = []
        # A controller expects the day's transitions in order; an unsorted
        # list is accepted by some and silently reordered by others.
        for e in sorted(dag, key=lambda x: str(x.get("time", ""))):
            tid = str(e.get("time", "")).strip()
            biter = tid.split(":")
            if len(biter) < 2:
                continue
            try:
                t = Time((int(biter[0]), int(biter[1]), 0, 0))
            except (TypeError, ValueError):
                continue
            try:
                tv_liste.append(TimeValue(time=t, value=lag_verdi(e.get("value"))))
            except (TypeError, ValueError) as ex:
                return {"status": "error",
                        "error": f"Kunne ikke tolke verdien {e.get('value')!r}: {ex}"}
        ukeprogram.append(DailySchedule(daySchedule=tv_liste))

    try:
        await asyncio.wait_for(
            app.write_property(addr, objid, "weekly-schedule", ukeprogram),
            timeout=timeout)
    except COMM_ERRORS as e:
        return {"status": "error", "error": f"{type(e).__name__}: {e}"}

    return {"status": "done", "verdi_type": klasse.__name__,
            "skift": sum(len(d) for d in dager)}


async def read_trend_log(app, addr: Address, objid: str,
                         limit: int = 500, timeout: float = 20.0) -> Dict[str, Any]:
    """
    Read a TrendLog's stored history, newest records last.

    Uses ReadRange, not ReadProperty. A log buffer is not readable as an
    ordinary property - this controller answers ReadProperty on log-buffer
    with read-access-denied, which is what the standard expects - and that is
    why this returned an empty list for every log it was ever pointed at.
    Verified against a JCI NIE with 144 records buffered and 390362 logged in
    total.

    RangeByPosition indexes from the oldest record, so the tail is read by
    counting back from record-count rather than asking for a negative count -
    which this device answers with a single record.
    """
    info: Dict[str, Any] = {"objid": objid, "records": []}
    for prop, key in (("object-name", "name"), ("record-count", "record_count"),
                      ("total-record-count", "total_records"),
                      ("buffer-size", "buffer_size"), ("log-interval", "interval"),
                      ("start-time", "start"), ("stop-time", "stop")):
        try:
            info[key] = serialize(await asyncio.wait_for(
                app.read_property(addr, objid, prop), timeout=timeout))
        except COMM_ERRORS:
            info[key] = None

    antall = info.get("record_count") or 0
    try:
        antall = int(antall)
    except (TypeError, ValueError):
        antall = 0
    if antall <= 0:
        info["error"] = "Loggen er tom"
        return info

    onsket = min(int(limit), antall)
    forste = max(1, antall - onsket + 1)

    # Read in chunks: a controller answers ReadRange with as much as fits one
    # APDU and sets moreItems, so asking for 500 in one go silently truncates.
    poster: List[Any] = []
    pos = forste
    while len(poster) < onsket:
        biten = min(50, onsket - len(poster))
        svar = None
        for _ in range(3):
            try:
                svar = await asyncio.wait_for(
                    app.read_range(addr, objid, "log-buffer",
                                   range_params=("p", pos, None, None, biten)),
                    timeout=timeout)
                break
            except COMM_ERRORS:
                await asyncio.sleep(0.4)
        if not svar:
            break
        nye = list(svar)
        if not nye:
            break
        poster.extend(nye)
        pos += len(nye)
        # A short answer is the APDU limit, not the end of the log - this
        # controller returns 38 records when asked for 50. Treating that as
        # "no more" is why only a quarter of the buffer came back.
        if pos > antall:
            break

    recs = []
    for r in poster[-limit:]:
        datum = getattr(r, "logDatum", None)
        value = None
        # logDatum is a choice; take whichever member carries the reading.
        for attr in ("realValue", "enumValue", "unsignedValue", "signedValue",
                     "booleanValue", "bitstringValue", "anyValue"):
            v = getattr(datum, attr, None) if datum is not None else None
            if v is not None:
                value = serialize(v)
                break
        recs.append({
            "ts": _log_ts(serialize(getattr(r, "timestamp", None))),
            "value": value,
        })
    info["records"] = recs
    if not recs:
        info["error"] = "Fikk ingen poster fra loggen"
    return info

