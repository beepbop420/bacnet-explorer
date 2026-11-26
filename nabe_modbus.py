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
import os
import re
import struct
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from xml.etree import ElementTree as ET

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
        self.count = 0                         # requests sent, for a budget

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
        self.count += 1
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


def crc16(data: bytes) -> int:
    """The Modbus CRC-16 (polynomial 0xA001), sent low byte first."""
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


class RtuClient(ModbusClient):
    """Modbus RTU: the unit, the PDU and a CRC, with no header. Over a TCP socket to a serial gateway that passes
    the bytes through, or on a serial port (RS-485 on the bus, USB adapter on the PC). One master, one request at a
    time. Serial needs pyserial, which is loaded when a port is opened and not before."""

    def __init__(self, host: str = "", port: int = MODBUS_PORT, timeout: float = 2.0, serial_port: Optional[str] = None,
                 baud: int = 19200, parity: str = "N", stopbits: int = 1, bytesize: int = 8):
        super().__init__(host, port, timeout)
        self.serial_port, self.baud, self.parity, self.stopbits, self.bytesize = serial_port, int(baud), parity, int(stopbits), int(bytesize)
        self._ser: Any = None

    async def connect(self) -> None:
        await self.close()
        if not self.serial_port:
            await super().connect()
            return
        try:
            import serial
        except ImportError as e:
            raise ModbusError("pyserial is not installed, so NABE cannot open a serial port") from e
        try:
            self._ser = await asyncio.to_thread(
                lambda: serial.serial_for_url(self.serial_port, baudrate=self.baud, bytesize=self.bytesize, parity=self.parity,
                                              stopbits=self.stopbits, timeout=0.05, write_timeout=1.0))
        except Exception as e:
            raise ModbusError(f"serial port {self.serial_port}: {e}") from e

    async def close(self) -> None:
        ser, self._ser = self._ser, None
        if ser is not None:
            try:
                await asyncio.to_thread(ser.close)
            except Exception:
                pass
        await super().close()

    @property
    def _open(self) -> bool:
        return self._ser is not None if self.serial_port else self._writer is not None

    async def _write(self, frame: bytes) -> None:
        if self.serial_port:
            await asyncio.sleep(max(0.004, 40.0 / self.baud))          # the silent interval of 3.5 characters between frames
            await asyncio.to_thread(self._ser.reset_input_buffer)
            await asyncio.to_thread(self._ser.write, frame)
        else:
            self._writer.write(frame)
            await asyncio.wait_for(self._writer.drain(), self.timeout)

    async def _take(self, n: int, deadline: float) -> bytes:
        if not self.serial_port:
            return await self._read_exact(n, deadline)
        buf = b""
        while len(buf) < n:
            if time.monotonic() >= deadline:
                raise asyncio.TimeoutError()
            buf += await asyncio.to_thread(self._ser.read, n - len(buf))
        return buf

    async def _take_idle(self, deadline: float) -> bytes:
        """What else arrives until the line has been quiet for a moment: an answer whose length cannot be known beforehand."""
        out = b""
        gap = 0.06 if self.serial_port else 0.15
        while len(out) < 250:
            try:
                if self.serial_port:
                    more = await asyncio.to_thread(self._ser.read, 64)
                    if not more:
                        break
                    out += more
                else:
                    out += await asyncio.wait_for(self._reader.read(64), gap)
            except asyncio.TimeoutError:
                break
            if time.monotonic() >= deadline:
                break
        return out

    async def request(self, unit: int, pdu: bytes) -> bytes:
        if not pdu or pdu[0] in FORBIDDEN_FUNCTIONS:
            raise ModbusError("this client does not write")
        frame = bytes([unit]) + pdu
        frame += struct.pack("<H", crc16(frame))
        self.count += 1
        async with self._lock:
            for attempt in (0, 1):
                try:
                    if not self._open:
                        await self.connect()
                    await self._write(frame)
                    deadline = time.monotonic() + self.timeout
                    head = await self._take(3, deadline)
                    fn = head[1]
                    if fn & 0x80:
                        rest = await self._take(2, deadline)
                    elif fn in (1, 2, 3, 4, 0x11):
                        rest = await self._take(head[2] + 2, deadline)
                    else:
                        rest = await self._take_idle(deadline)
                    full = head + rest
                    if len(full) < 5 or crc16(full[:-2]) != struct.unpack("<H", full[-2:])[0]:
                        raise ModbusError("bad CRC in the answer")
                    if full[0] != unit:
                        raise ModbusError(f"the answer is from unit {full[0]}, not {unit}")
                    body = full[1:-2]
                    break
                except asyncio.TimeoutError as e:
                    if not self.serial_port:
                        await self.close()
                    raise ModbusError("timeout") from e
                except (OSError, ConnectionError, ModbusError) as e:
                    if not self.serial_port:
                        await self.close()
                    if attempt or "CRC" in str(e):
                        raise ModbusError(str(e)) from e
            else:
                raise ModbusError("no answer")
        if body[0] & 0x80:
            raise ModbusException(body[0] & 0x7F, body[1] if len(body) > 1 else 0)
        return body


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
async def tcp_sweep(hosts: Sequence[str], port: int = MODBUS_PORT, timeout: float = 0.8, concurrency: int = 256) -> List[str]:
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
    return (await probe_unit2(client, unit))[0]


