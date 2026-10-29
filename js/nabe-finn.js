/* NABE - finding the plant.

   Most of a site visit is not reading points, it is getting to the first
   one: which adapter, which range, which of forty controllers. Everything in
   here shortens that. Loaded after app.js and the other parts, and wraps a
   few of their functions the same way they wrap each other. */

/* ---------------------------------------------------------- range chips
   The adapter already knows where the building is. A WireGuard tunnel's
   AllowedIPs and a FortiClient split tunnel are routes, and a site scanned
   through this adapter before is in the site memory. Both turn up under the
   field as one click each. */
let FORSLAG = {ip: null, data: null};

function forslagBrikker() {
  const d = FORSLAG.data || {};
  const ut = [];
  for (const a of d.anlegg || []) {
    ut.push({
      v: a.key.split(' ').join(', '), key: a.key,
      merke: a.navn || `${a.enheter} ${a.enheter === 1 ? T('enhet', 'device') : T('enheter', 'devices')}`,
      tittel: T('Skannet fra dette kortet før', 'Scanned from this adapter before'),
    });
  }
  for (const r of d.ruter || []) {
    if (ut.some(b => b.key === r.cidr)) continue;
    ut.push({
      v: r.cidr, key: r.cidr,
      merke: r.egen ? T('eget nett', 'own subnet') : T('rute', 'route'),
      tittel: r.egen
        ? T('Nettet kortet selv sitter på. På en VPN er det tunnelen, på kabel er det anlegget.',
            'The network the adapter itself is on. On a VPN that is the tunnel, on a cable it is the plant.')
        : T('Windows sender trafikk til dette nettet gjennom kortet - som regel er det bygget.',
            'Windows routes this network through the adapter - usually that is the building.'),
    });
  }
  return ut.slice(0, 5);
}

function tegnForslag() {
  const boks = $('omrForslag');
  if (!boks) return;
  const brikker = forslagBrikker();
  boks.hidden = !brikker.length;
  const naa = parseRanges($('rangeInput').value).sort().join(' ');
  boks.innerHTML = brikker.map(b => `
    <button type="button" class="omr-brikke${parseRanges(b.v).sort().join(' ') === naa ? ' valgt' : ''}"
            data-v="${esc(b.v)}" title="${esc(b.tittel + ' · ' + T('dobbeltklikk for å skanne', 'double-click to scan'))}">
      <span class="omr-ip">${esc(b.v)}</span><span class="omr-merke">${esc(b.merke)}</span>
    </button>`).join('');
  // The first route is what an empty field most likely wants.
  const ri = $('rangeInput');
  if (ri) ri.placeholder = brikker.length ? brikker[0].v : '10.75.1.0/24, …';
}

async function visForslag() {
  const ip = String($('localAddr')?.value || S.localAddr || '').split('/')[0];
  if (!ip) { FORSLAG = {ip: null, data: null}; tegnForslag(); return; }
  try {
    const d = await (await fetch('/api/forslag?ip=' + encodeURIComponent(ip))).json();
    FORSLAG = {ip, data: d && d.status === 'done' ? d : null};
  } catch { FORSLAG = {ip, data: null}; }
  tegnForslag();
}

function brukOmrade(v) {
  const ri = $('rangeInput');
  ri.value = v;
  // change: saves it and picks the mode the site used last time.
  ri.dispatchEvent(new Event('change'));
  ri.dispatchEvent(new Event('input'));
  tegnForslag();
}

