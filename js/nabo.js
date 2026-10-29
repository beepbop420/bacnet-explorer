/* NABO - Not Another BACnet Object-namer.

   The neighbour of NABE. NABE reads the plant; NABO gives every point the
   name Niagara will know it by, and writes the «Variabel» file NTI imports -
   the job BTG does, with the devices read live and EDE files side by side.

   What it takes in: the devices NABE has read, and any number of EDE files
   (with their _StateTexts companion). What it puts out: one Variabel file for
   all of them or one per device, and EDE files for each. BTG's own settings
   file, HeaderBTG.ini, is read and written so a site set up in BTG carries
   straight over, and back.

   The row format is the one BTG 2.9.6 writes, 34 fields - see the BTG notes in
   nabe-verktoy.js for what each field holds. Two things differ on purpose:
   the device field comes from the controller's name rather than the EDE file
   name, and decimals follow BTG's per-unit table instead of a fixed rule. */

const NABO = {
  kilder: [],          // {id, type:'anlegg'|'ede', auto, fil, instans, punkter}
  sok: '',
  filter: 'alle',      // alle | adv | alarm | trend
  perEnhet: false,
  visning: 'var',      // var | diff | norm
  fasit: null,         // a Variabel file read back: {fil, rader}
  bekreft: 0,          // when "export anyway" was offered
  valgt: new Set(),    // rows ticked in the table, by key
  sistValgt: null,     // the last row ticked, where Shift-click ranges from
};

/* BTG's normalisation, as its Normalisering tab ships it: a regex with named
   groups, a template the groups fill, and TC2 function codes mapped to NM. */
const NORM_STD = {
  paa: false,
  regex: '^(?:(?<lokasjon>[A-Za-z][A-Za-z0-9]*)_)?(?<hoved>\\d{1,5})_(?<under>\\d{1,5})(?:_(?<subdir>\\d{2}))?_(?<komponent>[A-Za-z]{1,3}\\d{1,4})_(?<funksjonskode>.+)$',
  mal: '{hoved}.{under}.{komponent}.{funksjonskode}',
  koder: 'C = Pådrag, JV_AU, SB_AO, AO, SB.AO, SB.AU, LX_AO\nS = Start, Starts, JP_DO, JP.DO, LX_DO\nA = Alarm, Feil\nA1 = Alarm1, AlarmA, FeilA\nA2 = Alarm2, AlarmB, FeilB\nKMD = Auto, JP_Auto, SB_Auto, AM',
};

/* BTG's decimals per kind of unit, as HeaderBTG.ini calls them. */
const EU_STD = {
  EUDefault: 1, EUTemp: 1, EUTrykk_Pa: 0, EUTrykk_kPa: 0, EUTrykk_bar: 1,
  EUluftmengde: 0, EUliterprsek: 1, EUluftkvalitet: 0, EUprosent: 0, EUVolum: 1,
  EUEl_kWh: 1, EUEl_MWh: 3, EUEl_W: 0, EUEl_kW: 1, EUEl_V: 0, EUEl_A: 1,
};
const EU_NAVN = {
  EUDefault: ['Standard', 'Default'], EUTemp: ['Temperatur', 'Temperature'],
  EUTrykk_Pa: ['Trykk, Pa', 'Pressure, Pa'], EUTrykk_kPa: ['Trykk, kPa', 'Pressure, kPa'],
  EUTrykk_bar: ['Trykk, bar', 'Pressure, bar'], EUluftmengde: ['Luftmengde, m³/h', 'Airflow, m³/h'],
  EUliterprsek: ['Vannmengde, l/s', 'Flow, l/s'], EUluftkvalitet: ['Luftkvalitet, ppm', 'Air quality, ppm'],
  EUprosent: ['Prosent', 'Percent'], EUVolum: ['Volum', 'Volume'],
  EUEl_kWh: ['Energi, kWh', 'Energy, kWh'], EUEl_MWh: ['Energi, MWh', 'Energy, MWh'],
  EUEl_W: ['Effekt, W', 'Power, W'], EUEl_kW: ['Effekt, kW', 'Power, kW'],
  EUEl_V: ['Spenning, V', 'Voltage, V'], EUEl_A: ['Strøm, A', 'Current, A'],
};

function euNokkel(enhet) {
  const u = String(enhet || '').toLowerCase();
  if (/celsius|fahrenheit|kelvin/.test(u)) return 'EUTemp';
  if (/^kilopascals?$/.test(u)) return 'EUTrykk_kPa';
  if (/pascals?$/.test(u)) return 'EUTrykk_Pa';
  if (/^bars?$/.test(u)) return 'EUTrykk_bar';
  if (/cubic (meters|feet) per (hour|second|minute)/.test(u)) return 'EUluftmengde';
  if (/liters per (second|minute|hour)/.test(u)) return 'EUliterprsek';
  if (/parts per million/.test(u)) return 'EUluftkvalitet';
  if (/percent/.test(u)) return 'EUprosent';
  if (/^(cubic meters?|liters?)$/.test(u)) return 'EUVolum';
  if (/^kilowatt hours?$/.test(u)) return 'EUEl_kWh';
  if (/^megawatt hours?$/.test(u)) return 'EUEl_MWh';
  if (/^watts?$/.test(u)) return 'EUEl_W';
  if (/^kilowatts?$/.test(u)) return 'EUEl_kW';
  if (/volts?$/.test(u)) return 'EUEl_V';
  if (/amperes?$/.test(u)) return 'EUEl_A';
  return 'EUDefault';
}

/* Hand edits and device names belong to a site: the same EDE loaded next
   month finds them again. Keyed by the site name, and inside it by device
   instance and object - never by the EDE file name, which changes with the
   date in it. */
function anleggNokkel() {
  const t = tagInnstillinger();
  return String(t.anleggsnavn || t.prefiks || '-').trim().toLowerCase() || '-';
}
function devNokkel(k) {
  return k.instans !== null && k.instans !== undefined && k.instans !== '' ? 'd' + k.instans : k.id;
}
function naboKey(k, p) { return `${devNokkel(k)}|${p.type},${p.instance}`; }
function lagreAnlegg(patch) {
  const p = loadPrefs().nabo || {};
  const alle = Object.assign({}, p.anlegg || {});
  alle[anleggNokkel()] = Object.assign({}, alle[anleggNokkel()] || {}, patch);
  lagreNabo({anlegg: alle});
}

/* How the prefix is used. BTG asks the same in its Format list; here it is
   one choice beside the prefix itself, and blank means no prefix at all. */
const PREF_MOD = ['device', 'tag', 'btg', 'ingen'];

function naboInnst() {
  const p = loadPrefs().nabo || {};
  const her = (p.anlegg || {})[anleggNokkel()] || {};
  return {trend: p.trend || '00:05:00', eu: Object.assign({}, EU_STD, p.eu || {}),
          ini: p.ini || '', navn: her.navn || {}, perEnhet: !!p.perEnhet,
          prefMod: PREF_MOD.includes(p.prefMod) ? p.prefMod : (p.foran === 'prefiks' ? 'tag' : 'device'),
          // The site name is always there for the file; in the tag only if you say so.
          foranAnlegg: !!p.foranAnlegg,
          norm: Object.assign({}, NORM_STD, p.norm || {}),
          // Every separator in a point name starts a new folder in the path:
          // a dot is a folder to Niagara, so dots all the way is the rule.
          // Names that keep an underscore at the end are set per row (hale).
          // A slash is a folder in names copied from Niagara (OS001/FCB/...).
          skille: '_.- /',
          // Hand edits, per device and object: what used to be done in Excel.
          rett: her.rett || {},
          // Where files go: '' is the browser's Downloads, anything else a
          // folder the server writes into.
          mappe: p.mappe || '', mapper: p.mapper || [],
          // Write the SD code (alarm class, then T for trend or 0) in front
          // of the description, for tools that read it from there.
          sdBeskr: false};
}
function lagreNabo(patch) {
  savePrefs({nabo: Object.assign({}, loadPrefs().nabo || {}, patch)});
}

/* ------------------------------------------------------- normalisation */
let NORM_CACHE = {nokkel: null};
function normOppsett(o) {
  const n = o.norm;
  const nokkel = n.regex + '\u0001' + n.koder;
  if (NORM_CACHE.nokkel !== nokkel) {
    let re = null, feil = '';
    try { re = new RegExp(n.regex); } catch (e) { feil = e.message; }
    const kart = new Map();
    for (const l of String(n.koder || '').split(/\r?\n/)) {
      const m = /^\s*([^=]+?)\s*=\s*(.+)$/.exec(l);
      if (!m) continue;
      for (const fra of m[2].split(',')) { const k = fra.trim().toLowerCase(); if (k) kart.set(k, m[1].trim()); }
    }
    NORM_CACHE = {nokkel, re, feil, kart};
  }
  return NORM_CACHE;
}

let SKILLE_CACHE = {k: null, re: null};
function naboSkilleRe(o) {
  if (SKILLE_CACHE.k !== o.skille) {
    const tegn = [...new Set(o.skille.split(''))].map(c => c === ' ' ? '\\s' : c.replace(/[\]\\^-]/g, '\\$&')).join('');
    SKILLE_CACHE = {k: o.skille, re: tegn ? new RegExp(`[${tegn}]+`, 'g') : null};
  }
  return SKILLE_CACHE.re;
}
/* The point name as a Niagara path: split where you have said it should be,
   joined with dots. A dot left in a name is still a folder to Niagara. */
/* Measured against 7516 points BTG itself wrote, from the EDE files they came
   from (five real sites):
   - _ always starts a new part.
   - A part with a space in it is text and stays whole, dots and hyphens and
     all: "XS Akk. tank temp." and "Drift fra SD-anlegg" are one part each.
   - A code part (no spaces) splits on . and - as well.
   - A slash is kept: JP41/JP42 means both pumps, not a folder.
   This gives what BTG gave for 80 % of those points; the rest are SYSTEM
   (deliberately at the top here), names BTG left with a trailing space,
   and tags someone edited by hand in BTG. */
function naboSti(navn, cluster, o) {
  const deler = [];
  for (const rå of String(navn || '').trim().split('_')) {
    const d = rå.trim();
    if (!d) continue;
    if (/\s/.test(d)) deler.push(d);
    else deler.push(...d.split(/[.\-]+/).filter(Boolean));
  }
  const biter = romkoder(delSystemnummer(deler));
  return (cluster ? cluster + '.' : '') + biter.join('.');
}

/* Room codes as BTG writes them: floor, underscore, room in four digits.
   R00_0004 stays together, and R000004 or R99999 becomes R00_0004 or R99_9999. */
function romkoder(biter) {
  const ut = [];
  for (const d of biter) {
    const m = /^R(\d{5,6})$/i.exec(d);
    if (m) ut.push(`${d[0]}${m[1].slice(0, 2)}_${m[1].slice(-4)}`);
    else if (ut.length && /^R\d{2}$/i.test(ut[ut.length - 1]) && /^\d{4}$/.test(d)) ut[ut.length - 1] += '_' + d;
    else ut.push(d);
  }
  return ut;
}

/* A system number written in one piece is split the way BTG writes it:
   360001 -> 360.001, 3600001 -> 360.0001. Five digits stay, as BTG leaves
   31002 (HK Kommunehuset). Only the first
   number in the name, and only when the next part is not a number too -
   360_001 is already split, and in 360.360013 the 360 comes first. */
function delSystemnummer(biter) {
  // An s marks the system (s432_001, s360001). Whatever stands before it is a
  // program's namespace - Mod_TCP in a Beckhoff - and BTG leaves it out.
  const s = biter.findIndex(b => /^s\d+$/i.test(b));
  if (s > 0) biter = biter.slice(s);
  // The first number, counting BTG's +PRE= in front of it; the s goes.
  const i = biter.findIndex(b => /^(\+[^=]*=)?s?\d+$/i.test(b));
  if (i < 0) return biter;
  const m = /^(\+[^=]*=)?s?(\d+)$/i.exec(biter[i]);
  const tall = m[2], foran = m[1] || '';
  if (tall.length < 6 || tall.length > 7 || /^\d+$/.test(biter[i + 1] || ''))
    return [...biter.slice(0, i), foran + tall, ...biter.slice(i + 1)];
  return [...biter.slice(0, i), foran + tall.slice(0, 3), tall.slice(3), ...biter.slice(i + 1)];
}

/* What stands in front of the systems in every tag: the prefix as a folder
   if you chose that, and the site name if you want it there. Cluster is not
   here: in BTG it is the Citect cluster and has never been part of a Niagara
   tag - NABO keeps it only for HeaderBTG.ini. */
function naboTopp(t, o) {
  const pref = o.prefMod === 'tag' ? t.prefiks : '';
  return [pref, o.foranAnlegg ? t.anleggsnavn : ''].map(x => String(x || '').trim().replace(/[\s.]+/g, '_'))
    .filter(Boolean).join('.');
}

/* A SYSTEM point is common to the whole controller: its name starts with
   SYSTEM. SYSTEM further in, as in 360.013.SYSTEM.Utekomp, belongs to that
   system and stays where it is. */
function erSystemNavn(navn) {
  return /^SYSTEM(?:[_.\-\s]|$)/i.test(String(navn || '').trim());
}

/* The last two folders joined with an underscore, for the points whose name
   ends in something like HB_KV: SYSTEM.OU001.HB.KV becomes SYSTEM.OU001.HB_KV. */
function naboHale(sti) {
  const biter = sti.split('.');
  if (biter.length < 2) return sti;
  return [...biter.slice(0, -2), biter.slice(-2).join('_')].join('.');
}

/* A point name through the regex and the template, or null when it does not
   fit - then the ordinary path is used, and the row says so. */
function normaliser(navn, o) {
  const c = normOppsett(o);
  if (!c.re) return null;
  const m = c.re.exec(String(navn || '').trim());
  if (!m || !m.groups) return null;
  const g = Object.assign({}, m.groups);
  if (g.funksjonskode) {
    const hel = c.kart.get(g.funksjonskode.toLowerCase());
    g.funksjonskode = hel || g.funksjonskode.split(/([_.])/).map(x => c.kart.get(x.toLowerCase()) || x).join('');
  }
  const sti = o.norm.mal.split('.')
    .map(del => del.replace(/\{(\w+)\}/g, (_, k) => g[k] ?? ''))
    .map(x => (naboSkilleRe(o) ? x.replace(naboSkilleRe(o), '.') : x).replace(/^\.+|\.+$/g, ''))
    .filter(Boolean).join('.');
  return sti ? {sti, g} : null;
}

