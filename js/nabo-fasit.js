/* NABO - tags suggested from the description.

   Tagging differs from plant to plant, but the description usually says
   what a point is: «Pådrag tilluftsvifte», «Temperatur tilluft». Every
   Variabel file BTG has written is a list of descriptions and the tags
   they got here. So a point's description is compared with all of them,
   and the closest one lends its form - component code and ending, JV401.Gn
   or RT401 - to the point's own system number.

   Compared by letter triples rather than words, so «Tilluftstemperatur» and
   «Temperatur tilluft» meet. Only the same kind of point (analog, binary,
   multi-state) is compared, and a word like «feil» or «settpunkt» on one
   side only counts against the match. A tag that already has a component
   code is left alone: the plant's own numbering wins. What is left are the
   points that never had one - a Corrigo's AV-40128 behind a gateway.
   Loaded after nabo.js and shares its globals. */
'use strict';

const FASIT = {klar: false, henter: false, liste: [], filer: 0, cache: new Map()};
const FS_STOPP = new Set(['i', 'på', 'til', 'for', 'av', 'og', 'fra', 'med', 'ved', 'etter', 'før', 'the', 'of']);
// Words that change what a point is. On one side only, they count against.
const FS_NOKKEL = ['feil', 'alarm', 'status', 'drift', 'settpunkt', 'pådrag', 'kvitter', 'brann', 'tilbakemeld',
  'vender', 'hand', 'auto', 'start', 'stopp', 'maks', 'min', 'offset', 'grense'];

function fsRen(s) {
  return (String(s || '').toLowerCase().replace(/\./g, ' ').match(/[a-zæøå0-9]+/g) || [])
    .filter(w => !FS_STOPP.has(w) && !/^\d+$/.test(w)).join(' ');
}
function fsTri(s) {
  s = s.replace(/ /g, '');
  const t = new Set();
  for (let i = 0; i + 3 <= s.length; i++) t.add(s.slice(i, i + 3));
  return t;
}
function fsNokler(ren) {
  const ord = ren.split(' ');
  return FS_NOKKEL.filter(k => ord.some(w => w.startsWith(k)));
}
function fsKlasse(t) {
  t = Number(t);
  return t <= 2 ? 'a' : t <= 5 ? 'b' : [13, 14, 19].includes(t) ? 'm' : '?';
}
function fsForm(tag) {
  const d = String(tag).split('.');
  const i = d.findLastIndex(x => KOMPONENT.test(x) && !/^O[US]\d+$/i.test(x));
  return i < 0 ? null : d.slice(i).join('.');
}
const fsBokstaver = x => String(x || '').replace(/\d/g, '').toUpperCase();

async function hentFasit() {
  if (FASIT.klar || FASIT.henter) return;
  FASIT.henter = true;
  try {
    const d = await (await fetch('/api/btg-fasit', {cache: 'no-store'})).json();
    FASIT.filer = d.filer || 0;
    FASIT.liste = (d.punkter || []).map(([tag, beskr, type]) => {
      const f = fsForm(tag);
      if (!f) return null;
      const ren = fsRen(btgUtenSd(beskr));
      return {f, b: beskr, kl: fsKlasse(type), tri: fsTri(ren), n: fsNokler(ren)};
    }).filter(x => x && x.tri.size >= 3);
    FASIT.klar = true;
    FASIT.cache.clear();
    if (!$('naboOverlay')?.hidden) tegnNabo();
  } catch { /* no exports, no suggestions */ }
  finally { FASIT.henter = false; }
}

/* The suggestion for one row, or null. */
function naboForslag(x) {
  if (!FASIT.klar || x.system || !x.beskr) return null;
  const kl = x.type <= 2 ? 'a' : x.type <= 5 ? 'b' : 'm';
  const nokkel = kl + '|' + x.beskr;
  let best = FASIT.cache.get(nokkel);
  if (best === undefined) {
    const ren = fsRen(btgUtenSd(x.beskr));
    const t = fsTri(ren), n = fsNokler(ren);
    best = null;
    if (t.size >= 3) {
      for (const f of FASIT.liste) {
        if (f.kl !== kl) continue;
        let felles = 0;
        for (const g of t) if (f.tri.has(g)) felles++;
        let s = 2 * felles / (t.size + f.tri.size);
        for (const k of FS_NOKKEL) if (n.includes(k) !== f.n.includes(k)) s -= 0.12;
        if (!best || s > best.s) best = {s, f: f.f, b: f.b};
      }
    }
    if (best && best.s < 0.6) best = null;
    FASIT.cache.set(nokkel, best);
  }
  if (!best) return null;
  // Onto the point's own system number, keeping what stands in front of it.
  const d = x.sti.split('.');
  const i = d.findIndex((p, j) => /^(\+[^=]*=)?\d{3}$/.test(p) && /^\d{3,4}$/.test(d[j + 1] || ''));
  if (i < 0) return null;
  // A tag that already has a component code keeps it: tried on a real
  // controller, the plant's own RT601 and SQ401 were right every time and
  // the description ("Lokalt settpunkt") said too little. Codes inside a
  // joined part count too (CAV_110_563101_SK401_FLOW).
  if (d.slice(i + 2).some(p => p.split('_').some(q => KOMPONENT.test(q) && !/^O[US]\d+$/i.test(q)))) return null;
  const tag = [...d.slice(0, i + 2), best.f].join('.');
  return tag === x.sti ? null : {tag, s: best.s, b: best.b, sikker: best.s >= 0.8};
}

