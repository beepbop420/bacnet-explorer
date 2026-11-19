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
from bacpypes3.local.binary import BinaryInputObject, BinaryValueObject
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
    if skjev_klokke:
        # A sensor that is not connected (a fault, with its reason) and a binary
        # point the device calls an alarm while it is on.
        app.add_object(AnalogInputObject(objectIdentifier=("analog-input", 4), objectName=f"{navn}_FEIL",
                                         presentValue=0.0, units="degreesCelsius", description="Ubrukt",
                                         statusFlags=[0, 1, 0, 0], reliability="noSensor"))
        app.add_object(BinaryInputObject(objectIdentifier=("binary-input", 5), objectName=f"{navn}_ALARM",
                                         presentValue="active", polarity="normal", description="Alarm ved på",
                                         statusFlags=[1, 0, 0, 0], eventState="offnormal", alarmValue="active"))
        # A pump that starts every six seconds, for the count of starts an hour
        app.add_object(BinaryInputObject(objectIdentifier=("binary-input", 6), objectName=f"{navn}_PUMPE",
                                         presentValue="inactive", polarity="normal", description="Sirkulasjonspumpe",
                                         statusFlags=[0, 0, 0, 0]))
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
MBSIM = None
KXSIM = None
MBRTU = None
KXSEC = None


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


