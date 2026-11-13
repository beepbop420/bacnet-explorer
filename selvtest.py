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
from bacpypes3.primitivedata import Date, Time
from bacpypes3.pdu import IPv4Address

HER = Path(__file__).parent
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
PORT = 8099
BASE = f"http://127.0.0.1:{PORT}"
ENHETER = [(2, 9001, "SIM-AHU01"), (3, 9002, "SIM-RT401"), (4, 9003, "SIM-VP01")]


class SkjevKlokkeDevice(DeviceObject):
    """A controller whose clock stands exactly one hour ahead: the wrong side of
    the summer/winter switch."""
    @property
    def localDate(self):
        return Date.now(time.time() + 3600)

    @localDate.setter
    def localDate(self, value):
        pass

    @property
    def localTime(self):
        return Time.now(time.time() + 3600)

    @localTime.setter
    def localTime(self, value):
        pass


def lag_enhet(siste_oktett: int, instans: int, navn: str, skjev_klokke: bool = False):
    dev = (SkjevKlokkeDevice if skjev_klokke else DeviceObject)(objectIdentifier=("device", instans), objectName=navn,
                       vendorIdentifier=999, maxApduLengthAccepted=1476,
                       segmentationSupported="noSegmentation", vendorName="NABE Simulator")
    app = NormalApplication(dev, IPv4Address(f"127.0.0.{siste_oktett}/8"))
    app.add_object(AnalogInputObject(objectIdentifier=("analog-input", 1), objectName=f"{navn}_RT401",
                                     presentValue=21.5, units="degreesCelsius", covIncrement=0.5,
                                     description="Romtemperatur", statusFlags=[0, 0, 0, 0]))
    app.add_object(AnalogValueObjectCmd(objectIdentifier=("analog-value", 1), objectName=f"{navn}_SP",
                                        presentValue=21.0, relinquishDefault=21.0,
                                        units="degreesCelsius", description="Settpunkt",
                                        statusFlags=[0, 0, 0, 0]))
    app.add_object(BinaryValueObject(objectIdentifier=("binary-value", 1), objectName=f"{navn}_DRIFT",
                                     presentValue="active", description="Drift",
                                     statusFlags=[0, 0, 0, 0]))
    if skjev_klokke:
        # A loop that hunts on purpose: room temperature and valve swing with
        # a period of five seconds, the valve a quarter turn ahead.
        app.add_object(AnalogInputObject(objectIdentifier=("analog-input", 2), objectName=f"{navn}_RT402",
                                         presentValue=21.0, units="degreesCelsius", covIncrement=0.5,
                                         description="Pendler", statusFlags=[0, 0, 0, 0]))
        app.add_object(AnalogInputObject(objectIdentifier=("analog-input", 3), objectName=f"{navn}_SB402",
                                         presentValue=50.0, units="percent", covIncrement=1.0,
                                         description="Pendler pådrag", statusFlags=[0, 0, 0, 0]))
    # Lets a test make the device go quiet: it keeps the subscription but
    # stops pushing, which is what a restarted controller looks like.
    app.stum = False
    orig = app.cov_notification
    def _cn(cov, apdu):
        return None if app.stum else orig(cov, apdu)
    app.cov_notification = _cn
    return app


LOOP = None
APPS = {}


