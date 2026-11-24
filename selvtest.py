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
import re
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


def lag_alarmenhet(siste_oktett: int, instans: int, navn: str):
    """A device with alarms set up in four ways: a class with nobody in it, one with a supervisor (device 1234), a point that
    names a class that does not exist, and a point with no alarm at all. Kept apart from the other simulators: a point
    with intrinsic reporting runs the device's event machinery, and the timing tests should not share it."""
    from bacpypes3.basetypes import Destination, Recipient, EventTransitionBits, DaysOfWeek
    from bacpypes3.object import NotificationClassObject
    from bacpypes3.primitivedata import ObjectIdentifier
    dev = DeviceObject(objectIdentifier=("device", instans), objectName=navn, vendorIdentifier=999, maxApduLengthAccepted=1476,
                       segmentationSupported="noSegmentation", vendorName="NABE Simulator")
    app = NormalApplication(dev, IPv4Address(f"127.0.0.{siste_oktett}/8"))
    app.add_object(NotificationClassObject(objectIdentifier=("notification-class", 5), objectName=f"{navn}_KLASSE_TOM",
                                           notificationClass=5, priority=[1, 2, 3], ackRequired=EventTransitionBits([0, 0, 0]), recipientList=[]))
    app.add_object(NotificationClassObject(objectIdentifier=("notification-class", 6), objectName=f"{navn}_KLASSE_OVERVAKING",
                                           notificationClass=6, priority=[1, 2, 3], ackRequired=EventTransitionBits([0, 0, 0]),
                                           recipientList=[Destination(validDays=DaysOfWeek([1] * 7), fromTime=Time("00:00:00.00"), toTime=Time("23:59:59.99"),
                                                                      recipient=Recipient(device=ObjectIdentifier("device,1234")), processIdentifier=1,
                                                                      issueConfirmedNotifications=False, transitions=EventTransitionBits([1, 1, 1]))]))
    for nr, (klasse, ekte) in enumerate(((5, True), (6, True), (9, False), (None, True)), start=1):
        o = AnalogInputObject(objectIdentifier=("analog-input", nr), objectName=f"{navn}_P{nr}", presentValue=20.0, units="degreesCelsius", statusFlags=[0, 0, 0, 0])
        app.add_object(o)
        if klasse is not None:
            o.notificationClass = klasse
            o.eventEnable = EventTransitionBits([1, 1, 1])
    return app


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
        # A room at 18 degrees with its valve at 100 % and the setpoint at 21: the loop does all it can and nothing happens
        app.add_object(AnalogInputObject(objectIdentifier=("analog-input", 7), objectName=f"{navn}_RT403",
                                         presentValue=18.0, units="degreesCelsius", covIncrement=0.5,
                                         description="Rom uten effekt", statusFlags=[0, 0, 0, 0]))
        app.add_object(AnalogInputObject(objectIdentifier=("analog-input", 8), objectName=f"{navn}_SB403",
                                         presentValue=100.0, units="percent", covIncrement=1.0,
                                         description="Ventil full", statusFlags=[0, 0, 0, 0]))
        app.add_object(AnalogValueObjectCmd(objectIdentifier=("analog-value", 7), objectName=f"{navn}_RT403_SP",
                                            presentValue=21.0, relinquishDefault=21.0, units="degreesCelsius",
                                            description="Settpunkt", statusFlags=[0, 0, 0, 0]))
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