/* ------------------------------------------------------------ one row */
function naboRad(p, t, o, anlegg, enhetNavn, rett) {
  const type = BTG_TYPE[p.type];
  if (type === undefined) return null;
  rett = rett || {};
  const analog = type <= 2;
  const system = erSystemNavn(p.name);
  // SYSTEM points are not system-numbered, so the normalisation leaves them be.
  const norm = o.norm.paa && !system ? normaliser(p.name, o) : null;
  const topp = naboTopp(t, o);
  let stiRen = norm ? norm.sti : naboSti(p.name, '', o);
  // BTG's +PRE=360.001: the prefix glued to the system number. A SYSTEM
  // point has no system number and sits outside them all, so it goes bare.
  // It goes on the system number - the first part that is a number - so a
  // location in front, as VMS in VMS.639.001, stays in front of it.
  if (o.prefMod === 'btg' && t.prefiks && !system && !/\+[^.]*=/.test(stiRen)) {
    const biter = stiRen.split('.');
    const i = Math.max(0, biter.findIndex(b => /^\d/.test(b)));
    biter[i] = `+${t.prefiks}=${biter[i]}`;
    stiRen = biter.join('.');
  }
  stiRen = (topp ? topp + '.' : '') + stiRen;
  const stiAuto = rett.hale ? naboHale(stiRen) : stiRen;
  const sti = rett.sti ?? stiAuto;
  const sd = btgSd(p.description || '');
  const beskrAuto = sd.rest || p.name || '';
  const beskr = rett.beskr ?? beskrAuto;
  const enhetAuto = analog ? btgEnhet(p.units) : '';
  const enhet = rett.enhet ?? enhetAuto;
  // No unit is a count or a state, never a fraction.
  const desAuto = analog ? (enhetAuto === 'null' ? 0 : (o.eu[euNokkel(enhetAuto)] ?? o.eu.EUDefault)) : 0;
  const des = rett.des ?? desAuto;
  const klasse = rett.klasse ?? sd.klasse;
  let tilstander = '';
  if (Array.isArray(p.state_text) && p.state_text.length) {
    tilstander = (type >= 3 && type <= 5)
      ? `0=${p.state_text[0] || 'Av'}|1=${p.state_text[1] || 'På'}`
      : p.state_text.map((s, i) => `${i + 1}=${s}`).join('|');
  }
  const biter = sti.split('.');
  // The alarm source is system.sub-component, as BTG writes 310.02-JP40: it
  // starts at the system number (or SYSTEM), past any prefix or location.
  const fra = biter.findIndex(b => /^(\+[^=]*=)?\d/.test(b) || /^SYSTEM$/i.test(b));
  const del = fra >= 0 ? biter.slice(fra) : biter;
  if (del[0]) del[0] = del[0].replace(/^\+[^=]*=/, '');
  const kilde = klasse
    ? [anlegg, del.length >= 3 ? `${del[0]}.${del[1]}-${del[2]}` : sti].filter(Boolean).join(' ') : '';
  const trend = (rett.trend ?? sd.trend) ? `Interval|${o.trend}` : '';
  const sdKode = `SD${klasse || 0}${trend ? 'T' : '0'}`;
  // The code is written once, from Trend and Alarm; any code already in the
  // text, typed by hand or left in the plant, is taken out first.
  const beskrSd = `${sdKode} ${btgUtenSd(beskr)}`.trim();
  const f = new Array(34).fill('');
  f[0] = 'BacnetNetwork'; f[1] = anlegg; f[2] = enhetNavn; f[3] = sti;
  f[4] = String(type); f[5] = String(p.instance ?? ''); f[6] = naboVerdi(p.value); f[7] = enhet;
  f[8] = String(des); f[9] = tilstander; f[10] = o.sdBeskr ? beskrSd : beskr; f[11] = trend;
  if (klasse) { f[12] = String(klasse); f[13] = beskr; f[14] = kilde; }
  f[30] = p.name || '';
  if (norm) { f[29] = norm.g.komponent || ''; f[33] = norm.g.funksjonskode || ''; }
  return {
    normert: o.norm.paa && !system ? !!norm : null, system,
    linje: f.map(x => String(x).replace(/[;\r\n]/g, ' ')).join(';'),
    sti, type, typeNavn: shortType(p.type), inst: p.instance, enhet, des,
    trend: !!trend, klasse, beskr, navn: p.name || '', harSd: sd.rest !== (p.description || '').trim(),
    hale: !!rett.hale, stiRen, sdKode, beskrSd,
    auto: {sti: stiAuto, beskr: beskrAuto, enhet: enhetAuto, des: desAuto, trend: sd.trend, klasse: sd.klasse},
    rett,
  };
}

function naboVerdi(v) {
  if (v === null || v === undefined || typeof v === 'object') return '';
  return typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
}

function enhetsfelt(kilde, t) {
  const o = naboInnst();
  let navn = String((o.navn[devNokkel(kilde)] ?? kilde.auto) || '').trim();
  const pref = o.prefMod === 'ingen' ? '' : (t.prefiks || '').trim();
  if (pref && navn.toLowerCase().startsWith(pref.toLowerCase()))
    navn = navn.slice(pref.length).replace(/^[._\-\s]+/, '');
  navn = navn.replace(/[\s\-.]+/g, '_');
  // No prefix is a choice, not a mistake: the device is then just its name.
  return pref ? `${pref}.${navn}` : navn;
}

/* Every row of every included device, with what is wrong with it. */
function naboResultat() {
  const t = tagInnstillinger();
  const o = naboInnst();
  const anlegg = (t.anleggsnavn || '').trim();
  const rader = [];
  let hoppet = 0;
  // Two devices that end up with the same name would be one device to NTI.
  const navnBrukt = new Map();
  for (const k of NABO.kilder) if (!k.av) {
    const e = enhetsfelt(k, t);
    navnBrukt.set(e, (navnBrukt.get(e) || 0) + 1);
  }
  for (const k of NABO.kilder) {
    if (k.av) continue;
    const enhetNavn = enhetsfelt(k, t);
    const sett = new Map();
    const objekter = new Set();
    for (const p of k.punkter) {
      const key = naboKey(k, p);
      const r = naboRad(p, t, o, anlegg, enhetNavn, o.rett[key]);
      if (!r) { hoppet++; continue; }
      r.kilde = k; r.enhetNavn = enhetNavn; r.feil = []; r.adv = []; r.key = key;
      if (!r.navn) r.feil.push(T('Mangler objektnavn', 'No object name'));
      if (sett.has(r.sti)) {
        r.feil.push(T('Samme tag finnes alt på denne enheten', 'The same tag already exists on this device'));
        sett.get(r.sti).feil.push(T('Samme tag finnes to ganger', 'The same tag appears twice'));
      } else sett.set(r.sti, r);
      const ob = `${r.type}:${r.inst}`;
      if (objekter.has(ob)) r.feil.push(T('Samme objekt (type og instans) finnes to ganger', 'The same object (type and instance) appears twice'));
      objekter.add(ob);
      if (navnBrukt.get(enhetNavn) > 1) r.feil.push(T('En annen enhet får samme device-navn', 'Another device gets the same device name'));
      // No warning for a short path: a controller's own points (.avDTempHeat01)
      // never follow the plant's naming, and nothing can be done about them here.
      if (r.normert === false) r.adv.push(T('Passer ikke normaliseringen, vanlig sti brukt', 'Does not fit the normalisation, plain path used'));
      // + and = are BTG's own +01=360.001 format; Niagara escapes them and NTI expects it.
      const rare = [...new Set((r.sti.match(/[^A-Za-z0-9_.$+=]/g) || []))];
      if (rare.length) r.adv.push(T(`Niagara må escape ${rare.map(c => c === ' ' ? 'mellomrom' : c).join(' ')}`,
                                    `Niagara has to escape ${rare.map(c => c === ' ' ? 'space' : c).join(' ')}`));
      rader.push(r);
    }
  }
  const globalt = [];
  if (t.prefiks && t.prefiks.length > PREFIKS_MAKS)
    globalt.push(T(`Prefikset er over ${PREFIKS_MAKS} tegn`, `The prefix is over ${PREFIKS_MAKS} characters`));
  const usikre = NABO.kilder.filter(k => !k.av && k.usikker && !o.navn[devNokkel(k)]).length;
  if (usikre) globalt.push(T(`${usikre} ${usikre === 1 ? 'enhet har' : 'enheter har'} et device-navn som må sjekkes`,
                             `${usikre} ${usikre === 1 ? 'device has' : 'devices have'} a device name to check`));
  if (o.norm.paa && normOppsett(o).feil) globalt.push(T('Regex-feil i normaliseringen', 'Regex error in the normalisation'));
  return {rader, hoppet, globalt, t, o, anlegg};
}

/* ------------------------------------------------------------ sources */
function naboAnleggKilder() {
  const ut = [];
  for (const d of S.devices) {
    const pts = S.cache[d.address];
    if (!pts || !pts.length) continue;
    ut.push({id: 'a:' + d.address + ':' + d.device_instance, type: 'anlegg',
             auto: String(d.object_name || d.device_instance), fil: d.address,
             instans: d.device_instance, punkter: pts});
  }
  return ut;
}

function oppdaterKilder() {
  const ede = NABO.kilder.filter(k => k.type === 'ede');
  const av = new Set(NABO.kilder.filter(k => k.av).map(k => k.id));
  NABO.kilder = [...naboAnleggKilder(), ...ede];
  NABO.kilder.forEach(k => { k.av = av.has(k.id); });
}

