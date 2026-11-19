/* NABE - topology.
   This PC on the left, its network adapters next to it, the sites behind them,
   and inside each site the devices grouped by the protocol they talk: BACnet
   (blue), Modbus (orange), KNX (green). The grey lines are the plain network,
   the coloured strands on top of them are the traffic of each protocol.
   The list on the left holds every site NABE remembers. One that is within reach
   is added to the scan with a click, and the page stays where it is while the
   devices turn up one by one. Opened from the ⋯ menu or the palette. */
'use strict';

(function topologi() {
  const VISNING = (() => { try { return localStorage.getItem('nabe.topologi') || 'samlet'; } catch { return 'samlet'; } })();
  const KT = {kort: [], anlegg: [], perKort: {}, timer: 0, valgt: null, utvid: new Set(), sett: new Set(), sig: '', filter: '', bare: false, skann: null, forste: true, apen: new Set(), visning: VISNING, vb: null};

  const lag = document.createElement('div');
  lag.id = 'kartOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const ipSuff = (d) => { const m = String(d.address).replace(/^(mb|mr|ms|kx):/, '').match(/(\d+)(?::\d+)?(?:\/\d+)?$/); return /^\d+\.\d+\.\d+\.\d+/.test(String(d.address).replace(/^(mb|mr|ms|kx):/, '')) && m ? '.' + m[1] : ''; };
  const dupl = (d) => !!(KT.dupe && d.object_name && KT.dupe.get(d.object_name) > 1);
  const rolig = () => { try { return loadPrefs().utenBevegelse === true; } catch { return false; } };
  const start = () => { lag.classList.add('tp-start'); clearTimeout(KT.startT); KT.startT = setTimeout(() => lag.classList.remove('tp-start'), 1500); };
  const ent = (n) => (n === 1 ? T('enhet', 'device') : T('enheter', 'devices'));
  const kBruk = (n) => (n === 1 ? T('kort i bruk', 'adapter in use') : T('kort i bruk', 'adapters in use'));
  const ip0 = (cidr) => String(cidr || '').split(/[\/:]/)[0];
  const kort0 = (a) => String(a || '').replace(/^(mb|mr|ms|kx):/, '');
  const PROT = ['bacnet', 'modbus', 'knx'];
  const PROT_NAVN = {bacnet: 'BACnet', modbus: 'Modbus', knx: 'KNX'};
  const protAv = (d) => (d.protocol === 'modbus' || d.protocol === 'knx' ? d.protocol : 'bacnet');
  const stedKey = (k) => k.split(' ');

  async function hent() {
    const j = async (u) => { try { return await (await fetch(u, {cache: 'no-store'})).json(); } catch { return {}; } };
    const [i, a, t] = await Promise.all([j('/api/interfaces'), j('/api/anlegg'), j('/api/trafikk?etter=999999999')]);
    KT.kort = i.interfaces || [];
    KT.anlegg = a.anlegg || [];
    KT.perKort = t.kort || {};
  }

  /* What is open right now: the loaded devices grouped by range, each tied to the adapter that reads it. */
  function aapne() {
    const g = new Map();
    for (const d of S.devices || []) {
      const r = d._range || '';
      if (!r) continue;
      const e = g.get(r) || {omr: r, antall: 0, kort: ''};
      e.antall++;
      e.kort = e.kort || (S.via && S.via[d.address]) || '';
      g.set(r, e);
    }
    return g;
  }

  /* One list of sites, each with the adapter it goes through. */
  function steder() {
    const lastet = aapne();
    const brukt = new Set();
    const ut = [];
    // Smallest first: a site remembered as one range wins over one remembered as
    // several that happen to include it, so nothing is drawn twice.
    const sortert = KT.anlegg.slice().sort((x, y) => x.key.split(' ').length - y.key.split(' ').length);
    for (const a of sortert) {
      const omr = a.key.split(' ');
      const l = omr.map(r => lastet.get(r)).filter(Boolean);
      if (l.length && omr.filter(r => lastet.has(r)).every(r => brukt.has(r))) continue;
      omr.forEach(r => { if (lastet.has(r)) brukt.add(r); });
      const kortIp = (l[0] && l[0].kort) || (a.naabar && a.naabar.ip) || '';
      const inne = !!l.length;
      // Scanned together and remembered as one, but read through different adapters:
      // each range is its own building on the map.
      if (l.length > 1 && new Set(l.map(x => x.kort)).size > 1) {
        for (const x of l) {
          brukt.add(x.omr);
          ut.push({key: x.omr, navn: '', antall: x.antall, lastet: true, kort: x.kort, svarer: true, overstyrt: 0, modus: a.modus});
        }
        continue;
      }
      if (!inne && !(a.naabar && a.svarer !== false)) continue;
      ut.push({key: a.key, navn: a.navn || '', antall: inne ? l.reduce((s, x) => s + x.antall, 0) : a.enheter,
               lastet: inne, kort: kortIp, svarer: a.svarer, overstyrt: a.overstyrt, modus: a.modus});
    }
    for (const [omr, e] of lastet) {
      if (brukt.has(omr)) continue;
      ut.push({key: omr, navn: '', antall: e.antall, lastet: true, kort: e.kort, svarer: true, overstyrt: 0, modus: ''});
    }
    const ute = KT.anlegg.filter(a => !a.naabar && !a.key.split(' ').some(r => lastet.has(r))).length;
    return {ut: ut.slice(0, 14), ute};
  }

  /* ------------------------------------------------------------ what a device is */
  const SLAG = [
    ['aggregat', /(^|[-_. /])(lb|la|ta|ll|agg|aggr|ahu|vent\w*|lufta\w*|ventilasjon\w*)[-_. 0-9]|^\d{3}[.\-]\d+[-_ ]?(lb|ta|ll)/i, ['Ventilasjonsaggregat', 'Air handling unit']],
    ['kjoler', /30r[ab]|chill|kj[øo]l|kulde|varmepumpe|heat ?pump|\bvp\d/i, ['Kjøle- eller varmepumpe', 'Chiller or heat pump']],
    ['energi', /energy|energi|\bem\d|kwh|m[åa]ler|\bmeter|\bnrg|valve/i, ['Energi eller ventil', 'Energy or valve']],
    ['sentral', /jace|\bnae|\bnie|niagara|metasys|server|supervis|station/i, ['Sentral eller server', 'Station or server']],
    ['rom', /(^|[-_. ])(rt|rr|rom|room|vav|fcu)[-_. 0-9]|^\d{2}-\d{2,4}\b/i, ['Romregulering', 'Room control']],
  ];
  function slag(d) {
    const p = protAv(d);
    if (p === 'knx') return {k: 'knx', t: T('KNX-gateway', 'KNX gateway')};
    const navn = [d.object_name, d.model_name, d.description].filter(Boolean).join(' ');
    if (/^\d+\.\d+\.\d+\.\d+$/.test(d.object_name || '')) return p === 'modbus' ? {k: 'modul', t: T('Modbus-enhet', 'Modbus device')} : {k: 'regulator', t: T('Regulator', 'Controller')};
    for (const [k, re, t] of SLAG) if (re.test(navn)) return {k, t: T(t[0], t[1])};
    if (p === 'modbus') return {k: 'modul', t: T('Modbus-enhet', 'Modbus device')};
    return {k: 'regulator', t: T('Regulator', 'Controller')};
  }
  const IK = {
    aggregat: '<circle cx="8" cy="8" r="1.5"/><path d="M8 6.5C7 3.5 8.5 2 10 2.6 11.5 3.3 10.5 5.5 8 6.5Z"/><path d="M9.3 8.7C12 10.3 12 12.4 10.4 13 8.8 13.5 8.2 11 9.3 8.7Z"/><path d="M6.7 8.7C4 10.3 3 9 3.3 7.5 3.7 6 5.8 6.4 6.7 8.7Z"/>',
    kjoler: '<path d="M8 2v12M2.8 5l10.4 6M2.8 11l10.4-6"/><path d="M6.5 2.8 8 4.3l1.5-1.5M6.5 13.2 8 11.7l1.5 1.5"/>',
    energi: '<path d="M2.5 11.5a5.5 5.5 0 1 1 11 0"/><path d="M8 11.5 10.8 6.5"/><circle cx="8" cy="11.5" r=".8"/>',
    sentral: '<rect x="2.5" y="3" width="11" height="4" rx="1"/><rect x="2.5" y="9" width="11" height="4" rx="1"/><path d="M5 5h.01M5 11h.01"/>',
    rom: '<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M2.5 7h11"/><circle cx="8" cy="10" r="1"/>',
    knx: '<path d="M2.5 8 8 3l5.5 5"/><path d="M4 7.2V13h8V7.2"/>',
    modul: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M5 6.5h6M5 9.5h4"/>',
    regulator: '<rect x="4.5" y="4.5" width="7" height="7" rx="1"/><path d="M6.5 2.5v2M9.5 2.5v2M6.5 11.5v2M9.5 11.5v2M2.5 6.5h2M2.5 9.5h2M11.5 6.5h2M11.5 9.5h2"/>',
    pc: '<rect x="2.5" y="3" width="11" height="7.5" rx="1"/><path d="M5.5 13h5M8 10.5V13"/>',
    kort: '<rect x="2.5" y="5" width="11" height="6" rx="1"/><path d="M5 8h.01M8 8h.01M11 8h.01M4.5 11v2M11.5 11v2"/>',
  };
  const ikon = (k) => `<svg class="tp-ik" viewBox="0 0 16 16" aria-hidden="true">${IK[k] || IK.regulator}</svg>`;

  /* Colour and shape together: a triangle for alarm, a diamond for a fault, a ring for an override,
     a dash for one that has gone quiet and a filled circle for one that is simply fine. */
  function tilstand(d) {
    const c = d.address in S.cache ? flagCounts(S.cache[d.address]) : null;
    // Alarms are a count on the device and no state of their own: a controller that only has alarms is otherwise fine,
    // and the alarms are a small mark beside it. Fault, override and silence are the states that colour a device.
    d._alm = c ? (c['in-alarm'] || 0) : 0;
    return BORTE_NAA.has(d.address) ? 'stille' : c && c['fault'] ? 'feil' : c && (c['overridden'] || c['out-of-service']) ? 'over' : 'ok';
  }
  const rang = (d) => (d._tp === 'ok' && d._alm ? 1.5 : RANG[d._tp]);
  const almMerke = (d) => (d._alm ? `<span class="tp-alm" title="${esc(T(`${d._alm} alarm på enheten`, d._alm === 1 ? '1 alarm on the device' : `${d._alm} alarms on the device`))}">${glyf('alarm')}</span>` : '');
  const GLYF = {
    ok: '<circle cx="6" cy="6" r="3.6"/>',
    alarm: '<path d="M6 1.4 11 10.4H1Z"/>',
    feil: '<path d="M6 1 11 6 6 11 1 6Z"/>',
    over: '<circle cx="6" cy="6" r="3.2" class="ring"/>',
    stille: '<path d="M2 6h8" class="line"/>',
  };
  const glyf = (s) => `<svg class="tp-gl s-${s}" viewBox="0 0 12 12" aria-hidden="true">${GLYF[s]}</svg>`;
  const STAT_TXT = () => ({ok: T('i orden', 'fine'), alarm: T('alarm', 'alarm'), feil: T('feil', 'fault'), over: T('overstyrt', 'overridden'), stille: T('stille', 'quiet')});
  const RANG = {alarm: 0, feil: 1, over: 2, stille: 3, ok: 4};

  const siden = (ts) => {
    if (!ts) return '';
    const d = Math.floor((Date.now() / 1000 - ts) / 86400);
    return d < 1 ? T('i dag', 'today') : d === 1 ? T('i går', 'yesterday') : T(`for ${d} dager siden`, `${d} days ago`);
  };

  /* ------------------------------------------------------------ the picture */
  function sted(st) {
    const omr = stedKey(st.key);
    st.dev = st.lastet ? (S.devices || []).filter(d => omr.includes(d._range)) : [];
    st.per = {bacnet: [], modbus: [], knx: []};
    st.tell = {ok: 0, alarm: 0, feil: 0, over: 0, stille: 0};
    for (const d of st.dev) {
      const s = tilstand(d);
      d._tp = s;
      st.tell[s]++;
      if (d._alm) st.tell.alarm++;
      st.per[protAv(d)].push(d);
    }
    for (const p of PROT) st.per[p].sort((a, b) => rang(a) - rang(b) || String(a.object_name || a.address).localeCompare(String(b.object_name || b.address), undefined, {numeric: true}));
    return st;
  }

  function flis(d, ny, i) {
    const s = d._tp, p = protAv(d), k = slag(d);
    const navn = d.object_name || kort0(d.address);
    return `<button type="button" class="tp-flis p-${p} s-${s}${ny ? ' ny' : ''}${KT.valgt === 'e:' + d.address ? ' valgt' : ''}" data-tp="enhet" data-adr="${esc(d.address)}" data-tip="d:${esc(d.address)}" style="--d:${Math.min(i, 24) * 55}ms">
      <span class="tp-ikon">${ikon(k.k)}</span><span class="tp-tekst"><b>${esc(navn)}</b><small>${dupl(d) && ipSuff(d) ? esc(ipSuff(d)) + ' · ' : ''}${esc(k.t)}</small></span>${almMerke(d)}${glyf(s)}</button>`;
  }

  const MAKS_FLIS = 10;
  function bane(st, p) {
    const l = st.per[p];
    if (!l.length) return '';
    const id = st.key + '|' + p, aapen = KT.utvid.has(id);
    const vis = aapen ? l : l.slice(0, MAKS_FLIS);
    const bad = l.filter(d => d._tp === 'alarm' || d._tp === 'feil').length;
    const tellere = ['alarm', 'feil'].map(s => ({s, n: l.filter(d => d._tp === s).length})).filter(x => x.n)
      .map(x => `<span class="tp-merke s-${x.s}">${glyf(x.s)}${x.n}</span>`).join('');
    const nye = vis.map((d, i) => {
      const ny = !KT.sett.has(d.address);
      return flis(d, ny && !KT.forste, i);
    }).join('');
    return `<div class="tp-bane p-${p}${bad ? ' har-feil' : ''}"><div class="tp-bane-h"><i></i><b>${PROT_NAVN[p]}</b><span class="tp-ant">${l.length}</span>${tellere}</div>
      <div class="tp-rutenett">${nye}</div>
      ${l.length > MAKS_FLIS ? `<button type="button" class="tp-mer" data-tp="mer" data-id="${esc(id)}">${aapen ? T('Vis færre', 'Show fewer') : T(`Vis alle ${l.length}`, `Show all ${l.length}`)}</button>` : ''}</div>`;
  }

  function stedKort(st) {
    const navn = st.navn || stedKey(st.key).join(', ');
    const sk = !!st.skanner;
    const t = st.tell || {};
    const sammen = st.lastet ? ['alarm', 'feil', 'over', 'stille', 'ok'].filter(s => t[s]).map(s => `<span class="tp-merke s-${s}" title="${esc(STAT_TXT()[s])}">${glyf(s)}${t[s]}<em>${esc(STAT_TXT()[s])}</em></span>`).join('') : '';
    const under = sk ? T(`Skanner … fant ${st.antall}`, `Scanning … found ${st.antall}`)
      : st.lastet ? `${st.antall} ${ent(st.antall)}${st.overstyrt ? ` · ${st.overstyrt} ${T('overstyrt', 'overridden')}` : ''}`
      : `${st.antall} ${ent(st.antall)} · ${T('innen rekkevidde', 'within reach')}`;
    const apen = st.lastet && (st.apen || KT.apen.has(st.key));
    const inn = apen ? PROT.map(p => bane(st, p)).join('')
      : st.lastet ? `<div class="tp-protrad">${PROT.filter(p => st.per[p].length).map(p => `<span class="tp-prot p-${p}"><i></i>${PROT_NAVN[p]} ${st.per[p].length}</span>`).join('')}<button type="button" class="tp-mer" data-tp="vis" data-key="${esc(st.key)}">${T('Vis enhetene', 'Show devices')}</button></div>` : '';
    return `<div class="tp-sted ${st.lastet ? 'lastet' : 'ledig'}${sk ? ' skanner' : ''}${KT.valgt === 's:' + st.key ? ' valgt' : ''}" data-stedid="${esc(st.key)}" data-kort="${esc(st.kort || '')}" data-prots="${PROT.filter(p => st.per && st.per[p].length).join(' ')}">
      <div class="tp-sted-h" data-tp="sted" data-key="${esc(st.key)}" data-tip="t:${esc(navn)}">
        <span class="tp-prikk"></span><span class="tp-tekst"><b>${esc(navn)}</b><small>${esc(under)}</small></span>
        ${sk ? '<span class="tp-radar" aria-hidden="true"></span>' : st.lastet ? `<button type="button" class="tp-x" data-tp="fjern" data-key="${esc(st.key)}" aria-label="${esc(T('Fjern fra lista', 'Remove from the list'))}" data-tip="t:${esc(T('Fjern fra lista', 'Remove from the list'))}">✕</button>`
          : `<button type="button" class="tp-pluss" data-tp="skann" data-key="${esc(st.key)}" data-modus="${esc(st.modus || '')}" data-tip="t:${esc(T('Legg til i skannet', 'Add to the scan'))}">+</button>`}
      </div>
      ${sammen ? `<div class="tp-sammen">${sammen}</div>` : ''}${inn}</div>`;
  }

  function kortChips(k) {
    const igang = (S.kort || []).some(x => x.ip === k.ip), m = KT.perKort[k.ip];
    const feil = m && m.antall ? m.feil / m.antall : 0;
    return igang && m && m.antall
      ? `<span class="tp-chip">${m.snitt} ms</span>${m.feil ? `<span class="tp-chip ${feil > 0.5 ? 'rod' : 'gul'}">${m.feil} ${T('feil', m.feil === 1 ? 'error' : 'errors')}</span>` : ''}`
      : `<span class="tp-chip">${igang ? T('ingen trafikk ennå', 'no traffic yet') : T('ikke i bruk', 'not in use')}</span>`;
  }
  function kortNode(k) {
    const aktive = new Set((S.kort || []).map(x => x.ip));
    const hoved = ((S.kort || []).find(x => x.primary) || {}).ip;
    const igang = aktive.has(k.ip), s = (S.kort || []).find(x => x.ip === k.ip) || {};
    const m = KT.perKort[k.ip];
    const feil = m && m.antall ? m.feil / m.antall : 0;
    const kl = igang ? (feil > 0.5 ? 'varsel' : 'ok') : 'av';
    const chips = kortChips(k);
    return `<div class="tp-kort ${kl}${KT.valgt === 'k:' + k.ip ? ' valgt' : ''}" data-tp="kort" data-kortid="${esc(k.ip)}" data-cidr="${esc(k.cidr)}" data-tip="t:${esc(k.interface + ' · ' + k.cidr + (s.bbmd ? ' · BBMD ' + s.bbmd : ''))}">
      <div class="tp-kort-h"><span class="tp-ikon">${ikon('kort')}</span><span class="tp-tekst"><b>${esc(k.interface)}</b><small>${esc(k.ip)}${s.bbmd ? ' · BBMD' : ''}</small></span>
        <span class="tp-merke-t ${kl}">${igang ? (k.ip === hoved ? T('hoved', 'main') : T('aktiv', 'active')) : T('Bruk', 'Use')}</span></div>
      <div class="tp-chips">${chips}</div></div>`;
  }

  function tegn(tving) {
    if (!$('tpKol')) return;
    const {ut, ute} = steder();
    const hoved = ((S.kort || []).find(x => x.primary) || {}).ip || (KT.kort[0] || {}).ip || '';
    const skanner = document.body.classList.contains('skanner');
    if (KT.skann && skanner && !ut.some(x => x.key === KT.skann.key)) ut.push({key: KT.skann.key, navn: '', antall: 0, lastet: false, kort: hoved, svarer: true, overstyrt: 0, modus: ''});
    KT.dupe = new Map();
    for (const d of S.devices) if (d.object_name) KT.dupe.set(d.object_name, (KT.dupe.get(d.object_name) || 0) + 1);
    const antLastet = ut.filter(x => x.lastet).length;
    for (const st of ut) { sted(st); st.apen = antLastet === 1 || !!st.skanner; st.skanner = !!(KT.skann && skanner && st.key === KT.skann.key); if (st.skanner) st.antall = st.dev.length || st.antall; }
    const sig = [S.devices.length, S.devices.map(d => tilstand(d)[0] + (d._alm ? 'a' : '')).join(''), ut.map(x => x.key + (x.lastet ? 1 : 0) + x.antall + (x.skanner ? 's' : '')).join(','), KT.kort.map(k => k.ip).join(','),
      (S.kort || []).map(k => k.ip).join(','), skanner, KT.visning === 'spredt' ? '' : KT.valgt, [...KT.utvid].join(','), [...KT.apen].join(','), KT.anlegg.length, KT.visning].join('|');
    if (!tving && sig === KT.sig) return;
    KT.sig = sig;
    const rotY = $('tpKol').scrollTop;
    lag.classList.toggle('tp-spredt', KT.visning === 'spredt');
    lag.classList.toggle('tp-statusvis', KT.visning === 'status');
    if (KT.visning === 'status') {
      statusTegn(ut);
      $('tpFot').textContent = '';
      for (const d of S.devices) KT.sett.add(d.address);
      KT.forste = false;
      rail(); detalj();
      return;
    }
    if (KT.visning === 'spredt') {
      grafTegn(ut);
      lag.classList.toggle('tp-skanner', skanner);
      for (const d of S.devices) KT.sett.add(d.address);
      KT.forste = false;
      $('tpFot').textContent = T('Dra for å flytte, rull for å zoome', 'Drag to move, scroll to zoom');
      rail(); detalj();
      return;
    }

    const blokker = KT.kort.map(k => ({k, s: ut.filter(x => x.kort === k.ip)}));
    const uten = ut.filter(x => !KT.kort.some(k => k.ip === x.kort));
    const aktive = new Set((S.kort || []).map(x => x.ip));
    let html = '';
    for (const b of blokker) {
      if (!b.s.length && !aktive.has(b.k.ip) && KT.kort.length > 3) continue;
      html += `<div class="tp-blokk">${kortNode(b.k)}<div class="tp-steder">${b.s.map(stedKort).join('') || `<div class="tp-tomt">${T('Ingen anlegg her ennå', 'No sites here yet')}</div>`}</div></div>`;
    }
    if (uten.length) html += `<div class="tp-blokk uten"><div class="tp-steder">${uten.map(stedKort).join('')}</div></div>`;
    $('tpInnhold').innerHTML = html || `<div class="tp-tomt">${T('Ingen nettverkskort funnet', 'No network adapters found')}</div>`;
    $('tpPc').innerHTML = `<span class="tp-ikon">${ikon('pc')}</span><span class="tp-tekst"><b>${T('Denne PC-en', 'This PC')}</b><small>${aktive.size} ${kBruk(aktive.size)}</small></span>`;
    $('tpFot').textContent = ute ? T(`${ute} husket anlegg er utenfor rekkevidde nå`, ute === 1 ? '1 remembered site is out of reach now' : `${ute} remembered sites are out of reach now`) : '';
    lag.classList.toggle('tp-skanner', skanner);
    for (const d of S.devices) KT.sett.add(d.address);
    KT.forste = false;
    rail();
    detalj();
    requestAnimationFrame(() => { $('tpKol').scrollTop = rotY; lenker(); });
  }

  /* The links are measured from the boxes after they have been laid out, so they follow whatever size the text ended up with. */
  function lenker() {
    const rot = $('tpKol'), sv = $('tpLenker');
    if (!rot || !sv) return;
    const R = rot.getBoundingClientRect();
    sv.setAttribute('width', rot.scrollWidth);
    sv.setAttribute('height', rot.scrollHeight);
    const pos = (el, hoyre) => { const r = el.getBoundingClientRect(); return {x: (hoyre ? r.right : r.left) - R.left + rot.scrollLeft, y: r.top + r.height / 2 - R.top + rot.scrollTop}; };
    const bue = (a, b, dy) => { const x1 = a.x, y1 = a.y + dy, x2 = b.x, y2 = b.y + dy, m = Math.max(30, (x2 - x1) / 2); return `M${x1},${y1} C${x1 + m},${y1} ${x2 - m},${y2} ${x2},${y2}`; };
    const pc = $('tpPc');
    let ut = '';
    const aktive = new Set((S.kort || []).map(k => k.ip));
    for (const k of rot.querySelectorAll('[data-kortid]')) {
      const paa = aktive.has(k.dataset.kortid);
      ut += `<path class="tp-nett${paa ? ' paa' : ''}" d="${bue(pos(pc, true), pos(k, false), 0)}"/>`;
      if (paa) ut += `<path class="tp-flyt" d="${bue(pos(pc, true), pos(k, false), 0)}"/>`;
    }
    for (const s of rot.querySelectorAll('[data-stedid]')) {
      const fra = [...rot.querySelectorAll('[data-kortid]')].find(k => k.dataset.kortid === s.dataset.kort);
      const a = fra ? pos(fra, true) : pos(pc, true), b = pos(s.querySelector('.tp-sted-h'), false);
      const lastet = s.classList.contains('lastet');
      ut += `<path class="tp-nett${lastet ? ' paa' : ''}${lastet ? '' : ' ledig'}" d="${bue(a, b, 0)}"/>`;
      const ps = lastet ? PROT.filter(p => (s.dataset.prots || '').split(' ').includes(p)) : s.classList.contains('skanner') ? PROT : [];
      ps.forEach((p, i) => { ut += `<path class="tp-s p-${p}" d="${bue(a, b, (i - (ps.length - 1) / 2) * 4.5)}" style="animation-delay:${-i * 0.37}s"/>`; });
    }
    sv.innerHTML = ut;
  }

  /* ------------------------------------------------------------ the spread view
     Every device is a dot of its own, tied to the site it belongs to, the site to its adapter and the adapter to this PC, so
     the physical connections can be followed. Each adapter gets a slice of the circle, each site a part of that slice,
     in proportion to how many devices it has. Colour is the protocol, the shape is the state. */
  function grafTegn(ut) {
    const sv = $('tpGraf');
    const aktive = new Set((S.kort || []).map(k => k.ip));
    const lastede = ut.filter(x => x.lastet || x.skanner);
    const kortene = KT.kort.filter(k => lastede.some(x => x.kort === k.ip));
    const uten = lastede.filter(x => !KT.kort.some(k => k.ip === x.kort));
    const gruppe = kortene.map(k => ({k, s: lastede.filter(x => x.kort === k.ip)}));
    if (uten.length) gruppe.push({k: null, s: uten});
    const vekt = (st) => Math.max(3, st.dev.length);
    const tot = gruppe.reduce((a, g) => a + g.s.reduce((b, st) => b + vekt(st), 0), 0) || 1;
    const C = 15;                                               // spacing of the dots in a cluster
    let a0 = Math.PI - (gruppe.length ? gruppe[0].s.reduce((b, st) => b + vekt(st), 0) / tot * Math.PI : 0), noder = '', lenk = '', faste = '';
    for (const g of gruppe) {
      const gv = g.s.reduce((b, st) => b + vekt(st), 0), ga = (gv / tot) * Math.PI * 2;
      g.a = a0 + ga / 2;
      let sa = a0;
      for (const st of g.s) {
        const v = (vekt(st) / gv) * ga;
        st.a = sa + v / 2; st.v = v; sa += v;
        // Inside a site every protocol is a cluster of its own, side by side, so a technician finds BACnet, Modbus and KNX apart
        st.sub = PROT.filter(q => st.per[q].length).map(q => ({q, n: st.per[q].length, R: C * Math.sqrt(st.per[q].length) + 12}));
        st.W = st.sub.reduce((b, x) => b + 2 * x.R + 16, 0) || 30;
        st.mR = Math.max(0, ...st.sub.map(x => x.R));
        st.R = Math.max(st.W / 2, st.mR);
      }
      a0 += ga;
    }
    // Every adapter keeps its own distance, so one large site does not push all the others out
    for (const g of gruppe) {
      g.rS = 120;
      for (const st of g.s) g.rS = Math.max(g.rS, Math.min(1400, (2 * st.R + 26) / Math.max(st.v, .12) + st.R * .15));
      g.rK = Math.max(110, g.rS * .4);
      g.rS = Math.max(g.rS, g.rK + 150);
    }
    let minx = -40, miny = -40, maxx = 40, maxy = 40;
    const se = (x, y, r, b) => { minx = Math.min(minx, x - r); maxx = Math.max(maxx, x + r); miny = Math.min(miny, y - r); maxy = Math.max(maxy, y + r);
      if (b) { b[0] = Math.min(b[0], x - r); b[1] = Math.min(b[1], y - r); b[2] = Math.max(b[2], x + r); b[3] = Math.max(b[3], y + r); } };
    KT.pos = {}; KT.grenser = {};
    let si = 0;
    // A node that keeps its size on the screen however far you zoom, so names stay readable (see maal())
    const fast = (kl, x, y, inn, attr = '') => `<g class="tp-k ${kl}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}" ${attr}>${inn}</g>`;
    for (const g of gruppe) {
      const kx = Math.cos(g.a) * g.rK, ky = Math.sin(g.a) * g.rK;
      if (g.k) {
        const igang = aktive.has(g.k.ip);
        lenk += `<path class="tp-nett${igang ? ' paa' : ''}" d="M0,0 L${kx},${ky}"/>${igang ? `<path class="tp-flyt" d="M0,0 L${kx},${ky}"/>` : ''}`;
        faste += fast('tp-gk' + (igang ? '' : ' av'), kx, ky, `<rect x="-42" y="-12" width="84" height="24" rx="6"/><text y="4" text-anchor="middle">${esc(g.k.ip)}</text>`,
          `data-tp="kort" data-kortid="${esc(g.k.ip)}" data-tip="t:${esc(g.k.interface + ' · ' + g.k.cidr)}"`);
      }
      se(kx, ky, 60);
      for (const st of g.s) {
        const ca = Math.cos(st.a), sa = Math.sin(st.a), hx = ca * g.rS, hy = sa * g.rS, gr = [hx, hy, hx, hy];
        const nr = si++;
        lenk += `<path class="tp-nett paa" d="M${g.k ? kx : 0},${g.k ? ky : 0} L${hx},${hy}" data-s="${nr}"/><path class="tp-flyt" d="M${g.k ? kx : 0},${g.k ? ky : 0} L${hx},${hy}" data-s="${nr}"/>`;
        const bx = ca * (g.rS + st.mR + 60), by = sa * (g.rS + st.mR + 60), tx = -sa, ty = ca;
        let off = -st.W / 2;
        for (const x of st.sub) {
          off += x.R + 8;
          const cx = bx + tx * off, cy = by + ty * off, sx = cx - ca * (x.R + 8), sy = cy - sa * (x.R + 8);
          off += x.R + 8;
          lenk += `<path class="tp-gs-l p-${x.q}" d="M${hx},${hy} L${sx.toFixed(1)},${sy.toFixed(1)}" data-s="${nr}"/><path class="tp-flyt p-${x.q}" d="M${hx},${hy} L${sx.toFixed(1)},${sy.toFixed(1)}" data-s="${nr}"/>`;
          st.per[x.q].forEach((d, i) => {
            const r = C * Math.sqrt(i + .5), t = i * 2.39996 + st.a;
            const px = cx + Math.cos(t) * r, py = cy + Math.sin(t) * r, sl = d._tp;
            KT.pos[d.address] = [px, py];
            lenk += `<path class="tp-gl-l p-${x.q}" d="M${sx.toFixed(1)},${sy.toFixed(1)} L${px.toFixed(1)},${py.toFixed(1)}" data-s="${nr}"/>`;
            const ny = !KT.sett.has(d.address) && !KT.forste;
            const at = `class="tp-gn p-${x.q} s-${sl}${ny ? ' ny' : ''}${KT.valgt === 'e:' + d.address ? ' valgt' : ''}" data-s="${nr}" data-tp="enhet" data-adr="${esc(d.address)}" data-tip="d:${esc(d.address)}"`;
            if (sl === 'alarm') noder += `<polygon ${at} points="${px.toFixed(1)},${(py - 6.5).toFixed(1)} ${(px + 6.5).toFixed(1)},${(py + 5.5).toFixed(1)} ${(px - 6.5).toFixed(1)},${(py + 5.5).toFixed(1)}"/>`;
            else if (sl === 'feil') noder += `<polygon ${at} points="${px.toFixed(1)},${(py - 7).toFixed(1)} ${(px + 7).toFixed(1)},${py.toFixed(1)} ${px.toFixed(1)},${(py + 7).toFixed(1)} ${(px - 7).toFixed(1)},${py.toFixed(1)}"/>`;
            else noder += `<circle ${at} cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${sl === 'stille' ? 4 : 5.5}"/>`;
            const nm = (d.object_name || kort0(d.address)) + (dupl(d) && ipSuff(d) ? ' ' + ipSuff(d) : '');
            noder += `<text class="tp-gt${sl === 'ok' || sl === 'stille' ? '' : ' fs'}" x="${(px + 9).toFixed(1)}" y="${(py + 3.5).toFixed(1)}">${esc(nm.length > 24 ? nm.slice(0, 23) + '…' : nm)}</text>`;
            if (d._alm) noder += `<polygon class="tp-gb" data-s="${nr}" points="${(px + 4.5).toFixed(1)},${(py - 10).toFixed(1)} ${(px + 9.5).toFixed(1)},${(py - 2).toFixed(1)} ${(px - .5).toFixed(1)},${(py - 2).toFixed(1)}"/>`;
            // Close up, the dot becomes the device itself: icon, name, kind, state; closer still, address, vendor and points
            const kk = slag(d), gl = gruppeFor(d), pk = (S.cache[d.address] || []).length, tr = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
            faste += fast(`tp-dk p-${x.q} s-${sl}`, px, py,
              `<rect class="r1" x="-56" y="-20" width="112" height="40" rx="8"/><rect class="r2" x="-56" y="-20" width="112" height="64" rx="8"/><rect class="str" x="-56" y="-20" width="4" height="40" rx="2"/>`
              + `<g class="ik" transform="translate(-48,-10) scale(1.25)">${IK[kk.k] || IK.regulator}</g>`
              + `<text class="n" x="-24" y="-3">${esc(nm.length > 13 ? (dupl(d) && ipSuff(d) ? tr(nm.slice(0, nm.length - ipSuff(d).length - 1), 12 - ipSuff(d).length) + ' ' + ipSuff(d) : tr(nm, 13)) : nm)}</text><text class="k" x="-24" y="10">${esc(tr(kk.t, 20))}</text>`
              + `<g class="tp-gl s-${sl}" transform="translate(46,-27) scale(.9)">${GLYF[sl]}</g>${d._alm ? `<g class="tp-gl s-alarm" transform="translate(35,-25) scale(.7)">${GLYF.alarm}</g>` : ''}`
              + `<g class="d2"><text class="k" x="-48" y="32">${esc(kort0(d.address))}</text><text class="k" x="-48" y="43">${esc(tr(gl.label || '', 18))}${pk ? ' · ' + pk + ' ' + T('pkt', 'pts') : ''}</text></g>`,
              `data-s="${nr}" data-tp="enhet" data-adr="${esc(d.address)}" data-tip="d:${esc(d.address)}"`);
          });
          faste += fast('tp-gs p-' + x.q, sx, sy, `<circle r="5.5"/><text y="-12" text-anchor="middle">${PROT_NAVN[x.q]} ${x.n}</text>`, `data-s="${nr}"`);
          se(cx, cy, x.R + 20, gr);
        }
        const navn = st.navn || stedKey(st.key).join(', ');
        faste += fast('tp-gh' + (KT.valgt === 's:' + st.key ? ' valgt' : ''), hx, hy,
          `<circle r="9"/><text y="-17" text-anchor="middle">${esc(navn.length > 26 ? navn.slice(0, 25) + '…' : navn)}</text><text class="u" y="27" text-anchor="middle">${st.dev.length} ${ent(st.dev.length)}</text>`,
          `data-s="${nr}" data-tp="sted" data-key="${esc(st.key)}" data-tip="t:${esc(navn + ' · ' + st.dev.length + ' ' + ent(st.dev.length))}"`);
        se(hx, hy, 50, gr);
        KT.grenser[st.key] = gr;
      }
    }
    faste += fast('tp-gp', 0, 0, `<circle r="24"/><text y="4" text-anchor="middle">PC</text>`);
    KT.fit = [minx - 40, miny - 40, maxx - minx + 80, maxy - miny + 80];
    sv.innerHTML = `<g class="tp-gl-lag">${lenk}</g><g class="tp-gn-lag">${noder}</g><g class="tp-f-lag">${faste}</g>`;
    KT.fastEls = [...sv.querySelectorAll('.tp-k')].map(g => [g, g.classList.contains('tp-dk')]);
    KT.sc0 = 0;
    if (!KT.vb || KT.vbNy) { KT.vb = tilpass(KT.fit); KT.mal = KT.vb.slice(); KT.vbNy = false; sv.classList.add('inn'); setTimeout(() => sv.classList.remove('inn'), 1400); }
    bruk();
    $('tpPc').innerHTML = '';
  }

  /* The view box that fits a rectangle in the window, with the window's own proportions. */
  function tilpass(b) {
    const sv = $('tpGraf'), ar = (sv.clientWidth || 800) / (sv.clientHeight || 500);
    const cx = (b[0] + b[2] / 2), cy = (b[1] + b[3] / 2);
    const w = Math.max(b[2], b[3] * ar), h = w / ar;
    return [cx - w / 2, cy - h / 2, w, h];
  }
  /* The whole plant at a glance: one line per site with its worst state, and a total on top. */
  function statusTegn(ut) {
    const alle = {ok: 0, alarm: 0, feil: 0, over: 0, stille: 0};
    const lastede = ut.filter(x => x.lastet);
    for (const st of lastede) for (const k in alle) alle[k] += st.tell[k] || 0;
    const sum = lastede.reduce((a, x) => a + x.dev.length, 0);
    const verst = (t) => (t.feil ? 'feil' : t.over ? 'over' : t.stille ? 'stille' : 'ok');
    const tot = verst(alle);
    const tekst = {feil: T('Feil i anlegget', 'Faults in the plant'), over: T('Overstyringer i anlegget', 'Overrides in the plant'),
      stille: T('Noen enheter er stille', 'Some devices are quiet'), ok: sum ? (alle.alarm ? (alle.alarm === 1 ? T('Alt i orden. Alarm på 1 enhet', 'All fine. Alarm on 1 device') : T(`Alt i orden. Alarmer på ${alle.alarm} enheter`, `All fine. Alarms on ${alle.alarm} devices`)) : T('Alt i orden', 'All fine')) : T('Ingen anlegg åpne', 'No sites open')};
    const chips = (t) => ['alarm', 'feil', 'over', 'stille'].filter(k => t[k]).map(k => `<span class="tp-merke s-${k}">${glyf(k)}${t[k]}<em>${esc(STAT_TXT()[k])}</em></span>`).join('');
    const rader = lastede.sort((a, b) => RANG[verst(a.tell)] - RANG[verst(b.tell)] || (b.tell.alarm || 0) - (a.tell.alarm || 0)).map(st => {
      const navn = st.navn || stedKey(st.key).join(', '), v = verst(st.tell), n = st.dev.length || 1;
      const bar = ['feil', 'over', 'stille', 'ok'].map(k => `<i class="s-${k}" style="flex:${(st.tell[k] || 0) / n}"></i>`).join('');
      const pr = PROT.filter(q => st.per[q].length).map(q => `<span class="tp-prot p-${q}"><i></i>${PROT_NAVN[q]} ${st.per[q].length}</span>`).join('');
      return `<button type="button" class="tp-srad v-${v}${KT.valgt === 's:' + st.key ? ' valgt' : ''}" data-tp="sted" data-key="${esc(st.key)}"><span class="tp-lys">${glyf(v)}</span>
        <span class="tp-tekst"><b>${esc(navn)}</b><small>${st.dev.length} ${ent(st.dev.length)} · ${esc(stedKey(st.key).join(', '))}</small></span>
        <span class="tp-sprot">${pr}</span><span class="tp-sbar">${bar}</span><span class="tp-sstat">${chips(st.tell) || `<span class="tp-merke s-ok">${esc(STAT_TXT().ok)}</span>`}</span></button>`;
    }).join('');
    $('tpStatus').innerHTML = `<div class="tp-sum v-${tot}"><span class="tp-lys stor">${glyf(tot)}</span><div class="tp-tekst"><b>${esc(tekst[tot])}</b><small>${sum} ${ent(sum)} · ${lastede.length} ${lastede.length === 1 ? T('anlegg', 'site') : T('anlegg', 'sites')} · ${(S.kort || []).length} ${kBruk((S.kort || []).length)}</small></div><div class="tp-sstat">${chips(alle)}</div></div>
      <div class="tp-srader">${rader || `<div class="tp-tomt">${T('Skann et anlegg, så vises status her.', 'Scan a site and its status shows here.')}</div>`}</div>`;
  }
  /* The picture is one SVG whose view box is moved: the wheel and the buttons set where it should go, and every frame it moves a
     fraction of the way there, so zooming glides instead of jumping. Names, hubs and adapters are redrawn at a fixed size on
     the screen, so they stay readable at every zoom, and the names of the devices come in as you get close. */
  function bruk() {
    const sv = $('tpGraf');
    if (!sv || !KT.vb) return;
    sv.setAttribute('viewBox', KT.vb.map(v => +v.toFixed(2)).join(' '));
    maal();
  }
  function maal() {
    const sv = $('tpGraf');
    if (!sv || !KT.vb) return;
    const sc = Math.min((sv.clientWidth || 1) / KT.vb[2], (sv.clientHeight || 1) / KT.vb[3]) || 1;
    KT.sc = sc;
    if (Math.abs(sc - (KT.sc0 || 0)) > 1e-4 * sc) {
      KT.sc0 = sc;
      const inv = (1 / sc).toFixed(4);
      const kortSk = (Math.min(3, Math.max(1, sc / 8.5)) / sc).toFixed(4);
      for (const [g, k] of KT.fastEls || []) g.setAttribute('transform', `translate(${g.dataset.x},${g.dataset.y}) scale(${k ? kortSk : inv})`);
      sv.style.setProperty('--dl', (11 / sc).toFixed(3) + 'px');
    }
    sv.classList.toggle('n-proto', sc > .5);
    sv.classList.toggle('n-feil', sc > .9);
    sv.classList.toggle('n-alle', !!KT.navn || sc > 4.2);
    sv.classList.toggle('n-kort', sc > 8.5);
    sv.classList.toggle('n-detalj', sc > 16);
    clearTimeout(KT.kolT);
    KT.kolT = setTimeout(kolisjon, 110);
  }
  /* Names are shown by priority: sites first, then the protocol labels, then devices with an alarm or fault (worst first), then the
     rest. A name that would touch one already placed waits until you zoom in. The one under the pointer or picked is always shown. */
  function kolisjon() {
    const sv = $('tpGraf');
    if (!sv || sv.clientWidth < 10) return;
    const kand = [];
    sv.querySelectorAll('.tp-gh text:not(.u), .tp-gs text, .tp-gt').forEach((el) => {
      el.removeAttribute('data-skjul');
      if (!el.getClientRects().length) return;
      const pri = el.closest('.tp-gh') ? 0 : el.closest('.tp-gs') ? 1 : 2;
      const rang = pri === 2 ? (() => { const n = el.previousElementSibling; return n ? ({'s-alarm': 0, 's-feil': 1, 's-over': 2}[[...n.classList].find(c => c.startsWith('s-'))] ?? 3) : 3; })() : 0;
      kand.push({el, pri, rang});
    });
    kand.sort((a, b) => a.pri - b.pri || a.rang - b.rang);
    const tatt = [], pad = 3;
    const sr = sv.getBoundingClientRect();
    // The dots themselves count too, so a name does not sit on top of a neighbour's dot when it can be helped
    for (const k of kand) {
      const r = k.el.getBoundingClientRect();
      const b = {x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad};
      const ute = b.x < sr.left || b.y < sr.top || b.x + b.w > sr.right || b.y + b.h > sr.bottom;
      const treff = tatt.some(t => b.x < t.x + t.w && b.x + b.w > t.x && b.y < t.y + t.h && b.y + b.h > t.y);
      if (treff || (ute && k.pri === 2)) k.el.setAttribute('data-skjul', '1'); else tatt.push(b);
      if (k.pri === 0 && treff) k.el.removeAttribute('data-skjul');
    }
  }
  function steg(t) {
    KT.raf = 0;
    if (!KT.mal || !KT.vb) return;
    const dt = Math.min(50, t - (KT.sist || t - 16));
    KT.sist = t;
    const k = rolig() ? 1 : 1 - Math.exp(-dt / 80);
    let ferdig = true;
    for (let i = 0; i < 4; i++) {
      const d = KT.mal[i] - KT.vb[i];
      KT.vb[i] += d * k;
      if (Math.abs(d) > (i < 2 ? KT.mal[2] : KT.mal[i]) * .0008) ferdig = false;
    }
    if (ferdig) { KT.vb = KT.mal.slice(); KT.sist = 0; }
    bruk();
    if (!ferdig) KT.raf = requestAnimationFrame(steg);
  }
  function mot(vb) {
    const maks = KT.fit ? KT.fit[2] * 3 : 1e5, min = KT.fit ? KT.fit[2] / 80 : 5;
    if (vb[2] > maks || vb[2] < min) return;
    KT.mal = vb;
    if (!KT.raf) { KT.sist = 0; KT.raf = requestAnimationFrame(steg); }
  }
  function zoomOm(f, cx, cy) {
    const sv = $('tpGraf'), [x, y, w, h] = KT.mal || KT.vb, r = sv.getBoundingClientRect();
    const fx = cx === undefined ? .5 : (cx - r.left) / r.width, fy = cy === undefined ? .5 : (cy - r.top) / r.height;
    const nw = w * f, nh = h * f;
    mot([x + (w - nw) * fx, y + (h - nh) * fy, nw, nh]);
  }
  function flyGrense(b) { mot(tilpass([b[0], b[1], b[2] - b[0], b[3] - b[1]])); }
  function flyPunkt(adr) {
    const q = KT.pos && KT.pos[adr];
    if (!q) return;
    const sv = $('tpGraf'), ar = (sv.clientWidth || 800) / (sv.clientHeight || 500), w = Math.min((KT.mal || KT.vb)[2], 340), h = w / ar;
    mot([q[0] - w / 2, q[1] - h / 2, w, h]);
  }
  function grafInteraksjon() {
    const sv = $('tpGraf'), pek = new Map();
    let dra = null, klyp = 0;
    sv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomOm(Math.exp(Math.max(-120, Math.min(120, d)) * .0016), e.clientX, e.clientY);
    }, {passive: false});
    sv.addEventListener('pointerdown', (e) => {
      pek.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (pek.size === 2) { const [a, b] = [...pek.values()]; klyp = Math.hypot(a.x - b.x, a.y - b.y); dra = null; return; }
      dra = {x: e.clientX, y: e.clientY, vb: (KT.mal || KT.vb).slice(), flyttet: false};
    });
    sv.addEventListener('pointermove', (e) => {
      if (pek.has(e.pointerId)) pek.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (pek.size === 2) {
        const [a, b] = [...pek.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (klyp && d) zoomOm(klyp / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        klyp = d; KT.drattNaa = Date.now();
        return;
      }
      if (!dra) return;
      const r = sv.getBoundingClientRect(), dx = e.clientX - dra.x, dy = e.clientY - dra.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { dra.flyttet = true; sv.classList.add('drar'); }
      if (!dra.flyttet) return;
      const sc = Math.min(r.width / dra.vb[2], r.height / dra.vb[3]);
      const nv = [dra.vb[0] - dx / sc, dra.vb[1] - dy / sc, dra.vb[2], dra.vb[3]];
      KT.vb = nv.slice(); KT.mal = nv; bruk();
    });
    const slutt = (e) => {
      pek.delete(e.pointerId);
      if (pek.size < 2) klyp = 0;
      if (dra && dra.flyttet) KT.drattNaa = Date.now();
      sv.classList.remove('drar');
      if (!pek.size) dra = null;
    };
    sv.addEventListener('pointerup', slutt);
    sv.addEventListener('pointercancel', slutt);
    sv.addEventListener('dblclick', (e) => {
      const g = e.target.closest('[data-key]');
      if (g && KT.grenser[g.dataset.key]) flyGrense(KT.grenser[g.dataset.key]);
      else if (KT.fit) mot(tilpass(KT.fit));
    });
    // Hover: the site under the pointer lights up, the rest steps back
    sv.addEventListener('mouseover', (e) => {
      const n = e.target.closest ? e.target.closest('[data-s]') : null, v = n ? n.dataset.s : null;
      if (v === KT.fokus) return;
      sv.querySelectorAll('.hel').forEach(x => x.classList.remove('hel'));
      KT.fokus = v;
      sv.classList.toggle('fokus', v !== null);
      if (v !== null) sv.querySelectorAll(`[data-s="${v}"]`).forEach(x => x.classList.add('hel'));
    });
    sv.addEventListener('mouseleave', () => { KT.fokus = null; sv.classList.remove('fokus'); sv.querySelectorAll('.hel').forEach(x => x.classList.remove('hel')); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (KT.vb && KT.visning === 'spredt') maal(); }).observe(sv);
  }

  /* ------------------------------------------------------------ the list of remembered sites */
  function rail() {
    const lastet = aapne();
    const f = KT.filter.trim().toLowerCase();
    const rader = KT.anlegg.map(a => {
      const omr = a.key.split(' ');
      const inne = omr.some(r => lastet.has(r));
      const innen = !inne && !!a.naabar && a.svarer !== false;
      return {a, inne, innen, tilst: inne ? 'inne' : innen ? 'innen' : 'ute'};
    }).filter(r => (!KT.bare || r.inne || r.innen)
      && (!f || (r.a.navn + ' ' + r.a.key + ' ' + (r.a.navnliste || []).join(' ')).toLowerCase().includes(f)))
      .sort((x, y) => ({inne: 0, innen: 1, ute: 2}[x.tilst] - {inne: 0, innen: 1, ute: 2}[y.tilst]));
    const tekst = {inne: T('Åpent', 'Open'), innen: T('Legg til', 'Add'), ute: T('Utenfor rekkevidde', 'Out of reach')};
    $('tpListe').innerHTML = rader.map(({a, tilst}) => {
      const navn = a.navn || a.key.split(' ').join(', ');
      const skanner = KT.skann && document.body.classList.contains('skanner') && KT.skann.key === a.key;
      return `<button type="button" class="tp-rad ${tilst}${skanner ? ' skanner' : ''}${KT.valgt === 's:' + a.key ? ' valgt' : ''}" data-tp="rad" data-key="${esc(a.key)}" data-tip="t:${esc(tilst === 'ute' ? T('Utenfor rekkevidde nå. Koble til nettet eller VPN-et for å nå det', 'Out of reach now. Connect to the network or VPN to reach it') : tilst === 'innen' ? T('Klikk for å legge det til i skannet', 'Click to add it to the scan') : T('Åpent nå', 'Open now'))}">
        <span class="tp-prikk"></span><span class="tp-tekst"><b>${esc(navn)}</b><small>${a.enheter} ${ent(a.enheter)}${a.sist ? ' · ' + esc(siden(a.sist)) : ''}</small></span>
        <span class="tp-rad-t">${skanner ? '<span class="tp-radar liten"></span>' : esc(tekst[tilst])}</span></button>`;
    }).join('') || `<div class="tp-tomt">${KT.anlegg.length ? T('Ingen treff', 'No match') : T('Ingen anlegg husket ennå. Skann et anlegg, så dukker det opp her.', 'No sites remembered yet. Scan a site and it shows up here.')}</div>`;
  }

  /* ------------------------------------------------------------ the details */
  function enhetDetalj(d) {
    const k = slag(d), g = gruppeFor(d), p = protAv(d), s = tilstand(d);
    const c = d.address in S.cache ? flagCounts(S.cache[d.address]) : null;
    const rad = (n, v) => (v === '' || v === undefined || v === null ? '' : `<tr><td>${n}</td><td>${v}</td></tr>`);
    const tall = c ? [['in-alarm', T('alarm', 'alarm')], ['fault', T('feil', 'fault')], ['overridden', T('overstyrt', 'overridden')], ['out-of-service', T('ute av drift', 'out of service')]]
      .filter(([f]) => c[f]).map(([f, n]) => `${c[f]} ${n}`).join(' · ') : '';
    const adr = p === 'bacnet' ? d.address : (d.ip || kort0(d.address));
    return `<div class="tp-d-h"><span class="tp-ikon stor p-${p}">${ikon(k.k)}</span><div class="tp-tekst"><b>${esc(d.object_name || kort0(d.address))}</b><small>${esc(k.t)}</small></div>
        <button type="button" class="tp-x" data-tp="lukk-d" aria-label="${esc(T('Lukk', 'Close'))}">✕</button></div>
      <div class="tp-d-stat s-${s}">${glyf(s)}<span>${esc(STAT_TXT()[s])}${tall ? ' · ' + esc(tall) : ''}</span></div>
      <table class="tp-d-tab"><tbody>
        ${rad(T('Adresse', 'Address'), `<code>${esc(adr)}</code>`)}
        ${rad(T('Protokoll', 'Protocol'), `<span class="tp-prot p-${p}"><i></i>${PROT_NAVN[p]}</span>`)}
        ${rad(T('Leverandør', 'Vendor'), g.label ? esc(g.label) + (g.grunn ? ` <small>(${esc(g.grunn)})</small>` : '') : '')}
        ${rad(T('Modell', 'Model'), esc(d.model_name || ''))}
        ${rad(T('Instans', 'Instance'), d.instance !== undefined && p === 'bacnet' ? esc(String(d.instance)) : '')}
        ${rad('MAC', d.mac ? `<code>${esc(d.mac)}</code>${d.mac_vendor ? ' ' + esc(d.mac_vendor) : ''}` : '')}
        ${rad(T('Nettside', 'Web page'), d.web && d.web.tittel ? esc(d.web.tittel) : '')}
        ${rad(T('Svartid', 'Response'), d.rtt_ms ? d.rtt_ms + ' ms' : '')}
        ${rad(T('Område', 'Range'), esc(d._range || ''))}
      </tbody></table>
      <div class="tp-d-knapper"><button type="button" class="btn primary" data-tp="aapne-e" data-adr="${esc(d.address)}">${T('Åpne', 'Open')}</button>
        <button type="button" class="btn" data-tp="les-e" data-adr="${esc(d.address)}">${T('Les på nytt', 'Read again')}</button>
        <button type="button" class="btn" data-tp="web-e" data-adr="${esc(d.address)}">${T('Nettside', 'Web page')}</button>
        <button type="button" class="btn" data-tp="kopi-e" data-adr="${esc(adr)}">${T('Kopier adresse', 'Copy address')}</button></div>`;
  }

  function stedDetalj(key) {
    const a = KT.anlegg.find(x => x.key === key) || {key, navn: '', enheter: 0};
    const st = sted({key, lastet: stedKey(key).some(r => aapne().has(r))});
    const navn = a.navn || stedKey(key).join(', ');
    const per = PROT.filter(p => st.per[p].length).map(p => `<span class="tp-prot p-${p}"><i></i>${PROT_NAVN[p]} ${st.per[p].length}</span>`).join(' ');
    const inne = st.lastet, innen = !!a.naabar && a.svarer !== false;
    const rad = (n, v) => (v ? `<tr><td>${n}</td><td>${v}</td></tr>` : '');
    const lev = (a.leverandorer || []).filter(([n]) => n && !/^(ukjent|unknown)$/i.test(n)).map(([n, c]) => `${esc(n)} ${c}`).join(', ');
    const tell = inne ? ['alarm', 'feil', 'over', 'stille'].filter(s => st.tell[s]).map(s => `${st.tell[s]} ${STAT_TXT()[s]}`).join(' · ') : '';
    return `<div class="tp-d-h"><span class="tp-ikon stor">${ikon('sentral')}</span><div class="tp-tekst"><b>${esc(navn)}</b><small>${inne ? T('Åpent nå', 'Open now') : innen ? T('Innen rekkevidde', 'Within reach') : T('Utenfor rekkevidde', 'Out of reach')}</small></div>
        <button type="button" class="tp-x" data-tp="lukk-d" aria-label="${esc(T('Lukk', 'Close'))}">✕</button></div>
      <table class="tp-d-tab"><tbody>
        ${rad(T('Områder', 'Ranges'), esc(stedKey(key).join(', ')))}
        ${rad(T('Enheter', 'Devices'), inne ? st.dev.length + (per ? '<br>' + per : '') : a.enheter || '')}
        ${rad(T('Status', 'Status'), esc(tell))}
        ${rad(T('Leverandører', 'Vendors'), lev)}
        ${rad(T('Overstyrt', 'Overridden'), a.overstyrt ? String(a.overstyrt) : '')}
        ${rad(T('Sist besøkt', 'Last visit'), a.sist ? esc(siden(a.sist)) : '')}
        ${rad(T('Skannet', 'Scanned'), a.ganger ? (a.ganger === 1 ? T('1 gang', 'once') : T(`${a.ganger} ganger`, `${a.ganger} times`)) : '')}
        ${rad(T('Via kort', 'Through adapter'), a.naabar ? esc(a.naabar.interface + ' · ' + a.naabar.ip) : '')}
      </tbody></table>
      ${!inne && !innen ? `<p class="sp-meta">${T('Utenfor rekkevidde nå. Koble til anlegget (nettverk eller VPN), så kan du legge det til her.', 'Out of reach now. Connect to the site (network or VPN) and you can add it here.')}</p>` : ''}
      <div class="tp-d-knapper">${inne || innen ? `<button type="button" class="btn primary" data-tp="skann" data-key="${esc(key)}" data-modus="${esc(a.modus || '')}">${inne ? T('Skann på nytt', 'Scan again') : T('Legg til i skannet', 'Add to the scan')}</button>` : ''}
        ${inne ? `<button type="button" class="btn" data-tp="fjern" data-key="${esc(key)}">${T('Fjern fra lista', 'Remove from the list')}</button>` : ''}</div>`;
  }

  function kortDetalj(ip) {
    const k = KT.kort.find(x => x.ip === ip);
    if (!k) return '';
    const igang = (S.kort || []).some(x => x.ip === ip), m = KT.perKort[ip];
    const rad = (n, v) => (v ? `<tr><td>${n}</td><td>${v}</td></tr>` : '');
    return `<div class="tp-d-h"><span class="tp-ikon stor">${ikon('kort')}</span><div class="tp-tekst"><b>${esc(k.interface)}</b><small>${igang ? T('I bruk', 'In use') : T('Ikke i bruk', 'Not in use')}</small></div>
        <button type="button" class="tp-x" data-tp="lukk-d" aria-label="${esc(T('Lukk', 'Close'))}">✕</button></div>
      <table class="tp-d-tab"><tbody>
        ${rad('IP', `<code>${esc(k.cidr)}</code>`)}
        ${rad(T('Forespørsler', 'Requests'), m && m.antall ? String(m.antall) : '')}
        ${rad(T('Snitt', 'Average'), m && m.antall ? m.snitt + ' ms' : '')}
        ${rad(T('Feil', 'Errors'), m && m.antall ? String(m.feil) : '')}
      </tbody></table>
      ${igang ? '' : `<div class="tp-d-knapper"><button type="button" class="btn primary" data-tp="bruk-k" data-cidr="${esc(k.cidr)}">${T('Bruk dette kortet', 'Use this adapter')}</button></div>`}`;
  }

  function detalj() {
    const el = $('tpDetalj');
    if (!el) return;
    let h = '';
    const v = KT.valgt || '';
    if (v.startsWith('e:')) { const d = S.devices.find(x => x.address === v.slice(2)); h = d ? enhetDetalj(d) : ''; }
    else if (v.startsWith('s:')) h = stedDetalj(v.slice(2));
    else if (v.startsWith('k:')) h = kortDetalj(v.slice(2));
    el.hidden = !h;
    el.innerHTML = h;
    lag.classList.toggle('tp-medDetalj', !!h);
  }

  /* ------------------------------------------------------------ tooltips */
  function tipTekst(k) {
    if (k.startsWith('t:')) return `<div>${esc(k.slice(2))}</div>`;
    const d = S.devices.find(x => x.address === k.slice(2));
    if (!d) return '';
    const g = gruppeFor(d), s = tilstand(d), sl = slag(d);
    return `<b>${esc(d.object_name || kort0(d.address))}</b><div>${esc(sl.t)} · ${esc(g.label || PROT_NAVN[protAv(d)])}</div><div class="mono">${esc(kort0(d.address))}</div><div class="tp-tip-s s-${s}">${glyf(s)}${esc(STAT_TXT()[s])}</div>`;
  }
  function visTip(e) {
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    const tip = $('tpTip');
    if (!el || !tip) { if (tip) tip.hidden = true; return; }
    const h = tipTekst(el.dataset.tip);
    if (!h) { tip.hidden = true; return; }
    tip.innerHTML = h;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2)) + 'px';
    tip.style.top = (r.bottom + 8 + t.height > window.innerHeight ? r.top - t.height - 8 : r.bottom + 8) + 'px';
  }

  /* ------------------------------------------------------------ the frame */
  function skjelett() {
    lag.innerHTML = `<div class="gs-modal tp-modal"><div class="gs-head"><span class="gd-tittel">${T('Topologi', 'Topology')}</span>
      <span class="tp-visning" role="group" aria-label="${esc(T('Visning', 'View'))}"><button type="button" data-tp="v-status" class="${KT.visning === 'status' ? 'on' : ''}" title="${esc(T('Bare status for hele anlegget', 'Only the status of the whole plant'))}">${T('Status', 'Status')}</button><button type="button" data-tp="v-samlet" class="${KT.visning === 'samlet' ? 'on' : ''}" title="${esc(T('Enhetene samlet i grupper', 'Devices gathered in groups'))}">${T('Samlet', 'Grouped')}</button><button type="button" data-tp="v-spredt" class="${KT.visning === 'spredt' ? 'on' : ''}" title="${esc(T('Hver enhet for seg, med koblingene mellom dem', 'Every device on its own, with the connections between them'))}">${T('Spredt', 'Spread')}</button></span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="tp-kropp">
        <aside class="tp-rail"><div class="tp-rail-h"><b>${T('Husket anlegg', 'Remembered sites')}</b>
          <div class="tp-valg"><button type="button" data-tp="alle" class="on">${T('Alle', 'All')}</button><button type="button" data-tp="bare">${T('I rekkevidde', 'In reach')}</button></div></div>
          <input id="tpSok" class="field" type="search" placeholder="${esc(T('Søk etter anlegg', 'Search sites'))}" aria-label="${esc(T('Søk etter anlegg', 'Search sites'))}">
          <div id="tpListe" class="tp-liste"></div></aside>
        <section id="tpKol" class="tp-lerret"><div id="tpStatus" class="tp-status"></div>
          <div class="tp-verktoy" role="toolbar" aria-label="${esc(T('Zoom', 'Zoom'))}"><button type="button" data-tp="z-pluss" aria-label="${esc(T('Zoom inn', 'Zoom in'))}" title="${esc(T('Zoom inn (+)', 'Zoom in (+)'))}">+</button><button type="button" data-tp="z-minus" aria-label="${esc(T('Zoom ut', 'Zoom out'))}" title="${esc(T('Zoom ut (-)', 'Zoom out (-)'))}">−</button><button type="button" data-tp="z-fit" aria-label="${esc(T('Tilpass til vinduet', 'Fit to the window'))}" title="${esc(T('Tilpass til vinduet (0)', 'Fit to the window (0)'))}"><svg viewBox="0 0 16 16" class="tp-ik"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg></button><button type="button" data-tp="z-navn" aria-label="${esc(T('Vis alle navn', 'Show every name'))}" title="${esc(T('Vis alle navn', 'Show every name'))}">Aa</button></div><svg id="tpGraf" class="tp-graf-svg" role="img" aria-label="${esc(T('Topologi, spredt', 'Topology, spread'))}"></svg><svg id="tpLenker" class="tp-lenker" aria-hidden="true"></svg>
          <div class="tp-rad-pc"><div id="tpPc" class="tp-pc"></div><div id="tpInnhold" class="tp-innhold"></div></div></section>
        <aside id="tpDetalj" class="tp-detalj" hidden></aside>
      </div>
      <div class="tp-bunn"><span class="tp-tegn">
          <span class="tp-prot p-bacnet"><i></i>BACnet</span><span class="tp-prot p-modbus"><i></i>Modbus</span><span class="tp-prot p-knx"><i></i>KNX</span><span class="tp-prot p-nett"><i></i>${T('Nettverk', 'Network')}</span></span>
        <span class="tp-tegn st">${['ok', 'alarm', 'feil', 'over', 'stille'].map(s => `<span class="s-${s}">${glyf(s)}${esc(STAT_TXT()[s])}</span>`).join('')}</span>
        <span id="tpFot" class="sp-meta"></span></div>
      <div id="tpTip" class="tp-tip" hidden></div></div>`;
    grafInteraksjon();
    $('tpSok').addEventListener('input', (e) => { KT.filter = e.target.value; rail(); });
    $('tpKol').addEventListener('scroll', () => {}, {passive: true});
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => lenker()); ro.observe($('tpKol')); }
  }

  async function tikk() {
    if (lag.hidden) { clearInterval(KT.timer); KT.timer = 0; return; }
    if (!document.body.classList.contains('skanner') || !KT.anlegg.length) await hent();
    // The figures on the adapters move without the picture being drawn again
    lag.querySelectorAll('.tp-kort[data-kortid]').forEach(el => {
      const k = KT.kort.find(x => x.ip === el.dataset.kortid), c = el.querySelector('.tp-chips');
      if (k && c) { const h = kortChips(k); if (c.innerHTML !== h) c.innerHTML = h; }
    });
    tegn();
  }
  function lukk() { lag.hidden = true; clearInterval(KT.timer); KT.timer = 0; }

  /* Adds a site to the scan without leaving the page: the card turns into a scanner, the devices appear as they answer. */
  async function leggTil(key, modus) {
    if (document.body.classList.contains('skanner')) { toast(T('Et skann pågår, vent til det er ferdig.', 'A scan is running, wait until it is done.'), true); return; }
    if (!S.connected) { toast(T('Koble til et kort først.', 'Connect an adapter first.'), true); return; }
    $('rangeInput').value = key.split(' ').join(', ');
    if (modus && [...$('modeSel').options].some(o => o.value === modus)) $('modeSel').value = modus;
    savePrefs({range: $('rangeInput').value, mode: $('modeSel').value});
    KT.skann = {key};
    KT.valgt = 's:' + key;
    clearInterval(KT.timer);
    KT.timer = setInterval(tikk, 600);
    const p = runScan();
    setTimeout(() => tegn(true), 80);
    try { await p; } finally {
      KT.skann = null;
      await hent();
      if (!lag.hidden) { tegn(true); clearInterval(KT.timer); KT.timer = setInterval(tikk, 6000); }
    }
  }

  /* A pick in the spread view only moves the highlight, so the picture is not drawn again (and does not replay its entrance). */
  function velg(v) {
    KT.valgt = v;
    if (KT.visning !== 'spredt') { tegn(true); return; }
    const sv = $('tpGraf');
    sv.querySelectorAll('.valgt').forEach(x => x.classList.remove('valgt'));
    const q = v.slice(2);
    const el = v[0] === 'e' ? sv.querySelector(`.tp-gn[data-adr="${CSS.escape(q)}"]`) : v[0] === 's' ? sv.querySelector(`.tp-gh[data-key="${CSS.escape(q)}"]`) : sv.querySelector(`.tp-gk[data-kortid="${CSS.escape(q)}"]`);
    if (el) el.classList.add('valgt');
    detalj();
    rail();
  }
  /* In the grouped view the same buttons zoom the whole page, so many sites fit on one screen, and the page is moved by dragging. */
  function samletZoom(z) {
    KT.zs = Math.max(.35, Math.min(1.5, z));
    const rp = lag.querySelector('.tp-rad-pc');
    if (rp) rp.style.zoom = KT.zs === 1 ? '' : KT.zs;
    requestAnimationFrame(lenker);
  }
  function samletTilpass() {
    const rp = lag.querySelector('.tp-rad-pc'), lr = $('tpKol');
    if (!rp || !lr) return;
    rp.style.zoom = '';
    const w = rp.scrollWidth || 1, h = rp.scrollHeight || 1;
    samletZoom(Math.min(1.2, (lr.clientWidth - 40) / w, (lr.clientHeight - 36) / h));
  }
  function zoomKnapp(f) { if (KT.visning === 'spredt') zoomOm(f); else samletZoom((KT.zs || 1) / f); }
  let pd = null;
  lag.addEventListener('pointerdown', (e) => {
    if (KT.visning === 'spredt' || e.button !== 0 || !e.target.closest || e.target.closest('input,select,textarea,.tp-rail,.tp-detalj,.tp-verktoy')) return;
    const sc = e.target.closest('.tp-status') || $('tpKol');
    if (sc && sc.contains(e.target)) pd = {x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, sc, f: false};
  });
  lag.addEventListener('pointermove', (e) => {
    if (!pd) return;
    const dx = e.clientX - pd.x, dy = e.clientY - pd.y;
    if (!pd.f && Math.abs(dx) + Math.abs(dy) < 6) return;
    pd.f = true;
    pd.sc.classList.add('drar');
    pd.sc.scrollLeft = pd.sl - dx;
    pd.sc.scrollTop = pd.st - dy;
  });
  const slippPd = () => { if (pd) { if (pd.f) KT.drattNaa = Date.now(); pd.sc.classList.remove('drar'); } pd = null; };
  lag.addEventListener('pointerup', slippPd);
  lag.addEventListener('pointercancel', slippPd);
  lag.addEventListener('wheel', (e) => {
    if (KT.visning !== 'samlet' || !e.ctrlKey || !e.target.closest('.tp-lerret')) return;
    e.preventDefault();
    samletZoom((KT.zs || 1) * Math.exp(-e.deltaY * .002));
  }, {passive: false});
  async function kopi(t) { try { await navigator.clipboard.writeText(t); toast(T('Kopiert', 'Copied')); } catch { toast(t); } }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const n = e.target.closest('[data-tp]');
    if (!n) { if (e.target.closest('.tp-lerret') && KT.valgt) { KT.valgt = null; tegn(true); } return; }
    const t = n.dataset.tp;
    if (KT.drattNaa && Date.now() - KT.drattNaa < 250) return;
    if (t === 'v-samlet' || t === 'v-spredt' || t === 'v-status') {
      KT.visning = t === 'v-spredt' ? 'spredt' : t === 'v-status' ? 'status' : 'samlet';
      KT.vbNy = true;
      start();
      try { localStorage.setItem('nabe.topologi', KT.visning); } catch {}
      lag.querySelectorAll('.tp-visning button').forEach(b => b.classList.toggle('on', b === n));
      tegn(true);
      return;
    }
    if (t === 'alle' || t === 'bare') {
      KT.bare = t === 'bare';
      lag.querySelectorAll('.tp-valg button').forEach(b => b.classList.toggle('on', b === n));
      rail();
    } else if (t === 'lukk-d') { KT.valgt = null; tegn(true); }
    else if (t === 'mer') { KT.utvid.has(n.dataset.id) ? KT.utvid.delete(n.dataset.id) : KT.utvid.add(n.dataset.id); tegn(true); }
    else if (t === 'enhet') { velg('e:' + n.dataset.adr); if (KT.visning === 'spredt') flyPunkt(n.dataset.adr); }
    else if (t === 'sted') {
      if (KT.visning === 'spredt') { velg('s:' + n.dataset.key); if (KT.grenser[n.dataset.key]) flyGrense(KT.grenser[n.dataset.key]); }
      else { KT.valgt = 's:' + n.dataset.key; KT.apen.has(n.dataset.key) ? KT.apen.delete(n.dataset.key) : KT.apen.add(n.dataset.key); tegn(true); }
    }
    else if (t === 'z-pluss') zoomKnapp(1 / 1.4)
    else if (t === 'z-minus') zoomKnapp(1.4)
    else if (t === 'z-fit') { if (KT.visning === 'spredt') { if (KT.fit) mot(tilpass(KT.fit)); } else samletTilpass(); }
    else if (t === 'z-navn') { KT.navn = !KT.navn; n.classList.toggle('on', KT.navn); maal(); }
    else if (t === 'vis') { KT.apen.add(n.dataset.key); KT.valgt = 's:' + n.dataset.key; tegn(true); }
    else if (t === 'kort') velg('k:' + n.dataset.kortid);
    else if (t === 'skann') { e.stopPropagation(); leggTil(n.dataset.key, n.dataset.modus); }
    else if (t === 'rad') {
      const a = KT.anlegg.find(x => x.key === n.dataset.key);
      KT.valgt = 's:' + n.dataset.key;
      const inne = stedKey(n.dataset.key).some(r => aapne().has(r));
      if (!inne && a && a.naabar && a.svarer !== false) leggTil(n.dataset.key, a.modus);
      else {
        tegn(true);
        const kort = lag.querySelector(`[data-stedid="${CSS.escape(n.dataset.key)}"]`);
        if (kort) { kort.scrollIntoView({block: 'center', behavior: bevegelseAv() ? 'auto' : 'smooth'}); kort.classList.add('blink'); setTimeout(() => kort.classList.remove('blink'), 1400); }
      }
    } else if (t === 'fjern') {
      e.stopPropagation();
      const omr = n.dataset.key.split(' ');
      S.devices = S.devices.filter(d => !omr.includes(d._range));
      renderDevices();
      KT.valgt = null;
      tegn(true);
    } else if (t === 'aapne-e') { lukk(); selectDevice(n.dataset.adr); }
    else if (t === 'les-e') { delete S.cache[n.dataset.adr]; lukk(); selectDevice(n.dataset.adr, {force: true}); }
    else if (t === 'web-e') {
      const d = S.devices.find(x => x.address === n.dataset.adr);
      if (!d) return;
      const r = await api('/api/webside', {address: d.protocol === 'modbus' || d.protocol === 'knx' ? d.ip : d.address});
      if (r.status === 'done') toast(T(`Åpner ${r.url}`, `Opening ${r.url}`)); else toast(r.error || T('Fant ingen webside', 'Found no web page'), true);
    } else if (t === 'kopi-e') kopi(n.dataset.adr);
    else if (t === 'bruk-k') {
      await connectTo(n.dataset.cidr, {quiet: true});
      await refreshStatus();
      await hent();
      tegn(true);
    }
  });
  lag.addEventListener('mouseover', visTip);
  lag.addEventListener('mouseleave', () => { const t = $('tpTip'); if (t) t.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (!lag.hidden && KT.visning === 'spredt' && !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '') && !e.ctrlKey && !e.metaKey) {
      if (e.key === '+' || e.key === '=') { zoomOm(1 / 1.4); e.preventDefault(); return; }
      if (e.key === '-') { zoomOm(1.4); e.preventDefault(); return; }
      if (e.key === '0' && KT.fit) { mot(tilpass(KT.fit)); e.preventDefault(); return; }
    }
    if (e.key === 'Escape' && !lag.hidden) { if (KT.valgt) { KT.valgt = null; tegn(true); } else lukk(); e.stopPropagation(); }
  }, true);

  window.aapneKart = async () => {
    KT.sett = new Set(S.devices.map(d => d.address));
    KT.forste = true;
    KT.sig = '';
    KT.vbNy = true;
    skjelett();
    lag.hidden = false;
    lag.classList.toggle('tp-stille', rolig());
    start();
    await hent();
    tegn(true);
    clearInterval(KT.timer);
    KT.timer = setInterval(tikk, document.body.classList.contains('skanner') ? 600 : 6000);
  };
  /* A site name typed in the scan field stands for its ranges: "Hoppensprett" becomes 10.111.125.0/24. Whole names, or the start of
     one when only one site starts that way. Anything that looks like an address is left alone. */
  let NAVN = [];
  async function lastNavn() {
    try {
      const a = (await (await fetch('/api/anlegg', {cache: 'no-store'})).json()).anlegg || [];
      NAVN = a.filter(x => x.navn).map(x => ({navn: x.navn, key: x.key}));
      const dl = $('kjenteOmrader');
      if (dl) for (const n of NAVN) if (![...dl.options].some(o => o.value === n.navn)) { const o = document.createElement('option'); o.value = n.navn; dl.append(o); }
    } catch {}
  }
  window.nabeNavnTilOmraade = function (tekst) {
    if (!NAVN.length) return {tekst, byttet: []};
    const byttet = [];
    const ut = String(tekst || '').split(/[,;]/).map(del => {
      const t = del.trim(), lav = t.toLowerCase();
      if (!t || /^[\d.\/:\- ]+$/.test(t) || t.length < 3) return t;
      let treff = NAVN.filter(n => n.navn.toLowerCase() === lav);
      if (!treff.length) treff = NAVN.filter(n => n.navn.toLowerCase().startsWith(lav));
      if (treff.length !== 1) return t;
      byttet.push(`${treff[0].navn} → ${treff[0].key.split(' ').join(', ')}`);
      return treff[0].key.split(' ').join(', ');
    }).filter(Boolean).join(', ');
    return {tekst: ut, byttet};
  };
  setTimeout(lastNavn, 2500);
  // The language was switched while the page is open: build it again in the new language
  window.nabeKartSprak = () => { if (!lag.hidden) { skjelett(); KT.sig = ''; KT.vbNy = true; tegn(true); } };
  window.nabeKart = {steder, ip0, leggTil, lastNavn};
  if ($('kartBtn')) $('kartBtn').onclick = () => { closeMenus(); window.aapneKart(); };
})();