NYE_RYKTEST = r'''  urimelig: (() => {    const ai = (v, u, n) => ({type: 'analog-input', value: v, units: u, name: n || 'X'});    return !!rarGrunn(ai(-50, 'degrees-celsius')) && !!rarGrunn(ai(32767, 'degrees-celsius')) && !rarGrunn(ai(21.5, 'degrees-celsius'))      && !!rarGrunn(ai(0, 'parts-per-million', 'CO2_PV')) && !rarGrunn(ai(0, 'parts-per-million', 'CO_PV')) && !rarGrunn(ai(650, 'parts-per-million', 'CO2_PV'))      && !!rarGrunn(ai(120, 'percent-relative-humidity')) && !!rarGrunn(ai(0, 'percent-relative-humidity')) && !rarGrunn(ai(45, 'percent-relative-humidity'))      && !rarGrunn({...ai(-50, 'degrees-celsius'), type: 'analog-output'}) && !rarGrunn({...ai(-50, 'degrees-celsius'), unread: true})      && !!rarGrunn(ai(-60, 'degrees-celsius')) && rarVerdi(ai(-50, 'degrees-celsius')) === true && rarGrunn({type: 'analog-input', value: 5, units: 'degrees-celsius'}) === ''; })(),  nett: !!window.nabeNett && (() => {    const N = window.nabeNett, mk = (net, n) => Array.from({length: n}, (_, i) => ({address: net + ':' + i, device_instance: net * 100 + i, protocol: 'bacnet'}));    const r = N.ruterBelastning([{ruter: '10.0.0.1', nett: [5, 6]}, {ruter: '10.0.0.2', nett: [7]}], [...mk(5, 33), ...mk(6, 5), ...mk(7, 25), ...mk(9, 4), {address: '10.0.0.9', device_instance: 1}]);    const a = r.rutere.find(x => x.ruter === '10.0.0.1'), b = r.rutere.find(x => x.ruter === '10.0.0.2');    const m = N.sammeMac([{address: '10.0.0.1', mac: 'AA:BB:CC:00:00:01'}, {address: '10.0.0.2', mac: 'aa-bb-cc-00-00-01'}, {address: '10.0.0.3:47809', mac: '11:22:33:44:55:66'}, {address: '10.0.0.3', mac: '11:22:33:44:55:66'}]);    S._sammeAdr = {};    const it = N.ny();    N.noterAdresse(null, {address: '10.1.1.1', device_instance: 1}, it); N.noterAdresse(null, {address: '10.1.1.1', device_instance: 2}, it); N.noterAdresse(null, {address: '10.1.1.2', device_instance: 3}, it);    N.ferdigMed(it);    const konf = N.sammeAdresse([{address: '10.1.1.1'}, {address: '10.1.1.2'}]);    const it2 = N.ny(); N.noterAdresse({device_instance: 1}, {address: '10.1.1.1', device_instance: 1}, it2); N.ferdigMed(it2);    const etter = N.sammeAdresse([{address: '10.1.1.1'}]);    S._sammeAdr = {};    return a.niva === 'over' && a.nett[0].antall === 33 && a.nett[0].mstp === 33 && a.total === 38 && b.niva === 'naer' && r.utenRuter.length === 1 && r.utenRuter[0].nett === 9      && m.length === 1 && m[0].enheter.length === 2 && konf.length === 1 && konf[0].ider.join() === '1,2' && etter.length === 0 && N.nettAv('10.0.0.1:47808') === null && N.nettAv('50:2').nett === 50      && typeof window.nabeKart.ruterData === 'function'; })(),  alarmhist: !!window.nabeAlarmhist && typeof aapneAlarmhist === 'function' && !!document.getElementById('alarmhistBtn') && (() => {    const A = window.nabeAlarmhist, lager = {anlegg: {}}, a = A.anlegg(lager, 'k'), dag = 864e5, t0 = Date.UTC(2026, 5, 1, 10);    const d = {address: '10.0.0.1', object_name: 'RTU'}, p = (n, f) => ({objid: 'ai,' + n, name: 'P' + n, status: f});    const n1 = A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, [])], t0);    const n2 = A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, ['in-alarm']), p(3, ['fault'])], t0 + dag);    A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, [])], t0 + 2 * dag);    A.registrerEnhet(a, d, [p(1, ['in-alarm']), p(2, ['in-alarm'])], t0 + 3 * dag);    const dd = a.enh['10.0.0.1'].dager, nu = t0 + 3 * dag + 1000, x = (n) => a.pkt['10.0.0.1|ai,' + n];    return n1 === 0 && n2 === 2 && x(1).grunnlag === true && A.klassifiser(x(1), dd, nu).kronisk && !A.klassifiser(x(1), dd, nu).ny      && !A.klassifiser(x(2), dd, nu).kronisk && A.klassifiser(x(2), dd, nu).sjelden && x(2).n === 2      && A.klassifiser(x(3), dd, t0 + dag + 1000).ny && !A.klassifiser(x(3), dd, nu).ny; })(),  idriftsettelse: !!window.nabeSat && typeof aapneSat === 'function' && !!document.getElementById('satBtn') && (() => {    const Z = window.nabeSat;    const r = Z.parsPunktliste('Enhet;Punkt;Min;Maks;Merknad\nRTU-1;RT401;19,5;23;Rom\nRTU-1;FS401\n# kommentar\n;P9;;5');    const r2 = Z.parsPunktliste('RT401\nRT402'), r3 = Z.parsPunktliste('A,B,1,2');    const devs = [{address: '10.0.0.1', device_instance: 11, object_name: 'RTU-1'}, {address: '10.0.0.2', device_instance: 12, object_name: 'RTU-2'}, {address: '10.0.0.3', device_instance: 13, object_name: 'RTU-2'}];    const cache = {'10.0.0.1': [{objid: 'ai,1', name: 'RT401', value: 21, status: []}, {objid: 'ai,2', name: 'Fs 401', value: 5, status: ['overridden']}], '10.0.0.2': [{objid: 'ai,1', name: 'RT401', value: 21}]};    const f = (e, p) => Z.finnPunkt({enhet: e, punkt: p}, devs, cache);    const v = (rad, p, val) => Z.vurder(rad, p, val);    const ok = {objid: 'ai,1', name: 'T', value: 21, status: []};    const o = Z.oppsummer([{res: {status: 'ok'}}, {res: {status: 'utenfor'}}, {res: {status: 'over'}, godkjent: true}, {res: {status: 'over'}}, {}]);    return r.length === 3 && r[0].lav === 19.5 && r[0].hoy === 23 && r[0].merknad === 'Rom' && r[1].lav === null && r[2].enhet === '' && r[2].hoy === 5      && r2.length === 2 && r2[0].punkt === 'RT401' && r3.length === 1 && r3[0].lav === 1      && f('RTU-1', 'RT401').status === 'funnet' && f('11', 'RT401').p.objid === 'ai,1' && f('10.0.0.1', 'fs401').status === 'funnet' && f('RTU-1', 'FS-401').p.objid === 'ai,2'      && f('RTU-2', 'RT401').status === 'flere-enheter' && f('Finnes ikke', 'X').status === 'ingen-enhet' && f('RTU-1', 'X').status === 'ingen-punkt' && f('', 'RT401').status === 'flere-punkter'      && f('RTU-3', 'RT401').status === 'ingen-enhet'      && Z.objidFraKortform('AI 10000') === 'analog-input,10000' && Z.objidFraKortform('bv1') === 'binary-value,1' && Z.objidFraKortform('RT401') === '' && Z.objidFraKortform('msv-3') === 'multi-state-value,3'      && v({lav: 19, hoy: 23}, ok).status === 'ok' && v({lav: 22, hoy: null}, ok).status === 'utenfor' && v({lav: null, hoy: 20}, ok).status === 'utenfor'      && v({}, {...ok, status: ['fault']}).status === 'feil' && v({}, {...ok, status: ['overridden']}).status === 'over' && v({}, {...ok, status: ['out-of-service']}).status === 'ute' && v({}, {...ok, value: null}).status === 'ikke'      && v({}, {...ok, status: ['in-alarm']}).status === 'alarm' && o.ok === 1 && o.godkjent === 1 && o.avvik === 1 && o.varsel === 1 && o.ikkeKjort === 1 && o.ferdige === 2; })(),  forslag2: (() => {    const dev = (a, n) => ({address: a, object_name: n, device_instance: 1});    const r = bygForslag({devices: [dev('10.0.0.1', 'A')], cache: {'10.0.0.1': [{objid: 'ai,1', name: 'P', status: []}]}, failed: new Set(), varsler: [], avvik: [],      urimelig: [{ip: '10.0.0.1', objid: 'ai,1', navn: 'T1', verdi: '-50 C'}], flate: [{ip: '10.0.0.1', objid: 'ai,1', navn: 'T2', minutter: 40}],      sykluser: [{address: '10.0.0.1', objid: 'bi,1', navn: 'Pumpe (x)', per_time: 9.5, dom: 'mange'}], tips: [{ip: '10.0.0.1', objid: 'bo,1', navn: 'Pumpe 2'}],      alarmhist: [{ip: '10.0.0.1', objid: 'ai,3', navn: 'N', ny: true, kjent: false, dager: ['d'], kronisk: false}, {ip: '10.0.0.1', objid: 'ai,4', navn: 'K', kronisk: true, kjent: false, dager: ['a', 'b', 'c']}, {ip: '10.0.0.1', objid: 'ai,5', navn: 'Kj', kronisk: true, kjent: true, dager: ['a']}],      ruter: {rutere: [{ruter: '10.0.0.9', total: 40, niva: 'over', nett: [{nett: 5, antall: 40, mstp: 40, niva: 'over', forste: '5:1'}]}], utenRuter: []},      sammeMac: [{mac: 'aa:bb', enheter: [{address: '10.0.0.1'}, {address: '10.0.0.2'}]}], endretId: [{ip: '10.0.0.1', fra: 1, til: 2}]});    const id = r.liste.map(p => p.id), get = (x) => r.liste.find(p => p.id === x);    return ['urimelig', 'flat', 'sykluser', 'syk-tips', 'alarm-nye', 'alarm-ofte', 'ruter', 'mac', 'endret-id'].every(x => id.includes(x))      && get('sykluser').prio === 2 && get('ruter').prio === 2 && get('alarm-ofte').rader.length === 1 && get('alarm-nye').rader.length === 1 && id.indexOf('urimelig') < id.indexOf('flat')      && get('sykluser').rader[0].navn !== undefined && /9,5/.test(get('sykluser').rader[0].tekst) && /kan ikke stemme|cannot be right/.test(get('urimelig').tittel); })(),  grenser: !!window.nabeGrenser && (() => {    const G = window.nabeGrenser;    const ev = [{id: 1, address: 'a', objid: 'o', type: 'over'}, {id: 2, address: 'a', objid: 'o', type: 'tilbake'}, {id: 3, address: 'b', objid: 'o', type: 'under'}, {id: 4, address: 'b', objid: 'o', type: 'fortsatt'}];    const ak = G.aktive(ev), t = G.tekst({type: 'over', verdi: 33.2, grense: 30, enhet: 'C'});    return ak.length === 1 && ak[0].address === 'b' && /30/.test(t) && /33/.test(t) && /Fortsatt under|Still below/.test(G.tekst({type: 'fortsatt', verdi: 5, grense: 10, enhet: 'C'}))      && /Tilbake|Back/.test(G.tekst({type: 'tilbake', verdi: 20, grense: null, enhet: 'C'})) && typeof aapneGrenser === 'function'; })(),  stotte: typeof aapneStotte === 'function' && !!document.getElementById('stotteBtn') && typeof window.nabeStotte.enhetsCsv() === 'string' && window.nabeStotte.enhetsCsv().startsWith('adresse;instans'),  eksport: !!window.nabeKartEksport && (() => {    const foer = S.devices;    S.devices = [{address: '10.0.0.1', device_instance: 1, object_name: 'A <&> "B"', _range: '10.0.0.0/24'}, {address: 'mb:10.0.0.2', protocol: 'modbus', object_name: 'M', _range: '10.0.0.0/24'}];    let ok = false;    try {      const r = window.nabeKartEksport.bygSvg(), x = new DOMParser().parseFromString(r.svg, 'image/svg+xml');      ok = !x.querySelector('parsererror') && x.documentElement.nodeName === 'svg' && r.W > 500 && r.H > 200 && !r.svg.includes('A <&>');    } finally { S.devices = foer; }    return ok && window.nabeKartEksport.bygSvg() === null; })(),  regler: !!window.nabeRegler && (() => {    const Rg = window.nabeRegler;    const ok = Rg.valider(JSON.stringify({regler: [      {id: 'a', tittel: 'Kaldt {n}', hvorfor: 'x', sjekk: ['y'], prio: 1, naar: {navn: 'RT\\d+', type: ['analog-input'], enhet: 'degrees-celsius', verdi: {'<': 19}}},      {id: 'b', aktiv: false, tittel: 'av', naar: {navn: 'x'}},      {id: 'c', tittel: {no: 'Norsk {enheter}', en: 'English {enheter}'}, naar: {status: ['in-alarm']}, per_enhet: {minst: 2}}]}));    const dev = (a, n) => ({address: a, object_name: n, device_instance: 1});    const cache = {'10.0.0.1': [{type: 'analog-input', name: '360.001-RT401', units: 'degrees-celsius', value: 17.5, status: []}, {type: 'analog-input', name: '360.001-RT402', units: 'degrees-celsius', value: 21, status: []},      {type: 'analog-input', name: 'X1', units: 'degrees-celsius', value: 10, status: ['in-alarm']}, {type: 'binary-output', name: 'P1', value: 'active', status: ['in-alarm']}],      '10.0.0.2': [{type: 'analog-input', name: 'RT500', units: 'degrees-celsius', value: 15, status: ['in-alarm']}]};    const ut = Rg.evaluer(ok.regler, [dev('10.0.0.1', 'A'), dev('10.0.0.2', 'B')], cache, () => 'Beckhoff');    const slett = Rg.valider('{"regler": [');    const feil = Rg.valider(JSON.stringify({regler: [{id: 'x', tittl: 'a', naar: {navnn: 'x', verdi: {'<<': 1, mellom: [5, 1]}, status: ['faul']}}, {tittel: 'u', naar: {navn: '['}}, 5, {tittel: 't', naar: {}}]}));    const t = Rg.valider(JSON.stringify([{tittel: 't', naar: {tilstand: 'active', protokoll: ['bacnet']}, minst: 0}]));    const tx = Rg.evaluer(Rg.valider(JSON.stringify({regler: [{tittel: 'P', naar: {tilstand: 'active', type: ['binary-output']}}, {tittel: 'M', minst: 3, naar: {type: ['analog-input']}}, {tittel: 'L', naar: {leverandor: 'regin'}}]})).regler, [dev('10.0.0.1', 'A')], cache, () => 'Beckhoff');    return ok.feil.length === 0 && ok.regler.length === 2 && ok.antall === 3 && ut.length === 2 && ut[0].id === 'egen:a' && /Kaldt 2/.test(ut[0].tittel) && ut[0].rader.length === 2 && ut[0].prio === 1      && /(Norsk|English) 1/.test(ut[1].tittel) && ut[1].rader[0].ip === '10.0.0.1'      && slett.feil.length === 1 && /JSON/.test(slett.feil[0]) && feil.regler.length === 0      && feil.feil.some(f => /tittl/.test(f) && /tittel/.test(f)) && feil.feil.some(f => /navnn/.test(f) && /navn/.test(f)) && feil.feil.some(f => /faul/.test(f)) && feil.feil.some(f => /<</.test(f))      && feil.feil.some(f => /(Regel|Rule) 2/.test(f) && /regul|regular/.test(f)) && feil.feil.some(f => /(Regel|Rule) 3/.test(f)) && feil.feil.some(f => /(Regel|Rule) 4/.test(f))      && t.feil.length === 1 && tx.length === 2 && tx.map(x => x.tittel).join() === 'P,M'; })(),  forslag3: (() => {    const r = bygForslag({devices: [{address: '10.0.0.1', object_name: 'A', device_instance: 1}], cache: {'10.0.0.1': [{objid: 'ai,1', name: 'P', status: []}]}, failed: new Set(), varsler: [], avvik: [],      virkning: [{maling: 'RT401 (C)', padrag: 'SB401 (%)', address: '10.0.0.1', objid: 'ai,1', siden_s: 1800, verdi: 18, settpunkt: 21, avvik: 3, dom: 'ingen'}],      virkningTips: [{ip: '10.0.0.1', objid: 'ai,2', navn: 'RT402'}],      storm: {aktiv: [{id: 1, type: 'whois', rate: 33.3, terskel: 10, topp: [['10.1.1.7', 20]]}], ferdige: []},      egne: [{id: 'egen:a', prio: 2, tittel: 'Kaldt 2', hvorfor: 'x', sjekk: [], rader: [{ip: '10.0.0.1', navn: 'A', tekst: 't', objid: ''}]}],      regelfeil: ['Regel 1: ukjent felt']});    const id = r.liste.map(p => p.id), get = (x) => r.liste.find(p => p.id === x);    return ['virkning', 'virkning-tips', 'storm', 'egen:a', 'regelfeil'].every(x => id.includes(x)) && get('storm').prio === 1 && get('virkning').prio === 2      && /30 min/.test(get('virkning').rader[0].tekst) && /18/.test(get('virkning').rader[0].tekst) && get('regelfeil').rader[0].lang === true && id.indexOf('storm') < id.indexOf('virkning')      && /10\.1\.1\.7/.test(get('storm').rader[0].tekst); })(),  grenser2: !!window.nabeGrenser && !!window.nabeStorm && (() => {    const G = window.nabeGrenser, ev = [{address: 'a', objid: 'o', regel: 'grense', type: 'over'}, {address: 'a', objid: 'o', regel: 'paa', type: 'paa_lenge'}, {address: 'a', objid: 'o', regel: 'grense', type: 'tilbake'}];    const ak = G.aktive(ev);    return ak.length === 1 && ak[0].regel === 'paa' && /95/.test(G.tekst({regel: 'paa', type: 'paa_lenge', verdi: 95, grense: 60})) && /Ikke lest|Not read/.test(G.tekst({regel: 'stille', type: 'stille', verdi: 12.5, grense: 10}))      && /ned|down/.test(G.tekst({regel: 'fart', type: 'fort', verdi: -3.2, grense: 2, enhet: 'C'})) && /Av igjen|Off again/.test(G.tekst({regel: 'paa', type: 'tilbake'}))      && /30/.test(G.oppsummering({lav: 1, hoy: 2, paa: 30, stille: null, fart: 5})) && /10\.2\.2\.2/.test(window.nabeStorm.tekst({type: 'cov-kilde', rate: 25, terskel: 20, topp: [['10.2.2.2', 25]]}))      && typeof window.nabeStorm.banner() === 'string'; })(),  drift: !!window.nabeDrift && (() => {    const D = window.nabeDrift;    const dag = (...e) => ({entries: e.map(([time, value]) => ({time, value}))});    const uke = [1, 2, 3, 4, 5].map(() => dag(['07:00', 'active'], ['17:00', 'inactive'])).concat([dag(['00:00', 'inactive']), dag(['00:00', 'inactive'])]);    const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi);    const dev = {address: '10.0.0.1', object_name: 'AHU1'};    const mk = (p, i) => ({objid: p.objid || 'bi,' + i, ...p});    const pts = [{type: 'binary-input', name: '360.001-SF_Drift', value: 'active', status: []}, {type: 'binary-input', name: '360.002-SF_Drift', value: 'active', status: []},      {type: 'binary-input', name: '360.001-Alarm_Drift', value: 'active', status: []}, {type: 'binary-output', name: '360.001-Vifte', value: 'inactive', status: []},      {type: 'binary-input', name: '360.001-Pumpe', value: 'active', status: ['overridden'], objid: 'bi,9'}, {type: 'analog-input', name: '360.001-Drift', value: 1, status: []}].map(mk);    const ur = {'10.0.0.1': {klar: true, schedules: [{objid: 'schedule,1', name: '360.001-Ukeprogram', value: 'inactive', weekly: uke}, {objid: 'schedule,2', name: '360.002-Ukeprogram', value: 'active', weekly: uke}]}};    const natt = at(2026, 11, 17, 3, 0).getTime();    const k1 = D.kandidater([dev], {'10.0.0.1': pts}, ur, natt);    const ur1 = {'10.0.0.1': {klar: true, schedules: [{objid: 's', name: 'Ukeprogram', value: 'inactive', weekly: uke}]}};    const ur2 = {'10.0.0.1': {klar: true, schedules: [{objid: 's', name: 'Ukeprogram', value: 'inactive', weekly: uke}, {objid: 't', name: 'Annet', value: 'inactive', weekly: uke}]}};    const enkel = [{objid: 'bi,1', type: 'binary-input', name: 'Vifte drift', value: 'active', status: []}];    return D.minSidenAv(uke, at(2026, 11, 17, 3, 0)) === 600 && D.minSidenAv(uke, at(2026, 11, 16, 17, 5)) === 5 && D.minSidenAv(uke, at(2026, 11, 16, 10, 0)) === null      && D.minSidenAv(uke, at(2026, 11, 21, 12, 0)) === 1140 && D.minSidenAv([], new Date()) === null      && k1.length === 2 && k1[0].siden === 600 && k1.some(x => x.punkt === '360.001-SF_Drift' && !x.overstyrt) && k1.some(x => x.punkt === '360.001-Pumpe' && x.overstyrt) && k1[0].program === '360.001-Ukeprogram'      && D.kandidater([dev], {'10.0.0.1': pts}, ur, at(2026, 11, 16, 17, 5).getTime()).length === 0      && D.kandidater([dev], {'10.0.0.1': pts}, ur, at(2026, 11, 16, 16, 30).getTime(), () => 3600).length === 2      && D.kandidater([dev], {'10.0.0.1': enkel}, ur1, natt).length === 1 && D.kandidater([dev], {'10.0.0.1': enkel}, ur2, natt).length === 0      && D.kandidater([dev], {'10.0.0.1': enkel}, {'10.0.0.1': {klar: false, schedules: []}}, natt).length === 0      && D.klass('På') === 'paa' && D.klass('Av') === 'av' && D.klass('Auto') === null && D.sysAv('A_360_001_x') === '360.001'; })(),  punktlogg: !!window.nabePunktlogg && (() => {    const P = window.nabePunktlogg, Dd = P.ny('k'), dev = {address: '10.0.0.1', object_name: 'A'};    const dag = 864e5, t0 = Date.UTC(2026, 5, 1, 10);    const pt = (n, v, o = {}) => ({type: 'analog-input', objid: 'ai,' + n, name: 'P' + n, value: v, units: 'degrees-celsius', unit_symbol: 'C', status: [], ...o});    const les = (k) => P.registrer(Dd, dev, [pt(1, 21.5), pt(2, 19 + k * 0.1), pt(3, 0, {units: 'percent'}), pt(4, 5, {name: 'T_SP'}), pt(5, 7, {status: ['out-of-service']}), pt(6, 3.3),      {type: 'analog-value', objid: 'av,1', name: 'V', value: 1}, pt(7, null)], t0 + k * dag);    les(0); les(1);    const tidlig = P.finnDode(Dd).punkter.length;    les(2); les(2);    const r = P.finnDode(JSON.parse(JSON.stringify(Dd)));    P.registrer(Dd, dev, [pt(1, 21.7)], t0 + 3 * dag);    const etter = P.finnDode(Dd).punkter.map(x => x.navn).join();    const D2 = P.ny('k2');    for (let k = 0; k < 3; k++) P.registrer(D2, dev, [1, 2, 3, 4, 5, 6].map(n => pt(n, 10 + n)), t0 + k * dag);    const e = P.finnDode(D2);    return tidlig === 0 && r.punkter.map(x => x.navn).sort().join() === 'P1,P6' && r.punkter[0].dager === 3 && r.besok === 3 && r.analoge === 3 && r.punkter[0].symbol === 'C'      && etter === 'P6' && e.punkter.length === 0 && e.enheter.length === 1 && e.enheter[0].antall === 6 && e.enheter[0].av === 6; })(),  arbeid: !!window.nabeArbeid && typeof window.rapportHtml === 'function' && typeof window.forslagNaa === 'function' && !!document.getElementById('apiBtn') && (() => { const A = window.nabeArbeid; A.tilbakestill(); const lop = (id, tittel, rader) => ({id, tittel, hvorfor: 'x', sjekk: [], prio: 2, rader}); const rad = (ip, n) => ({ip, objid: 'o' + n, navn: 'N' + n}); const p1 = lop('a', '2 faulty points', [rad('1', 1), rad('1', 2)]); const p2 = lop('b', '1 in alarm', [rad('1', 3)]); const tom = A.del([p1, p2]); A.marker(p1, 'utfort'); A.marker(p2, 'utsatt', 7); const skjult = A.del([p1, p2]); const nytt = A.del([lop('a', '3 faulty points', [rad('1', 1), rad('1', 2), rad('1', 9)]), p2]); const tall = A.del([lop('a', '3 faulty points', [rad('1', 1), rad('1', 2)]), p2]); A.siste().poster.b.til = Date.now() - 1000; const utlopt = A.del([p1, p2]); A.vis('a'); const vist = A.del([p1]); const m = A.melding(p1, 'Anlegg'); A.tilbakestill(); return tom.synlige.length === 2 && tom.skjulte.length === 0 && skjult.synlige.length === 0 && skjult.skjulte.length === 2 && nytt.synlige.length === 1 && nytt.synlige[0].kom === 'nye' && nytt.synlige[0].nyeAntall === 1 && tall.synlige.length === 1 && tall.synlige[0].nyeAntall === 1 && utlopt.synlige.length === 1 && utlopt.synlige[0].kom === 'tilbake' && utlopt.synlige[0].id === 'b' && vist.synlige.length === 1 && /2 faulty points/.test(m) && /N1/.test(m) && m.startsWith('Anlegg'); })(), laer: !!window.nabeLaer && !!window.nabeStatus && (() => { const L = window.nabeLaer, Z = window.nabeStatus, foerR = S.scanRanges, foerD = S.devices; S.scanRanges = ['selftest-laer']; S.devices = [{address: '10.0.0.1', device_instance: 7, object_name: 'A'}]; L.tilbakestill(); const pts = [{o: 'ai,1', n: 'Reserve_T1'}, {o: 'ai,2', n: 'Reserve_T2'}, {o: 'ai,3', n: 'ReserveT3'}]; L.laer('dode', [{ip: '10.0.0.1', objid: 'ai,1', pts}], 'vilje'); L.laer('dup', [{ip: '10.0.0.1', objid: 'ai,1', pts}], 'vilje'); const a = L.skjult('dode', '10.0.0.1', 'ai,2', 'x'), b = L.skjult('dode', '10.0.0.1', 'ai,9', 'x'), c = L.skjult('flat', '10.0.0.1', 'ai,1', 'x'), nekt = L.skjult('dup', '10.0.0.1', 'ai,1', 'x'); S.devices = [{address: '10.0.0.55', device_instance: 7, object_name: 'A'}]; const flyttet = L.skjult('dode', '10.0.0.55', 'ai,3', 'x'); const rader = [{pts: [{o: 'ai,7', n: 'Reserve_T7'}, {o: 'ai,8', n: 'Annet'}]}]; const m = L.monsterFor('dode', rader); const tom = L.monsterFor('flat', rader); L.taMonster('dode', 'reserve', 'vilje'); const mn = L.skjult('dode', '10.0.0.55', 'ai,7', 'Reserve_T7') && !L.skjult('dode', '10.0.0.55', 'ai,8', 'Annet') && !L.skjult('flat', '10.0.0.55', 'ai,7', 'Reserve_T7'); const ingenMer = L.monsterFor('dode', rader) === null; L.avslaMonster('dode', 'xyz'); const antallFoer = L.antall(); const liste = L.liste(); L.angre('dode|#7|ai,1'); L.angreMonster('dode', 'reserve'); const etterAngre = !L.skjult('dode', '10.0.0.55', 'ai,1', 'x') && !L.skjult('dode', '10.0.0.55', 'ai,7', 'Reserve_T7') && L.antall() === antallFoer - 2; L.siste().poster['dode|#7|ai,2'].til = Date.now() - 1; const utlopt = !L.skjult('dode', '10.0.0.55', 'ai,2', 'x') && L.liste().some(x => x.utlopt); S.devices = [{address: '10.0.0.1', device_instance: 7, object_name: 'A'}]; L.laer('urimelig', [{ip: '10.0.0.1', objid: 'ai,1', pts: [{o: 'ai,1', n: 'T1'}]}], 'kjent'); const r = bygForslag({devices: S.devices, cache: {'10.0.0.1': [{objid: 'ai,1', name: 'T1', status: []}]}, failed: new Set(), varsler: [], avvik: [], urimelig: [{ip: '10.0.0.1', objid: 'ai,1', navn: 'T1', verdi: '-50 C'}, {ip: '10.0.0.1', objid: 'ai,2', navn: 'T2', verdi: '-50 C'}]}); const ur = r.liste.find(p => p.id === 'urimelig'); const f = bygForslag({devices: S.devices, cache: {'10.0.0.1': [{objid: 'ai,1', name: 'T1', status: ['fault']}, {objid: 'ai,2', name: 'T2', status: ['fault']}]}, failed: new Set(), varsler: [], avvik: []}); L.laer('feil-punkt', [{ip: '10.0.0.1', objid: 'ai,1', pts: [{o: 'ai,1', n: 'T1'}]}], 'vilje'); const f2 = bygForslag({devices: S.devices, cache: {'10.0.0.1': [{objid: 'ai,1', name: 'T1', status: ['fault']}, {objid: 'ai,2', name: 'T2', status: ['fault']}]}, failed: new Set(), varsler: [], avvik: []}); const fp = f2.liste.find(p => p.id === 'feil-punkt'); const s1 = Z.linje({status: {p1: 2, p2: 1, p3: 0, nye: 1, utfort: 0, topp: []}}), s2 = Z.linje({status: {p1: 0, p2: 0, p3: 0, utfort: 2}}), s3 = Z.linje({}); const o = Z.oppsummer([['a', {status: {p1: 1, p2: 0, p3: 0}}], ['b', {status: {p1: 0, p2: 2, p3: 0}}], ['c', {}]]); L.tilbakestill(); S.scanRanges = foerR; S.devices = foerD; return a && !b && !c && !nekt && flyttet && m && m.ord === 'reserve' && m.laert === 3 && m.flere === 1 && !tom && mn && ingenMer && liste.length === 4 && etterAngre && utlopt && ur && ur.rader[0].pts.length === 1 && /1 /.test(ur.tittel) && r.laert === 1 && f.liste.find(p => p.id === 'feil-punkt').rader[0].pts.length === 2 && fp.rader[0].pts.length === 1 && f2.laert === 1 && /3 (færre|fewer)/.test(Z.trend({status: {t: 1000000, p1: 0, p2: 1, p3: 0}, hist: [{t: 1000000 - 172800, a: 4}, {t: 1000000, a: 1}]})) && Z.trend({status: {t: 1000000, p1: 0, p2: 1, p3: 0}, hist: [{t: 1000000, a: 1}]}) === '' && /2 (flere|more)/.test(Z.trend({status: {t: 1000000, p1: 1, p2: 1, p3: 0}, hist: [{t: 1, a: 0}]})) && (() => { const ov = (al) => bygForslag({devices: [{address: '10.0.0.1', object_name: 'A', device_instance: 7}], cache: {'10.0.0.1': [{objid: 'ao,1', name: 'P', status: ['overridden']}]}, failed: new Set(), varsler: [], avvik: [], overAlder: al}).liste.find(p => p.id === 'overstyrt'); const gammel = ov({'10.0.0.1|ao,1': {siden: Date.now() / 1000 - 20 * 86400, besok: 3}}), ny = ov({}); return gammel.prio === 2 && /20 d/.test(gammel.rader[0].tekst) && /(i over to uker|for over two weeks)/.test(gammel.tittel) && ny.prio === 3 && !/ d$/.test(ny.rader[0].tekst) && !/(to uker|two weeks)/.test(ny.tittel); })() && s1.klasse === 'p1' && /3/.test(s1.html) && s2.klasse === 'ro' && s3 === null && /1/.test(o); })(), alarmvei: !!window.nabeAlarmvei && !!document.getElementById('sbAlarm') && (() => { const A = window.nabeAlarmvei; const m = (inst, tr) => ({enhet: 'device,' + inst, adresse: null, overganger: tr, bekreftet: false}); const r = {status: 'done', punkter_lest: true, antall_objekter: 30, klasser: [{objid: 'notification-class,5', nummer: 5, mottakere: []}, {objid: 'notification-class,6', nummer: 6, mottakere: [m(1234, ['to-offnormal'])]}, {objid: 'notification-class,7', nummer: 7, mottakere: [m(77, [])]}, {objid: 'notification-class,8', nummer: 8, mottakere: null}], kilder: {'analog-input,1': {navn: 'A1', nummer: 5, paa: ['to-offnormal']}, 'analog-input,2': {navn: 'A2', nummer: 6, paa: ['to-offnormal']}, 'analog-input,3': {navn: 'A3', nummer: 9, paa: ['to-offnormal']}, 'analog-input,7': {navn: 'A7', nummer: 5, paa: []}, 'analog-input,4': {navn: 'A4', nummer: 6, paa: []}, 'analog-input,5': {navn: 'A5', nummer: 7, paa: ['to-fault']}, 'analog-input,6': {navn: 'A6', nummer: 8, paa: ['to-fault']}}, innmeldinger: [{objid: 'event-enrollment,1', navn: 'E1', nummer: 5}]}; const a = A.analyserEnhet(r, new Set([1])); const t5 = a.tom.get(5), t7 = a.tom.get(7); const ingen1 = A.analyserEnhet({klasser: [], kilder: {}, innmeldinger: [], antall_objekter: 30, punkter_lest: true}, new Set()).ingen, ingen2 = A.analyserEnhet({klasser: [], kilder: {}, innmeldinger: [], antall_objekter: 5, punkter_lest: true}, new Set()).ingen; A.tilbakestill(); A.settInn('10.0.0.1', r); A.settInn('10.0.0.2', {feil: true}); const dev = [{address: '10.0.0.1', device_instance: 1, object_name: 'X'}, {address: '10.0.0.2', device_instance: 2, object_name: 'Y'}]; const ps = A.poster(dev, null), get = (id) => ps.find(p => p.id === id), uten = A.poster(dev, (id) => id === 'alarmvei-tom'); A.tilbakestill(); return a.tom.size === 2 && t5.kilder.length === 2 && t5.arsak === 'tom' && t7.arsak === 'overganger' && !a.tom.has(8) && a.mangler.size === 1 && a.mangler.get(9)[0].navn === 'A3' && a.av.length === 2 && a.av.some(x => x.navn === 'A4') && a.av.some(x => x.navn === 'A7') && t5.kilder.length === 2 && a.ukjent.length === 2 && a.ukjent.some(u => u.enhet === 1234) && !a.ingen && ingen1 === true && ingen2 === false && get('alarmvei-tom').prio === 1 && /^3 /.test(get('alarmvei-tom').tittel) && /^1 /.test(get('alarmvei-mangler').tittel) && get('alarmvei-av').prio === 3 && /^2 /.test(get('alarmvei-av').tittel) && get('alarmvei-tom').rader[0].navn === 'X' && ps.every(p => p.rader.every(x => x.ip === '10.0.0.1')) && !uten.some(p => p.id === 'alarmvei-tom') && uten.some(p => p.id === 'alarmvei-mangler'); })(),'''


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
              " verdisok: typeof sokeOrd === 'function' && (() => {"
              "  const p = (v) => ({value: v}), t = (q, v) => sokTreff('x', sokeOrd(q), p(v));"
              "  return t('>20', 21) && !t('>20', 20) && t('>=20', 20) && t('<5', 4.5) && t('=0', 0) && !t('=0', 'active')"
              "    && t('20..22', 21) && t('22..20', 21) && !t('20..22', 23) && t('verdi>=20,5', 20.5) && t('x >20', 21)"
              "    && !t('x >20', 'inactive') && sokTreff('rt401', sokeOrd('rt401'), {}) && sokeOrd('-5') && sokeOrd('-5').nei[0] === '5'"
              "    && sokeOrd('>20').ja.length === 0; })(),"
              " excel: typeof exportXlsx === 'function' && !!document.getElementById('xlsxBtn'),"
              " levlogo: typeof levLogo === 'function' && /lev-i-beckhoff/.test(levLogo('Beckhoff')) && /aria-label=.Beckhoff./.test(levLogo('Beckhoff')) && levLogo('Ukjent <x>') === 'Ukjent &lt;x&gt;' && /JCI/.test(levLogo('Johnson C.')),"
              " bjelle: /svg/.test(getComputedStyle(document.documentElement).getPropertyValue('--bjelle')) && (() => { const e = document.createElement('i'); e.className = 'bjelle'; document.body.appendChild(e);"
              "    const ok = parseFloat(getComputedStyle(e).width) > 4; e.remove(); return ok; })() && typeof levLogoCss === 'function',"
              " systemer: typeof systemerAv === 'function' && systemerAv([{name: '360.001-RT401'}, {name: 'A_320_002_X'}, {name: '563.100-A'}, {name: 'Spjeld'}]).join() === '320,360'"
              "    && /360/.test(systemTagger(['360'])) && systemTagger([]) === '' && systemerAv([]).length === 0,"
              " logoer: typeof LEV_LOGO === 'object' && Object.keys(LEV_LOGO).length >= 10 && Object.values(LEV_LOGO).every(v => /^<svg[^>]*viewBox=/.test(v) && !/<(script|image|text)/i.test(v)),"
              " globalede: typeof exportGlobalEde === 'function' && crc32(new TextEncoder().encode('123456789')) === 0xCBF43926 && lagZip([['a/b.txt', 'hei']]).size === 115,"
              " popupro: typeof updateValueCells === 'function' && (() => { document.body.classList.add('har-popup'); window.__verdiStale = false; updateValueCells(['x']);"
              "    const ok = window.__verdiStale === true; document.body.classList.remove('har-popup'); window.__verdiStale = false; return ok; })(),"
              " skannbygg: typeof skannBygg === 'function' && typeof window.skannBygg === 'function',"
              " mobilikon: !!document.getElementById('mobilTopBtn') && !!document.getElementById('mobilTopBtn').title && typeof aapneMobil === 'function',"
              " akkordeon: typeof brukSettAkkordeon === 'function' && (() => { brukSettAkkordeon('oppsett');"
              "    const g = [...document.getElementById('settOppsett').children].filter(x => x.classList.contains('sett-gruppe'));"
              "    return g.length > 3 && !g[0].classList.contains('lukket') && g.slice(1).every(x => x.classList.contains('lukket')); })(),"
              " solbriller: typeof arbeidsklaer === 'function' && (() => { const rot = document.documentElement, t0 = rot.getAttribute('data-theme');"
              "    if ([...document.querySelectorAll('.gs-overlay')].some(o => !o.hidden && o.offsetParent !== null)) return true;"
              "    rot.setAttribute('data-theme', 'light'); const l = arbeidsklaer().nabe.ansikt;"
              "    rot.setAttribute('data-theme', 'dark'); const d = arbeidsklaer().nabe.ansikt;"
              "    if (t0) rot.setAttribute('data-theme', t0); else rot.removeAttribute('data-theme');"
              "    return l === 'solbriller' && d !== 'solbriller'; })(),"
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