(function koblForslag() {
  const boks = $('omrForslag');
  if (!boks) return;
  boks.addEventListener('click', (e) => {
    const b = e.target.closest('.omr-brikke');
    if (!b) return;
    brukOmrade(b.dataset.v);
    $('scanBtn')?.focus();
  });
  boks.addEventListener('dblclick', (e) => {
    const b = e.target.closest('.omr-brikke');
    if (b && !$('scanBtn').disabled && !document.body.classList.contains('skanner')) runScan();
  });
  $('rangeInput').addEventListener('input', tegnForslag);
  $('localAddr').addEventListener('change', visForslag);

  // Whenever the binding moves - boot, a pick, a tunnel coming up - the
  // suggestions follow the adapter that is actually in use.
  const _refresh = refreshStatus;
  refreshStatus = async function () {
    const r = await _refresh.apply(this, arguments);
    const ip = String(S.localAddr || '').split('/')[0];
    if (ip && ip !== FORSLAG.ip) visForslag();
    return r;
  };
  // A finished scan may have added a site to the memory.
  const _husk = husk;
  husk = async function () {
    const r = await _husk.apply(this, arguments);
    visForslag();
    return r;
  };
  const _sprak = settSprak;
  settSprak = function () {
    const r = _sprak.apply(this, arguments);
    tegnForslag();
    return r;
  };
  if (S.localAddr) visForslag();
})();

/* ------------------------------------------------------- pasted addresses
   Addresses arrive from an e-mail, a drawing, OneNote, a YABE window, an
   Excel sheet - with ports, masks, words and line breaks around them. What
   the field wants is the addresses. */
const IP4 = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}';
const REN_LISTE = new RegExp(`^[\\s,;]*(?:${IP4}(?:/\\d{1,2}|-(?:${IP4}|\\d{1,3}))?[\\s,;]*)+$`);

function maskeTilPrefiks(m) {
  const bits = m.split('.').map(Number).reduce((n, o) => n * 256 + o, 0);
  let p = 0;
  for (let i = 31; i >= 0 && (bits >>> i) & 1; i--) p++;
  return p;
}

function hentAdresser(tekst) {
  const s = String(tekst || '');
  // Already what the field takes - unless one of the "addresses" is a mask.
  if (REN_LISTE.test(s) && !/(^|[\s,;])255\./.test(s)) return null;
  const re = new RegExp(
    `(${IP4})(?:\\s*-\\s*(${IP4}|\\d{1,3})(?![\\d.])|\\s*/\\s*(\\d{1,2})\\b|\\s+(?:(?:net)?mask\\s+)?(255\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}))?`
    + `|(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})\\.(?:\\*|x|X)(?![\\w.])`, 'g');
  const ut = [];
  let m;
  while ((m = re.exec(s))) {
    let v;
    if (m[5]) v = m[5] + '.0/24';
    else {
      const ip = m[1];
      if (/^(0\.|127\.|255\.|169\.254\.)/.test(ip)) continue;
      if (m[2]) v = `${ip}-${m[2]}`;
      else if (m[3]) v = `${ip}/${m[3]}`;
      else if (m[4]) v = `${ip}/${maskeTilPrefiks(m[4])}`;
      else v = ip;
    }
    if (!ut.includes(v)) ut.push(v);
  }
  return ut;
}

$('rangeInput').addEventListener('paste', (e) => {
  const tekst = (e.clipboardData || window.clipboardData)?.getData('text');
  const adr = hentAdresser(tekst);
  if (!adr || !adr.length) return;
  e.preventDefault();
  const ri = $('rangeInput');
  const foer = ri.value.slice(0, ri.selectionStart).replace(/[\s,;]+$/, '');
  const etter = ri.value.slice(ri.selectionEnd).replace(/^[\s,;]+/, '');
  ri.value = [foer, adr.join(', '), etter].filter(Boolean).join(', ');
  ri.dispatchEvent(new Event('change'));
  ri.dispatchEvent(new Event('input'));
  toast(adr.length === 1
    ? T(`Hentet ${adr[0]} fra teksten`, `Took ${adr[0]} from the text`)
    : T(`Hentet ${adr.length} adresser fra teksten`, `Took ${adr.length} addresses from the text`));
});

/* ------------------------------------------------------ device list search
   Over a BBMD a building is forty controllers. Typing part of a name, an IP
   or an instance is faster than reading the list. */
