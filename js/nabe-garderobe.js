/* NABE - the wardrobe, and the two brothers being alive.

   Others have done this. Clippy interrupted work to offer help nobody asked
   for. Desktop pets run around the screen and are funny for a week.
   Tamagotchi made care a chore. Duolingo's outfits are bought with gems
   from a shop. What lasts is what this tries to keep:

   - Nothing is bought or clicked for. An item comes from doing the job: the
     hard hat from the first write to a plant, the head torch from a scan
     after ten at night, the crown from two hundred scans. Locked ones show
     how far there is to go, as a bar.
   - Work gear goes on by itself, on top of whatever is worn: reading
     glasses and a note while you are in a document or dialog, the hard hat
     while you are about to write, headphones on NABO while Live listens, a
     head torch in the evening. It says what is going on without a word.
   - They talk to each other - about the outfit, the plant on screen, the
     time of day - briefly, rarely, and never while you are typing.
   - They never block anything, and respect «Animations off».

   Right-click NABE or NABO, the … menu or the command palette opens it.
   Loaded after nabo-brodre.js and shares the globals. */
'use strict';

/* ------------------------------------------------------------- the items
   Drawn on the 32x32 grid both figures share. NABE's head is the box from
   y 6 to 29; NABO's is the little house from y 7 to 23 with his keyboard
   below. `krav` is a counter from the career and how many it takes. */