def systemer_husket():
    """The systems a device has points in are remembered, so the phone can show them without reading the points itself."""
    kall("/api/sites", {"ranges": ["10.250.0.0/24"], "name": "selvtest-systemer",
                        "devices": [{"address": "127.0.0.6", "device_instance": 9004, "object_name": "SIM-AVVIK", "vendor": "x"}]})
    sites = kall("/api/sites").get("sites", {})
    enh = (sites.get("10.250.0.0/24") or {}).get("enheter") or [{}]
    sjekk("anleggsminnet gir hver enhet en liste med systemer", isinstance(enh[0].get("systemer"), list), str(enh[0]))
    kall("/api/sites/delete", {"key": "10.250.0.0/24"})


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
          st.get("status") == "done" and rt.get("score", 0) >= 40 and abs((rt.get("periode_s") or 0) - 5) <= 1.5, str(rt))   # 60 when the machine is quiet, lower with timing jitter
    # Under last kan pådraget havne under terskelen, og da heter dommen «forstyrrelse». Selve klassifiseringen er testet med regnede serier over.
    sjekk("pendling: opptaket gir et par som pendler", [p["dom"] for p in e.get("par", [])] in (["sloyfe"], ["forstyrrelse"]), str(e.get("par")))


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
    j = {}
    for _forsok in range(6 if r2.get("status") == "done" else 0):   # en simulering som nettopp er startet kan bruke et øyeblikk før den svarer
        j = vent_jobb(kall("/api/scan", {"subnet": "127.0.0.30-31", "mode": "unicast_sweep", "thorough": False,
                                         "per_host_timeout": 1.0, "concurrency": 4, "via": "127.0.0.1"})["job_id"])
        if (j.get("result") or {}).get("count") == 2:
            break
        time.sleep(2.5)
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
    # Where an alarm would go: read from the notification classes and from what reports through them
    alarmsim = []
    i_loop(lambda: alarmsim.append(lag_alarmenhet(9, 9009, "SIM-ALARM")))
    av = kall("/api/device/alarmvei", {"address": "127.0.0.9", "device_instance": 9009})
    kl = {k.get("nummer"): k for k in av.get("klasser", [])}
    ki = {o: v.get("nummer") for o, v in av.get("kilder", {}).items()}
    sjekk("alarmvei: klassen uten mottakere leses som tom, ikke som ukjent", av.get("status") == "done" and kl.get(5, {}).get("mottakere") == [], str(av)[:300])
    sjekk("alarmvei: klassen med en mottaker sier hvem den er og hvilke overganger", len(kl.get(6, {}).get("mottakere") or []) == 1
          and kl[6]["mottakere"][0].get("enhet") == "device,1234" and len(kl[6]["mottakere"][0].get("overganger", [])) == 3, str(kl.get(6))[:300])
    sjekk("alarmvei: punktene sier hvilken klasse de melder gjennom, også en som ikke finnes",
          ki.get("analog-input,1") == 5 and ki.get("analog-input,2") == 6 and ki.get("analog-input,3") == 9 and "analog-input,4" not in ki, str(ki))
    sjekk("alarmvei: uten punktlesing kommer bare klassene", kall("/api/device/alarmvei", {"address": "127.0.0.9", "device_instance": 9009, "punkter": False}).get("kilder") == {})
    i_loop(lambda: alarmsim[0].close())
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
               {"address": "127.0.0.6", "objid": "binary-input,6", "navn": "SIM-PUMPE", "enhet": ""},
               # the loop that does nothing, the switch that stays on, a point nobody answers for, and one that changes too fast
               {"address": "127.0.0.6", "objid": "analog-input,7", "navn": "SIM-RT403", "enhet": "°C"},
               {"address": "127.0.0.6", "objid": "analog-input,8", "navn": "SIM-SB403", "enhet": "%"},
               {"address": "127.0.0.6", "objid": "analog-value,7", "navn": "SIM-RT403-SP", "enhet": "°C"},
               {"address": "127.0.0.6", "objid": "binary-value,1", "navn": "SIM-DRIFT", "enhet": "", "paa": 0.2},
               {"address": "127.0.0.6", "objid": "analog-input,99", "navn": "SIM-FINNES-IKKE", "enhet": "", "stille": 0.2}]
    # A limit on the swinging point: it is above 21.0 for two and a half seconds in every five
    punkter[0]["hoy"] = 21.0
    punkter[1]["fart"] = 100.0           # the valve swings thirty points either way in five seconds
    r = kall("/api/vakt/sett", {"punkter": punkter})
    sjekk("opptak bakover: festede punkter følges", r.get("punkter") == 9, str(r))
    # The same pump recorded to a file, for the count of starts from a recording
    opp = kall("/api/opptak/start", {"punkter": [{"address": "127.0.0.6", "objid": "binary-input,6", "navn": "SIM-PUMPE"}], "intervall": 1})
    time.sleep(40)
    kall("/api/opptak/stopp", {})
    st = kall("/api/vakt")
    sjekk("opptak bakover: punktene leses i bakgrunnen uten at noe annet pågår",
          st.get("aktiv") and st.get("punkter") == 9 and st.get("eldste") is not None, str(st))
    se = kall("/api/vakt/serier", {"minutter": 5})
    n = {s["navn"]: len(s["t"]) for s in se.get("serier", [])}
    sjekk("opptak bakover: det er målinger å se tilbake på",
          len(n) == 9 and n.get("SIM-FINNES-IKKE") == 0 and all(v >= 15 for k, v in n.items() if k != "SIM-FINNES-IKKE"), str(n))
    syk = kall("/api/vakt/sykluser", {}).get("sykluser", [])
    pumpe = next((x for x in syk if x["objid"] == "binary-input,6"), {})
    sjekk("starter per time: en pumpe som starter hvert sjette sekund er funnet, med tall",
          pumpe.get("dom") == "mange" and pumpe.get("per_time", 0) > 300 and 2 <= (pumpe.get("snitt_pa_s") or 0) <= 4 and pumpe.get("starter", 0) >= 3, str(pumpe))
    sjekk("starter per time: et punkt som ikke er av og på er ikke med", all(x["objid"] == "binary-input,6" for x in syk), str(syk))
    sjekk("starter per time: kommer også i statuslista", any(x["objid"] == "binary-input,6" for x in kall("/api/vakt").get("sykluser", [])))
    st2 = kall("/api/vakt")
    ev = st2.get("hendelser", [])
    typer = [e["type"] for e in ev if e["objid"] == "analog-input,2"]
    sjekk("grenser: et punkt som går over grensen gir en hendelse med verdi og grense", "over" in typer and st2.get("grenser") == 4
          and all(e["grense"] == 21.0 and e["verdi"] > 21.0 for e in ev if e["type"] == "over"), str(ev[:3]))
    sjekk("grenser: og når det kommer tilbake sies det", "tilbake" in typer, str(typer))
    sjekk("grenser: bare punktet med nedre eller øvre grense gir grensehendelser", {e["objid"] for e in ev if e["regel"] == "grense"} == {"analog-input,2"},
          str({e["objid"] for e in ev if e["regel"] == "grense"}))
    regler = {(e["objid"], e["regel"], e["type"]) for e in ev}
    paae = next((e for e in ev if e["regel"] == "paa" and e["type"] == "paa_lenge"), {})
    sjekk("flere grenser: en bryter som står på lenger enn tillatt gir hendelse, med minutter og grense",
          ("binary-value,1", "paa", "paa_lenge") in regler and paae.get("grense") == 0.2 and paae.get("verdi", 0) >= 0.2, str(paae))
    sjekk("flere grenser: et punkt som ikke leses på for lenge gir hendelse", ("analog-input,99", "stille", "stille") in regler, str(sorted(regler)))
    fort = next((e for e in ev if e["regel"] == "fart" and e["type"] == "fort"), {})
    sjekk("flere grenser: et punkt som endrer seg for fort gir hendelse, med fart og grense",
          ("analog-input,3", "fart", "fort") in regler and abs(fort.get("verdi", 0)) >= 100 and fort.get("grense") == 100.0, str(fort))
    vk = kall("/api/vakt/virkning", {}).get("virkning", [])
    v403 = next((x for x in vk if "RT403" in x["maling"] and "SP" not in x["maling"]), {})
    sjekk("pådrag uten effekt: en ventil på 100 % og et rom som står under settpunktet er funnet, med tall og kilde",
          v403.get("dom") == "ingen" and v403.get("settpunkt") == 21.0 and v403.get("avvik") == 3.0 and "SB403" in v403.get("padrag", "")
          and v403.get("address") == "127.0.0.6" and v403.get("objid") == "analog-input,7" and v403.get("siden_s", 0) >= 18, str(vk))
    sjekk("pådrag uten effekt: sløyfa som svinger og ventilen som ikke står fullt er ikke med", all("RT402" not in x["maling"] for x in vk) and len(vk) == 1, str(vk))
    sjekk("pådrag uten effekt: kommer også i statuslista", len(kall("/api/vakt").get("virkning", [])) >= 1)
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
          rt.get("dom") in ("pendler", "mulig") and abs((rt.get("periode_s") or 0) - 5) <= 1.5
          and 0 < (rt.get("siden_s") or 0) <= 70 and bool(rt.get("siden_t")), str(rt))   # opptaket er et par minutter gammelt, så starten kan ligge over 40 s tilbake
    sjekk("opptak bakover: RT og SB blir et par som pendler", [p["dom"] for p in pe.get("par", []) if p["dom"] != "rolig"] in (["sloyfe"], ["forstyrrelse"]), str(pe.get("par")))   # se over: «forstyrrelse» når pådraget er under terskelen
    sjekk("opptak bakover: et punkt som ikke beveger seg pendler ikke", flat.get("dom") == "nei", str(flat))
    ek = kall("/api/vakt/eksport", {"minutter": 5})
    linjer = Path(ek.get("fil", "x")).read_text(encoding="utf-8-sig").splitlines() if ek.get("status") == "done" else []
    sjekk("opptak bakover: kan åpnes som CSV, i samme format som et opptak",
          len(linjer) >= 20 and linjer[0].startswith("Time;") or (len(linjer) >= 20 and linjer[0].startswith("Tid;")), str(linjer[:2]))
    lagret = kall("/api/vakt/lagre", {}).get("lagret")
    sjekk("opptak bakover: lagres, så en omstart ikke tømmer det", bool(lagret) and kall("/api/vakt").get("lagret"), str(lagret))
    kall("/api/vakt/sett", {"punkter": []})
    sjekk("opptak bakover: tas et punkt av lista, slutter det", kall("/api/vakt").get("punkter") == 0)


