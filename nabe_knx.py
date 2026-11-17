"""
KNX for NABE, read only.

KNX reaches the IP network through KNXnet/IP gateways on UDP 3671. This module finds them (a description request,
which connects to nothing), opens a tunnel to one, and listens: every group telegram on the bus passes through
the tunnel, and the last value of each group address is kept. For an address nobody has spoken on yet it asks
once, with a GroupValueRead, at a pace the bus can bear (a twisted-pair line carries about thirty telegrams a
second, and NABE sends five).

It cannot write. There is no function in this module that builds a GroupValueWrite or a GroupValueResponse; the
only telegram it can send is a read, and the tests check that no write ever reaches a gateway. KNX Secure
(IP Secure) is not supported: a gateway that requires it is reported as such and left alone.

The names of the group addresses come from the ETS project: the CSV export of group addresses, or the .knxproj
file itself, imported in NABE. The datapoint types decide how a value is read (1.001 on/off, 5.001 percent,
9.001 temperature and so on). The protocol is KNXnet/IP as published by the KNX Association; the discovery was
informed by the MIT-licensed HVAC-Network-Scanner by James Cupps.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import re
import socket
import struct
import time
import zipfile
from collections import deque
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
from xml.etree import ElementTree as ET

from nabe_modbus import UNIT_NAMES

KNX_PORT = 3671
SEARCH_REQ, SEARCH_RES, DESC_REQ, DESC_RES = 0x0201, 0x0202, 0x0203, 0x0204
CONNECT_REQ, CONNECT_RES, CSTATE_REQ, CSTATE_RES, DISC_REQ, DISC_RES = 0x0205, 0x0206, 0x0207, 0x0208, 0x0209, 0x020A
TUNNEL_REQ, TUNNEL_ACK = 0x0420, 0x0421
SERVICE_FAMILIES = {0x02: "Core", 0x03: "Device Management", 0x04: "Tunnelling", 0x05: "Routing", 0x06: "Remote Logging",
                    0x07: "Remote Configuration", 0x08: "Object Server", 0x09: "Security"}
APCI_READ, APCI_RESPONSE, APCI_WRITE = 0x000, 0x040, 0x080
READS_PER_SECOND = 5


class KnxError(Exception):
    pass


# ---------------------------------------------------------- group addresses
def ga_text(ga: int) -> str:
    return f"{(ga >> 11) & 0x1F}/{(ga >> 8) & 0x07}/{ga & 0xFF}"


def parse_ga(text: Any) -> int:
    """1/2/3, 1/234 or a plain number to the 16 bit group address."""
    s = str(text).strip()
    parts = s.split("/")
    try:
        if len(parts) == 3:
            m, mid, sub = (int(p) for p in parts)
            if not (0 <= m <= 31 and 0 <= mid <= 7 and 0 <= sub <= 255):
                raise ValueError
            return m << 11 | mid << 8 | sub
        if len(parts) == 2:
            m, sub = (int(p) for p in parts)
            if not (0 <= m <= 31 and 0 <= sub <= 2047):
                raise ValueError
            return m << 11 | sub
        v = int(s, 0)
        if 0 <= v <= 0xFFFF:
            return v
    except ValueError:
        pass
    raise KnxError(f"bad group address {text!r}")


def ia_text(ia: int) -> str:
    return f"{ia >> 12}.{(ia >> 8) & 0x0F}.{ia & 0xFF}"


# ----------------------------------------------------------------- datapoints
UNITS = {  # (main, sub) -> unit as a register map writes it
    (9, 1): "°C", (9, 2): "K", (9, 3): "K/h", (9, 4): "lux", (9, 5): "m/s", (9, 6): "Pa", (9, 7): "%", (9, 8): "ppm",
    (9, 9): "m3/h", (9, 10): "s", (9, 20): "mV", (9, 21): "mA", (9, 24): "kW",
    (5, 1): "%", (5, 3): "°", (7, 5): "s", (7, 6): "min", (7, 7): "h", (14, 19): "A", (14, 27): "V", (14, 56): "W",
    (14, 68): "°C", (14, 65): "m/s", (14, 58): "Pa", (14, 74): "s", (13, 13): "kWh", (13, 10): "Wh", (14, 77): "m3/s", (9, 9): "m3/h",
}
UNIT_BY_SYMBOL = dict(UNIT_NAMES, **{"m3/s": "cubic-meters-per-second", "k/h": "kelvins-per-hour", "°": "degrees-angular", "lux": "lux", "m/s": "meters-per-second",
                                     "m3/h": "cubic-meters-per-hour", "mv": "millivolts", "ma": "milliamperes"})


def parse_dpt(text: Any) -> Tuple[int, int]:
    """DPST-9-1, DPT-9, 9.001, 9 -> (9, 1). (0, 0) when the type is not given."""
    m = re.search(r"(\d+)(?:[-.](\d+))?", str(text or ""))
    return (int(m.group(1)), int(m.group(2) or 0)) if m else (0, 0)


def decode(dpt: Tuple[int, int], raw: bytes, small: bool) -> Any:
    """The value of a group telegram payload. `small` is a value that sits in the six bits of the APCI byte (1, 2, 3)."""
    main, sub = dpt
    try:
        if main == 1:
            return "active" if (raw[0] & 1) else "inactive"
        if main in (2, 3, 17, 20) and raw:
            return int(raw[0] & (0x3F if small else 0xFF))
        if main == 5:
            v = raw[0]
            return round(v * 100 / 255, 1) if sub == 1 else round(v * 360 / 255, 1) if sub == 3 else int(v)
        if main == 6:
            return struct.unpack("!b", raw[:1])[0]
        if main == 7:
            return struct.unpack("!H", raw[:2])[0]
        if main == 8:
            return struct.unpack("!h", raw[:2])[0]
        if main == 9:
            v = struct.unpack("!H", raw[:2])[0]
            mant = v & 0x07FF
            if v & 0x8000:
                mant -= 2048
            return round(0.01 * mant * (1 << ((v >> 11) & 0x0F)), 2)
        if main == 10 and len(raw) >= 3:                 # time of day
            return f"{raw[0] & 0x1F:02d}:{raw[1] & 0x3F:02d}:{raw[2] & 0x3F:02d}"
        if main == 11 and len(raw) >= 3:                 # date
            y = raw[2] & 0x7F
            return f"{2000 + y if y < 90 else 1900 + y}-{raw[1] & 0x0F:02d}-{raw[0] & 0x1F:02d}"
        if main == 19 and len(raw) >= 6:                 # date and time
            return f"{1900 + raw[0]}-{raw[1] & 0x0F:02d}-{raw[2] & 0x1F:02d} {raw[3] & 0x1F:02d}:{raw[4] & 0x3F:02d}:{raw[5] & 0x3F:02d}"
        if main == 12:
            return struct.unpack("!I", raw[:4])[0]
        if main == 13:
            return struct.unpack("!i", raw[:4])[0]
        if main == 14:
            return round(struct.unpack("!f", raw[:4])[0], 4)
        if main == 16:
            return raw.rstrip(b"\x00").decode("latin-1")
    except (struct.error, IndexError):
        return None
    # A type that is not known, or not given: the number it is, or the bytes.
    if len(raw) == 0:
        return None
    return int.from_bytes(raw, "big") if len(raw) <= 4 else raw.hex()


# A project with no datapoint types (many have none) leaves the value of a telegram to be worked out. The size of the
# telegram says what it can be, and the name says what it is: a two byte "Temperatur" is DPT 9.001, a one byte
# "Varmepådrag" is 5.001. A type found this way is a guess, and is shown as one.
_HINTS = [
    (r"co2|ppm", (9, 8)), (r"lux|lysstyrke", (9, 4)), (r"fukt|humid|\brh\b", (9, 7)),
    (r"temp|\brt\d|settpunkt|setpoint|setp\b", (9, 1)),
    (r"p[åa]drag|ventil|valve|posisjon|position|dimm|spjeld|damper|%", (5, 1)),
    (r"effekt|power|\bkw\b", (9, 24)), (r"energi|energy|kwh", (13, 13)),
    (r"p[åa]/av|av/p[åa]|status|alarm|feil|bryter|switch|drift|\blys\b|on/off|aktiv", (1, 1)),
]
_SIZE = {1: 0, 5: 1, 7: 2, 8: 2, 9: 2, 12: 4, 13: 4, 14: 4}


def guess_dpt(text: str, length: int, small: bool) -> Tuple[int, int]:
    """A datapoint type from what a group address is called and how long its telegrams are. (0, 0) when neither says."""
    if small:
        return (1, 1)
    for rx, (main, sub) in _HINTS:
        if re.search(rx, text or "", re.I):
            if main == 5 and length == 2:
                return (9, 7)
            if _SIZE.get(main) == length:
                return (main, sub)
    return (0, 0)


# ------------------------------------------------------------------- frames
def header(service: int, body: bytes) -> bytes:
    return struct.pack("!BBHH", 6, 0x10, service, 6 + len(body)) + body


def hpai(ip: str = "0.0.0.0", port: int = 0) -> bytes:
    return struct.pack("!BB4sH", 8, 0x01, socket.inet_aton(ip), port)


def ldata_read(ga: int) -> bytes:
    """The cEMI frame for a GroupValueRead, the one telegram this module can send."""
    return bytes([0x11, 0x00, 0xBC, 0xE0, 0x00, 0x00, ga >> 8, ga & 0xFF, 0x01, 0x00, 0x00])


def parse_ldata(cemi: bytes) -> Optional[Dict[str, Any]]:
    """A group telegram from a cEMI L_Data.ind or L_Data.con, or None for anything else."""
    if len(cemi) < 11 or cemi[0] not in (0x29, 0x2E):
        return None
    pos = 2 + cemi[1]
    if len(cemi) < pos + 8:
        return None
    ctrl2 = cemi[pos + 1]
    if not ctrl2 & 0x80:                              # an individual address, not a group
        return None
    src = struct.unpack("!H", cemi[pos + 2:pos + 4])[0]
    dst = struct.unpack("!H", cemi[pos + 4:pos + 6])[0]
    length = cemi[pos + 6]
    data = cemi[pos + 7:pos + 7 + 1 + length]
    if len(data) < 2:
        return None
    apci = ((data[0] & 0x03) << 8) | data[1]
    kind = apci & 0x3C0
    if kind not in (APCI_READ, APCI_RESPONSE, APCI_WRITE):
        return None
    if length == 1:
        raw, small = bytes([data[1] & 0x3F]), True
    else:
        raw, small = bytes(data[2:]), False
    return {"src": src, "dst": dst, "kind": {APCI_READ: "read", APCI_RESPONSE: "response", APCI_WRITE: "write"}[kind],
            "raw": raw, "small": small, "confirmation": cemi[0] == 0x2E}


def parse_description(data: bytes) -> Optional[Dict[str, Any]]:
    """The name, KNX address, serial number, MAC and service families in a description or search response."""
    if len(data) < 8 or data[0] != 0x06 or data[1] != 0x10:
        return None
    service, total = struct.unpack("!HH", data[2:6])
    if service not in (DESC_RES, SEARCH_RES):
        return None
    pos = 6 + (8 if service == SEARCH_RES else 0)     # a search response starts with the gateway's own HPAI
    out: Dict[str, Any] = {}
    end = min(total, len(data))
    while pos + 2 <= end:
        ln, kind = data[pos], data[pos + 1]
        if ln < 2:
            break
        body = data[pos + 2:pos + ln]
        if kind == 0x01 and len(body) >= 52:
            ia = struct.unpack("!H", body[2:4])[0]
            out.update({"knx_address": ia_text(ia), "serial": body[6:12].hex(),
                        "mac": ":".join(f"{b:02X}" for b in body[16:22]),
                        "name": re.sub(r"[^\x20-\x7e]+", " ", body[22:52].split(b"\x00", 1)[0].decode("latin-1")).strip()})
        elif kind == 0x02:
            out["services"] = [SERVICE_FAMILIES.get(body[i], f"0x{body[i]:02X}") for i in range(0, len(body) - 1, 2)]
        pos += ln
    return out or None


# ---------------------------------------------------------------- discovery
async def describe_hosts(hosts: Sequence[str], port: int = KNX_PORT, timeout: float = 2.0) -> List[Dict[str, Any]]:
    """A description request to each host on one UDP socket, and the replies collected in one window. Connects to nothing."""
    loop = asyncio.get_running_loop()
    got: Dict[str, Dict[str, Any]] = {}
    wanted = set(hosts)

    class P(asyncio.DatagramProtocol):
        def datagram_received(self, data, addr):
            if addr[0] in wanted and addr[0] not in got:
                info = parse_description(data)
                if info:
                    got[addr[0]] = info

    transport, _ = await loop.create_datagram_endpoint(P, local_addr=("0.0.0.0", 0))
    try:
        local_port = transport.get_extra_info("sockname")[1]
        for h in hosts:
            try:
                transport.sendto(header(DESC_REQ, hpai(_local_ip_for(h, port), local_port)), (h, port))
            except OSError:
                pass
            await asyncio.sleep(0.002)
        deadline = loop.time() + timeout
        while loop.time() < deadline and len(got) < len(wanted):
            await asyncio.sleep(0.05)
    finally:
        transport.close()
    out = []
    for h in hosts:
        if h in got:
            info = got[h]
            fam = info.get("services", [])
            out.append({"ip": h, "port": port, "name": info.get("name") or "KNXnet/IP", **info,
                        "tunnelling": "Tunnelling" in fam, "routing": "Routing" in fam, "secure": "Security" in fam})
    return out


def _local_ip_for(ip: str, port: int) -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((ip, port))
            return s.getsockname()[0]
    except OSError:
        return "0.0.0.0"


# ------------------------------------------------------------------- tunnel
class KnxTunnel(asyncio.DatagramProtocol):
    """A tunnel to one KNXnet/IP gateway: listens to the group telegrams and can send reads, nothing else."""

    def __init__(self, host: str, port: int = KNX_PORT, timeout: float = 3.0):
        self.host, self.port, self.timeout = host, int(port), float(timeout)
        self.transport: Optional[asyncio.DatagramTransport] = None
        self.channel = 0
        self.address = ""                     # the individual address the gateway gave us
        self._seq_out = 0
        self._seq_in = -1
        self._pending: Dict[int, asyncio.Future] = {}
        self._connect_fut: Optional[asyncio.Future] = None
        self.values: Dict[int, Dict[str, Any]] = {}     # group address -> last telegram
        self.last_used = time.monotonic()
        self.connected = False
        self._heartbeat: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self.telegrams = 0
        self.log: deque = deque(maxlen=3000)         # every group telegram heard: for a monitor, newest last
        self.seq = 0

    # --- asyncio plumbing
    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data: bytes, addr):
        if len(data) < 6 or data[0] != 0x06:
            return
        service = struct.unpack("!H", data[2:4])[0]
        body = data[6:]
        if service == CONNECT_RES and self._connect_fut and not self._connect_fut.done():
            self._connect_fut.set_result(body)
        elif service == TUNNEL_REQ and len(body) >= 4:
            channel, seq = body[1], body[2]
            if channel != self.channel:
                return
            self._send(header(TUNNEL_ACK, bytes([4, channel, seq, 0])))
            if seq == self._seq_in:                # a repeat of one already taken: acknowledged, not counted twice
                return
            self._seq_in = seq
            t = parse_ldata(body[4:])
            if t and not t["confirmation"]:
                self.seq += 1
                self.log.append({"n": self.seq, "t": time.time(), "src": t["src"], "dst": t["dst"], "kind": t["kind"], "raw": t["raw"], "small": t["small"]})
            if t and t["kind"] in ("write", "response"):
                self.telegrams += 1
                self.values[t["dst"]] = {"t": time.time(), "src": t["src"], "kind": t["kind"], "raw": t["raw"], "small": t["small"]}
        elif service == TUNNEL_ACK and len(body) >= 4:
            fut = self._pending.pop(body[2], None)
            if fut and not fut.done():
                fut.set_result(body[3])
        elif service == DISC_REQ:
            self.connected = False

    def connection_lost(self, exc):
        self.connected = False

    def _send(self, data: bytes) -> None:
        if self.transport is not None:
            self.transport.sendto(data, (self.host, self.port))

    # --- life cycle
    async def connect(self) -> str:
        loop = asyncio.get_running_loop()
        await self.close()
        await loop.create_datagram_endpoint(lambda: self, local_addr=("0.0.0.0", 0), remote_addr=None)
        self._connect_fut = loop.create_future()
        cri = bytes([4, 0x04, 0x02, 0x00])       # a tunnel at link layer
        self._send(header(CONNECT_REQ, hpai() + hpai() + cri))
        try:
            body = await asyncio.wait_for(self._connect_fut, self.timeout)
        except asyncio.TimeoutError as e:
            await self.close()
            raise KnxError("the gateway did not answer the connection request") from e
        if len(body) < 2 or body[1] != 0:
            await self.close()
            code = body[1] if len(body) > 1 else -1
            raise KnxError({0x22: "the gateway does not offer a tunnel of this kind", 0x24: "the gateway has no free tunnel",
                            0x23: "the gateway refused the connection"}.get(code, f"the gateway refused the connection ({code})"))
        self.channel = body[0]
        if len(body) >= 14:
            self.address = ia_text(struct.unpack("!H", body[12:14])[0])
        self.connected = True
        self._seq_out = 0
        self._seq_in = -1
        self._heartbeat = asyncio.create_task(self._beat())
        return self.address

    async def _beat(self) -> None:
        while self.connected:
            await asyncio.sleep(55)
            if self.connected:
                self._send(header(CSTATE_REQ, bytes([self.channel, 0]) + hpai()))

    async def close(self) -> None:
        if self._heartbeat:
            self._heartbeat.cancel()
            self._heartbeat = None
        if self.transport is not None:
            if self.connected:
                try:
                    self._send(header(DISC_REQ, bytes([self.channel, 0]) + hpai()))
                except Exception:
                    pass
            self.transport.close()
            self.transport = None
        self.connected = False

    # --- reads: the only telegram that goes out
    async def read(self, ga: int) -> bool:
        """Ask the bus for a group address's value, once. True when the gateway took the request. The answer
        arrives as a telegram and lands in `values`."""
        if not self.connected:
            raise KnxError("not connected")
        async with self._lock:
            seq = self._seq_out
            fut = asyncio.get_running_loop().create_future()
            self._pending[seq] = fut
            frame = header(TUNNEL_REQ, bytes([4, self.channel, seq, 0]) + ldata_read(ga))
            for _ in range(2):
                self._send(frame)
                try:
                    status = await asyncio.wait_for(asyncio.shield(fut), 1.0)
                    self._seq_out = (seq + 1) & 0xFF
                    return status == 0
                except asyncio.TimeoutError:
                    continue
            self._pending.pop(seq, None)
            raise KnxError("the gateway did not acknowledge the read")

    async def read_many(self, gas: Sequence[int], per_second: float = READS_PER_SECOND, wait: float = 2.5,
                        progress: Optional[Callable[[int, int], None]] = None) -> int:
        """Read each address once, at a pace the bus can bear, then wait a moment for the last answers. Returns
        how many were asked for."""
        asked = 0
        gap = 1.0 / max(0.5, min(per_second, 8.0))
        for i, ga in enumerate(gas):
            try:
                await self.read(ga)
                asked += 1
            except KnxError:
                break
            if progress:
                progress(i + 1, len(gas))
            await asyncio.sleep(gap)
        await asyncio.sleep(wait)
        return asked


# --------------------------------------------------------------- group lists
def point_for(ga: int, name: str, dpt: Tuple[int, int], description: str = "", value: Any = None, seen: bool = True) -> Dict[str, Any]:
    """A group address as the flat record the UI consumes, in the shape of a BACnet point."""
    main, sub = dpt
    binary = main == 1
    otype = "binary-value" if binary else "analog-value"
    unit = UNITS.get((main, sub), "")
    return {
        "objid": f"{otype},{ga}", "type": otype, "instance": ga, "name": name or ga_text(ga), "value": value,
        "description": description or (f"KNX {ga_text(ga)}" + (f" DPT {main}.{sub:03d}" if main else "")),
        "units": None if binary else UNIT_BY_SYMBOL.get(unit.lower(), unit or "no-units"),
        "unit_symbol": "" if binary else unit, "status": [], "status_lest": False, "writable": False,
        "numeric": not binary and isinstance(value, (int, float)) and not isinstance(value, bool),
        "knx": {"ga": ga_text(ga), "dpt": f"{main}.{sub:03d}" if main else ""},
    }


def parse_group_list(data: bytes, filename: str = "") -> Dict[str, Any]:
    """Group addresses from an ETS project (.knxproj, no password) or from a CSV: the ETS export of group addresses
    (Group name; Address; ...; Description; Datapoint Type), or columns of address, name, dpt, description."""
    if data[:2] == b"PK":
        return _from_knxproj(data)
    text = data.decode("utf-8-sig", "replace") if not data.startswith(b"\xff\xfe") else data.decode("utf-16")
    sample = text[:3000]
    delim = max(";\t,", key=sample.count)
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = [r for r in reader if any(c.strip() for c in r)]
    if not rows:
        raise KnxError("the file is empty")
    head = [c.strip().lower() for c in rows[0]]
    def col(*names):
        for n in names:
            for i, h in enumerate(head):
                if h == n or h.startswith(n):
                    return i
        return -1
    ia = col("address", "adresse", "group address", "ga")
    iname = col("group name", "name", "navn", "gruppenavn")
    idpt = col("datapointtype", "datapoint type", "dpt", "datapunkttype", "type")
    idesc = col("description", "beskrivelse")
    if ia < 0:
        raise KnxError("no address column in the file")
    points, seen = [], set()
    for n, r in enumerate(rows[1:], 2):
        if ia >= len(r) or not r[ia].strip():
            continue
        try:
            ga = parse_ga(r[ia])
        except KnxError:
            continue                         # a row for a main or middle group has no address
        if ga in seen:
            raise KnxError(f"row {n}: {ga_text(ga)} is in the list twice")
        seen.add(ga)
        dpt = parse_dpt(r[idpt]) if 0 <= idpt < len(r) else (0, 0)
        points.append({"ga": ga, "name": (r[iname].strip() if 0 <= iname < len(r) else "") or ga_text(ga),
                       "dpt": f"{dpt[0]}.{dpt[1]:03d}" if dpt[0] else "", "description": r[idesc].strip() if 0 <= idesc < len(r) else ""})
    if not points:
        raise KnxError("the list has no group addresses")
    return {"name": Path(filename).stem if filename else "", "points": points}


def _from_knxproj(data: bytes) -> Dict[str, Any]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise KnxError("not a valid zip file") from e
    xmls = [n for n in z.namelist() if n.lower().endswith("0.xml")]
    if not xmls:
        raise KnxError("the project is password protected or has no group addresses. Export the group addresses from ETS as CSV instead")
    points, seen = [], set()
    for n in xmls:
        if z.getinfo(n).file_size > 80_000_000:
            raise KnxError("the project file is too large")
        try:
            root = ET.fromstring(z.read(n))
        except ET.ParseError:
            continue
        # What the communication objects say about the group addresses they are linked to: the read flag (an object that
        # has it on answers a GroupValueRead) and the datapoint type some of them carry.
        by_suffix: Dict[str, int] = {}
        for el in root.iter():
            if el.tag.split("}")[-1] == "GroupAddress" and (el.get("Address") or "").isdigit():
                by_suffix[(el.get("Id") or "").rsplit("_", 1)[-1]] = int(el.get("Address"))
        leser: Dict[int, Optional[bool]] = {}
        refdpt: Dict[int, str] = {}
        for el in root.iter():
            if el.tag.split("}")[-1] != "ComObjectInstanceRef" or not el.get("Links"):
                continue
            flag = el.get("ReadFlag")
            for link in el.get("Links").split():
                ga = by_suffix.get(link)
                if ga is None:
                    continue
                if flag == "Enabled":
                    leser[ga] = True
                elif flag == "Disabled" and leser.get(ga) is None:
                    leser[ga] = False
                if el.get("DatapointType") and ga not in refdpt:
                    refdpt[ga] = el.get("DatapointType").split(" ")[0]
        for el in root.iter():
            if el.tag.split("}")[-1] != "GroupAddress":
                continue
            try:
                ga = int(el.get("Address", ""))
            except ValueError:
                continue
            if ga in seen or not 0 <= ga <= 0xFFFF:
                continue
            seen.add(ga)
            dpt = parse_dpt((el.get("DatapointType") or refdpt.get(ga) or "").split(" ")[0])
            p = {"ga": ga, "name": el.get("Name") or ga_text(ga), "dpt": f"{dpt[0]}.{dpt[1]:03d}" if dpt[0] else "",
                 "description": el.get("Description") or ""}
            if ga in leser:
                p["leser"] = leser[ga]
            points.append(p)
    if not points:
        raise KnxError("the project has no group addresses")
    return {"name": "", "points": sorted(points, key=lambda p: p["ga"])}


class GroupStore:
    """Group address lists and which gateway uses which, as plain JSON files under the NABE data folder."""

    def __init__(self, folder: Path):
        self.folder = Path(folder) / "knx"
        self.lists = self.folder / "lister"
        self.assign_file = self.folder / "tilordning.json"

    def save(self, name: str, parsed: Dict[str, Any]) -> str:
        self.lists.mkdir(parents=True, exist_ok=True)
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", (name or parsed.get("name") or "ets").strip()).strip("_") or "ets"
        (self.lists / f"{slug}.json").write_text(json.dumps({"name": name or parsed.get("name") or slug, "points": parsed["points"]},
                                                           ensure_ascii=False), encoding="utf-8")
        return slug

    def list_all(self) -> List[Dict[str, Any]]:
        out = []
        for f in sorted(self.lists.glob("*.json")) if self.lists.exists() else []:
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                pts = d.get("points", [])
                out.append({"id": f.stem, "name": d.get("name") or f.stem, "points": len(pts), "lesbare": sum(1 for p in pts if p.get("leser") is True)})
            except (OSError, ValueError):
                continue
        return out

    def load(self, list_id: str) -> Optional[Dict[str, Any]]:
        try:
            return json.loads((self.lists / f"{re.sub(r'[^A-Za-z0-9_.-]+', '_', list_id)}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def assignments(self) -> Dict[str, str]:
        try:
            return json.loads(self.assign_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def assign(self, address: str, list_id: Optional[str]) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        a = self.assignments()
        if list_id:
            a[address] = list_id
        else:
            a.pop(address, None)
        self.assign_file.write_text(json.dumps(a, ensure_ascii=False), encoding="utf-8")

    def edit_point(self, address: str, ga: int, changes: Dict[str, Any]) -> Tuple[str, int]:
        """Change the name, description or datapoint type of one group address in the ETS list a gateway uses, or add it when the list
        does not have it (an address heard on the bus). A gateway with no list gets one of its own. Returns the list and how many gateways use it."""
        lid = self.assignments().get(address)
        d = self.load(lid) if lid else None
        if d is None:
            d = {"name": f"Egen {address}", "points": []}
            lid = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"Egen {address}").strip("_")
        pts = d["points"]
        p = next((x for x in pts if x["ga"] == ga), None)
        if p is None:
            p = {"ga": ga, "name": ga_text(ga), "dpt": "", "description": ""}
            pts.append(p)
        if "name" in changes:
            p["name"] = str(changes["name"]).strip() or ga_text(ga)
        if "description" in changes:
            p["description"] = str(changes["description"]).strip()
        if "dpt" in changes:
            t = parse_dpt(changes["dpt"])
            p["dpt"] = f"{t[0]}.{t[1]:03d}" if t[0] else ""
        self.lists.mkdir(parents=True, exist_ok=True)
        (self.lists / f"{lid}.json").write_text(json.dumps({"name": d["name"], "points": sorted(pts, key=lambda x: x["ga"])}, ensure_ascii=False), encoding="utf-8")
        self.assign(address, lid)
        return lid, sum(1 for v in self.assignments().values() if v == lid)

    def points_for(self, address: str) -> List[Dict[str, Any]]:
        lid = self.assignments().get(address)
        d = self.load(lid) if lid else None
        return list(d["points"]) if d else []


def device_address(host: str, port: int) -> str:
    return f"kx:{host}:{port}"


def parse_address(address: str) -> Optional[Tuple[str, int]]:
    m = re.fullmatch(r"kx:([^:/]+):(\d+)", str(address))
    return (m.group(1), int(m.group(2))) if m else None


def device_record(d: Dict[str, Any]) -> Dict[str, Any]:
    name = d.get("name") or f"KNX {d['ip']}"
    return {"address": device_address(d["ip"], d["port"]), "ip": d["ip"], "port": d["port"], "device_instance": 1, "protocol": "knx",
            "object_name": name, "vendor_name": "KNX", "model_name": ", ".join(d.get("services", [])), "firmware": "",
            "knx_address": d.get("knx_address", ""), "serial": d.get("serial", ""), "tunnelling": d.get("tunnelling", False),
            "routing": d.get("routing", False), "secure": d.get("secure", False)}
