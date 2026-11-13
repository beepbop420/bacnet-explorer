r"""
NABE simulator: a scanned site, run as BACnet devices on this PC.

    python nabe_sim.py anlegg.json [--fra=2] [--pendling] [--periode=120]

The file is a snapshot of devices NABE has read: names, descriptions, units,
values, state texts. Each device is started on its own loopback address
(127.0.0.2, .3, ...) with the same instance number, name and points, so NABE
can scan, read, write and release them exactly as it would at the plant. It is
for practice, demonstrations and testing name checks and hunting detection
without a VPN. Nothing here ever leaves the PC.

Values move a little, so Live and the trend look alive. With --pendling the
room sensor (RT) and the valve (SB) of every loop swing together, which is
what the hunting detector is for.

When every device is up, <file>.klar is written with the address each one got.
The process runs until it is stopped (NABE stops it, or Ctrl+C).
"""
import asyncio
import json
import math
import random
import re
import sys
import time
from pathlib import Path

from bacpypes3.ipv4.app import NormalApplication
from bacpypes3.local.analog import AnalogInputObject, AnalogOutputObject, AnalogValueObjectCmd
from bacpypes3.local.binary import BinaryInputObject, BinaryOutputObject, BinaryValueObjectCmd
from bacpypes3.local.device import DeviceObject
from bacpypes3.local.multistate import (MultiStateInputObject, MultiStateOutputObject,
                                        MultiStateValueObject)
from bacpypes3.pdu import IPv4Address

KLASSER = {
    "analog-input": AnalogInputObject, "analog-output": AnalogOutputObject,
    "analog-value": AnalogValueObjectCmd,
    "binary-input": BinaryInputObject, "binary-output": BinaryOutputObject,
    "binary-value": BinaryValueObjectCmd,
    "multi-state-input": MultiStateInputObject, "multi-state-output": MultiStateOutputObject,
    "multi-state-value": MultiStateValueObject,
}
KOMMANDERBAR = {"analog-output", "analog-value", "binary-output", "binary-value", "multi-state-output"}
PEND_RE = re.compile(r"(?:^|[^A-Za-z0-9])(RT|SB)(\d{2,4})(?!\d)", re.I)
PEND_SYS = re.compile(r"(?:^|\D)(\d{3})[._\-](\d{3})(?!\d)")
SP_RE = re.compile(r"(?:[-_.\s]SPT?|Sp|Spt)$")
HJERTE_RE = re.compile(r"(?:^|[._\-])(HB|HEARTBEAT)(?:_[A-Z]+)?$", re.I)


def enhet(tekst):
    """degrees-celsius -> degreesCelsius, the spelling bacpypes3 uses."""
    if not tekst or tekst == "no-units":
        return "noUnits"
    return re.sub(r"-(\w)", lambda m: m.group(1).upper(), str(tekst))


def tall(v, standard=0.0):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else standard


def lag_objekt(p):
    """One point as a bacpypes3 object, or None when its type is not simulated."""
    typ = p.get("type")
    klasse = KLASSER.get(typ)
    if klasse is None or p.get("instance") is None:
        return None
    navn = p.get("name") or f"{typ}-{p['instance']}"
    kw = dict(objectIdentifier=(typ, int(p["instance"])), objectName=navn,
              description=p.get("description") or "", statusFlags=[0, 0, 0, 0])
    v = p.get("value")
    tekster = [str(x) for x in (p.get("state_text") or [])]
    if typ.startswith("analog"):
        verdi = tall(v)
        kw.update(presentValue=verdi, units=enhet(p.get("units")), covIncrement=max(0.1, abs(verdi) * 0.005))
        if typ != "analog-input":
            kw["relinquishDefault"] = verdi
    elif typ.startswith("binary"):
        pv = "active" if v == "active" else "inactive"
        kw["presentValue"] = pv
        if typ != "binary-value":
            kw["polarity"] = "normal"
        if typ in KOMMANDERBAR:
            kw["relinquishDefault"] = pv
        if len(tekster) >= 2:
            kw["inactiveText"], kw["activeText"] = tekster[0], tekster[1]
    else:
        n = len(tekster) or max(int(tall(v, 1)), 2)
        pv = min(max(int(tall(v, 1)), 1), n)
        kw.update(presentValue=pv, numberOfStates=n)
        if len(tekster) == n:
            kw["stateText"] = tekster
        if typ in KOMMANDERBAR:
            kw["relinquishDefault"] = pv
    try:
        return klasse(**kw)
    except Exception:
        # An odd unit or text should not cost the point: try again without them.
        for k in ("units", "stateText", "inactiveText", "activeText", "description"):
            kw.pop(k, None)
        try:
            return klasse(**kw)
        except Exception:
            return None