def storm():
    """What comes in is counted, and a rate over the limit is a storm: who sends most, and when it is over."""
    import asyncio as _a
    from bacpypes3.apdu import WhoIsRequest
    from bacpypes3.pdu import Address as _Adr
    kall("/api/start", {"local_address": "127.0.0.1/8"})
    for_ = kall("/api/storm")
    sjekk("storm: roen før noe skjer", for_.get("status") == "done" and not for_.get("aktiv") and for_["terskler"]["whois"] == 5.0, str(for_))

    sendt = []
    # To every adapter NABE has open: some other stack on the loopback (the simulator) may hold the first address too
    mal = [k["ip"] for k in kall("/api/status").get("kort", []) if k.get("ip", "").startswith("127.")] or ["127.0.0.1"]

    async def flod():
        app = APPS["127.0.0.6"]
        for i in range(240):
            f = app.request(WhoIsRequest(destination=_Adr(mal[i % len(mal)])))
            if len(sendt) < 3:
                sendt.append(f)
            await _a.sleep(0.025)
    fut = _a.run_coroutine_threadsafe(flod(), LOOP)
    time.sleep(6)
    d = kall("/api/storm")
    akt = {e["type"]: e for e in d.get("aktiv", [])}
    sjekk("storm: Who-Is i hundrevis gir storm, med hastighet og hvem som sender mest",
          "whois" in akt and akt["whois"]["rate"] >= 5 and akt["whois"]["topp"] and akt["whois"]["topp"][0][0].startswith("127.0.0.6"),
          f"{d.get('rater')} mottatt {d.get('mottatt')} kort {[k['ip'] for k in kall('/api/status').get('kort', [])]} sendt {[(f.done(), repr(f.exception()) if f.done() and not f.cancelled() else '') for f in sendt]} app {APPS['127.0.0.6']._nabe_x if hasattr(APPS['127.0.0.6'], '_nabe_x') else type(APPS['127.0.0.6']).__name__}")
    fut.result(timeout=10)
    for _ in range(40):
        time.sleep(1)
        d = kall("/api/storm")
        if not d.get("aktiv"):
            break
    sjekk("storm: er flommen over, er stormen over, og den står i historikken med slutt",
          not d.get("aktiv") and any(e["type"] == "whois" and e["slutt"] for e in d.get("hist", [])), str(d)[:400])


def regler_fil():
    """The rules file: a template when there is none, and never written over."""
    for_ = kall("/api/regler")
    sjekk("egne regler: ingen fil før den er bedt om", for_.get("status") == "done" and for_.get("finnes") is False and for_.get("fil", "").endswith("regler.json"), str(for_))
    m = kall("/api/regler/mal", {})
    ny = kall("/api/regler")
    mal = json.loads(ny.get("tekst") or "{}")
    sjekk("egne regler: malen lages med eksempler som alle er avslått", m.get("laget") is True and ny.get("finnes") and len(mal.get("regler", [])) == 4
          and all(r["aktiv"] is False for r in mal["regler"]) and "felt" in mal, str(m))
    Path(m["fil"]).write_text('{"versjon": 1, "regler": []}', encoding="utf-8")
    m2 = kall("/api/regler/mal", {})
    sjekk("egne regler: en fil som finnes skrives aldri over", m2.get("laget") is False and kall("/api/regler")["tekst"].startswith('{"versjon"'), str(m2))


def punktlogg_fil():
    """What each point showed on each visit is kept in a file per plant, and the page can get it back."""
    d = {"v": 1, "nokkel": "10.9.9.0/24", "enh": {"10.9.9.1": {"n": "A", "dager": ["2026-06-01"]}}, "pkt": {"10.9.9.1|ai,1": [21.5, 1, "2026-06-01", "2026-06-01", "T", "degrees-celsius", "C"]}}
    ingen = kall("/api/punktlogg?nokkel=" + urllib.parse.quote("10.9.9.0/24"))
    sjekk("punktlogg: ingenting før noe er lagret", ingen.get("status") == "done" and ingen.get("data") is None, str(ingen))
    r = kall("/api/punktlogg", {"nokkel": "10.9.9.0/24", "data": d})
    tilbake = kall("/api/punktlogg?nokkel=" + urllib.parse.quote("10.9.9.0/24"))
    sjekk("punktlogg: det som lagres kommer tilbake likt", r.get("status") == "done" and tilbake.get("data") == d, str(tilbake)[:200])
    annet = kall("/api/punktlogg?nokkel=" + urllib.parse.quote("10.8.8.0/24"))
    sjekk("punktlogg: hvert anlegg har sin egen fil", annet.get("data") is None)
    stor = kall("/api/punktlogg", {"nokkel": "10.9.9.0/24", "data": {"pkt": {"x": ["y" * 1000] * 5000}}})
    sjekk("punktlogg: en for stor fil avvises, og den som finnes røres ikke", stor.get("status") == "error"
          and kall("/api/punktlogg?nokkel=" + urllib.parse.quote("10.9.9.0/24")).get("data") == d, str(stor)[:120])
    ugyldig = kall("/api/punktlogg", {"nokkel": "", "data": {}})
    sjekk("punktlogg: uten anlegg lagres ingenting", ugyldig.get("status") == "error", str(ugyldig))