const PLAGG = [
  // --- head
  {id: 'caps', plass: 'hode', navn: ['Caps', 'Cap'], krav: null,
   nabe: '<path d="M5 9.4Q5 3.4 16 3.4T27 9.4Z" fill="#2c6be0"/><path d="M16 9.4H31.2Q31.2 11 27 11H16Z" fill="#1f4fae"/>',
   nabo: '<path d="M8.4 10.6Q8.6 5 16 5T23.6 10.6Z" fill="#2c6be0"/><path d="M16 10.6H28.4Q28.4 12 24.6 12H16Z" fill="#1f4fae"/>'},
  {id: 'lue', plass: 'hode', navn: ['Lue', 'Beanie'], krav: null,
   nabe: '<path d="M4.4 10Q4.4 1.6 16 1.6T27.6 10Z" fill="#2a9d8f"/><rect x="4" y="8.4" width="24" height="3" rx="1.2" fill="#21867a"/><circle cx="16" cy="1.4" r="1.8" fill="#e9f5f3"/>',
   nabo: '<path d="M8 11.4Q8 3.4 16 3.4T24 11.4Z" fill="#2a9d8f"/><rect x="7.6" y="10" width="16.8" height="2.6" rx="1" fill="#21867a"/><circle cx="16" cy="3.2" r="1.5" fill="#e9f5f3"/>'},
  {id: 'hjelm', plass: 'hode', navn: ['Hjelm', 'Hard hat'], krav: ['skriv', 1, ['Skriv til et anlegg', 'Write to a plant']],
   nabe: '<path d="M4.6 9.6Q4.6 2.6 16 2.6T27.4 9.6Z" fill="#f5c400"/><rect x="2.6" y="8.8" width="26.8" height="2" rx="1" fill="#d9a900"/><rect x="14.8" y="2.8" width="2.4" height="6" rx="1" fill="#d9a900"/>',
   nabo: '<path d="M7.8 11Q8 4.4 16 4.4T24.2 11Z" fill="#f5c400"/><rect x="6.4" y="10.2" width="19.2" height="1.8" rx=".9" fill="#d9a900"/><rect x="15" y="4.6" width="2" height="5.4" rx=".8" fill="#d9a900"/>'},
  {id: 'hodetelefoner', plass: 'hode', navn: ['Hodetelefoner', 'Headphones'], krav: ['live', 3, ['Slå på Live tre ganger', 'Turn Live on three times']],
   nabe: '<path d="M3.6 15Q3.6 3 16 3T28.4 15" fill="none" stroke="#2b2b2e" stroke-width="1.8"/><rect x="1" y="12" width="4" height="7" rx="1.6" fill="#3a3a3e"/><rect x="27" y="12" width="4" height="7" rx="1.6" fill="#3a3a3e"/>',
   nabo: '<path d="M7 15Q7 4.6 16 4.6T25 15" fill="none" stroke="#2b2b2e" stroke-width="1.6"/><rect x="5.2" y="12.6" width="3.4" height="5.6" rx="1.4" fill="#3a3a3e"/><rect x="23.4" y="12.6" width="3.4" height="5.6" rx="1.4" fill="#3a3a3e"/>'},
  {id: 'hodelykt', plass: 'hode', navn: ['Hodelykt', 'Head torch'], krav: ['natt', 1, ['Skann etter kl. 22', 'Scan after 10 pm']],
   nabe: '<rect x="3" y="8.6" width="26" height="2.2" fill="#2b2b2e"/><rect x="13.2" y="6.8" width="5.6" height="4.2" rx="1.2" fill="#4a4a50"/><circle cx="16" cy="8.9" r="1.5" fill="#fff4b0"/><path class="plagg-straale" d="M16 8.9L4 -6H28Z" fill="#fff4b0" opacity=".16"/>',
   nabo: '<rect x="7.8" y="9.6" width="16.4" height="1.8" fill="#2b2b2e"/><rect x="13.6" y="8" width="4.8" height="3.6" rx="1" fill="#4a4a50"/><circle cx="16" cy="9.8" r="1.2" fill="#fff4b0"/>'},
  {id: 'kokkelue', plass: 'hode', navn: ['Kokkelue', 'Chef’s hat'], krav: ['kos', 20, ['Klapp NABE 20 ganger', 'Pat NABE 20 times']],
   nabe: '<path d="M8 9.4V5.2Q5.6 2 9 1.6Q11 -1.2 16 .4Q21 -1.2 23 1.6Q26.4 2 24 5.2V9.4Z" fill="#fafafa" stroke="#d6d6d6" stroke-width=".4"/><rect x="8" y="7.4" width="16" height="2.2" fill="#ececec"/>',
   nabo: '<path d="M10 10.6V7Q8.4 4.4 11 4Q12.6 1.8 16 3Q19.4 1.8 21 4Q23.6 4.4 22 7V10.6Z" fill="#fafafa" stroke="#d6d6d6" stroke-width=".4"/>'},
  {id: 'propell', plass: 'hode', navn: ['Propellcaps', 'Propeller cap'], krav: ['skann', 50, ['50 skann', '50 scans']],
   nabe: '<path d="M7 9.4Q7 4 16 4T25 9.4Z" fill="#e63946"/><path d="M7 9.4H25" stroke="#c22f3b" stroke-width="1.2"/><path d="M16 4V1.4" stroke="#333" stroke-width=".7"/><ellipse class="plagg-propell" cx="16" cy="1.2" rx="4.4" ry=".9" fill="#ffd166"/>',
   nabo: '<path d="M9.6 10.6Q9.6 6 16 6T22.4 10.6Z" fill="#e63946"/><path d="M16 6V3.6" stroke="#333" stroke-width=".6"/><ellipse class="plagg-propell" cx="16" cy="3.4" rx="3.6" ry=".8" fill="#ffd166"/>'},
  {id: 'krone', plass: 'hode', navn: ['Krone', 'Crown'], krav: ['skann', 200, ['200 skann', '200 scans']],
   nabe: '<path d="M7.6 8.8L8.2 2.4L11.8 5.6L16 .6L20.2 5.6L23.8 2.4L24.4 8.8Z" fill="#f2c230" stroke="#c99a00" stroke-width=".5"/><circle cx="16" cy="6.4" r="1" fill="#e63946"/>',
   nabo: '<path d="M10 9.4L10.6 4.2L13.4 6.6L16 3L18.6 6.6L21.4 4.2L22 9.4Z" fill="#f2c230" stroke="#c99a00" stroke-width=".4"/>'},
  // --- face
  {id: 'lesebriller', plass: 'ansikt', navn: ['Lesebriller', 'Reading glasses'], krav: ['aapnet', 3, ['Åpne NABE tre ganger', 'Open NABE three times']],
   nabe: '<g fill="none" stroke="#c9a227" stroke-width=".9"><circle cx="11.2" cy="15.8" r="4.4"/><circle cx="20.8" cy="15.8" r="4.4"/><path d="M15.6 15.2Q16 14.4 16.4 15.2"/></g>',
   nabo: '<g fill="none" stroke="#c9a227" stroke-width=".7"><circle cx="13.1" cy="14.8" r="2.4"/><circle cx="18.9" cy="14.8" r="2.4"/><path d="M15.5 14.4h1"/></g>'},
  {id: 'solbriller', plass: 'ansikt', navn: ['Solbriller', 'Sunglasses'], krav: null,
   nabe: '<rect x="5.6" y="12.4" width="9.6" height="6" rx="2.4" fill="#111113"/><rect x="16.8" y="12.4" width="9.6" height="6" rx="2.4" fill="#111113"/><rect x="15" y="13.8" width="2" height="1.2" fill="#111113"/>',
   nabo: '<rect x="10.6" y="13" width="4.6" height="3.4" rx="1.2" fill="#111113"/><rect x="16.8" y="13" width="4.6" height="3.4" rx="1.2" fill="#111113"/><path d="M15.2 14.2h1.6" stroke="#111113" stroke-width=".8"/>'},
  {id: 'vernebriller', plass: 'ansikt', navn: ['Vernebriller', 'Safety goggles'], krav: ['skann', 10, ['10 skann', '10 scans']],
   nabe: '<rect x="4.4" y="11.6" width="23.2" height="8.4" rx="4" fill="rgba(140,200,255,.32)" stroke="#2b6cb0" stroke-width="1"/><rect x="2.4" y="14.6" width="2" height="2" fill="#2b6cb0"/><rect x="27.6" y="14.6" width="2" height="2" fill="#2b6cb0"/>',
   nabo: '<rect x="9.6" y="12.6" width="12.8" height="4.6" rx="2.2" fill="rgba(140,200,255,.32)" stroke="#2b6cb0" stroke-width=".8"/>'},
  {id: 'nerd', plass: 'ansikt', navn: ['Teipede briller', 'Taped glasses'], krav: ['punkter', 5000, ['Les 5000 punkter', 'Read 5000 points']],
   nabe: '<g fill="none" stroke="#111113" stroke-width="1.3"><rect x="6" y="11.6" width="10" height="8" rx="1.6"/><rect x="16" y="11.6" width="10" height="8" rx="1.6"/></g><rect x="14.6" y="13.4" width="2.8" height="3.4" rx=".6" fill="#f2f2f2"/>',
   nabo: '<g fill="none" stroke="#111113" stroke-width=".9"><rect x="10.6" y="12.8" width="5" height="4" rx=".8"/><rect x="16.4" y="12.8" width="5" height="4" rx=".8"/></g><rect x="15.2" y="13.6" width="1.6" height="2.2" fill="#f2f2f2"/>'},
  {id: 'monokkel', plass: 'ansikt', navn: ['Monokkel', 'Monocle'], krav: ['punkter', 25000, ['Les 25 000 punkter', 'Read 25,000 points']],
   nabe: '<circle cx="20.8" cy="15.6" r="4.8" fill="rgba(255,255,255,.08)" stroke="#c9a227" stroke-width=".9"/><path d="M25.4 17Q27.4 22 25.2 27.6" fill="none" stroke="#c9a227" stroke-width=".5"/>',
   nabo: '<circle cx="18.9" cy="14.8" r="2.6" fill="rgba(255,255,255,.08)" stroke="#c9a227" stroke-width=".7"/><path d="M21.4 15.6Q23 19 21.8 22" fill="none" stroke="#c9a227" stroke-width=".4"/>'},
  // --- neck
  {id: 'butterfly', plass: 'hals', navn: ['Butterfly', 'Bow tie'], krav: null,
   nabe: '<path d="M12.4 26.2L16 27.7L12.4 29.2ZM19.6 26.2L16 27.7L19.6 29.2Z" fill="#d62839"/><circle cx="16" cy="27.7" r="1" fill="#a51d2d"/>',
   nabo: '<path d="M13.2 22.4L16 23.6L13.2 24.8ZM18.8 22.4L16 23.6L18.8 24.8Z" fill="#d62839"/><circle cx="16" cy="23.6" r=".8" fill="#a51d2d"/>'},
  {id: 'skjerf', plass: 'hals', navn: ['Skjerf', 'Scarf'], krav: ['aapnet', 10, ['Åpne NABE ti ganger', 'Open NABE ten times']],
   nabe: '<path d="M3.4 25.4Q16 29.6 28.6 25.4V28.4Q16 32.4 3.4 28.4Z" fill="#e76f51"/><rect x="22" y="27" width="3.2" height="5" rx=".6" fill="#d65f42"/>',
   nabo: '<path d="M9 21.4Q16 24.4 23 21.4V23.4Q16 26.4 9 23.4Z" fill="#e76f51"/>'},
  {id: 'slips', plass: 'hals', navn: ['Slips', 'Tie'], krav: ['varfil', 1, ['Lag en Variabel-fil', 'Make a Variabel file']],
   nabe: '<path d="M14.8 26.2h2.4l.6 1.4-1.8 4.2-1.8-4.2z" fill="#2c6be0"/>',
   nabo: '<path d="M15 22.4h2l.5 1.1-1.5 3-1.5-3z" fill="#2c6be0"/>'},
  {id: 'refleks', plass: 'hals', navn: ['Refleksvest', 'Hi-vis vest'], krav: ['enheter', 100, ['Finn 100 enheter', 'Find 100 devices']],
   nabe: '<rect x="3" y="24.8" width="26" height="4.2" rx="1" fill="#c6f432"/><rect x="3" y="26.2" width="26" height="1.1" fill="#e8e8e8"/>',
   nabo: '<rect x="8" y="20.6" width="16" height="2.8" rx=".8" fill="#c6f432"/><rect x="8" y="21.5" width="16" height=".8" fill="#e8e8e8"/>'},
  // --- earned in the tunnel game, nowhere else
  {id: 'flygebriller', plass: 'ansikt', navn: ['Flygebriller', 'Flying goggles'], krav: ['tunnelRekord', 25, ['25 poeng i Tunnelen', '25 points in the tunnel']], spill: true,
   nabe: '<rect x="2.6" y="13.4" width="26.8" height="2.4" fill="#5b3a1e"/><circle cx="11.2" cy="15.6" r="4.9" fill="rgba(255,200,120,.28)" stroke="#a87a3d" stroke-width="1.4"/><circle cx="20.8" cy="15.6" r="4.9" fill="rgba(255,200,120,.28)" stroke="#a87a3d" stroke-width="1.4"/>',
   nabo: '<rect x="8" y="14" width="16" height="1.6" fill="#5b3a1e"/><circle cx="13.1" cy="14.8" r="2.7" fill="rgba(255,200,120,.28)" stroke="#a87a3d" stroke-width="1"/><circle cx="18.9" cy="14.8" r="2.7" fill="rgba(255,200,120,.28)" stroke="#a87a3d" stroke-width="1"/>'},
  {id: 'gullkabel', plass: 'hals', navn: ['Gullkabel', 'Gold cable'], krav: ['tunnelRunder', 50, ['Kjør Tunnelen 50 ganger', 'Run the tunnel 50 times']], spill: true,
   nabe: '<path d="M4 26.6Q16 31 28 26.6" fill="none" stroke="#e8b923" stroke-width="1.6"/><rect x="14" y="27.6" width="4" height="3.2" rx=".6" fill="#e8b923"/><path d="M15 30.8v1.2M17 30.8v1.2" stroke="#c99a00" stroke-width=".6"/>',
   nabo: '<path d="M9.4 22.6Q16 25.4 22.6 22.6" fill="none" stroke="#e8b923" stroke-width="1.2"/><rect x="14.6" y="23.4" width="2.8" height="2.2" rx=".5" fill="#e8b923"/>'},
  {id: 'jetpakke', plass: 'ekstra', navn: ['Jetpakke', 'Jetpack'], krav: ['tunnelRekord', 150, ['150 poeng i én tur i Tunnelen', '150 points in one tunnel run']], spill: true, sjelden: true,
   nabe: '<g class="plagg-jet"><rect x="-1.8" y="12" width="4.4" height="13" rx="2" fill="#9aa4b1" stroke="#6b7480" stroke-width=".5"/><rect x="29.4" y="12" width="4.4" height="13" rx="2" fill="#9aa4b1" stroke="#6b7480" stroke-width=".5"/><rect x="-1" y="14.6" width="2.8" height="1" fill="#e63946"/><rect x="30.2" y="14.6" width="2.8" height="1" fill="#e63946"/><path d="M-1.2 25h3.2l-.6 1.6h-2z M30 25h3.2l-.6 1.6h-2z" fill="#4a4f57"/><path class="plagg-flamme" d="M-.6 26.8Q.4 31.6 1.4 26.8Z M30.6 26.8Q31.6 31.6 32.6 26.8Z" fill="#ffb02e"/><path class="plagg-flamme indre" d="M0 26.8Q.4 29.4.8 26.8Z M31.2 26.8Q31.6 29.4 32 26.8Z" fill="#fff4b0"/></g>',
   nabo: '<g class="plagg-jet"><rect x="1" y="29.6" width="30" height="2.2" rx="1.1" fill="#2c6be0"/><rect x="3" y="30.2" width="26" height=".7" rx=".35" fill="#9cc2ff"/><path class="plagg-flamme" d="M5 31.8Q6 34.6 7 31.8Z M25 31.8Q26 34.6 27 31.8Z" fill="#7fd1ff"/></g>'},
];
const PLASSER = [['hode', ['Hode', 'Head']], ['ansikt', ['Ansikt', 'Face']], ['hals', ['Hals', 'Neck']], ['ekstra', ['Ekstra', 'Extra']]];