def i_loop(fn):
    """Change a simulated device from the test thread, on the loop it lives in."""
    ferdig = __import__("threading").Event()

    def kjor():
        try:
            fn()
        finally:
            ferdig.set()
    LOOP.call_soon_threadsafe(kjor)
    ferdig.wait(5)


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
    RESULTAT.append(bool(ok))
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
        uttrykk = lambda i: ({"id": i, "method": "Runtime.evaluate", "params": {"returnByValue": True, "expression":
              "({skann: typeof runScan === 'function' && !!document.querySelector('.skann-ny'),"
              " nabo: !!document.getElementById('naboHus'), meny: typeof closeMenus === 'function',"
              " flat: typeof flatVerdi === 'function' && !!document.getElementById('flatBtn') && (() => {"
              "  const a = {type:'analog-input', value:21, units:'degrees-celsius', _flatSett:1, _flatEndret:1, _flatSist:36e5-1000};"
              "  return flatVerdi(a, 36e5, 18e5) && !flatVerdi({...a, _flatEndret:3e6}, 36e5, 18e5)"
              "    && !flatVerdi({...a, value:0, units:'pascals'}, 36e5, 18e5) && !flatVerdi({...a, _flatCov:true}, 36e5, 18e5)"
              "    && !flatVerdi({...a, type:'analog-value'}, 36e5, 18e5); })(),"
              " sommer: typeof sommertidAvvik === 'function' && sommertidAvvik(3600) === 1 && sommertidAvvik(-3590) === -1"
              "   && sommertidAvvik(3000) === 0 && sommertidAvvik(7200) === 0 && sommertidAvvik(0) === 0"
              "   && /sommertid|summer/.test(klokkeTekst(3600)) && !/sommertid|summer/.test(klokkeTekst(1800)),"
              " pendling: !!window.nabePendling && (() => {"
              "  S.cache['9.9.9.9'] = [{objid:'analog-input,1', name:'360.003-RT401', unit_symbol:'C', value:21},"
              "    {objid:'analog-output,1', name:'360.003-SB401'}, {objid:'analog-value,1', name:'360.003-RT401-SP', value:21},"
              "    {objid:'analog-output,2', name:'360.004-SB401'}];"
              "  const p = nabePendling.partnere([{address:'9.9.9.9', objid:'analog-input,1'}]).map(x => x.objid).join();"
              "  const h = nabePendling.pendlingHtml({serier:[{navn:'360.003-RT401 (C)', enhet:'C', score:90, periode_s:300, amplitude:1.2, sykluser:5, dom:'pendler'}],"
              "    par:[{maling:'360.003-RT401 (C)', padrag:'360.003-SB401 (%)', dom:'sloyfe', forsinkelse_s:12}]});"
              "  return p === 'analog-output,1,analog-value,1' && !/undefined|NaN/.test(h) && /360.003-RT401/.test(h) && /5,0 min/.test(h); })(),"
              " kortlas: typeof kortLaast === 'function' && !!document.getElementById('kortAutoBtn') && (() => {"
              "  const sel = document.getElementById('localAddr'), alt = sel.innerHTML;"
              "  const o = document.createElement('option'); o.value = '1.2.3.4/32'; sel.append(o);"
              "  savePrefs({kortLast: ''}); const fri = kortLaast() === false;"
              "  savePrefs({kortLast: '1.2.3.4/32'}); const laast = kortLaast() === true;"
              "  savePrefs({kortLast: '9.9.9.9/32'}); const borte = kortLaast() === false;"
              "  savePrefs({kortLast: ''}); sel.innerHTML = alt;"
              "  return fri && laast && borte; })(),"
              " sistnaabar: typeof sistNaabar === 'function' && (() => {"
              "  const sel = document.getElementById('localAddr'), alt = sel.innerHTML, gammel = SK.anlegg, p = loadPrefs().iface;"
              "  const o = document.createElement('option'); o.value = '172.25.4.153/32'; sel.append(o);"
              "  SK.anlegg = [{key:'a', enheter:1, sist:Date.now()/1000, naabar:{ip:'10.252.254.107'}}];"
              "  savePrefs({iface: ''}); const fri = !!sistNaabar();"
              "  savePrefs({iface: '172.25.4.153/32'}); const blir = sistNaabar() === null;"
              "  savePrefs({iface: '10.252.254.107/32'}); sel.append(Object.assign(document.createElement('option'), {value: '10.252.254.107/32'}));"
              "  const samme = !!sistNaabar();"
              "  savePrefs({iface: p || ''}); sel.innerHTML = alt; SK.anlegg = gammel;"
              "  return fri && blir && samme; })(),"
              " oppdatering: typeof aapneOppdatering === 'function',"
              " simulator: !!window.nabeSimulator && !!document.getElementById('simBtn') && (() => {"
              "  S.devices.push({address:'9.9.9.9', device_instance: 5, object_name:'X', vendor_name:'V'});"
              "  S.cache['9.9.9.9'] = [{objid:'analog-input,1', type:'analog-input', instance:1, name:'N', description:'D', units:'percent', value:3, state_text:null, _hay:'bad'}];"
              "  const e = nabeSimulator.bygg(['9.9.9.9', '8.8.8.8']); S.devices.pop(); delete S.cache['9.9.9.9'];"
              "  return e.length === 1 && e[0].device_instance === 5 && e[0].punkter[0].units === 'percent' && !('_hay' in e[0].punkter[0]); })(),"
              " fortsett: !!window.nabeFortsett && (() => {"
              "  const gammel = S.watch, gS = S.scanRanges, nokkel = 'nabe_watch_v1', lagret = localStorage.getItem(nokkel);"
              "  S.scanRanges = ['9.9.9.0/24']; S.cache['9.9.9.9'] = [{objid:'analog-input,1', name:'Nytt navn', unit_symbol:'C', value:7}];"
              "  S.watch = [{ip:'9.9.9.9', objid:'analog-input,1', name:'X', unit:'C', hist:[1,2], value:1}]; nabeFortsett.lagre();"
              "  const lagretLagt = nabeFortsett.lagret().length === 1 && !JSON.stringify(nabeFortsett.lagret()).includes('hist');"
              "  S.watch = []; const n = nabeFortsett.gjenopprett(undefined, {stille: true});"
              "  const hentet = n === 1 && S.watch[0].name === 'Nytt navn' && S.watch[0].value === 7 && S.watch[0].hist.length === 0;"
              "  S.scanRanges = ['8.8.8.0/24']; const annet = nabeFortsett.gjenopprett(undefined, {stille: true}) === 0;"
              "  S.scanRanges = ['9.9.9.0/24']; S.watch = []; nabeFortsett.lagre(); const borte = nabeFortsett.lagret().length === 0;"
              "  S.watch = gammel; S.scanRanges = gS; delete S.cache['9.9.9.9'];"
              "  if (lagret === null) localStorage.removeItem(nokkel); else localStorage.setItem(nokkel, lagret);"
              "  return lagretLagt && hentet && annet && borte; })(),"
              " trafikk: typeof aapneTrafikk === 'function' && !!document.getElementById('trafikkBtn'),"
              " settpunkt: typeof aapneAvvik === 'function' && !!document.getElementById('avvikBtn') && (() => {"
              "  const n = ['X-SP','X_SP','X.sp','XSp','RT401SP','Akt_Sp','AktSP'].map(erSettpunktNavn);"
              "  const ikke = ['Spenning','Spjeld','Display','X','Sp'].every(x => erSettpunktNavn(x) === null);"
              "  const c = u => ({objid:u, name:u, value:1, units:'degrees-celsius'});"
              "  const a = [{name:'X',value:24,units:'degrees-celsius',objid:'1'},{name:'X-SP',value:21,units:'degrees-celsius',objid:'2'},"
              "             {name:'Y',value:20,units:'percent',objid:'3'},{name:'y_sp',value:20.5,units:'percent',objid:'4'},"
              "             {name:'AktTemp',value:5,units:'pascals',objid:'5'},{name:'AktSp',value:4,units:'pascals',objid:'6'},"
              "             {name:'Dup1',value:1,objid:'7'},{name:'Dup2',value:1,objid:'8'},{name:'Dup_SP',value:2,objid:'9'}];"
              "  const r = settpunktAvvik({a, b: [{name:'Z',value:1,objid:'1'},{name:'Z.SP',value:1,objid:'2'}]});"
              "  return n.join() === 'X,X,X,X,RT401,Akt,Akt' && ikke && r.length === 4 && r[0].p.name === 'AktTemp' && r[1].p.name === 'X' && r[1].avvik === 3"
              "    && !r.some(x => x.p.name.startsWith('Dup')); })()})"}})
        # A slow page (the machine busy with something else) gets a few more tries
        # before it counts as broken: the late scripts may simply not have run yet.
        for forsok in range(8):
            send(uttrykk(3 + forsok))
            while True:
                m = motta()
                if m.get("id") == 3 + forsok:
                    sjekker = m.get("result", {}).get("result", {}).get("value") or {}
                    break
            if sjekker and all(sjekker.values()):
                break
            time.sleep(1.5)
    except Exception as e:
        feil.append(f"røyktesten selv: {e}")
    finally:
        p.kill()
    sjekk("appen starter i nettleseren uten JavaScript-feil", not feil, "; ".join(feil[:3]))
    sjekk("scan-feltet, NABO og menyene er på plass etter oppstart",
          bool(sjekker) and all(sjekker.values()), json.dumps(sjekker))