class Enhet:
    """One simulated device and the points that move."""

    def __init__(self, app, data, pendling, periode):
        self.app, self.data, self.pendling, self.periode = app, data, pendling, periode
        self.levende = []        # (objekt, base, enhet, brukes av sløyfe)
        self.hjerter = []
        self.par = []            # (rt, rt-base, sb, sb-base, rt-enhet)
        self.hoppet = 0
        self.antall = 0

    def bygg(self):
        navn = {}
        for p in self.data.get("punkter") or []:
            o = lag_objekt(p)
            if o is None:
                self.hoppet += 1
                continue
            try:
                self.app.add_object(o)
            except Exception:
                self.hoppet += 1
                continue
            self.antall += 1
            navn[p.get("name") or ""] = (p, o)
            if p["type"] == "analog-input":
                self.levende.append([o, tall(p.get("value")), str(p.get("units") or "")])
            if p["type"].startswith("binary") and HJERTE_RE.search(p.get("name") or ""):
                self.hjerter.append(o)
        if self.pendling:
            rt, sb = {}, {}
            for n, (p, o) in navn.items():
                m = PEND_RE.search(n)
                # RT401-SP is the setpoint of the loop, not its sensor.
                if not m or not p["type"].startswith("analog") or SP_RE.search(n):
                    continue
                s = PEND_SYS.search(n)
                nokkel = ((s.group(1) + "." + s.group(2)) if s else "", m.group(2))
                (rt if m.group(1).upper() == "RT" else sb)[nokkel] = (p, o)
            for k, (p, o) in rt.items():
                if k in sb:
                    q, so = sb[k]
                    self.par.append((o, tall(p.get("value")), so, tall(q.get("value")), str(p.get("units") or "")))
            # A swinging loop is driven by the swing, not by the random walk.
            brukt = {id(x[0]) for x in self.par} | {id(x[2]) for x in self.par}
            self.levende = [x for x in self.levende if id(x[0]) not in brukt]

    def tikk(self, t, hjerte):
        for x in self.levende:
            o, base, u = x
            ny = tall(o.presentValue) + (base - tall(o.presentValue)) * 0.08 + random.gauss(0, max(abs(base) * 0.003, 0.01))
            if "percent" in u:
                ny = min(100.0, max(0.0, ny))
            try:
                o.presentValue = round(ny, 3)
            except Exception:
                pass
        for o in self.hjerter:
            try:
                o.presentValue = "active" if hjerte else "inactive"
            except Exception:
                pass
        w = 2 * math.pi * t / max(self.periode, 5)
        for rt, rt_base, sb, sb_base, u in self.par:
            amp = 1.0 if "celsius" in u else max(abs(rt_base) * 0.03, 0.5)
            try:
                rt.presentValue = round(rt_base + amp * math.sin(w), 3)
                sb.presentValue = round(min(100.0, max(0.0, sb_base + 30.0 * math.sin(w + math.pi / 2))), 3)
            except Exception:
                pass


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    fil = Path(sys.argv[1])
    valg = {a.split("=")[0]: (a.split("=", 1)[1] if "=" in a else True) for a in sys.argv[2:]}
    fra = int(valg.get("--fra", 2))
    periode = float(valg.get("--periode", 120))
    snap = json.loads(fil.read_text(encoding="utf-8"))
    enheter = snap.get("enheter") or []
    if fra + len(enheter) > 250:
        print("For mange enheter for 127.0.0.x", file=sys.stderr)
        return 1
    apper, kart = [], []
    for i, d in enumerate(enheter):
        adresse = f"127.0.0.{fra + i}"
        dev = DeviceObject(objectIdentifier=("device", int(d["device_instance"])),
                           objectName=d.get("object_name") or f"SIM-{fra + i}",
                           vendorIdentifier=int(d.get("vendor_id") or 999), maxApduLengthAccepted=1476,
                           segmentationSupported="noSegmentation",
                           vendorName=d.get("vendor_name") or "NABE Simulator")
        app = NormalApplication(dev, IPv4Address(f"{adresse}/8"))
        e = Enhet(app, d, "--pendling" in valg, periode)
        e.bygg()
        apper.append(e)
        kart.append({"address": adresse, "original": d.get("address"), "device_instance": d["device_instance"],
                     "navn": d.get("object_name"), "punkter": e.antall, "hoppet": e.hoppet})
    await asyncio.sleep(0.5)
    fil.with_suffix(".klar").write_text(json.dumps({"enheter": kart, "fra": fra}), encoding="utf-8")
    print(f"KLAR {len(kart)} enheter", flush=True)
    t0, n = time.time(), 0
    while True:
        await asyncio.sleep(2)
        n += 1
        for e in apper:
            e.tikk(time.time() - t0, n % 3 == 0)


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()) or 0)
    except KeyboardInterrupt:
        pass