/* EDE files arrive as Windows-1252 from older tools and UTF-8 from newer. */
async function lesTekst(fil) {
  const buf = await fil.arrayBuffer();
  try { return new TextDecoder('utf-8', {fatal: true}).decode(buf).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

const EDE_ENHET_NAVN = (() => {
  const m = {};
  for (const [navn, kode] of Object.entries(EDE_UNIT))
    if (m[kode] === undefined || (m[kode] !== m[kode].toLowerCase() && navn === navn.toLowerCase())) m[kode] = navn;
  return m;
})();

function lesStateTexts(tekst) {
  const m = new Map();
  for (const l of tekst.split(/\r?\n/)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const f = splitCsvLine(l);
    const n = parseInt(f[0], 10);
    if (!isNaN(n)) m.set(n, f.slice(1).map(x => x.trim()).filter((x, i, a) => x || a.slice(i).some(Boolean)));
  }
  return m;
}

/* An EDE file as NABO needs it: every column it carries, grouped per device
   (one file can hold several), with the project name as the device's name. */
function lesEdeFil(tekst, filnavn, tilstander) {
  const linjer = tekst.split(/\r?\n/).filter(l => l.trim() !== '');
  const hi = linjer.findIndex(l => /object-name/i.test(l) && /object-type/i.test(l));
  if (hi < 0) return {error: T(`${filnavn}: fant ikke EDE-overskriften`, `${filnavn}: no EDE header found`)};
  const prosjekt = (linjer.slice(0, hi).map(splitCsvLine).find(f => /^PROJECT_NAME$/i.test((f[0] || '').trim())) || [])[1] || '';
  const head = splitCsvLine(linjer[hi]).map(h => h.replace(/^#\s*/, '').trim().toLowerCase());
  const kol = n => head.findIndex(h => h === n || h.startsWith(n));
  const i = {navn: kol('object-name'), type: kol('object-type'), inst: kol('object-instance'),
             beskr: kol('description'), dev: kol('device-object-instance'), verdi: kol('present-value-default'),
             st: kol('state-text-reference'), enhet: kol('unit-code')};
  const enheter = new Map();
  for (const l of linjer.slice(hi + 1)) {
    if (l.trim().startsWith('#')) continue;
    const f = splitCsvLine(l);
    const typeNavn = EDE_TYPE_NAME[(f[i.type] || '').trim()] || (f[i.type] || '').trim().toLowerCase();
    const inst = parseInt((f[i.inst] || '').trim(), 10);
    if (!typeNavn || isNaN(inst)) continue;
    const dev = i.dev >= 0 ? (f[i.dev] || '').trim() : '';
    const ref = i.st >= 0 ? parseInt(f[i.st], 10) : NaN;
    const kode = i.enhet >= 0 ? parseInt(f[i.enhet], 10) : NaN;
    if (!enheter.has(dev)) enheter.set(dev, []);
    enheter.get(dev).push({
      type: typeNavn, instance: inst, objid: `${typeNavn},${inst}`,
      name: (f[i.navn] || '').trim(),
      description: i.beskr >= 0 ? (f[i.beskr] || '').trim() : '',
      units: isNaN(kode) ? null : (EDE_ENHET_NAVN[kode] || null),
      value: i.verdi >= 0 ? (f[i.verdi] || '').trim() : '',
      state_text: !isNaN(ref) && tilstander && tilstander.get(ref) ? tilstander.get(ref) : null,
    });
  }
  const flere = enheter.size > 1;
  return {kilder: [...enheter].map(([dev, punkter]) => {
    const n = devicenavnFor(dev, !flere && prosjekt.trim());
    return {id: `e:${filnavn}:${dev}`, type: 'ede', fil: filnavn, instans: dev || null, punkter,
            auto: n.navn || navnFraFil(filnavn) || (dev ? `Device${dev}` : filnavn.replace(/\.csv$/i, '')),
            usikker: !n.navn, hvor: n.hvor || (navnFraFil(filnavn) ? T('fra filnavnet', 'from the file name') : '')};
  })};
}

/* The device field is where BTG goes wrong, so this is careful about it. An
   instance NABE has seen on a plant gives the controller's own name. A project
   name that is one word is the device name in NABE's and Beckhoff's exports;
   one with spaces is a project title. Otherwise it is left for you to fill in
   - flagged, rather than guessed from the file name as BTG does. */
function devicenavnFor(inst, prosjekt) {
  if (inst) {
    const d = S.devices.find(x => String(x.device_instance) === String(inst) && x.object_name);
    if (d) return {navn: d.object_name, hvor: T('fra anlegget', 'from the plant')};
    for (const s of Object.values(MINNE || {})) {
      const e = (s.enheter || []).find(x => String(x.device_instance) === String(inst) && x.object_name);
      if (e) return {navn: e.object_name, hvor: T('fra anleggsminnet', 'from the site memory')};
    }
  }
  if (prosjekt && !/\s/.test(prosjekt)) return {navn: prosjekt, hvor: 'PROJECT_NAME'};
  return {navn: '', hvor: ''};
}

/* A Variabel file read back - what Niagara got last time. BTG writes it with
   no quoting, so a plain split is the honest parser. */
function lesVariabel(tekst, fil) {
  const rader = tekst.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.startsWith('BacnetNetwork;')).map(l => l.split(';'));
  return rader.length ? {fil, rader} : null;
}

/* What a file name says about the device once the EDE and the dates are
   gone: GR.1A.04_EDE -> GR.1A.04, ABC1_434001OU001_EDE -> ABC1_434001OU001.
   Device1234_2026-10-23_EDE says nothing, and BTG's ABC.2026_10_23 shows why
   that must not become the name. */
function navnFraFil(filnavn) {
  // Whole parts only: EDE, dates, versions and copies go; what is left is the name.
  const bort = /^(EDE|v\d+|\(\d+\)|utdatert|fixed|ny|gammel|kopi|Device\d*|\d{4}-?\d{2}-?\d{2}|\d{8})$/i;
  const deler = String(filnavn || '').replace(/\.(csv|txt)$/i, '').split(/[_\s]+/).filter(d => d && !bort.test(d));
  // Nothing but numbers left is an instance or a system, not a device name.
  return deler.length && !deler.every(d => /^[\d.]+$/.test(d)) ? deler.join('_') : '';
}

async function leggTilFiler(filer) {
  const liste = [...filer];
  const basis = n => n.replace(/_(EDE|StateTexts|ObjTypes|Units|TagSettings)\.csv$/i, '').toLowerCase();
  const tilst = new Map();
  for (const f of liste.filter(f => /_StateTexts\.csv$/i.test(f.name)))
    tilst.set(basis(f.name), lesStateTexts(await lesTekst(f)));
  let n = 0, pkt = 0;
  for (const f of liste) {
    if (/\.ini$/i.test(f.name)) { await lesIniFil(f); continue; }
    if (/_(StateTexts|ObjTypes|Units|TagSettings)\.csv$/i.test(f.name)) continue;
    if (!/\.(csv|txt)$/i.test(f.name)) continue;
    const tekst = await lesTekst(f);
    if (/^\uFEFF?BacnetNetwork;/.test(tekst)) {
      NABO.fasit = lesVariabel(tekst, f.name);
      NABO.visning = 'diff';
      toast(T(`${f.name} lest inn til sammenligning`, `${f.name} read in for comparison`));
      continue;
    }
    const r = lesEdeFil(tekst, f.name, tilst.get(basis(f.name)));
    if (r.error) { toast(r.error, true); continue; }
    for (const k of r.kilder) {
      NABO.kilder = NABO.kilder.filter(x => x.id !== k.id);
      NABO.kilder.push(k); n++; pkt += k.punkter.length;
    }
  }
  if (n) toast(T(`${n} ${n === 1 ? 'enhet' : 'enheter'} lagt til fra EDE · ${pkt} punkter`,
                 `${n} ${n === 1 ? 'device' : 'devices'} added from EDE · ${pkt} points`));
  tegnNabo();
}

/* ------------------------------------------------------ HeaderBTG.ini */
function lesIni(tekst) {
  const seksjoner = [];
  let cur = null;
  for (const l of tekst.split(/\r?\n/)) {
    const s = /^\s*\[(.+)\]\s*$/.exec(l);
    if (s) { cur = {navn: s[1], par: []}; seksjoner.push(cur); continue; }
    const kv = /^([^=;#]+)=(.*)$/.exec(l);
    if (kv && cur) cur.par.push([kv[1].trim(), kv[2]]);
  }
  return seksjoner;
}
function iniVerdi(sek, s, k) {
  const x = sek.find(a => a.navn.toLowerCase() === s.toLowerCase());
  const p = x && x.par.find(([kk]) => kk.toLowerCase() === k.toLowerCase());
  return p ? p[1] : undefined;
}

async function lesIniFil(fil) {
  const tekst = await lesTekst(fil);
  const sek = lesIni(tekst);
  if (!sek.length) { toast(T('Fant ingen innstillinger i fila', 'No settings found in the file'), true); return; }
  const patch = {};
  // Cluster is BTG's Citect cluster. It is kept for the round trip and does
  // not touch the Niagara tags.
  const a = iniVerdi(sek, 'Generator', 'Anleggsnavn'), p = iniVerdi(sek, 'Generator', 'Prefix'),
        c = iniVerdi(sek, 'Generator', 'Cluster');
  if (a !== undefined) patch.anleggsnavn = a.trim();
  if (p !== undefined) patch.prefiks = p.trim();
  if (c !== undefined) patch.cluster = c.trim();
  const eu = {};
  for (const k of Object.keys(EU_STD)) {
    const v = iniVerdi(sek, 'EngineeringUnits', k);
    if (v !== undefined && !isNaN(parseInt(v, 10))) eu[k] = parseInt(v, 10);
  }
  const trend = iniVerdi(sek, 'Trend', 'SamplerPeriode');
  lagreNabo({eu: Object.assign({}, EU_STD, eu), ini: tekst,
             ...(trend && /^\d\d:\d\d:\d\d$/.test(trend.trim()) ? {trend: trend.trim()} : {})});
  if (Object.keys(patch).length) await lagreTagging(patch);
  toast(T(`Innstillinger hentet fra ${fil.name}`, `Settings taken from ${fil.name}`));
  tegnNabo();
}

/* Written back in BTG's own layout and encoding, with every section NABO does
   not know left exactly as it was - KNX, Mapper and the rest stay BTG's. */
function lagIni() {
  const t = tagInnstillinger();
  const o = naboInnst();
  const sek = lesIni(o.ini || '[Generator]\n[Innstillinger]\n[Trend]\n[EngineeringUnits]\n');
  const sett = (s, k, v) => {
    let x = sek.find(a => a.navn.toLowerCase() === s.toLowerCase());
    if (!x) { x = {navn: s, par: []}; sek.push(x); }
    const p = x.par.find(([kk]) => kk.toLowerCase() === k.toLowerCase());
    if (p) p[1] = String(v); else x.par.push([k, String(v)]);
  };
  sett('Generator', 'Anleggsnavn', t.anleggsnavn || '');
  sett('Generator', 'Prefix', t.prefiks || '');
  sett('Generator', 'Cluster', t.cluster || '');
  sett('Trend', 'SamplerPeriode', o.trend);
  for (const [k, v] of Object.entries(o.eu)) sett('EngineeringUnits', k, v);
  const tekst = sek.map(s => `[${s.navn}]\r\n` + s.par.map(([k, v]) => `${k}=${v}`).join('\r\n')).join('\r\n') + '\r\n';
  // BTG reads the file as Windows-1252; æøå and ° are single bytes there.
  const bytes = new Uint8Array(tekst.length);
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst.charCodeAt(i);
    bytes[i] = c < 256 ? c : 63;
  }
  naboLagre('HeaderBTG.ini', bytes, 'text/plain');
  toast(T(`HeaderBTG.ini lagret i ${mappeNavn()}`, `HeaderBTG.ini saved in ${mappeNavn()}`));
}

/* -------------------------------------------------------- where files go
   One queue for every file NABO writes, so several files land in order and
   a download never overtakes a save. */
let LAGRE_KO = Promise.resolve();
function naboLagre(navn, data, type) {
  LAGRE_KO = LAGRE_KO.then(() => lagreEn(navn, data, type)).catch(() => {});
  return LAGRE_KO;
}
async function lagreEn(navn, data, type) {
  /* Downloads too is written by the server, into the real Downloads folder.
     A download from the page is only the fallback: NABE's own window lets
     none through unless told to, and then the file just never appears. */
  if (!NABO.mapperInfo) await hentMapper();
  const mappe = naboInnst().mappe || (NABO.mapperInfo && NABO.mapperInfo.nedlastinger) || '';
  if (!mappe) {
    lastNedBytes(data, navn, type);
    await new Promise(r => setTimeout(r, 350));   // the browser drops downloads fired together
    return;
  }
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  try {
    const d = await api('/api/lagre', {mappe, navn, data: btoa(bin)});
    if (d.status !== 'done') throw new Error(d.error || '?');
    NABO.sistLagret = d.sti;
    visLagret();
  } catch (e) {
    toast(T(`Fikk ikke lagret i mappa (${e.message}). Lastet ned i stedet.`,
            `Could not save in the folder (${e.message}). Downloaded instead.`), true);
    lastNedBytes(data, navn, type);
  }
}
function mappeNavn() {
  const m = naboInnst().mappe;
  if (!m) return T('Nedlastinger', 'Downloads');
  if (NABO.mapperInfo && m === NABO.mapperInfo.btg) return 'BTG-Export';
  return m.split(/[\\/]/).filter(Boolean).pop() || m;
}
function visLagret() {
  const b = $('naboVis');
  if (!b || !NABO.sistLagret) return;
  b.hidden = false;
  b.title = NABO.sistLagret;
}
async function hentMapper() {
  try { NABO.mapperInfo = await (await fetch('/api/mapper')).json(); } catch { NABO.mapperInfo = null; }
  fyllMapper();
}
function fyllMapper() {
  const s = $('naboMappe');
  if (!s) return;
  const o = naboInnst();
  const info = NABO.mapperInfo || {};
  const valg = [['', T('Nedlastinger', 'Downloads'), info.nedlastinger || '']];
  if (info.btg) valg.push([info.btg, 'BTG-Export', info.btg]);
  for (const m of o.mapper) if (m && !valg.some(v => v[0] === m)) valg.push([m, m.split(/[\\/]/).filter(Boolean).pop() || m, m]);
  if (o.mappe && !valg.some(v => v[0] === o.mappe)) valg.push([o.mappe, o.mappe.split(/[\\/]/).pop(), o.mappe]);
  s.innerHTML = valg.map(([v, l, t]) => `<option value="${esc(v)}" title="${esc(t)}">${esc(l)}</option>`).join('')
    + `<option value="__velg">${T('Velg mappe…', 'Choose folder…')}</option>`;
  s.value = o.mappe;
  s.title = o.mappe || info.nedlastinger || '';
}
async function velgMappe() {
  const o = naboInnst();
  const start = o.mappe || (NABO.mapperInfo && NABO.mapperInfo.btg) || '';
  let valgt = null;
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.velg_mappe) {
      valgt = await window.pywebview.api.velg_mappe(start);
    } else {
      toast(T('Velg mappa i dialogen som åpnes', 'Choose the folder in the dialog that opens'));
      const d = await api('/api/velg-mappe', {sti: start});
      valgt = d.mappe;
    }
  } catch { /* closed or not available */ }
  if (valgt) lagreNabo({mappe: valgt, mapper: [valgt, ...o.mapper.filter(m => m !== valgt)].slice(0, 4)});
  fyllMapper();
}

function lastNedBytes(data, navn, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], {type}));
  a.download = navn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* What changed between the file Niagara got and what NABO would write now.
   Devices are paired by the objects they share, not by name: a device that
   was named after the EDE file last time is still the same controller. */
const DIFF_FELT = [[3, ['Tag', 'Tag']], [7, ['Måleenhet', 'Unit']], [8, ['Desimaler', 'Decimals']],
  [9, ['Tilstander', 'States']], [10, ['Beskrivelse', 'Description']], [11, ['Trend', 'Trend']],
  [12, ['Alarmklasse', 'Alarm class']]];

function naboDiff(r) {
  const fasit = NABO.fasit;
  if (!fasit) return null;
  const nokkel = f => `${f[4]}:${f[5]}`;
  const naa = r.rader.map(x => ({x, f: x.linje.split(';')}));
  const gruppe = (liste, dev) => {
    const m = new Map();
    for (const e of liste) { const d = dev(e); if (!m.has(d)) m.set(d, new Map()); m.get(d).set(nokkel(e.f || e), e); }
    return m;
  };
  const filDev = gruppe(fasit.rader, f => f[2]);
  const naaDev = gruppe(naa, e => e.x.enhetNavn);
  const par = new Map();   // NABO device -> file device
  for (const [fd, fm] of filDev) {
    let best = null, n = 0;
    for (const [nd, nm] of naaDev) {
      let k = 0; for (const key of fm.keys()) if (nm.has(key)) k++;
      if (k > n) { n = k; best = nd; }
    }
    if (best && !par.has(best)) par.set(best, fd);
  }
  const ut = {nye: [], endret: [], borte: [], like: 0, omdopt: []};
  const sett = new Set();
  for (const [nd, nm] of naaDev) {
    const fd = par.get(nd);
    if (fd && fd !== nd) ut.omdopt.push([fd, nd]);
    const fm = fd ? filDev.get(fd) : null;
    for (const [key, e] of nm) {
      const gml = fm && fm.get(key);
      if (!gml) { ut.nye.push(e.x); continue; }
      sett.add(fd + '|' + key);
      const diff = DIFF_FELT.filter(([i]) => (gml[i] || '') !== (e.f[i] || ''))
        .map(([i, navn]) => ({navn: T(...navn), fra: gml[i] || '', til: e.f[i] || ''}));
      if (diff.length) ut.endret.push({x: e.x, diff}); else ut.like++;
    }
  }
  for (const [fd, fm] of filDev) for (const [key, f] of fm) if (!sett.has(fd + '|' + key)) ut.borte.push(f);
  return ut;
}