// Props for what they do now and then - not worn, held.
const REKVISITT = {
  lapp: '<g transform="rotate(-9 6 25)"><rect x="0" y="19.6" width="10" height="12" rx="1" fill="#fffbe6" stroke="#d9cf9e" stroke-width=".4"/><path d="M1.8 22.6h6.4M1.8 24.6h5M1.8 26.6h6.4M1.8 28.6h4" stroke="#b9ae7a" stroke-width=".55"/></g>',
  kaffe: '<g class="plagg-kaffe"><rect x="23.4" y="23.4" width="6.4" height="7" rx="1.4" fill="#f4efe6" stroke="#cdbfa6" stroke-width=".4"/><path d="M29.8 25.2q2 0 2 1.8t-2 1.8" fill="none" stroke="#cdbfa6" stroke-width=".7"/><path class="plagg-damp" d="M25.4 22q-1-1.4 0-2.8M27.6 22q-1-1.4 0-2.8" fill="none" stroke="#bfbfbf" stroke-width=".5" stroke-linecap="round"/></g>',
};

/* ---------------------------------------------------------- state */
const GARD = {kontekst: '', aktivitet: '', sistSamtale: 0, sistInput: 0, laast: null};
const gardPrefs = () => Object.assign({nabe: {}, nabo: {}, arbeidsklaer: true, kunngjort: []}, loadPrefs().garderobe || {});
const gardLagre = (patch) => savePrefs({garderobe: Object.assign(gardPrefs(), patch)});
const tellerNaa = () => (typeof teller === 'function' ? teller() : {});
const laastOpp = (p) => !p.krav || (tellerNaa()[p.krav[0]] || 0) >= p.krav[1];
const plagg = (id) => PLAGG.find(p => p.id === id);
const pn = (p) => T(p.navn[0], p.navn[1]);

