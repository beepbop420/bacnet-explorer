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
  function tolkNavn(navn, beskr) {
    let n = String(navn || '');
    let sys = '', etterSys = 0, m, romNavn = '';
    // A room unit: "OU601.613.-RT601" is room 613 on unit OU601, and "KJ12_BOS1.325.-RT600" is room 325.
    // The room number sits between two dots with the code of the part after it.
    // An ETS group name in the Nordomatic pattern: "563.9-303-RT601 HtrGn SDw" is system 563.9, room 303, part RT601.
    // Two rooms share a name as 303/304, and 99999 means no room.
    const mk = /^(\d{3}\.\d{1,3})-(\d{3}[A-Za-z]?(?:\/\d{3}[A-Za-z]?)*|\d{5})-([A-Z]{2}\d{3})\s*/.exec(n);
    if (mk) {
      return {sys: mk[1], rom: /^\d{5}$/.test(mk[2]) ? '' : mk[2], kode: mk[3], bokstav: mk[3].slice(0, 2), nr: mk[3].slice(2), hale: n.slice(mk[0].length).trim(), under: '', knx: true};
    }
    // The other KNX naming: "01-212 VAV m3/s Tilluft", "04-021 lys bevegelse SD", "07-M08 lys av/på": building, room, then what it is
    const mk2 = /^(\d{2})-(\d{3}[A-Za-z]?|[A-Z]\d{2,3})\s+(.+)$/.exec(n);
    if (mk2) return {sys: 'Bygg ' + mk2[1], rom: mk2[2], kode: '', bokstav: '', nr: '', hale: mk2[3].trim(), under: '', knx: true};
    const mr = /(?:O[US](\d{3})\.)?(?<![0-9])(\d{3})\.-(?=[A-Z]{2}\d{2,4})/.exec(n);
    if (mr) { romNavn = mr[2]; sys = mr[1] || ''; etterSys = mr.index + mr[0].length; }
    // A room module on a bus driver: "Drivers.Modbus_3_1.S563.R_338.points.RT600" is room 338, the part is RT600.
    const mb = !mr && /(?:^|[._])R_(\d{2,4}[A-Za-z]?)\.(?:points\.)?(?=[A-Z]{2}\d{2,4})/.exec(n);
    if (mb) { romNavn = mb[1]; etterSys = mb.index + mb[0].length; }
    const reS = /(?<![0-9A-Za-z])(\d{3})[._](\d{3})(?![0-9])|(?<![0-9A-Za-z])(\d{2})[._](\d{2})(?![0-9])/g;
    if (!mr && !mb) while ((m = reS.exec(n))) { sys = m[1] ? m[1] + '.' + m[2] : m[3] + '.' + m[4]; etterSys = m.index + m[0].length; }
    // Other ways a system stands in a tag: "+KG32=350 002-RT401" with a space, or "350002-RP401" as one number.
    // A building and unit code in front of the part (564001-OU601) is not a system.
    // A system with a hyphen between the two numbers: "OU01.1OX01 - 320-002-RT401" is system 320.002.
    if (!sys && !mr && (m = /(?<![0-9])(3\d{2}) (\d{3})(?=-[A-Z]{2}\d)/.exec(n) || /(?<![0-9])(3\d{2})(\d{3})(?=-(?!O[US]\d)[A-Z]{2}\d)/.exec(n)
        || /(?<![0-9A-Za-z])(3\d{2})-(\d{3})(?=-[A-Z]{2}\d)/.exec(n))) {
      sys = m[1] + '.' + m[2]; etterSys = m.index + m[0].length;
    }
    // The way some Beckhoff projects write the system into a variable: s36001 is 360.01, s433_1001 is 433.1001.
    if (!sys && (m = /(?<![A-Za-z0-9])s(\d{3})_(\d{3,4})(?![0-9])/.exec(n) || /(?<![A-Za-z0-9])s(\d{3})(\d{2})(?![0-9])/.exec(n))) {
      sys = m[1] + '.' + m[2]; etterSys = m.index + m[0].length;
    }
    // Where the name carries no system, the description often does: "SD2T 433.1001-QE001 ...", "+10-00=332.001-SM401 ...".
    if (!sys && beskr && (m = /(?<![0-9])(\d{3})\.(\d{3,4}|00X)\b[^A-Za-z0-9]{0,2}([A-Z]{2}\d{2,4})\b/.exec(String(beskr)))) {
      sys = m[1] + '.' + m[2]; n = n + ' ' + m[3];
    }
    // A room controller named by its bus position, with the room in the description: "SQ401-02.85 Spjeldposisjon".
    if (!sys && !romNavn && beskr && (m = /(?<![A-Za-z0-9])([A-Z]{2}\d{3})-(\d{2}\.\d{1,3}[a-z]?)(?![0-9])/.exec(String(beskr)))) {
      romNavn = m[2]; n = n + ' ' + m[1];
    }
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
    // Room codes as they stand in the tag: A109, A219_A, or two rooms that share a zone (A026/A159).
    const rom = romNavn || [...new Set(mellom.match(/(?<![A-Za-z0-9])[A-Z]\d{3}(?:_[A-Z](?![A-Za-z0-9]))?(?![0-9])/g) || [])].join('/');
    let hale = valgt ? n.slice(valgt.index + valgt[0].length) : (sys ? n.slice(etterSys) : '');
    hale = hale.replace(/^[\s_.\-/]+/, '').trim();
    let under = '';
    const u = /^([A-Z]{2})_(.+)$/.exec(hale);
    if (u && O.KODE[u[1]] && (!valgt || u[1] !== valgt[1])) under = u[1];
    return {sys, rom, kode: valgt ? valgt[1] + valgt[2] : '', bokstav: valgt ? valgt[1] : '', nr: valgt ? valgt[2] : '', hale, under};
  }

  /* ---------------------------------------------------------- one point */
  function tolkPunkt(p) {
    const t = tolkNavn(p.name, p.description);
    if (t.knx) {
      // The tail of a KNX name says what the point is; the code in front only says which kind of device it sits on.
      const k = t.rom ? (slaa(O.KNXHALE, t.hale.toLowerCase()) || {art: 'rompunkt', rolle: 'annet'}) : {art: '', rolle: 'annet'};
      // A KNX point that is not a part of a room is not a part of anything here: an air handler is never made of group addresses
      return {p, sys: t.sys, rom: t.rom, kode: t.kode, under: '', art: k.art, rolle: k.rolle, sted: 'rom', hvor: '', beskr: String(p.description || ''), maalt: '', spr: false, ord: t.hale.toLowerCase(), enhet: String(p.units || p.unit || '').toLowerCase()};
    }
    // "min:-50.0, max:+120.0, error: -32768" is the range of the point, not what it is
    const beskr = String(p.description || '').replace(/\bmin:\s*[-+]?[\d.]+,?\s*max:\s*[-+]?[\d.]+(,?\s*error:\s*[-+]?[\d.]+)?/gi, '').trim().replace(/^SD\w{2}\s+/, '').replace(/^[+=A-Za-z0-9\/.\-]*?\d{3}\.\d{2,4}[\s-]*[A-Z]{2}\d{2,4}\s*/, '');
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
    if ((art === 'trykk' || art === 'difftrykk') && iOrd === 'ekspansjon') art = 'ekspansjon';
    // A yes/no pressure input is a pressure switch: on an air handler the filter guard.
    if ((art === 'trykk' || art === 'difftrykk') && type.startsWith('binary')) art = iOrd === 'ekspansjon' ? 'ekspansjon' : 'filter';
    if (art === 'frost') rolle = 'alarm';
    if (!art) art = maalt && (!rolle || rolle === 'pv' || rolle === 'sp' || rolle === 'innstilling') ? maalt : iOrd;
    // A position is a position whatever unit the programmer gave it: "Spjeldposisjon" in degrees is still a damper.
    if (!t.kode && maalt === 'temp' && ['ventil', 'spjeld', 'vifte'].includes(iOrd) && /posisjon|position|åpning|pådrag/.test(ord)) { art = iOrd; rolle = 'paadrag'; }
    // The refrigerant circuit of a heat pump or a DX coil is its own thing, not a reading in the duct.
    if (['temp', 'trykk', 'difftrykk', 'mengde', 'fukt'].includes(art) && !t.kode
        && /heat\s*pump|heatpump|compressor|\bevap|\bcond\b|condens|suction|discharge|superheat|\bh\/c\b|\bhc\s+in\b|defrost|\bdx\b|outdoor\s*coil|outd\s*coil/.test(ord)) art = 'varmepumpe';
    // A pressure that says "filter" is the pressure drop across a filter.
    if ((art === 'trykk' || art === 'difftrykk') && iOrd === 'filter') art = 'filter';
    // A reading of a part of a coil or a recovery unit that is not itself a coil: keep it a reading.

    if (!rolle) {
      rolle = type === 'analog-input' ? 'pv' : type === 'analog-output' ? 'paadrag'
        : type === 'binary-output' ? 'start'
        : type.startsWith('multi-state') ? 'vender'
        : type.startsWith('binary') ? (art === 'filter' || art === 'royk' || art === 'frost' ? 'alarm' : 'drift')
        : type === 'analog-value' ? 'pv' : 'annet';
    }
    if (rolle === 'pv' && type.startsWith('binary')) rolle = art === 'filter' || art === 'royk' ? 'alarm' : 'drift';
    if (rolle === 'pv' && ['vifte', 'ventil', 'spjeld', 'pumpe', 'gjenvinner'].includes(art) && /percent|%/.test(enhet)) rolle = 'paadrag';
    if (rolle === 'pv' && ['vav', 'spjeld', 'ventil', 'vifte'].includes(art) && /posisjon|position|pådrag/.test(b)) rolle = 'paadrag';
    // A valve or damper that is read in percent with a tail like "_P" is what it is told: its output.
    if (rolle === 'annet' && t.kode && type.startsWith('analog') && ['vav', 'spjeld', 'ventil', 'vifte', 'radiator'].includes(art) && /percent|%/.test(enhet)) rolle = 'paadrag';
    // A number cannot be a run state or a switch. Without a code to say otherwise it is a setting.
    if (!t.kode && type.startsWith('analog') && ['start', 'drift', 'vender'].includes(rolle)) rolle = 'annet';

    // Where: the words, then what the number usually means.
    let sted = slaa(O.STED, ord);
    const hvorOrd = (tekst) => slaa(O.HVOR, tekst);
    let hvor = hvorOrd(b) || (t.kode ? null : hvorOrd(ord));
    if (!sted && t.nr) {
      if (art === 'temp' && /^9\d\d?$|^0?01$/.test(t.nr) && !b) sted = 'ute';
      else if (art === 'temp' && /^6\d\d?$/.test(t.nr)) sted = 'rom';
      else if (/^4/.test(t.nr)) sted = '4';
      else if (/^5/.test(t.nr)) sted = '5';
    }
    // Air quality in an air handler is measured in the extract air, the room air coming back.
    if (!sted && art === 'co2' && !t.rom && rolle === 'pv') sted = 'avtrekk';
    // Names a vendor builds from a prefix (BDInletRelPos, BVHeat1SetPrc) are read from the dictionary.
    const nv = slaa(O.NAVN, String(p.name || ''));
    if (nv) {
      art = nv.art;
      if (nv.sted) sted = nv.sted;
      if (nv.hvor) hvor = nv.hvor;
      rolle = slaa(O.NAVNROLLE, String(p.name || '')) || rolle;
    }
    const spr = /sprink|brannslukk|slokke|slukk|brannvann|fire\s*(suppress|sprink)/.test(ord + ' ' + String(p.name || '').toLowerCase());
    return {p, sys: t.sys, rom: t.rom, kode: t.kode, under: t.under, art: art || '', rolle, sted: sted || '', hvor: hvor || '', beskr, maalt: maalt || '', spr, ord, enhet};
  }

  /* Is this point something the plant reads or does right now, as opposed to a setting? */
  function levende(p, x) {
    const t = String(p.type || '');
    if (/second|minute|hour|day|ampere|volt|watt|revolutions|joule/.test(x.enhet)) return false;
    const inn = t === 'analog-input' || t === 'analog-output';
    // A status register that a controller keeps for each alarm (a number that says normal or active) is a state, not a part.
    if (x.rolle === 'alarm' && t.startsWith('analog')) return false;
    // A point the programmer never named ("Input (Float)") says nothing about the plant
    if (/^\s*(input|output)\s*\((float|int|bool)/i.test(String(p.description || '') + ' ' + String(p.name || '')) && !String(p.description || '').replace(/^\s*(input|output)\s*\([a-z]+\)\s*/i, '')) return false;
    // Read-only inputs have a narrower list of what is not live: their "RegSet" is a regulator's own setpoint.
    if (O.NAVN.some(([re]) => re.test(String(p.name || ''))) && inn) return true;
    if (inn ? O.INNSTILLING_AI.test(x.ord + ' ' + String(p.name || '')) : O.INNSTILLING_ORD.test(x.ord + ' ' + String(p.name || ''))) return false;
    if (t === 'analog-input') return true;
    if (t === 'analog-output') return true;
    // A value whose description lists its choices ("0-m3/h, 1-l/s, 3-Pa") is a mode, not a reading
    if (t === 'analog-value' && /(^|,\s*)\d\s*-\s*[A-Za-z]/.test(String(p.description || ''))) return false;
    if (t === 'analog-value') return x.rolle === 'pv' || x.rolle === 'paadrag';
    // A yes/no point is a part of the plant only where it says something about a filter, a fan, a pump,
    // a damper or smoke. The rest of the alarms of such a device are events, not parts.
    if (t.startsWith('binary')) return ['filter', 'royk', 'vifte', 'pumpe', 'spjeld'].includes(x.art);
    return false;
  }

  /* ----------------------------------------------- points into systems */
  function byggSystemer(punkter) {
    const systemer = new Map();
    for (const p of punkter || []) {
      if (!p || p.type === 'schedule' || p.type === 'calendar' || String(p.type).startsWith('trend')) continue;
      const x = tolkPunkt(p);
      if (!x.art) continue;
      if (p.knx && !x.rom) continue;
      // Sprinkler points (a shut-off valve, a low-pressure switch, the word itself) are their own system,
      // so they do not pull a whole unnamed group of points with them into a drawing.
      const sprinkler = x.spr || x.art === 'stengeventil';
      const sk = sprinkler ? (x.sys || '-') + '|spr' : x.sys;
      if (!systemer.has(sk)) systemer.set(sk, {id: x.sys, komp: new Map(), rom: new Set(), romData: new Map(), type: sprinkler ? 'sprinkler' : ''});
      const s = systemer.get(sk);
      if (x.rom) {
        s.rom.add(x.rom);
        // A room is its temperature, its setpoint, what the valve or damper is told, and its air quality.
        if (!s.romData.has(x.rom)) s.romData.set(x.rom, {rom: x.rom, sys: x.sys, n: 0, alle: []});
        const r = s.romData.get(x.rom), hale = tolkNavn(p.name).hale.toLowerCase();
        r.n++;
        if (!/avvik|diff|deviation/i.test(p.name)) r.alle.push(p);
        if (/avvik|diff|deviation/i.test(p.name)) { /* a calculated difference, not a reading */ }
        else if (x.art === 'temp' && x.rolle === 'pv') r.temp = r.temp || p;
        else if (x.art === 'temp' && x.rolle === 'sp') { if (!r.tempSp || /spk|akt|arb/.test(hale)) r.tempSp = p; }
        else if (x.art === 'co2' && x.rolle === 'pv') r.co2 = r.co2 || p;
        else if (x.art === 'co2' && x.rolle === 'sp') r.co2Sp = r.co2Sp || p;
        else if (x.rolle === 'paadrag' && (x.art === 'ventil' || x.art === 'radiator')) r.varme = r.varme || p;
        else if (x.rolle === 'paadrag' && (x.art === 'spjeld' || x.art === 'vav')) r.luft = r.luft || p;
        else if (x.art === 'bevegelse') r.bevegelse = r.bevegelse || p;
        else if (x.art === 'lys' && x.rolle === 'pv') r.lys = r.lys || p;
        else if (x.art === 'mengde' && x.rolle === 'pv') r.mengde = r.mengde || p;
        else if (x.art === 'lux' && x.rolle === 'pv') r.lux = r.lux || p;
        else if (x.art === 'lux' && x.rolle === 'sp') r.luxSp = r.luxSp || p;
        continue;
      }
      const maaling = ['temp', 'trykk', 'difftrykk', 'mengde', 'fukt', 'co2'].includes(x.art);
      // A device that names its points in words has hundreds of settings for every reading. Only a point that
      // is read live is a part of the plant, and each one is a part of its own.
      const uten = !x.kode && !x.under;
      if (uten && !levende(p, x)) continue;
      const nokkel = x.kode ? x.kode + (x.under ? '/' + x.under : '') : uten ? 'p:' + p.objid : x.art + ':' + (x.sted || (maaling ? x.hvor : '') || '');
      if (!s.komp.has(nokkel)) {
        s.komp.set(nokkel, {nokkel, sys: x.sys, kode: x.kode ? (x.under ? '' : x.kode) : '', eier: x.under ? x.kode : '',
          art: x.art, sted: '', hvor: '', beskr: '', pkt: {alarm: [], annet: []}});
      }
      const k = s.komp.get(nokkel);
      if (!k.sted && x.sted) k.sted = x.sted;
      if (!k.hvor && x.hvor) k.hvor = x.hvor;
      if (x.spr) k.spr = true;
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
      s.type = s.type || slaa(O.SYSTEM, s.id.replace('.', '')) || '';
      // 310 is water and drain in general; it is a sprinkler system only where a point says so (a shut-off valve, the word).
      if (s.type === 'sprinkler' && /^310/.test(s.id) && ![...s.komp.values()].some(k => k.spr || k.art === 'stengeventil')) s.type = 'sanitaer';
      const harVent = O.VENT.some(a => arter.has(a)) && arter.has('vifte');
      const harVarme = O.VARME.some(a => arter.has(a));
      if (s.type === 'ventilasjon' && !harVent) s.type = arter.has('spjeld') || arter.has('vav') ? 'ventilasjon-rom' : '';
      // Sprinkler is its own kind of system, by number (310, 33x) or by what the points say. A shut-off
      // valve (SM) belongs to it and never to a heating or cooling circuit.
      if (!s.type || s.type === 'sd' || s.type === 'el') s.type = harVent ? 'ventilasjon' : harVarme ? 'varme' : '';
      // A plant with no number in its tags that has pipes and pumps and only a relay or two for a fan (an emergency
      // fan in the same room) is not an air handler. No live air reading, no air handler: it is circuits.
      if (s.type === 'ventilasjon' && !s.id) {
        const alleK = [...s.komp.values()], luftSted = ['inntak', 'tilluft', 'avtrekk', 'avkast', 'etter'];
        const levendeLuft = alleK.some(k => (k.pkt.pv || k.pkt.paadrag) && (['vifte', 'filter', 'gjenvinner', 'spjeld'].includes(k.art) || (k.art === 'temp' && luftSted.includes(k.sted))));
        const rorDeler = alleK.filter(k => ['ekspansjon', 'ventil', 'pumpe'].includes(k.art) || (k.sted === 'tur' && (k.pkt.pv || k.pkt.paadrag))).length;
        if (!levendeLuft && rorDeler >= 3) {
          const kald = alleK.filter(k => /kj[øo]l|cool|chill|baffel/i.test(k.beskr || '')).length, varm = alleK.filter(k => /varme|heat|fjernvarme|radiator/i.test(k.beskr || '')).length;
          s.type = kald >= varm ? 'kjoling' : 'varme';
        }
      }
      // A setpoint that hangs on the system itself, or on a fan, belongs to the sensor it is the setpoint for.
      const alle = [...s.komp.values()];
      // Relays and other loose codes do not make a plant coded; only real parts (a fan, a sensor, a valve) do.
      const kodet = alle.filter(k => (k.kode || k.eier) && !['system', 'effekt', 'tank'].includes(k.art)).length >= 3;
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
      // A regulator's setpoint that is read as an input belongs to the reading it regulates: the same kind of
      // thing at the same place. Without a match it is left out, a setpoint alone is not a part of the plant.
      const spFoerst = [...alle].sort((a, b) => (b.pkt.sp && b.pkt.sp.value ? 1 : 0) - (a.pkt.sp && a.pkt.sp.value ? 1 : 0));
      for (const k of spFoerst) {
        if (!String(k.nokkel).startsWith('p:') || !k.pkt.sp || k.pkt.pv || k.pkt.paadrag) continue;
        if (!k.sted || !['temp', 'trykk', 'difftrykk', 'mengde', 'fukt', 'co2'].includes(k.art)) continue;
        if (k.art === 'temp' && k.pkt.sp.value === 0) { k.sluk = true; continue; }
        const kand = alle.filter(z => z !== k && String(z.nokkel).startsWith('p:') && z.art === k.art && z.sted === k.sted && z.pkt.pv && !z.pkt.sp);
        const maal = kand.find(z => typeof z.pkt.pv.value === 'number' && z.pkt.pv.value !== 0) || kand[0];
        if (maal) { maal.pkt.sp = k.pkt.sp; k.sluk = true; }
      }
      // Where the plant names its parts with codes, a point without one is a setting of the
      // program, not a part of the plant: it has given away its setpoint above and is left out.
      s.komp = alle.filter(k => k.art !== 'system' && !k.sluk && (!kodet || k.kode || k.eier || k.nokkel.startsWith('p:'))
        && !(String(k.nokkel).startsWith('p:') && k.pkt.sp && !k.pkt.pv && !k.pkt.paadrag && !k.pkt.drift && !k.pkt.start && !k.pkt.alarm.length));
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
    stengeventil: ['Stengeventil', 'Shutoff valve'], ekspansjon: ['Ekspansjonskar', 'Expansion vessel'], kompressor: ['Kompressor', 'Compressor'], radiator: ['Radiator', 'Radiator'], omformer: ['Omformer', 'Drive'], fjernvarme: ['Fjernvarme', 'District heating'],
  };
  const tn = (tabell, k) => tabell[k] ? T(tabell[k][0], tabell[k][1]) : k;
  // In a drawing the label has a few centimetres: the code when there is one, else a short word.
  const KORT = {temp: ['Temp', 'Temp'], varmebatteri: ['Varme', 'Heating'], kjolebatteri: ['Kjøling', 'Cooling'], difftrykk: ['ΔP', 'ΔP']};
  const merke = (k) => k.merkeTekst || k.kode || k.eier || (['temp', 'fukt', 'co2'].includes(k.art) && k.sted && NAVN[k.sted] ? tn(NAVN, k.sted) : tn(KORT[k.art] ? KORT : ART, k.art));

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
  const MASKIN = ['vifte', 'pumpe', 'ventil', 'stengeventil', 'spjeld', 'gjenvinner', 'varmebatteri', 'kjolebatteri'];
  const hoved = (k) => (MASKIN.includes(k.art) ? (k.pkt.paadrag || k.pkt.drift || k.pkt.start || k.pkt.pv) : (k.pkt.pv || k.pkt.paadrag || k.pkt.drift || k.pkt.start))
    || k.pkt.virkningsgrad || k.pkt.alarm[0] || k.pkt.vender || k.pkt.sp || k.pkt.annet[0];
  const tittel = (k) => [k.kode || k.eier, k.beskr, ...Object.entries(k.pkt).filter(([r, p]) => p && !Array.isArray(p)).map(([r, p]) => `${r}: ${verdi(p)}`),
    k.pkt.alarm.length ? `${k.pkt.alarm.length} ${T('alarmpunkt', 'alarm points')}` : ''].filter(Boolean).join('\n');

  /* --- drawing primitives. All sizes in the drawing's own units. --- */
  const klasser = (k, mer) => `sk-k${iAlarm(k) ? ' alarm' : iFeil(k) ? ' feil' : ''}${iHaand(k) ? ' haand' : ''}${iDrift(k) ? ' drift' : ''}${mer ? ' ' + mer : ''}`;
  const gruppe = (k, mer, inni) => {
    const h = hoved(k);
    return `<g class="${klasser(k, mer)}" data-o="${esc(h ? h.objid : '')}" tabindex="0" role="button" aria-label="${esc(tittel(k))}">${inni}</g>`;
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
  const BOK = {temp: 'T', trykk: 'P', ekspansjon: 'P', difftrykk: 'ΔP', mengde: 'Q', fukt: 'φ', co2: 'C', royk: 'R', frost: 'F', bevegelse: 'B'};

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
    const p = k.pkt.paadrag || (type === 'filter' ? k.pkt.pv : null) || (type === 'spjeld' ? (k.pkt.start || k.pkt.drift) : null);
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
  /* The air path is a row of stations: intake, after the recovery unit, supply
     on one duct, extract and exhaust on the other. Every part is put at the
     station its name and description name. A station holds as many parts as it
     has, each with room of its own; the drawing grows to fit, and neighbouring
     sensors take turns hanging outside the duct and in the gap between the two,
     so nothing is ever drawn on top of anything else. */
  const MAAL = ['temp', 'trykk', 'difftrykk', 'mengde', 'fukt', 'co2', 'royk', 'bevegelse'];
  const harLevende = (k) => !!(k.pkt.pv || k.pkt.paadrag || k.pkt.drift || k.pkt.start || k.pkt.alarm.length || k.pkt.virkningsgrad);
  const ARTRANG = {temp: 0, fukt: 1, trykk: 2, difftrykk: 2, mengde: 3, co2: 4, royk: 5, bevegelse: 6};

  /* Which station of the air path each part belongs to, and on what grounds. The words of the
     description come first, since that is what the plant says. Where there are none, the tag
     number does: 4xx sensors follow the supply air from intake to supply, 5xx follow the extract
     air from the room to the exhaust, 6xx are the room. And where the number alone leaves
     several sensors to place (RT50, RT51, RT52), what they read decides, the way a technician
     would: the exhaust lies between the outdoor and the extract temperature, a sensor far hotter
     than any air is the water of the coil, the supply is where the setpoint is.
     The grounds are kept in `basis` for the list of tags under the drawing. */
  function stasjoner(K) {
    const ut = new Map(), basis = new Map();
    ut.basis = basis;
    const sett = (k, st, b) => { ut.set(k, st); basis.set(k, b); };
    const tall = (k) => parseInt(String(k.kode || '').replace(/\D/g, ''), 10) || 0;
    const v1 = (k) => { const p = k.pkt.pv; return p && typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null; };
    for (const k of K) {
      const s = k.sted;
      const st = s === 'inntak' || s === 'ute' ? 'inntak' : s === 'ettergjenvinner' ? 'etter' : s === 'tilluft' ? 'tilluft' : s === 'avtrekk' ? 'avtrekk' : s === 'avkast' ? 'avkast' : '';
      if (st) sett(k, st, 'beskrivelse');
    }
    for (const [siffer, orden] of [['4', ['inntak', 'etter', 'tilluft']], ['5', ['avtrekk', 'avtrekk', 'avkast']]]) {
      const l = K.filter(k => k.sted === siffer && !ut.has(k) && k.art !== 'frost').sort((a, b) => tall(a) - tall(b));
      l.forEach((k, i) => {
        k.siffer = siffer;
        sett(k, l.length === 1 ? (k.art === 'spjeld' ? (siffer === '4' ? 'inntak' : 'avkast') : (siffer === '4' ? 'tilluft' : 'avtrekk'))
          : i === 0 ? orden[0] : i === l.length - 1 ? orden[2] : orden[1], 'tall');
      });
    }
    // The values. Reference temperatures come from the sensors the words placed.
    const snitt = (st) => { const v = K.filter(k => k.art === 'temp' && ut.get(k) === st && basis.get(k) === 'beskrivelse').map(v1).filter(x => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const tInn = snitt('inntak');
    let tTil = snitt('tilluft');
    const spK = K.find(k => k.art === 'temp' && ut.get(k) === 'tilluft' && k.pkt.sp && typeof k.pkt.sp.value === 'number');
    if (tTil === null && spK) tTil = spK.pkt.sp.value;
    const tAvt = snitt('avtrekk');
    const luft = [tTil, tAvt, tInn].filter(x => x !== null);
    const varmest = luft.length ? Math.max(...luft) : null;
    for (const k of K.filter(k => k.art === 'temp' && basis.get(k) === 'tall')) {
      const v = v1(k);
      if (v === null) continue;
      // far hotter than any air in the unit: it is the water of the coil
      if (varmest !== null && v > varmest + 7) { k.sted = 'batteriretur'; if (!k.hvor) k.hvor = 'varmebatteri'; ut.delete(k); basis.delete(k); continue; }
      if (k.siffer === '4' && tInn !== null && tTil !== null) {
        const ny = Math.abs(v - tInn) <= 1.5 ? 'inntak' : Math.abs(v - tTil) <= 1.5 ? 'tilluft' : 'etter';
        if (ny !== ut.get(k)) sett(k, ny, 'verdi');
        else basis.set(k, 'verdi');
      } else if (k.siffer === '5' && tInn !== null && tAvt !== null) {
        // the exhaust has given its heat to the supply air: clearly cooler than the extract
        const ny = Math.abs(v - tAvt) <= 2 ? 'avtrekk' : 'avkast';
        if (ny !== ut.get(k)) sett(k, ny, 'verdi');
        else basis.set(k, 'verdi');
      }
    }
    // A damper that is read as a position and also as a relay: the position is the one to draw.
    for (const stas of new Set(K.filter(k => k.art === 'spjeld' && ut.has(k)).map(k => ut.get(k)))) {
      const her = K.filter(k => k.art === 'spjeld' && ut.get(k) === stas && String(k.nokkel).startsWith('p:'));
      if (her.some(k => k.pkt.paadrag)) for (const k of her) if (!k.pkt.paadrag) ut.delete(k);
    }
    // Parts with no word and no number. A damper or filter sits at the start of the air path,
    // unless it says it belongs to a room or to the recovery unit; fans go by number.
    const vifter = K.filter(k => k.art === 'vifte' && !ut.has(k) && !String(k.nokkel).startsWith('p:')).sort((a, b) => tall(a) - tall(b));
    vifter.forEach((k, i) => sett(k, i === 0 ? 'tilluft' : 'avtrekk', 'tall'));
    // Coded dampers and filters with nothing to go by are put at the start. Without a code, one damper
    // alone is taken for the outdoor air damper; several are not guessed at.
    const uplassert = K.filter(k => !ut.has(k) && (k.art === 'spjeld' || k.art === 'filter') && !k.sted && k.hvor !== 'gjenvinner');
    const utenKode = uplassert.filter(k => String(k.nokkel).startsWith('p:'));
    for (const k of uplassert) if (!String(k.nokkel).startsWith('p:') || (utenKode.length === 1 && k.art === 'spjeld')) sett(k, 'inntak', 'standard');
    // A fan that is read twice (a percentage and a voltage for the same motor): one drawing of it.
    const vifter2 = new Map();
    for (const k of K) if (k.art === 'vifte' && String(k.nokkel).startsWith('p:') && ut.has(k)) { if (!vifter2.has(ut.get(k))) vifter2.set(ut.get(k), k); else if (!vifter2.get(ut.get(k)).pkt.paadrag && k.pkt.paadrag) { ut.delete(vifter2.get(ut.get(k))); vifter2.set(ut.get(k), k); } else ut.delete(k); }
    // "Exhaust fan" is the extract fan and "outdoor air fan" the supply fan: a fan is never at the duct ends.
    for (const k of K) if (k.art === 'vifte') { if (ut.get(k) === 'avkast') ut.set(k, 'avtrekk'); else if (ut.get(k) === 'inntak') ut.set(k, 'tilluft'); }
    for (const k of K) if (k.art === 'filter' && String(k.nokkel).startsWith('p:') && k.pkt.pv && k.pkt.pv.value === 0) ut.delete(k);
    // The same reading twice (a plant that reports the outdoor temperature under two names): drawn once.
    const sett2 = new Set();
    for (const k of K) {
      if (!String(k.nokkel).startsWith('p:') || !ut.has(k)) continue;
      const p = k.pkt.pv || k.pkt.paadrag;
      if (!p) continue;
      const nok = ut.get(k) + ':' + k.art + ':' + JSON.stringify(p.value);
      if (sett2.has(nok)) ut.delete(k); else sett2.add(nok);
    }
    const stedArt = new Map();
    for (const k of K) if (String(k.nokkel).startsWith('p:') && ut.has(k) && MAAL.includes(k.art) && k.pkt.pv) {
      const n = ut.get(k) + ':' + k.art;
      if (!stedArt.has(n)) stedArt.set(n, []);
      stedArt.get(n).push(k);
    }
    for (const l of stedArt.values()) if (l.length > 1 && l.some(k => k.pkt.pv.value)) for (const k of l) if (!k.pkt.pv.value) ut.delete(k);
    // Two parts that name the same thing at the same station: the one with something to show wins.
    const grp = new Map();
    for (const k of K) if (MAAL.includes(k.art) && ut.has(k)) { const n = ut.get(k) + ':' + k.art; if (!grp.has(n)) grp.set(n, []); grp.get(n).push(k); }
    for (const l of grp.values()) if (l.length > 1 && l.some(harLevende)) for (const k of l) if (!harLevende(k)) ut.delete(k);
    return ut;
  }

  /* What kind of heat recovery an air handler has. The words of its points say it when they do; otherwise the
     technician picks, and the pick is remembered for that plant. */
  const VEKSLER = [['rotor', ['Roterende', 'Rotary']], ['kryss', ['Kryss', 'Cross-flow']], ['vaeske', ['Væskekoblet', 'Liquid-coupled']]];
  function vekslerGjetting(gj) {
    const ord = [gj.beskr, ...Object.values(gj.pkt).flat().filter(Boolean).map(p => `${p.name || ''} ${p.description || ''}`)].join(' ').toLowerCase();
    if (/kryss|cross|plate|plateveksler|motstrøm|counter\s*flow/.test(ord)) return 'kryss';
    if (/væske|glykol|glycol|run[\s-]*around|batterigjenvinn|liquid/.test(ord)) return 'vaeske';
    return 'rotor';
  }
  const vekslerLagret = () => { try { return JSON.parse(localStorage.getItem('nabe.veksler') || '{}'); } catch { return {}; } };
  const vekslerNokkel = (s) => `${SK.ip}|${s.id || ''}`;
  function tegnAggregat(s, vtypeValgt) {
    const yA = 150, yT = 400, hK = 38, K = s.komp, tatt = new Set();
    const st = stasjoner(K);
    const en = (f) => { const k = K.find(k => !tatt.has(k) && f(k)); if (k) tatt.add(k); return k; };
    const alle = (f) => { const l = K.filter(k => !tatt.has(k) && f(k)); l.forEach(k => tatt.add(k)); return l; };
    const sorter = (a, b) => (ARTRANG[a.art] ?? 9) - (ARTRANG[b.art] ?? 9) || String(a.kode).localeCompare(String(b.kode), 'no', {numeric: true});
    const ved = (stas, f) => alle(k => st.get(k) === stas && f(k));
    // An unnamed temperature input that reads exactly zero is an input with nothing on it.
    const tom = (k) => String(k.nokkel).startsWith('p:') && k.pkt.pv && (
      (k.art === 'temp' && (k.pkt.pv.value === 0 || k.pkt.pv.value <= -40 || k.pkt.pv.value >= 200))
      || (['fukt', 'co2'].includes(k.art) && k.pkt.pv.value === 0));
    // A station has room for a handful of sensors: the ones with a reading, temperatures first. The rest are
    // listed under the drawing, not squeezed in.
    const topp6 = new Set();
    for (const stas of new Set([...st.values()])) {
      K.filter(k => st.get(k) === stas && MAAL.includes(k.art) && harLevende(k) && !tom(k))
        .sort((a, b) => ((b.pkt.pv && b.pkt.pv.value) ? 1 : 0) - ((a.pkt.pv && a.pkt.pv.value) ? 1 : 0) || (ARTRANG[a.art] ?? 9) - (ARTRANG[b.art] ?? 9))
        .slice(0, 6).forEach(k => topp6.add(k));
    }
    const maalFn = (k) => topp6.has(k);

    const gj = en(k => k.art === 'gjenvinner' && (k.pkt.paadrag || k.pkt.virkningsgrad || k.kode)) || en(k => k.art === 'gjenvinner');
    if (gj) for (const k of K) {
      if (k === gj || tatt.has(k) || k.art !== 'gjenvinner') continue;
      let tok = false;
      for (const rolle of ['virkningsgrad', 'paadrag', 'drift', 'start', 'vender']) if (!gj.pkt[rolle] && k.pkt[rolle]) { gj.pkt[rolle] = k.pkt[rolle]; tok = true; }
      if (tok) tatt.add(k);
    }
    const vtype = vtypeValgt || (gj ? vekslerGjetting(gj) : 'rotor');
    const spoler = [];
    // The water side of each coil: pump, valve, return temperature and frost, by what the words say about the coil.
    const vannFor = (h, forste) => {
      const mine = (k) => k.hvor === h || (forste && !k.hvor);
      return {pumpe: en(k => k.art === 'pumpe' && k.hvor === h) || (forste ? en(k => k.art === 'pumpe' && !k.hvor && harLevende(k)) : null),
              ventil: en(k => k.art === 'ventil' && mine(k)),
              retur: en(k => k.art === 'temp' && k.sted === 'batteriretur' && mine(k)),
              frost: en(k => k.art === 'frost' && mine(k))};
    };
    const harV = (v) => v && (v.pumpe || v.ventil || v.retur || v.frost);
    const MERKE = {forvarme: T('Forvarme', 'Preheat'), varmebatteri: T('Varme', 'Heating'), kjolebatteri: T('Kjøling', 'Cooling'), ettervarme: T('Ettervarme', 'Reheat')};
    // Air passes them in this order: preheater (before the recovery unit), heating, cooling, reheat.
    for (const [h, art, t, forste] of [['forvarme', 'varmebatteri', 'varme', false], ['varmebatteri', 'varmebatteri', 'varme', true], ['kjolebatteri', 'kjolebatteri', 'kjol', false], ['ettervarme', 'varmebatteri', 'varme', false]]) {
      const kropp = en(k => k.art === art && (k.hvor === h || (!k.hvor && (forste || art === 'kjolebatteri'))));
      const v = vannFor(h, forste);
      // Two coil components that are both drawn with a signal: a second one of the same kind is a spare, not a second coil.
      if (!kropp && !harV(v)) continue;
      const k = kropp || {kode: '', eier: '', art, beskr: '', pkt: {alarm: [], annet: []}};
      if (!k.kode && !k.eier) k.merkeTekst = MERKE[h];
      spoler.push({k, v, t, h});
    }

    // --- the parts of each of the four stretches, left to right, with how much room each needs
    const sens = (k) => ({k, typ: 'sensor', l: 24, r: 24});
    const boksIt = (k, typ) => ({k, typ, l: 42, r: 42});
    const rotIt = (k, retn) => ({k, typ: 'rotor', retn, l: 44, r: 44});
    const spoleIt = (sp) => ({k: sp.k, typ: sp.t === 'varme' ? 'varmebatteri' : 'kjolebatteri', v: sp.v, t: sp.t, l: harV(sp.v) ? 92 : 42, r: harV(sp.v) ? 118 : 42});
    const topp2 = (l) => l.slice(0, 2);
    // A filter read as a pressure and also as a change-filter relay is one filter: draw the pressure.
    const filt = (l) => topp2(l.some(k => k.pkt.pv) ? l.filter(k => k.pkt.pv) : l);
    const SL = [...topp2(ved('inntak', k => k.art === 'spjeld')).map(k => boksIt(k, 'spjeld')),
                ...ved('inntak', k => maalFn(k)).sort(sorter).map(sens),
                ...filt(ved('inntak', k => k.art === 'filter')).map(k => boksIt(k, 'filter')),
                ...spoler.filter(sp => sp.h === 'forvarme').map(spoleIt)];
    const EL = [...topp2(ved('avkast', k => k.art === 'spjeld')).map(k => boksIt(k, 'spjeld')),
                ...ved('avkast', k => maalFn(k)).sort(sorter).map(sens),
                ...filt(ved('avkast', k => k.art === 'filter')).map(k => boksIt(k, 'filter')),
                ...ved('avtrekk', k => k.art === 'vifte').map(k => rotIt(k, 'v'))];
    const SR = [...ved('etter', k => maalFn(k)).sort(sorter).map(sens),
                ...filt(ved('etter', k => k.art === 'filter')).map(k => boksIt(k, 'filter')),
                ...filt(ved('tilluft', k => k.art === 'filter')).map(k => boksIt(k, 'filter')),
                ...spoler.filter(sp => sp.h !== 'forvarme').map(spoleIt),
                ...ved('tilluft', k => k.art === 'vifte').map(k => rotIt(k, 'h')),
                ...topp2(ved('tilluft', k => k.art === 'spjeld')).map(k => boksIt(k, 'spjeld')),
                ...ved('tilluft', k => maalFn(k)).sort(sorter).map(sens)];
    const ER = [...filt(ved('avtrekk', k => k.art === 'filter')).map(k => boksIt(k, 'filter')),
                ...ved('avtrekk', k => maalFn(k)).sort(sorter).map(sens),
                ...topp2(ved('avtrekk', k => k.art === 'spjeld')).map(k => boksIt(k, 'spjeld'))];

    const plasser = (liste, x0) => { let c = x0, n = 0; const ut = liste.map(it => { const x = c + it.l; c = x + it.r + 6; it.x = x; if (it.typ === 'sensor') it.ute = n++ % 2 === 0; return it; }); return {liste: ut, slutt: c}; };
    const ls = plasser(SL, 150), le = plasser(EL, 150);
    const xG = Math.max(ls.slutt, le.slutt) + (gj ? 110 : 30);
    const rs = plasser(SR, xG + (gj ? 70 : 20)), re = plasser(ER, xG + (gj ? 70 : 20));
    const B = Math.max(1000, rs.slutt + 160, re.slutt + 160);
    let d = '';

    // ducts
    const kanal = (x1, x2, y, kl) => `<rect class="sk-kanal ${kl}" x="${x1}" y="${y - hK / 2}" width="${x2 - x1}" height="${hK}" rx="3"/>`;
    d += kanal(50, xG, yA, 'avkast') + kanal(xG, B - 40, yA, 'avtrekk') + kanal(50, xG, yT, 'ute') + kanal(xG, B - 40, yT, 'tilluft');
    const pil = (x, y, v) => `<path class="sk-flyt" d="M${x} ${y - 6}l${v ? -9 : 9} 6l${v ? 9 : -9} 6"/>`;
    d += pil(34, yT, false) + pil(B - 22, yT, false) + pil(B - 26, yA, true) + pil(30, yA, true);
    d += tekst(58, yT + 4, T('Uteluft', 'Outdoor air'), 'sk-etikett', 'start') + tekst(B - 50, yT + 4, T('Tilluft', 'Supply air'), 'sk-etikett', 'end')
       + tekst(B - 50, yA + 4, T('Avtrekk', 'Extract air'), 'sk-etikett', 'end') + tekst(58, yA + 4, T('Avkast', 'Exhaust air'), 'sk-etikett', 'start');

    // each part at its place. A sensor hangs outside the duct or in the gap, by turns.
    const tegnVann = (it) => {
      const v = it.v, x = it.x, xt = x - 6, xr = x + 8, y1 = yT + (hK + 18) / 2, y2 = y1 + 132, kl = it.t;
      let o = `<line class="sk-ror tur ${kl}" x1="${xt}" y1="${y1}" x2="${xt}" y2="${y2}"/><line class="sk-ror retur ${kl}" x1="${xr}" y1="${y1}" x2="${xr}" y2="${y2}"/>`;
      if (v.retur) o += gruppe(v.retur, 'foler', `<line class="sk-stilk" x1="${xr}" y1="${y1 + 22}" x2="${xr + 22}" y2="${y1 + 22}"/><circle class="sk-ring" cx="${xr + 31}" cy="${y1 + 22}" r="10"/>
        ${tekst(xr + 31, y1 + 26, 'T', 'sk-bok')}${tekst(xr + 48, y1 + 18, merke(v.retur), 'sk-kode', 'start')}${tekst(xr + 48, y1 + 34, verdi(v.retur.pkt.pv), 'sk-v', 'start')}`);
      if (v.pumpe) {
        // On the pipe the description names; a pump is on the flow unless it says return
        const k = v.pumpe, y = y1 + 64, p = k.pkt.paadrag || k.pkt.start || k.pkt.drift, ret = retningAv(k) === 'retur', xp = ret ? xr : xt;
        o += gruppe(k, 'rotor', `<circle class="sk-kropp" cx="${xp}" cy="${y}" r="12"/><path class="sk-pil" d="M${xp - 7} ${y + 5}L${xp} ${y - 8}L${xp + 7} ${y + 5}z"/>
          ${tekst(ret ? xp + 20 : xp - 20, y - 2, merke(k) === k.eier ? T('Pumpe', 'Pump') : merke(k), 'sk-kode', ret ? 'start' : 'end')}${p ? tekst(ret ? xp + 20 : xp - 20, y + 14, verdi(p), 'sk-v', ret ? 'start' : 'end') : ''}${haandMerke(k, xp + 16, y + 14)}${varsel(k, xp + 16, y - 8)}`);
      }
      if (v.ventil) o += ventil(v.ventil, retningAv(v.ventil) === 'tur' ? xt : xr, y1 + 106, true);
      if (v.frost) o += gruppe(v.frost, 'foler', `<circle class="sk-ring" cx="${xt - 36}" cy="${y1 + 22}" r="10"/>${tekst(xt - 36, y1 + 26, 'F', 'sk-bok')}
        ${tekst(xt - 52, y1 + 18, T('Frost', 'Frost'), 'sk-kode', 'end')}${tekst(xt - 52, y1 + 34, iAlarm(v.frost) ? T('alarm', 'alarm') : 'ok', 'sk-v', 'end')}${varsel(v.frost, xt - 36, y1 + 4)}`);
      return o;
    };
    const tegnIt = (it, y, forsyning) => {
      if (it.typ === 'sensor') return foler(it.k, it.x, y, forsyning ? !it.ute : it.ute, BOK[it.k.art] || '?');
      if (it.typ === 'rotor') return rotor(it.k, it.x, y, it.retn, 24);
      if (it.typ === 'varmebatteri' || it.typ === 'kjolebatteri') return boks(it.k, it.x, y, hK + 18, it.typ) + (harV(it.v) ? tegnVann(it) : '');
      return boks(it.k, it.x, y, hK + 18, it.typ);
    };
    // the duct edge a sensor's stalk starts on
    const kant = (it, y) => it.typ === 'sensor' ? y + (it.opp ? -hK / 2 : hK / 2) : y;
    for (const it of [...ls.liste, ...rs.liste]) d += it.typ === 'sensor' ? foler(it.k, it.x, yT + (it.ute ? hK / 2 : -hK / 2), !it.ute, BOK[it.k.art] || '?') : tegnIt(it, yT, true);
    for (const it of [...le.liste, ...re.liste]) d += it.typ === 'sensor' ? foler(it.k, it.x, yA + (it.ute ? -hK / 2 : hK / 2), it.ute, BOK[it.k.art] || '?') : tegnIt(it, yA, false);

    // heat recovery, across both ducts
    if (gj) {
      const y0 = yA - 46, h = yT - yA + 92, v = gj.pkt.virkningsgrad, ym = (yA + yT) / 2;
      const merk = `${tekst(xG - 34, ym - 14, merke(gj), 'sk-kode', 'end')}
        ${gj.pkt.paadrag ? tekst(xG - 34, ym + 2, verdi(gj.pkt.paadrag), 'sk-v', 'end') : ''}
        ${v ? tekst(xG - 34, ym + 18, 'η ' + verdi(v), 'sk-v', 'end') : ''}${haandMerke(gj, xG + 24, y0 + h - 4)}${varsel(gj, xG - 26, y0 + 6)}`;
      if (vtype === 'kryss') {
        // A cross-flow plate exchanger: the two air paths cross inside a diamond, as it is drawn on a station's graphics.
        d += gruppe(gj, 'gjenvinner', `<rect class="sk-kropp" x="${xG - 28}" y="${y0}" width="56" height="${h}" rx="6"/>
          <path class="sk-strek" d="M${xG - 28} ${yA}L${xG + 28} ${yT}M${xG - 28} ${yT}L${xG + 28} ${yA}"/>
          <path class="sk-pil" d="M${xG + 28} ${yT}l-9 -2l3 -8z M${xG + 28} ${yA}l-9 2l3 8z"/>${merk}`);
      } else if (vtype === 'vaeske') {
        // Liquid-coupled recovery: a coil in each duct, joined by a pipe loop with a pump.
        const xt = xG - 7, xr = xG + 7, y1 = yA + hK / 2 + 6, y2 = yT - hK / 2 - 6;
        const spole = (y) => `<rect class="sk-kropp" x="${xG - 20}" y="${y - hK / 2 - 4}" width="40" height="${hK + 8}" rx="5"/><path class="sk-strek" d="M${xG - 10} ${y - 12}l5 8l5 -8l5 8l5 -8M${xG - 10} ${y + 6}l5 8l5 -8l5 8l5 -8"/>`;
        d += gruppe(gj, 'gjenvinner', `<line class="sk-ror tur varme" x1="${xt}" y1="${y1}" x2="${xt}" y2="${y2}"/><line class="sk-ror retur varme" x1="${xr}" y1="${y1}" x2="${xr}" y2="${y2}"/>
          ${spole(yA)}${spole(yT)}<circle class="sk-kropp" cx="${xt}" cy="${ym}" r="12"/><path class="sk-pil" d="M${xt - 7} ${ym + 5}L${xt} ${ym - 8}L${xt + 7} ${ym + 5}z"/>${merk}`);
      } else {
        d += gruppe(gj, 'gjenvinner', `<rect class="sk-kropp" x="${xG - 24}" y="${y0}" width="48" height="${h}" rx="10"/>
          <path class="sk-strek" d="M${xG - 12} ${yA + 52}A40 40 0 0 1 ${xG + 12} ${yA + 52}M${xG + 12} ${yT - 52}A40 40 0 0 1 ${xG - 12} ${yT - 52}"/>
          <path class="sk-pil" d="M${xG + 12} ${yA + 52}l-8 -2l5 -6z M${xG - 12} ${yT - 52}l8 2l-5 6z"/>${merk}`);
      }
    }
    const STAS = {inntak: ['Inntak', 'Intake'], etter: ['Etter gjenvinner', 'After recovery'], tilluft: ['Tilluft', 'Supply'], avtrekk: ['Avtrekk', 'Extract'], avkast: ['Avkast', 'Exhaust']};
    const brukt = [];
    const hvorFor = (k) => tn(STAS, st.get(k) || '') || '';
    for (const it of [...ls.liste, ...le.liste, ...rs.liste, ...re.liste]) brukt.push({k: it.k, hvor: it.typ === 'varmebatteri' || it.typ === 'kjolebatteri' ? T('Batteri', 'Coil') : (STAS[st.get(it.k)] ? hvorFor(it.k) : T('Luftveien', 'Air path')), basis: st.basis.get(it.k) || 'beskrivelse'});
    if (gj) brukt.push({k: gj, hvor: T('Gjenvinner', 'Recovery'), basis: 'beskrivelse'});
    for (const sp of spoler) for (const k of [sp.v.pumpe, sp.v.ventil, sp.v.retur, sp.v.frost]) if (k) brukt.push({k, hvor: sp.t === 'varme' ? T('Varmebatteri, vann', 'Heating coil, water') : T('Kjølebatteri, vann', 'Cooling coil, water'), basis: k.sted === 'batteriretur' && k.siffer ? 'verdi' : 'beskrivelse'});
    return {svg: d, bredde: B, hoyde: yT + 215, topp: 36, rest: K.filter(k => !tatt.has(k)), brukt, veksler: gj ? vtype : ''};
  }

  /* ----------------------------------------------------- heating circuits */
  /* What a plant calls the parts of a heating or cooling system is in the description, after the
     tag: "320.001-RT402 Tur fra fjernvarme", "Retur til VP veksler", "Trykkgiver ekspansjonskar".
     Take away the tag, the kind of sensor and the direction, and what is left is what the pipe
     goes to or comes from. Sensors with the same subject belong to the same part of the plant. */
  const STOPP = /\b(miscellaneous|temperature|pressure|flow|return|output|input|float|value|pådrag|sirk|pumper|diff|differansetrykk|ekspansjonstrykk|ventilposisjon|posisjon|plan|tur|retur|fra|til|på|paa|ved|av|for|og|temperaturføler|temperaturgiver|tempgiver|temperatur|temp|trykkgiver|trykk|føler|giver|ventilmotor|motor|ventil|sirkulasjonspumpe|pumpe|pumpa|vifte|nr|kurs|krets)\b\.?/gi;
  const SKRIV = {vp: 'VP', jp: 'JP', sb: 'SB', rt: 'RT', rp: 'RP', vv: 'VV', vvb: 'VVB', fv: 'FV'};
  const pen = (e) => String(e || '').split(' ').map((o, i) => SKRIV[o] || (i === 0 ? o.charAt(0).toUpperCase() + o.slice(1) : o)).join(' ');
  const retningAv = (k) => {
    const b = ' ' + String(k.beskr || '').toLowerCase() + ' ';
    if (/\bretur\b|\breturn\b/.test(b)) return 'retur';
    if (/\btur\b|\bflow temp/.test(b)) return 'tur';
    return k.sted === 'retur' || k.sted === '5' ? 'retur' : k.sted === 'tur' || k.sted === '4' ? 'tur' : '';
  };
  const emneAv = (k) => {
    const o = String(k.beskr || '').toLowerCase().replace(/^\s*[a-zæøå]{2}\d{2,4}\b/, ' ').replace(/\b(re)?tur(temperatur|trykk|temp)\b/g, ' ').replace(STOPP, ' ').replace(/[^a-zæøå ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    while (o.length > 1 && o[o.length - 1].length <= 2 && o[o.length - 1] !== 'vp') o.pop();
    return o.slice(0, 2).join(' ');
  };
  const SYMBOL = [[/ekspansjon|expansion/, 'ekspansjon'], [/\bvp\b|varmepumpe/, 'vp'], [/veksler/, 'veksler'], [/tank|akkumulator|beredder|bereder/, 'tank']];
  // What a circuit is not made of: a setpoint, a limit, a deviation, a text that says the part is not there.
  const INNST_KURS = /settpunkt|setpoint|hysterese|grense|avvik|differanse(?!trykk)|finnes ikke|forsinkelse|kurve\b|\b(høy|lav|laveste|høyeste)\b|1\s*=\s*av|=\s*manuell/i;
  const romDel = (k) => k.sted === 'rom' || /\brom\b/i.test(k.beskr || '');
  function delkretser(s) {
    const g = new Map();
    for (const k of s.komp) {
      if (!['temp', 'trykk', 'difftrykk', 'ekspansjon'].includes(k.art) || !k.pkt.pv) continue;
      if (INNST_KURS.test(k.beskr || '')) continue;
      // room sensors in a circuit are rooms, not a part of the pipe work
      if (k.sted === 'rom' || /\brom\b/i.test(k.beskr || '')) continue;
      if (!retningAv(k) && k.art !== 'ekspansjon') continue;
      const e = emneAv(k);
      if (!e) continue;
      if (!g.has(e)) g.set(e, {del: e, komp: []});
      g.get(e).komp.push(k);
    }
    // One subject or none: the system is one circuit, as before. Several: a column each.
    if (g.size < 2) return [s];
    const standard = g.has('hovedstokk') ? 'hovedstokk' : [...g.values()].filter(x => x.komp.some(k => retningAv(k))).sort((a, b) => b.komp.length - a.komp.length)[0].del;
    const tilordnet = new Set([...g.values()].flatMap(x => x.komp));
    // The words of a subject that a part's own words contain: "Pumpe gulvvarme sekundær" belongs with "gulvvarme".
    const treff = (e) => {
      const ord = new Set(e.split(' '));
      let best = null;
      for (const x of g.values()) {
        const nok = x.del.split(' ').filter(o => o.length > 2);
        if (nok.length && nok.every(o => ord.has(o)) && (!best || nok.length > best.n)) best = {x, n: nok.length};
      }
      return best && best.x;
    };
    for (const k of s.komp) {
      if (tilordnet.has(k)) continue;
      const e = emneAv(k);
      const hit = g.get(e) || (e ? treff(e) : null);
      if (hit) hit.komp.push(k);
      else if (e && !INNST_KURS.test(k.beskr || '') && !romDel(k) && ((k.art === 'pumpe' && (k.pkt.paadrag || k.pkt.start || k.pkt.drift || k.pkt.pv)) || (k.art === 'ventil' && (k.pkt.paadrag || k.pkt.pv)))) g.set(e, {del: e, komp: [k]});
      else g.get(standard).komp.push(k);
    }
    return [...g.values()].map(x => ({id: s.id, del: x.del, komp: x.komp, rom: s.rom, romData: s.romData, type: s.type,
      symbol: (SYMBOL.find(([re]) => re.test(x.del)) || [])[1] || ''}));
  }
  const GENERISK = /=|utgang|inngang|\bverdi\b|manuell|\bauto\b|\bstart\b|stopp|\bdrift\b|\bfeil|alarm|settpunkt|vender|grenseverdi|forvarsel|differanse|\bcs\b|\bh[øo]yt\b|\blavt\b|miscellaneous|\bflow\b|\breturn\b/i;
  const TITTELSTOPP = new Set(['settpunkt', 'grenseverdi', 'alarm', 'temperatur', 'differansetrykk', 'differanse', 'trykk', 'trykkgiver', 'trykkvakt', 'forvarsel', 'regulering',
    'ventil', 'ventilmotor', 'pumpe', 'pådrag', 'paadrag', 'status', 'aktuell', 'aktuelt', 'arbeidende', 'manuell', 'manuelt', 'verdi', 'feilmelding', 'drift', 'start', 'startsignal',
    'sirkulasjonspumpe', 'temperaturføler', 'føler', 'giver', 'kommunikasjonsfeil', 'vender', 'auto', 'utgang', 'inngang', 'enum', 'høyt', 'lavt', 'høy', 'lav', 'temp', 'varme', 'fjernvarme',
    'miscellaneous', 'temperature', 'pressure', 'float', 'output', 'input', 'value', 'return', 'supply', 'setpoint']);
  /* The name that comes up most in what the points of a system say about themselves, with the words that
     describe kinds of points taken away: "tørrkjølekrets" from "Settpunkt tørrkjølekrets" and its alarms. */
  function systemTittel(s) {
    const tall = new Map();
    for (const k of s.komp) for (const p of Object.values(k.pkt).flat()) {
      if (!p || !p.description) continue;
      const ord = new Set(String(p.description).toLowerCase().replace(/^sd\w{2}\s+/, '').split(/[^a-zæøå]+/).filter(o => o.length >= 5 && !TITTELSTOPP.has(o)));
      for (const o of ord) tall.set(o, (tall.get(o) || 0) + (/krets|anlegg|kurs$|maskin|veksler|tank|baffel/.test(o) ? 3 : 1));
    }
    // Only a word that names a part of a plant is a title; the rest ("command", "alarm") is not.
    const best = [...tall].filter(([o]) => /krets|anlegg|kurs|veksler|tank|baffel|kj[øo]l|varme|gulv|radiator|batteri|aggregat|bereder|kjel|k[øo]lle/.test(o))
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
    return best ? best[0].charAt(0).toUpperCase() + best[0].slice(1) : '';
  }
  function kursNavn(s) {
    const k = s.komp.find(z => z.art === 'temp' && z.sted === 'tur' && !GENERISK.test(z.beskr || '')) || s.komp.find(z => z.beskr && !GENERISK.test(z.beskr) && z.beskr.length > 7);
    const n = (k ? k.beskr : '').replace(/^\s*[A-Za-zÆØÅæøå]{2}\d{2,4}\b/, '').replace(/\b(re)?tur(temperatur|temp\.?)\b/gi, '').replace(/temperaturf[øo]ler|tempgiver|turtemp\.?|\btemp\b\.?|trykkgiver|sirkulasjonspumpe|ventilmotor|\btur\b|\bretur\b/gi, '').replace(/\s+/g, ' ').trim();
    return n ? n[0].toUpperCase() + n.slice(1) : systemTittel(s);
  }
  /* The symbol of a part of the plant that has no pipe of its own, drawn between the two pipes. */
  function symbolKurs(sym, cx, y) {
    if (sym === 'ekspansjon') return `<ellipse class="sk-kropp" cx="${cx}" cy="${y}" rx="22" ry="32"/><path class="sk-strek" d="M${cx - 22} ${y}Q${cx} ${y - 12} ${cx + 22} ${y}"/>`;
    if (sym === 'vp') return `<rect class="sk-kropp" x="${cx - 24}" y="${y - 20}" width="48" height="40" rx="7"/>${tekst(cx, y + 5, 'VP', 'sk-kode')}`;
    if (sym === 'veksler') return `<rect class="sk-kropp" x="${cx - 22}" y="${y - 28}" width="44" height="56" rx="6"/><path class="sk-strek" d="M${cx - 14} ${y + 20}L${cx + 14} ${y - 20}"/>`;
    if (sym === 'tank') return `<rect class="sk-kropp" x="${cx - 20}" y="${y - 32}" width="40" height="64" rx="16"/>`;
    return '';
  }
  function tegnKurser(systemer, type) {
    const t = type === 'kjoling' ? 'kjol' : 'varme';
    const kol = systemer.flatMap(delkretser);
    const kb = 316, x0 = 110, yTopp = 96, yTur = 560, yRet = 612, B = x0 + kol.length * kb + 30;
    let d = `<line class="sk-ror tur ${t}" x1="40" y1="${yTur}" x2="${B - 40}" y2="${yTur}"/><line class="sk-ror retur ${t}" x1="40" y1="${yRet}" x2="${B - 40}" y2="${yRet}"/>
      <path class="sk-flyt" d="M34 ${yTur - 6}l9 6l-9 6"/><path class="sk-flyt" d="M43 ${yRet - 6}l-9 6l9 6"/>`;
    const rest = [], brukt = [];
    let ute = null;
    kol.forEach((s, i) => {
      const xt = x0 + i * kb + 110, xr = xt + 62, tatt = new Set();
      const ta = (f) => { const l = s.komp.filter(k => !tatt.has(k) && f(k)); l.forEach(k => tatt.add(k)); return l; };
      d += `<line class="sk-ror tur ${t}" x1="${xt}" y1="${yTopp + 34}" x2="${xt}" y2="${yTur}"/><line class="sk-ror retur ${t}" x1="${xr}" y1="${yTopp + 34}" x2="${xr}" y2="${yRet}"/>
        <path class="sk-flyt" d="M${xt - 6} ${yTopp + 44}l6 -9l6 9"/><path class="sk-flyt" d="M${xr - 6} ${yTopp + 35}l6 9l6 -9"/>
        <circle class="sk-dot" cx="${xt}" cy="${yTur}" r="3"/><circle class="sk-dot" cx="${xr}" cy="${yRet}" r="3"/>`;
      const t1 = s.del ? pen(s.del) : (s.id || T('Kurs', 'Circuit')), t2 = s.del ? (s.id || '') : kursNavn(s);
      d += tekst(xt + 31, yTopp - 8, t1.slice(0, 22), 'sk-tittel') + tekst(xt + 31, yTopp + 10, t2.slice(0, 30), 'sk-under');
      const u = ta(k => k.art === 'temp' && k.sted === 'ute');
      if (u[0] && !ute) ute = u[0];
      // sensors: flow side to the left of the flow pipe, return side to the right of the return pipe
      const side = (liste, x, venstre, y0) => liste.forEach((k, n) => {
        const y = y0 + n * 56, cx = x + (venstre ? -31 : 31);
        d += gruppe(k, 'foler', `<line class="sk-stilk" x1="${x}" y1="${y}" x2="${cx + (venstre ? 9 : -9)}" y2="${y}"/><circle class="sk-ring" cx="${cx}" cy="${y}" r="9"/>
          ${tekst(cx, y + 4, BOK[k.art] || '?', 'sk-bok')}${tekst(cx + (venstre ? -15 : 15), y - 4, ((m) => m.length > 10 ? m.slice(0, 9) + '…' : m)(String(merke(k))), 'sk-kode', venstre ? 'end' : 'start')}
          ${tekst(cx + (venstre ? -15 : 15), y + 12, verdi(k.pkt.pv), 'sk-v', venstre ? 'end' : 'start')}${k.pkt.sp ? tekst(cx + (venstre ? -15 : 15), y + 28, verdi(k.pkt.sp), 'sk-sp', venstre ? 'end' : 'start') : ''}${varsel(k, cx, y - 16)}`);
      });
      const maal = ['temp', 'trykk', 'difftrykk', 'mengde'];
      // the description says which side; where it does not, the number does
      const tur = (k) => retningAv(k) === 'tur', ret = (k) => retningAv(k) === 'retur';
      const sL = ta(k => maal.includes(k.art) && k.pkt.pv && tur(k) && !INNST_KURS.test(k.beskr || '')).slice(0, 4);
      const sR = ta(k => maal.includes(k.art) && k.pkt.pv && ret(k) && !INNST_KURS.test(k.beskr || '')).slice(0, 4);
      // A pressure that names no side hangs on the side that has fewer sensors, never in the gap between the pipes
      // where the labels of both sides would run into it. With a vessel or a heat pump symbol it stays beside the symbol.
      const ensidig = s.symbol ? [] : ta(k => (k.art === 'ekspansjon' || k.art === 'trykk') && k.pkt.pv && !INNST_KURS.test(k.beskr || ''));
      ensidig.forEach(k => (sL.length <= sR.length ? sL : sR).push(k));
      side(sL.slice(0, 5), xt, true, yTopp + 78);
      side(sR.slice(0, 5), xr, false, yTopp + 78);
      // a part with no pipe of its own: its symbol between the pipes, its pressures beside it
      const cx0 = xt + 31;
      if (s.symbol) d += symbolKurs(s.symbol, cx0, yTopp + 130);
      const trykk = ta(k => (k.art === 'ekspansjon' || k.art === 'trykk') && k.pkt.pv && !INNST_KURS.test(k.beskr || ''));
      trykk.forEach((k, n) => {
        d += gruppe(k, 'foler', `${tekst(cx0 + 36, yTopp + 112 + n * 30, merke(k), 'sk-kode', 'start')}${tekst(cx0 + 36, yTopp + 128 + n * 30, verdi(k.pkt.pv), 'sk-v', 'start')}`);
      });
      // Pumps and valves go on the pipe the description says they sit on; where it says nothing, a pump is on the flow and
      // a valve on the return. Each pipe has its own row, so two parts on one pipe stand one above the other.
      const rader = {tur: 0, retur: 0};
      const plass = (k, standard) => { const side = retningAv(k) || standard; return [side, rader[side]++]; };
      // A pump with something to show, and a valve with a position: not a setting, not a mode switch, not a room's radiator valve.
      const pumper = ta(k => k.art === 'pumpe' && (k.pkt.paadrag || k.pkt.start || k.pkt.drift || k.pkt.pv)).slice(0, 3);
      pumper.forEach((k) => {
        const [side, n] = plass(k, 'tur'), x = side === 'tur' ? xt : xr, v = side === 'tur', y = (side === 'tur' ? yTur : yRet) - 118 + n * 44, p = k.pkt.paadrag || k.pkt.start || k.pkt.drift;
        d += gruppe(k, 'rotor', `<circle class="sk-kropp" cx="${x}" cy="${y}" r="14"/><path class="sk-pil" d="M${x - 8} ${y + 6}L${x} ${y - 9}L${x + 8} ${y + 6}z"/>
          ${tekst(v ? x - 22 : x + 22, y - 2, merke(k), 'sk-kode', v ? 'end' : 'start')}${p ? tekst(v ? x - 22 : x + 22, y + 14, verdi(p), 'sk-v', v ? 'end' : 'start') : ''}${haandMerke(k, x + 17, y + 15)}${varsel(k, x + 17, y - 9)}`);
      });
      ta(k => k.art === 'ventil' && (k.pkt.paadrag || k.pkt.pv) && !INNST_KURS.test(k.beskr || '') && !romDel(k)).slice(0, 3).forEach((k) => {
        const [side, n] = plass(k, 'retur');
        d += ventil(k, side === 'tur' ? xt : xr, (side === 'tur' ? yTur : yRet) - 118 + n * 44, true);
      });
      // what else the circuit has, as quiet labels under its name
      const annet = ta(k => ['varmepumpe', 'elkjel', 'kjel', 'tank', 'veksler', 'energimaaler', 'fjernvarme', 'kompressor'].includes(k.art) && !INNST_KURS.test(k.beskr || ''));
      const tell = new Map();
      annet.forEach(k => tell.set(k.art, (tell.get(k.art) || 0) + 1));
      const linje = [...tell].map(([a, n]) => (n > 1 ? n + ' ' : '') + tn(ART, a).toLowerCase()).concat(s.rom.size ? [`${s.rom.size} ${s.rom.size === 1 ? T('rom', 'room') : T('rom', 'rooms')}`] : []).join(' · ');
      if (linje) d += tekst(xt + 31, yTopp + 28, linje.slice(0, 34), 'sk-under svak');
      for (const k of tatt) brukt.push({k, hvor: t1 + (t2 ? ' · ' + t2 : ''), basis: s.del ? 'beskrivelse' : (k.sted === '4' || k.sted === '5' ? 'tall' : 'beskrivelse')});
      rest.push(...s.komp.filter(k => !tatt.has(k)));
    });
    if (ute) d += foler(ute, 62, 118, true, 'T') + tekst(62, 136, T('Ute', 'Outdoor'), 'sk-etikett');
    return {svg: d, bredde: B, hoyde: yRet + 36, topp: 40, rest, brukt};
  }

  /* ---------------------------------------------------------- sprinkler */
  /* Shut-off valves and pressure switches of a sprinkler system: not a circuit, so no flow and
     return, only the main with what sits on it and whether the valves stand open. */
  function stengt(k) {
    const ps = Object.values(k.pkt).flat().filter(Boolean);
    const tekst = [k.beskr, ...ps.map(p => p.description || '')].join(' ').toLowerCase();
    const p = k.pkt.alarm[0] || k.pkt.drift || k.pkt.start || k.pkt.pv;
    if (!p) return null;
    const aktiv = paa(p);
    if (/åpen|aapen|open/.test(tekst) && !/stengt|closed|lukket/.test(tekst)) return !aktiv;
    if (/stengt|closed|lukket/.test(tekst)) return aktiv;
    return null;
  }
  function tegnSprinkler(liste) {
    const B = 1000, rad = 210;
    let d = '';
    const rest = [];
    liste.forEach((s, i) => {
      const y = 110 + i * rad, yr = y + 40;
      const K = s.komp.filter(k => harLevende(k) || k.art === 'stengeventil');
      const deler = [...K.filter(k => k.art === 'stengeventil'), ...K.filter(k => k.art === 'pumpe'), ...K.filter(k => !['stengeventil', 'pumpe'].includes(k.art))];
      d += tekst(50, y - 44, s.id || T('Sprinkler', 'Sprinkler'), 'sk-tittel', 'start');
      d += tekst(50, y - 26, T('Brannslokking, ikke en varme- eller kjølekurs', 'Fire protection, not a heating or cooling circuit'), 'sk-under svak', 'start');
      d += `<line class="sk-ror spr" x1="50" y1="${yr}" x2="${B - 50}" y2="${yr}"/>`;
      const steg = Math.min(120, (B - 200) / Math.max(1, deler.length));
      deler.forEach((k, n) => {
        const x = 110 + n * steg;
        if (k.art === 'stengeventil') {
          const st = stengt(k), p = k.pkt.alarm[0] || k.pkt.drift || k.pkt.start || k.pkt.pv;
          const kl = st === true ? ' stengt' : '';
          d += gruppe(k, 'stengeventil' + kl, `<path class="sk-kropp" d="M${x - 11} ${yr - 11}L${x + 11} ${yr + 11}L${x + 11} ${yr - 11}L${x - 11} ${yr + 11}z"/>
            ${tekst(x, yr - 22, merke(k), 'sk-kode')}${tekst(x, yr + 32, st === null ? verdi(p) : st ? T('Stengt', 'Closed') : T('Åpen', 'Open'), 'sk-v')}${varsel(k, x + 14, yr - 20)}`);
        } else if (k.art === 'pumpe') d += rotor(k, x, yr, 'h', 18);
        else d += foler(k, x, yr + 0, false, BOK[k.art] || '?');
      });
      rest.push(...s.komp.filter(k => !K.includes(k)));
    });
    return {svg: d, bredde: B, hoyde: 110 + liste.length * rad, topp: 40, rest};
  }

  /* ------------------------------------------------------------ the pane */
  const SK = {vis: false, valgt: {}, sist: '', systemer: [], ip: ''};
  const tegnbare = (s) => (s.type === 'ventilasjon' && s.komp.length >= 3) || (s.type === 'sprinkler' && s.komp.length >= 1) ||
    // A circuit with no system number needs a sensor on it. Two valves on their own are not a circuit.
    ((s.type === 'varme' || s.type === 'kjoling') && s.komp.length >= 2 && (!!s.id || s.komp.some(k => k.art === 'temp')));

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
    const vent = SK.systemer.filter(s => s.type === 'ventilasjon' && tegnbare(s));
    const f = vent.map(s => ({id: 'v:' + s.id, navn: (s.id ? s.id + ' ' : '') + T('Aggregat', 'Air handling'), type: 'aggregat', s}));
    for (const [type, navn] of [['varme', T('Varme', 'Heating')], ['kjoling', T('Kjøling', 'Cooling')]]) {
      const l = SK.systemer.filter(s => s.type === type && tegnbare(s));
      if (l.length) f.push({id: type, navn: `${navn} · ${l.length} ${T(l.length === 1 ? 'kurs' : 'kurser', l.length === 1 ? 'circuit' : 'circuits')}`, type: 'kurser', kind: type, l});
    }
    const spr = SK.systemer.filter(s => s.type === 'sprinkler');
    if (spr.length) f.push({id: 'sprinkler', navn: `${T('Sprinkler', 'Sprinkler')} · ${spr.length}`, type: 'sprinkler', l: spr});
    const rom = SK.systemer.flatMap(s => [...s.romData.values()]).filter(r => r.temp || r.co2 || r.varme || r.luft || r.lux || r.lys || r.mengde || r.bevegelse);
    if (rom.length) f.push({id: 'rom', navn: `${T('Rom', 'Rooms')} · ${rom.length}`, type: 'rom', l: rom});
    return f;
  }

  function oppdater() {
    const ip = S.activeDev ? S.activeDev.address : '';
    const sig = ip + '|' + S.points.length;
    if (sig !== SK.sist) {
      SK.sist = sig; SK.ip = ip;
      SK.systemer = ip ? byggSystemer(S.points).filter(s => tegnbare(s) || s.romData.size) : [];
    } else {
      // same device, new values: the components hold the point objects, which the poll may have replaced
      const naa = new Map(S.points.map(p => [p.objid, p]));
      for (const s of SK.systemer) for (const k of s.komp) {
        for (const [r, p] of Object.entries(k.pkt)) k.pkt[r] = Array.isArray(p) ? p.map(x => naa.get(x.objid) || x) : (naa.get(p.objid) || p);
      }
      for (const s of SK.systemer) for (const r of s.romData.values()) {
        for (const f of ['temp', 'tempSp', 'co2', 'co2Sp', 'varme', 'luft', 'bevegelse', 'lux', 'luxSp', 'lys', 'mengde']) if (r[f]) r[f] = naa.get(r[f].objid) || r[f];
        r.alle = (r.alle || []).map(x => naa.get(x.objid) || x);
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
    SK.kompVed = new Map();
    for (const s of SK.systemer) for (const k of s.komp) { const h = hoved(k); if (h) SK.kompVed.set(h.objid, k); }
    const hode = (stor, ekstra = '') => `<div class="sk-hode"><div class="sk-faner" role="tablist">${f.map(x => `<button type="button" role="tab" data-fane="${esc(x.id)}" class="${x === valgt ? 'sel' : ''}" aria-selected="${x === valgt}">${esc(x.navn)}</button>`).join('')}</div>
        <span class="sk-forkl">${valgt.type === 'kurser' ? `<i class="sk-sw tur ${valgt.kind === 'kjoling' ? 'kjol' : 'varme'}"></i>${T('tur', 'flow')}<i class="sk-sw retur ${valgt.kind === 'kjoling' ? 'kjol' : 'varme'}"></i>${T('retur', 'return')}` : ''}${valgt.type === 'rom' ? '' : `<span class="sk-merke drift" aria-hidden="true">✓</span>${T('i drift', 'running')}<span class="sk-merke haand" aria-hidden="true">■</span>${T('i hånd', 'in hand')}<span class="sk-merke alarm" aria-hidden="true">▲</span>${T('alarm', 'alarm')}`}
          ${ekstra}<button type="button" class="btn sk-underlag" data-underlag title="${esc(T('Lagrer det skjemaet er tegnet fra (navn, beskrivelser og hva hver del ble tolket som) som en fil. Send den hvis noe ser feil ut, så kan det rettes.', 'Saves what the schematic is drawn from (names, descriptions and what each part was taken to be) as a file. Send it if something looks wrong so it can be fixed.'))}">${T('Lagre underlag', 'Save basis')}</button>
          <button type="button" class="btn sk-utvid" data-utvid aria-pressed="${stor}" title="${esc(stor ? T('Vis hele enhetslista igjen', 'Show the whole device list again') : T('Gi skjemaet mer av bredden', 'Give the schematic more of the width'))}">${stor ? T('Vis enhetsliste', 'Show device list') : T('Utvid', 'Expand')}</button></span></div>`;
    if (valgt.type === 'rom') { settInn(hode(document.body.classList.contains('sk-stor')) + romHtml(valgt.l)); return; }
    SK.kompVed = SK.kompVed || new Map();
    const vValg = valgt.type === 'aggregat' ? (vekslerLagret()[vekslerNokkel(valgt.s)] || '') : '';
    const r = valgt.type === 'aggregat' ? tegnAggregat(valgt.s, vValg) : valgt.type === 'sprinkler' ? tegnSprinkler(valgt.l) : tegnKurser(valgt.l, valgt.kind);
    const harTall = (k) => { const h = hoved(k); return h && ((typeof h.value === 'number' && Number.isFinite(h.value)) || k.pkt.alarm.length || h.value === 'active'); };
    const aktuelle = r.rest.filter(k => k.art !== 'effekt' && hoved(k) && harTall(k));
    // The refrigerant circuit of a heat pump (evaporator, condenser, superheat, compressor) is not in the air path:
    // it gets a group of its own, with what each point is called, instead of being lost among the rest.
    const vp = aktuelle.filter(k => k.art === 'varmepumpe').slice(0, 16);
    const rest = aktuelle.filter(k => k.art !== 'varmepumpe').slice(0, 18);
    const brikke = (k) => { const h = hoved(k);
      return `<button type="button" class="${klasser(k, 'sk-brikke')}" data-o="${esc(h.objid)}" title="${esc(h.name || '')}"><b>${esc(k.kode || k.beskr || merke(k))}</b>${k.sted && NAVN[k.sted] ? `<i>${esc(tn(NAVN, k.sted))}</i>` : ''}<span>${esc(verdi(h))}</span></button>`; };
    const vpHtml = vp.length ? `<div class="sk-rest"><span class="sk-rest-t">${T('Varmepumpe, kuldekrets', 'Heat pump, refrigerant circuit')}</span>${vp.map(brikke).join('')}</div>` : '';
    const rom = valgt.type === 'aggregat' && valgt.s.rom.size ? `<span class="sk-rom">${valgt.s.rom.size} ${valgt.s.rom.size === 1 ? T('rom styres herfra', 'room is controlled from here') : T('rom styres herfra', 'rooms are controlled from here')}</span>` : '';
    // Text must stay readable: the drawing is never scaled below 85 percent, it scrolls sideways instead
    const minB = valgt.type === 'kurser' ? Math.max(520, r.bredde * 0.85) : valgt.type === 'aggregat' ? r.bredde * 0.85 : 0;
    const stor = document.body.classList.contains('sk-stor');
    const vekslerVelger = r.veksler ? `<span class="sk-veksler" role="group" aria-label="${esc(T('Type varmegjenvinner', 'Type of heat recovery'))}"><span class="sk-vtekst">${T('Veksler', 'Recovery')}</span>${
      VEKSLER.map(([id, n]) => `<button type="button" data-veksler="${id}" class="${r.veksler === id ? 'sel' : ''}" aria-pressed="${r.veksler === id}">${esc(T(n[0], n[1]))}</button>`).join('')}</span>` : '';
    const html = `${hode(stor, vekslerVelger)}
      <div class="sk-lerret"><svg viewBox="0 ${r.topp || 0} ${r.bredde} ${r.hoyde - (r.topp || 0)}" style="min-width:${Math.round(minB)}px;max-width:${Math.round(r.bredde * 1.35)}px;margin:0 auto" role="img" aria-label="${esc(valgt.navn)}">${r.svg}</svg></div>
      ${taggerHtml(r.brukt)}
      ${vpHtml}
      ${rest.length || rom ? `<div class="sk-rest"><span class="sk-rest-t">${T('Også i systemet', 'Also in the system')}</span>${rom}${rest.map(k => {
        const h = hoved(k);
        return `<button type="button" class="${klasser(k, 'sk-brikke')}" data-o="${esc(h.objid)}"><b>${esc(merke(k))}</b>${k.sted && NAVN[k.sted] ? `<i>${esc(tn(NAVN, k.sted))}</i>` : ''}<span>${esc(verdi(h))}</span></button>`;
      }).join('')}</div>` : ''}
      <div class="sk-fot">${T('Tegnet etter navn og beskrivelse på punktene, ikke etter rørføringen i bygget. Klikk en del for å se punktet, høyreklikk for å feste det i overvåkingen.', 'Drawn from the names and descriptions of the points, not from the piping in the building. Click a part to see its point, right-click to pin it to the watch list.')}</div>`;
    settInn(html);
  }
  /* Every tag the drawing is built from, with what it was taken to mean and on what grounds:
     the words of the description, the number of the tag, or what the sensor reads. */
  function taggerHtml(brukt) {
    if (!brukt || !brukt.length) return '';
    const BAS = {beskrivelse: [T('ord', 'words'), T('Plassert etter ordene i beskrivelsen', 'Placed by the words of the description')],
                 tall: ['#', T('Plassert etter nummeret i taggen. Beskrivelsen sa ikke hvor', 'Placed by the number of the tag. The description did not say where')],
                 verdi: ['≈', T('Plassert etter hva føleren leser, siden ordene og nummeret ikke holdt', 'Placed by what the sensor reads, since neither words nor number were enough')],
                 standard: ['?', T('Antatt: ingenting i navnet sa hvor', 'Assumed: nothing in the name said where')]};
    const grupper = new Map();
    for (const b of brukt) { const g = b.hvor || ''; if (!grupper.has(g)) grupper.set(g, []); grupper.get(g).push(b); }
    const rens = (k) => String(k.beskr || '').replace(/\s+/g, ' ').slice(0, 46);
    return `<details class="sk-tagger" open><summary>${T('Tagger brukt', 'Tags used')} <small>${brukt.length}</small></summary><div class="sk-taggrid">${
      [...grupper].map(([g, l]) => `<div class="sk-tagkol"><div class="sk-tagt">${esc(g)}</div>${l.map(b => {
        const h = hoved(b.k), bs = BAS[b.basis] || BAS.beskrivelse;
        const navn = b.k.kode || b.k.eier || (h && h.name) || merke(b.k);
        return `<button type="button" class="sk-tagrad" data-o="${esc(h ? h.objid : '')}" title="${esc((h && h.name) || '')}"><b>${esc(navn)}</b><span>${esc(rens(b.k))}</span><em>${h ? esc(verdi(h)) : ''}</em><u class="${esc(b.basis)}" title="${esc(bs[1])}">${bs[0]}</u></button>`;
      }).join('')}</div>`).join('')}</div></details>`;
  }
  function settInn(html) {
    if (wrap.innerHTML === html) return;
    const rull = wrap.querySelector('.sk-lerret');
    const rx = rull ? rull.scrollLeft : 0, ry = wrap.scrollTop;
    wrap.innerHTML = html;
    const ny = wrap.querySelector('.sk-lerret');
    if (ny && rx) ny.scrollLeft = rx;
    wrap.scrollTop = ry;
    merkValgt();
  }

  /* Rooms: one card each, the ones furthest from their setpoint first. */
  function romHtml(rom) {
    const tall = (p) => p && typeof p.value === 'number' ? p.value : null;
    const avvik = (r) => tall(r.temp) !== null && tall(r.tempSp) !== null ? tall(r.temp) - tall(r.tempSp) : null;
    const sortert = [...rom].sort((a, b) => Math.abs(avvik(b) ?? -1) - Math.abs(avvik(a) ?? -1) || a.rom.localeCompare(b.rom, 'no', {numeric: true}));
    const bar = (navn, p) => {
      const v = tall(p);
      return v === null ? '' : `<span class="rk-linje"><i>${navn}</i><span class="rk-bar"><b style="width:${Math.max(0, Math.min(100, v)).toFixed(0)}%"></b></span><em>${esc(verdi(p))}</em></span>`;
    };
    return `<div class="sk-romgitter">${sortert.map(r => {
      const a = avvik(r), h = r.temp || r.co2 || r.varme || r.luft || r.lux || r.lys || r.mengde || r.bevegelse;
      const over = r.co2 && r.co2Sp && tall(r.co2) !== null && tall(r.co2Sp) !== null && tall(r.co2) > tall(r.co2Sp);
      return `<button type="button" class="sk-romkort${SK.klikket === h.objid ? ' valgt' : ''}" data-rom="${esc(r.rom)}" data-o="${esc(h.objid)}">
        <span class="rk-topp"><b>${esc(r.rom)}</b><i>${esc(r.sys)}</i></span>
        <span class="rk-temp">${r.temp ? esc(verdi(r.temp)) : '—'}</span>
        <span class="rk-sp">${r.tempSp ? `${T('settpunkt', 'setpoint')} ${esc(verdi(r.tempSp))}` : '&nbsp;'}${a !== null && Math.abs(a) >= 0.05 ? `<em>${a > 0 ? '+' : '−'}${Math.abs(a).toFixed(1)}</em>` : ''}</span>
        ${bar(T('Varme', 'Heating'), r.varme)}${bar(T('Luft', 'Air'), r.luft)}
        ${r.bevegelse ? `<span class="rk-co2"><i>${T('Nærvær', 'Presence')}</i>${esc(verdi(r.bevegelse))}</span>` : ''}${r.lys ? `<span class="rk-co2"><i>${T('Lys', 'Light')}</i>${esc(verdi(r.lys))}</span>` : ''}${r.mengde && tall(r.mengde) !== null ? `<span class="rk-co2"><i>${T('Luft', 'Air')}</i>${esc(verdi(r.mengde))}</span>` : ''}
        ${r.lux && tall(r.lux) !== null ? `<span class="rk-co2"><i>lux</i>${esc(verdi(r.lux))}${r.luxSp ? ` <small>/ ${esc(verdi(r.luxSp))}</small>` : ''}</span>` : ''}
        ${r.co2 ? `<span class="rk-co2${over ? ' over' : ''}"><i>CO2</i>${esc(verdi(r.co2))}${r.co2Sp ? ` <small>/ ${esc(verdi(r.co2Sp))}</small>` : ''}</span>` : ''}
      </button>`;
    }).join('')}</div>
    <div class="sk-fot">${T('Rommene er funnet i navnene på punktene (A109, C126). Sortert etter avstand til settpunkt. Klikk et rom for å se temperaturpunktet.', 'The rooms are found in the names of the points (A109, C126). Sorted by distance from the setpoint. Click a room to see its temperature point.')}</div>`;
  }


  /* A room, opened: the reading with its distance from the setpoint on a scale, what the
     valve and the damper are asked to do, the air quality, and every point the room has. */
  const romLag = document.createElement('div');
  romLag.id = 'romOverlay';
  romLag.className = 'gs-overlay';
  romLag.setAttribute('role', 'dialog');
  romLag.setAttribute('aria-modal', 'true');
  romLag.hidden = true;
  document.body.append(romLag);
  function aapneRom(navn) {
    const r = SK.systemer.flatMap(s => [...s.romData.values()]).find(x => x.rom === navn);
    if (!r) return;
    const tall = (p) => p && typeof p.value === 'number' ? p.value : null;
    const a = tall(r.temp) !== null && tall(r.tempSp) !== null ? tall(r.temp) - tall(r.tempSp) : null;
    const skala = a === null ? '' : `<div class="rp-skala" aria-hidden="true"><i></i><b style="left:${Math.max(3, Math.min(97, 50 + a / 3 * 50)).toFixed(1)}%"></b><span class="l">−3</span><span class="m">${esc(verdi(r.tempSp))}</span><span class="h">+3</span></div>`;
    const bar = (tittel, p) => tall(p) === null ? '' : `<div class="rp-linje"><i>${tittel}</i><span class="rk-bar"><b style="width:${Math.max(0, Math.min(100, tall(p))).toFixed(0)}%"></b></span><em>${esc(verdi(p))}</em></div>`;
    const co2 = r.co2 ? `<div class="rp-linje"><i>CO2</i><span class="rk-bar${r.co2Sp && tall(r.co2) > tall(r.co2Sp) ? ' over' : ''}"><b style="width:${Math.max(2, Math.min(100, tall(r.co2) / (tall(r.co2Sp) || 1000) * 60)).toFixed(0)}%"></b></span><em>${esc(verdi(r.co2))}${r.co2Sp ? ' / ' + esc(verdi(r.co2Sp)) : ''}</em></div>` : '';
    const lux = r.lux ? `<div class="rp-linje"><i>lux</i><em>${esc(verdi(r.lux))}${r.luxSp ? ' / ' + esc(verdi(r.luxSp)) : ''}</em></div>` : '';
    const rader = (r.alle || []).filter(p => p.type !== 'schedule').slice(0, 60);
    const festet = r.temp && S.watch.some(w => w.ip === SK.ip && w.objid === r.temp.objid);
    romLag.innerHTML = `<div class="gs-modal rp-modal"><div class="gs-head"><span class="gd-tittel">${esc(T('Rom ', 'Room ') + r.rom)}</span><span class="rp-sys">${esc(r.sys || '')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="rp-kropp"><div class="rp-stor"><b>${r.temp ? esc(verdi(r.temp)) : '—'}</b><span>${r.tempSp ? T('settpunkt ', 'setpoint ') + esc(verdi(r.tempSp)) : ''}${a !== null && Math.abs(a) >= 0.05 ? ` <em>${a > 0 ? '+' : '−'}${Math.abs(a).toFixed(1)}</em>` : ''}</span></div>
        ${skala}${bar(T('Varme', 'Heating'), r.varme)}${bar(T('Luft', 'Air'), r.luft)}${co2}${lux}
        <div class="rp-liste">${rader.map(p => `<button type="button" class="rp-rad" data-o="${esc(p.objid)}"><span>${esc(String(p.description || p.name).replace(/^SD\w{2}\s+/, ''))}</span><small>${esc(p.name)}</small><b>${esc(verdi(p))}</b></button>`).join('')}</div>
        <div class="op-knapper">${r.temp ? `<button type="button" class="btn" data-rp="fest">${festet ? T('Ta ut av overvåkingen', 'Remove from the watch list') : T('Fest temperaturen', 'Pin the temperature')}</button>` : ''}</div></div></div>`;
    romLag.hidden = false;
    romLag._rom = r;
  }
  romLag.addEventListener('click', async (e) => {
    if (e.target === romLag || e.target.closest('.gs-close')) { romLag.hidden = true; return; }
    const r = romLag._rom;
    if (e.target.closest('[data-rp="fest"]') && r && r.temp) {
      const var_ = S.watch.some(w => w.ip === SK.ip && w.objid === r.temp.objid);
      togglePin(r.temp.objid);
      toast(var_ ? T('Tatt ut av overvåkingen', 'Removed from the watch list') : T('Festet i overvåkingen', 'Pinned to the watch list'));
      aapneRom(r.rom);
      return;
    }
    const k = e.target.closest('.rp-rad');
    if (k) { romLag.hidden = true; SK.klikket = k.dataset.o; try { await selectPoint(k.dataset.o); } catch { /* the inspector says what went wrong */ } }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !romLag.hidden) { romLag.hidden = true; e.stopPropagation(); } }, true);

  /* A card that follows the pointer: everything the part has, in words. */
  const kort = document.createElement('div');
  kort.id = 'skKort';
  kort.className = 'sk-kort';
  kort.hidden = true;
  document.body.append(kort);
  const ROLLENAVN = {pv: ['Verdi', 'Value'], sp: ['Settpunkt', 'Setpoint'], paadrag: ['Pådrag', 'Signal'], drift: ['Drift', 'Running'], start: ['Start', 'Start'],
    vender: ['Vender', 'Switch'], manuell: ['Manuell verdi', 'Manual value'], virkningsgrad: ['Virkningsgrad', 'Efficiency']};
  function visKort(el) {
    const k = SK.kompVed && SK.kompVed.get(el.dataset.o);
    if (!k) { kort.hidden = true; return; }
    const rader = Object.entries(k.pkt).filter(([r, p]) => p && !Array.isArray(p) && ROLLENAVN[r])
      .map(([r, p]) => `<span class="skk-rad"><i>${tn(ROLLENAVN, r)}</i><b>${esc(verdi(p))}</b></span>`);
    const al = k.pkt.alarm.map(p => `<span class="skk-rad${p.value === 'active' ? ' alarm' : ''}"><i>${esc(String(p.description || p.name || '').split(' - ').pop().slice(0, 30))}</i><b>${esc(verdi(p))}</b></span>`).slice(0, 4);
    const w = S.watch.find(x => x.ip === SK.ip && Object.values(k.pkt).flat().some(p => p && p.objid === x.objid));
    const linje = w && typeof sparkPunkter === 'function' ? sparkPunkter(w.hist) : null;
    kort.innerHTML = `<b class="skk-t">${esc(k.kode || k.eier || tn(ART, k.art))}</b><span class="skk-u">${esc(k.beskr || tn(ART, k.art))}${k.sted && NAVN[k.sted] ? ' · ' + esc(tn(NAVN, k.sted)) : ''}</span>
      ${rader.join('')}${al.join('')}
      ${linje ? `<svg class="skk-spark" viewBox="0 0 62 20" preserveAspectRatio="none"><polyline points="${linje}"/></svg>` : ''}
      <span class="skk-hint">${w ? T('Festet i overvåkingen', 'Pinned to the watch list') : T('Høyreklikk for å feste', 'Right-click to pin')}</span>`;
    kort.hidden = false;
    const r = el.getBoundingClientRect(), b = kort.offsetWidth, h = kort.offsetHeight;
    kort.style.left = Math.round(r.right + 14 + b > window.innerWidth - 8 ? Math.max(8, r.left - b - 14) : r.right + 14) + 'px';
    kort.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2))) + 'px';
  }
  wrap.addEventListener('mouseover', (e) => { const el = e.target.closest('.sk-k[data-o], .sk-brikke[data-o]'); if (el) visKort(el); else kort.hidden = true; });
  wrap.addEventListener('mouseleave', () => { kort.hidden = true; });
  wrap.addEventListener('focusin', (e) => { const el = e.target.closest('.sk-k[data-o]'); if (el) visKort(el); });
  wrap.addEventListener('focusout', () => { kort.hidden = true; });
  wrap.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-o]');
    if (!el || !el.dataset.o || !S.pointIndex.get(el.dataset.o) || el.closest('[data-rom]')) return;
    e.preventDefault();
    const festet = S.watch.some(w => w.ip === SK.ip && w.objid === el.dataset.o);
    togglePin(el.dataset.o);
    toast(festet ? T('Tatt ut av overvåkingen', 'Removed from the watch list') : T('Festet i overvåkingen', 'Pinned to the watch list'));
    kort.hidden = true;
  });
  function merkValgt() {
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
    if (el.closest('[data-underlag]')) {
      // Everything the drawing is built from, so a drawing that looks wrong can be reproduced and fixed from the file alone.
      const pkt = (p) => ({name: p.name, description: p.description || '', type: p.type, units: p.units || p.unit || '', value: p.value});
      const ut = {versjon: (document.getElementById('versjon') || {}).textContent || '', enhet: SK.ip, systemer: SK.systemer.map(s => ({
        id: s.id, type: s.type, rom: [...s.rom],
        komp: s.komp.map(k => ({kode: k.kode, eier: k.eier, art: k.art, sted: k.sted, hvor: k.hvor, beskr: k.beskr,
          punkter: Object.fromEntries(Object.entries(k.pkt).map(([r, p]) => [r, Array.isArray(p) ? p.map(pkt) : pkt(p)]))}))}))};
      downloadText(JSON.stringify(ut, null, 1), `skjema-underlag-${String(SK.ip).replace(/[^\w.-]+/g, '_')}.json`, false);
      toast(T('Underlaget er lagret', 'The basis is saved'));
      return;
    }
    if (el.closest('[data-utvid]')) { savePrefs({skjemaStor: !document.body.classList.contains('sk-stor')}); oppdater(); return; }
    const vv = el.closest('[data-veksler]');
    if (vv) {
      const f = faner(), valgt = f.find(x => x.id === SK.valgt[SK.ip]) || f[0];
      if (valgt && valgt.type === 'aggregat') {
        const l = vekslerLagret(); l[vekslerNokkel(valgt.s)] = vv.dataset.veksler;
        try { localStorage.setItem('nabe.veksler', JSON.stringify(l)); } catch { /* private window: the pick lasts until the page is closed */ }
        tegn();
      }
      return;
    }
    const fane = el.closest('[data-fane]');
    if (fane) { SK.valgt[SK.ip] = fane.dataset.fane; tegn(); return; }
    const rk = el.closest('[data-rom]');
    if (rk) { aapneRom(rk.dataset.rom); return; }
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


  /* -------------------------------------------- the whole plant at a glance
     Every air handling unit and every heating circuit NABE has read, on every
     device, as one card each with the three or four numbers that say how it is
     doing. A click opens the device with that drawing. */
  const lag = document.createElement('div');
  lag.id = 'oversiktOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);
  function oversiktKort() {
    const ut = [];
    for (const d of S.devices) {
      const pkt = S.cache[d.address];
      if (!pkt) continue;
      for (const s of byggSystemer(pkt)) {
        if (!tegnbare(s)) continue;
        const finn = (art, ...steder) => s.komp.find(k => k.art === art && steder.includes(k.sted) && k.pkt.pv);
        const tall = [];
        if (s.type === 'ventilasjon') {
          const til = finn('temp', 'tilluft'), avt = finn('temp', 'avtrekk');
          if (til) tall.push([T('Tilluft', 'Supply'), verdi(til.pkt.pv), til.pkt.sp ? verdi(til.pkt.sp) : '']);
          if (avt) tall.push([T('Avtrekk', 'Extract'), verdi(avt.pkt.pv), '']);
          const vifter = s.komp.filter(k => k.art === 'vifte');
          if (vifter.length) tall.push([T('Vifter', 'Fans'), `${vifter.filter(iDrift).length} ${T('av', 'of')} ${vifter.length} ${T('i drift', 'running')}`, '']);
        } else {
          const tur = finn('temp', 'tur', '4'), ret = finn('temp', 'retur', '5');
          if (tur) tall.push([T('Tur', 'Flow'), verdi(tur.pkt.pv), tur.pkt.sp ? verdi(tur.pkt.sp) : '']);
          if (ret) tall.push([T('Retur', 'Return'), verdi(ret.pkt.pv), '']);
          const pumper = s.komp.filter(k => k.art === 'pumpe');
          if (pumper.length) tall.push([T('Pumper', 'Pumps'), `${pumper.filter(iDrift).length} ${T('av', 'of')} ${pumper.length} ${T('i drift', 'running')}`, '']);
        }
        ut.push({ip: d.address, enhet: d.object_name || d.address, s, tall, navn: s.type === 'ventilasjon' ? T('Aggregat', 'Air handling') : (kursNavn(s) || tn({varme: ['Varme', 'Heating'], kjoling: ['Kjøling', 'Cooling']}, s.type)),
          alarm: s.komp.filter(iAlarm).length, haand: s.komp.filter(iHaand).length, rom: s.rom.size});
      }
    }
    return ut;
  }
  function tegnOversikt() {
    const kort = oversiktKort();
    const lest = S.devices.filter(d => S.cache[d.address]).length;
    const grupper = [['ventilasjon', T('Ventilasjon', 'Ventilation')], ['varme', T('Varme', 'Heating')], ['kjoling', T('Kjøling', 'Cooling')]];
    const kropp = !kort.length
      ? `<div class="gs-empty">${T('Fant ingen aggregater eller varmekurser i navnene på punktene som er lest. Åpne en enhet for å lese den.', 'Found no air handling units or heating circuits in the names of the points that have been read. Open a device to read it.')}</div>`
      : grupper.filter(([t]) => kort.some(k => k.s.type === t)).map(([t, navn]) => `<div class="ov-gruppe"><div class="ov-t">${navn}<small>${kort.filter(k => k.s.type === t).length}</small></div>
          <div class="ov-gitter">${kort.filter(k => k.s.type === t).map(k => `<button type="button" class="ov-kort${k.alarm ? ' alarm' : ''}" data-ip="${esc(k.ip)}" data-fane="${esc(t === 'ventilasjon' ? 'v:' + k.s.id : t)}">
            <span class="ov-topp"><b>${esc(k.s.id || k.navn)}</b>${k.alarm ? `<em class="a">▲ ${k.alarm}</em>` : ''}${k.haand ? `<em class="h">${k.haand} ${T('i hånd', 'in hand')}</em>` : ''}</span>
            <span class="ov-navn">${esc(k.s.id ? k.navn : '')}</span>
            ${k.tall.map(([n, v, sp]) => `<span class="ov-rad"><i>${esc(n)}</i><b>${esc(v)}</b>${sp ? `<u>${esc(sp)}</u>` : ''}</span>`).join('')}
            <span class="ov-enhet">${esc(k.enhet)}${k.rom ? ` · ${k.rom} ${T('rom', 'rooms')}` : ''}</span></button>`).join('')}</div></div>`).join('');
    lag.innerHTML = `<div class="gs-modal ov-modal"><div class="gs-head"><span class="gd-tittel">${T('Anleggsoversikt', 'Plant overview')}</span>
      <span class="ov-meta">${T(`${kort.length} systemer på ${lest} leste enheter av ${S.devices.length}`, `${kort.length} systems on ${lest} devices read of ${S.devices.length}`)}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="ov-kropp">${kropp}</div></div>`;
  }
  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const k = e.target.closest('.ov-kort');
    if (!k) return;
    lag.hidden = true;
    SK.vis = true; savePrefs({skjemaVis: true});
    SK.valgt[k.dataset.ip] = k.dataset.fane;
    if (!S.activeDev || S.activeDev.address !== k.dataset.ip) await selectDevice(k.dataset.ip);
    else oppdater();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);
  window.aapneOversikt = function () {
    if (!S.devices.length) { toast(T('Skann et anlegg først', 'Scan a plant first')); return; }
    tegnOversikt();
    lag.hidden = false;
  };
  if ($('oversiktBtn')) $('oversiktBtn').onclick = () => { closeMenus(); window.aapneOversikt(); };

  window.aapneSkjema = function () {
    if (!S.activeDev) { toast(T('Åpne en enhet først', 'Open a device first')); return; }
    if (!SK.systemer.length) { toast(T('Fant ikke noe aggregat eller noen varmekurs i navnene på denne enheten', 'Found no air handling unit or heating circuit in the names on this device')); return; }
    SK.vis = true; savePrefs({skjemaVis: true}); oppdater();
  };
  window.nabeSkjema = {tolkNavn, tolkPunkt, byggSystemer, sideAv, stasjoner, tegnAggregat, tegnKurser, tegnSprinkler, romHtml, oversiktKort, tilstand: SK};
})();
