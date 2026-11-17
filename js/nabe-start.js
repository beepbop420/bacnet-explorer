/* NABE - start screen, alarms, routers and usage
   Loaded after app.js and shares its globals (S, $, api, toast, nabeSier ...).
   Kept apart so app.js does not have to carry everything. */
'use strict';

/* =============================================================== NABE 1.1
   Alarms, routers, the start screen, and the small things that happen when
   the tool has been used a lot. New text is written in both languages here
   with T(), and the containers are left out of the language sweep, so nothing
   is translated twice. */
let NABE_VERSJON = '';
fetch('/api/status').then(r => r.json()).then(d => {
  NABE_VERSJON = (d.versjon || '') + (d.mini ? ' Mini' : '');
  // Mini: no local AI and no self-update, so their controls are not shown either.
  document.documentElement.classList.toggle('mini', !!d.mini);
}).catch(() => {});

/* ------------------------------------------------------------ alarm list */
const ALARM_CACHE = {};

/* The device's own alarm list and the points' status flags, together.
   GetEventInformation only lists objects with intrinsic reporting set up in
   the controller; a Corrigo, a WAGO or alarms made in the DDC program never
   show there, and the list comes back empty while points stand in alarm or
   fault. So the flags are read as well, and "no alarms" is only said when
   both are clean and every point's status was actually read. */
async function fyllAlarmer() {
  const boks = document.getElementById('alarmSect');
  const d = S.activeDev;
  if (!boks || !d) return;
  // KNX and Modbus have no alarm list to ask for, and their points carry no status flags: the box would only say nothing was found.
  if (d.protocol === 'knx' || d.protocol === 'modbus') { boks.hidden = true; return; }
  let data = ALARM_CACHE[d.address];
  if (!data || Date.now() - data.t > 60000) {
    try {
      const r = await api('/api/device/alarms', {address: d.address});
      data = ALARM_CACHE[d.address] = {t: Date.now(), r};
    } catch { data = {t: Date.now(), r: {status: 'error'}}; }
  }
  // The inspector may have moved on while we waited.
  if (S.activeDev !== d || !document.body.contains(boks)) return;
  const r = data.r;
  const listeOk = r.status === 'done';
  const alle = new Map();
  for (const a of (listeOk ? r.alarmer || [] : [])) alle.set(a.objid, Object.assign({kilde: 'liste'}, a));
  for (const p of S.points || []) {
    const f = (p.status || []).filter(x => x === 'in-alarm' || x === 'fault');
    if (!f.length) continue;
    // The list says "normal, not acknowledged" while the flag says the point is in
    // alarm or fault right now: the flag is the present, the list is what it remembers.
    if (alle.has(p.objid)) {
      const a = alle.get(p.objid);
      if (a.tilstand === 'normal') a.tilstand = f.includes('fault') ? 'fault' : 'in-alarm';
      continue;
    }
    alle.set(p.objid, {objid: p.objid, tilstand: f.includes('fault') ? 'fault' : 'in-alarm', ukvittert: [], kilde: 'flagg'});
  }
  const alt = [...alle.values()];
  // What stands in alarm now, what is faulty, and what has come back to normal without
  // being acknowledged: three different things, and only the first is "active".
  const erFeil = a => /fault/.test(a.tilstand);
  const erNormal = a => a.tilstand === 'normal';
  const liste = alt.filter(a => !erFeil(a) && !erNormal(a));
  const feil = alt.filter(erFeil);
  const venter = alt.filter(a => erNormal(a) && (a.ukvittert || []).length);
  const lest = (S.points || []).length > 0 && S.points.every(p => p.status_lest === true);
  boks.hidden = false;
  const kildeTekst = listeOk
    ? T('Fra enhetens alarmliste og punktenes statusflagg.', 'From the device’s alarm list and the points’ status flags.')
    : T('Enheten svarer ikke på alarmforespørsel, så dette er fra punktenes statusflagg.', 'The device does not answer the alarm request, so this is from the points’ status flags.');
  if (!alt.length) {
    boks.innerHTML = `<div class="sect-head">${T('Aktive alarmer', 'Active alarms')} <span class="count">0</span></div>`
      + `<div class="alarm-tom">${lest
          ? T('Ingen aktive alarmer.', 'No active alarms.')
          : T('Ingen funnet så langt. Punktene er ikke ferdig lest.', 'None found so far. The points are not fully read yet.')}
         <div class="alarm-kilde">${kildeTekst}</div></div>`;
    if (lest && listeOk) nabeSier(T('Ingen alarmer, verken i lista eller i flaggene. Mistenkelig.', 'No alarms, in the list or the flags. Suspicious.'), 'skvatt', 'ingen-alarm:' + d.address);
    return;
  }
  const navn = oid => (S.pointIndex && S.pointIndex.get(oid)?.name) || oid;
  const tilstand = t => ({'in-alarm': T('i alarm', 'in alarm'), fault: T('feil', 'fault')}[t] || t);
  const rad = a => `
      <button class="alarm-rad" data-o="${esc(a.objid)}" title="${esc(a.kilde === 'flagg'
        ? T('Statusflagget står i alarm eller feil. Ikke i enhetens alarmliste.', 'The status flag is in alarm or fault. Not in the device’s alarm list.')
        : T('Fra enhetens alarmliste', 'From the device’s alarm list'))}">
        <span class="alarm-navn">${esc(navn(a.objid))}</span>
        <span class="alarm-til ${erFeil(a) ? 'bad' : erNormal(a) ? '' : 'warn'}">${esc(tilstand(a.tilstand))}</span>
        ${(a.ukvittert || []).length ? `<span class="alarm-ukv" title="${esc(a.ukvittert.join(', '))}">${T('ukvittert', 'unacked')}</span>` : ''}
      </button>`;
  // Alarms first and open. Faults and returned-to-normal are folded away when there are
  // more than a few, so one real alarm is never buried under twenty dead sensors.
  const gruppe = (tittel, rader, apen) => !rader.length ? '' : (apen || rader.length <= 3
    ? `<div class="alarm-del">${tittel} <span class="count">${rader.length}</span></div><div class="alarm-liste">${rader.map(rad).join('')}</div>`
    : `<details class="alarm-fold"><summary>${tittel} <span class="count">${rader.length}</span></summary><div class="alarm-liste">${rader.map(rad).join('')}</div></details>`);
  boks.innerHTML = `<div class="sect-head">${T('Aktive alarmer', 'Active alarms')} <span class="count">${liste.length}</span></div>
    ${liste.length ? `<div class="alarm-liste">${liste.map(rad).join('')}</div>` : `<div class="alarm-tom">${T('Ingen aktive alarmer.', 'No active alarms.')}</div>`}
    ${gruppe(T('Punkter med feil', 'Points with a fault'), feil, false)}
    ${gruppe(T('Tilbake til normal, venter på kvittering', 'Back to normal, waiting to be acknowledged'), venter, false)}
    <div class="alarm-kilde">${kildeTekst}</div>`;
  boks.querySelectorAll('.alarm-rad').forEach(b => b.onclick = () =>
    document.querySelector(`#pointsWrap tr[data-o="${CSS.escape(b.dataset.o)}"]`)?.click());
}

/* ------------------------------------------------------- routers on site */
async function visRutere() {
  let r;
  try { r = await (await fetch('/api/routers')).json(); } catch { return; }
  const liste = (r && r.rutere) || [];
  let el = document.getElementById('ruterInfo');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ruterInfo';
    el.className = 'ruter-info';
    $('dupWarn')?.after(el);
  }
  if (!liste.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = liste.map(x =>
    `<div title="${esc(T('BACnet-nett bak denne ruteren - typisk MS/TP', 'BACnet networks behind this router - usually MS/TP'))}">`
    + `<span class="ruter-ip">${esc(x.ruter)}</span> → ${T('nett', 'network')} ${x.nett.map(n => esc(String(n))).join(', ')}</div>`).join('');
}

/* ------------------------------------------------------- usage, and jokes */
const TELLER_NOKKEL = 'nabe_teller';
function teller() {
  try { return JSON.parse(localStorage.getItem(TELLER_NOKKEL)) || {}; } catch { return {}; }
}
function tell(hva, n = 1) {
  const t = teller();
  t[hva] = (t[hva] || 0) + n;
  t.sett = t.sett || [];
  try { localStorage.setItem(TELLER_NOKKEL, JSON.stringify(t)); } catch {}
  milepaeler(hva, t);
}
const MILEPAELER = {
  aapnet: [[10, 'Tiende gang. Vi begynner å bli venner.', 'Tenth time. We are becoming friends.'],
           [50, 'Femti åpninger. Du fortjener en NABE-kopp.', 'Fifty opens. You deserve a NABE mug.'],
           [200, 'To hundre. Jeg tror jeg er favoritten din.', 'Two hundred. I think I am your favourite.']],
  skann:  [[1, 'Første skann. Jeg skal huske denne dagen.', 'First scan. I will remember this day.'],
           [25, '25 skann. Du skanner mer enn en flyplass.', '25 scans. You scan more than an airport.'],
           [100, 'Hundre skann. YABE kunne aldri.', 'A hundred scans. YABE could never.']],
  enheter:[[100, 'Hundre enheter funnet. Noen var til og med konfigurert riktig.', 'A hundred devices found. Some were even configured properly.'],
           [1000, 'Tusen enheter. Du har sett ting.', 'A thousand devices. You have seen things.']],
  skriv:  [[1, 'Første skriving. Husk å frigi.', 'First write. Remember to release.'],
           [50, 'Femti skrivinger. Driften lurer på hvem du er.', 'Fifty writes. Operations wonders who you are.']],
  punkter:[[10000, 'Ti tusen punkter lest. Dataene dine er tunge.', 'Ten thousand points read. Your data is heavy.']],
};
function milepaeler(hva, t) {
  for (const [grense, nb, en] of MILEPAELER[hva] || []) {
    const id = hva + grense;
    if (t[hva] >= grense && !t.sett.includes(id)) {
      t.sett.push(id);
      try { localStorage.setItem(TELLER_NOKKEL, JSON.stringify(t)); } catch {}
      setTimeout(() => nabeSier(T(nb, en), 'fornoyd'), 800);
      return;
    }
  }
}

// Points read: counted once per device per visit.
const LEST_TELT = new Set();
function tellPunkter() {
  const d = S.activeDev;
  if (!d || !S.points.length || LEST_TELT.has(d.address)) return;
  LEST_TELT.add(d.address);
  tell('punkter', S.points.length);
  if (S.points.length > 1500) nabeSier(T('Pratsom regulator, denne.', 'Chatty controller, this one.'), 'skvatt', 'prat');
}

// Flip-flopping between light and dark.
let TEMA_KLIKK = [];
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('#themeBtn')) return;
  const naa = Date.now();
  TEMA_KLIKK = TEMA_KLIKK.filter(t => naa - t < 4000).concat(naa);
  if (TEMA_KLIKK.length >= 5) { TEMA_KLIKK = []; nabeSier(T('Bestem deg.', 'Make up your mind.'), 'svimmel'); }
}, true);

// A long session.
const NABE_OKT_START = Date.now();
setInterval(() => {
  if (Date.now() - NABE_OKT_START > 3 * 3600e3)
    nabeSier(T('Tre timer i strekk. Drikk litt vann.', 'Three hours straight. Drink some water.'), null, 'lang-okt');
}, 60000);

// Copying rows for Excel.
document.addEventListener('copy', () => {
  if (document.activeElement?.closest?.('#pointsWrap'))
    nabeSier(T('Kopiert. Ikke si det til YABE.', 'Copied. Do not tell YABE.'), 'fornoyd', 'kopi');
});

/* ------------------------------------------------------------ start screen
   One screen between opening the tool and using it: who it is, which plants
   you were on last, and what is new. It never stands in the way - any key,
   a click on a plant, or Esc goes straight through - and a plant clicked
   here is scanned the way it was scanned last time. */