/* ------------------------------------------------------------ export */
function stempel() {
  const n = new Date(), to = x => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${to(n.getMonth() + 1)}-${to(n.getDate())} ${to(n.getHours())}${to(n.getMinutes())}${to(n.getSeconds())}`;
}

function eksporterVariabel(bare) {
  const r = naboResultat();
  if (bare) r.rader = bare;
  const feil = r.rader.filter(x => x.feil.length).length;
  if (!r.rader.length) { toast(T('Ingen punkter å eksportere', 'No points to export'), true); return; }
  /* A file with errors in it is NTI's problem an hour later on site. The
     first click shows what is wrong; a second within a few seconds means
     you have looked and want it anyway. */
  if (feil && !(NABO.bekreft && Date.now() - NABO.bekreft < 6000)) {
    NABO.bekreft = Date.now();
    if (!bare) { NABO.visning = 'var'; NABO.filter = 'adv'; tegnNabo(); }
    const b = $('naboVar');
    if (b && !bare) {
      b.classList.add('fare');
      b.textContent = T(`Eksporter likevel (${feil} med feil)`, `Export anyway (${feil} with errors)`);
      setTimeout(() => {
        const k = $('naboVar');
        if (k) { k.classList.remove('fare'); k.textContent = T('Lag Variabel-fil', 'Make Variabel file'); }
      }, 6000);
    }
    toast(T(`${feil} rader har feil. Se gjennom, eller klikk igjen for å eksportere likevel.`,
            `${feil} rows have errors. Look them over, or click again to export anyway.`), true);
    return;
  }
  NABO.bekreft = 0;
  const b0 = $('naboVar');
  if (b0) { b0.classList.remove('fare'); b0.textContent = T('Lag Variabel-fil', 'Make Variabel file'); }
  const tid = stempel();
  const ren = s => s.replace(/[\\/:*?"<>|]/g, '_');
  const grupper = NABO.perEnhet
    ? [...new Set(r.rader.map(x => x.enhetNavn))].map(e => [e, r.rader.filter(x => x.enhetNavn === e)])
    : [['', r.rader]];
  grupper.forEach(([e, rader]) => {
    const dev = e ? (e.includes('.') ? e.split('.').slice(1).join('.') : e) : '';
    const navn = ren([r.t.prefiks, 'Variabel', r.anlegg, tid, dev, bare ? 'endringer' : ''].filter(Boolean).join(' ') + '.csv');
    naboLagre(navn, '\uFEFF' + rader.map(x => x.linje).join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  });
  toast(T(`Variabel-fil laget: ${r.rader.length} punkter fra ${new Set(r.rader.map(x => x.enhetNavn)).size} enheter`
          + (feil ? ` · ${feil} med feil` : '') + ` → ${mappeNavn()}`,
          `Variabel file made: ${r.rader.length} points from ${new Set(r.rader.map(x => x.enhetNavn)).size} devices`
          + (feil ? ` · ${feil} with errors` : '') + ` → ${mappeNavn()}`), !!feil);
  naboFigur('vink');
  const hus = $('naboHus');
  if (hus) { hus.classList.add('puff'); setTimeout(() => hus.classList.remove('puff'), 1600); }
  const t = new Date().getHours();
  if (t >= 22 || t < 5) {
    // Working late: the lights are on next door.
    [hus, $('naboHusStor')].forEach(x => { if (x) { x.classList.add('lys'); setTimeout(() => x.classList.remove('lys'), 6000); } });
    naboSier(T('Lys i vinduet hos naboen. Legg deg snart.', 'Lights on next door. Go to bed soon.'));
  }
  if (!feil && !loadPrefs().nabo?.forsteFil) { lagreNabo({forsteFil: Date.now()}); naboKonfetti(); }
  if (typeof blikk === 'function') blikk(2.4, 0, 1200);
  if (typeof tell === 'function') tell('nabo');
  if (typeof nabeSier === 'function' && !feil) setTimeout(() => nabeSier(
    T('Naboen har levert. Pent arbeid, egentlig.', 'The neighbour delivered. Decent work, actually.'), 'fornoyd', 'nabo-levert'), 900);
}

/* EDE out for each included device, in the layout NABE's own export uses. */
function eksporterEde() {
  const kilder = NABO.kilder.filter(k => !k.av);
  if (!kilder.length) { toast(T('Ingen enheter valgt', 'No devices selected'), true); return; }
  const f = v => String(v ?? '').replace(/[;\r\n]+/g, ' ').trim();
  const KOL = 16;
  const pad = (felt) => { const u = felt.slice(); while (u.length < KOL) u.push(''); return u.join(';'); };
  const n = new Date(), to = x => String(x).padStart(2, '0');
  const tid = `${to(n.getDate())}.${to(n.getMonth() + 1)}.${n.getFullYear()} ${to(n.getHours())}:${to(n.getMinutes())}`;
  const dato = n.toISOString().slice(0, 10);
  const t = tagInnstillinger();
  const o = naboInnst();
  // With SD codes on, the description is the one in the table, code in front.
  const rader = o.sdBeskr ? new Map(naboResultat().rader.map(x => [x.key, x])) : null;
  const beskrivelse = (k, p) => {
    const x = rader && rader.get(naboKey(k, p));
    return x ? x.beskrSd : p.description;
  };
  let i = 0;
  for (const k of kilder) {
    const st = buildStateTexts(k.punkter);
    const navn = enhetsfelt(k, t).split('.').slice(1).join('.');
    const linjer = [
      pad(['#Engineering-Data-Exchange']), pad(['PROJECT_NAME', f(navn)]),
      pad(['TIMESTAMP_OF_LAST_CHANGE', tid]), pad(['AUTHOR_OF_LAST_CHANGE', 'NABO']),
      pad(['VERSION_OF_LAYOUT', '2.2']),
      ['#mandatory', 'mandatory', 'mandatory', 'mandatory', 'mandatory',
       ...Array.from({length: KOL - 5}, () => 'optional')].join(';'),
      ['# keyname', 'device-object-instance', 'object-name', 'object-type', 'object-instance',
       'description', 'present-value-default', 'min-present-value', 'max-present-value', 'settable',
       'supports COV', 'hi-limit', 'low-limit', 'state-text-reference', 'unit-code',
       'vendor-specific-address'].join(';'),
    ];
    for (const p of k.punkter) {
      linjer.push(pad([`OBJECT_${String(p.type).toUpperCase().replace(/-/g, '_')}:${p.instance}`,
        k.instans ?? '', f(p.name), EDE_OBJ_TYPE[p.type] ?? '', p.instance ?? '', f(beskrivelse(k, p)),
        '', '', '', p.writable ? 'Y' : 'N', '', '', '', st.ref.get(p.objid) ?? '', EDE_UNIT[p.units] ?? '']));
    }
    const basis = `Device${k.instans ?? 'x'}_${dato}`;
    const filer = [[linjer.join('\r\n') + '\r\n', `${basis}_EDE.csv`]];
    if (st.tabell.length) {
      const sl = ['#State Text Reference', '#Reference Number;Text 1 or Inactive-Text;Text 2 or Active-Text'];
      st.tabell.forEach((x, j) => sl.push([j + 1, ...x.map(f)].join(';')));
      filer.push([sl.join('\r\n') + '\r\n', `${basis}_StateTexts.csv`]);
    }
    for (const [tekst, fn] of filer) { naboLagre(fn, tekst, 'text/csv;charset=utf-8'); i++; }
  }
  toast(T(`EDE for ${kilder.length} ${kilder.length === 1 ? 'enhet' : 'enheter'} → ${mappeNavn()}`,
          `EDE for ${kilder.length} ${kilder.length === 1 ? 'device' : 'devices'} → ${mappeNavn()}`));
}

/* ------------------------------------------------------------ the view */
const NABO_SVG = `<svg class="nabo-fig" viewBox="0 0 32 32" aria-hidden="true">
  <path class="nabo-tak" d="M4.4 15.2 14.9 6.5q1.1-.9 2.2 0l10.5 8.7"/>
  <path class="nabo-sno" d="M6.4 13.4 14.9 6.5q1.1-.9 2.2 0l3.6 3"/>
  <g class="nabo-flagg"><path d="M24.6 5.6V.6"/><rect x="24.6" y=".6" width="4.4" height="3"/><path class="kryss" d="M24.6 2.1h4.4M26.1.6v3"/></g>
  <rect class="nabo-hus" x="7" y="13.4" width="18" height="15.6" rx="5.2"/>
  <g class="nabo-oyne"><circle cx="12.5" cy="19.8" r="1.9"/><circle cx="19.5" cy="19.8" r="1.9"/></g>
  <g class="nabo-glimt"><circle cx="13.15" cy="19.1" r=".6"/><circle cx="20.15" cy="19.1" r=".6"/></g>
  <g class="nabo-kinn"><ellipse cx="10.1" cy="23" rx="1.6" ry="1"/><ellipse cx="21.9" cy="23" rx="1.6" ry="1"/></g>
  <path class="nabo-munn" d="M14.7 23.1q1.3 1.2 2.6 0"/>
  <path class="nabo-pipe" d="M21.8 9.8V6.2h2.6v5.8"/>
  <g class="nabo-roeyk"><circle cx="23.1" cy="4" r="1"/><circle cx="24.4" cy="2.2" r=".75"/><circle cx="25.9" cy=".9" r=".55"/></g>
  <text class="nabo-z" x="26" y="4">z</text>
</svg>`;

function naboFigur(k) {
  const f = document.querySelector('#naboOverlay .nabo-fig');
  if (!f) return;
  f.classList.remove(k); void f.getBoundingClientRect(); f.classList.add(k);
  setTimeout(() => f.classList.remove(k), 1400);
}

function aapneNabo() {
  if (typeof closeMenus === 'function') closeMenus();
  // From the Tagging tab in Settings: one dialog at a time.
  if ($('temaOverlay') && !$('temaOverlay').hidden && typeof closeTema === 'function') closeTema();
  NABO.perEnhet = naboInnst().perEnhet;
  oppdaterKilder();
  const ov = $('naboOverlay');
  ov.hidden = false;
  tegnNabo(true);
  setTimeout(() => $(tagInnstillinger().prefiks ? 'naboSok' : 'naboPrefiks')?.focus(), 60);
  // NABE looks over at the neighbour's when you go next door.
  if (typeof blikk === 'function') blikk(2.2, -0.4, 1600);
  if (typeof figur === 'function') figur('hopp', 550);
  if (typeof nabeSier === 'function' && Math.random() < 0.35)
    nabeSier(T('Hils på naboen. Han tagger alt.', 'Say hi to the neighbour. He tags everything.'), 'fornoyd', 'nabo-hei');
}
function lukkNabo() {
  const ov = $('naboOverlay');
  if (!ov || ov.hidden) return;
  ov.hidden = true;
  // And waves when you come back.
  if (typeof nabeKlasse === 'function') setTimeout(() => nabeKlasse('vink', 1100), 180);
}

function tegnNabo(helt) {
  const ov = $('naboOverlay');
  if (!ov || ov.hidden) return;
  const r = naboResultat();
  const {t, o} = r;
  if (helt || !ov.querySelector('.nabo-modal')) {
    ov.innerHTML = `<div class="gs-modal nabo-modal" role="document">
      <header class="nabo-topp">
        <div class="nabo-merke"><span id="naboHusStor" title="NABO">${NABO_SVG}</span><span class="nabo-boble" id="naboBoble"></span><div><div class="nabo-ord">NABO</div>
          <div class="nabo-under">Not Another BACnet Object-namer · ${T('naboen til NABE', 'NABE\u2019s neighbour')}</div></div></div>
        <div class="nabo-gjerde" aria-hidden="true"><button class="nabo-titt" id="naboTitt" title="${T('Tilbake til NABE', 'Back to NABE')}">${NABE_SVG}</button></div>
        <div class="nabo-topp-knapper">
          <button class="gs-close" id="naboLukk">${T('Lukk', 'Close')} ✕</button>
        </div>
      </header>
      <section class="nabo-oppsett">
        <div class="nabo-pref" title="${T('Står i Variabel-fila og filnavnet, og holder rettingene dine samlet per anlegg', 'Goes in the Variabel file and its name, and keeps your edits together per site')}">
          <span>${T('Anlegg', 'Site')} <i>${T('valgfritt', 'optional')}</i></span>
          <div class="nabo-pref-felt bred">
            <input class="field" id="naboAnlegg" autocomplete="off" placeholder="${T('ingen', 'none')}">
            <select class="field" id="naboAnleggMod" title="${T('Om anleggsnavnet skal stå først i taggen', 'Whether the site name goes first in the tag')}">
              <option value="">${T('ikke i taggen', 'not in the tag')}</option>
              <option value="tag">${T('først i taggen', 'first in the tag')}</option>
            </select></div></div>
        <div class="nabo-pref"><span>${T('Prefiks', 'Prefix')} <i>${T('valgfritt', 'optional')}</i></span>
          <div class="nabo-pref-felt">
            <input class="field" id="naboPrefiks" autocomplete="off" spellcheck="false" placeholder="${T('ingen', 'none')}">
            <select class="field" id="naboPrefMod" title="${T('Hvor prefikset brukes, som Format i BTG', 'Where the prefix is used, like Format in BTG')}">
              <option value="device">${T('foran enhetsnavnet', 'before the device')}</option>
              <option value="tag">${T('foran enhetsnavn og tag', 'before device and tag')}</option>
              <option value="btg">${T('BTG-format +PRE=360.001', 'BTG format +PRE=360.001')}</option>
              <option value="ingen">${T('ikke i bruk', 'not used')}</option>
            </select></div></div>
        <label class="kort"><span>${T('Trend hvert', 'Trend every')}</span><input class="field" id="naboTrend" autocomplete="off" spellcheck="false" placeholder="tt:mm:ss"></label>
        <details class="nabo-des"><summary>${T('Avansert', 'Advanced')}</summary>
          <div class="nabo-avansert">
            <label class="kort" title="${T('Citect-cluster fra BTG. Brukes ikke i Niagara-taggene, bare lagret i HeaderBTG.ini.', 'Citect cluster from BTG. Not used in the Niagara tags, only kept in HeaderBTG.ini.')}"><span>Cluster <i>(Citect)</i></span><input class="field" id="naboCluster" autocomplete="off" spellcheck="false"></label>
            <label class="nabo-sd-valg"><span>HeaderBTG.ini</span><span class="nabo-ini">
              <button type="button" class="btn" id="naboIniInn" title="${T('Hent prefiks, anlegg, trend og desimaler fra BTG', 'Take prefix, site, trend and decimals from BTG')}">${T('Hent…', 'Load…')}</button>
              <button type="button" class="btn" id="naboIniUt" title="${T('Lagre innstillingene i BTGs format, så BTG kan bruke dem', 'Save the settings in BTG\u2019s format, for BTG to use')}">${T('Lagre', 'Save')}</button></span></label>
            <label class="nabo-sd-valg"><span>${T('Normalisering', 'Normalisation')}</span>
              <button type="button" class="btn" id="naboNormKnapp" title="${T('BTGs regex, mal og TC2-koder. Trengs sjelden: punktum hele veien og unntakene dekker det meste.', 'BTG\u2019s regex, template and TC2 codes. Rarely needed: dots all the way and the exceptions cover most.')}">${T('Åpne normalisering…', 'Open normalisation…')}</button></label>
          </div>
          <div class="nabo-des-tittel">${T('Desimaler', 'Decimals')}</div>
          <div class="nabo-des-grid"></div></details>
        <div class="nabo-eks"><span>${T('Slik blir det', 'What it becomes')}</span><code id="naboEks"></code></div>
      </section>
      <div class="nabo-kropp">
        <aside class="nabo-kilder">
          <div class="nabo-h">${T('Enheter', 'Devices')} <span id="naboAntK"></span></div>
          <div class="nabo-kliste" id="naboKliste"></div>
          <label class="nabo-slipp" id="naboSlipp" tabindex="0">
            <input type="file" id="naboFil" accept=".csv,.txt,.ini" multiple hidden>
            <b>${T('Legg til EDE-filer', 'Add EDE files')}</b>
            <span>${T('eller slipp dem her, gjerne med _StateTexts og HeaderBTG.ini', 'or drop them here, with _StateTexts and HeaderBTG.ini if you have them')}</span>
          </label>
        </aside>
        <main class="nabo-forh">
          <div class="nabo-verktoy">
            <div class="nabo-visning" role="tablist">
              ${[['var', T('Variabler', 'Variables')], ['diff', T('Sammenlign', 'Compare')]]
                .map(([k, l]) => `<button data-v="${k}" role="tab">${l}</button>`).join('')}
            </div>
            <input class="field" id="naboSok" type="search" placeholder="${T('Søk i tag, navn eller beskrivelse', 'Search tag, name or description')}" autocomplete="off" spellcheck="false">
            <div class="nabo-filter" role="tablist">
              ${[['alle', T('Alle', 'All')], ['adv', T('Feil og advarsler', 'Problems')], ['rettet', T('Rettet', 'Edited')], ['alarm', 'Alarm'], ['trend', 'Trend']]
                .map(([k, l]) => `<button data-f="${k}" role="tab">${l}<em></em></button>`).join('')}
            </div>
            <button class="btn" id="naboErstattKnapp" title="${T('Søk og erstatt i tagger eller beskrivelser (Ctrl+H)', 'Find and replace in tags or descriptions (Ctrl+H)')}">${T('Erstatt…', 'Replace…')}</button>
          </div>
          <div class="nabo-erstatt" id="naboErstatt" hidden>
            <select class="field" id="naboErFelt"><option value="sti">Tag</option><option value="beskr">${T('Beskrivelse', 'Description')}</option></select>
            <input class="field" id="naboErFinn" placeholder="${T('Finn', 'Find')}" spellcheck="false" autocomplete="off">
            <span class="nabo-pil">→</span>
            <input class="field" id="naboErMed" placeholder="${T('Erstatt med', 'Replace with')}" spellcheck="false" autocomplete="off">
            <div class="nabo-er-raske">
              <button type="button" data-fra="_" data-til=".">_ → .</button>
              <button type="button" data-fra="." data-til="_">. → _</button>
            </div>
            <label><input type="checkbox" id="naboErRe"> Regex</label>
            <label><input type="checkbox" id="naboErViste" checked> ${T('Bare viste rader', 'Only rows shown')}</label>
            <span class="nabo-er-tall" id="naboErTall"></span>
            <button class="btn primary" id="naboErBruk">${T('Bruk', 'Apply')}</button>
            <button class="btn" id="naboErAngre" hidden>${T('Angre', 'Undo')}</button>
            <button class="nabo-x" id="naboErLukk" title="${T('Lukk', 'Close')}" aria-label="${T('Lukk', 'Close')}">✕</button>
          </div>
          <div class="nabo-globalt" id="naboGlobalt"></div>
          <div class="nabo-markert" id="naboMarkert" hidden>
            <span class="nabo-mark-tall" id="naboMarkTall"></span>
            <button class="btn" id="naboHale" title="${T('Slå sammen de to siste leddene med understrek, f.eks. SYSTEM.OU001.HB_KV', 'Join the last two parts with an underscore, e.g. SYSTEM.OU001.HB_KV')}">${T('Siste med understrek', 'Last with underscore')}</button>
            <button class="btn" id="naboPunktum" title="${T('Tilbake til standard: punktum mellom alle leddene', 'Back to the standard: dots between all parts')}">${T('Punktum hele veien', 'Dots all the way')}</button>
            <span class="nabo-mark-skille">${T('marker også', 'also select')}</span>
            <button class="btn" id="naboLike" title="${T('Alle punkter med samme navnemønster, f.eks. alle *_HB_KV', 'Every point with the same name pattern, e.g. every *_HB_KV')}">${T('samme navnemønster', 'same name pattern')}</button>
            <button class="btn" id="naboType" title="${T('Alle punkter av samme punkttype', 'Every point of the same point type')}">${T('samme type', 'same type')}</button>
            <button class="nabo-x" id="naboMarkLukk" title="${T('Fjern markeringen', 'Clear the selection')}" aria-label="${T('Fjern markeringen', 'Clear the selection')}">✕</button>
          </div>
          <div class="nabo-tabell" id="naboTabell"></div>
        </main>
      </div>
      <footer class="nabo-fot">
        <div class="nabo-sum" id="naboSum"></div>
        <label class="nabo-mappe"><span>${T('Lagre i', 'Save in')}</span><select class="field" id="naboMappe"></select></label>
        <button class="nabo-vis" id="naboVis" hidden>${T('Åpne mappa', 'Open folder')}</button>
        <label class="nabo-per" title="${T('Gjelder Variabel-fila. EDE lagres alltid én per enhet.', 'Applies to the Variabel file. EDE is always one per device.')}"><input type="checkbox" id="naboPer"> ${T('Én fil per enhet', 'One file per device')}</label>
        <button class="btn" id="naboEde">${T('Lagre EDE-filer', 'Save EDE files')}</button>
        <button class="btn primary" id="naboVar">${T('Lag Variabel-fil', 'Make Variabel file')}</button>
      </footer>
    </div>`;
    koblNabo(ov);
  }
  const sett = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  sett('naboAnlegg', t.anleggsnavn || ''); sett('naboPrefiks', t.prefiks || '');
  sett('naboCluster', t.cluster || ''); sett('naboTrend', o.trend); sett('naboPrefMod', o.prefMod);
  $('naboPrefMod').disabled = !t.prefiks;
  sett('naboAnleggMod', o.foranAnlegg ? 'tag' : '');
  $('naboAnleggMod').disabled = !(t.anleggsnavn || '').trim();
  $('naboPer').checked = NABO.perEnhet;

  const grid = ov.querySelector('.nabo-des-grid');
  if (grid && !grid.childElementCount) {
    grid.innerHTML = Object.keys(EU_STD).map(k => `<label><span>${esc(T(...EU_NAVN[k]))}</span>
      <input class="field" type="number" min="0" max="6" data-eu="${k}"></label>`).join('');
  }
  grid?.querySelectorAll('[data-eu]').forEach(i => { if (document.activeElement !== i) i.value = o.eu[i.dataset.eu]; });

  // One ordinary point and one SYSTEM point, so both halves of the tree show.
  const topp = naboTopp(t, o);
  const vanlig = r.rader.find(x => !x.system);
  const system = r.rader.find(x => x.system);
  const pre = o.prefMod === 'btg' && t.prefiks ? `+${t.prefiks}=` : '';
  const dev = (vanlig || system || {}).enhetNavn || ((o.prefMod !== 'ingen' && t.prefiks ? t.prefiks + '.' : '') + 'OU001');
  const tt = x => (topp ? topp + '.' : '') + x;
  $('naboEks').innerHTML = `<b>${esc(dev)}</b><span>${esc(vanlig ? vanlig.sti : tt(pre + 'VMS.639.001.RR001'))}</span>`
    + `<span>${esc(system ? system.sti : tt('SYSTEM.OU001.HB.KV'))}</span>`;
  $('naboEks').title = T('Device · et vanlig punkt · et SYSTEM-punkt', 'Device · an ordinary point · a SYSTEM point');

  // Devices
  const perKilde = new Map();
  for (const x of r.rader) {
    const a = perKilde.get(x.kilde) || {n: 0, feil: 0, adv: 0};
    a.n++; if (x.feil.length) a.feil++; else if (x.adv.length) a.adv++;
    perKilde.set(x.kilde, a);
  }
  $('naboAntK').textContent = NABO.kilder.length;
  $('naboKliste').innerHTML = NABO.kilder.length ? NABO.kilder.map(k => {
    const a = perKilde.get(k) || {n: 0, feil: 0, adv: 0};
    const navn = naboInnst().navn[devNokkel(k)] ?? k.auto;
    return `<div class="nabo-k${k.av ? ' av' : ''}" data-id="${esc(k.id)}">
      <input type="checkbox" class="nabo-k-med" ${k.av ? '' : 'checked'} title="${T('Ta med', 'Include')}">
      <div class="nabo-k-tekst">
        <input class="nabo-k-navn" value="${esc(navn)}" spellcheck="false" title="${T('Navnet enheten har i Niagara. Prefikset settes foran.', 'The device\u2019s name in Niagara. The prefix goes in front.')}">
        <div class="nabo-k-meta"><span class="nabo-kilde-${k.type}">${k.type === 'ede' ? 'EDE' : T('Anlegg', 'Live')}</span>${
          k.usikker && !(naboInnst().navn[devNokkel(k)]) ? `<span class="nabo-sjekk">${T('sjekk navnet', 'check the name')}</span>` : ''}
          ${esc(k.type === 'ede' ? k.fil : k.fil)}${k.instans != null && k.instans !== '' ? ` · #${esc(k.instans)}` : ''}</div>
      </div>
      <div class="nabo-k-tall"><b>${k.av ? k.punkter.length : a.n}</b>${a.feil ? `<i class="f">${a.feil}</i>` : a.adv ? `<i class="a">${a.adv}</i>` : ''}</div>
      ${k.type === 'ede' ? `<button class="nabo-k-fjern" title="${T('Fjern', 'Remove')}">✕</button>` : ''}
    </div>`;
  }).join('') : `<div class="nabo-tom">${T('Ingen enheter ennå.', 'No devices yet.')}</div>`;

  // Rows
  const q = NABO.sok.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const passer = x => (NABO.filter === 'alle' || (NABO.filter === 'adv' && (x.feil.length || x.adv.length))
    || (NABO.filter === 'rettet' && Object.keys(x.rett).length)
    || (NABO.filter === 'alarm' && x.klasse) || (NABO.filter === 'trend' && x.trend))
    && q.every(w => (x.sti + ' ' + x.navn + ' ' + x.beskr + ' ' + x.enhetNavn).toLowerCase().includes(w));
  const vis = r.rader.filter(passer);
  const tall = {alle: r.rader.length, adv: r.rader.filter(x => x.feil.length || x.adv.length).length,
                rettet: r.rader.filter(x => Object.keys(x.rett).length).length,
                alarm: r.rader.filter(x => x.klasse).length, trend: r.rader.filter(x => x.trend).length};
  ov.querySelectorAll('.nabo-visning button').forEach(b => b.classList.toggle('sel', b.dataset.v === NABO.visning));
  ov.querySelector('.nabo-verktoy').hidden = !NABO.kilder.length;
  ov.querySelector('.nabo-kropp').classList.toggle('tom', !NABO.kilder.length);
  ov.querySelector('.nabo-slipp').hidden = !NABO.kilder.length;
  ov.querySelector('.nabo-filter').hidden = NABO.visning !== 'var';
  $('naboErstattKnapp').hidden = NABO.visning !== 'var';
  $('naboErstatt').hidden = NABO.visning !== 'var' || !NABO.erstatt;
  $('naboSok').hidden = NABO.visning === 'norm';
  ov.querySelectorAll('.nabo-filter button').forEach(b => {
    b.classList.toggle('sel', b.dataset.f === NABO.filter);
    b.querySelector('em').textContent = tall[b.dataset.f];
  });
  for (const k of [...NABO.valgt]) if (!r.rader.some(x => x.key === k)) NABO.valgt.delete(k);
  const nValgt = NABO.valgt.size;
  $('naboMarkert').hidden = NABO.visning !== 'var' || !nValgt;
  $('naboMarkTall').innerHTML = T(`<b>${nValgt}</b> markert`, `<b>${nValgt}</b> ticked`);
  $('naboGlobalt').innerHTML = r.globalt.map(g => `<span>${esc(g)}</span>`).join('');
  $('naboGlobalt').hidden = !r.globalt.length;
  const MAKS = 1500;
  if (NABO.visning === 'diff') tegnDiff(r, q);
  else if (NABO.visning === 'norm') tegnNorm(r);
  else {
    NABO.vist = vis.map(x => x.key);
    const er = NABO.erstatt;
    let forslag = 0;
    const celle = (x, felt, cls, tekst, foran = '') => {
      const egen = x.rett[felt] !== undefined || (felt === 'sti' && x.hale);
      const ny = er && er.felt === felt ? erstattVerdi(x[felt], er) : null;
      if (ny !== null) forslag++;
      const somTag = v => felt === 'sti' ? esc(v).replace(/\./g, '.<wbr>') : esc(v);
      const innhold = foran + (ny !== null ? `<span class="gml">${somTag(tekst)}</span><span class="ny">${somTag(ny)}</span>` : somTag(tekst));
      return `<td class="${cls}${egen ? ' egen' : ''}" data-felt="${felt}" data-k="${esc(x.key)}"
        title="${egen ? esc(T('Rettet for hånd. Automatisk: ', 'Edited by hand. Automatic: ') + (felt === 'sti' ? x.stiRen : x.auto[felt])) : T('Klikk for å rette', 'Click to edit')}">${innhold}</td>`;
    };
    $('naboTabell').innerHTML = r.rader.length ? `<table class="nabo-rettbar">
    <thead><tr><th class="velg"><input type="checkbox" id="naboVelgAlle" title="${T('Marker alle viste rader (Shift-klikk en rad markerer alt mellom)', 'Select every row shown (Shift-click a row selects everything between)')}"${vis.length && vis.every(x => NABO.valgt.has(x.key)) ? ' checked' : ''}></th><th>Tag</th><th>${T('Navn i anlegget', 'Name in the plant')}</th><th>${T('Type', 'Type')}</th><th class="h">Inst</th><th>${T('Måleenhet', 'Unit')}</th>
      <th class="h" title="${T('Desimaler', 'Decimals')}">Des</th><th>Trend</th><th>Alarm</th><th>${T('Beskrivelse', 'Description')}</th><th></th></tr></thead>
    <tbody>${vis.slice(0, MAKS).map((x, i, a) => {
      // A heading where the device changes: the device field is said once,
      // not on every row, and clicking it ticks the whole device.
      const hode = i === 0 || a[i - 1].enhetNavn !== x.enhetNavn
        ? `<tr class="nabo-gruppe"><td colspan="12"><button class="nabo-gruppe-knapp" data-dev="${esc(x.enhetNavn)}"
            title="${T('Marker alle punktene på denne enheten', 'Tick every point on this device')}"><b>${esc(x.enhetNavn)}</b>
            <span>${vis.filter(y => y.enhetNavn === x.enhetNavn).length} ${T('variabler', 'variables')}</span></button></td></tr>` : '';
      const merk = x.feil.length ? 'feil' : x.adv.length ? 'adv' : '';
      const hvorfor = [...x.feil, ...x.adv].join(' · ');
      const rettet = Object.keys(x.rett).length;
      const valgt = NABO.valgt.has(x.key);
      return hode + `<tr class="${merk}${rettet ? ' rettet' : ''}${valgt ? ' valgt' : ''}">
        <td class="velg"><input type="checkbox" class="nabo-velg" data-k="${esc(x.key)}"${valgt ? ' checked' : ''}></td>
        ${celle(x, 'sti', 't', x.sti, x.system ? '<span class="nabo-sys">SYSTEM</span>' : '')}
        <td class="n sel-c" data-k="${esc(x.key)}" title="${esc(x.navn)}">${esc(x.navn)}</td>
        <td class="sel-c" data-k="${esc(x.key)}"><span class="type-tag">${esc(x.typeNavn)}</span></td><td class="h sel-c" data-k="${esc(x.key)}">${esc(x.inst)}</td>
        ${x.type <= 2 ? celle(x, 'enhet', 'u', x.enhet === 'null' ? '' : x.enhet) : '<td></td>'}
        ${x.type <= 2 ? celle(x, 'des', 'h', String(x.des)) : '<td></td>'}
        <td class="bryter${x.rett.trend !== undefined ? ' egen' : ''}" data-bryter="trend" data-k="${esc(x.key)}" title="${T('Klikk for å slå trend av eller på', 'Click to switch trend on or off')}">${x.trend ? '<span class="nabo-prikk tr"></span>' : '<span class="nabo-av"></span>'}</td>
        <td class="bryter${x.rett.klasse !== undefined ? ' egen' : ''}" data-bryter="klasse" data-k="${esc(x.key)}" title="${T('Klikk for å bytte alarmklasse: ingen, 1, 2, 3', 'Click to change the alarm class: none, 1, 2, 3')}">${x.klasse ? `<span class="nabo-kl">${x.klasse}</span>` : '<span class="nabo-av"></span>'}</td>
        ${celle(x, 'beskr', 'b', x.beskr, o.sdBeskr ? `<span class="nabo-sd">${x.sdKode}</span>` : '').replace('</td>', `${hvorfor ? `<span class="nabo-hvorfor">${esc(hvorfor)}</span>` : ''}</td>`)}
        <td class="nabo-angre-c">${rettet ? `<button class="nabo-angre" data-k="${esc(x.key)}" title="${T('Tilbake til det automatiske', 'Back to the automatic value')}">↺</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>${vis.length > MAKS ? `<div class="nabo-mer">${T(`Viser ${MAKS} av ${vis.length}. Søk for å snevre inn.`, `Showing ${MAKS} of ${vis.length}. Search to narrow it down.`)}</div>` : ''}
    ${!vis.length ? `<div class="nabo-tom">${T('Ingen rader passer.', 'No rows match.')}</div>` : ''}`
    : `<label class="nabo-start" tabindex="0">${NABO_SVG}
        <b>${T('Slipp EDE-filene her', 'Drop the EDE files here')}</b>
        <span>${T('eller', 'or')} <u>${T('velg filer', 'choose files')}</u> · ${T('_StateTexts og HeaderBTG.ini kan være med', '_StateTexts and HeaderBTG.ini may come along')}</span>
        <small>${T('Enheter du har åpnet i NABE kommer med av seg selv.', 'Devices you have opened in NABE come along by themselves.')}</small>
        <input type="file" class="nabo-start-fil" accept=".csv,.txt,.ini" multiple hidden></label>`;
    if (er) {
      const alle = er.bareViste ? vis : r.rader;
      const n = alle.filter(x => erstattVerdi(x[er.felt], er) !== null).length;
      $('naboErTall').textContent = er.feil ? er.feil : T(`${n} ${n === 1 ? 'endres' : 'endres'}`, `${n} will change`);
      $('naboErBruk').disabled = !n;
    }
  }

  const feil = r.rader.filter(x => x.feil.length).length;
  const enh = new Set(r.rader.map(x => x.enhetNavn)).size;
  $('naboSum').innerHTML = `<b>${r.rader.length}</b> ${T('variabler', 'variables')} · <b>${enh}</b> ${T(enh === 1 ? 'enhet' : 'enheter', enh === 1 ? 'device' : 'devices')}`
    + (feil ? ` · <span class="f">${feil} ${T('med feil', 'with errors')}</span>` : '')
    + (r.hoppet ? ` · <span title="${T('Kalendere, ukeplaner, trendlogger og andre typer blir ikke variabler', 'Calendars, schedules, trend logs and other types do not become variables')}">${r.hoppet} ${T('hoppet over', 'skipped')}</span>` : '');
  $('naboVar').disabled = !r.rader.length;
  $('naboEde').disabled = !NABO.kilder.some(k => !k.av);
}

function tegnDiff(r, q) {
  const el = $('naboTabell');
  if (!NABO.fasit) {
    el.innerHTML = `<div class="nabo-tom stor">${NABO_SVG}<div>${T(
      'Les inn Variabel-fila Niagara fikk sist, så viser NABO hva som er nytt, endret og borte siden da.',
      'Read in the Variabel file Niagara got last time, and NABO shows what is new, changed and gone since.')}</div>
      <button class="btn" id="naboFasitVelg">${T('Velg Variabel-fil', 'Choose Variabel file')}</button></div>`;
    $('naboFasitVelg').onclick = velgFasit;
    return;
  }
  const d = naboDiff(r);
  const treff = s => !q.length || q.every(w => s.toLowerCase().includes(w));
  const endret = d.endret.filter(e => treff(e.x.sti + ' ' + e.x.beskr + ' ' + e.x.enhetNavn));
  const nye = d.nye.filter(x => treff(x.sti + ' ' + x.beskr + ' ' + x.enhetNavn));
  const borte = d.borte.filter(f => treff(f[3] + ' ' + f[10] + ' ' + f[2]));
  const vis = (s, n) => s.length > n ? s.slice(0, n) : s;
  el.innerHTML = `<div class="nabo-diff">
    <div class="nabo-diff-hode">
      <div><span class="nabo-diff-fil">${esc(NABO.fasit.fil)}</span>
        <span class="nabo-diff-tall"><b class="ny">${d.nye.length}</b> ${T('nye', 'new')}
          · <b class="endr">${d.endret.length}</b> ${T('endret', 'changed')}
          · <b class="borte">${d.borte.length}</b> ${T('borte', 'gone')}
          · <b>${d.like}</b> ${T('like', 'unchanged')}</span></div>
      <button class="btn" id="naboFasitVelg">${T('Annen fil', 'Another file')}</button>
      <button class="btn" id="naboBareEndr" ${d.nye.length + d.endret.length ? '' : 'disabled'}
        title="${T('Bare radene NTI må importere på nytt', 'Only the rows NTI needs to import again')}">${T('Fil med bare nye og endrede', 'File with only new and changed')}</button>
    </div>
    ${d.omdopt.length ? `<div class="nabo-diff-omdopt">${d.omdopt.map(([a, b]) =>
      `<span>${T('Enhetsnavn', 'Device name')} <s>${esc(a)}</s> → <b>${esc(b)}</b></span>`).join('')}</div>` : ''}
    ${endret.length ? `<div class="nabo-diff-sek"><div class="nabo-diff-h endr">${T('Endret', 'Changed')} <em>${endret.length}</em></div>
      ${vis(endret, 400).map(e => `<div class="nabo-diff-rad"><code>${esc(e.x.sti)}</code><span class="d">${esc(e.x.enhetNavn)}</span>
        <div class="nabo-diff-felt">${e.diff.map(x => `<span><i>${esc(x.navn)}</i> <s>${esc(x.fra) || '–'}</s> → <b>${esc(x.til) || '–'}</b></span>`).join('')}</div></div>`).join('')}</div>` : ''}
    ${nye.length ? `<div class="nabo-diff-sek"><div class="nabo-diff-h ny">${T('Nye', 'New')} <em>${nye.length}</em></div>
      ${vis(nye, 400).map(x => `<div class="nabo-diff-rad"><code>${esc(x.sti)}</code><span class="d">${esc(x.enhetNavn)}</span><span class="b">${esc(x.beskr)}</span></div>`).join('')}</div>` : ''}
    ${borte.length ? `<div class="nabo-diff-sek"><div class="nabo-diff-h borte">${T('Borte', 'Gone')} <em>${borte.length}</em></div>
      ${vis(borte, 400).map(f => `<div class="nabo-diff-rad"><code>${esc(f[3])}</code><span class="d">${esc(f[2])}</span><span class="b">${esc(f[10])}</span></div>`).join('')}</div>` : ''}
    ${!d.nye.length && !d.endret.length && !d.borte.length ? `<div class="nabo-tom">${T('Ingen forskjeller. Niagara har det samme som NABO ville skrevet.', 'No differences. Niagara has what NABO would write.')}</div>` : ''}
  </div>`;
  $('naboFasitVelg').onclick = velgFasit;
  $('naboBareEndr').onclick = () => eksporterVariabel([...d.nye, ...d.endret.map(e => e.x)]);
}

function velgFasit() {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.csv';
  i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    const v = lesVariabel(await lesTekst(f), f.name);
    if (!v) { toast(T('Fant ingen Variabel-rader i fila', 'No Variabel rows found in the file'), true); return; }
    NABO.fasit = v; NABO.visning = 'diff'; tegnNabo();
  };
  i.click();
}

function tegnNorm(r) {
  const el = $('naboTabell');
  const o = r.o;
  if (!el.querySelector('.nabo-norm')) {
    el.innerHTML = `<div class="nabo-norm">
      <div class="nabo-norm-oppsett">
        <button type="button" class="btn nabo-tilbake" id="naboNormTilbake">← ${T('Variabler', 'Variables')}</button>
        <label class="nabo-bryter"><input type="checkbox" id="naboNormPaa"> <b>${T('Bruk normalisering', 'Use normalisation')}</b>
          <span>${T('Stien bygges fra regex-gruppene i stedet for å deles på _ og .', 'The path is built from the regex groups instead of splitting on _ and .')}</span></label>
        <label><span>Regex</span><textarea class="field" id="naboNormRe" rows="3" spellcheck="false"></textarea>
          <small id="naboNormFeil"></small></label>
        <label><span>${T('Mal for stien', 'Path template')}</span><input class="field" id="naboNormMal" spellcheck="false">
          <small>{lokasjon} {hoved} {under} {subdir} {komponent} {funksjonskode}</small></label>
        <label><span>${T('Funksjonskoder, NM = TC2, TC2 …', 'Function codes, NM = TC2, TC2 …')}</span>
          <textarea class="field" id="naboNormKoder" rows="7" spellcheck="false"></textarea></label>
        <button class="btn" id="naboNormStd">${T('Tilbake til BTG-standard', 'Back to BTG default')}</button>
      </div>
      <div class="nabo-norm-test" id="naboNormTest"></div>
    </div>`;
    const lagre = () => {
      lagreNabo({norm: {paa: $('naboNormPaa').checked, regex: $('naboNormRe').value,
                        mal: $('naboNormMal').value, koder: $('naboNormKoder').value}});
      tegnNabo();
    };
    let tid;
    const senere = () => { clearTimeout(tid); tid = setTimeout(lagre, 250); };
    $('naboNormPaa').onchange = lagre;
    $('naboNormTilbake').onclick = () => { NABO.visning = 'var'; tegnNabo(); };
    ['naboNormRe', 'naboNormMal', 'naboNormKoder'].forEach(id => $(id).addEventListener('input', senere));
    $('naboNormStd').onclick = () => { lagreNabo({norm: Object.assign({}, NORM_STD, {paa: naboInnst().norm.paa})}); el.innerHTML = ''; tegnNabo(); };
    $('naboNormPaa').checked = o.norm.paa;
    $('naboNormRe').value = o.norm.regex;
    $('naboNormMal').value = o.norm.mal;
    $('naboNormKoder').value = o.norm.koder;
  }
  const c = normOppsett(o);
  $('naboNormFeil').textContent = c.feil ? T('Feil: ', 'Error: ') + c.feil : '';
  const navn = [...new Set(NABO.kilder.filter(k => !k.av).flatMap(k => k.punkter.map(p => p.name).filter(Boolean)))];
  const prov = navn.map(n => ({n, r: normaliser(n, o)}));
  const ok = prov.filter(x => x.r), ikke = prov.filter(x => !x.r);
  const GR = ['lokasjon', 'hoved', 'under', 'subdir', 'komponent', 'funksjonskode'];
  $('naboNormTest').innerHTML = !navn.length
    ? `<div class="nabo-tom">${T('Legg til enheter for å prøve regexen på ekte navn.', 'Add devices to try the regex on real names.')}</div>`
    : `<div class="nabo-norm-sum"><b>${ok.length}</b> ${T('av', 'of')} ${navn.length} ${T('navn passer', 'names fit')}${
        o.norm.paa ? '' : ` · <span>${T('ikke i bruk ennå', 'not in use yet')}</span>`}</div>
      <table><thead><tr><th>${T('Navn', 'Name')}</th>${GR.map(g => `<th>${g}</th>`).join('')}<th>${T('Blir', 'Becomes')}</th></tr></thead>
      <tbody>${ok.slice(0, 200).map(x => `<tr><td class="t">${esc(x.n)}</td>${GR.map(g => `<td>${esc(x.r.g[g] ?? '')}</td>`).join('')}<td class="t blir">${esc(x.r.sti)}</td></tr>`).join('')}</tbody></table>
      ${ikke.length ? `<div class="nabo-diff-h borte">${T('Passer ikke', 'Does not fit')} <em>${ikke.length}</em></div>
        <div class="nabo-norm-ikke">${ikke.slice(0, 120).map(x => `<code>${esc(x.n)}</code>`).join('')}</div>` : ''}`;
}

/* ------------------------------------------------------- hand edits
   What used to be a round trip through Excel: click a tag, a description, a
   unit or the decimals and type; click trend or alarm to switch it. Tab moves
   down the column, as in a spreadsheet. An edit back to the automatic value
   removes itself, so "edited" always means different. */
function settRett(endringer) {
  const alle = Object.assign({}, naboInnst().rett);
  for (const [key, felt, verdi] of endringer) {
    const x = Object.assign({}, alle[key] || {});
    if (verdi === undefined) delete x[felt]; else x[felt] = verdi;
    if (Object.keys(x).length) alle[key] = x; else delete alle[key];
  }
  lagreAnlegg({rett: alle});
}

function radFor(key) { return naboResultat().rader.find(x => x.key === key); }

function rettCelle(td) {
  const key = td.dataset.k, felt = td.dataset.felt;
  const x = radFor(key);
  if (!x) return;
  const gammel = felt === 'enhet' && x.enhet === 'null' ? '' : String(x[felt] ?? '');
  const inn = document.createElement('input');
  inn.className = 'nabo-rett-inn';
  inn.value = gammel;
  inn.spellcheck = false;
  if (felt === 'des') { inn.type = 'number'; inn.min = 0; inn.max = 6; }
  td.textContent = '';
  td.appendChild(inn);
  inn.focus(); inn.select();
  let ferdig = false;
  const lagre = (flytt) => {
    if (ferdig) return; ferdig = true;
    let v = inn.value.trim();
    if (felt === 'des') v = Math.max(0, Math.min(6, parseInt(v, 10) || 0));
    if (felt === 'enhet' && v === '') v = 'null';
    const auto = x.auto[felt];
    const sd = felt === 'beskr' ? btgSd(v) : null;
    if (sd && sd.rest !== v) {
      // A code typed into the description is an order for Alarm and Trend,
      // and the text keeps only the words - so it is never written twice.
      v = sd.rest;
      settRett([[key, 'beskr', v === String(auto) ? undefined : v],
                [key, 'klasse', sd.klasse === (x.auto.klasse || 0) ? undefined : sd.klasse],
                [key, 'trend', sd.trend === !!x.auto.trend ? undefined : sd.trend]]);
    } else settRett([[key, felt, String(v) === String(auto) ? undefined : v]]);
    tegnNabo();
    if (flytt) {
      const i = NABO.vist.indexOf(key) + flytt;
      const neste = NABO.vist[i];
      const c = neste && document.querySelector(`#naboTabell td[data-felt="${felt}"][data-k="${CSS.escape(neste)}"]`);
      if (c) { c.scrollIntoView({block: 'nearest'}); rettCelle(c); }
    }
  };
  inn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lagre(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Tab') { e.preventDefault(); lagre(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ferdig = true; tegnNabo(); }
  });
  inn.addEventListener('blur', () => lagre(0));
}