def arbeidsliste_fil():
    """Which suggestions are done or put aside is kept per plant in a file, and the API has its documentation."""
    d = {"v": 1, "nokkel": "10.9.9.0/24", "poster": {"feil-punkt": {"s": "utfort", "til": 0, "k": ["10.9.9.1|ai,1|A"], "n": 1, "c": 1, "t": 1}}}
    ingen = kall("/api/arbeidsliste?nokkel=" + urllib.parse.quote("10.9.9.0/24"))
    sjekk("arbeidsliste: ingenting før noe er lagret", ingen.get("status") == "done" and ingen.get("data") is None, str(ingen))
    r = kall("/api/arbeidsliste", {"nokkel": "10.9.9.0/24", "data": d})
    tilbake = kall("/api/arbeidsliste?nokkel=" + urllib.parse.quote("10.9.9.0/24"))
    sjekk("arbeidsliste: det som lagres kommer tilbake likt", r.get("status") == "done" and tilbake.get("data") == d, str(tilbake)[:200])
    annet = kall("/api/arbeidsliste?nokkel=" + urllib.parse.quote("10.8.8.0/24"))
    sjekk("arbeidsliste: hvert anlegg har sin egen liste", annet.get("data") is None)
    stor = kall("/api/arbeidsliste", {"nokkel": "10.9.9.0/24", "data": {"x": "y" * 500_000}})
    sjekk("arbeidsliste: for stor fil avvises, den som finnes røres ikke", stor.get("status") == "error"
          and kall("/api/arbeidsliste?nokkel=" + urllib.parse.quote("10.9.9.0/24")).get("data") == d, str(stor)[:120])
    sjekk("arbeidsliste: uten anlegg lagres ingenting", kall("/api/arbeidsliste", {"nokkel": "", "data": {}}).get("status") == "error")
    api = kall("/openapi.json")
    sjekk("API: beskrivelsen finnes med versjon og de viktigste stiene", api.get("info", {}).get("version") == kall("/api/status").get("versjon")
          and "/api/status" in api.get("paths", {}) and "/api/arbeidsliste" in api.get("paths", {}) and bool(api.get("info", {}).get("description")), str(api.get("info"))[:160])
    with urllib.request.urlopen(BASE + "/docs", timeout=10) as dr:
        sjekk("API: dokumentasjonssiden svarer", dr.status == 200 and b"swagger" in dr.read().lower())


def lokal_fil():
    """Koble direkte: ledig adresse, validering, skript og de tre rutene. Selftesten endrer aldri kortet."""
    sys.path.insert(0, str(HER))
    import lokalnett as ln
    n = ln.nett_for("10.42.12.1", 24)
    sjekk("lokal: foreslår .200 i enhetens nett", ln.foreslaa_ip(n, ["10.42.12.1"]) == "10.42.12.200")
    sjekk("lokal: hopper over adresser som er tatt", ln.foreslaa_ip(n, ["10.42.12.200"]) == "10.42.12.201")
    sjekk("lokal: adressen du brukte sist vinner, men bare i riktig nett", ln.foreslaa_ip(n, [], "10.42.12.77") == "10.42.12.77"
          and ln.foreslaa_ip(n, [], "10.9.9.77") == "10.42.12.200")
    sjekk("lokal: et lite nett gir en adresse som ikke er enheten selv", ln.foreslaa_ip(ln.nett_for("192.168.1.10", 30), ["192.168.1.10"]) == "192.168.1.9")
    sjekk("lokal: validering stopper link-lokal, feil maske og navn som ikke finnes",
          ln.valider("Ethernet", "169.254.1.1", 24, ["Ethernet"]) is not None
          and ln.valider("Ethernet", "10.1.1.200", 40, ["Ethernet"]) is not None
          and ln.valider("Ethernet; calc", "10.1.1.200", 24, ["Ethernet"]) is not None
          and ln.valider("Ethernet", "10.1.1.255", 24, ["Ethernet"]) is not None
          and ln.valider("Ethernet", "10.1.1.200", 24, ["Ethernet"]) is None)
    sk = ln.bygg_skript("static", "Ethernet 3", "10.42.12.200", 24)
    sjekk("lokal: skriptet slår av DHCP, setter adressen og siterer navnet",
          "-Dhcp Disabled" in sk and "'10.42.12.200'" in sk and "-PrefixLength 24" in sk and "$n = 'Ethernet 3'" in sk, sk[:200])
    sjekk("lokal: tilbake gir DHCP igjen og fjerner adressen",
          "-Dhcp Enabled" in ln.bygg_skript("tilbake", "Ethernet", "10.42.12.200", 24, True)
          and "-Dhcp Enabled" not in ln.bygg_skript("tilbake", "Ethernet", "10.42.12.200", 24, False))
    sjekk("lokal: I-Am gir enhetsinstansen", ln.les_i_am(bytes.fromhex("810b001401" + "20ffff00ff" + "1000c402000064")) == 100
          and ln.les_i_am(b"hei") is None)
    kort = [{"navn": "Ethernet", "opp": True, "adresser": [{"ip": "169.254.7.3", "prefix": 16}], "linklokal": True, "virtuell": False, "kabel": True},
            {"navn": "Wi-Fi", "opp": True, "adresser": [{"ip": "192.168.50.95", "prefix": 24}], "linklokal": False, "virtuell": False, "kabel": True}]
    hort = [{"ip": "10.42.12.1", "instans": 100, "via": None}, {"ip": "192.168.50.7", "instans": 5, "via": None}]
    f = ln.lag_forslag(hort, kort, {}, None, [])
    sjekk("lokal: bare enheter utenfor PC-ens nett gir forslag, og kortet uten adresse velges",
          len(f) == 1 and f[0]["nett"] == "10.42.12.0/24" and f[0]["ip"] == "10.42.12.200" and f[0]["kort"] == "Ethernet", str(f))
    st = kall("/api/lokal")
    sjekk("lokal: status gir kort, huskede nett og det NABE har satt", st.get("status") == "done" and isinstance(st.get("kort"), list)
          and isinstance(st.get("husket"), list) and isinstance(st.get("satt"), list), str(st)[:200])
    fi = kall("/api/lokal/finn", {"ip": "10.77.5.1"})
    sjekk("lokal: en IP du skriver gir forslag i samme nett", fi.get("status") == "done" and fi["forslag"]
          and fi["forslag"][0]["nett"] == "10.77.5.0/24" and fi["forslag"][0]["ip"] == "10.77.5.200", str(fi)[:300])
    sjekk("lokal: ugyldig IP avvises", kall("/api/lokal/finn", {"ip": "10.77.5"}).get("status") == "error")
    navn = next((k["navn"] for k in st["kort"]), None)
    if navn:
        t = kall("/api/lokal/sett", {"kort": navn, "ip": "10.77.5.200", "prefix": 24, "torr": True})
        sjekk("lokal: tørrkjøring gir kommando uten å endre noe", t.get("status") == "done" and t.get("torr") and "10.77.5.200" in t.get("kommando", "")
              and kall("/api/lokal")["satt"] == [], str(t)[:300])
    sjekk("lokal: ukjent kort avvises før noe sendes til Windows", kall("/api/lokal/sett", {"kort": "Finnes ikke", "ip": "10.77.5.200", "prefix": 24}).get("status") == "error")
    sjekk("lokal: tilbake uten at NABE har satt noe er ufarlig", kall("/api/lokal/tilbake", {"kort": "Finnes ikke"}).get("ingenting") is True)