const FAKTA = [
  ['Instans 4194303 betyr «hvem du enn er». NABE bruker den til å finne deg.', 'Instance 4194303 means "whoever you are". NABE uses it to find you.'],
  ['47808 er 0xBAC0 i heks. Noen hadde det gøy i 1995.', '47808 is 0xBAC0 in hex. Somebody had fun in 1995.'],
  ['Prioritet 1 er for livssikkerhet. Prioritet 8 er for deg.', 'Priority 1 is for life safety. Priority 8 is for you.'],
  ['MS/TP sender en stafettpinne rundt bussen. Den som har den, får snakke.', 'MS/TP passes a token round the bus. Whoever holds it gets to talk.'],
  ['En BBMD gjentar kringkastinger mellom nett. Uten den hører ingen deg over VPN.', 'A BBMD repeats broadcasts between networks. Without one nobody hears you over VPN.'],
  ['BACnet ble standard i 1995. Noen av regulatorene du finner, er nesten like gamle.', 'BACnet became a standard in 1995. Some controllers you find are nearly as old.'],
  ['Relinquish default er verdien som gjelder når ingen prioritet er satt.', 'Relinquish default is the value that applies when no priority is set.'],
  ['COV betyr at regulatoren sier fra selv. Mindre spørring, mer ro.', 'COV means the controller speaks up itself. Less asking, more peace.'],
];
const NYTT = {
  '2.7': [
    ['Systembildene er gått grundig over: pumper og ventiler som nevner en annen kurs (gulvvarme, barnehage) havner på den kursen i stedet for på hovedstokken, kurstitler uten tagkoder og avkuttede ord, og system 310 (vann og avløp) tegnes ikke lenger som sprinkler uten at et punkt sier sprinkler. Aggregatet tegnes i bredden som er tilgjengelig i stedet for å rulle sidelengs', 'The schematics have been gone over closely: pumps and valves that name another circuit (floor heating, kindergarten) now land on that circuit instead of the main, circuit titles have no tag codes or cut-off words, and system 310 (water and drain) is no longer drawn as sprinkler unless a point says sprinkler. The air handler is drawn to the available width instead of scrolling sideways'],
  ],
  '2.6': [
    ['ETS-lister og registerkart kan oppdateres: velg en ny versjon av filen, så får du se hva som er nytt, omdøpt og borte, og navn og skala du har endret selv i appen beholdes. Kartene kan lastes ned igjen som CSV med endringene', 'ETS lists and register maps can be updated: pick a new version of the file and you see what is new, renamed and gone, while names and scales you changed yourself in the app are kept. The maps can be downloaded again as CSV with the changes'],
    ['Skjemaet: pumper og ventiler på kurser står på røret beskrivelsen sier (tur eller retur), og innstillinger, moduser og romventiler tegnes ikke lenger som deler av kursen. Aggregater med varmegjenvinner får en velger for roterende, kryss eller væskekoblet veksler, husket per anlegg', 'The schematic: pumps and valves on circuits sit on the pipe the description names (flow or return), and settings, modes and room valves are no longer drawn as parts of the circuit. Air handlers with heat recovery get a choice of rotary, cross-flow or liquid-coupled exchanger, remembered per plant'],
    ['KNX og Modbus: bedre på smal skjerm, ukjente gruppeadresser vises ikke lenger som meningsløse tall, KNX-enheter viser ikke lenger «baud», og alarmboksen skjules der protokollen ikke har alarmer', 'KNX and Modbus: better on a narrow screen, unknown group addresses no longer show as meaningless numbers, KNX devices no longer say "baud", and the alarm box is hidden where the protocol has no alarms'],
  ],
  '2.5': [
    ['Modbus: registerkart kan leses fra Excel og fra Niagaras eksport av Modbus-punkter, Modicon-adresser som 40012 forstås, punkter kan få nytt navn, skala og enhet i appen, og en enhet av en kjent type får kartet sitt igjen ved neste skann. Ledige Modbus-forbindelser lukkes etter noen minutter', 'Modbus: register maps can be read from Excel and from the Niagara export of Modbus points, Modicon addresses like 40012 are understood, points can be renamed, rescaled and given a unit in the app, and a device of a known type gets its map back at the next scan. Idle Modbus connections are closed after a few minutes'],
    ['KNX: rom i ETS-navn som 563.9-303-RT601 vises som romkort i skjemaet, med temperatur, settpunkt, varmepådrag, CO2 og lux. Gruppeadresser kan få nytt navn og datapunkttype i appen. Telegrammonitor som i ETS, og alder på hver verdi («hørt for 3 timer siden»). Uten verdi skjules som standard, for KNX og for Modbus uten kart', 'KNX: rooms in ETS names like 563.9-303-RT601 show as room cards in the schematic, with temperature, setpoint, heating output, CO2 and lux. Group addresses can be renamed and given a datapoint type in the app. A telegram monitor like the one in ETS, and the age of each value ("heard 3 hours ago"). Points without a value are hidden by default, for KNX and for Modbus without a map'],
    ['KNX routing: NABE kan lytte på multikastgruppen 224.0.23.12 uten å ta en tunnel fra noen gateway. Bare lytting, den sender ingenting. Krever at PC-en står på samme nett som en KNX-ruter. KNX Secure støttes ikke ennå', 'KNX routing: NABE can listen to the multicast group 224.0.23.12 without taking a tunnel from any gateway. Listening only, it sends nothing. Needs the PC to be on the same network as a KNX router. KNX Secure is not supported yet'],
  ],
  '2.4': [
    ['KNX leser lesefanen og datapunkttypen fra kommunikasjonsobjektene i ETS-prosjektet, så NABE bare spør adresser som kan svare og aldri de som har lesefanen av. «Les alle lesbare» spør bussen om dem på forespørsel (fem i sekundet, med bekreftelse), og en adresse som ikke svarte spørres ikke igjen på ti minutter. Tunnelen lukkes ryddig. Prøvd mot en ekte KNX-gateway og et eksisterende prosjekt på 5260 gruppeadresser, bare lesing', 'KNX reads the read flag and the datapoint type from the communication objects in the ETS project, so NABE only asks addresses that can answer and never those with the read flag off. "Read all readable" asks the bus for them on request (five a second, with confirmation), and an address that did not answer is not asked again for ten minutes. The tunnel is closed cleanly. Tried against a real KNX gateway and an existing project of 5260 group addresses, read only'],
  ],
  '2.3': [
    ['Modbus RTU: seriell port (RS-485 via USB-adapter) og RTU over TCP for serielle gatewayer som slipper bytene gjennom. Enheter leses fra beskrivelsene i lister uten enhetskolonne. «Utforsk» finner hvilke registre en enhet svarer på og lagrer dem som et registerkart du kan gi navn. Alarmstatusregistre tegnes ikke lenger som følere i skjemaet. Prøvd mot en ekte Regin-regulator over VPN, bare lesing', 'Modbus RTU: serial port (RS-485 through a USB adapter) and RTU over TCP for serial gateways that pass the bytes through. Units are read from the descriptions in lists with no unit column. "Explore" finds which registers a device answers to and keeps them as a register map you can name. Alarm status registers are no longer drawn as sensors in the schematic. Tried against a real Regin controller over VPN, read only'],
  ],
  '2.2': [
    ['Et registerkart i et format NABE ikke kjenner igjen sier nå hvilke kolonner filen har og hva som støttes, i stedet for «bad address»', 'A register map in a format NABE does not recognise now says which columns the file has and what is supported, instead of "bad address"'],
  ],
  '2.1': [
    ['Modbus leser Regin EXOL-lister (Modbus Type, Signal Name, EXOL Type, Modbus Address): adressene teller fra 1 og trekkes fra 1, reelle verdier (R) skaleres, og begge valgene kan overstyres ved import, med merknader om hva som er antatt. KNX gjetter datapunkttypen fra navn og telegramlengde når ETS-prosjektet ikke har noen, og sier at den er antatt. Klokkeslett og dato i KNX leses', 'Modbus reads Regin EXOL lists (Modbus Type, Signal Name, EXOL Type, Modbus Address): the addresses count from 1 and have 1 taken off, reals (R) are scaled, and both can be overridden at import, with notes on what was assumed. KNX guesses the datapoint type from the name and the length of the telegram when the ETS project has none, and says it is a guess. KNX time and date are read'],
  ],
  '2.0': [
    ['NABE 2.0: BACnet, Modbus og KNX i samme program. KNX leses gjennom én tunnel mot KNXnet/IP-gatewayen: verdiene kommer når de endrer seg, og en gruppeadresse ingen har snakket på spørres om én gang, fem i sekundet. Navnene kommer fra ETS (prosjektfilen eller CSV-eksporten). Det eneste NABE kan sende på KNX er en lesing. Åpnes fra ⋯-menyen eller paletten («KNX…»)', 'NABE 2.0: BACnet, Modbus and KNX in one program. KNX is read through one tunnel to the KNXnet/IP gateway: values arrive as they change, and a group address nobody has spoken on is asked for once, five a second. The names come from ETS (the project file or the CSV export). The only thing NABE can send on KNX is a read. Opened from the ⋯ menu or the palette ("KNX…")'],
  ],
  '1.96': [
    ['Modbus TCP, bare lesing: skann etter enheter, importer et registerkart (CSV eller JSON) som gir registrene navn, type, skalering og enhet, og enhetene ligger i lista med samme tabell, overvåking, opptak, eksport og skjema som BACnet. Åpnes fra ⋯-menyen eller paletten («Modbus…»). Koden har ingen funksjon som skriver', 'Modbus TCP, read only: scan for devices, import a register map (CSV or JSON) that gives the registers a name, type, scale and unit, and the devices sit in the list with the same table, watch list, recording, export and schematic as BACnet. Opened from the ⋯ menu or the palette ("Modbus…"). The code has no function that writes'],
  ],
  '1.95': [
    ['System skrevet med bindestrek («OU01.1OX01 - 320-002-RT401») leses som 320.002, og varmekurser får egen kolonne per system selv når beskrivelsene er generelle engelske ord som «Miscellaneous Pressure»', 'Systems written with a hyphen ("OU01.1OX01 - 320-002-RT401") are read as 320.002, and heating circuits get a column of their own per system even when the descriptions are general English words like "Miscellaneous Pressure"'],
  ],
  '1.94': [
    ['Punkter som en travel regulator ikke ga navnet på i første runde blir spurt om en gang til, hver for seg. Uten navn kan ikke skjemaet lese punktet', 'Points whose name a busy controller did not give in the first pass are asked for once more, on their own. Without the name the schematic cannot read the point'],
  ],
  '1.93': [
    ['Rommoduler på en bussdriver («Drivers.Modbus_3_1.S563.R_338.points.RT600») leses som rom 338 med temperatur, varme- og luftpådrag, og en ventil eller et spjeld i prosent med «_P» i navnet er pådrag', 'Room modules on a bus driver ("Drivers.Modbus_3_1.S563.R_338.points.RT600") are read as room 338 with temperature, heating and air output, and a valve or damper in percent with "_P" in the name is an output'],
  ],
  '1.92': [
    ['Rettet en skrivefeil i nyhetsteksten for 1.91', 'Fixed a typo in the news text for 1.91'],
  ],
  '1.91': [
    ['Installasjonsvinduet er mer levende: figuren blunker og svever, trinnprikker viser hvor du er, fremdriften har prosent og en strek med lys i, og ferdigsiden knaller litt konfetti. Klikk på NABE og se hva som skjer', 'The installer window is livelier: the figure blinks and floats, step dots show where you are, the progress has a percentage and a bar with light in it, and the done page bursts a little confetti. Click NABE and see what happens'],
  ],
  '1.90': [
    ['Snarveiene som installasjonen lager får ikonet med indeks, og Windows får beskjed om at de er nye, så skrivebordet og startmenyen ikke viser tomme ikoner', 'The shortcuts the installer makes get the icon with its index, and Windows is told they are new, so the desktop and Start menu do not show blank icons'],
  ],
  '1.89': [
    ['Varmepumpas kuldekrets (fordamper, kondensator, sugegass, overheting, høy- og lavtrykk) står i en egen gruppe under aggregatet, med navn og verdi, i stedet for blant det andre', 'The refrigerant circuit of a heat pump (evaporator, condenser, suction gas, superheat, high and low pressure) is in a group of its own under the air handler, with name and value, instead of among the rest'],
  ],
  '1.88': [
    ['Installasjonen stopper en NABE som kjører fra målmappa og prøver igjen på filer som er i bruk, i stedet for å feile med «prosessen får ikke tilgang til filen»', 'The installer stops a NABE that runs from the target folder and retries files that are in use, instead of failing with "the process cannot access the file"'],
  ],
  '1.87': [
    ['Installasjonen åpner seg på maskiner der Windows har merket filene fra zip-fila som hentet fra internett (WebView2 ble nektet lastet). NABE fjerner merket selv før vinduet åpnes', 'The installer now opens on machines where Windows has marked the files from the zip as downloaded from the internet (WebView2 was refused). NABE removes the mark itself before the window opens'],
  ],
  '1.86': [
    ['Installasjonen sier fra når vinduet ikke kan åpnes (for eksempel uten Edge WebView2) og tilbyr standardinstallasjon, og «Installer NABE» blir stående med en forklaring hvis zip-fila ikke er pakket ut', 'The installer says so when its window cannot open (for example without Edge WebView2) and offers the default install, and "Installer NABE" stays open with an explanation if the zip has not been unpacked'],
  ],
  '1.85': [
    ['NABE.bat i den bærbare utgaven og Mini blir stående med en forklaring hvis den ikke finner Python (åpnet inne i zip-fila) eller stopper med feil, i stedet for at vinduet lukkes av seg selv', 'NABE.bat in the portable edition and Mini stays open with an explanation if it cannot find Python (opened inside the zip) or stops with an error, instead of the window closing by itself'],
  ],
  '1.84': [
    ['Reguleringsparametre (tid for derivat og integral på styrestrekene) og varmekurver for varmepumper (UtekompVP Y1 til Y4) regnes som innstillinger og tegnes ikke som målinger', 'Control parameters (derivative and integral time of the control loops) and heat pump curves (UtekompVP Y1 to Y4) count as settings and are not drawn as readings'],
  ],
  '1.83': [
    ['Luftkvalitet (CO2) som ikke sier hvor den måles settes i avtrekksluften, der rommets luft kommer tilbake', 'Air quality (CO2) that does not say where it is measured is put in the extract air, where the air of the rooms comes back'],
  ],
  '1.82': [
    ['Avtrekksvifta tegnes på avtrekkssiden også når beskrivelsen kaller den «Exhaust fan», elektrisk varmebatteri tegnes som ettervarme, og «External override» og sommer- og vinterverdier holdes utenfor som innstillinger', 'The extract fan is drawn on the extract side also when the description calls it "Exhaust fan", an electric heater is drawn as reheat, and "External override" and summer and winter values are kept out as settings'],
  ],
  '1.81': [
    ['Romstyringer som står med buss og rom i beskrivelsen («SQ401-02.85 Spjeldposisjon») blir romkort med spjeldpådrag, i stedet for hundrevis av løse målinger i et varmeanlegg. En posisjon er en posisjon uansett hvilken enhet programmereren ga den, og punkter uten navn («Input (Float)») holdes utenfor', 'Room controllers that carry bus and room in the description ("SQ401-02.85 Damper position") become room cards with damper output, instead of hundreds of loose readings in a heating plant. A position is a position whatever unit the programmer gave it, and unnamed points ("Input (Float)") are kept out'],
  ],
  '1.80': [
    ['Anlegg uten systemnummer i taggene som har rør, pumper og ventiler men bare et reléutgang for en nødvifte, tegnes som kjøle- eller varmekurser i stedet for som et tomt aggregat. Punkter på varmekurven (Utekomp Y1 til Y5) regnes som innstillinger', 'Plants with no system number in the tags that have pipes, pumps and valves but only a relay for an emergency fan are drawn as cooling or heating circuits instead of an empty air handler. Points on the heating curve (Utekomp Y1 to Y5) count as settings'],
  ],
  '1.79': [
    ['Et filter som både måles som trykk og meldes som «bytt filter» tegnes som ett filter, med trykket. «Water temperature» settes på batteriet som returtemperatur', 'A filter that is both measured as pressure and reported as "change filter" is drawn as one filter, with the pressure. "Water temperature" is put on the coil as its return temperature'],
  ],
  '1.78': [
    ['Komfovent og andre enheter som skriver måleområdet i beskrivelsen («min:-50, max:+120») leses nå som målinger i stedet for innstillinger, så aggregatet tegnes med temperaturer, filter, spjeld og spoler. Valglister («0-m3/h, 1-l/s») holdes utenfor tegningen', 'Komfovent and other devices that write the measuring range in the description ("min:-50, max:+120") are now read as readings instead of settings, so the air handler is drawn with temperatures, filters, dampers and coils. Choice lists ("0-m3/h, 1-l/s") are kept out of the drawing'],
  ],
  '1.77': [
    ['Skjema leser GOLD- og OJ-Air2-aggregater: kodene i navnene (BDInlet, BVHeat1, BVCool), fire typer spoler (forvarme, varme, kjøling, ettervarme), gjenvinner med virkningsgrad og lesende innganger holdt adskilt fra innstillinger', 'The schematic reads GOLD and OJ-Air2 air handlers: the codes in the names (BDInlet, BVHeat1, BVCool), four kinds of coils (preheat, heating, cooling, reheat), recovery with efficiency and read-only inputs kept apart from settings'],
    ['Hotellrom (OU601.613.-RT601) tegnes som romkort, systemer leses også fra «350 002-RT401» og «350002-RP401», og kjølekurser får navn etter det punktene sier om seg selv', 'Hotel rooms (OU601.613.-RT601) are drawn as room cards, systems are also read from "350 002-RT401" and "350002-RP401", and cooling circuits are named after what their points say about themselves'],
  ],
  '1.76': [
    ['Skjema viser hvilke tagger tegningen er laget av («Tagger brukt»), med hva hver ble tolket som og på hvilket grunnlag: ordene i beskrivelsen, tallet i taggen eller hva føleren leser', 'The schematic shows which tags the drawing is made of ("Tags used"), with what each was taken to mean and on what grounds: the words of the description, the number of the tag or what the sensor reads'],
    ['Aggregat: sensorer som beskrivelsen ikke plasserer (RT50, RT51, RT52) skilles etter nummer og etter verdi, slik en tekniker ville gjort det. Avkast ligger mellom ute og avtrekk, en føler som er mye varmere enn all luft er vannet i batteriet, og romtemperatur RT601 eller RT60 er et rom', 'Air handler: sensors the description does not place (RT50, RT51, RT52) are told apart by number and by value, the way a technician would. The exhaust lies between outdoor and extract, a sensor much hotter than any air is the water of the coil, and room temperature RT601 or RT60 is a room'],
    ['Varmeanlegg deles i kurser etter hva beskrivelsen sier («Tur fra fjernvarme», «Retur til VP veksler», «Trykkgiver ekspansjonskar»), med egne symboler for VP, veksler, tank og ekspansjonskar. Ingen kursnavn som «Analog Utgang» lenger', 'Heating plants are split into circuits by what the description says ("Flow from district heating", "Return to heat pump exchanger", "Expansion vessel pressure"), with symbols of their own for heat pump, exchanger, tank and expansion vessel. No more circuit names like "Analog Output"'],
  ],
  '1.75': [
    ['Skjema leser nå anlegg som navngir punktene med ord (Corrigo, EXcon, OJ-Air2 og lignende): Sup, Ext, Exh og Outdoor settes på riktig sted i luftveien, og innstillinger, tidsverdier og alarmhendelser holdes utenfor tegningen', 'The schematic now reads plants that name their points in words (Corrigo, EXcon, OJ-Air2 and the like): Sup, Ext, Exh and Outdoor are put at the right place in the air path, and settings, time values and alarm events are kept out of the drawing'],
    ['System og komponentkode leses også fra navn som s36001.RT401 og fra beskrivelsen («332.001-SM401»), så Beckhoff-enheter med slike navn deles riktig i systemer', 'System and component code are also read from names like s36001.RT401 and from the description ("332.001-SM401"), so Beckhoff devices with such names are split into systems correctly'],
  ],
  '1.74': [
    ['Skjema: sensorene settes på sin plass i luftveien (inntak, etter gjenvinner, tilluft, avtrekk, avkast) ut fra navn og beskrivelse, og ligger ikke lenger oppå hverandre. Tegningen blir bredere når det trengs', 'Schematic: the sensors are put at their place in the air path (intake, after recovery, supply, extract, exhaust) from the name and description, and no longer sit on top of each other. The drawing grows wider when it needs to'],
    ['Varmekurser er røde (lys rød for retur) og kjølekurser blå (lys blå for retur)', 'Heating circuits are red (light red for return) and cooling circuits blue (light blue for return)'],
    ['Sprinkler og stengeventiler (SM001) er et eget system og kommer ikke med i varme- eller kjølekurser', 'Sprinkler and shut-off valves (SM001) are a system of their own and do not come with the heating or cooling circuits'],
    ['Rom som kort, med et eget vindu per rom: avstand til settpunkt på en skala, pådrag, CO2 og alle punktene i rommet. Svevekort over deler i skjemaet, og høyreklikk fester punktet', 'Rooms as cards, with a window of its own for each room: distance from the setpoint on a scale, signals, CO2 and every point in the room. A card over parts in the schematic, and right-click pins the point'],
    ['Anleggsoversikt over alle aggregater og kurser, enhetslista som smal stripe og punktpanelet i faner', 'Plant overview of every air handling unit and circuit, the device list as a narrow strip and the point panel in tabs'],
  ],
  '1.73': [
    ['Skjema: aggregat og varmekurser tegnes av seg selv ut fra navn og beskrivelse på punktene. Bytt mellom Tabell og Skjema over punktlista. Klikk en vifte, føler eller ventil for å se punktet. Virker med TFM-koder (RT40, JV401), med lange stier og med enheter uten koder', 'Schematic: air handling units and heating circuits draw themselves from the names and descriptions of the points. Switch between Table and Schematic above the point list. Click a fan, sensor or valve to see its point. Works with TFM codes (RT40, JV401), with long paths and with devices that have no codes'],
    ['Innstillinger med flere valg åpner en liste i stedet for å bla til neste', 'Settings with several choices open a list instead of stepping to the next one'],
    ['Verktøymenyen (⋯) er delt i to kolonner og er ikke lenger én lang liste', 'The tools menu (⋯) is split in two columns and is no longer one long list'],
  ],
  '1.72': [
    ['Snakkeboblen til NABE legger seg ikke lenger over søkefeltet. Den bruker plassen foran feltet og bryter linja', 'The speech bubble no longer covers the search field. It uses the room in front of the field and wraps the line'],
    ['Anleggsraden under skannefeltet skjules når den bare viser anlegget du allerede står i. Klikk i feltet for å få den fram', 'The site row under the scan field is hidden when it only shows the plant you are already in. Click the field to bring it back'],
  ],
  '1.71': [
    ['Tre tekster som sto på norsk i engelsk visning er oversatt: hjelpelinja i ukeprogrammet og «…og N til» i to lister', 'Three texts that stayed Norwegian in the English view are translated: the hint line in the schedule and "…and N more" in two lists'],
  ],
  '1.70': [
    ['Anleggslinja holder seg på én linje. Når det er trangt, vises former (▲ alarm, ◆ feil) i stedet for ord, og ordene står når du peker', 'The plant line stays on one row. When space is tight it shows shapes (▲ alarm, ◆ fault) instead of words, and the words are there when you point'],
    ['NABO teller enheter riktig når flere har samme navn, og enheten står på én linje i tabellen', 'NABO counts devices correctly when several share a name, and the unit stays on one line in the table'],
  ],
  '1.69': [
    ['Når et annet BACnet-program (for eksempel en Niagara-stasjon) har port 47808, står det en knapp «Bruk egen port» i varselet. NABE bytter til en ledig port og husker valget. Porten kan også byttes fra Ctrl K', 'When another BACnet program (a Niagara station, for instance) has port 47808, the warning has a button "Use own port". NABE moves to a free port and remembers the choice. The port can also be changed from Ctrl K'],
    ['Snakkeboblen til NABE kan bruke to linjer, så setninger ikke kuttes midt i', 'The speech bubble can use two lines, so sentences are not cut in the middle'],
  ],
  '1.68': [
    ['Spørsmål som «Fortsette?» og «Hva heter anlegget?» kommer i NABEs egen dialog, ikke nettleserens grå boks', 'Questions like "Continue?" and "What is this site called?" come in a dialog of NABE itself, not the grey box of the browser'],
    ['Skriv og Frigi er synlige uten rulling på 1366×768, som er vanlig på fjernskrivebord', 'Write and Release are visible without scrolling at 1366×768, which is common on remote desktops'],
    ['En enhet der nesten alle punktene har feil, telles som én enhet på anleggslinja i stedet for flere hundre punkter', 'A device where nearly every point is faulty counts as one device on the plant line instead of several hundred points'],
    ['En enhet uten punkter sier hvorfor. Handlingene i søket følger språket', 'A device with no points says why. The actions in the search follow the language'],
  ],
  '1.67': [
    ['NABE Mini: en egen pakke for fjernskrivebord. Pakk ut og start, uten installasjon, uten lokal KI, uten selvoppdatering og uten internett. Ligger som NABE-Mini.zip i utgivelsen', 'NABE Mini: a package of its own for remote desktops. Extract and start, with no installation, no local AI, no self-update and no internet. It is NABE-Mini.zip in the release'],
  ],
  '1.66': [
    ['Siden sist: NABE husker anlegget når det er lest til ende, og sammenligner neste besøk med det. Nye alarmer, endrede settpunkt, overstyringer og enheter som ikke svarer lenger. Ligger i menyen under Verktøy', 'Since last visit: NABE remembers the plant once it is read to the end, and compares the next visit with it. New alarms, changed setpoints, overrides and devices that no longer answer. In the menu under Tools'],
    ['Besøksrapport: ett ark med alarmer, feil, overstyringer, klokker, avvik fra settpunkt og notatene dine. Skriv ut eller lagre som PDF', 'Visit report: one sheet with alarms, faults, overrides, clocks, setpoint deviations and your notes. Print it or save it as PDF'],
    ['Lagre alle verdiene til en fil før du endrer noe, og sammenlign anlegget med fila etterpå', 'Save every value to a file before you change anything, and compare the plant with the file afterwards'],
    ['Overvåkingslista huskes per anlegg. Punktene du festet sist, ligger der når du skanner anlegget igjen', 'The watch list is remembered per plant. The points you pinned last time are there when you scan the plant again'],
    ['Ctrl F finner nå enheter og handlinger, ikke bare punkter', 'Ctrl F now finds devices and actions, not only points'],
    ['Kortet enhetene faktisk ligger bak blir hovedkort. Kortene står på én linje, og varselet om klokker ligger som et lite merke på anleggslinja', 'The adapter the devices are actually behind becomes the main one. The adapters sit on one line, and the clock warning is a small mark on the plant line'],
    ['Leverandørfargen vises som en liten stolpe i stedet for en rund prikk, så den ikke forveksles med status', 'The vendor colour is a small bar instead of a round dot, so it is not mistaken for status'],
    ['Statuslinja viser kortnavn og svartid. En treg lenke merkes på kortet', 'The status bar shows the adapter name and the response time. A slow link is marked on the adapter'],
    ['Sikkerhet: forespørsler med et fremmed vertsnavn avvises', 'Security: requests with a foreign host name are rejected'],
  ],
  '1.65': [
    ['Ukeprogram viser nå alle enhetene du har skannet, ikke bare den som er åpen. Enhetene leses i bakgrunnen noen om gangen, og lista fyller seg opp. Sortert på anlegg, så enhetsnavn (med tall i riktig rekkefølge), så navn på ur. «Denne enheten» gir den gamle visningen', 'Schedule now shows every device you have scanned, not only the open one. The devices are read in the background a few at a time, and the list fills in. Sorted by site, then device name (numbers in their natural order), then schedule name. "This device" gives the old view'],
    ['Anleggsstatus brettes sammen til én rolig linje med alarmer og feil, og åpnes ved å trykke på den. Den kan skjules med ✕ og slås på igjen i innstillinger', 'The plant status folds into one quiet line with alarms and faults, and opens when you click it. It can be hidden with ✕ and turned back on in Settings'],
    ['«Feil klokke» er ryddet: enhetsnavn og avvik i stedet for ID og IP, delt per anlegg, og «Still klokka» vises bare når du peker på raden', 'The wrong-clock list is tidied: device name and deviation instead of ID and IP, split per site, and "Set clock" only shows when you point at the row'],
  ],
  '1.64': [
    ['Megapakke med dialoger: NABE og NABO har fått over tusen nye replikker som passer til det du gjør, til tiden på døgnet, til leverandøren du leser og til hvordan det går. Ingenting gjentas før alt annet er sagt. Humørnivå i innstillinger (Stille, Normal, Kaos) styrer hvor mye', 'A mega pack of dialogue: NABE and NABO have over a thousand new lines that fit what you are doing, the time of day, the vendor you are reading and how it is going. Nothing repeats before everything else has been said. Mood in Settings (Quiet, Normal, Chaos) sets how much'],
    ['De to snakker også sammen når det er stille, og kommenterer verktøyene du åpner. NABO har fått mer å skrive i terminalen sin', 'The two also talk to each other when it is quiet, and comment on the tools you open. NABO has more to type in his terminal'],
    ['Femten nye ting i garderoben, alle fortjent og ingen kjøpt: sydvest, brannhjelm, hørselvern, sykkelhjelm, bandana, klovnenese, munnbind, stetoskop, nøkkelkjede, kaffekopp, multimeter, kabelrulle, ballong, termos og flagg. De kommenterer hverandre når de tas på', 'Fifteen new things in the wardrobe, all earned and none bought: rain hat, fire helmet, ear defenders, bike helmet, bandana, clown nose, face mask, stethoscope, key chain, coffee cup, multimeter, cable reel, balloon, flask and flag. They comment on each other when put on'],
    ['Ryddet i teksten: tankestrekene er borte fra grensesnittet, og en notis om avkortet tabell var bare på norsk', 'Tidied the text: the long dashes are gone from the interface, and a note about a truncated table was only in Norwegian'],
  ],
  '1.63': [
    ['Fargesyn i innstillinger: tre paletter som holder alarm, feil og advarsel adskilt ved rød-grønn og blå-gul fargeblindhet, og høy kontrast. Former (▲ alarm, ◆ feil, ● overstyrt) står ved siden av fargen, også i nettverkskartet', 'Colour vision in Settings: three palettes that keep alarm, fault and warning apart for red-green and blue-yellow colour blindness, plus high contrast. Shapes (▲ alarm, ◆ fault, ● overridden) sit beside the colour, in the network map too'],
    ['Venstre side: hvert kort i bruk vises som en rad med svartid, anlegg kan få navn (blyanten ved overskriften), og enheter med samme navn får adressen bak navnet. Oppsummeringen deler alarmene per anlegg', 'Left side: every adapter in use shows as a row with its response time, sites can be named (the pencil by the heading), and devices with the same name get the address behind it. The summary splits the alarms per site'],
    ['«Koble til på nytt» binder hvert kort på nytt og beholder det andre anlegget, i stedet for å bare ta hovedkortet. «Søk etter enheter» spør de kjente enhetene direkte og har fått en egen knapp ved Enheter', '"Reconnect" binds every adapter again and keeps the other site, instead of only taking the main adapter. "Look for devices" asks the known devices directly and has its own button by Devices'],
    ['Menyen er sortert på det den gjør (Verktøy, Overvåk, Tilkobling, Sikkerhet, Vis), Ukeprogram ligger ikke lenger under Eksport, og Escape lukker menyen', 'The menu is sorted by what it does (Tools, Monitor, Connection, Safety, View), Schedule is no longer under Export, and Escape closes the menu'],
    ['NABE sier fra av seg selv når det hjelper: flere enheter med samme navn, et anlegg uten tidssynk, en klokke som står fast. NABO kan gi unike enhetsnavn med ett klikk. Humørnivå (Stille, Normal, Kaos) i innstillinger', 'NABE speaks up when it helps: several devices with the same name, a plant with no time sync, a clock that is stuck. NABO can give unique device names in one click. Mood (Quiet, Normal, Chaos) in Settings'],
  ],
  '1.62': [
    ['Aktive alarmer viser bare det som står i alarm nå. Punkter med feil og alarmer som er tilbake til normal uten å være kvittert ligger i hver sin sammenfoldede liste, så én ekte alarm ikke drukner i tjue døde følere', 'Active alarms shows only what is in alarm now. Points with a fault and alarms back to normal but not acknowledged sit in their own folded lists, so one real alarm is not buried under twenty dead sensors'],
    ['Avvik fra settpunkt: en CO2-verdi under grensen (for eksempel 420 ppm mot 700) regnes ikke lenger som avvik, og lange punktnavn brytes i stedet for å klippes', 'Deviation from setpoint: a CO2 value under its limit (for example 420 ppm against 700) is no longer a deviation, and long point names wrap instead of being cut'],
    ['NABE lærer hva en enhet tåler: en kontroller som ikke kan segmentere et stort svar får mindre forespørsler resten av økten (WAGO fikk 60 % færre avbrutte forespørsler)', 'NABE learns what a device can take: a controller that cannot segment a large answer gets smaller requests for the rest of the session (a WAGO got 60 % fewer aborted requests)'],
    ['Et skann som ikke finner noe prøver én gang til av seg selv, siden en tunnel som har stått stille kan miste de første pakkene', 'A scan that finds nothing tries once more by itself, since a tunnel that has been idle can drop its first packets'],
    ['Kartet deler anlegg som leses via ulike kort, og skanneprober teller ikke lenger som feil. Ukeprogram viser «Frigir», «På» og «Av» i stedet for null og true, dagnavn og klokketekst følger språket, og smale vinduer stables i stedet for å presses sammen', 'The map splits sites read through different adapters, and sweep probes no longer count as errors. Schedules show "Releases", "On" and "Off" instead of null and true, weekday names and clock text follow the language, and narrow windows stack instead of squeezing'],
  ],
  '1.61': [
    ['Flere anlegg samtidig: skanner du et nytt område via et annet nettverkskort, blir bygget du allerede har åpent stående. Hoppenspretthallen over Hoppensprett og en Beckhoff over FortiClient kan ligge side om side', 'Several sites at once: scan a new range through another adapter and the building you already have open stays. Hoppenspretthallen over Hoppensprett and a Beckhoff over FortiClient can sit side by side'],
    ['Nettverkskart: PC-en, nettverkskortene og byggene bak dem på ett bilde, med hver enhet som en liten rute (rød alarm, gul feil). Trykk på et anlegg for å legge det til, på et ledig kort for å ta det i bruk, eller på en enhet for å åpne den', 'Network map: the PC, its adapters and the buildings behind them in one picture, with each device as a small square (red alarm, yellow fault). Click a site to add it, an idle adapter to bring it into use, or a device to open it'],
  ],
  '1.60': [
    ['Alltid-på opptak: punktene du fester leses i bakgrunnen og de siste to timene lagres, også om du lukker NABE. Knappen ⟲ i overvåkingen åpner «Se bakover» med en graf per punkt, og du kan åpne det som CSV', 'Always-on recording: the points you pin are read in the background and the last two hours are kept, even if you close NABE. The ⟲ button in Watch opens "Look back" with a chart per point, and you can open it as CSV'],
    ['Pendling i ettertid: NABE leter i opptaket og sier når en sløyfe begynte å svinge, for eksempel «RT401 pendler siden 14:10», også mens du holder på med noe annet', 'Hunting afterwards: NABE searches the recording and says when a loop began to swing, for example "RT401 is hunting since 14:10", even while you are busy with something else'],
  ],
  '1.59': [
    ['NABE maser ikke lenger om å frigi en overstyring på en enhet som ikke svarer. Før regnet den en enhet som innen rekkevidde så lenge nettet var det samme, selv om enheten var avslått. Nå spørres enheten selv når du lukker, og den som ikke svarer venter til neste besøk', 'NABE no longer nags you to release an override on a device that does not answer. It used to count a device as in reach whenever the network was the same, even if the device was switched off. Now the device itself is asked when you close, and one that does not answer waits for the next visit'],
  ],
  '1.58': [
    ['Feil og alarm skilles, og du ser hvorfor: en feil viser årsaken fra enheten (ingen føler, åpen sløyfe, ingen utgang), en alarm viser tilstanden og alarmverdien. Feil har en roligere rød enn alarm', 'Faults and alarms are told apart, and you see why: a fault shows the reason from the device (no sensor, open loop, no output), an alarm shows the state and the alarm value. A fault is a quieter red than an alarm'],
    ['Flaggene leses på nytt hvert tjuende sekund mens Live går, så en feil som har gått over forsvinner, og en ny alarm dukker opp uten at du leser enheten på nytt', 'The flags are read again every twenty seconds while Live runs, so a fault that has cleared goes away and a new alarm appears without reading the device again'],
  ],
  '1.57': [
    ['NABE kan oppdatere seg selv. Utgivelsen er signert, og signaturen sjekkes før noe installeres: stemmer den ikke, kastes filen og ingenting endres. Fra og med denne versjonen kommer nye versjoner som en knapp i statuslinja', 'NABE can update itself. The release is signed, and the signature is checked before anything is installed: if it does not match, the file is thrown away and nothing changes. From this version on, new versions arrive as a button in the status bar'],
    ['Simulator: et anlegg du har lest kan startes som BACnet-enheter på denne PC-en, med samme navn, beskrivelser og verdier. Den lagres og kan startes igjen uten anlegg, og RT og SB kan pendle. Alt er merket SIMULATOR', 'Simulator: a site you have read can be started as BACnet devices on this PC, with the same names, descriptions and values. It is saved and can be started again without the plant, and RT and SB can hunt. Everything is marked SIMULATOR'],
    ['Overvåkingslista huskes per anlegg og hentes tilbake når du åpner anlegget igjen', 'The watch list is remembered per site and comes back when you open the site again'],
  ],
  '1.56': [
    ['Flere nettverkskort samtidig: hver adresse går ut av kortet den rutes gjennom, og områder bak ulike kort skannes samtidig. Enhetene viser hvilket kort de leses via, og statuslinja viser +1 når flere kort er i bruk', 'Several network adapters at once: every address goes out of the adapter it is routed through, and ranges behind different adapters are scanned at the same time. Devices show which adapter they are read through, and the status bar shows +1 when more than one is in use'],
    ['Et anlegg bak FortiClient med bare standardrute regnes som nåbart når en av enhetene det husker svarer, så oppstarten går til anlegget du var på sist', 'A site behind FortiClient with only the default route counts as in reach once one of its remembered devices answers, so start-up goes to the site you were on last'],
    ['Trafikkloggen viser kortet per forespørsel og et sammendrag per kort, så det er lett å se hvilken forbindelse som er stille', 'The traffic log shows the adapter per request and a summary per adapter, so it is easy to see which connection is silent'],
  ],
  '1.55': [
    ['Slår du av automatisk valg av nettverkskort i innstillinger, går alt ut av kortet du velger. Oppstarten flytter deg ikke til et anlegg på et annet kort', 'Turn automatic adapter choice off in Settings and everything goes out of the adapter you pick. Start-up does not move you to a site on another adapter'],
    ['COV-vakt: når varslene uteblir, merkes punktet «COV stille», leses i stedet og abonneres på nytt. COV leverer nå verdier, det gjorde den ikke før', 'COV guard: when notifications stop, the point is marked "COV silent", read instead and subscribed again. COV now delivers values, which it did not before'],
    ['Flat linje, feil sommertid/vintertid, avvik fra settpunkt, trafikklogg og pendlingsdetektor for RT mot SB', 'Flatline, wrong summer/winter time, deviation from setpoint, a traffic log and a hunting detector for RT against SB'],
  ],
  '1.54': [
    ['Tunnelen spør nå BACnet-enhetene selv om de er der. En ruter med samme adresse hjemme teller ikke lenger som anlegget', 'The tunnel now asks the BACnet devices themselves whether they are there. A router at home with the same address no longer counts as the site'],
  ],
  '1.53': [
    ['Tunnelen kommer når ingen anlegg faktisk svarer, også når VPN-en henger med ruter, men uten forbindelse. Den kan alltid startes fra paletten: Tunnelen (spill)', 'The tunnel comes up when no site actually answers, also when the VPN keeps its routes without a connection. It can always be started from the palette: Tunnelen (spill)'],
  ],
  '1.52': [
    ['Spør NABE leser punktet du står på, navn og beskrivelse, på norsk og engelsk, og foreslår tag også når navnet er AV5. Spør om alle punkter for å få hele enheten', 'Ask NABE reads the point you are on, name and description, in Norwegian and English, and suggests a tag even when the name is AV5. Ask about all points to get the whole device'],
  ],
  '1.51': [
    ['Spør NABE har fått en fast knapp øverst til høyre og Ctrl+J. Med Spør NABE-pekeren stopper han når du hviler musa, og svarer i en snakkeboble', 'Ask NABE has a fixed button at the top right and Ctrl+J. With the Ask NABE pointer he stops when you rest the mouse, and answers in a speech bubble'],
    ['Raskere skann: de stille adressene sjekkes tre ganger så fort, med like mange forsøk. NABE åpner også raskere', 'Faster scans: silent addresses are checked three times as fast, with as many attempts. NABE also opens faster'],
    ['Telleren i IP-feltet legger seg ikke lenger over adressen', 'The counter in the IP field no longer sits on top of the address'],
  ],
  '1.48': [
    ['Opprydding i koden', 'A tidy-up in the code'],
  ],
  '1.47': [
    ['Oppslagsverk i Spør NABE: TFM og tagger per fabrikat, BACnet, Niagara, Regin, TwinCAT, Distech og WAGO', 'A reference in Ask NABE: TFM and tags by make, BACnet, Niagara, Regin, TwinCAT, Distech and WAGO'],
    ['Lokal KI som valg: kjører på PC-en og formulerer svar ut fra oppslagsverket, alltid med kilden under. Uten kilde svarer den ikke. Under Innstillinger, eller i installasjonen', 'Local AI as a choice: runs on the PC and words answers from the reference, always with the source below. Without a source it does not answer. Under Settings, or in the installer'],
  ],
  '1.46': [
    ['Opptak av punkter: velg punkter, la NABE logge dem i timevis og åpne CSV-fila i Excel. Under ⋯-menyen', 'Recording points: select points, let NABE log them for hours and open the CSV in Excel. Under the ⋯ menu'],
    ['Spør NABE: finn overstyrte punkter, alarmer og punkter på navn, og få forklart BACnet-ord. Alt skjer på denne PC-en. I paletten, eller som peker i garderoben', 'Ask NABE: find overridden points, alarms and points by name, and get BACnet words explained. It all happens on this PC. In the palette, or as a pointer in the wardrobe'],
  ],
  '1.45': [
    ['Fullskjerm: knapp øverst til høyre, eller F11', 'Full screen: a button at the top right, or F11'],
  ],
  '1.44': [
    ['25 nye plagg til NABE og NABO: fra sixpence og sveisemaske til kappe, adgangskort og papegøye', '25 new items for NABE and NABO: from a flat cap and a welding mask to a cape, an access card and a parrot'],
    ['Pekere: ny fane i garderoben med 45 pekere, fra patchkabel og tur og retur til lommelykt, Lille NABE og skrutrekker. De kommer av arbeid, som plaggene', 'Pointers: a new tab in the wardrobe with 45 pointers, from a patch cable and flow and return to a flashlight, Little NABE and a screwdriver. They come from work, like the items'],
    ['Lexend som skrift, og enhetsoverskriften er satt som tittelfeltet på en tegning', 'Lexend as the typeface, and the device heading set like the title block on a drawing'],
  ],
  '1.43': [
    ['Alt beveger seg likt nå: dialoger og menyer kommer med en ekte fjær, litt forbi målet og tilbake', 'Everything moves alike now: dialogs and menus arrive on a real spring, a little past the target and back'],
    ['Enheter som bytter plass i lista glir dit i stedet for å hoppe, og punktene glir inn når du bytter enhet', 'Devices that change place in the list glide there instead of jumping, and the points glide in when you change device'],
    ['Tittellinja i Windows følger fargene i NABE, i både mørkt og lyst tema', 'The Windows title bar follows NABE’s colours, in both dark and light theme'],
  ],
  '1.42': [
    ['Ryddet bort det gamle: Tagging-fanen i Innstillinger, den gamle Variabel-generatoren, Lagre/Åpne anlegg og «Anlegg jeg har vært på». NABO gjør taggingen, og startsiden husker anleggene', 'Cleared out the old: the Tagging tab in Settings, the old Variabel generator, Save/Open site and “Sites I have visited”. NABO does the tagging, and the start page remembers the sites'],
    ['Gi navn og Glem står nå på hver rad på startsiden', 'Rename and Forget now sit on each row of the start page'],
    ['EDE-eksporten lager ikke lenger en _TagSettings-fil', 'The EDE export no longer makes a _TagSettings file'],
    ['Plaggene, tellerne og tunnelrekorden lagres også i NABE-mappa, så de følger med til en ny PC', 'Items, counters and the tunnel record are also kept in the NABE folder, so they come along to a new PC'],
  ],
  '1.41': [
    ['Startsiden gjør det du ber om: et anlegg du klikker, skannes også om NABE fortsatt kobler til, og «Bare åpne» eller Esc avlyser søket ved oppstart også før det har begynt', 'The start page does what you ask: a site you click is scanned even while NABE is still connecting, and “Just open it” or Esc call off the search on start even before it has begun'],
  ],
  '1.40': [
    ['NABE åpner maksimert, og husker om vinduet var maksimert. Lukket du den minimert, åpnet den før utenfor skjermen', 'NABE opens maximised, and remembers whether the window was. Closed while minimised, it used to open off screen'],
  ],
  '1.39': [
    ['Flere punkter sammen: velg to eller flere (Ctrl-klikk, Shift-klikk eller dra over radene), så tegner inspektøren dem i én graf mens Live går. Hver kurve har sin egen skala, så % og °C kan stå side om side', 'Several points together: select two or more (Ctrl-click, Shift-click or drag over the rows) and the inspector draws them in one chart while Live runs. Each curve has its own scale, so % and °C can sit side by side'],
    ['Shift- og Ctrl-klikk i tabellen markerer rader, ikke tekst, og Shift tegner ikke lenger en blå ramme rundt panelet', 'Shift- and Ctrl-click in the table select rows, not text, and Shift no longer draws a blue ring around the pane'],
  ],
  '1.38': [
    ['Tunnelen: når ingen anlegg kan nås, kan NABE kjøres gjennom en VPN-tunnel som er nede. Hold mellomrom for å stige, unngå brannmurene, samle I-Am', 'The tunnel: when no site can be reached, NABE can be flown through a dead VPN tunnel. Hold space to rise, dodge the firewalls, collect I-Am'],
    ['Tre plagg som bare finnes i Tunnelen: flygebriller, gullkabel, og en jetpakke for den som klarer 150 poeng i én tur', 'Three items found only in the tunnel: flying goggles, a gold cable, and a jetpack for whoever makes 150 points in one run'],
  ],
  '1.37': [
    ['Lukkevakta stopper deg bare for punkter du kan frigi herfra. Står det noe overstyrt på et nett du har forlatt, lukker NABE og minner deg på det neste gang du er der', 'The close guard only stops you for points you can release from here. Something overridden on a network you have left: NABE closes, and reminds you next time you are there'],
    ['«Glem» tar et punkt av lista uten å skrive noe, for det som er frigitt på annen måte. Det står i skriveloggen', '“Forget” takes a point off the list without writing anything, for what was released some other way. It shows in the write log'],
  ],
  '1.36': [
    ['Klikk IP-adressen i enhetsoverskriften for å åpne regulatorens webgrensesnitt i nettleseren. NABE velger HTTPS eller HTTP etter hva den svarer på', 'Click the IP address in the device heading to open the controller’s web interface in your browser. NABE picks HTTPS or HTTP by what it answers on'],
  ],
  '1.35': [
    ['«Bare åpne» og Esc på startsiden stopper søket ved oppstart. Feltet beholder anlegget, så Enter skanner når du vil', '“Just open it” and Esc on the start page stop the search on start. The field keeps the site, so Enter scans when you like'],
    ['Garderoben kan rulles helt ned til Hals', 'The wardrobe scrolls all the way down to Neck'],
    ['Et skann du stopper selv, gir ikke lenger råd om hvorfor ingen svarte', 'A scan you stop yourself no longer gives advice about why nobody answered'],
  ],
  '1.34': [
    ['Lukkevakta er ny: punktene som står overstyrt med navn, regulator, prioritet og når de ble skrevet, og knapper i vanlig størrelse', 'The close guard is new: the points still overridden by name, controller, priority and when they were written, and buttons of a normal size'],
    ['«Siste punkter» (Ctrl+E) og karrierekortet har fått tilbake sin egen form', '“Recent points” (Ctrl+E) and the career card have their own shape back'],
  ],
  '1.33': [
    ['Garderoben: klær til NABE og NABO, låst opp av ekte arbeid. Hjelmen kommer når du skriver til et anlegg, hodelykta etter et nattskann. Høyreklikk en av dem', 'The wardrobe: clothes for NABE and NABO, unlocked by real work. The hard hat comes with your first write to a plant, the head torch after a scan at night. Right-click either of them'],
    ['Arbeidsklær etter situasjon: lesebriller og notat i dokumenter, hjelm når du skriver, hodetelefoner på Live', 'Work gear for the moment: reading glasses and a note in documents, a hard hat when you write, headphones on Live'],
    ['NABE og NABO prater sammen innimellom, og NABE svarer når NABO pinger', 'NABE and NABO talk now and then, and NABE answers when NABO pings'],
    ['Ny bunnlinje: Live er en knapp med en strek som fylles fram til neste lesing, og bakgrunnslesingen er en fremdriftslinje. Ingen pulserende prikker', 'A new bottom bar: Live is a button with a line that fills up to the next read, and the background read is a progress bar. No pulsing dots'],
    ['Søk i anlegget midt i topplinja. Tomt søk viser alle enhetene per nett', 'Search the plant in the middle of the toolbar. An empty search lists every device per network'],
    ['Hold musa over en trend eller trendlogg for klokkeslett og verdi', 'Hover a trend or trend log for the time and value'],
    ['«Alle egenskaper» i inspektøren leser alt objektet har', '“All properties” in the inspector reads everything the object has'],
    ['Skriveloggen er et eget vindu, gruppert per dag', 'The write log is a proper window, grouped by day'],
    ['NABO: Statsbygg-profil etter merkemanualen: 111096_3601_001_04_RTB01_MV. Profilen velges selv ut fra anlegget', 'NABO: a Statsbygg profile after their tag manual: 111096_3601_001_04_RTB01_MV. The profile picks itself from the site'],
    ['Hele appen på engelsk, også meldingene fra serveren', 'The whole app in English, the server’s messages too'],
  ],
  '1.32': [
    ['NABE henger ikke lenger når du lukker den med punkter overstyrt: lukkevakta kommer i stedet for «svarer ikke»', 'NABE no longer hangs when closed with points overridden: the close guard shows instead of “not responding”'],
    ['Innstillingene har avkrysningsbokser som på en Mac, ikke telefonbrytere', 'Settings have checkboxes as on a Mac, not phone switches'],
    ['Skriv-knappen er rolig til du har en verdi, og sier så nøyaktig hva den gjør: «Skriv 21,5 på pri 8»', 'The Write button is quiet until there is a value, and then says exactly what it does: “Write 21.5 at pri 8”'],
    ['Enhetskortene skiller alarm fra feil, og kommandopaletten har fått tilbake æ, ø og å. «sok» finner fortsatt «Søk»', 'Device cards tell an alarm from a fault, and the command palette has its æ, ø and å back. “sok” still finds “Søk”'],
  ],
  '1.31': [
    ['Ny startside: hvem og hva til venstre, anleggene dine til høyre i én liste med prikk for det som er nåbart. Piltaster og Enter velger', 'A new start page: who and what on the left, your sites on the right in one list with a dot for what is in reach. Arrow keys and Enter choose'],
    ['Startsiden blir stående mens NABE skanner anlegget du var på sist, og raden viser svarene som kommer', 'The start page stays while NABE scans the site you were at last, and the row shows the replies as they come'],
    ['Skanner du flere nett, grupperes enhetene etter nett, med leverandør inni når et nett er stort', 'Scan several networks and the devices are grouped by network, with vendor inside when a network is large'],
    ['NABE avslutter med en gang vinduet lukkes, også når en forespørsel henger', 'NABE exits as soon as the window closes, also when a request is hanging'],
  ],
  '1.30': [
    ['Hundrevis av feil under én del av en JACE blir én linje: «527 under BACnet IP.564001-OU001». Trolig én forbindelse nede, ikke 527 feil. Klikk for bare de punktene', 'Hundreds of faults under one part of a JACE become one line: “527 under BACnet IP.564001-OU001”. Probably one link down, not 527 faults. Click for just those points'],
    ['Et skann som ikke hører noe, sletter ikke lenger enhetene NABE husker fra anlegget', 'A scan that hears nothing no longer wipes the controllers NABE remembers for the site'],
    ['Søket ved oppstart tar anlegget du var på sist, også når flere er innen rekkevidde, og tomme skann står ikke lenger på startkortet', 'The search on start takes the site you were at last, also when several are in reach, and empty scans no longer stand on the start card'],
  ],
  '1.29': [
    ['NABE søker selv når den åpnes: kabelen inn i anlegget, eller anlegget du var på sist, og åpner regulatoren du slapp', 'NABE looks for itself when it opens: the cable into the plant, or the site you were at last, and opens the controller you left'],
    ['Én linje for hele anlegget over enhetslista: overstyrt, i alarm, feil og ute av drift på alle regulatorene. Klikk et tall for punktene', 'One line for the whole plant above the device list: overridden, in alarm, faulty and out of service across every controller. Click a count for the points'],
    ['Kopier status til servicerapporten, og se hva som er endret siden forrige besøk', 'Copy the status for the service report, and see what changed since the last visit'],
  ],
  '1.28': [
    ['Romtagger starter med systemnummer og rom: 564.001.288.RT601.WSP, uten OU001 og Plan2', 'Room tags start with system number and room: 564.001.288.RT601.WSP, without OU001 and Plan2'],
    ['Forslag fra beskrivelsen kjenner Børverdi som Settpunkt, og X3 eller Y3 i et kurvepunkt følger med til taggen (RT401.K.X3)', 'Suggestions from the description know Børverdi as Settpunkt, and X3 or Y3 in a curve point comes along to the tag (RT401.K.X3)'],
  ],
  '1.27': [
    ['NABO foreslår tagger fra beskrivelsen, lært av Variabel-eksportene dine: «Temperatur tilluft» blir RT401, «Pådrag tilluftsvifte» blir JV401 … Gn. Bare på punkter uten komponentkode', 'NABO suggests tags from the description, learnt from your Variabel exports: “Temperatur tilluft” becomes RT401, “Pådrag tilluftsvifte” becomes JV401 … Gn. Only on points without a component code'],
    ['Velg PX-familie per anlegg (freeTag, nordomatic/statsbygg, Beckhoff TC2), så følger signalnavnene malene i nmNxFiles: Gn blir C, Err blir A, Drift blir D', 'Pick the PX family per site (freeTag, nordomatic/statsbygg, Beckhoff TC2) and the signal names follow the templates in nmNxFiles: Gn becomes C, Err becomes A, Drift becomes D'],
  ],
  '1.26': [
    ['NABO har en ordliste for endelser per komponenttype. Energimålere (OE) er fylt inn fra Variabel-eksportene: Energy blir kWh, Power kW, Flow m3, FT RT4, RT RT5', 'NABO has a word list for endings per kind of component. Energy meters (OE) are filled in from the Variabel exports: Energy becomes kWh, Power kW, Flow m3, FT RT4, RT RT5'],
    ['Retter du en endelse på én komponent, kan du velge «Husk for alle OE», så skjer det av seg selv på alle anlegg', 'Correct an ending on one component and choose “Remember for every OE”, and it happens by itself on every site'],
  ],
  '1.25': [
    ['NABO: «_ etter komponentkoden». RT601.SP.ADJ blir RT601.SP_ADJ, JP400.TW.AUTO blir JP400.TW_AUTO', 'NABO: “_ after the component code”. RT601.SP.ADJ becomes RT601.SP_ADJ, JP400.TW.AUTO becomes JP400.TW_AUTO'],
    ['Valgene for taggene blir med når du skriver inn et anleggsnavn, i stedet for å forsvinne', 'The tag choices come along when you type a site name, instead of disappearing'],
  ],
  '1.24': [
    ['Endrer du én tagg, tilbyr NABO det samme på de andre med lik sti: tatt bort foran, byttet midt inni, eller ledd slått sammen. Ctrl+Z angrer', 'Edit one tag and NABO offers the same on the others with the same path: taken off the front, swapped in the middle, or parts joined. Ctrl+Z undoes it'],
    ['Tar du bort et navn midt i en tagg, går ledd av samme form også (Plan1, Plan2, Plan3)', 'Take a name out of the middle of a tag and parts of the same shape go too (Plan1, Plan2, Plan3)'],
    ['Valg per anlegg: behold _K, _Gn og andre korte endelser som i navnet, også med punktum hele veien', 'Per site: keep _K, _Gn and other short endings as in the name, even with dots all the way'],
  ],
  '1.23': [
    ['NABO: «Start ved systemnummeret». Navn kopiert fra en Niagara-stasjon blir til ekte tagger: 564001-OS001/BACnet IP.360003.AV-40128 blir 360.003.AV.40128', 'NABO: “Start at the system number”. Names copied from a Niagara station become real tags: 564001-OS001/BACnet IP.360003.AV-40128 becomes 360.003.AV.40128'],
    ['Knapp for å nullstille håndrettede tagger, så regelen kan virke på dem også', 'A button to reset hand-edited tags, so the rule applies to them too'],
    ['Tastaturet lyser når NABO taster, og inne i NABO taster den store figuren med', 'The keyboard lights when NABO types, and inside NABO the large figure types along'],
  ],
  '1.22': [
    ['Aktive alarmer viser også punkter med alarm- eller feilflagg. Mange regulatorer har tom alarmliste selv når noe står i alarm, og da sa NABE «ingen alarmer» feil', 'Active alarms also shows points with an alarm or fault flag. Many controllers have an empty alarm list even when something is in alarm, and NABE wrongly said “no alarms”'],
    ['NABO: «Fjern fra starten». Klikk leddet du vil kutte til, så forsvinner f.eks. 564.001.OS001/FCB fra alle tagger. Huskes per anlegg', 'NABO: “Remove from the start”. Click the part to cut to and 564.001.OS001/FCB, say, goes from every tag. Remembered per site'],
    ['Etter kuttet blir 320002 til 320.002, og samme systemnummer to-tre ganger på rad står bare én gang', 'After the cut 320002 becomes 320.002, and the same system number two or three times in a row is kept once'],
    ['Roligere topp i NABO: valgene for anlegg og prefiks vises først når feltet har noe i seg', 'A calmer top in NABO: the site and prefix choices appear only once the field has something in it'],
  ],
  '1.21': [
    ['NABE sier «ingen feil» bare etter en full, fersk lesing der hvert punkts status faktisk ble lest, og bare om den ene regulatoren', 'NABE says “no faults” only after a full, fresh read where every point’s status was actually read, and only about that one controller'],
    ['Ryddigere statuslinje og enhetshode: antall punkter står under navnet, «vist» bare når et filter skjuler noe', 'A tidier status bar and device header: the point count sits under the name, “shown” only when a filter hides something'],
    ['Anlegg jeg har vært på er en liste: klikk skanner, dobbeltklikk gir navn, søk når de blir mange', 'Sites I have visited is a list: a click scans, a double-click renames, a search when there are many'],
    ['Ctrl+S, Ctrl+O og Ctrl+, som i andre programmer, og en knapp som slår på Live der trenden skal være', 'Ctrl+S, Ctrl+O and Ctrl+, as in other programs, and a button that turns Live on where the trend goes'],
  ],
  '1.20': [
    ['Innstillinger med ekte brytere og nedtrekk, samlet i grupper. Indigo er borte fra forhåndsvalgene', 'Settings with real switches and pop-up buttons, in groups. Indigo is gone from the presets'],
    ['Én stille lukk-knapp i alle dialoger, haker i filtermenyen og blå hovedknapp i begge moduser', 'One quiet close button in every dialog, check marks in the filter menu and a blue default button in both themes'],
    ['Engelsk overalt der det manglet, oppdatert hjelp, og simulatorer på 127.0.0.x regnes som nåbare', 'English wherever it was missing, updated help, and simulators on 127.0.0.x count as reachable'],
  ],
  '1.19': [
    ['Ett felt for IP, område eller anleggsnavn. Anleggene står under med grønn prikk når det finnes en vei dit', 'One field for an IP, a range or a site name. Your sites sit below it, with a green dot when there is a way there'],
    ['Kort og modus er én linje. NABE sier fra når Windows ville tatt feil vei, og bruker riktig kort', 'Adapter and mode are one line. NABE tells you when Windows would have taken the wrong way, and uses the right adapter'],
    ['NABE legger merke til en tunnel som kommer opp, et anlegg du lot stå overstyrt og en regulator som mangler siden sist', 'NABE notices a tunnel coming up, a site you left overridden and a controller missing since last time'],
    ['NABO er NABEs lillebror nå. Han sitter ved tastaturet, taster litt innimellom og svarer storebror på sin måte', 'NABO is NABE’s little brother now. He sits at his keyboard, types now and then and answers his big brother in his own way'],
  ],
  '1.18': [
    ['Designgjennomgang med tre par øyne: flat temabryter, lyse skillelinjer i lys modus, ingen piller eller indigo igjen', 'A design review with three pairs of eyes: a flat theme switch, light hairlines in light mode, no pills or indigo left'],
    ['NABO: én knappehøyde, én type faner, Esc går ett steg tilbake om gangen, og .ini ligger under Avansert', 'NABO: one button height, one kind of tab, Esc goes back one step at a time, and .ini sits under Advanced'],
    ['Naboene leker ikke når vinduet er skjult eller en dialog er åpen, og sovner ikke rett etter at du kom tilbake', 'The neighbours do not play while the window is hidden or a dialog is open, and do not doze off right after you return'],
  ],
  '1.17': [
    ['Naboen kler seg for årstiden. Mer sier vi ikke', 'The neighbour dresses for the season. We say no more'],
    ['Når de leker, kan du ta ballen', 'When they play, you can catch the ball'],
    ['Noen ord i NABOs søkefelt får svar, og det lønner seg å banke på', 'A few words in NABO’s search get an answer, and knocking pays off'],
  ],
  '1.16': [
    ['NABO er målt mot 7516 ekte tagger fra ekte EDE-filer, og treffer nå der de var riktige', 'NABO is measured against 7516 real tags from real EDE files, and now matches where they were right'],
    ['Tekst med mellomrom er ett ledd (Drift fra SD-anlegg), romkoder blir R00_0004, og skråstrek beholdes', 'Text with spaces is one part (Drift fra SD-anlegg), room codes become R00_0004, and a slash is kept'],
    ['Et s foran systemnummeret (s360001) markerer hvor taggen starter', 'An s before the system number (s360001) marks where the tag starts'],
    ['Punkter uten SD-kode får ikke trend', 'Points without an SD code get no trend'],
    ['Finnes ikke noe device-navn, brukes filnavnet uten EDE og datoer', 'With no device name to be found, the file name without EDE and dates is used'],
  ],
  '1.15': [
    ['Naboen har fått kinn, og pipa puster litt nå og da', 'The neighbour has cheeks, and the chimney breathes now and then'],
    ['Er du borte en stund, sovner begge to. Så vekker den ene den andre for å leke', 'Away for a while and both fall asleep. Then one wakes the other to play'],
  ],
  '1.14': [
    ['NABO: lange Niagara-stier brytes etter punktum i stedet for å presse tabellen ut av vinduet', 'NABO: long Niagara paths break after a dot instead of pushing the table out of the window'],
    ['Skråstrek i punktnavn (OS001/FCB) blir mapper, som punktum', 'A slash in a point name (OS001/FCB) becomes a folder, like a dot'],
    ['Advarselen om kort sti er borte: den slo ut på hundrevis av leverandørpunkter og druknet de som betyr noe', 'The short path warning is gone: it hit hundreds of vendor points and drowned the ones that matter'],
  ],
  '1.13': [
    ['NABO: systemnummer skrevet i ett deles, 360001 blir 360.001', 'NABO: system numbers written in one piece are split, 360001 becomes 360.001'],
    ['Anlegg og prefiks er valgfrie, og du velger selv om de skal stå i taggen', 'Site and prefix are optional, and you choose whether they go in the tag'],
    ['Ingenting stopper eksporten lenger fordi et felt er tomt', 'Nothing stops the export any more because a field is empty'],
    ['Normalisering ligger under Avansert, og SD-koden leses fra beskrivelsen som før', 'Normalisation sits under Advanced, and the SD code is read from the description as before'],
  ],
  '1.12': [
    ['NABO: punktene står gruppert per enhet, og klikk på enheten markerer alle punktene', 'NABO: points are grouped per device, and clicking the device ticks all of them'],
    ['Hele tabellen får plass uten sidescroll, og verktøylinja bryter pent i smale vinduer', 'The whole table fits without sideways scrolling, and the toolbar wraps neatly in narrow windows'],
    ['En stor slippsone midt i NABO når ingenting er lastet inn ennå', 'A big drop zone in the middle of NABO while nothing is loaded yet'],
  ],
  '1.11': [
    ['NABO: klikk, Shift og Ctrl markerer rader, og «samme navnemønster» eller «samme type» tar resten', 'NABO: click, Shift and Ctrl tick rows, and "same name pattern" or "same type" takes the rest'],
    ['Unntakene huskes per anlegg, også når samme EDE kommer med ny dato i filnavnet', 'The exceptions are kept per site, also when the same EDE arrives with a new date in its name'],
    ['SYSTEM-punktene ligger i egen mappe på toppnivå, utenfor systemene', 'SYSTEM points sit in their own folder at the top, outside the systems'],
    ['Prefiks er valgfritt, med en velger: foran device, foran device og tag, eller +PRE=360.001', 'The prefix is optional, with a choice: before the device, before device and tag, or +PRE=360.001'],
    ['Cluster er Citect-clusteret og påvirker ikke Niagara-taggene', 'Cluster is the Citect cluster and does not touch the Niagara tags'],
    ['Slipp en EDE-fil hvor som helst i NABE, så åpner NABO seg med den', 'Drop an EDE file anywhere on NABE and NABO opens with it'],
  ],
  '1.10': [
    ['NABO: punktum mellom alle ledd er fast standard, slik Niagara lager mapper, og «Del navnet på» er borte', 'NABO: dots between all parts is the fixed standard, the way Niagara makes folders, and "Split the name on" is gone'],
    ['Marker rader (Shift for flere) og velg «Siste ledd med _» for punkter som SYSTEM.OU001.HB_KV, eller «Marker alle som slutter likt»', 'Tick rows (Shift for a range) and choose "Last part with _" for points like SYSTEM.OU001.HB_KV, or "Tick all that end the same"'],
    ['Avansert › SD-kode: legg SD1T, SD00 osv. først i beskrivelsen, ut fra trend og alarm i tabellen', 'Advanced › SD code: put SD1T, SD00 and so on first in the description, from trend and alarm in the table'],
    ['Velg om prefikset eller anleggsnavnet skal stå først i taggen', 'Choose whether the prefix or the site name goes first in the tag'],
    ['Cluster og desimaler ligger under Avansert, og SYSTEM-punkter får ikke lenger advarsel om kort sti', 'Cluster and decimals are under Advanced, and SYSTEM points no longer warn about a short path'],
    ['Filene havner i Nedlastinger også i app-vinduet, der de før kunne forsvinne uten beskjed', 'Files land in Downloads in the app window too, where they could vanish without a word before'],
  ],
  '1.9.1': [
    ['NABO: velg hvor filene lagres - Nedlastinger, eksportmappa eller en mappe du velger selv', 'NABO: choose where files are saved - Downloads, the export folder or a folder of your own'],
    ['«Åpne mappa» viser fila du nettopp lagret i Utforsker', '"Open folder" shows the file you just saved in Explorer'],
  ],
  '1.9': [
    ['NABO: klikk en tag, beskrivelse, enhet eller desimaler for å rette den, Tab går nedover som i Excel', 'NABO: click a tag, description, unit or decimals to edit it, Tab goes down as in Excel'],
    ['Klikk trend eller alarm for å slå av og på, ↺ tar raden tilbake til det automatiske', 'Click trend or alarm to switch it, ↺ takes the row back to the automatic value'],
    ['Erstatt… (Ctrl+H): søk og erstatt i tagger eller beskrivelser, med forhåndsvisning og angre', 'Replace… (Ctrl+H): find and replace in tags or descriptions, with a preview and undo'],
    ['Velg hvilke tegn navnet deles på: _ . - og mellomrom', 'Choose which characters split the name: _ . - and space'],
  ],
  '1.8.1': [
    ['NABE har fått en nabo: huset ved navnet øverst, eller tasten N, går rett til NABO', 'NABE has a neighbour: the house by the name at the top, or the N key, goes straight to NABO'],
    ['På startskjermen står naboen ved siden av NABE, og i NABO titter NABE over gjerdet', 'On the start screen the neighbour stands beside NABE, and in NABO, NABE peeks over the fence'],
  ],
  '1.8': [
    ['NABO › Sammenlign: les inn Variabel-fila Niagara fikk, og se hva som er nytt, endret og borte', 'NABO › Compare: read in the Variabel file Niagara got, and see what is new, changed and gone'],
    ['Lag en fil med bare nye og endrede rader til NTI', 'Make a file with only the new and changed rows for NTI'],
    ['NABO › Normalisering: regex, mal for stien og funksjonskoder fra TC2 til NM, med test på ekte navn', 'NABO › Normalisation: a regex, a path template and function codes from TC2 to NM, tested on real names'],
    ['Flere sjekker, og et stopp før en fil med feil eksporteres', 'More checks, and a stop before a file with errors is exported'],
    ['Enheter skrives i entall: pascal, bar, kilowatt hour', 'Units are written in the singular as Niagara expects: pascal, bar, kilowatt hour'],
  ],
  '1.7': [
    ['NABO - Not Another BACnet Object-namer: tagger og Variabel-fil til Niagara, under Eksport', 'NABO - Not Another BACnet Object-namer: tags and the Variabel file for Niagara, under Export'],
    ['Enheter fra anlegget og EDE-filer side om side, med device-navnet riktig', 'Devices from the plant and EDE files side by side, with the device name right'],
    ['Leser og lagrer oppsettet som ini-fil', 'Reads and saves the settings as an .ini file'],
    ['Desimaler per enhetstype og trendintervall, og varsel om like tagger', 'Decimals per unit type and trend interval, and a warning on duplicate tags'],
  ],
  '1.6.4': [
    ['Startskjermen viser kortene dine med IP og nettene bak dem - klikk for å skanne derfra', 'The start screen shows your adapters with their IP and the networks behind them - click to scan from there'],
    ['Anleggene står med kontrollernavn, leverandør og hvilket kort de nås via', 'Sites are listed by controller name, vendor and the adapter that reaches them'],
    ['Nedtrekkslister er mørke i mørk modus', 'Dropdowns are dark in dark mode'],
  ],
  '1.6.3': [
    ['Siste rad i en kort punktliste er ikke lenger tonet ned', 'The last row of a short point list is no longer faded'],
  ],
  '1.6.2': [
    ['Enheter funnet med Who-Is - på eget nett og via BBMD - får navn og leverandør', 'Devices found by Who-Is - on your own subnet and through a BBMD - get their name and vendor'],
  ],
  '1.6.1': [
    ['Kortet som sitter på samme nett som anlegget velges alltid - ikke mobilen fordi Windows husket en gammel vei', 'The adapter on the plant’s own subnet is always picked - not the 4G modem because Windows remembered an old path'],
    ['Kort uten link (Wi-Fi utenfor rekkevidde, frakoblet VPN) står ikke lenger i lista', 'Adapters with no link (Wi-Fi out of range, VPN disconnected) are no longer listed'],
  ],
  '1.6': [
    ['Velg nettverkskort, så foreslår NABE nettene bak det - fra rutetabellen og anlegg du har skannet derfra', 'Pick an adapter and NABE suggests the networks behind it - from the routing table and sites scanned through it'],
    ['Lim inn tekst med IP-er i, porter og ord rundt - feltet tar bare adressene', 'Paste text with IPs in it, ports and words around them - the field keeps just the addresses'],
    ['Finn enhet: filtrer enhetslista på navn, IP eller instans', 'Find device: filter the device list by name, IP or instance'],
    ['Skriv i enhetslista for å hoppe, pil opp i søkefeltet for forrige søk', 'Type in the device list to jump, arrow up in search for earlier searches'],
    ['Pek på AV, BI, MSV … for hva objekttypen er', 'Point at AV, BI, MSV … to see what the object type is'],
    ['Klikk «vist av» i statuslinja for å nullstille filteret', 'Click "shown of" in the status bar to clear the filter'],
  ],
  '1.5': [
    ['Variabel-fila ligger nå i Eksport-menyen', 'The Variabel file is now in the Export menu'],
    ['Enhetslista hopper ikke lenger under musa mens anlegget leses', 'The device list no longer jumps under the pointer while the site is read'],
    ['Smale vinduer: tabellen beholder kolonnene sine', 'Narrow windows: the table keeps its columns'],
    ['Live blinker rolig, og Escape lukker alle dialoger', 'Live flashes quietly, and Escape closes every dialog'],
  ],
  '1.4': [
    ['NABE ser etter musa når den forlater vinduet, og dukker når den kommer for fort', 'NABE watches the pointer leave the window, and ducks when it comes too fast'],
    ['Åpne et varmt eller kaldt temperaturpunkt', 'Open a hot or a cold temperature point'],
    ['Han husker om du klapper ham, eller drar i ham', 'He remembers whether you pet him, or drag him'],
    ['Han snakker ferdig før han sier noe nytt', 'He finishes a line before starting the next'],
  ],
  '1.3': [
    ['NABE puster, fikler når ingen ser, og liker å bli klappet', 'NABE breathes, fidgets when nobody is looking, and likes being petted'],
    ['Prøv å dra i ham', 'Try dragging him'],
    ['Animasjoner på i Innstillinger betyr på, selv om Windows har skrudd dem av', 'Animations on in Settings now means on, even when Windows has them off'],
  ],
  '1.2': [
    ['Lukker du med punkter overstyrt, sier NABE fra', 'Close with points still overridden and NABE says so'],
    ['Prioritetslista viser hvilke plasser som er dine', 'The priority list shows which slots are yours'],
    ['System-knappen grupperer punktene etter 360.003, 320.001 ...', 'The System button groups points by 360.003, 320.001 ...'],
    ['Ctrl+E: siste punkter, på tvers av enheter', 'Ctrl+E: recent points, across devices'],
    ['Klokkevarselet kan trykkes på', 'The clock warning can be clicked'],
  ],
  '1.1': [
    ['Aktive alarmer per enhet i inspektøren', 'Active alarms per device in the inspector'],
    ['Live og overvåking bruker COV der regulatoren kan', 'Live and watch use COV where the controller allows'],
    ['Rutere og nettene bak dem vises etter skann', 'Routers and the networks behind them appear after a scan'],
    ['Diagnosen sier fra når et anlegg bare nås via fjernskrivebord', 'Diagnostics tell you when a plant is only reachable by remote desktop'],
    ['Denne skjermen', 'This screen'],
  ],
};

