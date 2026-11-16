/* NABE - the schematic: an air handling unit or a set of heating circuits
   drawn from what the points are called.

   Nobody draws anything. A point's name and description are read against the
   dictionaries in nabe-skjema-ordbok.js, the points are gathered into
   components (a fan with its signal, its run state and its alarm), the
   components into systems (360.001, 320.012), and a system is laid out the
   way such a plant is always laid out: outdoor air in on the left of the
   supply duct, extract air back along the duct above it, heat recovery
   between the two.

   It is a picture of the names, not of the building. A sensor NABE cannot
   place is still shown, in a row of its own under the drawing, so nothing a
   technician is looking for is hidden by a guess.

   Read-only. Clicking a component selects its point, and the inspector does
   the rest. Loaded after nabe-skjema-ordbok.js. */
'use strict';

(function skjema() {
  const O = SKJEMA_ORDBOK;
  const slaa = (liste, tekst) => { for (const [re, v] of liste) if (re.test(tekst)) return v; return null; };
  const kamel = (s) => String(s || '').replace(/([a-zæøå])([A-ZÆØÅ])/g, '$1 $2').replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2').replace(/[_.\-/]+/g, ' ');
  const MAALT = [[/celsius|kelvin|fahrenheit|°c/, 'temp'], [/pascal|\bbar\b|\bpa\b|kpa/, 'trykk'],
                 [/cubic|liters?-per|m³\/h|l\/s/, 'mengde'], [/parts-per-million|ppm/, 'co2'], [/relative-humidity|%rh/, 'fukt']];

  /* ----------------------------------------------------------- one name */
  function tolkNavn(navn) {
    const n = String(navn || '');
    let sys = '', etterSys = 0, m;
    const reS = /(?<![0-9])(\d{3})[._](\d{3})(?![0-9])|(?<![0-9A-Za-z])(\d{2})[._](\d{2})(?![0-9])/g;
    while ((m = reS.exec(n))) { sys = m[1] ? m[1] + '.' + m[2] : m[3] + '.' + m[4]; etterSys = m.index + m[0].length; }
    const reK = /(?<![A-Za-z0-9])([A-Z]{2})(\d{2,4})(?![0-9])/g;
    reK.lastIndex = etterSys;
    let valgt = null;
    while ((m = reK.exec(n))) {
      const art = O.KODE[m[1]];
      if (!art) continue;
      if (!valgt || (O.KODE[valgt[1]] === 'system' && art !== 'system')) valgt = m;
      if (art !== 'system') break;
    }
    const mellom = n.slice(etterSys, valgt ? valgt.index : n.length);
    const rom = (/(?<![A-Za-z0-9])([A-Z]\d{3})(?![0-9])/.exec(mellom) || [])[1] || '';
    let hale = valgt ? n.slice(valgt.index + valgt[0].length) : (sys ? n.slice(etterSys) : '');
    hale = hale.replace(/^[\s_.\-/]+/, '').trim();
    let under = '';
    const u = /^([A-Z]{2})_(.+)$/.exec(hale);
    if (u && O.KODE[u[1]] && (!valgt || u[1] !== valgt[1])) under = u[1];
    return {sys, rom, kode: valgt ? valgt[1] + valgt[2] : '', bokstav: valgt ? valgt[1] : '', nr: valgt ? valgt[2] : '', hale, under};
  }

  /* ---------------------------------------------------------- one point */
  function tolkPunkt(p) {
    const t = tolkNavn(p.name);
    const beskr = String(p.description || '').replace(/^SD\w{2}\s+/, '');
    const b = beskr.toLowerCase();
    const ord = (kamel(t.kode ? t.hale : p.name) + ' ' + beskr).toLowerCase();
    const enhet = String(p.units || p.unit || '').toLowerCase();
    const maalt = slaa(MAALT, enhet);

    // What it is to its component: the tail of the name, then the description, then the object type.
    const haleRen = (t.under ? t.hale.slice(3) : t.hale).toLowerCase();
    let rolle = haleRen ? slaa(O.HALE, haleRen) : null;
    if (!rolle) rolle = slaa(O.ROLLE, ord);
    if (!rolle && t.kode && haleRen) rolle = 'annet';
    const type = String(p.type || '');

    // What kind of thing: the code, corrected by the words where the code is used for several things.
    let art = t.under ? O.KODE[t.under] : (t.bokstav ? O.KODE[t.bokstav] : null);
    const iOrd = slaa(O.TYPE, ord);
    if (art === 'kvalitet') art = iOrd === 'royk' || iOrd === 'co2' ? iOrd : (maalt === 'co2' ? 'co2' : 'royk');
    if ((art === 'trykk' || art === 'difftrykk') && iOrd === 'filter') art = 'filter';
    if (art === 'frost') rolle = 'alarm';
    if (!art) art = maalt && (!rolle || rolle === 'pv' || rolle === 'sp' || rolle === 'innstilling') ? maalt : iOrd;

    if (!rolle) {
      rolle = type === 'analog-input' ? 'pv' : type === 'analog-output' ? 'paadrag'
        : type === 'binary-output' ? 'start'
        : type.startsWith('multi-state') ? 'vender'
        : type.startsWith('binary') ? (art === 'filter' || art === 'royk' || art === 'frost' ? 'alarm' : 'drift')
        : type === 'analog-value' ? 'pv' : 'annet';
    }
    if (rolle === 'pv' && type.startsWith('binary')) rolle = art === 'filter' || art === 'royk' ? 'alarm' : 'drift';
    // A number cannot be a run state or a switch. Without a code to say otherwise it is a setting.
    if (!t.kode && type.startsWith('analog') && ['start', 'drift', 'vender'].includes(rolle)) rolle = 'annet';

    // Where: the words, then what the number usually means.
    let sted = slaa(O.STED, ord);
    const hvor = slaa(O.TYPE.filter(x => ['varmebatteri', 'kjolebatteri', 'gjenvinner', 'veksler'].includes(x[1])), b);
    if (!sted && t.nr) {
      if (art === 'temp' && /^9\d\d?$|^0?01$/.test(t.nr) && !b) sted = 'ute';
      else if (/^4/.test(t.nr)) sted = '4';
      else if (/^5/.test(t.nr)) sted = '5';
    }
    return {p, sys: t.sys, rom: t.rom, kode: t.kode, under: t.under, art: art || '', rolle, sted: sted || '', hvor: hvor || '', beskr, maalt: maalt || ''};
  }

  /* ----------------------------------------------- points into systems */
  function byggSystemer(punkter) {
    const systemer = new Map();
    for (const p of punkter || []) {
      if (!p || p.type === 'schedule' || p.type === 'calendar' || String(p.type).startsWith('trend')) continue;
      const x = tolkPunkt(p);
      if (!x.art) continue;
      if (!systemer.has(x.sys)) systemer.set(x.sys, {id: x.sys, komp: new Map(), rom: new Set(), type: ''});
      const s = systemer.get(x.sys);
      if (x.rom) { s.rom.add(x.rom); continue; }
      const maaling = ['temp', 'trykk', 'difftrykk', 'mengde', 'fukt', 'co2'].includes(x.art);
      const nokkel = x.kode ? x.kode + (x.under ? '/' + x.under : '') : x.art + ':' + (x.sted || (maaling ? x.hvor : '') || '');
      if (!s.komp.has(nokkel)) {
        s.komp.set(nokkel, {nokkel, sys: x.sys, kode: x.kode ? (x.under ? '' : x.kode) : '', eier: x.under ? x.kode : '',
          art: x.art, sted: '', hvor: '', beskr: '', pkt: {alarm: [], annet: []}});
      }
      const k = s.komp.get(nokkel);
      if (!k.sted && x.sted) k.sted = x.sted;
      if (!k.hvor && x.hvor) k.hvor = x.hvor;
      if (x.beskr && (!k.beskr || (x.rolle === 'pv' && !k.pkt.pv))) k.beskr = x.beskr.split(' - ')[0].trim();
      if (x.rolle === 'sp') (k.spAlle = k.spAlle || []).push({p, sted: x.sted});
      if (x.rolle === 'alarm') k.pkt.alarm.push(p);
      else if (x.rolle === 'annet' || x.rolle === 'innstilling') k.pkt.annet.push(p);
      else if (!k.pkt[x.rolle]) k.pkt[x.rolle] = p;
      else if (x.rolle === 'pv' && k.pkt.pv.type !== 'analog-input' && p.type === 'analog-input') { k.pkt.annet.push(k.pkt.pv); k.pkt.pv = p; }
      else k.pkt.annet.push(p);
    }
    const ut = [];
    for (const s of systemer.values()) {
      const arter = new Set([...s.komp.values()].map(k => k.art));
      s.type = slaa(O.SYSTEM, s.id.replace('.', '')) || '';
      const harVent = O.VENT.some(a => arter.has(a)) && arter.has('vifte');
      const harVarme = O.VARME.some(a => arter.has(a));
      if (s.type === 'ventilasjon' && !harVent) s.type = arter.has('spjeld') || arter.has('vav') ? 'ventilasjon-rom' : '';
      if (!s.type || s.type === 'sd' || s.type === 'el') s.type = harVent ? 'ventilasjon' : harVarme ? 'varme' : '';
      // A setpoint that hangs on the system itself, or on a fan, belongs to the sensor it is the setpoint for.
      const alle = [...s.komp.values()];
      const kodet = alle.filter(k => (k.kode || k.eier) && k.art !== 'system').length >= 3;
      for (const k of alle) {
        const giver = k.art === 'system' || k.art === 'vifte' || (kodet && !k.kode && !k.eier);
        if (!giver) continue;
        for (const c of k.spAlle || []) {
          const m = slaa(MAALT, String(c.p.units || '').toLowerCase());
          const maal = alle.find(z => z !== k && z.art === m && !z.pkt.sp && z.pkt.pv && (z.kode || !kodet)
            && (k.art === 'vifte' ? sideAv(z) === sideAv(k) : !!c.sted && z.sted === c.sted));
          if (maal) { maal.pkt.sp = c.p; if (k.pkt.sp === c.p) delete k.pkt.sp; }
        }
      }
      // Where the plant names its parts with codes, a point without one is a setting of the
      // program, not a part of the plant: it has given away its setpoint above and is left out.
      s.komp = alle.filter(k => k.art !== 'system' && (!kodet || k.kode || k.eier));
      if (s.komp.length || s.rom.size) ut.push(s);
    }
    return ut.sort((a, b) => a.id.localeCompare(b.id, 'no', {numeric: true}));
  }

  /* Which duct, or which pipe. "4" and "5" are what the number says when no word does. */
  function sideAv(k) {
    if (['tilluft', 'inntak', 'ettergjenvinner', '4', 'tur'].includes(k.sted)) return 'til';
    if (['avtrekk', 'avkast', '5', 'retur'].includes(k.sted)) return 'fra';
    return '';
  }

  /* ====== tegning ======================================================
     Everything below draws. The interpreter above knows nothing about it. */

  const NAVN = {
    inntak: ['Inntak', 'Intake'], tilluft: ['Tilluft', 'Supply'], avtrekk: ['Avtrekk', 'Extract'], avkast: ['Avkast', 'Exhaust'],
    ettergjenvinner: ['Etter gjenvinner', 'After recovery'], batteriretur: ['Retur batteri', 'Coil return'],
    ute: ['Ute', 'Outdoor'], tur: ['Tur', 'Flow'], retur: ['Retur', 'Return'], rom: ['Rom', 'Room'],
  };
  const ART = {
    temp: ['Temperatur', 'Temperature'], trykk: ['Trykk', 'Pressure'], difftrykk: ['Difftrykk', 'Diff. pressure'], mengde: ['Mengde', 'Flow'],
    fukt: ['Fukt', 'Humidity'], co2: ['CO2', 'CO2'], vifte: ['Vifte', 'Fan'], pumpe: ['Pumpe', 'Pump'], ventil: ['Ventil', 'Valve'],
    spjeld: ['Spjeld', 'Damper'], filter: ['Filter', 'Filter'], gjenvinner: ['Gjenvinner', 'Recovery'], varmebatteri: ['Varmebatteri', 'Heating coil'],
    kjolebatteri: ['Kjølebatteri', 'Cooling coil'], royk: ['Røyk', 'Smoke'], frost: ['Frost', 'Frost'], varmepumpe: ['Varmepumpe', 'Heat pump'],
    elkjel: ['Elkjel', 'Electric boiler'], tank: ['Tank', 'Tank'], veksler: ['Veksler', 'Exchanger'], energimaaler: ['Energimåler', 'Energy meter'],
    bevegelse: ['Bevegelse', 'Motion'], vav: ['VAV', 'VAV'], kjel: ['Kjel', 'Boiler'], varmekabel: ['Varmekabel', 'Heating cable'],
    kompressor: ['Kompressor', 'Compressor'], radiator: ['Radiator', 'Radiator'], omformer: ['Omformer', 'Drive'], fjernvarme: ['Fjernvarme', 'District heating'],
  };
  const tn = (tabell, k) => tabell[k] ? T(tabell[k][0], tabell[k][1]) : k;
  // In a drawing the label has a few centimetres: the code when there is one, else a short word.
  const KORT = {temp: ['Temp', 'Temp'], varmebatteri: ['Varme', 'Heating'], kjolebatteri: ['Kjøling', 'Cooling'], difftrykk: ['ΔP', 'ΔP']};
  const merke = (k) => k.kode || k.eier || tn(KORT[k.art] ? KORT : ART, k.art);

  /* --- reading a component's state from its points --- */
  const paa = (p) => !!p && (p.value === 'active' || p.value === true || p.value === 1 || (typeof p.value === 'number' && p.value > 0.5 && !String(p.type).startsWith('multi')));
  function verdi(p) {
    if (!p) return '';
    const v = p.value;
    if (v === 'active' || v === 'inactive') {
      const st = Array.isArray(p.state_text) ? p.state_text[v === 'active' ? 1 : 0] : null;
      return st || (v === 'active' ? T('på', 'on') : T('av', 'off'));
    }
    if (String(p.type).startsWith('multi') && Array.isArray(p.state_text) && typeof v === 'number') return p.state_text[v - 1] || String(v);
    if (v === null || v === undefined) return '—';
    const u = p.unit_symbol || p.unit || '';
    const tall = typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')) : String(v);
    return tall + (u ? ' ' + u : '');
  }
  function iHaand(k) {
    const v = k.pkt.vender;
    if (v && Array.isArray(v.state_text) && typeof v.value === 'number') {
      const navn = String(v.state_text[v.value - 1] || '').toLowerCase().trim();
      if (navn) return !O.AUTO.test(navn);
    }
    return Object.values(k.pkt).flat().some(p => p && (p.status || []).includes('overridden'));
  }
  const iAlarm = (k) => k.pkt.alarm.some(p => p.value === 'active' || (p.status || []).includes('in-alarm'))
    || Object.values(k.pkt).flat().some(p => p && (p.status || []).includes('in-alarm'));
  const iFeil = (k) => Object.values(k.pkt).flat().some(p => p && (p.status || []).includes('fault'));
  const iDrift = (k) => paa(k.pkt.drift) || paa(k.pkt.start) || (k.pkt.paadrag && typeof k.pkt.paadrag.value === 'number' && k.pkt.paadrag.value > 0.5);
  // The point a click lands on: the reading for a sensor, the signal for a machine.
  const MASKIN = ['vifte', 'pumpe', 'ventil', 'spjeld', 'gjenvinner', 'varmebatteri', 'kjolebatteri'];
  const hoved = (k) => (MASKIN.includes(k.art) ? (k.pkt.paadrag || k.pkt.drift || k.pkt.start || k.pkt.pv) : (k.pkt.pv || k.pkt.paadrag || k.pkt.drift || k.pkt.start))
    || k.pkt.virkningsgrad || k.pkt.alarm[0] || k.pkt.vender || k.pkt.sp || k.pkt.annet[0];
  const tittel = (k) => [k.kode || k.eier, k.beskr, ...Object.entries(k.pkt).filter(([r, p]) => p && !Array.isArray(p)).map(([r, p]) => `${r}: ${verdi(p)}`),
    k.pkt.alarm.length ? `${k.pkt.alarm.length} ${T('alarmpunkt', 'alarm points')}` : ''].filter(Boolean).join('\n');

  /* --- drawing primitives. All sizes in the drawing's own units. --- */
  const klasser = (k, mer) => `sk-k${iAlarm(k) ? ' alarm' : iFeil(k) ? ' feil' : ''}${iHaand(k) ? ' haand' : ''}${iDrift(k) ? ' drift' : ''}${mer ? ' ' + mer : ''}`;
  const gruppe = (k, mer, inni) => {
    const h = hoved(k);
    return `<g class="${klasser(k, mer)}" data-o="${esc(h ? h.objid : '')}" tabindex="0" role="button"><title>${esc(tittel(k))}</title>${inni}</g>`;
  };
  const tekst = (x, y, t, kl, anker) => `<text x="${x}" y="${y}" class="${kl}" text-anchor="${anker || 'middle'}">${esc(t)}</text>`;
  const haandMerke = (k, x, y) => iHaand(k) ? `<g class="sk-hm"><rect x="${x - 9}" y="${y - 8}" width="18" height="13" rx="3"/><text x="${x}" y="${y + 2}" text-anchor="middle">${T('H', 'H')}</text></g>` : '';
  const varsel = (k, x, y) => iAlarm(k) ? `<path class="sk-am" d="M${x} ${y - 7}l7 12h-14z"/>` : '';

  /* A sensor: a short stem off the duct or pipe, a small ring with its letter, and its numbers. */
  function foler(k, x, y, opp, bokstav) {
    const r = opp ? -1 : 1, cy = y + r * 28;
    const linjer = [k.pkt.pv ? verdi(k.pkt.pv) : (k.pkt.alarm.length ? (iAlarm(k) ? T('alarm', 'alarm') : 'ok') : ''), k.pkt.sp ? verdi(k.pkt.sp) : ''].filter(Boolean);
    const ty = opp ? cy - 18 - (linjer.length) * 16 : cy + 28;
    return gruppe(k, 'foler', `<line class="sk-stilk" x1="${x}" y1="${y}" x2="${x}" y2="${cy - r * 10}"/><circle class="sk-ring" cx="${x}" cy="${cy}" r="10"/>
      ${tekst(x, cy + 4, bokstav, 'sk-bok')}${tekst(x, ty, merke(k), 'sk-kode')}
      ${linjer[0] ? tekst(x, ty + 16, linjer[0], 'sk-v') : ''}${linjer[1] ? tekst(x, ty + 32, linjer[1], 'sk-sp') : ''}${varsel(k, x + 16, cy)}`);
  }
  const BOK = {temp: 'T', trykk: 'P', difftrykk: 'ΔP', mengde: 'Q', fukt: 'φ', co2: 'C', royk: 'R', frost: 'F', bevegelse: 'B'};

  /* A fan or a pump: a circle with the direction of flow in it. */
  function rotor(k, x, y, retning, r) {
    r = r || 20;
    const pil = retning === 'v' ? `M${x + r * .55} ${y - r * .62}L${x - r * .7} ${y}L${x + r * .55} ${y + r * .62}z`
      : retning === 'o' ? `M${x - r * .62} ${y + r * .55}L${x} ${y - r * .7}L${x + r * .62} ${y + r * .55}z`
      : `M${x - r * .55} ${y - r * .62}L${x + r * .7} ${y}L${x - r * .55} ${y + r * .62}z`;
    const p = k.pkt.paadrag || k.pkt.pv;
    return gruppe(k, 'rotor', `<circle class="sk-kropp" cx="${x}" cy="${y}" r="${r}"/><path class="sk-pil" d="${pil}"/>
      ${tekst(x, y - r - 25, merke(k), 'sk-kode')}${p ? tekst(x, y - r - 9, verdi(p), 'sk-v') : ''}${haandMerke(k, x + r, y + r - 2)}${varsel(k, x - r - 2, y - r + 4)}`);
  }
  /* A box across the duct, with what it is drawn inside. */
  function boks(k, x, y, h, type) {
    const b = 34, x0 = x - b / 2, y0 = y - h / 2;
    const inni = type === 'filter' ? `<path class="sk-strek" d="M${x0} ${y0}L${x0 + b} ${y0 + h / 3}L${x0} ${y0 + 2 * h / 3}L${x0 + b} ${y0 + h}"/>`
      : type === 'spjeld' ? `<line class="sk-strek" x1="${x}" y1="${y0 + 7}" x2="${x}" y2="${y0 + h - 7}" transform="rotate(${iDrift(k) ? 0 : 62} ${x} ${y})"/><circle class="sk-dot" cx="${x}" cy="${y}" r="2.4"/>`
      : `<line class="sk-strek" x1="${x - 7}" y1="${y}" x2="${x + 7}" y2="${y}"/>${type === 'varmebatteri' ? `<line class="sk-strek" x1="${x}" y1="${y - 7}" x2="${x}" y2="${y + 7}"/>` : ''}`;
    const p = k.pkt.paadrag || (type === 'spjeld' ? (k.pkt.start || k.pkt.drift) : null);
    const v = p ? verdi(p) : (k.pkt.alarm.length ? (iAlarm(k) ? T('alarm', 'alarm') : 'ok') : '');
    return gruppe(k, type, `<rect class="sk-kropp" x="${x0}" y="${y0}" width="${b}" height="${h}" rx="5"/>${inni}
      ${tekst(x, y0 - 24, merke(k), 'sk-kode')}${v ? tekst(x, y0 - 8, v, 'sk-v') : ''}${haandMerke(k, x0 + b, y0 + h - 2)}${varsel(k, x0 - 2, y0 + 4)}`);
  }
  function ventil(k, x, y, staaende) {
    const d = staaende ? `M${x - 8} ${y - 10}L${x + 8} ${y - 10}L${x - 8} ${y + 10}L${x + 8} ${y + 10}z` : `M${x - 10} ${y - 8}L${x - 10} ${y + 8}L${x + 10} ${y - 8}L${x + 10} ${y + 8}z`;
    const p = k.pkt.paadrag || k.pkt.pv;
    return gruppe(k, 'ventil', `<path class="sk-kropp" d="${d}"/>${tekst(x + 18, y - 2, merke(k), 'sk-kode', 'start')}${p ? tekst(x + 18, y + 14, verdi(p), 'sk-v', 'start') : ''}${haandMerke(k, x - 16, y + 2)}${varsel(k, x - 16, y - 12)}`);
  }

  /* ------------------------------------------------------------- the AHU */
  function tegnAggregat(s) {
    const B = 1000, yA = 190, yT = 368, hK = 38, xG = 430;
    const K = s.komp, tatt = new Set();
    const ta = (f) => { const l = K.filter(k => !tatt.has(k) && f(k)); l.forEach(k => tatt.add(k)); return l; };
    const en = (f) => { const k = K.find(k => !tatt.has(k) && f(k)); if (k) tatt.add(k); return k; };
    const paaSted = (art, ...steder) => (k) => (Array.isArray(art) ? art.includes(k.art) : k.art === art) && steder.includes(k.sted);
    let d = '';

    const gj = en(k => k.art === 'gjenvinner');
    const batt = en(k => k.art === 'varmebatteri');
    const kjol = en(k => k.art === 'kjolebatteri');
    const vann = {pumpe: en(k => k.art === 'pumpe' && (k.hvor === 'varmebatteri' || /^SB|^LV/.test(k.eier))) || en(k => k.art === 'pumpe'),
                  ventil: en(k => k.art === 'ventil' && (k.hvor === 'varmebatteri' || !k.hvor)),
                  retur: en(paaSted('temp', 'batteriretur')), frost: en(k => k.art === 'frost' && k.hvor !== 'gjenvinner')};
    const harBatt = batt || vann.ventil || vann.pumpe || vann.retur;

    // ducts: four tinted stretches, the recovery unit between the two
    const kanal = (x1, x2, y, kl) => `<rect class="sk-kanal ${kl}" x="${x1}" y="${y - hK / 2}" width="${x2 - x1}" height="${hK}" rx="3"/>`;
    d += kanal(50, xG, yA, 'avkast') + kanal(xG, B - 40, yA, 'avtrekk') + kanal(50, xG, yT, 'ute') + kanal(xG, B - 40, yT, 'tilluft');
    const pil = (x, y, v) => `<path class="sk-flyt" d="M${x} ${y - 6}l${v ? -9 : 9} 6l${v ? 9 : -9} 6"/>`;
    d += pil(34, yT, false) + pil(B - 22, yT, false) + pil(B - 26, yA, true) + pil(30, yA, true);
    d += tekst(58, yT + 4, T('Uteluft', 'Outdoor air'), 'sk-etikett', 'start') + tekst(B - 50, yT + 4, T('Tilluft', 'Supply air'), 'sk-etikett', 'end')
       + tekst(B - 50, yA + 4, T('Avtrekk', 'Extract air'), 'sk-etikett', 'end') + tekst(58, yA + 4, T('Avkast', 'Exhaust air'), 'sk-etikett', 'start');

    // a row of things along a duct, spread over the room they are given
    const rekke = (liste, x1, x2, tegn) => { const n = liste.length; liste.forEach((k, i) => { d += tegn(k, n === 1 ? (x1 + x2) / 2 : x1 + (x2 - x1) * i / (n - 1)); }); };
    const fol = (y, opp) => (k, x) => foler(k, x, y + (opp ? -hK / 2 : hK / 2), opp, BOK[k.art] || '?');

    // supply side, left to right
    rekke(ta(paaSted(['temp', 'fukt'], 'inntak')), 150, 150, fol(yT, false));
    rekke(ta(paaSted('spjeld', 'inntak')), 225, 225, (k, x) => boks(k, x, yT, hK + 18, 'spjeld'));
    rekke(ta(k => k.art === 'filter' && ['inntak', 'tilluft', '4'].includes(k.sted)), 310, 310, (k, x) => boks(k, x, yT, hK + 18, 'filter'));
    rekke(ta(paaSted(['temp', 'fukt'], 'ettergjenvinner')), 500, 500, fol(yT, true));
    if (harBatt) d += boks(batt || {kode: '', eier: '', art: 'varmebatteri', beskr: '', pkt: {alarm: [], annet: []}}, 580, yT, hK + 18, 'varmebatteri');
    if (kjol) d += boks(kjol, 650, yT, hK + 18, 'kjolebatteri');
    rekke(ta(paaSted('vifte', 'tilluft', '4')), 725, 725, (k, x) => rotor(k, x, yT, 'h', 24));
    rekke(ta(k => ['royk', 'trykk', 'difftrykk', 'mengde', 'temp', 'fukt', 'co2'].includes(k.art) && ['tilluft', '4'].includes(k.sted))
      .sort((a, b) => (a.art === 'temp') - (b.art === 'temp')), 800, 930, fol(yT, false));

    // extract side, air moving right to left
    rekke(ta(k => ['temp', 'trykk', 'difftrykk', 'mengde', 'fukt', 'co2', 'royk'].includes(k.art) && ['avtrekk', '5'].includes(k.sted))
      .sort((a, b) => (b.art === 'temp') - (a.art === 'temp')).reverse(), 800, 930, fol(yA, true));
    rekke(ta(k => k.art === 'filter' && ['avtrekk', '5'].includes(k.sted)), 600, 600, (k, x) => boks(k, x, yA, hK + 18, 'filter'));
    rekke(ta(paaSted('vifte', 'avtrekk', '5')), 325, 325, (k, x) => rotor(k, x, yA, 'v', 24));
    rekke(ta(paaSted('spjeld', 'avkast')), 225, 225, (k, x) => boks(k, x, yA, hK + 18, 'spjeld'));
    rekke(ta(paaSted(['temp', 'fukt'], 'avkast')), 150, 150, fol(yA, true));

    // heat recovery, across both ducts
    if (gj) {
      const y0 = yA - 46, h = yT - yA + 92, v = gj.pkt.virkningsgrad;
      d += gruppe(gj, 'gjenvinner', `<rect class="sk-kropp" x="${xG - 24}" y="${y0}" width="48" height="${h}" rx="10"/>
        <path class="sk-strek" d="M${xG - 12} ${yA + 52}A40 40 0 0 1 ${xG + 12} ${yA + 52}M${xG + 12} ${yT - 52}A40 40 0 0 1 ${xG - 12} ${yT - 52}"/>
        <path class="sk-pil" d="M${xG + 12} ${yA + 52}l-8 -2l5 -6z M${xG - 12} ${yT - 52}l8 2l-5 6z"/>
        ${tekst(xG - 34, (yA + yT) / 2 - 14, merke(gj), 'sk-kode', 'end')}
        ${gj.pkt.paadrag ? tekst(xG - 34, (yA + yT) / 2 + 2, verdi(gj.pkt.paadrag), 'sk-v', 'end') : ''}
        ${v ? tekst(xG - 34, (yA + yT) / 2 + 18, 'η ' + verdi(v), 'sk-v', 'end') : ''}${haandMerke(gj, xG + 24, y0 + h - 4)}${varsel(gj, xG - 26, y0 + 6)}`);
    }

    // the water side of the heating coil
    let yBunn = yT + 110;
    if (vann.ventil || vann.pumpe || vann.retur) {
      const xt = 573, xr = 587, y1 = yT + (hK + 18) / 2, y2 = y1 + 132;
      d += `<line class="sk-ror tur" x1="${xt}" y1="${y1}" x2="${xt}" y2="${y2}"/><line class="sk-ror retur" x1="${xr}" y1="${y1}" x2="${xr}" y2="${y2}"/>`;
      if (vann.retur) d += gruppe(vann.retur, 'foler', `<line class="sk-stilk" x1="${xr}" y1="${y1 + 22}" x2="${xr + 22}" y2="${y1 + 22}"/><circle class="sk-ring" cx="${xr + 31}" cy="${y1 + 22}" r="9"/>
        ${tekst(xr + 31, y1 + 26, 'T', 'sk-bok')}${tekst(xr + 47, y1 + 18, merke(vann.retur), 'sk-kode', 'start')}${tekst(xr + 47, y1 + 34, verdi(vann.retur.pkt.pv), 'sk-v', 'start')}`);
      if (vann.pumpe) d += rotor2(vann.pumpe, xt, y1 + 64);
      if (vann.ventil) d += ventil(vann.ventil, xr, y1 + 106, true);
      if (vann.frost) d += gruppe(vann.frost, 'foler', `<circle class="sk-ring" cx="${xt - 36}" cy="${y1 + 22}" r="9"/>${tekst(xt - 36, y1 + 25.5, 'F', 'sk-bok')}
        ${tekst(xt - 50, y1 + 18, T('Frost', 'Frost'), 'sk-kode', 'end')}${tekst(xt - 50, y1 + 34, iAlarm(vann.frost) ? T('alarm', 'alarm') : 'ok', 'sk-v', 'end')}${varsel(vann.frost, xt - 36, y1 + 4)}`);
      yBunn = y2 + 20;
    }
    function rotor2(k, x, y) {
      const r = 12, p = k.pkt.paadrag || k.pkt.start || k.pkt.drift;
      return gruppe(k, 'rotor', `<circle class="sk-kropp" cx="${x}" cy="${y}" r="${r}"/><path class="sk-pil" d="M${x - 7} ${y + 5}L${x} ${y - 8}L${x + 7} ${y + 5}z"/>
        ${tekst(x - 20, y - 2, merke(k) === k.eier ? T('Pumpe', 'Pump') : merke(k), 'sk-kode', 'end')}${p ? tekst(x - 20, y + 14, verdi(p), 'sk-v', 'end') : ''}${haandMerke(k, x + 16, y + 14)}${varsel(k, x + 16, y - 8)}`);
    }

    // outdoor temperature, and what the dictionaries could not place
    const ute = ta(paaSted(['temp', 'fukt'], 'ute'));
    ute.forEach((k, i) => { d += foler(k, 70 + i * 62, 84, true, BOK[k.art]); });
    if (ute.length) d += `<path class="sk-strek svak" d="M48 84h${ute.length * 62 - 18}"/>` + tekst(48, 100, T('Ute', 'Outdoor'), 'sk-etikett', 'start');
    return {svg: d, bredde: B, hoyde: yBunn, topp: ute.length ? 0 : 76, rest: K.filter(k => !tatt.has(k))};
  }

  /* ----------------------------------------------------- heating circuits */
  function kursNavn(s) {
    const k = s.komp.find(z => z.art === 'temp' && z.sted === 'tur') || s.komp.find(z => z.beskr);
    const n = (k ? k.beskr : '').replace(/temperaturf[øo]ler|tempgiver|turtemp\.?|temp\.?|trykkgiver|sirkulasjonspumpe|ventilmotor|\btur\b|\bretur\b/gi, '').replace(/\s+/g, ' ').trim();
    return n ? n[0].toUpperCase() + n.slice(1) : '';
  }
  function tegnKurser(systemer) {
    const kb = 300, x0 = 110, yTopp = 96, yTur = 560, yRet = 612, B = x0 + systemer.length * kb + 30;
    let d = `<line class="sk-ror tur" x1="40" y1="${yTur}" x2="${B - 40}" y2="${yTur}"/><line class="sk-ror retur" x1="40" y1="${yRet}" x2="${B - 40}" y2="${yRet}"/>
      <path class="sk-flyt" d="M34 ${yTur - 6}l9 6l-9 6"/><path class="sk-flyt" d="M43 ${yRet - 6}l-9 6l9 6"/>`;
    const rest = [];
    let ute = null;
    systemer.forEach((s, i) => {
      const xt = x0 + i * kb + 110, xr = xt + 62, tatt = new Set();
      const ta = (f) => { const l = s.komp.filter(k => !tatt.has(k) && f(k)); l.forEach(k => tatt.add(k)); return l; };
      d += `<line class="sk-ror tur" x1="${xt}" y1="${yTopp + 34}" x2="${xt}" y2="${yTur}"/><line class="sk-ror retur" x1="${xr}" y1="${yTopp + 34}" x2="${xr}" y2="${yRet}"/>
        <path class="sk-flyt" d="M${xt - 6} ${yTopp + 44}l6 -9l6 9"/><path class="sk-flyt" d="M${xr - 6} ${yTopp + 35}l6 9l6 -9"/>
        <circle class="sk-dot" cx="${xt}" cy="${yTur}" r="3"/><circle class="sk-dot" cx="${xr}" cy="${yRet}" r="3"/>`;
      d += tekst(xt + 31, yTopp - 8, s.id || T('Kurs', 'Circuit'), 'sk-tittel') + tekst(xt + 31, yTopp + 10, kursNavn(s).slice(0, 30), 'sk-under');
      const u = ta(k => k.art === 'temp' && k.sted === 'ute');
      if (u[0] && !ute) ute = u[0];
      // sensors: flow side to the left of the flow pipe, return side to the right of the return pipe
      const side = (liste, x, venstre, y0) => liste.forEach((k, n) => {
        const y = y0 + n * 56, cx = x + (venstre ? -31 : 31);
        d += gruppe(k, 'foler', `<line class="sk-stilk" x1="${x}" y1="${y}" x2="${cx + (venstre ? 9 : -9)}" y2="${y}"/><circle class="sk-ring" cx="${cx}" cy="${y}" r="9"/>
          ${tekst(cx, y + 4, BOK[k.art] || '?', 'sk-bok')}${tekst(cx + (venstre ? -15 : 15), y - 4, merke(k), 'sk-kode', venstre ? 'end' : 'start')}
          ${tekst(cx + (venstre ? -15 : 15), y + 12, verdi(k.pkt.pv), 'sk-v', venstre ? 'end' : 'start')}${k.pkt.sp ? tekst(cx + (venstre ? -15 : 15), y + 28, verdi(k.pkt.sp), 'sk-sp', venstre ? 'end' : 'start') : ''}${varsel(k, cx, y - 16)}`);
      });
      const maal = ['temp', 'trykk', 'difftrykk', 'mengde'];
      side(ta(k => maal.includes(k.art) && k.pkt.pv && ['tur', '4'].includes(k.sted)).slice(0, 4), xt, true, yTopp + 78);
      side(ta(k => maal.includes(k.art) && k.pkt.pv && ['retur', '5'].includes(k.sted)).slice(0, 4), xr, false, yTopp + 78);
      const pumper = ta(k => k.art === 'pumpe').slice(0, 2);
      pumper.forEach((k, n) => {
        const y = yTur - 118 + n * 60, p = k.pkt.paadrag || k.pkt.start || k.pkt.drift;
        d += gruppe(k, 'rotor', `<circle class="sk-kropp" cx="${xt}" cy="${y}" r="14"/><path class="sk-pil" d="M${xt - 8} ${y + 6}L${xt} ${y - 9}L${xt + 8} ${y + 6}z"/>
          ${tekst(xt - 22, y - 2, merke(k), 'sk-kode', 'end')}${p ? tekst(xt - 22, y + 14, verdi(p), 'sk-v', 'end') : ''}${haandMerke(k, xt + 17, y + 15)}${varsel(k, xt + 17, y - 9)}`);
      });
      ta(k => k.art === 'ventil').slice(0, 2).forEach((k, n) => { d += ventil(k, xr, yRet - 118 + n * 60, true); });
      // what else the circuit has, as quiet labels under its name
      const annet = ta(k => ['varmepumpe', 'elkjel', 'kjel', 'tank', 'veksler', 'energimaaler', 'fjernvarme', 'kompressor'].includes(k.art));
      const tell = new Map();
      annet.forEach(k => tell.set(k.art, (tell.get(k.art) || 0) + 1));
      const linje = [...tell].map(([a, n]) => (n > 1 ? n + ' ' : '') + tn(ART, a).toLowerCase()).concat(s.rom.size ? [`${s.rom.size} ${T('rom', 'rooms')}`] : []).join(' · ');
      if (linje) d += tekst(xt + 31, yTopp + 28, linje.slice(0, 34), 'sk-under svak');
      rest.push(...s.komp.filter(k => !tatt.has(k)));
    });
    if (ute) d += foler(ute, 62, 118, true, 'T') + tekst(62, 136, T('Ute', 'Outdoor'), 'sk-etikett');
    return {svg: d, bredde: B, hoyde: yRet + 36, topp: 40, rest};
  }

  /* ------------------------------------------------------------ the pane */
  const SK = {vis: false, valgt: {}, sist: '', systemer: [], ip: ''};
  const tegnbare = (s) => (s.type === 'ventilasjon' && s.komp.length >= 3) || ((s.type === 'varme' || s.type === 'kjoling') && s.komp.length >= 2);

  const wrap = document.createElement('div');
  wrap.id = 'skjemaWrap';
  wrap.className = 'skjema';
  wrap.hidden = true;
  const bryter = document.createElement('div');
  bryter.className = 'sk-bryter';
  bryter.hidden = true;
  bryter.setAttribute('role', 'tablist');
  bryter.innerHTML = `<button type="button" data-v="tabell" role="tab">${T('Tabell', 'Table')}</button><button type="button" data-v="skjema" role="tab">${T('Skjema', 'Schematic')}</button>`;
  const pw = $('pointsWrap'), fb = document.querySelector('.filterbar');
  if (pw) pw.after(wrap);
  if (fb) fb.prepend(bryter);

  function faner() {
    const vent = SK.systemer.filter(s => s.type === 'ventilasjon');
    const f = vent.map(s => ({id: 'v:' + s.id, navn: (s.id ? s.id + ' ' : '') + T('Aggregat', 'Air handling'), type: 'aggregat', s}));
    for (const [type, navn] of [['varme', T('Varme', 'Heating')], ['kjoling', T('Kjøling', 'Cooling')]]) {
      const l = SK.systemer.filter(s => s.type === type);
      if (l.length) f.push({id: type, navn: `${navn} · ${l.length} ${T(l.length === 1 ? 'kurs' : 'kurser', l.length === 1 ? 'circuit' : 'circuits')}`, type: 'kurser', l});
    }
    return f;
  }

  function oppdater() {
    const ip = S.activeDev ? S.activeDev.address : '';
    const sig = ip + '|' + S.points.length;
    if (sig !== SK.sist) {
      SK.sist = sig; SK.ip = ip;
      SK.systemer = ip ? byggSystemer(S.points).filter(tegnbare) : [];
    } else {
      // same device, new values: the components hold the point objects, which the poll may have replaced
      const naa = new Map(S.points.map(p => [p.objid, p]));
      for (const s of SK.systemer) for (const k of s.komp) {
        for (const [r, p] of Object.entries(k.pkt)) k.pkt[r] = Array.isArray(p) ? p.map(x => naa.get(x.objid) || x) : (naa.get(p.objid) || p);
      }
    }
    const har = SK.systemer.length > 0;
    bryter.hidden = !har;
    bryter.querySelector('[data-v="tabell"]').textContent = T('Tabell', 'Table');
    bryter.querySelector('[data-v="skjema"]').textContent = T('Skjema', 'Schematic');
    const vis = har && SK.vis;
    bryter.querySelectorAll('button').forEach(b => { const s = (b.dataset.v === 'skjema') === vis; b.classList.toggle('sel', s); b.setAttribute('aria-selected', s); });
    wrap.hidden = !vis;
    if (pw) pw.hidden = vis;
    document.body.classList.toggle('viser-skjema', vis);
    // The drawing needs width. On a small screen it takes the room of the device list
    // unless the technician has said otherwise; the button in its heading gives the list back.
    const pref = loadPrefs().skjemaStor;
    const stor = vis && (pref === undefined ? window.innerWidth < 1500 : !!pref);
    document.body.classList.toggle('sk-stor', stor);
    if (vis) tegn();
  }

  function tegn() {
    const f = faner();
    if (!f.length) { wrap.innerHTML = ''; return; }
    const valgt = f.find(x => x.id === SK.valgt[SK.ip]) || f[0];
    const r = valgt.type === 'aggregat' ? tegnAggregat(valgt.s) : tegnKurser(valgt.l);
    const rest = r.rest.filter(k => hoved(k) && (k.pkt.pv || k.pkt.paadrag || k.pkt.drift || k.pkt.start || k.pkt.alarm.length)).slice(0, 40);
    const rom = valgt.type === 'aggregat' && valgt.s.rom.size ? `<span class="sk-rom">${valgt.s.rom.size} ${T('rom styres herfra', 'rooms are controlled from here')}</span>` : '';
    const minB = valgt.type === 'kurser' ? Math.max(520, r.bredde * 0.72) : 0;
    const stor = document.body.classList.contains('sk-stor');
    const html = `<div class="sk-hode"><div class="sk-faner" role="tablist">${f.map(x => `<button type="button" role="tab" data-fane="${esc(x.id)}" class="${x === valgt ? 'sel' : ''}" aria-selected="${x === valgt}">${esc(x.navn)}</button>`).join('')}</div>
        <span class="sk-forkl"><i class="sk-prikk drift"></i>${T('i drift', 'running')}<i class="sk-prikk haand"></i>${T('i hånd', 'in hand')}<i class="sk-prikk alarm"></i>${T('alarm', 'alarm')}
          <button type="button" class="btn sk-utvid" data-utvid aria-pressed="${stor}" title="${esc(stor ? T('Vis enhetslista igjen', 'Show the device list again') : T('Gi skjemaet plassen til enhetslista', 'Give the schematic the room of the device list'))}">${stor ? T('Vis enhetsliste', 'Show device list') : T('Utvid', 'Expand')}</button></span></div>
      <div class="sk-lerret"><svg viewBox="0 ${r.topp || 0} ${r.bredde} ${r.hoyde - (r.topp || 0)}" style="min-width:${Math.round(minB)}px" role="img" aria-label="${esc(valgt.navn)}">${r.svg}</svg></div>
      ${rest.length || rom ? `<div class="sk-rest"><span class="sk-rest-t">${T('Også i systemet', 'Also in the system')}</span>${rom}${rest.map(k => {
        const h = hoved(k);
        return `<button type="button" class="${klasser(k, 'sk-brikke')}" data-o="${esc(h.objid)}" title="${esc(tittel(k))}"><b>${esc(merke(k))}</b>${k.sted && NAVN[k.sted] ? `<i>${esc(tn(NAVN, k.sted))}</i>` : ''}<span>${esc(verdi(h))}</span></button>`;
      }).join('')}</div>` : ''}
      <div class="sk-fot">${T('Tegnet etter navn og beskrivelse på punktene, ikke etter rørføringen i bygget. Klikk en del for å se punktet.', 'Drawn from the names and descriptions of the points, not from the piping in the building. Click a part to see its point.')}</div>`;
    if (wrap.innerHTML !== html) {
      const rull = wrap.querySelector('.sk-lerret');
      const rx = rull ? rull.scrollLeft : 0;
      wrap.innerHTML = html;
      const ny = wrap.querySelector('.sk-lerret');
      if (ny && rx) ny.scrollLeft = rx;
      merkValgt();
    }
  }
  function merkValgt() {
    const o = S.selected || (S.selectedPoint && S.selectedPoint.objid) || SK.klikket;
    wrap.querySelectorAll('.valgt').forEach(e => e.classList.remove('valgt'));
    if (SK.klikket) wrap.querySelectorAll(`[data-o="${CSS.escape(SK.klikket)}"]`).forEach(e => e.classList.add('valgt'));
  }

  bryter.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    SK.vis = b.dataset.v === 'skjema';
    savePrefs({skjemaVis: SK.vis});
    oppdater();
  });
  const velg = async (el) => {
    if (el.closest('[data-utvid]')) { savePrefs({skjemaStor: !document.body.classList.contains('sk-stor')}); oppdater(); return; }
    const fane = el.closest('[data-fane]');
    if (fane) { SK.valgt[SK.ip] = fane.dataset.fane; tegn(); return; }
    const k = el.closest('[data-o]');
    if (!k || !k.dataset.o) return;
    SK.klikket = k.dataset.o;
    merkValgt();
    try { await selectPoint(k.dataset.o); } catch { /* the inspector says what went wrong */ }
  };
  wrap.addEventListener('click', (e) => velg(e.target));
  wrap.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.sk-k')) { e.preventDefault(); velg(e.target); } });

  try { SK.vis = !!loadPrefs().skjemaVis; } catch { /* default: the table */ }
  etter('renderPoints', oppdater);
  if (typeof pollTick === 'function') etter('pollTick', () => { if (SK.vis && !wrap.hidden) oppdater(); });
  if (typeof updateValueCells === 'function') etter('updateValueCells', () => { if (SK.vis && !wrap.hidden) oppdater(); });

  window.aapneSkjema = function () {
    if (!S.activeDev) { toast(T('Åpne en enhet først', 'Open a device first')); return; }
    if (!SK.systemer.length) { toast(T('Fant ikke noe aggregat eller noen varmekurs i navnene på denne enheten', 'Found no air handling unit or heating circuit in the names on this device')); return; }
    SK.vis = true; savePrefs({skjemaVis: true}); oppdater();
  };
  window.nabeSkjema = {tolkNavn, tolkPunkt, byggSystemer, sideAv, tegnAggregat, tegnKurser, tilstand: SK};
})();