/* Work gear for the moment: what goes on top of the chosen outfit now. */
function arbeidsklaer() {
  if (!gardPrefs().arbeidsklaer) return {nabe: {}, nabo: {}};
  const ut = {nabe: {}, nabo: {}, rekv: {nabe: []}};
  const time = new Date().getHours();
  const dokument = [...document.querySelectorAll('.gs-overlay')].some(o => !o.hidden && o.offsetParent !== null)
    || ($('naboOverlay') && !$('naboOverlay').hidden);
  const skriver = (document.activeElement && document.activeElement.id === 'wVal' && String(document.activeElement.value || '').trim())
    || Date.now() - (GARD.skrevet || 0) < 15000;
  if (time >= 21 || time < 6) ut.nabe.hode = 'hodelykt';
  if (S.live) ut.nabo.hode = 'hodetelefoner';
  if (skriver) ut.nabe.hode = 'hjelm';
  if (dokument) { ut.nabe.ansikt = 'lesebriller'; ut.nabo.ansikt = 'lesebriller'; ut.rekv.nabe.push('lapp'); }
  if (GARD.aktivitet === 'kaffe') ut.rekv.nabe.push('kaffe');
  if (GARD.aktivitet === 'lese') { ut.nabe.ansikt = 'lesebriller'; ut.rekv.nabe.push('lapp'); }
  return ut;
}

/* ---------------------------------------------------------- drawing */
function antrekk(hvem) {
  const valgt = gardPrefs()[hvem] || {};
  const arb = arbeidsklaer()[hvem] || {};
  return Object.assign({}, valgt, arb);
}

function kle(svg, hvem, fast) {
  // fast: the outfit to draw instead of the live one (the catalog's previews).
  const sett = fast || antrekk(hvem);
  const rekv = fast ? [] : ((arbeidsklaer().rekv || {})[hvem] || []);
  const nokkel = JSON.stringify([sett, rekv]);
  if (svg.dataset.plagg === nokkel) return;
  svg.dataset.plagg = nokkel;
  svg.querySelector(':scope > g.plagg-lag')?.remove();
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'plagg-lag');
  const deler = [];
  for (const [plass] of PLASSER) {
    const p = plagg(sett[plass]);
    if (p && p[hvem]) deler.push(`<g class="plagg plagg-${p.id}">${p[hvem]}</g>`);
  }
  for (const r of rekv) deler.push(`<g class="rekv rekv-${r}">${REKVISITT[r] || ''}</g>`);
  g.innerHTML = deler.join('');
  svg.appendChild(g);
  // Something on the head hides what it would clash with.
  svg.classList.toggle('har-hode', !!sett.hode);
  svg.classList.toggle('har-ansikt', !!sett.ansikt);
  svg.style.overflow = 'visible';
}