NYE_RYKTEST = r'''  urimelig: (() => {    const ai = (v, u, n) => ({type: 'analog-input', value: v, units: u, name: n || 'X'});    return !!rarGrunn(ai(-50, 'degrees-celsius')) && !!rarGrunn(ai(32767, 'degrees-celsius')) && !rarGrunn(ai(21.5, 'degrees-celsius'))      && !!rarGrunn(ai(0, 'parts-per-million', 'CO2_PV')) && !rarGrunn(ai(0, 'parts-per-million', 'CO_PV')) && !rarGrunn(ai(650, 'parts-per-million', 'CO2_PV'))      && !!rarGrunn(ai(120, 'percent-relative-humidity')) && !!rarGrunn(ai(0, 'percent-relative-humidity')) && !rarGrunn(ai(45, 'percent-relative-humidity'))      && !rarGrunn({...ai(-50, 'degrees-celsius'), type: 'analog-output'}) && !rarGrunn({...ai(-50, 'degrees-celsius'), unread: true})      && !!rarGrunn(ai(-60, 'degrees-celsius')) && rarVerdi(ai(-50, 'degrees-celsius')) === true && rarGrunn({type: 'analog-input', value: 5, units: 'degrees-celsius'}) === ''; })(),  nett: !!window.nabeNett && (() => {    const N = window.nabeNett, mk = (net, n) => Array.from({length: n}, (_, i) => ({address: net + ':' + i, device_instance: net * 100 + i, protocol: 'bacnet'}));    const r = N.ruterBelastning([{ruter: '10.0.0.1', nett: [5, 6]}, {ruter: '10.0.0.2', nett: [7]}], [...mk(5, 33), ...mk(6, 5), ...mk(7, 25), ...mk(9, 4), {address: '10.0.0.9', device_instance: 1}]);    const a = r.rutere.find(x => x.ruter === '10.0.0.1'), b = r.rutere.find(x => x.ruter === '10.0.0.2');    const m = N.sammeMac([{address: '10.0.0.1', mac: 'AA:BB:CC:00:00:01'}, {address: '10.0.0.2', mac: 'aa-bb-cc-00-00-01'}, {address: '10.0.0.3:47809', mac: '11:22:33:44:55:66'}, {address: '10.0.0.3', mac: '11:22:33:44:55:66'}]);    S._sammeAdr = {};    const it = N.ny();    N.noterAdresse(null, {address: '10.1.1.1', device_instance: 1}, it); N.noterAdresse(null, {address: '10.1.1.1', device_instance: 2}, it); N.noterAdresse(null, {address: '10.1.1.2', device_instance: 3}, it);    N.ferdigMed(it);    const konf = N.sammeAdresse([{address: '10.1.1.1'}, {address: '10.1.1.2'}]);    const it2 = N.ny(); N.noterAdresse({device_instance: 1}, {address: '10.1.1.1', device_instance: 1}, it2); N.ferdigMed(it2);    const etter = N.sammeAdresse([{address: '10.1.1.1'}]);    S._sammeAdr = {};    return a.niva === 'over' && a.nett[0].antall === 33 && a.nett[0].mstp === 33 && a.total === 38 && b.niva === 'naer' && r.utenRuter.length === 1 && r.utenRuter[0].nett === 9      && m.length === 1 && m[0].enheter.length === 2 && konf.length === 1 && konf[0].ider.join() === '1,2' && etter.length === 0 && N.nettAv('10.0.0.1:47808') === null && N.nettAv('50:2').nett === 50      && typeof window.nabeKart.ruterData === 'function'; })(),  alarmhist: !!window.nabeAlarmhist && typeof aapneAlarmhist === 'function' && !!document.getElementById('alarmhistBtn') && (() => {    const A = window.nabeAlarmhist, lager = {anlegg: {}}, a = A.anlegg(lager, 'k'), dag = 864e5, t0 = Date.UTC(2026, 5, 1, 10);    const d = {address: '10.0.0.1', object_name: 'RTU'}, p = (n, f) => ({objid: 'ai,' + n, name: 'P' + n, status: f});    const n1 = A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, [])], t0);    const n2 = A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, ['in-alarm']), p(3, ['fault'])], t0 + dag);    A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, [])], t0 + 2 * dag);    A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, ['in-alarm'])], t0 + 3 * dag);    const dd = a.enh['10.0.0.1'].dager, nu = t0 + 3 * dag + 1000, x = (n) => a.pkt['10.0.0.1|ai,' + n];    return n1 === 0 && n2 === 2 && x(1).grunnlag === true && A.klassifiser(x(1), dd, nu).kronisk && !A.klassifiser(x(1), dd, nu).ny      && !A.klassifiser(x(2), dd, nu).kronisk && A.klassifiser(x(2), dd, nu).sjelden && x(2).n === 2      && A.klassifiser(x(3), dd, t0 + dag + 1000).ny && !A.klassifiser(x(3), dd, nu).ny; })(),  idriftsettelse: !!window.nabeSat && typeof aapneSat === 'function' && !!document.getElementById('satBtn') && (() => {    const Z = window.nabeSat;    const r = Z.parsPunktliste('Enhet;Punkt;Min;Maks;Merknad\nRTU-1;RT401;19,5;23;Rom\nRTU-1;FS401\n# kommentar\n;P9;;5');    const r2 = Z.parsPunktliste('RT401\nRT402'), r3 = Z.parsPunktliste('A,B,1,2');    const devs = [{address: '10.0.0.1', device_instance: 11, object_name: 'RTU-1'}, {address: '10.0.0.2', device_instance: 12, object_name: 'RTU-2'}, {address: '10.0.0.3', device_instance: 13, object_name: 'RTU-2'}];    const cache = {'10.0.0.1': [{objid: 'ai,1', name: 'RT401', value: 21, status: []}, {objid: 'ai,2', name: 'Fs 401', value: 5, status: ['overridden']}], '10.0.0.2': [{objid: 'ai,1', name: 'RT401', value: 21}]};    const f = (e, p) => Z.finnPunkt({enhet: e, punkt: p}, devs, cache);    const v = (rad, p, val) => Z.vurder(rad, p, val);    const ok = {objid: 'ai,1', name: 'T', value: 21, status: []};    const o = Z.oppsummer([{res: {status: 'ok'}}, {res: {status: 'utenfor'}}, {res: {status: 'over'}, godkjent: true}, {res: {status: 'over'}}, {}]);    return r.length === 3 && r[0].lav === 19.5 && r[0].hoy === 23 && r[0].merknad === 'Rom' && r[1].lav === null && r[2].enhet === '' && r[2].hoy === 5      && r2.length === 2 && r2[0].punkt === 'RT401' && r3.length === 1 && r3[0].lav === 1      && f('RTU-1', 'RT401').status === 'funnet' && f('11', 'RT401').p.objid === 'ai,1' && f('10.0.0.1', 'fs401').status === 'funnet' && f('RTU-1', 'FS-401').p.objid === 'ai,2'      && f('RTU-2', 'RT401').status === 'flere-enheter' && f('Finnes ikke', 'X').status === 'ingen-enhet' && f('RTU-1', 'X').status === 'ingen-punkt' && f('', 'RT401').status === 'flere-punkter'      && f('RTU-3', 'RT401').status === 'ingen-enhet'      && Z.objidFraKortform('AI 10000') === 'analog-input,10000' && Z.objidFraKortform('bv1') === 'binary-value,1' && Z.objidFraKortform('RT401') === '' && Z.objidFraKortform('msv-3') === 'multi-state-value,3'      && v({lav: 19, hoy: 23}, ok).status === 'ok' && v({lav: 22, hoy: null}, ok).status === 'utenfor' && v({lav: null, hoy: 20}, ok).status === 'utenfor'      && v({}, {...ok, status: ['fault']}).status === 'feil' && v({}, {...ok, status: ['overridden']}).status === 'over' && v({}, {...ok, status: ['out-of-service']}).status === 'ute' && v({}, {...ok, value: null}).status === 'ikke'      && v({}, {...ok, status: ['in-alarm']}).status === 'alarm' && o.ok === 1 && o.godkjent === 1 && o.avvik === 1 && o.varsel === 1 && o.ikkeKjort === 1 && o.ferdige === 2; })(),  forslag2: (() => {    const dev = (a, n) => ({address: a, object_name: n, device_instance: 1});    const r = bygForslag({devices: [dev('10.0.0.1', 'A')], cache: {'10.0.0.1': [{objid: 'ai,1', name: 'P', status: []}]}, failed: new Set(), varsler: [], avvik: [],      urimelig: [{ip: '10.0.0.1', objid: 'ai,1', navn: 'T1', verdi: '-50 C'}], flate: [{ip: '10.0.0.1', objid: 'ai,1', navn: 'T2', minutter: 40}],      sykluser: [{address: '10.0.0.1', objid: 'bi,1', navn: 'Pumpe (x)', per_time: 9.5, dom: 'mange'}], tips: [{ip: '10.0.0.1', objid: 'bo,1', navn: 'Pumpe 2'}],      alarmhist: [{ip: '10.0.0.1', objid: 'ai,3', navn: 'N', ny: true, kjent: false, dager: ['d'], kronisk: false}, {ip: '10.0.0.1', objid: 'ai,4', navn: 'K', kronisk: true, kjent: false, dager: ['a', 'b', 'c']}, {ip: '10.0.0.1', objid: 'ai,5', navn: 'Kj', kronisk: true, kjent: true, dager: ['a']}],      ruter: {rutere: [{ruter: '10.0.0.9', total: 40, niva: 'over', nett: [{nett: 5, antall: 40, mstp: 40, niva: 'over', forste: '5:1'}]}], utenRuter: []},      sammeMac: [{mac: 'aa:bb', enheter: [{address: '10.0.0.1'}, {address: '10.0.0.2'}]}], endretId: [{ip: '10.0.0.1', fra: 1, til: 2}]});    const id = r.liste.map(p => p.id), get = (x) => r.liste.find(p => p.id === x);    return ['urimelig', 'flat', 'sykluser', 'syk-tips', 'alarm-nye', 'alarm-ofte', 'ruter', 'mac', 'endret-id'].every(x => id.includes(x))      && get('sykluser').prio === 2 && get('ruter').prio === 2 && get('alarm-ofte').rader.length === 1 && get('alarm-nye').rader.length === 1 && id.indexOf('urimelig') < id.indexOf('flat')      && get('sykluser').rader[0].navn !== undefined && /9,5/.test(get('sykluser').rader[0].tekst) && /kan ikke stemme|cannot be right/.test(get('urimelig').tittel); })(),  grenser: !!window.nabeGrenser && (() => {    const G = window.nabeGrenser;    const ev = [{id: 1, address: 'a', objid: 'o', type: 'over'}, {id: 2, address: 'a', objid: 'o', type: 'tilbake'}, {id: 3, address: 'b', objid: 'o', type: 'under'}, {id: 4, address: 'b', objid: 'o', type: 'fortsatt'}];    const ak = G.aktive(ev), t = G.tekst({type: 'over', verdi: 33.2, grense: 30, enhet: 'C'});    return ak.length === 1 && ak[0].address === 'b' && /30/.test(t) && /33/.test(t) && /Fortsatt under|Still below/.test(G.tekst({type: 'fortsatt', verdi: 5, grense: 10, enhet: 'C'}))      && /Tilbake|Back/.test(G.tekst({type: 'tilbake', verdi: 20, grense: null, enhet: 'C'})) && typeof aapneGrenser === 'function'; })(),  stotte: typeof aapneStotte === 'function' && !!document.getElementById('stotteBtn') && typeof window.nabeStotte.enhetsCsv() === 'string' && window.nabeStotte.enhetsCsv().startsWith('adresse;instans'),  eksport: !!window.nabeKartEksport && (() => {    const foer = S.devices;    S.devices = [{address: '10.0.0.1', device_instance: 1, object_name: 'A <&> "B"', _range: '10.0.0.0/24'}, {address: 'mb:10.0.0.2', protocol: 'modbus', object_name: 'M', _range: '10.0.0.0/24'}];    let ok = false;    try {      const r = window.nabeKartEksport.bygSvg(), x = new DOMParser().parseFromString(r.svg, 'image/svg+xml');      ok = !x.querySelector('parsererror') && x.documentElement.nodeName === 'svg' && r.W > 500 && r.H > 200 && !r.svg.includes('A <&>');    } finally { S.devices = foer; }    return ok && window.nabeKartEksport.bygSvg() === null; })(),'''


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
              " flagg: (() => {"
              "  const f = {status:['fault'], reliability:'no-output'}, a = {status:['in-alarm','fault'], event_state:'offnormal', alarm_value:'active'};"
              "  return flaggKlasse(f) === 'fault' && flaggKlasse(a) === 'alarm' && flaggKlasse({status:[]}) === ''"
              "    && flaggArsak(f).length > 0 && !flaggArsak(f).includes('-') && flaggArsak(a).includes('·')"
              "    && flaggArsak({status:['fault'], reliability:'no-fault-detected'}) === '' && flaggArsak({status:['fault']}) === ''"
              "    && flaggTag({status:[]}) === ''; })(),"
              " bakover: typeof aapneBakover === 'function' && !!document.getElementById('watchBakover') && (() => {"
              "  const d = nabeVakt.bane([0, 10, 20, 100, 110], [1, 2, 3, 2, 1], 0, 110, 100, 10, 1, 3);"
              "  return /^M/.test(d) && (d.match(/M/g) || []).length === 2 && /L/.test(d) && nabeVakt.bane([], [], 0, 10, 100, 10, 0, 1) === ''; })(),"
              " kart: typeof nabeKartSprak === 'function' && typeof aapneKart === 'function' && !!document.getElementById('kartBtn') && typeof nabeKart.steder === 'function',"
              " klassifisering: (() => { S.identity['9.9.9.8'] = {'model-name': 'BACnet/IP for TwinCAT'}; const a = gruppeFor({address: '9.9.9.8', protocol: 'bacnet'}).label; delete S.identity['9.9.9.8'];"
              "  const b = gruppeFor({address: '9.9.9.7', protocol: 'bacnet', vendor_name: null, object_name: 'Beckhoff_0'}).label; const c = gruppeFor({address: '9.9.9.6', protocol: 'bacnet', vendor_id: 415}).label;"
              "  return a === 'Beckhoff' && b === 'Beckhoff' && c === 'Beckhoff' && !!nabeNavnTilOmraade('10.0.0.1/24') && nabeNavnTilOmraade('10.0.0.1/24').tekst === '10.0.0.1/24'; })(),"
              " oppdatering: typeof aapneOppdatering === 'function' && typeof sjekkOppdatering === 'function',"
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
              " helhet: !!window.nabeSyn && !!window.nabeRaad && typeof kobleTilPaaNytt === 'function' && typeof navngiNett === 'function'"
              "  && !!document.getElementById('devRescan') && !!document.getElementById('fargesynBtn') && !!document.getElementById('humorBtn')"
              "  && !!document.getElementById('bakoverBtn') && !document.getElementById('expPop').contains(document.getElementById('schBtn')),"
              " besok: typeof aapneBesok === 'function' && typeof aapneRapport === 'function' && !!document.getElementById('besokBtn')"
              "  && (() => { const a = {t: 1, enheter: {x: {n: 'A', p: {o1: ['RT-SP', 21, '', ''], o2: ['RT', 20, '', '']}}, y: {n: 'B', p: {}}}};"
              "    const b = {t: 2, enheter: {x: {n: 'A', p: {o1: ['RT-SP', 23, '', ''], o2: ['RT', 20.2, 'in-alarm', '']}}}};"
              "    const d = besokDiff(a, b, false); return d.verdi.length === 1 && d.alarmNy.length === 1 && d.borte.length === 1 && d.nye.length === 0; })(),"
              " runde: typeof rundeLagret === 'function' && typeof nabeRaad.funn === 'function' && typeof nabeRaad.tregLenke === 'function',"
              " dialog: typeof nabeBekreft === 'function' && (() => { nabeBekreft('x');"
              "    const ok = !!document.querySelector('.dlg-lag [data-d=ja]'); document.querySelector('.dlg-lag [data-d=nei]').click();"
              "    return ok && !document.querySelector('.dlg-lag'); })(),"
              " port: typeof byttPort === 'function',"
              " smart: (() => {"
              "  const T1 = (o, n, d, v) => ({objid: o, name: n, description: d, type: 'analog-input', value: v, units: 'degrees-celsius'});"
              "  const P = (o, n, d, v) => ({objid: o, name: n, description: d, type: 'analog-input', value: v, units: 'bar'});"
              "  const s = nabeSkjema.byggSystemer([T1('a', 's32001.RT402', 'SD2T 320.001-RT402 Tur fra fjernvarme', 60), T1('b', 's32001.RT502', 'SD2T 320.001-RT502 Retur fra fjernvarme', 40),"
              "    T1('c', 's32001.RT404', 'SD2T 320.001-RT404 Tur fra VP veksler', 40), T1('d', 's32001.RT504', 'SD2T 320.001-RT504 Retur til VP veksler', 33),"
              "    P('e', 's32001.RP401', 'SD2T 320.001-RP401 Trykkgiver ekspansjonskar', 6)]);"
              "  const kurs = s.find(x => x.id === '320.01'), d = kurs ? nabeSkjema.tegnKurser([kurs], 'varme') : null;"
              "  const L = (n, v, b) => T1(n, 'A_360_001_' + n, b, v);"
              "  const u = nabeSkjema.byggSystemer([L('RT40', 3.7, 'Temperaturføler Inntak'), L('RT43', 20.4, 'Temperaturføler Tilluft'), L('RT52', 21, 'Temperaturføler Avtrekk'),"
              "    L('RT50', 13.6, ''), L('RT41', 3.9, ''), L('RT42', 11, ''),"
              "    L('RT601', 22, '')]).find(x => x.id === '360.001');"
              "  const st = u && nabeSkjema.stasjoner(u.komp), av = (kd) => st.get(u.komp.find(k => k.kode === kd));"
              "  return !!kurs && !!d && d.svg.includes('RT402') && d.svg.includes('RP401') && /Fjernvarme/.test(d.svg) && /VP veksler/.test(d.svg)"
              "    && !!u && av('RT50') === 'avkast' && av('RT41') === 'inntak' && !av('RT601') && u.komp.find(k => k.kode === 'RT601').sted === 'rom'; })(),"
              " dmg10: (() => { const a = nabeSkjema.tolkNavn('s36001.RT401'), b = nabeSkjema.tolkNavn('s10_00332_001_SM401', 'SD2T +10-00=332.001-SM401 Sprinklerventil stengt'),"
              "    c = nabeSkjema.tolkPunkt({objid: 'x', name: 'SupDuctPa', description: '', type: 'analog-input', value: 292, units: 'pascals'}),"
              "    d = nabeSkjema.tolkPunkt({objid: 'y', name: 'ExhaustTemp', description: '', type: 'analog-input', value: 5, units: 'degrees-celsius'});"
              "  return a.sys === '360.01' && a.kode === 'RT401' && b.sys === '332.001' && b.kode === 'SM401' && c.sted === 'tilluft' && c.art === 'trykk' && d.sted === 'avkast'; })(),"
              " skjema2: (() => {"
              "  const P = (o, n, d, t, v, u) => ({objid: o, name: n, description: d, type: t, value: v, units: u || ''});"
              "  const T1 = (o, n, d, v) => P(o, n, d, 'analog-input', v, 'degrees-celsius');"
              "  const s = nabeSkjema.byggSystemer([T1('a', 'A_360_001_RT40', 'Temperaturføler Inntak', 3.7), T1('b', 'A_360_001_RT41', 'Temperaturføler Etter varmegjv.', 17.7),"
              "    T1('c', 'A_360_001_RT43', 'Temperaturføler Tilluft', 20.4), T1('d', 'A_360_001_RT50', 'Temperaturføler Avkast', 13.6), T1('e', 'A_360_001_RT52', 'Temperaturføler Avtrekk', 17.7),"
              "    T1('f', 'A_360_001_RT901', 'Temperaturføler Uteluft', 3.5), P('g', 'A_360_001_JV40 _JV_AU', 'Frekvensomformer Tilluftsvifte - viftepådrag', 'analog-output', 55, 'percent'),"
              "    P('h', 'A_360_001_JV50 _JV_AU', 'Frekvensomformer Avtrekksvifte - viftepådrag', 'analog-output', 40, 'percent'),"
              "    P('i', 'A_310_001_SM001_Err', 'Serviceventil stengt sprinkler', 'binary-input', 'active'),"
              "    T1('j', 'A_320_012_RT41', 'Temperaturføler Tur hovedstokk', 75)]);"
              "  const v = s.find(x => x.type === 'ventilasjon'), spr = s.find(x => x.type === 'sprinkler');"
              "  const st = nabeSkjema.stasjoner(v.komp), av = (kd) => st.get(v.komp.find(k => k.kode === kd));"
              "  const svg = nabeSkjema.tegnAggregat(v).svg;"
              "  return av('RT40') === 'inntak' && av('RT41') === 'etter' && av('RT43') === 'tilluft' && av('RT50') === 'avkast' && av('RT52') === 'avtrekk'"
              "    && !!spr && spr.komp.every(k => k.art === 'stengeventil') && !s.some(x => x.type === 'varme' && x.komp.some(k => k.art === 'stengeventil')) && svg.includes('RT901') && svg.includes('JV50'); })(),"
              " skjema3: (() => { const a = nabeSkjema.tolkNavn('+KG32=350 002-RT401_Sp'), b = nabeSkjema.tolkNavn('OU601.613.-RT601'), c = nabeSkjema.tolkNavn('350002-RP401_Err'),"
              "    d = nabeSkjema.tolkPunkt({objid: 'x', name: 'BDInlet', description: 'Outdoor damper', type: 'analog-output', value: 10, units: 'percent'}),"
              "    e = nabeSkjema.tolkPunkt({objid: 'y', name: 'SupTemp', description: '', type: 'analog-input', value: 19, units: 'degrees-celsius'});"
              "  return a.sys === '350.002' && a.kode === 'RT401' && b.sys === '601' && b.rom === '613' && c.sys === '350.002' && c.kode === 'RP401' && e.sted === 'tilluft' && e.art === 'temp' && !!d"
              "    && nabeSkjema.tolkPunkt({objid: 'z', name: 'Supply air temperature', description: 'min:-50.0, max:+120.0, error: -32768', type: 'analog-input', value: 16.6, units: 'degrees-celsius'}).rolle === 'pv'"
              "    && nabeSkjema.tolkPunkt({objid: 'w', name: 'Water temperature', description: 'min:-50.0, max:+120.0, error: -32768', type: 'analog-input', value: 13, units: 'degrees-celsius'}).sted === 'batteriretur'"
              "    && (q => q.rom === '338' && q.kode === 'RT600')(nabeSkjema.tolkNavn('Drivers.Modbus_3_1.S563.R_338.points.RT600'))"
              "    && nabeSkjema.tolkPunkt({objid: 'r', name: 'Drivers.Modbus_3_1.S563.R_338.points.SB400_P', description: '', type: 'analog-input', value: 40, units: 'percent'}).rolle === 'paadrag'"
              "    && nabeSkjema.tolkPunkt({objid: 'h', name: 'El. Heater level', description: 'El. Heater level', type: 'analog-output', value: 0, units: 'percent'}).hvor === 'ettervarme'"
              "    && nabeSkjema.byggSystemer([{objid: 'o', name: 'OWA_DV_MC2_Percent_Set', description: 'External override activate, Miru 3 fan level', type: 'binary-value', value: 'inactive'}]).every(s => !s.komp.size)"
              "    && (q => q.rom === '02.85' && q.rolle === 'paadrag' && q.art === 'vav')(nabeSkjema.tolkPunkt({objid: 'v', name: 'pMpBus.MP_BUS_1.POS[1]', description: 'SD0T SQ401-02.85 Spjeldposisjon', type: 'analog-value', value: 90, units: 'degrees-celsius'}))"
              "    && nabeSkjema.byggSystemer([{objid: 'u', name: 'A_320_012_Utekomp_Y1', description: 'Y1', type: 'analog-value', value: 80, units: 'degrees-celsius'}]).every(s => !s.komp.size)"
              "    && nabeSkjema.byggSystemer([{objid: 'm', name: 'Supply air mode', description: '0-m3/h, 1-l/s, 3-Pa', type: 'analog-value', value: 3, units: 'pascals'}]).every(s => !s.komp.size); })(),"
              " knxrom: (() => { const P = (n, v, u, t) => ({objid: n, name: n, description: '', type: t || 'analog-value', value: v, units: u || ''});"
              "  const sys = nabeSkjema.byggSystemer([P('563.9-303-RT601 Er-temperatur SDw', 21.5, 'degrees-celsius'), P('563.9-303-RT601 AKT SP temperatur SDw', 21, 'degrees-celsius'),"
              "    P('563.9-303-RT601 HtrGn SDw', 40, 'percent'), P('563.9-303-RB601 Er-lux ML', 300, 'lux'), P('563.9-303/304-RT601 Er-temperatur SDw', 20, 'degrees-celsius'),"
              "    P('563.9-99999-RT601 Er-temperatur SDw', 19, 'degrees-celsius')]);"
              "  const rom = sys.flatMap(s => [...s.romData.values()]), r = rom.find(x => x.rom === '303');"
              "  return !!r && r.sys === '563.9' && r.temp.value === 21.5 && r.tempSp.value === 21 && r.varme.value === 40 && r.lux.value === 300 && rom.some(x => x.rom === '303/304') && rom.length === 2; })(),"
              " kurs: (() => { const P = (n, d, v, u, t) => ({objid: n, name: n, description: d, type: t || 'analog-input', value: v, units: u || ''});"
              "  const sys = nabeSkjema.byggSystemer([P('320.001-RT401', 'Temperaturføler Tur hovedstokk', 70, 'degrees-celsius'), P('320.001-RT501', 'Temperaturføler Retur hovedstokk', 50, 'degrees-celsius'),"
              "    P('320.001-RT405', 'Hysterese start el.kjele vinter', 5, 'degrees-celsius'), P('320.001-JP401', 'Sirkulasjonspumpe hovedstokk', 1, '', 'binary-input'),"
              "    P('320.001-JP402', 'Settpunkt varmepumpe', 1, '', 'binary-input'), P('320.001-SB501', '1=Av 2=Manuell 3=Auto', 3, '', 'analog-value'), P('320.001-SB502', 'Ventilmotor hovedstokk', 40, 'percent', 'analog-output')]);"
              "  const svg = nabeSkjema.tegnKurser(sys.filter(x => x.type === 'varme'), 'varme').svg;"
              "  return /RT401/.test(svg) && !/RT405/.test(svg) && !/SB501/.test(svg) && /SB502/.test(svg) && !/JP402/.test(svg); })(),"
              " veksler: (() => { const a = nabeSkjema.tegnAggregat; return typeof a === 'function'; })(),"
              " protokoller: typeof skannProtokoller === 'function' && !!document.getElementById('scanMeny'),"
              " klassifisering: (() => { const a = gruppeFor({address: '1.1.1.1', object_name: 'ECY-S1000', vendor_name: '', vendor_id: 0}).label,"
              "   b = gruppeFor({address: '1.1.1.2', object_name: '564001-OU001', vendor_name: 'Tridium', vendor_id: 36, web_vendor: 'WAGO'}).label,"
              "   c = gruppeFor({address: '1.1.1.3', object_name: 'Beckhoff_0', vendor_name: 'Beckhoff Automation', vendor_id: 15}).label;"
              "  return a === 'Distech' && b === 'WAGO' && c === 'Beckhoff'; })(),"
              " knxrom2: (() => { const P = (n, v, t) => ({objid: n, name: n, description: '', type: t || 'analog-value', value: v, units: '', knx: {ga: 'x'}});"
              "  const s = nabeSkjema.byggSystemer([P('01-212 VAV status % Tilluft', 40), P('01-212 lys bevegelse SD', 'active', 'binary-value'), P('Ukjent navn uten rom', 1), P('Vifte 1 status', 1)]);"
              "  const r = s.flatMap(x => [...x.romData.values()]).find(x => x.rom === '212');"
              "  return !!r && !!r.luft && !!r.bevegelse && s.every(x => x.komp.length === 0 && x.type !== 'ventilasjon'); })(),"
              " modbus: typeof aapneModbus === 'function' && !!document.getElementById('modbusBtn'),"
              " bussfilter: typeof alderTekst === 'function' && S.filters.medVerdi === false && !!document.getElementById('fMedVerdi') && /min/.test(alderTekst(Date.now() / 1000 - 300)),"
              " knx: typeof aapneKnx === 'function' && !!document.getElementById('knxBtn'),"
              " flater: typeof aapneOversikt === 'function' &&!!document.getElementById('listeSmalBtn') && !!document.getElementById('oversiktBtn') && (() => {"
              "  const P = (o, n, d, t, v, u) => ({objid: o, name: n, description: d, type: t, value: v, units: u || ''});"
              "  const s = nabeSkjema.byggSystemer([P('ai,1', 'A_320_031_A109_RT603_PV', 'SD2T Romtemperatur', 'analog-input', 21.7, 'degrees-celsius'),"
              "    P('av,1', 'A_320_031_A109_RT603_SP', 'SD0T Settpunkt dag', 'analog-value', 21, 'degrees-celsius'),"
              "    P('av,2', 'A_320_031_A109_RT603_SPK', 'SD0T Arbeidende settpunkt', 'analog-value', 20, 'degrees-celsius'),"
              "    P('ao,1', 'A_320_031_A109_SB15 _C', 'SD0T Varmepådrag', 'analog-output', 80, 'percent'),"
              "    P('av,3', 'A_320_031_A109_Avvik', 'Avvik', 'analog-value', 0.7, 'degrees-celsius')]);"
              "  const r = s[0] && s[0].romData.get('A109');"
              "  return !!r && r.temp.value === 21.7 && r.tempSp.value === 20 && r.varme.value === 80 && nabeSkjema.romHtml([r]).includes('A109'); })(),"
              " skjema: typeof aapneSkjema === 'function' && typeof aapneValg === 'function' && (() => {"
              "  const P = (o, n, d, t, v, u) => ({objid: o, name: n, description: d, type: t, value: v, units: u || ''});"
              "  const s = nabeSkjema.byggSystemer([P('ai,1', 'A_360_001_RT43', 'SD2T Temperaturføler Tilluft', 'analog-input', 20.4, 'degrees-celsius'),"
              "    P('ai,2', 'A_360_001_RT40', 'SD2T Temperaturføler Inntak', 'analog-input', 3.7, 'degrees-celsius'),"
              "    P('ao,1', 'A_360_001_JV40 _JV_AU', 'SD0T Frekvensomformer Tilluftsvifte - viftepådrag', 'analog-output', 55, 'percent'),"
              "    P('bo,1', 'A_360_001_JV40 _Start', 'SD0T Frekvensomformer Tilluftsvifte - Start', 'binary-output', 'active'),"
              "    P('av,1', 'A_360_001_IV001_AktSpTill', 'SD0T Blokk A - tilluftstemperatur', 'analog-value', 19, 'degrees-celsius'),"
              "    P('ai,3', 'A_320_012_RT41', 'SD2T Temperaturføler Tur hovedstokk', 'analog-input', 75, 'degrees-celsius'),"
              "    P('bo,2', 'A_320_012_JP40 _Start', 'SD0T Sirkulasjonspumpe - Start', 'binary-output', 'active')]);"
              "  const v = s.find(x => x.id === '360.001'), h = s.find(x => x.id === '320.012');"
              "  const rt = v && v.komp.find(k => k.kode === 'RT43'), jv = v && v.komp.find(k => k.kode === 'JV40');"
              "  const n = nabeSkjema.tolkNavn('564001-OS001/FCB.320002.320002.320_002-RT400_SP');"
              "  const c = nabeSkjema.tolkPunkt(P('av,9', 'SupplyAirTemp', 'Supply air temperature', 'analog-value', 19.8, 'degrees-celsius'));"
              "  return !!v && v.type === 'ventilasjon' && !!h && h.type === 'varme' && rt.sted === 'tilluft' && rt.pkt.sp.value === 19"
              "    && jv.art === 'vifte' && jv.pkt.paadrag.value === 55 && n.sys === '320.002' && n.kode === 'RT400' && n.hale === 'SP'"
              "    && c.art === 'temp' && c.sted === 'tilluft' && c.rolle === 'pv' && nabeSkjema.tegnAggregat(v).svg.includes('RT43'); })(),"
              " anleggsrad: typeof bareDetteAnlegget === 'function',"
              " kort: typeof flereKortIBruk === 'function' && typeof anKompakt === 'function',"
              " ukeprogram: typeof urEnheter === 'function' && typeof urLesAlle === 'function' && !!document.getElementById('anStatusBtn')"
              "  && cmpAdr('10.0.0.9', '10.0.0.10') < 0 && cmpAdr('10.0.1.1', '10.0.0.200') > 0,"
              " dialoger: !!window.nabeDialoger && nabeDialoger.antall() > 600 && PLAGG.length >= 55 && !!PLAGG_REPLIKK.sydvest"
              "  && Object.values(DIA_INNHOLD).every(d => d.l.every(x => String(JSON.stringify(x)).includes(' | '))),"
              " co2grense: (() => { const mk = (v, i) => ({a: [{objid: 'ai,' + i, name: 'CO2_PV', units: 'parts-per-million', value: v}, {objid: 'av,' + i, name: 'CO2_SP', units: 'parts-per-million', value: 700}]});"
              "  return settpunktAvvik(mk(420, 91)).length === 0 && settpunktAvvik(mk(800, 92)).length === 1 && schedDag(0) === T('man', 'Mon'); })(),"
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
              "    && !r.some(x => x.p.name.startsWith('Dup')); })(),"
              " service: typeof aapneForslag === 'function' && !!document.getElementById('forslagBtn') && (() => {"
              "  const d = (a, n) => ({address: a, object_name: n, device_instance: 1});"
              "  const pt = (n, s) => ({objid: 'ai,' + n, name: 'P' + n, status: s});"
              "  const devs = [d('10.0.0.1', 'A'), d('10.0.0.2', 'B'), d('10.0.0.3', 'X'), d('10.0.0.4', 'X'), d('10.0.0.5', 'X')];"
              "  const cache = {'10.0.0.1': [1, 2, 3, 4, 5].map(i => pt(i, ['fault'])), '10.0.0.2': [pt(1, ['fault']), pt(2, []), pt(3, ['overridden']), pt(4, [])]};"
              "  const r = bygForslag({devices: devs, cache, failed: new Set(['10.0.0.5']), varsler: [], avvik: []});"
              "  const ids = r.liste.map(p => p.id).join();"
              "  const tom = bygForslag({devices: [], cache: {}, failed: new Set(), varsler: [], avvik: []});"
              "  return ids === 'feil-enhet,feil-punkt,lesefeil,overstyrt,navn' && r.lest === 2 && r.totalt === 5 && tom.liste.length === 0"
              "    && r.liste[0].rader[0].ip === '10.0.0.1'; })()," + NYE_RYKTEST + "})"}})
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


