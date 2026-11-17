"""
A Modbus TCP server for testing NABE without a plant: units with registers, bits, identification and the quirks
of real gateways (a unit with nothing behind it, a unit that never answers). It answers reads only, and records
every write function it is sent, so a test can check that NABE never sent one.

    python nabe_modbus_sim.py [port]          # default 1502, for trying NABE by hand
"""
from __future__ import annotations

import asyncio
import math
import struct
import sys
import time
from typing import Callable, Dict, List, Optional, Union

from nabe_modbus import crc16

Value = Union[int, Callable[[], int]]


class SimUnit:
    def __init__(self, vendor: str = "NABE Sim", product: str = "Room controller", revision: str = "1.0",
                 holding: Optional[Dict[int, Value]] = None, input_: Optional[Dict[int, Value]] = None,
                 coils: Optional[Dict[int, bool]] = None, discrete: Optional[Dict[int, bool]] = None,
                 identification: bool = True, server_id: bool = True):
        self.vendor, self.product, self.revision = vendor, product, revision
        self.holding, self.input = holding or {}, input_ or {}
        self.coils, self.discrete = coils or {}, discrete or {}
        self.identification, self.server_id = identification, server_id

    @staticmethod
    def _v(v: Value) -> int:
        return int(v() if callable(v) else v) & 0xFFFF


class ModbusSim:
    def __init__(self, units: Dict[int, SimUnit], empty: Optional[List[int]] = None, silent: Optional[List[int]] = None,
                 answer_any_unit: bool = False, rtu: bool = False):
        self.units = units
        self.rtu = rtu                         # RTU frames (unit, PDU, CRC) in the TCP stream: a serial gateway that passes bytes through
        self.empty = set(empty or [])          # a gateway's "no device at this unit": exception 0x0B
        self.silent = set(silent or [])        # never answers
        self.answer_any_unit = answer_any_unit
        self.writes_received: List[int] = []   # function codes of any write that arrived
        self.requests = 0
        self.connections = 0                   # clients connected now
        self._server: Optional[asyncio.AbstractServer] = None
        self.port = 0

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> int:
        self._server = await asyncio.start_server(self._client_rtu if self.rtu else self._client, host, port)
        self.port = self._server.sockets[0].getsockname()[1]
        return self.port

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def _client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.connections += 1
        try:
            while True:
                head = await reader.readexactly(7)
                txn, _proto, length, unit = struct.unpack("!HHHB", head)
                pdu = await reader.readexactly(length - 1)
                self.requests += 1
                if unit in self.silent:
                    continue
                out = self._answer(unit, pdu)
                if out is not None:
                    writer.write(struct.pack("!HHHB", txn, 0, len(out) + 1, unit) + out)
                    await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            self.connections -= 1
            writer.close()

    async def _client_rtu(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                head = await reader.readexactly(2)                  # unit, function
                unit, fn = head
                rest = await reader.readexactly({0x11: 2, 0x2B: 5}.get(fn, 6))
                frame = head + rest
                if crc16(frame[:-2]) != int.from_bytes(frame[-2:], "little"):
                    continue                                        # a device stays silent on a bad frame
                self.requests += 1
                if unit in self.silent:
                    continue
                out = self._answer(unit, frame[1:-2])
                if out is None:
                    continue
                resp = bytes([unit]) + out
                writer.write(resp + crc16(resp).to_bytes(2, "little"))
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            writer.close()

    @staticmethod
    def _exc(fn: int, code: int) -> bytes:
        return bytes([fn | 0x80, code])

    def _answer(self, unit: int, pdu: bytes) -> Optional[bytes]:
        fn = pdu[0]
        if fn in (5, 6, 15, 16, 22, 23):
            self.writes_received.append(fn)
            return self._exc(fn, 0x01)
        if unit in self.empty:
            return self._exc(fn, 0x0B)
        u = self.units.get(unit) or (next(iter(self.units.values())) if self.answer_any_unit and self.units else None)
        if u is None:
            return self._exc(fn, 0x0B) if self.empty else None
        if fn in (3, 4):
            start, count = struct.unpack("!HH", pdu[1:5])
            table = u.holding if fn == 3 else u.input
            if not 1 <= count <= 125:
                return self._exc(fn, 0x03)
            vals = []
            for a in range(start, start + count):
                if a not in table:
                    return self._exc(fn, 0x02)
                vals.append(SimUnit._v(table[a]))
            return bytes([fn, count * 2]) + struct.pack(f"!{count}H", *vals)
        if fn in (1, 2):
            start, count = struct.unpack("!HH", pdu[1:5])
            table = u.coils if fn == 1 else u.discrete
            if not 1 <= count <= 2000:
                return self._exc(fn, 0x03)
            bits = []
            for a in range(start, start + count):
                if a not in table:
                    return self._exc(fn, 0x02)
                bits.append(table[a])
            data = bytearray((count + 7) // 8)
            for i, b in enumerate(bits):
                if b:
                    data[i // 8] |= 1 << (i % 8)
            return bytes([fn, len(data)]) + bytes(data)
        if fn == 0x11 and u.server_id:
            text = f"{u.vendor} {u.product}".encode()
            return bytes([0x11, len(text) + 1]) + text + b"\xff"
        if fn == 0x2B and len(pdu) >= 4 and pdu[1] == 0x0E and u.identification:
            objs = [(0, u.vendor), (1, "SIM-1"), (2, u.revision), (4, u.product)]
            body = b"".join(bytes([i, len(v)]) + v.encode() for i, v in objs)
            return bytes([0x2B, 0x0E, 0x01, 0x01, 0x00, 0x00, len(objs)]) + body
        return self._exc(fn, 0x01)


def demo_units() -> Dict[int, SimUnit]:
    """Two units: a room controller with a temperature that drifts, and a meter with a float in swapped words."""
    t0 = time.time()
    def temp() -> int:                     # 21.0 degrees with a slow swing, in tenths
        return int(round((21.0 + 0.8 * math.sin((time.time() - t0) / 20.0)) * 10)) & 0xFFFF
    power = struct.unpack("!2H", struct.pack("!f", 12.5))      # 12.5 kW as ABCD words
    return {
        1: SimUnit(vendor="NABE Sim", product="Room controller", revision="1.2",
                   holding={0: temp, 1: 210, 2: 55, 3: 0b0000000000000101},
                   input_={0: 3, 1: 440}, coils={0: True, 1: False, 2: True}, discrete={0: False, 1: True}),
        2: SimUnit(vendor="NABE Sim", product="Energy meter", revision="3.0",
                   holding={0: power[1], 1: power[0], 2: 0xFFFF}, input_={0: 1234}),
    }


async def _main(port: int) -> None:
    sim = ModbusSim(demo_units(), empty=[9])
    await sim.start("0.0.0.0", port)
    print(f"Modbus simulator on port {sim.port}: unit 1 (room controller), unit 2 (meter), unit 9 empty", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(_main(int(sys.argv[1]) if len(sys.argv) > 1 else 1502))
    except KeyboardInterrupt:
        pass
