/* NABE - field safety and the small things that save time
   Loaded after app.js and shares its globals (S, $, api, toast, nabeSier ...). */
'use strict';

/* ---------------------------------------------------------- my overrides
   What this NABE has written and not released, from the server's write log.
   Kept fresh so the priority list can say who holds a slot, and so closing
   the tool can say what is still commanded. */
let MINE = new Map();          // "ip|objid|pri" -> {value, ts}

async function hentMine() {
  try {
    const d = await (await fetch('/api/mine', {cache: 'no-store'})).json();
    MINE = new Map((d.overstyrt || []).map(o => [`${o.address}|${o.objid}|${o.priority}`, o]));
  } catch {}
  return MINE;
}
hentMine();
setInterval(hentMine, 30000);
// After any write or release, the list changes.
document.addEventListener('click', (e) => {
  if (e.target.closest?.('#wSend, #selRel, .rel-btn, [data-rel]')) setTimeout(hentMine, 1500);
}, true);

function minHolder(ip, objid, pri) {
  return MINE.get(`${ip}|${objid}|${pri}`) || null;
}

/* The plug that will not come out. Called by the app window when it is being
   closed with points still commanded; the browser version gets the browser's
   own "leave this page?" question. */
async function visLukkVakt() {
  await hentMine();
  const liste = [...MINE.values()];
  // Only what can be reached can be released. A point on a network you have
  // left waits for the next visit - NABE says so on start when it is in
  // reach again - so it does not stop you at the door.
  const kan = liste.filter(o => o.naabar !== false);
  if (!kan.length) { window.pywebview?.api?.lukk(); return; }
  document.getElementById('lukkvakt')?.remove();
  const lag = document.createElement('div');
  lag.id = 'lukkvakt';
  lag.className = 'lv-lag';
  lag.setAttribute('role', 'alertdialog');
  lag.setAttribute('aria-modal', 'true');
  const lokal = SPRAAK === 'en' ? 'en-GB' : 'nb-NO';
  // The point and the controller by name where they are known, the ids as
  // the small print - the list is read in a hurry, on the way out.
  const navn = (o) => ((S.cache[o.address] || []).find(p => p.objid === o.objid) || {}).name || o.objid;
  const enhet = (o) => (S.devices.find(d => d.address === o.address) || {}).object_name || o.address;
  const nokkel = (o) => `${o.address}|${o.objid}|${o.priority}`;
  const rad = (o) => `
      <div class="lv-rad${o.naabar === false ? ' utenfor' : ''}" data-k="${esc(nokkel(o))}">
        <span class="lv-pkt">${esc(navn(o))}<small>${esc(enhet(o))} · ${esc(o.objid)}${o.naabar === false ? ` · <b>${T('ikke innen rekkevidde nå', 'not in reach now')}</b>` : ''}</small></span>
        <span class="lv-pri">pri ${esc(String(o.priority))}</span>
        <span class="lv-ver">${esc(String(o.value))}</span>
        <span class="lv-tid">${o.ts ? esc(new Date(o.ts * 1000).toLocaleString(lokal, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})) : ''}</span>
        <button type="button" class="lv-glem" data-glem="${esc(nokkel(o))}" title="${esc(T('Ta av lista uten å skrive noe - for et punkt som er frigitt på annen måte', 'Take it off the list without writing anything - for a point released some other way'))}">${T('Glem', 'Forget')}</button>
      </div>`;
  const tegn = () => {
    const alle = [...MINE.values()], naa = alle.filter(o => o.naabar !== false);
    lag.innerHTML = `<div class="lv-kort">
    <div class="lv-hode">
      <div class="lv-fig">${NABE_SVG.replace('width="26" height="26"', 'width="44" height="44"')}</div>
      <div>
        <h2 class="lv-tittel">${T('Pluggen sitter fast', 'The plug is stuck')}</h2>
        <p class="lv-tekst">${T(
          `${naa.length} ${naa.length === 1 ? 'punkt står' : 'punkter står'} fortsatt overstyrt av deg. Det er sånn anlegg blir stående i manuell.`,
          `${naa.length} ${naa.length === 1 ? 'point is' : 'points are'} still overridden by you. That is how plants get left in manual.`)}</p>
      </div>
    </div>
    <div class="lv-liste">${naa.map(rad).join('')}${alle.length > naa.length ? `
      <div class="lv-under">${T('Utenfor rekkevidde nå - NABE minner deg på dem neste gang du er der', 'Out of reach now - NABE reminds you of them next time you are there')}</div>
      ${alle.filter(o => o.naabar === false).map(rad).join('')}` : ''}</div>
    <div class="lv-knapper">
      <button class="btn" id="lvAvbryt">${T('Avbryt', 'Cancel')}</button>
      <span class="lv-rom"></span>
      <button class="btn" id="lvLukk">${T('Lukk likevel', 'Close anyway')}</button>
      <button class="btn primary" id="lvFrigi">${naa.length === alle.length ? T('Frigi alle og lukk', 'Release all and close') : T(`Frigi ${naa.length} og lukk`, `Release ${naa.length} and close`)}</button>
    </div></div>`;
    kobl();
  };
  const lukkLag = () => { lag.remove(); document.removeEventListener('keydown', esc_, true); };
  const esc_ = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); lukkLag(); } };
  const kobl = () => {
    lag.querySelector('#lvAvbryt').onclick = lukkLag;
    lag.querySelector('#lvLukk').onclick = () => {
      nabeSier(T('Greit. Jeg sa ingenting.', 'Fine. I said nothing.'), 'trist');
      setTimeout(() => window.pywebview?.api?.lukk(), 900);
    };
    lag.querySelectorAll('[data-glem]').forEach(b => b.onclick = async () => {
      const o = MINE.get(b.dataset.glem);
      if (!o) return;
      await api('/api/mine/glem', {address: o.address, objid: o.objid, priority: o.priority});
      await hentMine();
      if (![...MINE.values()].some(x => x.naabar !== false)) { lukkLag(); window.pywebview?.api?.lukk(); return; }
      tegn();
    });
    lag.querySelector('#lvFrigi').onclick = async () => {
      lag.querySelector('#lvFrigi').disabled = true;
      const naa = [...MINE.values()].filter(o => o.naabar !== false);
      let ok = 0;
      for (const o of naa) {
        try {
          const r = await api('/api/write', {address: o.address, objid: o.objid, priority: o.priority, release: true});
          if (r.status === 'done') ok++;
        } catch {}
      }
      toast(T(`${ok} av ${naa.length} frigitt`, `${ok} of ${naa.length} released`), ok < naa.length);
      if (ok === naa.length) setTimeout(() => window.pywebview?.api?.lukk(), 700);
      else { await hentMine(); tegn(); }
    };
  };
  tegn();
  document.body.appendChild(lag);
  nabeKlasse('nervos', 4000);
  setTimeout(() => $('lvFrigi')?.focus(), 30);
  document.addEventListener('keydown', esc_, true);
  lag.addEventListener('click', (e) => { if (e.target === lag) lukkLag(); });
}
window.addEventListener('beforeunload', (e) => {
  if (!window.pywebview && MINE.size) { e.preventDefault(); e.returnValue = ''; }
});

