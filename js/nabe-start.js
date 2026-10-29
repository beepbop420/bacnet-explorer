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

async function visStartskjerm() {
  tell('aapnet');
  const lag = document.createElement('div');
  lag.id = 'startskjerm';
  lag.className = 'startskjerm';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-label', 'NABE');
  const fakta = FAKTA[Math.floor(Math.random() * FAKTA.length)];
  const sistSett = (() => { try { return localStorage.getItem('nabe_sett_versjon'); } catch { return null; } })();
  lag.innerHTML = `
    <div class="ss-kort">
      <div class="ss-logo">${NABE_SVG.replace('width="26" height="26"', 'width="96" height="96"')}</div>
      <h1 class="ss-navn">NABE</h1>
      <div class="ss-under">Not Another BACnet Explorer<span class="ss-ver"></span></div>
      <div class="ss-hilsen">${esc(hilsen())}</div>
      <div class="ss-anlegg" hidden>
        <div class="ss-tittel">${T('Fortsett der du slapp', 'Pick up where you left off')}</div>
        <div class="ss-liste"></div>
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
  const tast = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); lukk(); }
  };
  document.addEventListener('keydown', tast, true);
  lag.querySelector('.ss-videre').onclick = lukk;
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

  // The last plants, newest first.
  try { if (typeof hentMinne === 'function') await hentMinne(); } catch {}
  const rader = Object.entries(MINNE || {}).sort((a, b) => (b[1].sist || 0) - (a[1].sist || 0)).slice(0, 5);
  if (rader.length && document.body.contains(lag)) {
    lag.querySelector('.ss-anlegg').hidden = false;
    const liste = lag.querySelector('.ss-liste');
    liste.innerHTML = rader.map(([key, s]) => `
      <button class="ss-rad" data-k="${esc(key)}">
        <span class="ss-rad-navn">${esc(s.navn || key)}</span>
        <span class="ss-rad-meta">${s.navn ? esc(key) + ' · ' : ''}${(s.enheter || []).length} ${(s.enheter || []).length === 1 ? T('enhet', 'device') : T('enheter', 'devices')}${s.modus === 'bbmd' ? ' · BBMD' : ''}${(() => {
          const b = sisteBesok(key);
          return b && b.over ? ` · <span class="ss-over">${b.over} ${T('overstyrt da du gikk', 'overridden when you left')}</span>` : '';
        })()}</span>
      </button>`).join('');
    liste.querySelectorAll('.ss-rad').forEach(b => b.onclick = () =>
      skann(b.dataset.k.split(' ').join(', '), (MINNE[b.dataset.k] || {}).modus));
  }
}
setTimeout(visStartskjerm, 0);
