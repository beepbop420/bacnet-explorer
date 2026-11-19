/* NABE - the topology as a picture for documentation.

   A drawing of what is open: this PC, the adapters it uses, the sites behind them, and in each site the devices by
   protocol and by vendor, with the state of the plant in small marks and the routers with what they carry. It is
   drawn fresh from what NABE knows, always on white with the same colours as the screen in its light theme, so it
   reads on paper and in a report whatever the theme is. Saved as SVG (vector, scales without loss) or PNG.
   Only what has been read is in it, and it is drawn on this PC. */
'use strict';

(function kartEksport() {
  const FARGE = {bg: '#ffffff', tekst: '#1b1d21', dempet: '#5c5f66', linje: '#c9ccd1', kort: '#f6f7f9', kant: '#d5d8de',
    bacnet: '#0072b2', modbus: '#b86e00', knx: '#00875f', ok: '#077a07', alarm: '#d81400', feil: '#d81400', over: '#8a6400', stille: '#5c5f66', varsel: '#8a6400'};
  const PROT = ['bacnet', 'modbus', 'knx'];
  const PROT_NAVN = {bacnet: 'BACnet', modbus: 'Modbus', knx: 'KNX'};
  const FONT = "font-family=\"Segoe UI, Helvetica, Arial, sans-serif\"";
  const rent = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ');
  const kort = (s, px, size) => { s = rent(s); const n = Math.max(3, Math.floor(px / (size * 0.56))); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const tekst = (x, y, s, o = {}) => `<text x="${x}" y="${y}" ${FONT} font-size="${o.size || 12}" font-weight="${o.vekt || 400}" fill="${o.farge || FARGE.tekst}"${o.anker ? ` text-anchor="${o.anker}"` : ''}>${esc(rent(s))}</text>`;

  const GLYF = {
    ok: (f) => `<circle cx="6" cy="6" r="3.6" fill="${f}"/>`,
    alarm: (f) => `<path d="M6 1.4 11 10.4H1Z" fill="${f}"/>`,
    feil: (f) => `<path d="M6 1 11 6 6 11 1 6Z" fill="${f}"/>`,
    over: (f) => `<circle cx="6" cy="6" r="3.2" fill="none" stroke="${f}" stroke-width="1.6"/>`,
    stille: (f) => `<path d="M2 6h8" stroke="${f}" stroke-width="1.8" stroke-linecap="round"/>`,
  };
  const glyf = (s, x, y, size = 12) => `<g transform="translate(${x},${y}) scale(${size / 12})">${GLYF[s](FARGE[s])}</g>`;

  function modell() {
    const K = window.nabeKart;
    const {ut} = K.steder();
    const steder = ut.filter((s) => s.lastet).map((s) => K.sted(s));
    const aktive = new Set((S.kort || []).map((k) => k.ip));
    const kortliste = K.kortListe();
    const perKort = new Map();
    for (const s of steder) {
      const k = s.kort || '';
      if (!perKort.has(k)) perKort.set(k, []);
      perKort.get(k).push(s);
    }
    return {K, steder, aktive, kortliste, perKort};
  }

  /* One site's card: what it is called, how it stands, and per protocol the vendors. Returns its height too. */
  function stedKortSvg(K, st, x, y, w) {
    let h = 18, u = '';
    const navn = st.navn || st.key.split(' ').join(', ');
    u += tekst(x + 14, y + 26, kort(navn, w - 120, 14), {size: 14, vekt: 600});
    u += tekst(x + 14, y + 44, kort(`${st.dev.length} ${st.dev.length === 1 ? T('enhet', 'device') : T('enheter', 'devices')} · ${st.key.split(' ').join(', ')}`, w - 28, 11), {size: 11, farge: FARGE.dempet});
    // The state of the site, as small marks from the right: shape and colour together
    let mx = x + w - 14;
    for (const s of ['stille', 'over', 'feil', 'alarm']) {
      const n = st.tell[s];
      if (!n) continue;
      const t = String(n), br = 12 + 4 + t.length * 7 + 8;
      mx -= br;
      u += glyf(s, mx, y + 14, 12) + tekst(mx + 16, y + 24, t, {size: 11, vekt: 600, farge: FARGE[s]});
    }
    h = 60;
    for (const p of PROT) {
      const l = st.per[p];
      if (!l.length) continue;
      const lev = new Map();
      for (const d of l) { const v = K.levAv(d) || ''; lev.set(v, (lev.get(v) || 0) + 1); }
      const sek = [...lev].sort((a, b) => b[1] - a[1]);
      const vtekst = sek.length === 1 && !sek[0][0] ? '' : sek.slice(0, 5).map(([v, n]) => `${v || '–'} ${n}`).join(' · ') + (sek.length > 5 ? ` · +${sek.length - 5}` : '');
      u += `<rect x="${x + 14}" y="${y + h - 4}" width="4" height="${vtekst ? 32 : 18}" rx="2" fill="${FARGE[p]}"/>`;
      u += tekst(x + 26, y + h + 9, `${PROT_NAVN[p]}  ${l.length}`, {size: 12, vekt: 600, farge: FARGE[p]});
      const bad = l.filter((d) => d._tp === 'feil').length, alm = l.filter((d) => d._alm).length;
      if (bad || alm) u += tekst(x + w - 14, y + h + 9, [bad ? `${bad} ${T('feil', 'faulty')}` : '', alm ? `${alm} ${T('alarm', 'alarm')}` : ''].filter(Boolean).join(' · '), {size: 11, farge: FARGE.alarm, anker: 'end'});
      if (vtekst) u += tekst(x + 26, y + h + 26, kort(vtekst, w - 40, 11), {size: 11, farge: FARGE.dempet});
      h += vtekst ? 42 : 28;
    }
    h += 8;
    return {h, svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${FARGE.kort}" stroke="${FARGE.kant}"/>${u}`};
  }

  function bygSvg() {
    const m = modell();
    if (!m.steder.length) return null;
    const {K, steder, aktive, kortliste, perKort} = m;
    const PC = {x: 40, w: 170, h: 64}, AD = {x: 290, w: 220, h: 62}, ST = {x: 600, w: 460};
    const GAP = 18, TOPP = 92;
    let y = TOPP;
    const plassert = [];
    const keys = [...perKort.keys()].sort((a, b) => (aktive.has(b) ? 1 : 0) - (aktive.has(a) ? 1 : 0));
    for (const k of keys) {
      const rader = perKort.get(k).map((s) => ({s, ...stedKortSvg(K, s, ST.x, 0, ST.w)}));
      const sum = rader.reduce((t, r) => t + r.h, 0) + GAP * (rader.length - 1);
      const y0 = y;
      let yy = y;
      const ytre = rader.map((r) => { const o = {y: yy, ...r}; yy += r.h + GAP; return o; });
      plassert.push({k, y0, sum, rader: ytre, kort: kortliste.find((c) => c.ip === k) || null});
      y += sum + GAP * 2;
    }
    const ruter = (window.nabeNett && K.ruterData) ? K.ruterData() : {rutere: [], utenRuter: [], maks: 32};
    const ruterRader = ruter.rutere.map((r) => ({a: r.ruter, b: `${r.nett.length} ${T('nett', r.nett.length === 1 ? 'network' : 'networks')} · ${r.total} ${r.total === 1 ? T('enhet', 'device') : T('enheter', 'devices')}`, niva: r.niva}))
      .concat(ruter.utenRuter.map((n) => ({a: T(`Nett ${n.nett}`, `Network ${n.nett}`), b: `${n.antall} ${T('enheter, ruter ikke funnet', 'devices, router not found')}`, niva: n.niva})));
    const ruterH = ruterRader.length ? 40 + ruterRader.length * 20 : 0;
    const bunn = y - GAP * 2 + 30;
    const rutY = bunn;
    const legY = rutY + (ruterH ? ruterH + 16 : 0);
    const H = legY + 64, W = ST.x + ST.w + 40;
    const midt = (TOPP + (y - GAP * 2)) / 2;
    let u = '';
    const bue = (x1, y1, x2, y2) => { const mm = Math.max(30, (x2 - x1) / 2); return `M${x1},${y1} C${x1 + mm},${y1} ${x2 - mm},${y2} ${x2},${y2}`; };
    const pcY = midt;
    // The lines first, so the boxes lie on top of them
    for (const g of plassert) {
      const ay = g.y0 + g.sum / 2;
      const paa = aktive.has(g.k);
      u += `<path d="${bue(PC.x + PC.w, pcY, AD.x, ay)}" fill="none" stroke="${paa ? FARGE.dempet : FARGE.linje}" stroke-width="2"${paa ? '' : ' stroke-dasharray="4 4"'}/>`;
      for (const r of g.rader) {
        const sy = r.y + 26;
        u += `<path d="${bue(AD.x + AD.w, ay, ST.x, sy)}" fill="none" stroke="${FARGE.linje}" stroke-width="2"/>`;
        const ps = PROT.filter((p) => r.s.per[p].length);
        ps.forEach((p, i) => { u += `<path d="${bue(AD.x + AD.w, ay + (i - (ps.length - 1) / 2) * 4, ST.x, sy + (i - (ps.length - 1) / 2) * 4)}" fill="none" stroke="${FARGE[p]}" stroke-width="1.4" opacity=".85"/>`; });
      }
    }
    u += `<rect x="${PC.x}" y="${pcY - PC.h / 2}" width="${PC.w}" height="${PC.h}" rx="10" fill="${FARGE.kort}" stroke="${FARGE.dempet}" stroke-width="1.4"/>`
      + tekst(PC.x + 14, pcY - 4, T('Denne PC-en', 'This PC'), {size: 14, vekt: 600})
      + tekst(PC.x + 14, pcY + 14, `${aktive.size} ${aktive.size === 1 ? T('kort i bruk', 'adapter in use') : T('kort i bruk', 'adapters in use')}`, {size: 11, farge: FARGE.dempet});
    for (const g of plassert) {
      const ay = g.y0 + g.sum / 2, paa = aktive.has(g.k);
      u += `<rect x="${AD.x}" y="${ay - AD.h / 2}" width="${AD.w}" height="${AD.h}" rx="10" fill="${FARGE.kort}" stroke="${paa ? FARGE.dempet : FARGE.kant}" stroke-width="${paa ? 1.4 : 1}"/>`
        + tekst(AD.x + 14, ay - 6, kort(g.kort ? g.kort.interface : T('Ukjent kort', 'Unknown adapter'), AD.w - 28, 13), {size: 13, vekt: 600})
        + tekst(AD.x + 14, ay + 12, kort(g.kort ? g.kort.cidr || g.k : g.k, AD.w - 28, 11), {size: 11, farge: FARGE.dempet});
      for (const r of g.rader) u += stedKortSvg(K, r.s, ST.x, r.y, ST.w).svg;
    }
    if (ruterH) {
      u += `<rect x="${ST.x}" y="${rutY}" width="${ST.w}" height="${ruterH}" rx="10" fill="${FARGE.kort}" stroke="${FARGE.kant}"/>`
        + tekst(ST.x + 14, rutY + 26, T('Rutere og MS/TP', 'Routers and MS/TP'), {size: 14, vekt: 600});
      ruterRader.forEach((r, i) => {
        const farge = r.niva === 'over' ? FARGE.alarm : r.niva === 'ok' ? FARGE.tekst : FARGE.varsel;
        u += tekst(ST.x + 14, rutY + 50 + i * 20, kort(r.a, 140, 12), {size: 12, vekt: 600, farge})
          + tekst(ST.x + 160, rutY + 50 + i * 20, kort(r.b, ST.w - 176 - (r.niva !== 'ok' ? 90 : 0), 12), {size: 12, farge: FARGE.dempet});
        if (r.niva !== 'ok') u += tekst(ST.x + ST.w - 14, rutY + 50 + i * 20, ({over: T('over grensen', 'over the limit'), tung: T('tung', 'heavy'), naer: T('nær grensen', 'near the limit')})[r.niva], {size: 11, vekt: 600, farge, anker: 'end'});
      });
    }
    // The key, and where it came from
    let lx = 40;
    for (const p of PROT) { u += `<rect x="${lx}" y="${legY}" width="14" height="4" rx="2" fill="${FARGE[p]}"/>` + tekst(lx + 20, legY + 5, PROT_NAVN[p], {size: 11}); lx += 28 + PROT_NAVN[p].length * 7; }
    lx += 16;
    for (const [s, t] of [['ok', T('i orden', 'fine')], ['alarm', T('alarm', 'alarm')], ['feil', T('feil', 'fault')], ['over', T('overstyrt', 'overridden')], ['stille', T('stille', 'quiet')]]) {
      u += glyf(s, lx, legY - 4, 12) + tekst(lx + 16, legY + 6, t, {size: 11}); lx += 28 + t.length * 6.5;
    }
    const dato = new Date().toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'long', year: 'numeric'});
    u += tekst(40, legY + 36, `NABE ${typeof NABE_VERSJON !== 'undefined' ? NABE_VERSJON : ''} · ${dato} · ${T('slik anlegget sto da det ble lest', 'the plant as it stood when it was read')}`, {size: 10, farge: FARGE.dempet});
    // A name the plant was given; else just what the picture is, since the controllers' own names would make a poor heading
    let navnet = '';
    try { const a = (SK.anlegg || []).find((x) => x.key === asNokkel()); navnet = (a && a.navn) || ''; } catch { /* none */ }
    const hode = tekst(40, 46, kort(navnet || T('Topologi', 'Topology'), W - 80, 20), {size: 20, vekt: 600})
      + tekst(40, 68, kort(navnet ? T('Topologi · nettverk, anlegg og enheter', 'Topology · network, sites and devices') : (S.scanRanges || []).join(', ') || T('Nettverk, anlegg og enheter', 'Network, sites and devices'), W - 80, 12), {size: 12, farge: FARGE.dempet});
    return {W, H, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('Topologi', 'Topology'))}"><rect width="${W}" height="${H}" fill="${FARGE.bg}"/>${hode}${u}</svg>`};
  }

  /* -------------------------------------------------------------- saving */
  const dag = () => new Date().toISOString().slice(0, 10);
  function last(blob, navn) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = navn;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function svgFil() {
    const r = bygSvg();
    if (!r) { toast(T('Skann et anlegg først', 'Scan a plant first')); return; }
    last(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + r.svg], {type: 'image/svg+xml;charset=utf-8'}), `topologi_${dag()}.svg`);
  }
  async function pngFil(skala = 2) {
    const r = bygSvg();
    if (!r) { toast(T('Skann et anlegg først', 'Scan a plant first')); return; }
    const img = new Image();
    const lastet = new Promise((ok, feil) => { img.onload = ok; img.onerror = feil; });
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
    try { await lastet; } catch { toast(T('Fikk ikke tegnet bildet', 'Could not draw the picture'), true); return; }
    const c = document.createElement('canvas');
    c.width = Math.round(r.W * skala); c.height = Math.round(r.H * skala);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => { if (b) last(b, `topologi_${dag()}.png`); else toast(T('Fikk ikke lagret bildet', 'Could not save the picture'), true); }, 'image/png');
  }

  /* ---------------------------------------------------------------- the menu */
  let meny = null;
  const lukkMeny = () => { if (meny) { meny.remove(); meny = null; } };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-tp="eksport"]');
    const valg = e.target.closest && e.target.closest('[data-eks]');
    if (valg) { const v = valg.dataset.eks; lukkMeny(); if (v === 'svg') svgFil(); else pngFil(); return; }
    if (!b) { if (meny && !e.target.closest('.tp-eksmeny')) lukkMeny(); return; }
    if (meny) { lukkMeny(); return; }
    meny = document.createElement('div');
    meny.className = 'tp-eksmeny';
    meny.innerHTML = `<button type="button" data-eks="svg"><b>SVG</b><span>${T('Vektor. Skalerer uten tap, passer i dokumenter', 'Vector. Scales without loss, fits in documents')}</span></button>
      <button type="button" data-eks="png"><b>PNG</b><span>${T('Bilde, to ganger oppløsning', 'Picture, twice the resolution')}</span></button>`;
    document.body.append(meny);
    const r = b.getBoundingClientRect(), mb = meny.getBoundingClientRect();
    meny.style.left = Math.max(8, Math.min(window.innerWidth - mb.width - 8, r.right - mb.width)) + 'px';
    meny.style.top = r.bottom + 6 + 'px';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && meny) { lukkMeny(); e.stopPropagation(); } }, true);

  window.nabeKartEksport = {bygSvg, svgFil, pngFil};
})();
