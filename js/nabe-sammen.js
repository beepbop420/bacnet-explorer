/* NABE - several points at once.

   Picking rows: Ctrl/Cmd adds one, Shift takes a range, and a drag down the
   rows selects them the way a file list does - none of it starts a text
   selection any more.

   Seen together: with two or more points selected, the inspector draws them
   in one chart. A heating coil valve in % and a supply temperature in °C do
   not share a scale, so each curve has its own, top to bottom of the chart;
   the legend says what each is now and its range, and pointing at the chart
   reads every curve at that moment. The history is kept from when they were
   selected, every Live read. Loaded after app.js. */
'use strict';

const SAMMEN = {hist: new Map(), maks: 360};
const SAMMEN_FARGER = ['var(--accent)', '#e8833a', '#2bb673', '#b07cf0', '#e05a8a', '#2bb0c4'];

const valgteObj = () => !S.activeDev ? [] : [...S.sel]
  .filter(k => k.startsWith(S.activeDev.address + '|'))
  .map(k => k.slice(S.activeDev.address.length + 1))
  .filter(o => S.pointIndex.get(o));

function tallAv(v) {
  if (typeof v === 'number') return v;
  if (v === 'active') return 1;
  if (v === 'inactive') return 0;
  return null;
}

/* ---------------------------------------------------- picking rows */
(function velgRader() {
  const wrap = $('pointsWrap');
  if (!wrap) return;
  let start = null, dratt = false;
  wrap.addEventListener('mousedown', (e) => {
    const tr = e.target.closest && e.target.closest('tbody tr[data-o]');
    if (!tr || e.button !== 0) return;
    // A modifier click is a selection, never the start of marked text.
    if (e.shiftKey || e.ctrlKey || e.metaKey) { e.preventDefault(); window.getSelection()?.removeAllRanges(); return; }
    if (e.target.closest('input, button, [contenteditable]')) return;
    start = tr.dataset.o; dratt = false;
  });
  wrap.addEventListener('mousemove', (e) => {
    if (!start || !(e.buttons & 1)) { start = null; return; }
    const tr = e.target.closest && e.target.closest('tbody tr[data-o]');
    if (!tr || (tr.dataset.o === start && !dratt)) return;
    // Over a second row with the button down: a drag selection.
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    dratt = true;
    const rader = visiblePoints();
    const a = rader.findIndex(p => p.objid === start), b = rader.findIndex(p => p.objid === tr.dataset.o);
    if (a < 0 || b < 0) return;
    const [fra, til] = a <= b ? [a, b] : [b, a];
    S.sel.clear();
    for (let i = fra; i <= til; i++) S.sel.add(selKey(rader[i]));
    S.selAnchor = start;
    renderPoints();
  });
  document.addEventListener('mouseup', () => {
    if (dratt) {
      // The click that follows the drag must not inspect a single point.
      const stopp = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      wrap.addEventListener('click', stopp, {capture: true, once: true});
      setTimeout(() => wrap.removeEventListener('click', stopp, true), 50);
    }
    start = null; dratt = false;
  });
})();

/* ---------------------------------------------------- the history */
function registrer() {
  const naa = Date.now();
  for (const o of valgteObj()) {
    const p = S.pointIndex.get(o), v = tallAv(p && p.value);
    if (v === null) continue;
    const k = `${S.activeDev.address}|${o}`;
    const h = SAMMEN.hist.get(k) || [];
    if (!h.length || naa - h[h.length - 1][0] > 400) h.push([naa, v]);
    if (h.length > SAMMEN.maks) h.shift();
    SAMMEN.hist.set(k, h);
  }
}