def tilkobling():
    """Reconnecting binds every adapter in use again, as it was, and the known devices
    can be asked directly whether they answer."""
    for_ = kall("/api/status")
    # A page that points its own domain name at 127.0.0.1 is stopped on the Host header.
    def med_vert(vert):
        req = urllib.request.Request(BASE + "/api/status", headers={"Host": vert})
        try:
            with urllib.request.urlopen(req, timeout=5) as rr:
                return rr.status
        except urllib.error.HTTPError as e:
            return e.code
    sjekk("fremmed vertsnavn avvises, adresse og localhost slipper inn",
          med_vert(f"ond.example:{PORT}") == 403 and med_vert(f"localhost:{PORT}") == 200
          and med_vert(f"127.0.0.1:{PORT}") == 200)
    # A visit is kept, and a second one within the hour replaces it rather than becoming "last time".
    sjekk("vanlig utgave er ikke Mini, og KI-status sier det samme",
          kall("/api/status").get("mini") is False and kall("/api/ki").get("mini") is False)
    pp = kall("/api/port", {"port": 80})
    sjekk("portbytte avviser en umulig port, og status sier hvilken port som brukes",
          pp.get("status") == "error" and isinstance(kall("/api/status").get("bacnet_port"), int))
    b1 = kall("/api/besok", {"key": "selvtest 127.0.0.0/8", "data": {"enheter": {"127.0.0.2": {"n": "X", "p": {}}}}})
    b2 = kall("/api/besok", {"key": "selvtest 127.0.0.0/8", "data": {"enheter": {}}})
    b3 = kall("/api/besok", {"key": "", "data": {"enheter": {}}})
    sjekk("besøk lagres, samme time er samme besøk, tom nøkkel avvises",
          b1.get("status") == "done" and b1.get("forrige") is None and b2.get("antall") == 1
          and b2.get("forrige") is None and b3.get("status") == "error", f"{b1.get('status')} {b2.get('antall')} {b3.get('status')}")
    r = kall("/api/reconnect", {})
    sjekk("koble til på nytt: hvert kort i bruk bindes på nytt", r.get("status") == "done" and bool(r.get("kort"))
          and all(k.get("ok") for k in r["kort"]), str(r))
    etter_ = kall("/api/status")
    sjekk("koble til på nytt: samme kort er oppe og hovedkortet er det samme",
          sorted(k["ip"] for k in etter_.get("kort", [])) == sorted(k["ip"] for k in for_.get("kort", []))
          and etter_.get("local_address") == for_.get("local_address"), str(etter_.get("kort")))
    sv = kall("/api/svar", {"adresser": ["127.0.0.2", "127.0.0.3"]})
    sjekk("svarer nå: kjente enheter som svarer blir funnet", sv.get("svar") == {"127.0.0.2": True, "127.0.0.3": True}, str(sv))
    ib = kall("/api/identitet-batch", {"enheter": [{"address": "127.0.0.20", "device_instance": 7001}, {"address": "127.0.0.99", "device_instance": 1}]})
    sjekk("identitet for ukjente enheter: svarer, og en enhet som ikke svarer gir ikke feil",
          ib.get("status") == "done" and isinstance(ib.get("identitet"), dict) and "127.0.0.99" not in ib["identitet"], str(ib))


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
    sjekk("oppdatering: jobben melder hvor langt nedlastingen har kommet", "gjort" in s.get("jobb", {}) and "total" in s.get("jobb", {}), str(s.get("jobb")))
    sjekk("oppdatering: å starte i en kopi som ikke er installert gir en forklaring", kall("/api/oppdater", {}).get("status") == "error")

    # The installer waits for NABE to close, and does not install over one that is still open.
    if os.name == "nt":
        sys.path.insert(0, str(HER / "installasjon"))
        import installer as inst
        p = subprocess.Popen(["ping", "-n", "4", "127.0.0.1"], stdout=subprocess.DEVNULL)
        apen = inst.vent_paa_prosess(p.pid, 1)
        lukket = inst.vent_paa_prosess(p.pid, 20)
        sjekk("oppdatering: installasjonen venter på at NABE lukkes, og sier fra når den fortsatt er åpen",
              apen is False and lukket is True and inst.vent_paa_prosess(p.pid, 1) is True, f"{apen} {lukket}")


