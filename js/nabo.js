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

function naboInnst() {
  const p = loadPrefs().nabo || {};
  return {trend: p.trend || '00:05:00', eu: Object.assign({}, EU_STD, p.eu || {}),
          ini: p.ini || '', navn: p.navn || {}, perEnhet: !!p.perEnhet,
          norm: Object.assign({}, NORM_STD, p.norm || {})};
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
    .map(x => x.replace(/[-_\s]+/g, '.').replace(/^\.+|\.+$/g, ''))
    .filter(Boolean).join('.');
  return sti ? {sti, g} : null;
}

/* ------------------------------------------------------------ one row */
function naboRad(p, t, o, anlegg, enhetNavn) {
  const type = BTG_TYPE[p.type];
  if (type === undefined) return null;
  const analog = type <= 2;
  const norm = o.norm.paa ? normaliser(p.name, o) : null;
  const sti = norm ? (t.cluster ? t.cluster + '.' : '') + norm.sti : btgSti(p.name, t.cluster);
  const sd = btgSd(p.description || '');
  const beskr = sd.rest || p.name || '';
  const enhet = analog ? btgEnhet(p.units) : '';
  // No unit is a count or a state, never a fraction.
  const des = analog ? (enhet === 'null' ? 0 : (o.eu[euNokkel(enhet)] ?? o.eu.EUDefault)) : 0;
  let tilstander = '';
  if (Array.isArray(p.state_text) && p.state_text.length) {
    tilstander = (type >= 3 && type <= 5)
      ? `0=${p.state_text[0] || 'Av'}|1=${p.state_text[1] || 'På'}`
      : p.state_text.map((s, i) => `${i + 1}=${s}`).join('|');
  }
  const biter = sti.split('.');
  const kilde = sd.klasse
    ? `${anlegg} ${biter.length >= 3 ? `${biter[0]}.${biter[1]}-${biter[2]}` : sti}` : '';
  const trend = sd.trend ? `Interval|${o.trend}` : '';
  const f = new Array(34).fill('');
  f[0] = 'BacnetNetwork'; f[1] = anlegg; f[2] = enhetNavn; f[3] = sti;
  f[4] = String(type); f[5] = String(p.instance ?? ''); f[6] = naboVerdi(p.value); f[7] = enhet;
  f[8] = String(des); f[9] = tilstander; f[10] = beskr; f[11] = trend;
  if (sd.klasse) { f[12] = String(sd.klasse); f[13] = beskr; f[14] = kilde; }
  f[30] = p.name || '';
  if (norm) { f[29] = norm.g.komponent || ''; f[33] = norm.g.funksjonskode || ''; }
  return {
    normert: o.norm.paa ? !!norm : null,
    linje: f.map(x => String(x).replace(/[;\r\n]/g, ' ')).join(';'),
    sti, type, typeNavn: shortType(p.type), inst: p.instance, enhet, des,
    trend: !!trend, klasse: sd.klasse, beskr, navn: p.name || '', harSd: sd.rest !== (p.description || '').trim(),
  };
}

function naboVerdi(v) {
  if (v === null || v === undefined || typeof v === 'object') return '';
  return typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
}