function hilsen() {
  const t = new Date().getHours();
  const n = teller().aapnet || 0;
  if (n > 100) return T('Du igjen. Selvfølgelig.', 'You again. Of course.');
  if (t < 6) return T('Hvorfor er vi våkne?', 'Why are we awake?');
  if (t < 10) return T('God morgen. Kaffen først.', 'Good morning. Coffee first.');
  if (t < 17) return T('Klar for enda en BACnet-explorer?', 'Ready for another BACnet explorer?');
  return T('God kveld. Sen igangkjøring?', 'Good evening. Late commissioning?');
}

let FAKTA_NR = null;

/* igjen: drawn again after a language switch - same fact, no count, no entrance.

   Laid out like a welcome window on a Mac: on the left who this is and what
   you can do, on the right the places you have been. One list, not two -
   the sites you were on and the networks the PC sits on now used to be
   shown separately, mostly saying the same thing twice. Arrow keys move
   through the list and Enter scans; typing goes to the field. */
async function visStartskjerm(igjen = false) {
  if (!igjen) tell('aapnet');
  const lag = document.createElement('div');
  lag.id = 'startskjerm';
  lag.className = 'startskjerm' + (igjen ? ' igjen' : '');
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-label', 'NABE');
  if (FAKTA_NR === null) FAKTA_NR = Math.floor(Math.random() * FAKTA.length);
  const fakta = FAKTA[FAKTA_NR];
  const sistSett = (() => { try { return localStorage.getItem('nabe_sett_versjon'); } catch { return null; } })();
  lag.innerHTML = `
    <div class="ss-kort">
      <section class="ss-venstre">
        <div class="ss-logo">${NABE_SVG.replace('width="26" height="26"', 'width="84" height="84"')}</div>
        <h1 class="ss-navn">NABE</h1>
        <div class="ss-under">Not Another BACnet Explorer<span class="ss-ver"></span></div>
        <div class="ss-hilsen">${esc(hilsen())}</div>
        <form class="ss-nytt">
          <label class="ss-felt-etikett" for="ssOmr">${T('Skann et område', 'Scan a range')}</label>
          <div class="ss-felt">
            <input class="field" id="ssOmr" placeholder="10.75.1.0/24" autocomplete="off" spellcheck="false">
            <button class="btn primary" type="submit">${T('Skann', 'Scan')}</button>
          </div>
          <div class="ss-felt-hint">${T('Én IP, et område som 10.75.1.10-40, eller flere med komma', 'One IP, a range like 10.75.1.10-40, or several with commas')}</div>
        </form>
        <div class="ss-handlinger">
          <button class="ss-videre" type="button"><span>${T('Bare åpne', 'Just open it')}</span><kbd>Esc</kbd></button>
          <div class="ss-nytt-i" hidden></div>
        </div>
        <div class="ss-bunn">
          <span class="ss-fakta">${esc(T(fakta[0], fakta[1]))}</span>
          <button class="ss-sprak" type="button" lang="${T('en', 'no')}">${T('English', 'Norsk')}</button>
        </div>
      </section>
      <section class="ss-hoyre">
        <div class="ss-liste-hode">${T('Anlegg', 'Sites')}</div>
        <div class="ss-liste" role="listbox" aria-label="${T('Anlegg', 'Sites')}">
          <div class="ss-tom">${T('Ser etter anlegg og nett…', 'Looking for sites and networks…')}</div>
        </div>
        <div class="ss-tast" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> ${T('velg', 'choose')} <kbd>↵</kbd> ${T('skann', 'scan')}</div>
      </section>
    </div>`;
  document.body.appendChild(lag);

  const lukk = () => {
    lag.classList.add('ut');
    setTimeout(() => lag.remove(), 260);
    document.removeEventListener('keydown', tast, true);
    try { localStorage.setItem('nabe_sett_versjon', NABE_VERSJON); } catch {}
  };
  const skann = (omr, modus) => {
    // Already being scanned by the search on start: just go in.
    if (document.body.classList.contains('skanner') && $('rangeInput').value.trim() === omr) { lukk(); return; }
    $('rangeInput').value = omr;
    if (modus && [...$('modeSel').options].some(o => o.value === modus)) $('modeSel').value = modus;
    savePrefs({range: omr, mode: $('modeSel').value});
    lukk();
    // A site chosen here is the start: the search on start stands down, and
    // the scan waits for the connection if NABE is still making it.
    if (typeof AN !== 'undefined') AN.avlyst = true;
    (async () => {
      for (let i = 0; i < 60 && !S.connected; i++) await new Promise(r => setTimeout(r, 200));
      await new Promise(r => setTimeout(r, 300));
      if (S.connected && !document.body.classList.contains('skanner')) runScan();
    })();
  };
  // A network row: bind that adapter first, so the scan goes out where the
  // route is rather than wherever Windows last sent it.
  // The server sends the scan out of the adapter the range is routed through.
  const skannVia = async (omr) => { skann(omr); };
  const rader = () => [...lag.querySelectorAll('.ss-rad')];
  const marker = (i) => {
    const r = rader();
    if (!r.length) return;
    i = Math.max(0, Math.min(r.length - 1, i));
    r.forEach((x, j) => x.setAttribute('aria-selected', String(j === i)));
    r[i].scrollIntoView({block: 'nearest'});
  };
  const markert = () => rader().findIndex(x => x.getAttribute('aria-selected') === 'true');
  const tast = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (typeof stoppAutoSkann === 'function') stoppAutoSkann(); lukk(); return; }
    const felt = $('ssOmr');
    // Up and down belong to the list; Enter scans the marked site unless
    // something has been typed in the field.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rader().length) return;
      e.preventDefault();
      const i = markert();
      marker(i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter' && !felt.value.trim() && markert() >= 0) {
      e.preventDefault();
      rader()[markert()].click();
    }
  };
  document.addEventListener('keydown', tast, true);
  lag.querySelector('.ss-videre').onclick = () => { if (typeof stoppAutoSkann === 'function') stoppAutoSkann(); lukk(); };
  lag.querySelector('.ss-sprak').onclick = () => {
    const omr = $('ssOmr').value;
    settSprak(SPRAAK === 'en' ? 'nb' : 'en', true);
    document.removeEventListener('keydown', tast, true);
    lag.remove();
    visStartskjerm(true);  // the card is in place before its first await
    if (omr) $('ssOmr').value = omr;
  };
  lag.addEventListener('click', (e) => { if (e.target === lag) lukk(); });
  lag.querySelector('.ss-nytt').onsubmit = (e) => {
    e.preventDefault();
    const v = $('ssOmr').value.trim();
    if (v) skann(v); else lukk();
  };
  setTimeout(() => $('ssOmr')?.focus(), 50);

  // The big NABE watches the pointer too.
  const g = lag.querySelector('.nabe-pupiller');
  lag.addEventListener('pointermove', (e) => {
    const r = lag.querySelector('.ss-logo').getBoundingClientRect();
    const vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(vx, vy) || 1, mag = Math.min(2.2, len / 60);
    if (g) g.style.transform = `translate(${(vx / len * mag).toFixed(2)}px, ${(vy / len * mag).toFixed(2)}px)`;
  });

  // Version, and what is new as a line you can open - with a dot until seen.
  setTimeout(() => {
    if (NABE_VERSJON) lag.querySelector('.ss-ver').textContent = ' · ' + NABE_VERSJON;
    const nytt = NYTT[NABE_VERSJON];
    if (!nytt) return;
    const boks = lag.querySelector('.ss-nytt-i');
    const ulest = sistSett !== NABE_VERSJON;
    boks.hidden = false;
    boks.classList.toggle('ulest', ulest);
    boks.innerHTML = `<details${ulest ? ' open' : ''}>
        <summary><span>${T('Nytt i', 'New in')} ${esc(NABE_VERSJON)}</span>${ulest ? '<i class="ss-prikk" aria-label="ny"></i>' : ''}</summary>
        <ul>${nytt.map(x => `<li>${esc(T(x[0], x[1]))}</li>`).join('')}</ul>
      </details>`;
  }, 400);

  // The last plants, newest first, and the adapters as they are right now.
  try { if (typeof hentMinne === 'function') await hentMinne(); } catch {}
  const nett = await hentNettNaa();
  if (!document.body.contains(lag)) return;
  const via = {};
  for (const k of nett) for (const a of k.anlegg) if (!via[a.key]) via[a.key] = k.interface;

  // A scan that found nothing is not a place you left off.
  const steder = Object.entries(MINNE || {}).filter(([, s]) => (s.enheter || []).length)
    .sort((a, b) => (b[1].sist || 0) - (a[1].sist || 0)).slice(0, 60);
  const kjent = new Set(steder.map(([k]) => k));
  // Networks the PC is on that are not already a site above.
  const andre = [];
  for (const k of nett) for (const b of k.brikker) {
    const k2 = b.v.split(', ').join(' ');
    // A site that was scanned and found empty is neither a site nor news.
    if (kjent.has(k2) || ((MINNE || {})[k2] && !((MINNE || {})[k2].enheter || []).length) || andre.some(x => x.v === b.v)) continue;
    andre.push({...b, kort: k.interface, cidr: k.cidr});
  }

  const naar = (t) => {
    if (!t) return '';
    const d = Math.floor((Date.now() / 1000 - t) / 86400);
    return d < 1 ? T('i dag', 'today') : d < 2 ? T('i går', 'yesterday') : d < 30 ? T(`${d} d`, `${d} d`)
      : new Date(t * 1000).toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'short'});
  };
  const liste = lag.querySelector('.ss-liste');
  let html = steder.map(([key, s], i) => {
    const n = (s.enheter || []).length;
    const tittel = s.navn || enhetsnavn(s) || key;
    const b = sisteBesok(key);
    const naabar = !!via[key];
    return `<button type="button" class="ss-rad" role="option" aria-selected="false" data-k="${esc(key)}" style="--i:${i}" title="${esc(enhetsliste(s))}">
        <i class="ss-dot${naabar ? ' paa' : ''}" title="${naabar ? T('Nåbar nå', 'In reach now') : T('Ingen vei dit nå', 'No route there now')}"></i>
        <span class="ss-rad-tekst">
          <span class="ss-rad-navn">${esc(tittel)}</span>
          <span class="ss-rad-meta"><span class="ss-ip">${esc(key)}</span> · ${n} ${n === 1 ? T('enhet', 'device') : T('enheter', 'devices')}${leverandorer(s)}${s.modus === 'bbmd' ? ' · BBMD' : ''}${naabar ? ` · via ${esc(via[key])}` : ''}</span>
          ${b && b.over ? `<span class="ss-over">${b.over} ${T('overstyrt da du gikk', 'overridden when you left')}</span>` : ''}
        </span>
        <span class="ss-naar">${esc(naar(s.sist))}</span>
        <span class="ss-handling" aria-hidden="true">
          <span class="ss-h" data-navngi="${esc(key)}" title="${esc(T('Gi anlegget et navn', 'Name the site'))}">${T('Gi navn', 'Rename')}</span>
          <span class="ss-h fare" data-glem="${esc(key)}" title="${esc(T('Glem anlegget', 'Forget the site'))}">${T('Glem', 'Forget')}</span>
        </span>
      </button>`;
  }).join('');
  if (andre.length) {
    html += `<div class="ss-liste-hode ss-under-hode">${T('Nett denne PC-en ser', 'Networks this PC sees')}</div>`
      + andre.slice(0, 5).map((b, j) => `<button type="button" class="ss-rad ss-rad-nett" role="option" aria-selected="false" data-v="${esc(b.v)}" data-c="${esc(b.cidr)}" style="--i:${steder.length + j}" title="${esc(b.tittel)}">
          <i class="ss-dot nett"></i>
          <span class="ss-rad-tekst">
            <span class="ss-rad-navn ss-ip">${esc(b.v)}</span>
            <span class="ss-rad-meta">${esc(b.merke)} · ${esc(b.kort)}</span>
          </span>
        </button>`).join('');
  }
  liste.innerHTML = html || `<div class="ss-tom">${T('Ingen anlegg ennå. Skriv et område til venstre.', 'No sites yet. Type a range on the left.')}</div>`;
  liste.querySelectorAll('.ss-rad[data-k]').forEach(b => b.onclick = async (e) => {
    // Naming and forgetting live on the row, as they did in the old list of
    // sites: shown when you point at it, and never a scan.
    const navngi = e.target.closest('[data-navngi]'), glem = e.target.closest('[data-glem]');
    if (navngi || glem) {
      e.stopPropagation();
      const key = (navngi || glem).dataset[navngi ? 'navngi' : 'glem'];
      if (navngi) {
        const navn = await nabeSpor(T('Hva heter dette anlegget?', 'What is this site called?'), (MINNE[key] || {}).navn || '');
        if (navn === null) return;
        const d = await api('/api/sites/name', {key, name: navn});
        if (d.status === 'done') MINNE[key] = d.site;
      } else {
        if (!await nabeBekreft(T(`Glemme ${key}? Enhetene og navnet NABE husker for det, forsvinner.`, `Forget ${key}? The devices and name NABE remembers for it go.`))) return;
        const d = await api('/api/sites/delete', {key});
        if (d.status === 'done') delete MINNE[key];
      }
      if (typeof fyllOmradeliste === 'function') fyllOmradeliste();
      document.removeEventListener('keydown', tast, true);
      lag.remove();
      visStartskjerm(true);
      return;
    }
    skann(b.dataset.k.split(' ').join(', '), (MINNE[b.dataset.k] || {}).modus);
  });
  liste.querySelectorAll('.ss-rad[data-v]').forEach(b => b.onclick = () => skannVia(b.dataset.v, b.dataset.c));
  liste.addEventListener('pointermove', (e) => {
    const r = e.target.closest('.ss-rad');
    if (r) marker(rader().indexOf(r));
  });
  // The site most likely wanted is marked: the newest one in reach.
  const forste = rader().findIndex(r => r.querySelector('.ss-dot.paa'));
  if (forste >= 0) marker(forste);
  merkAutoRad();
}