/* Applying: one, every sure one, or all. A suggestion that would give a
   tag already on the device is left out - two points cannot share one. */
function brukForslag(rader) {
  const opptatt = new Set(naboResultat().rader.map(x => `${x.enhetNavn}|${x.sti}`));
  const endre = [];
  for (const x of rader) {
    const k = `${x.enhetNavn}|${x.forslag.tag}`;
    if (opptatt.has(k)) continue;
    opptatt.add(k);
    endre.push([x.key, 'sti', x.forslag.tag]);
  }
  if (!endre.length) { toast(T('Alle forslagene ville gitt tagger som finnes fra før', 'Every suggestion would give a tag that already exists'), true); return; }
  NABO.angre = naboInnst().rett;
  settRett(endre);
  tegnNabo();
  const hoppet = rader.length - endre.length;
  toast(T(`${endre.length} tagger fra forslag${hoppet ? `, ${hoppet} hoppet over fordi taggen finnes` : ''}. Ctrl+Z angrer.`,
          `${endre.length} tags from suggestions${hoppet ? `, ${hoppet} skipped because the tag exists` : ''}. Ctrl+Z undoes it.`));
  if (typeof brorKlasse === 'function') { brorKlasse('taster', 1200); brorKlasse('fort', 1200); }
}

document.addEventListener('click', (e) => {
  const en = e.target.closest('.nabo-fs [data-bruk]');
  if (en) {
    e.preventDefault(); e.stopPropagation();
    const x = naboResultat().rader.find(r => r.key === en.dataset.bruk);
    if (x && x.forslag) brukForslag([x]);
    return;
  }
  const alle = e.target.closest('#naboFsBar [data-alle]');
  if (alle) {
    const rader = naboResultat().rader.filter(x => x.forslag && (alle.dataset.alle === 'alle' || x.forslag.sikker));
    brukForslag(rader);
  }
}, true);

/* The bar above the table in the Suggestions view. */
function tegnForslagBar(r) {
  hentFasit();
  let bar = $('naboFsBar');
  const like = $('naboLike');
  if (!bar && like) { bar = document.createElement('div'); bar.id = 'naboFsBar'; bar.className = 'nabo-like nabo-fs-bar'; like.before(bar); }
  if (!bar) return;
  if (NABO.filter !== 'forslag' || NABO.visning !== 'var') { bar.hidden = true; return; }
  const med = r.rader.filter(x => x.forslag);
  const sikre = med.filter(x => x.forslag.sikker).length;
  bar.hidden = false;
  bar.innerHTML = !FASIT.klar
    ? `<span class="like-tekst">${T('Leser BTG-eksportene…', 'Reading the BTG exports…')}</span>`
    : !FASIT.liste.length
      ? `<span class="like-tekst">${T('Fant ingen Variabel-filer i BTG-Export eller Nedlastinger å lære av.', 'Found no Variabel files in BTG-Export or Downloads to learn from.')}</span>`
      : `<span class="like-tekst">${T(`${med.length} forslag fra beskrivelsen, lært av ${FASIT.liste.length} tagger i ${FASIT.filer} BTG-eksporter.`,
                                      `${med.length} suggestions from the description, learnt from ${FASIT.liste.length} tags in ${FASIT.filer} BTG exports.`)}</span>
         <span class="like-eks">${T('Grønn = sikker, gul = mulig. Klikk et forslag for å bruke det.', 'Green = sure, yellow = possible. Click a suggestion to use it.')}</span>
         ${sikre ? `<button type="button" class="btn primary" data-alle="sikre">${T(`Bruk alle sikre (${sikre})`, `Use every sure one (${sikre})`)}</button>` : ''}
         ${med.length ? `<button type="button" class="btn" data-alle="alle">${T(`Bruk alle (${med.length})`, `Use all (${med.length})`)}</button>` : ''}`;
}

(function kobl() {
  const _apne = aapneNabo;
  aapneNabo = function () { const r = _apne.apply(this, arguments); hentFasit(); return r; };
})();