function enhetsfelt(kilde, t) {
  const o = naboInnst();
  let navn = String((o.navn[kilde.id] ?? kilde.auto) || '').trim();
  if (t.prefiks && navn.toLowerCase().startsWith(t.prefiks.toLowerCase()))
    navn = navn.slice(t.prefiks.length).replace(/^[._\-\s]+/, '');
  return `${t.prefiks || '?'}.${navn.replace(/[\s\-.]+/g, '_')}`;
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
      const r = naboRad(p, t, o, anlegg, enhetNavn);
      if (!r) { hoppet++; continue; }
      r.kilde = k; r.enhetNavn = enhetNavn; r.feil = []; r.adv = [];
      if (!r.navn) r.feil.push(T('Mangler objektnavn', 'No object name'));
      if (sett.has(r.sti)) {
        r.feil.push(T('Samme tag finnes alt på denne enheten', 'The same tag already exists on this device'));
        sett.get(r.sti).feil.push(T('Samme tag finnes to ganger', 'The same tag appears twice'));
      } else sett.set(r.sti, r);
      const ob = `${r.type}:${r.inst}`;
      if (objekter.has(ob)) r.feil.push(T('Samme objekt (type og instans) finnes to ganger', 'The same object (type and instance) appears twice'));
      objekter.add(ob);
      if (navnBrukt.get(enhetNavn) > 1) r.feil.push(T('En annen enhet får samme device-navn', 'Another device gets the same device name'));
      if (r.sti.split('.').length < 3)
        r.adv.push(T('Kort sti, følger ikke system.nummer.komponent', 'Short path, not system.number.component'));
      if (r.normert === false) r.adv.push(T('Passer ikke normaliseringen, vanlig sti brukt', 'Does not fit the normalisation, plain path used'));
      // + and = are BTG's own +01=360.001 format; Niagara escapes them and NTI expects it.
      const rare = [...new Set((r.sti.match(/[^A-Za-z0-9_.$+=]/g) || []))];
      if (rare.length) r.adv.push(T(`Niagara må escape ${rare.map(c => c === ' ' ? 'mellomrom' : c).join(' ')}`,
                                    `Niagara has to escape ${rare.map(c => c === ' ' ? 'space' : c).join(' ')}`));
      rader.push(r);
    }
  }
  const globalt = [];
  if (!t.prefiks) globalt.push(T('Prefiks mangler', 'Prefix missing'));
  if (!anlegg) globalt.push(T('Anleggsnavn mangler', 'Site name missing'));
  if (t.prefiks && t.prefiks.length > PREFIKS_MAKS)
    globalt.push(T(`Prefikset er over ${PREFIKS_MAKS} tegn`, `The prefix is over ${PREFIKS_MAKS} characters`));
  const usikre = NABO.kilder.filter(k => !k.av && k.usikker && !o.navn[k.id]).length;
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
            auto: n.navn || (dev ? `Device${dev}` : filnavn.replace(/\.csv$/i, '')), usikker: !n.navn, hvor: n.hvor};
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
  // Cluster stays in the file: it is BTG's Citect cluster, and in NABE the
  // field of that name is what goes in front of the path.
  const a = iniVerdi(sek, 'Generator', 'Anleggsnavn'), p = iniVerdi(sek, 'Generator', 'Prefix');
  if (a !== undefined) patch.anleggsnavn = a.trim();
  if (p !== undefined) patch.prefiks = p.trim();
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
  sett('Trend', 'SamplerPeriode', o.trend);
  for (const [k, v] of Object.entries(o.eu)) sett('EngineeringUnits', k, v);
  const tekst = sek.map(s => `[${s.navn}]\r\n` + s.par.map(([k, v]) => `${k}=${v}`).join('\r\n')).join('\r\n') + '\r\n';
  // BTG reads the file as Windows-1252; æøå and ° are single bytes there.
  const bytes = new Uint8Array(tekst.length);
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst.charCodeAt(i);
    bytes[i] = c < 256 ? c : 63;
  }
  lastNedBytes(bytes, 'HeaderBTG.ini', 'text/plain');
  toast(T('HeaderBTG.ini lagret', 'HeaderBTG.ini saved'));
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
const DIFF_FELT = [[3, ['Tag', 'Tag']], [7, ['Enhet', 'Unit']], [8, ['Desimaler', 'Decimals']],
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
  if (!r.t.prefiks || !r.anlegg) {
    toast(r.globalt.join(' · '), true);
    $(r.t.prefiks ? 'naboAnlegg' : 'naboPrefiks')?.focus();
    return;
  }
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
  grupper.forEach(([e, rader], i) => setTimeout(() => {
    const navn = ren(`${r.t.prefiks} Variabel ${r.anlegg} ${tid}${e ? ' ' + e.split('.').slice(1).join('.') : ''}${bare ? ' endringer' : ''}.csv`);
    lastNedBytes('\uFEFF' + rader.map(x => x.linje).join('\r\n') + '\r\n', navn, 'text/csv;charset=utf-8');
  }, i * 350));
  toast(T(`Variabel-fil laget: ${r.rader.length} punkter fra ${new Set(r.rader.map(x => x.enhetNavn)).size} enheter`
          + (feil ? ` · ${feil} med feil` : ''),
          `Variabel file made: ${r.rader.length} points from ${new Set(r.rader.map(x => x.enhetNavn)).size} devices`
          + (feil ? ` · ${feil} with errors` : '')), !!feil);
  naboFigur('vink');
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
        k.instans ?? '', f(p.name), EDE_OBJ_TYPE[p.type] ?? '', p.instance ?? '', f(p.description),
        '', '', '', p.writable ? 'Y' : 'N', '', '', '', st.ref.get(p.objid) ?? '', EDE_UNIT[p.units] ?? '']));
    }
    const basis = `Device${k.instans ?? 'x'}_${dato}`;
    const filer = [[linjer.join('\r\n') + '\r\n', `${basis}_EDE.csv`]];
    if (st.tabell.length) {
      const sl = ['#State Text Reference', '#Reference Number;Text 1 or Inactive-Text;Text 2 or Active-Text'];
      st.tabell.forEach((x, j) => sl.push([j + 1, ...x.map(f)].join(';')));
      filer.push([sl.join('\r\n') + '\r\n', `${basis}_StateTexts.csv`]);
    }
    for (const [tekst, fn] of filer) setTimeout(() => downloadText(tekst, fn, false), (i++) * 350);
  }
  toast(T(`EDE for ${kilder.length} ${kilder.length === 1 ? 'enhet' : 'enheter'}`,
          `EDE for ${kilder.length} ${kilder.length === 1 ? 'device' : 'devices'}`));
}