/* The row the search on start is scanning says so, with the count of
   controllers that have answered, until the scan is done. */
function merkAutoRad() {
  const lag = $('startskjerm');
  const r = lag && window.SS_AUTO && [...lag.querySelectorAll('.ss-rad[data-k]')].find(x => x.dataset.k === window.SS_AUTO);
  if (!r || r.classList.contains('auto')) return;
  r.classList.add('auto');
  const naar = r.querySelector('.ss-naar');
  const t = setInterval(() => {
    if (!document.body.contains(r)) { clearInterval(t); return; }
    const n = S.devices.length;
    if (document.body.classList.contains('skanner')) {
      naar.textContent = n ? T(`${n} svar`, `${n} replies`) : T('skanner…', 'scanning…');
    } else if (n) {
      naar.textContent = T(`${n} ${n === 1 ? 'klar' : 'klare'}`, `${n} ready`);
      r.classList.add('klar');
      clearInterval(t);
    }
  }, 300);
}

/* What a remembered site is, in the words on the equipment: the controller
   names, not the range you would have to remember. */
function enhetsnavn(s) {
  const navn = (s.enheter || []).map(d => d.object_name).filter(Boolean);
  if (!navn.length) return '';
  return navn.slice(0, 2).join(', ') + (navn.length > 2 ? ` +${navn.length - 2}` : '');
}
function enhetsliste(s) {
  return (s.enheter || []).map(d => `${d.object_name || '-'}  ${d.address}  #${d.device_instance ?? '?'}`).join('\n');
}
function leverandorer(s) {
  const v = [...new Set((s.enheter || []).map(d => d.vendor).filter(Boolean))];
  return v.length ? ' · ' + esc(v.slice(0, 2).join(', ') + (v.length > 2 ? ' …' : '')) : '';
}