async def probe_unit2(client: ModbusClient, unit: int, quick: bool = False):
    """(what answered or None, whether it was silence). `quick` is for the units after the first: a device that
    ignores a unit it is not does so by saying nothing, and every silence costs a timeout, so a quick probe asks
    once with a short wait instead of three times with a long one."""
    stille = False
    uten43 = False
    try:
        ident = await client.device_identification(unit)
        if ident:
            return {"via": "device_identification", **ident}, False
        return {"via": "device_identification"}, False
    except ModbusException as e:
        if e.code == 0x0A:                  # the gateway has no path to this unit
            return None, False
        # 0x0B, "target failed to respond", is also what some gateways say when the unit is there but ignores
        # function 43: a plain register read decides. Server ID is no better question, so it is not asked.
        uten43 = e.code == 0x0B
        if uten43:
            client.bak_gateway = True       # only a gateway says that
        # Function 43 is optional; a device that refuses it with another exception is still a device.
    except ModbusError:
        stille = True
    if not quick and not uten43:
        try:
            sid = await client.server_id(unit)
            return {"via": "report_server_id", "product_name": sid.get("text") or ""}, False
        except ModbusException as e:
            if e.code in GATEWAY_NO_DEVICE:
                return None, False
        except ModbusError:
            pass
    # Behind a busy serial gateway a unit that is there answers 0x0B now and then, so that answer is asked twice.
    for forsok in range(2):
        try:
            await client.read_registers(unit, "holding", 0, 1)
            return {"via": "holding_read"}, False
        except ModbusException as e:
            if e.code == 0x0B and not forsok:
                continue
            if e.code in GATEWAY_NO_DEVICE:
                return None, False
            return {"via": "exception_response"}, False     # a device that says "no such register" is alive
        except ModbusError:
            return None, stille or True
    return None, False


async def scan_host(host: str, port: int = MODBUS_PORT, units: Optional[Iterable[int]] = None, timeout: float = 1.0,
                    framing: str = "tcp", progress=None) -> List[Dict[str, Any]]:
    """The units that answer on one host. A device that ignores the unit and answers the same for all of them
    is reported once, not nine times. `framing` is "tcp" (Modbus TCP) or "rtu" (RTU bytes in a TCP socket).
    Without `units` a few common ids are asked first, and behind a gateway then every id 1-247.
    `progress(unit, round, found)` is told what is being asked."""
    client = ModbusClient(host, port, timeout) if framing != "rtu" else RtuClient(host, port, timeout)
    return await _scan_units(client, units, timeout, lambda f: device_record(host, port, f, "mr" if framing == "rtu" else "mb"), progress)


async def scan_serial(port: str, baud: int = 19200, parity: str = "N", stopbits: int = 1, units: Optional[Iterable[int]] = None,
                      timeout: float = 0.6) -> List[Dict[str, Any]]:
    """The units that answer on a serial bus, one question at a time: a serial bus has one master and a slow line."""
    client = RtuClient("", 0, timeout, serial_port=port, baud=baud, parity=parity, stopbits=stopbits)
    await client.connect()                 # a port that cannot be opened is said, not taken for an empty bus
    await client.close()
    return await _scan_units(client, units or range(1, 33), timeout, lambda f: serial_record(port, baud, parity, stopbits, f))


async def _answers(client: ModbusClient, unit: int, kind: str) -> Optional[str]:
    """One plain read of register 0: anything but silence and the gateway saying there is nobody means a unit is there."""
    try:
        await client.read_registers(unit, kind, 0, 1)
        return f"{kind}_read"
    except ModbusException as e:
        return None if e.code in GATEWAY_NO_DEVICE else "exception_response"
    except ModbusError:
        return None


async def _scan_units(client: ModbusClient, units: Optional[Iterable[int]], timeout: float, make, progress=None) -> List[Dict[str, Any]]:
    """Which units answer behind one connection. Without `units` the common ids are asked first. When there turns out to
    be more than one unit, or a gateway, the whole range 1-247 is asked: a plant puts its units on whatever ids it likes.
    A list given by the caller is asked in full.

    A serial bus behind a gateway loses questions: units that are there answer "nobody" one time in four to ten, whatever
    the pace. So there the silent ids are asked again, with holding and input registers in turn: four times in all for
    ids up to 64 (where units nearly always are, and for a list the caller gave), twice for the rest."""
    auto = units is None
    units = [u for u in (units or COMMON_UNITS) if 1 <= int(u) <= 255]
    found: List[Dict[str, Any]] = []
    stille = 0
    voksent_tid = client.timeout

    def alike() -> bool:
        return len({(f.get("vendor"), f.get("product_code"), f.get("product_name"), f.get("via")) for f in found}) == 1

    try:
        await client.connect()
        for i, u in enumerate(units):
            t0 = time.monotonic()
            if i:
                # The first unit gets the full wait, the rest a short one; longer behind a gateway with a serial bus.
                client.timeout = min(voksent_tid, 1.0 if getattr(client, "bak_gateway", False) else 0.5)
            if progress:
                progress(u, 1, len(found))
            info, var_stille = await probe_unit2(client, u, quick=bool(i))
            if info is not None:
                found.append({"unit": u, "rtt_ms": round((time.monotonic() - t0) * 1000), **info})
                stille = 0
            elif var_stille:
                stille += 1
            else:
                stille = 0
            # The common ids only: two silences in a row after something answered, or three with nothing found, and the
            # rest of them would only be more waiting. A list asked for is asked in full, and so is a gateway.
            if auto and not getattr(client, "bak_gateway", False) and ((found and stille >= 2) or (not found and stille >= 3)):
                break
        gateway = getattr(client, "bak_gateway", False)
        # A plain device that ignores the unit id answers everything alike: there is nothing more to look for
        svarer_alt = not gateway and len(units) >= 3 and len(found) == len(units) and alike()
        if not svarer_alt and (gateway or (auto and len(found) >= 2)):
            alle = list(range(1, 248)) if auto else units
            # A gateway says "nobody there" within a second; waiting longer keeps a slow unit from being taken for none
            client.timeout = max(voksent_tid, 1.5) if gateway else min(voksent_tid, 0.5)
            for runde, kind in enumerate(("holding", "input", "holding", "input") if gateway else ("holding",), 1):
                har = {f["unit"] for f in found}
                for u in alle:
                    if u in har or (runde == 1 and u in units) or (runde > 2 and auto and u > 64):
                        continue
                    if progress:
                        progress(u, runde + 1, len(found))
                    t0 = time.monotonic()
                    via = await _answers(client, u, kind)
                    if via:
                        ident: Dict[str, Any] = {}
                        try:
                            ident = await client.device_identification(u) or {}
                        except ModbusError:
                            pass
                        found.append({"unit": u, "rtt_ms": round((time.monotonic() - t0) * 1000), **ident,
                                      "via": "device_identification" if ident else via})
    except ModbusError:
        pass
    finally:
        client.timeout = voksent_tid
        await client.close()
    if not getattr(client, "bak_gateway", False) and len(units) >= 3 and len(found) == len(units) and alike():
        found = [{**found[0], "answers_any_unit": True}]
    return [make(f) for f in sorted(found, key=lambda f: f["unit"])]