/* ------------------------------------------------------------ the view */
const NABO_SVG = `<svg class="nabo-fig" viewBox="0 0 32 32" aria-hidden="true">
  <path class="nabo-tak" d="M3.5 14.5 16 4.5l12.5 10"/>
  <rect class="nabo-hus" x="6.5" y="12.5" width="19" height="16.5" rx="3"/>
  <g class="nabo-oyne"><rect x="10.5" y="17" width="3.6" height="3.6" rx=".8"/><rect x="17.9" y="17" width="3.6" height="3.6" rx=".8"/></g>
  <path class="nabo-munn" d="M13.5 24.3q2.5 1.6 5 0"/>
  <path class="nabo-pipe" d="M22 9.2V5.6h2.6v5.7"/>
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
        <div class="nabo-merke">${NABO_SVG}<div><div class="nabo-ord">NABO</div>
          <div class="nabo-under">Not Another BACnet Object-namer · ${T('naboen til NABE', 'NABE\u2019s neighbour')}</div></div></div>
        <div class="nabo-gjerde" aria-hidden="true"><button class="nabo-titt" id="naboTitt" title="${T('Tilbake til NABE', 'Back to NABE')}">${NABE_SVG}</button></div>
        <div class="nabo-topp-knapper">
          <button class="btn" id="naboIniInn" title="${T('Hent prefiks, anlegg, trend og desimaler fra BTG', 'Take prefix, site, trend and decimals from BTG')}">${T('Hent HeaderBTG.ini', 'Load HeaderBTG.ini')}</button>
          <button class="btn" id="naboIniUt" title="${T('Lagre innstillingene i BTGs format, så BTG kan bruke dem', 'Save the settings in BTG\u2019s format, for BTG to use')}">${T('Lagre .ini', 'Save .ini')}</button>
          <button class="gs-close" id="naboLukk">${T('Lukk', 'Close')} ✕</button>
        </div>
      </header>
      <section class="nabo-oppsett">
        <label><span>${T('Anlegg', 'Site')}</span><input class="field" id="naboAnlegg" autocomplete="off"></label>
        <label class="kort"><span>${T('Prefiks', 'Prefix')}</span><input class="field" id="naboPrefiks" autocomplete="off" spellcheck="false"></label>
        <label class="kort"><span>Cluster</span><input class="field" id="naboCluster" autocomplete="off" spellcheck="false"></label>
        <label class="kort"><span>${T('Trend hvert', 'Trend every')}</span><input class="field" id="naboTrend" autocomplete="off" spellcheck="false"></label>
        <details class="nabo-des"><summary>${T('Desimaler', 'Decimals')}</summary><div class="nabo-des-grid"></div></details>
        <div class="nabo-eks"><span>${T('Slik blir det', 'What it becomes')}</span><code id="naboEks"></code></div>
      </section>
      <div class="nabo-kropp">
        <aside class="nabo-kilder">
          <div class="nabo-h">${T('Enheter', 'Devices')} <span id="naboAntK"></span></div>
          <div class="nabo-kliste" id="naboKliste"></div>
          <label class="nabo-slipp" id="naboSlipp">
            <input type="file" id="naboFil" accept=".csv,.txt,.ini" multiple hidden>
            <b>${T('Legg til EDE-filer', 'Add EDE files')}</b>
            <span>${T('eller slipp dem her, gjerne med _StateTexts og HeaderBTG.ini', 'or drop them here, with _StateTexts and HeaderBTG.ini if you have them')}</span>
          </label>
        </aside>
        <main class="nabo-forh">
          <div class="nabo-verktoy">
            <div class="nabo-visning" role="tablist">
              ${[['var', T('Variabler', 'Variables')], ['diff', T('Sammenlign', 'Compare')], ['norm', T('Normalisering', 'Normalisation')]]
                .map(([k, l]) => `<button data-v="${k}" role="tab">${l}</button>`).join('')}
            </div>
            <input class="field" id="naboSok" type="search" placeholder="${T('Søk i tag, navn eller beskrivelse', 'Search tag, name or description')}" autocomplete="off" spellcheck="false">
            <div class="nabo-filter" role="tablist">
              ${[['alle', T('Alle', 'All')], ['adv', T('Advarsler', 'Warnings')], ['alarm', 'Alarm'], ['trend', 'Trend']]
                .map(([k, l]) => `<button data-f="${k}" role="tab">${l}<em></em></button>`).join('')}
            </div>
          </div>
          <div class="nabo-globalt" id="naboGlobalt"></div>
          <div class="nabo-tabell" id="naboTabell"></div>
        </main>
      </div>
      <footer class="nabo-fot">
        <div class="nabo-sum" id="naboSum"></div>
        <label class="nabo-per"><input type="checkbox" id="naboPer"> ${T('Én fil per enhet', 'One file per device')}</label>
        <button class="btn" id="naboEde">${T('EDE-filer', 'EDE files')}</button>
        <button class="btn primary" id="naboVar">${T('Lag Variabel-fil', 'Make Variabel file')}</button>
      </footer>
    </div>`;
    koblNabo(ov);
  }
  const sett = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  sett('naboAnlegg', t.anleggsnavn || ''); sett('naboPrefiks', t.prefiks || '');
  sett('naboCluster', t.cluster || ''); sett('naboTrend', o.trend);
  $('naboPer').checked = NABO.perEnhet;
  $('naboPrefiks').classList.toggle('mangler', !t.prefiks);
  $('naboAnlegg').classList.toggle('mangler', !(t.anleggsnavn || '').trim());

  const grid = ov.querySelector('.nabo-des-grid');
  if (grid && !grid.childElementCount) {
    grid.innerHTML = Object.keys(EU_STD).map(k => `<label><span>${esc(T(...EU_NAVN[k]))}</span>
      <input class="field" type="number" min="0" max="6" data-eu="${k}"></label>`).join('');
  }
  grid?.querySelectorAll('[data-eu]').forEach(i => { if (document.activeElement !== i) i.value = o.eu[i.dataset.eu]; });

  const forste = r.rader[0];
  $('naboEks').textContent = forste ? `${forste.enhetNavn}  ·  ${forste.sti}` : `${t.prefiks || 'PREFIKS'}.OU001  ·  360.001.RT401`;

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
    const navn = naboInnst().navn[k.id] ?? k.auto;
    return `<div class="nabo-k${k.av ? ' av' : ''}" data-id="${esc(k.id)}">
      <input type="checkbox" class="nabo-k-med" ${k.av ? '' : 'checked'} title="${T('Ta med', 'Include')}">
      <div class="nabo-k-tekst">
        <input class="nabo-k-navn" value="${esc(navn)}" spellcheck="false" title="${T('Navnet devicen har i Niagara. Prefikset settes foran.', 'The device\u2019s name in Niagara. The prefix goes in front.')}">
        <div class="nabo-k-meta"><span class="nabo-kilde-${k.type}">${k.type === 'ede' ? 'EDE' : T('Anlegg', 'Plant')}</span>${
          k.usikker && !(naboInnst().navn[k.id]) ? `<span class="nabo-sjekk">${T('sjekk navnet', 'check the name')}</span>` : ''}
          ${esc(k.type === 'ede' ? k.fil : k.fil)}${k.instans != null && k.instans !== '' ? ` · #${esc(k.instans)}` : ''}</div>
      </div>
      <div class="nabo-k-tall"><b>${k.av ? k.punkter.length : a.n}</b>${a.feil ? `<i class="f">${a.feil}</i>` : a.adv ? `<i class="a">${a.adv}</i>` : ''}</div>
      ${k.type === 'ede' ? `<button class="nabo-k-fjern" title="${T('Fjern', 'Remove')}">✕</button>` : ''}
    </div>`;
  }).join('') : `<div class="nabo-tom">${T('Ingen enheter ennå. Åpne enheter i NABE, eller legg til EDE-filer under.',
                                        'No devices yet. Open devices in NABE, or add EDE files below.')}</div>`;

  // Rows
  const q = NABO.sok.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const passer = x => (NABO.filter === 'alle' || (NABO.filter === 'adv' && (x.feil.length || x.adv.length))
    || (NABO.filter === 'alarm' && x.klasse) || (NABO.filter === 'trend' && x.trend))
    && q.every(w => (x.sti + ' ' + x.navn + ' ' + x.beskr + ' ' + x.enhetNavn).toLowerCase().includes(w));
  const vis = r.rader.filter(passer);
  const tall = {alle: r.rader.length, adv: r.rader.filter(x => x.feil.length || x.adv.length).length,
                alarm: r.rader.filter(x => x.klasse).length, trend: r.rader.filter(x => x.trend).length};
  ov.querySelectorAll('.nabo-visning button').forEach(b => b.classList.toggle('sel', b.dataset.v === NABO.visning));
  ov.querySelector('.nabo-filter').hidden = NABO.visning !== 'var';
  $('naboSok').hidden = NABO.visning === 'norm';
  ov.querySelectorAll('.nabo-filter button').forEach(b => {
    b.classList.toggle('sel', b.dataset.f === NABO.filter);
    b.querySelector('em').textContent = tall[b.dataset.f];
  });
  $('naboGlobalt').innerHTML = r.globalt.map(g => `<span>${esc(g)}</span>`).join('');
  $('naboGlobalt').hidden = !r.globalt.length;
  const MAKS = 1500;
  if (NABO.visning === 'diff') tegnDiff(r, q);
  else if (NABO.visning === 'norm') tegnNorm(r);
  else $('naboTabell').innerHTML = r.rader.length ? `<table>
    <thead><tr><th>Device</th><th>Tag</th><th>${T('Type', 'Type')}</th><th class="h">Inst</th><th>${T('Enhet', 'Unit')}</th>
      <th class="h">Des</th><th>Trend</th><th>Alarm</th><th>${T('Beskrivelse', 'Description')}</th></tr></thead>
    <tbody>${vis.slice(0, MAKS).map(x => {
      const merk = x.feil.length ? 'feil' : x.adv.length ? 'adv' : '';
      const hvorfor = [...x.feil, ...x.adv].join(' · ');
      return `<tr class="${merk}"${hvorfor ? ` title="${esc(hvorfor)}"` : ''}>
        <td class="d">${esc(x.enhetNavn)}</td><td class="t">${esc(x.sti)}</td>
        <td><span class="type-tag">${esc(x.typeNavn)}</span></td><td class="h">${esc(x.inst)}</td>
        <td class="u">${esc(x.enhet === 'null' ? '' : x.enhet)}</td><td class="h">${x.type <= 2 ? x.des : ''}</td>
        <td>${x.trend ? '<span class="nabo-prikk tr"></span>' : ''}</td>
        <td>${x.klasse ? `<span class="nabo-kl">${x.klasse}</span>` : ''}</td>
        <td class="b">${esc(x.beskr)}${hvorfor ? `<span class="nabo-hvorfor">${esc(hvorfor)}</span>` : ''}</td></tr>`;
    }).join('')}</tbody></table>${vis.length > MAKS ? `<div class="nabo-mer">${T(`Viser ${MAKS} av ${vis.length}. Søk for å snevre inn.`, `Showing ${MAKS} of ${vis.length}. Search to narrow it down.`)}</div>` : ''}
    ${!vis.length ? `<div class="nabo-tom">${T('Ingen rader passer.', 'No rows match.')}</div>` : ''}`
    : `<div class="nabo-tom stor">${NABO_SVG}<div>${T('Her kommer taggene. Åpne enheter i NABE eller legg til EDE-filer.', 'The tags will show here. Open devices in NABE or add EDE files.')}</div></div>`;

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
      <button class="btn primary" id="naboBareEndr" ${d.nye.length + d.endret.length ? '' : 'disabled'}
        title="${T('Bare radene NTI må importere på nytt', 'Only the rows NTI needs to import again')}">${T('Fil med bare nye og endrede', 'File with only new and changed')}</button>
    </div>
    ${d.omdopt.length ? `<div class="nabo-diff-omdopt">${d.omdopt.map(([a, b]) =>
      `<span>${T('Device-navn', 'Device name')} <s>${esc(a)}</s> → <b>${esc(b)}</b></span>`).join('')}</div>` : ''}
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

function koblNabo(ov) {
  let tid;
  const senere = (fn) => { clearTimeout(tid); tid = setTimeout(fn, 160); };
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
  const felt = {naboAnlegg: 'anleggsnavn', naboPrefiks: 'prefiks', naboCluster: 'cluster'};
  for (const [id, nokkel] of Object.entries(felt)) {
    $(id).addEventListener('input', (e) => senere(() => lagreTagging({[nokkel]: e.target.value.trim()}).then(() => tegnNabo())));
  }
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
    const id = e.target.closest('.nabo-k').dataset.id;
    senere(() => { lagreNabo({navn: Object.assign({}, naboInnst().navn, {[id]: e.target.value.trim()})}); tegnNabo(); });
  });
  $('naboKliste').addEventListener('click', (e) => {
    if (!e.target.closest('.nabo-k-fjern')) return;
    const id = e.target.closest('.nabo-k').dataset.id;
    NABO.kilder = NABO.kilder.filter(x => x.id !== id); tegnNabo();
  });
  $('naboFil').addEventListener('change', (e) => { leggTilFiler(e.target.files); e.target.value = ''; });
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
    if (e.key === 'Escape' && !ov.hidden) { e.preventDefault(); e.stopPropagation(); lukkNabo(); }
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