def cov_vakt():
    """COV guard: a point that stops pushing is marked, read instead, and
    subscribed again. A quiet point that still pushes when asked is not."""
    ip, ai, bv = "127.0.0.6", "analog-input,1", "binary-value,1"
    mal = {ip: [ai, bv]}

    def poll():
        return kall("/api/poll", {"targets": mal})

    def kald():
        d = poll()
        return d, set(d.get("cov_ok", {}).get(ip, []))

    slutt = time.time() + 20
    d, ok = kald()
    while time.time() < slutt and len(ok) < 2:
        time.sleep(0.5)
        d, ok = kald()
    sjekk("COV: begge punktene abonnert", len(ok) == 2, f"{sorted(ok)}")

    def sett(v):
        i_loop(lambda: setattr(APPS[ip].get_object_name("SIM-AVVIK_RT401"), "presentValue", v))

    # While the device pushes, a change reaches the page by itself.
    sett(25.0)
    slutt, v = time.time() + 6, None
    while time.time() < slutt and v != 25.0:
        time.sleep(0.4)
        d = poll()
        v = d["values"][ip].get(ai)
    sjekk("COV: endring kommer som varsel", v == 25.0 and ai in d.get("cov_ok", {}).get(ip, []), f"verdi={v}")

    APPS[ip].stum = True
    sett(30.0)
    slutt, falsk, verdi = time.time() + 30, False, None
    while time.time() < slutt:
        d = poll()
        st = d.get("cov_stille", {}).get(ip, [])
        falsk = falsk or bv in st
        if ai in st:
            verdi = d["values"][ip].get(ai)
            break
        time.sleep(0.5)
    sjekk("COV stille: oppdages, og polling tar over", verdi == 30.0, f"verdi={verdi}")
    time.sleep(7)
    d = poll()
    falsk = falsk or bv in d.get("cov_stille", {}).get(ip, [])
    sjekk("COV: konstant punkt som ikke melder er ikke stille", not falsk)

    APPS[ip].stum = False
    slutt, tilbake = time.time() + 25, False
    while time.time() < slutt:
        d = poll()
        if ai not in d.get("cov_stille", {}).get(ip, []) and d.get("cov", 0) >= 1:
            tilbake = True
            break
        time.sleep(0.5)
    sjekk("COV: abonnerer på nytt og varslene kommer igjen", tilbake)