function kleAlle() {
  document.querySelectorAll('svg.nabe:not(.gard-forhånd)').forEach(s => kle(s, 'nabe'));
  document.querySelectorAll('svg.nabo-fig:not(.gard-forhånd)').forEach(s => kle(s, 'nabo'));
}

/* ---------------------------------------------------------- the catalog */
function aapneGarderobe(fane) {
  let lag = $('gardOverlay');
  if (!lag) {
    lag = document.createElement('div');
    lag.id = 'gardOverlay';
    lag.className = 'gs-overlay';
    lag.setAttribute('role', 'dialog');
    lag.setAttribute('aria-modal', 'true');
    document.body.appendChild(lag);
    lag.addEventListener('click', gardKlikk);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);
  }
  lag.dataset.fane = fane || lag.dataset.fane || 'nabe';
  tegnGarderobe();
  lag.hidden = false;
}

function forhaand(hvem, sett) {
  const kilde = hvem === 'nabe' ? NABE_SVG : (typeof NABO_SVG === 'string' ? NABO_SVG : '');
  return kilde.replace(/<svg /, '<svg data-hvem="' + hvem + '" ');
}

function tegnGarderobe() {
  const lag = $('gardOverlay');
  if (!lag) return;
  const hvem = lag.dataset.fane;
  const pr = gardPrefs();
  const valgt = pr[hvem] || {};
  const t = tellerNaa();
  const kort = (p) => {
    const aapen = laastOpp(p);
    const paa = valgt[p.plass] === p.id;
    const [k, n, tekst] = p.krav || [];
    const har = p.krav ? Math.min(t[k] || 0, n) : 0;
    return `<button type="button" class="gd-kort${aapen ? '' : ' laast'}${paa ? ' paa' : ''}${p.spill ? ' spill' : ''}${p.sjelden ? ' sjelden' : ''}" data-plagg="${p.id}" ${aapen ? '' : 'aria-disabled="true"'}
        title="${esc(aapen ? (paa ? T('Ta av', 'Take off') : T('Ta på', 'Put on')) : T(tekst[0], tekst[1]))}">
      <span class="gd-fig" data-forhand="${p.id}">${forhaand(hvem)}</span>
      <span class="gd-navn">${esc(pn(p))}</span>${p.spill ? `<span class="gd-merke">${T('Fra Tunnelen', 'From the tunnel')}</span>` : ''}
      ${aapen ? `<span class="gd-status">${paa ? T('På', 'On') : ''}</span>`
              : `<span class="gd-krav">${esc(T(tekst[0], tekst[1]))}</span><span class="gd-bar"><i style="transform:scaleX(${har / n})"></i></span><span class="gd-tall">${har} / ${n}</span>`}
    </button>`;
  };
  const alle = [...PLAGG, ...PEKERE], antall = alle.filter(laastOpp).length;
  lag.innerHTML = `<div class="gs-modal gd-modal">
    <div class="gs-head">
      <span class="gd-tittel">${T('Garderoben', 'The wardrobe')}</span>
      <span class="gs-meta gd-meta">${T(`${antall} av ${alle.length} låst opp`, `${antall} of ${alle.length} unlocked`)}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button>
    </div>
    <div class="gd-topp">
      <div class="gd-faner" role="tablist">
        <button type="button" role="tab" data-fane="nabe" aria-selected="${hvem === 'nabe'}">NABE</button>
        <button type="button" role="tab" data-fane="nabo" aria-selected="${hvem === 'nabo'}">NABO</button>
        <button type="button" role="tab" data-fane="peker" aria-selected="${hvem === 'peker'}">${T('Peker', 'Pointer')}</button>
      </div>
      <label class="gd-arb"${hvem === 'peker' ? ' hidden' : ''}><input type="checkbox" id="gdArb" ${pr.arbeidsklaer ? 'checked' : ''}>
        <span>${T('Arbeidsklær etter situasjon', 'Work gear for the moment')}<small>${T('Lesebriller i dokumenter, hjelm når du skriver, hodetelefoner på Live, hodelykt om kvelden', 'Reading glasses in documents, a hard hat when you write, headphones on Live, a head torch in the evening')}</small></span></label>
    </div>
    ${hvem === 'peker' ? pekerKatalog() : `<div class="gd-hoved">
      <div class="gd-scene"><div class="gd-stor" id="gdStor">${forhaand(hvem)}</div>
        <div class="gd-scene-tekst">${esc(T('Plaggene kommer av arbeid, ikke av klikking.', 'Items come from work, not from clicking.'))}</div></div>
      <div class="gd-katalog">${PLASSER.map(([plass, navn]) => `
        <div class="gd-plass">${esc(T(navn[0], navn[1]))}</div>
        <div class="gd-rutenett">${PLAGG.filter(p => p.plass === plass).map(kort).join('')}</div>`).join('')}</div>
    </div>`}
    </div>`;
  // Previews: each card wears its own item only; the big one the full outfit.
  lag.querySelectorAll('[data-forhand] svg').forEach(s => {
    s.classList.add('gard-forhånd');
    const p = plagg(s.parentElement.dataset.forhand);
    kle(s, hvem, {[p.plass]: p.id});
  });
  const stor = lag.querySelector('#gdStor svg');
  if (stor) { stor.classList.add('gard-forhånd'); kle(stor, hvem, Object.assign({}, valgt)); }
}