/* Every adapter with a link, what it sits on and what lies behind it. An
   adapter with nothing behind it - the 4G modem's own /28, a Tailscale
   address - is left out; it is not where a building is. */
async function hentNettNaa() {
  let kort = [];
  try { kort = (await (await fetch('/api/interfaces')).json()).interfaces || []; } catch { return []; }
  return Promise.all(kort.map(async (k) => {
    let d = {};
    try { d = await (await fetch('/api/forslag?ip=' + encodeURIComponent(k.ip))).json(); } catch {}
    const anlegg = d.anlegg || [];
    const brikker = [];
    for (const a of anlegg) {
      const s = (MINNE || {})[a.key] || {};
      brikker.push({v: a.key.split(' ').join(', '),
        merke: s.navn || enhetsnavn(s) || `${a.enheter} ${a.enheter === 1 ? T('enhet', 'device') : T('enheter', 'devices')}`,
        tittel: T('Skannet herfra før', 'Scanned from here before')});
    }
    for (const r of d.ruter || []) {
      if (brikker.some(b => b.v === r.cidr)) continue;
      if (r.egen && Number(r.cidr.split('/')[1]) > 24) continue;
      brikker.push({v: r.cidr, merke: r.egen ? T('eget nett', 'own subnet') : T('rute', 'route'),
        tittel: r.egen ? T('Nettet kortet sitter på', 'The network the adapter is on')
                       : T('Windows sender dit gjennom dette kortet', 'Windows routes it through this adapter')});
    }
    return {...k, anlegg, brikker: brikker.slice(0, 4)};
  }));
}
setTimeout(visStartskjerm, 0);