def sommertid():
    """A clock that is exactly an hour off is the summer/winter switch."""
    j = vent_jobb(kall("/api/device/points", {"address": "127.0.0.6", "device_instance": 9004})["job_id"])
    ident = (j.get("result") or {}).get("identity") or j.get("identity") or {}
    drift = ident.get("clock-drift")
    sjekk("enhet med klokka en time frem gir klokkeavvik på 3600 s",
          isinstance(drift, int) and abs(drift - 3600) <= 60, f"drift={drift}")


def trafikklogg():
    """Every request NABE sends is logged, with an answer, a time and a code."""
    t = kall("/api/trafikk")
    rader = t.get("rader", [])
    rpm = [r for r in rader if r["tjeneste"] == "ReadPropertyMultiple" and r["til"].startswith("127.0.0.3") and r["svar"] == "ok"]
    sjekk("trafikklogg: forespørsel mot 127.0.0.3 er logget med svar og tid", bool(rpm) and rpm[0]["ms"] >= 0,
          f"{len(rader)} rader, tjenester {sorted({r['tjeneste'] for r in rader})}")
    kall("/api/object/detail", {"address": "127.0.0.3", "objid": "analog-input,99"})
    feil = [r for r in kall("/api/trafikk")["rader"] if r["svar"] != "ok" and r["til"].startswith("127.0.0.3")]
    sjekk("trafikklogg: avvist forespørsel får feilkode", any("unknown-object" in r["kode"] or "unknownObject" in r["kode"] for r in feil),
          str([(r["svar"], r["kode"]) for r in feil[:3]]))
    sist = t.get("seq", 0)
    ny = kall(f"/api/trafikk?etter={sist}")
    sjekk("trafikklogg: etter-filter gir bare nye rader", all(r["n"] > sist for r in ny["rader"]) and ny["seq"] >= sist)
    sjekk("trafikklogg: oppsummering per enhet", "127.0.0.3" in {k.split(":")[0] for k in ny["oppsummering"]},
          str(list(ny["oppsummering"])[:4]))


def pendling():
    """Hunting is found on a recording, with its amplitude and period, and the
    loop is named when the sensor (RT) and the valve (SB) swing together."""
    import math, random
    rng = random.Random(1)
    n = 90
    ren = {"360.003-RT401 (°C)": [21 + math.sin(2 * math.pi * i / 6) + rng.uniform(-.05, .05) for i in range(n)],
           "360.003-SB401 (%)": [50 + 20 * math.sin(2 * math.pi * i / 6 + 1.5) + rng.uniform(-.5, .5) for i in range(n)],
           "Rolig (°C)": [21 + rng.uniform(-.05, .05) for _ in range(n)],
           "Rampe (°C)": [15 + .05 * i + rng.uniform(-.05, .05) for i in range(n)],
           "Bare støy (°C)": [21 + rng.uniform(-1, 1) for _ in range(n)]}
    r = kall("/api/pendling", {"serier": ren, "intervall": 1})
    s = {x["navn"]: x for x in r.get("serier", [])}
    rt = s.get("360.003-RT401 (°C)", {})
    sjekk("pendling: svingende RT gir høy poeng, riktig periode og amplitude",
          rt.get("score", 0) >= 60 and abs((rt.get("periode_s") or 0) - 6) <= 1 and abs(rt.get("amplitude", 0) - 1) < .2, str(rt))
    sjekk("pendling: rolig, rampe og støy gir lav poeng",
          all(s.get(k, {}).get("score", 100) < 35 for k in ("Rolig (°C)", "Rampe (°C)", "Bare støy (°C)")),
          str({k: s.get(k, {}).get("score") for k in ("Rolig (°C)", "Rampe (°C)", "Bare støy (°C)")}))
    sjekk("pendling: RT og SB som svinger sammen blir en sløyfe som pendler",
          [p["dom"] for p in r.get("par", [])] == ["sloyfe"], str(r.get("par")))
    sjekk("pendling: stien til opptak kan ikke peke utenfor mappa",
          kall("/api/pendling", {"fil": str(HER / "server.py")}).get("status") == "error")

    # Recorded for real from the simulated loop that hunts on purpose.
    punkter = [{"address": "127.0.0.6", "objid": "analog-input,2", "navn": "360.003-RT402", "enhet": "°C"},
               {"address": "127.0.0.6", "objid": "analog-input,3", "navn": "360.003-SB402", "enhet": "%"}]
    st = kall("/api/opptak/start", {"punkter": punkter, "intervall": 1})
    time.sleep(28)
    kall("/api/opptak/stopp", {})
    e = kall("/api/pendling", {})
    s = {x["navn"].split(" (")[0]: x for x in e.get("serier", [])}
    rt = s.get("360.003-RT402", {})
    sjekk("pendling: opptak av simulert enhet som svinger, periode 5 s",
          st.get("status") == "done" and rt.get("score", 0) >= 60 and abs((rt.get("periode_s") or 0) - 5) <= 1.5, str(rt))
    sjekk("pendling: opptaket gir en sløyfe som pendler", [p["dom"] for p in e.get("par", [])] == ["sloyfe"], str(e.get("par")))