function byttBryter(td) {
  const key = td.dataset.k, hva = td.dataset.bryter;
  const x = radFor(key);
  if (!x) return;
  if (hva === 'trend') {
    const ny = !x.trend;
    settRett([[key, 'trend', ny === !!x.auto.trend ? undefined : ny]]);
  } else {
    const ny = ((x.klasse || 0) + 1) % 4;
    settRett([[key, 'klasse', ny === (x.auto.klasse || 0) ? undefined : ny]]);
  }
  tegnNabo();
}

/* ------------------------------------------------------- ticked rows
   Dots all the way is the rule; the points that need an underscore at the
   end are ticked - one by one, Shift for a range, or every point that ends
   the same way - and set in one go. */
function velgRad(key, paa, omraade) {
  const vist = NABO.vist || [];
  const keys = omraade && NABO.sistValgt && vist.includes(NABO.sistValgt)
    ? (() => { const a = vist.indexOf(NABO.sistValgt), b = vist.indexOf(key);
               return vist.slice(Math.min(a, b), Math.max(a, b) + 1); })()
    : [key];
  keys.forEach(k => paa ? NABO.valgt.add(k) : NABO.valgt.delete(k));
  NABO.sistValgt = key;
  tegnNabo();
}

/* Click a row as in Explorer: a click picks that one, Ctrl adds or removes,
   Shift takes everything from the last one. */