def mobil_fil():
    """Mobiltilgang: smal port inn, kode, begrenset skriving med automatisk slipp, og Prøv og se svar med tall."""
    import http.cookiejar
    sys.path.insert(0, str(HER))
    import nabe_mobil as nm
    import nabe_svar as nsv
    r = nm.regler("POST", "/api/write", {"address": "a", "objid": "analog-output,1", "value": 1, "priority": 1, "auto_release_min": 99}, True, 10)
    sjekk("mobil: nødprioritet løftes til 8 og slippetiden kuttes", r["ok"] and r["body"]["priority"] == 8 and r["body"]["auto_release_min"] == 10, str(r))
    sjekk("mobil: skriving er blokkert når den er av, men å slippe går", not nm.regler("POST", "/api/write", {"value": 1}, False, 10)["ok"]
          and nm.regler("POST", "/api/write", {"release": True}, False, 10)["ok"])
    sjekk("mobil: bare present-value kan settes", not nm.regler("POST", "/api/write", {"prop": "priority-array", "value": 1}, True, 10)["ok"])
    sjekk("mobil: styringen av porten og alt annet er stengt", all(not nm.regler("POST", s, {}, True, 10)["ok"] for s in ("/api/mobil/skriv", "/api/lokal/sett", "/api/start", "/api/sim/stopp", "/api/readonly"))
          and not nm.regler("GET", "/api/mobil", None, True, 10)["ok"])
    sjekk("mobil: en test som tar lengre enn slippetiden avvises", not nm.regler("POST", "/api/test/svar", {"trinn": [0, 50, 100], "pause_s": 120}, True, 5)["ok"]
          and nm.regler("POST", "/api/test/svar", {"trinn": [0, 50, 100], "pause_s": 30, "prioritet": 2}, True, 10)["body"]["prioritet"] == 8)

    # Sperre mot gjetting: fem feil fra én adresse sperrer den, femten feil fra mange gjør koden ugyldig
    nm.M["kode"], nm.M["kode_til"] = "123456", time.time() + 600
    nm.M["feil_ip"], nm.M["feil_alle"] = {}, []
    ledd = [nm.logg_inn("000000", "10.1.1.9")["ok"] for _ in range(5)]
    sperret = nm.logg_inn("123456", "10.1.1.9")
    annen = nm.logg_inn("123456", "10.1.1.10")
    sjekk("mobil: fem feil sperrer adressen, også for riktig kode, men ikke en annen adresse",
          ledd == [False] * 5 and sperret["ok"] is False and "mange" in sperret["feil"] and annen["ok"] is True, str((sperret, annen)))
    nm.M["kode"], nm.M["kode_til"] = "123456", time.time() + 600
    nm.M["feil_ip"], nm.M["feil_alle"], nm.M["okter"] = {}, [], {}
    for i in range(15):
        nm.logg_inn("999999", f"10.2.0.{i}")
    sjekk("mobil: femten feil fra mange adresser gjør koden ugyldig", nm.M["kode"] is None and nm.logg_inn("123456", "10.3.0.1")["ok"] is False)
    nm.M["kode"], nm.M["kode_til"] = "123456", time.time() - 1
    sjekk("mobil: utløpt kode avvises", nm.logg_inn("123456", "10.4.0.1")["ok"] is False)
    nm.M["kode"], nm.M["kode_til"], nm.M["okter"] = None, 0.0, {}
    nm.M["server"] = object()
    nm.M["kode"], nm.M["kode_til"] = "654321", time.time() + 600
    tok = nm.logg_inn("654321", "10.5.0.1")["token"]
    sjekk("mobil: økt gjelder så lenge porten er på", nm.okt_for(tok) is not None and nm.okt_for("feil") is None and nm.okt_for(None) is None)
    nm.M["okter"][tok]["til"] = time.time() - 1
    sjekk("mobil: utløpt økt avvises", nm.okt_for(tok) is None)
    nm.M["server"] = None
    sjekk("mobil: uten port er alle økter døde", nm.okt_for(tok) is None)
    nm.M["okter"] = {}
    sjekk("mobil: hotspot-status gir et svar uten å endre noe", set(nm.hotspot_status()) == {"paa", "ssid", "passord", "kan", "klienter"})

    # QR-koden: tegnet av nabe-qr.js, kontrollert mot segno og OpenCV da den ble laget. Her vakt mot at noe endrer den.
    node = subprocess.run(["node", "-e", "const q=require('./js/nabe-qr.js');const m=q.make('http://192.168.137.1:8093/m?k=123456');"
                           "const h=require('crypto').createHash('sha1').update(m.modules.map(r=>r.map(b=>b?1:0).join('')).join('')).digest('hex');"
                           "console.log(JSON.stringify({v:m.version,n:m.size,h:h,w:q.wifi('Mitt \"nett\"; 2','p;q'),s:q.svg('A').slice(0,4),"
                           "feil:(()=>{try{q.make('x'.repeat(300));return null}catch(e){return e.message}})()}))"],
                          cwd=str(HER), capture_output=True, text=True, timeout=20)
    try:
        qd = json.loads(node.stdout.strip().splitlines()[-1])
    except Exception:
        qd = {}
    sjekk("qr: adressen med koden gir samme kode som da den ble kontrollert", qd.get("v") == 3 and qd.get("n") == 29
          and qd.get("h") == "0ead653403441de8033db544f99cd782a03070f7", str(qd) + node.stderr[:100])
    sjekk("qr: Wi-Fi-kode skjermer spesialtegn, SVG tegnes, og for lang tekst gir feil",
          qd.get("w") == 'WIFI:T:WPA;S:Mitt \\"nett\\"\\; 2;P:p\\;q;;' and qd.get("s") == "<svg" and "lang" in str(qd.get("feil")), str(qd))
    # Replikkene for igangkjøring følger husreglene: begge språk, ingen tankestrek, ingen utrop
    tekst = (HER / "js" / "nabe-dialoger-igang.js").read_text(encoding="utf-8")
    hend = re.findall(r"^  (\w+): \{pause:", tekst, re.M)
    linjer_ = [l for l in re.findall(r"'((?:[NO]: )?[^']+ \| [^']+)'", tekst)]
    sjekk("replikker: igangkjøringen har hendelser og linjer, alle på to språk", len(hend) >= 10 and len(linjer_) >= 40, f"{len(hend)} hendelser, {len(linjer_)} linjer")
    sjekk("replikker: ingen tankestrek og ingen utrop", "—" not in tekst and "–" not in tekst and "!" not in tekst.replace("!==", "").replace("!=", ""), "")
    sjekk("replikker: NABO skriver med små bokstaver", all(not re.match(r"O: [A-ZÆØÅ]", l) for l in linjer_), str([l for l in linjer_ if re.match(r"O: [A-ZÆØÅ]", l)][:2]))
    # Hotspot: skriptet kan bare slå på noe etter at tørrkjøringen er sjekket, svar tolkes strengt, og feil får en lesbar tekst
    ps = nm.HOTSPOT_SETT_PS
    sjekk("hotspot: tørrkjøring avslutter skriptet før noe slås på", "$Torr" in ps and ps.index("if ($Torr) { Ut @{ok = $true; torr = $true; paa = $false") < ps.index("StartTetheringAsync")
          and ps.count("StartTetheringAsync") == 1 and ps.count("StopTetheringAsync") == 1)
    sjekk("hotspot: tunneler og VPN-kort velges sist som kilde", "fortinet" in ps and "wireguard" in ps and "$skal -= 30" in ps)
    sjekk("hotspot: svaret fra Windows tolkes strengt", nm.tolk_hotspot('{"ok":true,"paa":true,"ssid":"A","passord":"b"}')["ssid"] == "A"
          and nm.tolk_hotspot("rot")["ok"] is False and nm.tolk_hotspot("")["ok"] is False and nm.tolk_hotspot("[1,2]")["ok"] is False)
    sjekk("hotspot: kjente feil får en lesbar tekst, ukjente viser koden", "Wi-Fi" in nm.hotspot_feiltekst({"status": "WiFiDeviceOff"})[0]
          and "Rart" in nm.hotspot_feiltekst({"status": "Rart", "melding": "x"})[0] and nm.hotspot_feiltekst({"status": "IngenKilde"})[1].startswith("Windows has no"))
    th = kall("/api/mobil/hotspot/paa", {"torr": True})
    sjekk("hotspot: tørrkjøring over API-et endrer ingenting", th.get("status") in ("done", "error") and th.get("paa") is not True
          and (th.get("status") == "error" or (th.get("torr") is True and th.get("kilde"))), str(th)[:250])
    ta = kall("/api/mobil/hotspot/av", {"torr": True})
    sjekk("hotspot: avslåing i tørrkjøring endrer ingenting", ta.get("status") in ("done", "error") and ta.get("paa") is not True, str(ta)[:200])

    # Popups med omtanke: hvert overlegg som har en oppføring finnes, og kommentarene under bekreftelsene finnes
    pop = (HER / "js" / "nabe-popup.js").read_text(encoding="utf-8")
    ider = re.findall(r"^    (\w+Overlay): \[", pop, re.M)
    korpus = (HER / "index.html").read_text(encoding="utf-8") + "".join(f.read_text(encoding="utf-8") for f in (HER / "js").glob("*.js")) + (HER / "app.js").read_text(encoding="utf-8")
    savner = [i for i in ider if i not in korpus.replace("js/nabe-popup.js", "")]
    sjekk("popup: hvert overlegg med identitet finnes i appen", len(ider) >= 20 and not [i for i in ider if korpus.count(i) < 2], f"{len(ider)} oppføringer, mangler: {[i for i in ider if korpus.count(i) < 2]}")
    ikoner = set(re.findall(r"^    (\w+): IK\(", pop, re.M))
    brukt = set(re.findall(r"\w+Overlay: \['(\w+)'", pop))
    sjekk("popup: alle ikonene som brukes er tegnet", brukt <= ikoner and len(ikoner) >= 15, str(brukt - ikoner))
    igang = (HER / "js" / "nabe-dialoger-igang.js").read_text(encoding="utf-8")
    sjekk("popup: bekreftelsene har kommentarer å velge mellom", all(f"popup{n}:" in igang for n in ("Skriv", "Frigi", "Slett")))
    appjs = (HER / "app.js").read_text(encoding="utf-8")
    sjekk("popup: skriv og frigi bruker kortet med før og etter", "kort: kortInfo" in appjs and "dlgKortHtml" in appjs and "Skriver til anlegget" in appjs)
    # Appen på hjemskjermen: ikonet er en gyldig PNG i riktig størrelse, og manifestet peker på det
    import struct as _st
    import zlib as _zl
    ik = nm.ikon_png(180)
    w_, h_ = _st.unpack(">II", ik[16:24])
    idat, i_ = b"", 8
    while i_ < len(ik):
        n_ = _st.unpack(">I", ik[i_:i_ + 4])[0]
        if ik[i_ + 4:i_ + 8] == b"IDAT":
            idat += ik[i_ + 8:i_ + 8 + n_]
        i_ += 12 + n_
    sjekk("app: ikonet er en gyldig PNG i riktig størrelse", ik[:8] == b"\x89PNG\r\n\x1a\n" and (w_, h_) == (180, 180) and len(_zl.decompress(idat)) == 180 * (180 * 3 + 1), f"{w_}x{h_}")
    sjekk("app: manifestet vil ha en app uten nettleserramme med ikon", nm.MANIFEST["display"] == "standalone" and nm.MANIFEST["start_url"] == "/m"
          and all(i["src"].startswith("/m/ikon/") for i in nm.MANIFEST["icons"]))
    side = (HER / "nabe_mobil.html").read_text(encoding="utf-8")
    sjekk("app: siden har hjemskjerm-merkene og trygge områder", all(x in side for x in ("apple-mobile-web-app-capable", "apple-touch-icon", "viewport-fit=cover", "env(safe-area-inset-bottom)", "manifest.webmanifest")))
    # Husket telefon: kjennes igjen på MAC-adressen, bare der den skal stoles på
    import tempfile as _tf
    gammel_par, gammel_mac, gammel_server = nm.PAR_FIL, nm.mac_for, nm.M["server"]
    nm.PAR_FIL = Path(_tf.mkdtemp(prefix="nabe-par-")) / "par.json"
    nm.M["server"] = object()
    nm.M["okter"] = {}
    kjente = {"192.168.137.5": "02:11:22:33:44:55", "10.0.0.5": "02:11:22:33:44:55", "192.168.137.6": "02:99:99:99:99:99"}
    nm.mac_for = lambda ip: kjente.get(ip, "")
    try:
        tok0 = nm._ny_okt("192.168.137.5", "iPhone", "Mozilla/5.0 (iPhone)")
        sjekk("par: en telefon uten at den er husket logges ikke inn av seg selv", nm.auto_logg_inn("192.168.137.5") is None)
        r_ = nm.par_ny(nm.okt_id(tok0))
        sjekk("par: å huske en telefon lagrer MAC-adressen og navnet", r_["ok"] and r_["enhet"]["mac"] == "02:11:22:33:44:55" and r_["enhet"]["navn"] == "iPhone", str(r_))
        sjekk("par: en husket telefon på hotspotet får en økt uten kode", nm.okt_for(nm.auto_logg_inn("192.168.137.5", "UA")) is not None)
        sjekk("par: en annen telefon på hotspotet slipper ikke inn", nm.auto_logg_inn("192.168.137.6") is None and nm.auto_logg_inn("192.168.137.77") is None)
        sjekk("par: samme MAC på vanlig nett slipper ikke inn før det er slått på", nm.auto_logg_inn("10.0.0.5") is None)
        nm.par_lan(True)
        sjekk("par: på vanlig nett slipper den inn når PC-eieren har slått det på", nm.okt_for(nm.auto_logg_inn("10.0.0.5")) is not None)
        nm.par_lan(False)
        st_ = nm.par_status()
        sjekk("par: listen viser telefonen med maskert MAC", len(st_["liste"]) == 1 and "••" in st_["liste"][0]["mac"] and "02:11:22:33:44:55" not in str(st_), str(st_))
        nm.par_glem(r_["enhet"]["id"])
        sjekk("par: etter at den er glemt kjennes den ikke igjen", nm.auto_logg_inn("192.168.137.5") is None and nm.par_status()["liste"] == [])
        nm.M["server"] = None
        nm.par_ny("finnes-ikke")
        sjekk("par: uten mobiltilgang på logges ingen inn", nm.auto_logg_inn("192.168.137.5") is None)
        nm.mac_for = lambda ip: ""
        nm.M["server"] = object()
        tok1 = nm._ny_okt("192.168.137.9", "Mobil")
        sjekk("par: finner NABE ikke MAC-adressen, huskes ingenting", nm.par_ny(nm.okt_id(tok1))["ok"] is False)
        sjekk("par: navn fra nettleseren", nm.navn_fra_ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") == "iPhone"
              and nm.navn_fra_ua("Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) Chrome/120") == "Pixel 8 Pro" and nm.navn_fra_ua("") == "Mobil")
        sjekk("par: MAC-adresser normaliseres, og skrot avvises", nm.mac_normaliser("AA-BB-CC-DD-EE-FF") == "aa:bb:cc:dd:ee:ff" and nm.mac_normaliser("xyz") == "")
    finally:
        nm.PAR_FIL, nm.mac_for, nm.M["server"] = gammel_par, gammel_mac, gammel_server
        nm.M["okter"] = {}

    # En telefon er én rad, uansett hvor mange ganger den har logget inn
    nm.M["okter"] = {}
    t1 = nm._ny_okt("10.1.1.1", "iPhone")
    t2 = nm._ny_okt("10.1.1.1", "iPhone")
    t3 = nm._ny_okt("10.1.1.2", "Pixel")
    nm.M["okter"][t1]["sist"] -= 50
    kopi_ = [(nm.okt_id(t), dict(o)) for t, o in nm.M["okter"].items()]
    g_ = nm.gruppe_okter(kopi_)
    sjekk("par: samme telefon vises som én rad, med den nyeste økten", len(g_) == 2 and {o["ip"] for _, o in g_} == {"10.1.1.1", "10.1.1.2"}
          and [oid for oid, o in g_ if o["ip"] == "10.1.1.1"] == [nm.okt_id(t2)], str(g_)[:200])
    sjekk("par: å kaste ut en telefon fjerner alle øktene dens og bare dem", nm.kast_telefon(nm.okt_id(t2)) == 2 and list(nm.M["okter"]) == [t3] and nm.kast_telefon("finnes-ikke") == 0)
    nm.M["okter"] = {}

    # Test oppsettet: ren funksjon fra fakta til en liste, hver linje med status og hva du kan gjøre.
    kabel_ok = {"navn": "Ethernet", "kabel": True, "opp": True, "adresser": [{"ip": "10.42.12.50", "prefix": 24}]}
    bra = nm.sjekkliste({"kort": [kabel_ok], "mobil_paa": True, "port": 8093, "nar": {"10.42.12.50": True}, "skriv": False, "brannmur": True,
                         "hotspot": {"paa": True, "ssid": "NABE", "klienter": 1}, "arp": 3, "wifi": None})
    sjekk("oppsett: alt i orden gir bare ok, og skriving av er ok", all(r["status"] == "ok" for r in bra) and {r["id"] for r in bra} >= {"kabel", "mobil", "nar", "brannmur", "hotspot", "arp", "skriv"}, str([(r["id"], r["status"]) for r in bra]))
    darlig = {r["id"]: r for r in nm.sjekkliste({"kort": [dict(kabel_ok, adresser=[{"ip": "169.254.3.4", "prefix": 16}])], "mobil_paa": True, "port": 8093,
                                                  "nar": {"10.0.0.5": False}, "skriv": True, "brannmur": False, "hotspot": {"paa": False, "kan": True}, "arp": 0, "wifi": "WLAN"})}
    sjekk("oppsett: selvtildelt adresse gir tilbud om Koble direkte", darlig["kabel"]["status"] == "merk" and darlig["kabel"]["fiks"] == "lokal", str(darlig["kabel"]))
    sjekk("oppsett: en port som ikke svarer er en feil, med brannmuren som tiltak", darlig["nar"]["status"] == "feil" and darlig["nar"]["fiks"] == "brannmur", str(darlig["nar"]))
    sjekk("oppsett: manglende brannmurregel og hotspot av har hvert sitt tiltak", darlig["brannmur"]["fiks"] == "brannmur" and darlig["hotspot"]["fiks"] == "hotspot", str((darlig["brannmur"], darlig["hotspot"])))
    sjekk("oppsett: skriving på er et merke, og et ukjent oppslag sier at det er ukjent", darlig["skriv"]["status"] == "merk" and darlig["arp"]["status"] == "ukjent")
    av = {r["id"]: r for r in nm.sjekkliste({"kort": [], "mobil_paa": False, "port": 8093, "nar": {}, "skriv": False, "brannmur": None, "hotspot": {}, "arp": 1, "wifi": None})}
    sjekk("oppsett: mobiltilgang av gir tiltaket Slå på, og ingen porttest", av["mobil"]["fiks"] == "start" and "nar" not in av and av["brannmur"]["status"] == "ukjent", str(list(av)))
    sjekk("oppsett: sammendraget teller", nm.sjekk_sammendrag(bra)["ok"] == len(bra) and nm.sjekk_sammendrag(list(darlig.values()))["feil"] == 1)
    sjekk("oppsett: titler og detaljer finnes på begge språk", all(len(r["tittel"]) == 2 and all(r["tittel"]) for r in list(darlig.values()) + bra))
    # Offentlig nett uten regel er en feil, ikke et råd. Et gjestenett får en egen advarsel. Sperret hotspot sier hvorfor.
    off = {r["id"]: r for r in nm.sjekkliste({"kort": [], "mobil_paa": True, "port": 8093, "nar": {"192.168.2.5": True}, "skriv": False, "brannmur": False,
                                               "hotspot": {"paa": False, "kan": True}, "arp": 0, "wifi": "Wi-Fi", "hotspot_sperret": True,
                                               "wifi_profil": {"navn": "Firma Gjest", "kat": "Public"}})}
    sjekk("oppsett: offentlig nett uten brannmurregel er en feil med tiltaket Åpne", off["brannmur"]["status"] == "feil" and off["brannmur"]["fiks"] == "brannmur" and "Firma Gjest" in off["brannmur"]["tittel"][0] + off["brannmur"]["detalj"][0], str(off["brannmur"]))
    sjekk("oppsett: gjestenett får egen advarsel, og sperret hotspot har ikke tiltaket Slå på", off["wifi_iso"]["status"] == "merk" and off["hotspot"]["fiks"] == "" and "sperret" in off["hotspot"]["tittel"][0], str((off.get("wifi_iso"), off["hotspot"])))
    privat = {r["id"]: r for r in nm.sjekkliste({"kort": [], "mobil_paa": True, "port": 8093, "nar": {}, "skriv": False, "brannmur": False, "hotspot": {}, "arp": 0, "wifi": "Wi-Fi",
                                                  "wifi_profil": {"navn": "Kontor", "kat": "Private"}})}
    sjekk("oppsett: privat nett uten regel er bare et merke, og vanlig navn gir ingen gjestevarsel", privat["brannmur"]["status"] == "merk" and "wifi_iso" not in privat)

    # Loggen over hva telefonen gjorde: strukturert, i en fil, nyeste først, og den holder seg liten.
    import tempfile as _tf
    _gammel = nm.LOGG_FIL
    with _tf.TemporaryDirectory() as _d:
        nm.LOGG_FIL = Path(_d) / "logg.jsonl"
        try:
            nm.M["logg"].clear()
            nm.logg("a1", "Satte 50 på analog-value,1 @ 10.0.0.5", type="skriv", navn="iPhone", ip="10.0.0.9", enhet="10.0.0.5", punkt="analog-value,1", verdi=50, ok=True)
            nm.logg("a1", "Slapp analog-value,1 @ 10.0.0.5", type="slipp", navn="iPhone", ok=True)
            h = nm.logg_historikk()
            sjekk("mobillogg: nyeste først, med navn, enhet, punkt og verdi", [x["type"] for x in h] == ["slipp", "skriv"] and h[1]["navn"] == "iPhone" and h[1]["verdi"] == 50 and h[1]["enhet"] == "10.0.0.5", str(h))
            nm.M["logg"].clear()
            sjekk("mobillogg: ligger i filen, så den overlever at porten slås av", len(nm.logg_historikk()) == 2)
            for i in range(nm.LOGG_MAKS + 300):
                nm.logg("a1", "x" * 800 + str(i))
            sjekk("mobillogg: filen holder seg liten og beholder de nyeste", nm.LOGG_FIL.stat().st_size < 500_000 and nm.logg_historikk(5)[0]["tekst"].endswith(str(nm.LOGG_MAKS + 299)), str(nm.LOGG_FIL.stat().st_size))
        finally:
            nm.LOGG_FIL = _gammel
            nm.M["logg"].clear()
    sjekk("mobillogg: telefonen når ikke sjekk, logg eller tømming, men kan lese testhistorikken",
          not nm.regler("POST", "/api/mobil/sjekk", {}, True, 10)["ok"] and not nm.regler("GET", "/api/mobil/logg", None, True, 10)["ok"]
          and not nm.regler("POST", "/api/mobil/logg/tom", {}, True, 10)["ok"] and nm.regler("GET", "/api/test/svar-historikk", None, False, 10)["ok"])

    # Telefonsiden og PC-dialogen har det de skal ha for å tåle tapt kontakt, holde skjermen våken og vise før og etter.
    _html = (HER / "nabe_mobil.html").read_text(encoding="utf-8")
    sjekk("mobilside: tapt kontakt, våken skjerm, vibrasjon og før og etter finnes",
          all(x in _html for x in ("function kobling(", "navigator.wakeLock.request", "const hapt =", "function forEtter(", "svar-historikk", "Mistet kontakten med PC-en")))
    _js = (HER / "js" / "nabe-mobil.js").read_text(encoding="utf-8") + (HER / "js" / "nabe-besok.js").read_text(encoding="utf-8")
    sjekk("mobildialog: test oppsettet, logg som kan kopieres og lastes ned, og testene i rapporten", all(x in _js for x in ("sjekkHtml", "logg-csv", "/api/mobil/sjekk", "svarRader", "telefonRader")))

    # Brukeren vil ikke ha statusprikker (farget ●-prikk som sier at noe er på, av eller tilkoblet). Aldri, i noe UI.
    kilder = "".join((HER / f).read_text(encoding="utf-8") for f in ("nabe.css", "nabe_mobil.html", "app.js", "index.html")) \
        + "".join(f.read_text(encoding="utf-8") for f in (HER / "js").glob("*.js"))
    forbudt = ("prot-prikk", "tp-prikk", "fo-prikk", "ss-prikk", "lk-puls", "ss-funn i{", "nabo-prikk", "kort-brikke i{", ".an-rad .prikk", "pille::before",
               "lokal-rad.aktiv::before", "delvis::after", ".mb-ok i{", "sk-prikk", "content:'● '",
               "dev-ip::before", ".vsub-prikk{width", ".prot-skille i{width", "prot-filter button i{width")
    funnet = [x for x in forbudt if x in kilder]
    sjekk("ingen statusprikker: de er fjernet og kommer ikke tilbake", not funnet, str(funnet))
    sjekk("ingen statusprikker: tilstand står med ord eller symbol", "fo-prio" in kilder and "ss-ny" in kilder and "nabo-pa" in kilder and "lk-stolpe" in kilder)
    # En regnet respons: første ordens, dødtid 3 s, tidskonstant 8 s, 0,25 grader per prosent
    def serie(fra, til, v0, n=30):
        ut = []
        for t in range(n):
            v = v0 if t < 3 else v0 + (til - fra) * 0.25 * (1 - 2.718281828 ** (-(t - 3) / 8.0))
            ut.append((float(t), round(v, 3)))
        return ut
    s1 = nsv.analyser_steg(20.0, serie(0, 50, 20.0), 0, 50, 0.01)
    sjekk("svar: dødtid og 63 % regnes ut fra serien", s1["reagerte"] and 3 <= s1["dode_s"] <= 5 and 10 <= s1["t63_s"] <= 14, str(s1))
    s2 = nsv.analyser_steg(s1["slutt"], serie(50, 100, s1["slutt"]), 50, 100, 0.01)
    r2 = nsv.oppsummer([s1, s2], 30)
    sjekk("svar: forsterkning per 10 % og jevnt svar", abs(r2["per_10"] - 2.5 * 0.9) < 0.6 and r2["lineaer"] is True and r2["retning"] == "opp", str(r2))
    flat = nsv.analyser_steg(20.0, [(float(t), 20.0 + (0.004 if t % 2 else -0.004)) for t in range(30)], 0, 100, 0.005)
    sjekk("svar: støy er ikke respons", not flat["reagerte"] and nsv.oppsummer([flat], 30)["dom"] == "ingen", str(flat))

    # Bruker enhet 127.0.0.3 som resten av testen allerede har skrevet til. Kjøres sist, så den ikke forstyrrer andre.
    addr = "127.0.0.3"
    PAD = "analog-value,1"
    G = "http://127.0.0.1:18093"
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)).open

    def g(sti, data=None, hdr=None):
        h = {"Content-Type": "application/json"}
        h.update(hdr if hdr is not None else {"X-Nabe": "1"})
        req = urllib.request.Request(G + sti, data=None if data is None else json.dumps(data).encode(), headers=h)
        try:
            with op(req, timeout=60) as rr:
                return rr.status, json.loads(rr.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except Exception:
                return e.code, {}
    try:
        st = kall("/api/mobil/start", {})
        sjekk("mobil: porten slås på med kode", st.get("paa") and len(st.get("kode") or "") == 6, str(st)[:200])
        kode = st["kode"]
        sjekk("mobil: uten innlogging kommer ingenting gjennom", g("/api/poll", {"targets": {}})[0] == 401)
        sjekk("mobil: feil kode avvises", g("/m/logginn", {"kode": "x" + kode})[0] == 403)
        sjekk("mobil: innlogging uten X-Nabe-header avvises", g("/m/logginn", {"kode": kode}, {})[0] == 403)
        sjekk("mobil: riktig kode gir økt", g("/m/logginn", {"kode": kode})[1].get("ok") is True)
        sjekk("mobil: styringen av porten er stengt for telefonen", all(g(s, {} if s not in ("/api/mobil", "/api/lokal") else None)[0] == 403 for s in ("/api/mobil", "/api/lokal", "/api/lokal/sett", "/api/mobil/skriv", "/api/start")))
        sjekk("mobil: skriving er av som standard, slipp virker", g("/api/write", {"address": addr, "objid": PAD, "value": 50, "priority": 8})[0] == 403
              and g("/api/write", {"address": addr, "objid": PAD, "release": True, "priority": 8})[0] == 200)
        kall("/api/mobil/skriv", {"tillat": True})
        kall("/api/mobil/maks", {"min": 5})
        c, w = g("/api/write", {"address": addr, "objid": PAD, "value": 55, "priority": 1, "auto_release_min": 999})
        sjekk("mobil: skriving virker når den er på, med kuttet slippetid", c == 200 and w.get("status") == "done" and w.get("auto_release_min") == 5, str(w))
        sjekk("mobil: nødprioritet ble 8 i skrivelogg", kall("/api/writelog")["entries"][0].get("priority") == 8)
        c, t = g("/api/test/svar", {"address": addr, "padrag": PAD, "maaling": PAD, "trinn": [0, 100], "pause_s": 6, "prioritet": 2})
        sjekk("svar: starter fra mobil", c == 200 and t.get("status") == "started", str(t))
        sjekk("svar: en test til samtidig avvises", g("/api/test/svar", {"address": addr, "padrag": PAD, "maaling": PAD, "trinn": [0], "pause_s": 5})[1].get("status") == "error")
        d = {}
        for _ in range(60):
            d = g("/api/test/svar/" + t["id"])[1].get("test", {})
            if d.get("fase") == "ferdig":
                break
            time.sleep(1)
        sjekk("svar: testen går til ende med to trinn, dom og måleserie", d.get("status") == "ferdig" and len(d.get("steg", [])) == 2 and len(d.get("serie", [])) >= 10 and d["resultat"]["dom"] in ("ingen", "ok", "treg"), str(d)[:300])
        sjekk("svar: pådraget slippes til slutt", d.get("sluppet") is True and kall("/api/writelog")["entries"][0].get("action") == "release", str(d.get("feil")))
        c, a = g("/api/test/svar", {"address": addr, "padrag": "binary-value,1", "maaling": "analog-input,0"})
        sjekk("svar: bare analoge pådrag", a.get("status") == "error")
        for sti, typ in (("/m/manifest.webmanifest", "manifest"), ("/m/ikon/180.png", "image/png"), ("/m/ikon/512.png", "image/png")):
            try:
                with urllib.request.urlopen(G + sti, timeout=30) as rr:
                    ok_ = rr.status == 200 and typ in rr.headers.get("content-type", "") and (sti.endswith(".png") is False or rr.read(8) == b"\x89PNG\r\n\x1a\n")
            except Exception as e_:
                ok_ = False
            sjekk(f"app: {sti} serveres uten innlogging", ok_)
        try:
            urllib.request.urlopen(G + "/m/ikon/999.png", timeout=10)
            sjekk("app: ukjent ikonstørrelse gir 404", False)
        except urllib.error.HTTPError as e_:
            sjekk("app: ukjent ikonstørrelse gir 404", e_.code == 404)
        # Husk telefonen og se at den kjennes igjen av en ny nettleser uten kode
        def ny_leser(sti):
            op_ = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())).open
            try:
                with op_(urllib.request.Request(G + sti), timeout=30) as rr:
                    return rr.status, json.loads(rr.read() or b"{}") if sti == "/m/me" else {}
            except urllib.error.HTTPError as e_:
                return e_.code, {}
        kall("/api/mobil/par/lan", {"tillat": False})
        okt_ = kall("/api/mobil")["okter"][0]
        sjekk("par: en innlogget telefon kan huskes", okt_["kan_pare"] is True and okt_["par"] is False, str(okt_))
        pst = kall("/api/mobil/par", {"id": okt_["id"]})
        sjekk("par: å huske den gir en oppføring og merker økten", len(pst["par"]["liste"]) == 1 and pst["okter"][0]["par"] is True, str(pst.get("par"))[:200])
        sjekk("par: en ny nettleser slipper ikke inn utenfor hotspotet", ny_leser("/m/me")[0] == 401)
        kall("/api/mobil/par/lan", {"tillat": True})
        c_, d_ = ny_leser("/m/me")
        sjekk("par: med «vanlig Wi-Fi» på slipper den husket telefonen inn uten kode", c_ == 200 and d_.get("kjent") is True, f"{c_} {d_}")
        kall("/api/mobil/par/glem", {"id": pst["par"]["liste"][0]["id"]})
        sjekk("par: etter at den er glemt er den ute igjen", ny_leser("/m/me")[0] == 401 and kall("/api/mobil")["par"]["liste"] == [])
        kall("/api/mobil/par/lan", {"tillat": False})
        sjekk("mobil: logg viser hva telefonen gjorde", any("Satte 55" in l["tekst"] for l in kall("/api/mobil")["logg"]))
        sk = next((l for l in kall("/api/mobil/logg").get("logg", []) if l.get("type") == "skriv"), {})
        sjekk("mobillogg: skrivingen står med telefon, enhet, punkt, verdi og at den gikk gjennom",
              sk.get("enhet") == addr and sk.get("punkt") == PAD and sk.get("verdi") == 55 and sk.get("ok") is True and bool(sk.get("navn")) and bool(sk.get("ip")), str(sk))
        sjekk("mobillogg: også testen og slippet står i loggen", {"test", "slipp"} <= {l.get("type") for l in kall("/api/mobil/logg").get("logg", [])})
        sjekk("mobillogg: styringen er stengt for telefonen", g("/api/mobil/sjekk", {})[0] == 403 and g("/api/mobil/logg")[0] == 403 and g("/api/mobil/logg/tom", {})[0] == 403)
        hi = g("/api/test/svar-historikk?padrag=" + urllib.parse.quote(PAD) + "&address=" + addr)[1].get("tester", [])
        sjekk("svar: den ferdige testen er husket med tall, og kan hentes fra telefonen",
              any(x["id"] == t["id"] and len(x["steg"]) == 2 and x["resultat"] and x["address"] == addr for x in hi), str(hi)[:300])
        sjekk("svar: historikken kan filtreres bort", not kall("/api/test/svar-historikk?padrag=analog-output,99").get("tester"))
        sj = kall("/api/mobil/sjekk", {})
        sjekk("oppsett: sjekken svarer fra serveren med liste og sammendrag", sj.get("status") == "done" and {"kabel", "mobil", "hotspot"} <= {r["id"] for r in sj.get("sjekk", [])}
              and sum(sj["sammendrag"].values()) == len(sj["sjekk"]), str(sj)[:300])
        sjekk("oppsett: mobiltilgang som er på står som ok", next((r["status"] for r in sj["sjekk"] if r["id"] == "mobil"), "") == "ok")
    finally:
        kall("/api/mobil/stopp", {})
    try:
        g("/m/me")
        sjekk("mobil: porten er lukket etter stopp", False)
    except Exception:
        sjekk("mobil: porten er lukket etter stopp", True)