function gardKlikk(e) {
  const lag = $('gardOverlay');
  if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
  const fane = e.target.closest('[data-fane]');
  if (fane && fane.getAttribute('role') === 'tab') { lag.dataset.fane = fane.dataset.fane; tegnGarderobe(); return; }
  const pk = e.target.closest('[data-peker]');
  if (pk) {
    if (pk.classList.contains('laast')) return;
    gardLagre({peker: pk.dataset.peker});
    PEKER.bruk(pk.dataset.peker);
    tegnGarderobe();
    return;
  }
  if (e.target.id === 'gdArb') { gardLagre({arbeidsklaer: e.target.checked}); kleAlle(); return; }
  const k = e.target.closest('.gd-kort');
  if (!k || k.classList.contains('laast')) return;
  const hvem = lag.dataset.fane, p = plagg(k.dataset.plagg);
  const pr = gardPrefs();
  const sett = Object.assign({}, pr[hvem]);
  const paa = sett[p.plass] !== p.id;
  if (paa) sett[p.plass] = p.id; else delete sett[p.plass];
  gardLagre({[hvem]: sett});
  tegnGarderobe();
  kleAlle();
  if (paa) setTimeout(() => kommenterPlagg(hvem, p), 350);
}

/* ---------------------------------------------------------- talking
   A conversation is a list of lines, each to NABE (a bubble) or NABO (his
   terminal). Spaced by how long a line takes to read. */
let SAMTALE_GAAR = false;
async function samtale(linjer, {tvang = false} = {}) {
  if (SAMTALE_GAAR) return;
  if (!tvang && (Date.now() - GARD.sistInput < 15000 || document.body.classList.contains('skanner')
      || (typeof brorStille === 'function' && brorStille()))) return;
  SAMTALE_GAAR = true;
  GARD.sistSamtale = Date.now();
  try {
    for (const [hvem, nb, en] of linjer) {
      const tekst = T(nb, en);
      if (hvem === 'nabe') { if (typeof nabeSier === 'function') nabeSier(tekst); }
      else if (typeof brorSkriv === 'function') brorSkriv(tekst, {tvang: true, holde: 2200});
      await new Promise(r => setTimeout(r, 1500 + tekst.length * 55));
    }
  } finally { SAMTALE_GAAR = false; }
}

const PLAGG_REPLIKK = {
  hjelm: [['nabo', 'hjelm? du sitter i en topplinje', 'a hard hat? you live in a toolbar'], ['nabe', 'Ting faller ned. Ikoner, for eksempel.', 'Things fall. Icons, for one.']],
  krone: [['nabo', 'sudo kneel', 'sudo kneel'], ['nabe', 'Tillatelse avslått.', 'Permission denied.']],
  propell: [['nabo', 'kan du fly nå?', 'can you fly now?'], ['nabe', 'Bare når VPN-en faller.', 'Only when the VPN drops.']],
  monokkel: [['nabe', 'Mm. Et punkt ute av drift. Hvor uvanlig.', 'Mm. A point out of service. How unusual.'], ['nabo', 'du har lest 25 000 punkter og kjøpt en monokkel', 'you read 25,000 points and bought a monocle']],
  refleks: [['nabo', 'ingen kommer til å kjøre på deg her', 'nobody is going to run you over in here'], ['nabe', 'Det er fordi jeg bruker refleks.', 'That is because I wear hi-vis.']],
  kokkelue: [['nabo', 'hva lager vi?', 'what are we making?'], ['nabe', 'Variabel-fil. Al dente.', 'A Variabel file. Al dente.']],
  slips: [['nabo', 'møte?', 'meeting?'], ['nabe', 'Overlevering. Kunden liker slips.', 'Handover. The client likes ties.']],
  jetpakke: [['nabo', 'HVOR fikk du den', 'WHERE did you get that'], ['nabe', '150 brannmurer. Uten VPN.', '150 firewalls. Without a VPN.'], ['nabo', 'kan jeg låne den', 'can i borrow it'], ['nabe', 'Nei.', 'No.']],
  flygebriller: [['nabo', 'skal du fly?', 'are you flying?'], ['nabe', 'Jeg har flydd. I en tunnel.', 'I have flown. In a tunnel.']],
  gullkabel: [['nabo', 'er den ekte gull', 'is that real gold'], ['nabe', 'Kategori 8. Ingen merker forskjellen.', 'Category 8. Nobody can tell.']],
  hodelykt: [['nabe', 'Mørkt her. Eller er det bare dark mode.', 'Dark in here. Or is it just dark mode.']],
  solbriller: [['nabo', 'det er innendørs', 'we are indoors'], ['nabe', 'Skjermen er lys.', 'The screen is bright.']],
  nerd: [['nabo', 'teip?', 'tape?'], ['nabe', 'Den holder. Som det meste i et teknisk rom.', 'It holds. Like most things in a plant room.']],
};
function kommenterPlagg(hvem, p) {
  const r = PLAGG_REPLIKK[p.id];
  if (r) samtale(r, {tvang: true});
  else if (hvem === 'nabe') samtale([['nabo', `fin ${pn(p).toLowerCase()}`, `nice ${pn(p).toLowerCase()}`], ['nabe', 'Jeg vet.', 'I know.']], {tvang: true});
  else samtale([['nabe', `${pn(p)}? På deg?`, `${pn(p)}? On you?`], ['nabo', 'ja', 'yes']], {tvang: true});
}