def flagg():
    """A fault says why (the reliability behind it), an alarm says which state and
    value, and flags read again follow what the device says now, never taking a
    flag that could not be read for one that cleared."""
    j = vent_jobb(kall("/api/device/points", {"address": "127.0.0.6", "device_instance": 9004})["job_id"])
    pts = {p["objid"]: p for p in (j.get("result") or {}).get("points", [])}
    f, a = pts.get("analog-input,4", {}), pts.get("binary-input,5", {})
    sjekk("flagg: en fault får årsaken fra enhetens reliability",
          f.get("status") == ["fault"] and f.get("reliability") == "no-sensor", str(f)[:160])
    sjekk("flagg: en alarm får tilstand og alarmverdi fra enheten",
          a.get("status") == ["in-alarm"] and a.get("event_state") == "offnormal" and a.get("alarm_value") == "active", str(a)[:160])
    ok = pts.get("analog-input,1", {})
    sjekk("flagg: et punkt uten flagg får ingen årsak", ok.get("status") == [] and "reliability" not in ok, str(ok)[:120])

    ider = ["analog-input,4", "binary-input,5", "analog-input,1"]
    r = kall("/api/device/flagg", {"address": "127.0.0.6", "objids": ider}).get("flagg", {})
    sjekk("flagg: lest på nytt gir flagg og årsak",
          r.get("analog-input,4", {}).get("status") == ["fault"] and r["analog-input,4"].get("reliability") == "no-sensor"
          and r.get("binary-input,5", {}).get("status") == ["in-alarm"] and r.get("analog-input,1", {}).get("status") == []
          and all(x.get("lest") for x in r.values()), str(r)[:200])

    obj = APPS["127.0.0.6"].get_object_name("SIM-AVVIK_FEIL")
    i_loop(lambda: (setattr(obj, "statusFlags", [0, 0, 0, 0]), setattr(obj, "reliability", "noFaultDetected")))
    r = kall("/api/device/flagg", {"address": "127.0.0.6", "objids": ["analog-input,4"]}).get("flagg", {})
    sjekk("flagg: når enheten fjerner feilen, forsvinner den ved neste lesing",
          r.get("analog-input,4", {}).get("status") == [] and r["analog-input,4"].get("lest") is True, str(r))
    i_loop(lambda: (setattr(obj, "statusFlags", [0, 1, 0, 0]), setattr(obj, "reliability", "noSensor")))


def mine_uten_kontakt():
    """An override on a device that does not answer is not something to be stopped
    at the door for: it waits for the next visit. One that answers still is."""
    for adr in ("127.0.0.4", "127.0.0.6"):
        kall("/api/write", {"address": adr, "objid": "analog-value,1", "value": 22.0, "priority": 7})

    def liste():
        return {o["address"]: o["naabar"] for o in kall("/api/mine?fersk=1").get("overstyrt", [])
                if o["address"] in ("127.0.0.4", "127.0.0.6") and o["priority"] == 7}

    for _ in range(3):
        for adr in ("127.0.0.4", "127.0.0.6"):
            kall("/api/write", {"address": adr, "objid": "analog-value,1", "value": 22.0, "priority": 7})
    for_ = liste()
    sjekk("overstyring: enheter som svarer regnes som innen rekkevidde",
          for_ == {"127.0.0.4": True, "127.0.0.6": True}, str(for_))
    # The device on .6 goes quiet, as a rig that is switched off does.
    i_loop(lambda: APPS["127.0.0.6"].close())
    etter_ = liste()
    sjekk("overstyring: en enhet som ikke svarer er utenfor rekkevidde, de andre er det ikke",
          etter_ == {"127.0.0.4": True, "127.0.0.6": False}, str(etter_))
    for adr in ("127.0.0.4",):
        kall("/api/write", {"address": adr, "objid": "analog-value,1", "priority": 7, "release": True})


def vakt():
    """The pinned points are recorded in the background, and what was recorded can
    be looked at: the numbers, a file, and the hunting detector, which also says
    when the swing began."""
    punkter = [{"address": "127.0.0.6", "objid": "analog-input,2", "navn": "360.003-RT402", "enhet": "°C"},
               {"address": "127.0.0.6", "objid": "analog-input,3", "navn": "360.003-SB402", "enhet": "%"},
               {"address": "127.0.0.6", "objid": "analog-input,1", "navn": "VAKT-FLAT", "enhet": "°C"},
               {"address": "127.0.0.6", "objid": "binary-input,6", "navn": "SIM-PUMPE", "enhet": ""}]
    # A limit on the swinging point: it is above 21.0 for two and a half seconds in every five
    punkter[0]["hoy"] = 21.0
    r = kall("/api/vakt/sett", {"punkter": punkter})
    sjekk("opptak bakover: festede punkter følges", r.get("punkter") == 4, str(r))
    # The same pump recorded to a file, for the count of starts from a recording
    opp = kall("/api/opptak/start", {"punkter": [{"address": "127.0.0.6", "objid": "binary-input,6", "navn": "SIM-PUMPE"}], "intervall": 1})
    time.sleep(32)
    kall("/api/opptak/stopp", {})
    st = kall("/api/vakt")
    sjekk("opptak bakover: punktene leses i bakgrunnen uten at noe annet pågår",
          st.get("aktiv") and st.get("punkter") == 4 and st.get("eldste") is not None, str(st))
    se = kall("/api/vakt/serier", {"minutter": 5})
    n = {s["navn"]: len(s["t"]) for s in se.get("serier", [])}
    sjekk("opptak bakover: det er målinger å se tilbake på", len(n) == 4 and all(v >= 15 for v in n.values()), str(n))
    syk = kall("/api/vakt/sykluser", {}).get("sykluser", [])
    pumpe = next((x for x in syk if x["objid"] == "binary-input,6"), {})
    sjekk("starter per time: en pumpe som starter hvert sjette sekund er funnet, med tall",
          pumpe.get("dom") == "mange" and pumpe.get("per_time", 0) > 300 and 2 <= (pumpe.get("snitt_pa_s") or 0) <= 4 and pumpe.get("starter", 0) >= 3, str(pumpe))
    sjekk("starter per time: et punkt som ikke er av og på er ikke med", all(x["objid"] == "binary-input,6" for x in syk), str(syk))
    sjekk("starter per time: kommer også i statuslista", any(x["objid"] == "binary-input,6" for x in kall("/api/vakt").get("sykluser", [])))
    st2 = kall("/api/vakt")
    ev = st2.get("hendelser", [])
    typer = [e["type"] for e in ev if e["objid"] == "analog-input,2"]
    sjekk("grenser: et punkt som går over grensen gir en hendelse med verdi og grense", "over" in typer and st2.get("grenser") == 1
          and all(e["grense"] == 21.0 and e["verdi"] > 21.0 for e in ev if e["type"] == "over"), str(ev[:3]))
    sjekk("grenser: og når det kommer tilbake sies det", "tilbake" in typer, str(typer))
    sjekk("grenser: bare punktet med grense gir hendelser", {e["objid"] for e in ev} == {"analog-input,2"}, str({e["objid"] for e in ev}))
    pe2 = kall("/api/pendling", {"paa_av": {"P": {"t": [i * 10.0 for i in range(180)], "v": [1.0 if (i * 10) % 300 < 120 else 0.0 for i in range(180)]},
                                              "R": {"t": [i * 10.0 for i in range(180)], "v": [1.0 if i > 90 else 0.0 for i in range(180)]}}})
    sjekk("starter per time: pendling-kallet teller også på/av-serier uten fil",
          [x["navn"] for x in pe2.get("sykluser", [])] == ["P"] and pe2["sykluser"][0]["dom"] == "mange", str(pe2.get("sykluser")))
    logg = {"L": {"t": [0, 10, 20, 30, 40, 50, 9000, 9010, 18000], "v": [1, 1, 1, 1, 1, 0, 1, 1, 0]}}
    lt = kall("/api/pendling", {"paa_av": logg, "trinn": True, "alle": True}).get("sykluser", [{}])[0]
    ln = kall("/api/pendling", {"paa_av": logg, "alle": True}).get("sykluser", [{}])[0]
    sjekk("starter per time: en trendlogg som bare skriver ved endring telles som trinn, ikke som hull",
          lt.get("starter") == 1 and lt.get("dom") == "ok" and 0.15 <= (lt.get("per_time") or 0) <= 0.25 and ln.get("starter") == 0, f"{lt} / {ln}")
    pf = kall("/api/pendling", {})
    sjekk("starter per time: fra et opptak med på/av-kolonne", any("PUMPE" in x["navn"] and x["dom"] == "mange" for x in pf.get("sykluser", [])), str(pf)[:300])
    stp = kall("/api/stotte", {"med": ["enheter", "forslag", "trafikk", "rutere", "innstillinger"], "enheter": "adresse;navn\\r\\n10.0.0.1;A", "forslag": "x",
                               "rutere": [], "klient": {"spraak": "nb", "x": {"a": 1}}, "merknad": "Pumpa går hele tiden"})
    import zipfile as _zf
    navn_zip = _zf.ZipFile(stp["fil"]).namelist() if stp.get("status") == "done" and Path(stp["fil"]).is_file() else []
    sjekk("støttepakke: lages som én fil med det som er valgt, og ikke mer",
          sorted(navn_zip) == sorted(["LESMEG.txt", "info.json", "merknad.txt", "enheter.csv", "forslag.txt", "trafikk.csv", "rutere.json", "innstillinger.json"]), str(navn_zip))
    sjekk("støttepakke: trafikkloggen fra denne økta er med", len(_zf.ZipFile(stp["fil"]).read("trafikk.csv").decode("utf-8").splitlines()) > 5 if navn_zip else False)
    sjekk("støttepakke: innstillinger har bare enkle verdier", json.loads(_zf.ZipFile(stp["fil"]).read("innstillinger.json")) == {"spraak": "nb"} if navn_zip else False)
    pe = kall("/api/vakt/pendling", {"minutter": 5})
    ser = {x["navn"]: x for x in pe.get("serier", [])}
    rt, flat = ser.get("360.003-RT402 (°C)", {}), ser.get("VAKT-FLAT (°C)", {})
    sjekk("opptak bakover: pendlingen finnes i ettertid, med periode og når den begynte",
          rt.get("dom") == "pendler" and abs((rt.get("periode_s") or 0) - 5) <= 1.5
          and 0 < (rt.get("siden_s") or 0) <= 40 and bool(rt.get("siden_t")), str(rt))
    sjekk("opptak bakover: RT og SB blir en sløyfe som pendler", [p["dom"] for p in pe.get("par", [])] == ["sloyfe"], str(pe.get("par")))
    sjekk("opptak bakover: et punkt som ikke beveger seg pendler ikke", flat.get("dom") == "nei", str(flat))
    ek = kall("/api/vakt/eksport", {"minutter": 5})
    linjer = Path(ek.get("fil", "x")).read_text(encoding="utf-8-sig").splitlines() if ek.get("status") == "done" else []
    sjekk("opptak bakover: kan åpnes som CSV, i samme format som et opptak",
          len(linjer) >= 20 and linjer[0].startswith("Time;") or (len(linjer) >= 20 and linjer[0].startswith("Tid;")), str(linjer[:2]))
    lagret = kall("/api/vakt/lagre", {}).get("lagret")
    sjekk("opptak bakover: lagres, så en omstart ikke tømmer det", bool(lagret) and kall("/api/vakt").get("lagret"), str(lagret))
    kall("/api/vakt/sett", {"punkter": []})
    sjekk("opptak bakover: tas et punkt av lista, slutter det", kall("/api/vakt").get("punkter") == 0)


