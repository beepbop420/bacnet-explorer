/* NABE - pointing at a curve.

   Both curves - the live trend in the inspector and a controller's own
   trend log - answer the pointer: a hairline drops to the nearest sample,
   a dot sits on it, and a label says when and what. The label stays on
   the side of the line away from the edge, so it never runs off the panel.
   Loaded after app.js and shares its globals. */
'use strict';

(function grafPeker() {
  const lapp = document.createElement('div');
  lapp.className = 'graf-lapp';
  lapp.hidden = true;
  document.body.appendChild(lapp);

  const lokal = () => (SPRAAK === 'en' ? 'en-GB' : 'nb-NO');
  const tall = (v) => { const n = Number(v); return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))); };

  // The samples behind a curve: [time text, value] for each point drawn.
  function punkter(svg) {
    if (svg.dataset.kilde === 'logg') {
      const enhet = (S.tlData && S.tlData.unit) || '';
      return (S.tlPunkter || []).map(r => [String(r.ts || ''), `${tall(r.value)} ${enhet}`.trim()]);
    }
    const p = S.pointIndex && S.pointIndex.get(S.selected);
    const enhet = (p && p.unit_symbol) || '';
    const tider = S.selHistT || [];
    return S.selHist.filter(v => typeof v === 'number').map((v, i) => [
      tider[i] ? new Date(tider[i]).toLocaleTimeString(lokal(), {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '',
      `${tall(v)} ${enhet}`.trim()]);
  }

  function rydd(svg) {
    svg.querySelectorAll('.graf-peker').forEach(e => e.remove());
    lapp.hidden = true;
  }

  document.addEventListener('pointermove', (e) => {
    const svg = e.target.closest && e.target.closest('svg.trend[data-kilde]');
    if (!svg) { if (!lapp.hidden) document.querySelectorAll('svg.trend').forEach(rydd); return; }
    const pts = punkter(svg);
    const linje = svg.querySelector('polyline');
    if (pts.length < 2 || !linje) return;
    const r = svg.getBoundingClientRect();
    const andel = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.round(andel * (pts.length - 1));
    // The point on the drawn line, in the svg's own units.
    const xy = linje.getAttribute('points').trim().split(/\s+/)[i];
    if (!xy) return;
    const [x, y] = xy.split(',').map(Number);
    const vb = svg.viewBox.baseVal;
    let g = svg.querySelector('g.graf-peker');
    if (!g) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'graf-peker');
      g.innerHTML = '<line y1="0"/><circle r="2.6"/>';
      svg.appendChild(g);
    }
    const l = g.querySelector('line'), c = g.querySelector('circle');
    l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y2', vb.height);
    c.setAttribute('cx', x); c.setAttribute('cy', y);
    const [tid, verdi] = pts[i];
    lapp.innerHTML = `${tid ? `<span>${esc(tid)}</span>` : ''}<b>${esc(verdi)}</b>`;
    lapp.hidden = false;
    // Screen position of the point, label on the side with room.
    const sx = r.left + (x / vb.width) * r.width, sy = r.top + (y / vb.height) * r.height;
    const b = lapp.offsetWidth, venstre = sx + 12 + b > window.innerWidth - 8;
    lapp.style.left = `${venstre ? sx - 12 - b : sx + 12}px`;
    lapp.style.top = `${Math.max(8, sy - lapp.offsetHeight - 8)}px`;
  });
  document.addEventListener('pointerleave', () => document.querySelectorAll('svg.trend').forEach(rydd), true);
})();