function klikkRad(key, e) {
  if (e.shiftKey) { velgRad(key, true, true); return; }
  if (e.ctrlKey || e.metaKey) { velgRad(key, !NABO.valgt.has(key), false); return; }
  const bare = NABO.valgt.size === 1 && NABO.valgt.has(key);
  NABO.valgt.clear();
  if (!bare) NABO.valgt.add(key);
  NABO.sistValgt = key;
  tegnNabo();
}

/* The name pattern of a point: its last two parts, as *_HB_KV. Points that
   share it are the ones that want the same treatment. */
function navnMonster(x) {
  const biter = String(x.navn || '').split(/[_.\-\s]+/).filter(Boolean);
  return biter.length >= 3 ? biter.slice(-2).join('_').toLowerCase() : null;
}
function velgLike() {
  const rader = naboResultat().rader;
  const monstre = new Set(rader.filter(x => NABO.valgt.has(x.key)).map(navnMonster).filter(Boolean));
  const for_ = NABO.valgt.size;
  rader.forEach(x => { if (monstre.has(navnMonster(x))) NABO.valgt.add(x.key); });
  const ny = NABO.valgt.size - for_;
  const vis = [...monstre].slice(0, 3).map(m => '*_' + m.toUpperCase()).join(', ');
  toast(ny ? T(`${ny} til markert (${vis})`, `${ny} more ticked (${vis})`) : T('Ingen andre har samme navnemønster', 'No others share the name pattern'));
  tegnNabo();
}
function velgSammeType() {
  const rader = naboResultat().rader;
  const typer = new Set(rader.filter(x => NABO.valgt.has(x.key)).map(x => x.type));
  const for_ = NABO.valgt.size;
  rader.forEach(x => { if (typer.has(x.type)) NABO.valgt.add(x.key); });
  const ny = NABO.valgt.size - for_;
  toast(ny ? T(`${ny} til markert`, `${ny} more ticked`) : T('Ingen andre av samme type', 'No others of the same type'));
  tegnNabo();
}