function filtrerEnheter() {
  const f = $('devSok');
  const liste = $('devList');
  if (!f || !liste) return;
  f.hidden = S.devices.length < 2;
  const ord = f.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let vist = 0;
  for (const b of liste.querySelectorAll('.dev')) {
    const tekst = b.textContent.toLowerCase();
    const ok = ord.every(o => tekst.includes(o));
    b.hidden = !ok;
    if (ok) vist++;
  }
  for (const g of liste.querySelectorAll('.vgroup')) {
    g.hidden = !!ord.length && !g.querySelector('.dev:not([hidden])');
  }
  liste.classList.toggle('sok-aktiv', !!ord.length);
  $('devCount').textContent = ord.length ? `${vist}/${S.devices.length}` : S.devices.length;
}

(function koblEnhetssok() {
  const f = $('devSok');
  if (!f) return;
  const _render = renderDevices;
  renderDevices = function () {
    const r = _render.apply(this, arguments);
    filtrerEnheter();
    return r;
  };
  f.addEventListener('input', filtrerEnheter);
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && f.value) { e.preventDefault(); e.stopPropagation(); f.value = ''; filtrerEnheter(); }
    else if (e.key === 'Enter') {
      const forste = $('devList').querySelector('.dev:not([hidden])');
      if (forste) { e.preventDefault(); forste.click(); }
    } else if (e.key === 'ArrowDown') {
      const forste = $('devList').querySelector('.dev:not([hidden])');
      if (forste) { e.preventDefault(); forste.focus(); }
    }
  });
  filtrerEnheter();
})();

/* Type to jump, as in Explorer: with a device focused, typing "36" moves to
   the first one whose name, IP or instance starts with it. Caught before the
   page's own shortcuts, or "l" would toggle Live. */
const HOPP = {buffer: '', t: 0};
$('devList')?.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
  if (!e.target.closest('.dev')) return;
  if (e.key === ' ' && !HOPP.buffer) return;
  const naa = Date.now();
  HOPP.buffer = (naa - HOPP.t > 800 ? '' : HOPP.buffer) + e.key.toLowerCase();
  HOPP.t = naa;
  e.preventDefault();
  e.stopPropagation();
  const kort = [...$('devList').querySelectorAll('.dev:not([hidden])')]
    .filter(b => !b.closest('.vgroup.av'));
  const treff = kort.find(b => [b.querySelector('.dev-name'), b.querySelector('.dev-ip'), b.querySelector('.dev-id')]
    .some(x => x && x.textContent.trim().toLowerCase().startsWith(HOPP.buffer)));
  if (treff) { treff.focus(); treff.scrollIntoView({block: 'nearest'}); }
});

/* ---------------------------------------------------- earlier searches
   Arrow up in the search field brings back what you searched for on this
   site, newest first. You look for the same few things all day. */
function sokNokkel() { return (S.scanRanges || []).slice().sort().join(' ') || '-'; }
function sokHistorikk() { return (loadPrefs().sokHist || {})[sokNokkel()] || []; }
function huskSok(v) {
  v = String(v || '').trim();
  if (v.length < 2) return;
  const alle = loadPrefs().sokHist || {};
  const liste = (alle[sokNokkel()] || []).filter(x => x !== v);
  liste.unshift(v);
  alle[sokNokkel()] = liste.slice(0, 12);
  // Only the sites visited lately; the memory is not a log.
  const nokler = Object.keys(alle);
  if (nokler.length > 30) delete alle[nokler[0]];
  savePrefs({sokHist: alle});
}

(function koblSokHistorikk() {
  const q = $('q');
  if (!q) return;
  let steg = -1, utkast = '', egen = false;
  q.addEventListener('change', () => huskSok(q.value));
  // Typing starts the walk over; our own stepping does not.
  q.addEventListener('input', () => { if (!egen) steg = -1; });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { huskSok(q.value); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const h = sokHistorikk();
    if (!h.length) return;
    if (steg === -1) utkast = q.value;
    const ny = e.key === 'ArrowUp' ? Math.min(h.length - 1, steg + 1) : Math.max(-1, steg - 1);
    e.preventDefault();
    if (ny === steg) return;
    steg = ny;
    q.value = steg === -1 ? utkast : h[steg];
    egen = true;
    q.dispatchEvent(new Event('input'));
    egen = false;
    q.setSelectionRange(q.value.length, q.value.length);
  });
})();

