/* Leverandører: gjenkjenning av hvem som har laget en enhet, og merket de får. Delt av hovedappen (app.js) og mobilsiden,
   slik at begge kaller samme enhet det samme. */
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
  // Funnet paa et hotellanlegg 20.08.2026 - ventilasjonsaggregater og gatewayer
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

/* Leverandørens navn som en liten merkeplate i NABE-stil: ordmerket med merkets farge, uten bilder å laste.
   Bare leverandører NABE kjenner får den; resten står som vanlig tekst. Navnet står i aria-label og title. */
const LEV_KORT = {'Johnson C.': 'JCI', 'Kieback&Peter': 'K&P', 'Automated Logic': 'ALC', 'Delta Controls': 'DELTA', 'Saia-Burgess': 'SAIA',
  'Phoenix C.': 'PHOENIX', 'Reliable C.': 'RELIABLE', 'Embedded Sys.': 'EMBEDDED', 'OJ Electronics': 'OJ', 'TA Hydronics': 'TA',
  'Babel Buster': 'BABEL', 'Micro Matic': 'MICRO MATIC', 'Trend': 'TREND', 'Delta': 'DELTA'};
/* Merker som er gjort om fra leverandørens egen logo (lag_logoer.py, js/nabe-lev-logo.js): én farge, i appens tekstfarge,
   så de følger lys og mørk visning. Nøkkelen er navnet vendorOf gir, verdien er filnavnet i logoer/. */
const LOGO_AV = {'Beckhoff': 'beckhoff', 'Siemens': 'siemens', 'Schneider': 'schneiderelectric', 'Honeywell': 'honeywell', 'Phoenix C.': 'phoenix',
  'Mitsubishi': 'mitsubishi', 'LG': 'lg', 'Samsung': 'samsung', 'Bosch': 'bosch', 'Johnson C.': 'johnsoncontrols', 'Sauter': 'sauter',
  'KMC': 'kmc', 'Belimo': 'belimo', 'Vaisala': 'vaisala', 'NIBE': 'nibe', 'Danfoss': 'danfoss', 'ABB': 'abb', 'Carrier': 'carrier',
  'Trane': 'trane', 'Daikin': 'daikin', 'Hitachi': 'hitachi', 'Panasonic': 'panasonic', 'Toshiba': 'toshiba', 'Fujitsu': 'fujitsu',
  'Rockwell': 'rockwellautomation', 'WAGO': 'wago', 'Grundfos': 'grundfos', 'Yokogawa': 'yokogawa', 'Regin': 'regin', 'Priva': 'priva',
  'Tridium': 'tridium', 'Distech': 'distech', 'Delta Controls': 'deltacontrols', 'Alerton': 'alerton', 'Trend': 'trend', 'Systemair': 'systemair',
  'Swegon': 'swegon', 'Lindab': 'lindab', 'Viessmann': 'viessmann', 'Vaillant': 'vaillant', 'Komfovent': 'komfovent', 'LOYTEC': 'loytec'};
let LOGO_CSS = false;
function levLogoCss() {
  if (LOGO_CSS || typeof LEV_LOGO === 'undefined' || typeof document === 'undefined' || !document.body) return;
  LOGO_CSS = true;
  /* Hver logo beskjæres til det som faktisk er tegnet, slik at et bredt ordmerke i en kvadratisk ramme ikke blir et frimerke */
  const hold = document.createElement('div');
  hold.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden';
  document.body.appendChild(hold);
  const regler = [];
  for (const [k, svg0] of Object.entries(LEV_LOGO)) {
    let svg = svg0;
    const m = /viewBox="([-0-9. ]+)"/.exec(svg);
    let v = m ? m[1].trim().split(/\s+/).map(Number) : [0, 0, 1, 1];
    try {
      hold.innerHTML = svg0;
      const b = hold.firstElementChild.getBBox();
      if (b.width > 0 && b.height > 0) {
        const pad = Math.max(b.width, b.height) * 0.03;
        v = [b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad];
        svg = svg0.replace(/viewBox="[^"]*"/, `viewBox="${v.map(n => +n.toFixed(2)).join(' ')}"`);
      }
    } catch { /* uten beskjæring får logoen sin egen ramme */ }
    regler.push(`.lev-i-${k}{--li:url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}");--ar:${(v[2] / (v[3] || 1)).toFixed(3)}}`);
  }
  hold.remove();
  const st = document.createElement('style');
  st.textContent = regler.join('\n');
  document.head.appendChild(st);
}
function levLogo(label, farge) {
  const navn = String(label || '');
  if (!Object.prototype.hasOwnProperty.call(VENDOR_COLOR, navn)) return esc(navn);
  const nokkel = LOGO_AV[navn];
  if (nokkel && typeof LEV_LOGO !== 'undefined' && LEV_LOGO[nokkel]) {
    levLogoCss();
    return `<span class="lev-ikon lev-i-${nokkel}" role="img" aria-label="${esc(navn)}" title="${esc(navn)}"></span>`;
  }
  const tekst = (LEV_KORT[navn] || navn).toUpperCase();
  return `<span class="lev-logo" role="img" aria-label="${esc(navn)}" title="${esc(navn)}" style="--vc:${farge || VENDOR_COLOR[navn]}">${esc(tekst)}</span>`;
}

/* Systemene etter NS 3451 og taggene som viser hvilke en enhet har punkter i. Delt med mobilsiden, så de heter det samme begge steder.
   Fargen bærer ingenting: nummeret og navnet står i teksten. */
const SYSTEMTYPE = {'310': ['Sanitær', 'Plumbing'], '320': ['Varme', 'Heating'], '330': ['Brannslokking', 'Fire fighting'], '340': ['Gass og trykkluft', 'Gas and compressed air'],
  '350': ['Prosesskjøling', 'Process cooling'], '360': ['Luftbehandling', 'Air handling'], '370': ['Kjøling', 'Cooling'], '380': ['Vannbehandling', 'Water treatment']};
/* To skrivemåter: med skilletegn (360.026, 360_026, A_360_001) og kompakt (S36026, s36026, 36026), der en bokstav foran bare kan være S.
   Den kompakte må stå først i ordet, ellers ville RT36012 bli lest som system 360. */
const SYS_RE = /(?:^|[^0-9])(3[1-8]0)[._-][0-9]{3}(?![0-9])|(?:^|[^0-9A-Za-z])[Ss]?(3[1-8]0)[0-9]{2,3}(?![0-9])/;
const sysFra = (m) => (m ? (m[1] || m[2]) : '');
const SYS_MINNE = new WeakMap();
function systemerAv(punkter) {
  if (!punkter || !punkter.length) return [];
  let r = SYS_MINNE.get(punkter);
  if (r && r.n === punkter.length) return r.v;
  const s = new Set();
  for (const p of punkter) { const nr = sysFra(SYS_RE.exec(p.name || '') || SYS_RE.exec(p.description || '')); if (nr) s.add(nr); }
  r = {n: punkter.length, v: [...s].sort()};
  SYS_MINNE.set(punkter, r);
  return r.v;
}
function systemTagger(nrs) {
  if (!nrs || !nrs.length) return '';
  return `<span class="systags">${nrs.map(nr => { const t = SYSTEMTYPE[nr]; return `<i class="systag" title="${esc(t ? nr + ' ' + T(t[0], t[1]) : nr)}"><b>${esc(nr)}</b>${t ? ' ' + esc(T(t[0], t[1])) : ''}</i>`; }).join('')}</span>`;
}

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