function settHale(paa) {
  const keys = [...NABO.valgt];
  if (!keys.length) return;
  // A hand-written tag would hide the change, so it goes back to automatic.
  settRett(keys.flatMap(k => [[k, 'hale', paa ? true : undefined], [k, 'sti', undefined]]));
  toast(paa ? T(`${keys.length} med understrek i siste ledd`, `${keys.length} with an underscore in the last part`)
            : T(`${keys.length} tilbake til punktum hele veien`, `${keys.length} back to dots all the way`));
  tegnNabo();
}

/* ------------------------------------------------------- find and replace */
function erstattVerdi(verdi, er) {
  if (!er || !er.finn) return null;
  const v = String(verdi ?? '');
  let ny;
  if (er.regex) {
    try { ny = v.replace(new RegExp(er.finn, 'g'), er.med); er.feil = ''; }
    catch (e) { er.feil = e.message; return null; }
  } else ny = v.split(er.finn).join(er.med);
  return ny !== v ? ny : null;
}
function aapneErstatt() {
  if (!NABO.erstatt) NABO.erstatt = {felt: 'sti', finn: '', med: '', regex: false, bareViste: true};
  tegnNabo();
  setTimeout(() => $('naboErFinn')?.focus(), 30);
}
function lukkErstatt() { NABO.erstatt = null; tegnNabo(); }
function brukErstatt() {
  const er = NABO.erstatt;
  if (!er) return;
  const r = naboResultat();
  const vist = new Set(NABO.vist || []);
  const rader = r.rader.filter(x => !er.bareViste || vist.has(x.key));
  const endr = [];
  for (const x of rader) {
    const ny = erstattVerdi(x[er.felt], er);
    if (ny !== null) endr.push([x.key, er.felt, ny === String(x.auto[er.felt]) ? undefined : ny]);
  }
  if (!endr.length) return;
  NABO.angre = naboInnst().rett;
  settRett(endr);
  er.finn = ''; $('naboErFinn').value = '';
  $('naboErAngre').hidden = false;
  toast(T(`${endr.length} ${er.felt === 'sti' ? 'tagger' : 'beskrivelser'} endret`, `${endr.length} ${er.felt === 'sti' ? 'tags' : 'descriptions'} changed`));
  tegnNabo();
}

function koblNabo(ov) {
  // One timer per field: typing in the next field must not cancel this one.
  const tider = {};
  const senere = (fn, k = '') => { clearTimeout(tider[k]); tider[k] = setTimeout(fn, 160); };
  $('naboLukk').onclick = lukkNabo;
  $('naboTitt').onclick = lukkNabo;
  $('naboIniInn').onclick = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.ini';
    i.onchange = () => i.files[0] && lesIniFil(i.files[0]);
    i.click();
  };
  $('naboIniUt').onclick = lagIni;
  $('naboVar').onclick = () => eksporterVariabel();
  $('naboEde').onclick = eksporterEde;
  $('naboPer').onchange = (e) => { NABO.perEnhet = e.target.checked; lagreNabo({perEnhet: NABO.perEnhet}); };
  $('naboMappe').onchange = (e) => {
    if (e.target.value === '__velg') { velgMappe(); return; }
    lagreNabo({mappe: e.target.value}); fyllMapper();
  };
  $('naboVis').onclick = () => NABO.sistLagret && api('/api/vis-fil', {sti: NABO.sistLagret});
  hentMapper();
  const felt = {naboAnlegg: 'anleggsnavn', naboPrefiks: 'prefiks', naboCluster: 'cluster'};
  for (const [id, nokkel] of Object.entries(felt)) {
    $(id).addEventListener('input', (e) => senere(() => lagreTagging({[nokkel]: e.target.value.trim()}).then(() => tegnNabo()), id));
  }
  $('naboNormKnapp').onclick = () => { NABO.visning = 'norm'; ov.querySelector('.nabo-des').open = false; tegnNabo(); };
  $('naboPrefMod').onchange = (e) => { lagreNabo({prefMod: e.target.value}); tegnNabo(); };
  $('naboAnleggMod').onchange = (e) => { lagreNabo({foranAnlegg: e.target.value === 'tag'}); tegnNabo(); };
  $('naboTrend').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (!/^\d\d:\d\d:\d\d$/.test(v)) { toast(T('Skriv tiden som tt:mm:ss', 'Write the time as hh:mm:ss'), true); e.target.value = naboInnst().trend; return; }
    lagreNabo({trend: v}); tegnNabo();
  });
  ov.querySelector('.nabo-des-grid')?.addEventListener('change', (e) => {
    const k = e.target.dataset.eu; if (!k) return;
    const v = Math.max(0, Math.min(6, parseInt(e.target.value, 10) || 0));
    lagreNabo({eu: Object.assign({}, naboInnst().eu, {[k]: v})}); tegnNabo();
  });
  $('naboSok').addEventListener('input', (e) => { NABO.sok = e.target.value; senere(() => tegnNabo()); });
  $('naboTabell').addEventListener('click', (e) => {
    if (NABO.visning !== 'var') return;
    if (e.target.id === 'naboVelgAlle') {
      const vist = NABO.vist || [];
      if (e.target.checked) vist.forEach(k => NABO.valgt.add(k)); else vist.forEach(k => NABO.valgt.delete(k));
      tegnNabo(); return;
    }
    const v = e.target.closest('.nabo-velg');
    if (v) { velgRad(v.dataset.k, v.checked, e.shiftKey); return; }
    const s = e.target.closest('td.sel-c');
    if (s) { klikkRad(s.dataset.k, e); return; }
    const g = e.target.closest('.nabo-gruppe-knapp');
    if (g) {
      const keys = naboResultat().rader.filter(x => x.enhetNavn === g.dataset.dev).map(x => x.key);
      const alle = keys.every(k => NABO.valgt.has(k));
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) NABO.valgt.clear();
      keys.forEach(k => alle ? NABO.valgt.delete(k) : NABO.valgt.add(k));
      tegnNabo(); return;
    }
    const angre = e.target.closest('.nabo-angre');
    if (angre) {
      const key = angre.dataset.k;
      settRett(Object.keys(naboInnst().rett[key] || {}).map(f => [key, f, undefined]));
      tegnNabo(); return;
    }
    const b = e.target.closest('td[data-bryter]');
    if (b) { byttBryter(b); return; }
    const td = e.target.closest('td[data-felt]');
    if (td && !td.querySelector('input')) rettCelle(td);
  });
  $('naboHale').onclick = () => settHale(true);
  $('naboPunktum').onclick = () => settHale(false);
  $('naboLike').onclick = velgLike;
  $('naboType').onclick = velgSammeType;
  $('naboMarkLukk').onclick = () => { NABO.valgt.clear(); tegnNabo(); };
  $('naboErstattKnapp').onclick = () => (NABO.erstatt ? lukkErstatt() : aapneErstatt());
  $('naboErLukk').onclick = lukkErstatt;
  $('naboErBruk').onclick = brukErstatt;
  $('naboErAngre').onclick = () => {
    if (NABO.angre) { lagreAnlegg({rett: NABO.angre}); NABO.angre = null; }
    $('naboErAngre').hidden = true; tegnNabo();
  };
  const erOppdater = () => {
    const er = NABO.erstatt; if (!er) return;
    er.felt = $('naboErFelt').value; er.finn = $('naboErFinn').value; er.med = $('naboErMed').value;
    er.regex = $('naboErRe').checked; er.bareViste = $('naboErViste').checked;
    tegnNabo();
  };
  ['naboErFinn', 'naboErMed'].forEach(id => $(id).addEventListener('input', erOppdater));
  ['naboErFelt', 'naboErRe', 'naboErViste'].forEach(id => $(id).addEventListener('change', erOppdater));
  $('naboErFinn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); brukErstatt(); } });
  $('naboErMed').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); brukErstatt(); } });
  ov.querySelector('.nabo-er-raske').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $('naboErFinn').value = b.dataset.fra; $('naboErMed').value = b.dataset.til; erOppdater();
  });
  ov.querySelector('.nabo-visning').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    NABO.visning = b.dataset.v; tegnNabo();
  });
  ov.querySelector('.nabo-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    NABO.filter = b.dataset.f; tegnNabo();
  });
  $('naboKliste').addEventListener('change', (e) => {
    const rad = e.target.closest('.nabo-k'); if (!rad) return;
    const k = NABO.kilder.find(x => x.id === rad.dataset.id); if (!k) return;
    if (e.target.classList.contains('nabo-k-med')) { k.av = !e.target.checked; tegnNabo(); }
  });
  $('naboKliste').addEventListener('input', (e) => {
    if (!e.target.classList.contains('nabo-k-navn')) return;
    const k = NABO.kilder.find(x => x.id === e.target.closest('.nabo-k').dataset.id);
    if (!k) return;
    senere(() => { lagreAnlegg({navn: Object.assign({}, naboInnst().navn, {[devNokkel(k)]: e.target.value.trim()})}); tegnNabo(); }, 'navn');
  });
  $('naboKliste').addEventListener('click', (e) => {
    if (!e.target.closest('.nabo-k-fjern')) return;
    const id = e.target.closest('.nabo-k').dataset.id;
    NABO.kilder = NABO.kilder.filter(x => x.id !== id); tegnNabo();
  });
  $('naboFil').addEventListener('change', (e) => { leggTilFiler(e.target.files); e.target.value = ''; });
  ov.addEventListener('keydown', (e) => {
    const z = e.target.closest && e.target.closest('.nabo-slipp, .nabo-start');
    if (z && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); z.querySelector('input[type=file]')?.click(); }
  });
  $('naboTabell').addEventListener('change', (e) => {
    if (!e.target.classList.contains('nabo-start-fil')) return;
    leggTilFiler(e.target.files); e.target.value = '';
  });
  const modal = ov.querySelector('.nabo-modal');
  modal.addEventListener('dragover', (e) => { e.preventDefault(); modal.classList.add('slipper'); });
  modal.addEventListener('dragleave', (e) => { if (!modal.contains(e.relatedTarget)) modal.classList.remove('slipper'); });
  modal.addEventListener('drop', (e) => {
    e.preventDefault(); modal.classList.remove('slipper');
    if (e.dataTransfer?.files?.length) leggTilFiler(e.dataTransfer.files);
  });
}