def device_address(host: str, port: int, unit: int, scheme: str = "mb") -> str:
    return f"{scheme}:{host}:{port}/{unit}"


def serial_address(port: str, baud: int, parity: str, stopbits: int, unit: int) -> str:
    return f"ms:{port}@{baud}-8{parity}{stopbits}/{unit}"


def parse_address(address: str) -> Optional[Tuple[str, int, int]]:
    """mb:192.168.1.5:502/3 -> ("192.168.1.5", 502, 3), and None for anything else (also for RTU and serial)."""
    m = re.fullmatch(r"mb:([^:/]+):(\d+)/(\d+)", str(address))
    return (m.group(1), int(m.group(2)), int(m.group(3))) if m else None


def parse_any(address: str) -> Optional[Dict[str, Any]]:
    """Any Modbus address: mb:host:port/unit (TCP), mr:host:port/unit (RTU over TCP), ms:COM3@19200-8N1/unit (serial)."""
    a = str(address)
    m = re.fullmatch(r"m([br]):([^:/]+):(\d+)/(\d+)", a)
    if m:
        scheme = "m" + m.group(1)
        return {"scheme": scheme, "framing": "tcp" if scheme == "mb" else "rtu", "host": m.group(2), "port": int(m.group(3)),
                "unit": int(m.group(4)), "key": f"{scheme}:{m.group(2)}:{m.group(3)}"}
    m = re.fullmatch(r"ms:([A-Za-z0-9_./:\\-]+)@(\d+)-(\d)([NEO])(\d)/(\d+)", a)
    if m:
        return {"scheme": "ms", "framing": "rtu", "serial": m.group(1), "baud": int(m.group(2)), "parity": m.group(4),
                "stopbits": int(m.group(5)), "unit": int(m.group(6)), "key": f"ms:{m.group(1)}@{m.group(2)}-{m.group(3)}{m.group(4)}{m.group(5)}"}
    return None


def make_client(p: Dict[str, Any], timeout: float = 2.5) -> ModbusClient:
    if p["scheme"] == "mb":
        return ModbusClient(p["host"], p["port"], timeout)
    if p["scheme"] == "mr":
        return RtuClient(p["host"], p["port"], timeout)
    return RtuClient("", 0, max(timeout, 1.0), serial_port=p["serial"], baud=p["baud"], parity=p["parity"], stopbits=p["stopbits"])


def serial_record(port: str, baud: int, parity: str, stopbits: int, found: Dict[str, Any]) -> Dict[str, Any]:
    unit = int(found["unit"])
    name = " ".join(x for x in (found.get("vendor"), found.get("product_name") or found.get("model_name") or found.get("product_code")) if x)
    return {
        "address": serial_address(port, baud, parity, stopbits, unit), "ip": port, "port": baud, "unit": unit,
        "device_instance": unit, "protocol": "modbus", "object_name": name or f"Modbus {port} #{unit}",
        "vendor_name": found.get("vendor") or "", "model_name": found.get("product_name") or found.get("model_name") or found.get("product_code") or "",
        "firmware": found.get("revision") or "", "detected_via": found.get("via"), "answers_any_unit": bool(found.get("answers_any_unit")),
        "serial": True,
    }


def serial_ports() -> List[Dict[str, str]]:
    """The serial ports of this PC, or [] when pyserial is not there or no port is."""
    try:
        from serial.tools import list_ports
    except ImportError:
        return []
    return [{"port": p.device, "name": p.description or p.device} for p in list_ports.comports()]