/* --------------------------------------------------------- a newer NABE */
setTimeout(async () => {
  try {
    const d = await (await fetch('/api/ny-versjon')).json();
    const nyere = (a, b) => {
      const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
      }
      return false;
    };
    if (d.github && nyere(d.github, d.her))
      nabeSier(T(`Det finnes en nyere NABE (${d.github}). Jeg er ${d.her}. Det svir litt.`,
                 `There is a newer NABE (${d.github}). I am ${d.her}. It stings a little.`), 'trist', 'ny-versjon');
  } catch {}
}, 8000);

/* ----------------------------------------------- grouping, odd values */
// "360.003-RT401" and "360_003_RT401" both live in system 360.003.
function systemAv(p) {
  // Three digits, a separator, three digits, and no digits either side -
  // so 360.003 and 360_003 count, and 563100 inside a longer number does not.
  const m = /(?:^|\D)(\d{3})[._\-](\d{3})(?!\d)/.exec(p.name || '');
  return m ? `${m[1]}.${m[2]}` : '';
}
function grupperEtterSystem(rader) {
  // Stable: within a system the user's own sort order is kept.
  return rader.map((p, i) => [systemAv(p) || '~', i, p])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]))
    .map(x => x[2]);
}
/* Values that are possible but rarely right. Marked, never hidden. */
function rarVerdi(p) {
  const v = p.value;
  if (typeof v !== 'number' || p.unread) return false;
  const u = String(p.units || '');
  if (u === 'percent') return v < -1 || v > 101;
  if (u === 'degrees-celsius') return v < -50 || v > 150;
  if (/per-second|per-hour|per-minute/.test(u)) return v < -0.5;
  return false;
}

/* Flat line: an analog input that has not moved for a chosen time. A live
   sensor jitters a little; one that stands perfectly still has often lost its
   wire or been left on a fixed value. Marked like rarVerdi, never hidden.

   Only the open device is followed, and only while it is being read: a gap in
   the reading restarts the watch, so "unchanged" always means someone was
   looking the whole time. A point that arrives by COV is left out, because
   COV only speaks when the value passes its increment and silence is normal. */