def modbus():
    """Modbus TCP, read only: found, named by a register map, polled, and never written to."""
    import nabe_modbus as nm
    port = MBSIM.port
    j = vent_jobb(kall("/api/modbus/scan", {"subnet": "127.0.0.1", "port": port, "units": [1, 2, 9]})["job_id"])
    devs = (j.get("result") or {}).get("devices", [])
    adr = {d["unit"]: d["address"] for d in devs}
    sjekk("modbus: skann finner to enheter og tar ikke gatewayens «ingen enhet» for en enhet",
          sorted(adr) == [1, 2] and all(a.startswith("mb:127.0.0.1:") for a in adr.values()), str(sorted(adr)))
    sjekk("modbus: enheten får navn fra identifikasjonen", any("Room controller" in d["object_name"] for d in devs),
          str([d["object_name"] for d in devs]))

    p = vent_jobb(kall("/api/device/points", {"address": adr[1], "device_instance": 1})["job_id"])
    r = p.get("result") or {}
    sjekk("modbus: uten registerkart vises registrene som de er", r.get("modbus", {}).get("raw") is True and r.get("count") == 6,
          f"{r.get('count')} punkter")

    feil = kall("/api/modbus/kart", {"navn": "feil", "tekst": "address,function\nabc,holding\n"})
    sjekk("modbus: et ødelagt registerkart sier hvilken rad som er feil", feil.get("status") == "error" and "row 1" in feil.get("error", ""), str(feil))
    csv = ("address;function;type;name;scale;unit;description;bit\n0;holding;s16;Temperatur;0,1;°C;Romtemperatur;\n"
           "1;holding;s16;Settpunkt;0,1;°C;Settpunkt rom;\n3;holding;u16;Drift;;;Drift;0\n0;coil;bool;Rele1;;;Relé 1;\n")
    k = kall("/api/modbus/kart", {"navn": "Romregulator", "tekst": csv})
    sjekk("modbus: registerkart importeres", k.get("status") == "done" and k.get("punkter") == 4, str(k))
    kall("/api/modbus/tilordne", {"address": adr[1], "kart": k["id"]})
    p = vent_jobb(kall("/api/device/points", {"address": adr[1], "device_instance": 1})["job_id"])
    pts = {x["name"]: x for x in (p.get("result") or {}).get("points", [])}
    sjekk("modbus: registerkartet gir navn, skalering og enhet", abs((pts.get("Temperatur") or {}).get("value", 0) - 21.0) < 1.2
          and pts["Temperatur"]["units"] == "degrees-celsius" and pts["Drift"]["value"] == "active" and pts["Rele1"]["value"] == "active",
          str({n: x["value"] for n, x in pts.items()}))
    sjekk("modbus: punktene har BACnet-form, så tabellen kan vise dem", pts["Temperatur"]["objid"].startswith("analog-value,")
          and pts["Temperatur"]["writable"] is False and "modbus" in pts["Temperatur"])

    obj = [x["objid"] for x in pts.values()]
    po = kall("/api/poll", {"targets": {adr[1]: obj}})
    sjekk("modbus: live-lesing gir verdier for punktene", set(po["values"].get(adr[1], {})) == set(obj), str(po["values"].get(adr[1])))
    d = kall("/api/object/detail", {"address": adr[1], "objid": pts["Temperatur"]["objid"]})
    sjekk("modbus: detaljer sier funksjon og skalering", d.get("properties", {}).get("modbus-function") == "holding"
          and d["properties"].get("scale") == 0.1, str(d.get("properties")))

    s = kall("/api/device/schedules", {"address": adr[1], "device_instance": 1})
    w = kall("/api/write", {"address": adr[1], "objid": pts["Temperatur"]["objid"], "value": 5})
    sjekk("modbus: BACnet-funksjoner svarer tydelig, og ingenting skrives", s.get("status") == "error" and w.get("status") == "error"
          and "BACnet" in w.get("error", "") and MBSIM.writes_received == [], str(MBSIM.writes_received))

    # the pieces, with no server
    def punkt(**kv):
        return nm.normalise_point(dict({"function": "holding", "address": 0, "type": "u16"}, **kv))
    fl = __import__("struct").unpack("!2H", __import__("struct").pack("!f", 12.5))
    sjekk("modbus: flyttall leses i alle fire ordrekkefølger",
          nm.decode_value(punkt(type="f32", order="ABCD"), [fl[0], fl[1]]) == 12.5
          and nm.decode_value(punkt(type="f32", order="CDAB"), [fl[1], fl[0]]) == 12.5
          and nm.decode_value(punkt(type="f32", order="BADC"), [int.from_bytes(fl[0].to_bytes(2, "big")[::-1], "big"), int.from_bytes(fl[1].to_bytes(2, "big")[::-1], "big")]) == 12.5
          and nm.decode_value(punkt(type="f32", order="DCBA"), [int.from_bytes(fl[1].to_bytes(2, "big")[::-1], "big"), int.from_bytes(fl[0].to_bytes(2, "big")[::-1], "big")]) == 12.5)
    sjekk("modbus: fortegn, 32 bit og skalering",
          nm.decode_value(punkt(type="s16"), [0xFFFF]) == -1 and nm.decode_value(punkt(type="u32"), [1, 0]) == 65536
          and nm.decode_value(punkt(type="s16", scale=0.1), [215]) == 21.5)
    bl = nm.blocks([punkt(address=a) for a in (0, 2, 40)])
    sjekk("modbus: små hull leses gjennom, store gir ny forespørsel", [(b[1], b[2]) for b in bl] == [(0, 3), (40, 1)], str([(b[1], b[2]) for b in bl]))
    try:
        nm.parse_map("address,function,type,name\n0,holding,u16,A\n0,holding,u16,B\n")
        dobbel = False
    except nm.MapError:
        dobbel = True
    sjekk("modbus: samme register to ganger i kartet avvises", dobbel)

    async def skriv():
        c = nm.ModbusClient("127.0.0.1", port, 1.0)
        try:
            for fn in (5, 6, 15, 16):
                try:
                    await c.request(1, bytes([fn, 0, 0, 0, 1]))
                    return False
                except nm.ModbusError:
                    pass
            return True
        finally:
            await c.close()
    sjekk("modbus: klienten kan ikke sende en skrivefunksjon", asyncio.run(skriv()) and MBSIM.writes_received == [])