def flere_kort():
    """Two adapters at once: each address is sent from its own, scans on
    different adapters run side by side, and changing the main adapter leaves
    the others (and the devices read through them) alone. The second adapter is
    127.0.0.7, which the test server is allowed to bind."""
    forst = kall("/api/status")
    sjekk("flere kort: starter med ett kort", len(forst.get("kort", [])) == 1, str(forst.get("kort")))

    def skann(omr, via):
        return kall("/api/scan", {"subnet": omr, "mode": "unicast_sweep", "thorough": False,
                                  "per_host_timeout": 1.0, "concurrency": 8, "via": via})["job_id"]

    # Two scans started together, each out of its own adapter.
    t0 = time.time()
    a, b = skann("127.0.0.2-4", "127.0.0.1"), skann("127.0.0.6", "127.0.0.7")
    ja, jb = vent_jobb(a), vent_jobb(b)
    ra, rb = ja.get("result") or {}, jb.get("result") or {}
    sjekk("flere kort: to skann samtidig, hver ut av sitt kort",
          ra.get("count") == 3 and rb.get("count") == 1
          and (ra.get("via") or {}).get("ip") == "127.0.0.1" and (rb.get("via") or {}).get("ip") == "127.0.0.7",
          f"{ra.get('count')}+{rb.get('count')} via {(ra.get('via') or {}).get('ip')}/{(rb.get('via') or {}).get('ip')}")

    st = kall("/api/status")
    ips = {k["ip"] for k in st.get("kort", [])}
    sjekk("flere kort: status lister begge kortene og hvilket som leser hvilken enhet",
          ips == {"127.0.0.1", "127.0.0.7"} and st["via"].get("127.0.0.6") == "127.0.0.7"
          and st["via"].get("127.0.0.3") == "127.0.0.1", f"{sorted(ips)} {st.get('via')}")

    # One poll, two devices, two adapters.
    p = kall("/api/poll", {"targets": {"127.0.0.6": ["analog-input,1"], "127.0.0.3": ["analog-input,1"]}})
    v = p.get("values") or {}
    sjekk("flere kort: ett poll leser begge enhetene hver via sitt kort",
          "analog-input,1" in v.get("127.0.0.6", {}) and "analog-input,1" in v.get("127.0.0.3", {}), str(v))
    rader = kall("/api/trafikk")["rader"]
    k6 = {r["kort"] for r in rader if r["til"].startswith("127.0.0.6") and r["n"] > 0 and r["svar"] != "sendt"}
    k3 = {r["kort"] for r in rader if r["til"].startswith("127.0.0.3") and r["svar"] != "sendt"}
    sjekk("flere kort: trafikkloggen viser kortet per forespørsel",
          "127.0.0.7" in k6 and "127.0.0.1" in k3 and "127.0.0.7" not in k3, f"{k6} / {k3}")

    # The main adapter changes; nothing else does.
    r1 = kall("/api/start", {"local_address": "127.0.0.7/8"})
    st = kall("/api/status")
    p = kall("/api/poll", {"targets": {"127.0.0.3": ["analog-input,1"]}})
    sjekk("flere kort: nytt hovedkort slipper de andre og enhetene beholder sitt kort",
          r1.get("status") == "done" and st["local_address"].startswith("127.0.0.7")
          and len(st["kort"]) == 2 and "analog-input,1" in (p.get("values") or {}).get("127.0.0.3", {}),
          f"{r1.get('status')} {st.get('local_address')} {len(st.get('kort', []))}")
    kall("/api/start", {"local_address": "127.0.0.1/8"})
    st = kall("/api/status")
    sjekk("flere kort: tilbake til første kort", st["local_address"].startswith("127.0.0.1")
          and any(k["primary"] and k["ip"] == "127.0.0.1" for k in st["kort"]))


