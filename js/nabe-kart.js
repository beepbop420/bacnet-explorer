/* NABE - network map.
   This PC on the left, its network adapters in the middle, the sites behind
   them on the right. Shows at a glance which adapters are in use, what each
   one carries (latency, errors), which buildings are open right now and which
   are within reach. Pick a site to add it next to the ones already open, or an
   idle adapter to bring it into use. Opened from the ⋯ menu or the palette. */
'use strict';

(function nettverkskart() {
  const KT = {kort: [], anlegg: [], perKort: {}, timer: 0};

  const lag = document.createElement('div');
  lag.id = 'kartOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const kort = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const ip0 = (cidr) => String(cidr || '').split(/[\/:]/)[0];

  async function hent() {
    const j = async (u) => { try { return await (await fetch(u, {cache: 'no-store'})).json(); } catch { return {}; } };
    const [i, a, t] = await Promise.all([j('/api/interfaces'), j('/api/anlegg'), j('/api/trafikk?etter=999999999')]);
    KT.kort = i.interfaces || [];
    KT.anlegg = a.anlegg || [];
    KT.perKort = t.kort || {};
  }

  /* What is open right now: the loaded devices grouped by range, each tied to
     the adapter that reads it. */
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
      if (!inne && !(a.naabar && a.svarer !== false)) continue;
      ut.push({key: a.key, navn: a.navn || '', antall: inne ? l.reduce((s, x) => s + x.antall, 0) : a.enheter,
               lastet: inne, kort: kortIp, svarer: a.svarer, overstyrt: a.overstyrt, modus: a.modus});
    }
    for (const [omr, e] of lastet) {
      if (brukt.has(omr)) continue;
      ut.push({key: omr, navn: '', antall: e.antall, lastet: true, kort: e.kort, svarer: true, overstyrt: 0, modus: ''});
    }
    const ute = KT.anlegg.filter(a => !a.naabar && !a.key.split(' ').some(r => lastet.has(r))).length;
    return {ut: ut.slice(0, 10), ute};
  }

  function tegn() {
    const {ut, ute} = steder();
    const adaptere = KT.kort.slice();
    // Sites per adapter, in the adapter order, so the lines never cross.
    const blokker = adaptere.map(k => ({k, s: ut.filter(x => x.kort === k.ip)}));
    const uten = ut.filter(x => !adaptere.some(k => k.ip === x.kort));
    const RAD = 62, TOPP = 36, PR_RAD = 12, MAKS_RADER = 7;
    // The devices of an open site, one small chip each, inside its node.
    for (const st of ut) {
      const omr = st.key.split(' ');
      st.dev = st.lastet ? (S.devices || []).filter(d => omr.includes(d._range)) : [];
      st.rader = Math.min(MAKS_RADER, Math.ceil(st.dev.length / PR_RAD));
      st.nodeH = 52 + (st.rader ? st.rader * 14 + 4 : 0);
      st.h = Math.max(RAD, st.nodeH + 12);
    }
    let y = TOPP;
    for (const b of blokker) {
      const hele = b.s.reduce((a, s) => a + s.h, 0) || RAD;
      b.y = y + hele / 2;
      let yy = y;
      for (const s of b.s) { s.y = yy + s.h / 2; yy += s.h; }
      y += hele;
    }
    const utenStart = y;
    for (const s of uten) { s.y = y + s.h / 2; y += s.h; }
    const H = Math.max(y + 16, 220), W = 860;
    const pcY = TOPP + Math.max(RAD, utenStart - TOPP) / 2;
    const aktive = new Set((S.kort || []).map(k => k.ip));
    const hoved = ((S.kort || []).find(k => k.primary) || {}).ip;

    const kurve = (x1, y1, x2, y2) => `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`;
    let linjer = '', noder = '';

    // This PC
    noder += `<g class="kt-pc" transform="translate(28,${pcY - 28})"><rect width="112" height="56" rx="3"/>
      <text x="56" y="25" class="kt-t">${T('Denne PC-en', 'This PC')}</text>
      <text x="56" y="42" class="kt-s">${aktive.size} ${T('kort i bruk', 'adapters in use')}</text></g>`;

    for (const b of blokker) {
      const k = b.k, igang = aktive.has(k.ip), s = (S.kort || []).find(x => x.ip === k.ip) || {};
      const m = KT.perKort[k.ip];
      const feil = m && m.antall ? m.feil / m.antall : 0;
      const klasse = igang ? (feil > 0.5 ? 'ktx-varsel' : 'ktx-ok') : 'ktx-av';
      const tall = igang && m ? `${m.snitt} ms${m.feil ? ` · ${m.feil} ${T('feil', 'errors')}` : ''}` : (igang ? T('ingen trafikk ennå', 'no traffic yet') : T('ikke i bruk', 'not in use'));
      linjer += `<path class="kt-lenke ${igang ? 'paa' : 'av'} ${klasse}" d="${kurve(140, pcY, 300, b.y)}"/>`;
      noder += `<g class="kt-kort ${klasse}${igang ? '' : ' kt-klikk'}" data-kt="kort" data-cidr="${esc(k.cidr)}" transform="translate(300,${b.y - 29})">
        <title>${esc(k.interface + ' ' + k.cidr + (s.bbmd ? ' · BBMD ' + s.bbmd : ''))}</title>
        <rect width="230" height="58" rx="3"/><circle cx="16" cy="19" r="4" class="kt-prikk"/>
        <text x="30" y="23" class="kt-t">${esc(kort(k.interface, 24))}</text>
        <text x="216" y="23" class="kt-s kt-h">${igang ? (k.ip === hoved ? T('hoved', 'main') : T('aktiv', 'active')) : T('Bruk', 'Use')}</text>
        <text x="16" y="42" class="kt-s">${esc(k.ip)}${s.bbmd ? ' · BBMD' : ''} · ${esc(tall)}</text></g>`;
      for (const st of b.s) {
        linjer += `<path class="kt-lenke ${st.lastet ? 'paa' : 'av'}" d="${kurve(530, b.y, 640, st.y)}"/>`;
        if (st.lastet) linjer += `<circle r="2.6" class="kt-puls"><animateMotion dur="2.6s" repeatCount="indefinite" path="${kurve(530, b.y, 640, st.y)}"/></circle>`;
      }
    }
    const stedNode = (st) => {
      const navn = st.navn || st.key.split(' ').join(', ');
      const under = `${st.antall} ${T('enheter', 'devices')}${st.overstyrt ? ` · ${st.overstyrt} ${T('overstyrt', 'overridden')}` : ''}`;
      const maks = st.rader * PR_RAD;
      const chips = st.dev.slice(0, maks).map((d, i) => {
        const c = d.address in S.cache ? flagCounts(S.cache[d.address]) : null;
        const kl = BORTE_NAA.has(d.address) ? 'stille' : c && c['in-alarm'] ? 'alarm' : c && c['fault'] ? 'feil'
          : c && (c['overridden'] || c['out-of-service']) ? 'over' : 'ok';
        return `<rect class="kt-chip ${kl}" data-kt="enhet" data-adr="${esc(d.address)}" x="${14 + (i % PR_RAD) * 14}" y="${50 + Math.floor(i / PR_RAD) * 14}" width="10" height="10" rx="2">
          <title>${esc((d.object_name || d.address) + ' · ' + d.address)}</title></rect>`;
      }).join('');
      const mer = st.dev.length > maks ? `<text x="182" y="${st.nodeH - 6}" class="kt-s kt-h">+${st.dev.length - maks}</text>` : '';
      return `<g class="kt-sted ${st.lastet ? 'lastet' : 'ledig'} kt-klikk" data-kt="sted" data-key="${esc(st.key)}" data-modus="${esc(st.modus || '')}" transform="translate(640,${st.y - st.nodeH / 2})">
        <title>${esc(navn)}</title><rect width="196" height="${st.nodeH}" rx="3"/>${chips}${mer}<circle cx="14" cy="17" r="3.5" class="kt-prikk"/>
        <text x="26" y="21" class="kt-t">${esc(kort(navn, 22))}</text>
        <text x="14" y="38" class="kt-s">${esc(under)}</text>
        ${st.lastet ? `<text x="182" y="21" class="kt-fjern" data-kt="fjern" data-key="${esc(st.key)}">✕<title>${T('Fjern fra lista', 'Remove from the list')}</title></text>` : `<text x="182" y="21" class="kt-s kt-h">+</text>`}</g>`;
    };
    for (const b of blokker) for (const st of b.s) noder += stedNode(st);
    for (const st of uten) noder += stedNode(st);

    const tom = !ut.length ? `<text x="640" y="${pcY}" class="kt-s">${T('Ingen anlegg å vise ennå', 'No sites to show yet')}</text>` : '';
    $('ktSvg').setAttribute('viewBox', `0 0 ${W} ${H}`);
    $('ktSvg').innerHTML = linjer + noder + tom;
    $('ktFot').textContent = ute ? T(`${ute} husket anlegg er utenfor rekkevidde nå`, `${ute} remembered site(s) are out of reach now`) : '';
  }

  function skjelett() {
    lag.innerHTML = `<div class="gs-modal kt-modal"><div class="gs-head"><span class="gd-tittel">${T('Nettverkskart', 'Network map')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="kt-kropp"><svg id="ktSvg" class="kt-svg" role="img" aria-label="${T('Nettverkskart', 'Network map')}"></svg>
        <div class="kt-bunn"><span class="kt-tegn"><i class="kt-lp"></i>${T('i bruk nå', 'open now')}<i class="kt-ld"></i>${T('innen rekkevidde', 'within reach')}</span>
          <span id="ktFot" class="sp-meta"></span></div></div></div>`;
  }

  async function tikk() {
    if (lag.hidden) { clearInterval(KT.timer); KT.timer = 0; return; }
    await hent();
    if (!lag.hidden && $('ktSvg')) tegn();
  }
  function lukk() { lag.hidden = true; clearInterval(KT.timer); KT.timer = 0; }

  async function leggTil(key, modus) {
    if (document.body.classList.contains('skanner')) { toast(T('Et skann pågår, vent til det er ferdig.', 'A scan is running, wait until it is done.'), true); return; }
    lukk();
    $('rangeInput').value = key.split(' ').join(', ');
    if (modus && [...$('modeSel').options].some(o => o.value === modus)) $('modeSel').value = modus;
    savePrefs({range: $('rangeInput').value, mode: $('modeSel').value});
    if (!S.connected) { toast(T('Koble til et kort først.', 'Connect an adapter first.'), true); return; }
    runScan();
  }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const fjern = e.target.closest('[data-kt="fjern"]');
    if (fjern) {
      const omr = fjern.dataset.key.split(' ');
      S.devices = S.devices.filter(d => !omr.includes(d._range));
      renderDevices();
      tegn();
      return;
    }
    const n = e.target.closest('[data-kt]');
    if (!n) return;
    if (n.dataset.kt === 'enhet') { lukk(); selectDevice(n.dataset.adr); return; }
    if (n.dataset.kt === 'sted') {
      if (n.classList.contains('lastet')) { lukk(); return; }
      leggTil(n.dataset.key, n.dataset.modus);
    } else if (n.dataset.kt === 'kort' && n.classList.contains('kt-klikk')) {
      await connectTo(n.dataset.cidr, {quiet: true});
      await refreshStatus();
      await tikk();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lukk(); e.stopPropagation(); }
  }, true);

  window.aapneKart = async () => {
    skjelett();
    lag.hidden = false;
    await hent();
    tegn();
    clearInterval(KT.timer);
    KT.timer = setInterval(tikk, 3000);
  };
  window.nabeKart = {steder, ip0};
  if ($('kartBtn')) $('kartBtn').onclick = () => { closeMenus(); window.aapneKart(); };
})();
