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

async function fyllAlarmer() {
  const boks = document.getElementById('alarmSect');
  const d = S.activeDev;
  if (!boks || !d) return;
  let data = ALARM_CACHE[d.address];
  if (!data || Date.now() - data.t > 60000) {
    try {
      const r = await api('/api/device/alarms', {address: d.address});
      data = ALARM_CACHE[d.address] = {t: Date.now(), r};
    } catch { return; }
  }
  // The inspector may have moved on while we waited.
  if (S.activeDev !== d || !document.body.contains(boks)) return;
  const r = data.r;
  if (r.status !== 'done') { boks.hidden = true; return; }
  const liste = r.alarmer || [];
  boks.hidden = false;
  if (!liste.length) {
    boks.innerHTML = `<div class="sect-head">${T('Aktive alarmer', 'Active alarms')} <span class="count">0</span></div>`
      + `<div class="alarm-tom">${T('Ingen aktive alarmer.', 'No active alarms.')}</div>`;
    nabeSier(T('Ingen alarmer. Mistenkelig.', 'No alarms. Suspicious.'), 'skvatt', 'ingen-alarm');
    return;
  }
  const navn = oid => (S.pointIndex && S.pointIndex.get(oid)?.name) || oid;
  boks.innerHTML = `<div class="sect-head">${T('Aktive alarmer', 'Active alarms')} <span class="count">${liste.length}</span></div>
    <div class="alarm-liste">${liste.map(a => `
      <button class="alarm-rad" data-o="${esc(a.objid)}">
        <span class="alarm-navn">${esc(navn(a.objid))}</span>
        <span class="alarm-til ${/fault/.test(a.tilstand) ? 'bad' : 'warn'}">${esc(a.tilstand)}</span>
        ${a.ukvittert.length ? `<span class="alarm-ukv" title="${esc(a.ukvittert.join(', '))}">${T('ukvittert', 'unacked')}</span>` : ''}
      </button>`).join('')}</div>`;
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

/* igjen: drawn again after a language switch - same fact, no count, no entrance. */
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
      <button class="ss-sprak" type="button" lang="${T('en', 'no')}">${T('English', 'Norsk')}</button>
      <div class="ss-logo">${NABE_SVG.replace('width="26" height="26"', 'width="96" height="96"')}</div>
      <h1 class="ss-navn">NABE</h1>
      <div class="ss-under">Not Another BACnet Explorer<span class="ss-ver"></span></div>
      <div class="ss-hilsen">${esc(hilsen())}</div>
      <div class="ss-anlegg" hidden>
        <div class="ss-tittel">${T('Fortsett der du slapp', 'Pick up where you left off')}</div>
        <div class="ss-liste"></div>
      </div>
      <div class="ss-nett" hidden>
        <div class="ss-tittel">${T('Nettverket nå', 'The network now')}</div>
        <div class="ss-kortliste"></div>
      </div>
      <form class="ss-nytt">
        <input class="field" id="ssOmr" placeholder="${T('Nytt område, f.eks. 10.75.1.0/24', 'New range, e.g. 10.75.1.0/24')}" autocomplete="off">
        <button class="btn primary" type="submit">${T('Skann', 'Scan')}</button>
      </form>
      <button class="ss-videre" type="button">${T('Bare åpne', 'Just open it')} <kbd>Esc</kbd></button>
      <div class="ss-nytt-i" hidden></div>
      <div class="ss-fakta">${esc(T(fakta[0], fakta[1]))}</div>
    </div>`;
  document.body.appendChild(lag);

  const lukk = () => {
    lag.classList.add('ut');
    setTimeout(() => lag.remove(), 260);
    document.removeEventListener('keydown', tast, true);
    try { localStorage.setItem('nabe_sett_versjon', NABE_VERSJON); } catch {}
  };
  const skann = (omr, modus) => {
    $('rangeInput').value = omr;
    if (modus && [...$('modeSel').options].some(o => o.value === modus)) $('modeSel').value = modus;
    savePrefs({range: omr, mode: $('modeSel').value});
    lukk();
    setTimeout(() => { if (S.connected) runScan(); }, 300);
  };
  // From the network section: bind that adapter first, so the scan goes
  // out where the route is rather than wherever Windows last sent it.
  const skannVia = async (omr, cidr) => {
    if (cidr && S.localAddr !== cidr) {
      try { await connectTo(cidr, {quiet: true}); } catch {}
    }
    skann(omr);
  };
  const tast = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); lukk(); }
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

  // Version and what is new - filled once the server has answered.
  setTimeout(() => {
    if (NABE_VERSJON) lag.querySelector('.ss-ver').textContent = ' · v' + NABE_VERSJON;
    const nytt = NYTT[NABE_VERSJON];
    if (nytt && sistSett !== NABE_VERSJON) {
      const boks = lag.querySelector('.ss-nytt-i');
      boks.hidden = false;
      boks.innerHTML = `<div class="ss-tittel">${T('Nytt i', 'New in')} ${esc(NABE_VERSJON)}</div><ul>`
        + nytt.map(x => `<li>${esc(T(x[0], x[1]))}</li>`).join('') + '</ul>';
    }
  }, 400);

  // The last plants, newest first, and the adapters as they are right now.
  try { if (typeof hentMinne === 'function') await hentMinne(); } catch {}
  const nett = await hentNettNaa();
  if (!document.body.contains(lag)) return;
  const via = {};
  for (const k of nett) for (const a of k.anlegg) if (!via[a.key]) via[a.key] = k.interface;

  const rader = Object.entries(MINNE || {}).sort((a, b) => (b[1].sist || 0) - (a[1].sist || 0)).slice(0, 5);
  if (rader.length) {
    lag.querySelector('.ss-anlegg').hidden = false;
    const liste = lag.querySelector('.ss-liste');
    liste.innerHTML = rader.map(([key, s]) => {
      const n = (s.enheter || []).length;
      const tittel = s.navn || enhetsnavn(s) || key;
      return `
      <button class="ss-rad" data-k="${esc(key)}" title="${esc(enhetsliste(s))}">
        <span class="ss-rad-navn">${esc(tittel)}</span>
        <span class="ss-rad-meta">${tittel !== key ? `<span class="ss-ip">${esc(key)}</span> · ` : ''}${n} ${n === 1 ? T('enhet', 'device') : T('enheter', 'devices')}${leverandorer(s)}${s.modus === 'bbmd' ? ' · BBMD' : ''}${via[key] ? ` · via ${esc(via[key])}` : ''}${(() => {
          const b = sisteBesok(key);
          return b && b.over ? ` · <span class="ss-over">${b.over} ${T('overstyrt da du gikk', 'overridden when you left')}</span>` : '';
        })()}</span>
      </button>`;
    }).join('');
    liste.querySelectorAll('.ss-rad').forEach(b => b.onclick = () =>
      skann(b.dataset.k.split(' ').join(', '), (MINNE[b.dataset.k] || {}).modus));
  }

  const vis = nett.filter(k => k.brikker.length);
  if (vis.length) {
    lag.querySelector('.ss-nett').hidden = false;
    lag.querySelector('.ss-kortliste').innerHTML = vis.map(k => `
      <div class="ss-kort-rad">
        <div class="ss-kort-hode"><span class="ss-kort-navn">${esc(k.interface)}</span>
          <span class="ss-ip">${esc(k.ip)}</span>${S.localAddr === k.cidr ? `<span class="ss-kort-i-bruk">${T('i bruk', 'in use')}</span>` : ''}</div>
        <div class="ss-kort-nett">${k.brikker.map(b => `
          <button type="button" class="ss-nett-brikke" data-v="${esc(b.v)}" data-c="${esc(k.cidr)}" title="${esc(b.tittel)}">
            <span class="ss-ip">${esc(b.v)}</span><span class="ss-nett-merke">${esc(b.merke)}</span>
          </button>`).join('')}</div>
      </div>`).join('');
    lag.querySelectorAll('.ss-nett-brikke').forEach(b => b.onclick = () => skannVia(b.dataset.v, b.dataset.c));
  }
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
