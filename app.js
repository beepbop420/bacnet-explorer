'use strict';

/* ------------------------------------------------------------------ state */
const S = {
  connected: false,
  localAddr: null,
  devices: [],
  activeDev: null,          // {address, device_instance, object_name, ...}
  points: [],               // points of activeDev
  pointIndex: new Map(),    // objid -> point
  selected: null,           // objid
  detail: null,             // properties of selected
  sort: {key: 'objid', dir: 1},
  filters: {q: '', type: '', flag: '', writable: false, diff: false},
  live: false,
  pollTimer: null,
  pollBusy: false,
  watch: [],                // [{ip, objid, name, unit, hist:[]}]
  snapshot: null,           // {"ip|objid": value}
  snapAt: null,
  selHist: [],              // live history for the inspected point
  readOnly: false,
  sel: new Set(),           // "ip|objid" picked for bulk actions
  selAnchor: null,          // last plainly-clicked row, for shift-range
  job: null,                // id of the running load job
  scanJob: null,            // id of the running scan job
  rowIndex: null,           // objid -> <tr>, rebuilt on render
  gsFlag: '',               // global search: filter by status flag instead of text
  cache: {},                // ip -> points, reused when revisiting a device
  notes: {},                // "ip|instans" -> {text, updated}, lagret paa serveren
  noteSync: null,           // status for deling mot fellesserveren
  noteUpstream: '',         // adressen til fellesserveren, tom paa serveren selv
  namePrefix: '',           // leading segment shared by every point name
  cacheMeta: {},            // ip -> {type_counts, total_objects}
  identity: {},             // ip -> {model-name, firmware-revision, ...}
  projectSnaps: [],         // snapshot history of the open project
};
const MAX_HIST = 40;
const SEL_HIST = 90;

/* Brand-tinted identification for the controllers we actually meet in the
   field. Matched loosely against the vendor-name the device reports, so
   "Beckhoff Automation GmbH" and "Beckhoff" both resolve. */
/* Recognising the maker matters in practice: it tells you what to expect from
   a controller before you have read a single point - a JCI refuses 12 objects
   in one request, a Tridium answers happily, a WAGO ships with its clock
   unset. Matched on vendor-name first, which the device states in plain text.

   Colour here is identity, not state, so it is deliberately confined to the
   2x2 px vendor mark at low opacity. The full-height rail on the row belongs
   to state - see devState(). Anything unrecognised gets a neutral tone rather
   than an invented brand colour. */
const VENDOR_GREY = '#5a636e';
const VENDORS = [
  // Nordic and European building automation - the ones met most often here
  [/beckhoff/i,                        'Beckhoff',      '#d4332f'],
  [/wago/i,                            'WAGO',          '#6ec800'],
  [/siemens/i,                         'Siemens',       '#009999'],
  [/honeywell/i,                       'Honeywell',     '#ee3124'],
  [/alerton/i,                         'Alerton',       '#ee3124'],
  [/novar|trend\s*control/i,           'Trend',         '#0072ce'],
  [/schneider|(^|\W)tac(\W|$)|invensys|satchwell|andover/i, 'Schneider', '#3dcd58'],
  [/johnson\s*controls|(^|\W)jci(\W|$)|metasys/i, 'Johnson C.', '#3b6fb6'],
  [/tridium|niagara/i,                 'Tridium',       '#f68b1f'],
  [/sauter/i,                          'Sauter',        '#e2001a'],
  [/priva/i,                           'Priva',         '#f39200'],
  [/regin/i,                           'Regin',         '#e30613'],
  [/fidelix/i,                         'Fidelix',       '#00a0df'],
  [/ouman/i,                           'Ouman',         '#e30613'],
  [/kieback|k[\s&-]*p\b/i,             'Kieback&Peter', '#005ca9'],
  [/loytec/i,                          'LOYTEC',        '#009ee0'],
  [/saia|burgess/i,                    'Saia-Burgess',  '#e2001a'],
  [/phoenix\s*contact/i,               'Phoenix C.',    '#00a2e1'],
  [/deos/i,                            'DEOS',          '#004f9f'],
  [/neuberger/i,                       'Neuberger',     VENDOR_GREY],
  [/wurm/i,                            'Wurm',          VENDOR_GREY],
  [/gfr\b/i,                           'GFR',           VENDOR_GREY],
  [/delta\s*controls/i,                'Delta Controls','#0093d0'],
  [/distech/i,                         'Distech',       '#00a3e0'],
  [/automated\s*logic|(^|\W)alc(\W|$)|webctrl/i, 'Automated Logic', '#0072bc'],
  [/reliable\s*controls/i,             'Reliable C.',   '#006341'],
  [/kmc\b/i,                           'KMC',           '#7a1f2b'],
  [/belimo/i,                          'Belimo',        '#e2001a'],
  [/produal/i,                         'Produal',       VENDOR_GREY],
  [/thermokon/i,                       'Thermokon',     VENDOR_GREY],
  [/s\+s|regeltechnik/i,               'S+S',           VENDOR_GREY],
  [/vaisala/i,                         'Vaisala',       '#005eb8'],

  // Ventilation and plant equipment that speaks BACnet directly
  [/swegon/i,                          'Swegon',        '#0093d0'],
  [/systemair/i,                       'Systemair',     '#e30613'],
  [/fl[aä]kt/i,                        'FläktGroup',    '#0069b4'],
  [/iv\s*produkt/i,                    'IV Produkt',    VENDOR_GREY],
  [/exhausto/i,                        'Exhausto',      VENDOR_GREY],
  [/enervent/i,                        'Enervent',      VENDOR_GREY],
  [/halton/i,                          'Halton',        VENDOR_GREY],
  [/lindab/i,                          'Lindab',        '#005ca9'],
  [/nibe/i,                            'NIBE',          '#e30613'],
  [/danfoss/i,                         'Danfoss',       '#e2000f'],
  [/grundfos/i,                        'Grundfos',      '#0068b3'],
  [/(^|\W)abb(\W|$)|auto-?matrix|cylon/i, 'ABB',        '#ff000f'],
  [/carrier/i,                         'Carrier',       '#00539b'],
  [/trane/i,                           'Trane',         '#ba0c2f'],
  [/daikin/i,                          'Daikin',        '#0097e0'],
  [/mitsubishi/i,                      'Mitsubishi',    '#e60012'],
  [/(^|\W)lg(\W|$)/i,                  'LG',            '#a50034'],
  [/samsung/i,                         'Samsung',       '#1428a0'],
  [/yokogawa/i,                        'Yokogawa',      '#00a0e9'],
  [/bosch/i,                           'Bosch',         '#e20015'],
  [/viessmann/i,                       'Viessmann',     '#e2001a'],
  [/vaillant/i,                        'Vaillant',      '#00754a'],
  [/oj\s*electronics/i,                'OJ Electronics', VENDOR_GREY],
  // Funnet paa et hotellanlegg - ventilasjonsaggregater og gatewayer
  // som svarer paa BACnet direkte.
  [/komfovent|amalva/i,                'Komfovent',     '#0072bc'],
  [/embedded\s*systems/i,              'Embedded Sys.', VENDOR_GREY],
  // Protokoll-gatewayer: dukker opp som egne BACnet-enheter og er ofte det
  // som staar mellom deg og utstyret du egentlig leter etter.
  [/fieldserver|sierra\s*monitor|(^|\W)msa(\W|$)/i, 'FieldServer', VENDOR_GREY],
  [/intesis|hms\s*(networks|industrial)/i, 'Intesis',   VENDOR_GREY],
  [/anybus/i,                          'Anybus',        VENDOR_GREY],
  [/babel\s*buster|control\s*solutions/i, 'Babel Buster', VENDOR_GREY],
  [/chipkin/i,                         'Chipkin',       VENDOR_GREY],
  [/(^|\W)exor(\W|$)/i,                'Exor',          VENDOR_GREY],
  [/wexi|wexiodisk/i,                  'Wexiödisk',     VENDOR_GREY],
  [/bastec/i,                          'Bastec',        VENDOR_GREY],
  [/webeasy|abelko/i,                  'Abelko',        VENDOR_GREY],
  [/tour\s*&?\s*andersson|(^|\W)ta(\W|$)/i, 'TA Hydronics', VENDOR_GREY],
  [/micro\s*matic/i,                   'Micro Matic',   VENDOR_GREY],
];

/* Registered BACnet vendor identifiers, used only when vendor-name is missing
   or says nothing we recognise. The number comes from the device itself and is
   assigned by ASHRAE, so it is the more reliable of the two - but a wrong entry
   here would mislabel a controller, so it is kept as a fallback behind the
   name and covers only vendors whose id was checked against the published
   register (bacnet.org/assigned-vendor-ids). */
const VENDOR_IDS = {
  2: 'Trane', 3: 'Daikin', 5: 'Johnson C.', 6: 'ABB', 7: 'Siemens',
  8: 'Delta Controls', 9: 'Siemens', 10: 'Schneider', 16: 'Carrier',
  17: 'Honeywell', 18: 'Alerton', 24: 'Automated Logic', 28: 'KMC',
  35: 'Reliable C.', 36: 'Tridium', 53: 'Daikin', 80: 'Sauter',
  82: 'Mitsubishi', 89: 'Saia-Burgess', 91: 'Trend', 105: 'Priva',
  127: 'ABB', 129: 'Carrier', 171: 'ABB', 178: 'LOYTEC', 190: 'Danfoss',
  196: 'Yokogawa', 217: 'Samsung', 222: 'WAGO', 226: 'Phoenix C.',
  227: 'Grundfos', 264: 'Regin', 284: 'Belimo', 332: 'Distech',
  335: 'Schneider', 339: 'Vaisala', 364: 'Distech', 415: 'Beckhoff',
  423: 'Belimo', 432: 'LG',
};
const VENDOR_COLOR = Object.fromEntries(VENDORS.map(([, navn, farge]) => [navn, farge]));

function vendorOf(name, id) {
  const raw = String(name == null ? '' : name).trim();
  for (const [re, label, color] of VENDORS) if (re.test(raw)) return {label, color};
  // Nothing matched the text: fall back to the registered id, which many
  // controllers report even when their vendor-name is blank or generic.
  const fraId = VENDOR_IDS[Number(id)];
  if (fraId) return {label: fraId, color: VENDOR_COLOR[fraId] || VENDOR_GREY};
  return {label: raw || 'Ukjent', color: VENDOR_GREY};
}

/* Mirrors VALUE_TYPES on the server: the types that carry a live value and
   therefore make it into the table unless "alle objekttyper" is on. */
const VERDITYPER = new Set([
  'analog-input','analog-output','analog-value',
  'binary-input','binary-output','binary-value',
  'multi-state-input','multi-state-output','multi-state-value',
  'schedule',
]);

const TYPE_CLASS = {
  'analog-input': 't-ai', 'analog-output': 't-ao', 'analog-value': 't-av',
  'binary-input': 't-bi', 'binary-output': 't-bo', 'binary-value': 't-bv',
  'multi-state-input': 't-msi', 'multi-state-output': 't-mso', 'multi-state-value': 't-msv',
};

/* --------------------------------------------------------- persisted prefs */
const PREFS_KEY = 'nm-bacnet-prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(patch) {
  const p = Object.assign(loadPrefs(), patch);
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

/* ------------------------------------------------------------------ utils */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Two very different failures used to look identical here.
   "Failed to fetch" is what the browser says when it cannot reach *our own*
   backend - the program on this PC has stopped, or the page is open against a
   server that is gone. Standing at a plant, that message reads as "the plant
   is unreachable", and the next hour goes into debugging a VPN that was never
   the problem.

   So the two are separated: a request that never reached the backend says so
   in those words, and raises a banner that stays up until it answers again.
   Anything the backend itself refuses keeps its own message. */
let BACKEND_NEDE = false;

/* Sender en linje tvers over hele appen. Ned naar sambandet ryker, opp naar
   det er tilbake. Kalles bare paa selve overgangen - ikke hver gang noe
   sjekker status, for da hadde den gaatt hvert fjerde sekund. */
function sambandslinje(opp) {
  if (bevegelseAv()) return;
  const lag = document.getElementById('linjelag');
  if (!lag) return;
  const el = document.createElement('div');
  el.className = 'samband ' + (opp ? 'opp' : 'ned');
  lag.appendChild(el);
  /* animationend alene er ikke nok: bytter du fane mens linja gaar, fryser
     animasjonen og hendelsen kommer aldri - og streken blir liggende over
     skjermen til sida lastes om. Tidsavbruddet rydder uansett. */
  const vekk = () => el.remove();
  el.addEventListener('animationend', vekk, {once: true});
  setTimeout(vekk, 4000);
}

/* Samler alt som skjer naar kontakten gaar eller kommer, saa de tre stedene
   som oppdager det ikke hver for seg maa huske aa gjore det samme. */
function sambandEndret(oppe) {
  if (SAMBAND_OPPE === oppe) return;
  SAMBAND_OPPE = oppe;
  document.body.classList.toggle('frakoblet', !oppe);
  sambandslinje(oppe);
}
let SAMBAND_OPPE = true;

function meldBackend(nede, detalj) {
  if (BACKEND_NEDE === nede) return;
  BACKEND_NEDE = nede;
  sambandEndret(!nede);
  const el = $('backendWarn');
  if (el) {
    el.hidden = !nede;
    if (nede) el.innerHTML = 'Mistet kontakt med BACnet Explorer på denne PC-en'
      + '<span class="bw-note">Dette er programmet, ikke anlegget. '
      + 'Kjør <b>start.bat</b> igjen — siden kobler seg på av seg selv.</span>';
  }
  if (nede) {
    // The address indicator must stop claiming a live connection: with the
    // backend gone we have no idea what the proxy is bound to any more.
    S.connected = false;
    const c = $('conn');
    if (c) {
      c.classList.add('down');
      $('connText').textContent = 'Ikke tilkoblet';
      $('connAddr').textContent = '';
    }
    $('scanBtn').disabled = true;
  }
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    meldBackend(true);
    throw new Error('Ingen kontakt med BACnet Explorer på denne PC-en — kjører start.bat?');
  }
  meldBackend(false);
  if (!res.ok) {
    // The backend answered, so it is alive - this is a real error from it.
    let detalj = '';
    try { const j = await res.json(); detalj = j.error || j.detail || ''; } catch {}
    throw new Error(detalj || `Serveren svarte ${res.status}`);
  }
  try {
    return await res.json();
  } catch (e) {
    throw new Error('Uventet svar fra serveren (ikke JSON)');
  }
}

/* The page's idea of being connected can go stale without anything failing:
   the backend restarts - autostart, a crash, a service restart - and comes
   back unbound, while the page still shows the old address. Nothing notices
   until the next scan fails with "Proxy er ikke startet", which reads as a
   problem with the plant.
   
   So the binding is checked on a slow timer and restored if it was lost.
   Only when we believed we were connected: an unbound backend the user has
   not connected yet is not something to fix behind their back. */
setInterval(async () => {
  if (BACKEND_NEDE || S.job || S.scanJob || !S.connected) return;
  try {
    const d = await (await fetch('/api/status', {cache: 'no-store'})).json();
    if (!d.running) {
      const kort = S.localAddr || $('localAddr').value;
      await connectTo(kort, {quiet: true});
      if (S.connected) { sambandEndret(true); toast('Forbindelsen ble gjenopprettet — sender fra ' + S.localAddr); }
      else { S.connected = false; sambandEndret(false); await refreshStatus(); }
    }
  } catch { /* haandteres av backend-vakten under */ }
}, 20000);

/* Polls quietly while the backend is down so the banner clears itself the
   moment it comes back, without the user having to reload. */
setInterval(async () => {
  if (!BACKEND_NEDE) return;
  try {
    const r = await fetch('/api/status', {cache: 'no-store'});
    if (r.ok) {
      meldBackend(false);
      await refreshStatus();
      // The restarted backend has no network card bound yet, so pick up the
      // one that was in use. Without this the page recovers but still says
      // "Ikke tilkoblet" until the user works out that they must choose it
      // again - which is exactly the kind of small stall this whole banner
      // exists to prevent.
      if (!S.connected) await connectTo($('localAddr').value, {quiet: true});
      toast(S.connected ? 'Kontakt gjenopprettet — sender fra ' + S.localAddr
                        : 'Kontakt gjenopprettet — velg nettverkskort');
    }
  } catch { /* fortsatt nede */ }
}, 4000);

let toastTimer;
function toast(msg, isErr) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    // Announced to screen readers: a toast that says "12 punkter frigitt" is
    // the confirmation that the write happened, and it was silent before.
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
const status = m => { $('sbMsg').textContent = m || ''; };

function fmtVal(v) {
  if (v === null || v === undefined) return {t: '—', c: 'val-null'};
  if (typeof v === 'number') {
    const r = Math.abs(v) >= 1000 ? v.toFixed(0)
            : Math.abs(v) >= 100 ? v.toFixed(1)
            : Number(v.toFixed(3)).toString();
    return {t: r, c: v === 0 ? 'val-zero' : 'val-num'};
  }
  if (v === 'active') return {t: 'active', c: 'val-on'};
  if (v === 'inactive') return {t: 'inactive', c: 'val-off'};
  return {t: String(v), c: 'val-str'};
}
const shortType = t => (t || '').split('-').map(p => p[0]).join('').toUpperCase();
const wkey = (ip, objid) => ip + '|' + objid;

/* Ranges you have actually scanned become suggestions next time — engineers
   revisit the same buildings and retyping the CIDR every visit is pure
   friction. */
function rememberRange(range) {
  if (!range) return;
  const list = (loadPrefs().ranges || []).filter(r => r !== range);
  list.unshift(range);
  savePrefs({ranges: list.slice(0, 8)});
  renderRangeSuggestions();
}

function renderRangeSuggestions() {
  const dl = $('recentRanges');
  if (!dl) return;
  dl.innerHTML = (loadPrefs().ranges || []).map(r => `<option value="${esc(r)}">`).join('');
}

/* -------------------------------------------------------------- splitters */
const PANE_DEFAULT = {devices: 250, side: 400};
const PANE_LIMITS = {devices: [160, 460], side: [240, 760]};

function applyPaneWidth(which, px) {
  const [lo, hi] = PANE_LIMITS[which];
  const v = Math.max(lo, Math.min(hi, Math.round(px)));
  document.documentElement.style.setProperty('--w-' + which, v + 'px');
  return v;
}

const MAIN_MIN = 430;   // keep the points table usable

/* The side panes are rigid (flex 0 0), so on a narrow window they would
   happily squeeze the points table down to a few characters. Give the table
   a floor and take the space back from the inspector first, then the device
   list — without overwriting the user's saved preference. */
function clampPanes() {
  const prefs = loadPrefs();
  let dev = prefs.wDevices || PANE_DEFAULT.devices;
  let side = prefs.wSide || PANE_DEFAULT.side;
  const avail = window.innerWidth - 10; // two splitters

  let over = (dev + side + MAIN_MIN) - avail;
  if (over > 0) {
    const sideCut = Math.min(over, side - PANE_LIMITS.side[0]);
    side -= Math.max(0, sideCut);
    over -= Math.max(0, sideCut);
  }
  if (over > 0) {
    const devCut = Math.min(over, dev - PANE_LIMITS.devices[0]);
    dev -= Math.max(0, devCut);
  }
  applyPaneWidth('devices', dev);
  applyPaneWidth('side', side);
}

function initSplitters() {
  clampPanes();

  document.querySelectorAll('.splitter').forEach(sp => {
    const which = sp.dataset.pane;
    sp.addEventListener('pointerdown', e => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.classList.add('dragging');
      document.body.classList.add('resizing');
      const startX = e.clientX;
      const startW = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--w-' + which), 10) || PANE_DEFAULT[which];

      const move = ev => {
        // The devices pane grows to the right, the side pane to the left.
        const delta = which === 'devices' ? ev.clientX - startX : startX - ev.clientX;
        applyPaneWidth(which, startW + delta);
      };
      const up = ev => {
        sp.releasePointerCapture(ev.pointerId);
        sp.classList.remove('dragging');
        document.body.classList.remove('resizing');
        sp.removeEventListener('pointermove', move);
        sp.removeEventListener('pointerup', up);
        const w = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--w-' + which), 10);
        savePrefs(which === 'devices' ? {wDevices: w} : {wSide: w});
        renderPoints();
      };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });

    sp.addEventListener('dblclick', () => {
      applyPaneWidth(which, PANE_DEFAULT[which]);
      savePrefs(which === 'devices'
        ? {wDevices: PANE_DEFAULT.devices} : {wSide: PANE_DEFAULT.side});
      renderPoints();
    });
  });
}

/* ------------------------------------------------------------ interfaces */
async function loadInterfaces() {
  const sel = $('localAddr');
  try {
    const d = await (await fetch('/api/interfaces')).json();
    const list = d.interfaces || [];
    if (!list.length) { sel.innerHTML = '<option value="">Fant ingen nettverkskort</option>'; return []; }
    sel.innerHTML = list.map(i =>
      `<option value="${esc(i.cidr)}">${esc(i.interface)} — ${esc(i.cidr)}</option>`).join('');
    const saved = loadPrefs().iface;
    if (saved && list.some(i => i.cidr === saved)) sel.value = saved;
    return list;
  } catch {
    sel.innerHTML = '<option value="">Kunne ikke lese nettverkskort</option>';
    return [];
  }
}

/* Bind to a specific interface. Called on startup and whenever the user
   picks a different one — there is no reason to make them press a separate
   connect button when choosing the interface already says what they want. */
async function connectTo(cidr, {quiet = false} = {}) {
  $('connText').textContent = 'Kobler til…';
  try {
    if (S.connected) await api('/api/stop');
    stopPolling();
    const d = await api('/api/start', {local_address: cidr || null});
    if (d.status === 'error') {
      if (!quiet) toast(d.error || 'Tilkobling feilet', true);
    } else {
      savePrefs({iface: d.local_address});
    }
  } catch (e) {
    if (!quiet) toast(e.message, true);
  }
  await refreshStatus();
}

/* ------------------------------------------------------- connect / status */
async function refreshStatus() {
  try {
    const d = await (await fetch('/api/status')).json();
    S.connected = !!d.running;
    S.localAddr = d.local_address;
  } catch { S.connected = false; }
  const c = $('conn');
  // Nothing to announce while it works; only speak up when it does not.
  c.classList.toggle('down', !S.connected);
  $('connText').textContent = S.connected ? '' : 'Ikke tilkoblet';
  $('connAddr').textContent = S.connected ? (S.localAddr || '') : '';
  $('scanBtn').disabled = !S.connected;
  $('scanBtn').title = S.connected ? '' : 'Velg et nettverkskort først';
  // Keep the dropdown showing what is actually bound, not a stale pick.
  if (S.connected && S.localAddr) {
    const sel = $('localAddr');
    if (![...sel.options].some(o => o.value === S.localAddr)) {
      sel.insertAdjacentHTML('afterbegin', `<option value="${esc(S.localAddr)}">${esc(S.localAddr)}</option>`);
    }
    sel.value = S.localAddr;
  }
}

/* Switching interface invalidates everything discovered through the old one. */
function clearDiscovery() {
  S.devices = []; S.activeDev = null; S.points = [];
  S.selected = null; S.detail = null; S.pointIndex = new Map();
  S.selHist = []; S.snapshot = null; S.sel.clear();
  renderDevices(); renderCtx(); renderPoints(); renderInspector();
}

/* ------------------------------------------------------------------ scan */
/* A plant is often more than one subnet - a building with 192.168.40.0/24 for
   the ventilation and 10.75.1.0/24 for the heating is ordinary. Several ranges
   can be given at once, separated by comma, semicolon, space or newline, and
   they are swept one after another into one list.

   One at a time rather than in parallel: the sweeps share a single BACnet
   socket and the link is usually the constraint, so running them together
   would only make each one less reliable - and the progress line could no
   longer say which range it was on. */
function parseRanges(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

async function scanOneRange(subnet, mode, thorough, onProgress) {
  const body = mode === 'broadcast'
    ? {subnet, mode: 'broadcast', timeout: 4}
    // A responding device answers in ~90 ms, so 600 ms is already a 6x
    // margin and the wait is almost entirely empty addresses. Measured on a
    // /24 over a hotel VPN: 4.4 s at 0.6 s against 6.6-22.9 s at 1.0 s, for
    // the same devices. Thorough mode adds the patient passes on top.
    : {subnet, mode: 'unicast_sweep', per_host_timeout: 0.6,
       concurrency: 40, thorough};

  const started = await api('/api/scan', body);
  if (started.status !== 'started') throw new Error(started.error || 'Skann feilet');
  S.scanJob = started.job_id;

  for (;;) {
    await new Promise(r => setTimeout(r, 400));
    const j = await (await fetch('/api/job/' + started.job_id)).json();
    if (j.status === 'running') {
      onProgress(j);
      continue;
    }
    if (j.status === 'cancelled') return {cancelled: true};
    if (j.status === 'error') throw new Error(j.error || 'Skann feilet');
    return j.result;
  }
}

/* Devices from a previous range are kept; a second range adds to the list
   rather than replacing it. Keyed by address, so re-scanning the same range
   updates in place instead of duplicating. */
function mergeDevices(funnet, subnet) {
  S.tomtSkann = null;   // det kom noe likevel
  for (const d of funnet || []) {
    const eksisterende = S.devices.find(x => x.address === d.address);
    if (eksisterende) Object.assign(eksisterende, d, {_range: subnet});
    else {
      // Marked so the list can stage its arrival once, and only once - a
      // device that has been on screen for a minute should not re-animate
      // every time the list is redrawn.
      S.devices.push(Object.assign({}, d, {_range: subnet, _seen: [], _ny: true}));
    }
  }
}

async function runScan() {
  // Knappen lader opp foer den fyrer, saa ringene som gaar ut leses som noe
  // som ble avfyrt. Ladningen er et eget element, og etiketten faar staa til
  // den er ferdig - skannet gaar i mellomtida, saa ingen ventetid legges til.
  const ladet = ladSkann();
  const raa = $('rangeInput').value.trim();
  const omraader = parseRanges(raa);
  if (!omraader.length) { toast('Skriv inn et IP-område', true); return; }
  const mode = $('modeSel').value;
  const thorough = mode !== 'unicast_fast';
  const b = $('scanBtn');
  b.disabled = true;
  // Vent til ladningen er sett foer etiketten blir en spinner. Nettverket
  // jobber allerede; dette flytter bare rekkefolgen paa det oyet faar.
  if (ladet) setTimeout(() => { if (b.disabled) b.innerHTML = '<span class="spin"></span>'; }, 300);
  else b.innerHTML = '<span class="spin"></span>';

  // A device that would not answer ten minutes ago may well answer now -
  // reachability on a site VPN drifts. A new scan is the natural moment to
  // stop holding that against it.
  PRE.failed.clear();
  prefetchStop();

  /* Devices already known for these same ranges are kept. Measured on a site
     VPN, the six WAGO controllers there answered a discovery probe 46% of the
     time - 3/12, 5/12, 6/12 and so on, in bursts - so a single sweep is close
     to a coin flip per device and clearing the list would throw away
     controllers that are demonstrably there.

     This is what YABE and Niagara get right without trying: once a device is
     in the tree or the database it stays, and they poll what they know rather
     than rediscovering from scratch. Scanning a different range starts over,
     because then the old list really is about somewhere else. */
  const sammeOmraader = omraader.join(' ') === (S.scanRanges || []).join(' ');
  if (!sammeOmraader) { S.devices = []; }
  S.scanRanges = omraader.slice();
  renderDevices();

  document.body.classList.add('skanner');
  skannPing();
  const t0 = performance.now();
  const perOmraade = [];
  b.innerHTML = 'Avbryt';
  b.disabled = false;
  b.onclick = cancelScan;

  try {
    for (let n = 0; n < omraader.length; n++) {
      const subnet = omraader[n];
      const forrige = S.devices.length;
      const merke = omraader.length > 1 ? `[${n + 1}/${omraader.length}] ${subnet} · ` : '';

      const d = await scanOneRange(subnet, mode, thorough, (j) => {
        const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
        skannFramdrift(pct, !j.total);
        status(`${merke}${j.phase || 'søker'} · ${j.done}/${j.total} adresser · ${
          forrige + (j.devices ? j.devices.length : 0)} funnet · ${pct}%`);
        // Devices are published as they answer, so the list fills in while the
        // sweep runs instead of staying empty until it finishes.
        if (j.devices && forrige + j.devices.length !== S.devices.length) {
          // Something answered - the button says so before the list redraws.
          skannSvar();
          mergeDevices(j.devices, subnet);
          S._flyr = true;
          renderDevices();
          S._flyr = false;
          flyInnNye();
        }
      });

      if (d && d.cancelled) { status('Skann avbrutt'); break; }
      if (!d || d.status !== 'done') break;
      mergeDevices(d.devices, subnet);
      // Record who answered this round so a device kept from an earlier scan
      // is shown as remembered rather than as answering now.
      const svarte = new Set((d.devices || []).map(x => x.address));
      for (const dev of S.devices) {
        if (dev._range === subnet) noteSeen(dev.address, svarte.has(dev.address));
      }
      renderDevices();
      rememberRange(subnet);
      perOmraade.push(`${subnet}: ${d.count}`);
    }

    const secs = ((performance.now() - t0) / 1000).toFixed(0);
    if (omraader.length > 1) {
      status(`${S.devices.length} enhet(er) i ${omraader.length} områder · ${secs}s · ${perOmraade.join(' · ')}`);
    } else {
      status(`${S.devices.length} enhet(er) · ${secs}s`);
    }
    /* Hva som ble skannet, saa manglendeEnheter() vet hvilke savnede enheter
       som hoerer til - ikke enheter paa et helt annet nett. */
    S.sisteOmraader = omraader;
    S.tomtSkann = S.devices.length ? null : {mode, omraader};
    renderDevices();          // varselpanelet skal med en gang
  } catch (e) { toast(e.message, true); status(''); }
  document.body.classList.remove('skanner');
  skannSlutt();
  S.scanJob = null;
  // Remembered once the sweep is finished, not while it runs - a half-done
  // scan is not the list you want to come back to next month.
  husk(S.scanRanges, S.devices);
  // Not re-enabled when the backend is gone: pressing it again would only
  // produce the same failure.
  b.disabled = BACKEND_NEDE || !S.connected;
  b.textContent = 'Skann'; b.onclick = runScan;
}

async function cancelScan() {
  if (!S.scanJob) return;
  await api('/api/job/' + S.scanJob + '/cancel');
}

/* Two devices answering to the same instance number is a real and nasty
   fault on a BACnet network: requests reach whichever replies first, so
   readings and writes land on the wrong controller intermittently. The scan
   already has everything needed to spot it, and nothing was doing so. */
function duplicateInstances() {
  const seen = {};
  for (const d of S.devices) {
    if (d.device_instance == null) continue;
    (seen[d.device_instance] = seen[d.device_instance] || []).push(d.address);
  }
  return Object.entries(seen).filter(([, ips]) => ips.length > 1);
}

/* Faults that belong to the site rather than to any one device. Both are
   things nobody goes looking for - you notice the symptoms months later and
   never connect them to the cause.

   Presented as a collapsed summary by default: on a site where five
   controllers have drifted clocks, the expanded list pushed the device list
   off screen, and a wall of amber text at full brightness makes every line
   shout equally loudly. Inside it, only the fault itself is coloured - the
   instance and address stay neutral so the eye lands on what is wrong
   rather than on the whole block. */

/* ------------------------------------------- enheter som pleier aa svare */
/* Anleggsminnet husker hvilke enheter som har svart paa dette anlegget - med
   adresse, ID og leverandoer. Det er en langt bedre fasit enn et antall:

   - Den overlever at verktoyet lukkes. Kjoerer du rask sweep foerste gang i
     dag, vet den likevel hva som pleier aa vaere der.
   - Den kan si HVILKE som mangler, ikke bare hvor mange. "Tre WAGO svarte
     ikke" er noe man kan gjoere noe med; "tre faerre enn sist" er det ikke.

   Rask sweep proever hver adresse en gang, og rekkevidden over VPN driver fra
   minutt til minutt - saa manglende enheter er regelen, ikke unntaket. Derfor
   hoerer dette hjemme i varselpanelet sammen med klokkeavvikene, som blir
   staaende og kan foldes bort, og ikke i en rute som forsvinner ved neste
   omtegning. */
function manglendeEnheter() {
  if (!S.devices.length) return [];
  const naa = new Set(S.devices.map(d => d.address));
  const sett = new Map();
  for (const site of Object.values(MINNE || {})) {
    for (const e of (site.enheter || [])) {
      if (!e || !e.address || naa.has(e.address)) continue;
      // Bare enheter som hoerer til et omraade vi faktisk skannet naa.
      if (!(S.sisteOmraader || []).some(o => iOmraade(e.address, o))) continue;
      sett.set(e.address, e);
    }
  }
  return [...sett.values()];
}

/* Er adressen innenfor omraadet? Brukes til aa la vaere aa melde savn om
   enheter paa et helt annet nett enn det som ble skannet. */
function iOmraade(ip, omraade) {
  try {
    const [nett, bits] = omraade.split('/');
    const n = +bits;
    if (!isFinite(n)) return ip === omraade;
    const tall = (a) => a.split('.').reduce((s, x) => (s << 8) + (+x), 0) >>> 0;
    const maske = n === 0 ? 0 : (0xFFFFFFFF << (32 - n)) >>> 0;
    return (tall(ip) & maske) === (tall(nett) & maske);
  } catch (e) { return false; }
}

function siteWarnings() {
  const ut = [];

  const dup = duplicateInstances();
  if (dup.length) {
    ut.push({
      nokkel: 'dup',
      tittel: `${dup.length} enhets-ID i konflikt`,
      note: 'Forespørsler treffer den som svarer først, så lesinger og skrivinger '
          + 'kan lande på feil sentral.',
      rader: dup.map(([inst, ips]) => ({
        alvorlig: true, id: inst, adresse: ips.join('  '),
        tekst: `svarer fra ${ips.length} adresser`, ip: ips[0],
      })),
    });
  }

  const mangler = manglendeEnheter();
  if (mangler.length) {
    // Gruppert paa leverandoer, fordi det som regel er en hel type som ryker -
    // "alle WAGO-ene" er et moenster, tre tilfeldige adresser er det ikke.
    const perLev = {};
    for (const e of mangler) {
      const l = e.vendor || 'Ukjent';
      (perLev[l] = perLev[l] || []).push(e);
    }
    const levTekst = Object.entries(perLev)
      .sort((x, y) => y[1].length - x[1].length)
      .map(([l, xs]) => xs.length + ' ' + l).join(' · ');
    ut.push({
      nokkel: 'mangler',
      tittel: `${mangler.length} ${mangler.length === 1 ? 'enhet' : 'enheter'} svarte ikke`,
      note: 'Disse har svart her før. Rask sweep prøver hver adresse én gang, og '
          + 'rekkevidden over VPN driver — «Sweep — grundig» prøver de stille om igjen. '
          + levTekst,
      rader: mangler.map(e => ({
        alvorlig: false,
        id: String(e.device_instance ?? '?'),
        adresse: e.address, ip: e.address,
        tekst: (e.object_name || '') + (e.vendor ? ' · ' + e.vendor : ''),
        savnet: true,
      })),
    });
  }

  const skjeve = S.devices
    .map(d => ({d, sek: clockDrift(d.address)}))
    .filter(x => x.sek !== null && Math.abs(x.sek) >= CLOCK_WARN)
    // Worst first: a controller that has never had its clock set matters more
    // than one running half an hour fast.
    .sort((a, b) => Math.abs(b.sek) - Math.abs(a.sek));
  if (skjeve.length) {
    ut.push({
      nokkel: 'klokke',
      tittel: `${skjeve.length} ${skjeve.length === 1 ? 'enhet har' : 'enheter har'} feil klokke`,
      note: 'Ukeprogram kjører etter enhetens egen klokke, og trendlogger stemples med den.',
      rader: skjeve.map(({d, sek}) => ({
        alvorlig: Math.abs(sek) > CLOCK_SEVERE,
        id: String(d.device_instance ?? '?'), adresse: d.address, ip: d.address,
        tekst: driftText(sek, (S.identity[d.address] || {})['device-time']),
      })),
    });
  }
  return ut;
}

function renderSiteWarnings() {
  const el = $('dupWarn');
  if (!el) return;
  const seksjoner = siteWarnings();
  /* Toem ogsaa innholdet. Med bare hidden=true blir forrige varsel liggende i
     dokumentet - usynlig, men det er fortsatt der for skjermlesere og for alt
     som leser teksten. */
  if (!seksjoner.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;

  const apen = !!loadPrefs().warnOpen;
  const antall = seksjoner.reduce((n, s) => n + s.rader.length, 0);
  const alvorlige = seksjoner.reduce((n, s) => n + s.rader.filter(r => r.alvorlig).length, 0);

  const hode = `<button class="warn-head${alvorlige ? ' severe' : ''}" id="warnToggle"
      aria-expanded="${apen}" title="${apen ? 'Skjul' : 'Vis'} detaljer">
    <span class="warn-title">${seksjoner.map(s => esc(s.tittel)).join(' · ')}</span>
    <span class="warn-chev">${apen ? '⌃' : '⌄'}</span>
  </button>`;

  const kropp = !apen ? '' : '<div class="warn-body">' + seksjoner.map(s => `
    <div class="warn-sect">
      ${s.rader.map(r => `<button class="warn-row${r.alvorlig ? ' severe' : ''}" data-goto="${esc(r.ip)}"
          title="Gå til ${esc(r.adresse)}">
        <span class="wr-id">${esc(r.id)}</span>
        <span class="wr-ip">${esc(r.adresse)}</span>
        <span class="wr-txt">${esc(r.tekst)}</span>
        ${s.nokkel === 'klokke' && !S.readOnly
          ? `<span class="wr-fiks" data-synk="${esc(r.ip)}"
               title="Sett klokka på denne enheten fra denne PC-en">Still klokka</span>` : ''}
        ${r.savnet
          ? `<span class="wr-fiks" data-pingen="${esc(r.ip)}"
               title="Svarer denne adressen på ping?">Ping</span>` : ''}
      </button>`).join('')}
      <div class="warn-note">${esc(s.note)}</div>
    </div>`).join('') + '</div>';

  el.classList.toggle('severe', alvorlige > 0);
  el.innerHTML = hode + kropp;
  el.querySelector('#warnToggle').onclick = () => {
    savePrefs({warnOpen: !apen});
    renderSiteWarnings();
  };
  // The point of listing a device is to go and look at it.
  el.querySelectorAll('[data-goto]').forEach(b =>
    b.onclick = () => selectDevice(b.dataset.goto));
  el.querySelectorAll('[data-synk]').forEach(sp =>
    sp.onclick = ev => { ev.stopPropagation(); stillKlokka(sp.dataset.synk); });

  /* Ping paa en enkelt savnet adresse. Svarer den, staar regulatoren der og
     det er BACnet-oppdagelsen som feiler - da er grundig sweep svaret. */
  el.querySelectorAll('[data-pingen]').forEach(sp =>
    sp.onclick = async ev => {
      ev.stopPropagation();
      const ip = sp.dataset.pingen;
      const foer = sp.textContent;
      sp.textContent = 'pinger…';
      try {
        const d = await api('/api/ping', {subnet: ip + '/32', timeout_ms: 900});
        const lever = (d.alive || []).length > 0;
        sp.textContent = lever ? 'svarer på ping' : 'stille';
        sp.classList.toggle('wr-ok', lever);
        sp.classList.toggle('wr-nei', !lever);
        if (lever) toast(ip + ' svarer på ping — prøv «Sweep — grundig»');
      } catch (e) {
        sp.textContent = /404|not found/i.test(e.message || '')
          ? 'krever omstart' : 'feilet';
        sp.title = /404|not found/i.test(e.message || '')
          ? 'Ping kom i en nyere serverversjon — kjør start.bat igjen'
          : e.message;
      }
    });
}

/* The tool already spotted the wrong clock and said why it matters; what it
   could not do was anything about it. On this site one controller sits at
   2000-02-02 and another is eighteen days behind, and both drive schedules -
   so the fix belongs next to the finding, not in another program. */
async function stillKlokka(ip) {
  const d = S.devices.find(x => x.address === ip);
  const naavaerende = (S.identity[ip] || {})['device-time'];
  if (!confirm(`Sette klokka på ${d ? (d.device_instance ?? ip) : ip} til denne PC-ens tid?\n\n`
             + `Enheten står nå på: ${naavaerende || 'ukjent'}\n`
             + `Denne PC-en:        ${new Date().toLocaleString('no')}\n\n`
             + `Ukeprogram og trendlogger på enheten følger denne klokka.`)) return;

  toast('Stiller klokka…');
  let r;
  try {
    r = await api('/api/device/clock', {address: ip});
  } catch (e) {
    r = {status: 'error', error: e.message};
  }
  if (r.status !== 'done') { toast(r.error || 'Klarte ikke å stille klokka', true); return; }

  if (r.advarsel) {
    toast(r.advarsel, true);
  } else {
    toast(`Klokka er stilt — enheten er nå ${r.avvik_etter ?? 0} s fra denne PC-en`);
  }
  // Re-read so the warning reflects what the device says now, not what it
  // said when it was first identified.
  if (r.etter) {
    S.identity[ip] = Object.assign({}, S.identity[ip], {
      'device-time': r.etter, 'clock-drift': r.avvik_etter ?? 0,
    });
  }
  renderSiteWarnings();
  renderDevices();
}

/* Once a device has been read we already know whether anything in it is in
   fault or overridden - but the device list said nothing, so you had to open
   each one to find out. Counts only, and only when non-zero: the list stays
   quiet on a healthy site. */
/* The rail down the left of a device row used to be the vendor's brand colour.
   That put a permanent red bar on every Honeywell and Sauter, and a green one
   on every WAGO and Schneider - colour spent on identity, which ISA-101 rules
   out for exactly the reason it bit here: the same row now shows fault counts
   in red, so a red rail beside a red chip is noise arguing with signal.

   The rail carries state instead. On a healthy site the device list is quiet,
   and colour there means something. The vendor keeps its name - identity
   carried by text, which costs no salience. */
function devState(ip) {
  const pts = S.cache[ip];
  if (!pts) return '';
  const c = flagCounts(pts);
  if ((c['in-alarm'] || 0) + (c['fault'] || 0)) return 'bad';
  if ((c['overridden'] || 0) + (c['out-of-service'] || 0)) return 'warn';
  return 'ok';
}

/* Shown only when a device has actually missed a sweep - on a healthy network
   this never appears. */
function presenceTag(d) {
  const p = presence(d);
  if (!p || p.svar === p.av) return '';
  const tittel = `Svarte på ${p.svar} av de siste ${p.av} søkene`
    + (d._lastSeen ? ` · sist sett ${new Date(d._lastSeen).toLocaleTimeString('no')}` : '');
  return `<em class="dev-seen${p.naa ? '' : ' borte'}" title="${esc(tittel)}">${p.svar}/${p.av}</em>`;
}

function devFlagTags(ip) {
  const pts = S.cache[ip];
  if (!pts) return '';
  const c = flagCounts(pts);
  const feil = (c['in-alarm'] || 0) + (c['fault'] || 0);
  const over = (c['overridden'] || 0) + (c['out-of-service'] || 0);
  let ut = '';
  if (feil) ut += `<em class="dev-flag bad" title="${feil} punkter i alarm eller med feil">${feil}</em>`;
  if (over) ut += `<em class="dev-flag warn" title="${over} punkter overstyrt eller ute av drift">${over}</em>`;
  return ut;
}

/* Hvem som var stille sist lista ble tegnet. */
let BORTE_FOER = new Set();
let BORTE_NAA = new Set();

function renderDevices() {
  BORTE_NAA = new Set();
  $('devCount').textContent = S.devices.length;
  renderSiteWarnings();
  const el = $('devList');
  if (!S.devices.length && S.tomtSkann) {
    // Forklaringa paa et tomt skann tegnes HER, ikke skrives inn en gang
    // utenfra - ellers viskes den bort neste gang lista bygges.
    tomtSkannResultat(S.tomtSkann.mode, S.tomtSkann.omraader);
    return;
  }
  if (!S.devices.length) {
    el.innerHTML = `<div class="guide">
      <b>Kom i gang</b>
      <ol>
        <li>Sjekk at <b>Fra</b> viser nettverkskortet som når anlegget.</li>
        <li>Skriv IP-området i <b>Skann</b>, f.eks. <b>10.75.1.0/24</b>.</li>
        <li>Trykk <b>Skann</b> — enhetene dukker opp her.</li>
      </ol>
    </div>`;
    return;
  }
  const dupIds = new Set(duplicateInstances().map(([inst]) => String(inst)));

  const kort = (d) => {
    const sel = S.activeDev && S.activeDev.address === d.address ? ' sel' : '';
    const v = vendorOf(d.vendor_name, d.vendor_id);
    const dup = dupIds.has(String(d.device_instance));
    const st = devState(d.address);
    const ny = d._ny ? ' ny' : '';
    // Not deleted here: the flight needs to know which cards are new after
    // the list has been laid out, and this pass runs before that.
    if (d._ny && !S._flyr) delete d._ny;
    const L = (S._lastere && S._lastere[d.address]) || null;
    const laster = L ? ' laster' + (L.ukjent ? ' ukjent' : '') : '';
    const frem = L && !L.ukjent
      ? `;--frem:${L.andel};--frem2:${L.andel2 || 0}` : '';
    // En regulator som ikke svarte sist runde skal SES, ikke telles.
    // Selve overgangen til stillhet faar tegne streken; er den allerede
    // stille, staar streken der uten aa gjore noe.
    const pres = presence(d);
    const erBorte = !!(pres && !pres.naa);
    // Tre tilstander, ikke to: stille, nettopp blitt stille, og nettopp
    // kommet tilbake. Den siste manglet - streken bare forsvant.
    const borte = erBorte
      ? (BORTE_FOER.has(d.address) ? ' borte' : ' borte nyborte')
      : (BORTE_FOER.has(d.address) ? ' tilbake' : '');
    if (erBorte) BORTE_NAA.add(d.address);
    return `<button class="dev${sel}${ny}${laster}${borte}${st ? ' st-' + st : ''}" data-ip="${esc(d.address)}" style="--vc:${v.color}${frem}">
      <div class="dev-top">
        <span class="dev-id${dup ? ' dup' : ''}"${dup ? ' title="Flere enheter svarer på denne ID-en"' : ''}>${d.device_instance ?? '?'}</span>
        <span class="dev-ip">${esc(d.address)}</span>
      </div>
      <div class="dev-name">${esc(d.object_name || '—')}${
        noteFor(d) ? `<span class="dev-note" title="${esc(noteFor(d))}">notat</span>` : ''}</div>
      <div class="dev-meta vendor"><i></i><span class="vendor-name">${esc(v.label)}</span>${presenceTag(d)}${devFlagTags(d.address)}${
        S.cache[d.address] ? `<em class="dev-cached">${S.cache[d.address].length} pkt</em>`
        : PRE.jobs.has(d.address) ? '<em class="dev-cached pre">leser…</em>' : ''}</div>
    </button>`;
  };

  const akse = loadPrefs().groupBy || (loadPrefs().groupVendor === false ? 'none' : 'vendor');
  if (akse === 'none') {
    el.innerHTML = S.devices.map(kort).join('');
  } else {
    // Grouped by maker, because on a mixed site that is genuinely how you
    // think about the plant: the Beckhoffs behave one way, the WAGOs another.
    // Sections are ordered by size so the dominant system comes first, and a
    // section carrying a fault sorts above an equally large healthy one.
    const grupper = new Map();
    for (const d of S.devices) {
      // Grouping by range answers "which part of the plant"; by vendor it
      // answers "which system". Both are things you actually ask.
      const v = akse === 'range'
        ? {label: d._range || 'Ukjent område', color: VENDOR_GREY}
        : vendorOf(d.vendor_name, d.vendor_id);
      if (!grupper.has(v.label)) grupper.set(v.label, {v, enheter: []});
      grupper.get(v.label).enheter.push(d);
    }
    const verst = (g) => g.enheter.reduce((n, d) =>
      Math.max(n, devState(d.address) === 'bad' ? 2 : devState(d.address) === 'warn' ? 1 : 0), 0);
    const skjulte = new Set(loadPrefs().vendorCollapsed || []);
    el.innerHTML = [...grupper.values()]
      .sort((a, b) => verst(b) - verst(a) || b.enheter.length - a.enheter.length
                      || a.v.label.localeCompare(b.v.label, 'no'))
      .map(g => {
        const av = skjulte.has(g.v.label);
        const feil = g.enheter.filter(d => devState(d.address) === 'bad').length;
        const adv = g.enheter.filter(d => devState(d.address) === 'warn').length;
        return `<div class="vgroup${av ? ' av' : ''}" style="--vc:${g.v.color}">
          <button class="vgroup-head" data-vendor="${esc(g.v.label)}">
            <span class="vgroup-bar"></span>
            <span class="vgroup-name">${esc(g.v.label)}</span>
            ${feil ? `<em class="dev-flag bad" title="${feil} enheter med feil">${feil}</em>` : ''}
            ${adv ? `<em class="dev-flag warn" title="${adv} enheter med overstyringer">${adv}</em>` : ''}
            <span class="vgroup-n">${g.enheter.length}</span>
            <span class="vgroup-chev">⌃</span>
          </button>
          <div class="vgroup-body"><div class="vgroup-inner">${
            g.enheter.map(kort).join('')}</div></div>
        </div>`;
      }).join('');

    el.querySelectorAll('[data-vendor]').forEach(b => b.onclick = () => {
      const sett = new Set(loadPrefs().vendorCollapsed || []);
      sett.has(b.dataset.vendor) ? sett.delete(b.dataset.vendor) : sett.add(b.dataset.vendor);
      savePrefs({vendorCollapsed: [...sett]});
      renderDevices();
    });
  }

  el.querySelectorAll('.dev').forEach(b =>
    b.onclick = () => selectDevice(b.dataset.ip));

  // Neste tegning vet hvem som allerede sto stille, saa streken ikke tegnes
  // opp igjen for dem.
  BORTE_FOER = BORTE_NAA;

  // Kort som er i lufta maa foelge med paa at lista flyttet seg.
  synkFlyvende();
}

/* -------------------------------------------------------------- load points */
/* Poll a server-side job until it finishes, reporting progress as it goes.
   Loading a large controller is slow enough that a frozen pane with no way
   out is the worst possible answer. */
/* Watch a job to completion. Kept separate from starting one so that a
   background prefetch and the foreground can both use it - and so clicking
   the device that is already being prefetched can adopt that job instead of
   cancelling it and reading the same controller twice. */
async function pollJob(jobId, onProgress, onPartial) {
  let handedOver = false;
  let shownCount = -1;
  for (;;) {
    await new Promise(r => setTimeout(r, 250));
    const j = await (await fetch('/api/job/' + jobId)).json();
    if (j.status === 'running') {
      // The server publishes points as they arrive and keeps running for the
      // descriptions. Show them as they come rather than holding the table
      // back for a pass the user never asked to wait for. Only re-render when
      // the count actually moved - polling is faster than the read.
      if (j.result && onPartial && j.result.count !== shownCount) {
        shownCount = j.result.count;
        handedOver = true;
        onPartial(j.result);
      }
      if (onProgress) onProgress(j.done, j.total, j.phase, handedOver, j.counts, j.identity);
      continue;
    }
    if (j.status === 'cancelled') return {cancelled: true};
    if (j.status === 'error') throw new Error(j.error || 'Lasting feilet');
    return j.result;
  }
}

async function runJob(startBody, onProgress, onPartial) {
  const started = await api('/api/device/points', startBody);
  if (started.status !== 'started') throw new Error(started.error || 'Kunne ikke starte');
  S.job = started.job_id;
  try {
    return await pollJob(started.job_id, onProgress, onPartial);
  } finally {
    S.job = null;
  }
}

/* ------------------------------------------------------- background prefetch
   Reading a controller's points takes seconds to minutes, and the user
   almost always wants more than one. So after a scan the remaining devices
   are read quietly in the background.

   The rule that keeps this from making things worse: strictly one device at
   a time, and never while the user is waiting for something. Everything
   shares one BACnet socket, so a "parallel" prefetch would simply steal
   bandwidth from whatever the user is actually looking at - which is the
   failure mode this is meant to prevent. */
/* Three at a time, measured. Reading one device is bounded by that device,
   not by the link or by our socket: within a single controller, raising the
   request concurrency from 6 to 20 changed nothing (8.9 s either way). So
   reading several controllers at once is close to free, and it scales -
   six devices took 18.6 s one at a time, 10.8 s at two, 7.5 s at three and
   7.1 s at four.

   Three is the point where the curve flattens. And it costs the user
   nothing: a foreground load of a 1301-point controller took 8.4 s with
   nothing else running, and 8.1-8.3 s with three background reads in
   flight - inside the noise on this link. */
const PRE = {on: true, max: 3, jobs: new Map(), failed: new Set()};

function prefetchStop() {
  for (const id of PRE.jobs.values()) api('/api/job/' + id + '/cancel').catch(() => {});
  PRE.jobs.clear();
  renderDevices();
  renderPrefetchStatus();
}

function prefetchNextDevice() {
  // Never the device on screen. The foreground load claims S.job only once
  // its request comes back, and a tick landing in that window would start a
  // second read of the very controller the user is waiting for.
  const aktiv = S.activeDev && S.activeDev.address;
  return S.devices.find(d => !S.cache[d.address]
                          && !PRE.failed.has(d.address)
                          && !PRE.jobs.has(d.address)
                          && d.address !== aktiv);
}

async function prefetchOne(dev) {
  const ip = dev.address;
  PRE.jobs.set(ip, null);            // claim the slot before any await
  try {
    const started = await api('/api/device/points',
                              {address: ip, device_instance: dev.device_instance,
                               background: true});
    if (started.status !== 'started') { PRE.failed.add(ip); return; }
    // Between the await above and here the user may have clicked something.
    if (!PRE.on || !PRE.jobs.has(ip)) {
      api('/api/job/' + started.job_id + '/cancel').catch(() => {});
      return;
    }
    PRE.jobs.set(ip, started.job_id);
    renderDevices();
    /* The background read is the same work on the same device, so it gets the
       same two bars. It reported nothing at all before - a device could be
       read for half a minute with the card showing only "leser…", which says
       that something is happening and nothing about how far along it is. */
    const bakgrunnFramdrift = (done, total, phase) =>
      kortFramdrift(ip, total ? (done / total) * 100 : 0, !total, phase);
    const d = await pollJob(started.job_id, bakgrunnFramdrift, null);
    if (d && d.points && !d.cancelled) {
      cachePoints(ip, d.points);
      S.cacheMeta[ip] = {type_counts: d.type_counts || {}, total_objects: d.total_objects || 0,
                         readAt: Date.now()};
      // Also from the background, so the site warnings cover every device
      // that has been read - not only the ones opened by hand.
      if (d.identity && Object.keys(d.identity).length) S.identity[ip] = d.identity;
    } else if (!d || !d.cancelled) {
      PRE.failed.add(ip);
    }
  } catch (e) {
    PRE.failed.add(ip);
  } finally {
    PRE.jobs.delete(ip);
    kortFerdig(ip);
    renderDevices();
    renderPrefetchStatus();
  }
}

/* Starting new background reads waits for the foreground; ones already in
   flight are left alone, since they were measured not to cost it anything. */
/* The background reads are otherwise only visible as badges appearing in the
   device list. One line saying how far it has got tells you whether waiting a
   moment longer will save you a load. */
function renderPrefetchStatus() {
  const el = $('sbPre');
  if (!el) return;
  const total = S.devices.length;
  if (!total || !PRE.on) { el.hidden = true; return; }
  const lest = S.devices.filter(d => S.cache[d.address]).length;
  const feilet = S.devices.filter(d => PRE.failed.has(d.address)).length;
  const html = (lest + feilet >= total)
    ? `<b>${lest}</b> av ${total} enheter lest` + (feilet ? ` · ${feilet} svarte ikke` : '')
    : `leser anlegget: <b>${lest}</b> av ${total}`;
  el.hidden = false;
  // This runs on a 1.2 s timer whether or not anything moved. Rewriting
  // innerHTML with the same string tears down and rebuilds the nodes, which
  // drops a text selection and makes screen readers re-announce - so only
  // write when it actually changed.
  if (el.innerHTML !== html) el.innerHTML = html;
}

function prefetchTick() {
  renderPrefetchStatus();
  if (!PRE.on || S.job || S.scanJob) return;
  while (PRE.jobs.size < PRE.max) {
    const dev = prefetchNextDevice();
    if (!dev) return;
    prefetchOne(dev).catch(() => {});
  }
}

setInterval(prefetchTick, 1200);
// The values do not change, but their age does - so the label has to keep up
// on its own rather than only when something is clicked.
setInterval(markFreshness, 15000);

async function cancelJob() {
  if (!S.job) return;
  await api('/api/job/' + S.job + '/cancel');
  toast('Lasting avbrutt');
}

const IDENT_LABELS = {
  'model-name': 'Modell', 'firmware-revision': 'Firmware',
  'application-software-version': 'Programvare', 'location': 'Plassering',
  'description': 'Beskrivelse', 'device-time': 'Enhetens klokke',
};

/* Under two minutes is round-trip and rounding. Above it, the device's
   schedules fire at the wrong hour and its trend timestamps are fiction -
   a fault that produces complaints about ventilation running at odd times
   long before anyone thinks to check a clock. */
const CLOCK_WARN = 300;      // under fem minutter endrer ikke driften av et anlegg
const CLOCK_SEVERE = 86400;  // et døgn eller mer: klokka er ikke stilt, ikke bare drevet

function clockDrift(ip) {
  const id = S.identity[ip];
  if (!id || typeof id['clock-drift'] !== 'number') return null;
  return id['clock-drift'];
}

/* Past about a month a duration stops being informative - "9695 døgn etter"
   is harder to act on than "står på 2000-02-02", which immediately reads as
   a controller that has never had its clock set. */
function driftText(sek, deviceTime) {
  const a = Math.abs(sek);
  const retning = sek > 0 ? 'foran' : 'etter';
  if (a > 2592000 && deviceTime) return `står på ${String(deviceTime).slice(0, 10)}`;
  if (a < 90) return `${Math.round(a)} s ${retning}`;
  if (a < 5400) return `${Math.round(a / 60)} min ${retning}`;
  if (a < 172800) return `${(a / 3600).toFixed(1)} t ${retning}`;
  return `${Math.round(a / 86400)} døgn ${retning}`;
}

/* What the wait shows is whatever the device has already told us. The object
   list arrives about a second before the first values, and it says what kind
   of controller this is - which is the question you actually have while
   standing there. No filler.

   The box is built once and then patched. Rebuilding it from a string on every
   poll - four times a second - replaced the spinner element each time, so its
   CSS animation restarted from zero and the thing visibly juddered; and it
   replaced the progress bar before its width transition could run, so the bar
   snapped instead of sliding. Neither is fixable with CSS while the element
   keeps being thrown away. */
const FASE_TEKST = {
  'objektliste': 'Leser objektliste fra',
  'punkter': 'Leser verdier fra',
  'beskrivelser': 'Leser beskrivelser fra',
  'tilstandstekster': 'Leser tilstandstekster fra',
  'av/pa-tekster': 'Leser av/på-tekster fra',
  'ukeprogram': 'Leser ukeprogram fra',
};

/* Each phase reports its own done/total starting at zero, so a bar driven
   straight off them ran to full and snapped back to nothing five times in one
   load. The phases get a share of the bar instead, and the result is clamped
   so it can never move backwards - a progress bar that retreats tells the user
   the tool has lost its place. */
const FASE_ANDEL = {
  'objektliste': [0, 40],
  'punkter': [40, 75],
  'beskrivelser': [75, 88],
  'tilstandstekster': [88, 92],
  'av/pa-tekster': [92, 97],
  'ukeprogram': [97, 100],
};

function samletPct(done, total, phase) {
  const andel = FASE_ANDEL[phase];
  const inne = total ? Math.min(1, done / total) : 0;
  if (!andel) return inne * 100;
  return andel[0] + inne * (andel[1] - andel[0]);
}

function loadingSkall(ip) {
  return `<div class="loadbox" id="loadbox">
    <div class="loadbox-top"><span class="spin"></span>
      <span id="lbWhat">Kobler til ${esc(ip)}</span>
      <button id="cancelLoad" class="btn">Avbryt</button></div>
    <div class="prog"><div class="prog-fill" id="lbFill" style="width:0%"></div>
      <div class="prog-fill2" id="lbFill2" style="width:0%"></div></div>
    <div class="loadbox-meta" id="lbMeta">venter på svar fra enheten…</div>
    <div id="lbIdent"></div>
    <div id="lbTypes"></div>
  </div>
  <div class="skjelett" aria-hidden="true">${skjelettRader(12)}</div>`;
}

/* Formen paa tabellen som er paa vei. Lasteboksen sier hvor langt det er
   kommet; denne sier hva som kommer. */
function skjelettRader(n) {
  if (bevegelseAv()) return '';
  let ut = '';
  for (let i = 0; i < n; i++) {
    // Litt ulik bredde per rad, ellers ser blokka ut som et rutenett og ikke
    // som tekst.
    const nb = 58 + ((i * 37) % 34);
    const db = 46 + ((i * 53) % 44);
    ut += `<div class="skjelett-rad">
      <span class="skjelett-felt sk-obj"></span>
      <span class="skjelett-felt sk-navn" style="width:${nb}%"></span>
      <span class="skjelett-felt sk-verdi"></span>
      <span class="skjelett-felt sk-desc" style="width:${db}%"></span>
    </div>`;
  }
  return ut;
}

function loadingView(ip, done, total, phase, counts, identity) {
  const wrap = $('pointsWrap');
  let boks = $('loadbox');
  if (!boks) {
    wrap.innerHTML = loadingSkall(ip);
    boks = $('loadbox');
    LAST_PCT = 0;
    $('lbFill').style.width = '0%';
    $('lbFill2').style.width = '0%';
  }

  /* Each pass gets its own bar, the way the device card does - the overall
     percentage is still what the text says, but a single bar could not show
     that the second sweep had started. */
  const pct = Math.max(LAST_PCT, samletPct(done, total, phase));
  LAST_PCT = pct;
  const gruppe = FASE_GRUPPE[phase] || 1;
  const egen = total ? (done / total) * 100 : 0;
  $('lbFill').style.width = (gruppe === 2 ? 100 : egen).toFixed(1) + '%';
  $('lbFill2').style.width = (gruppe === 2 ? egen : 0).toFixed(1) + '%';

  const hva = `${FASE_TEKST[phase] || 'Kobler til'} ${ip}`;
  const w = $('lbWhat');
  if (w.textContent !== hva) w.textContent = hva;

  const meta = total ? `${done} av ${total} objekter · ${Math.round(pct)}%`
                     : 'venter på svar fra enheten…';
  const m = $('lbMeta');
  if (m.textContent !== meta) m.textContent = meta;

  if (identity && Object.keys(identity).length) {
    const html = '<div class="load-ident">' + Object.entries(IDENT_LABELS)
      .filter(([k]) => identity[k])
      .map(([k, label]) => `<span><b>${label}</b> ${esc(String(identity[k]))}</span>`)
      .join('') + '</div>';
    const el = $('lbIdent');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  if (counts && Object.keys(counts).length) {
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    const rader = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const html = `<div class="load-types"><div class="load-types-sum">${sum} objekter</div>` +
      rader.map(([t, n]) => `<span class="lt"><span class="type-tag ${
        TYPE_CLASS[t] || ''}">${esc(shortType(t))}</span><b>${n}</b></span>`).join('') + '</div>';
    const el = $('lbTypes');
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}
let LAST_PCT = 0;

/* Hvilket enhetsvalg som gjelder akkurat naa.

   selectDevice er async og bruker titalls sekunder over VPN. Uten en vakt
   kunne to kjoeringer vaere i lufta samtidig: klikket du enhet B mens A leste,
   fortsatte A - og naar A ble ferdig skrev den sine punkter inn i S.points
   selv om du forlengst sto paa B. Tabellen viste da punktene til en annen
   regulator enn den lista sa var valgt.

   Hver kjoering tar et nummer. Alt som roerer felles tilstand - lasteboksen,
   statuslinja, tabellen - spoer foerst om det fortsatt er DENS tur. Det som
   IKKE spoer er hurtiglageret: lesinga ble faktisk fullfoert, og de punktene
   er like gyldige om et halvt minutt. */
let VALG_GEN = 0;

async function selectDevice(ip, opts = {}) {
  const dev = S.devices.find(d => d.address === ip);
  if (!dev) return;

  /* Er en annen enhet allerede i ferd med aa lastes, avbrytes den foerst.
     To lesinger mot samme BACnet-socket kravler begge - koden advarer allerede
     mot nettopp det for skann, og det gjelder like mye her. */
  if (S.job) {
    try { await cancelJob(); } catch (e) { /* jobben kan alt vaere ferdig */ }
  }
  const min = ++VALG_GEN;
  const gjelder = () => min === VALG_GEN;

  // The context bar restages itself when the device behind it changes, so the
  // switch is something you see rather than something you notice afterwards.
  if (S.activeDev && S.activeDev.address !== ip) S._ctxBytte = true;

  // Points already read this session are reused. Re-reading a controller
  // takes tens of seconds over a VPN, and nothing about it has changed since
  // a minute ago - live values are refreshed by polling anyway.
  const cached = S.cache[ip];
  if (cached && cached.length && !opts.force) {
    S.activeDev = dev;
    S.selected = null; S.detail = null; S.sel.clear();
    S.points = cached;
    S.pointIndex = new Map(cached.map(p => [p.objid, p]));
    S.namePrefix = commonNamePrefix(cached);
    S.typeCounts = S.cacheMeta[ip] ? S.cacheMeta[ip].type_counts : {};
    S.totalObjects = S.cacheMeta[ip] ? S.cacheMeta[ip].total_objects : cached.length;
    fillTypeFilter(S.typeCounts);
    renderDevices(); renderCtx(); renderPoints(); renderInspector();
    $('sbDev').textContent = dev.device_instance;
    $('sbPts').textContent = cached.length;
    ['pollBtn', 'expBtn', 'reloadBtn'].forEach(i => $(i).disabled = false);
    const alder = valuesAge(ip);
    status(`${cached.length} punkter fra hurtiglager · lest ${alder === null ? '?' : ageText(alder)}` + ` · trykk ⟳ for å lese på nytt`);
    markFreshness();
    return;
  }

  // If a background read of this very device is already in flight, take it
  // over rather than cancelling it and reading the same controller twice.
  // Clicking the device the prefetch reached first is the common case.
  //
  // The other background reads are deliberately left running: they are
  // against different controllers, and measured to cost this load nothing.
  // prefetchTick will not start any new ones while this job is open.
  // A background read claims its slot with a null placeholder before it has
  // a job id back from the server. Landing in that window means there is
  // nothing to adopt yet - but the claim must still be released, because
  // prefetchOne treats a missing claim as "cancel what I just started".
  // Without that, the click started a second read of the same controller
  // and the background one kept running alongside it.
  const reservert = PRE.jobs.has(ip);
  const adoptJob = PRE.jobs.get(ip) || null;
  if (reservert) PRE.jobs.delete(ip);
  S.activeDev = dev;   // set before any await, so prefetchTick sees it

  // A thorough sweep runs for minutes. If it is still going when the user
  // picks a device, both fight over the same BACnet socket and the load
  // crawls or times out - which looked like "the points never appear".
  // Clicking a device says the scan has served its purpose.
  if (S.scanJob) {
    status('Stopper skannet…');
    await cancelScan();
    // Cancelling the job does not recall probes already in flight; they hold
    // the socket until their own timeouts expire. Give them a moment to
    // drain, or the load that follows competes with them and crawls.
    await new Promise(r => setTimeout(r, 4500));
    status('Skann stoppet — laster enheten');
  }
  S.selected = null; S.detail = null;
  renderDevices(); renderInspector();
  const showLoading = (done, total, phase, handedOver, counts, identity) => {
    // En eldre lesing skal ikke tegne lasteboksen til en enhet du forlot.
    if (!gjelder()) return;
    // Once the table is up, the remaining pass reports itself in the status
    // bar. Replacing the table with a progress box again would be a step
    // backwards for the user.
    // The card keeps filling after the table is up: the later passes are real
    // work on the same device, and stopping the bar at 75 % would say the
    // opposite.
    /* Each pass reports its own 0 to 100 rather than a share of one overall
       number: the two bars are separate jobs, and the second one starting at
       75 % would read as the first having stalled. */
    kortFramdrift(ip, total ? (done / total) * 100 : 0, !total, phase);
    if (handedOver) { status(`Leser beskrivelser… ${done}/${total}`); return; }
    if (identity && Object.keys(identity).length) S.identity[ip] = identity;
    const fantes = !!$('loadbox');
    loadingView(ip, done, total, phase, counts, identity);
    // The cancel button only needs wiring the once the box is built.
    if (!fantes) {
      const cb = $('cancelLoad');
      if (cb) cb.onclick = cancelJob;
    }
  };
  showLoading(0, 0);
  status('Laster punkter…');
  const t0 = performance.now();

  // Used twice: once when the points arrive and the table can go up, and
  // again when the descriptions have filled in.
  const applyResult = (d) => {
    /* Hurtiglageret fylles uansett - lesinga ble fullfoert, og punktene er
       like gyldige selv om du gikk videre. Skjermen roeres bare hvis dette
       fortsatt er enheten du staar paa. */
    cachePoints(ip, d.points || []);
    S.cacheMeta[ip] = {type_counts: d.type_counts || {}, total_objects: d.total_objects || 0,
                       readAt: Date.now()};
    if (d.identity && Object.keys(d.identity).length) S.identity[ip] = d.identity;
    if (!gjelder()) { renderDevices(); return; }

    S.points = d.points || [];
    S.pointIndex = new Map(S.points.map(p => [p.objid, p]));
    S.namePrefix = commonNamePrefix(S.points);
    fillTypeFilter(d.type_counts);
    S.typeCounts = d.type_counts || {};
    S.totalObjects = d.total_objects || 0;
    renderDevices();   // the device now carries its point count
    renderCtx();
    renderPoints();
    renderInspector();
    markFreshness();
    $('sbDev').textContent = dev.device_instance;
    $('sbPts').textContent = S.points.length;
    ['pollBtn', 'expBtn', 'reloadBtn'].forEach(i => $(i).disabled = false);
  };

  /* Partial results exist so the table appears early, not so the row count
     ticks up live. The server publishes about eleven times during a load of
     this size, and a full table draw measured 520 ms for 2418 rows - so
     redrawing on every publish spent close to six seconds with the main
     thread blocked, in half-second freezes. That is what made the whole
     window stutter while loading.

     So: the first publish goes up immediately, because that is the one the
     user is waiting for. After that a redraw needs either a real jump in the
     row count or a couple of seconds since the last one. The status line
     still updates every time, which is cheap and keeps it honest. */
  let sistTegnet = 0;
  let sistAntall = 0;
  const onPartial = (partial) => {
    if (!gjelder()) return;
    const naa = performance.now();
    const forste = sistAntall === 0;
    const vokstMye = partial.count >= sistAntall * 1.5;
    const lengeSiden = naa - sistTegnet > 2000;
    if (forste || vokstMye || lengeSiden) {
      sistTegnet = naa;
      sistAntall = partial.count;
      applyResult(partial);
    } else {
      // Keep the data current even when the draw is skipped, so the final
      // render has everything and nothing is lost by waiting.
      S.points = partial.points || S.points;
      S.pointIndex = new Map(S.points.map(p => [p.objid, p]));
    }
    const secs = ((naa - t0) / 1000).toFixed(1);
    const igjen = partial.total_objects && partial.count < partial.total_objects;
    status(igjen ? `${partial.count} punkter · ${secs}s · leser fortsatt…`
                 : `${partial.count} punkter · ${secs}s · leser beskrivelser…`);
  };

  try {
    let d;
    if (adoptJob) {
      status('Fortsetter lastingen som allerede var i gang…');
      // It was started as background work and is still yielding to
      // foreground jobs; now it is the foreground job.
      await api('/api/job/' + adoptJob + '/promote');
      S.job = adoptJob;
      try { d = await pollJob(adoptJob, showLoading, onPartial); }
      finally { S.job = null; }
    } else {
      d = await runJob({address: ip, device_instance: dev.device_instance,
                        include_all_types: loadPrefs().allTypes === true},
                       showLoading, onPartial);
    }
    if (d && d.cancelled) {
      /* Avbrytelsen kan komme fordi DU trykket paa en annen enhet. Da skal
         ikke denne kjoringa legge en feilrute over den som lastes naa. */
      if (gjelder()) { feilVisning(ip, 'Lasting avbrutt', 'Ingenting er lest fra enheten.'); status(''); }
      return;
    }
    if (!d || d.status !== 'done') {
      /* En feilmelding uten vei videre er en blindvei. Regulatorer paa en
         site-VPN svarer ikke alltid foerste gang, og det aller vanligste
         neste steget er aa proeve om igjen - saa den knappen skal staa her,
         ikke i en meny. */
      if (gjelder()) {
        feilVisning(ip, 'Kunne ikke lese enheten', (d && d.error) || 'Ukjent feil');
        status('');
      }
      return;
    }
    applyResult(d);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const extra = (d.rpm === false ? ' · uten RPM' : '')
                + (d.unread ? ` · ${d.unread} uleste` : '');
    if (gjelder()) status(`${d.count} punkter av ${d.total_objects} objekter · ${secs}s${extra}`);
  } catch (e) {
    // Kastes det fordi lesinga ble avbrutt av et nytt valg, er det ikke en
    // feil brukeren skal se - da staar det alt en annen enhet og laster.
    if (gjelder()) {
      feilVisning(ip, 'Kunne ikke lese enheten', e.message);
      status('');
    }
  } finally {
    // Every way out of here - finished, cancelled, failed, thrown - clears the
    // bar, or a card sits at 60 % for the rest of the session.
    kortFerdig(ip);
  }
}

function fillTypeFilter(counts) {
  const present = {};
  S.points.forEach(p => present[p.type] = (present[p.type] || 0) + 1);
  const sel = $('typeSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle typer</option>' +
    Object.keys(present).sort().map(t =>
      `<option value="${t}">${t} (${present[t]})</option>`).join('');
  sel.value = cur;
}

/* ---------------------------------------------------------------- selection */
/* Keyed by ip|objid rather than objid alone so a selection made on one device
   is not silently reinterpreted as different points on the next. */
/* Every caller reaches these through a render, and renders happen from timers
   and the resize handler as well as from clicks — so they must not assume a
   device is selected. Without the guard, clearing the device while points were
   still in memory threw out of renderPoints and left a half-drawn table. */
function selKey(p) { return S.activeDev ? wkey(S.activeDev.address, p.objid) : ''; }
function isSel(p)  { const k = selKey(p); return !!k && S.sel.has(k); }

function toggleSel(objid) {
  const p = S.pointIndex.get(objid);
  if (!p) return;
  const k = selKey(p);
  S.sel.has(k) ? S.sel.delete(k) : S.sel.add(k);
  renderPoints();
}

/* Checked AND currently visible. Export acts on this, so "select all"
   followed by a filter change cannot silently export rows the user can no
   longer see. */
function selectedVisible() {
  return visiblePoints().filter(isSel);
}

/* What export/pin operate on: the selection if there is one, else everything
   currently filtered in. */
function actionRows() {
  const sel = selectedVisible();
  return sel.length ? sel : visiblePoints();
}

function toggleSelectAll() {
  const rows = visiblePoints();
  const allOn = rows.length > 0 && rows.every(isSel);
  rows.forEach(p => allOn ? S.sel.delete(selKey(p)) : S.sel.add(selKey(p)));
  renderPoints();
}

/* Shift-click extends from the last plainly-clicked row through the clicked
   one, over the rows as currently sorted and filtered. */
function selectRange(objid) {
  const rows = visiblePoints();
  const to = rows.findIndex(p => p.objid === objid);
  if (to < 0) return;
  let from = rows.findIndex(p => p.objid === S.selAnchor);
  if (from < 0) from = to;
  const [a, b] = from <= to ? [from, to] : [to, from];
  for (let i = a; i <= b; i++) S.sel.add(selKey(rows[i]));
  renderPoints();
}

function clearSel() { S.sel.clear(); renderPoints(); }

function renderSelBar() {
  const rows = selectedVisible();
  const n = rows.length;
  const bar = $('selBar');
  if (!bar) return;
  if (!n) { bar.hidden = true; return; }
  bar.hidden = false;
  $('selCount').textContent = n + ' valgt';

  // Releasing only makes sense for commandable objects, and never in read-only
  // mode. Both controls hide together so the bar does not offer an action that
  // would only be refused.
  const skrivbare = rows.filter(p => p.writable).length;
  const vis = skrivbare > 0 && !S.readOnly;
  const sel = $('selPri'), btn = $('selRel');
  if (!sel.options.length) {
    sel.innerHTML = [...Array(16)].map((_, i) =>
      `<option value="${i + 1}"${i + 1 === 8 ? ' selected' : ''}>pri ${i + 1}</option>`).join('');
  }
  sel.hidden = !vis; btn.hidden = !vis;
  btn.textContent = skrivbare === n ? '⏏ Frigi' : `⏏ Frigi ${skrivbare}`;
}

/* Handing control back after a test is the step that gets forgotten, and
   doing it one point at a time is how a plant is left commanded. The writes
   go out one after another rather than in parallel: the controller is the
   bottleneck anyway, the write log then reads in the order things happened,
   and a failure part-way names exactly which points were already released. */
async function releaseSelected() {
  const rows = selectedVisible().filter(p => p.writable);
  if (!rows.length) { toast('Ingen skrivbare punkter valgt', true); return; }
  if (S.readOnly) { toast('Lesemodus er på — skriving er blokkert', true); return; }
  const pri = parseInt($('selPri').value, 10);
  const NL = String.fromCharCode(10);
  const vis = rows.slice(0, 8).map(p => '  · ' + (p.name || p.objid)).join(NL)
            + (rows.length > 8 ? NL + `  … og ${rows.length - 8} til` : '');
  const msg = `Frigi prioritet ${pri} på ${rows.length} punkter` + NL + NL
            + S.activeDev.address + NL + vis + NL + NL
            + 'Punktene faller tilbake til anleggets egen styring.' + NL
            + 'Dette endrer et anlegg i drift. Fortsette?';
  if (!confirm(msg)) return;

  const btn = $('selRel');
  btn.disabled = true;
  let ok = 0; const feil = [];
  try {
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      status(`Frigir ${i + 1} av ${rows.length}…`);
      try {
        const r = await api('/api/write', {address: S.activeDev.address, objid: p.objid,
                                           value: null, priority: pri, release: true});
        if (r.status === 'done') ok++;
        else feil.push((p.name || p.objid) + ': ' + (r.error || 'feilet'));
      } catch (e) {
        feil.push((p.name || p.objid) + ': ' + e.message);
      }
    }
  } finally {
    btn.disabled = false;
  }
  // Samme signal som en enkeltskriving: regulatoren fikk noe.
  if (ok && S.activeDev && !bevegelseAv()) {
    slaaPaaNytt(document.querySelector(
      `.dev[data-ip="${CSS.escape(S.activeDev.address)}"]`), 'mottok', 1040);
  }
  status(`${ok} av ${rows.length} frigitt på prioritet ${pri}`);
  toast(feil.length ? `${ok} frigitt · ${feil.length} feilet — se skriveloggen`
                    : `${ok} punkter frigitt på prioritet ${pri}`, feil.length > 0);
  await refreshMany(rows.map(p => p.objid));
}

async function refreshMany(objids) {
  if (!S.activeDev || !objids.length) return;
  const d = await api('/api/poll', {targets: {[S.activeDev.address]: objids}});
  const v = d.values && d.values[S.activeDev.address];
  if (!v) return;
  for (const [objid, val] of Object.entries(v)) {
    const p = S.pointIndex.get(objid);
    if (p) p.value = val;
  }
  renderPoints(); renderInspector();
}

function pinSelected() {
  const rows = selectedVisible();
  if (!rows.length) { toast('Ingen punkter valgt', true); return; }
  let added = 0;
  rows.forEach(p => {
    if (S.watch.some(w => w.ip === S.activeDev.address && w.objid === p.objid)) return;
    S.watch.push({ip: S.activeDev.address, objid: p.objid,
                  name: p.name || p.objid, unit: p.unit_symbol || '',
                  hist: [], value: p.value});
    added++;
  });
  // Ett fly per punkt blir et snoedrev naar man fester tjue; de tre foerste
  // sier hvor det bar, og resten teller toasten.
  rows.slice(0, 3).forEach((p, i) =>
    setTimeout(() => festFly(p.objid, p.name || p.objid), i * 70));
  renderWatch(); renderPoints();
  toast(added ? added + ' punkt(er) festet' : 'Alle var allerede festet');
}

/* Merker radene som faktisk ble kopiert. */
function merkKopiert(rows) {
  if (bevegelseAv() || !S.rowIndex) return;
  rows.forEach((p, i) => {
    const tr = S.rowIndex.get(p.objid);
    if (!tr) return;
    // Ovenfra og ned, men taket holder det under et halvt sekund selv om du
    // kopierer to tusen rader.
    setTimeout(() => slaaPaaNytt(tr, 'kopiert', 850), Math.min(i * 12, 420));
  });
}

function copySelected() {
  const rows = actionRows();
  const TAB = String.fromCharCode(9);
  const NL = String.fromCharCode(10);
  const head = ['objekt', 'navn', 'verdi', 'tilstandstekst', 'enhet', 'beskrivelse'].join(TAB);
  const body = rows.map(p => [p.objid, p.name || '', p.value ?? '', stateTextFor(p),
                              p.unit_symbol || '', p.description || ''].join(TAB));
  navigator.clipboard.writeText([head].concat(body).join(NL))
    .then(() => { merkKopiert(rows); toast(rows.length + ' rader kopiert - lim inn i Excel'); })
    .catch(() => toast('Kunne ikke kopiere', true));
}

/* ------------------------------------------------------------ context bar */
/* Model and firmware read once during the load and kept: the sort of thing
   you need when a controller misbehaves and someone asks what is actually
   installed. Hover gives the rest, including where it says it sits. */
function identBadge(ip) {
  const id = S.identity[ip];
  if (!id) return '';
  const kort = [id['model-name'], id['firmware-revision']].filter(Boolean).join(' · ');
  if (!kort) return '';
  const full = Object.entries(IDENT_LABELS)
    .filter(([k]) => id[k])
    .map(([k, label]) => `${label}: ${id[k]}`)
    .join(String.fromCharCode(10));
  return `<span class="ctx-ident" title="${esc(full)}">${esc(kort)}</span>`;
}

function clockBadge(ip) {
  const sek = clockDrift(ip);
  if (sek === null || Math.abs(sek) < CLOCK_WARN) return '';
  const id = S.identity[ip] || {};
  const alvorlig = Math.abs(sek) > CLOCK_SEVERE;
  return `<span class="ctx-stat ${alvorlig ? 'bad' : 'warn'}" title="Enheten sier ${
    esc(String(id['device-time'] || '?'))} — ukeprogram og trendlogger følger denne klokka">⏱ klokke ${
    esc(driftText(sek, id['device-time']))}</span>`;
}

function renderCtx() {
  const el = $('ctxBar');
  if (S._ctxBytte) {
    S._ctxBytte = false;
    // Restart the animation: removing the class and forcing one layout is
    // what makes it run again on a second switch.
    el.classList.remove('byttet');
    void el.offsetWidth;
    if (!bevegelseAv()) el.classList.add('byttet');
  }
  const d = S.activeDev;
  if (!d) {
    el.style.removeProperty('--vc');
    el.innerHTML = '<span class="ctx-empty">Ingen enhet valgt</span>';
    return;
  }
  const v = vendorOf(d.vendor_name, d.vendor_id);
  const flagg = flagCounts(S.points);
  const writable = S.points.filter(p => p.writable).length;
  el.style.setProperty('--vc', v.color);
  el.innerHTML = `
    <span class="ctx-id">${d.device_instance ?? '?'}</span>
    <span class="vendor" style="--vc:${v.color};flex:0 0 auto"><i></i><span>${esc(v.label)}</span></span>
    <span class="ctx-name">${esc(d.object_name || '')}</span>
    <span class="ctx-ip">${esc(d.address)}</span>
    ${identBadge(d.address)}
    ${clockBadge(d.address)}
    ${(S.namePrefix && loadPrefs().shortNames !== false) ? `<span class="ctx-prefix" title="Alle punktnavn på denne enheten starter med dette. Det er utelatt fra tabellen for lesbarhet — hold over et navn for å se det fullt ut.">${esc(S.namePrefix)}…</span>` : ''}
    <div class="spacer"></div>
    ${Object.entries(FLAGS).filter(([f]) => flagg[f]).map(([f, m]) =>
      `<button class="ctx-stat ${m.cls}" data-flag="${f}" title="Vis kun punkter ${esc(m.label)}">${flagg[f]} ${esc(m.label)}</button>`).join('')}
    <span class="ctx-stat">${writable} skrivbare</span>
    <span class="ctx-stat">${S.points.length} punkter</span>`;

  // Clicking a count filters to it; clicking the one already active clears it,
  // so the same button gets you back out.
  el.querySelectorAll('[data-flag]').forEach(b => b.onclick = () => {
    const f = b.dataset.flag;
    settFlaggfilter(S.filters.flag === f ? '' : f);
    S.filters.q = ''; $('q').value = '';
  });
}

/* One place for "the flag filter changed", because asking who is holding a
   point only makes sense once you have asked to see the held ones - and the
   filter can be set from the counts, the menu and the command palette. */
function settFlaggfilter(f) {
  S.filters.flag = f;
  renderPoints();
  syncMenuStates();
  if (f === 'overridden' || f === 'out-of-service') hentTvungne();
}

/* Reusing points from the cache is what makes revisiting a device instant,
   but a value read twenty minutes ago looks exactly like one read now. On a
   plant in operation that is worse than showing nothing, so the age is stated
   and stale values are dimmed until a poll refreshes them. */
const FRESH_SECONDS = 60;

function valuesAge(ip) {
  const m = S.cacheMeta[ip];
  if (!m || !m.readAt) return null;
  return (Date.now() - m.readAt) / 1000;
}

function ageText(sek) {
  if (sek < 60) return 'nå nettopp';
  if (sek < 5400) return `${Math.round(sek / 60)} min siden`;
  return `${(sek / 3600).toFixed(1)} t siden`;
}

/* Live polling rewrites the visible values, so while it runs they are current
   whatever the cache timestamp says. */
function markFreshness() {
  const ip = S.activeDev && S.activeDev.address;
  const sek = ip ? valuesAge(ip) : null;
  const gammel = !S.live && sek !== null && sek > FRESH_SECONDS;
  document.body.classList.toggle('stale-values', !!gammel);
  const el = $('sbLive');
  if (!el) return;
  const base = S.live ? el.dataset.live || 'Live på' : 'Live av';
  el.textContent = gammel ? `${base} · verdier ${ageText(sek)}` : base;
  el.classList.toggle('stale', !!gammel);
}

/* BACnet status-flags are four different things, and lumping them together
   was actively misleading: on one controller 96 points were reported as "in
   alarm" when the truth was 77 in fault and 19 overridden, and none in alarm
   at all. Overridden in particular is what you are looking for when handing a
   plant back - it says someone has taken manual control of that point. */
const FLAGS = {
  'in-alarm':      {label: 'i alarm',      kort: 'alarm',    cls: 'bad'},
  'fault':         {label: 'med feil',     kort: 'feil',     cls: 'bad'},
  'overridden':    {label: 'overstyrte',   kort: 'overstyrt', cls: 'warn'},
  'out-of-service':{label: 'ute av drift', kort: 'ute av drift', cls: 'warn'},
};
const hasFlag = (p, f) => !!(p.status && p.status.includes(f));

function flagCounts(points) {
  const out = {};
  for (const p of points) {
    if (!p.status) continue;
    for (const f of p.status) if (FLAGS[f]) out[f] = (out[f] || 0) + 1;
  }
  return out;
}

/* Every point on a controller carries the controller's own name as the first
   segment of its own: 1421 points, 1421 copies of "563001-1OS001/", a quarter
   of every name spent on something the device list already tells you. Worse,
   text-overflow trims the tail — and the tail ("AI-4", "AV-256") is the only
   part that differs.

   So leading segments that are identical across every point are dropped from
   the rows and stated once above the table. The full name is still on the row
   as a tooltip, in the inspector, and in every export. */
function commonNamePrefix(points) {
  const navn = points.map(p => p.name).filter(Boolean);
  if (navn.length < 2) return '';
  let pre = navn[0];
  for (const n of navn) {
    let i = 0;
    while (i < pre.length && i < n.length && pre[i] === n[i]) i++;
    pre = pre.slice(0, i);
    if (!pre) return '';
  }
  // Only cut at a separator: trimming mid-token ("563001-1OS0") would be
  // worse than not trimming at all.
  const kutt = Math.max(pre.lastIndexOf('/'), pre.lastIndexOf('.'));
  if (kutt < 2) return '';
  return pre.slice(0, kutt + 1);
}

function shortName(p) {
  const n = p.name || '';
  if (loadPrefs().shortNames === false) return n;
  return (S.namePrefix && n.startsWith(S.namePrefix)) ? n.slice(S.namePrefix.length) : n;
}

/* "Ingen treff" is the same sentence whether you mistyped a search or the
   plant simply has nothing in alarm — and those deserve different reactions.
   Say which filter came up empty, and offer the way back out. */
function emptyResultView() {
  const f = S.filters;
  const aktive = [];
  if (f.flag) aktive.push(FLAGS[f.flag].label);
  if (f.writable) aktive.push('skrivbare');
  if (f.diff) aktive.push('endret siden snapshot');
  if (f.type) aktive.push(f.type);

  let tittel, hjelp = '';
  if (f.q.trim() && !aktive.length) {
    tittel = `Ingen punkter matcher «${esc(f.q.trim())}»`;
    hjelp = 'Søket dekker navn, beskrivelse og objekt-ID på denne enheten. '
          + 'Flere ord må alle treffe, uansett rekkefølge — «360.001 RT601» '
          + 'finner punkter som inneholder begge. Sett minus foran et ord for '
          + 'å utelate det. Trykk Ctrl+F for å søke i alle leste enheter.';
  } else if (aktive.length && !f.q.trim()) {
    tittel = aktive.length === 1 && f.flag
      ? `Ingen punkter ${esc(FLAGS[f.flag].label)} på denne enheten`
      : `Ingen punkter igjen etter filteret (${esc(aktive.join(' + '))})`;
  } else if (aktive.length) {
    tittel = `Ingen treff på «${esc(f.q.trim())}» blant ${esc(aktive.join(' + '))}`;
  } else {
    tittel = 'Ingen treff';
  }
  const knapp = (f.q.trim() || aktive.length)
    ? '<button class="btn" id="emptyClear" style="margin-top:12px">Nullstill filter</button>' : '';
  return `<div class="empty"><div style="color:var(--fg-2)">${tittel}</div>${
    hjelp ? `<div style="margin-top:7px;font-size:11px;line-height:1.6">${hjelp}</div>` : ''}${knapp}</div>`;
}

/* ------------------------------------------------------- continuous rescan */
/* On a link that drops in and out, a single sweep is a snapshot of luck: the
   same plant answered with 13 devices one minute and 20 the next during
   testing. So the range is swept again in the background and the results are
   merged rather than replaced - a device that answered once is never dropped
   from the list, only marked as not answering now.

   What you end up with is the union of everything seen, plus an honest record
   of how reliably each one answers. On a good network nothing changes and the
   loop costs one sweep every few minutes; on a bad one it is the difference
   between guessing and knowing. */
const RESCAN = {on: false, timer: null, running: false, runs: 0, last: 0};
const RESCAN_HISTORY = 10;        // how many sweeps the presence record keeps

function rescanIntervalMs() {
  return Math.max(60, parseInt(loadPrefs().rescanSec, 10) || 180) * 1000;
}

function noteSeen(ip, sett) {
  const d = S.devices.find(x => x.address === ip);
  if (!d) return;
  d._seen = (d._seen || []).concat(sett ? 1 : 0).slice(-RESCAN_HISTORY);
  if (sett) d._lastSeen = Date.now();
}

/* "Answered 7 of the last 10" says something a green dot cannot. */
function presence(d) {
  const h = d._seen || [];
  if (h.length < 2) return null;
  return {svar: h.reduce((a, b) => a + b, 0), av: h.length, naa: h[h.length - 1] === 1};
}

async function rescanOnce(manuell) {
  if (RESCAN.running || S.job || S.scanJob) return;
  const omraader = parseRanges($('rangeInput').value);
  if (!omraader.length || !S.connected) return;
  RESCAN.running = true;
  try {
    // Every range is covered, or a device on the second subnet would be
    // reported as missing on every round simply because nobody looked.
    const funnet = new Set();
    for (const subnet of omraader) {
      const started = await api('/api/scan', {
        subnet, mode: 'unicast_sweep', per_host_timeout: 0.6, concurrency: 40, thorough: false});
      if (started.status !== 'started') continue;
      let res = null;
      for (let i = 0; i < 400; i++) {
        await new Promise(r => setTimeout(r, 500));
        const j = await (await fetch('/api/job/' + started.job_id)).json();
        if (j.status !== 'running') { res = j.result; break; }
        // A foreground load started while we were sweeping: it wins.
        if (S.job) { api('/api/job/' + started.job_id + '/cancel').catch(() => {}); return; }
      }
      if (!res || res.status !== 'done') continue;
      for (const d of res.devices || []) {
        funnet.add(d.address);
        if (!S.devices.some(x => x.address === d.address)) {
          // Something new answered - keep whatever the scan learned about it.
          // Same flag the scan uses, so a controller that turns up while the
          // network is being watched arrives the way every other one does
          // rather than simply being there on the next redraw.
          S.devices.push(Object.assign({}, d, {_range: subnet, _seen: [], _ny: true}));
        }
      }
    }
    for (const d of S.devices) noteSeen(d.address, funnet.has(d.address));

    RESCAN.runs++; RESCAN.last = Date.now();
    renderDevices(); renderRescanStatus();
    if (manuell) {
      const borte = S.devices.filter(d => { const p = presence(d); return p && !p.naa; }).length;
      toast(`${funnet.size} av ${S.devices.length} svarte` + (borte ? ` · ${borte} svarte ikke` : ''));
    }
  } catch (e) {
    if (manuell) toast('Skann feilet: ' + e.message, true);
  } finally {
    RESCAN.running = false;
  }
}

function rescanStart() {
  rescanStop();
  RESCAN.on = true;
  RESCAN.timer = setInterval(() => rescanOnce(false), rescanIntervalMs());
  savePrefs({rescan: true});
  renderRescanStatus(); syncMenuStates();
  rescanOnce(false);
}
function rescanStop() {
  RESCAN.on = false;
  if (RESCAN.timer) clearInterval(RESCAN.timer);
  RESCAN.timer = null;
  savePrefs({rescan: false});
  renderRescanStatus(); syncMenuStates();
}

function renderRescanStatus() {
  const el = $('sbRescan');
  if (!el) return;
  if (!RESCAN.on) { el.hidden = true; return; }
  const borte = S.devices.filter(d => { const p = presence(d); return p && !p.naa; }).length;
  const html = `overvåker · ${RESCAN.runs} runder` + (borte ? ` · <b>${borte}</b> svarer ikke` : '');
  el.hidden = false;
  el.classList.toggle('stale', borte > 0);
  if (el.innerHTML !== html) el.innerHTML = html;
}

/* ------------------------------------------------------------------ notes */
/* What you noticed at ten in the morning, still there when you write the
   report at four - and when a colleague opens the same site next month.
   Stored on the server, so it survives a cleared cache, a new laptop and a
   restart of anything.

   Keyed on address and instance together: a note belongs to one controller,
   and on a plant network both are fixed. If a device is re-addressed the note
   does not follow it, which is honest - it would be worse to attach a note to
   whatever answers on that IP next. */
function noteKey(d) {
  if (!d) return '';
  return d.address + '|' + (d.device_instance == null ? '?' : d.device_instance);
}
function noteFor(d) {
  const n = S.notes[noteKey(d)];
  return n ? n.text : '';
}

async function lastNotater() {
  try {
    const d = await (await fetch('/api/notes')).json();
    if (d.status === 'done') {
      S.notes = d.notes || {};
      S.noteSync = d.sync || null;
      S.noteUpstream = d.upstream || '';
      renderDevices();
    }
  } catch { /* uten notater fungerer alt annet som før */ }
}

async function lagreNotat(dev, tekst) {
  const key = noteKey(dev);
  if (!key) return;
  const d = await api('/api/notes', {key, text: tekst});
  if (d.status !== 'done') { toast(d.error || 'Kunne ikke lagre notatet', true); return false; }
  S.notes = d.notes || {};
  S.noteSync = d.sync || null;
  renderDevices();
  return true;
}

/* Whether the note reached the shared server is not a detail the writer can
   be left guessing about: a note that only exists on one laptop is the exact
   failure this feature is meant to prevent. */
function noteSyncTekst() {
  if (!S.noteUpstream) return '';
  const s = S.noteSync || {};
  if (s.state === 'ok') return 'delt med fellesserveren';
  if (s.state === 'ikke delt') return 'lagret her, men ikke delt — fellesserveren svarte ikke';
  if (s.state === 'frakoblet') return 'lagret her · fellesserveren er ikke tilgjengelig';
  return 'lagret her';
}

/* ------------------------------------------------------------ dialog focus */
/* Tab used to walk straight out of an open dialog and into the controls
   behind it, which for a keyboard user means losing the dialog without
   closing it. Focus is kept inside while one is open, and handed back to
   whatever opened it on the way out. */
let FOKUS_FOER_DIALOG = null;
let SISTE_FOKUS_UTENFOR = null;

/* Recorded as it happens rather than when a dialog opens: by then the dialog
   has already moved focus to itself, and we would be remembering the dialog
   instead of the field the user came from. */
document.addEventListener('focusin', e => {
  if (!e.target.closest || !e.target.closest('[role="dialog"]')) {
    SISTE_FOKUS_UTENFOR = e.target;
  }
}, true);

function dialogElementer(d) {
  return [...d.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(e => !e.disabled && e.offsetWidth > 0 && e.offsetHeight > 0);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const d = [...document.querySelectorAll('[role="dialog"]')].find(x => !x.hidden);
  if (!d) return;
  const felt = dialogElementer(d);
  if (!felt.length) return;
  const forste = felt[0], siste = felt[felt.length - 1];
  if (e.shiftKey && document.activeElement === forste) { e.preventDefault(); siste.focus(); }
  else if (!e.shiftKey && document.activeElement === siste) { e.preventDefault(); forste.focus(); }
  else if (!d.contains(document.activeElement)) { e.preventDefault(); forste.focus(); }
}, true);

// Remembers where focus was so closing a dialog does not dump the user at the
// top of the page.
new MutationObserver(muts => {
  for (const m of muts) {
    const d = m.target;
    if (!d.matches || !d.matches('[role="dialog"]')) continue;
    if (!d.hidden) {
      FOKUS_FOER_DIALOG = FOKUS_FOER_DIALOG || SISTE_FOKUS_UTENFOR || document.activeElement;
      const f = dialogElementer(d);
      if (f.length && !d.contains(document.activeElement)) f[0].focus();
    } else if (FOKUS_FOER_DIALOG) {
      const aapen = [...document.querySelectorAll('[role="dialog"]')].some(x => !x.hidden);
      if (!aapen) {
        try { FOKUS_FOER_DIALOG.focus(); } catch {}
        FOKUS_FOER_DIALOG = null;
      }
    }
  }
}).observe(document.body, {attributes: true, attributeFilter: ['hidden'], subtree: true});

/* Clicking the dark area outside a dialog closes it. Every other tool on a
   technician's screen behaves this way, and without it the only way out is a
   button in one corner - which is exactly the complaint. Escape already
   worked; this is the same escape hatch for the mouse. */
const DIALOG_LUKK = {
  schOverlay: () => closeSchedules(),
  temaOverlay: () => closeTema(),
  minneOverlay: () => closeMinne(),
  edeOverlay: () => closeEde(),
  prjOverlay: () => closeProjects(),
  cmdOverlay: () => closeCmd(),
  colsOverlay: () => closeCols(),
  gsOverlay: () => closeGlobal(),
  zoomOverlay: () => closeZoom(),
};
Object.entries(DIALOG_LUKK).forEach(([id, lukk]) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('mousedown', e => {
    // Only a press that both starts and ends on the backdrop counts, so a
    // drag that began inside the dialog does not dismiss it.
    if (e.target !== el) return;
    const opp = ev => {
      document.removeEventListener('mouseup', opp, true);
      if (ev.target === el) lukk();
    };
    document.addEventListener('mouseup', opp, true);
  });
});

/* -------------------------------------------------------------- bilder */
/* Images live under their own storage key, never in the preferences.

   localStorage gives an origin a handful of megabytes, and a write that goes
   over throws. savePrefs swallows that exception - so a background image put
   in the same object would not merely fail to save: it would take the range
   you scan, your column layout and every colour with it, silently. Separate
   keys mean a picture too large can only ever lose the picture. */
const BILDE_KEY = 'nm-bacnet-bilder';
const BILDE_MAKS = {bg: [1920, 1200], logo: [96, 96], banner: [1600, 120]};

function lastBilder() {
  try { return JSON.parse(localStorage.getItem(BILDE_KEY)) || {}; } catch { return {}; }
}
function lagreBilde(navn, dataUri) {
  const b = lastBilder();
  if (dataUri) b[navn] = dataUri; else delete b[navn];
  try {
    localStorage.setItem(BILDE_KEY, JSON.stringify(b));
    return true;
  } catch {
    toast('Bildet er for stort til å lagres — prøv et mindre', true);
    return false;
  }
}

/* Scale down before storing. A phone photo is several megabytes of base64,
   which is most of the quota for a picture nobody will look at closely. */
function skalerBilde(fil, maks) {
  return new Promise((ok, nei) => {
    const les = new FileReader();
    les.onerror = () => nei(new Error('kunne ikke lese filen'));
    les.onload = () => {
      const img = new Image();
      img.onerror = () => nei(new Error('ikke et bilde'));
      img.onload = () => {
        const [mw, mh] = maks;
        const f = Math.min(1, mw / img.width, mh / img.height);
        const w = Math.round(img.width * f), h = Math.round(img.height * f);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        // PNG for anything small enough to have sharp edges (a logo), JPEG
        // for photographs - a photo as PNG is several times the size.
        const stor = w * h > 90000;
        ok(c.toDataURL(stor ? 'image/jpeg' : 'image/png', 0.82));
      };
      img.src = les.result;
    };
    les.readAsDataURL(fil);
  });
}

/* Take an image from wherever it comes: the picker, a drag onto the row, or
   the clipboard. The picker alone was the whole story, and a file input that
   is never put in the document is exactly the case browsers have been
   tightening up on - it stayed silent instead of opening. It is attached now,
   and it is no longer the only way in: dropping a file on the row or pasting a
   screenshot both work, which is how anyone actually has an image to hand. */
async function taImot(navn, fil, etterpaa) {
  if (!fil) return;
  if (!/^image\//.test(fil.type || '')) {
    toast('Det er ikke et bilde', true);
    return;
  }
  try {
    const uri = await skalerBilde(fil, BILDE_MAKS[navn] || [1200, 1200]);
    const kb = Math.round(uri.length * 0.75 / 1024);
    if (navn === 'bg') savePrefs({bgSnitt: await snittFarge(uri)});
    if (lagreBilde(navn, uri)) {
      brukTema();
      if (etterpaa) etterpaa();
      toast(`Bilde lagt inn (${kb} kB)`);
    }
  } catch (e) {
    toast('Kunne ikke lese bildet: ' + e.message, true);
  }
}

function velgBilde(navn, etterpaa) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  // Attached and hidden: a detached input is the version that quietly does
  // nothing in current Chrome.
  inp.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
  document.body.appendChild(inp);
  const rydd = () => { try { inp.remove(); } catch {} };
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    rydd();
    if (!f) return;
    await taImot(navn, f, etterpaa);
  };
  // If the dialog is dismissed without picking, the element still has to go.
  window.addEventListener('focus', () => setTimeout(rydd, 2000), {once: true});
  if (typeof inp.showPicker === 'function') {
    try { inp.showPicker(); return; } catch { /* faller tilbake under */ }
  }
  inp.click();
}

function lesbarhetRad(p) {
  const k = lesbarhet(p);
  const tall = k.toFixed(1).replace('.', ',');
  if (k >= 4.5) {
    return `<div class="tema-hjelp">Tekst mot bakgrunn: <b>${tall}:1</b> \u2014 lesbar</div>`;
  }
  return `<div class="tema-advarsel">
    Tekst mot bakgrunn: <b>${tall}:1</b>. Under 4,5:1 blir punktlista tung å lese.
    <button class="btn" id="temaFiks">Fiks lesbarheten</button></div>`;
}

/* Whether the text still reads over the picture.

   The old warning guessed from two slider positions: a lot of transparency
   plus little dimming, therefore probably bad. But a dark photograph at 60 %
   is perfectly readable and a bright one at 20 % is not - the picture decides,
   and the picture is right here to be measured. So the layers are composed the
   way the browser composes them (image over background, scrim over that,
   surface over that) and the real ratio comes out the far end.

   Measured with the whole stack at their current settings, this is the number
   that decides whether a technician can read the point list at all. */
function snittFarge(dataUri) {
  return new Promise(ok => {
    const img = new Image();
    img.onerror = () => ok(null);
    img.onload = () => {
      const c = document.createElement('canvas');
      // 16x16 is enough for an average and costs nothing.
      c.width = 16; c.height = 16;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 16, 16);
      try {
        const d = g.getImageData(0, 0, 16, 16).data;
        let r = 0, gr = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        ok([Math.round(r / n), Math.round(gr / n), Math.round(b / n)]);
      } catch { ok(null); }
    };
    img.src = dataUri;
  });
}

function relLum([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function rgbAv(farge) {
  const h = hexAv(farge);
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const bland = (over, under, a) => over.map((x, i) => x * a + under[i] * (1 - a));

/* The ratio body text ends up with, given the picture and every slider. */
function lesbarhet(p) {
  p = p || loadPrefs();
  const snitt = p.bgSnitt;
  const flate = rgbAv(temaVerdi('--panel'));
  /* The dimmest text decides, not the brightest. Measuring --fg said the page
     was readable while every unit symbol, column header and status line in
     --fg-3 was still lost in the picture - the fix stopped one step early
     because it was watching the wrong text. */
  const tekst = rgbAv(temaVerdi('--fg-3'));
  if (!snitt || !lastBilder().bg) {
    const l1 = relLum(tekst), l2 = relLum(flate);
    return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
  }
  let c = bland(snitt, rgbAv(temaVerdi('--bg')), (p.bgStyrke ?? 40) / 100);
  c = bland([0, 0, 0], c, (p.bgMorkne ?? 0) / 100);
  c = bland(flate, c, 1 - (p.flateGjennom ?? 0) / 100);
  const l1 = relLum(tekst), l2 = relLum(c);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}

/* Raise the dimming until the text passes - the one slider that always helps,
   and the smallest value that does, so the picture stays as visible as it can. */
function fiksLesbarhet() {
  const p = loadPrefs();
  for (let m = p.bgMorkne ?? 0; m <= 80; m += 5) {
    if (lesbarhet(Object.assign({}, p, {bgMorkne: m})) >= 4.5) {
      savePrefs({bgMorkne: m});
      brukTema();
      tegnTema();
      toast(`Mørklegging satt til ${m} % — teksten er lesbar igjen`);
      return;
    }
  }
  // Dimming alone was not enough; the surfaces have to close up too.
  savePrefs({bgMorkne: 80, flateGjennom: Math.max(0, (p.flateGjennom ?? 0) - 30)});
  brukTema();
  tegnTema();
  toast('Bildet er for lyst — dempet det og gjorde flatene mer dekkende', true);
}

function rgbaAv(hex, alfa) {
  const h = hexAv(hex);
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

/* Everything that is not a colour token: pictures, corner radius, the name in
   the top bar. Called from brukTema so there is one entry point for "make the
   page look like the saved settings". */
/* The one place the mark in the top bar is written.

   There were two: this, and the start-up check for a logo file next to the
   server. They fought, and the start-up one won because it ran last and
   removed the element the other needed. */
let LOGO_FRA_SERVER = null;

/* With no logo file the slot stays empty and CSS hides it. */

function settMerke(kilde) {
  const merke = $('brandMark');
  if (!merke) return;
  if (kilde) {
    const img = merke.querySelector('img');
    if (img && img.getAttribute('src') === kilde) return;   // allerede riktig
    merke.innerHTML = '';
    const ny = new Image();
    ny.alt = '';
    ny.src = kilde;
    merke.appendChild(ny);
    merke.classList.add('eget-bilde');
  } else if (merke.firstChild) {
    merke.innerHTML = '';
    merke.classList.remove('eget-bilde');
  }
}

function brukUtseende() {
  const p = loadPrefs();
  const b = lastBilder();
  const rot = document.documentElement;

  // --- bakgrunnsbilde ---
  const lag = $('bgLag'), skjerm = $('bgScrim');
  if (lag) {
    if (b.bg) {
      const modus = p.bgModus || 'dekk';
      lag.style.backgroundImage = `url("${b.bg}")`;
      lag.style.backgroundSize = modus === 'fliser' ? 'auto'
                               : modus === 'tilpass' ? 'contain' : 'cover';
      lag.style.backgroundRepeat = modus === 'fliser' ? 'repeat' : 'no-repeat';
      lag.style.opacity = (p.bgStyrke ?? 40) / 100;
      lag.style.filter = p.bgUskarp ? `blur(${p.bgUskarp}px)` : '';
      lag.hidden = false;
    } else {
      lag.hidden = true;
      lag.style.backgroundImage = '';
    }
  }
  if (skjerm) {
    const m = (p.bgMorkne ?? 0) / 100;
    skjerm.hidden = !b.bg || m <= 0;
    skjerm.style.background = `rgba(0,0,0,${m})`;
  }

  /* Surfaces have to let some light through or the picture is only visible in
     the gaps. Read the tokens after the colour overrides have been applied,
     so this works on top of whatever palette is in force. */
  const gjennom = Math.min(70, Math.max(0, p.flateGjennom ?? 0));
  document.body.classList.toggle('gjennomsiktig', !!b.bg && gjennom > 0);
  if (b.bg && gjennom > 0) {
    const a = 1 - gjennom / 100;
    ['--panel', '--raised', '--bg'].forEach(t => {
      rot.style.setProperty(t, rgbaAv(temaVerdi(t), a));
    });
  }

  // --- hjornerunding ---
  rot.style.removeProperty('--radius');
  if (p.radius !== undefined && p.radius !== null) {
    rot.style.setProperty('--radius', p.radius + 'px');
  }

  // --- toppbaren ---
  // Chosen picture first, then whatever the server has, then the letter.
  settMerke(b.logo || LOGO_FRA_SERVER || null);
  const topp = document.querySelector('.topbar');
  if (topp) {
    topp.style.backgroundImage = b.banner ? `url("${b.banner}")` : '';
    topp.style.backgroundSize = 'cover';
    topp.style.backgroundPosition = 'center';
  }
  const tittel = document.querySelector('.brand-text b');
  if (tittel) tittel.textContent = p.tittel || 'BACnet Explorer';
  const under = $('brandSub');
  if (under && p.undertittel !== undefined) under.textContent = p.undertittel;
}

/* ---------------------------------------------------- enheter som lander */
/* A controller that answers arrives from the button that called it.

   It flies as a copy in a layer over the whole window, not as the card itself:
   the device pane clips its contents, so a card animating up towards the top
   bar disappeared at the pane's edge the moment it left. The real card waits
   invisible and is revealed the instant the copy lands on it, so nothing
   flickers and the list never reflows.

   Positions are measured after layout - a row has no position until it is in
   the document - which is why this runs on the next frame rather than while
   the markup is being written. */
/* The class comes off the element, but the flag lives on the device object -
   and that is what renderDevices reads. Leaving it set meant the next redraw
   during the same sweep put the class straight back and the card flew again,
   over and over, for as long as the scan ran. A controller arrives once. */
function glemNy(el) {
  const ip = el.dataset.ip;
  const d = S.devices.find(x => x.address === ip);
  if (d) delete d._ny;
}

/* Kan kortet faktisk SES der det ligger?

   getBoundingClientRect paa kortet sier ingenting om noe over det klipper det
   bort. Et kort i en sammenslaatt leverandorgruppe har full hoyde og bredde -
   det er innpakningen som er null - saa vakten mot nullstore kort slapp det
   rett igjennom. Kortet floy tvers over skjermen og landet paa et sted der det
   ikke er noe aa se.

   Det var ikke et problem for trekkspillet kom: en sammenslaatt gruppe utelot
   kortene fra dokumentet, saa de ble aldri funnet. Naa ligger de der, og da maa
   spoersmaalet stilles ordentlig.

   Samme vakt dekker kort som er rullet ut av syne i en lang liste - de har
   ogsaa full storrelse og er like lite synlige. */
function synligIListen(el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;

  // Sammenslaatt gruppe. Klassen er fasit; hoyden er midt i en overgang naar
  // gruppa nettopp ble lukket, og da svarer geometrien feil.
  if (el.closest('.vgroup.av')) return false;

  // Rullet ut av syne. Halve kortet maa vaere innenfor for at en landing der
  // skal bety noe.
  const liste = document.getElementById('devList');
  if (liste) {
    const lr = liste.getBoundingClientRect();
    const innenfor = Math.min(r.bottom, lr.bottom) - Math.max(r.top, lr.top);
    if (innenfor < r.height * 0.5) return false;
  }
  return true;
}

/* Kortene som er i lufta akkurat naa: adresse -> klonen.

   Enhetslista bygges om hver gang en ny enhet svarer, og da er det ekte kortet
   et NYTT element. To ting gikk galt av det, og begge saa ut som "kortene
   lander rart":

   - Klassen 'venter', som skjuler kortet mens klonen flyr, satt igjen paa det
     gamle elementet. Det nye var synlig, saa den samme regulatoren sto baade i
     lista og i lufta samtidig.
   - Klonen hadde faatt beskjed om aa lande der kortet LAA da den tok av. Maalt
     under en ekte skanning av 192.168.40.0/24: to kort endte 397 px lenger ned
     fordi flere enheter kom til og sorterte seg over dem, to endte 132 px ned,
     og ni ble 10 px for brede fordi lista fikk rullefelt underveis.

   Begge loeses av aa synkronisere klonen mot det ekte kortet etter hver
   omtegning - da lander den der kortet ER, ikke der det var. */
const FLYVENDE = new Map();

function synkFlyvende() {
  if (!FLYVENDE.size) return;
  for (const [ip, klon] of FLYVENDE) {
    const el = document.querySelector(`#devList .dev[data-ip="${CSS.escape(ip)}"]`);
    if (!el) continue;
    el.classList.add('venter');
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    klon.style.left = r.left + 'px';
    klon.style.top = r.top + 'px';
    klon.style.width = r.width + 'px';
    klon.style.height = r.height + 'px';
  }
}

function flyInnNye() {
  const nye = [...document.querySelectorAll('.dev.ny')];
  if (!nye.length) return;
  /* Both of these clear the class - and both used to leave the flag on the
     device object, which is what renderDevices reads. With motion switched off
     that meant every redraw put the class straight back and this ran again,
     for as long as the list kept redrawing. */
  const dropp = () => nye.forEach(e => { e.classList.remove('ny'); glemNy(e); });
  if (bevegelseAv()) { dropp(); return; }

  const knapp = $('scanBtn');
  const lag = $('flylag');
  if (!knapp || !lag) { dropp(); return; }
  const kr = knapp.getBoundingClientRect();
  const fra = {x: kr.left + kr.width / 2, y: kr.top + kr.height / 2};

  lag.hidden = false;
  const tall = (min, maks) => min + Math.random() * (maks - min);

  /* Klassen maa vekk FOER kortene maales.

     .dev.ny kjorer enhet-inn, som skalerer kortet til 94 %. Saa lenge klassen
     staar paa maaler getBoundingClientRect den nedskalerte boksen: klonen ble
     237,8 px bred der kortet er 250, den fikk beskjed om aa lande paa x=7,5 der
     kortet ligger paa x=0 - og i det klonen ble fjernet spratt kortet ut til
     full bredde. To animasjoner kjempet om den samme ankomsten, og flyvningen
     tapte fordi den maalte motstanderen sin.

     Alle foerst, saa EN tvungen layout, saa maaling - ikke en layout per kort. */
  nye.forEach(el => { el.classList.remove('ny'); glemNy(el); });
  void document.body.offsetWidth;

  nye.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    // Ingen flyvning til et sted ingen ser. Flagget er alt ryddet over, saa
    // kortet tar heller ikke av naar du apner gruppa igjen.
    if (!synligIListen(el)) return;

    const klon = el.cloneNode(true);
    klon.classList.remove('ny', 'sel');
    klon.removeAttribute('id');
    klon.style.left = r.left + 'px';
    klon.style.top = r.top + 'px';
    klon.style.width = r.width + 'px';
    klon.style.height = r.height + 'px';
    /* Rolled per card. Without this every controller traced the same line from
       the same pixel, which after the third one stops reading as things
       arriving and starts reading as a loop. The spread moves where it leaves
       the button, the arc decides how high it is thrown, and the tumble gives
       it a little spin to shed on the way down. */
    /* Wide enough to see. The previous ranges moved a card by a few percent
       of a six-hundred-pixel journey, which is a rounding error dressed as
       variety - the complaint was fair. A card can now leave from anywhere
       across a fan the width of the top bar, be lobbed high or flung flat,
       and tumble nearly half a turn on the way down. */
    const spredX = Math.round(tall(-140, 140));
    const spredY = Math.round(tall(-18, 26));
    klon.style.setProperty('--fra-x',
      Math.round(fra.x - (r.left + r.width / 2)) + spredX + 'px');
    klon.style.setProperty('--fra-y',
      Math.round(fra.y - (r.top + r.height / 2)) + spredY + 'px');

    /* The rise is capped by whatever room is actually above the launch point.
       The button sits near the top of the window, so an unbounded arc threw
       the card off the screen - the layer clipped it and the flight simply
       stopped being visible halfway through. */
    const takhoyde = Math.max(0, fra.y - 20);
    klon.style.setProperty('--bue', Math.round(Math.min(takhoyde, tall(0, 34))) + 'px');

    /* The variety goes sideways instead, where there is room for it. A wide
       swing and a direct throw are different arrivals, not two points on one
       scale - so the swing is drawn from one or the other rather than from the
       middle of a single range, which is where an even roll spends most of its
       time and why everything looked alike. */
    const svinger = Math.random() < 0.55;
    /* Clamped to the room the card actually has beside it. These land in the
       leftmost pane, so a two-hundred-pixel swing to the left put them past
       the window edge and the layer clipped them - twenty-three sample points
       outside the frame across eight flights. The room is different on each
       side and different for every card, so it is measured rather than
       guessed, and the throw goes wherever there is space for it. */
    const romVenstre = Math.max(0, r.left - 16);
    const romHoyre = Math.max(0, window.innerWidth - r.right - 16);
    const retning = romHoyre > romVenstre * 1.6 ? 1
                  : romVenstre > romHoyre * 1.6 ? -1
                  : (Math.random() < 0.5 ? -1 : 1);
    const rom = retning < 0 ? romVenstre : romHoyre;
    const onsket = svinger ? tall(90, 210) : tall(0, 40);
    klon.style.setProperty('--sving',
      Math.round(retning * Math.min(rom, onsket)) + 'px');
    klon.style.setProperty('--rot', tall(-42, 42).toFixed(1) + 'deg');
    /* Spretten kappes mot kortets egen hoyde. Kortene er 62-66 px, og et
       sprett paa 40 px er to tredjedeler av kortet - det leser som en ball,
       ikke som noe med vekt. Under en tredjedel holder det jordnaert. */
    const tak = Math.max(10, Math.round(r.height * 0.30));
    klon.style.setProperty('--sprett', Math.min(tak, Math.round(tall(11, 26))) + 'px');
    /* Lengre enn foer, fordi landinga naa er nesten halve animasjonen og
       sprettet trenger aatte-ni bilder for aa lese som en bue. Paa 640 ms fikk
       det under tre. Kortene overlapper hverandre uansett, saa summen foles
       ikke tregere - hvert enkelt kort blir bare mulig aa foelge. */
    /* Kortere enn forrige runde. Landinga trengte flere bilder, og jeg gav den
       dem ved aa forlenge hele flyvningen - men kortet er ikke ferdig ankommet
       foer klonen lander, og maalt paa et ekte skann ble hvert kort staaende
       usynlig i over ett sekund. Landinga eier fortsatt naesten halve
       animasjonen, saa spretten har det den trenger. */
    klon.style.setProperty('--varighet',
      Math.round(svinger ? tall(760, 900) : tall(620, 740)) + 'ms');
    // Staggered, so eight controllers answering at once read as eight
    // arrivals rather than one shower - capped, or the last of thirty would
    // still be in the air long after the sweep ended. Jittered, or the
    // stagger itself becomes the pattern.
    // Taket ned fra 400 til 190 ms: med femten enheter var de siste kortene
    // et halvt sekund bak de foerste, i tillegg til flyvetida.
    const forsink = Math.min(i * 34, 190) + Math.round(tall(0, 40));
    klon.style.animationDelay = forsink + 'ms';
    lag.appendChild(klon);

    const ip = el.dataset.ip;
    el.classList.add('venter');
    FLYVENDE.set(ip, klon);
    const land = () => {
      FLYVENDE.delete(ip);
      // Elementet kan vaere byttet ut siden avgang, saa finn det som staar der
      // NAA - ellers blir kortet staaende usynlig.
      const naa = document.querySelector(`#devList .dev[data-ip="${CSS.escape(ip)}"]`);
      if (naa) naa.classList.remove('venter');
      el.classList.remove('venter');
      klon.remove();
      if (!lag.children.length) lag.hidden = true;
    };
    klon.addEventListener('animationend', land, {once: true});
    // A belt for the case where the animation never reports finishing - a
    // card left invisible would be worse than one that skipped its flight.
    setTimeout(land, 1020 + forsink + 300);
  });
}

/* ------------------------------------------------------- skanneknappen */
/* The button carries the state of the thing it started: rings on the way out,
   a fill while the sweep runs, a flare each time something answers. */
/* Ladningen som gaar foran skannet. Returnerer om den faktisk kjorte, saa
   den som kalte kan la etiketten staa saa lenge. */
function ladSkann() {
  const b = $('scanBtn');
  if (!b || bevegelseAv()) return false;
  // Ingenting settes inn i knappen - den bygges om til "Avbryt" med en gang,
  // og alt som ligger inni forsvinner med den.
  b.classList.remove('lader');
  void b.offsetWidth;
  b.classList.add('lader');
  setTimeout(() => b.classList.remove('lader'), 380);
  return true;
}

function skannPing() {
  const b = $('scanBtn');
  if (!b || bevegelseAv()) return;
  b.classList.remove('sender');
  void b.offsetWidth;
  b.classList.add('sender');
  setTimeout(() => b.classList.remove('sender'), 1200);
}

function skannFramdrift(pst, ukjent) {
  const b = $('scanBtn');
  if (!b) return;
  b.classList.add('skanner');
  b.classList.toggle('ukjent', !!ukjent);
  if (!b.querySelector('span.fyll')) {
    const f = document.createElement('span');
    f.className = 'fyll';
    b.appendChild(f);
  }
  if (!ukjent) b.style.setProperty('--skann', Math.max(0, Math.min(1, pst / 100)));
}

function skannSvar() {
  const b = $('scanBtn');
  if (!b || bevegelseAv()) return;
  b.classList.remove('svar');
  void b.offsetWidth;
  b.classList.add('svar');
  setTimeout(() => b.classList.remove('svar'), 560);
}

function skannSlutt() {
  const b = $('scanBtn');
  if (!b) return;
  b.classList.remove('skanner', 'ukjent', 'sender', 'svar');
  b.style.removeProperty('--skann');
  const f = b.querySelector('span.fyll');
  if (f) f.remove();
}

/* --------------------------------------------------- framdrift paa kortet */
/* The card in the list is what was clicked, so the card is where the waiting
   belongs - not a box in the middle of the screen, which is not where you are
   looking.

   Held in state as well as written to the element: partial results call
   renderDevices, which rebuilds the list from a string, so a class set only on
   the node would vanish the first time points arrived - precisely when the bar
   matters. State survives the rebuild; the direct write keeps the in-between
   updates smooth without re-rendering four times a second. */
/* Which of the two passes a phase belongs to. The first is the object list and
   the values on it; everything after that is a second sweep over the same
   objects for the things the table fills in afterwards. */
const FASE_GRUPPE = {
  'objektliste': 1, 'punkter': 1,
  'beskrivelser': 2, 'tilstandstekster': 2, 'av/pa-tekster': 2, 'ukeprogram': 2,
};
const FASE_ORD = {
  'objektliste': 'leser objektlista', 'punkter': 'leser verdier',
  'beskrivelser': 'leser beskrivelser', 'tilstandstekster': 'leser tilstandstekster',
  'av/pa-tekster': 'leser av/på-tekster', 'ukeprogram': 'leser ukeprogram',
};

/* Three devices can be read at once in the background, so the state is per
   address rather than one slot - with a single slot the second device to
   report simply erased the first one's bar. */
function kortFramdrift(ip, pst, ukjent, fase) {
  const andel = Math.max(0, Math.min(1, pst / 100));
  const gruppe = FASE_GRUPPE[fase] || 1;
  if (!S._lastere) S._lastere = {};
  const forrige = S._lastere[ip] || null;
  S._lastere[ip] = S._laster = {
    ip, ukjent: !!ukjent, fase,
    // The first bar stays full once its pass is done - it did finish, and
    // emptying it would say otherwise.
    andel: gruppe === 1 ? andel : 1,
    andel2: gruppe === 2 ? andel : (forrige ? forrige.andel2 || 0 : 0),
  };
  const el = document.querySelector(`.dev[data-ip="${CSS.escape(ip)}"]`);
  if (!el) return;
  el.classList.add('laster');
  el.classList.toggle('ukjent', !!ukjent);
  if (!ukjent) {
    el.style.setProperty('--frem', S._laster.andel);
    el.style.setProperty('--frem2', S._laster.andel2);
  }
  if (fase && FASE_ORD[fase]) el.title = FASE_ORD[fase];
}

function kortFerdig(ip) {
  if (S._lastere) delete S._lastere[ip];
  if (S._laster && S._laster.ip === ip) S._laster = null;
  const el = document.querySelector(`.dev[data-ip="${CSS.escape(ip)}"]`);
  if (!el) return;
  el.classList.remove('laster', 'ukjent');
  el.removeAttribute('title');
  el.style.removeProperty('--frem2');
  el.style.removeProperty('--frem');
  if (bevegelseAv()) return;
  el.classList.remove('ferdig');
  void el.offsetWidth;
  el.classList.add('ferdig');
  setTimeout(() => el.classList.remove('ferdig'), 700);
}

/* --------------------------------------------------------- anleggsminne */
/* What was scanned here, and what answered.

   Coming back to a building weeks later, the first question is always the
   same: what was the range, and what did I find last time. That lived in the
   technician's head, and the tool opened blank every visit. Now every scan is
   remembered - the ranges, the controllers that answered, when, and how many
   times - so the next visit starts from what is already known.

   Deliberately not a project: no point values, no snapshots. This is the list
   you skim to remember where you were, and projects are for taking the whole
   site with you. */
let MINNE = {};

async function hentMinne() {
  try {
    const d = await (await fetch('/api/sites')).json();
    MINNE = d.sites || {};
  } catch { MINNE = {}; }
  fyllOmradeliste();
}

function fyllOmradeliste() {
  const dl = $('kjenteOmrader');
  if (!dl) return;
  // Most recent first: the site you were at yesterday is the one you want.
  const rader = Object.entries(MINNE)
    .sort((a, b) => (b[1].sist || 0) - (a[1].sist || 0))
    .slice(0, 25);
  dl.innerHTML = rader.map(([key, s]) => {
    const merke = s.navn || `${(s.enheter || []).length} enheter`;
    return `<option value="${esc(key)}">${esc(merke)}</option>`;
  }).join('');
}

/* Recorded after a scan finishes, not while it runs: a half-finished sweep is
   not what you want to come back to. */
async function husk(omraader, enheter) {
  if (!omraader || !omraader.length) return;
  try {
    const d = await api('/api/sites', {
      ranges: omraader,
      local_address: S.localAddr || null,
      devices: (enheter || []).map(x => ({
        address: x.address, device_instance: x.device_instance,
        object_name: x.object_name, // vendor_name, not object_name: the device list looks it up that way, and
        // passing the device's own name made every remembered site record its
        // controller names where the vendor belongs.
        vendor: (vendorOf(x.vendor_name, x.vendor_id) || {}).label || null,
      })),
    });
    if (d.status === 'done') { MINNE[d.key] = d.site; fyllOmradeliste(); }
  } catch { /* minnet er en bekvemmelighet, ikke noe aa stoppe skannet for */ }
}

function openMinne() { $('minneOverlay').hidden = false; hentMinne().then(tegnMinne); }
function closeMinne() { $('minneOverlay').hidden = true; }

function naarTekst(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const dager = Math.floor((Date.now() - d) / 86400000);
  if (dager === 0) return 'i dag ' + d.toLocaleTimeString('no', {hour: '2-digit', minute: '2-digit'});
  if (dager === 1) return 'i går';
  if (dager < 30) return dager + ' dager siden';
  return d.toLocaleDateString('no');
}

function tegnMinne() {
  const rader = Object.entries(MINNE).sort((a, b) => (b[1].sist || 0) - (a[1].sist || 0));
  $('minneAntall').textContent = rader.length ? `${rader.length} anlegg` : '';
  if (!rader.length) {
    $('minneBody').innerHTML = '<div class="gs-empty">Ingen skann er husket enn\u00e5. '
      + 'Skann et omr\u00e5de, s\u00e5 dukker det opp her.</div>';
    return;
  }
  $('minneBody').innerHTML = rader.map(([key, s]) => {
    const enh = s.enheter || [];
    const merker = [...new Set(enh.map(e => e.vendor).filter(Boolean))].slice(0, 4);
    return `<div class="mn-rad">
      <div class="mn-navn">
        <div class="mn-tittel${s.navn ? '' : ' uten'}">${esc(s.navn || 'uten navn')}</div>
        <div class="mn-omrade">${esc(key)}</div>
        <div class="mn-under">${merkerHtml(merker)}${
          s.lokal ? 'fra ' + esc(s.lokal) : ''}</div>
      </div>
      <div class="mn-tall">${enh.length} enheter<br>${esc(naarTekst(s.sist))}${
        s.ganger > 1 ? `<br>${s.ganger} skann` : ''}</div>
      <div class="mn-knapper">
        <button class="btn" data-skann="${esc(key)}">Skann</button>
        <button class="btn" data-navn="${esc(key)}">Navn</button>
        <button class="btn" data-slett="${esc(key)}">Slett</button>
      </div>
    </div>`;
  }).join('');

  $('minneBody').querySelectorAll('[data-skann]').forEach(b => b.onclick = () => {
    $('rangeInput').value = b.dataset.skann;
    savePrefs({range: b.dataset.skann});
    closeMinne();
    runScan();
  });
  $('minneBody').querySelectorAll('[data-navn]').forEach(b => b.onclick = async () => {
    const naa = (MINNE[b.dataset.navn] || {}).navn || '';
    const navn = prompt('Hva heter dette anlegget?', naa);
    if (navn === null) return;
    const d = await api('/api/sites/name', {key: b.dataset.navn, name: navn});
    if (d.status === 'done') { MINNE[b.dataset.navn] = d.site; tegnMinne(); fyllOmradeliste(); }
  });
  $('minneBody').querySelectorAll('[data-slett]').forEach(b => b.onclick = async () => {
    if (!confirm(`Glemme ${b.dataset.slett}?`)) return;
    const d = await api('/api/sites/delete', {key: b.dataset.slett});
    if (d.status === 'done') { delete MINNE[b.dataset.slett]; tegnMinne(); fyllOmradeliste(); }
  });
}

function merkerHtml(merker) {
  return merker.map(m => `<span class="mn-vendor">${esc(m)}</span>`).join('');
}

/* ------------------------------------------------------------- tagging */
/* The settings the tag generator asks for every single time.

   The workflow today is: read a controller here, export EDE, open BTG, and
   type in prefix, cluster, site name and the rest before it will do anything.
   Those answers do not change between visits - they belong to the building,
   not to the session - so they are kept with the site, next to the ranges and
   the controllers that answered. Come back to the same building next month
   and they are already filled in.

   Field names follow BTG's own: prefix, cluster, anleggsnavn, prosjekt,
   delimiter, building-id-first. Same words, so there is nothing to translate
   between the two screens. */
const TAG_STD = {
  prefiks: '', cluster: '', anleggsnavn: '', prosjekt: '',
  skilletegn: '=', byggIdForst: false, ventLedd: '2', sorter: 'etasje',
};

// BTG warns above this; the tag becomes unwieldy in Niagara long before it
// becomes invalid.
const PREFIKS_MAKS = 12;

function tagNokkel() {
  const r = (S.scanRanges || []).slice().sort().join(' ');
  return r || null;
}

function tagInnstillinger() {
  const k = tagNokkel();
  const fra = k && MINNE[k] && MINNE[k].tagging ? MINNE[k].tagging : {};
  return Object.assign({}, TAG_STD, loadPrefs().taggingStd || {}, fra);
}

async function lagreTagging(patch) {
  const k = tagNokkel();
  const naa = Object.assign({}, tagInnstillinger(), patch);
  // Kept as the default for the next site too, so a new building starts from
  // what you last used rather than from blank.
  savePrefs({taggingStd: naa});
  if (!k) { tegnTagging(); return; }
  try {
    const d = await api('/api/sites/tagging', {key: k, tagging: naa});
    if (d.status === 'done') MINNE[k] = d.site;
  } catch { /* lokalt er lagret uansett */ }
  tegnTagging();
}

/* What a tag will look like with these settings, built from a real point on
   the device if there is one - a preview from invented data proves nothing. */
function tagEksempel(t) {
  const p = (S.points || []).find(x => x.name) || null;
  const navn = p ? shortName(p) || p.name : 'RT401';
  const biter = [];
  if (t.prefiks) biter.push('+' + t.prefiks);
  if (t.cluster) biter.push(t.cluster);
  const system = t.byggIdForst ? '360.003' : '003.360';
  return (biter.join('') || '+PREFIKS') + t.skilletegn + system + '-' +
         String(navn).split(/[.\/]/).pop().slice(0, 18);
}

function tegnTagging() {
  const el = $('settTagging');
  if (!el) return;
  const t = tagInnstillinger();
  const k = tagNokkel();
  const site = k && MINNE[k] ? MINNE[k] : null;

  const felt = (id, etikett, hjelp, verdi, attr = '') => `
    <div class="tg-rad">
      <label for="${id}">${etikett}${hjelp ? `<small>${hjelp}</small>` : ''}</label>
      <input type="text" id="${id}" value="${esc(verdi ?? '')}" spellcheck="false"${attr}>
    </div>`;

  el.innerHTML = `
    <div class="tg-anlegg">${k
      ? `Lagres for ${esc(site && site.navn ? site.navn : k)}`
      : 'Ingen område skannet ennå — lagres som standard for neste anlegg'}</div>

    <div class="tg-gruppe">
      <div class="tema-tittel">Identifikasjon</div>
      ${felt('tgPrefiks', 'Prefiks', 'Foran systemnummeret, som i BTG', t.prefiks)}
      ${t.prefiks.length > PREFIKS_MAKS
        ? `<div class="tg-advarsel">Prefikset er ${t.prefiks.length} tegn.
             Over ${PREFIKS_MAKS} blir taggen tung å lese i Niagara, og BTG
             advarer om det samme.</div>` : ''}
      ${felt('tgCluster', 'Cluster', '', t.cluster)}
      ${felt('tgAnlegg', 'Anleggsnavn', '', t.anleggsnavn)}
      ${felt('tgProsjekt', 'Prosjekt', '', t.prosjekt)}
    </div>

    <div class="tg-gruppe">
      <div class="tema-tittel">Oppbygging</div>
      <div class="tg-rad">
        <label for="tgSkille">Skilletegn<small>Mellom prefiks og system</small></label>
        <span class="sel-boks"><select id="tgSkille">
          ${['=', '-', '.', '_', ':'].map(x =>
            `<option value="${x}"${t.skilletegn === x ? ' selected' : ''}>${x}</option>`).join('')}
        </select></span>
      </div>
      <div class="tg-rad avkryss">
        <input type="checkbox" id="tgByggForst"${t.byggIdForst ? ' checked' : ''}>
        <label for="tgByggForst">Bygg-ID først
          <small>Bygg-ID foran systemnummeret</small></label>
      </div>
      <div class="tg-rad">
        <label for="tgLedd">Ventilasjonssystemets ledd<small>Hvilket ledd systemnummeret står i</small></label>
        <span class="sel-boks"><select id="tgLedd">
          ${['1', '2', '3', '4'].map(x =>
            `<option value="${x}"${t.ventLedd === x ? ' selected' : ''}>${x}</option>`).join('')}
        </select></span>
      </div>
      <div class="tg-rad">
        <label for="tgSorter">Sortering</label>
        <span class="sel-boks"><select id="tgSorter">
          <option value="etasje"${t.sorter === 'etasje' ? ' selected' : ''}>Etasje</option>
          <option value="vent"${t.sorter === 'vent' ? ' selected' : ''}>Ventilasjonssystem</option>
        </select></span>
      </div>
    </div>

    <div class="tg-gruppe">
      <div class="tema-tittel">Slik blir det</div>
      <div class="tg-forhaandsvis">${esc(tagEksempel(t))}</div>
      <div class="tg-foot">
        <button class="btn" id="tgKopier">Kopier til BTG</button>
        <button class="btn" id="tgNullstill">Tøm</button>
      </div>
    </div>`;

  const bind = (id, noekkel) => {
    const e = $(id);
    if (!e) return;
    e.onchange = () => lagreTagging({[noekkel]: e.type === 'checkbox' ? e.checked : e.value});
  };
  bind('tgPrefiks', 'prefiks'); bind('tgCluster', 'cluster');
  bind('tgAnlegg', 'anleggsnavn'); bind('tgProsjekt', 'prosjekt');
  bind('tgSkille', 'skilletegn'); bind('tgByggForst', 'byggIdForst');
  bind('tgLedd', 'ventLedd'); bind('tgSorter', 'sorter');

  const kop = $('tgKopier');
  if (kop) kop.onclick = () => {
    // Laid out as label and value on separate lines so it can be read while
    // filling the fields on the other screen.
    const linjer = [
      ['Prefix', t.prefiks], ['Cluster', t.cluster],
      ['Anleggsnavn', t.anleggsnavn], ['Prosjekt', t.prosjekt],
      ['Delimiter', t.skilletegn],
      ['Bygg-ID først', t.byggIdForst ? 'ja' : 'nei'],
      ['Ventilasjonsledd', t.ventLedd], ['Sortering', t.sorter],
    ].filter(([, v]) => v !== '' && v !== undefined)
     .map(([a, b]) => `${a}: ${b}`).join('\n');
    navigator.clipboard.writeText(linjer)
      .then(() => toast('Innstillingene er kopiert'))
      .catch(() => toast('Kunne ikke kopiere', true));
  };
  const nul = $('tgNullstill');
  if (nul) nul.onclick = () => {
    if (!confirm('Tømme taggeinnstillingene for dette anlegget?')) return;
    lagreTagging(Object.assign({}, TAG_STD));
  };
}

/* ------------------------------------------------------------------ tema */
/* Everything the look is made of, in one place, editable and remembered.

   The app already had two themes; what it did not have was any way to change
   them. On a machine that runs this tool all day - sometimes on a laptop in a
   plant room under fluorescent light, sometimes on a desk monitor - the right
   contrast is not the same, and neither is the right size. So the tokens are
   exposed rather than fixed, stored per mode (dark and light keep separate
   overrides), and applied as inline custom properties on :root, which beats
   every stylesheet rule without touching the stylesheet. */
const TEMA_GRUPPER = [
  {navn: 'Flater', felt: [
    ['--bg', 'Bakgrunn'], ['--panel', 'Paneler'], ['--raised', 'Hevet flate'],
    ['--sunken', 'Innfelte felt'], ['--hover', 'Peker over'],
    ['--line', 'Linjer'], ['--line-2', 'Linjer, sterkere'], ['--line-soft', 'Linjer, svake'],
  ]},
  {navn: 'Tekst', felt: [
    ['--fg', 'Tekst'], ['--fg-2', 'Tekst, dempet'], ['--fg-3', 'Tekst, svak'],
  ]},
  {navn: 'Aksent', felt: [
    ['--accent', 'Aksent'], ['--accent-dim', 'Aksent, flate'],
    ['--accent-edge', 'Aksent, kant'], ['--accent-press', 'Aksent, trykket'],
    ['--on-accent', 'Tekst på aksent'], ['--live', 'Live og trend'],
  ]},
  {navn: 'Status', felt: [
    ['--ok', 'Normal / på'], ['--warn', 'Unormal tilstand'],
    ['--err', 'Alarm'], ['--err-fg', 'Alarmtekst'], ['--adjust', 'Justerbart settpunkt'],
  ]},
  {navn: 'Merkevare', felt: [
    ['--merke', 'Topplinje'], ['--merke-lys', 'Topplinje, lysere'],
    ['--merke-aksent', 'Merkeaksent'],
  ]},
];
const TEMA_ALLE = TEMA_GRUPPER.flatMap(g => g.felt.map(f => f[0]));

/* Presets are whole palettes, not tweaks: picking one replaces every token so
   there is no half-applied state to reason about. */
const TEMA_FORVALG = {
  'Standard': null,
  'Indigo': {
    dark: {'--accent': '#4f7bd6', '--accent-dim': '#1b2b4d', '--accent-edge': '#33518f',
           '--accent-press': '#2a4478', '--on-accent': '#d5e2ff'},
    light: {'--accent': '#3b3a8f', '--accent-dim': '#dcdcf2', '--accent-edge': '#a9a9d8',
            '--accent-press': '#c9c9e8', '--on-accent': '#26246b'},
  },
  'Høy kontrast': {
    dark: {'--bg': '#000000', '--panel': '#0a0a0a', '--raised': '#141414',
           '--sunken': '#000000', '--line': '#3a3a3a', '--line-2': '#5a5a5a',
           '--line-soft': '#1e1e1e', '--fg': '#ffffff', '--fg-2': '#d8d8d8',
           '--fg-3': '#b4b4b4', '--accent': '#4da3ff', '--accent-dim': '#10365e',
           '--on-accent': '#ffffff', '--ok': '#3ce03c', '--warn': '#ffd633', '--err': '#ff7b6b'},
    light: {'--bg': '#ffffff', '--panel': '#ffffff', '--raised': '#f0f0f0',
            '--line': '#9a9a9a', '--line-2': '#5a5a5a', '--fg': '#000000',
            '--fg-2': '#2b2b2b', '--fg-3': '#454545', '--accent': '#0b52a8',
            '--ok': '#046004', '--warn': '#6b4d00', '--err': '#b00d00'},
  },
  'Dempet': {
    dark: {'--bg': '#14171a', '--panel': '#191d21', '--raised': '#1f242a',
           '--sunken': '#111417', '--fg': '#c6ccd2', '--fg-2': '#9aa2aa',
           '--fg-3': '#7d858d', '--accent': '#6f9fd8', '--accent-dim': '#22303f',
           '--ok': '#5c9e64', '--warn': '#c9a227', '--err': '#d1705f'},
    light: {'--bg': '#f7f7f5', '--panel': '#fffffe', '--raised': '#efefec',
            '--fg': '#2a2f34', '--fg-2': '#565d64', '--fg-3': '#6e757c',
            '--accent': '#4a72a8', '--ok': '#3f7a45', '--warn': '#8a6a12', '--err': '#b5432f'},
  },
};

function temaModus() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/* Read the value a token has right now, whether that comes from the stylesheet
   or from an override - the colour input needs something concrete to show. */
function temaVerdi(token) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || '#000000';
}

function hexAv(farge) {
  if (/^#[0-9a-f]{6}$/i.test(farge)) return farge.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(farge)) {
    return '#' + farge.slice(1).split('').map(c => c + c).join('').toLowerCase();
  }
  const m = farge.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map(x => Math.round(parseFloat(x)));
    return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x || 0))
      .toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}

function brukBevegelse() {
  const av = loadPrefs().utenBevegelse === true;
  document.body.classList.toggle('uten-bevegelse', av);
  const el = $('motionState');
  if (el) el.textContent = av ? 'av' : 'på';
  const knapp = $('motionBtn');
  if (knapp) knapp.classList.toggle('on', !av);
}

function brukTema() {
  const p = loadPrefs();
  const rot = document.documentElement;
  const t = ((p.tema || {})[temaModus()]) || {};
  // Clear first: without this a token removed from the overrides would keep
  // whatever it was last set to, and "tilbakestill" would do nothing visible.
  TEMA_ALLE.forEach(k => rot.style.removeProperty(k));
  Object.entries(t).forEach(([k, v]) => { if (v) rot.style.setProperty(k, v); });

  rot.style.removeProperty('--row');
  if (p.radHoyde) rot.style.setProperty('--row', p.radHoyde + 'px');
  // Pictures and shapes come after the colours, because surface transparency
  // is computed from whatever the tokens ended up being.
  brukUtseende();
  // zoom scales the whole layout, which is what "larger" has to mean in a tool
  // measured in px throughout; font-size alone would change nothing.
  // Clear rather than set zoom:1 - a zoom value, even 1, creates a
  // containing block, and there is no reason to carry that by default.
  document.body.style.zoom = (p.uiSkala && p.uiSkala !== 100) ? (p.uiSkala / 100) : '';
  brukBevegelse();
}

function settTema(token, verdi) {
  const p = loadPrefs();
  const tema = p.tema || {};
  const m = temaModus();
  tema[m] = tema[m] || {};
  if (verdi) tema[m][token] = verdi; else delete tema[m][token];
  savePrefs({tema});
  brukTema();
}

function openTema(fane) {
  $('temaOverlay').hidden = false;
  visSettFane(fane || 'oppsett');
  syncMenuStates();
}
function closeTema() { $('temaOverlay').hidden = true; }

function tegnTema() {
  const p = loadPrefs();
  const m = temaModus();
  const egne = (p.tema || {})[m] || {};
  $('temaModus').textContent = m === 'light' ? 'lys visning' : 'mørk visning';

  const grupper = TEMA_GRUPPER.map(g => `
    <div class="tema-gruppe">
      <div class="tema-tittel">${esc(g.navn)}</div>
      ${g.felt.map(([token, navn]) => {
        const hex = hexAv(temaVerdi(token));
        const endret = !!egne[token];
        return `<div class="tema-rad${endret ? ' endret' : ''}">
          <input type="color" class="tema-farge" data-token="${token}" value="${hex}"
                 aria-label="${esc(navn)}">
          <span class="tema-navn">${esc(navn)}</span>
          <input type="text" class="tema-hex" data-token="${token}" value="${hex}"
                 spellcheck="false" aria-label="${esc(navn)} som heksadesimal">
          <button class="tema-null" data-token="${token}"
                  title="Tilbakestill"${endret ? '' : ' disabled'}>↺</button>
        </div>`;
      }).join('')}
    </div>`).join('');

  const skala = p.uiSkala || 100;
  const rad = p.radHoyde || 26;
  const runding = p.radius ?? 4;
  const b = lastBilder();

  const skyv = (id, navn, min, maks, steg, verdi, enhet) => `
    <div class="tema-rad"><span class="tema-navn">${navn}</span>
      <input type="range" id="${id}" min="${min}" max="${maks}" step="${steg}" value="${verdi}">
      <span class="tema-tall" id="${id}Tall">${verdi}${enhet}</span></div>`;

  const bildeRad = (navn, etikett, uri, hjelp) => `
    <div class="tema-rad bilde-rad" tabindex="0"
         title="Velg fil, dra et bilde hit, eller lim inn med Ctrl+V">
      <span class="bilde-visning">${uri ? `<img src="${uri}" alt="">` : '<i>tomt</i>'}</span>
      <span class="tema-navn">${etikett}<small>${hjelp}</small></span>
      <button class="btn" data-bilde="${navn}">${uri ? 'Bytt' : 'Velg fil'}</button>
      <button class="tema-null" data-fjernbilde="${navn}" title="Fjern"${uri ? '' : ' disabled'}>↺</button>
    </div>`;

  $('temaBody').innerHTML = `
    <div class="tema-forvalg">
      <span class="tema-tittel">Ferdige oppsett</span>
      ${Object.keys(TEMA_FORVALG).map(n =>
        `<button class="btn" data-forvalg="${esc(n)}">${esc(n)}</button>`).join('')}
    </div>

    <div class="tema-gruppe">
      <div class="tema-tittel">Bilder</div>
      <div class="tema-hjelp">Velg fil, dra et bilde inn i raden, eller lim inn
        med Ctrl+V når raden er markert.</div>
      ${bildeRad('bg', 'Bakgrunnsbilde', b.bg, 'bak hele vinduet')}
      ${b.bg ? skyv('bgStyrke', 'Styrke', 5, 100, 5, p.bgStyrke ?? 40, ' %')
             + skyv('bgUskarp', 'Uskarphet', 0, 20, 1, p.bgUskarp ?? 0, ' px')
             + skyv('bgMorkne', 'Mørklegging', 0, 80, 5, p.bgMorkne ?? 0, ' %')
             + skyv('flateGjennom', 'Gjennomsiktige flater', 0, 70, 5, p.flateGjennom ?? 0, ' %')
             + lesbarhetRad(p)
             + `<div class="tema-rad"><span class="tema-navn">Plassering</span>
                 <span class="sel-boks"><select id="bgModus">
                   ${['dekk', 'tilpass', 'fliser'].map(m =>
                     `<option value="${m}"${(p.bgModus || 'dekk') === m ? ' selected' : ''}>${
                       {dekk: 'Fyller vinduet', tilpass: 'Hele bildet synlig', fliser: 'Gjentas som fliser'}[m]
                     }</option>`).join('')}
                 </select></span></div>`
             : '<div class="tema-hjelp">Legg inn et bakgrunnsbilde for å få flere valg.</div>'}
      ${bildeRad('logo', 'Logo i toppbaren', b.logo, 'erstatter N-merket')}
      ${bildeRad('banner', 'Banner i toppbaren', b.banner, 'bak knappene øverst')}
    </div>

    <div class="tema-gruppe">
      <div class="tema-tittel">Navn</div>
      <div class="tema-rad"><span class="tema-navn">Tittel</span>
        <input type="text" class="tema-tekst" id="temaTittel"
               value="${esc(p.tittel || 'BACnet Explorer')}" spellcheck="false"></div>
      <div class="tema-rad"><span class="tema-navn">Undertittel</span>
        <input type="text" class="tema-tekst" id="temaUnder"
               value="${esc(p.undertittel ?? '')}" spellcheck="false"></div>
    </div>

    <div class="tema-gruppe">
      <div class="tema-tittel">Størrelse og form</div>
      ${skyv('temaSkala', 'Hele grensesnittet', 80, 140, 5, skala, ' %')}
      ${skyv('temaRad', 'Radhøyde i tabellen', 20, 40, 1, rad, ' px')}
      ${skyv('temaRunding', 'Runde hjørner', 0, 14, 1, runding, ' px')}
    </div>
    ${grupper}`;

  $('temaBody').querySelectorAll('.tema-farge').forEach(i => {
    i.oninput = () => {
      settTema(i.dataset.token, i.value);
      const hex = $('temaBody').querySelector(`.tema-hex[data-token="${i.dataset.token}"]`);
      if (hex) hex.value = i.value;
      i.closest('.tema-rad').classList.add('endret');
      i.closest('.tema-rad').querySelector('.tema-null').disabled = false;
    };
  });
  $('temaBody').querySelectorAll('.tema-hex').forEach(i => {
    i.onchange = () => {
      const v = i.value.trim();
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { i.value = hexAv(temaVerdi(i.dataset.token)); return; }
      settTema(i.dataset.token, v);
      tegnTema();
    };
  });
  $('temaBody').querySelectorAll('.tema-null').forEach(b => {
    b.onclick = () => { settTema(b.dataset.token, null); tegnTema(); };
  });
  $('temaBody').querySelectorAll('[data-forvalg]').forEach(b => {
    b.onclick = () => {
      const v = TEMA_FORVALG[b.dataset.forvalg];
      const pr = loadPrefs();
      const tema = pr.tema || {};
      tema[m] = v ? Object.assign({}, v[m] || {}) : {};
      savePrefs({tema});
      brukTema();
      tegnTema();
      toast('Oppsett: ' + b.dataset.forvalg);
    };
  });

  /* Every slider behaves the same: update the number beside it, store, apply.
     Redrawing the dialog on each step would fight the drag, so the panel is
     only rebuilt when something changes what it contains. */
  const kobleSkyv = (id, noekkel, enhet) => {
    const el = $(id);
    if (!el) return;
    el.oninput = () => {
      $(id + 'Tall').textContent = el.value + enhet;
      savePrefs({[noekkel]: +el.value});
      brukTema();
    };
  };
  kobleSkyv('temaSkala', 'uiSkala', ' %');
  kobleSkyv('temaRad', 'radHoyde', ' px');
  kobleSkyv('temaRunding', 'radius', ' px');
  kobleSkyv('bgStyrke', 'bgStyrke', ' %');
  kobleSkyv('bgUskarp', 'bgUskarp', ' px');
  kobleSkyv('bgMorkne', 'bgMorkne', ' %');
  kobleSkyv('flateGjennom', 'flateGjennom', ' %');
  /* These two decide whether text stays readable over the picture, and the
     warning that says so has to appear while the slider is being dragged -
     so they redraw the panel when released, not on every step. */
  ['bgMorkne', 'flateGjennom'].forEach(id => {
    const el = $(id);
    if (el) el.onchange = () => tegnTema();
  });

  const fiks = $('temaFiks');
  if (fiks) fiks.onclick = fiksLesbarhet;

  const modus = $('bgModus');
  if (modus) modus.onchange = () => { savePrefs({bgModus: modus.value}); brukTema(); };

  // Drop a file on the row, or paste one while it is focused.
  $('temaBody').querySelectorAll('.bilde-rad').forEach(rad => {
    const navn = rad.querySelector('[data-bilde]')?.dataset.bilde;
    if (!navn) return;
    rad.addEventListener('dragover', ev => {
      ev.preventDefault();
      rad.classList.add('slipp-her');
    });
    rad.addEventListener('dragleave', () => rad.classList.remove('slipp-her'));
    rad.addEventListener('drop', async ev => {
      ev.preventDefault();
      rad.classList.remove('slipp-her');
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      await taImot(navn, f, tegnTema);
    });
    rad.addEventListener('paste', async ev => {
      const el = [...(ev.clipboardData || {}).items || []]
        .find(x => x.kind === 'file' && /^image\//.test(x.type));
      if (!el) return;
      ev.preventDefault();
      await taImot(navn, el.getAsFile(), tegnTema);
    });
  });

  $('temaBody').querySelectorAll('[data-bilde]').forEach(btn => {
    btn.onclick = () => velgBilde(btn.dataset.bilde, tegnTema);
  });
  $('temaBody').querySelectorAll('[data-fjernbilde]').forEach(btn => {
    btn.onclick = () => { lagreBilde(btn.dataset.fjernbilde, null); brukTema(); tegnTema(); };
  });

  const tit = $('temaTittel');
  if (tit) tit.onchange = () => { savePrefs({tittel: tit.value.trim() || 'BACnet Explorer'}); brukTema(); };
  const und = $('temaUnder');
  if (und) und.onchange = () => { savePrefs({undertittel: und.value.trim()}); brukTema(); };
}

/* Everything the appearance is made of, so a theme file restores the look
   rather than a third of it. The colours were all that travelled before the
   pictures existed; exporting after setting a background produced a file that
   silently dropped the picture, the dimming, the surface transparency and the
   name in the top bar - which is most of what makes one install look unlike
   another. */
const UTSEENDE_TALL = ['uiSkala', 'radHoyde', 'radius', 'bgStyrke', 'bgUskarp',
                       'bgMorkne', 'flateGjennom'];
// The measured average of the background picture travels with it, so an
// imported theme can judge its own readability without re-measuring.
const UTSEENDE_LISTE = ['bgSnitt'];
const UTSEENDE_TEKST = ['bgModus', 'tittel', 'undertittel'];
const UTSEENDE_BILDER = ['bg', 'logo', 'banner'];

function temaEksporter() {
  const p = loadPrefs();
  const b = lastBilder();
  const data = {format: 'bacnet-explorer-tema', versjon: 2, tema: p.tema || {}, bilder: {}};
  UTSEENDE_TALL.forEach(k => { if (p[k] !== undefined) data[k] = p[k]; });
  UTSEENDE_TEKST.forEach(k => { if (p[k] !== undefined) data[k] = p[k]; });
  UTSEENDE_BILDER.forEach(k => { if (b[k]) data.bilder[k] = b[k]; });
  UTSEENDE_LISTE.forEach(k => { if (Array.isArray(p[k])) data[k] = p[k]; });

  const tekst = JSON.stringify(data, null, 2);
  const kb = Math.round(tekst.length / 1024);
  const blob = new Blob([tekst], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bacnet-explorer-tema.json';
  a.click();
  URL.revokeObjectURL(a.href);
  const antall = Object.keys(data.bilder).length;
  toast(`Temaet er lagret (${kb} kB${antall ? `, ${antall} bilde${antall > 1 ? 'r' : ''}` : ''})`);
}

function temaImporter() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        // Only take what belongs to a theme; a stray file should not be able
        // to write arbitrary keys into the preferences.
        const rent = {};
        for (const modus of ['dark', 'light']) {
          const kilde = (d.tema || {})[modus] || {};
          rent[modus] = {};
          TEMA_ALLE.forEach(k => { if (kilde[k]) rent[modus][k] = String(kilde[k]); });
        }
        const patch = {tema: rent};
        UTSEENDE_TALL.forEach(k => { if (d[k] !== undefined) patch[k] = Number(d[k]) || 0; });
        UTSEENDE_TEKST.forEach(k => { if (typeof d[k] === 'string') patch[k] = d[k].slice(0, 60); });
        UTSEENDE_LISTE.forEach(k => {
          if (Array.isArray(d[k]) && d[k].length === 3) patch[k] = d[k].map(Number);
        });
        savePrefs(patch);

        // Only data: URIs for images, and only the three slots that exist. A
        // theme file is something people mail each other, and it should not be
        // able to point the page at an address off this machine.
        let bilder = 0;
        UTSEENDE_BILDER.forEach(k => {
          const v = (d.bilder || {})[k];
          if (typeof v === 'string' && /^data:image\//.test(v)) {
            if (lagreBilde(k, v)) bilder++;
          }
        });

        brukTema();
        tegnTema();
        toast(`Temaet er hentet fra fil${bilder ? ` (${bilder} bilde${bilder > 1 ? 'r' : ''})` : ''}`);
      } catch {
        toast('Kunne ikke lese temafilen', true);
      }
    };
    r.readAsText(f);
  };
  inp.click();
}

/* ---------------------------------------------------------- command palette */
/* Everything the tool can do, reachable by typing part of its name. The
   features are spread across three menus and a dozen shortcuts - fine once
   you know them, a wall if you use this a few times a year. Devices are in
   here too: on a site with twenty controllers, typing part of a name beats
   hunting down the list.

   `when` decides whether an action is offered at all, so the list never
   presents something that would only fail. */
function commands() {
  const harEnhet = () => !!S.activeDev;
  const harPunkter = () => S.points.length > 0;
  const c = [];
  const add = (gruppe, etikett, kjor, o = {}) =>
    c.push(Object.assign({gruppe, etikett, kjor}, o));

  add('Naviger', 'Skann IP-omrade', () => { closeCmd(); $('rangeInput').focus(); $('rangeInput').select(); });
  add('Naviger', 'Sok i alle leste enheter', () => { closeCmd(); openGlobal(); }, {hint: 'Ctrl+F'});
  add('Naviger', 'Sok i punkter pa denne enheten', () => { closeCmd(); $('q').focus(); }, {hint: '/', when: harPunkter});

  add('Filter', 'Vis alle punkter', () => {
    S.filters = {q: '', type: '', flag: '', writable: false, diff: false};
  S.sortMer = [];
    $('q').value = ''; $('typeSel').value = ''; renderPoints(); syncMenuStates();
  }, {when: () => harPunkter() && (S.filters.flag || S.filters.writable || S.filters.diff || S.filters.q || S.filters.type)});

  for (const [f, m] of Object.entries(FLAGS)) {
    add('Filter', 'Kun ' + m.label, () => {
      settFlaggfilter(S.filters.flag === f ? '' : f);
    }, {when: harPunkter,
        tilstand: () => S.filters.flag === f ? 'pa' : '',
        undertekst: () => { const n = flagCounts(S.points)[f]; return n ? n + ' punkter' : 'ingen'; }});
  }
  add('Filter', 'Kun skrivbare', () => { S.filters.writable = !S.filters.writable; renderPoints(); syncMenuStates(); },
      {when: harPunkter, tilstand: () => S.filters.writable ? 'pa' : ''});
  add('Filter', 'Kun endret siden snapshot', () => { S.filters.diff = !S.filters.diff; renderPoints(); syncMenuStates(); },
      {when: () => harPunkter() && !!S.snapshot, tilstand: () => S.filters.diff ? 'pa' : ''});

  add('Handling', 'Les punktene pa nytt', () => {
    const ip = S.activeDev.address;
    delete S.cache[ip]; delete S.cacheMeta[ip]; closeCmd(); selectDevice(ip, {force: true});
  }, {when: harEnhet});
  add('Handling', 'Start/stopp live-oppdatering', () => { S.live ? stopPolling() : startPolling(); },
      {hint: 'L', when: harPunkter, tilstand: () => S.live ? 'pa' : ''});
  add('Handling', 'Sok etter enheter na', () => { closeCmd(); rescanOnce(true); },
      {when: () => S.connected && !!$('rangeInput').value.trim(),
       undertekst: () => S.devices.length + ' kjent'});
  add('Handling', 'Overvak nettet kontinuerlig', () => $('rescanBtn').click(),
      {tilstand: () => RESCAN.on ? 'pa' : '',
       undertekst: () => RESCAN.on ? RESCAN.runs + ' runder' : 'av'});
  add('Handling', 'Ta snapshot', () => takeSnapshot(), {when: harPunkter});
  add('Handling', 'Frigi valgte punkter', () => { closeCmd(); releaseSelected(); },
      {when: () => harPunkter() && selectedVisible().some(p => p.writable) && !S.readOnly,
       undertekst: () => selectedVisible().filter(p => p.writable).length + ' valgt'});
  add('Handling', 'Lesemodus - blokker all skriving', () => $('roBtn').click(),
      {tilstand: () => S.readOnly ? 'pa' : ''});

  add('Visning', 'Vis alle objekttyper (ukeprogram, kalender, trendlogg)',
      () => { closeCmd(); $('allTypesBtn').click(); },
      {tilstand: () => loadPrefs().allTypes === true ? 'pa' : '',
       undertekst: () => { const t = S.typeCounts || {};
         const skjult = Object.entries(t).filter(([k]) => !VERDITYPER.has(k))
                              .reduce((n,[,v]) => n+v, 0);
         return skjult ? skjult + ' objekter skjult na' : ''; }});
  add('Visning', 'Innstillinger...', () => { closeCmd(); openTema(); });
  add('Eksport', 'Taggeinnstillinger for dette anlegget...',
      () => { closeCmd(); openTema('tagging'); });
  add('Visning', 'Utseende — farger, bilder og størrelse...',
      () => { closeCmd(); openTema('utseende'); });
  add('Visning', 'Kolonner...', () => { closeCmd(); openCols(); });
  add('Visning', 'Grupper enheter (leverandor / IP-omrade / av)', () => $('groupBtn').click(),
      {tilstand: () => GROUP_NAVN[loadPrefs().groupBy || (loadPrefs().groupVendor === false ? 'none' : 'vendor')],
       undertekst: () => { const lev = new Set(S.devices.map(d => vendorOf(d.vendor_name, d.vendor_id).label)).size;
                           const omr = new Set(S.devices.map(d => d._range).filter(Boolean)).size;
                           return `${lev} leverandorer${omr > 1 ? ', ' + omr + ' omrader' : ''}`; },
       when: () => S.devices.length > 0});
  add('Visning', 'Forkort punktnavn', () => $('shortBtn').click(),
      {tilstand: () => loadPrefs().shortNames !== false ? 'pa' : '',
       undertekst: () => S.namePrefix || 'ingen felles start'});
  add('Visning', 'Lys visning', () => $('themeBtn').click(),
      {tilstand: () => document.documentElement.getAttribute('data-theme') === 'light' ? 'pa' : ''});
  add('Visning', 'Tett visning', () => $('denseBtn').click(),
      {tilstand: () => document.body.classList.contains('dense') ? 'pa' : ''});
  add('Visning', 'Forhandsles enheter i bakgrunnen', () => $('preBtn').click(),
      {tilstand: () => PRE.on ? 'pa' : ''});
  add('Visning', 'Stor visning av valgt punkt', () => { closeCmd(); openZoom(); },
      {hint: 'Z', when: () => !!S.selected});

  add('Nettverk', 'Sammenlikn to enheter…', () => { closeCmd(); openSammenlign(); },
      {when: () => S.devices.filter(d => (S.cache[d.address] || []).length).length >= 2});

  add('Eksport', 'Sesjonsrapport…', () => { closeCmd(); visSesjonsrapport(); });
  add('Eksport', 'Endret siden snapshot…', () => { closeCmd(); visSnapshotrapport(); },
      {when: () => !!S.snapshot});

  add('Eksport', 'CSV...', () => { closeCmd(); exportCSV(); }, {when: harPunkter});
  add('Eksport', 'EDE 2.3...', () => { closeCmd(); exportEDE(); }, {when: harPunkter});
  add('Eksport', 'Sammenlign med EDE-fil...', () => { closeCmd(); startEdeCompare(); }, {when: harPunkter});
  add('Eksport', 'Skrivelogg', () => { closeCmd(); showWriteLog(); });
  add('Handling', 'Ukeprogram — vis og rediger', () => { closeCmd(); $('schBtn').click(); }, {when: harEnhet});

  add('Anlegg', 'Lagre anlegg', () => { closeCmd(); saveProject(); }, {when: () => S.devices.length > 0});
  add('Anlegg', 'Anlegg jeg har vært på...', () => { closeCmd(); openMinne(); });
  add('Anlegg', 'Apne anlegg...', () => { closeCmd(); openProjects(); });
  add('Anlegg', 'Koble til pa nytt', () => $('reconnBtn').click());

  for (const d of S.devices) {
    const ip = d.address;
    add('Enheter', (d.device_instance == null ? '?' : d.device_instance) + ' - ' + (d.object_name || ip),
        () => { closeCmd(); selectDevice(ip); },
        {undertekst: () => ip + (S.cache[ip] ? ' - ' + S.cache[ip].length + ' pkt' : '')});
  }
  return c.filter(x => !x.when || x.when());
}

let CMD_VALG = 0;

function settCmdSeg(seg) {
  CMD_SEG = seg;
  document.querySelectorAll('.cmd-segk').forEach(b =>
    b.classList.toggle('sel', b.dataset.seg === seg));
  CMD_VALG = 0;
  renderCmd();
}

function openCmd() {
  closeMenus();
  CMD_SEG = 'alt';
  document.querySelectorAll('.cmd-segk').forEach(b =>
    b.classList.toggle('sel', b.dataset.seg === 'alt'));
  $('cmdOverlay').hidden = false;
  $('cmdInput').value = '';
  CMD_VALG = 0;
  $('cmdList').classList.add('kaskade');
  renderCmd();
  $('cmdInput').focus();
}
function closeCmd() { $('cmdOverlay').hidden = true; }

/* Loose enough that "frgi" finds "Frigi valgte punkter", strict enough that
   "tett" does not land on "Kun overstyrte" - which it did when every field was
   thrown into one string and any subsequence counted as a hit ("Filter Kun
   overstyrte" contains t, e, t, t in order). Matches are scored and the label
   is what counts most; the group and the subtext only break ties. */
function cmdScore(x, q) {
  const etikett = x.etikett.toLowerCase();
  const ekstra = (x.gruppe + ' ' + (x.undertekst ? x.undertekst() : '')).toLowerCase();

  if (etikett.startsWith(q)) return 100;
  const i = etikett.indexOf(q);
  if (i >= 0) return 80 - Math.min(i, 20);          // earlier in the label is better
  if (ekstra.includes(q)) return 40;

  // Subsequence, label only - never across the group name.
  let j = 0;
  for (const ch of q) { j = etikett.indexOf(ch, j); if (j < 0) return -1; j++; }
  // A short query matching a long label this loosely is usually noise.
  return 25 - Math.min(20, Math.round(etikett.length / q.length));
}

/* Paletten husker hva du faktisk bruker.

   Et fuzzy-treff alene rangerer etter hvor godt bokstavene passer, ikke etter
   hva du gjor ti ganger om dagen. Bruk teller med som et lite paaslag - nok
   til at "Ta snapshot" legger seg over "Ta bort snapshot" naar du alltid tar
   det foerste, og for lite til aa dytte et aapenbart bedre tekstreff ned.

   Tellinga ligger i prefs og er ikke knyttet til anlegg. */
function cmdBruk() {
  const b = loadPrefs().cmdBruk;
  return (b && typeof b === 'object') ? b : {};
}

function tellCmdBruk(etikett) {
  if (!etikett) return;
  const b = cmdBruk();
  b[etikett] = (b[etikett] || 0) + 1;
  // Et tak, saa en handling du brukte mye i fjor ikke ligger evig paa toppen.
  if (b[etikett] > 50) for (const k in b) b[k] = Math.round(b[k] * 0.6);
  savePrefs({cmdBruk: b});
}

function cmdTreff() {
  const q = $('cmdInput').value.trim().toLowerCase();
  const alle = commands();
  const bruk = cmdBruk();
  // Uten soek: mest brukte foerst, resten i sin egen rekkefolge.
  if (!q) {
    return alle.slice().sort((a, b2) => (bruk[b2.etikett] || 0) - (bruk[a.etikett] || 0));
  }
  const handlinger = alle
    .map(x => ({x, s: cmdScore(x, q) + Math.min(6, (bruk[x.etikett] || 0)) * 0.8}))
    .filter(o => o.s >= 0)
    .sort((a, b2) => b2.s - a.s)
    .map(o => o.x);

  // Segmentet avgjor hva som er med. "Alt" viser handlinger foerst - de er
  // faerre og mer presise - og punktene under.
  const seg = CMD_SEG;
  if (seg === 'handling') return handlinger;
  if (seg === 'punkt') return cmdPunkter(q);
  if (seg === 'enhet') return cmdEnheter(q);
  return handlinger.concat(cmdEnheter(q), cmdPunkter(q));
}

function renderCmd() {
  const treff = cmdTreff();
  const box = $('cmdList');
  if (!treff.length) { box.innerHTML = '<div class="gs-empty">Ingen handling matcher</div>'; return; }
  CMD_VALG = Math.max(0, Math.min(CMD_VALG, treff.length - 1));

  // With a query the list is in score order, so group headings would break it
  // into meaningless fragments; they only make sense on the unfiltered list.
  const sokt = !!$('cmdInput').value.trim();
  let html = '';
  let forrige = '';
  treff.forEach((x, i) => {
    if (!sokt && x.gruppe !== forrige) { html += '<div class="cmd-group">' + esc(x.gruppe) + '</div>'; forrige = x.gruppe; }
    const st = x.tilstand ? x.tilstand() : '';
    const und = x.undertekst ? x.undertekst() : '';
    html += '<button class="cmd-item" data-i="' + i + '" aria-selected="' + (i === CMD_VALG) + '">'
      + (x.merke ? '<span class="cmd-merke">' + esc(x.merke) + '</span>' : '')
      + '<span class="cmd-label">' + esc(x.etikett)
      + (und ? '<span class="cmd-sub">' + esc(und) + '</span>' : '')
      + (sokt ? '<span class="cmd-sub">' + esc(x.gruppe) + '</span>' : '') + '</span>'
      + (x.verdi ? '<span class="cmd-verdi">' + esc(x.verdi) + '</span>' : '')
      + (st ? '<span class="cmd-state">' + esc(st) + '</span>' : '')
      + (x.hint ? '<span class="cmd-hint">' + esc(x.hint) + '</span>' : '')
      + '</button>';
  });
  box.innerHTML = html;
  box.querySelectorAll('.cmd-item').forEach(b => {
    b.onclick = () => kjorCmd(treff[+b.dataset.i]);
    b.onmousemove = () => { if (CMD_VALG !== +b.dataset.i) { CMD_VALG = +b.dataset.i; merkValgt(); } };
  });
  merkValgt();
}

function merkValgt() {
  const items = [...$('cmdList').querySelectorAll('.cmd-item')];
  items.forEach((b, i) => b.setAttribute('aria-selected', i === CMD_VALG));
  const v = items[CMD_VALG];
  if (v) v.scrollIntoView({block: 'nearest'});
}

function kjorCmd(x) {
  if (!x) return;
  tellCmdBruk(x.etikett);
  try { x.kjor(); } catch (e) { toast(e.message, true); }
  // Toggles keep the palette open so several can be set in one pass; anything
  // that opens its own surface closes the palette in its own handler.
  if (!$('cmdOverlay').hidden) renderCmd();
}

/* -------------------------------------------------------------- column setup */
/* The picker names each column for its own list, but never touches the table's
   headings - those stay exactly as they have always read. */
function colState() {
  const prefs = loadPrefs();
  const kjent = COLS.map(c => c.k);
  const rekke = Array.isArray(prefs.colOrder) ? prefs.colOrder.filter(k => kjent.includes(k)) : [];
  for (const k of kjent) if (!rekke.includes(k)) rekke.push(k);
  return {rekke, skjult: new Set(prefs.colHidden || [])};
}

function openCols() {
  $('colsOverlay').hidden = false;
  renderColsList();
}
function closeCols() { $('colsOverlay').hidden = true; }

function renderColsList() {
  const {rekke, skjult} = colState();
  const box = $('colsList');
  box.innerHTML = rekke.map(k => {
    const c = COL_BY_KEY[k];
    return `<div class="cols-row" draggable="true" data-k="${k}">
      <span class="cols-grip" aria-hidden="true">⠿</span>
      <label class="cols-name"><input type="checkbox" data-vis="${k}"${
        skjult.has(k) ? '' : ' checked'}> ${esc(c.menu)}</label>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-vis]').forEach(inp => inp.onchange = () => {
    const s2 = new Set(loadPrefs().colHidden || []);
    inp.checked ? s2.delete(inp.dataset.vis) : s2.add(inp.dataset.vis);
    // Hiding every column would leave a table with nothing in it.
    if (s2.size >= COLS.length) { inp.checked = true; toast('Minst én kolonne må vises', true); return; }
    savePrefs({colHidden: [...s2]});
    renderPoints();
  });

  let dratt = null;
  box.querySelectorAll('.cols-row').forEach(row => {
    row.ondragstart = e => { dratt = row; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragend = () => { dratt = null; box.querySelectorAll('.cols-row').forEach(r => r.classList.remove('dragging','over')); };
    row.ondragover = e => { e.preventDefault(); if (dratt && dratt !== row) row.classList.add('over'); };
    row.ondragleave = () => row.classList.remove('over');
    row.ondrop = e => {
      e.preventDefault();
      row.classList.remove('over');
      if (!dratt || dratt === row) return;
      const ny = [...box.querySelectorAll('.cols-row')].map(r => r.dataset.k);
      const fra = ny.indexOf(dratt.dataset.k);
      ny.splice(fra, 1);
      ny.splice(ny.indexOf(row.dataset.k) + (fra < ny.indexOf(row.dataset.k) ? 1 : 0), 0, dratt.dataset.k);
      savePrefs({colOrder: ny});
      renderColsList();
      renderPoints();
    };
  });
}

/* The search key was rebuilt and lowercased for every point on every search.
   Measured on a 5000-point controller that made a single filter pass take
   1034 ms - a full second of frozen UI after each pause in typing. Built once
   per point instead and kept on it; the values it is made of do not change
   while the device is loaded. */
/* The label the device gives for the state it is currently in. Read in the
   background pass, so it is present for display, for search and for export
   without anyone waiting on it. */
function stateTextFor(p) {
  if (!Array.isArray(p.state_text) || !p.state_text.length) return '';
  // A multi-state point is 1-based; a binary one answers "active"/"inactive"
  // and its two labels are inactive first. Subtracting 1 from "active" gives
  // NaN, which is why a binary point showed the raw word and not its label.
  if (typeof p.value === 'number') return p.state_text[p.value - 1] || '';
  if (p.value === 'inactive') return p.state_text[0] || '';
  if (p.value === 'active') return p.state_text[1] || '';
  return '';
}

function hayFor(p) {
  if (p._hay === undefined) {
    p._hay = ((p.name || '') + ' ' + (p.description || '') + ' ' + p.objid + ' '
              + (Array.isArray(p.state_text) ? p.state_text.join(' ') : '')).toLowerCase();
  }
  return p._hay;
}

/* Soek med flere ord: alle maa treffe, uansett rekkefolge.

   Punktnavn er satt sammen av anlegg, system og komponent i en rekkefolge man
   ikke husker - "+KG32=360.001-RT601". Et sammenhengende soek fant bare det du
   skrev i riktig rekkefolge, saa du maatte kjenne navnet for aa lete etter det.

   Naa er mellomrom "og": KG32 RT601 finner alle RT601 paa KG32, uansett hva
   som staar mellom dem. I tillegg:
     -ord      utelater treff som inneholder ordet
     "to ord"  soeker etter dem som en sammenhengende frase

   Ordene tolkes en gang per soek, ikke en gang per punkt - paa 2418 punkter er
   det forskjellen paa en tolkning og to tusen. */
function sokeOrd(q) {
  const ja = [], nei = [];
  const re = /(-?)"([^"]*)"|(-?)(\S+)/g;
  let m;
  while ((m = re.exec(q)) !== null) {
    const negativ = (m[1] || m[3]) === '-';
    const ord = (m[2] !== undefined ? m[2] : m[4]).toLowerCase().trim();
    if (!ord) continue;
    (negativ ? nei : ja).push(ord);
  }
  return (ja.length || nei.length) ? {ja, nei} : null;
}

function sokTreff(hay, ord) {
  for (const o of ord.nei) if (hay.includes(o)) return false;
  for (const o of ord.ja)  if (!hay.includes(o)) return false;
  return true;
}

/* ---------------------------------------------------------------- filtering */
function visiblePoints() {
  const {q, type, flag, writable, diff} = S.filters;
  const ord = sokeOrd(q.trim().toLowerCase());
  let out = S.points.filter(p => {
    if (type && p.type !== type) return false;
    if (flag && !hasFlag(p, flag)) return false;
    if (writable && !p.writable) return false;
    if (diff && !isDiff(p)) return false;
    if (ord && !sokTreff(hayFor(p), ord)) return false;
    return true;
  });
  /* Sortering paa flere kolonner.

     "Type, saa navn" er den naturlige maaten aa lese en punktliste paa - alle
     temperaturene sammen, i navnerekkefolge. Med en kolonne om gangen maatte
     man velge hvilken av dem man ville ha.

     S.sort er fortsatt den foerste noekkelen, og S.sortMer er de neste. Shift
     paa en kolonneoverskrift legger den til i stedet for aa erstatte. */
  const noekler = [S.sort].concat(S.sortMer || []);
  const felt = (p, key) => {
    if (key === 'objid') return p.type + String(p.instance).padStart(9, '0');
    const v = p[key];
    return (v === null || v === undefined) ? '' : v;
  };
  out.sort((a, b) => {
    for (const {key, dir} of noekler) {
      const x = felt(a, key), y = felt(b, key);
      let c;
      if (typeof x === 'number' && typeof y === 'number') c = x - y;
      else c = String(x).localeCompare(String(y), 'no', {numeric: true});
      if (c) return c * dir;
    }
    return 0;
  });
  return out;
}

function isDiff(p) {
  if (!S.snapshot || !S.activeDev) return false;
  const k = wkey(S.activeDev.address, p.objid);
  return k in S.snapshot && S.snapshot[k] !== p.value;
}

/* ------------------------------------------------------------ render points */
/* Both the header and the body are generated from this list, so the order can
   be changed without the two drifting apart. `menu` is only what the column
   picker calls it — the table's own headings are left exactly as they were. */
const COLS = [
  {k: 'objid', label: 'Objekt', menu: 'Objekt', cls: 'c-obj', col: 'w-obj',
   cell: p => `<span class="type-tag ${TYPE_CLASS[p.type] || ''}">${shortType(p.type)}</span><span class="inst">${p.instance}</span>`},
  {k: 'name', label: 'Navn', menu: 'Navn', cls: 'c-name', col: '',
   attrs: p => ` title="${esc(p.name || '')}"`,
   cell: p => esc(shortName(p) || '—')},
  {k: 'value', label: 'Verdi', menu: 'Verdi', cls: 'c-val', col: 'w-val',
   extraCls: p => fmtVal(p.value).c + (p.unread ? ' unread' : ''),
   attrs: p => p.unread ? ' title="Ingen svar fra enheten på dette punktet"' : '',
   cell: p => {
     if (p.unread) return '?';
     // A multi-state reading of "3" says nothing; the device already told us
     // it means "Hoy hastighet", so show that and keep the number alongside.
     const tekst = stateTextFor(p) || schedTekst(p) || tvungetTekst(p);
     return tekst ? `${esc(String(p.value))}<span class="st-txt">${esc(tekst)}</span>`
                  : esc(fmtVal(p.value).t);
   }},
  {k: '_u', label: '', menu: 'Enhet', cls: 'c-unit', col: 'w-unit', nosort: true,
   cell: p => esc(p.unit_symbol || '')},
  {k: 'description', label: 'Beskrivelse', menu: 'Beskrivelse', cls: 'c-desc', col: '',
   attrs: p => ` title="${esc(p.description || '')}"`,
   cell: p => esc(p.description || '')},
];
const COL_BY_KEY = Object.fromEntries(COLS.map(c => [c.k, c]));

/* Order and visibility are the user's, kept across sessions. Anything saved
   that no longer exists is dropped, and anything new is appended, so an older
   saved layout cannot make a column unreachable. */
function orderedCols() {
  const lagret = loadPrefs().colOrder;
  const kjent = COLS.map(c => c.k);
  const rekke = Array.isArray(lagret) ? lagret.filter(k => kjent.includes(k)) : [];
  for (const k of kjent) if (!rekke.includes(k)) rekke.push(k);
  const skjult = new Set(loadPrefs().colHidden || []);
  return rekke.map(k => COL_BY_KEY[k]).filter(c => !skjult.has(c.k));
}

// The description column must be dropped from the markup entirely when the
// pane is narrow. Hiding it with CSS alone is not enough: under
// table-layout:fixed its <col> still claims a share of the free width, which
// starves the name column down to a couple of characters.
const DESC_MIN_WIDTH = 560;
const MAX_ROWS = 500;

/* Chip-raden over tabellen: hvert aktive filter, med krysset som slaar det av.

   Filtrene laa i en meny med haker, og de ble bare nevnt naar ingenting matchet.
   En filtrert liste MED treff saa ut som hele lista - og et punkt som er
   filtrert bort ser ut som et punkt som ikke finnes. */
function tegnFilterChips() {
  const boks = document.getElementById('filterChips');
  if (!boks) return;
  const f = S.filters;
  const chips = [];
  if (f.q.trim())  chips.push({k: 'q',        e: 'søk',      v: f.q.trim()});
  if (f.type)      chips.push({k: 'type',     e: 'type',     v: f.type});
  if (f.flag)      chips.push({k: 'flag',     e: 'status',   v: FLAGS[f.flag] ? FLAGS[f.flag].label : f.flag});
  if (f.writable)  chips.push({k: 'writable', e: 'kun',      v: 'skrivbare'});
  if (f.diff)      chips.push({k: 'diff',     e: 'kun',      v: 'endret siden snapshot'});

  if (!chips.length) { boks.hidden = true; boks.innerHTML = ''; return; }
  boks.hidden = false;
  boks.innerHTML = chips.map(c =>
    `<span class="fchip">${esc(c.e)} <b>${esc(c.v)}</b>` +
    `<button class="fchip-x" data-av="${c.k}" title="Fjern dette filteret"` +
    ` aria-label="Fjern filter ${esc(c.e)} ${esc(c.v)}">✕</button></span>`).join('')
    + (chips.length > 1
        ? '<button class="fchip-alle" id="fchipAlle">Nullstill alle</button>' : '');

  boks.querySelectorAll('[data-av]').forEach(b2 => b2.onclick = () => {
    const k = b2.dataset.av;
    if (k === 'q') { S.filters.q = ''; const q = document.getElementById('q'); if (q) q.value = ''; }
    else if (k === 'type') { S.filters.type = ''; const s2 = document.getElementById('typeSel'); if (s2) s2.value = ''; }
    else if (k === 'flag') S.filters.flag = '';
    else S.filters[k] = false;
    syncMenuStates();
    flyttRader(document.getElementById('pointsWrap'), renderPoints);
  });
  const alle = document.getElementById('fchipAlle');
  if (alle) alle.onclick = () => {
    S.filters = {q: '', type: '', flag: '', writable: false, diff: false};
  S.sortMer = [];
    const q = document.getElementById('q'); if (q) q.value = '';
    const s2 = document.getElementById('typeSel'); if (s2) s2.value = '';
    syncMenuStates();
    flyttRader(document.getElementById('pointsWrap'), renderPoints);
  };
}

/* ------------------------------------------------------- lagrede visninger */
/* Et navngitt oppsett av filter, sortering og kolonner.

   Paa et anlegg gjor man det samme utvalget om igjen hver gang: "alt som er i
   alarm", "alle settpunkt", "det som er overstyrt". I dag maa det settes opp
   paa nytt hver eneste okt - fire klikk og et soek for aa komme tilbake til
   noe du saa paa i gaar.

   Visningene ligger i prefs, altsaa per maskin og ikke per anlegg. Det er med
   vilje: maaten DU leser et anlegg paa er den samme uansett hvilket anlegg det
   er, og et filter som "kun overstyrte" gir mening overalt. */
function hentVisninger() {
  const v = loadPrefs().visninger;
  return Array.isArray(v) ? v : [];
}

function naavaerendeVisning() {
  const p = loadPrefs();
  return {
    filters: {...S.filters},
    sort: {...S.sort},
    colHidden: p.colHidden || [],
    colOrder: p.colOrder || [],
  };
}

function lagreVisning(navn) {
  navn = (navn || '').trim();
  if (!navn) return false;
  const alle = hentVisninger().filter(v => v.navn !== navn);
  alle.push({navn, ...naavaerendeVisning()});
  // Nyeste sist, men lista vises alfabetisk - man leter etter navn, ikke tid.
  alle.sort((a, b) => a.navn.localeCompare(b.navn, 'no'));
  savePrefs({visninger: alle});
  return true;
}

function slettVisning(navn) {
  savePrefs({visninger: hentVisninger().filter(v => v.navn !== navn)});
}

function brukVisning(navn) {
  const v = hentVisninger().find(x => x.navn === navn);
  if (!v) return false;
  S.filters = {q: '', type: '', flag: '', writable: false, diff: false, ...(v.filters || {})};
  if (v.sort) S.sort = {...v.sort};
  savePrefs({colHidden: v.colHidden || [], colOrder: v.colOrder || []});
  const q = $('q'); if (q) q.value = S.filters.q || '';
  const ts = $('typeSel'); if (ts) ts.value = S.filters.type || '';
  syncMenuStates();
  flyttRader($('pointsWrap'), renderPoints);
  toast('Visning: ' + navn);
  return true;
}

/* Menyen med visningene. Bygges hver gang den apnes, saa den alltid viser det
   som faktisk ligger lagret. */
function tegnVisninger() {
  const pop = $('visPop');
  if (!pop) return;
  const alle = hentVisninger();
  const aktiv = JSON.stringify(naavaerendeVisning().filters);
  let h = '';
  if (alle.length) {
    h += '<div class="menu-gruppe">Lagrede</div>';
    h += alle.map(v => {
      const lik = JSON.stringify({q: '', type: '', flag: '', writable: false,
                                  diff: false, ...(v.filters || {})}) === aktiv;
      return `<button class="menu-item" data-vis="${esc(v.navn)}">${esc(v.navn)}`
        + `<span class="menu-state">${lik ? '✓' : ''}</span>`
        + `<span class="vis-slett" data-slett="${esc(v.navn)}" title="Slett visningen">✕</span>`
        + '</button>';
    }).join('');
    h += '<div class="menu-sep"></div>';
  } else {
    h += '<div class="menu-gruppe">Ingen lagret ennå</div>';
  }
  h += '<button class="menu-item" id="visLagre">Lagre nåværende…</button>';
  pop.innerHTML = h;

  pop.querySelectorAll('[data-vis]').forEach(b3 => b3.onclick = e => {
    if (e.target.dataset.slett) return;      // krysset handteres under
    brukVisning(b3.dataset.vis);
    closeMenus();
  });
  pop.querySelectorAll('[data-slett]').forEach(x => x.onclick = e => {
    e.stopPropagation();
    slettVisning(x.dataset.slett);
    tegnVisninger();
  });
  const lagre = $('visLagre');
  if (lagre) lagre.onclick = () => {
    const navn = prompt('Navn på visningen:', forslagVisningsnavn());
    if (navn && lagreVisning(navn)) { toast('Visning lagret: ' + navn.trim()); }
    tegnVisninger();
  };
}

/* Et forslag basert paa hva som faktisk er valgt - de fleste visninger heter
   det samme som filteret sitt. */
function forslagVisningsnavn() {
  const f = S.filters, d = [];
  if (f.flag && FLAGS[f.flag]) d.push(FLAGS[f.flag].label);
  if (f.writable) d.push('skrivbare');
  if (f.diff) d.push('endret');
  if (f.type) d.push(f.type);
  if (f.q.trim()) d.push('«' + f.q.trim() + '»');
  return d.length ? d.join(' + ') : 'Min visning';
}

/* Feiltilstand med vei videre. */
function feilVisning(ip, tittel, detalj) {
  const wrap = $('pointsWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div class="empty feilrute">'
    + `<div class="feil-tittel">${esc(tittel)}</div>`
    + `<div class="feil-detalj">${esc(detalj || '')}</div>`
    + `<div class="feil-adr">${esc(ip)}</div>`
    + '<div class="feil-knapper">'
    + '<button class="btn primary" id="feilRetry">Prøv igjen</button>'
    + '<button class="btn" id="feilTilbake">Velg en annen enhet</button>'
    + '</div></div>';
  const r = $('feilRetry');
  if (r) r.onclick = () => selectDevice(ip);
  const tb = $('feilTilbake');
  if (tb) tb.onclick = () => {
    S.activeDev = null; S.points = []; S.pointIndex = new Map();
    renderCtx(); renderPoints(); renderInspector();
    const f = document.querySelector('#devList .dev');
    if (f) f.focus();
  };
}

/* Sekvenser: to tastetrykk etter hverandre i stedet for en akkord.

   g d, g p, g o - "gaa til enheter / punkter / overvaaking". Lettere aa lære
   og huske enn Ctrl+Alt-kombinasjoner, og de krasjer ikke med nettleseren.

   Vinduet er kort med vilje: skriver du g i et soekefelt skal det bli en g. */
let SEKV = {tast: '', tid: 0};
const SEKV_VINDU = 900;

function sekvensTast(e) {
  // Aldri naar noen skriver.
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const naa = Date.now();
  const k = e.key.toLowerCase();
  if (SEKV.tast === 'g' && naa - SEKV.tid < SEKV_VINDU) {
    SEKV = {tast: '', tid: 0};
    /* Maalene maa kunne ta imot fokus. Et enhetskort er en button og gaar av
       seg selv; en tabellrad og overvaakingslista er ikke fokuserbare, saa der
       er det ruta som faar fokus - den har tabindex="-1" nettopp for dette. */
    const fokus = (sel) => { const el = document.querySelector(sel); if (el) el.focus(); return !!el; };
    if (k === 'd') { fokus('#devList .dev') || fokus('#devList'); return true; }
    if (k === 'p') {
      fokus('#pointsWrap');
      // Er ingen rad valgt, velg den foerste - ellers er "gaa til punkter" et
      // hopp uten et sted aa staa.
      if (!S.selected && S.points.length) {
        const f = visiblePoints()[0];
        if (f) selectPoint(f.objid);
      }
      return true;
    }
    if (k === 'o') { fokus('#watchList'); return true; }
    if (k === 's') { const q = $('q'); if (q) { q.focus(); q.select(); } return true; }
    return false;
  }
  if (k === 'g') { SEKV = {tast: 'g', tid: naa}; return true; }
  SEKV = {tast: '', tid: 0};
  return false;
}

/* ------------------------------------------------- C1: sammenlikne enheter */
/* Samme aggregattype paa to plan - hva er ulikt?

   Det er spoersmaalet man staar med naar det ene virker og det andre ikke, og
   i dag maa man aapne den ene, notere, aapne den andre og huske. Med 2418
   punkter er det ikke en jobb man gjor.

   Punktene kobles paa navn med enhetens eget prefiks fjernet. Navnestrukturen
   gjor det mulig: +KG32=360.001-RT601 og +KG32=360.002-RT601 er samme punkt
   paa to systemer, og felles-prefikset for HVER enhet er nettopp den delen som
   skiller dem. Da sitter man igjen med RT601 paa begge. */
function cmpNoekkel(p, prefiks) {
  let n = (p.name || '').trim();
  if (prefiks && n.toLowerCase().startsWith(prefiks.toLowerCase())) {
    n = n.slice(prefiks.length);
  }
  /* Systemnummeret maa ogsaa vekk.

     commonNamePrefix kutter ved siste skilletegn, saa av +KG32=360.001-RT601
     blir prefikset "+KG32=360." og "001-RT601" staar igjen. Den funksjonen er
     laget for aa korte ned navn i visninga, ikke for aa koble to enheter - og
     det er nettopp systemnummeret som SKILLER dem.

     Derfor fjernes en innledende serie med tall, punktum, bindestrek eller
     understrek i tillegg. 001-RT601 blir RT601, mens -SP-suffikset staar
     urort fordi det ligger bakerst. */
  const kortet = n.replace(/^[0-9.\-_ ]+/, '');
  if (kortet) n = kortet;
  // Uten navn er objekt-IDen det eneste som finnes, og den er ofte lik paa
  // to like regulatorer.
  return (n || p.objid).toLowerCase();
}

function sammenlignData(ipA, ipB) {
  const A = S.cache[ipA] || [], B = S.cache[ipB] || [];
  const pa = commonNamePrefix(A), pb = commonNamePrefix(B);
  const kartA = new Map(), kartB = new Map();
  for (const p of A) kartA.set(cmpNoekkel(p, pa), p);
  for (const p of B) kartB.set(cmpNoekkel(p, pb), p);

  const noekler = [...new Set([...kartA.keys(), ...kartB.keys()])].sort();
  const rader = [];
  let ulike = 0, bareA = 0, bareB = 0, like = 0;
  for (const k of noekler) {
    const a = kartA.get(k), b = kartB.get(k);
    let art;
    if (a && !b) { art = 'bare-a'; bareA++; }
    else if (!a && b) { art = 'bare-b'; bareB++; }
    else {
      // Tall sammenliknes som tall - "21" og "21.0" er ikke et avvik.
      const va = a.value, vb = b.value;
      const talla = typeof va === 'number' && typeof vb === 'number';
      const ulik = talla ? Math.abs(va - vb) > 1e-9 : String(va) !== String(vb);
      if (ulik) { art = 'ulik'; ulike++; } else { art = 'lik'; like++; }
    }
    rader.push({k, a, b, art});
  }
  return {rader, ulike, bareA, bareB, like, prefiksA: pa, prefiksB: pb};
}

function tegnSammenlign() {
  const ipA = $('cmpA').value, ipB = $('cmpB').value;
  const body = $('cmpBody'), meta = $('cmpMeta');
  if (!ipA || !ipB || ipA === ipB) {
    meta.textContent = 'Velg to forskjellige enheter';
    body.innerHTML = '<div class="gs-empty">To enheter som begge er lest.</div>';
    return;
  }
  const d = sammenlignData(ipA, ipB);
  const bareUlike = $('cmpBareUlike').checked;
  const vis = bareUlike ? d.rader.filter(r => r.art !== 'lik') : d.rader;

  meta.textContent = `${d.ulike} ulike verdier · ${d.bareA} bare i A · `
    + `${d.bareB} bare i B · ${d.like} like`;

  if (!vis.length) {
    body.innerHTML = '<div class="gs-empty">'
      + (bareUlike ? 'Ingen avvik — de to er like.' : 'Ingen felles punkter.')
      + '</div>';
    return;
  }
  const vFmt = (p) => p ? esc(fmtVal(p.value).t + ' ' + (p.unit_symbol || '')).trim()
                        : '<span class="cmp-mangler">—</span>';
  const merke = {ulik: 'ulik', 'bare-a': 'kun A', 'bare-b': 'kun B', lik: ''};
  body.innerHTML =
    '<div class="cmp-rad cmp-hode"><span>Punkt</span>'
    + '<span class="cmp-v">A</span><span class="cmp-v">B</span>'
    + '<span class="cmp-merke">avvik</span></div>'
    + vis.slice(0, 600).map(r => {
        const navn = (r.a && r.a.name) || (r.b && r.b.name) || r.k;
        return `<div class="cmp-rad ${r.art}">`
          + `<span class="cmp-navn" title="${esc(navn)}">${esc(r.k)}</span>`
          + `<span class="cmp-v">${vFmt(r.a)}</span>`
          + `<span class="cmp-v">${vFmt(r.b)}</span>`
          + `<span class="cmp-merke">${merke[r.art]}</span></div>`;
      }).join('')
    + (vis.length > 600 ? `<div class="gs-empty">…og ${vis.length - 600} til</div>` : '');
}

function openSammenlign() {
  const lest = S.devices.filter(d => (S.cache[d.address] || []).length);
  if (lest.length < 2) {
    toast('Åpne minst to enheter først — sammenlikningen bruker det som er lest', true);
    return;
  }
  const valg = (sel, forvalg) => {
    sel.innerHTML = lest.map(d =>
      `<option value="${esc(d.address)}">${esc(d.object_name || ('Enhet ' + d.device_instance))}`
      + ` — ${esc(d.address)}</option>`).join('');
    sel.value = forvalg;
  };
  const a = S.activeDev && S.cache[S.activeDev.address] ? S.activeDev.address : lest[0].address;
  const b = lest.find(d => d.address !== a).address;
  valg($('cmpA'), a); valg($('cmpB'), b);
  $('cmpOverlay').hidden = false;
  $('cmpA').onchange = tegnSammenlign;
  $('cmpB').onchange = tegnSammenlign;
  $('cmpBareUlike').onchange = tegnSammenlign;
  tegnSammenlign();
}
function closeSammenlign() { $('cmpOverlay').hidden = true; }

/* --------------------------------------------------------------- rapporter */
/* C5 - sesjonsrapport, og C4 - hva har endret seg siden snapshot.

   Begge svarer paa noe man uansett skriver i en e-post etterpaa: hva gjorde
   jeg, og hva beveget seg mens jeg holdt paa. Verktoyet vet det allerede - det
   har bare aldri sagt det samlet.

   De deler dialog og kopiknapp, fordi begge skal kunne limes rett inn et annet
   sted. Derfor bygges innholdet som tekst med en enkel HTML-speiling, ikke som
   en tabell man maa formatere om for aa faa den ut. */
let OKT_START = Date.now();
let RAPPORT_TEKST = '';

function rapLinje(k, v) { return {k, v: String(v)}; }

function visRapport(tittel, bolker) {
  const NL = String.fromCharCode(10);
  $('rapTittel').textContent = tittel;

  const tekst = [tittel, '-'.repeat(tittel.length), ''];
  let html = '';
  for (const b of bolker) {
    html += '<div class="rap-bolk"><div class="rap-h">' + esc(b.h) + '</div>';
    tekst.push(b.h.toUpperCase());
    const linjer = b.linjer || [], liste = b.liste || [];
    if (linjer.length) {
      html += linjer.map(l =>
        '<div class="rap-linje"><span class="rap-nokkel">' + esc(l.k) + '</span>'
        + '<span class="rap-verdi">' + esc(l.v) + '</span></div>').join('');
      linjer.forEach(l => tekst.push('  ' + l.k.padEnd(24) + l.v));
    }
    if (liste.length) {
      html += '<ul class="rap-liste">'
        + liste.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      liste.forEach(x => tekst.push('  - ' + x));
    }
    if (!linjer.length && !liste.length) {
      const tom = b.tom || 'ingenting';
      html += '<div class="rap-tom">' + esc(tom) + '</div>';
      tekst.push('  (' + tom + ')');
    }
    html += '</div>';
    tekst.push('');
  }
  $('rapBody').innerHTML = html;
  RAPPORT_TEKST = tekst.join(NL);
  $('raportOverlay').hidden = false;
}

function closeRapport() { $('raportOverlay').hidden = true; }

/* C5 - hva okta har bestaatt av. */
async function visSesjonsrapport() {
  const min = Math.round((Date.now() - OKT_START) / 60000);
  const lest = S.devices.filter(d => (S.cache[d.address] || []).length);
  const alle = [];
  for (const pts of Object.values(S.cache)) alle.push(...pts);
  const flagg = flagCounts(alle);

  let skriv = [];
  try {
    const d = await (await fetch('/api/writelog')).json();
    const fra = OKT_START / 1000;
    skriv = (d.entries || []).filter(e => e.ts >= fra);
  } catch (e) { /* loggen er ikke kritisk for rapporten */ }

  const NL = String.fromCharCode(10);
  const notater = Object.entries(S.notes || {})
    .filter(([, n]) => n && (n.text || '').trim())
    .map(([k, n]) => k + ': ' + (n.text || '').trim().split(NL)[0]);

  visRapport('Sesjonsrapport - ' + new Date().toLocaleString('no'), [
    {h: 'Okt', linjer: [
      rapLinje('Varighet', min + ' min'),
      rapLinje('Nettverkskort', S.localAddr || '-'),
      rapLinje('Omraade', ($('rangeInput') || {}).value || '-'),
    ]},
    {h: 'Enheter', linjer: [
      rapLinje('Funnet', S.devices.length),
      rapLinje('Lest', lest.length),
      rapLinje('Punkter lest', alle.length),
    ]},
    {h: 'Funn', linjer: Object.entries(FLAGS)
      .filter(([f]) => flagg[f])
      .map(([f, m]) => rapLinje(m.label, flagg[f])),
     tom: 'ingen punkter i alarm, med feil eller overstyrt'},
    {h: 'Skrivinger i denne okta',
     liste: skriv.map(e => {
       const t2 = new Date(e.ts * 1000).toLocaleTimeString('no');
       const hva = e.action === 'release' ? 'frigitt'
                 : e.action === 'auto-release' ? 'auto-frigitt' : 'skrevet';
       const v = e.action === 'write'
         ? ' ' + (e.before === null || e.before === undefined ? '-' : e.before)
           + ' -> ' + e.value : '';
       return t2 + '  ' + e.address + ' ' + e.objid + ' ' + hva + v;
     }),
     tom: 'ingen'},
    {h: 'Notater', liste: notater, tom: 'ingen'},
  ]);
}

/* C4 - hva har endret seg siden snapshot. */
function visSnapshotrapport() {
  if (!S.snapshot || !S.activeDev) {
    toast('Ta et snapshot forst - rapporten viser hva som har endret seg siden da', true);
    return;
  }
  const ip = S.activeDev.address;
  const endret = [], borte = [], nye = [];
  const sett = new Set();
  for (const p of S.points) {
    const n = ip + '|' + p.objid;
    sett.add(n);
    if (!(n in S.snapshot)) { nye.push(p); continue; }
    const foer = S.snapshot[n];
    const talla = typeof foer === 'number' && typeof p.value === 'number';
    const ulik = talla ? Math.abs(foer - p.value) > 1e-9
                       : String(foer) !== String(p.value);
    if (ulik) endret.push({p, foer});
  }
  for (const n of Object.keys(S.snapshot)) {
    if (n.indexOf(ip + '|') === 0 && !sett.has(n)) borte.push(n.split('|')[1]);
  }

  const u = (p) => p.unit_symbol ? ' ' + p.unit_symbol : '';
  visRapport('Endret siden snapshot - ' + (S.activeDev.object_name || ip), [
    {h: 'Sammendrag', linjer: [
      rapLinje('Punkter naa', S.points.length),
      rapLinje('Endret verdi', endret.length),
      rapLinje('Nye siden snapshot', nye.length),
      rapLinje('Borte siden snapshot', borte.length),
    ]},
    {h: 'Endrede verdier',
     liste: endret.slice(0, 300).map(o =>
       (o.p.name || o.p.objid) + ':  ' + o.foer + u(o.p) + '  ->  ' + o.p.value + u(o.p)),
     tom: 'ingen verdier har endret seg'},
    {h: 'Nye punkter', liste: nye.slice(0, 100).map(p => p.name || p.objid), tom: 'ingen'},
    {h: 'Borte', liste: borte.slice(0, 100), tom: 'ingen'},
  ]);
}

/* ------------------------------------------------- B3: handlinger paa raden */
/* Alt du kan gjore med punktet, uten aa flytte handa til musa.

   Verktoyet i radkanten dekker de tre vanligste, og kommandopaletten dekker
   alt - men paletten gjelder hele verktoyet og maa soke seg fram til punktet.
   Dette er den mellomtingen som mangler: en liste over hva som gjelder NETTOPP
   det punktet som er valgt.

   Ctrl+. er valgt fordi punktum ligger ved siden av piltastene man akkurat har
   brukt for aa komme dit. */
function punktHandlinger(p) {
  const h = [];
  h.push({t: 'Kopier punktnavn', k: () => {
    navigator.clipboard.writeText(p.name || p.objid)
      .then(() => toast('Kopiert: ' + (p.name || p.objid)))
      .catch(() => toast('Kunne ikke kopiere', true));
  }});
  h.push({t: 'Kopier objekt-ID', k: () => {
    navigator.clipboard.writeText(p.objid)
      .then(() => toast('Kopiert: ' + p.objid))
      .catch(() => toast('Kunne ikke kopiere', true));
  }});
  h.push({t: 'Stor visning', hint: 'Z', k: () => openZoom()});
  const festet = S.watch.some(w => S.activeDev && w.ip === S.activeDev.address
                                   && w.objid === p.objid);
  h.push({t: festet ? 'Løs fra overvåking' : 'Fest til overvåking', hint: 'Mellomrom',
          k: () => togglePin(p.objid)});
  if (p.writable) h.push({t: 'Skriv verdi…', k: () => { /* skjemaet staar i inspektoren */
    renderInspector();
    const el = document.querySelector('.insp-val.adjustable');
    if (el) el.scrollIntoView({block: 'nearest'});
  }});
  h.push({t: 'Les punktet på nytt', k: () => refreshOne(p.objid)});
  return h;
}

function apneRadmeny() {
  const p = S.selected && S.pointIndex ? S.pointIndex.get(S.selected) : null;
  if (!p) { toast('Velg et punkt først', true); return; }
  lukkRadmeny();
  const tr = S.rowIndex && S.rowIndex.get(p.objid);
  const wrap = $('pointsWrap');
  if (!wrap) return;

  const m = document.createElement('div');
  m.id = 'radmeny';
  m.className = 'menu-pop';
  m.innerHTML = '<div class="menu-gruppe">' + esc(p.name || p.objid) + '</div>'
    + punktHandlinger(p).map((h, i) =>
        '<button class="menu-item" data-h="' + i + '">' + esc(h.t)
        + (h.hint ? '<span class="menu-hint">' + esc(h.hint) + '</span>' : '')
        + '</button>').join('');
  wrap.appendChild(m);

  // Under raden om det er plass, ellers over - menyen skal ikke havne utenfor.
  const rr = tr ? tr.getBoundingClientRect() : wrap.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const h = m.offsetHeight;
  const under = rr.bottom - wr.top + wrap.scrollTop + 2;
  const over = rr.top - wr.top + wrap.scrollTop - h - 2;
  m.style.top = (rr.bottom + h < wr.bottom ? under : Math.max(0, over)) + 'px';
  m.style.left = '38px';

  const handlinger = punktHandlinger(p);
  m.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
    const fn = handlinger[+b.dataset.h];
    lukkRadmeny();
    if (fn) { try { fn.k(); } catch (e) { toast(e.message, true); } }
  });
  const f = m.querySelector('.menu-item');
  if (f) f.focus();
}

function lukkRadmeny() {
  const m = document.getElementById('radmeny');
  if (m) m.remove();
}

/* ------------------------------------------------- B4: hopp mellom rutene */
/* F6 er konvensjonen for aa sykle mellom ruter, og Ctrl+1/2/3 gaar rett dit.
   Uten dette maatte man tabbe seg gjennom hver knapp i verktoylinja for aa
   komme fra enhetslista til punktene. */
const RUTER = ['devList', 'pointsWrap', 'watchList'];

function hoppRute(steg) {
  const naa = RUTER.findIndex(id => {
    const el = document.getElementById(id);
    return el && el.contains(document.activeElement);
  });
  const i = naa < 0 ? 0 : (naa + steg + RUTER.length) % RUTER.length;
  gaaTilRute(i);
}

function gaaTilRute(i) {
  const el = document.getElementById(RUTER[i]);
  if (!el) return;
  // Foerste fokuserbare inni, ellers ruta selv.
  const f = el.querySelector('.dev, .watch-row button, button');
  (f || el).focus();
  el.scrollIntoView({block: 'nearest'});
}

/* ------------------------------------------- D1/D2: paletten som ett soek */
/* Paletten kunne bare handlinger. Skulle man til et punkt maatte man lukke
   den, klikke i soekefeltet og lete der - to forskjellige soek for det som
   foles som ett spoersmaal: "hvor er RT401".

   Naa er punktene paa den aapne enheten og enhetene selv med i samme liste,
   og segmentene over gjor at man kan si hva man ville ha. Treffene baerer
   typemerke og verdi, saa man ser hvilket RT401 det er uten aa aapne det. */
let CMD_SEG = 'alt';

function cmdPunkter(q) {
  if (!q || q.length < 2 || !S.points || !S.points.length) return [];
  const ut = [];
  for (const p of S.points) {
    if (!hayFor(p).includes(q)) continue;
    const v = fmtVal(p.value);
    ut.push({
      art: 'punkt',
      gruppe: 'Punkter',
      etikett: p.name || p.objid,
      undertekst: () => p.description || '',
      merke: shortType(p.type),
      verdi: (v.t + ' ' + (p.unit_symbol || '')).trim(),
      kjor: () => { closeCmd(); selectPoint(p.objid); },
    });
    if (ut.length >= 40) break;
  }
  return ut;
}

function cmdEnheter(q) {
  if (!q || q.length < 2) return [];
  return S.devices
    .filter(d => ((d.object_name || '') + ' ' + d.address + ' '
                  + (d.device_instance ?? '')).toLowerCase().includes(q))
    .slice(0, 20)
    .map(d => ({
      art: 'enhet',
      gruppe: 'Enheter',
      etikett: d.object_name || ('Enhet ' + d.device_instance),
      undertekst: () => vendorOf(d.vendor_name, d.vendor_id).label,
      merke: String(d.device_instance ?? '?'),
      verdi: d.address,
      kjor: () => { closeCmd(); selectDevice(d.address); },
    }));
}

/* ------------------------------------------------- A5: skriv fra tabellen */
/* Dobbeltklikk paa en skrivbar verdi gir et felt i cella.

   VIKTIG: dette skriver ikke. Feltet fyller ut skjemaet i inspektoren og
   trykker paa Skriv - som fortsatt stiller det samme spoersmaalet det alltid
   har gjort, med punktnavn, adresse, gammel og ny verdi, og "dette endrer et
   anlegg i drift".

   Det er hele poenget med aa gjore det slik. En redigering rett i tabellen som
   gaar rett ut paa nettet ville gjort et uhell til en driftsendring - og paa
   et anlegg med 2418 punkter er et feilklikk ikke en fjern mulighet. Her
   sparer man klikkene fram til spoersmaalet, ikke spoersmaalet. */
function startInlineSkriv(td, p) {
  if (!p || !p.writable || td.querySelector('input')) return;
  if (S.readOnly) { toast('Lesemodus er på — skriving er blokkert', true); return; }

  const gammel = td.textContent;
  const inp = document.createElement('input');
  inp.className = 'inline-skriv';
  inp.value = typeof p.value === 'number' ? String(p.value) : '';
  inp.setAttribute('aria-label', 'Ny verdi for ' + (p.name || p.objid));
  td.textContent = '';
  td.appendChild(inp);
  inp.focus();
  inp.select();

  const avbryt = () => { td.textContent = gammel; };
  inp.onkeydown = (e) => {
    e.stopPropagation();                  // ikke la piltaster flytte valget
    if (e.key === 'Escape') { e.preventDefault(); avbryt(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const verdi = inp.value.trim();
      avbryt();
      if (!verdi) return;
      levérTilSkjema(p, verdi);
    }
  };
  inp.onblur = avbryt;
}

/* Fyller skjemaet i inspektoren og trykker Skriv - saa bekreftelsen kommer
   som vanlig. */
function levérTilSkjema(p, verdi) {
  if (S.selected !== p.objid) selectPoint(p.objid);
  // Skjemaet bygges av renderInspector, saa det kan komme et bilde senere.
  const forsok = (n) => {
    const felt = document.getElementById('wVal');
    const send = document.getElementById('wSend');
    if (!felt || !send) {
      if (n > 0) return void setTimeout(() => forsok(n - 1), 60);
      toast('Fant ikke skriveskjemaet — bruk feltet i inspektøren', true);
      return;
    }
    felt.value = verdi;
    send.click();                          // denne spor "Fortsette?" som for
  };
  forsok(12);
}

/* --------------------------------------------------- ping som motbevis */
/* Skiller to helt ulike stillheter fra hverandre.

   Et skann som ikke finner noe kan bety at adressene er tomme, eller at
   enhetene staar der og det er BACnet-samtalen som feiler. Over VPN er det
   andre langt vanligst - maalt her paa 192.168.40.0/28: fire adresser svarte
   paa ping, mens Who-Is og rask sweep fant null.

   Ping svarer paa det direkte. Men det er ikke fasit begge veier: .11 paa
   samme nett svarte paa BACnet uten aa svare paa ping i det hele tatt, fordi
   mange regulatorer og brannmurer ikke slipper ICMP. Derfor formuleres svaret
   som et hint med forbehold, ikke som en konklusjon. */
async function pingOmraade(omraader, boks) {
  if (!omraader || !omraader.length) return;
  const ut = boks.querySelector('.ping-svar');
  if (ut) ut.innerHTML = '<span class="spin"></span> pinger…';

  const lever = [];
  let sjekket = 0;
  try {
    for (const omr of omraader) {
      const d = await api('/api/ping', {subnet: omr, timeout_ms: 700});
      if (d.status !== 'done') throw new Error(d.error || 'ping feilet');
      lever.push(...(d.alive || []));
      sjekket += d.checked || 0;
    }
  } catch (e) {
    const nytt = /404|not found/i.test(e.message || '');
    if (ut) ut.innerHTML = nytt
      ? 'Ping krever at serveren startes på nytt — kjør <code>start.bat</code> igjen.'
      : esc('Ping feilet: ' + e.message);
    return;
  }

  const svarteBacnet = new Set(S.devices.map(d => d.address));
  const stille = lever.filter(ip => !svarteBacnet.has(ip));

  if (!ut) return;
  if (!lever.length) {
    ut.innerHTML = '<b>Ingen av ' + sjekket + ' adresser svarte på ping heller.</b> '
      + 'Det peker mot nettveien — rute, brannmur eller feil nettverkskort. '
      + 'Men vær klar over at mange regulatorer svarer på BACnet uten å svare '
      + 'på ping, så prøv <b>grundig sweep</b> før du konkluderer.';
    return;
  }
  ut.innerHTML =
    '<b>' + lever.length + ' av ' + sjekket + ' adresser svarer på ping'
    + (stille.length
        ? ', men ' + stille.length + ' av dem svarte ikke på BACnet.</b> '
          + 'De adressene er i live — det er BACnet-oppdagelsen som feiler der. '
          + 'Grundig sweep prøver dem om igjen. '
          + '<span class="ping-nb">Merk at ping ikke er fasit andre veien: '
          + 'en regulator kan svare på BACnet uten å svare på ping.</span>'
        : '.</b> Alle som svarer på ping svarte også på BACnet.')
    + (stille.length
        ? '<div class="ping-liste">' + stille.slice(0, 12).map(esc).join('  ')
          + (stille.length > 12 ? '  …og ' + (stille.length - 12) + ' til' : '') + '</div>'
        : '');
}

function pingDel(omraader) {
  return '<div class="ping-del">'
    + '<button class="btn" data-ping="1">Sjekk med ping</button>'
    + '<div class="ping-svar"></div></div>';
}

function koblePing(boks, omraader) {
  const b = boks.querySelector('[data-ping]');
  if (b) b.onclick = () => { b.disabled = true; pingOmraade(omraader, boks)
    .finally(() => { b.disabled = false; }); };
}

/* ------------------------------------------- naar skannet ikke fant noe */
/* "Ingen BACnet-enheter i omraadet" er sjelden sant, og aldri nyttig.

   Maalt paa et hotell-VPN (en /32-tunnel), samme omraade, tre modi:
   Who-Is fant 0, Sweep-rask fant 0, Sweep-grundig fant 4. Samtidig svarte alle
   fire paa ping. At ping gaar sier bare at IP-en naas - BACnet-oppdagelse er
   noe annet:

   - Who-Is er en kringkasting til nettets .255-adresse. VPN-konsentratorer og
     rutere videresender som regel ikke directed broadcast, saa den forsvinner
     paa veien. Ping er unicast og rutes helt normalt.
   - Sweep-rask proever hver adresse EN gang med kort tidsavbrudd. Over VPN er
     rundturen lang nok til at svaret kommer for sent, og adressen regnes som
     stille.
   - Sweep-grundig proever de stille adressene en gang til, langsommere. Det er
     forskjellen mellom 0 og 4.

   Derfor sier ruta naa hva som ble proevd, hvorfor det kan ha feilet nettopp
   her, og gir knappen som pleier aa loese det. */
function tomtSkannResultat(mode, omraader) {
  const el = $('devList');
  if (!el) return;
  const vpn = /\/32$/.test(S.localAddr || '');
  const omr = (omraader || []).join(', ');

  const grunner = [];
  if (mode === 'broadcast') {
    grunner.push('<b>Who-Is</b> er en kringkasting. Rutere og VPN slipper den '
      + 'som regel ikke gjennom — derfor svarer ingen, selv om enhetene er der.');
  }
  if (mode === 'unicast_fast') {
    grunner.push('<b>Sweep — rask</b> prøver hver adresse <b>én gang</b>. Over '
      + 'VPN driver rekkevidden fra minutt til minutt — samme regulator kan '
      + 'svare på seks av åtte forsøk, og på null en halvtime senere. Ett '
      + 'stille forsøk betyr derfor lite, og «grundig» prøver de stille '
      + 'adressene om igjen for deg.');
  }
  if (vpn) {
    grunner.push('Du sender fra <code>' + esc(S.localAddr) + '</code> — et '
      + '/32 uten eget subnett, altså en VPN-tunnel. Kringkasting virker ikke herfra.');
  }
  grunner.push('At <b>ping</b> svarer betyr bare at IP-en nås. BACnet-oppdagelse '
    + 'er en egen samtale på UDP 47808, og den kan blokkeres selv om ping går.');

  const knapp = mode !== 'unicast_sweep'
    ? '<button class="btn primary" id="tomtGrundig">Prøv «Sweep — grundig»</button>'
    : '<button class="btn" id="tomtIgjen">Skann på nytt</button>';

  el.innerHTML =
    '<div class="tomt-skann">'
    + '<div class="tomt-tittel">Ingen enheter svarte</div>'
    + '<div class="tomt-omr">' + esc(omr) + '</div>'
    + '<ul class="tomt-grunner">' + grunner.map(g => '<li>' + g + '</li>').join('') + '</ul>'
    + '<div class="tomt-knapper">' + knapp + '</div>'
    + pingDel(omraader)
    + '</div>';

  koblePing(el, omraader);
  const g = $('tomtGrundig');
  if (g) g.onclick = () => { $('modeSel').value = 'unicast_sweep'; runScan(); };
  const i = $('tomtIgjen');
  if (i) i.onclick = () => runScan();
}

/* Den antall-baserte varslinga er tatt ut.

   Den talte enheter per omraade og sa fra naar dagens skann fant faerre enn
   det hoyeste den hadde sett. To ting var galt med den:

   - Den bodde i enhetslista, og renderDevices bygger den lista paa nytt hver
     gang noe skjer - saa ruta forsvant etter noen sekunder.
   - Et antall kan ikke si HVA som mangler. "Tre faerre enn sist" er ikke noe
     man kan handle paa; "tre WAGO svarte ikke, her er adressene" er det.

   Anleggsminnet visste allerede hvilke enheter som har svart her, med adresse
   og leverandoer, og det overlever at verktoyet lukkes. Varslinga ligger naa i
   varselpanelet sammen med klokkeavvikene - der den blir staaende og kan
   foldes bort. Se manglendeEnheter(). */

let RENDER_GEN = 0;

function renderPoints() {
  const wrap = $('pointsWrap');
  /* Chipsene tegnes foerst, ikke sist.

     Foerste utkast la kallet nederst i funksjonen - men renderPoints gaar ut
     tidlig baade naar ingen enhet er valgt og naar filteret ikke gir treff, og
     det siste er nettopp naar det betyr mest aa se hva som filtrerer. Da sto
     raden tom i det ene tilfellet den fantes for. */
  tegnFilterChips();
  if (!S.points.length) {
    wrap.innerHTML = '<div class="empty">Velg en enhet for å laste punkter</div>';
    $('sbShown').textContent = '0';
    return;
  }
  const all = visiblePoints();
  $('sbShown').textContent = all.length;
  /* "40 vist" sa ingenting om at 2378 var filtrert bort. Naa staar begge tall
     der, saa du vet om du ser paa anlegget eller paa et utvalg av det. */
  const sbTot = $('sbShownTot');
  if (sbTot) {
    const skjult = S.points.length - all.length;
    sbTot.textContent = skjult > 0 ? ` av ${S.points.length}` : '';
    sbTot.title = skjult > 0 ? `${skjult} punkter er filtrert bort` : '';
  }
  renderSelBar();
  if (!all.length) {
    wrap.innerHTML = emptyResultView();
    const b = $('emptyClear');
    if (b) b.onclick = () => {
      S.filters = {q: '', type: '', flag: '', writable: false, diff: false};
  S.sortMer = [];
      $('q').value = ''; $('typeSel').value = '';
      renderPoints(); syncMenuStates();
    };
    return;
  }
  // Every point is rendered - engineers need the whole list. This is only
  // affordable because live updates patch individual cells instead of
  // rebuilding the table (see updateValueCells).
  const rows = all;
  const truncated = 0;

  const showDesc = wrap.clientWidth >= DESC_MIN_WIDTH;
  // "Luftmengde tilluft" is what the point is; "BACnet IP.360002.AI-4" is
  // where it lives. The address was the emphasised one and the meaning was
  // dimmed. When the description column is on screen the emphasis flips; when
  // it is too narrow to show, the name is all there is and keeps it.
  wrap.classList.toggle('desc-primary', showDesc);
  /* The fixed columns add up to 250 px. When the table has less room than
     that plus something to read, the name column — the one that identifies
     the point — is what gets squeezed, and it was measured down to 20 px on a
     700 px window. Below this the object instance stands down: it is an
     address you rarely read, and the type tag next to it survives. */
  wrap.classList.toggle('cramped', wrap.clientWidth < 420);
  // Staged only when the list is genuinely new, not on every filter keystroke.
  const fersk = S._sisteTabell !== S.activeDev.address;
  S._sisteTabell = S.activeDev.address;
  const cols = orderedCols().filter(c => showDesc || c.k !== 'description');

  const head = cols.map(c => {
    /* Pila viser retning; tallet viser hvilken noekkel kolonnen er. Uten
       tallet er "sortert paa tre kolonner" umulig aa lese av. */
    const mer = S.sortMer || [];
    const i = mer.findIndex(s => s.key === c.k);
    const aktiv = S.sort.key === c.k ? S.sort : (i >= 0 ? mer[i] : null);
    const nr = S.sort.key === c.k ? (mer.length ? 1 : 0) : i + 2;
    const arr = aktiv
      ? `<span class="arr">${aktiv.dir > 0 ? '▲' : '▼'}${
          nr ? `<b class="arr-nr">${nr}</b>` : ''}</span>` : '';
    const sortert = S.sort.key === c.k ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none';
    return `<th class="${c.cls}" data-k="${c.k}" scope="col"${
      c.nosort ? ' style="cursor:default"' : ` aria-sort="${sortert}"`}>${c.label} ${arr}</th>`;
  }).join('');

  /* Radene bygges i biter.

     Aa sette sammen 2418 rader og la nettleseren tolke dem i en operasjon
     maalte 470 ms - en halv sekunds frossen skjerm hver gang du sorterer eller
     filtrerer paa et anlegg av denne storrelsen. Ingenting av det er synlig:
     ~30 rader faar plass paa skjermen.

     Foerste bit kommer med en gang og fyller skjermen. Resten legges til bit
     for bit mellom rammene, saa listen er komplett like fort som foer, men uten
     at noe staar stille imens. */
  const radHtml = (p) => {
    const pinned = S.watch.some(w => w.ip === S.activeDev.address && w.objid === p.objid);
    const cls = [
      S.selected === p.objid ? 'sel' : '',
      isSel(p) ? 'picked' : '',
      (hasFlag(p, 'in-alarm') || hasFlag(p, 'fault')) ? 'alarm' : '',
      (hasFlag(p, 'overridden') || hasFlag(p, 'out-of-service')) ? 'over' : '',
      isDiff(p) ? 'diff' : '',
    ].filter(Boolean).join(' ');
    const celler = cols.map(c =>
      `<td class="${c.cls}${c.extraCls ? ' ' + c.extraCls(p) : ''}"${
        c.attrs ? c.attrs(p) : ''}>${c.cell(p)}</td>`).join('');
    return `<tr class="${cls}" data-o="${esc(p.objid)}">
      <td class="c-act"><span class="pin${pinned ? ' on' : ''}" data-pin="${esc(p.objid)}">${pinned ? '★' : '☆'}</span></td>
      ${celler}
    </tr>`;
  };

  const FORSTE_BIT = 160, BIT = 320;
  const body = rows.slice(0, FORSTE_BIT).map(radHtml).join('');

  const colgroup = '<colgroup><col class="w-act">'
    + cols.map(c => `<col${c.col ? ` class="${c.col}"` : ''}>`).join('') + '</colgroup>';
  const moreNote = truncated
    ? `<div class="empty" style="padding:12px">Viser ${MAX_ROWS} av ${all.length} punkter —
        bruk søk eller typefilter for å snevre inn.</div>`
    : '';
  wrap.innerHTML = `<table>${colgroup}<thead><tr><th></th>${head}</tr></thead><tbody${fersk ? ' class="ferske"' : ''}>${body}</tbody></table>${moreNote}`;

  wrap.querySelectorAll('thead th[data-k]').forEach(th => {
    if (th.dataset.k === '_u') return;
    th.onclick = (event) => {
      const k = th.dataset.k;
      if (event && event.shiftKey) {
        // Shift legger kolonnen til som neste noekkel, eller snur den om den
        // alt er med.
        S.sortMer = S.sortMer || [];
        if (S.sort.key === k) S.sort.dir *= -1;
        else {
          const i = S.sortMer.findIndex(s => s.key === k);
          if (i >= 0) S.sortMer[i].dir *= -1;
          else S.sortMer.push({key: k, dir: 1});
        }
      } else if (S.sort.key === k) S.sort.dir *= -1;
      else { S.sort = {key: k, dir: 1}; S.sortMer = []; }
      flyttRader(wrap, renderPoints);
    };
  });
  /* Punkter som nettopp tippet over tennes. Gjoeres etter at tabellen er
     bygget, ellers finnes ikke radene. */
  if (!bevegelseAv()) {
    const nye = nyeMerker(rows);
    /* Alt i en bunt, med EN tvungen layout for hele slengen.

       slaaPaaNytt leser offsetWidth per element for aa faa animasjonen til aa
       starte om igjen. Det er riktig for ett element, men naar et anlegg
       tripper og hundre og femti punkter gaar i alarm samtidig blir det hundre
       og femti tvungne layouts - maalt til 123 ms paa en tabell med fire
       hundre rader. Samme grep som updateValueCells allerede bruker: rydd
       foerst, tving layout en gang, sett saa klassene. */
    const bunt = [];
    for (const [liste, klasse, ms] of [[nye.alarm, 'tenn', 1200],
                                       [nye.tvang, 'tvang', 1200],
                                       [nye.drift, 'drift', 950]]) {
      for (const o of liste) {
        const tr = wrap.querySelector(`tbody tr[data-o="${CSS.escape(o)}"]`);
        if (tr) { tr.classList.remove(klasse); bunt.push([tr, klasse, ms]); }
      }
    }
    if (bunt.length) {
      void document.body.offsetWidth;
      for (const [tr, klasse, ms] of bunt) {
        tr.classList.add(klasse);
        setTimeout(() => tr.classList.remove(klasse), ms);
      }
    }
  } else {
    nyeMerker(rows);   // hold bokfoeringa i takt selv uten bevegelse
  }

  // Tabellen er bygget paa nytt, saa settet og radmenyen er borte med den.
  skjulRadVerktoy();
  lukkRadmeny();
  // Rullefeltet vises bare naar det faktisk er noe aa rulle i.
  visRullefelt();

  /* EN klikkhaandterer paa tbody, ikke en per rad.

     Foer fikk hver eneste rad sin egen onclick. Paa 2418 punkter er det 2418
     funksjoner aa opprette og feste hver gang tabellen bygges - for en
     hendelse som uansett bobler opp til samme sted. Delegeringa gjor det samme
     med en. */
  S.rowIndex = new Map();
  const tbody = wrap.querySelector('tbody');
  if (tbody) {
    for (const tr of tbody.rows) S.rowIndex.set(tr.dataset.o, tr);
    /* A5: dobbeltklikk paa en skrivbar verdi. Delegert som klikket, saa det
       koster ingenting per rad. */
    tbody.ondblclick = e => {
      const td = e.target.closest && e.target.closest('td.c-val');
      if (!td) return;
      const tr = td.closest('tr[data-o]');
      const p = tr && S.pointIndex.get(tr.dataset.o);
      if (!p || !p.writable) return;
      e.preventDefault(); e.stopPropagation();
      startInlineSkriv(td, p);
    };

    tbody.onclick = e => {
      const tr = e.target.closest && e.target.closest('tr[data-o]');
      if (!tr) return;
      if (e.target.dataset.pin) { togglePin(e.target.dataset.pin); e.stopPropagation(); return; }
      // Ctrl/Cmd toggles one row, Shift takes the range from the last anchor;
      // a plain click still just inspects the point.
      if (e.ctrlKey || e.metaKey) { toggleSel(tr.dataset.o); return; }
      if (e.shiftKey) { selectRange(tr.dataset.o); return; }
      S.selAnchor = tr.dataset.o;
      selectPoint(tr.dataset.o);
    };

    /* Resten av radene, en bit per ramme.

       Generasjonstelleren stopper en paagaaende paafylling naar tabellen
       bygges paa nytt - uten den ville en sortering midt i en paafylling
       fortsette aa legge rader inn i en tabell som ikke finnes lenger. */
    if (rows.length > FORSTE_BIT) {
      const min = ++RENDER_GEN;
      let i = FORSTE_BIT;
      const mer = () => {
        if (min !== RENDER_GEN || !tbody.isConnected) return;
        const slutt = Math.min(i + BIT, rows.length);
        let h = '';
        for (let k = i; k < slutt; k++) h += radHtml(rows[k]);
        tbody.insertAdjacentHTML('beforeend', h);
        for (let k = i; k < slutt; k++) S.rowIndex.set(rows[k].objid, tbody.rows[k]);
        i = slutt;
        if (i < rows.length) requestAnimationFrame(mer);
        else visRullefelt();       // hoyden er foerst kjent naar alt er inne
      };
      requestAnimationFrame(mer);
    }
  }
}

/* ---------------------------------------------------------------- menus */
/* One open menu at a time, closed by clicking away or Esc. */
const MENUS = [['toolsBtn', 'toolsPop'], ['filtBtn', 'filtPop'], ['expBtn', 'expPop'],
               ['visBtn', 'visPop']];

function closeMenus(except) {
  MENUS.forEach(([, pop]) => { if (pop !== except) $(pop).hidden = true; });
}

function initMenus() {
  MENUS.forEach(([btn, pop]) => {
    $(btn).onclick = e => {
      e.stopPropagation();
      const el = $(pop);
      const willOpen = el.hidden;
      if (willOpen && pop === 'visPop') tegnVisninger();
      closeMenus();
      // Some states depend on the device on screen, not just on a saved
      // preference, so they are refreshed at the moment the menu is shown.
      if (willOpen) syncMenuStates();
      el.hidden = !willOpen;
    };
    $(pop).onclick = e => e.stopPropagation();
  });
  document.addEventListener('click', () => closeMenus());
}

/* Toggle states live inside menus, so the button that opens the menu has to
   signal that something is active - otherwise a filter can be left on with
   nothing on screen to say so. */
function syncMenuStates() {
  const f = S.filters;
  [['fWrit', f.writable], ['fDiff', f.diff]].forEach(([id, on]) => {
    const el = $(id);
    el.classList.toggle('on', !!on);
    el.querySelector('.menu-state').textContent = on ? 'på' : '';
  });
  // The four flag filters are mutually exclusive - a point cannot be shown as
  // "only overridden" and "only in fault" at once - so they behave as a
  // radio group rather than four independent toggles.
  document.querySelectorAll('.menu-item[data-flag]').forEach(el => {
    const on = f.flag === el.dataset.flag;
    el.classList.toggle('on', on);
    el.querySelector('.menu-state').textContent = on ? 'på' : '';
  });
  const anyFilter = f.flag || f.writable || f.diff;
  $('filtBtn').classList.toggle('has-active', !!anyFilter);
  $('filtBtn').textContent = anyFilter ? 'Filter •' : 'Filter';

  $('roBtn').classList.toggle('on', S.readOnly);
  // Every switch shows a word now that the state sits in a pill - an empty
  // pill reads as a control that failed to load, not as "off".
  $('roState').textContent = S.readOnly ? 'på' : 'av';
  $('toolsBtn').classList.toggle('has-active', S.readOnly);

  const dense = document.body.classList.contains('dense');
  $('denseBtn').classList.toggle('on', dense);
  $('denseState').textContent = dense ? 'på' : 'av';

  syncPrefetchBtn();

  /* Shortening only has anything to remove when every point on the device
     shares a leading segment. Saying "på" on a device where nothing is being
     shortened would be a claim the table does not support, so the state says
     what is actually happening. */
  const ab = $('allTypesBtn');
  if (ab) {
    const alle = loadPrefs().allTypes === true;
    ab.classList.toggle('on', alle);
    $('allTypesState').textContent = alle ? 'alle' : 'kun verdier';
  }

  const rb = $('rescanBtn');
  if (rb) {
    rb.classList.toggle('on', RESCAN.on);
    $('rescanState').textContent = RESCAN.on
      ? Math.round(rescanIntervalMs() / 1000) + 's' : 'av';
  }

  const gb = $('groupBtn');
  if (gb) {
    const akse = loadPrefs().groupBy || (loadPrefs().groupVendor === false ? 'none' : 'vendor');
    gb.classList.toggle('on', akse !== 'none');
    $('groupState').textContent = GROUP_NAVN[akse];
  }

  const kort = loadPrefs().shortNames !== false;
  const el = $('shortBtn');
  if (el) {
    el.classList.toggle('on', kort && !!S.namePrefix);
    $('shortState').textContent = !kort ? 'av'
      : S.namePrefix ? 'på' : 'ingen felles start';
    el.title = !kort ? 'Punktnavn vises fullt ut'
      : S.namePrefix ? `Utelater «${S.namePrefix}» fra tabellen — fullt navn i tooltip, søk og eksport`
                     : 'På, men punktnavnene her har ingen felles start å utelate';
  }
}

/* ------------------------------------------------------------------ project */
/* A site is saved server-side so a colleague opening the same instance sees
   the same sites. Snapshots accumulate per save, which is what makes
   "what changed since last visit" possible. */
function projectPayload() {
  return {
    devices: S.devices,
    watch: S.watch.map(w => ({ip: w.ip, objid: w.objid, name: w.name, unit: w.unit})),
    range: $('rangeInput').value.trim(),
    iface: S.localAddr,
    snapshot: S.snapshot || null,
    // The object list is what costs minutes to read; live values cost one
    // poll. So the structure is persisted and the values deliberately are
    // not - showing yesterday's temperature as if it were current would be
    // worse than showing nothing.
    points: Object.fromEntries(Object.entries(S.cache).map(([ip, pts]) => [ip,
      pts.map(p => { const {value, status, _hay, ...rest} = p; return rest; })])),
    pointsMeta: S.cacheMeta,
    // Model and firmware are facts about the device; the clock reading is a
    // measurement that was true at the time. Saving the drift would show
    // yesterday's number as if it were current, so only the static half is
    // kept and the clock is re-read on the next visit.
    identity: Object.fromEntries(Object.entries(S.identity).map(([ip, id]) => {
      const {'clock-drift': _d, 'device-time': _t, ...rest} = id;
      return [ip, rest];
    })),
  };
}

async function saveProject() {
  const suggested = loadPrefs().lastProject || '';
  const name = prompt('Navn på anlegget:', suggested);
  if (!name) return;
  S.prosjektNavn = name;
  const d = await api('/api/projects/save', {name, data: projectPayload()});
  if (d.status !== 'done') { toast(d.error || 'Lagring feilet', true); return; }
  savePrefs({lastProject: d.name});
  toast(`Lagret «${d.name}» · ${d.snapshots} snapshot(s)`);
}

async function openProjects() {
  const d = await (await fetch('/api/projects')).json();
  const list = d.projects || [];
  const box = $('prjList');
  if (!list.length) {
    box.innerHTML = '<div class="gs-empty">Ingen lagrede anlegg ennå</div>';
  } else {
    box.innerHTML = list.map((p, i) => `<div class="prj-row">
      <button class="prj-open" data-n="${esc(p.name)}">
        <span class="prj-name">${esc(p.name)}</span>
        <span class="prj-meta">${p.devices} enheter · ${p.watch} overvåket · ${p.snapshots} snapshot(s)</span>
        <span class="prj-date">${p.saved ? new Date(p.saved * 1000).toLocaleString('no') : ''}</span>
      </button>
      <button class="prj-del" data-d="${esc(p.name)}" title="Slett">✕</button>
    </div>`).join('');
    box.querySelectorAll('.prj-open').forEach(b => b.onclick = () => loadProject(b.dataset.n));
    box.querySelectorAll('.prj-del').forEach(b => b.onclick = async () => {
      if (!confirm(`Slette «${b.dataset.d}»?`)) return;
      await api(`/api/projects/${encodeURIComponent(b.dataset.d)}/delete`);
      openProjects();
    });
  }
  $('prjOverlay').hidden = false;
}
function closeProjects() { $('prjOverlay').hidden = true; }

async function loadProject(name) {
  const d = await (await fetch('/api/projects/' + encodeURIComponent(name))).json();
  if (d.status !== 'done') { toast(d.error || 'Kunne ikke åpne', true); return; }
  const p = d.data || {};
  closeProjects();
  // EDE wants a project name in its header; the loaded project is the best
  // answer we have for what this set of devices is called.
  S.prosjektNavn = name;

  S.devices = p.devices || [];
  S.cache = {}; S.cacheMeta = p.pointsMeta || {}; S.identity = p.identity || {};
  for (const [ip, pts] of Object.entries(p.points || {})) {
    S.cache[ip] = pts.map(q => Object.assign({value: null, status: []}, q));
  }
  S.activeDev = null; S.points = []; S.pointIndex = new Map();
  S.selected = null; S.sel.clear();
  S.watch = (p.watch || []).map(w => Object.assign({hist: [], value: null}, w));
  if (p.range) $('rangeInput').value = p.range;

  // Restore the most recent snapshot so "changed since" works immediately.
  const snaps = p.snapshots || [];
  if (snaps.length) {
    S.snapshot = snaps[snaps.length - 1].values;
    S.snapAt = new Date(snaps[snaps.length - 1].ts * 1000);
    $('sbSnap').innerHTML = `<b>snapshot</b> ${S.snapAt.toLocaleDateString('no')}`;
  }
  S.projectSnaps = snaps;

  renderDevices(); renderCtx(); renderPoints(); renderInspector(); renderWatch();
  savePrefs({lastProject: name});
  toast(`Åpnet «${name}» · ${S.devices.length} enheter${snaps.length ? ` · snapshot fra ${S.snapAt.toLocaleDateString('no')}` : ''}`);
}

/* ------------------------------------------------------------ global search */
/* Points are cached per device as they are loaded, so a search can span every
   device visited this session instead of only the active one. Devices that
   have not been opened yet simply are not in the cache - the result header
   says so rather than pretending the search was exhaustive. */
function cachePoints(ip, points) {
  S.cache[ip] = points;
}

function globalMatches(term) {
  const out = [];
  // Flag mode answers a different question from the search box: not "where is
  // this point" but "is anything still forced anywhere on this site". It is
  // read straight out of the cache, so it costs nothing and covers every
  // device that has been opened or prefetched.
  if (S.gsFlag) {
    for (const [ip, pts] of Object.entries(S.cache)) {
      const dev = S.devices.find(d => d.address === ip);
      for (const p of pts) {
        if (hasFlag(p, S.gsFlag)) {
          out.push({ip, dev, p});
          if (out.length >= 300) return out;
        }
      }
    }
    return out;
  }
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];
  const ord = sokeOrd(t);
  if (!ord) return [];
  for (const [ip, pts] of Object.entries(S.cache)) {
    const dev = S.devices.find(d => d.address === ip);
    /* Enheten er med i hoystakken her, men ikke i det lokale soeket - der har
       du alt valgt hvilken regulator du staar paa. "KG32 RT601" skal finne alle
       RT601 paa KG32 selv naar KG32 er navnet paa enheten og ikke en del av
       punktnavnet. Bygges en gang per enhet, ikke en gang per punkt. */
    const devHay = (' ' + (dev ? (dev.object_name || '') + ' ' + dev.device_instance : '')
                    + ' ' + ip).toLowerCase();
    for (const p of pts) {
      if (sokTreff(hayFor(p) + devHay, ord)) {
        out.push({ip, dev, p});
        if (out.length >= 300) return out;
      }
    }
  }
  return out;
}

function renderGlobalChips() {
  const box = $('gsChips');
  if (!box) return;
  const alle = [];
  for (const pts of Object.values(S.cache)) alle.push(...pts);
  const tellinger = flagCounts(alle);
  const finnes = Object.entries(FLAGS).filter(([f]) => tellinger[f]);
  if (!finnes.length) { box.innerHTML = ''; return; }
  box.innerHTML = finnes.map(([f, m]) =>
    `<button class="gs-chip ${m.cls}${S.gsFlag === f ? ' on' : ''}" data-gsflag="${f}">${
      tellinger[f]} ${esc(m.label)} i anlegget</button>`).join('');
  box.querySelectorAll('[data-gsflag]').forEach(b => b.onclick = () => {
    S.gsFlag = S.gsFlag === b.dataset.gsflag ? '' : b.dataset.gsflag;
    if (S.gsFlag) { $('gsInput').value = ''; }
    renderGlobalChips(); renderGlobal();
  });
}

function openGlobal() {
  $('gsOverlay').hidden = false;
  // Treffene deles ut naar ruta apnes; foerste tastetrykk avslutter det.
  S._gsSkrevet = false;
  $('gsResults').classList.add('kaskade');
  const inp = $('gsInput');
  inp.value = S.filters.q || '';
  inp.focus(); inp.select();
  renderGlobalChips();
  renderGlobal();
}
function closeGlobal() { $('gsOverlay').hidden = true; }

function renderGlobal() {
  const term = $('gsInput').value;
  const hits = globalMatches(term);
  const loaded = Object.keys(S.cache).length;
  const total = S.devices.length;
  const dekning = loaded < total
    ? `søker i ${loaded} av ${total} enheter (åpne en enhet for å ta den med)`
    : `alle ${total} enheter`;
  $('gsMeta').textContent = S.gsFlag
    ? `${hits.length} punkter ${FLAGS[S.gsFlag].label} · ${dekning}`
    : `${hits.length} treff · ${dekning}`;

  const box = $('gsResults');
  // Kaskaden hoerer til apninga. Lista bygges om paa hvert tastetrykk, og en
  // synlig kaskade der ville stroboskopere mens du skriver.
  if (S._gsSkrevet) box.classList.remove('kaskade');
  if (!S.gsFlag && (!term.trim() || term.trim().length < 2)) {
    box.innerHTML = '<div class="gs-empty">Skriv minst to tegn</div>';
    return;
  }
  if (!hits.length) { box.innerHTML = '<div class="gs-empty">Ingen treff</div>'; return; }

  box.innerHTML = hits.slice(0, 200).map((h, i) => {
    const v = fmtVal(h.p.value);
    return `<button class="gs-row" data-i="${i}">
      <span class="gs-dev">${h.dev ? h.dev.device_instance : '?'}</span>
      <span class="gs-name">${esc(h.p.name || h.p.objid)}</span>
      <span class="gs-desc">${esc(h.p.description || '')}</span>
      <span class="gs-val ${v.c}">${esc(v.t)} ${esc(h.p.unit_symbol || '')}</span>
      <span class="gs-ip">${esc(h.ip)}</span>
    </button>`;
  }).join('');

  box.querySelectorAll('.gs-row').forEach(b => b.onclick = async () => {
    const h = hits[+b.dataset.i];
    closeGlobal();
    if (!S.activeDev || S.activeDev.address !== h.ip) await selectDevice(h.ip);
    S.filters.q = ''; $('q').value = '';
    renderPoints();
    await selectPoint(h.p.objid);
    const tr = document.querySelector(`#pointsWrap tbody tr[data-o="${CSS.escape(h.p.objid)}"]`);
    if (tr) tr.scrollIntoView({block: 'center'});
  });
}

/* --------------------------------------------------------------- inspector */
/* Aa velge en rad skal ikke bygge tabellen paa nytt.

   selectPoint kalte renderPoints(), som setter sammen hele tabellen som en
   HTML-streng og bytter ut innmaten. Paa 2400 punkter - som er det anlegget
   faktisk har - maalte jeg verste ramme til 398 ms for et enkelt radklikk.
   Fire tideler frossen skjerm for aa flytte en markering fra en rad til en
   annen.

   Her flyttes bare klassen. Alt annet i tabellen er uendret: samme rader,
   samme rekkefolge, samme kolonner.

   Jeg proevde ogsaa en View Transition som morfet verdien fra raden opp i
   inspektoren. Den var fin, og den kostet ytterligere nitti millisekunder paa
   toppen av de fire hundre - saa den ligger ikke her. Maalingen var poenget:
   en animasjon som gjor den vanligste handlingen tregere har ikke fortjent
   plassen. */
/* Ett verktoysett som flytter seg, ikke ett per rad.

   Foerste utkast la knappene i markupen til hver eneste rad. Det virket, men
   maalt paa 2418 punkter - som er det anlegget har - kostet det naesten ti
   tusen ekstra DOM-noder, og byggetida for tabellen gikk fra 346 til 603 ms.
   Jeg gjorde den vanligste handlingen tregere for aa spare tre knappetrykk.

   Naa finnes settet en gang og flyttes til raden under peker. Samme opplevelse,
   samme knapper, uten 2417 kopier som ingen ser. */
function radVerktoy() {
  let el = document.getElementById('radVerktoy');
  if (el) return el;
  const wrap = document.getElementById('pointsWrap');
  if (!wrap) return null;
  el = document.createElement('div');
  el.id = 'radVerktoy';
  el.className = 'rad-verktoy';
  el.innerHTML =
    '<button class="rv-knapp" data-rv="navn" title="Kopier punktnavn">⧉</button>'
  + '<button class="rv-knapp" data-rv="skriv" title="Skriv verdi">✎</button>'
  + '<button class="rv-knapp" data-rv="zoom" title="Stor visning">⤢</button>';

  /* Handtereren maa ligge HER. Settet er soesken av tabellen, ikke barn av en
     rad, saa klikk paa det bobler aldri opp til tbody - der klikkene ellers
     fanges. Foerste utkast lot den ligge igjen der, og da var knappene doede. */
  el.onclick = e => {
    const rv = e.target.closest && e.target.closest('[data-rv]');
    if (!rv) return;
    e.stopPropagation(); e.preventDefault();
    const p = S.pointIndex && S.pointIndex.get(el.dataset.o);
    if (!p) return;
    if (rv.dataset.rv === 'navn') {
      navigator.clipboard.writeText(p.name || p.objid)
        .then(() => toast('Kopiert: ' + (p.name || p.objid)))
        .catch(() => toast('Kunne ikke kopiere', true));
    } else if (rv.dataset.rv === 'skriv') {
      selectPoint(p.objid);
    } else if (rv.dataset.rv === 'zoom') {
      selectPoint(p.objid); openZoom();
    }
  };

  wrap.appendChild(el);
  return el;
}

function visRadVerktoy(tr) {
  const el = radVerktoy();
  if (!el) return;
  const p = tr && S.pointIndex && S.pointIndex.get(tr.dataset.o);
  if (!p) { el.classList.remove('paa'); el.dataset.o = ''; return; }
  el.dataset.o = p.objid;
  // Skriveknappen finnes bare der den betyr noe.
  el.querySelector('[data-rv="skriv"]').hidden = !p.writable;
  el.style.top = tr.offsetTop + 'px';
  el.style.height = tr.offsetHeight + 'px';
  el.classList.add('paa');
}

function skjulRadVerktoy() {
  const el = document.getElementById('radVerktoy');
  if (el) { el.classList.remove('paa'); el.dataset.o = ''; }
}

function velgRad(objid) {
  const wrap = document.getElementById('pointsWrap');
  if (!wrap) return false;
  const gammel = wrap.querySelector('tbody tr.sel');
  const ny = objid && S.rowIndex ? S.rowIndex.get(objid) : null;
  // Finnes ikke raden - filtrert bort, eller tabellen hoerer til en annen
  // enhet - maa den bygges paa vanlig maate.
  if (objid && !ny) return false;
  if (gammel === ny) return true;
  if (gammel) gammel.classList.remove('sel');
  if (ny) ny.classList.add('sel');
  return true;
}

async function selectPoint(objid) {
  if (S.selected !== objid) {
    S.selHist = [];
    S._trendMerker = [];
    S.tlData = null;
    // Seed from the watchlist if this point is already being followed, so
    // pinned points show their accumulated trend immediately.
    const w = S.watch.find(x => S.activeDev && x.ip === S.activeDev.address && x.objid === objid);
    if (w) S.selHist = w.hist.slice();
    const p0 = S.pointIndex.get(objid);
    if (p0 && typeof p0.value === 'number' && !S.selHist.length) S.selHist.push(p0.value);
  }
  S.selected = objid; S.detail = null; S.detailError = null;
  // Flytt markeringa hvis raden allerede staar der; ellers full omtegning.
  if (!velgRad(objid)) renderPoints();
  renderInspector();
  if (!S.activeDev) return;
  try {
    const d = await api('/api/object/detail', {address: S.activeDev.address, objid});
    if (S.selected !== objid) return;              // user moved on already
    if (d.status === 'done') S.detail = d.properties;
    else S.detailError = d.error || 'Enheten svarte ikke på egenskapsforespørselen.';
  } catch (e) {
    if (S.selected !== objid) return;
    S.detailError = e.message;
  }
  // Always re-render: without this a failed read leaves "laster…" on screen
  // forever with no indication that anything went wrong.
  renderInspector();
}

/* Wired after the summary is written to the DOM, since the field is part of
   that markup and is replaced every time the panel re-renders. */
function wireNoteField() {
  const ta = $('devNote');
  if (!ta || !S.activeDev) return;
  const dev = S.activeDev;
  ta.value = noteFor(dev);
  const st = $('noteState');
  const n = S.notes[noteKey(dev)];
  if (st) {
    const naar = n ? 'sist endret ' + new Date(n.updated * 1000).toLocaleString('no') : '';
    const delt = noteSyncTekst();
    st.textContent = [naar, delt].filter(Boolean).join(' · ');
    st.classList.toggle('advarsel', /ikke delt|ikke tilgjengelig/.test(delt));
  }

  const lagre = async () => {
    const btn = $('noteSave');
    btn.disabled = true;
    const ok = await lagreNotat(dev, ta.value);
    btn.disabled = false;
    if (ok) {
      // Kvitteringa der oyet allerede er, ikke bare i hjornet.
      if (!bevegelseAv()) slaaPaaNytt(ta, 'lagret', 1050);
      toast(ta.value.trim() ? 'Notat lagret' : 'Notat slettet');
      renderInspector();
    }
  };
  $('noteSave').onclick = lagre;
  // Ctrl+Enter saves without reaching for the mouse; plain Enter makes a new
  // line, because notes are prose.
  ta.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); lagre(); }
    e.stopPropagation();   // arrow keys belong to the note, not the point list
  };
}

/* With no point selected the inspector would just be dead space, so use it
   for a device overview instead. */
/* Tallene i sammendraget teller opp, i samme rekkefolge som kortene kommer
   inn, saa de to bevegelsene er en bevegelse.

   Og alarmkortet slaar tre ganger naar tallet har endret seg siden sist -
   ikke hver gang ruta tegnes om, for da ville det slaa hvert sekund mens Live
   staar paa, og det er nettopp den type stoy som gjoer at folk slaar av
   animasjoner. */
let ALARM_TALL = null;

function tellSammendrag(rot) {
  const kort = [...rot.querySelectorAll('.sum-grid .sum-card')];
  kort.forEach((k, i) => {
    const b = k.querySelector('b');
    const til = parseInt(b.textContent, 10);
    if (!isFinite(til)) return;
    setTimeout(() => tellOpp(b, til), 40 + i * 45);
  });

  const al = rot.querySelector('.sum-card.alarm b');
  const naa = al ? parseInt(al.textContent, 10) : 0;
  if (al && ALARM_TALL !== null && naa !== ALARM_TALL && !bevegelseAv()) {
    slaaPaaNytt(al.parentElement, 'slaar', 2900);
  }
  ALARM_TALL = naa;
}

function renderDeviceSummary() {
  const d = S.activeDev;
  if (!d) return '<div class="empty" style="padding:20px 16px">Velg et punkt</div>';
  const v = vendorOf(d.vendor_name, d.vendor_id);
  const flagg = flagCounts(S.points);
  const counts = S.typeCounts || {};
  const cards = Object.keys(counts).sort().map(t => {
    return `<div class="sum-card">
      <b>${counts[t]}</b><span>${esc(t.replace('multi-state', 'msv').replace('-', ' '))}</span></div>`;
  }).join('');
  return `
    <div class="insp-title"><span>${esc(d.object_name || 'Enhet ' + d.device_instance)}</span></div>
    <div class="insp-sub">
      <span class="vendor" style="--vc:${v.color}"><i></i><span>${esc(v.label)}</span></span>
      · <code style="font-family:var(--mono);font-size:10px">#${d.device_instance} · ${esc(d.address)}</code>
    </div>
    <div class="sect"><div class="sect-head">Sammendrag</div>
      <div class="sum-grid">
        <div class="sum-card"><b>${S.totalObjects || 0}</b><span>objekter</span></div>
        <div class="sum-card"><b>${S.points.length}</b><span>punkter</span></div>
        ${Object.entries(FLAGS).filter(([f]) => flagg[f]).map(([f, m]) =>
          `<div class="sum-card ${m.cls === 'bad' ? 'alarm' : 'over'}"><b>${flagg[f]}</b><span>${esc(m.label)}</span></div>`).join('')}
      </div>
    </div>
    <div class="sect"><div class="sect-head">Notat</div>
      <div class="sect-body">
        <textarea id="devNote" class="note-field" rows="3"
          placeholder="Hva du fant, hva som gjenstår, hva neste mann bør vite…"></textarea>
        <div class="note-foot"><span id="noteState"></span>
          <button id="noteSave" class="btn">Lagre notat</button></div>
      </div>
    </div>
    <div class="sect"><div class="sect-head">Objekttyper</div>
      <div class="sum-grid">${cards}</div>
    </div>
    <div class="sect-body"><div style="font-size:11px;color:var(--fg-3)">
      Velg et punkt i tabellen for detaljer, live trend og skriving.
    </div></div>`;
}

/* Bygger og oppdaterer et rullende tall.

   Poenget er aa IKKE bygge om naar tallet bare endrer verdi: da ville sifrene
   bli erstattet og ingenting rullet. Har teksten samme form - like mange tegn,
   samme tegn paa de faste plassene - flyttes bare --d paa de sifrene som
   faktisk er nye, og CSS-overgangen gjor resten. */
function tegnOdometer(el, tekst, enhet) {
  const form = [...tekst].map(c => (c >= '0' && c <= '9') ? '#' : c).join('');
  const lik = el.dataset.form === form;

  if (!lik) {
    el.dataset.form = form;
    let h = '<span class="od">';
    for (const c of tekst) {
      if (c >= '0' && c <= '9') {
        h += '<span class="od-sif" data-d="' + c + '"><span class="od-strip" style="--d:'
           + c + '">' + '0123456789'.split('').map(d => '<b>' + d + '</b>').join('')
           + '</span></span>';
      } else {
        h += '<span class="od-fast">' + esc(c) + '</span>';
      }
    }
    h += '</span>';
    el.innerHTML = h + '<small>' + esc(enhet || '') + '</small>';
    return;
  }

  // Samme form: flytt bare sifrene som er endret.
  const sifre = el.querySelectorAll('.od-sif');
  let i = 0;
  for (const c of tekst) {
    if (c < '0' || c > '9') continue;
    const sif = sifre[i++];
    if (!sif || sif.dataset.d === c) continue;
    sif.dataset.d = c;
    sif.classList.add('rull');
    sif.firstElementChild.style.setProperty('--d', c);
  }
  const sm = el.querySelector('small');
  if (sm) sm.textContent = enhet || '';
}

/* Bare rene tall skal rulle. "Hoy hastighet" eller "active" er ord, ikke
   maalinger, og et ord som ruller sifferveis er bare stoy. */
function kanRulle(tekst) {
  return /^-?\d+([.,]\d+)?$/.test(tekst);
}

function renderInspector() {
  const el = $('inspector');
  if (!S.selected) {
    el.innerHTML = renderDeviceSummary();
    tellSammendrag(el);
    wireNoteField();
    return;
  }
  const p = S.pointIndex.get(S.selected);
  if (!p) { el.innerHTML = '<div class="empty">—</div>'; return; }
  const d = S.detail || {};
  const v = fmtVal(p.value);

  // Multi-state and binary points carry human labels; show those instead of raw codes.
  let shown = v.t;
  if (Array.isArray(d['state-text']) && typeof p.value === 'number') {
    shown = d['state-text'][p.value - 1] || v.t;
  } else if (p.value === 'active' && d['active-text']) shown = d['active-text'];
  else if (p.value === 'inactive' && d['inactive-text']) shown = d['inactive-text'];

  const skip = new Set(['object-name', 'present-value', 'description', 'units_symbol', 'priority-array']);
  // Controllers report "no limit" as ±MAX_FLOAT; printing 3.4028e+38 as a
  // min/max just adds noise, so drop those rows.
  const isFloatSentinel = x => typeof x === 'number' && Math.abs(x) > 1e37;
  const rows = Object.keys(d).filter(k => !skip.has(k) && !isFloatSentinel(d[k])).map(k => {
    let val = d[k];
    if (Array.isArray(val)) val = val.length ? val.join(', ') : '—';
    if (typeof val === 'boolean') val = val ? 'ja' : 'nei';
    if (typeof val === 'number' && !Number.isInteger(val)) val = Number(val.toFixed(4));
    return `<dt>${esc(k)}</dt><dd>${esc(val === null || val === '' ? '—' : val)}</dd>`;
  }).join('');

  const propsBody = rows ? `<dl class="kv">${rows}</dl>`
    : S.detailError
      ? `<div style="font-size:11px;color:var(--warn)">${esc(S.detailError)}
         <button class="btn" style="margin-top:6px;width:100%" onclick="selectPoint('${esc(S.selected)}')">Prøv igjen</button></div>`
      : `<div style="font-size:11px;color:var(--fg-3)"><span class="spin"></span> leser egenskaper…</div>`;

  const pa = d['priority-array'];
  let paHtml = '';
  if (Array.isArray(pa)) {
    const active = pa.map((x, i) => x === null ? null : {p: i + 1, v: x}).filter(Boolean);
    paHtml = `<div class="sect"><div class="sect-head">Prioritetsarray</div><div class="sect-body">` +
      (active.length
        ? `<dl class="kv">${active.map(a => `<dt>prioritet ${a.p}</dt><dd>${esc(a.v)}</dd>`).join('')}</dl>`
        : `<div style="font-size:11px;color:var(--fg-3)">Ingen aktive kommandoer — styres av lokal logikk</div>`) +
      `</div></div>`;
  }

  const alarmHtml = p.status && p.status.length
    ? `<div class="sect-body"><div class="warn-box" style="color:var(--err);background:rgba(240,83,63,.08);border-color:rgba(240,83,63,.25)">${esc(p.status.join(', '))}</div></div>`
    : '';

  el.innerHTML = `
    <div class="insp-title">
      <span>${esc(p.name || p.objid)}</span>
      <button class="cp" data-cp="${esc(p.name || p.objid)}" title="Kopier navn">⧉</button>
    </div>
    <div class="insp-sub">${esc(p.description || '')}</div>
    <div class="insp-val${p.writable ? ' adjustable' : ''}"${
      p.writable ? ' title="Kommanderbart punkt — kan skrives"' : ''
      } data-rull="${kanRulle(shown) ? '1' : ''}">${
      esc(shown)}<small>${esc(p.unit_symbol || '')}</small></div>
    <div class="insp-sub" style="padding-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span class="type-tag ${TYPE_CLASS[p.type] || ''}">${esc(p.type)}</span>
      <code style="font-family:var(--mono);font-size:10px;color:var(--fg-3)">#${p.instance} · ${esc(S.activeDev.address)}</code>
      <button class="cp" data-cp="${esc(p.objid)}" title="Kopier objekt-ID">⧉</button>
    </div>
    ${trendBlock(p)}
    ${ukeBlock(p)}
    ${loggBlock(p)}
    ${alarmHtml}
    <div class="sect"><div class="sect-head">Egenskaper</div><div class="sect-body data-verdier">${propsBody}</div></div>
    ${paHtml}
    ${p.writable ? (S.readOnly ? roNotice() : writeForm(p, d)) : ''}
  `;
  el.querySelectorAll('[data-cp]').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    navigator.clipboard.writeText(b.dataset.cp)
      .then(() => toast('Kopiert: ' + b.dataset.cp))
      .catch(() => toast('Kunne ikke kopiere', true));
  });
  if (p.writable && !S.readOnly) wireWriteForm(p, d);
  const hb = $('tlHent');
  if (hb) hb.onclick = () => hentTrendlogg(p);
  const ub = $('ukeAapne');
  if (ub) ub.onclick = () => openSchedules(p.objid);
}

/* Patch only the value and the trend. A full renderInspector() on every
   poll tick would rebuild the write form and wipe whatever the user was
   halfway through typing into it. */
function updateInspectorLive() {
  const p = S.pointIndex.get(S.selected);
  if (!p) return;
  const valEl = document.querySelector('.insp-val');
  if (valEl) {
    const d = S.detail || {};
    let shown = fmtVal(p.value).t;
    if (Array.isArray(d['state-text']) && typeof p.value === 'number') {
      shown = d['state-text'][p.value - 1] || shown;
    } else if (p.value === 'active' && d['active-text']) shown = d['active-text'];
    else if (p.value === 'inactive' && d['inactive-text']) shown = d['inactive-text'];
    if (kanRulle(shown) && !bevegelseAv()) {
      tegnOdometer(valEl, shown, p.unit_symbol || '');
    } else {
      valEl.dataset.form = '';
      valEl.innerHTML = esc(shown) + `<small>${esc(p.unit_symbol || '')}</small>`;
    }
  }
  // Bygg bare paa nytt hvis kurven ikke kan oppdateres paa plass.
  if (!oppdaterTrend(p)) {
    const tw = document.querySelector('.trend-wrap');
    if (tw) tw.outerHTML = trendBlock(p);
  }
}

/* A schedule selected in the point list gets its week right there, plus a way
   into the editor - the dialog is no longer somewhere you have to know to go. */
function ukeBlock(p) {
  if (p.type !== 'schedule') return '';
  const st = schedNow(p);
  const naa = !st ? 'Ukeprogrammet er ikke lest'
            : st.tom ? 'Ingen skift lagt inn på denne ukedagen'
            : `Nå: <b>${esc(String(st.verdi))}</b>`
              + (st.til ? ` · ${esc(schedTekst(p))}` : ' · uendret hele uka');
  return `<div class="sect"><div class="sect-head">Ukeprogram</div>
    <div class="sect-body">
      <div class="tl-note">${naa}</div>
      <button class="btn" id="ukeAapne">Åpne ukeprogram</button>
    </div></div>`;
}

/* ------------------------------------------------------ lagret historikk */
/* The live sparkline above only knows what has happened since the point was
   selected. A trend-log object holds what the controller recorded while
   nobody was watching - which is the part a technician actually needs when
   asked why something tripped last Tuesday. Reading it needs ReadRange; a log
   buffer is not an ordinary property, and every ReadProperty attempt came
   back read-access-denied, so this returned nothing and was never wired up. */
function loggBlock(p) {
  if (p.type !== 'trend-log' && p.type !== 'trend-log-multiple') return '';
  const d = S.tlData && S.tlData.objid === p.objid ? S.tlData : null;
  return `<div class="sect"><div class="sect-head">Lagret historikk</div>
    <div class="sect-body" id="tlBody">${d ? tlInnhold(d)
      : '<button class="btn" id="tlHent">Hent logg fra kontrolleren</button>'}</div>
  </div>`;
}

async function hentTrendlogg(p) {
  const boks = $('tlBody');
  if (!boks || !S.activeDev) return;
  boks.innerHTML = '<div class="tl-note"><span class="spin"></span> Leser logg…</div>';
  let d;
  try {
    d = await api('/api/object/trendlog',
                  {address: S.activeDev.address, objid: p.objid, limit: 500});
  } catch (e) {
    d = {status: 'error', error: e.message};
  }
  if (d.status !== 'done') {
    boks.innerHTML = `<div class="tl-note">${esc(d.error || 'Feil ved lesing')}</div>`;
    return;
  }
  d.objid = p.objid;
  d.unit = p.unit_symbol || '';
  S.tlData = d;
  boks.innerHTML = tlInnhold(d);
  wireLogg(d);
}

function wireLogg(d) {
  const c = $('tlCsv'); if (c) c.onclick = () => eksporterLogg(d);
  const n = $('tlNy'); if (n) n.onclick = () => {
    S.tlData = null;
    const p = S.pointIndex.get(S.selected);
    if (p) hentTrendlogg(p);
  };
}

function tlInnhold(d) {
  const recs = d.records || [];
  if (!recs.length) {
    return `<div class="tl-note">${esc(d.error || 'Loggen er tom')}</div>
      <button class="btn" id="tlNy">Prøv igjen</button>`;
  }
  const nums = recs.map(r => Number(r.value)).filter(v => Number.isFinite(v));
  const meta = `${recs.length} poster · buffer ${d.record_count ?? '?'}`
    + (d.total_records ? ` · ${d.total_records} logget totalt` : '');

  let graf = '';
  if (nums.length >= 2) {
    const w = 300, h = 70;
    const min = Math.min(...nums), max = Math.max(...nums);
    const flat = max === min, span = max - min;
    const xy = nums.map((v, i) => [
      (i / (nums.length - 1)) * w,
      flat ? h / 2 : h - 4 - ((v - min) / span) * (h - 10),
    ]);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    graf = `<svg class="trend" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polygon points="0,${h} ${line} ${w},${h}" fill="var(--live)" opacity=".10"/>
        <polyline pathLength="1" points="${line}" fill="none" stroke="var(--live)" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <div class="trend-meta">${flat
        ? `<span>uendret på ${Number(min.toFixed(3))} ${esc(d.unit)}</span>`
        : `<span>min ${Number(min.toFixed(3))} ${esc(d.unit)}</span>
           <span>max ${Number(max.toFixed(3))} ${esc(d.unit)}</span>`}</div>`;
  }

  // A controller stores full float precision; 25.18499183654785 is noise on a
  // temperature. Three decimals is past any sensor's real resolution, and the
  // CSV keeps whatever the device sent.
  const vis = v => {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) && !Number.isInteger(n) ? String(Number(n.toFixed(3))) : String(v);
  };
  // Newest first: the last thing that happened is the thing being asked about.
  const rader = recs.slice(-40).reverse().map(r =>
    `<tr><td class="tl-t">${esc(r.ts)}</td><td class="tl-v">${esc(vis(r.value))}</td></tr>`).join('');

  return `<div class="tl-note">${esc(meta)}</div>
    ${graf}
    <div class="tl-scroll"><table class="tl-tab">
      <thead><tr><th class="tl-t">tidspunkt</th><th class="tl-v">${
        esc(d.unit || 'verdi')}</th></tr></thead>
      <tbody>${rader}</tbody></table></div>
    <div class="tl-foot">
      <span>${recs.length > 40 ? 'viser de 40 nyeste' : ''}</span>
      <span><button class="btn" id="tlNy">Oppdater</button>
      <button class="btn" id="tlCsv">Last ned CSV</button></span>
    </div>`;
}

function eksporterLogg(d) {
  const head = ['tidspunkt', 'verdi', 'enhet', 'objekt', 'navn'];
  const lines = [head.join(';')];
  (d.records || []).forEach(r => lines.push([
    r.ts, r.value ?? '', d.unit || '', d.objid, d.name || '',
  ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `trend_${d.objid.replace(/[^\w]+/g, '_')}_${
    new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast((d.records || []).length + ' logglinjer eksportert');
}

/* Filled area chart for the point being inspected — bigger than the
   watchlist sparkline, with min/max so a flat line is distinguishable
   from a line that simply has a tiny range. */
/* Geometrien for kurven, skilt ut fra HTML-en.

   Oppdateringa under trenger de samme tallene uten aa bygge markup, og to
   steder som regner ut det samme hver for seg kommer alltid til aa gli fra
   hverandre. */
/* C3 - settpunktet til punktet du ser paa, hvis det finnes.

   Navnestrukturen er fast: 360.003-RT401 er foelerne, 360.003-RT401-SP er
   settpunktet. Da kan kurva vise begge deler - maalt verdi mot det den skal
   vaere - i stedet for bare en linje du selv maa vurdere.

   Uten dette maa man aapne to punkter etter hverandre og huske det ene. */
function finnSettpunkt(p) {
  if (!p || !p.name || !S.pointIndex) return null;
  const n = p.name;
  // Er dette allerede settpunktet, er det ingenting aa vise mot.
  if (/-SP$/i.test(n)) return null;
  for (const q of S.pointIndex.values()) {
    if (q.name && q.name.toLowerCase() === (n + '-SP').toLowerCase()
        && typeof q.value === 'number') return q;
  }
  return null;
}

/* C2 - hvor i kurva du skrev noe.

   Skriveloggen visste hva som ble skrevet og naar, men kurva visste ingenting
   om den. Naar man staar og ser paa en verdi som beveger seg, er "her grep
   jeg inn" nettopp det man trenger for aa lese resten.

   Merket er indeksen i selHist da skrivinga gikk gjennom - ikke en klokkeslett,
   fordi selHist ikke har tidsstempler. Det holder: kurva er jevnt fordelt i
   tid, saa indeksen ER x-aksen. */
function merkSkriving(objid) {
  if (objid !== S.selected) return;
  S._trendMerker = (S._trendMerker || []).concat(S.selHist.length - 1);
  if (S._trendMerker.length > 12) S._trendMerker.shift();
}

function trendGeo(p) {
  const nums = S.selHist.filter(v => typeof v === 'number');
  if (nums.length < 2) return null;
  const w = 300, h = 64;
  const sp = finnSettpunkt(p);
  // Settpunktet maa vaere med i skaleringa, ellers havner streken utenfor
  // ruta naar verdien ligger langt fra den.
  const alle = sp ? nums.concat([sp.value]) : nums;
  const min = Math.min(...alle), max = Math.max(...alle);
  const flat = max === min;
  const span = max - min;
  const yFor = (v) => flat ? h / 2 : h - 4 - ((v - min) / span) * (h - 10);
  const xy = nums.map((v, i) => [(i / (nums.length - 1)) * w, yFor(v)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const merker = (S._trendMerker || [])
    .filter(i => i >= 0 && i < nums.length)
    .map(i => ({x: +((i / Math.max(1, nums.length - 1)) * w).toFixed(1),
                y: +yFor(nums[i]).toFixed(1)}));

  return {w, h, nums, min, max, flat, line,
          area: `0,${h} ` + line + ` ${w},${h}`,
          sp: sp ? {verdi: sp.value, y: +yFor(sp.value).toFixed(1), navn: sp.name} : null,
          merker};
}

function trendMeta(g, p) {
  const u = p.unit_symbol || '';
  const sp = g.sp
    ? `<span class="meta-sp" title="${esc(g.sp.navn)}">SP ${
        Number(g.sp.verdi.toFixed(3))} ${esc(u)}</span>` : '';
  return sp + (g.flat
    ? `<span>uendret på ${Number(g.min.toFixed(3))} ${esc(u)}</span><span>${g.nums.length} pkt</span>`
    : `<span>min ${Number(g.min.toFixed(3))} ${esc(u)}</span>
       <span>${g.nums.length} pkt</span>
       <span>max ${Number(g.max.toFixed(3))} ${esc(u)}</span>`);
}

function trendBlock(p) {
  const g = trendGeo(p);
  if (!g) {
    return `<div class="trend-wrap"><div style="font-size:10px;color:var(--fg-3)">${
      S.live ? 'Samler trend…' : 'Slå på Live for å se trend'}</div></div>`;
  }
  const spLinje = g.sp
    ? `<line class="trend-sp" x1="0" y1="${g.sp.y}" x2="${g.w}" y2="${g.sp.y}"/>` : '';
  const merker = (g.merker || []).map(m =>
    `<line class="trend-merke" x1="${m.x}" y1="0" x2="${m.x}" y2="${g.h}"/>`
    + `<circle class="trend-merke-p" cx="${m.x}" cy="${m.y}" r="2.4"/>`).join('');
  return `<div class="trend-wrap">
    <svg class="trend" viewBox="0 0 ${g.w} ${g.h}" preserveAspectRatio="none">
      <polygon points="${g.area}" fill="var(--live)" opacity=".10"/>
      ${merker}
      ${spLinje}
      <polyline pathLength="1" points="${g.line}" fill="none" stroke="var(--live)" stroke-width="1.5"
        stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div class="trend-meta">${trendMeta(g, p)}</div>
  </div>`;
}

/* Oppdaterer kurven paa plass i stedet for aa bygge den paa nytt.

   Foer ble hele blokka byttet ut med frisk HTML ved hvert poll. Det gir et NYTT
   polyline-element hvert andre sekund, og et nytt element starter
   tegne-animasjonen forfra - saa kurven visket seg selv ut og tegnet seg opp
   igjen mens du satt og saa paa den. Umulig aa lese en trend av.

   Naa endres bare tallene i elementet som allerede staar der. Tegninga gaar en
   gang, den forste gangen kurven kommer fram for et punkt.

   Jevnheten beholdes: naar bufferet er fullt har hele kurven flyttet seg ett
   steg til venstre, og da glir den dit i stedet for aa hoppe - samme bevegelse
   som papiret i en skriver. */
function oppdaterTrend(p) {
  const wrap = document.querySelector('.trend-wrap');
  if (!wrap) return false;
  const g = trendGeo(p);
  const pl = wrap.querySelector('polyline');
  const pg = wrap.querySelector('polygon');
  const meta = wrap.querySelector('.trend-meta');
  // Ingen kurve enda, eller den staar i "Samler trend…" - da maa blokka
  // bygges, og DA skal den tegne seg.
  if (!g || !pl || !pg || !meta) return false;

  pl.setAttribute('points', g.line);
  pg.setAttribute('points', g.area);
  meta.innerHTML = trendMeta(g, p);

  if (S._trendSkjov && !bevegelseAv()) {
    const steg = g.w / (g.nums.length - 1);
    // Bare linja. Flata ligger paa 10 % og et sprang der ser ingen, mens en
    // flate som glir etterlater et hakk i bunnlinja.
    pl.animate([{transform: `translateX(${steg}px)`}, {transform: 'none'}],
               {duration: 560, easing: 'linear'});
  }
  S._trendSkjov = false;
  return true;
}

/* ------------------------------------------------------- read-only + log */
async function refreshReadOnly() {
  try {
    const d = await (await fetch('/api/readonly')).json();
    S.readOnly = !!d.enabled;
  } catch { S.readOnly = false; }
  syncMenuStates();
  if (S.selected) renderInspector();
}

function roNotice() {
  return '<div class="sect"><div class="sect-head">Skriv verdi</div>'
       + '<div class="wf"><div class="warn-box">Lesemodus er på — skriving er blokkert. '
       + 'Slå av hengelåsen i verktøylinjen for å skrive.</div></div></div>';
}

async function showWriteLog() {
  const d = await (await fetch('/api/writelog')).json();
  const rows = d.entries || [];
  if (!rows.length) { toast('Ingen skrivinger logget'); return; }
  const NL = String.fromCharCode(10);
  const lines = rows.map(e => {
    const t = new Date(e.ts * 1000).toLocaleString('no');
    const what = e.action === 'auto-release' ? 'auto-frigi'
               : e.action === 'release' ? 'frigi' : 'skriv';
    const val = e.action === 'write' ? '  ' + (e.before ?? '—') + ' -> ' + e.value : '';
    return t + '  ' + what + ' pri' + (e.priority ?? '-') + '  ' + e.objid
         + val + '  @' + e.address + '  [' + e.status + ']';
  });
  alert('Skrivelogg (nyeste først)' + NL + NL + lines.join(NL));
}

function writeForm(p, d) {
  let input;
  if (Array.isArray(d['state-text'])) {
    input = `<select id="wVal" class="field">` +
      d['state-text'].map((t, i) => `<option value="${i + 1}">${i + 1} — ${esc(t)}</option>`).join('') + `</select>`;
  } else if (p.type.startsWith('binary')) {
    input = `<select id="wVal" class="field">
      <option value="active">active${d['active-text'] ? ' — ' + esc(d['active-text']) : ''}</option>
      <option value="inactive">inactive${d['inactive-text'] ? ' — ' + esc(d['inactive-text']) : ''}</option>
    </select>`;
  } else {
    input = `<input id="wVal" class="field" placeholder="verdi">`;
  }
  return `<div class="sect"><div class="sect-head">Skriv verdi</div>
    <div class="wf">
      <div class="wf-row">${input}
        <select id="wPri" class="field" style="flex:0 0 96px" title="Prioritet">
          ${[...Array(16)].map((_, i) => `<option value="${i + 1}"${i + 1 === 8 ? ' selected' : ''}>pri ${i + 1}</option>`).join('')}
        </select>
      </div>
      <div class="wf-row">
        <label style="font-size:10px;color:var(--fg-3);flex:0 0 auto">Auto-frigi</label>
        <select id="wAuto" class="field" style="flex:1" title="Frigjør prioriteten automatisk etter valgt tid">
          <option value="">av — blir stående til du frigir</option>
          <option value="5">etter 5 min</option>
          <option value="15" selected>etter 15 min</option>
          <option value="30">etter 30 min</option>
          <option value="60">etter 1 time</option>
        </select>
      </div>
      <div class="wf-row">
        <button id="wSend" class="btn primary" style="flex:1">Skriv</button>
        <button id="wRel" class="btn" title="Skriv Null — frigjør prioriteten">Frigi</button>
      </div>
      <div class="warn-box">Skriving påvirker et anlegg i drift. Kontroller punkt og prioritet før du sender.</div>
    </div></div>`;
}

function wireWriteForm(p) {
  const send = async release => {
    const raw = $('wVal').value;
    const pri = parseInt($('wPri').value, 10);
    const autoMin = release ? null : (parseFloat($('wAuto').value) || null);
    let value = null;
    if (!release) {
      value = raw;
      if (!p.type.startsWith('binary') && !isNaN(parseFloat(raw))) value = parseFloat(raw);
      if (p.type.startsWith('multi-state')) value = parseInt(raw, 10);
    }
    // A confirmation that only names the new value tells you nothing about
    // what you are about to overwrite, so show the current value too.
    const nowTxt = fmtVal(p.value).t + (p.unit_symbol || '');
    const NL = String.fromCharCode(10);
    const head = release ? ('Frigi prioritet ' + pri) : ('Skriv verdi @ prioritet ' + pri);
    const detail = release
      ? (NL + NL + 'Nå: ' + nowTxt)
      : (NL + NL + 'Nå: ' + nowTxt + NL + 'Ny: ' + raw + (p.unit_symbol || ''));
    const tail = release ? ''
      : (NL + NL + (autoMin ? ('Frigis automatisk etter ' + autoMin + ' min.')
                            : 'Blir stående til du frigir den.'));
    const msg = head + NL + NL + (p.name || p.objid) + NL + S.activeDev.address
              + detail + tail + NL + NL + 'Dette endrer et anlegg i drift. Fortsette?';
    if (!confirm(msg)) return;
    const r = await api('/api/write', {
      address: S.activeDev.address, objid: p.objid,
      value, priority: pri, release, auto_release_min: autoMin,
    });
    if (r.status === 'done') {
      toast(release ? 'Prioritet frigitt'
        : (r.auto_release_min ? ('Skrevet - frigis om ' + r.auto_release_min + ' min') : 'Skrevet'));
      skriveEffekt(p.objid);
      merkSkriving(p.objid);
      refreshOne(p.objid);
    }
    else toast(r.error || 'Skriving feilet', true);
  };
  $('wSend').onclick = () => send(false);
  $('wRel').onclick = () => send(true);
}

async function refreshOne(objid) {
  if (!S.activeDev) return;
  const d = await api('/api/poll', {targets: {[S.activeDev.address]: [objid]}});
  const v = d.values && d.values[S.activeDev.address];
  if (v && objid in v) {
    const p = S.pointIndex.get(objid);
    if (p) {
      p.value = v[objid]; renderPoints(); renderInspector();
      bekreftEffekt(objid);
    }
  }
}

/* --------------------------------------------------------------- watchlist */
/* Sender navnet paa punktet fra raden sin til overvaakingslista.

   Maalet maales foer flyginga starter: lista kan vaere tom, og da er det
   overskrifta som er stedet punktet skal havne. */
function festFly(objid, navn) {
  if (bevegelseAv()) return;
  const fra = document.querySelector(`tr[data-o="${CSS.escape(objid)}"]`);
  const lag = document.getElementById('festlag');
  const maal = document.getElementById('watchList');
  if (!fra || !lag || !maal) return;

  const a = fra.getBoundingClientRect();
  const b = maal.getBoundingClientRect();
  if (!a.width || !b.width) return;

  const el = document.createElement('div');
  el.className = 'fest-fly';
  el.textContent = navn;
  el.style.left = Math.round(a.left + 26) + 'px';
  el.style.top = Math.round(a.top + 2) + 'px';
  lag.appendChild(el);

  // Maales etter innsetting - bredden er ukjent foer teksten er i dokumentet.
  const e = el.getBoundingClientRect();
  const dx = (b.left + Math.min(b.width / 2, 90)) - e.left;
  const dy = (b.top + 10) - e.top;
  const avstand = Math.hypot(dx, dy);
  el.style.setProperty('--dx', Math.round(dx) + 'px');
  el.style.setProperty('--dy', Math.round(dy) + 'px');
  // Lengre vei tar lengre tid; ellers ser korte hopp ut som de somler.
  el.style.setProperty('--flytid', Math.round(360 + Math.min(avstand, 900) * 0.32) + 'ms');

  el.addEventListener('animationend', () => {
    el.remove();
    slaaPaaNytt(maal, 'mottok', 760);
  }, {once: true});
}

function togglePin(objid) {
  if (!S.activeDev) return;
  const ip = S.activeDev.address;
  const i = S.watch.findIndex(w => w.ip === ip && w.objid === objid);
  if (i >= 0) S.watch.splice(i, 1);
  else {
    const p = S.pointIndex.get(objid);
    S.watch.push({ip, objid, name: p.name || objid, unit: p.unit_symbol || '', hist: [], value: p.value});
    festFly(objid, p.name || objid);
  }
  renderPoints(); renderWatch();
}

function sparkPunkter(hist) {
  const nums = hist.filter(v => typeof v === 'number');
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = (max - min) || 1;
  const w = 62, h = 20;
  return nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function sparkline(hist) {
  const pts = sparkPunkter(hist);
  if (!pts) return '<svg class="spark"></svg>';
  const w = 62, h = 20;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline pathLength="1" points="${pts}" fill="none" stroke="var(--live)" stroke-width="1.2"
      stroke-linejoin="round" stroke-linecap="round" opacity=".85"/></svg>`;
}

/* Hvilke punkter lista bestaar av - ikke verdiene deres. Endres denne maa
   lista bygges; endres bare tallene skal den ikke roeres. */
function watchSignatur() {
  return S.watch.map(w => w.ip + '~' + w.objid).join(';');
}

/* Samme feil som trendkurven hadde, og verre her fordi det kan vaere mange:
   renderWatch bygde hele lista paa nytt ved hvert poll, saa hver eneste
   sparkline fikk et nytt polyline-element hvert andre sekund og tegnet seg
   selv opp igjen forfra. Ti festede punkter blinket i takt hvert annet
   sekund. Naa endres bare tallene i elementene som allerede staar der. */
function oppdaterWatch() {
  const el = $('watchList');
  const rader = el.querySelectorAll('.watch-row');
  if (rader.length !== S.watch.length) return false;
  S.watch.forEach((w, i) => {
    const rad = rader[i];
    const v = fmtVal(w.value);
    const val = rad.querySelector('.watch-val');
    if (val) {
      val.className = 'watch-val ' + v.c;
      val.innerHTML = esc(v.t)
        + `<span style="color:var(--fg-3);font-size:9px"> ${esc(w.unit)}</span>`;
    }
    const pts = sparkPunkter(w.hist);
    const pl = rad.querySelector('.spark polyline');
    if (pts && pl) pl.setAttribute('points', pts);
    else if (pts && !pl) {
      // Foerste to maalinger: kurven finnes ikke enda og maa faktisk bygges.
      const svg = rad.querySelector('.spark');
      if (svg) svg.outerHTML = sparkline(w.hist);
    }
  });
  return true;
}

function renderWatch() {
  $('watchCount').textContent = S.watch.length;
  const el = $('watchList');
  // Er det de samme punktene som sist, holder det aa oppdatere tallene.
  if (S.watch.length && S._watchSig === watchSignatur() && oppdaterWatch()) return;
  S._watchSig = watchSignatur();
  if (!S.watch.length) {
    el.innerHTML = '<div style="padding:8px 10px;font-size:10.5px;color:var(--fg-3);line-height:1.4">'
      + 'Fest punkter med ☆ (eller mellomrom) — også fra andre enheter</div>';
    return;
  }
  el.innerHTML = S.watch.map((w, i) => {
    const v = fmtVal(w.value);
    return `<div class="watch-row">
      <div class="watch-r1">
        <div class="watch-name" title="${esc(w.name)}">${esc(w.name)}</div>
        <button class="x" data-w="${i}">✕</button>
      </div>
      <div class="watch-r2">
        <span class="watch-ip">${esc(w.ip)}</span>
        ${sparkline(w.hist)}
        <span class="watch-val ${v.c}">${esc(v.t)}<span style="color:var(--fg-3);font-size:9px"> ${esc(w.unit)}</span></span>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-w]').forEach(b =>
    b.onclick = () => { S.watch.splice(+b.dataset.w, 1); renderWatch(); renderPoints(); });
}

/* ----------------------------------------------------------------- polling */
function pollTargets() {
  const t = {};
  if (S.activeDev && S.points.length) {
    // Only poll what's on screen — a 400-point device polled whole would be
    // both slow and pointless when 20 rows are visible.
    t[S.activeDev.address] = visiblePoints().slice(0, 120).map(p => p.objid);
  }
  S.watch.forEach(w => {
    (t[w.ip] = t[w.ip] || []);
    if (!t[w.ip].includes(w.objid)) t[w.ip].push(w.objid);
  });
  return t;
}

async function pollTick() {
  if (S.pollBusy || !S.live) return;
  const targets = pollTargets();
  if (!Object.keys(targets).length) return;
  S.pollBusy = true;
  try {
    const d = await api('/api/poll', {targets});
    if (d.status !== 'done') return;
    // A poll rewrites the values, so the cache timestamp advances with it -
    // otherwise the table would keep claiming the numbers were minutes old
    // while they were being refreshed every few seconds.
    for (const ip of Object.keys(d.values || {})) {
      if (S.cacheMeta[ip]) S.cacheMeta[ip].readAt = Date.now();
    }
    const changed = [];
    for (const [ip, vals] of Object.entries(d.values || {})) {
      for (const [objid, val] of Object.entries(vals)) {
        if (S.activeDev && ip === S.activeDev.address) {
          const p = S.pointIndex.get(objid);
          if (p && p.value !== val) { p.value = val; changed.push(objid); }
          if (objid === S.selected && typeof val === 'number') {
            S.selHist.push(val);
            // Bufferet er fullt: hele kurven flytter seg ett steg til venstre.
            if (S.selHist.length > SEL_HIST) { S.selHist.shift(); S._trendSkjov = true; }
          }
        }
        S.watch.filter(w => w.ip === ip && w.objid === objid).forEach(w => {
          w.value = val;
          if (typeof val === 'number') { w.hist.push(val); if (w.hist.length > MAX_HIST) w.hist.shift(); }
        });
      }
    }
    if (changed.length) {
      updateValueCells(changed);
      // Kortet til regulatoren som faktisk leverte noe nytt drar til seg et
      // svakt streif, saa du ser hvem som er i bevegelse.
      if (S.activeDev && !bevegelseAv()) {
        slaaPaaNytt(document.querySelector(
          `#devList .dev[data-ip="${CSS.escape(S.activeDev.address)}"]`), 'puls', 950);
      }
    }
    if (S.selected) { updateInspectorLive(); updateZoom(); }
    renderWatch();
  } catch { /* transient network hiccup; next tick retries */ }
  finally { S.pollBusy = false; }
}

/* Update just the value cells that changed.
   Rebuilding the whole table on every poll tick meant assembling several
   hundred rows of HTML twice a second, which blocked the main thread long
   enough to make the spinner and transitions visibly stutter. */
function updateValueCells(objids) {
  const touched = [];
  // Look the row up in a map built once per render. Querying the DOM per
  // cell scans the whole table each time, which with a few hundred live
  // points cost more than the poll interval itself.
  for (const objid of objids) {
    const p = S.pointIndex.get(objid);
    if (!p) continue;
    const tr = S.rowIndex && S.rowIndex.get(objid);
    if (!tr) continue;
    const td = tr._valCell || (tr._valCell = tr.querySelector('td.c-val'));
    if (!td) continue;
    const v = fmtVal(p.value);
    td.className = 'c-val ' + v.c + (p.unread ? ' unread' : '');
    td.textContent = p.unread ? '?' : v.t;
    tr.classList.remove('flash');
    /* Which way it moved, so a wall of changing values reads as a pattern
       instead of a blink. Only for numbers - "active" has no direction. */
    const celle = tr.querySelector('td.c-val');
    if (celle) {
      celle.classList.remove('opp', 'ned');
      const p = S.pointIndex.get(tr.dataset.o);
      const forrige = p && p._forrige;
      if (typeof p?.value === 'number' && typeof forrige === 'number' && p.value !== forrige) {
        celle.classList.add(p.value > forrige ? 'opp' : 'ned');
      }
      if (p) p._forrige = p.value;
    }
    touched.push(tr);
  }
  // Restarting the flash animation needs one forced layout, not one per row:
  // reading offsetWidth inside the loop made the browser lay out the whole
  // table for every changed cell, which is what made updates stutter.
  if (touched.length) {
    void document.body.offsetWidth;
    requestAnimationFrame(() => touched.forEach(tr => tr.classList.add('flash')));
  }
}

/* Start en animasjon paa nytt: klassen maa vekk, layouten tvinges fram, saa
   settes den tilbake. Uten offsetWidth ser nettleseren bare sluttilstanden og
   spiller ingenting av. */
function slaaPaaNytt(el, klasse, ms) {
  if (!el) return;
  el.classList.remove(klasse);
  void el.offsetWidth;
  el.classList.add(klasse);
  setTimeout(() => el.classList.remove(klasse), ms);
}

function rad(objid) {
  return document.querySelector(`tr[data-o="${CSS.escape(objid)}"]`);
}

// Foerste slag: kommandoen gaar ut, og regulatoren som fikk den svarer i lista.
function skriveEffekt(objid) {
  if (bevegelseAv()) return;
  /* Radene er ikke lenger ferske naar noen skriver til dem, og
     tbody.ferske tr:nth-child(-n+15) er spissere enn tbody tr.sender - saa uten
     dette ville inngangsanimasjonen slaa ut baandet i det smale vinduet rett
     etter et enhetsbytte. */
  const kropp = document.querySelector('#pointsWrap tbody.ferske');
  if (kropp) kropp.classList.remove('ferske');
  slaaPaaNytt(rad(objid), 'sender', 520);
  if (S.activeDev) {
    slaaPaaNytt(document.querySelector(
      `.dev[data-ip="${CSS.escape(S.activeDev.address)}"]`), 'mottok', 1040);
  }
}

// Andre slag: verdien er lest tilbake. Kalles etter at tabellen er tegnet om,
// ellers finnes ikke raden lenger.
function bekreftEffekt(objid) {
  if (bevegelseAv()) return;
  slaaPaaNytt(rad(objid), 'bekreftet', 1060);
}

/* Radene flytter seg til sin nye plass i stedet for aa bare staa der.

   Sortering er den ene handlingen i tabellen der ALT endrer seg samtidig, og
   foer var resultatet at 2400 rader byttet innhold i samme ramme. Da ser man
   ikke at det ble sortert - man ser at bildet ble et annet. Naa beholder hver
   rad blikket sitt: den gaar fra der den var til der den skal.

   Teknikken er FLIP - maal foer, bygg om, maal etter, sett den inverse
   forskyvningen og slipp den. Tabellen bygges om med innerHTML, saa radene er
   ikke de samme elementene etterpaa; de kjennes igjen paa objekt-IDen.

   Bare radene som faktisk er synlige. De andre kan ingen se flytte seg, og
   2400 samtidige transformer er ikke gratis. */
/* Hvem som var i alarm sist vi tegnet.

   Foerste gang en enhet aapnes tenner ingenting: paa en stor sentral var 1236 av 2418
   punkter flagget, og aa tenne alle sammen paa en gang er ikke en varsling,
   det er et lysshow. Bare overgangen fra frisk til alarm teller. */
let ALARM_FOER = {ip: null, alarm: new Set(), tvang: new Set(), drift: new Set()};

/* Hva som er NYTT siden forrige tegning, per kategori.

   Alle tre er samme spoersmaal: hvilke punkter gikk over kanten mens du saa
   paa? Foerste gang en enhet aapnes svarer den ingen - paa en stor sentral var 1236 av
   2418 flagget, og aa tenne alle paa en gang er ikke en varsling, det er et
   lysshow. */
function nyeMerker(rows) {
  const ip = S.activeDev ? S.activeDev.address : null;
  const naa = {
    alarm: new Set(), tvang: new Set(), drift: new Set(),
  };
  for (const p of rows) {
    if (hasFlag(p, 'in-alarm') || hasFlag(p, 'fault')) naa.alarm.add(p.objid);
    else if (hasFlag(p, 'overridden') || hasFlag(p, 'out-of-service')) naa.tvang.add(p.objid);
    if (isDiff(p)) naa.drift.add(p.objid);
  }
  if (ALARM_FOER.ip !== ip) {
    ALARM_FOER = {ip, ...naa};
    return {alarm: [], tvang: [], drift: []};
  }
  const nye = {alarm: [], tvang: [], drift: []};
  for (const k of ['alarm', 'tvang', 'drift']) {
    for (const o of naa[k]) if (!ALARM_FOER[k].has(o)) nye[k].push(o);
  }
  ALARM_FOER = {ip, ...naa};
  return nye;
}

/* Teller et tall opp i stedet for aa sette det.

   Kort vei tar faerre steg - aa telle 0..3 i tjue trinn ser ut som en feil, og
   aa telle 0..2418 i tjue trinn hopper for grovt. */
function tellOpp(el, til, ms) {
  if (bevegelseAv() || !(til > 0)) { el.textContent = til; return; }

  /* requestAnimationFrame, ikke setInterval.

     Foerste utkast telte med setInterval paa 22ms. Nettleseren struper
     hovedtraad-timere til rundt ett sekund naar sida ikke tegnes, saa
     opptellinga tok to steg paa halvannet sekund i stedet for tjueaatte paa
     seks hundre millisekunder - mens alt annet i verktoyet gikk som normalt,
     fordi det ligger paa kompositoren. rAF foelger tegninga: staar den, staar
     tellinga, og tar den seg opp igjen fortsetter den der den var. */
  if (el._teller) cancelAnimationFrame(el._teller);
  const tid = ms || 620;
  const start = performance.now();
  el.textContent = '0';
  const steg = (naa) => {
    const u = Math.min(1, (naa - start) / tid);
    // Bremser mot slutten, saa siste tallet lander i stedet for aa stoppe.
    el.textContent = Math.round(til * (1 - Math.pow(1 - u, 3)));
    if (u < 1) el._teller = requestAnimationFrame(steg);
    else { el.textContent = til; el._teller = 0; }
  };
  el._teller = requestAnimationFrame(steg);
}

function visRullefelt() {
  const bar = document.getElementById('punktrull');
  const wrap = document.getElementById('pointsWrap');
  if (!bar || !wrap) return;
  bar.classList.toggle('aktiv', wrap.scrollHeight > wrap.clientHeight + 1);
}
// Ruta kan bli hoyere eller lavere uten at tabellen tegnes om - da endrer
// svaret seg ogsaa.
addEventListener('resize', visRullefelt);

function flyttRader(wrap, bygg) {
  if (bevegelseAv()) { bygg(); return; }
  const boks = wrap.getBoundingClientRect();
  const foer = new Map();
  for (const tr of wrap.querySelectorAll('tbody tr[data-o]')) {
    const r = tr.getBoundingClientRect();
    if (r.bottom > boks.top - 60 && r.top < boks.bottom + 60) foer.set(tr.dataset.o, r.top);
  }

  bygg();
  if (!foer.size) return;

  const flytt = [];
  for (const tr of wrap.querySelectorAll('tbody tr[data-o]')) {
    const y0 = foer.get(tr.dataset.o);
    if (y0 === undefined) continue;
    const dy = y0 - tr.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) flytt.push([tr, dy]);
  }
  if (!flytt.length) return;

  // Fra toppen og nedover, saa omstokkingen leses som en bevegelse og ikke
  // som at hele tabellen rykker samtidig.
  flytt.forEach(([tr, dy], i) => {
    tr.animate(
      [{transform: `translateY(${dy}px)`}, {transform: 'none'}],
      {duration: 460, delay: Math.min(i * 9, 140),
       easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards'});
  });
}

function flash(objids) {
  const set = new Set(objids);
  document.querySelectorAll('#pointsWrap tbody tr').forEach(tr => {
    if (set.has(tr.dataset.o)) { tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); }
  });
}

function startPolling() {
  const varAv = !S.live;
  S.live = true;
  // Bolgen hoerer til OVERGANGEN. Endrer du intervallet mens Live allerede
  // gaar, kalles denne paa nytt - og da skal det ikke skje noe.
  if (varAv && !bevegelseAv()) slaaPaaNytt($('pointsWrap'), 'vaakner', 950);
  const ms = parseInt($('pollInt').value, 10);
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(pollTick, ms);
  pollTick();
  $('pollBtn').textContent = 'Live på';
  $('pollBtn').classList.add('on');
  $('sbLive').dataset.live = 'Live ' + (ms / 1000) + 's';
  markFreshness();
}
function stopPolling() {
  S.live = false;
  clearInterval(S.pollTimer);
  $('pollBtn').textContent = 'Live av';
  $('pollBtn').classList.remove('on');
  markFreshness();
}

/* -------------------------------------------------------- snapshot / diff */
function takeSnapshot() {
  if (!S.activeDev) return;
  S.snapshot = {};
  S.points.forEach(p => S.snapshot[wkey(S.activeDev.address, p.objid)] = p.value);
  S.snapAt = new Date();
  $('sbSnap').innerHTML = `<b>snapshot</b> ${S.snapAt.toLocaleTimeString('no')}`;
  $('snapBtn').textContent = 'Nytt snapshot';
  toast(S.points.length + ' verdier lagret — endringer markeres gult');
  renderPoints();
}

/* ------------------------------------------------------------------- CSV */
function exportCSV() {
  const rows = actionRows();
  const head = ['objekt', 'type', 'instans', 'navn', 'verdi', 'tilstandstekst',
                'alle tilstander', 'enhet', 'beskrivelse', 'status'];
  const lines = [head.join(';')];
  rows.forEach(p => lines.push([
    p.objid, p.type, p.instance, p.name || '', p.value ?? '',
    stateTextFor(p) || schedTekst(p),
    Array.isArray(p.state_text) ? p.state_text.map((t, i) => `${i + 1}=${t}`).join(' | ') : '',
    p.unit_symbol || '', p.description || '', (p.status || []).join('|'),
  ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')));
  // BOM so Excel opens the Norwegian characters correctly
  const blob = new Blob(['﻿' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bacnet_${S.activeDev.device_instance}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(rows.length + ' rader eksportert' + (selectedVisible().length ? ' (kun valgte)' : ''));
}

/* --------------------------------------------------------- EDE 2.3 export */
// Numeric BACnet codes required by the EDE format. Names alone are not
// valid EDE, so anything unmapped is left blank rather than guessed.
/* Object type numbers per ASHRAE 135 Table K-1. The table used to cover only
   the nine types that carry a live value, because those were the only ones the
   table ever showed. With "alle objekttyper" on, a schedule or a trend log
   reaches the export too - and an EDE row with a blank object-type is rejected
   by the tools that read it, so the rest of the common types belong here. */
const EDE_OBJ_TYPE = {
  'analog-input': 0, 'analog-output': 1, 'analog-value': 2,
  'binary-input': 3, 'binary-output': 4, 'binary-value': 5,
  'calendar': 6, 'command': 7, 'device': 8, 'event-enrollment': 9,
  'file': 10, 'group': 11, 'loop': 12,
  'multi-state-input': 13, 'multi-state-output': 14, 'notification-class': 15,
  'program': 16, 'schedule': 17, 'averaging': 18, 'multi-state-value': 19,
  'trend-log': 20, 'life-safety-point': 21, 'life-safety-zone': 22,
  'accumulator': 23, 'pulse-converter': 24, 'event-log': 25,
  'trend-log-multiple': 27, 'load-control': 28, 'structured-view': 29,
  'access-door': 30, 'lighting-output': 54, 'binary-lighting-output': 55,
};
/* Engineering-unit codes per ASHRAE 135 Table K-2, taken from the same
   lookup table Beckhoff ships with its EDE exports. The short list this
   replaced covered 24 of them, so anything less common - cubic metres, for
   one - exported with an empty unit-code and the reader had to guess. */
const EDE_UNIT = {
  'square-meters': 0, 'square-feet': 1, 'milliamperes': 2, 'amperes': 3, 'ohms': 4,
  'volts': 5, 'kilovolts': 6, 'megavolts': 7, 'volt-amperes': 8, 'kilovolt-amperes': 9,
  'megavolt-amperes': 10, 'volt-amperes-reactive': 11, 'kilovolt-amperes-reactive': 12,
  'megavolt-amperes-reactive': 13, 'degrees-phase': 14, 'power-factor': 15, 'joules': 16,
  'kilojoules': 17, 'watt-hours': 18, 'kilowatt-hours': 19, 'btus': 20, 'therms': 21,
  'ton-hours': 22, 'joules-per-kilogram-dry-air': 23, 'btus-per-pound-dry-air': 24,
  'cycles-per-hour': 25, 'cycles-per-minute': 26, 'hertz': 27,
  'grams-of-water-per-kilogram-dry-air': 28, 'percent-relative-humidity': 29,
  'millimeters': 30, 'meters': 31, 'inches': 32, 'feet': 33, 'watts-per-square-foot': 34,
  'watts-per-square-meter': 35, 'lumens': 36, 'luxes': 37, 'foot-candles': 38,
  'kilograms': 39, 'pounds-mass': 40, 'tons': 41, 'kilograms-per-second': 42,
  'kilograms-per-minute': 43, 'kilograms-per-hour': 44, 'pounds-mass-per-minute': 45,
  'pounds-mass-per-hour': 46, 'watts': 47, 'kilowatts': 48, 'megawatts': 49,
  'btus-per-hour': 50, 'horsepower': 51, 'tons-refrigeration': 52, 'pascals': 53,
  'kilopascals': 54, 'bars': 55, 'pounds-force-per-square-inch': 56,
  'centimeters-of-water': 57, 'inches-of-water': 58, 'millimeters-of-mercury': 59,
  'centimeters-of-mercury': 60, 'inches-of-mercury': 61, 'degrees-Celsius': 62,
  'degrees-celsius': 62, 'degrees-Kelvin': 63, 'degrees-kelvin': 63,
  'degrees-Fahrenheit': 64, 'degrees-fahrenheit': 64, 'degree-days-Celsius': 65,
  'degree-days-Fahrenheit': 66, 'years': 67, 'months': 68, 'weeks': 69, 'days': 70,
  'hours': 71, 'minutes': 72, 'seconds': 73, 'meters-per-second': 74,
  'kilometers-per-hour': 75, 'feet-per-second': 76, 'feet-per-minute': 77,
  'miles-per-hour': 78, 'cubic-feet': 79, 'cubic-meters': 80, 'imperial-gallons': 81,
  'liters': 82, 'us-gallons': 83, 'cubic-feet-per-minute': 84,
  'cubic-meters-per-second': 85, 'imperial-gallons-per-minute': 86,
  'liters-per-second': 87, 'liters-per-minute': 88, 'us-gallons-per-minute': 89,
  'degrees-angular': 90, 'degrees-Celsius-per-hour': 91, 'degrees-Celsius-per-minute': 92,
  'degrees-Fahrenheit-per-hour': 93, 'degrees-Fahrenheit-per-minute': 94, 'no-units': 95,
  'parts-per-million': 96, 'parts-per-billion': 97, 'percent': 98,
  'percent-per-second': 99, 'per-minute': 100, 'per-second': 101,
  'psi-per-degree-Fahrenheit': 102, 'radians': 103, 'revolutions-per-minute': 104,
  'currency1': 105, 'currency2': 106, 'currency3': 107, 'currency4': 108, 'currency5': 109,
  'currency6': 110, 'currency7': 111, 'currency8': 112, 'currency9': 113,
  'currency10': 114, 'square-inches': 115, 'square-centimeters': 116,
  'btus-per-pound': 117, 'centimeters': 118, 'pounds-mass-per-second': 119,
  'delta-degrees-Fahrenheit': 120, 'delta-degrees-Kelvin': 121, 'kilohms': 122,
  'megohms': 123, 'millivolts': 124, 'kilojoules-per-kilogram': 125, 'megajoules': 126,
  'joules-per-degree-Kelvin': 127, 'joules-per-kilogram-degree-Kelvin': 128,
  'kilohertz': 129, 'megahertz': 130, 'per-hour': 131, 'milliwatts': 132,
  'hectopascals': 133, 'millibars': 134, 'cubic-meters-per-hour': 135,
  'liters-per-hour': 136, 'kilowatt-hours-per-square-meter': 137,
  'kilowatt-hours-per-square-foot': 138, 'megajoules-per-square-meter': 139,
  'megajoules-per-square-foot': 140, 'watts-per-square-meter-degree-kelvin': 141,
  'cubic-feet-per-second': 142, 'percent-obscuration-per-foot': 143,
  'percent-obscuration-per-meter': 144, 'milliohms': 145, 'megawatt-hours': 146,
  'kilo-btus': 147, 'mega-btus': 148, 'kilojoules-per-kilogram-dry-air': 149,
  'megajoules-per-kilogram-dry-air': 150, 'kilojoules-per-degree-Kelvin': 151,
  'megajoules-per-degree-Kelvin': 152, 'newton': 153, 'grams-per-second': 154,
  'grams-per-minute': 155, 'tons-per-hour': 156, 'kilo-btus-per-hour': 157,
  'hundredths-seconds': 158, 'milliseconds': 159, 'newton-meters': 160,
  'millimeters-per-second': 161, 'millimeters-per-minute': 162, 'meters-per-minute': 163,
  'meters-per-hour': 164, 'cubic-meters-per-minute': 165,
  'meters-per-second-per-second': 166, 'amperes-per-meter': 167,
  'amperes-per-square-meter': 168, 'ampere-square-meters': 169, 'farads': 170,
  'henrys': 171, 'ohm-meters': 172, 'siemens': 173, 'siemens-per-meter': 174,
  'teslas': 175, 'volts-per-degree-Kelvin': 176, 'volts-per-meter': 177, 'webers': 178,
  'candelas': 179, 'candelas-per-square-meter': 180, 'degrees-Kelvin-per-hour': 181,
  'degrees-Kelvin-per-minute': 182, 'joule-seconds': 183, 'radians-per-second': 184,
  'square-meters-per-Newton': 185, 'kilograms-per-cubic-meter': 186, 'newton-seconds': 187,
  'newtons-per-meter': 188, 'watts-per-meter-per-degree-Kelvin': 189, 'microsiemens': 190,
  'cubic-feet-per-hour': 191, 'us-gallons-per-hour': 192, 'kilometers': 193,
  'micrometers': 194, 'grams': 195, 'milligrams': 196, 'milliliters': 197,
  'milliliters-per-second': 198, 'decibels': 199, 'decibels-millivolt': 200,
  'decibels-volt': 201, 'millisiemens': 202, 'watt-hours-reactive': 203,
  'kilowatt-hours-reactive': 204, 'megawatt-hours-reactive': 205,
  'millimeters-of-water': 206, 'per-mille': 207, 'grams-per-gram': 208,
  'kilograms-per-kilogram': 209, 'grams-per-kilogram': 210, 'milligrams-per-gram': 211,
  'milligrams-per-kilogram': 212, 'grams-per-milliliter': 213, 'grams-per-liter': 214,
  'milligrams-per-liter': 215, 'micrograms-per-liter': 216, 'grams-per-cubic-meter': 217,
  'milligrams-per-cubic-meter': 218, 'micrograms-per-cubic-meter': 219,
  'nanograms-per-cubic-meter': 220, 'grams-per-cubic-centimeter': 221, 'becquerels': 222,
  'kilobecquerels': 223, 'megabecquerels': 224, 'gray': 225, 'milligray': 226,
  'microgray': 227, 'sieverts': 228, 'millisieverts': 229, 'microsieverts': 230,
  'microsieverts-per-hour': 231, 'decibels-a': 232, 'nephelometric-turbidity-unit': 233,
  'pH': 234, 'grams-per-square-meter': 235, 'minutes-per-degree-kelvin': 236,
};

/* ---------------------------------------------------------------- schedules */
/* BACnet stores a weekly schedule as transition points: "at 07:00 the value
   becomes X". A week grid needs spans, so each entry runs until the next one
   or to midnight. */
const SCHED_DAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

function timeToMin(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function minToTime(v) {
  const h = Math.floor(v / 60), m = v % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function spansFromEntries(entries) {
  const pts = (entries || [])
    .map(e => ({min: timeToMin(e.time), value: e.value}))
    .filter(e => e.min !== null)
    .sort((a, b) => a.min - b.min);
  if (!pts.length) return [];

  const spans = [];
  // A schedule that does not start at midnight leaves the small hours to the
  // previous day's last value; show that rather than a hole.
  if (pts[0].min > 0) {
    spans.push({from: 0, to: pts[0].min, value: pts[pts.length - 1].value, carried: true});
  }
  pts.forEach((p, i) => {
    const to = i + 1 < pts.length ? pts[i + 1].min : 24 * 60;
    if (to > p.min) spans.push({from: p.min, to, value: p.value});
  });
  return spans;
}

/* Who is holding this point.

   An overridden point is one that is not following its own logic, and the tool
   said that much already. What it did not say was at which priority - and that
   is the difference between "a person forced this from a keyboard" (priority 8
   is the operator level) and "a program is driving it" (16 is the bottom). On
   a commissioning job that is the whole question, and it was one that sent you
   into another tool to answer.

   Read only for the points on screen, and only when you ask to see the
   overridden ones: a priority-array is sixteen values per object, and reading
   it for two thousand points on every load would cost more than it is worth. */
const PRI_NAVN = {
  1: 'manuell nød', 2: 'automatisk nød', 5: 'kritisk', 6: 'minimum på',
  8: 'operatør', 10: 'automatikk', 16: 'laveste',
};

function tvungetTekst(p) {
  const f = p._tvunget;
  if (!f) return '';
  if (!f.pri) return f.grunn || '';
  return `holdt @${f.pri}${PRI_NAVN[f.pri] ? ' · ' + PRI_NAVN[f.pri] : ''}`;
}

async function hentTvungne() {
  if (!S.activeDev) return;
  const kandidater = visiblePoints()
    .filter(p => p.writable && !p._tvunget
              && (p.status || []).some(s => s === 'overridden' || s === 'out-of-service'))
    .slice(0, 400);
  if (!kandidater.length) return;
  let d;
  try {
    d = await api('/api/points/forced',
                  {address: S.activeDev.address, objids: kandidater.map(p => p.objid)});
  } catch { return; }
  if (d.status !== 'done') return;
  let holdt = 0, lokalt = 0;
  Object.entries(d.forced || {}).forEach(([oid, f]) => {
    const p = S.pointIndex.get(oid);
    if (!p) return;
    p._tvunget = f;
    p._hay = undefined;
    if (f.pri) holdt++; else if (f.grunn === 'lokal overstyring pa enheten') lokalt++;
  });
  renderPoints();
  const deler = [];
  if (holdt) deler.push(`${holdt} holdt av en prioritet`);
  if (lokalt) deler.push(`${lokalt} overstyrt lokalt p\u00e5 enheten`);
  if (deler.length) toast(deler.join(' \u00b7 '));
}

/* What a schedule is doing right now, and when that changes.
   A schedule row reading "1" is useless on a point list - the question is
   always "is it on, and until when". Both answers are in the weekly schedule,
   which the server now reads alongside the points.

   The controller's own clock decides, not the PC's: a schedule fires on
   device time, and on this site one controller is 18 days out. */
function schedNow(p) {
  const uke = p.weekly;
  if (!Array.isArray(uke) || !uke.length) return null;

  const klokke = deviceNow();
  // BACnet weekly-schedule index 0 is Monday; JS getDay() has Sunday at 0.
  let dag = (klokke.getDay() + 6) % 7;
  const min = klokke.getHours() * 60 + klokke.getMinutes();

  const spans = i => spansFromEntries((uke[i] || {}).entries);
  const idag = spans(dag);
  // A day with no entries is not a gap in our reading - the schedule simply
  // has no transitions that day and holds schedule-default. Saying so beats
  // showing an empty cell that looks like a failed read.
  if (!idag.length) return {tom: true};

  const naa = idag.find(sp => min >= sp.from && min < sp.to);
  if (!naa) return {tom: true};

  // Walk forward for the next transition - it may be past midnight, and a
  // schedule that holds one value all week has none at all. Only a change to a
  // DIFFERENT value counts: a schedule sitting at 1 every day was reporting
  // "til fre 00:00 -> 1", which is a transition to what it already is.
  let neste = idag.find(sp => sp.from > min && sp.value !== naa.value);
  let dagerFram = 0;
  while (!neste && dagerFram < 7) {
    dagerFram++;
    neste = spans((dag + dagerFram) % 7).find(sp => sp.value !== naa.value);
  }
  if (dagerFram >= 7) neste = null;

  return {
    verdi: naa.value,
    til: neste ? minToTime(neste.from) : null,
    nesteVerdi: neste ? neste.value : null,
    dagerFram,
  };
}

/* The controller's clock, as far as we know it.

   device-time is a reading taken when the device was identified, so using it
   directly would freeze "now" at that moment. clock-drift is the offset that
   was measured against this PC, and that offset stays true as time passes -
   so apply it to the current time instead. Falls back to this PC's clock when
   the device never answered local-date/local-time. */
function deviceNow() {
  const id = (S.identity || {})[(S.activeDev || {}).address] || {};
  const drift = id['clock-drift'];
  return typeof drift === 'number' ? new Date(Date.now() + drift * 1000) : new Date();
}

function schedTekst(p) {
  const st = schedNow(p);
  if (!st) return '';
  if (st.tom) return 'ingen skift i dag';
  if (!st.til) return 'hele uka';
  const naar = st.dagerFram === 0 ? st.til
             : st.dagerFram === 1 ? 'i morgen ' + st.til
             : SCHED_DAYS[(deviceNow().getDay() + 6 + st.dagerFram) % 7] + ' ' + st.til;
  return `til ${naar} \u2192 ${st.nesteVerdi}`;
}

/* Colour by meaning where the value says something ("Høy"/"On"/1), otherwise
   a stable colour per distinct value so the week still reads as a pattern. */
const SCHED_PALETTE = ['#3f6f8e', '#6b5b95', '#8e6f3f', '#4f7a6a', '#7a4f6a'];
/* The words are Norwegian on these controllers - "På" and "Av" - and neither
   was recognised, so a schedule that is plainly on and off drew in two
   arbitrary palette colours instead of green and red. The state texts read
   off this site supply the rest: Normal/Alarm, Stoppet/Drift, Utløst. */
function schedColor(v, seen) {
  const s = String(v ?? '').toLowerCase().trim();
  if (['1', 'true', 'active', 'on', 'høy', 'hoy', 'high', 'comfort',
       'på', 'pa', 'drift', 'normal', 'dag', 'komfort'].includes(s)) return '#4a7c59';
  if (['0', 'false', 'inactive', 'off', 'lav', 'low', 'natt', 'standby',
       'av', 'stopp', 'stoppet', 'alarm', 'utløst', 'utlost', 'feil',
       'spar'].includes(s)) return '#8c3b38';
  if (!seen.has(s)) seen.set(s, SCHED_PALETTE[seen.size % SCHED_PALETTE.length]);
  return seen.get(s);
}

/* The week grid, editable the way Niagara's BACnet scheduler is: drag a
   block's edge to move the transition it starts, drag its middle to move the
   whole period, double-click to change the value. Nothing is sent to the
   controller until "Lagre til kontroller" - the grid edits a working copy so
   a mis-drag costs nothing.

   The underlying BACnet model is transitions, not blocks: a day is a list of
   {time, value} pairs and a block is simply the gap until the next pair. That
   is why dragging a block's bottom edge moves the NEXT transition. */
const SNAP_MIN = 15;                    // minutter dragging snapper til
const WK_H = 620;                       // px for 24 timer

function snapMin(m) {
  return Math.max(0, Math.min(1440 - SNAP_MIN,
    Math.round(m / SNAP_MIN) * SNAP_MIN));
}

function renderWeekGrid(sch) {
  const seen = new Map();
  const hours = [];
  for (let h = 3; h < 24; h += 3) {
    hours.push(`<div class="wk-h" style="top:${(h * 60 / 1440) * WK_H}px">${String(h).padStart(2, '0')}:00</div>`);
  }

  const kanRedigere = !S.readOnly;
  const cols = (sch.weekly || []).map((day, i) => {
    const entries = (day.entries || []).slice()
      .sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
    const spans = spansFromEntries(entries);
    const blocks = spans.map(sp => {
      const top = (sp.from / 1440) * WK_H;
      const hgt = ((sp.to - sp.from) / 1440) * WK_H;
      const label = sp.value === null ? 'null'
                  : sp.value === undefined ? '—' : String(sp.value);
      // Which transition does this block start from? A carried block belongs
      // to the previous day and has no entry of its own to drag.
      const idx = sp.carried ? -1 : entries.findIndex(e => timeToMin(e.time) === sp.from);
      const valgt = S.ukeValgt && S.ukeValgt.dag === i && S.ukeValgt.idx === idx;
      return `<div class="wk-blk${sp.carried ? ' carried' : ''}${
                     kanRedigere && idx >= 0 ? ' redigerbar' : ''}${valgt ? ' valgt' : ''}"
                   data-dag="${i}" data-idx="${idx}" data-til="${sp.to}"
                   style="top:${top}px;height:${Math.max(hgt, 2)}px;background:${schedColor(sp.value, seen)}"
                   title="${esc(label)} ${minToTime(sp.from)}–${minToTime(sp.to === 1440 ? 0 : sp.to)}${
                     kanRedigere && idx >= 0 ? ' — klikk for å endre nedenfor, dra for å flytte' : ''}">
        ${kanRedigere && idx >= 0 ? '<span class="wk-grep topp"></span>' : ''}
        <b>${esc(label)}</b>
        <i>${minToTime(sp.from)} - ${minToTime(sp.to === 1440 ? 0 : sp.to)}</i>
        ${kanRedigere && idx >= 0 ? '<span class="wk-grep bunn"></span>' : ''}
      </div>`;
    }).join('');
    return `<div class="wk-col">
      <div class="wk-day">${SCHED_DAYS[i] || day.day}</div>
      <div class="wk-body" data-dag="${i}" style="height:${WK_H}px">${
        blocks || '<div class="wk-empty">tomt</div>'}</div>
    </div>`;
  }).join('');

  return `<div class="wk-wrap">
    <div class="wk-axis" style="height:${WK_H}px">${hours.join('')}</div>
    <div class="wk-grid">${cols}</div>
  </div>`;
}

/* ------------------------------------------------------- redigering */
/* S.ukeKladd holds the working copy; S.ukeRort says whether it differs from
   what the controller has. */
function ukeKladd() {
  return S.ukeKladd;
}

function tegnUke() {
  const sch = S.ukeKladd;
  if (!sch) return;
  const note = (sch.weekly || []).every(d => !(d.entries || []).length)
    ? '<div class="wk-note">Dette skjemaet har ingen tidspunkt lagt inn i kontrolleren. '
      + 'Dra i en tom dag for å legge inn den første perioden.</div>'
    : '';
  /* Every edit redraws the whole week, which throws away the field being
     typed in - so remember where the cursor was and put it back. Without this
     you type an hour, the row rebuilds, and the next keystroke goes nowhere. */
  const aktiv = document.activeElement;
  const fokusId = (aktiv && $('schEdit') && $('schEdit').contains(aktiv)) ? aktiv.id : null;

  $('schBody').innerHTML = note + renderWeekGrid(sch) + ukeFot();
  tegnRedigering();
  koblUke();

  if (fokusId) {
    const igjen = $(fokusId);
    if (igjen) { igjen.focus(); if (igjen.select) igjen.select(); }
  }
}

function ukeFot() {
  if (S.readOnly) {
    return `<div class="wk-foot"><span class="wk-hint">Lesemodus er på — ukeprogrammet kan ikke endres.</span></div>`;
  }
  return `<div class="wk-foot">
    <span class="wk-hint">Klikk en blokk og endre tidene nederst · «Del i to» lager en ny
      periode · dra blokken for å flytte · dra kanten for å endre lengden ·
      dra i en tom dag for å tegne en periode</span>
    <span>
      <button class="btn" id="ukeAngre"${S.ukeRort ? '' : ' disabled'}>Forkast</button>
      <button class="btn primary" id="ukeLagre"${S.ukeRort ? '' : ' disabled'}>Lagre til kontroller</button>
    </span>
  </div>`;
}

function koblUke() {
  const rot = $('schBody');
  if (!rot || S.readOnly) return;

  rot.querySelectorAll('.wk-blk.redigerbar').forEach(el => {
    el.addEventListener('mousedown', ev => startDra(ev, el));
    el.addEventListener('contextmenu', ev => { ev.preventDefault(); fjernSkift(el); });
  });
  // Dragging across an empty part of a day is how a new period is made -
  // the same gesture as in the scheduler people already use.
  rot.querySelectorAll('.wk-body').forEach(el => {
    el.addEventListener('mousedown', ev => startNyPeriode(ev, el));
  });

  const a = $('ukeAngre');
  if (a) a.onclick = () => {
    S.ukeKladd = JSON.parse(JSON.stringify(S.ukeOrig));
    S.ukeRort = false;
    tegnUke();
    toast('Endringene er forkastet');
  };
  const l = $('ukeLagre');
  if (l) l.onclick = () => lagreUke();
}

function dagEntries(dag) {
  const d = S.ukeKladd.weekly[dag];
  if (!d.entries) d.entries = [];
  d.entries.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  return d.entries;
}

function startDra(ev, el) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();          // ellers starter dagen en ny periode under
  const dag = +el.dataset.dag, idx = +el.dataset.idx;
  const entries = dagEntries(dag);
  const e = entries[idx];
  if (!e) return;
  // Selecting is the point of the click; the drag is what may or may not
  // follow. Doing it here means a plain click both selects and fills the row
  // at the bottom without a second gesture.
  velgBlokk(dag, idx);

  const r = el.getBoundingClientRect();
  const naerTopp = ev.clientY - r.top < 8;
  const naerBunn = r.bottom - ev.clientY < 8;
  const neste = entries[idx + 1];

  const start = ev.clientY;
  const startEgen = timeToMin(e.time);
  const startNeste = neste ? timeToMin(neste.time) : null;
  // A transition may not pass its neighbours; the day would reorder itself
  // under the pointer and the drag would become nonsense.
  const forrige = idx > 0 ? timeToMin(entries[idx - 1].time) : 0;
  const etter = startNeste !== null ? startNeste : 1440;

  const flytt = m => {
    const dm = ((m.clientY - start) / WK_H) * 1440;
    if (naerBunn && neste) {
      const etterNeste = entries[idx + 2] ? timeToMin(entries[idx + 2].time) : 1440;
      neste.time = minToTime(Math.max(startEgen + SNAP_MIN,
        Math.min(etterNeste - SNAP_MIN, snapMin(startNeste + dm))));
    } else if (naerTopp || !neste) {
      e.time = minToTime(Math.max(forrige + (idx > 0 ? SNAP_MIN : 0),
        Math.min(etter - SNAP_MIN, snapMin(startEgen + dm))));
    } else {
      // Middle: move the whole period, both edges together.
      const lengde = startNeste - startEgen;
      const etterNeste = entries[idx + 2] ? timeToMin(entries[idx + 2].time) : 1440;
      let ny = snapMin(startEgen + dm);
      ny = Math.max(forrige + (idx > 0 ? SNAP_MIN : 0), Math.min(etterNeste - lengde, ny));
      e.time = minToTime(ny);
      neste.time = minToTime(ny + lengde);
    }
    S.ukeRort = true;
    tegnUke();
  };
  const slipp = () => {
    document.removeEventListener('mousemove', flytt);
    document.removeEventListener('mouseup', slipp);
    document.body.classList.remove('drar');
  };
  document.body.classList.add('drar');
  document.addEventListener('mousemove', flytt);
  document.addEventListener('mouseup', slipp);
}

/* ------------------------------------------------ valg og bunnraden */
function velgBlokk(dag, idx) {
  S.ukeValgt = (idx >= 0) ? {dag, idx} : null;
  const rot = $('schBody');
  if (rot) rot.querySelectorAll('.wk-blk').forEach(b => b.classList.toggle(
    'valgt', +b.dataset.dag === dag && +b.dataset.idx === idx));
  tegnRedigering();
}

/* Where a block ends is where the next one starts; the last one runs to
   midnight, which is why the end reads 00:00 there. */
function blokkSlutt(dag, idx) {
  const e = dagEntries(dag);
  return e[idx + 1] ? timeToMin(e[idx + 1].time) : 1440;
}

function tegnRedigering() {
  const bar = $('schEdit');
  if (!bar) return;
  const v = S.ukeValgt;
  const e = v ? dagEntries(v.dag)[v.idx] : null;
  if (!e || S.readOnly) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;

  const fra = timeToMin(e.time);
  const til = blokkSlutt(v.dag, v.idx);
  const erNull = e.value === null;
  const valg = ukeVerdier();
  const opts = valg.map(x =>
    `<option value="${esc(x)}"${!erNull && String(e.value) === x ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const farge = erNull ? 'var(--fg-3)' : schedColor(e.value, new Map());

  const lengde = Math.max(0, til - fra);
  const varighet = lengde >= 60
    ? `${Math.floor(lengde / 60)} t${lengde % 60 ? ' ' + (lengde % 60) + ' min' : ''}`
    : `${lengde} min`;

  const tid = (id, m) => `<span class="tid-boks">
      <input id="${id}T" class="tf" inputmode="numeric" maxlength="2" data-maks="23"
             value="${String(Math.floor(m / 60)).padStart(2, '0')}" aria-label="time">
      <span class="kolon">:</span>
      <input id="${id}M" class="tf" inputmode="numeric" maxlength="2" data-maks="59"
             data-steg="5" value="${String(m % 60).padStart(2, '0')}" aria-label="minutt">
    </span>`;

  bar.innerHTML = `
    <span class="wk-dag">${SCHED_DAYS[v.dag]}</span>
    <label class="wk-felt"><span>Hendelsesstart</span>${tid('hs', fra)}</label>
    <label class="wk-felt"><span>Hendelsesslutt</span>${tid('he', til === 1440 ? 0 : til)}</label>
    <label class="wk-felt"><span>Hendelsesverdi</span>
      <span class="sel-boks">
        <span class="prikk" style="background:${farge}"></span>
        <select id="hvVal"${erNull ? ' disabled' : ''}>${opts}</select>
      </span></label>
    <label class="wk-null"><input type="checkbox" id="hvNull"${erNull ? ' checked' : ''}> null</label>
    <span class="wk-varighet">${esc(varighet)}${til === 1440 ? ' · til midnatt' : ''}</span>
    <span class="wk-handling">
      <button class="btn" id="hvDel">Del i to</button>
      <button class="btn fare" id="hvFjern">Fjern perioden</button>
    </span>`;

  const tall = (id) => {
    const n = parseInt($(id).value, 10);
    return Number.isFinite(n) ? n : 0;
  };
  const les = id => {
    const t = Math.max(0, Math.min(23, tall(id + 'T')));
    const m = Math.max(0, Math.min(59, tall(id + 'M')));
    return t * 60 + m;
  };

  /* One behaviour for all four fields: digits only, two of them, arrow keys
     step, and the value is applied when the field is left or Enter is
     pressed - not on every keystroke, or typing "1" on the way to "11" would
     move the block to 01:00 first. */
  bar.querySelectorAll('.tf').forEach(inp => {
    const maks = +inp.dataset.maks;
    const steg = +(inp.dataset.steg || 1);
    const bruk = () => {
      const n = Math.max(0, Math.min(maks, tall(inp.id)));
      inp.value = String(n).padStart(2, '0');
      if (inp.id.startsWith('hs')) settStart(les('hs'));
      else settSlutt(les('he'));
    };
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 2);
    });
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('change', bruk);
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); bruk(); return; }
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      /* Step the whole time, not the one field: pressing down on the minutes
         of 08:00 has to give 07:55, the way a clock behaves. Stepping the
         field on its own gave 08:55, which is an hour out and reads as a
         glitch. The hour field steps a whole hour. */
      const par = inp.id.slice(0, 2);            // 'hs' eller 'he'
      const d = (ev.key === 'ArrowUp' ? steg : -steg) * (inp.id.endsWith('T') ? 60 : 1);
      /* Stop at the ends of the day rather than wrapping. Wrapping 00:00 down
         to 23:55 produced a start later than its own end, which the clamp
         then pulled back to one minute before it - the block collapsed and
         it looked broken. Standing still at the boundary is the honest
         answer. */
      const naa = les(par);
      const ny = Math.max(0, Math.min(1439, naa + d));
      $(par + 'T').value = String(Math.floor(ny / 60)).padStart(2, '0');
      $(par + 'M').value = String(ny % 60).padStart(2, '0');
      if (par === 'hs') settStart(ny); else settSlutt(ny);
    });
  });

  $('hvVal').onchange = () => { e.value = $('hvVal').value; S.ukeRort = true; tegnUke(); };
  $('hvNull').onchange = () => {
    // BACnet lets a schedule entry hold Null, which means it stops commanding
    // rather than commanding something. It is a real value here, not a blank.
    e.value = $('hvNull').checked ? null : (ukeVerdier()[0] ?? '0');
    S.ukeRort = true;
    tegnUke();
  };
  $('hvFjern').onclick = () => {
    dagEntries(v.dag).splice(v.idx, 1);
    S.ukeValgt = null;
    S.ukeRort = true;
    tegnUke();
  };

  /* Dragging out a new period needs somewhere empty to start the drag, and on
     these controllers every day is already covered by a single all-day block -
     there is no empty pixel to grab. Splitting the selected block gives the
     same result from the block you are already looking at; the times are then
     typed in above, which is how an exact 11:30 gets entered anyway. */
  $('hvDel').onclick = () => {
    const midt = snapMin(fra + (Math.min(til, 1440) - fra) / 2);
    if (midt <= fra || midt >= til) { toast('Perioden er for kort til å deles', true); return; }
    nyPeriode(v.dag, midt, Math.min(til, 1440));
  };
}

function settStart(min) {
  const v = S.ukeValgt;
  if (!v) return;
  const e = dagEntries(v.dag);
  const forrige = v.idx > 0 ? timeToMin(e[v.idx - 1].time) : -1;
  const neste = blokkSlutt(v.dag, v.idx);
  const ny = Math.max(forrige + 1, Math.min(neste - 1, min));
  e[v.idx].time = minToTime(ny);
  S.ukeRort = true;
  tegnUke();
}

/* Moving the end moves the NEXT transition. On the last block of the day
   there is no next one, so a new transition is inserted - carrying whatever
   was in force before this block, which is what "the period ends here" means.
*/
function settSlutt(min) {
  const v = S.ukeValgt;
  if (!v) return;
  const e = dagEntries(v.dag);
  const start = timeToMin(e[v.idx].time);
  if (min === 0) min = 1440;                       // 00:00 i sluttfeltet = midnatt
  if (e[v.idx + 1]) {
    const etter = e[v.idx + 2] ? timeToMin(e[v.idx + 2].time) : 1440;
    e[v.idx + 1].time = minToTime(Math.max(start + 1, Math.min(etter - 1, min)));
  } else if (min < 1440) {
    const tilbake = v.idx > 0 ? e[v.idx - 1].value : e[0].value;
    e.push({time: minToTime(Math.max(start + 1, min)), value: tilbake});
  }
  S.ukeRort = true;
  tegnUke();
}

/* Drag across empty space to lay out a new period. Two transitions go in: one
   at the start carrying the new value, one at the end putting back whatever
   was running before - so the rest of the day is left exactly as it was. */
function startNyPeriode(ev, kropp) {
  if (ev.button !== 0 || ev.target !== kropp) return;
  ev.preventDefault();
  const dag = +kropp.dataset.dag;
  const r = kropp.getBoundingClientRect();
  const fra = snapMin(((ev.clientY - r.top) / WK_H) * 1440);

  const spok = document.createElement('div');
  spok.className = 'wk-ny';
  kropp.appendChild(spok);
  let til = fra;

  const tegn = () => {
    const a = Math.min(fra, til), b = Math.max(fra, til);
    spok.style.top = (a / 1440) * WK_H + 'px';
    spok.style.height = Math.max(2, ((b - a) / 1440) * WK_H) + 'px';
    spok.innerHTML = `<b>${minToTime(a)} - ${minToTime(b === 1440 ? 0 : b)}</b>`;
  };
  tegn();

  const flytt = m => {
    til = snapMin(((m.clientY - r.top) / WK_H) * 1440);
    tegn();
  };
  const slipp = () => {
    document.removeEventListener('mousemove', flytt);
    document.removeEventListener('mouseup', slipp);
    document.body.classList.remove('drar');
    spok.remove();
    const a = Math.min(fra, til), b = Math.max(fra, til);
    // A click without a drag should not silently create anything.
    if (b - a < SNAP_MIN) { velgBlokk(-1, -1); return; }
    nyPeriode(dag, a, b);
  };
  document.body.classList.add('drar');
  document.addEventListener('mousemove', flytt);
  document.addEventListener('mouseup', slipp);
}

function nyPeriode(dag, fra, til) {
  const e = dagEntries(dag);
  const spans = spansFromEntries(e);
  const gjeldende = spans.find(sp => fra >= sp.from && fra < sp.to);

  /* What the day returns to when the new period ends. Normally that is
     whatever was running there already. A day with no entries at all has no
     such value - the schedule falls back to its default - so the default is
     what the closing transition carries. Getting this wrong made the new
     period the same value as the rest of the day: three blocks, one colour,
     nothing to see. */
  const valg = ukeVerdier();
  const tilbake = gjeldende ? gjeldende.value
    : (S.ukeKladd.value !== null && S.ukeKladd.value !== undefined
        ? String(S.ukeKladd.value) : (valg[0] ?? '0'));

  // And the period itself has to differ from that, or it changes nothing.
  const nyVerdi = valg.find(x => String(x) !== String(tilbake)) ?? tilbake;

  const uten = (t) => { const i = e.findIndex(x => timeToMin(x.time) === t); if (i >= 0) e.splice(i, 1); };
  uten(fra); uten(til);
  e.push({time: minToTime(fra), value: nyVerdi});
  if (til < 1440) e.push({time: minToTime(til), value: tilbake});

  S.ukeRort = true;
  const sortert = dagEntries(dag);
  S.ukeValgt = {dag, idx: sortert.findIndex(x => timeToMin(x.time) === fra)};
  tegnUke();
}

/* The values a schedule may take are whatever it already uses - offering a
   free text box invites a type the controller will reject. */
function ukeVerdier() {
  const sett = new Set();
  (S.ukeKladd.weekly || []).forEach(d => (d.entries || []).forEach(e => {
    // null is offered by its own checkbox, not as an entry in the list.
    if (e.value !== null && e.value !== undefined) sett.add(String(e.value));
  }));
  if (S.ukeKladd.value !== null && S.ukeKladd.value !== undefined) {
    sett.add(String(S.ukeKladd.value));
  }
  return [...sett].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function fjernSkift(el) {
  const dag = +el.dataset.dag, idx = +el.dataset.idx;
  const entries = dagEntries(dag);
  if (!entries[idx]) return;
  entries.splice(idx, 1);
  S.ukeRort = true;
  tegnUke();
}

/* The seven days as a plain comparable string, so "did anything actually
   change" is a question with an answer. */
function ukeSignatur(sch) {
  return (sch.weekly || []).map(d => (d.entries || [])
    .slice().sort((a, b) => timeToMin(a.time) - timeToMin(b.time))
    .map(e => `${e.time}=${e.value === null ? '\u2400null' : String(e.value ?? '')}`)
    .join(',')).join('|');
}

async function lagreUke() {
  const sch = S.ukeKladd;

  /* Refuse to send an unchanged schedule. The button is disabled until
     something is edited, but the function can still be reached another way -
     and it was: two writes reached a live controller during testing carrying
     exactly the values it already held. Nothing changed on the plant, but a
     write that cannot change anything has no business going out at all.
     Comparing against what was read makes that structural rather than a
     matter of which button is enabled. */
  if (S.ukeOrig && ukeSignatur(sch) === ukeSignatur(S.ukeOrig)) {
    S.ukeRort = false;
    tegnUke();
    toast('Ukeprogrammet er uendret — ingenting å skrive');
    return;
  }

  const dager = (sch.weekly || []).map(d => (d.entries || [])
    .slice().sort((a, b) => timeToMin(a.time) - timeToMin(b.time))
    .map(e => ({time: e.time,
                value: e.value === null ? null : String(e.value ?? '')})));
  const antall = dager.reduce((n, d) => n + d.length, 0);

  const linjer = dager.map((d, i) => `  ${SCHED_DAYS[i]}: ` +
    (d.length ? d.map(e => `${e.time}=${e.value === null ? 'null' : e.value}`).join('  ')
              : '(ingen)')).join('\n');
  if (!confirm(`Skrive ukeprogrammet til ${sch.name || sch.objid}?\n\n`
             + `Dette endrer når anlegget går, fra nå av.\n\n${linjer}\n\n`
             + `${antall} skift totalt.`)) return;

  const b = $('ukeLagre');
  if (b) { b.disabled = true; b.textContent = 'Skriver…'; }
  let d;
  try {
    d = await api('/api/schedule/write',
                  {address: S.activeDev.address, objid: sch.objid, dager});
  } catch (e) {
    d = {status: 'error', error: e.message};
  }
  if (d.status !== 'done') {
    toast(d.error || 'Skrivingen feilet', true);
    if (b) { b.disabled = false; b.textContent = 'Lagre til kontroller'; }
    return;
  }
  toast(`Ukeprogrammet er skrevet (${d.skift} skift, ${d.verdi_type})`);
  S.ukeOrig = JSON.parse(JSON.stringify(S.ukeKladd));
  S.ukeRort = false;
  // Read it back: what the controller stored is the truth, not what we sent.
  await openSchedules(sch.objid);
}

/* The list, not a tab strip: a controller with thirty schedules has to be
   navigable, and the shared name prefix is stripped so what is left is the bit
   that tells them apart. Filtering matches the name, the description and the
   object id, because on site you are as likely to be given "3004247" as a
   name. */
function tegnUrListe(filter) {
  const boks = $('schTabs');
  if (!boks) return;
  const q = (filter || '').toLowerCase().trim();
  const treff = S.schedules
    .map((s, i) => ({s, i}))
    .filter(({s}) => !q
      || (s.name || '').toLowerCase().includes(q)
      || (s.description || '').toLowerCase().includes(q)
      || s.objid.toLowerCase().includes(q));

  if (!treff.length) {
    boks.innerHTML = '<div class="gs-empty" style="padding:10px">Ingen ur matcher</div>';
    return;
  }

  const felles = commonNamePrefix(S.schedules.map(x => ({name: x.name || ''})));
  boks.innerHTML = treff.map(({s, i}) => {
    const navn = (s.name || s.objid).slice(felles.length) || (s.name || s.objid);
    const st = s.entry_count === 0 ? 'tomt' : `${s.entry_count} skift`;
    return `<button class="sch-tab${i === S.urValgt ? ' sel' : ''}" data-i="${i}"
              title="${esc(s.name || s.objid)}">${esc(navn)}<span class="st-sub">${
              esc(s.objid)} · ${st}</span></button>`;
  }).join('');

  boks.querySelectorAll('.sch-tab').forEach(b => b.onclick = () => {
    showSchedule(+b.dataset.i);
  });
}

async function openSchedules(velgObjid) {
  if (!S.activeDev) { toast('Velg en enhet først', true); return; }
  $('schOverlay').hidden = false;
  $('schBody').innerHTML = '<div class="gs-empty"><span class="spin"></span> Leser skjema…</div>';
  $('schTabs').innerHTML = '';
  const d = await api('/api/device/schedules', {
    address: S.activeDev.address, device_instance: S.activeDev.device_instance,
  });
  if (d.status !== 'done') { $('schBody').innerHTML = `<div class="gs-empty">${esc(d.error || 'Feil')}</div>`; return; }

  S.schedules = d.schedules || [];
  S.trendLogs = d.trend_logs || [];
  if (!S.schedules.length) {
    $('schBody').innerHTML = '<div class="gs-empty">Enheten har ingen skjema-objekter.</div>';
    return;
  }
  $('schCount').textContent = `${S.schedules.length} ur`;
  tegnUrListe();
  const f = $('schFilter');
  if (f) {
    f.value = '';
    f.oninput = () => tegnUrListe(f.value);
  }
  const i = velgObjid ? S.schedules.findIndex(x => x.objid === velgObjid) : 0;
  showSchedule(i >= 0 ? i : 0);
}
function closeSchedules() {
  if (S.ukeRort && !confirm('Ulagrede endringer i ukeprogrammet går tapt. Lukke likevel?')) return;
  S.ukeRort = false;
  $('schOverlay').hidden = true;
}

function showSchedule(i) {
  const s = S.schedules[i];
  if (!s) return;
  if (S.ukeRort && !confirm('Du har ulagrede endringer i ukeprogrammet. Forkaste dem?')) return;
  S.urValgt = i;
  const boks = $('schTabs');
  if (boks) boks.querySelectorAll('.sch-tab').forEach(b =>
    b.classList.toggle('sel', +b.dataset.i === i));
  // Edit a copy, never the read result - "Forkast" has to have something to
  // go back to, and a failed write must not leave the grid showing values the
  // controller never accepted.
  S.ukeOrig = JSON.parse(JSON.stringify(s));
  S.ukeKladd = JSON.parse(JSON.stringify(s));
  S.ukeRort = false;
  S.ukeValgt = null;
  $('schMeta').textContent =
    `${s.objid} · ${s.entry_count} tidspunkt · skriver på prioritet ${s.priority ?? '?'}`
    + (s.description ? ' · ' + s.description : '');
  tegnUke();
}

/* -------------------------------------------------------------- EDE compare */
/* Load a delivered EDE file and hold it up against what the controller
   actually reports. This is the documentation check that otherwise happens
   by eye in Excel. */
const EDE_TYPE_NAME = Object.fromEntries(
  Object.entries(EDE_OBJ_TYPE).map(([name, code]) => [String(code), name]));

function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseEDE(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  // The header is the first line naming the mandatory EDE columns; anything
  // before it is free-form project commentary.
  let hi = lines.findIndex(l => /object-name/i.test(l) && /object-type/i.test(l));
  if (hi < 0) return {error: 'Fant ikke EDE-kolonneoverskriften (object-name / object-type).'};

  const head = splitCsvLine(lines[hi]).map(h => h.trim().toLowerCase());
  const col = n => head.findIndex(h => h === n || h.startsWith(n));
  const iName = col('object-name');
  const iType = col('object-type');
  const iInst = col('object-instance');
  const iDesc = col('description');
  const iDev  = col('device obj');
  if (iName < 0 || iType < 0 || iInst < 0) {
    return {error: 'EDE-filen mangler object-name, object-type eller object-instance.'};
  }

  const rows = [];
  for (const line of lines.slice(hi + 1)) {
    if (line.trim().startsWith('#')) continue;
    const f = splitCsvLine(line);
    const typeRaw = (f[iType] || '').trim();
    const typeName = EDE_TYPE_NAME[typeRaw] || typeRaw.toLowerCase();
    const inst = parseInt((f[iInst] || '').trim(), 10);
    if (!typeName || isNaN(inst)) continue;
    rows.push({
      objid: `${typeName},${inst}`,
      name: (f[iName] || '').trim(),
      description: iDesc >= 0 ? (f[iDesc] || '').trim() : '',
      device: iDev >= 0 ? (f[iDev] || '').trim() : '',
    });
  }
  return {rows};
}

function compareEDE(edeRows) {
  const live = new Map(S.points.map(p => [p.objid, p]));
  const ede = new Map(edeRows.map(r => [r.objid, r]));

  const missing = [];   // in the file, not in the controller
  const renamed = [];   // same object, different name
  const extra = [];     // in the controller, not in the file
  let same = 0;

  for (const [objid, r] of ede) {
    const p = live.get(objid);
    if (!p) { missing.push(r); continue; }
    if ((p.name || '').trim() !== r.name.trim()) renamed.push({objid, ede: r.name, live: p.name || ''});
    else same++;
  }
  for (const [objid, p] of live) if (!ede.has(objid)) extra.push(p);

  return {missing, renamed, extra, same, edeCount: edeRows.length, liveCount: S.points.length};
}

function renderEdeResult(r, filename) {
  const sec = (title, items, render, cls) => items.length
    ? `<div class="ede-sec"><div class="ede-h ${cls}">${title} <span>${items.length}</span></div>
       ${items.slice(0, 150).map(render).join('')}
       ${items.length > 150 ? `<div class="ede-more">…og ${items.length - 150} til</div>` : ''}</div>`
    : '';

  $('edeMeta').textContent =
    `${esc(filename)} · ${r.edeCount} punkter i fil · ${r.liveCount} i anlegg · ${r.same} like`;

  $('edeBody').innerHTML =
    (r.missing.length || r.renamed.length || r.extra.length
      ? ''
      : '<div class="gs-empty">Ingen avvik — filen stemmer med anlegget.</div>')
    + sec('Mangler i anlegget', r.missing,
        x => `<div class="ede-row"><code>${esc(x.objid)}</code><span>${esc(x.name)}</span>
              <em>${esc(x.description)}</em></div>`, 'bad')
    + sec('Ulikt navn', r.renamed,
        x => `<div class="ede-row"><code>${esc(x.objid)}</code>
              <span><s>${esc(x.ede)}</s> → ${esc(x.live)}</span><em>fil → anlegg</em></div>`, 'warn')
    + sec('Finnes bare i anlegget', r.extra,
        x => `<div class="ede-row"><code>${esc(x.objid)}</code><span>${esc(x.name || '')}</span>
              <em>${esc(x.description || '')}</em></div>`, 'info');

  $('edeOverlay').hidden = false;
}
function closeEde() { $('edeOverlay').hidden = true; }

function startEdeCompare() {
  if (!S.activeDev || !S.points.length) { toast('Åpne en enhet først', true); return; }
  $('edeFile').value = '';
  $('edeFile').click();
}

async function onEdeFile(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const text = await f.text();
  const parsed = parseEDE(text);
  if (parsed.error) { toast(parsed.error, true); return; }
  if (!parsed.rows.length) { toast('Fant ingen punkter i filen', true); return; }
  renderEdeResult(compareEDE(parsed.rows), f.name);
}

/* EDE keeps state texts out of the main sheet: that sheet carries a reference
   number and the labels live in a companion "<navn>_StateTexts.csv", one list
   per row. Both YABE and Beckhoff write exactly that pair, and their files are
   what this follows - down to the header wording, since that is what the tools
   reading these files expect to find.

   A binary point counts here too. Its labels arrive as inactive-text and
   active-text rather than a state-text array, but they are state texts all the
   same: in a YABE export from one of these sites, 2004 of 2031 references are
   binary. Identical lists share a row, so a controller with hundreds of alarm
   points still needs only a handful. */
function buildStateTexts(rows) {
  const tabell = [];
  const sett = new Map();
  const ref = new Map();
  rows.forEach(p => {
    const st = p.state_text;
    if (!Array.isArray(st) || !st.length) return;
    if (!st.some(x => String(x ?? '').trim() !== '')) return;
    const k = st.join('\u0001');
    if (!sett.has(k)) { tabell.push(st); sett.set(k, tabell.length); }
    ref.set(p.objid, sett.get(k));
  });
  return {tabell, ref};
}

function exportEDE() {
  const dev = S.activeDev;
  if (!dev) return;
  const rows = actionRows();
  const st = buildStateTexts(rows);

  /* EDE is a semicolon file with no quoting at all - the delimiter is simply
     not allowed inside a field. Quoting every field, which is what a normal
     CSV wants, is what made our files unreadable to the tools that consume
     EDE. Strip separators and line breaks instead. */
  const f = v => String(v ?? '').replace(/[;\r\n]+/g, ' ').trim();

  // present-value-default is numeric in EDE; a binary point's "active" has to
  // go in as the state number the controller actually holds.
  const pv = p => {
    const v = p.value;
    if (v === null || v === undefined || v === '') return '';
    if (v === 'active') return 1;
    if (v === 'inactive') return 0;
    return typeof v === 'number' ? v : f(v);
  };

  // OBJECT_ANALOG_VALUE:3002175 - the type name in EDE's own spelling.
  const keyname = p => `OBJECT_${String(p.type || '').toUpperCase().replace(/-/g, '_')}:${p.instance}`;

  const KOL = 16;
  const pad = (felt, bredde = KOL) => {
    const ut = felt.slice();
    while (ut.length < bredde) ut.push('');
    return ut.join(';');
  };

  const n = new Date();
  const to = x => String(x).padStart(2, '0');
  // dd.MM.yyyy HH:mm, as the format sheet has it - not ISO.
  const stempel = `${to(n.getDate())}.${to(n.getMonth() + 1)}.${n.getFullYear()} `
                + `${to(n.getHours())}:${to(n.getMinutes())}`;

  const lines = [
    pad(['#Engineering-Data-Exchange']),
    pad(['PROJECT_NAME', f(tagInnstillinger().prosjekt || S.prosjektNavn
        || dev.object_name || `Enhet ${dev.device_instance}`)]),
    pad(['TIMESTAMP_OF_LAST_CHANGE', stempel]),
    pad(['AUTHOR_OF_LAST_CHANGE', 'BACnet Explorer']),
    pad(['VERSION_OF_LAYOUT', '2.2']),
    ['#mandatory', 'mandatory', 'mandatory', 'mandatory', 'mandatory',
     ...Array.from({length: KOL - 5}, () => 'optional')].join(';'),
    [
      '# keyname', 'device-object-instance', 'object-name', 'object-type',
      'object-instance', 'description', 'present-value-default',
      'min-present-value', 'max-present-value', 'settable', 'supports COV',
      'hi-limit', 'low-limit', 'state-text-reference', 'unit-code',
      'vendor-specific-address',
    ].join(';'),
  ];

  rows.forEach(p => {
    lines.push(pad([
      keyname(p),
      dev.device_instance,
      f(p.name),
      EDE_OBJ_TYPE[p.type] ?? '',
      p.instance ?? '',
      f(p.description),
      pv(p),
      '', '',
      p.writable ? 'Y' : 'N',
      '', '', '',
      st.ref.get(p.objid) ?? '',
      EDE_UNIT[p.units] ?? '',
    ]));
  });

  // The companion files are found by base name, so the four have to agree on
  // it: "<basis>_EDE.csv" alongside "<basis>_StateTexts.csv" is how YABE and
  // Beckhoff name them, and it is how a reader pairs them up.
  const dato = new Date().toISOString().slice(0, 10);
  const basis = `Device${dev.device_instance}_${dato}`;
  // No BOM: the reference files have none, and a BOM ahead of
  // "#Engineering-Data-Exchange" turns the format marker into an unknown line.
  const filer = [[lines.join('\r\n') + '\r\n', `${basis}_EDE.csv`]];

  if (st.tabell.length) {
    const bredde = Math.max(...st.tabell.map(t => t.length));
    // Header wording copied from the files YABE and Beckhoff produce - the
    // first two texts are named for the binary case they usually describe.
    const stLinjer = [
      '#State Text Reference',
      ['#Reference Number', 'Text 1 or Inactive-Text', 'Text 2 or Active-Text',
       ...Array.from({length: Math.max(0, bredde - 2)}, (_, i) => `Text ${i + 3}`)].join(';'),
    ];
    // Rows are not padded out to the header width; YABE writes each list at
    // its own length and readers cope with that.
    st.tabell.forEach((t, i) => stLinjer.push([i + 1, ...t.map(x => f(x))].join(';')));
    filer.push([stLinjer.join('\r\n') + '\r\n', `${basis}_StateTexts.csv`]);
  }

  /* The tag generator's own settings, written beside the export. They are not
     part of EDE - nothing will read them automatically - but they travel with
     the file, so the answers are next to the data they belong to instead of
     being retyped from memory a week later. */
  const tg = tagInnstillinger();
  if (Object.values(tg).some(v => v !== '' && v !== false)) {
    const tgL = ['#Tag generator settings', '#Felt;Verdi',
      `Prefix;${f(tg.prefiks)}`, `Cluster;${f(tg.cluster)}`,
      `Anleggsnavn;${f(tg.anleggsnavn)}`, `Prosjekt;${f(tg.prosjekt)}`,
      `Delimiter;${f(tg.skilletegn)}`,
      `BuildingIdFirst;${tg.byggIdForst ? 'Y' : 'N'}`,
      `VentilationSegment;${f(tg.ventLedd)}`, `Sort;${f(tg.sorter)}`];
    filer.push([tgL.join('\r\n') + '\r\n', `${basis}_TagSettings.csv`]);
  }

  // Static lookup tables. They carry no site data, but Beckhoff ships them
  // with every export and a reader that expects the set should find it. The
  // spelling is theirs, not ours: object types in CamelCase, units with
  // underscores, because that is what these files contain everywhere else.
  const objT = ['#Encoding of BACnet Object Types', '#Code, Object Type'];
  Object.entries(EDE_OBJ_TYPE).sort((a, b) => a[1] - b[1])
    .forEach(([navn, kode]) => objT.push(
      `${kode};${navn.split('-').map(x => x[0].toUpperCase() + x.slice(1)).join('')}`));
  filer.push([objT.join('\r\n') + '\r\n', `${basis}_ObjTypes.csv`]);

  const enh = ['#Encoding of BACnet Engineering Units', '#Code; UnitText'];
  Object.entries(EDE_UNIT).sort((a, b) => a[1] - b[1])
    .forEach(([navn, kode]) => enh.push(`${kode};${navn.replace(/-/g, '_')}`));
  filer.push([enh.join('\r\n') + '\r\n', `${basis}_Units.csv`]);

  // Chrome drops downloads fired in the same tick as a popup burst.
  filer.forEach(([tekst, navn], i) =>
    setTimeout(() => downloadText(tekst, navn, false), i * 350));

  toast(`${rows.length} punkter eksportert som EDE i ${filer.length} filer`
    + (st.tabell.length ? ` · ${st.tabell.length} tilstandslister` : '')
    + (selectedVisible().length ? ' (kun valgte)' : ''));
}

function downloadText(text, filename, bom = true) {
  // BOM keeps æøå intact when the file is opened in Excel - but EDE files are
  // read by machines that expect the first byte to be '#', so those pass false.
  const blob = new Blob([(bom ? '﻿' : '') + text], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* --------------------------------------------------- watch history export */
function exportWatchHistory() {
  if (!S.watch.length) { toast('Ingen punkter i overvåkingen', true); return; }
  const lines = ['ip;objekt;navn;enhet;prove;verdi'];
  S.watch.forEach(w => w.hist.forEach((v, i) =>
    lines.push([w.ip, w.objid, `"${(w.name || '').replace(/"/g, '""')}"`, w.unit, i + 1, v].join(';'))));
  downloadText(lines.join('\r\n'), `overvaaking_${new Date().toISOString().slice(0, 10)}.csv`);
  toast('Overvåkingshistorikk eksportert');
}

/* -------------------------------------------------------------- zoom view */
function openZoom() {
  if (!S.selected) { toast('Velg et punkt først', true); return; }
  $('zoomOverlay').hidden = false;
  updateZoom();
}
function closeZoom() { $('zoomOverlay').hidden = true; }

function updateZoom() {
  if ($('zoomOverlay').hidden) return;
  const p = S.pointIndex.get(S.selected);
  if (!p) return;
  const d = S.detail || {};
  let shown = fmtVal(p.value).t;
  if (Array.isArray(d['state-text']) && typeof p.value === 'number') {
    shown = d['state-text'][p.value - 1] || shown;
  } else if (p.value === 'active' && d['active-text']) shown = d['active-text'];
  else if (p.value === 'inactive' && d['inactive-text']) shown = d['inactive-text'];

  const alarm = p.status && p.status.length;
  $('zoomName').textContent = p.name || p.objid;
  $('zoomDesc').textContent = p.description || '';
  const zv = $('zoomVal');
  zv.className = 'zoom-val' + (alarm ? ' alarm' : '');
  /* Store tall som byttes ut med innerHTML ved hvert poll snapper - og et nytt
     element starter enhver animasjon paa nytt, som er feilen trendkurven og
     sparklinene hadde. Odometeret bytter bare sifrene som faktisk endret seg,
     paa plass. Dette er visninga du leser paa avstand; da er det nettopp den
     som skal vise at tallet beveger seg. */
  if (kanRulle(shown) && !bevegelseAv()) {
    tegnOdometer(zv, shown, p.unit_symbol || '');
  } else {
    zv.dataset.form = '';
    zv.innerHTML = esc(shown) + `<small>${esc(p.unit_symbol || '')}</small>`;
  }
  $('zoomMeta').textContent =
    `${p.objid} · ${S.activeDev.address}` +
    (alarm ? ` · ${p.status.join(', ')}` : '') +
    (S.live ? '' : ' · live er av');
}

/* ------------------------------------------------------------------ wiring */
$('localAddr').onchange = async e => {
  clearDiscovery();
  await connectTo(e.target.value);
  if (S.connected) toast('Sender fra ' + S.localAddr);
};
$('reconnBtn').onclick = async () => {
  await connectTo($('localAddr').value);
  toast(S.connected ? 'Tilkoblet på nytt' : 'Klarte ikke koble til', !S.connected);
};
$('cmpBtn').onclick = () => { closeMenus(); openSammenlign(); };
$('rapOktBtn').onclick = () => { closeMenus(); visSesjonsrapport(); };
$('rapSnapBtn').onclick = () => { closeMenus(); visSnapshotrapport(); };
$('rapKopi').onclick = () => {
  navigator.clipboard.writeText(RAPPORT_TEKST)
    .then(() => toast('Rapporten er kopiert - lim inn der du vil'))
    .catch(() => toast('Kunne ikke kopiere', true));
};

$('helpBtn').onclick = e => {
  e.stopPropagation();
  $('helpPop').hidden = !$('helpPop').hidden;
};
document.addEventListener('click', e => {
  if (!$('helpPop').hidden && !$('helpPop').contains(e.target) && e.target !== $('helpBtn')) {
    $('helpPop').hidden = true;
  }
});
$('scanBtn').onclick = runScan;
$('rangeInput').onkeydown = e => { if (e.key === 'Enter' && !$('scanBtn').disabled) runScan(); };

let qTimer;
$('q').oninput = e => {
  clearTimeout(qTimer);
  /* Radene som overlever soket glir opp til sin nye plass i stedet for aa bli
     byttet ut. Du ser at lista snevret seg inn, ikke at den ble en annen - og
     en rad du hadde oye paa er den samme raden etterpaa.

     Samme FLIP som sortering. 120ms debounce staar, saa det kjoerer ikke per
     tastetrykk; uten den ville hver bokstav starte en ny omflytting oppi den
     forrige. */
  qTimer = setTimeout(() => {
    S.filters.q = e.target.value;
    flyttRader($('pointsWrap'), renderPoints);
  }, 120);
};
$('typeSel').onchange = e => {
  S.filters.type = e.target.value;
  flyttRader($('pointsWrap'), renderPoints);
};
document.querySelectorAll('.menu-item[data-flag]').forEach(el => {
  el.onclick = () => {
    const f = el.dataset.flag;
    settFlaggfilter(S.filters.flag === f ? '' : f);
  };
});
[['fWrit', 'writable'], ['fDiff', 'diff']].forEach(([id, key]) => {
  $(id).onclick = () => {
    S.filters[key] = !S.filters[key];
    syncMenuStates();
    renderPoints();
  };
});
$('pollBtn').onclick = () => S.live ? stopPolling() : startPolling();
$('pollInt').onchange = () => { if (S.live) startPolling(); };
$('snapBtn').onclick = takeSnapshot;
$('csvBtn').onclick = exportCSV;
$('watchClear').onclick = () => { S.watch = []; renderWatch(); renderPoints(); };
$('edeBtn').onclick = exportEDE;
document.querySelectorAll('.cmd-segk').forEach(b =>
  b.onclick = () => settCmdSeg(b.dataset.seg));

$('cmdInput').oninput = () => {
  // First keystroke ends the deal-out; from here the list must change without
  // reintroducing itself.
  $('cmdList').classList.remove('kaskade');
  CMD_VALG = 0; renderCmd();
};
$('cmdInput').onkeydown = e => {
  const n = $('cmdList').querySelectorAll('.cmd-item').length;
  if (e.key === 'ArrowDown') { e.preventDefault(); CMD_VALG = (CMD_VALG + 1) % Math.max(1, n); merkValgt(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); CMD_VALG = (CMD_VALG - 1 + n) % Math.max(1, n); merkValgt(); }
  else if (e.key === 'Enter') { e.preventDefault(); kjorCmd(cmdTreff()[CMD_VALG]); }
};
$('cmdOverlay').onclick = e => { if (e.target === $('cmdOverlay')) closeCmd(); };

$('gsInput').oninput = () => {
  S._gsSkrevet = true;
  // Typing means the user wants text search again, not the flag list.
  if (S.gsFlag && $('gsInput').value.trim()) { S.gsFlag = ''; renderGlobalChips(); }
  renderGlobal();
};
// Firing an action from a menu should also dismiss it.
['snapBtn','csvBtn','edeBtn','edeCmpBtn','schBtn','wlogBtn','prjSave','prjOpen','reconnBtn','denseBtn','roBtn']
  .forEach(id => { const el = $(id); if (el) el.addEventListener('click', () => closeMenus()); });
$('prjSave').onclick = saveProject;
$('prjOpen').onclick = openProjects;
$('edeCmpBtn').onclick = startEdeCompare;
$('colsBtn').onclick = openCols;
$('colsReset').onclick = () => {
  savePrefs({colOrder: null, colHidden: []});
  renderColsList(); renderPoints();
};
$('rescanBtn').onclick = () => { RESCAN.on ? rescanStop() : rescanStart();
  toast(RESCAN.on ? 'Overvåker nettet i bakgrunnen' : 'Overvåking av'); };
$('rescanNow').onclick = () => { toast('Søker…'); rescanOnce(true); };
$('minneBtn').onclick = () => { closeMenus(); openMinne(); };
$('motionBtn').onclick = () => {
  const av = loadPrefs().utenBevegelse === true;
  savePrefs({utenBevegelse: !av});
  brukBevegelse();
  syncMenuStates();
};

$('temaBtn').onclick = () => { closeMenus(); openTema(); };
/* Two tabs, because the settings that change behaviour and the ones that
   change appearance are not the same question and do not want the same
   scroll. */
document.querySelectorAll('.sett-fane').forEach(f => {
  f.onclick = () => visSettFane(f.dataset.fane);
});

/* One place that knows which panels exist, so adding a tab is one entry here
   rather than a chain of booleans that grows a term each time. */
const SETT_FANER = {oppsett: 'settOppsett', tagging: 'settTagging', utseende: 'temaBody'};

function visSettFane(navn) {
  const valgt = SETT_FANER[navn] ? navn : 'oppsett';
  document.querySelectorAll('.sett-fane').forEach(x =>
    x.classList.toggle('sel', x.dataset.fane === valgt));
  // Move the strip to the chosen tab; the transition does the sliding.
  const f = document.querySelector('.sett-fane.sel');
  const rad = document.querySelector('.sett-faner');
  if (f && rad) {
    rad.style.setProperty('--fane-x', (f.offsetLeft) + 'px');
    rad.style.setProperty('--fane-w', (f.offsetWidth) + 'px');
  }
  Object.entries(SETT_FANER).forEach(([n, id]) => {
    const el = $(id);
    if (el) el.hidden = n !== valgt;
  });
  if (valgt === 'utseende') tegnTema();
  if (valgt === 'tagging') tegnTagging();
}
$('temaEksport').onclick = temaEksporter;
$('temaImport').onclick = temaImporter;
$('temaNullstill').onclick = () => {
  if (!confirm('Tilbakestille alle farger og størrelser til standard?')) return;
  savePrefs({tema: {}, uiSkala: 100, radHoyde: 26, radius: 4,
             bgStyrke: 40, bgUskarp: 0, bgMorkne: 0, flateGjennom: 0,
             bgModus: 'dekk', tittel: 'BACnet Explorer', undertittel: '',
             bgSnitt: null});
  ['bg', 'logo', 'banner'].forEach(n => lagreBilde(n, null));
  brukTema(); tegnTema();
  toast('Utseendet er tilbakestilt');
};

/* Dark stays the default - it is what the tool was designed against and what
   most of this work is measured on. Light is there for a bright plant room
   or a sunlit van, and the choice is remembered. */
function applyTheme(lys) {
  document.documentElement.setAttribute('data-theme', lys ? 'light' : 'dark');
  // The sun and moon are drawn by the stylesheet now, so there is no glyph
  // to swap - and nothing to go wrong if a font lacks the character.
  // Light and dark keep separate overrides, so switching mode has to swap
  // which set is applied - otherwise a dark palette bleeds into light.
  if (typeof brukTema === 'function') brukTema();
  if (typeof tegnTema === 'function' && $('temaOverlay') && !$('temaOverlay').hidden) tegnTema();
}
$('themeBtn').onclick = (ev) => {
  const lys = document.documentElement.getAttribute('data-theme') !== 'light';
  savePrefs({light: lys});
  /* The screen changes over as a time of day, not as a setting. View
     Transitions wipes the two snapshots; the sky layer on top carries the sun
     or the moon across while it happens. Without support, or with motion
     switched off, the theme changes the way it always did. */
  if (!document.startViewTransition || bevegelseAv()) { applyTheme(lys); return; }
  visHimmel(lys);
  document.startViewTransition(() => applyTheme(lys));
};

/* The sun or the moon crossing while the theme changes under it. Restarted by
   removing the classes and forcing one layout, or a second switch inside a
   second would find the animation already finished and show nothing. */
let HIMMEL_TIMER = null;
function visHimmel(lys) {
  const el = $('himmel');
  if (!el) return;
  clearTimeout(HIMMEL_TIMER);
  el.hidden = false;
  el.classList.remove('dag', 'natt');
  void el.offsetWidth;
  el.classList.add(lys ? 'dag' : 'natt');
  HIMMEL_TIMER = setTimeout(() => {
    el.hidden = true;
    el.classList.remove('dag', 'natt');
  }, 1000);
}

/* One place to ask whether motion is wanted: the setting, or the operating
   system's own answer, which is not ours to override. */
function bevegelseAv() {
  return loadPrefs().utenBevegelse === true
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const GROUP_AKSER = ['vendor', 'range', 'none'];
const GROUP_NAVN = {vendor: 'leverandør', range: 'IP-område', none: 'av'};
$('groupBtn').onclick = () => {
  const naa = loadPrefs().groupBy || (loadPrefs().groupVendor === false ? 'none' : 'vendor');
  const neste = GROUP_AKSER[(GROUP_AKSER.indexOf(naa) + 1) % GROUP_AKSER.length];
  savePrefs({groupBy: neste, groupVendor: neste !== 'none'});
  renderDevices(); syncMenuStates();
  toast(neste === 'none' ? 'Enheter vises i én liste'
                         : 'Grupperes etter ' + GROUP_NAVN[neste]);
};

/* Schedules, calendars, trend logs and notification classes are objects like
   any other, but the table only ever showed the ones carrying a live value.
   A controller with six weekly schedules therefore looked like it had none -
   they existed, and there was no way to see them. */
$('allTypesBtn').onclick = () => {
  const paa = loadPrefs().allTypes === true;
  savePrefs({allTypes: !paa});
  syncMenuStates();
  toast(!paa ? 'Viser alle objekttyper — les enheten på nytt'
             : 'Viser kun punkter med verdi — les enheten på nytt');
  if (S.activeDev) {
    const ip = S.activeDev.address;
    delete S.cache[ip]; delete S.cacheMeta[ip];
    selectDevice(ip, {force: true});
  }
};

$('shortBtn').onclick = () => {
  const paa = loadPrefs().shortNames !== false;
  savePrefs({shortNames: !paa});
  renderPoints(); renderCtx(); syncMenuStates();
  toast(!paa ? 'Punktnavn forkortes' : 'Punktnavn vises fullt ut');
};

$('preBtn').onclick = () => {
  PRE.on = !PRE.on;
  if (!PRE.on) prefetchStop();
  savePrefs({prefetch: PRE.on});
  syncPrefetchBtn();
  toast(PRE.on ? 'Forhåndsleser enheter i bakgrunnen'
               : 'Forhåndslesing av enheter er av');
};
function syncPrefetchBtn() {
  $('preBtn').classList.toggle('on', PRE.on);
  $('preState').textContent = PRE.on ? 'på' : 'av';
}

$('reloadBtn').onclick = () => {
  if (!S.activeDev) return;
  const ip = S.activeDev.address;
  delete S.cache[ip]; delete S.cacheMeta[ip];
  selectDevice(ip, {force: true});
};
$('schBtn').onclick = openSchedules;
$('edeFile').onchange = onEdeFile;
$('wlogBtn').onclick = showWriteLog;
$('roBtn').onclick = async () => {
  const d = await api('/api/readonly', {enabled: !S.readOnly});
  S.readOnly = !!d.enabled;
  toast(S.readOnly ? 'Lesemodus på — skriving blokkert' : 'Lesemodus av');
  refreshReadOnly();
};
$('selPin').onclick = pinSelected;
$('selRel').onclick = releaseSelected;
$('selCopy').onclick = copySelected;
$('selClear').onclick = clearSel;
$('zoomClose').onclick = closeZoom;
$('zoomOverlay').onclick = e => { if (e.target === $('zoomOverlay')) closeZoom(); };
$('watchExport').onclick = exportWatchHistory;

/* The subtitle under the wordmark. Set it under Settings -> Appearance;
   with nothing set it reads "lokal", which is what this tool always is. */
(function undertekst() {
  $('brandSub').textContent = loadPrefs().undertittel || 'lokal';
})();

/* Build the image off-DOM with both handlers attached before src is set, so
   the load cannot fire before we are listening. It is only inserted once it
   has actually decoded — with no logo file installed the placeholder mark
   simply stays and no broken image is ever shown. */
(function loadLogo() {
  const img = new Image();
  img.alt = 'Logo';
  img.onload = () => {
    /* Fill the mark, never replace it. replaceWith() took #brandMark out of
       the document altogether, so every later attempt to put a chosen logo
       there wrote to an element that no longer existed - which is why a
       picked logo silently did nothing. The element stays; only its contents
       change. */
    LOGO_FRA_SERVER = img.src;
    if (lastBilder().logo) return;   // brukerens eget bilde vinner
    settMerke(img.src);
  };
  img.onerror = () => { /* no logo installed */ };
  img.src = '/logo';
})();

$('denseBtn').onclick = () => {
  const on = document.body.classList.toggle('dense');
  savePrefs({dense: on});
  syncMenuStates();
};

/* Keyboard navigation through the points list — arrow keys move the
   selection and scroll it into view, which is how anyone works through a
   few hundred points quickly. */
/* Streken som glir med piltastene.

   Den ligger i punktruta og flyttes ved aa sette top og height - begge har en
   overgang, saa den glir i stedet for aa hoppe. Bare ved tastatur: bruker du
   musa vet du selv hvor du trykket. */
function flyttMarkor(tr) {
  const wrap = document.getElementById('pointsWrap');
  if (!wrap) return;
  let m = document.getElementById('radmarkor');
  if (!m) {
    m = document.createElement('div');
    m.id = 'radmarkor';
    m.setAttribute('aria-hidden', 'true');
    wrap.appendChild(m);
  }
  if (!tr || bevegelseAv()) { m.classList.remove('paa'); return; }
  m.style.top = tr.offsetTop + 'px';
  m.style.height = tr.offsetHeight + 'px';
  m.classList.add('paa');
}

function skjulMarkor() {
  const m = document.getElementById('radmarkor');
  if (m) m.classList.remove('paa');
}

function moveSelection(step) {
  const rows = visiblePoints();
  if (!rows.length) return;
  let i = rows.findIndex(p => p.objid === S.selected);
  i = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + step));
  selectPoint(rows[i].objid);
  requestAnimationFrame(() => {
    const tr = document.querySelector(`#pointsWrap tbody tr[data-o="${CSS.escape(rows[i].objid)}"]`);
    if (tr) { tr.scrollIntoView({block: 'nearest'}); flyttMarkor(tr); visRadVerktoy(tr); }
  });
}

/* Bolgen fra treffpunktet.

   Diameteren er avstanden til hjornet lengst unna, ganget med to - da rekker
   bolgen ut til hele flaten uansett hvor du traff, og ikke bare til naermeste
   kant. Elementet rydder seg selv naar animasjonen er ferdig. */
function klikkBolge(vert, ev) {
  if (bevegelseAv() || !vert || ev.button) return;
  const r = vert.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const d = Math.max(Math.hypot(x, y), Math.hypot(r.width - x, y),
                     Math.hypot(x, r.height - y),
                     Math.hypot(r.width - x, r.height - y)) * 2;
  const b = document.createElement('span');
  b.className = 'bolge';
  b.style.setProperty('--bx', x + 'px');
  b.style.setProperty('--by', y + 'px');
  b.style.setProperty('--bd', Math.round(d) + 'px');
  vert.appendChild(b);
  const vekk = () => b.remove();
  b.addEventListener('animationend', vekk, {once: true});
  setTimeout(vekk, 1200);
}

/* Bare paa enhetskortene.

   Bolgen laa ogsaa paa tabellradene, og der gjorde den to ting galt. En span
   som direkte barn av en tr blir en ANONYM TABELLCELLE - tabellen fikk en
   ekstra kolonne saa lenge bolgen fantes. Maalt: beskrivelseskolonnen ble
   presset fra 220 til 147 piksler og hoppet 65 px til venstre, for saa aa
   sprette forbi utgangspunktet naar bolgen ble ryddet.

   Og selv uten den feilen hoerer den ikke hjemme der: en bolge under fingeren
   er fin paa et kort man trykker paa, og i veien i en tabell man leser tall i.
   Kortene er button-elementer og har ingen av delene. */
document.addEventListener('mousedown', e => {
  const kort = e.target.closest && e.target.closest('#devList .dev');
  if (kort) klikkBolge(kort, e);
}, true);

/* Settet foelger raden under peker. Delegert, saa det koster ingenting per
   rad - og det er hele poenget med aa ha bare ett. */
document.addEventListener('mouseover', e => {
  const wrap = document.getElementById('pointsWrap');
  if (!wrap || !e.target.closest) return;
  if (!wrap.contains(e.target)) { skjulRadVerktoy(); return; }
  if (e.target.closest('#radVerktoy')) return;   // ikke skjul mens du sikter
  const tr = e.target.closest('#pointsWrap tbody tr[data-o]');
  if (tr) visRadVerktoy(tr); else skjulRadVerktoy();
}, true);

document.addEventListener('mousedown', e => {
  const m = document.getElementById('radmeny');
  if (m && !m.contains(e.target)) lukkRadmeny();
}, true);

// Musa slaar av tastaturmarkoeren - to markeringer som konkurrerer er verre
// enn en.
document.addEventListener('mousedown', e => {
  if (e.target.closest && e.target.closest('#pointsWrap')) skjulMarkor();
}, true);

document.addEventListener('keydown', e => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);

  /* ? aapner hurtigtastene. Det er konvensjonen i alt som er tastaturdrevet,
     og hjelpa fantes allerede - den hadde bare ingen tast. */
  if (!typing && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
    e.preventDefault(); $('helpBtn').click(); return;
  }

  // Sekvenser (g d, g p, ...) foer alt annet, men aldri mens noen skriver.
  if (!typing && sekvensTast(e)) { e.preventDefault(); return; }

  // B3: handlingene som gjelder punktet du staar paa.
  if ((e.ctrlKey || e.metaKey) && e.key === '.') {
    e.preventDefault(); apneRadmeny(); return;
  }
  // B4: mellom rutene. F6 sykler, Ctrl+1/2/3 gaar rett dit.
  if (e.key === 'F6') { e.preventDefault(); hoppRute(e.shiftKey ? -1 : 1); return; }
  if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault(); gaaTilRute(+e.key - 1); return;
  }
  if (e.key === 'Escape' && document.getElementById('radmeny')) {
    e.preventDefault(); lukkRadmeny(); return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
    e.preventDefault(); toggleSelectAll(); return;
  }
  // Ctrl+K works while typing too: it is the way out of any field, which is
  // the point of a palette.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('cmdOverlay').hidden ? openCmd() : closeCmd();
    return;
  }
  if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); return; }
  if (e.key === '?' && !typing) { e.preventDefault(); openGlobal(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openGlobal(); return; }
  if (e.key === 'Escape') {
    if (!$('minneOverlay').hidden) { closeMinne(); return; }
    if (!$('temaOverlay').hidden) { closeTema(); return; }
    if (!$('schOverlay').hidden) { closeSchedules(); return; }
    if (!$('edeOverlay').hidden) { closeEde(); return; }
    if (!$('prjOverlay').hidden) { closeProjects(); return; }
    if (!$('cmdOverlay').hidden) { closeCmd(); return; }
    if (!$('colsOverlay').hidden) { closeCols(); return; }
    if (!$('gsOverlay').hidden) { closeGlobal(); return; }
    if (!$('zoomOverlay').hidden) { closeZoom(); return; }
    if (!$('helpPop').hidden) { $('helpPop').hidden = true; return; }
    $('q').blur(); return;
  }
  if (typing) return;
  if (e.key.toLowerCase() === 'z') { e.preventDefault(); $('zoomOverlay').hidden ? openZoom() : closeZoom(); return; }

  if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); moveSelection(15); }
  else if (e.key === 'PageUp') { e.preventDefault(); moveSelection(-15); }
  else if (e.key === ' ' && S.selected) { e.preventDefault(); togglePin(S.selected); }
  else if (e.key.toLowerCase() === 'l') { S.live ? stopPolling() : startPolling(); }
});

/* Restore what the user last used so the tool opens ready to work. */
(function restore() {
  const p = loadPrefs();
  if (p.range) $('rangeInput').value = p.range;
  if (p.mode) $('modeSel').value = p.mode;
  if (p.pollInt) $('pollInt').value = p.pollInt;
  if (p.dense) document.body.classList.add('dense');
})();
$('rangeInput').addEventListener('change', e => savePrefs({range: e.target.value.trim()}));
$('modeSel').addEventListener('change', e => savePrefs({mode: e.target.value}));
$('pollInt').addEventListener('change', e => savePrefs({pollInt: e.target.value}));

let rsTimer;
window.addEventListener('resize', () => {
  clearTimeout(rsTimer);
  rsTimer = setTimeout(() => { clampPanes(); if (S.points.length) renderPoints(); }, 140);
});

initMenus();
syncMenuStates();
initSplitters();
brukTema();
hentMinne();
renderRangeSuggestions();
renderWatch();
renderDevices();

/* Open ready to work: bind an interface immediately rather than making the
   user discover that "Skann" is disabled until they press a connect button. */
(async function boot() {
  applyTheme(!!loadPrefs().light);
  lastNotater();
  if (loadPrefs().rescan) setTimeout(() => { if (S.connected) rescanStart(); }, 3000);
  const prefs = loadPrefs();
  if (prefs.prefetch === false) PRE.on = false;
  syncPrefetchBtn();
  await loadInterfaces();
  await refreshStatus();
  if (!S.connected) await connectTo($('localAddr').value, {quiet: true});
  if (!S.connected) status('Velg nettverkskort øverst til venstre');
})();

/* ==========================================================================
   Language

   The interface is written in Norwegian, inline, in about 3500 string
   literals across this file. Wrapping every one of them in a lookup would
   have been 3500 edits through code that is otherwise working, so the
   translation happens on the way out instead: the DOM is swept and any text
   that matches a dictionary entry exactly is replaced.

   Sweeping has one property that matters more than the saved edits: plant
   data passes through untouched. A device called "Skann" is not a phrase in
   the dictionary as a whole text node unless it is exactly that, and point
   names, IP addresses and values never match, so nothing a controller
   reports can be mangled by a language switch.

   What it cannot do is translate a sentence that was built around a value -
   "5 enheter i 2 områder". Those are handled by MONSTER below, pattern by
   pattern, and anything not covered stays in Norwegian rather than coming
   out half-translated. */

const ORDBOK = {
  /* --- top bar and scanning --- */
  'Skann': 'Scan',
  'Avbryt': 'Cancel',
  'Sweep — grundig': 'Sweep — thorough',
  'Sweep — rask': 'Sweep — fast',
  'Who-Is (kringkasting)': 'Who-Is (broadcast)',
  'Laster nettverkskort…': 'Loading adapters…',
  'Nettverkskortet forespørslene sendes fra': 'The adapter requests are sent from',
  'Ett eller flere IP-områder. Skill dem med komma, semikolon eller mellomrom — de skannes etter tur inn i én liste.':
    'One or more IP ranges. Separate them with a comma, semicolon or space — they are scanned in turn into a single list.',
  'Grundig prøver stille adresser en gang til, langsomt — finner enheter som ellers mistes over VPN. Rask tar én runde. Who-Is blokkeres ofte.':
    'Thorough re-probes silent addresses once more, slowly — it finds devices that are otherwise missed over a VPN. Fast takes one pass. Who-Is is often blocked.',
  'Bytt mellom mørk og lys visning': 'Switch between dark and light',
  'Bytt visning': 'Switch appearance',
  'Hurtigtaster': 'Keyboard shortcuts',
  'Mer': 'More',

  /* --- panes --- */
  'Enheter': 'Devices',
  'Punkter': 'Points',
  'Overvåking': 'Watch',
  'Inspektør': 'Inspector',
  'Ingen enhet valgt': 'No device selected',
  'Ingen enheter': 'No devices',
  'Velg en enhet for å laste punkter': 'Select a device to load points',
  'Velg et punkt': 'Select a point',
  'Koble til og skann et IP-område': 'Connect and scan an IP range',

  /* --- getting started ---
     A bold word inside a sentence splits it into several text nodes, so
     these are the fragments as they actually reach the DOM, not the
     sentences as they read in the source. */
  'Kom i gang': 'Getting started',
  'Sjekk at': 'Check that',
  'Fra': 'From',
  'viser nettverkskortet som når anlegget.': 'shows the adapter that reaches the plant.',
  'Skriv IP-området i': 'Enter the IP range in',
  ', f.eks.': ', e.g.',
  'Trykk': 'Press',
  '— enhetene dukker opp her.': '— the devices appear here.',
  'Fest punkter med ☆ (eller mellomrom) — også fra andre enheter':
    'Pin points with ☆ (or space) — from other devices too',
  'Velg nettverkskortet som når anlegget (øverst til venstre).':
    'Pick the adapter that reaches the plant (top left).',
  'Skriv IP-området, f.eks.': 'Enter the IP range, e.g.',
  ', og trykk Skann.': ', then press Scan.',
  'Klikk en enhet for å laste punktene.': 'Click a device to load its points.',
  'Klikk et punkt for detaljer, trend og skriving.':
    'Click a point for details, trend and writing.',

  /* --- search and filtering --- */
  'Søk i punkter': 'Search points',
  'Søk… (/) — flere ord = alle må treffe': 'Search… (/) — several words = all must match',
  'Mellomrom betyr og: KG32 RT601 finner alle RT601 på KG32.  -ord utelater.  "to ord" søker som frase.':
    'A space means and: KG32 RT601 finds every RT601 on KG32.  -word excludes.  "two words" searches as a phrase.',
  'Søk i alle enheter…': 'Search every device…',
  'Søk i alle enheter samtidig': 'Search every device at once',
  'Søk etter handling eller enhet…': 'Search for an action or a device…',
  'Kommandopalett — alt verktøyet kan gjøre, ett søkefelt':
    'Command palette — everything the tool can do, one search field',
  'Alle typer': 'All types',
  'Filter': 'Filter',
  'Visninger': 'Views',
  'Lagrede visninger — filter, sortering og kolonner under ett navn':
    'Saved views — filter, sorting and columns under one name',
  'Denne lista': 'This list',
  'Kun med feil': 'Only with a fault',
  'Kun ute av drift': 'Only out of service',
  'Kun endret siden snapshot': 'Only changed since the snapshot',
  'Bare det som er ulikt': 'Only what differs',
  'Kun i alarm': 'Only in alarm',
  'Kun overstyrte': 'Only overridden',
  'Kun skrivbare': 'Only writable',
  'kun verdier': 'values only',
  'leverandør': 'vendor',
  'Leverandør': 'Vendor',
  'IP-område': 'IP range',
  'ingen felles start': 'no common prefix',
  'På, men punktnavnene her har ingen felles start å utelate':
    'On, but the point names here have no common prefix to drop',
  'Menyer, dialoger og temabytte beveger seg. Slås av\n              automatisk hvis Windows er satt til redusert bevegelse':
    'Menus, dialogs and the theme switch move. Turned off\n              automatically if Windows is set to reduced motion',

  /* --- table and selection --- */
  'Kopier': 'Copy',
  '⧉ Kopier': '⧉ Copy',
  'Tøm': 'Clear',
  'Tøm utvalg': 'Clear selection',
  'Tøm overvåkingslista': 'Clear the watch list',
  'Velg enkeltrad · Shift for område · Ctrl+A alle':
    'Single row · Shift for a range · Ctrl+A for all',
  'Ctrl-klikk': 'Ctrl-click',
  'Ctrl-klikk for enkeltrader, Shift for område, Ctrl+A for alle':
    'Ctrl-click for single rows, Shift for a range, Ctrl+A for all',
  'Dra for å endre bredde · dobbeltklikk for å nullstille':
    'Drag to resize · double-click to reset',
  'Dra for å endre rekkefølge. Overskriftene i tabellen er uendret.':
    'Drag to reorder. The table headings are unchanged.',
  'Skjuler den delen av navnet alle punkter deler':
    'Hides the part of the name every point shares',
  'Punktnavn forkortes av/på i ⋯-menyen.': 'Point names are shortened on/off in the ⋯ menu.',

  /* --- live and watch --- */
  'Live av': 'Live off',
  'Live på': 'Live on',
  'Live av/på': 'Live on/off',
  'Start/stopp live-oppdatering (L)': 'Start/stop live updating (L)',
  'Les punktene fra enheten på nytt': 'Read the points from the device again',
  'Fest punkt til overvåking': 'Pin the point to the watch list',
  'Fest punkter med ☆ for å følge dem live på tvers av enheter':
    'Pin points with ☆ to follow them live across devices',
  'Zoom — stor visning av valgt punkt': 'Zoom — large view of the selected point',

  /* --- menu: sites --- */
  'Anlegg': 'Sites',
  'Lagre anlegg': 'Save site',
  'Åpne anlegg…': 'Open site…',
  'Anlegg jeg har vært på': 'Sites I have visited',
  'Anlegg jeg har vært på…': 'Sites I have visited…',
  'Hvert skann huskes med området, hvilke enheter som svarte og når. Klikk et anlegg for å skanne det på nytt.':
    'Every scan is remembered with its range, which devices answered and when. Click a site to scan it again.',
  'Sammenlikn to enheter': 'Compare two devices',
  'Sammenlikn to enheter…': 'Compare two devices…',

  /* --- menu: network --- */
  'Nettverk': 'Network',
  'Søk etter enheter nå': 'Look for devices now',
  'Koble til på nytt': 'Reconnect',
  'Overvåk nettet': 'Watch the network',
  'Søker jevnlig etter enheter som faller inn og ut':
    'Looks regularly for devices that come and go',
  'Forhåndsles enheter': 'Pre-read devices',
  'Leser de andre enhetene i bakgrunnen etter et skann':
    'Reads the other devices in the background after a scan',
  'Grupper enheter': 'Group devices',
  'Samle listen etter leverandør eller IP-område':
    'Collect the list by vendor or IP range',

  /* --- menu: view and settings --- */
  'Vis': 'View',
  'Flere rader på skjermen, mindre luft': 'More rows on screen, less air',
  'Innstillinger…': 'Settings…',
  'Ctrl+K for alt': 'Ctrl+K for everything',
  'Endringer vises med en gang og lagres pa denne maskinen. Lys og mørk visning huskes hver for seg.':
    'Changes apply at once and are stored on this machine. Light and dark are remembered separately.',
  'Blokkerer all skriving til anlegget': 'Blocks all writing to the plant',
  'Lesemodus': 'Read-only mode',

  /* --- export --- */
  'Eksport': 'Export',
  'Eksporter loggede verdier som CSV': 'Export logged values as CSV',
  'Endret siden snapshot…': 'Changed since the snapshot…',
  'EDE mot anlegg': 'EDE against the plant',
  'Sammenlign med EDE-fil…': 'Compare with an EDE file…',
  'Ta med trendlogger, programmer og enhetsobjektet':
    'Include trend logs, programs and the device object',
  'Lagre til fil': 'Save to a file',
  'Hent fra fil': 'Load from a file',

  /* --- writing --- */
  'Dobbeltklikk på verdi': 'Double-click a value',
  'Skriv til et skrivbart punkt — bekreftelsen kommer som vanlig':
    'Write to a writable point — the confirmation appears as usual',
  'Skriv Null til valgt prioritet på alle markerte punkter':
    'Write Null at the chosen priority on every selected point',
  'Prioritet som frigis': 'Priority to release',
  'Handlinger for punktet du staar på': 'Actions for the point you are on',

  /* --- navigation --- */
  'Bla mellom punkter': 'Move between points',
  'Hopp 15 punkter': 'Jump 15 points',
  'Neste rute — enheter, punkter, overvåking': 'Next pane — devices, points, watch',
  'Rett til en rute': 'Straight to a pane',
  'Gå til enheter, punkter, overvåking, søk': 'Go to devices, points, watch, search',

  /* --- generic --- */
  'Lukk': 'Close',
  'Lukk (Esc)': 'Close (Esc)',
  'lukk': 'close',
  'velg': 'select',
  'kjør': 'run',
  'mot': 'to',
  'enhet': 'device',
  'enheter': 'devices',
  'punkt': 'point',
  'punkter': 'points',
  'vist': 'shown',

  /* --- the rest of the interface --- */
  'Kobler til': 'Connecting',
  'Kobler til…': 'Connecting…',
  'Ikke tilkoblet': 'Not connected',
  'Tilkoblet på nytt': 'Reconnected',
  'Klarte ikke koble til': 'Could not connect',
  'Kunne ikke starte': 'Could not start',
  'Proxy er ikke startet': 'The proxy has not been started',
  'Sender fra': 'Sending from',
  'Denne PC-en:': 'This PC:',
  'Forbindelsen ble gjenopprettet — sender fra': 'The connection is back — sending from',
  'Kontakt gjenopprettet — sender fra': 'Contact restored — sending from',
  'Kontakt gjenopprettet — velg nettverkskort': 'Contact restored — pick an adapter',
  'Mistet kontakt med BACnet Explorer på denne PC-en': 'Lost contact with BACnet Explorer on this PC',
  'Ingen kontakt med BACnet Explorer på denne PC-en — kjører start.bat?': 'No contact with BACnet Explorer on this PC — is start.bat running?',
  'Uventet svar fra serveren (ikke JSON)': 'Unexpected reply from the server (not JSON)',
  'Velg nettverkskort øverst til venstre': 'Pick an adapter at the top left',
  'Fant ingen nettverkskort': 'Found no adapters',
  'Kunne ikke lese nettverkskort': 'Could not read the adapters',
  'Skriv inn et IP-område': 'Enter an IP range',
  'Ingen enheter svarte': 'No devices answered',
  'Ingen BACnet-enheter i omraadet': 'No BACnet devices in the range',
  'Ukjent område': 'Unknown range',
  'Ingen område skannet ennå — lagres som standard for neste anlegg': 'No range scanned yet — saved as the default for the next site',
  'Skann på nytt': 'Scan again',
  'Prøv igjen': 'Try again',
  'Prøv «Sweep — grundig»': 'Try “Sweep — thorough”',
  'Velg en annen enhet': 'Pick another device',
  'Sjekk med ping': 'Check with ping',
  'Svarer denne adressen på ping?': 'Does this address answer a ping?',
  'Søker…': 'Searching…',
  'Overvåker nettet i bakgrunnen': 'Watching the network in the background',
  'Sok etter enheter na': 'Look for devices now',
  'Koble til pa nytt': 'Reconnect',
  'Laster punkter…': 'Loading points…',
  'Leser verdier fra': 'Reading values from',
  'Leser beskrivelser fra': 'Reading descriptions from',
  'Leser objektliste fra': 'Reading the object list from',
  'Leser tilstandstekster fra': 'Reading state texts from',
  'Leser av/på-tekster fra': 'Reading on/off texts from',
  'Leser ukeprogram fra': 'Reading the schedule from',
  'leser verdier': 'reading values',
  'leser av/på-tekster': 'reading on/off texts',
  'Fortsetter lastingen som allerede var i gang…': 'Continuing the load that was already running…',
  'venter på svar fra enheten…': 'waiting for the device to answer…',
  'Kunne ikke lese enheten': 'Could not read the device',
  'Feil ved lesing': 'Read failed',
  'Enheten svarte ikke på egenskapsforespørselen.': 'The device did not answer the property request.',
  'Ingen svar fra enheten på dette punktet': 'No answer from the device for this point',
  'Ingenting er lest fra enheten.': 'Nothing has been read from the device.',
  'Les punktet på nytt': 'Read the point again',
  'Forhåndsleser enheter i bakgrunnen': 'Pre-reading devices in the background',
  'Forhandsles enheter i bakgrunnen': 'Pre-read devices in the background',
  'Forhåndslesing av enheter er av': 'Pre-reading devices is off',
  'Flere enheter svarer på denne ID-en': 'Several devices answer this ID',
  'Forespørsler treffer den som svarer først, så lesinger og skrivinger': 'Requests reach whichever answers first, so reads and writes',
  'kan lande på feil sentral.': 'can land on the wrong controller.',
  'Ingen treff': 'No matches',
  'Ingen punkter': 'No points',
  'Ingen punkter valgt': 'No points selected',
  'Ingen punkter i overvåkingen': 'No points on the watch list',
  'Ingen skrivbare punkter valgt': 'No writable points selected',
  'Ingen handling matcher': 'No action matches',
  'Ingen ur matcher': 'No schedule matches',
  'Ingen lagrede anlegg ennå': 'No saved sites yet',
  'Ingen lagret ennå': 'None saved yet',
  'Ingen skrivinger logget': 'No writes logged',
  'Loggen er tom': 'The log is empty',
  'Ingen felles punkter.': 'No points in common.',
  'Ingen avvik — de to er like.': 'No differences — the two are the same.',
  'Ingen avvik — filen stemmer med anlegget.': 'No differences — the file matches the plant.',
  'To enheter som begge er lest.': 'Two devices that have both been read.',
  'Enheten har ingen skjema-objekter.': 'The device has no schedule objects.',
  'Ingen aktive kommandoer — styres av lokal logikk': 'No active commands — driven by local logic',
  'Ingen skift lagt inn på denne ukedagen': 'No periods entered on this weekday',
  'ingen skift i dag': 'no periods today',
  'ingen verdier har endret seg': 'no values have changed',
  'Velg en enhet først': 'Pick a device first',
  'Velg et punkt først': 'Pick a point first',
  'Åpne en enhet først': 'Open a device first',
  'Velg to forskjellige enheter': 'Pick two different devices',
  'Åpne minst to enheter først — sammenlikningen bruker det som er lest': 'Open at least two devices first — the comparison uses what has been read',
  'Velg et punkt i tabellen for detaljer, live trend og skriving.': 'Pick a point in the table for details, a live trend and writing.',
  'Slå på Live for å se trend': 'Turn Live on to see a trend',
  'Skriv verdi': 'Write value',
  'Skriv verdi…': 'Write value…',
  'Skriv verdi @ prioritet': 'Write value @ priority',
  'Ny verdi for': 'New value for',
  'Enheten står nå på:': 'The device is now at:',
  'Nå:': 'Now:',
  'Slik blir det': 'What it becomes',
  'Dette endrer et anlegg i drift. Fortsette?': 'This changes a plant in operation. Continue?',
  'Skriving påvirker et anlegg i drift. Kontroller punkt og prioritet før du sender.': 'Writing affects a plant in operation. Check the point and the priority before you send.',
  'Blir stående til du frigir den.': 'It stays until you release it.',
  'Frigis automatisk etter': 'Released automatically after',
  'Frigjør prioriteten automatisk etter valgt tid': 'Releases the priority automatically after the chosen time',
  'Frigi valgte punkter': 'Release the selected points',
  'Skriv Null — frigjør prioriteten': 'Write Null — releases the priority',
  'Punktene faller tilbake til anleggets egen styring.': 'The points fall back to the plant’s own control.',
  'Kommanderbart punkt — kan skrives': 'Commandable point — can be written',
  'Fant ikke skriveskjemaet — bruk feltet i inspektøren': 'Could not find the write form — use the field in the inspector',
  'Lesemodus er på — skriving er blokkert': 'Read-only mode is on — writing is blocked',
  'Lesemodus er på — skriving er blokkert.': 'Read-only mode is on — writing is blocked.',
  'Lesemodus på — skriving blokkert': 'Read-only — writing blocked',
  'Lesemodus er på — ukeprogrammet kan ikke endres.': 'Read-only mode is on — the schedule cannot be changed.',
  'Skrivelogg (nyeste først)': 'Write log (newest first)',
  'etter 5 min': 'after 5 min',
  'etter 15 min': 'after 15 min',
  'etter 30 min': 'after 30 min',
  'etter 1 time': 'after 1 hour',
  'av — blir stående til du frigir': 'off — stays until you release it',
  'Ukeprogram': 'Schedule',
  'Åpne ukeprogram': 'Open the schedule',
  'Ukeprogram — vis og rediger': 'Schedule — view and edit',
  'Ukeprogrammet er ikke lest': 'The schedule has not been read',
  'Ukeprogrammet er uendret — ingenting å skrive': 'The schedule is unchanged — nothing to write',
  'Skrive ukeprogrammet til': 'Write the schedule to',
  'Lagre til kontroller': 'Save to the controller',
  'Du har ulagrede endringer i ukeprogrammet. Forkaste dem?': 'You have unsaved changes to the schedule. Discard them?',
  'Ulagrede endringer i ukeprogrammet går tapt. Lukke likevel?': 'Unsaved changes to the schedule will be lost. Close anyway?',
  'Endringene er forkastet': 'The changes were discarded',
  'Klikk en blokk og endre tidene nederst · «Del i to» lager en ny': 'Click a block and change the times below · “Split in two” makes a new one',
  'dra i en tom dag for å tegne en periode': 'drag on an empty day to draw a period',
  'Perioden er for kort til å deles': 'The period is too short to split',
  'hele uka': 'the whole week',
  '· uendret hele uka': '· unchanged all week',
  '· til midnatt': '· to midnight',
  'lør': 'Sat',
  'søn': 'Sun',
  'feil klokke': 'wrong clock',
  'Sette klokka på': 'Set the clock on',
  'Sett klokka på denne enheten fra denne PC-en': 'Set this device’s clock from this PC',
  'Klokka er stilt — enheten er nå': 'The clock is set — the device is now',
  'Klarte ikke å stille klokka': 'Could not set the clock',
  'Ukeprogram kjører etter enhetens egen klokke, og trendlogger stemples med den.': 'The schedule runs on the device’s own clock, and trend logs are stamped with it.',
  'Ukeprogram og trendlogger på enheten følger denne klokka.': 'The schedule and trend logs on the device follow this clock.',
  'står på': 'is at',
  'Hva heter dette anlegget?': 'What is this site called?',
  'Navn på anlegget:': 'Site name:',
  'Navn på visningen:': 'View name:',
  'Lagre nåværende…': 'Save the current one…',
  'Lagre notat': 'Save note',
  'Kunne ikke lagre notatet': 'Could not save the note',
  'lagret her': 'saved here',
  'ikke delt': 'not shared',
  'delt med fellesserveren': 'shared with the common server',
  'lagret her · fellesserveren er ikke tilgjengelig': 'saved here · the common server is unreachable',
  'lagret her, men ikke delt — fellesserveren svarte ikke': 'saved here, but not shared — the common server did not answer',
  'Taggeinnstillinger for dette anlegget...': 'Tag settings for this site…',
  'Tømme taggeinnstillingene for dette anlegget?': 'Clear the tag settings for this site?',
  'Bygg-ID først': 'Building ID first',
  'Foran systemnummeret, som i BTG': 'Before the system number, as in BTG',
  'Hvilket ledd systemnummeret står i': 'Which segment the system number is in',
  'Mellom prefiks og system': 'Between the prefix and the system',
  'Finnes bare i anlegget': 'Only in the plant',
  'Ulikt navn': 'Different name',
  'Endret verdi': 'Changed value',
  'Endrede verdier': 'Changed values',
  'Nye punkter': 'New points',
  'Nye siden snapshot': 'New since the snapshot',
  'Borte siden snapshot': 'Gone since the snapshot',
  'endret siden snapshot': 'changed since the snapshot',
  'kun A': 'A only',
  'kun B': 'B only',
  'Last ned CSV': 'Download CSV',
  'Velg fil': 'Choose a file',
  'kunne ikke lese filen': 'could not read the file',
  'Fant ingen punkter i filen': 'Found no points in the file',
  'EDE-filen mangler object-name, object-type eller object-instance.': 'The EDE file is missing object-name, object-type or object-instance.',
  'Fant ikke EDE-kolonneoverskriften (object-name / object-type).': 'Could not find the EDE column heading (object-name / object-type).',
  'Overvåkingshistorikk eksportert': 'Watch history exported',
  'Rapporten er kopiert - lim inn der du vil': 'The report is copied — paste it wherever you want',
  'Innstillingene er kopiert': 'The settings are copied',
  'Kunne ikke kopiere': 'Could not copy',
  'Kopier navn': 'Copy name',
  'Kopier punktnavn': 'Copy the point name',
  'Kopier til BTG': 'Copy for BTG',
  'Hva du fant, hva som gjenstår, hva neste mann bør vite…': 'What you found, what is left, what the next person should know…',
  'Ta et snapshot forst - rapporten viser hva som har endret seg siden da': 'Take a snapshot first — the report shows what has changed since then',
  'Fjern dette filteret': 'Remove this filter',
  'Nullstill alle': 'Reset all',
  'Vis alle punkter': 'Show all points',
  'Vis alle objekttyper (ukeprogram, kalender, trendlogg)': 'Show every object type (schedule, calendar, trend log)',
  'Viser alle objekttyper — les enheten på nytt': 'Showing every object type — read the device again',
  'Viser kun punkter med verdi — les enheten på nytt': 'Showing only points with a value — read the device again',
  'alle objekttyper': 'every object type',
  'alle tilstander': 'every state',
  'kun overstyrte': 'overridden only',
  'Minst én kolonne må vises': 'At least one column must be shown',
  'Grupperes etter': 'Grouped by',
  'Enheter vises i én liste': 'Devices are shown in one list',
  'Grupper enheter (leverandor / IP-omrade / av)': 'Group devices (vendor / IP range / off)',
  'Punktnavn vises fullt ut': 'Point names are shown in full',
  'Alle punktnavn på denne enheten starter med dette. Det er utelatt fra tabellen for lesbarhet — hold over et navn for å se det fullt ut.': 'Every point name on this device starts with this. It is dropped from the table for readability — hover a name to see it in full.',
  'Live og trend': 'Live and trend',
  'Stor visning av valgt punkt': 'Large view of the selected point',
  'Fest til overvåking': 'Pin to the watch list',
  'Løs fra overvåking': 'Unpin from the watch list',
  'Alle var allerede festet': 'They were all pinned already',
  'Type, saa navn': 'Type, then name',
  'Sok i punkter pa denne enheten': 'Search points on this device',
  'Sok i alle leste enheter': 'Search every device read',
  'Søket dekker navn, beskrivelse og objekt-ID på denne enheten.': 'The search covers name, description and object ID on this device.',
  'Flere ord må alle treffe, uansett rekkefølge — «360.001 RT601»': 'Several words must all match, in any order — “360.001 RT601”',
  'finner punkter som inneholder begge. Sett minus foran et ord for': 'finds points containing both. Put a minus in front of a word to',
  'å utelate det. Trykk Ctrl+F for å søke i alle leste enheter.': 'exclude it. Press Ctrl+F to search every device read.',
  'hvor er RT401': 'where is RT401',
  'søker i': 'searching in',
  'gaa til punkter': 'go to points',
  'gaa til enheter / punkter / overvaaking': 'go to devices / points / watch',
  'Utseende — farger, bilder og størrelse...': 'Appearance — colours, images and size…',
  'Utseendet er tilbakestilt': 'Appearance reset',
  'Tilbakestille alle farger og størrelser til standard?': 'Reset every colour and size to the default?',
  'Hele grensesnittet': 'The whole interface',
  'Radhøyde i tabellen': 'Row height in the table',
  'Runde hjørner': 'Rounded corners',
  'Størrelse og form': 'Size and shape',
  'Tekst mot bakgrunn:': 'Text against the background:',
  'Tekst på aksent': 'Text on the accent',
  'Høy kontrast': 'High contrast',
  'mørk visning': 'dark appearance',
  'Mørklegging': 'Dimming',
  'Mørklegging satt til': 'Dimming set to',
  'Gjentas som fliser': 'Repeated as tiles',
  'Hele bildet synlig': 'The whole image visible',
  'bak hele vinduet': 'behind the whole window',
  'bak knappene øverst': 'behind the buttons at the top',
  'Legg inn et bakgrunnsbilde for å få flere valg.': 'Add a background image for more options.',
  'Velg fil, dra et bilde hit, eller lim inn med Ctrl+V': 'Choose a file, drag an image here, or paste with Ctrl+V',
  'Velg fil, dra et bilde inn i raden, eller lim inn': 'Choose a file, drag an image onto the row, or paste',
  'med Ctrl+V når raden er markert.': 'with Ctrl+V when the row is selected.',
  'Det er ikke et bilde': 'That is not an image',
  'ikke et bilde': 'not an image',
  'Kunne ikke lese bildet:': 'Could not read the image:',
  'Bildet er for stort til å lagres — prøv et mindre': 'The image is too large to store — try a smaller one',
  'Bildet er for lyst — dempet det og gjorde flatene mer dekkende': 'The image is too light — dimmed it and made the surfaces more opaque',
  '% — teksten er lesbar igjen': '% — the text is legible again',
  'Kunne ikke lese temafilen': 'Could not read the theme file',
  'Kunne ikke åpne': 'Could not open',
  'Navn': 'Name',
  'Verdi': 'Value',
  'Enhet': 'Device',
  'Feil': 'Fault',
  'Ukjent': 'Unknown',
  'Ukjent feil': 'Unknown error',
  'Høy': 'High',
  'Normal / på': 'Normal / on',
  'automatisk nød': 'automatic emergency',
  'manuell nød': 'manual emergency',
  'operatør': 'operator',
  'Skjul': 'Hide',
  'Vis detaljer': 'Show details',
  'Skjul detaljer': 'Hide details',
  '(ingen)': '(none)',
  '(kun valgte)': '(selected only)',
  'i går': 'yesterday',
  'nå nettopp': 'just now',
  'Peker over': 'Pointing at',
  'viser de 40 nyeste': 'showing the 40 newest',
  'Punkter lest': 'Points read',
  'Punkter naa': 'Points now',
  'Slik bruker du den': 'How to use it',
  'Åpne minst to enheter først': 'Open at least two devices first',
  'på denne enheten': 'on this device',
  'svarer ikke': 'does not answer',
  'svarte ikke': 'did not answer',
  'svarer fra': 'answers from',
  'svarer på ping': 'answers a ping',
  'svarer på ping — prøv «Sweep — grundig»': 'answers a ping — try “Sweep — thorough”',
  'utløst': 'triggered',
  'områder': 'ranges',
  'døgn': 'days',
  'dager siden': 'days ago',
  'Ping kom i en nyere serverversjon — kjør start.bat igjen': 'Ping arrived in a newer server version — run start.bat again',
  /* --- settings and menu state --- */
  'Innstillinger': 'Settings',
  'Oppsett': 'Setup',
  'Tagging': 'Tagging',
  'Tabellen': 'The table',
  'Enhetslista': 'The device list',
  'Bevegelse': 'Motion',
  'Animasjoner': 'Animations',
  'Tett visning': 'Dense view',
  'Forkort punktnavn': 'Shorten point names',
  'Objekttyper i tabellen': 'Object types in the table',
  'Tilbakestill alt': 'Restore defaults',
  'Filtrer ur…': 'Filter schedules…',
  'Intervall': 'Interval',
  'Sammendrag': 'Summary',
  'Objekttyper': 'Object types',
  'Egenskaper': 'Properties',
  'Notat': 'Note',
  'objekter': 'objects',
  'lokal': 'local',
  /* The tool's own on/off pills. Safe to translate because every element a
     controller's own state text lands in - the table, the big value, the
     property list - is excluded above. */
  'av': 'off',
  'på': 'on',
  'Alt': 'All',
  'Mellomrom': 'Space',
  'Piltaster': 'Arrow keys',
  'Handling': 'Action',
  'Handlinger': 'Actions',
  'Innstillinger...': 'Settings...',
  'Kolonner...': 'Columns...',
  'Kolonner…': 'Columns…',
  'Lys visning': 'Light appearance',
  'Mørk visning': 'Dark appearance',
  'Naviger': 'Navigate',
  'Overvak nettet kontinuerlig': 'Watch the network continuously',
  'Sesjonsrapport…': 'Session report…',
  'Sesjonsrapport...': 'Session report...',
  'Skann IP-omrade': 'Scan an IP range',
  'Skrivelogg': 'Write log',
  'Visning': 'Display',
  'pa': 'on',
  /* The command palette carries ASCII variants of the same labels - three
     dots rather than an ellipsis, and no diacritics - so they are their own
     entries rather than being folded into the ones above. */
  'Skriving': 'Writing',
  'Utseende': 'Appearance',
  'Anlegg jeg har vært på...': 'Sites I have visited...',
  'Apne anlegg...': 'Open site...',
  'Lesemodus - blokker all skriving': 'Read-only mode - block all writing',
  'Sammenlign med EDE-fil...': 'Compare with an EDE file...',
  'Utseende - farger, bilder og størrelse...': 'Appearance - colours, images and size...',
  /* Deliberately absent: Av, På, Ja, Nei. Those are state texts, and a
     controller supplies them - translating one would be editing what the
     plant reports, not what the tool says. */
};

/* Sentences built around a value. Each entry is the Norwegian shape, the
   English shape, and the group order that maps one to the other. Anything
   not listed here stays Norwegian rather than coming out half-translated. */
const MONSTER = [
  [/^(\d+) enhet\(er\) i (\d+) områder$/, (m) => `${m[1]} device(s) in ${m[2]} ranges`,
   /^(\d+) device\(s\) in (\d+) ranges$/, (m) => `${m[1]} enhet(er) i ${m[2]} områder`],
  [/^(\d+) enheter$/, (m) => `${m[1]} devices`,
   /^(\d+) devices$/, (m) => `${m[1]} enheter`],
  [/^(\d+) punkter$/, (m) => `${m[1]} points`,
   /^(\d+) points$/, (m) => `${m[1]} punkter`],
  [/^(\d+) vist$/, (m) => `${m[1]} shown`,
   /^(\d+) shown$/, (m) => `${m[1]} vist`],
  [/^(\d+) min siden$/, (m) => `${m[1]} min ago`,
   /^(\d+) min ago$/, (m) => `${m[1]} min siden`],
  [/^([\d.]+) t siden$/, (m) => `${m[1]} h ago`,
   /^([\d.]+) h ago$/, (m) => `${m[1]} t siden`],
  [/^(\d+) døgn siden$/, (m) => `${m[1]} days ago`,
   /^(\d+) days ago$/, (m) => `${m[1]} døgn siden`],
  [/^(\d+) punkter frigitt$/, (m) => `${m[1]} points released`,
   /^(\d+) points released$/, (m) => `${m[1]} punkter frigitt`],
  [/^(\d+) enheter med feil$/, (m) => `${m[1]} devices with a fault`,
   /^(\d+) devices with a fault$/, (m) => `${m[1]} enheter med feil`],
  [/^(\d+) enheter med overstyringer$/, (m) => `${m[1]} devices with overrides`,
   /^(\d+) devices with overrides$/, (m) => `${m[1]} enheter med overstyringer`],
  [/^(\d+) punkter i alarm eller med feil$/, (m) => `${m[1]} points in alarm or with a fault`,
   /^(\d+) points in alarm or with a fault$/, (m) => `${m[1]} punkter i alarm eller med feil`],
  [/^(\d+) punkter overstyrt eller ute av drift$/, (m) => `${m[1]} points overridden or out of service`,
   /^(\d+) points overridden or out of service$/, (m) => `${m[1]} punkter overstyrt eller ute av drift`],
  [/^(\d+) enheter lest$/, (m) => `${m[1]} devices read`,
   /^(\d+) devices read$/, (m) => `${m[1]} enheter lest`],
  [/^(\d+) rader kopiert - lim inn i Excel$/, (m) => `${m[1]} rows copied — paste into Excel`,
   /^(\d+) rows copied — paste into Excel$/, (m) => `${m[1]} rader kopiert - lim inn i Excel`],
  [/^(\d+) punkt\(er\) festet$/, (m) => `${m[1]} point(s) pinned`,
   /^(\d+) point\(s\) pinned$/, (m) => `${m[1]} punkt(er) festet`],
  [/^(\d+) punkter er filtrert bort$/, (m) => `${m[1]} points filtered out`,
   /^(\d+) points filtered out$/, (m) => `${m[1]} punkter er filtrert bort`],
];

let ORDBOK_REV = null;
function revOrdbok() {
  if (!ORDBOK_REV) {
    ORDBOK_REV = Object.create(null);
    /* First declaration wins. Some English words are reached from two
       Norwegian spellings - the command palette strips diacritics, so it
       says "Sok etter enheter na" where the menu says "Søk etter enheter
       nå". Both must translate, but only one can come back, and the one
       that comes back should be the properly spelled one. */
    for (const [nb, en] of Object.entries(ORDBOK)) {
      if (ORDBOK_REV[en] === undefined) ORDBOK_REV[en] = nb;
    }
  }
  return ORDBOK_REV;
}

/* Whitespace is preserved around the match so a text node that is only
   padding inside markup does not collapse when it is swapped. */
function oversettTekst(s, tilEn) {
  if (!s) return s;
  const kjerne = s.trim();
  if (kjerne.length < 2) return s;
  const bok = tilEn ? ORDBOK : revOrdbok();
  let ny = bok[kjerne];
  if (ny === undefined) {
    for (const [nbRe, nbUt, enRe, enUt] of MONSTER) {
      const m = (tilEn ? nbRe : enRe).exec(kjerne);
      if (m) { ny = (tilEn ? nbUt : enUt)(m); break; }
    }
  }
  if (ny === undefined || ny === kjerne) return s;
  return s.replace(kjerne, ny);
}

const ATTR_SPRAAK = ['title', 'placeholder', 'aria-label'];
const HOPP_OVER = /^(SCRIPT|STYLE|CODE|SVG|PATH)$/;

/* Where the plant speaks rather than the tool. Point names, device names,
   descriptions and pinned rows are read straight off the equipment, and a
   controller is entirely free to call a point "Filter" or "Vis". Nothing in
   here is looked at, so no dictionary entry can reach it.

   These are the fields that carry the data, not the panes that contain them:
   the device list also holds the getting-started text and the watch pane its
   own empty state, and both of those are the tool talking. */
const DATA_SONE = 'tbody, .dev-name, .dev-ip, .dev-note, '
  + '.watch-name, .watch-ip, .insp-title, .insp-sub, .insp-val, .data-verdier';

function iDataSone(n) {
  const el = n.nodeType === 1 ? n : n.parentElement;
  return !!(el && el.closest && el.closest(DATA_SONE));
}

function sveipSprak(rot, tilEn) {
  if (!rot) return;
  if (rot.nodeType === 3) {
    if (iDataSone(rot)) return;
    const ny = oversettTekst(rot.nodeValue, tilEn);
    if (ny !== rot.nodeValue) rot.nodeValue = ny;
    return;
  }
  if (rot.nodeType !== 1) return;
  if (iDataSone(rot)) return;

  /* Elements are walked as well as text, and that is the whole point: a
     rejected ELEMENT takes its subtree with it, while rejecting a text node
     only skips that one node. Filtering text alone meant one closest() call
     per text node - 14 400 of them on a full points table, which cost about
     5ms per render. Rejecting tbody once costs one. */
  const tw = document.createTreeWalker(rot,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType === 1) {
          return (HOPP_OVER.test(n.nodeName) || (n.matches && n.matches(DATA_SONE)))
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
  const noder = [];
  while (tw.nextNode()) noder.push(tw.currentNode);
  for (const n of noder) {
    const ny = oversettTekst(n.nodeValue, tilEn);
    if (ny !== n.nodeValue) n.nodeValue = ny;
  }

  const med = rot.matches && rot.matches('[title],[placeholder],[aria-label]')
    ? [rot, ...rot.querySelectorAll('[title],[placeholder],[aria-label]')]
    : (rot.querySelectorAll ? rot.querySelectorAll('[title],[placeholder],[aria-label]') : []);
  for (const el of med) {
    if (iDataSone(el)) continue;
    for (const a of ATTR_SPRAAK) {
      const v = el.getAttribute(a);
      if (v == null) continue;
      const ny = oversettTekst(v, tilEn);
      if (ny !== v) el.setAttribute(a, ny);
    }
  }
}

/* Anything the app renders after the switch has to be caught too. Only
   added nodes are swept, so the cost follows what was rendered rather than
   the size of the table. Text and attribute writes are not childList
   mutations, so this cannot feed itself. */
let SPRAAK_OBS = null;
let SKRIVER = false;
function oversettAttr(el, navn, tilEn) {
  if (!el || el.nodeType !== 1 || !navn) return;
  if (iDataSone(el)) return;
  const v = el.getAttribute(navn);
  if (v == null) return;
  const ny = oversettTekst(v, tilEn);
  if (ny !== v) el.setAttribute(navn, ny);
}

function startSprakObs() {
  if (SPRAAK_OBS) return;
  SPRAAK_OBS = new MutationObserver((muts) => {
    if (SKRIVER) return;
    SKRIVER = true;
    try {
      for (const m of muts) {
        if (m.type === 'attributes') { oversettAttr(m.target, m.attributeName, true); continue; }
        for (const n of m.addedNodes) sveipSprak(n, true);
      }
    } finally { SKRIVER = false; }
  });
  /* Attributes are watched too: a tooltip written after the sweep - the one
     explaining why point names are not being shortened, for instance - would
     otherwise stay Norwegian for the rest of the session. SKRIVER stops the
     write from being read back as a new mutation. */
  SPRAAK_OBS.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ATTR_SPRAAK,
  });
}
function stoppSprakObs() {
  if (!SPRAAK_OBS) return;
  SPRAAK_OBS.disconnect();
  SPRAAK_OBS = null;
}

let SPRAAK = 'nb';

function settSprak(kode, lagre) {
  const til = kode === 'en';
  if ((SPRAAK === 'en') !== til) {
    stoppSprakObs();
    sveipSprak(document.body, til);
    SPRAAK = til ? 'en' : 'nb';
    if (til) startSprakObs();
  }
  if (lagre) savePrefs({sprak: SPRAAK});
  const b = $('langBtn');
  if (b) {
    b.textContent = til ? 'NO' : 'EN';
    b.title = til ? 'Bytt til norsk' : 'Switch to English';
    b.setAttribute('aria-label', b.title);
  }
  document.documentElement.lang = til ? 'en' : 'no';
}

(function sprakOppstart() {
  const b = $('langBtn');
  if (b) b.onclick = () => settSprak(SPRAAK === 'en' ? 'nb' : 'en', true);
  const lagret = loadPrefs().sprak;
  if (lagret === 'en') settSprak('en', false); else settSprak('nb', false);
})();