// Now and then, when nothing is happening: one of these, picked to fit.
function hverdagsprat() {
  const t = new Date(), time = t.getHours(), dag = t.getDay();
  const tall = typeof anleggTall === 'function' ? anleggTall() : null;
  const pool = [
    [['nabo', 'ping nabe', 'ping nabe'], ['nabe', 'pong. Jeg er rett her.', 'pong. I am right here.']],
    [['nabo', 'hvorfor heter du NABE', 'why are you called NABE'], ['nabe', 'Not Another BACnet Explorer.', 'Not Another BACnet Explorer.'], ['nabo', 'men du ER en BACnet explorer', 'but you ARE a BACnet explorer'], ['nabe', 'Ikke en til, da.', 'Not another one, then.']],
    [['nabo', 'kan jeg få kaffe', 'can i have coffee'], ['nabe', 'Du er en nettside.', 'You are a web page.'], ['nabo', 'det var ikke et nei', 'that was not a no']],
    [['nabo', 'jeg tagget 650 punkter i går', 'i tagged 650 points yesterday'], ['nabe', 'Jeg leste dem. Vi er et team.', 'I read them. We are a team.'], ['nabo', 'du gjorde den lette delen', 'you did the easy part']],
    [['nabe', 'Vet du hva prioritet 1 er?', 'Do you know what priority 1 is?'], ['nabo', 'brann', 'fire'], ['nabe', 'Og prioritet 8?', 'And priority 8?'], ['nabo', 'noen som glemte å frigi', 'someone who forgot to release']],
    [['nabo', 'hvor mange regulatorer finnes det', 'how many controllers are there'], ['nabe', '4 194 302. Pluss jokeren.', '4,194,302. Plus the wildcard.']],
    [['nabo', 'git push', 'git push'], ['nabe', 'Ikke uten at Martin sier ja.', 'Not without a yes from Martin.']],
  ];
  if (tall && (tall.flagg['in-alarm'].length + tall.flagg['fault'].length) > 20)
    pool.push([['nabo', `${tall.flagg['in-alarm'].length + tall.flagg['fault'].length} feil her`, `${tall.flagg['in-alarm'].length + tall.flagg['fault'].length} faults here`], ['nabe', 'Mange av dem er én kabel. Se på klyngene.', 'Many of them are one cable. Look at the clusters.']]);
  if (tall && tall.flagg['overridden'].length)
    pool.push([['nabe', 'Noe står overstyrt.', 'Something is overridden.'], ['nabo', 'midlertidig?', 'temporarily?'], ['nabe', 'Det sa de i 2019 også.', 'They said that in 2019 too.']]);
  if (dag === 5 && time >= 14) pool.push([['nabo', 'fredag', 'friday'], ['nabe', 'Ikke endre settpunkter nå.', 'No setpoint changes now.'], ['nabo', 'bare en liten en', 'just a small one'], ['nabe', 'Nei.', 'No.']]);
  if (time >= 21 || time < 6) pool.push([['nabo', 'du har lykt på', 'you have a torch on'], ['nabe', 'Noen må være voksen her.', 'Someone has to be the grown-up.']]);
  if (time < 9 && time >= 6) pool.push([['nabe', 'God morgen.', 'Good morning.'], ['nabo', 'det er for tidlig for BACnet', 'it is too early for BACnet']]);
  if (S.devices.some(d => /wago/i.test(d.vendor_name || ''))) pool.push([['nabo', 'WAGO', 'WAGO'], ['nabe', 'Sjekk klokka.', 'Check the clock.'], ['nabo', 'alltid klokka', 'always the clock']]);
  if (S.live) pool.push([['nabo', 'jeg hører anlegget', 'i can hear the plant'], ['nabe', 'Det er Live. Hvert femte sekund.', 'That is Live. Every five seconds.']]);
  samtale(pool[Math.floor(Math.random() * pool.length)]);
}

/* ---------------------------------------------------------- now and then */
function aktivitet(navn, ms) {
  if (bevegelseAv() || GARD.aktivitet) return;
  GARD.aktivitet = navn;
  kleAlle();
  setTimeout(() => { GARD.aktivitet = ''; kleAlle(); }, ms);
}

