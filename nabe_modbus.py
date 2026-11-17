"""
Modbus TCP for NABE, read only.

This module has no function code that writes: not 5, 6, 15 or 16. It cannot change anything in a plant, by
construction, and the tests check that. What it does: finds Modbus servers (an asyncio connect sweep of port
502), finds the units behind them, asks them who they are (function 43/14, then 17, then a one-register read),
and reads registers and bits in blocks. A register map (a JSON file, or a CSV the technician already has) gives
the registers names, types, scale and units, and then every register reads as a point in the same shape as a
BACnet point, so the table, the watch list, recording, export and the schematic work without knowing the
difference.

The way around the Modbus gateways' quirks is the same one the field has settled on: a gateway answers
exception 0x0A or 0x0B for a unit with nothing behind it, which means "no device here", not "a device".
The protocol is public (the Modbus Application Protocol and the Modbus TCP implementation guide); the structure
of the scan was informed by the MIT-licensed HVAC-Network-Scanner by James Cupps.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import re
import struct
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

MODBUS_PORT = 502
# Units to try on a host. 0 is the broadcast address and is never used. 255 is what TCP-only gateways answer to.
COMMON_UNITS = [1, 2, 3, 4, 5, 10, 100, 247, 255]
# What a read may ask for. Nothing in this table writes.
READ_FUNCTIONS = {"coil": 1, "discrete": 2, "holding": 3, "input": 4}
FORBIDDEN_FUNCTIONS = (5, 6, 15, 16, 22, 23)
GATEWAY_NO_DEVICE = {0x0A, 0x0B}          # "path unavailable", "target failed to respond"
MAX_REGISTERS = 120                       # the standard allows 125 per read
MAX_BITS = 1900                           # the standard allows 2000 per read

# The BACnet name for each type of point, so the rest of NABE reads a Modbus point like any other.
OBJ_TYPE = {"input": "analog-input", "holding": "analog-value", "coil": "binary-value", "discrete": "binary-input"}
# Units the way a register map writes them, in the names NABE's tolkning and symbols know.
UNIT_NAMES = {
    "°c": "degrees-celsius", "c": "degrees-celsius", "degc": "degrees-celsius", "celsius": "degrees-celsius",
    "k": "kelvin", "%": "percent", "pct": "percent", "%rh": "percent-relative-humidity", "rh": "percent-relative-humidity",
    "pa": "pascals", "kpa": "kilopascals", "bar": "bars", "mbar": "millibars", "psi": "pounds-force-per-square-inch",
    "m3/h": "cubic-meters-per-hour", "m³/h": "cubic-meters-per-hour", "l/s": "liters-per-second", "l/min": "liters-per-minute",
    "ppm": "parts-per-million", "v": "volts", "a": "amperes", "w": "watts", "kw": "kilowatts", "kwh": "kilowatt-hours",
    "hz": "hertz", "rpm": "revolutions-per-minute", "s": "seconds", "min": "minutes", "h": "hours",
}


class ModbusError(Exception):
    """The connection or the answer was not usable."""


class ModbusException(ModbusError):
    """The server answered with an exception response (the function code with the high bit set)."""
    def __init__(self, function: int, code: int):
        super().__init__(f"Modbus exception {code:#04x} for function {function}")
        self.function, self.code = function, code


class ModbusClient:
    """One TCP connection to one Modbus server, used for every unit behind it, one request at a time."""

    def __init__(self, host: str, port: int = MODBUS_PORT, timeout: float = 2.0):
        self.host, self.port, self.timeout = host, int(port), float(timeout)
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._txn = 0
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        await self.close()
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), self.timeout)
        except (OSError, asyncio.TimeoutError) as e:
            raise ModbusError(f"connect {self.host}:{self.port}: {e}") from e

    async def close(self) -> None:
        w, self._writer, self._reader = self._writer, None, None
        if w is not None:
            try:
                w.close()
                await asyncio.wait_for(w.wait_closed(), 1.0)
            except Exception:
                pass

    async def request(self, unit: int, pdu: bytes) -> bytes:
        """Send one PDU, return the PDU of the answer. Reconnects once when the server dropped the connection."""
        if not pdu or pdu[0] in FORBIDDEN_FUNCTIONS:
            raise ModbusError("this client does not write")
        async with self._lock:
            last: Optional[Exception] = None
            for attempt in (0, 1):
                try:
                    if self._writer is None:
                        await self.connect()
                    self._txn = (self._txn + 1) & 0xFFFF
                    txn = self._txn
                    self._writer.write(struct.pack("!HHHB", txn, 0, len(pdu) + 1, unit) + pdu)
                    await asyncio.wait_for(self._writer.drain(), self.timeout)
                    deadline = time.monotonic() + self.timeout
                    while True:
                        head = await self._read_exact(7, deadline)
                        got, proto, length, _unit = struct.unpack("!HHHB", head)
                        if length < 2 or length > 260:
                            raise ModbusError("bad frame length")
                        body = await self._read_exact(length - 1, deadline)
                        if proto == 0 and got == txn:
                            break           # an answer to something else (a late one) is skipped
                    break
                except asyncio.TimeoutError as e:
                    # The server is up but silent for this unit: asking again only waits out the same time.
                    await self.close()
                    raise ModbusError("timeout") from e
                except (OSError, ConnectionError, ModbusError) as e:
                    last = e
                    await self.close()
                    if attempt:
                        raise ModbusError(str(e)) from e
            else:
                raise ModbusError(str(last))
        if body[0] & 0x80:
            raise ModbusException(body[0] & 0x7F, body[1] if len(body) > 1 else 0)
        return body

    async def _read_exact(self, n: int, deadline: float) -> bytes:
        left = deadline - time.monotonic()
        if left <= 0:
            raise asyncio.TimeoutError()
        try:
            return await asyncio.wait_for(self._reader.readexactly(n), left)
        except asyncio.IncompleteReadError as e:
            raise ModbusError("connection closed") from e

    # --- reads -------------------------------------------------------------
    async def read_registers(self, unit: int, kind: str, start: int, count: int) -> List[int]:
        fn = READ_FUNCTIONS[kind]
        if fn not in (3, 4) or not 1 <= count <= 125:
            raise ModbusError("bad register read")
        body = await self.request(unit, struct.pack("!BHH", fn, start, count))
        if len(body) < 2 or body[1] != count * 2 or len(body) < 2 + count * 2:
            raise ModbusError("short register answer")
        return list(struct.unpack(f"!{count}H", body[2:2 + count * 2]))

    async def read_bits(self, unit: int, kind: str, start: int, count: int) -> List[bool]:
        fn = READ_FUNCTIONS[kind]
        if fn not in (1, 2) or not 1 <= count <= 2000:
            raise ModbusError("bad bit read")
        body = await self.request(unit, struct.pack("!BHH", fn, start, count))
        n = (count + 7) // 8
        if len(body) < 2 + n:
            raise ModbusError("short bit answer")
        return [bool(body[2 + i // 8] >> (i % 8) & 1) for i in range(count)]

    async def device_identification(self, unit: int) -> Dict[str, str]:
        """Function 43, MEI type 14: vendor, product code and revision, where the device keeps them."""
        body = await self.request(unit, bytes([0x2B, 0x0E, 0x01, 0x00]))
        return parse_device_identification(body)

    async def server_id(self, unit: int) -> Dict[str, Any]:
        """Function 17, report server ID, which older devices answer in place of function 43."""
        body = await self.request(unit, bytes([0x11]))
        n = body[1] if len(body) > 1 else 0
        data = body[2:2 + n]
        text = re.sub(r"[^\x20-\x7e]+", " ", data.decode("latin-1")).strip()
        return {"server_id": data.hex(), "text": text}


def parse_device_identification(body: bytes) -> Dict[str, str]:
    """The objects of a function 43/14 answer, by their standard names."""
    names = {0: "vendor", 1: "product_code", 2: "revision", 3: "vendor_url", 4: "product_name", 5: "model_name", 6: "application"}
    out: Dict[str, str] = {}
    if len(body) < 7 or body[0] != 0x2B or body[1] != 0x0E:
        return out
    n_objects, pos = body[6], 7
    for _ in range(n_objects):
        if pos + 2 > len(body):
            break
        oid, ln = body[pos], body[pos + 1]
        value = body[pos + 2:pos + 2 + ln].decode("latin-1", "replace")
        out[names.get(oid, f"object_{oid}")] = re.sub(r"[^\x20-\x7e]+", " ", value).strip()
        pos += 2 + ln
    return out


# ----------------------------------------------------------------- scanning
async def tcp_sweep(hosts: Sequence[str], port: int = MODBUS_PORT, timeout: float = 0.8, concurrency: int = 64) -> List[str]:
    """The hosts with something listening on the port."""
    sem = asyncio.Semaphore(concurrency)
    open_: List[str] = []

    async def one(h: str):
        async with sem:
            try:
                _r, w = await asyncio.wait_for(asyncio.open_connection(h, port), timeout)
            except (OSError, asyncio.TimeoutError):
                return
            open_.append(h)
            w.close()
    await asyncio.gather(*[one(h) for h in hosts])
    return sorted(open_, key=lambda x: tuple(int(p) for p in x.split(".")) if re.fullmatch(r"[\d.]+", x) else (0,))


async def probe_unit(client: ModbusClient, unit: int) -> Optional[Dict[str, Any]]:
    """Is there a device at this unit, and who is it? Each step happens only if the unit is there: behind a
    gateway every request to an empty unit is a timeout on the serial bus."""
    try:
        ident = await client.device_identification(unit)
        if ident:
            return {"via": "device_identification", **ident}
        return {"via": "device_identification"}
    except ModbusException as e:
        if e.code in GATEWAY_NO_DEVICE:
            return None
        # Function 43 is optional; a device that refuses it with another exception is still a device.
    except ModbusError:
        pass
    try:
        sid = await client.server_id(unit)
        return {"via": "report_server_id", "product_name": sid.get("text") or ""}
    except ModbusException as e:
        if e.code in GATEWAY_NO_DEVICE:
            return None
    except ModbusError:
        pass
    try:
        await client.read_registers(unit, "holding", 0, 1)
        return {"via": "holding_read"}
    except ModbusException as e:
        if e.code in GATEWAY_NO_DEVICE:
            return None
        return {"via": "exception_response"}     # a device that says "no such register" is alive
    except ModbusError:
        return None


async def scan_host(host: str, port: int = MODBUS_PORT, units: Optional[Iterable[int]] = None, timeout: float = 1.0) -> List[Dict[str, Any]]:
    """The units that answer on one host. A device that ignores the unit and answers the same for all of them
    is reported once, not nine times."""
    units = [u for u in (units or COMMON_UNITS) if 1 <= int(u) <= 255]
    client = ModbusClient(host, port, timeout)
    found: List[Dict[str, Any]] = []
    try:
        await client.connect()
        for u in units:
            info = await probe_unit(client, u)
            if info is not None:
                found.append({"unit": u, **info})
    except ModbusError:
        pass
    finally:
        await client.close()
    if len(units) >= 3 and len(found) == len(units):
        sig = {(f.get("vendor"), f.get("product_code"), f.get("product_name"), f.get("via")) for f in found}
        if len(sig) == 1:
            found = [{**found[0], "answers_any_unit": True}]
    return [device_record(host, port, f) for f in found]


def device_address(host: str, port: int, unit: int) -> str:
    return f"mb:{host}:{port}/{unit}"


def parse_address(address: str) -> Optional[Tuple[str, int, int]]:
    """mb:192.168.1.5:502/3 -> ("192.168.1.5", 502, 3), and None for anything else."""
    m = re.fullmatch(r"mb:([^:/]+):(\d+)/(\d+)", str(address))
    return (m.group(1), int(m.group(2)), int(m.group(3))) if m else None


def device_record(host: str, port: int, found: Dict[str, Any]) -> Dict[str, Any]:
    unit = int(found["unit"])
    name = " ".join(x for x in (found.get("vendor"), found.get("product_name") or found.get("model_name") or found.get("product_code")) if x)
    return {
        "address": device_address(host, port, unit), "ip": host, "port": port, "unit": unit,
        "device_instance": unit, "protocol": "modbus", "object_name": name or f"Modbus {host} #{unit}",
        "vendor_name": found.get("vendor") or "", "model_name": found.get("product_name") or found.get("model_name") or found.get("product_code") or "",
        "firmware": found.get("revision") or "", "detected_via": found.get("via"), "answers_any_unit": bool(found.get("answers_any_unit")),
    }


# -------------------------------------------------------------- register maps
class MapError(ValueError):
    pass


TYPES = {"u16": 1, "s16": 1, "u32": 2, "s32": 2, "f32": 2, "u64": 4, "bool": 1}
ORDERS = ("ABCD", "CDAB", "BADC", "DCBA")       # word and byte order of a value in more than one register


def normalise_point(p: Dict[str, Any]) -> Dict[str, Any]:
    """One row of a register map, checked and with defaults filled in."""
    kind = str(p.get("function") or p.get("fn") or "holding").strip().lower()
    kind = {"hr": "holding", "holding register": "holding", "ir": "input", "input register": "input",
            "co": "coil", "di": "discrete", "discrete input": "discrete", "3": "holding", "4": "input", "1": "coil", "2": "discrete"}.get(kind, kind)
    if kind not in READ_FUNCTIONS:
        raise MapError(f"unknown function {p.get('function')!r}")
    try:
        address = int(str(p.get("address")).strip(), 0)
    except (TypeError, ValueError):
        raise MapError(f"bad address {p.get('address')!r}")
    if not 0 <= address <= 0xFFFF:
        raise MapError(f"address out of range: {address}")
    typ = str(p.get("type") or ("bool" if kind in ("coil", "discrete") else "u16")).strip().lower()
    if typ not in TYPES:
        raise MapError(f"unknown type {p.get('type')!r}")
    order = str(p.get("order") or "ABCD").strip().upper()
    if order not in ORDERS:
        raise MapError(f"unknown word order {order!r}")
    try:
        scale = float(str(p.get("scale") if p.get("scale") not in (None, "") else 1).replace(",", "."))
        offset = float(str(p.get("offset") if p.get("offset") not in (None, "") else 0).replace(",", "."))
    except ValueError:
        raise MapError("scale and offset must be numbers")
    bit = p.get("bit")
    bit = None if bit in (None, "") else int(bit)
    if bit is not None and not 0 <= bit <= 15:
        raise MapError("bit must be 0 to 15")
    unit = str(p.get("unit") or "").strip()
    return {"function": kind, "address": address, "type": typ, "order": order, "scale": scale, "offset": offset, "bit": bit,
            "name": str(p.get("name") or f"{kind[:2].upper()}{address}").strip(),
            "description": str(p.get("description") or "").strip(), "unit": unit,
            "units": UNIT_NAMES.get(unit.lower(), unit if unit else "no-units")}


def parse_map(text: str) -> Dict[str, Any]:
    """A register map from JSON ({"name": ..., "points": [...]}) or from CSV with a header row:
    address,function,type,name,scale,unit,description (extra columns: order, offset, bit)."""
    text = text.lstrip("﻿")
    if text.lstrip().startswith("{") or text.lstrip().startswith("["):
        data = json.loads(text)
        rows = data if isinstance(data, list) else data.get("points", [])
        name = "" if isinstance(data, list) else str(data.get("name") or "")
    else:
        sample = text[:2000]
        delim = max(",;\t", key=sample.count)
        reader = csv.DictReader(io.StringIO(text), delimiter=delim)
        reader.fieldnames = [str(h).strip().lower() for h in (reader.fieldnames or [])]
        alias = {"register": "address", "reg": "address", "adresse": "address", "fn": "function", "funksjon": "function",
                 "datatype": "type", "navn": "name", "beskrivelse": "description", "enhet": "unit", "units": "unit", "faktor": "scale"}
        rows = [{alias.get(k, k): v for k, v in r.items() if k} for r in reader]
        name = ""
    points, seen = [], set()
    for i, r in enumerate(rows, 1):
        if not any(str(v).strip() for v in r.values() if v is not None):
            continue
        try:
            p = normalise_point(r)
        except MapError as e:
            raise MapError(f"row {i}: {e}")
        key = (p["function"], p["address"], p["bit"])
        if key in seen:
            raise MapError(f"row {i}: {p['function']} {p['address']} is in the map twice")
        seen.add(key)
        points.append(p)
    if not points:
        raise MapError("the map has no points")
    return {"name": name, "points": points}


def decode_value(point: Dict[str, Any], words: List[int]) -> Any:
    """The value of one map point from the registers it occupies."""
    typ = point["type"]
    if typ == "bool":
        return bool(words[0] >> point["bit"] & 1) if point.get("bit") is not None and point["function"] in ("holding", "input") else bool(words[0])
    n = TYPES[typ]
    raw = struct.pack(f"!{n}H", *words[:n])
    if n >= 2:
        raw = _reorder(raw, point.get("order", "ABCD"), n)
    value: float
    if typ == "u16":
        value = struct.unpack("!H", raw)[0]
    elif typ == "s16":
        value = struct.unpack("!h", raw)[0]
    elif typ == "u32":
        value = struct.unpack("!I", raw)[0]
    elif typ == "s32":
        value = struct.unpack("!i", raw)[0]
    elif typ == "u64":
        value = struct.unpack("!Q", raw)[0]
    else:
        value = struct.unpack("!f", raw)[0]
    if point.get("bit") is not None:
        return bool(int(value) >> point["bit"] & 1)
    if point.get("scale", 1.0) == 1.0 and point.get("offset", 0.0) == 0.0 and typ != "f32":
        return int(value)
    value = value * point.get("scale", 1.0) + point.get("offset", 0.0)
    return round(value, 4)


def _reorder(raw: bytes, order: str, n: int) -> bytes:
    """Bring the bytes of a multi-register value into big-endian order. ABCD is the standard order; CDAB has the
    words swapped, BADC the bytes in each word, DCBA both."""
    words = [raw[i:i + 2] for i in range(0, len(raw), 2)]
    if order in ("BADC", "DCBA"):
        words = [w[::-1] for w in words]
    if order in ("CDAB", "DCBA"):
        words = words[::-1]
    return b"".join(words)


def point_record(point: Dict[str, Any], value: Any = None) -> Dict[str, Any]:
    """A map point as the flat record the UI consumes, in the shape of a BACnet point."""
    kind = point["function"]
    instance = point["address"] if point["bit"] is None else 1_000_000 + point["address"] * 16 + point["bit"]
    otype = OBJ_TYPE[kind]
    if point["type"] == "bool" or point["bit"] is not None:
        otype = {"input": "binary-input", "holding": "binary-value", "coil": "binary-value", "discrete": "binary-input"}[kind]
    is_bool = otype.startswith("binary")
    shown = ("active" if value else "inactive") if is_bool and value is not None else value
    return {
        "objid": f"{otype},{instance}", "type": otype, "instance": instance,
        "name": point["name"], "value": shown, "description": point["description"] or f"{kind} {point['address']}",
        "units": point["units"] if not is_bool else None, "unit_symbol": point["unit"] if not is_bool else "",
        "status": [], "status_lest": False, "writable": False, "numeric": not is_bool and isinstance(value, (int, float)),
        "modbus": {"function": kind, "address": point["address"]},
    }


def blocks(points: Sequence[Dict[str, Any]], gap: int = 4) -> List[Tuple[str, int, int, List[Dict[str, Any]]]]:
    """The reads needed for these points: contiguous blocks per function, with small gaps read through."""
    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for p in points:
        by_kind.setdefault(p["function"], []).append(p)
    out = []
    for kind, plist in by_kind.items():
        bits = kind in ("coil", "discrete")
        limit = MAX_BITS if bits else MAX_REGISTERS
        plist = sorted(plist, key=lambda p: p["address"])
        cur: List[Dict[str, Any]] = []
        start = end = 0
        for p in plist:
            width = 1 if bits else TYPES[p["type"]]
            if cur and (p["address"] - end > gap or p["address"] + width - start > limit):
                out.append((kind, start, end - start, cur))
                cur = []
            if not cur:
                start = p["address"]
                end = start
            cur.append(p)
            end = max(end, p["address"] + width)
        if cur:
            out.append((kind, start, end - start, cur))
    return out


async def read_points(client: ModbusClient, unit: int, points: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Read map points. Returns {objid: value} for what could be read; a block that fails is left out, so an
    unread point is never shown as a value."""
    out: Dict[str, Any] = {}
    for kind, start, count, plist in blocks(points):
        cells = await _read_range(client, unit, kind, start, count)
        for p in plist:
            width = 1 if kind in ("coil", "discrete") else TYPES[p["type"]]
            addrs = range(p["address"], p["address"] + width)
            if not all(a in cells for a in addrs):
                continue                      # not read: left out, never shown as a value
            out[point_record(p)["objid"]] = (cells[p["address"]] if width == 1 and kind in ("coil", "discrete")
                                             else decode_value(p, [cells[a] for a in addrs]))
    return {k: ("active" if v is True else "inactive" if v is False else v) for k, v in out.items()}


