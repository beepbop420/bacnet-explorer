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


def royktest():
    """
    Opens NABE in a headless Chrome or Edge and listens for JavaScript errors
    while it starts. A file that parses can still stop at start-up - a value
    used a line too early takes every script after it down - and only a real
    browser shows that. Skipped when neither browser is installed.
    """
    import base64, shutil, socket, struct, tempfile
    kandidater = [shutil.which("chrome"), shutil.which("msedge"),
                  r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                  r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"]
    nettleser = next((k for k in kandidater if k and Path(k).is_file()), None)
    if not nettleser:
        print("  --   ingen Chrome/Edge, røyktesten hoppes over", flush=True)
        return
    port = 9339
    prof = tempfile.mkdtemp(prefix="nabe-royk-")
    p = subprocess.Popen([nettleser, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                          "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    feil, sjekker = [], {}
    try:
        ws = None
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=1) as r:
                    ws = next(t for t in json.load(r) if t["type"] == "page")["webSocketDebuggerUrl"]
                break
            except Exception:
                time.sleep(0.25)
        s = socket.create_connection(("127.0.0.1", port), timeout=10)
        nokkel = base64.b64encode(os.urandom(16)).decode()
        s.send((f"GET {ws.split(str(port), 1)[1]} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {nokkel}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += s.recv(4096)
        rest = [buf.split(b"\r\n\r\n", 1)[1]]

        def les(n):
            while len(rest[0]) < n:
                rest[0] += s.recv(1 << 20)
            d, rest[0] = rest[0][:n], rest[0][n:]
            return d

        def send(obj):
            data = json.dumps(obj).encode()
            hode = bytearray([0x81])
            n = len(data)
            hode += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
            maske = os.urandom(4)
            s.send(bytes(hode) + maske + bytes(b ^ maske[i % 4] for i, b in enumerate(data)))

        def motta():
            _, b2 = les(2)
            n = b2 & 0x7f
            if n == 126:
                n = struct.unpack(">H", les(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", les(8))[0]
            return json.loads(les(n))

        send({"id": 1, "method": "Runtime.enable"})
        send({"id": 2, "method": "Page.navigate", "params": {"url": BASE + "/"}})
        slutt = time.time() + 6
        s.settimeout(0.5)
        while time.time() < slutt:
            try:
                m = motta()
            except socket.timeout:
                continue
            if m.get("method") == "Runtime.exceptionThrown":
                d = m["params"]["exceptionDetails"]
                feil.append((d.get("exception") or {}).get("description", d.get("text", "?")).splitlines()[0][:160])
        s.settimeout(10)
        send({"id": 3, "method": "Runtime.evaluate", "params": {"returnByValue": True, "expression":
              "({skann: typeof runScan === 'function' && !!document.querySelector('.skann-ny'),"
              " nabo: !!document.getElementById('naboHus'), meny: typeof closeMenus === 'function'})"}})
        while True:
            m = motta()
            if m.get("id") == 3:
                sjekker = m.get("result", {}).get("result", {}).get("value") or {}
                break
    except Exception as e:
        feil.append(f"røyktesten selv: {e}")
    finally:
        p.kill()
    sjekk("appen starter i nettleseren uten JavaScript-feil", not feil, "; ".join(feil[:3]))
    sjekk("scan-feltet, NABO og menyene er på plass etter oppstart",
          bool(sjekker) and all(sjekker.values()), json.dumps(sjekker))


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

    import base64, tempfile
    tmp = tempfile.mkdtemp(prefix="nabo-")
    r1 = kall("/api/lagre", {"mappe": tmp, "navn": "nabo.csv", "data": base64.b64encode(b"x").decode()})
    r2 = kall("/api/lagre", {"mappe": tmp, "navn": "../ut.csv", "data": "eA=="})
    sjekk("NABO lagrer i valgt mappe, aldri utenfor", r1.get("status") == "done"
          and Path(r1.get("sti", "")).is_file() and r2.get("status") == "error", f"{r1} / {r2}")

    for fil in ("nabe-start", "nabe-verktoy", "nabe-felt", "nabe-moro", "nabe-finn", "nabe-skann", "nabo", "nabo-brodre"):
        try:
            with urllib.request.urlopen(f"{BASE}/js/{fil}.js", timeout=5) as rr:
                ok = rr.status == 200
        except Exception:
            ok = False
        sjekk(f"serverer js/{fil}.js", ok)
    # A file the browser cannot parse takes everything after it down with it,
    # and nothing above would notice. Node checks the syntax where it is installed.
    import shutil
    node = shutil.which("node")
    if node:
        feil = []
        for js in [HER / "app.js", *sorted((HER / "js").glob("*.js"))]:
            p = subprocess.run([node, "--check", str(js)], capture_output=True, text=True)
            if p.returncode:
                feil.append(f"{js.name}: {(p.stderr.strip().splitlines() or ['?'])[-1]}")
        sjekk("all JavaScript lar seg tolke", not feil, "; ".join(feil))
    royktest()
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