def device_record(host: str, port: int, found: Dict[str, Any], scheme: str = "mb") -> Dict[str, Any]:
    unit = int(found["unit"])
    name = " ".join(x for x in (found.get("vendor"), found.get("product_name") or found.get("model_name") or found.get("product_code")) if x)
    return {
        "address": device_address(host, port, unit, scheme), "ip": host, "port": port, "unit": unit,
        "device_instance": unit, "protocol": "modbus", "object_name": name or (host if unit == 1 else f"{host} #{unit}"),
        "rtt_ms": found.get("rtt_ms"), "vendor_url": found.get("vendor_url") or "",
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


# Regin's EXOL lists (Corrigo, EXO): Modbus Type; Signal Name; EXOL Type; Modbus Address; Default Value; Function; Description.
_EXOL_FN = {"coil": "coil", "coils": "coil", "holding register": "holding", "holding registers": "holding",
            "input register": "input", "input registers": "input", "input status register": "discrete",
            "input status registers": "discrete", "input status": "discrete", "discrete input": "discrete", "discrete inputs": "discrete"}


def unit_from_text(name: str, description: str, scaled: bool) -> str:
    """A list with no unit column still says it in the words: "(Pa)", "m3/h", "Sequence A output (%)", "Supply air temperature".
    Only what the words say; a number with nothing said about it has no unit."""
    d = f"{description} {name}"
    m = re.search(r"\((%|Pa|kPa|bar|m3/h|m³/h|l/s|°C|s|min|h|rpm|kW|kWh|A|V|Hz|ppm)\)", d)
    if m:
        return m.group(1)
    if re.search(r"m3/h|m³/h", d):
        return "m3/h"
    if re.search(r"(?i)time|delay|period|hysteresis|status|alarm|mode|select|[kx]-constant|offset.*\b(pa|m3)", d):
        return ""
    if scaled and re.search(r"(?i)temperature|\btemp\b|frost.*temp", d):
        return "°C"
    if re.search(r"(?i)\b(output|speed|control|signal)\b.*\b(fan|saf|eaf|damper|valve|pump|sequence)\b|\b(fan|saf|eaf|damper|valve|pump|sequence)\b.*\b(output|speed|control|signal)\b", d) and scaled:
        return "%"
    if scaled and re.search(r"(?i)pressure", d):
        return "Pa"
    return ""


def _exol_rows(reader_rows: List[Dict[str, Any]], real_scale: float) -> List[Dict[str, Any]]:
    """EXOL type L is a bit, I an integer, R a real (a whole number in the register, scaled), X an index or state."""
    out = []
    for r in reader_rows:
        fn = _EXOL_FN.get(str(r.get("modbus type", "")).strip().lower())
        if fn is None:
            continue
        et = str(r.get("exol type", "")).strip().upper()
        if fn in ("coil", "discrete") or et == "L":
            typ, scale = "bool", 1
        elif et == "R":
            typ, scale = "s16", real_scale
        elif et == "X":
            typ, scale = "u16", 1
        else:
            typ, scale = "s16", 1
        desc = r.get("description") or r.get("function") or ""
        out.append({"function": fn, "address": r.get("modbus address"), "type": typ, "scale": scale,
                    "name": r.get("signal name"), "description": desc,
                    "unit": "" if typ == "bool" else unit_from_text(str(r.get("signal name") or ""), desc, et == "R")})
    return out


_ALIAS = {
    "address": ("address", "adresse", "register", "reg", "regno", "regnr", "registeradresse", "modbusadresse", "modbusaddress", "dataaddress",
                "adr", "regadr", "regadresse", "startadresse", "newaddress", "nyadresse"),
    "function": ("function", "funksjon", "fn", "fc", "functioncode", "funksjonskode", "regtype", "registertype", "registrertype"),
    "type": ("type", "datatype", "dataformat", "format", "datatyp"),
    "name": ("name", "navn", "signal", "signalname", "signalnavn", "tag", "tagname", "punkt", "punktnavn", "variabel", "variable", "newname", "nyttnavn"),
    "description": ("description", "beskrivelse", "kommentar", "comment", "desc", "tekst", "text"),
    "unit": ("unit", "units", "enhet"),
    "scale": ("scale", "skala", "faktor", "multiplier", "gain", "factor"),
    "offset": ("offset",), "order": ("order", "wordorder", "byteorder"), "bit": ("bit", "bitnr", "bitnumber"),
}
_ALIAS_REV = {a: k for k, names in _ALIAS.items() for a in names}


def _alias_row(r: Dict[str, Any]) -> Dict[str, Any]:
    """The columns of a list under their own names, by the many names a technician gives them."""
    out: Dict[str, Any] = {}
    for k, v in r.items():
        key = _ALIAS_REV.get(re.sub(r"[\s_.\-]", "", str(k).lower()))
        if key and key not in out:
            out[key] = v
    return out


_MODICON = re.compile(r"^(?:([0134])x(\d{4,5})|([0134])(\d{4,5}))$")


def _modicon(a: Any) -> Optional[Tuple[str, int]]:
    """40012, 30066, 300066 or 3x0661: the leading digit says what it is (0 coil, 1 discrete input, 3 input register, 4 holding
    register) and the rest is the address, counted from 1. Returns (function, address as written)."""
    m = _MODICON.match(str(a).strip().lower())
    if not m:
        return None
    d, n = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
    return {"0": "coil", "1": "discrete", "3": "input", "4": "holding"}[d], int(n)


_NIAGARA_TYPES = {"signed integer": "s16", "integer type": "u16", "unsigned integer": "u16", "float": "f32", "boolean": "bool"}


def _niagara_rows(raw_rows: List[Dict[str, Any]], notes: List[str]) -> List[Dict[str, Any]]:
    """A Niagara export of the points of a Modbus TCP network: Path, Name, Type, Absolute Address (Modbus:30066), Data Type,
    Conversion and Facets. The folders above a point carry the system and the component, so the name is built from them."""
    folders = {str(r.get("path", "")): str(r.get("name", "")) for r in raw_rows if "folder" in str(r.get("type", "")).lower()}
    out, uten_omregning = [], 0
    for r in raw_rows:
        typ = str(r.get("type", "")).lower()
        if "folder" in typ or not ("point" in typ or "writable" in typ):
            continue
        mod = _modicon(re.sub(r"(?i)^modbus:", "", str(r.get("absolute address") or r.get("data address") or "")))
        if not mod:
            continue
        path = str(r.get("path", ""))
        ancestors, cur = [], ""
        if "/points/" in path:
            for seg in path.split("/points/", 1)[1].split("/")[:-1]:
                cur = f"{cur}/{seg}"
                ancestors.append(folders.get(path.split("/points/", 1)[0] + "/points" + cur) or seg)
        navn = str(r.get("name", ""))
        deler = [x for x in ancestors[1:] if x] + [navn]
        sys_ = ancestors[0] if ancestors and re.fullmatch(r"\d{3}\.\d{2,3}", ancestors[0]) else ""
        full = (f"{sys_}-" if sys_ else "") + "_".join(deler)
        fac = str(r.get("facets", ""))
        um = re.search(r"units=u:\w+;([^;|]*)", fac)
        conv = str(r.get("conversion", ""))
        sm = re.search(r"\*\s*([0-9]*\.?[0-9]+)", conv)
        if conv.startswith("Linear|"):
            uten_omregning += 1
        dt = _NIAGARA_TYPES.get(str(r.get("data type", "")).strip().lower(), "bool" if "boolean" in typ else "u16")
        out.append({"address": re.sub(r"(?i)^modbus:", "", str(r.get("absolute address") or r.get("data address"))).strip(), "type": dt, "name": full,
                    "description": "/".join(deler),
                    "unit": (um.group(1) if um else "").replace("\ufffd", "°"), "scale": float(sm.group(1)) if sm else 1})
    if uten_omregning:
        notes.append(f"{uten_omregning} punkter har en lineær omregning NABE ikke kan tolke fra eksporten. De står med skala 1")
    return out


def read_xlsx(data: bytes) -> List[List[str]]:
    """The rows of the sheet that looks like a register list (else the first one), as text. Only the standard library."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise MapError("not a valid Excel file") from e
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    ss: List[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(ns + "si"):
            ss.append("".join(t.text or "" for t in si.iter(ns + "t")))
    sheets = []
    for n in sorted((x for x in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", x)), key=lambda x: int(re.findall(r"\d+", x)[0])):
        if z.getinfo(n).file_size > 60_000_000:
            raise MapError("the Excel sheet is too large")
        rows: List[List[str]] = []
        for row in ET.fromstring(z.read(n)).iter(ns + "row"):
            cells: Dict[int, str] = {}
            for c in row:
                col = 0
                for ch in re.match(r"[A-Z]+", c.get("r") or "A").group(0):
                    col = col * 26 + ord(ch) - 64
                v = c.find(ns + "v")
                if c.get("t") == "s" and v is not None:
                    val = ss[int(v.text)] if int(v.text) < len(ss) else ""
                elif c.get("t") == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(ns + "t"))
                else:
                    val = "" if v is None or v.text is None else v.text
                    if re.fullmatch(r"-?\d+\.0", val):
                        val = val[:-2]
                cells[col - 1] = val
            if cells:
                rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
        sheets.append(rows)
    if not sheets:
        raise MapError("the Excel file has no sheets")
    for rows in sheets:
        for r in rows[:10]:
            if any(_ALIAS_REV.get(re.sub(r"[\s_.\-]", "", c.lower())) == "address" for c in r):
                return rows
    return max(sheets, key=len)


def _xlsx_dicts(rows: List[List[str]]) -> List[Dict[str, Any]]:
    head_i = next((i for i, r in enumerate(rows[:10]) if any(_ALIAS_REV.get(re.sub(r"[\s_.\-]", "", c.lower())) == "address" for c in r)), 0)
    head = [c.strip().lower() for c in rows[head_i]]
    return [{h: (r[i] if i < len(r) else "") for i, h in enumerate(head) if h} for r in rows[head_i + 1:]]


def _blokk_rows(rows: List[List[str]]) -> List[Dict[str, Any]]:
    """A list copied from a unit's own display pages: one block downwards for each point, not one row.

        Display Point 8
         Point Name              CAP_T       Pådrag 50/100%
         Point Value             50
         BACnet Obj/Modbus Reg   0x4007 W

    A block without a name or a register is an empty slot and is left out. W marks a point the unit lets others write;
    NABE only reads. The values are whole signed numbers."""
    ut: List[Dict[str, Any]] = []
    punkt: Dict[str, str] = {}
    for r in rows:
        etikett = re.sub(r"\s+", " ", (r[0] if r else "").strip().lower())
        verdi = r[1].strip() if len(r) > 1 else ""
        if etikett.startswith("display point"):
            punkt = {}
        elif etikett == "point name":
            besk = r[2].strip() if len(r) > 2 else ""
            punkt = {"name": verdi, "description": "" if besk.strip("- ") == "" else besk}
        elif etikett.endswith("modbus reg"):
            m = re.match(r"(?i)^(0x[0-9a-f]+|\d+)\s*(w)?$", verdi)
            if m and punkt.get("name"):
                tekst = f"{punkt['name']} {punkt['description']}"
                enhet = ("°C" if re.search(r"(?i)temp|_[el]wt\b|ctrl_wt|ctrl_pnt|settpunkt|\bsp\b", tekst)
                         else "%" if re.search(r"(?i)\bcap_|_lim\b|pådrag", tekst) else "")
                ut.append({"function": "holding", "address": m.group(1), "type": "s16", "name": punkt["name"],
                           "description": punkt["description"], "unit": enhet})
            punkt = {}
    return ut


def parse_map_bytes(data: bytes, filename: str = "", base: Optional[int] = None, real_scale: float = 0.1) -> Dict[str, Any]:
    """A register map from the bytes of a file: Excel (.xlsx), or text (CSV, JSON, Regin EXOL, Niagara export)."""
    if data[:2] == b"PK":
        ark = read_xlsx(data)
        blokker = _blokk_rows(ark)
        if blokker:
            fra = 1 if base is None else base
            notes = ["Excel-fil lest: en blokk per punkt (Display Point, Point Name, BACnet Obj/Modbus Reg), lest som holdingregistre, heltall med fortegn"]
            if fra:
                notes.append("Adressene i denne typen liste teller fra 1: 1 er trukket fra, så 0x4000 leses som 0x3FFF på ledningen. Sjekk mot et punkt du kjenner")
            return _build_map(blokker, "", False, notes, fra, real_scale, "xlsx")
        tabell = _xlsx_dicts(ark)
        rows = [_alias_row(r) for r in tabell]
        rows = [r for r in rows if any(str(v).strip() for v in r.values())]
        if tabell and not rows:
            cols = ", ".join(sorted({k for r in tabell for k in r})[:12])
            raise MapError(f"no address column found (the columns are: {cols}). NABE reads CSV, Excel or JSON with address, function, type, name, "
                           "scale, unit, description, Regin EXOL lists and Niagara exports of Modbus points")
        return _build_map(rows, "", False, ["Excel-fil lest"], base, real_scale, "xlsx")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", "replace")
    return parse_map(text, base, real_scale)


def _build_map(rows: List[Dict[str, Any]], name: str, exol: bool, notes: List[str], base: Optional[int], real_scale: float, fmt: str) -> Dict[str, Any]:
    rows = [r for r in rows if any(str(v).strip() for v in r.values() if v is not None)]
    if rows and not any("address" in r for r in rows):
        cols = ", ".join(sorted({k for r in rows for k in r})[:12])
        raise MapError(f"no address column found (the columns are: {cols}). NABE reads CSV, Excel or JSON with address, function, type, name, "
                       "scale, unit, description, Regin EXOL lists and Niagara exports of Modbus points")
    # 40012 / 3x0661: the address says what it is, and counts from 1
    modicon = False
    if not any(r.get("function") for r in rows):
        mods = [_modicon(r.get("address")) for r in rows]
        if rows and sum(1 for m in mods if m) >= 0.8 * len(rows):
            for r, m in zip(rows, mods):
                if m:
                    r["function"], r["address"] = m[0], m[1]
            modicon = True
            notes.append("Adressene er skrevet som 40012 eller 3x0661: første siffer sier hva det er (1 diskret inngang, 3 inngangsregister, 4 holdingregister), og de teller fra 1")
    addrs = []
    for r in rows:
        try:
            addrs.append(int(str(r.get("address")).strip(), 0))
        except (TypeError, ValueError):
            pass
    if base is None:
        base = 1 if (exol or modicon) and addrs and min(addrs) >= 1 else 0
        if base and not modicon:
            notes.append("Adressene teller fra 1 (listen har ingen adresse 0): 1 er trukket fra, så register 1 leses som 0 på ledningen")
    if exol and any(r["type"] == "s16" and r["scale"] != 1 for r in rows):
        notes.append(f"Reelle verdier (R) er antatt skalert med {real_scale}. Sjekk mot et punkt du kjenner")
    points, seen, dubletter = [], set(), 0
    for i, r in enumerate(rows, 1):
        r = dict(r)
        if base:
            try:
                r["address"] = int(str(r.get("address")).strip(), 0) - base
            except (TypeError, ValueError):
                pass
        try:
            p = normalise_point(r)
        except MapError as e:
            raise MapError(f"row {i}: {e}")
        key = (p["function"], p["address"], p["bit"])
        if key in seen:
            # An export from another system often has several points on one register, and a list of address changes maps
            # several old addresses to one new. The first one stays; the others are said to be left out.
            if fmt in ("niagara", "xlsx"):
                dubletter += 1
                continue
            raise MapError(f"row {i}: {p['function']} {p['address']} is in the map twice")
        seen.add(key)
        points.append(p)
    if dubletter:
        notes.append(f"{dubletter} punkter bruker et register som et tidligere punkt allerede bruker. De er hoppet over, det første beholdt")
    if not points:
        raise MapError("the map has no points")
    return {"name": name, "points": points, "base": base, "notes": notes, "format": fmt}


def parse_map(text: str, base: Optional[int] = None, real_scale: float = 0.1) -> Dict[str, Any]:
    """A register map from JSON ({"name": ..., "points": [...]}) or from CSV with a header row:
    address,function,type,name,scale,unit,description (extra columns: order, offset, bit), or a Regin EXOL list.

    `base` says whether the addresses in the file count from 0 or from 1 (a list that is documentation usually counts
    from 1: the wire address is then one less). Left out, an EXOL list that starts at 1 is taken as counting from 1,
    and every other file as counting from 0. The result says which it used, and what it assumed on the way."""
    text = text.lstrip("\ufeff")
    notes: List[str] = []
    exol = False
    if text.lstrip().startswith("{") or text.lstrip().startswith("["):
        data = json.loads(text)
        rows = data if isinstance(data, list) else data.get("points", [])
        name = "" if isinstance(data, list) else str(data.get("name") or "")
    else:
        sample = text[:2000]
        delim = max(",;\t", key=sample.count)
        reader = csv.DictReader(io.StringIO(text), delimiter=delim)
        reader.fieldnames = [str(h).strip().lower() for h in (reader.fieldnames or [])]
        raw_rows = [{k: v for k, v in r.items() if k} for r in reader]
        name = ""
        fmt = "generic"
        if {"modbus type", "signal name", "modbus address"} <= set(reader.fieldnames):
            exol, fmt = True, "exol"
            rows = _exol_rows(raw_rows, real_scale)
            notes.append("Regin EXOL-format gjenkjent")
        elif {"path", "name", "type", "absolute address"} <= set(reader.fieldnames):
            fmt = "niagara"
            rows = _niagara_rows(raw_rows, notes)
            notes.insert(0, "Niagara-eksport av Modbus-punkter gjenkjent")
        else:
            rows = [_alias_row(r) for r in raw_rows]
        return _build_map(rows, name, exol, notes, base, real_scale, fmt)
    return _build_map(rows, name, exol, notes, base, real_scale, "generic")


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
    for forsok in range(3):
        try:
            if kind in ("coil", "discrete"):
                data: List[Any] = await client.read_bits(unit, kind, start, count)
            else:
                data = await client.read_registers(unit, kind, start, count)
            return {start + i: v for i, v in enumerate(data)}
        except ModbusException as e:
            if e.code == 0x0B and forsok < 2:       # a busy serial gateway: the same question again usually gets an answer
                await asyncio.sleep(0.2)
                continue
            if e.code in (0x02, 0x03) and count > 1:
                half = count // 2
                a = await _read_range(client, unit, kind, start, half)
                b = await _read_range(client, unit, kind, start + half, count - half)
                return {**a, **b}
            return {}
        except ModbusError:
            return {}
    return {}


async def _discover_range(client: ModbusClient, unit: int, kind: str, start: int, count: int) -> Dict[int, Any]:
    """Like _read_range, but a block that fails is not split all the way down when it is empty: a handful of addresses
    spread over it are tried, and if none answers the block is taken as empty. An address on its own in an empty area can
    be missed that way; a map imported from the manufacturer's list is the complete answer."""
    try:
        if kind in ("coil", "discrete"):
            data: List[Any] = await client.read_bits(unit, kind, start, count)
        else:
            data = await client.read_registers(unit, kind, start, count)
        return {start + i: v for i, v in enumerate(data)}
    except ModbusException as e:
        if e.code not in (0x02, 0x03):
            return {}
    except ModbusError:
        return {}
    if count <= 8:
        return await _read_range(client, unit, kind, start, count)
    probes = max(4, count // 8)
    hits: Dict[int, Any] = {}
    for i in range(probes):
        a = start + (count - 1) * i // (probes - 1)
        hits.update(await _read_range(client, unit, kind, a, 1))
    if not hits:
        return {}
    half = count // 2
    left = await _discover_range(client, unit, kind, start, half)
    right = await _discover_range(client, unit, kind, start + half, count - half)
    return {**hits, **left, **right}


async def discover(client: ModbusClient, unit: int, upto: int = 1200, kinds: Sequence[str] = ("coil", "discrete", "holding", "input"),
                   budget: int = 4000, progress: Optional[Callable[[int, int], None]] = None) -> List[Dict[str, Any]]:
    """Which addresses of a device answer. Modbus has no list of what a device holds and no names: the only thing to find
    out is which registers can be read, and what they contain. Each kind is read in blocks, and a block with an address the
    device does not have is split until the readable part is found. Reads only, with a ceiling on how many requests it sends."""
    start_count = client.count
    out: List[Dict[str, Any]] = []
    steps = [(k, a) for k in kinds for a in range(0, upto, 100 if k in ("holding", "input") else 500)]
    for i, (kind, a) in enumerate(steps):
        if client.count - start_count > budget:
            break
        width = 100 if kind in ("holding", "input") else 500
        cells = await _discover_range(client, unit, kind, a, min(width, upto - a))
        tag = {"holding": "HR", "input": "IR", "coil": "CO", "discrete": "DI"}[kind]
        for addr in sorted(cells):
            out.append(normalise_point({"function": kind, "address": addr, "name": f"{tag}{addr}"}))
        if progress:
            progress(i + 1, len(steps))
    return out


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
        self.profil_fil = self.folder / "profiler.json"

    def _ensure(self) -> None:
        self.maps.mkdir(parents=True, exist_ok=True)

    def save_map(self, name: str, parsed: Dict[str, Any]) -> str:
        self._ensure()
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", name.strip() or parsed.get("name") or "kart").strip("_") or "kart"
        (self.maps / f"{slug}.json").write_text(json.dumps({"name": name or slug, "points": parsed["points"],
                                                            **({"meta": parsed["meta"]} if parsed.get("meta") else {})}, ensure_ascii=False, indent=1), encoding="utf-8")
        return slug

    # --- what the technician changed by hand, kept apart from the map so a new export does not wipe it
    def _egne(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        try:
            return json.loads((self.maps.parent / "egne.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _noter_egen(self, mid: str, objid: str, changes: Dict[str, Any]) -> None:
        e = self._egne()
        e.setdefault(mid, {}).setdefault(objid, {}).update(changes)
        self._ensure()
        (self.maps.parent / "egne.json").write_text(json.dumps(e, ensure_ascii=False), encoding="utf-8")

    def save_merge(self, name: str, parsed: Dict[str, Any]) -> Tuple[str, Optional[Dict[str, Any]]]:
        """Save a map. When a map of that name exists the new one replaces it, the changes made by hand in the app are laid over it
        again, and what differs is returned: new registers, ones that are gone, ones that were renamed, and how many own changes were kept."""
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", name.strip() or parsed.get("name") or "kart").strip("_") or "kart"
        gammel = self.load_map(slug)
        egne = self._egne().get(slug, {})
        pts = [dict(p) for p in parsed["points"]]
        diff = None
        key = lambda p: point_record(p)["objid"]
        if gammel is not None:
            old = {key(p): p for p in gammel["points"]}
            new = {key(p): p for p in pts}
            diff = {"nye": [f"{new[k]['address']} {new[k]['name']}" for k in new if k not in old],
                    "borte": [f"{old[k]['address']} {old[k]['name']}" for k in old if k not in new and k not in egne],
                    "omdopt": [f"{old[k]['address']} {old[k]['name']} → {new[k]['name']}" for k in new if k in old and k not in egne and old[k]["name"] != new[k]["name"]],
                    "beholdt": 0}
        for i, p in enumerate(pts):
            ch = egne.get(key(p))
            if ch:
                pts[i] = normalise_point({**p, **ch})
                if diff is not None:
                    diff["beholdt"] += 1
        self.save_map(name, {**parsed, "points": pts})
        return slug, diff

    def info(self, map_id: str) -> Optional[Dict[str, Any]]:
        """What there is to say about a stored register map: where it is, what it came from, what is in it and who uses it."""
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", map_id)
        f = self.maps / f"{slug}.json"
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        pts = d.get("points", [])
        a = self.assignments()
        return {"id": map_id, "navn": d.get("name") or map_id, "punkter": len(pts), "meta": d.get("meta") or {}, "sti": str(f), "stoerrelse": f.stat().st_size,
                "per_funksjon": {k: sum(1 for p in pts if p.get("function") == k) for k in ("holding", "input", "coil", "discrete")},
                "brukes_av": [k for k, v in a.items() if v == map_id]}

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
            return {"name": d.get("name") or map_id, "points": [normalise_point(p) for p in d.get("points", [])], "meta": d.get("meta") or {}}
        except (OSError, ValueError, MapError):
            return None

    # --- known device types: which map was used for a vendor and model, so the next one of that kind gets it
    @staticmethod
    def _profilnokkel(vendor: str, model: str) -> str:
        return f"{str(vendor or '').strip().lower()}|{str(model or '').strip().lower()}"

    def _profiler(self) -> Dict[str, str]:
        try:
            return json.loads(self.profil_fil.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def learn(self, vendor: str, model: str, map_id: Optional[str]) -> None:
        if not (vendor or model) or not map_id:
            return
        self._ensure()
        p = self._profiler()
        p[self._profilnokkel(vendor, model)] = map_id
        self.profil_fil.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")

    def profile_for(self, vendor: str, model: str) -> Optional[str]:
        """The map used before for exactly this vendor and model, and only if it still exists. A device of another model of the same
        make is not given it: two models of one maker rarely share a register map."""
        mid = self._profiler().get(self._profilnokkel(vendor, model))
        return mid if mid and self.load_map(mid) else None

    def edit_point(self, address: str, objid: str, changes: Dict[str, Any]) -> Tuple[str, int]:
        """Change the name, description, unit, scale, type, offset or word order of one point in the map a device uses. A device with
        no map gets one of its own, made from the registers shown, and keeps it. Returns the map and how many devices use it."""
        allowed = {k: v for k, v in changes.items() if k in ("name", "description", "unit", "scale", "offset", "type", "order")}
        mid = self.assignments().get(address)
        m = self.load_map(mid) if mid else None
        if m is None:
            m = {"name": f"Egen {address}", "points": raw_points()}
            mid = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"Egen {address}").strip("_")
        for i, p in enumerate(m["points"]):
            if point_record(p)["objid"] == objid:
                m["points"][i] = normalise_point({**p, **allowed})
                break
        else:
            raise MapError("the point is not in the register map")
        self._noter_egen(re.sub(r"[^A-Za-z0-9_.-]+", "_", mid), objid, allowed)
        self._ensure()
        (self.maps / f"{re.sub(r'[^A-Za-z0-9_.-]+', '_', mid)}.json").write_text(
            json.dumps({"name": m["name"], "points": m["points"], **({"meta": m["meta"]} if m.get("meta") else {})}, ensure_ascii=False, indent=1), encoding="utf-8")
        self.assign(address, mid)
        return mid, sum(1 for v in self.assignments().values() if v == mid)

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


# ---------------------------------------------------------------- who is it
_OUI = {"00:01:05": "Beckhoff", "00:30:DE": "WAGO", "00:90:E8": "Moxa", "00:A0:45": "Phoenix Contact", "00:0E:8C": "Siemens",
        "00:1B:1B": "Siemens", "00:80:F4": "Schneider Electric", "00:0C:C6": "Ka-Ro", "00:50:C2": "IEEE registered", "00:1D:9C": "Rockwell"}


def mac_for(host: str) -> Dict[str, str]:
    """The MAC address of a host the PC has talked to on its own network, read from the neighbour table. A host behind a
    router (over a VPN, say) has none: the router answers for it. Returns {} then."""
    import subprocess
    try:
        if os.name == "nt":
            ut = subprocess.run(["arp", "-a", host], capture_output=True, text=True, timeout=3, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        else:
            ut = subprocess.run(["ip", "neigh", "show", host], capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    m = re.search(r"\b((?:[0-9a-fA-F]{2}[-:]){5}[0-9a-fA-F]{2})\b", ut)
    if not m:
        return {}
    mac = m.group(1).replace("-", ":").upper()
    if mac in ("FF:FF:FF:FF:FF:FF", "00:00:00:00:00:00"):
        return {}
    return {"mac": mac, "mac_vendor": _OUI.get(mac[:8], "")}
