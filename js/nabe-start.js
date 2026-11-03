/* NABE - start screen, alarms, routers and usage
   Loaded after app.js and shares its globals (S, $, api, toast, nabeSier ...).
   Kept apart so app.js does not have to carry everything. */
'use strict';

/* =============================================================== NABE 1.1
   Alarms, routers, the start screen, and the small things that happen when
   the tool has been used a lot. New text is written in both languages here
   with T(), and the containers are left out of the language sweep, so nothing
   is translated twice. */
const T = (nb, en) => (SPRAAK === 'en' ? en : nb);
let NABE_VERSJON = '';
fetch('/api/status').then(r => r.json()).then(d => { NABE_VERSJON = d.versjon || ''; }).catch(() => {});

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
    if (!f.length || alle.has(p.objid)) continue;
    alle.set(p.objid, {objid: p.objid, tilstand: f.includes('fault') ? 'fault' : 'in-alarm', ukvittert: [], kilde: 'flagg'});
  }
  const liste = [...alle.values()];
  const lest = (S.points || []).length > 0 && S.points.every(p => p.status_lest === true);
  boks.hidden = false;
  const kildeTekst = listeOk
    ? T('Fra enhetens alarmliste og punktenes statusflagg.', 'From the device’s alarm list and the points’ status flags.')
    : T('Enheten svarer ikke på alarmforespørsel, så dette er fra punktenes statusflagg.', 'The device does not answer the alarm request, so this is from the points’ status flags.');
  if (!liste.length) {
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
  boks.innerHTML = `<div class="sect-head">${T('Aktive alarmer', 'Active alarms')} <span class="count">${liste.length}</span></div>
    <div class="alarm-liste">${liste.map(a => `
      <button class="alarm-rad" data-o="${esc(a.objid)}" title="${esc(a.kilde === 'flagg'
        ? T('Statusflagget står i alarm eller feil. Ikke i enhetens alarmliste.', 'The status flag is in alarm or fault. Not in the device’s alarm list.')
        : T('Fra enhetens alarmliste', 'From the device’s alarm list'))}">
        <span class="alarm-navn">${esc(navn(a.objid))}</span>
        <span class="alarm-til ${/fault/.test(a.tilstand) ? 'bad' : 'warn'}">${esc(tilstand(a.tilstand))}</span>
        ${a.ukvittert.length ? `<span class="alarm-ukv" title="${esc(a.ukvittert.join(', '))}">${T('ukvittert', 'unacked')}</span>` : ''}
      </button>`).join('')}</div>
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
  skann:  [[1, 'Første skann! Jeg skal huske denne dagen.', 'First scan! I will remember this day.'],
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
  '1.32': [
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
    ['NABO foreslår tagger fra beskrivelsen, lært av BTG-eksportene dine: «Temperatur tilluft» blir RT401, «Pådrag tilluftsvifte» blir JV401 … Gn. Bare på punkter uten komponentkode', 'NABO suggests tags from the description, learnt from your BTG exports: “Temperatur tilluft” becomes RT401, “Pådrag tilluftsvifte” becomes JV401 … Gn. Only on points without a component code'],
    ['Velg PX-familie per anlegg (freeTag, nordomatic/statsbygg, Beckhoff TC2), så følger signalnavnene malene i nmNxFiles: Gn blir C, Err blir A, Drift blir D', 'Pick the PX family per site (freeTag, nordomatic/statsbygg, Beckhoff TC2) and the signal names follow the templates in nmNxFiles: Gn becomes C, Err becomes A, Drift becomes D'],
  ],
  '1.26': [
    ['NABO har en ordliste for endelser per komponenttype. Energimålere (OE) er fylt inn fra BTG-eksportene: Energy blir kWh, Power kW, Flow m3, FT RT4, RT RT5', 'NABO has a word list for endings per kind of component. Energy meters (OE) are filled in from the BTG exports: Energy becomes kWh, Power kW, Flow m3, FT RT4, RT RT5'],
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
    ['NABO er målt mot 7516 punkter BTG har laget fra ekte EDE-filer, og gjør nå som BTG der BTG har rett', 'NABO is measured against 7516 points BTG made from real EDE files, and now does as BTG where BTG is right'],
    ['Tekst med mellomrom er ett ledd (Drift fra SD-anlegg), romkoder blir R00_0004, og skråstrek beholdes', 'Text with spaces is one part (Drift fra SD-anlegg), room codes become R00_0004, and a slash is kept'],
    ['Et s foran systemnummeret (s360001) markerer hvor taggen starter, som i BTG', 'An s before the system number (s360001) marks where the tag starts, as in BTG'],
    ['Punkter uten SD-kode får ikke trend, slik BTG gjør', 'Points without an SD code get no trend, as BTG does'],
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
    ['NABO: systemnummer skrevet i ett deles som i BTG, 360001 blir 360.001', 'NABO: system numbers written in one piece are split as in BTG, 360001 becomes 360.001'],
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
    ['Prefiks er valgfritt, med en velger som i BTG: foran device, foran device og tag, eller +PRE=360.001', 'The prefix is optional, with a choice as in BTG: before the device, before device and tag, or +PRE=360.001'],
    ['Cluster er Citect-clusteret fra BTG og påvirker ikke Niagara-taggene', 'Cluster is BTG’s Citect cluster and does not touch the Niagara tags'],
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
    ['NABO: velg hvor filene lagres - Nedlastinger, BTG-Export eller en mappe du velger selv', 'NABO: choose where files are saved - Downloads, BTG-Export or a folder of your own'],
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
    ['NABO › Normalisering: BTGs regex, mal for stien og funksjonskoder fra TC2 til NM, med test på ekte navn', 'NABO › Normalisation: BTG’s regex, a path template and function codes from TC2 to NM, tested on real names'],
    ['Flere sjekker, og et stopp før en fil med feil eksporteres', 'More checks, and a stop before a file with errors is exported'],
    ['Enheter skrives i entall som i BTG: pascal, bar, kilowatt hour', 'Units are written in the singular as BTG does: pascal, bar, kilowatt hour'],
  ],
  '1.7': [
    ['NABO - Not Another BACnet Object-namer: tagger og Variabel-fil til Niagara, under Eksport', 'NABO - Not Another BACnet Object-namer: tags and the Variabel file for Niagara, under Export'],
    ['Enheter fra anlegget og EDE-filer side om side, med device-navnet riktig', 'Devices from the plant and EDE files side by side, with the device name right'],
    ['Leser og lagrer HeaderBTG.ini, så oppsettet går begge veier mellom BTG og NABO', 'Reads and saves HeaderBTG.ini, so settings go both ways between BTG and NABO'],
    ['Desimaler per enhetstype og trendintervall som i BTG, og varsel om like tagger', 'Decimals per unit type and trend interval as in BTG, and a warning on duplicate tags'],
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
    ['BTG-fil ligger nå i Eksport-menyen', 'The BTG file is now in the Export menu'],
    ['Enhetslista hopper ikke lenger under musa mens anlegget leses', 'The device list no longer jumps under the pointer while the site is read'],
    ['Smale vinduer: tabellen beholder kolonnene sine', 'Narrow windows: the table keeps its columns'],
    ['Live blinker rolig, og Escape lukker alle dialoger', 'Live flashes quietly, and Escape closes every dialog'],
  ],
  '1.4': [
    ['NABE ser etter musa når den forlater vinduet, og dukker når den kommer for fort', 'NABE watches the pointer leave the window, and ducks when it comes too fast'],
    ['Åpne et varmt eller kaldt temperaturpunkt', 'Open a hot or a cold temperature point'],
    ['Han husker om du klapper ham – eller drar i ham', 'He remembers whether you pet him – or drag him'],
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
    setTimeout(() => { if (S.connected) runScan(); }, 300);
  };
  // A network row: bind that adapter first, so the scan goes out where the
  // route is rather than wherever Windows last sent it.
  const skannVia = async (omr, cidr) => {
    if (cidr && S.localAddr !== cidr) {
      try { await connectTo(cidr, {quiet: true}); } catch {}
    }
    skann(omr);
  };
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
    if (e.key === 'Escape') { e.preventDefault(); lukk(); return; }
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
  lag.querySelector('.ss-videre').onclick = lukk;
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
    .sort((a, b) => (b[1].sist || 0) - (a[1].sist || 0)).slice(0, 6);
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
  liste.querySelectorAll('.ss-rad[data-k]').forEach(b => b.onclick = () =>
    skann(b.dataset.k.split(' ').join(', '), (MINNE[b.dataset.k] || {}).modus));
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