def simulator():
    """A site run as devices on this PC: started from a snapshot, scanned and
    read like the real thing, written and released, never remembered as a site,
    and gone when stopped."""
    def punkt(nr, typ, navn, v, enhet=None, tekst=None, besk=""):
        d = {"objid": f"{typ},{nr}", "type": typ, "instance": nr, "name": navn, "description": besk, "value": v}
        if enhet:
            d["units"] = enhet
        if tekst:
            d["state_text"] = tekst
        return d

    a = {"address": "10.0.0.1", "device_instance": 7001, "object_name": "SIM-A", "vendor_name": "Beckhoff",
         "vendor_id": 15, "punkter": [
             punkt(0, "analog-input", "DE.320.043.RT401", 21.5, "degrees-celsius", besk="Romtemp"),
             punkt(1, "analog-value", "DE.320.043.RT401-SP", 21.0, "degrees-celsius", besk="Settpunkt"),
             punkt(2, "analog-output", "DE.320.043.SB401", 40.0, "percent", besk="Ventil"),
             punkt(3, "binary-value", "SYSTEM.OU001_HB", "active", tekst=["Av", "På"]),
             punkt(4, "multi-state-value", "DE.MODE", 2, tekst=["Av", "Auto", "Hand"], besk="Drift"),
             punkt(0, "schedule", "Ukeprogram", None)]}
    b = {"address": "10.0.0.2", "device_instance": 7002, "object_name": "SIM-B",
         "punkter": [punkt(0, "analog-input", "B_T1", 5.0, "degrees-celsius")]}
    r = kall("/api/sim/start", {"navn": "Test", "enheter": [a, b], "pendling": True, "periode": 6, "fra": 20})
    sjekk("simulator: starter fra et øyeblikksbilde og gir området å skanne",
          r.get("status") == "done" and r.get("omrade") == "127.0.0.20-21" and len(r.get("enheter", [])) == 2, str(r)[:200])
    ifs = [i["interface"] for i in kall("/api/interfaces").get("interfaces", [])]
    sjekk("simulator: loopback er et kort mens den går", "Simulator" in ifs, str(ifs))

    j = vent_jobb(kall("/api/scan", {"subnet": "127.0.0.20-21", "mode": "unicast_sweep", "thorough": False,
                                      "per_host_timeout": 1.0, "concurrency": 4, "via": "127.0.0.1"})["job_id"])
    funnet = sorted(d["device_instance"] for d in (j.get("result") or {}).get("devices", []))
    sjekk("simulator: skann finner enhetene med riktig instans", funnet == [7001, 7002], str(funnet))

    j = vent_jobb(kall("/api/device/points", {"address": "127.0.0.20", "device_instance": 7001})["job_id"])
    pts = {p["name"]: p for p in (j.get("result") or {}).get("points", [])}
    sjekk("simulator: punktene har navn, beskrivelse og enhet fra bildet",
          pts.get("DE.320.043.RT401", {}).get("description") == "Romtemp"
          and pts.get("DE.320.043.RT401", {}).get("units") == "degrees-celsius"
          and "DE.MODE" in pts and "Ukeprogram" not in pts, str(sorted(pts))[:200])

    # The loop swings on purpose: the room sensor moves.
    vals = []
    for _ in range(14):
        p = kall("/api/poll", {"targets": {"127.0.0.20": ["analog-input,0"]}})
        v = ((p.get("values") or {}).get("127.0.0.20") or {}).get("analog-input,0")
        if isinstance(v, (int, float)):
            vals.append(v)
        time.sleep(0.7)
    sjekk("simulator: sløyfa pendler, måleverdien beveger seg", len(vals) > 8 and max(vals) - min(vals) > 0.5,
          f"{len(vals)} verdier, spenn {round(max(vals) - min(vals), 2) if vals else '-'}")

    w = kall("/api/write", {"address": "127.0.0.20", "objid": "analog-value,1", "value": 23.5, "priority": 8})
    p = kall("/api/poll", {"targets": {"127.0.0.20": ["analog-value,1"]}})
    skrevet = ((p.get("values") or {}).get("127.0.0.20") or {}).get("analog-value,1")
    kall("/api/write", {"address": "127.0.0.20", "objid": "analog-value,1", "priority": 8, "release": True})
    time.sleep(0.6)
    p = kall("/api/poll", {"targets": {"127.0.0.20": ["analog-value,1"]}})
    tilbake = ((p.get("values") or {}).get("127.0.0.20") or {}).get("analog-value,1")
    sjekk("simulator: skriving og frigjøring virker som mot et anlegg",
          w.get("status") == "done" and skrevet == 23.5 and tilbake == 21.0, f"{skrevet} -> {tilbake}")

    kall("/api/write", {"address": "127.0.0.20", "objid": "analog-value,1", "value": 22.0, "priority": 8})
    mine = [o for o in kall("/api/mine").get("overstyrt", []) if str(o.get("address")).startswith("127.0.0.2")]
    sjekk("simulator: det som skrives dit står ikke igjen som overstyrt anlegg", not mine, str(mine))
    sk = kall("/api/sites", {"ranges": ["127.0.0.20-21"], "devices": [{"address": "127.0.0.20", "device_instance": 7001, "object_name": "SIM-A"}]})
    sjekk("simulator: huskes ikke som et anlegg", sk.get("status") == "skip", str(sk))

    lagret = kall("/api/sim").get("filer", [])
    kall("/api/sim/stopp", {})
    st = kall("/api/sim")
    ifs = [i["interface"] for i in kall("/api/interfaces").get("interfaces", [])]
    sjekk("simulator: stopper, og loopback er ikke lenger et kort", not st.get("kjorer") and "Simulator" not in ifs, f"{st.get('kjorer')} {ifs}")

    # A saved simulation starts again without the plant.
    r2 = kall("/api/sim/start", {"fil": lagret[0]["fil"], "fra": 30}) if lagret else {}
    j = vent_jobb(kall("/api/scan", {"subnet": "127.0.0.30-31", "mode": "unicast_sweep", "thorough": False,
                                      "per_host_timeout": 1.0, "concurrency": 4, "via": "127.0.0.1"})["job_id"]) if r2.get("status") == "done" else {}
    sjekk("simulator: en lagret simulering starter igjen uten anlegget",
          r2.get("status") == "done" and (j.get("result") or {}).get("count") == 2, str(r2)[:150])
    kall("/api/sim/stopp", {})
    if lagret:
        kall("/api/sim/slett", {"fil": lagret[0]["fil"]})