(function koblNaboInn() {
  const ov = $('naboOverlay');
  if (!ov) return;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) lukkNabo(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ov.hidden) {
      if (document.activeElement?.classList.contains('nabo-rett-inn')) return;
      e.preventDefault(); e.stopPropagation();
      // One step back at a time: replace bar, selection, a side view, the
      // search, Advanced - and only then NABO itself.
      const avansert = ov.querySelector('.nabo-des[open]');
      if (NABO.erstatt) lukkErstatt();
      else if (NABO.valgt.size) { NABO.valgt.clear(); tegnNabo(); }
      else if (NABO.visning !== 'var') { NABO.visning = 'var'; tegnNabo(); }
      else if (NABO.sok) { NABO.sok = ''; $('naboSok').value = ''; tegnNabo(); }
      else if (avansert) avansert.open = false;
      else lukkNabo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h' && !ov.hidden && NABO.visning === 'var') {
      e.preventDefault(); e.stopPropagation(); aapneErstatt();
    }
  }, true);
  // The old way in now leads here: the menu item, the button under Tagging.
  lagBtgFil = aapneNabo;
  const b = $('btgBtn');
  if (b) b.onclick = aapneNabo;
  const _sprak = settSprak;
  settSprak = function () {
    const r = _sprak.apply(this, arguments);
    if (!ov.hidden) tegnNabo(true);
    naboHusTittel();
    return r;
  };
})();

/* ---------------------------------------------------------- the family
   NABE and NABO live next door to each other. The house sits beside NABE's
   name in the top bar, behind a hairline fence; NABE glances at it when you
   point there, it stands beside him on the start screen, and N goes next
   door from anywhere. */
/* NABO talks from beside his house in the header, briefly. */
function naboSier(tekst) {
  const b = $('naboBoble');
  if (!b || $('naboOverlay').hidden) return;
  b.textContent = tekst;
  b.classList.add('inne');
  clearTimeout(naboSier.t);
  naboSier.t = setTimeout(() => b.classList.remove('inne'), 3200);
}

/* A little confetti from the chimney, once: the first Variabel file. In the
   theme's own colours, and not at all with motion off. */
function naboKonfetti() {
  const kilde = $('naboHusStor');
  if (!kilde || bevegelseAv()) return;
  const r = kilde.getBoundingClientRect();
  const farger = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--live)', 'var(--fg-2)'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('span');
    p.className = 'nabo-konfetti';
    p.style.background = farger[i % farger.length];
    p.style.left = (r.left + r.width * .72) + 'px';
    p.style.top = (r.top + 4) + 'px';
    document.body.appendChild(p);
    const dx = (Math.random() - .3) * 120, dy = -40 - Math.random() * 50, rot = (Math.random() - .5) * 540;
    p.animate([{transform: 'translate(0,0) rotate(0)', opacity: 1},
               {transform: `translate(${dx * .6}px,${dy}px) rotate(${rot / 2}deg)`, opacity: 1, offset: .45},
               {transform: `translate(${dx}px,${dy + 110}px) rotate(${rot}deg)`, opacity: 0}],
              {duration: 1400 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)'}).finished
      .then(() => p.remove(), () => p.remove());
  }
  naboSier(T('Første fil fra naboen. Den henger vi opp.', 'The first file from next door. That one goes on the wall.'));
}

function naboHusTittel() {
  const b = $('naboHus');
  if (b) b.title = T('NABO, naboen: tagger og Variabel-fil (N)', 'NABO, the neighbour: tags and the Variabel file (N)');
}

(function familien() {
  const merke = document.querySelector('.topbar .brand-text');
  if (merke && !$('naboHus')) {
    const b = document.createElement('button');
    b.id = 'naboHus';
    b.className = 'nabo-hus-knapp';
    b.type = 'button';
    b.innerHTML = `${NABO_SVG}<span>NABO</span>`;
    // Beside the brand link, not in it: a button inside a link would navigate.
    (merke.closest('a') || merke).insertAdjacentElement('afterend', b);
    b.onclick = aapneNabo;
    b.addEventListener('mouseenter', () => { if (typeof blikk === 'function') blikk(2.4, 0, 1200); });
    naboHusTittel();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    if (document.querySelector('.gs-overlay:not([hidden])') || $('startskjerm')) return;
    e.preventDefault();
    aapneNabo();
  });

  /* An EDE dropped anywhere on NABE goes next door: NABO opens with it. Only
     files NABO reads, and only when nothing else on the page took the drop. */
  const naboFil = (e) => [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')
    && $('naboOverlay').hidden && !document.querySelector('.gs-overlay:not([hidden])');
  window.addEventListener('dragover', (e) => { if (!e.defaultPrevented && naboFil(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (e.defaultPrevented || !naboFil(e)) return;
    const filer = [...e.dataTransfer.files].filter(f => /\.(csv|txt|ini)$/i.test(f.name));
    if (!filer.length) return;
    e.preventDefault();
    $('startskjerm')?.querySelector('.ss-videre')?.click();
    aapneNabo();
    leggTilFiler(filer);
  });

  /* ------------------------------------------------- the neighbours at rest
     When you have been away a while NABE dozes off, and soon after so does
     the house next door. Some minutes into the nap one of them wakes the
     other to play: the house tosses a ball over the fence, or NABE knocks on
     its wall. A few throws, then they are both tired again. Once per nap,
     and your mouse ends it. With motion off they only sleep. */
  const LEK = {leker: false, lekt: false, naar: 0, baller: []};
  const nyNaar = () => { LEK.naar = 120000 + 90000 + Math.random() * 150000; };
  nyNaar();
  const vent = (ms) => new Promise(r => setTimeout(r, ms));
  const midt = (el) => { const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; };

  async function kast(fra, til) {
    if (!LEK.leker) return;
    const a = midt(fra), b = midt(til);
    const ball = document.createElement('span');
    ball.className = 'nabo-ball';
    ball.title = T('Ta den.', 'Catch it.');
    ball.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      LEK.leker = false;
      LEK.baller.forEach(b => b.remove()); LEK.baller = [];
      const n = (loadPrefs().nabo?.fanget || 0) + 1;
      lagreNabo({fanget: n});
      if (typeof nabeSier === 'function') nabeSier(n === 1
        ? T('Du tok ballen. Det har ingen gjort før.', 'You caught the ball. Nobody has done that before.')
        : T(`Tatt igjen. ${n} baller nå. Vi teller.`, `Caught again. ${n} balls now. We are counting.`), 'fornoyd');
    });
    document.body.appendChild(ball);
    LEK.baller.push(ball);
    const hoyde = 26 + Math.random() * 10;
    const steg = Array.from({length: 13}, (_, i) => {
      const t = i / 12;
      return {transform: `translate(${a.x + (b.x - a.x) * t - 3}px, ${a.y - 6 + (b.y - a.y) * t - 4 * hoyde * t * (1 - t)}px)`};
    });
    if (typeof blikk === 'function') blikk(Math.sign(b.x - a.x) * 2.4, -1, 900);
    try { await ball.animate(steg, {duration: 820, easing: 'linear'}).finished; } catch {}
    ball.remove();
    LEK.baller = LEK.baller.filter(x => x !== ball);
    if (!LEK.leker) return;
    // The catch.
    if (til.id === 'naboHus') { til.classList.add('fange'); setTimeout(() => til.classList.remove('fange'), 380); }
    else if (typeof figur === 'function') figur('hopp', 550);
    await vent(260);
  }

  async function lek() {
    const m = nabeMerke(), h = $('naboHus');
    if (!m || !h || LEK.leker || bevegelseAv() || document.hidden
        || document.querySelector('.gs-overlay:not([hidden])') || $('startskjerm')) return;
    LEK.leker = true; LEK.lekt = true; LEK.avbrutt = false;
    // NABE's own clock would put him straight back to sleep; tell it he just moved.
    NABE.sist = Date.now() - 60000;
    const huset = Math.random() < 0.5;
    if (huset) {
      h.classList.remove('sover'); h.classList.add('vekk');
      await vent(700); h.classList.remove('vekk');
      await kast(h, m);
      m.classList.remove('sover'); nabeOppdater();
    } else {
      m.classList.remove('sover'); nabeOppdater();
      if (typeof blikk === 'function') blikk(2.4, 0, 2500);
      if (typeof figur === 'function') figur('hopp', 550);
      await vent(650); if (!LEK.leker) return;
      h.classList.add('banke'); await vent(700);
      h.classList.remove('banke', 'sover'); h.classList.add('vekk');
      await vent(650); h.classList.remove('vekk');
    }
    let fra = huset ? m : h, til = huset ? h : m;
    const runder = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < runder && LEK.leker && !LEK.avbrutt; i++) { await kast(fra, til); [fra, til] = [til, fra]; }
    if (!LEK.leker) return;
    if (LEK.avbrutt) { LEK.leker = false; LEK.avbrutt = false; h.classList.remove('sover'); return; }
    await vent(900);
    if (LEK.avbrutt) { LEK.leker = false; LEK.avbrutt = false; return; }
    m.classList.add('sover'); nabeOppdater();
    await vent(1400);
    if (LEK.avbrutt) { LEK.leker = false; LEK.avbrutt = false; m.classList.remove('sover'); nabeOppdater(); return; }
    if (LEK.leker) h.classList.add('sover');
    LEK.leker = false;
  }
  window.naboLek = lek;   // to try it without waiting

  setInterval(() => {
    const m = nabeMerke(), h = $('naboHus');
    if (!m || !h || LEK.leker) return;
    const stille = Date.now() - NABE.sist;
    const nabeSover = m.classList.contains('sover');
    if (nabeSover && stille > 140000) h.classList.add('sover');
    if (!nabeSover) h.classList.remove('sover');
    if (nabeSover && h.classList.contains('sover') && !LEK.lekt && stille > LEK.naar) lek();
  }, 1000);

  document.addEventListener('pointermove', () => {
    // You are back: they finish this throw and stay awake, and the ball in
    // the air is yours to catch.
    if (LEK.leker) LEK.avbrutt = true;
    const h = $('naboHus');
    if (h && h.classList.contains('sover')) {
      h.classList.remove('sover'); h.classList.add('vekk');
      setTimeout(() => h.classList.remove('vekk'), 600);
    }
    if (LEK.lekt) { LEK.lekt = false; nyNaar(); }
  }, {passive: true});

  // A scan that found something: a puff from next door. A file made: NABE
  // glances at the house.
  if (typeof nabeEtterSkann === 'function') {
    const _skann = nabeEtterSkann;
    nabeEtterSkann = function (n) {
      const r = _skann.apply(this, arguments);
      const h = $('naboHus');
      if (n > 0 && h && !bevegelseAv()) { h.classList.add('puff'); setTimeout(() => h.classList.remove('puff'), 1600); }
      return r;
    };
  }

  // Now and then, while awake, a little puff from the chimney.
  (function pust() {
    setTimeout(() => {
      const h = $('naboHus');
      if (h && !bevegelseAv() && !h.classList.contains('sover') && !LEK.leker && !document.hidden) {
        h.classList.add('puff'); setTimeout(() => h.classList.remove('puff'), 1600);
      }
      pust();
    }, 40000 + Math.random() * 50000);
  })();

  /* ----------------------------------------------------- small surprises
     The house dresses for the season; a few words typed in NABO's search get
     an answer; five knocks on the house in NABO and NABE asks who it is. */
  const d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate();
  const sesong = d.getMonth() === 11 && d.getDate() <= 26 ? 'jul' : md === 517 ? 'mai17' : md === 1031 ? 'halloween' : '';
  if (sesong) document.documentElement.classList.add('nabo-' + sesong);

  const SOK_SVAR = {
    btg: ['Hvem?', 'Who?'],
    yabe: ['Feil nabolag.', 'Wrong neighbourhood.'],
    excel: ['Ikke her. Aldri mer.', 'Not here. Never again.'],
    nabe: ['Han bor ved siden av. Han kjeder seg.', 'He lives next door. He is bored.'],
    nabo: ['Det er meg.', 'That is me.'],
    nti: ['Den får fila når du er klar.', 'It gets the file when you are ready.'],
  };
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'naboSok') return;
    const s = SOK_SVAR[e.target.value.trim().toLowerCase()];
    if (s) naboSier(T(...s));
  });

  let bank = [];
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#naboHusStor')) return;
    const naa = Date.now();
    bank = bank.filter(t => naa - t < 2000); bank.push(naa);
    const h = $('naboHusStor');
    h.classList.remove('banke'); void h.offsetWidth; h.classList.add('banke');
    clearTimeout(h._bank); h._bank = setTimeout(() => h.classList.remove('banke'), 380);
    if (bank.length >= 5) {
      bank = [];
      const titt = $('naboTitt');
      if (titt) { titt.classList.add('opp'); setTimeout(() => titt.classList.remove('opp'), 2600); }
      if (typeof nabeSier === 'function') nabeSier('Hvem banker?', 'skvatt');
      setTimeout(() => naboSier(T('Naboen.', 'The neighbour.')), 900);
    }
  });

  // On the start screen the neighbour stands beside NABE, and is a way in.
  const paaStart = () => {
    const l = $('startskjerm');
    const logo = l && l.querySelector('.ss-logo');
    if (!logo || logo.querySelector('.ss-nabo')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ss-nabo';
    b.title = T('NABO, naboen: tagger og Variabel-fil', 'NABO, the neighbour: tags and the Variabel file');
    b.innerHTML = NABO_SVG;
    b.onclick = () => { l.querySelector('.ss-videre')?.click(); setTimeout(aapneNabo, 280); };
    logo.appendChild(b);
  };
  const _start = visStartskjerm;
  visStartskjerm = function () {
    const r = _start.apply(this, arguments);
    paaStart();
    return r;
  };
  paaStart();
  setTimeout(paaStart, 300);
})();