const FLAT_VALG = [0, 15, 30, 60, 120];          // minutes, 0 = off
let FLAT_TICK = 0;
function flatMin() {
  const v = loadPrefs().flatMin;
  return FLAT_VALG.includes(v) ? v : 30;
}
function flatVerdi(p, nu = Date.now(), vinduMs = flatMin() * 60000) {
  if (!vinduMs || !p || p.type !== 'analog-input' || typeof p.value !== 'number' || p.unread) return false;
  if (p._flatCov || !p._flatSett || nu - p._flatSist > 60000) return false;
  if (typeof hasFlag === 'function' && hasFlag(p, 'out-of-service')) return false;
  const u = String(p.units || '');
  if (!u || u === 'no-units') return false;
  // A fan that is off, a closed damper, no flow: zero is a true reading.
  if (p.value === 0 && /^(percent|pascals|kilopascals|hectopascals|bars|millibars)$|per-(second|hour|minute)/.test(u)) return false;
  return nu - p._flatSett >= vinduMs && nu - p._flatEndret >= vinduMs;
}
function flatTittel(p, nu = Date.now()) {
  const m = Math.max(1, Math.round((nu - p._flatEndret) / 60000));
  return T(`Uendret i ${m} min. En levende føler flytter seg som regel litt.`,
           `Unchanged for ${m} min. A live sensor usually moves a little.`);
}
function flatTekst() {
  const m = flatMin();
  return !m ? T('av', 'off') : m < 60 ? `${m} min` : T(`${m / 60} t`, `${m / 60} h`);
}
function syncFlat() {
  $('flatBtn')?.classList.toggle('on', flatMin() > 0);
  const s = $('flatState');
  if (s) s.textContent = flatTekst();
}
/* Watches what each poll brings, before the table takes the new value in. */
etter('api', (d, sti) => {
  if (sti !== '/api/poll' || !d || d.status !== 'done' || !S.activeDev) return;
  const ip = S.activeDev.address, vals = d.values && d.values[ip];
  if (!vals) return;
  const nu = Date.now();
  const hull = Math.max(60000, 4 * (parseInt($('pollInt')?.value, 10) || 5000));
  const cov = new Set((d.cov_ok && d.cov_ok[ip]) || []);
  for (const [objid, val] of Object.entries(vals)) {
    const p = S.pointIndex.get(objid);
    if (!p || p.type !== 'analog-input') continue;
    p._flatCov = cov.has(objid);
    if (!p._flatSett || nu - p._flatSist > hull) p._flatSett = p._flatEndret = nu;
    else if (val !== p.value) p._flatEndret = nu;
    p._flatSist = nu;
  }
});
/* The marks follow the polls, at most every other second. */
function merkFlat(tving) {
  const nu = Date.now();
  if (!S.rowIndex || (!tving && nu - FLAT_TICK < 2000)) return;
  FLAT_TICK = nu;
  for (const [objid, tr] of S.rowIndex) {
    const p = S.pointIndex.get(objid);
    const td = tr._valCell || (tr._valCell = tr.querySelector('td.c-val'));
    if (!p || !td) continue;
    const flat = flatVerdi(p, nu);
    if (flat === td.classList.contains('flat')) continue;
    td.classList.toggle('flat', flat);
    if (flat) td.title = flatTittel(p, nu); else td.removeAttribute('title');
  }
}
etter('pollTick', () => merkFlat());
etter('syncMenuStates', syncFlat);
if ($('flatBtn')) {
  $('flatBtn').onclick = () => {
    const neste = FLAT_VALG[(FLAT_VALG.indexOf(flatMin()) + 1) % FLAT_VALG.length];
    savePrefs({flatMin: neste});
    syncFlat(); merkFlat(true);
    toast(neste ? T(`Flat linje etter ${flatTekst()}`, `Flatline after ${flatTekst()}`)
                : T('Flat linje av', 'Flatline off'));
  };
  syncFlat();
}

/* ------------------------------------------------------- recent points */
const SISTE_NOKKEL = 'nabe_siste_punkter';
function sistePunkter() {
  try { return JSON.parse(localStorage.getItem(SISTE_NOKKEL)) || []; } catch { return []; }
}
let SIST_REGISTRERT = '';
setInterval(() => {
  const d = S.activeDev, o = S.selected;
  if (!d || !o) return;
  const k = d.address + '|' + o;
  if (k === SIST_REGISTRERT) return;
  SIST_REGISTRERT = k;
  const p = S.pointIndex && S.pointIndex.get(o);
  const liste = sistePunkter().filter(x => !(x.ip === d.address && x.objid === o));
  liste.unshift({ip: d.address, objid: o, navn: (p && (p.name || p.description)) || o,
                 enhet: d.object_name || String(d.device_instance)});
  try { localStorage.setItem(SISTE_NOKKEL, JSON.stringify(liste.slice(0, 10))); } catch {}
}, 1000);