def laering_fil():
    """What the technician has taught NABE is kept per plant, with the last version beside it, and the start page keeps a count per plant."""
    k = "10.9.8.0/24"
    ingen = kall("/api/laering?nokkel=" + urllib.parse.quote(k))
    sjekk("laering: ingenting før noe er lagret", ingen.get("status") == "done" and ingen.get("data") is None, str(ingen))
    d1 = {"v": 1, "nokkel": k, "poster": {"dode|#7|ai,1": {"id": "dode", "til": 9999999999999}}, "monster": [], "avslatt": []}
    d2 = {"v": 1, "nokkel": k, "poster": {}, "monster": [{"id": "dode", "ord": "reserve", "til": 9999999999999}], "avslatt": []}
    kall("/api/laering", {"nokkel": k, "data": d1})
    kall("/api/laering", {"nokkel": k, "data": d2})
    tilbake = kall("/api/laering?nokkel=" + urllib.parse.quote(k))
    sjekk("laering: det som lagres kommer tilbake likt", tilbake.get("data") == d2, str(tilbake)[:200])
    import hashlib
    bak = Path(DATAMAPPE) / "laering" / (hashlib.sha1(k.encode("utf-8")).hexdigest()[:20] + ".bak")
    sjekk("laering: forrige versjon ligger ved siden av", bak.exists() and json.loads(bak.read_text(encoding="utf-8")) == d1, str(bak))
    sjekk("laering: uten anlegg lagres ingenting", kall("/api/laering", {"nokkel": "", "data": {}}).get("status") == "error")
    kall("/api/sites", {"ranges": [k], "devices": [{"address": "10.9.8.1", "device_instance": 1, "object_name": "A"}]})
    st = {"p1": 2, "p2": 1, "p3": 4, "nye": 1, "utfort": 3, "laert": 5, "lest": 1, "totalt": 1,
          "topp": [{"id": "feil-punkt", "tittel": "2 punkter med feil", "prio": 1}, {"id": "x", "tittel": "y", "prio": 3}, {"id": "z", "tittel": "w", "prio": 3}, {"id": "q", "tittel": "r", "prio": 3}]}
    r = kall("/api/sites/status", {"key": k, "status": st})
    site = kall("/api/sites").get("sites", {}).get(k, {})
    s = site.get("status", {})
    sjekk("anlegg: tallene for startsiden lagres med anlegget", r.get("status") == "done" and s.get("p1") == 2 and s.get("p3") == 4 and s.get("nye") == 1
          and len(s.get("topp", [])) == 3 and s.get("t", 0) > 0, str(s)[:200])
    sjekk("anlegg: et anlegg NABE ikke kjenner får ingen tall", kall("/api/sites/status", {"key": "10.9.7.0/24", "status": st}).get("status") == "skip")
    kall("/api/sites/status", {"key": k, "status": dict(st, p1=0, siden={"n": 3, "verst": 1})})
    s2 = kall("/api/sites").get("sites", {}).get(k, {})
    sjekk("anlegg: tellinger samme dag overskriver hverandre, og «siden sist» følger med", len(s2.get("hist", [])) == 1 and s2["hist"][0]["a"] == 5
          and s2.get("status", {}).get("siden") == {"n": 3, "verst": 1}, str(s2.get("hist"))[:160])
    kall("/api/sites/delete", {"key": k})
    import hashlib as _h
    ko = "10.9.6.0/24"
    naa = time.time()
    vis = lambda t, a, b2: {"t": t, "key": ko, "enheter": {"10.9.6.1": {"n": "X", "p": {"ao,1": ["P1", 1, a, ""], "ao,2": ["P2", 1, b2, ""]}}}}
    (Path(DATAMAPPE) / "besok").mkdir(exist_ok=True)
    (Path(DATAMAPPE) / "besok" / (_h.sha256(ko.encode("utf-8")).hexdigest()[:24] + ".json")).write_text(
        json.dumps([vis(naa - 20 * 86400, "overridden", ""), vis(naa - 10 * 86400, "overridden", ""), vis(naa - 1 * 86400, "overridden", "overridden")]), encoding="utf-8")
    ov = kall("/api/besok/overstyrt?key=" + urllib.parse.quote(ko))
    p1, p2 = ov.get("punkter", {}).get("10.9.6.1|ao,1", {}), ov.get("punkter", {}).get("10.9.6.1|ao,2", {})
    sjekk("overstyrt: alderen telles tilbake gjennom besøkene som så det, og et punkt som ikke var det før er nytt",
          ov.get("besok") == 3 and p1.get("besok") == 3 and abs(p1.get("siden", 0) - (naa - 20 * 86400)) < 5 and p2.get("besok") == 1, str(ov)[:200])
    sjekk("overstyrt: ukjent anlegg gir tomt svar", kall("/api/besok/overstyrt?key=ingen").get("punkter") == {})
    b = kall("/api/bevis")
    sjekk("bevis: antall lesinger, skriv og enheter telles fra trafikkloggen", b.get("status") == "done" and b.get("lesinger", 0) > 0 and b.get("skriv", 0) >= 1
          and b.get("enheter", 0) >= 2 and b.get("fra") and b["til"] >= b["fra"] and b["antall"] >= b["lesinger"] + b["skriv"], str(b)[:260])


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