/* ---------------------------------------------------- the chart */
function sammenBlokk() {
  const objs = valgteObj();
  if (objs.length < 2) return '';
  registrer();
  const serier = objs.slice(0, SAMMEN_FARGER.length).map((o, i) => {
    const p = S.pointIndex.get(o);
    const h = SAMMEN.hist.get(`${S.activeDev.address}|${o}`) || [];
    const verdier = h.map(x => x[1]);
    return {o, p, h, farge: SAMMEN_FARGER[i], min: Math.min(...verdier), maks: Math.max(...verdier)};
  });
  const nok = serier.some(s => s.h.length >= 2);
  const W = 300, H = 110;
  const t0 = Math.min(...serier.flatMap(s => s.h.map(x => x[0]))), t1 = Math.max(...serier.flatMap(s => s.h.map(x => x[0])));
  const xFor = (t) => t1 > t0 ? ((t - t0) / (t1 - t0)) * W : W;
  const yFor = (s, v) => s.maks === s.min ? H / 2 : H - 6 - ((v - s.min) / (s.maks - s.min)) * (H - 12);
  const kurver = nok ? serier.filter(s => s.h.length >= 2).map(s =>
    `<polyline points="${s.h.map(([t, v]) => `${xFor(t).toFixed(1)},${yFor(s, v).toFixed(1)}`).join(' ')}" fill="none"
      stroke="${s.farge}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('') : '';
  const enhet = (p) => p.unit_symbol || '';
  const fmt = (v) => Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
  return `<div class="sect sammen" id="sammenSect">
    <div class="sect-head">${T('Sammen', 'Together')} <small>${T(`${objs.length} valgte`, `${objs.length} selected`)}</small></div>
    <div class="sect-body">
      ${nok ? `<svg class="sammen-graf" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-t0="${t0}" data-t1="${t1}">${kurver}</svg>`
            : `<div class="sammen-tom">${S.live ? T('Samler verdier… kurvene kommer etter et par lesinger.', 'Collecting values… the curves come after a couple of reads.')
                : `<button type="button" class="btn" onclick="$('pollBtn')?.click()">${T('Slå på Live', 'Turn Live on')}</button> ${T('for å se dem sammen', 'to see them together')}`}</div>`}
      <div class="sammen-tegn">${serier.map(s => `
        <div class="sammen-rad" data-o="${esc(s.o)}">
          <i style="background:${s.farge}"></i>
          <span class="sammen-navn" title="${esc(s.p.name || s.o)}">${esc(s.p.description || s.p.name || s.o)}</span>
          <b>${s.h.length ? esc(fmt(s.h[s.h.length - 1][1])) : '—'} ${esc(enhet(s.p))}</b>
          <small>${s.h.length >= 2 ? `${esc(fmt(s.min))}–${esc(fmt(s.maks))}` : ''}</small>
        </div>`).join('')}
        ${objs.length > SAMMEN_FARGER.length ? `<div class="sammen-mer">${T(`De første ${SAMMEN_FARGER.length} vises`, `The first ${SAMMEN_FARGER.length} are shown`)}</div>` : ''}
      </div>
    </div></div>`;
}

function tegnSammen() {
  const insp = $('inspector');
  if (!insp) return;
  const html = sammenBlokk();
  const gammel = $('sammenSect');
  if (!html) { gammel?.remove(); return; }
  if (gammel) gammel.outerHTML = html;
  else insp.insertAdjacentHTML('afterbegin', html);
}

/* Pointing at it: a line, and every curve's value at that moment. */
(function peker() {
  const lapp = document.createElement('div');
  lapp.className = 'graf-lapp sammen-lapp';
  lapp.hidden = true;
  document.body.appendChild(lapp);
  document.addEventListener('pointermove', (e) => {
    const svg = e.target.closest && e.target.closest('svg.sammen-graf');
    if (!svg) { if (!lapp.hidden) { lapp.hidden = true; document.querySelectorAll('.sammen-linje').forEach(l => l.remove()); } return; }
    const r = svg.getBoundingClientRect(), andel = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const t0 = +svg.dataset.t0, t1 = +svg.dataset.t1, t = t0 + andel * (t1 - t0);
    let l = svg.querySelector('.sammen-linje');
    if (!l) { l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('class', 'sammen-linje'); svg.appendChild(l); }
    const x = andel * 300;
    l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', 0); l.setAttribute('y2', 110);
    const objs = valgteObj().slice(0, SAMMEN_FARGER.length);
    const rader = objs.map((o, i) => {
      const h = SAMMEN.hist.get(`${S.activeDev.address}|${o}`) || [];
      if (!h.length) return '';
      let best = h[0];
      for (const x of h) if (Math.abs(x[0] - t) < Math.abs(best[0] - t)) best = x;
      const p = S.pointIndex.get(o);
      return `<div><i style="background:${SAMMEN_FARGER[i]}"></i>${esc(p.description || p.name || o)} <b>${esc(String(Number(best[1].toFixed(2))))} ${esc(p.unit_symbol || '')}</b></div>`;
    }).join('');
    lapp.innerHTML = `<span>${new Date(t).toLocaleTimeString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO')}</span>${rader}`;
    lapp.hidden = false;
    const b = lapp.offsetWidth, venstre = e.clientX + 14 + b > window.innerWidth - 8;
    lapp.style.left = `${venstre ? e.clientX - 14 - b : e.clientX + 14}px`;
    lapp.style.top = `${Math.max(8, r.top - lapp.offsetHeight - 6)}px`;
  });
})();

/* ---------------------------------------------------- wiring */
(function kobl() {
  etter('renderInspector', () => tegnSammen());
  etter('renderPoints', () => tegnSammen());
  etter('pollTick', () => { registrer(); tegnSammen(); });
  // A click on a legend line inspects that point.
  document.addEventListener('click', (e) => {
    const rad = e.target.closest && e.target.closest('.sammen-rad');
    if (rad) selectPoint(rad.dataset.o);
  });
})();
