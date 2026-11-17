"""
A KNXnet/IP gateway for testing NABE without a building: it answers a description request, accepts a tunnel,
puts group telegrams on it (a temperature that drifts, a switch, a valve) and answers a GroupValueRead with the
value of the group address. It records every write it is sent, so a test can check that NABE never sent one.

    python nabe_knx_sim.py [port]          # default 13671, for trying NABE by hand
"""
from __future__ import annotations

import asyncio
import math
import struct
import sys
import time
from typing import Callable, Dict, List, Optional, Tuple

import nabe_knx as nk

Source = 0x1101          # 1.1.1, the device that "speaks" on the bus


def enc9(v: float) -> bytes:
    """DPT 9: two byte float, 0.01 * mantissa * 2^exponent."""
    m = int(round(v * 100))
    e = 0
    while not -2048 <= m <= 2047:
        m >>= 1
        e += 1
    return struct.pack("!H", (0x8000 if m < 0 else 0) | (e << 11) | (m & 0x07FF))


class SimGroup:
    def __init__(self, dpt: str, value: Callable[[], float]):
        self.dpt, self.value = dpt, value

    def payload(self) -> Tuple[bytes, bool]:
        """(bytes, small). Small values sit in the APCI byte."""
        main, sub = nk.parse_dpt(self.dpt)
        v = self.value()
        if main == 1:
            return bytes([1 if v else 0]), True
        if main == 5:
            return bytes([int(round(v * 255 / 100)) if sub == 1 else int(v)]), False
        if main == 9:
            return enc9(v), False
        if main == 14:
            return struct.pack("!f", v), False
        return bytes([int(v) & 0xFF]), False