/* ---------------------------------------------------- object types told
   "MSV" means nothing to someone new to BACnet. Pointing at it says what it
   is and whether it can be written. */
const TYPE_FORKLART = {
  'analog-input':       ['Analog Input - målt verdi, kan ikke skrives', 'Analog Input - a measured value, not writable'],
  'analog-output':      ['Analog Output - utgang, skrives med prioritet', 'Analog Output - an output, written with a priority'],
  'analog-value':       ['Analog Value - tallverdi, ofte settpunkt', 'Analog Value - a number, often a setpoint'],
  'binary-input':       ['Binary Input - av/på-signal inn', 'Binary Input - an on/off signal in'],
  'binary-output':      ['Binary Output - av/på-utgang, skrives med prioritet', 'Binary Output - an on/off output, written with a priority'],
  'binary-value':       ['Binary Value - av/på-verdi, ofte driftsvalg', 'Binary Value - an on/off value, often an operating choice'],
  'multi-state-input':  ['Multi-state Input - tilstand inn, f.eks. driftsmodus', 'Multi-state Input - a state in, e.g. operating mode'],
  'multi-state-output': ['Multi-state Output - tilstand ut', 'Multi-state Output - a state out'],
  'multi-state-value':  ['Multi-state Value - valg mellom flere tilstander', 'Multi-state Value - a choice between several states'],
  'schedule':           ['Schedule - ukeplan', 'Schedule - a weekly schedule'],
  'calendar':           ['Calendar - helligdager og unntak', 'Calendar - holidays and exceptions'],
  'trend-log':          ['Trend Log - logget historikk', 'Trend Log - logged history'],
  'trend-log-multiple': ['Trend Log Multiple - flere logger i ett', 'Trend Log Multiple - several logs in one'],
  'notification-class': ['Notification Class - hvem alarmer går til', 'Notification Class - where alarms are sent'],
  'event-enrollment':   ['Event Enrollment - alarmregel', 'Event Enrollment - an alarm rule'],
  'program':            ['Program - program i kontrolleren', 'Program - a program in the controller'],
  'device':             ['Device - selve kontrolleren', 'Device - the controller itself'],
  'loop':               ['Loop - PID-sløyfe', 'Loop - a PID loop'],
  'accumulator':        ['Accumulator - teller, f.eks. energimåler', 'Accumulator - a counter, e.g. an energy meter'],
  'pulse-converter':    ['Pulse Converter - pulser til verdi', 'Pulse Converter - pulses to a value'],
  'structured-view':    ['Structured View - mappe som grupperer objekter', 'Structured View - a folder grouping objects'],
};
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest && e.target.closest('.type-tag');
  if (!t || t.dataset.forklart === SPRAAK) return;
  const rad = t.closest('tr[data-o]');
  const type = rad ? rad.dataset.o.split(',')[0] : null;
  const f = TYPE_FORKLART[type];
  if (!f) return;
  t.title = T(f[0], f[1]);
  t.dataset.forklart = SPRAAK;
});

/* ------------------------------------------------- "40 shown of 2378"
   The status bar is where you notice that a filter is on, so it is also
   where you take it off. */
(function koblVistNullstill() {
  const el = $('sbShown')?.closest('.sb-item');
  if (!el) return;
  el.classList.add('sb-vist');
  el.addEventListener('click', () => {
    if (!$('sbShownTot')?.textContent) return;
    S.filters = {q: '', type: '', flag: '', writable: false, diff: false};
    $('q').value = ''; $('typeSel').value = '';
    renderPoints(); syncMenuStates();
    toast(T('Filteret er nullstilt', 'Filter cleared'));
  });
  // The hint only while there is something to clear.
  new MutationObserver(() => {
    const filtrert = !!$('sbShownTot')?.textContent;
    el.classList.toggle('kan-nullstilles', filtrert);
    el.title = filtrert ? T('Klikk for å vise alle punkter', 'Click to show all points') : '';
  }).observe($('sbShownTot'), {childList: true, characterData: true, subtree: true});
})();