function visSistePunkter() {
  document.getElementById('sisteLag')?.remove();
  const liste = sistePunkter();
  const lag = document.createElement('div');
  lag.id = 'sisteLag';
  lag.className = 'startskjerm';
  lag.innerHTML = `<div class="ss-kort enkel liste" style="text-align:left">
    <div class="ss-tittel">${T('Siste punkter', 'Recent points')} <kbd style="margin-left:6px">Ctrl E</kbd></div>
    <div class="ss-liste">${liste.length ? liste.map((x, i) => `
      <button class="ss-rad" data-i="${i}"><span class="ss-rad-navn">${esc(x.navn)}</span>
      <span class="ss-rad-meta">${esc(x.enhet)} · ${esc(x.objid)}</span></button>`).join('')
      : `<div class="alarm-tom">${T('Ingen ennå. Klikk på noen punkter først.', 'None yet. Click a few points first.')}</div>`}</div></div>`;
  document.body.appendChild(lag);
  const lukk = () => lag.remove();
  lag.addEventListener('click', e => { if (e.target === lag) lukk(); });
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { lukk(); document.removeEventListener('keydown', esc_); } });
  lag.querySelectorAll('.ss-rad').forEach(b => b.onclick = async () => {
    const x = liste[Number(b.dataset.i)];
    lukk();
    if (!S.activeDev || S.activeDev.address !== x.ip) {
      document.querySelector(`#devList .dev[data-ip="${CSS.escape(x.ip)}"]`)?.click();
      for (let i = 0; i < 80 && !(S.pointIndex && S.pointIndex.get(x.objid)); i++)
        await new Promise(r => setTimeout(r, 150));
    }
    if (typeof selectPoint === 'function') selectPoint(x.objid);
    document.querySelector(`#pointsWrap tr[data-o="${CSS.escape(x.objid)}"]`)?.scrollIntoView({block: 'center'});
  });
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); visSistePunkter(); }
});

/* ------------------------------------------------- what NABE knows about */
const LEVERANDOR_TIPS = [
  [/wago/i, 'WAGO. Sjekk klokka, de glemmer den.', 'WAGO. Check the clock, they forget it.'],
  [/regin|corrigo/i, 'Regin. Alarmklassen står ofte i beskrivelsen.', 'Regin. The alarm class is often in the description.'],
  [/distech/i, 'Distech. Mange punkter, få beskrivelser. Lykke til.', 'Distech. Many points, few descriptions. Good luck.'],
  [/johnson|jci|metasys/i, 'JCI. «I alarm» betyr ofte bare overstyrt. Se på flaggene.', 'JCI. "In alarm" often just means overridden. Read the flags.'],
  [/siemens/i, 'Siemens. Prioritetene er der de skal være. Stort sett.', 'Siemens. The priorities are where they should be. Mostly.'],
  [/beckhoff/i, 'Beckhoff. Noen har skrevet strukturert tekst her. Vær snill.', 'Beckhoff. Someone wrote structured text here. Be kind.'],
  [/tridium|niagara/i, 'En JACE. Den vet mer om anlegget enn noen andre her.', 'A JACE. It knows more about this plant than anyone here.'],
  [/exor/i, 'Exor. Et panel som tror det er en regulator.', 'Exor. A panel that thinks it is a controller.'],
];
const LEV_SAGT = new Set();
setInterval(() => {
  const d = S.activeDev;
  if (!d || !S.points.length) return;
  const navn = d.vendor_name || '';
  for (const [re, nb, en] of LEVERANDOR_TIPS) {
    if (re.test(navn) && !LEV_SAGT.has(re.source)) {
      LEV_SAGT.add(re.source);
      nabeSier(T(nb, en), null, 'lev:' + re.source);
      return;
    }
  }
}, 4000);

/* The System button above the table. Remembered between visits. */
(function systemKnapp() {
  const b = $('sysBtn');
  if (!b) return;
  S.grupperSystem = !!loadPrefs().grupperSystem;
  b.classList.toggle('on', S.grupperSystem);
  b.onclick = () => {
    S.grupperSystem = !S.grupperSystem;
    savePrefs({grupperSystem: S.grupperSystem});
    b.classList.toggle('on', S.grupperSystem);
    if (S.activeDev) renderPoints();
  };
})();
