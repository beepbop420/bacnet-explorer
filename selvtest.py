"""
NABE selvtest - kjør før du tar i bruk en endring.

    venv\\Scripts\\python.exe selvtest.py

Starter tre simulerte BACnet-enheter på 127.0.0.2-4 og en NABE på port 8099
bundet til 127.0.0.1, og kjører det en tekniker gjør: koble til, skanne,
lese punkter, skrive, frigi, live-lese, alarmer og rutere. Alt skjer på
PC-en; ingenting går ut på nettet. Avsluttes med 0 når alt er grønt.
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from bacpypes3.ipv4.app import NormalApplication
from bacpypes3.local.analog import AnalogValueObjectCmd, AnalogInputObject
from bacpypes3.local.binary import BinaryValueObject
from bacpypes3.local.device import DeviceObject
from bacpypes3.pdu import IPv4Address

HER = Path(__file__).parent
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
PORT = 8099
BASE = f"http://127.0.0.1:{PORT}"
ENHETER = [(2, 9001, "SIM-AHU01"), (3, 9002, "SIM-RT401"), (4, 9003, "SIM-VP01")]


def lag_enhet(siste_oktett: int, instans: int, navn: str):
    dev = DeviceObject(objectIdentifier=("device", instans), objectName=navn,
                       vendorIdentifier=999, maxApduLengthAccepted=1476,
                       segmentationSupported="noSegmentation", vendorName="NABE Simulator")
    app = NormalApplication(dev, IPv4Address(f"127.0.0.{siste_oktett}/8"))
    app.add_object(AnalogInputObject(objectIdentifier=("analog-input", 1), objectName=f"{navn}_RT401",
                                     presentValue=21.5, units="degreesCelsius",
                                     description="Romtemperatur", statusFlags=[0, 0, 0, 0]))
    app.add_object(AnalogValueObjectCmd(objectIdentifier=("analog-value", 1), objectName=f"{navn}_SP",
                                        presentValue=21.0, relinquishDefault=21.0,
                                        units="degreesCelsius", description="Settpunkt",
                                        statusFlags=[0, 0, 0, 0]))
    app.add_object(BinaryValueObject(objectIdentifier=("binary-value", 1), objectName=f"{navn}_DRIFT",
                                     presentValue="active", description="Drift",
                                     statusFlags=[0, 0, 0, 0]))
    return app


def kall(sti, data=None, timeout=30):
    req = urllib.request.Request(BASE + sti, method="POST" if data is not None else "GET",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", "Origin": BASE})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def vent_jobb(jid, maks=60):
    slutt = time.time() + maks
    while time.time() < slutt:
        j = kall(f"/api/job/{jid}")
        if j.get("status") != "running":
            return j
        time.sleep(0.3)
    raise TimeoutError(f"jobb {jid} ble ikke ferdig")


RESULTAT = []


def sjekk(navn, ok, detalj=""):
    RESULTAT.append(ok)
    print(f"  {'OK ' if ok else 'FEIL'}  {navn}{'  - ' + detalj if detalj else ''}", flush=True)


def kjor_tester():
    s = kall("/api/start", {"local_address": "127.0.0.1/8"})
    sjekk("kobler til", s.get("status") == "done", s.get("local_address", s.get("error", "")))

    j = vent_jobb(kall("/api/scan", {"subnet": "127.0.0.2-4", "mode": "unicast_sweep",
                                      "thorough": False, "per_host_timeout": 1.0,
                                      "concurrency": 8})["job_id"])
    funnet = sorted(d["device_instance"] for d in (j.get("result") or {}).get("devices", []))
    sjekk("skann finner tre enheter", funnet == [9001, 9002, 9003], str(funnet))

    j = vent_jobb(kall("/api/device/points", {"address": "127.0.0.3", "device_instance": 9002})["job_id"])
    pts = (j.get("result") or {}).get("points", [])
    sjekk("leser punkter", len(pts) >= 3, f"{len(pts)} punkter")

    w = kall("/api/write", {"address": "127.0.0.3", "objid": "analog-value,1", "value": 23.5, "priority": 8})
    sjekk("skriver på prioritet 8", w.get("status") == "done", w.get("error", ""))

    mine = kall("/api/mine").get("overstyrt", [])
    sjekk("husker hva du har overstyrt", any(o["objid"] == "analog-value,1" and o["priority"] == 8 for o in mine),
          f"{len(mine)} i lista")

    p = kall("/api/poll", {"targets": {"127.0.0.3": ["analog-value,1", "analog-input,1"]}})
    verdi = (p.get("values") or {}).get("127.0.0.3", {}).get("analog-value,1")
    sjekk("live leser skrevet verdi", verdi == 23.5, str(verdi))

    # The bacpypes3 simulator answers a Null write with an error even though
    # it does release the slot, so the value is what decides.
    kall("/api/write", {"address": "127.0.0.3", "objid": "analog-value,1", "priority": 8, "release": True})
    time.sleep(0.5)
    p = kall("/api/poll", {"targets": {"127.0.0.3": ["analog-value,1"]}})
    verdi = (p.get("values") or {}).get("127.0.0.3", {}).get("analog-value,1")
    sjekk("frigir prioritet 8, tilbake på relinquish default", verdi == 21.0, str(verdi))

    a = kall("/api/device/alarms", {"address": "127.0.0.3"})
    sjekk("alarmspørring svarer", a.get("status") in ("done", "unsupported"), a.get("status", ""))

    ru = kall("/api/routers")
    sjekk("ruterspørring svarer", ru.get("status") == "done")

    d = kall("/api/diagnose", {"address": "127.0.0.2", "step": "bacnet"})
    sjekk("diagnose finner enheten", d.get("status") == "ok", d.get("detalj", ""))

    p = kall("/api/poll", {"targets": {"127.0.0.2": ["analog-input,1"]}})
    sjekk("live svarer med COV-telling", isinstance(p.get("cov"), int), f"cov={p.get('cov')}")

    j = vent_jobb(kall("/api/scan", {"subnet": "127.0.0.5:47820", "mode": "bbmd", "timeout": 4})["job_id"])
    r = j.get("result") or {}
    sjekk("BBMD-modus registrerer og finner", r.get("bbmd_status") == 0 and r.get("count", 0) >= 1,
          f"status {r.get('bbmd_status')}, {r.get('count')} enheter, tabell {r.get('bdt')}")
    uten = [d.get("address") for d in r.get("devices") or [] if not d.get("object_name")]
    sjekk("Who-Is-funn får navn", bool(r.get("devices")) and not uten, f"uten navn: {uten}")

    for fil in ("nabe-start", "nabe-verktoy", "nabe-felt", "nabe-moro", "nabe-finn", "nabo"):
        try:
            with urllib.request.urlopen(f"{BASE}/js/{fil}.js", timeout=5) as rr:
                ok = rr.status == 200
        except Exception:
            ok = False
        sjekk(f"serverer js/{fil}.js", ok)
    v = kall("/api/ny-versjon")
    sjekk("versjonssjekk svarer (med eller uten nett)", v.get("status") == "done", f"her {v.get('her')}, github {v.get('github')}")


async def main():
    # Windows reports a closed pipe as an error when the test server stops.
    # It is not one, and it made the output look like a failure.
    loop = asyncio.get_event_loop()
    loop.set_exception_handler(lambda l, c: None if isinstance(c.get("exception"), ConnectionResetError)
                               else l.default_exception_handler(c))
    apps = [lag_enhet(*e) for e in ENHETER]
    # A BBMD with one peer - itself. More peers that do not exist make the
    # bacpypes3 BBMD stop answering, which is the simulator, not NABE.
    from bacpypes3.ipv4.app import BBMDApplication
    bdev = DeviceObject(objectIdentifier=("device", 9100), objectName="SIM-BBMD", vendorIdentifier=999,
                        maxApduLengthAccepted=1476, segmentationSupported="noSegmentation")
    bbmd = BBMDApplication(bdev, IPv4Address("127.0.0.5/8:47820"))
    bbmd.bbmd.add_peer(IPv4Address("127.0.0.5/8:47820"))
    apps.append(bbmd)
    await asyncio.sleep(0.5)
    import tempfile
    data = tempfile.mkdtemp(prefix="nabe-selvtest-")
    env = dict(os.environ, NABE_ALLOWED_ORIGINS=BASE, NABE_DATA=data)
    server = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1",
                               "--port", str(PORT), "--log-level", "warning"], cwd=HER, env=env)
    try:
        for _ in range(60):
            try:
                kall("/api/status", timeout=2)
                break
            except Exception:
                await asyncio.sleep(0.3)
        print("NABE selvtest", flush=True)
        await asyncio.get_event_loop().run_in_executor(None, kjor_tester)
    finally:
        server.terminate()
        for a in apps:
            a.close()
    ok = all(RESULTAT)
    print(f"\n{sum(RESULTAT)} av {len(RESULTAT)} grønne." + ("" if ok else "  Noe er galt."))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