def knx():
    """KNX, read only: found, named by an ETS list, heard on the bus, asked once, and never written to."""
    import base64
    import io
    import struct
    import zipfile
    import nabe_knx as nk
    import nabe_knx_sim as ks
    j = vent_jobb(kall("/api/knx/scan", {"subnet": "127.0.0.1", "port": KXSIM.port, "timeout": 1.5})["job_id"])
    devs = (j.get("result") or {}).get("devices", [])
    sjekk("knx: skann finner gatewayen med navn og tunnel", len(devs) == 1 and devs[0]["address"].startswith("kx:127.0.0.1:")
          and devs[0]["tunnelling"] and not devs[0]["secure"], str([(d["object_name"], d["tunnelling"]) for d in devs]))
    adr = devs[0]["address"]
    k = kall("/api/knx/lister", {"navn": "Rom 101", "innhold": base64.b64encode(ks.DEMO_CSV.encode()).decode(), "filnavn": "ets.csv"})
    sjekk("knx: ETS-liste importeres", k.get("status") == "done" and k.get("punkter") == 5, str(k))
    feil = kall("/api/knx/lister", {"navn": "x", "innhold": base64.b64encode(b"foo;bar\n1;2\n").decode()})
    sjekk("knx: en fil uten adressekolonne avvises med forklaring", feil.get("status") == "error" and "address" in feil.get("error", ""), str(feil))
    kall("/api/knx/tilordne", {"address": adr, "liste": k["id"]})
    p = vent_jobb(kall("/api/device/points", {"address": adr, "device_instance": 1})["job_id"], 90)
    pts = {x["name"]: x for x in (p.get("result") or {}).get("points", [])}
    sjekk("knx: gruppeadressene får navn, verdi og enhet fra ETS-lista og bussen",
          abs((pts.get("Rom 101 Temperatur") or {}).get("value", 0) - 21.0) < 1.2 and pts["Rom 101 Temperatur"]["units"] == "degrees-celsius"
          and pts["Rom 101 Lys"]["value"] == "active" and pts["Rom 101 Ventil"]["value"] == 40.0 and pts["Effekt"]["value"] == 1250.5,
          str({n: x["value"] for n, x in pts.items()}))
    sjekk("knx: det som høres på bussen uten å stå i lista vises også", "5/5/5" in pts)
    sjekk("knx: punktene har BACnet-form og er ikke skrivbare", pts["Rom 101 Temperatur"]["writable"] is False
          and pts["Rom 101 Temperatur"]["objid"].startswith("analog-value,") and pts["Rom 101 Lys"]["objid"].startswith("binary-value,"))
    obj = [x["objid"] for x in pts.values()]
    po = kall("/api/poll", {"targets": {adr: obj}})
    sjekk("knx: live-lesing gir de siste verdiene", len(po["values"].get(adr, {})) == len(obj), str(po["values"].get(adr)))
    d = kall("/api/object/detail", {"address": adr, "objid": pts["Rom 101 Temperatur"]["objid"]})
    sjekk("knx: detaljer sier gruppeadresse og datapunkttype", d.get("properties", {}).get("group-address") == "1/1/1"
          and d["properties"].get("datapoint-type") == "9.001", str(d.get("properties")))
    w = kall("/api/write", {"address": adr, "objid": pts["Rom 101 Lys"]["objid"], "value": 0})
    sjekk("knx: BACnet-funksjoner svarer tydelig, og ingenting skrives til bussen", w.get("status") == "error" and "KNX" in w.get("error", "")
          and KXSIM.writes_received == [] and len(KXSIM.reads_received) >= 0, str(KXSIM.writes_received))

    # the pieces, with no server
    sjekk("knx: gruppeadresser leses i tre og to nivåer", nk.parse_ga("1/2/3") == 0x0A03 and nk.ga_text(0x0A03) == "1/2/3"
          and nk.parse_ga("1/515") == (1 << 11 | 515))
    sjekk("knx: temperatur (9.001), prosent (5.001), flyttall (14) og av/på (1) leses",
          nk.decode((9, 1), ks.enc9(21.5), False) == 21.5 and nk.decode((9, 1), ks.enc9(-5.0), False) == -5.0
          and nk.decode((5, 1), bytes([255]), False) == 100.0 and nk.decode((14, 56), struct.pack("!f", 12.5), False) == 12.5
          and nk.decode((1, 1), bytes([1]), True) == "active" and nk.decode((1, 1), bytes([0]), True) == "inactive")
    frame = nk.ldata_read(nk.parse_ga("1/1/1"))
    sjekk("knx: det eneste NABE kan sende er en lesing (APCI 0), og modulen har ingen skrivefunksjon",
          frame[9] == 0x00 and frame[10] == 0x00 and not any(n for n in dir(nk) if "write" in n.lower() and callable(getattr(nk, n))),
          frame.hex())
    xml = ('<KNX xmlns="http://knx.org/xml/project/20"><Project><GroupAddress Id="x" Address="2305" Name="Temp" DatapointType="DPST-9-1"/>'
           '<GroupAddress Id="y" Address="2307" Name="Lys" DatapointType="DPST-1-1"/></Project></KNX>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("P-0001/0.xml", xml)
    prosjekt = nk.parse_group_list(buf.getvalue(), "hus.knxproj")
    sjekk("knx: ETS-prosjektfilen (.knxproj) gir gruppeadresser med navn og type", [(nk.ga_text(p["ga"]), p["name"], p["dpt"]) for p in prosjekt["points"]]
          == [("1/1/1", "Temp", "9.001"), ("1/1/3", "Lys", "1.001")], str(prosjekt["points"]))

    async def tunnel():
        egen = ks.KnxSim(ks.demo_groups())             # NABE's own tunnel to KXSIM is the one it has: this one is ours
        port = await egen.start("127.0.0.1", 0)
        t1 = nk.KnxTunnel("127.0.0.1", port, 1.0)
        await t1.connect()
        t2 = nk.KnxTunnel("127.0.0.1", port, 1.0)
        try:
            await t2.connect()
            full = ""
        except nk.KnxError as e:
            full = str(e)
        await t1.close()
        await egen.stop()
        t3 = nk.KnxTunnel("127.0.0.1", KXSEC.port, 1.0)
        try:
            await t3.connect()
            sikker = ""
        except nk.KnxError as e:
            sikker = str(e)
        return full, sikker
    full, sikker = asyncio.run(tunnel())
    sjekk("knx: en gateway uten ledig tunnel og en som krever KNX Secure sier det i klartekst",
          "no free tunnel" in full and "tunnel of this kind" in sikker, f"{full} / {sikker}")
    sjekk("knx: ingen skriving nådde gatewayen", KXSIM.writes_received == [] and KXSEC.writes_received == [])


def modbus_exol():
    """A Regin EXOL list (what a technician is handed): its own column names, addresses that count from 1, reals that are scaled."""
    import nabe_modbus as nm
    liste = ("Modbus Type;Signal Name;EXOL Type;Modbus Address;Default Value;Function;Description\r\n"
             "Coil;VentSettings.S_Reset;L;1;0;Config;Reset alarms\r\n"
             "Input Registers;VentActual.A_SupplyTemp;R;5;;Ventilation;Supply air temperature\r\n"
             "Input Registers;VentActual.A_UnitMode;X;6;;Ventilation;Unit mode\r\n"
             "Holding Register;VentSettings.S_Setpoint;R;65;21;Ventilation;Supply air setpoint\r\n"
             "Holding Register;VentSettings.S_Delay;I;66;5;Config;Alarm delay\r\n"
             "Input Status Registers;AlaData.Ala_Fire_Status;L;2;;Alarms;Fire alarm\r\n")
    m = nm.parse_map(liste)
    p = {x["name"]: x for x in m["points"]}
    sjekk("modbus: Regin EXOL-liste gjenkjennes, og adresser som teller fra 1 trekkes fra 1",
          m["format"] == "exol" and m["base"] == 1 and p["VentActual.A_SupplyTemp"]["address"] == 4 and p["VentSettings.S_Reset"]["address"] == 0
          and p["AlaData.Ala_Fire_Status"]["function"] == "discrete" and p["AlaData.Ala_Fire_Status"]["address"] == 1, str(m["notes"]))
    sjekk("modbus: EXOL-typene gir bit, heltall, indeks og skalert reelt tall",
          p["VentSettings.S_Reset"]["type"] == "bool" and p["VentSettings.S_Delay"]["scale"] == 1 and p["VentActual.A_UnitMode"]["type"] == "u16"
          and p["VentActual.A_SupplyTemp"]["scale"] == 0.1 and any("antatt" in n for n in m["notes"]))
    m0 = nm.parse_map(liste, base=0, real_scale=1)
    p0 = {x["name"]: x for x in m0["points"]}
    sjekk("modbus: adressebase og skala kan velges", m0["base"] == 0 and p0["VentActual.A_SupplyTemp"]["address"] == 5
          and p0["VentActual.A_SupplyTemp"]["scale"] == 1)
    k = kall("/api/modbus/kart", {"navn": "EXOL", "tekst": liste})
    sjekk("modbus: importen gjennom API-et sier hvilken base den brukte", k.get("status") == "done" and k.get("base") == 1 and k.get("format") == "exol"
          and bool(k.get("merknader")), str(k))


def knx_gjetting():
    """A project with no datapoint types: the type is worked out from the name and the size of the telegram, and said to be a guess."""
    import base64
    import nabe_knx as nk
    sjekk("knx: type gjettes ut fra navn og telegramlengde",
          nk.guess_dpt("Rom 1 Er-temperatur", 2, False) == (9, 1) and nk.guess_dpt("Varmepådrag", 1, False) == (5, 1)
          and nk.guess_dpt("Lys", 1, True) == (1, 1) and nk.guess_dpt("noe uten navn", 2, False) == (0, 0) and nk.guess_dpt("CO2", 2, False) == (9, 8))
    sjekk("knx: klokkeslett og dato leses", nk.decode((10, 1), bytes([0x2C, 30, 15]), False) == "12:30:15"
          and nk.decode((11, 1), bytes([17, 11, 26]), False) == "2026-11-17")
    j = vent_jobb(kall("/api/knx/scan", {"subnet": "127.0.0.1", "port": KXSIM.port, "timeout": 1.5})["job_id"])
    adr = j["result"]["devices"][0]["address"]
    csv = "Group name;Address\r\nRom 101 Temperatur;1/1/1\r\nRom 101 Ventil;2/1/1\r\n"
    k = kall("/api/knx/lister", {"navn": "Uten type", "innhold": base64.b64encode(csv.encode()).decode(), "filnavn": "u.csv"})
    kall("/api/knx/tilordne", {"address": adr, "liste": k["id"]})
    p = vent_jobb(kall("/api/device/points", {"address": adr, "device_instance": 1})["job_id"], 90)
    pts = {x["name"]: x for x in (p.get("result") or {}).get("points", [])}
    sjekk("knx: uten datapunkttype i ETS får punktene verdi og enhet, og beskrivelsen sier at typen er antatt",
          abs((pts.get("Rom 101 Temperatur") or {}).get("value", 0) - 21.0) < 1.2 and pts["Rom 101 Temperatur"]["units"] == "degrees-celsius"
          and pts["Rom 101 Ventil"]["value"] == 40.0 and "antatt" in pts["Rom 101 Temperatur"]["description"] + pts["Rom 101 Ventil"]["description"]
          or "guessed" in pts["Rom 101 Temperatur"]["description"], str({n: (x["value"], x["description"]) for n, x in pts.items() if n.startswith("Rom")}))
    sjekk("knx: ingenting skrevet til bussen", KXSIM.writes_received == [])


def modbus_rtu():
    """Modbus RTU: the bytes of a serial line in a TCP socket (a serial gateway), and the serial port itself, both read only."""
    import nabe_modbus as nm
    sjekk("modbus RTU: CRC-en stemmer med lærebokverdien", nm.crc16(bytes([0x01, 0x03, 0x00, 0x00, 0x00, 0x0A])) == 0xCDC5)
    j = vent_jobb(kall("/api/modbus/scan", {"subnet": "127.0.0.1", "port": MBRTU.port, "units": [1, 2, 9], "framing": "rtu", "timeout": 1.0})["job_id"])
    devs = (j.get("result") or {}).get("devices", [])
    adr = {d["unit"]: d["address"] for d in devs}
    sjekk("modbus RTU: skann over RTU i TCP finner enhetene, og gatewayens «ingen enhet» er ingen enhet",
          sorted(adr) == [1, 2] and all(a.startswith("mr:127.0.0.1:") for a in adr.values()), str(adr))
    sjekk("modbus RTU: enheten identifiserer seg over RTU", any("Room controller" in d["object_name"] and d["detected_via"] == "device_identification" for d in devs),
          str([(d["object_name"], d["detected_via"]) for d in devs]))
    csv = "address;function;type;name;scale\n0;holding;s16;Temperatur;0,1\n1;holding;s16;Settpunkt;0,1\n0;coil;bool;Rele1\n"
    k = kall("/api/modbus/kart", {"navn": "RTU-kart", "tekst": csv})
    kall("/api/modbus/tilordne", {"address": adr[1], "kart": k["id"]})
    p = vent_jobb(kall("/api/device/points", {"address": adr[1], "device_instance": 1})["job_id"])
    pts = {x["name"]: x for x in (p.get("result") or {}).get("points", [])}
    sjekk("modbus RTU: punktene leses med navn og skalering", abs((pts.get("Temperatur") or {}).get("value", 0) - 21.0) < 1.2 and pts["Rele1"]["value"] == "active",
          str({n: x["value"] for n, x in pts.items()}))
    po = kall("/api/poll", {"targets": {adr[1]: [x["objid"] for x in pts.values()]}})
    sjekk("modbus RTU: live-lesing gir verdier", len(po["values"].get(adr[1], {})) == len(pts), str(po["values"].get(adr[1])))

    async def seriell():
        url = f"socket://127.0.0.1:{MBRTU.port}"
        funnet = await nm.scan_serial(url, 19200, "N", 1, [1, 2, 9], 0.8)
        p = nm.parse_any(funnet[0]["address"]) if funnet else None
        c = nm.RtuClient("", 0, 2.0, serial_port=url, baud=19200)
        try:
            m = nm.parse_map("address;function;type;name;scale\n0;holding;s16;T;0,1\n")
            v1 = await nm.read_points(c, 1, m["points"])
            try:
                await c.read_registers(9, "holding", 0, 1)
                unntak = None
            except nm.ModbusException as e:
                unntak = e.code
            v2 = await nm.read_points(c, 1, m["points"])
            try:
                await c.request(1, bytes([6, 0, 0, 0, 1]))
                skrev = True
            except nm.ModbusError:
                skrev = False
        finally:
            await c.close()
        try:
            await nm.scan_serial("COM99", 19200, "N", 1, [1], 0.3)
            ingen = ""
        except nm.ModbusError as e:
            ingen = str(e)
        return funnet, p, v1, v2, unntak, skrev, ingen
    funnet, p, v1, v2, unntak, skrev, ingen = asyncio.run(seriell())
    sjekk("modbus RTU: seriell port (her via en socket-URL) finner enhetene og gir adresse ms:", len(funnet) == 2 and p and p["scheme"] == "ms" and p["unit"] == 1,
          str([d["address"] for d in funnet]))
    sjekk("modbus RTU: seriell lesing overlever en enhet uten svar", len(v1) == 1 and len(v2) == 1 and unntak == 11, f"{v1} {v2} {unntak}")
    sjekk("modbus RTU: en port som ikke finnes sies i klartekst, og ingen skriving sendes", "COM99" in ingen and skrev is False and MBRTU.writes_received == [], ingen[:70])
    sjekk("modbus RTU: serielle adresser kan skilles fra TCP-adresser", [nm.parse_any(a) is not None for a in ("mb:1.2.3.4:502/1", "mr:1.2.3.4:4001/3", "ms:COM3@19200-8N1/5", "xx:1")]
          == [True, True, True, False])
    async def utforsk():
        c = nm.ModbusClient("127.0.0.1", MBSIM.port, 1.0)
        try:
            return await nm.discover(c, 1, 300, budget=400)
        finally:
            await c.close()
    funnet2 = asyncio.run(utforsk())
    per = {}
    for x in funnet2:
        per.setdefault(x["function"], set()).add(x["address"])
    sjekk("modbus: utforsking finner hvilke registre og biter som svarer, og ingenting annet",
          per == {"holding": {0, 1, 2, 3}, "input": {0, 1}, "coil": {0, 1, 2}, "discrete": {0, 1}} and MBSIM.writes_received == [], str({k: sorted(v) for k, v in per.items()}))
    # units from the words of an EXOL list
    liste = ("Modbus Type;Signal Name;EXOL Type;Modbus Address;Default Value;Function;Description\r\n"
             "Input Registers;VentActual.A_AI_SupplyAirTemp;R;293;;Ventilation;Supply air temperature\r\n"
             "Input Registers;VentActual.A_SAFAirFlow;R;360;;Ventilation;Counted air flow m3/h supply air\r\n"
             "Input Registers;VentActual.A_AO_SAF;R;376;;Ventilation;Supply air fan control\r\n"
             "Input Registers;VentActual.A_AI_SAFPressure;R;312;;Ventilation;Supply air fan pressure\r\n"
             "Input Registers;VentActual.A_UnitMode;X;429;;Ventilation;0=Stop, 1=Starting up\r\n")
    pp = {x["name"]: x for x in nm.parse_map(liste)["points"]}
    sjekk("modbus: enheter leses fra beskrivelsene i en liste uten enhetskolonne",
          pp["VentActual.A_AI_SupplyAirTemp"]["unit"] == "°C" and pp["VentActual.A_SAFAirFlow"]["unit"] == "m3/h"
          and pp["VentActual.A_AO_SAF"]["unit"] == "%" and pp["VentActual.A_AI_SAFPressure"]["unit"] == "Pa" and pp["VentActual.A_UnitMode"]["unit"] == "",
          str({n: x["unit"] for n, x in pp.items()}))


def knx_lesefane():
    """The read flag of an ETS project decides which addresses NABE asks: those with it on, never those with it off."""
    import base64
    import io
    import zipfile
    import nabe_knx as nk
    xml = ('<KNX xmlns="http://knx.org/xml/project/20"><Project><Installations>'
           '<GroupAddress Id="P-1-0_GA-1" Address="%d" Name="Av"/><GroupAddress Id="P-1-0_GA-2" Address="%d" Name="Pa"/>'
           '<GroupAddress Id="P-1-0_GA-3" Address="%d" Name="Ukjent"/>'
           '<ComObjectInstanceRef RefId="O-1" ReadFlag="Disabled" Links="GA-1"/><ComObjectInstanceRef RefId="O-2" ReadFlag="Enabled" DatapointType="DPST-9-1" Links="GA-2"/>'
           '<ComObjectInstanceRef RefId="O-3" Links="GA-3"/></Installations></Project></KNX>') % (nk.parse_ga("6/6/6"), nk.parse_ga("6/6/7"), nk.parse_ga("6/6/8"))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("P-0001/0.xml", xml)
    pts = {p["name"]: p for p in nk.parse_group_list(buf.getvalue(), "x.knxproj")["points"]}
    sjekk("knx: lesefanen og datapunkttypen leses fra kommunikasjonsobjektene i ETS-prosjektet",
          pts["Av"].get("leser") is False and pts["Pa"].get("leser") is True and "leser" not in pts["Ukjent"] and pts["Pa"]["dpt"] == "9.001", str(pts))
    j = vent_jobb(kall("/api/knx/scan", {"subnet": "127.0.0.1", "port": KXSIM.port, "timeout": 1.5})["job_id"])
    adr = j["result"]["devices"][0]["address"]
    k = kall("/api/knx/lister", {"navn": "Lesefane", "innhold": base64.b64encode(buf.getvalue()).decode(), "filnavn": "l.knxproj"})
    kall("/api/knx/tilordne", {"address": adr, "liste": k["id"]})
    la = vent_jobb(kall("/api/knx/les-alle", {"address": adr})["job_id"], 60)
    spurt = set(KXSIM.reads_received)
    sjekk("knx: «les alle lesbare» spør de med lesefanen på og hopper over de med den av",
          la.get("status") == "done" and nk.parse_ga("6/6/7") in spurt and nk.parse_ga("6/6/6") not in spurt and la["result"]["lesbare"] == 1, str(la.get("result")))
    p = vent_jobb(kall("/api/device/points", {"address": adr, "device_instance": 1})["job_id"], 90)
    sjekk("knx: lastingen spør heller ikke de med lesefanen av, og ingenting skrives", nk.parse_ga("6/6/6") not in set(KXSIM.reads_received) and KXSIM.writes_received == [])
    sjekk("knx: volumstrøm (14.077) får enhet", nk.point_for(1, "q", (14, 77), value=1.0)["units"] == "cubic-meters-per-second")


def modbus_ledig():
    """A Modbus connection that nobody uses is closed (a gateway has few to give), and opened again when it is needed."""
    j = vent_jobb(kall("/api/modbus/scan", {"subnet": "127.0.0.1", "port": MBSIM.port, "units": [1], "timeout": 1.0})["job_id"])
    adr = j["result"]["devices"][0]["address"]
    kall("/api/modbus/tilordne", {"address": adr, "kart": "Romregulator"})
    obj = ["analog-value,0"]
    kall("/api/poll", {"targets": {adr: obj}})
    aapen1 = MBSIM.connections
    tid = time.time()
    while MBSIM.connections and time.time() - tid < 20:
        time.sleep(0.5)
    sjekk("modbus: en ledig forbindelse lukkes etter en stund", aapen1 >= 1 and MBSIM.connections == 0, f"åpen {aapen1}, lukket etter {time.time() - tid:.1f} s")
    po = kall("/api/poll", {"targets": {adr: obj}})
    sjekk("modbus: forbindelsen åpnes igjen når den trengs", bool(po["values"].get(adr)) and MBSIM.connections >= 1, str(po["values"].get(adr)))
    kall("/api/modbus/koble-fra", {})
    time.sleep(0.5)
    sjekk("modbus: «koble fra» lukker alt", MBSIM.connections == 0)


def knx_monitor():
    """The group monitor, the times of the values and everything the bus has said in a poll."""
    import nabe_knx as nk
    j = vent_jobb(kall("/api/knx/scan", {"subnet": "127.0.0.1", "port": KXSIM.port, "timeout": 1.5})["job_id"])
    adr = j["result"]["devices"][0]["address"]
    kall("/api/knx/tilordne", {"address": adr, "liste": "Rom_101"})
    kall("/api/poll", {"targets": {adr: ["analog-value,%d" % nk.parse_ga("1/1/1")]}})
    time.sleep(2.0)
    m1 = kall("/api/knx/monitor?address=" + adr)
    rader = m1.get("rader", [])
    sjekk("knx: monitoren viser telegrammene med kilde, adresse, ETS-navn og verdi",
          m1.get("status") == "done" and any(r["ga"] == "1/1/1" and r["navn"] == "Rom 101 Temperatur" and r["kilde"] == "1.1.1" and isinstance(r["verdi"], float) for r in rader), str(rader[:2]))
    m2 = kall(f"/api/knx/monitor?address={adr}&etter={m1['seq']}")
    sjekk("knx: monitoren gir bare det som er nytt siden sist", all(r["n"] > m1["seq"] for r in m2.get("rader", [])) and m2["seq"] >= m1["seq"])
    po = kall("/api/poll", {"targets": {adr: ["analog-value,%d" % nk.parse_ga("1/1/1")]}})
    tider = po.get("tider", {}).get(adr, {})
    sjekk("knx: live-lesing sier når hver verdi ble hørt, og gir alt bussen har sagt, ikke bare det som vises",
          len(po["values"].get(adr, {})) >= 3 and "analog-value,%d" % nk.parse_ga("1/1/1") in tider and time.time() - tider["analog-value,%d" % nk.parse_ga("1/1/1")] < 5,
          f"{len(po['values'].get(adr, {}))} verdier, {len(tider)} tider")


def ny_liste():
    """A list imported again under the same name: what differs is said, and the names made by hand stay."""
    import base64
    import nabe_knx as nk
    csv1 = b"Group name;Address\r\nTemp;7/1/1\r\nLys;7/1/2\r\nGammel;7/1/3\r\n"
    csv2 = b"Group name;Address\r\nTemp ny;7/1/1\r\nLys;7/1/2\r\nNy;7/1/4\r\n"
    k1 = kall("/api/knx/lister", {"navn": "Ny liste test", "innhold": base64.b64encode(csv1).decode(), "filnavn": "a.csv"})
    inf = kall("/api/knx/lister/info?id=" + k1["id"])
    sjekk("liste: detaljene sier hvilken fil lista kom fra, hvor den ligger og hvem som bruker den",
          inf.get("status") == "done" and inf["meta"].get("filnavn") == "a.csv" and inf["punkter"] == 3 and inf["sti"].endswith(".json") and "*" in kall("/api/knx/lister")["tilordning"], str(inf)[:200])
    sjekk("liste: første import har ingen sammenligning", k1.get("status") == "done" and k1.get("endringer") is None, str(k1))
    jk = vent_jobb(kall("/api/knx/scan", {"subnet": "127.0.0.1", "port": KXSIM.port, "timeout": 1.5})["job_id"])
    adr = jk["result"]["devices"][0]["address"]
    kall("/api/knx/tilordne", {"address": adr, "liste": k1["id"]})
    kall("/api/knx/punkt", {"address": adr, "objid": "analog-value,%d" % nk.parse_ga("7/1/2"), "felter": {"name": "Min lampe"}})
    k2 = kall("/api/knx/lister", {"navn": "Ny liste test", "innhold": base64.b64encode(csv2).decode(), "filnavn": "b.csv"})
    e = k2.get("endringer") or {}
    sjekk("liste: ny import sier hva som er nytt, omdøpt og borte, og beholder navn gjort for hånd",
          e.get("nye", {}).get("antall") == 1 and e.get("borte", {}).get("antall") == 1 and e.get("omdopt", {}).get("antall") == 1 and e.get("beholdt") == 1, str(k2))
    inn = kall("/api/knx/lister/innhold?id=" + k2["id"])
    sjekk("liste: lista kan hentes ut igjen med endringene", inn.get("status") == "done" and any(p["name"] == "Min lampe" for p in inn.get("punkter", [])), str(inn)[:160])
    mk = kall("/api/modbus/kart", {"navn": "Eksport", "tekst": "address;function;type;name;scale\n0;holding;s16;Temperatur;0,1\n"})
    mi = kall("/api/modbus/kart/innhold?id=" + mk["id"])
    sjekk("liste: registerkartet kan hentes ut igjen", mi.get("status") == "done" and mi["punkter"][0]["name"] == "Temperatur" and abs(mi["punkter"][0]["scale"] - 0.1) < 1e-9, str(mi)[:160])
    pp = vent_jobb(kall("/api/device/points", {"address": adr, "device_instance": 1})["job_id"], 90)
    navn = {x["objid"]: x["name"] for x in pp["result"]["points"]}
    sjekk("liste: det egne navnet ligger i den nye lista", navn.get("analog-value,%d" % nk.parse_ga("7/1/2")) == "Min lampe" and navn.get("analog-value,%d" % nk.parse_ga("7/1/1")) == "Temp ny", str(navn)[:200])


def knx_linjer():
    """The ETS project says which line each group address lives on, so a gateway asks its own line first."""
    import io
    import zipfile
    import nabe_knx as nk
    xml = ('<KNX><Project><Installations><Installation><GroupAddresses><GroupRanges><GroupRange>'
           '<GroupAddress Id="P-1_GA-1" Address="2305" Name="Temp"/><GroupAddress Id="P-1_GA-2" Address="2306" Name="Lys"/>'
           '</GroupRange></GroupRanges></GroupAddresses><Topology><Area Address="1"><Line Address="2"><DeviceInstance Address="5"><ComObjectInstanceRefs>'
           '<ComObjectInstanceRef RefId="a" Links="GA-1" ReadFlag="Enabled"/></ComObjectInstanceRefs></DeviceInstance></Line>'
           '<Line Address="3"><DeviceInstance Address="6"><ComObjectInstanceRefs><ComObjectInstanceRef RefId="b" Links="GA-2" ReadFlag="Enabled"/>'
           '</ComObjectInstanceRefs></DeviceInstance></Line></Area></Topology></Installation></Installations></Project></KNX>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("P-0001/0.xml", xml)
    pts = {p["ga"]: p for p in nk.parse_group_list(buf.getvalue(), "t.knxproj")["points"]}
    sjekk("knx: prosjektet sier hvilken linje hver gruppeadresse hører til", pts[2305].get("linjer") == ["1.2"] and pts[2306].get("linjer") == ["1.3"], str(pts))
    t = kall("/api/knx/tempo", {"address": "kx:127.0.0.1:9", "per_sekund": 99})
    sjekk("knx: lesetempoet kan velges og holdes innenfor det bussen tåler", t.get("status") == "done" and t.get("tempo") == 16.0, str(t))


def protokoll_info():
    """A Modbus device with no name from the device is named by its IP, and the background reading of KNX reports its progress."""
    import nabe_modbus as nm
    d = nm.device_record("10.0.0.5", 502, {"unit": 1})
    d2 = nm.device_record("10.0.0.5", 502, {"unit": 3})
    sjekk("modbus: en enhet uten navn fra enheten heter bare IP-en, og enhets-ID står for seg",
          d["object_name"] == "10.0.0.5" and d["unit"] == 1 and d2["object_name"] == "10.0.0.5 #3", d["object_name"])
    sjekk("modbus: MAC-adressen hentes bare for maskiner på eget nett, ellers er svaret tomt", nm.mac_for("127.0.0.1") == {} and isinstance(nm.mac_for("192.0.2.1"), dict))
    r = kall("/api/knx/lesestatus?address=kx:127.0.0.1:9")
    sjekk("knx: lesingen i bakgrunnen melder fra om hvor langt den har kommet", r.get("status") == "done" and r.get("kjorer") is False and "spurt" in r, str(r))


def knx_routing():
    """Routing: listening to the multicast group, with no tunnel taken and nothing sent."""
    import socket
    import nabe_knx as nk
    r = nk.KnxRouting()
    cemi = bytes([0x29, 0x00, 0xBC, 0xE0, 0x11, 0x05, 0x01, 0x02, 0x03, 0x00, 0x80, 0x0C, 0x1A])
    r.datagram_received(nk.header(nk.ROUTING_IND, cemi), ("127.0.0.1", 3671))
    r.datagram_received(nk.header(0x0420, cemi), ("127.0.0.1", 3671))
    sjekk("knx: routing tar imot en gruppetelegram og leser kilde, adresse og verdi, og ignorerer annen trafikk",
          r.telegrams == 1 and r.values[258]["raw"] == bytes([0x0C, 0x1A]) and r.values[258]["src"] == 0x1105 and r.seq == 1, str(r.values))
    sjekk("knx: multikastadresser kjennes igjen", nk.is_multicast("224.0.23.12") and not nk.is_multicast("10.0.0.1"))
    k = kall("/api/knx/routing", {})
    if k.get("status") != "done":
        print("   (hopper over multikast: " + str(k.get("error"))[:90] + ")")
        return
    adr = k["device"]["address"]
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_LOOP, 1)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
    s.sendto(nk.header(nk.ROUTING_IND, cemi), (nk.ROUTING_GROUP, 3671))
    s.close()
    time.sleep(0.8)
    m = kall("/api/knx/monitor?address=" + adr)
    sjekk("knx: lytter på routing-gruppen og viser telegrammet i monitoren, uten å ta en tunnel",
          m.get("status") == "done" and any(x["ga"] == "0/1/2" and x["kilde"] == "1.1.5" for x in m.get("rader", [])), str(m)[:200])
    les = kall("/api/knx/les-alle", {"address": adr})
    sjekk("knx: routing sier fra at den bare lytter når man ber den lese alle", les.get("status") == "error", str(les))
    kall("/api/knx/koble-fra", {})


def modbus_import():
    """Lists in the shapes a technician has them: a Niagara export, Excel, and addresses written as 40012."""
    import base64
    import io
    import zipfile
    import nabe_modbus as nm
    kol = "Path,Name,Type,Out,Enabled,Tuning Policy Name,Absolute Address,Fault Cause,Poll Frequency,Data Address,Reg Type,Data Type,Status Type,Bit Number,Beginning Bit,Number of Bits,Data Source,Number Registers,Device Facets,Facets,Conversion"
    def rad(path, navn, typ, adr="", dt="", fac="", conv="Default"):
        f = [path, navn, typ, "", "true", "defaultPolicy", adr, "", "Normal", adr, "Input" if adr.startswith("Modbus:3") else "", dt, "", "", "", "", "Point Poll", "", "", fac, conv]
        return ",".join(f)
    p0 = "/Drivers/ModbusTcpNetwork/Site/Dev/points"
    niagara = "\r\n".join([kol,
        rad(p0 + "/system", "360.017", "Modbus Client Point Folder"), rad(p0 + "/system/Varmebatteri", "LV401", "Modbus Client Point Folder"),
        rad(p0 + "/system/Varmebatteri/SB_C", "SB_C", "Numeric Point", "Modbus:30054", "Signed Integer", "units=u:percentNM;%;;;|precision=i:1", "Linear *0.1"),
        rad(p0 + "/system/Varmebatteri/RT_P", "RT_P", "Numeric Point", "Modbus:30055", "Signed Integer", "units=u:celsius;\xb0C;(K);+273.15;|precision=i:1", "Linear *0.01"),
        rad(p0 + "/system/Varmebatteri/SB_D", "SB_D", "Numeric Point", "Modbus:30054", "Signed Integer"),
        rad(p0 + "/system/Varmebatteri/JP_S", "JP_S", "Boolean Point", "Modbus:10031")]).encode("cp1252")
    m = nm.parse_map_bytes(niagara, "n.csv")
    p = {x["name"]: x for x in m["points"]}
    sjekk("modbus: Niagara-eksport av Modbus-punkter gir navn fra mappene, adresse fra 30054 og skala fra omregningen",
          m["format"] == "niagara" and "360.017-LV401_SB_C" in p and p["360.017-LV401_SB_C"]["function"] == "input" and p["360.017-LV401_SB_C"]["address"] == 53
          and p["360.017-LV401_SB_C"]["scale"] == 0.1 and p["360.017-LV401_RT_P"]["scale"] == 0.01 and p["360.017-LV401_SB_C"]["unit"] == "%"
          and p["360.017-LV401_RT_P"]["unit"] == "°C" and p["360.017-LV401_JP_S"]["function"] == "discrete", str(m["notes"]))
    sjekk("modbus: to punkter på samme register gir ett, og importen sier at det andre er hoppet over", len(m["points"]) == 3 and any("hoppet over" in n for n in m["notes"]), str(m["notes"]))

    def xlsx(rader):
        celler = lambda r, i: "".join(f'<c r="{chr(65 + j)}{i}" t="inlineStr"><is><t>{v}</t></is></c>' for j, v in enumerate(r))
        xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(f'<row r="{i}">{celler(r, i)}</row>' for i, r in enumerate(rader, 1)) + "</sheetData></worksheet>"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("xl/worksheets/sheet1.xml", xml)
        return buf.getvalue()
    arket = xlsx([["Prosjekt Y", "", ""], ["Adresse", "Navn", "Enhet", "Beskrivelse"], ["40012", "Settpunkt tilluft", "°C", "Settpunkt"], ["30001", "Tilluftstemperatur", "°C", "Måling"], ["10005", "Brannalarm", "", "Alarm"]])
    mx = nm.parse_map_bytes(arket, "liste.xlsx")
    px = {x["name"]: x for x in mx["points"]}
    sjekk("modbus: Excel (.xlsx) leses, med overskriftsraden funnet og adresser som 40012 forstått",
          mx["format"] == "xlsx" and px["Settpunkt tilluft"]["function"] == "holding" and px["Settpunkt tilluft"]["address"] == 11 and px["Tilluftstemperatur"]["function"] == "input"
          and px["Tilluftstemperatur"]["address"] == 0 and px["Brannalarm"]["function"] == "discrete" and px["Tilluftstemperatur"]["unit"] == "°C", str(mx["notes"]))
    k = kall("/api/modbus/kart", {"navn": "Fra Excel", "innhold": base64.b64encode(arket).decode(), "filnavn": "liste.xlsx"})
    sjekk("modbus: Excel kan lastes opp gjennom API-et", k.get("status") == "done" and k.get("punkter") == 3 and k.get("format") == "xlsx", str(k))
    feil = kall("/api/modbus/kart", {"navn": "x", "innhold": base64.b64encode(xlsx([["A", "B"], ["1", "2"]])).decode(), "filnavn": "x.xlsx"})
    sjekk("modbus: en Excel-fil uten adressekolonne sier hvilke kolonner den har", feil.get("status") == "error" and "no address column" in feil.get("error", ""), str(feil)[:120])


def redigering():
    """Renaming and rescaling a point in the list a device uses, and a device type that gets its map back."""
    import base64
    import nabe_knx as nk
    import nabe_knx_sim as ks
    j = vent_jobb(kall("/api/modbus/scan", {"subnet": "127.0.0.1", "port": MBSIM.port, "units": [1], "timeout": 1.0})["job_id"])
    d = j["result"]["devices"][0]
    adr = d["address"]
    k = kall("/api/modbus/kart", {"navn": "Til redigering", "tekst": "address;function;type;name;scale\n0;holding;s16;Temperatur;1\n"})
    kall("/api/modbus/tilordne", {"address": adr, "kart": k["id"], "vendor": d["vendor_name"], "model": d["model_name"]})
    r = kall("/api/modbus/punkt", {"address": adr, "objid": "analog-value,0", "felter": {"name": "Romtemperatur", "scale": "0,1", "unit": "°C", "description": "Rommet"}})
    p = vent_jobb(kall("/api/device/points", {"address": adr, "device_instance": 1})["job_id"])
    pt = {x["name"]: x for x in p["result"]["points"]}
    sjekk("modbus: et punkt kan få nytt navn, skala og enhet i listen enheten bruker",
          r.get("status") == "done" and "Romtemperatur" in pt and abs(pt["Romtemperatur"]["value"] - 21.0) < 1.2 and pt["Romtemperatur"]["units"] == "degrees-celsius"
          and pt["Romtemperatur"]["description"] == "Rommet", str(r) + str({n: x["value"] for n, x in pt.items()}))
    feil = kall("/api/modbus/punkt", {"address": adr, "objid": "analog-value,0", "felter": {"scale": "ti"}})
    sjekk("modbus: en skala som ikke er et tall avvises", feil.get("status") == "error", str(feil))
    kall("/api/modbus/tilordne", {"address": adr, "kart": None})
    j2 = vent_jobb(kall("/api/modbus/scan", {"subnet": "127.0.0.1", "port": MBSIM.port, "units": [1], "timeout": 1.0})["job_id"])
    d2 = j2["result"]["devices"][0]
    sjekk("modbus: en enhet av en kjent type får kartet sitt igjen ved neste skann, og sier det", d2.get("forslag", {}).get("brukt") is True
          and d2["forslag"]["kart"] == k["id"], str(d2.get("forslag")))
    # a KNX point renamed and given a type
    jk = vent_jobb(kall("/api/knx/scan", {"subnet": "127.0.0.1", "port": KXSIM.port, "timeout": 1.5})["job_id"])
    kadr = jk["result"]["devices"][0]["address"]
    kl = kall("/api/knx/lister", {"navn": "Redigering", "innhold": base64.b64encode(b"Group name;Address\r\nTemp;1/1/1\r\n").decode(), "filnavn": "r.csv"})
    kall("/api/knx/tilordne", {"address": kadr, "liste": kl["id"]})
    r2 = kall("/api/knx/punkt", {"address": kadr, "objid": "analog-value,%d" % nk.parse_ga("1/1/1"), "felter": {"name": "Romtemp 101", "dpt": "9.001", "description": "Rom 101"}})
    r3 = kall("/api/knx/punkt", {"address": kadr, "objid": "analog-value,%d" % nk.parse_ga("9/1/9"), "felter": {"name": "Ny adresse"}})
    p2 = vent_jobb(kall("/api/device/points", {"address": kadr, "device_instance": 1})["job_id"], 90)
    pk = {x["name"]: x for x in p2["result"]["points"]}
    sjekk("knx: en gruppeadresse kan få nytt navn og datapunkttype, og en adresse som ikke står i lista kan legges til",
          r2.get("status") == "done" and "Romtemp 101" in pk and pk["Romtemp 101"]["units"] == "degrees-celsius" and "Ny adresse" in pk and r3.get("status") == "done",
          str(r2) + str(sorted(pk)[:6]))
    sjekk("knx: redigeringen skrev ingenting til bussen", KXSIM.writes_received == [])


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
    modbus()
    knx()
    modbus_exol()
    knx_gjetting()
    modbus_rtu()
    knx_lesefane()
    modbus_ledig()
    knx_monitor()
    knx_routing()
    protokoll_info()
    knx_linjer()
    ny_liste()
    modbus_import()
    redigering()
    flere_kort()
    simulator()
    oppdatering()
    flagg()
    vakt()
    tilkobling()

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
    # Last: it silences the simulated device on 127.0.0.6.
    mine_uten_kontakt()

    for fil in ("nabe-start", "nabe-verktoy", "nabe-felt", "nabe-moro", "nabe-finn", "nabe-skann", "nabe-anlegg", "nabe-bunn", "nabe-graf", "nabe-tunnel", "nabe-sammen", "nabe-flyt", "nabe-peker", "nabe-pekere", "nabe-skrift", "nabo", "nabo-brodre", "nabo-fasit", "nabe-garderobe", "nabe-opptak", "nabe-trafikk", "nabe-forslag", "nabe-nett", "nabe-alarmhist", "nabe-grenser", "nabe-sat", "nabe-stotte", "nabe-kart-eksport", "nabe-modbus", "nabe-knx", "nabe-rediger", "nabe-besok", "nabe-runde", "nabe-skjema-ordbok", "nabe-skjema", "nabe-flater", "nabe-fortsett", "nabe-simulator", "nabe-oppdatering", "nabe-bakover", "nabe-kart", "nabe-syn", "nabe-raad", "nabe-dialoger-innhold", "nabe-dialoger-mer", "nabe-dialoger", "nabe-tilbehor", "nabe-kunnskap", "nabe-spor"):
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

    import nabe_modbus_sim as mbsim
    global MBSIM
    MBSIM = mbsim.ModbusSim(mbsim.demo_units(), empty=[9])
    await MBSIM.start('127.0.0.1', 0)
    import nabe_knx_sim as kxsim
    global KXSIM, KXSEC, MBRTU
    MBRTU = mbsim.ModbusSim(mbsim.demo_units(), empty=[9], rtu=True)
    await MBRTU.start('127.0.0.1', 0)
    KXSIM = kxsim.KnxSim(kxsim.demo_groups())
    await KXSIM.start('127.0.0.1', 0)
    KXSEC = kxsim.KnxSim(kxsim.demo_groups(), secure=True)
    await KXSEC.start('127.0.0.1', 0)

    async def sving():
        import math
        rt = APPS["127.0.0.6"].get_object_name("SIM-AVVIK_RT402")
        sb = APPS["127.0.0.6"].get_object_name("SIM-AVVIK_SB402")
        pu = APPS["127.0.0.6"].get_object_name("SIM-AVVIK_PUMPE")
        while True:
            t = time.time()
            pu.presentValue = "active" if int(t) % 6 < 3 else "inactive"
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
               NABE_MB_LEDIG="4", NABE_COV_LIFETIME="6", NABE_COV_PAA_NYTT="3", NABE_TILLAT_LOOPBACK="1", NABE_VAKT_SEK="1", NABE_SYK_MIN_S="20")
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
        await MBSIM.stop()
        await MBRTU.stop()
        await KXSIM.stop()
        await KXSEC.stop()
        for a in apps:
            a.close()
    ok = all(RESULTAT)
    print(f"\n{sum(RESULTAT)} av {len(RESULTAT)} grønne." + ("" if ok else "  Noe er galt."))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
