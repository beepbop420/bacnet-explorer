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
  if (!liste.length) { window.pywebview?.api?.lukk(); return; }
  document.getElementById('lukkvakt')?.remove();
  const lag = document.createElement('div');
  lag.id = 'lukkvakt';
  lag.className = 'startskjerm';
  lag.innerHTML = `<div class="ss-kort" style="text-align:left">
    <h2 style="margin:0 0 4px;font-size:18px">${T('Pluggen sitter fast', 'The plug is stuck')}</h2>
    <p style="margin:0 0 12px;color:var(--fg-2)">${T(
      `${liste.length} ${liste.length === 1 ? 'punkt står' : 'punkter står'} fortsatt overstyrt av deg. Det er sånn anlegg blir stående i manuell.`,
      `${liste.length} ${liste.length === 1 ? 'point is' : 'points are'} still overridden by you. That is how plants get left in manual.`)}</p>
    <div class="ss-liste" style="max-height:220px;overflow:auto">${liste.map(o => `
      <div class="ss-rad" style="cursor:default"><span class="ss-rad-navn">${esc(o.address)} ${esc(o.objid)}</span>
      <span class="ss-rad-meta">P${o.priority} = ${esc(String(o.value))}</span></div>`).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn" id="lvAvbryt">${T('Avbryt', 'Cancel')}</button>
      <button class="btn" id="lvLukk">${T('Lukk likevel', 'Close anyway')}</button>
      <button class="btn primary" id="lvFrigi">${T('Frigi alle og lukk', 'Release all and close')}</button>
    </div></div>`;
  document.body.appendChild(lag);
  nabeKlasse('nervos', 4000);
  $('lvAvbryt').onclick = () => lag.remove();
  $('lvLukk').onclick = () => {
    nabeSier(T('Greit. Jeg sa ingenting.', 'Fine. I said nothing.'), 'trist');
    setTimeout(() => window.pywebview?.api?.lukk(), 900);
  };
  $('lvFrigi').onclick = async () => {
    $('lvFrigi').disabled = true;
    let ok = 0;
    for (const o of liste) {
      try {
        const r = await api('/api/write', {address: o.address, objid: o.objid, priority: o.priority, release: true});
        if (r.status === 'done') ok++;
      } catch {}
    }
    toast(T(`${ok} av ${liste.length} frigitt`, `${ok} of ${liste.length} released`), ok < liste.length);
    if (ok === liste.length) setTimeout(() => window.pywebview?.api?.lukk(), 700);
    else { await hentMine(); $('lvFrigi').disabled = false; }
  };
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
  lag.innerHTML = `<div class="ss-kort" style="text-align:left">
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