class KnxSim(asyncio.DatagramProtocol):
    def __init__(self, groups: Dict[int, SimGroup], tunnels: int = 1, secure: bool = False):
        self.groups = groups
        self.max_tunnels = tunnels
        self.secure = secure
        self.transport: Optional[asyncio.DatagramTransport] = None
        self.channels: Dict[int, Tuple[Tuple[str, int], int]] = {}      # channel -> (client address, outgoing seq)
        self.writes_received: List[int] = []                             # group addresses that a client tried to write
        self.reads_received: List[int] = []
        self.port = 0
        self._task: Optional[asyncio.Task] = None
        self._next = 1

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> int:
        loop = asyncio.get_running_loop()
        await loop.create_datagram_endpoint(lambda: self, local_addr=(host, port))
        self.port = self.transport.get_extra_info("sockname")[1]
        self._task = asyncio.create_task(self._bus())
        return self.port

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self.transport:
            self.transport.close()

    def connection_made(self, transport):
        self.transport = transport

    # --- what the gateway says
    def _description(self) -> bytes:
        name = b"NABE KNX Sim".ljust(30, b"\x00")
        dev = bytes([54, 0x01, 0x02, 0x00]) + struct.pack("!H", 0x1100) + b"\x00\x01" + b"\x00\x01\x02\x03\x04\x05" + bytes(4) + b"\x02\x00\x00\x00\x00\x01" + name
        fam = [0x02, 1, 0x04, 1] + ([0x09, 1] if self.secure else [])
        svc = bytes([2 + len(fam), 0x02]) + bytes(fam)
        return nk.header(nk.DESC_RES, dev + svc)

    def _ind(self, ga: int, kind: int, payload: bytes, small: bool) -> bytes:
        if small:
            data = bytes([0x00, kind | (payload[0] & 0x3F)])
            length = 1
        else:
            data = bytes([0x00, kind]) + payload
            length = 1 + len(payload)
        return bytes([0x29, 0x00, 0xBC, 0xE0]) + struct.pack("!HH", Source, ga) + bytes([length]) + data

    def _send_ind(self, channel: int, cemi: bytes) -> None:
        addr, seq = self.channels[channel]
        self.channels[channel] = (addr, (seq + 1) & 0xFF)
        self.transport.sendto(nk.header(nk.TUNNEL_REQ, bytes([4, channel, seq, 0]) + cemi), addr)

    # --- what it hears
    def datagram_received(self, data: bytes, addr):
        if len(data) < 6:
            return
        service = struct.unpack("!H", data[2:4])[0]
        body = data[6:]
        if service == nk.DESC_REQ:
            self.transport.sendto(self._description(), addr)
        elif service == nk.CONNECT_REQ:
            if self.secure or len(self.channels) >= self.max_tunnels:
                self.transport.sendto(nk.header(nk.CONNECT_RES, bytes([0, 0x24 if not self.secure else 0x22])), addr)
                return
            ch = self._next
            self._next += 1
            self.channels[ch] = (addr, 0)
            ia = 0x1105
            self.transport.sendto(nk.header(nk.CONNECT_RES, bytes([ch, 0]) + nk.hpai("127.0.0.1", self.port) + bytes([4, 0x04]) + struct.pack("!H", ia)), addr)
        elif service == nk.TUNNEL_REQ and len(body) >= 5:
            ch, seq = body[1], body[2]
            if ch not in self.channels:
                return
            self.transport.sendto(nk.header(nk.TUNNEL_ACK, bytes([4, ch, seq, 0])), addr)
            cemi = body[4:]
            if len(cemi) >= 11 and cemi[0] == 0x11:
                ga = struct.unpack("!H", cemi[6:8])[0]
                apci = ((cemi[9] & 0x03) << 8) | cemi[10]
                kind = apci & 0x3C0
                if kind == nk.APCI_READ:
                    self.reads_received.append(ga)
                    g = self.groups.get(ga)
                    if g is not None:
                        payload, small = g.payload()
                        asyncio.get_running_loop().call_later(0.05, self._send_ind, ch, self._ind(ga, nk.APCI_RESPONSE, payload, small))
                else:
                    self.writes_received.append(ga)
        elif service == nk.CSTATE_REQ and len(body) >= 2:
            self.transport.sendto(nk.header(nk.CSTATE_RES, bytes([body[0], 0 if body[0] in self.channels else 0x21])), addr)
        elif service == nk.DISC_REQ and len(body) >= 1:
            self.channels.pop(body[0], None)
            self.transport.sendto(nk.header(nk.DISC_RES, bytes([body[0], 0])), addr)

    # --- the bus: values change and are written by "devices"
    async def _bus(self) -> None:
        n = 0
        while True:
            await asyncio.sleep(0.5)
            n += 1
            for ga, g in self.groups.items():
                if not (g.dpt.startswith("9") or n % 6 == 0):
                    continue
                payload, small = g.payload()
                for ch in list(self.channels):
                    self._send_ind(ch, self._ind(ga, nk.APCI_WRITE, payload, small))
            # a group address that is not in any ETS list, to be seen
            for ch in list(self.channels):
                self._send_ind(ch, self._ind(nk.parse_ga("5/5/5"), nk.APCI_WRITE, bytes([0x3C]), False))


def demo_groups() -> Dict[int, SimGroup]:
    t0 = time.time()
    return {
        nk.parse_ga("1/1/1"): SimGroup("9.001", lambda: 21.0 + 0.8 * math.sin((time.time() - t0) / 20.0)),
        nk.parse_ga("1/1/2"): SimGroup("9.001", lambda: 21.0),
        nk.parse_ga("1/1/3"): SimGroup("1.001", lambda: 1),
        nk.parse_ga("2/1/1"): SimGroup("5.001", lambda: 40),
        nk.parse_ga("3/0/1"): SimGroup("14.056", lambda: 1250.5),
    }


DEMO_CSV = ("Group name;Address;Central;Unfiltered;Description;DatapointType;Security\r\n"
            "Rom 101 Temperatur;1/1/1;;;Romtemperatur;DPST-9-1;Auto\r\nRom 101 Settpunkt;1/1/2;;;Settpunkt rom;DPST-9-1;Auto\r\n"
            "Rom 101 Lys;1/1/3;;;Lys på/av;DPST-1-1;Auto\r\nRom 101 Ventil;2/1/1;;;Varmepådrag;DPST-5-1;Auto\r\n"
            "Effekt;3/0/1;;;Effekt;DPST-14-56;Auto\r\n")


async def _main(port: int) -> None:
    sim = KnxSim(demo_groups())
    await sim.start("0.0.0.0", port)
    print(f"KNX simulator on UDP {sim.port}", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(_main(int(sys.argv[1]) if len(sys.argv) > 1 else 13671))
    except KeyboardInterrupt:
        pass