def oppdatering():
    """Updating from inside the app: the signature decides. A file that does not
    verify, an old version, a path out of the folder, an app that is not the
    installed one: each stops with nothing changed."""
    import shutil, tempfile, zipfile
    sys.path.insert(0, str(HER))
    import nabe_oppdater as no
    import nabe_signatur as ns
    sjekk("oppdatering: Ed25519 stemmer med RFC 8032-testvektoren", ns._sjekk_rfc())
    sjekk("oppdatering: appen har en offentlig nøkkel å sjekke mot",
          len(ns.PUBLIKK_NOKKEL) == 64 and bytes.fromhex(ns.PUBLIKK_NOKKEL) != b"")

    h = os.urandom(32)
    off = ns.offentlig_fra(h).hex()
    tmp = Path(tempfile.mkdtemp(prefix="nabe-oppd-"))
    gammel_lokal = os.environ.get("LOCALAPPDATA")
    os.environ["LOCALAPPDATA"] = str(tmp / "lok")
    her = tmp / "lok" / "Programs" / "NABE"
    her.mkdir(parents=True)

    def lag_zip(navn, ekstra=None):
        z = tmp / navn
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("Installer NABE.cmd", "@echo off")
            f.writestr(".nabe/installer.py", "print('x')")
            f.writestr(".nabe/python/pythonw.exe", "")
            if ekstra:
                f.writestr(ekstra, "ond")
        return z

    def kilde(z, sigdata, tag="v9.9", med_sig=True):
        (tmp / "sig.json").write_text(json.dumps(sigdata), encoding="utf-8")
        filer = {"zip": z, "sig": tmp / "sig.json"}
        assets = [{"name": no.ZIPNAVN, "browser_download_url": "zip"}]
        if med_sig:
            assets.append({"name": no.SIGNAVN, "browser_download_url": "sig"})
        hent = lambda url, timeout=10: {"tag_name": tag, "body": "- noe nytt", "assets": assets}

        def last(url, mal, **k):
            shutil.copy(filer[url], mal)
            return ns.sha256_fil(mal)
        return hent, last

    def kjor(z, sigdata, her_versjon="1.0", mappe=None, **kw):
        hent, last = kilde(z, sigdata, **kw)
        try:
            return no.oppdater(her_versjon, mappe or her, tmp / "arbeid", 1, hent_json=hent, last=last,
                               offentlig_hex=off, start=False), ""
        except no.Feil as e:
            return None, str(e)

    z1 = lag_zip("a.zip")
    sig1 = ns.lag_signatur(z1, "9.9", h)
    sha1 = ns.sha256_fil(z1)
    sjekk("oppdatering: riktig fil, versjon og nøkkel godkjennes", ns.sjekk_signatur(sig1, sha1, "9.9", off))
    sjekk("oppdatering: endret fil, annen versjon eller annen nøkkel avvises",
          not ns.sjekk_signatur(sig1, "0" * 64, "9.9", off) and not ns.sjekk_signatur(sig1, sha1, "9.8", off)
          and not ns.sjekk_signatur(sig1, sha1, "9.9", ns.offentlig_fra(os.urandom(32)).hex()))

    r, feil = kjor(z1, sig1)
    sjekk("oppdatering: en signert utgivelse lastes, sjekkes og pakkes ut",
          r is not None and (Path(r["mappe"]) / ".nabe" / "installer.py").is_file(), feil or str(r))
    z2 = lag_zip("b.zip", ekstra="ekstra.txt")
    r, feil = kjor(z2, sig1)
    sjekk("oppdatering: en fil som ikke er den signerte stoppes, og filen slettes",
          r is None and "ignatur" in feil and not (tmp / "arbeid" / "NABE-Installasjon-9.9.zip").exists(), feil)
    z3 = lag_zip("c.zip", ekstra="../ond.txt")
    r, feil = kjor(z3, ns.lag_signatur(z3, "9.9", h))
    sjekk("oppdatering: en filsti ut av mappa avvises selv med riktig signatur",
          r is None and "utenfor" in feil and not (tmp / "arbeid" / "ond.txt").exists() and not (tmp / "ond.txt").exists(), feil)
    r, feil = kjor(z1, sig1, her_versjon="9.9")
    sjekk("oppdatering: samme eller nyere versjon installeres ikke igjen", r is None and "nyeste" in feil, feil)
    r, feil = kjor(z1, sig1, mappe=tmp / "kilde")
    sjekk("oppdatering: en kopi som ikke er den installerte overskrives aldri", r is None and "installert" in feil, feil)
    r, feil = kjor(z1, sig1, med_sig=False)
    sjekk("oppdatering: en utgivelse uten signatur installeres ikke av appen", r is None and "signatur" in feil, feil)

    if gammel_lokal is None:
        os.environ.pop("LOCALAPPDATA", None)
    else:
        os.environ["LOCALAPPDATA"] = gammel_lokal
    shutil.rmtree(tmp, ignore_errors=True)

    s = kall("/api/oppdatering")
    sjekk("oppdatering: serveren svarer, og en kopi fra kildemappa kan ikke oppdatere seg",
          s.get("status") == "done" and s.get("kanOppdatere") is False and bool(s.get("her")), str(s)[:150])
    sjekk("oppdatering: å starte i en kopi som ikke er installert gir en forklaring", kall("/api/oppdater", {}).get("status") == "error")


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
    cov_vakt()
    sommertid()
    trafikklogg()
    flere_kort()
    simulator()
    oppdatering()

    j = vent_jobb(kall("/api/scan", {"subnet": "127.0.0.5:47820", "mode": "bbmd", "timeout": 4})["job_id"])
    r = j.get("result") or {}
    sjekk("BBMD-modus registrerer og finner", r.get("bbmd_status") == 0 and r.get("count", 0) >= 1,
          f"status {r.get('bbmd_status')}, {r.get('count')} enheter, tabell {r.get('bdt')}")
    uten = [d.get("address") for d in r.get("devices") or [] if not d.get("object_name")]
    sjekk("Who-Is-funn får navn", bool(r.get("devices")) and not uten, f"uten navn: {uten}")

    # The search on start scans on its own; with the tunnel down it hears
    # nothing, and that must not wipe what the site is known to have.
    en = {"address": "10.9.9.9", "device_instance": 1, "object_name": "X"}
    kall("/api/sites", {"ranges": ["10.9.9.0/24"], "devices": [en]})
    tom = kall("/api/sites", {"ranges": ["10.9.9.0/24"], "devices": []})
    sjekk("et tomt skann sletter ikke enhetene anlegget husker",
          len((tom.get("site") or {}).get("enheter") or []) == 1, str((tom.get("site") or {}).get("enheter")))

    # English edition: no static text in index.html may stay Norwegian.
    import subprocess as _sp
    v = _sp.run(["node", str(Path(__file__).parent / "sprakvakt.js"), str(Path(__file__).parent)],
                capture_output=True, text=True, encoding="utf-8")
    sjekk("engelsk: all fast tekst i index.html er oversatt", v.returncode == 0, (v.stdout or "").strip()[:300])

    import base64, tempfile
    tmp = tempfile.mkdtemp(prefix="nabo-")
    r1 = kall("/api/lagre", {"mappe": tmp, "navn": "nabo.csv", "data": base64.b64encode(b"x").decode()})
    r2 = kall("/api/lagre", {"mappe": tmp, "navn": "../ut.csv", "data": "eA=="})
    sjekk("NABO lagrer i valgt mappe, aldri utenfor", r1.get("status") == "done"
          and Path(r1.get("sti", "")).is_file() and r2.get("status") == "error", f"{r1} / {r2}")

    # The local AI: never asked without a source, and off until chosen.
    r5 = kall("/api/ki/svar", {"sporsmal": "x", "kilder": []})
    sjekk("KI svarer aldri uten kilde", r5.get("status") == "error", str(r5))

    # A recording reads on its own and writes rows as it goes.
    r3 = kall("/api/opptak/start", {"punkter": [{"address": "127.0.0.2", "objid": "analog-input,1", "navn": "T"}], "intervall": 1})
    time.sleep(2.3)
    r4 = kall("/api/opptak/stopp", {})
    linjer = Path(r3.get("fil", "x")).read_text(encoding="utf-8-sig").splitlines() if r3.get("status") == "done" else []
    sjekk("opptak skriver rader med verdi", len(linjer) >= 3 and r4.get("rader", 0) >= 2 and linjer[1].split(";")[1] != "", str(linjer[:3]))

    pendling()

    for fil in ("nabe-start", "nabe-verktoy", "nabe-felt", "nabe-moro", "nabe-finn", "nabe-skann", "nabe-anlegg", "nabe-bunn", "nabe-graf", "nabe-tunnel", "nabe-sammen", "nabe-flyt", "nabe-peker", "nabe-pekere", "nabe-skrift", "nabo", "nabo-brodre", "nabo-fasit", "nabe-garderobe", "nabe-opptak", "nabe-trafikk", "nabe-fortsett", "nabe-simulator", "nabe-oppdatering", "nabe-kunnskap", "nabe-spor"):
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
    global LOOP
    LOOP = loop
    apps = [lag_enhet(*e) for e in ENHETER]
    # Outside the scanned range 127.0.0.2-4, so the scan tests do not see it.
    APPS["127.0.0.6"] = lag_enhet(6, 9004, "SIM-AVVIK", skjev_klokke=True)
    apps.append(APPS["127.0.0.6"])

    async def sving():
        import math
        rt = APPS["127.0.0.6"].get_object_name("SIM-AVVIK_RT402")
        sb = APPS["127.0.0.6"].get_object_name("SIM-AVVIK_SB402")
        while True:
            t = time.time()
            rt.presentValue = 21.0 + 1.0 * math.sin(2 * math.pi * t / 5)
            sb.presentValue = 50.0 + 30.0 * math.sin(2 * math.pi * t / 5 + math.pi / 2)
            await asyncio.sleep(0.2)
    svinger = asyncio.create_task(sving())
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
    env = dict(os.environ, NABE_ALLOWED_ORIGINS=BASE, NABE_DATA=data,
               NABE_COV_LIFETIME="6", NABE_COV_PAA_NYTT="3", NABE_TILLAT_LOOPBACK="1")
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