/* ---------------------------------------------------------- wiring */
(function kobl() {
  // Who did something just now: talking waits for a quiet moment.
  for (const ev of ['keydown', 'pointerdown', 'wheel']) document.addEventListener(ev, () => { GARD.sistInput = Date.now(); }, true);

  // Right-click on either brother opens the wardrobe on his tab.
  document.addEventListener('contextmenu', (e) => {
    const nabe = e.target.closest && e.target.closest('.nabe-mark, .ss-logo > svg.nabe');
    const nabo = e.target.closest && e.target.closest('#naboHus, .ss-nabo, .nabo-hus-knapp');
    if (!nabe && !nabo) return;
    e.preventDefault();
    aapneGarderobe(nabo ? 'nabo' : 'nabe');
  });

  // NABO says something when clicked, and sometimes his brother answers.
  const BROR_SVAR = [
    ['hei', 'hi'], ['jeg jobber', 'i am working'], ['ikke trykk der', 'do not press there'], ['ls -la ~/hjem', 'ls -la ~/home'],
    ['ctrl+z på livet', 'ctrl+z on life'], ['404 motivasjon ikke funnet', '404 motivation not found'], ['ja?', 'yes?'],
  ];
  document.addEventListener('click', (e) => {
    if (!(e.target.closest && e.target.closest('#naboHus'))) return;
    GARD.broKlikk = (GARD.broKlikk || 0) + 1;
    if (GARD.broKlikk % 3 !== 0) return;
    const [nb, en] = BROR_SVAR[Math.floor(Math.random() * BROR_SVAR.length)];
    if (typeof brorSkriv === 'function') brorSkriv(T(nb, en), {tvang: true});
    if (Math.random() < 0.35) setTimeout(() => nabeSier(T('Han liker ikke å bli forstyrret.', 'He does not like being disturbed.')), 1800);
  }, true);

  // The line he types on his own, "ping nabe", now gets its answer.
  if (typeof brorSkriv === 'function') {
    const _skriv = brorSkriv;
    brorSkriv = function (tekst) {
      const r = _skriv.apply(this, arguments);
      if (/^ping nabe$/i.test(String(tekst)) && typeof sendOrd === 'function') {
        setTimeout(async () => {
          const h = typeof bror === 'function' && bror(), m = nabeMerke();
          await sendOrd(h, m, 'ping');
          await new Promise(x => setTimeout(x, 220));
          await sendOrd(m, h, 'pong');
          const svar = [['pong', 'pong'], ['pong. 0,4 ms. Vi bor i samme fil.', 'pong. 0.4 ms. We live in the same file.'], ['pong. Jeg er opptatt.', 'pong. I am busy.'], ['…pong', '…pong']];
          const [nb, en] = svar[Math.floor(Math.random() * svar.length)];
          if (Math.random() < 0.5) nabeSier(T(nb, en));
        }, 1600);
      }
      return r;
    };
  }

  // Counters for the items: Live, a Variabel file, a scan at night, a write.
  foer('startPolling', () => { if (!S.live) tell('live'); });
  foer('runScan', () => { const h = new Date().getHours(); if (h >= 22 || h < 5) tell('natt'); });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#wSend')) GARD.skrevet = Date.now(); }, true);

  // A new item unlocked: NABE says so, once.
  function sjekkNye() {
    const pr = gardPrefs();
    const nye = [...PLAGG, ...PEKERE].filter(p => p.krav && laastOpp(p) && !pr.kunngjort.includes(p.id));
    if (!nye.length) return;
    gardLagre({kunngjort: pr.kunngjort.concat(nye.map(p => p.id))});
    if (pr.kunngjort.length === 0 && nye.length > 2) return;   // the first visit: no flood
    const p = nye[0];
    nabeSier(T(`Ny i garderoben: ${pn(p)}. Høyreklikk meg.`, `New in the wardrobe: ${pn(p)}. Right-click me.`), 'fornoyd');
  }

  // Draw now, and again whenever a figure appears or the moment changes.
  let ventende = 0;
  new MutationObserver(() => { if (!ventende) ventende = setTimeout(() => { ventende = 0; kleAlle(); }, 120); })
    .observe(document.body, {childList: true, subtree: true});
  setInterval(kleAlle, 1000);
  setInterval(sjekkNye, 5000);
  setTimeout(sjekkNye, 3000);
  kleAlle();

  // Now and then: a conversation, or one of them doing something.
  (function plan() {
    setTimeout(() => {
      if (!document.hidden) {
        const r = Math.random();
        if (r < 0.45) hverdagsprat();
        else if (r < 0.7) { aktivitet('kaffe', 9000); if (Math.random() < 0.5) setTimeout(() => brorSkriv && brorSkriv(T('sudo lag kaffe', 'sudo make coffee'), {tvang: true}), 1200); }
        else aktivitet('lese', 8000);
      }
      plan();
    }, 240000 + Math.random() * 420000);
  })();
})();

window.aapneGarderobe = aapneGarderobe;

/* ---------------------------------------------------- a copy on disk
   The counters, the outfits and the tunnel record are in localStorage, which
   an update keeps but a new PC does not. The server keeps a copy in the data
   folder; on start the higher of the two wins, then the copy follows along. */
(function fremgang() {
  const REKORD = 'nabe_tunnel_rekord';
  const rekord = () => { try { return Number(localStorage.getItem(REKORD)) || 0; } catch { return 0; } };
  const naa = () => JSON.stringify({teller: teller(), garderobe: loadPrefs().garderobe || null, tunnel: rekord()});
  let sist = '';
  const lagre = () => {
    const s = naa();
    if (s === sist) return;
    sist = s;
    fetch('/api/fremgang', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: s, keepalive: true}).catch(() => {});
  };
  fetch('/api/fremgang').then(r => r.json()).then(({fremgang: f}) => {
    if (!f || !Object.keys(f).length) return;
    const t = teller(), ft = f.teller || {};
    let endret = false;
    for (const [k, v] of Object.entries(ft)) {
      if (k === 'sett') continue;
      if (typeof v === 'number' ? v > (t[k] || 0) : !(k in t)) { t[k] = v; endret = true; }
    }
    const sett = [...new Set([...(t.sett || []), ...(ft.sett || [])])];
    if (sett.length !== (t.sett || []).length) { t.sett = sett; endret = true; }
    if (endret) try { localStorage.setItem(TELLER_NOKKEL, JSON.stringify(t)); } catch {}
    if (f.garderobe && !loadPrefs().garderobe) { savePrefs({garderobe: f.garderobe}); kleAlle(); }
    if (f.tunnel > rekord()) {
      try { localStorage.setItem(REKORD, String(f.tunnel)); } catch {}
      if (typeof TUN === 'object') TUN.rekord = f.tunnel;
    }
  }).catch(() => {}).finally(() => {
    lagre();
    setInterval(lagre, 30000);
    addEventListener('pagehide', lagre);
  });
})();
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#gardBtn')) { document.body.click(); aapneGarderobe(); } });