def standardregler():
    """Reglene som følger med for varme, kjøling og ventilasjon: gyldige, på norsk og engelsk, med egne id-er."""
    d = kall("/api/regler")
    std = json.loads(d.get("standard") or "{}")
    r = std.get("regler") or []
    ider = [x.get("id") for x in r]
    felt = {"id", "aktiv", "tittel", "hvorfor", "sjekk", "prio", "minst", "per_enhet", "naar"}
    naar = {"navn", "beskrivelse", "type", "enhet", "verdi", "tilstand", "status", "ikke_status", "enhetsnavn", "leverandor", "protokoll"}
    sjekk("standardregler: minst åtte, hver med egen id som starter med std-", len(r) >= 8 and len(set(ider)) == len(ider) and all(str(i).startswith("std-") for i in ider), str(ider))
    sjekk("standardregler: bare kjente felt og krav", all(set(x) <= felt and set(x.get("naar", {})) <= naar for x in r), str([x["id"] for x in r if not set(x) <= felt or not set(x.get("naar", {})) <= naar]))
    sjekk("standardregler: tekstene finnes på norsk og engelsk", all(isinstance(x.get("tittel"), dict) and x["tittel"].get("no") and x["tittel"].get("en") for x in r))
    mal = []
    for x in r:
        for k in ("navn", "beskrivelse", "enhetsnavn", "leverandor"):
            if k in x["naar"]:
                try:
                    re.compile(x["naar"][k], re.I)
                except re.error as e:
                    mal.append(f"{x['id']}.{k}: {e}")
    sjekk("standardregler: alle regulære uttrykk lar seg tolke", not mal, "; ".join(mal))
    sys320 = next((x for x in r if x["id"] == "std-overstyrt-varme"), None)
    sjekk("standardregler: systemnummeret treffer 320.012 og G_320_014_RT41, men ikke 3200 eller 1320",
          bool(sys320) and all(bool(re.search(sys320["naar"]["navn"], n)) == ok for n, ok in [("320.012-RT", True), ("G_320_014_RT41", True), ("A-3200-1", False), ("X1320_1", False)]))


def excel():
    """The point list as a real Excel file: read back, the numbers are still numbers and the odd characters survive."""
    import io, zipfile
    import nabe_modbus as nmb
    import nabe_xlsx
    ark = [{"navn": "Punkter", "rader": [["Navn", "Verdi", "Beskrivelse"], ["RT401", 21.5, "Rom <nord> & \"sør\""], ["SB401", 100, "Pådrag æøå"],
                                          ["X", None, "linje\x07"]]},
           {"navn": "Punkter", "rader": [["a"], [True]]}, {"navn": "Bad/name:*?[]" + "x" * 40, "rader": [[]]}]
    data = nabe_xlsx.skriv_xlsx(ark)
    z = zipfile.ZipFile(io.BytesIO(data))
    navn = re.findall(r'name="([^"]+)"', z.read("xl/workbook.xml").decode())
    sjekk("excel: arkene får gyldige og ulike navn", len(set(n.lower() for n in navn)) == 3 and all(len(n) <= 31 and not re.search(r"[\[\]*?/\\:]", n) for n in navn), str(navn))
    rader = nmb.read_xlsx(data)
    sjekk("excel: lest tilbake er teksten uendret (æøå, <, &, anførselstegn)", rader[1][2] == 'Rom <nord> & "sør"' and rader[2][2] == "Pådrag æøå", str(rader[:3]))
    sjekk("excel: tall er tall, ikke tekst", b'<c r="B2"><v>21.5</v></c>' in z.read("xl/worksheets/sheet1.xml") and b'<c r="B3"><v>100</v></c>' in z.read("xl/worksheets/sheet1.xml"))
    sjekk("excel: kontrolltegn fjernes og tomme celler hoppes over", "\x07" not in z.read("xl/worksheets/sheet1.xml").decode() and b'r="B4"' not in z.read("xl/worksheets/sheet1.xml"))
    sjekk("excel: overskriften står fast og har filter", b'state="frozen"' in z.read("xl/worksheets/sheet1.xml") and b"<autoFilter" in z.read("xl/worksheets/sheet1.xml"))
    req = urllib.request.Request(BASE + "/api/xlsx", data=json.dumps({"filnavn": "bacnet 9001/æ", "ark": ark[:1]}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Origin": BASE})
    with urllib.request.urlopen(req, timeout=20) as r:
        hode, kropp = r.headers, r.read()
    sjekk("excel: serveren gir en .xlsx-fil som kan lagres", kropp[:2] == b"PK" and "spreadsheetml" in hode.get("Content-Type", "")
          and ".xlsx" in hode.get("Content-Disposition", "") and "/" not in hode.get("Content-Disposition", "").split("filename=")[1], hode.get("Content-Disposition", ""))
    sjekk("excel: serveren leser den tilbake", nmb.read_xlsx(kropp)[1][0] == "RT401")


def statiske_filer():
    """Siden sjekkes ved hver lasting, men filene den peker på hentes bare én gang per versjon: adressene bærer versjonen."""
    import gzip
    def hent(sti, hodet=None):
        req = urllib.request.Request(BASE + sti, headers=dict({"Accept-Encoding": "gzip"}, **(hodet or {})))
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raa = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raa = gzip.decompress(raa)
                return r.status, {k.title(): v for k, v in r.headers.items()}, raa
        except urllib.error.HTTPError as e:
            return e.code, {k.title(): v for k, v in e.headers.items()}, b""
    c, h, raa = hent("/")
    tekst = raa.decode("utf-8")
    scripts = re.findall(r'src="(/(?:app\.js|js/[a-z0-9-]+\.js)\?v=[0-9a-f]{10})"', tekst)
    n_lokale = len(re.findall(r'src="/(?:app\.js|js/[a-z0-9-]+\.js)', tekst))
    sjekk("statiske filer: hvert skript og stilark får versjon i adressen", c == 200 and len(scripts) == n_lokale > 40 and re.search(r'href="/nabe\.css\?v=[0-9a-f]{10}"', tekst) is not None, f"{len(scripts)} av {n_lokale}")
    sjekk("statiske filer: siden selv sjekkes hver gang, med ETag", h.get("Cache-Control") == "no-cache" and bool(h.get("Etag")), str(h.get("Cache-Control")))
    c304, _, _ = hent("/", {"If-None-Match": h.get("Etag", "")})
    sjekk("statiske filer: uendret side gir 304", c304 == 304)
    c2, h2, b2 = hent(scripts[0])
    sjekk("statiske filer: riktig versjon kan beholdes for alltid", c2 == 200 and "immutable" in h2.get("Cache-Control", "") and len(b2) > 100, str(h2.get("Cache-Control")))
    c3, h3, _ = hent(scripts[0].split("?")[0] + "?v=0000000000")
    sjekk("statiske filer: gammel versjon beholdes ikke", c3 == 200 and h3.get("Cache-Control") == "no-cache", str(h3.get("Cache-Control")))
    c4, h4, _ = hent("/js/finnes-ikke.js?v=abc")
    sjekk("statiske filer: ukjent skript gir 404", c4 == 404)


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
    systemer_husket()
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
    storm()
    regler_fil()
    punktlogg_fil()
    arbeidsliste_fil()
    laering_fil()
    lokal_fil()
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

    for fil in ("nabe-start", "nabe-verktoy", "nabe-felt", "nabe-moro", "nabe-finn", "nabe-skann", "nabe-anlegg", "nabe-bunn", "nabe-graf", "nabe-tunnel", "nabe-sammen", "nabe-flyt", "nabe-peker", "nabe-pekere", "nabe-skrift", "nabe-lev", "nabe-lev-logo", "nabo", "nabo-brodre", "nabo-fasit", "nabe-garderobe", "nabe-opptak", "nabe-trafikk", "nabe-forslag", "nabe-storm", "nabe-regler", "nabe-drift", "nabe-punktlogg", "nabe-arbeidsliste", "nabe-laer", "nabe-status", "nabe-alarmvei", "nabe-lokal", "nabe-qr", "nabe-mobil", "nabe-popup", "nabe-dialoger-igang", "nabe-nett", "nabe-alarmhist", "nabe-grenser", "nabe-sat", "nabe-stotte", "nabe-kart-eksport", "nabe-modbus", "nabe-knx", "nabe-rediger", "nabe-besok", "nabe-runde", "nabe-skjema-ordbok", "nabe-skjema", "nabe-flater", "nabe-fortsett", "nabe-simulator", "nabe-oppdatering", "nabe-bakover", "nabe-kart", "nabe-syn", "nabe-raad", "nabe-dialoger-innhold", "nabe-dialoger-mer", "nabe-dialoger", "nabe-tilbehor", "nabe-kunnskap", "nabe-spor"):
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
    statiske_filer()
    excel()
    standardregler()
    mobil_fil()


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
    global DATAMAPPE
    DATAMAPPE = data
    env = dict(os.environ, NABE_ALLOWED_ORIGINS=BASE, NABE_DATA=data,
               NABE_MB_LEDIG="4", NABE_COV_LIFETIME="6", NABE_COV_PAA_NYTT="3", NABE_TILLAT_LOOPBACK="1", NABE_VAKT_SEK="1", NABE_SYK_MIN_S="20",
               NABE_VIRKNING_MIN="0.3", NABE_FART_S="8", NABE_STORM_WHOIS="5", NABE_STORM_VINDU="4", NABE_MOBIL_PORT="18093", NABE_MOBIL_MAC_TEST="127.0.0.1=02:00:00:aa:bb:cc")
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