async def _read_range(client: ModbusClient, unit: int, kind: str, start: int, count: int) -> Dict[int, Any]:
    """address -> register word or bit for what could be read. A range with an address the device does not have
    answers "illegal data address" for all of it, so it is split until the readable part is found."""
    try:
        if kind in ("coil", "discrete"):
            data: List[Any] = await client.read_bits(unit, kind, start, count)
        else:
            data = await client.read_registers(unit, kind, start, count)
        return {start + i: v for i, v in enumerate(data)}
    except ModbusException as e:
        if e.code in (0x02, 0x03) and count > 1:
            half = count // 2
            a = await _read_range(client, unit, kind, start, half)
            b = await _read_range(client, unit, kind, start + half, count - half)
            return {**a, **b}
        return {}
    except ModbusError:
        return {}


def raw_points(count: int = 50) -> List[Dict[str, Any]]:
    """What to read from a device with no map: the first holding and input registers, unnamed, so there is
    something to see and to name."""
    return [normalise_point({"function": kind, "address": a, "name": f"{'HR' if kind == 'holding' else 'IR'}{a}"})
            for kind in ("holding", "input") for a in range(count)]


# ------------------------------------------------------------- map storage
class MapStore:
    """Register maps and which device uses which, as plain JSON files under the NABE data folder."""

    def __init__(self, folder: Path):
        self.folder = Path(folder) / "modbus"
        self.maps = self.folder / "kart"
        self.assign_file = self.folder / "tilordning.json"

    def _ensure(self) -> None:
        self.maps.mkdir(parents=True, exist_ok=True)

    def save_map(self, name: str, parsed: Dict[str, Any]) -> str:
        self._ensure()
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", name.strip() or parsed.get("name") or "kart").strip("_") or "kart"
        (self.maps / f"{slug}.json").write_text(json.dumps({"name": name or slug, "points": parsed["points"]}, ensure_ascii=False, indent=1), encoding="utf-8")
        return slug

    def list_maps(self) -> List[Dict[str, Any]]:
        if not self.maps.exists():
            return []
        out = []
        for f in sorted(self.maps.glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                out.append({"id": f.stem, "name": d.get("name") or f.stem, "points": len(d.get("points", []))})
            except (OSError, ValueError):
                continue
        return out

    def load_map(self, map_id: str) -> Optional[Dict[str, Any]]:
        f = self.maps / f"{re.sub(r'[^A-Za-z0-9_.-]+', '_', map_id)}.json"
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            return {"name": d.get("name") or map_id, "points": [normalise_point(p) for p in d.get("points", [])]}
        except (OSError, ValueError, MapError):
            return None

    def assignments(self) -> Dict[str, str]:
        try:
            return json.loads(self.assign_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def assign(self, address: str, map_id: Optional[str]) -> None:
        self._ensure()
        a = self.assignments()
        if map_id:
            a[address] = map_id
        else:
            a.pop(address, None)
        self.assign_file.write_text(json.dumps(a, ensure_ascii=False, indent=1), encoding="utf-8")

    def points_for(self, address: str) -> Tuple[List[Dict[str, Any]], bool]:
        """The points to read for a device, and whether they come from a map (False: the unnamed first registers).
        Polling asks every few seconds, so the parsed points are kept until a file changes."""
        mid = self.assignments().get(address)
        key = None
        if mid:
            f = self.maps / f"{re.sub(r'[^A-Za-z0-9_.-]+', '_', mid)}.json"
            try:
                key = (mid, f.stat().st_mtime_ns)
            except OSError:
                key = None
        cache = self.__dict__.setdefault("_cache", {})
        hit = cache.get(address)
        if hit and hit[0] == key:
            return hit[1], hit[2]
        m = self.load_map(mid) if mid else None
        out = (m["points"], True) if m and m["points"] else (raw_points(), False)
        cache[address] = (key, out[0], out[1])
        return out
