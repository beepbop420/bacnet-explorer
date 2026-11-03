/* NABE - the plant as a whole, and the first ten seconds.

   Two things that make the app worth opening on every visit.

   On start, NABE looks for itself. A cable into a plant is a network that
   is neither the one with internet, Wi-Fi nor a tunnel; if there is one,
   it is scanned at once. Without a cable, a site remembered from the last
   fortnight that can be reached right now is scanned instead - but only
   when there is exactly one, since two is a choice and that is yours.

   Above the device list, one line for the whole plant: how many points are
   overridden, in alarm, faulty or out of service across every controller
   read so far. It says "so far" until every controller has been read, and
   it says "nothing flagged" only when every point's status was actually
   read - the same rule as for one controller. The counts open into the
   points behind them; the line copies as text for the service report; and
   the next visit is compared with this one.
   Loaded after nabe-skann.js and shares its globals. */
'use strict';

const AN = {sokt: false, apen: '', forrige: null, sammenlignet: ''};
const AN_REKKE = ['in-alarm', 'fault', 'overridden', 'out-of-service'];

/* ---------------------------------------------------- looking on start */
async function sokVedStart() {
  if (AN.sokt || loadPrefs().autoSok === false) return;
  // Wait for the adapter and the site list, a few seconds at most.
  for (let i = 0; i < 40 && !(S.connected && SK.lastet); i++) await new Promise(r => setTimeout(r, 250));
  const ri = $('rangeInput');
  // The field comes back with last time's range; only a change is yours.
  const fraSist = ri.value.trim();
  const opptatt = () => S.devices.length || ri.value.trim() !== fraSist || S.scanJob
    || document.body.classList.contains('skanner') || document.activeElement === ri;
  if (!S.connected || opptatt()) return;
  AN.sokt = true;
  let nett = [];
  try { nett = (await (await fetch('/api/kabelnett', {cache: 'no-store'})).json()).nett || []; } catch {}
  if (opptatt() || !startskjermViker(nett[0]?.cidr)) return;
  if (nett.length) {
    if ($('modeSel').value === 'bbmd') { $('modeSel').value = 'auto'; $('modeSel').dispatchEvent(new Event('change')); }
    brukOmrade(nett.map(n => n.cidr).join(', '));
    nabeSier(T(`Kabel i ${nett[0].cidr}. Ser hvem som er der.`, `A cable in ${nett[0].cidr}. Seeing who is there.`), 'fornoyd', 'kabel-start');
    AN.autoSkann = true;
    runScan();
    return;
  }
  // The newest site with controllers in it. An empty scan is not a site, and
  // on a real PC two or three are always in reach (the office network too),
  // so the last one you worked on wins, as on the start card.
  const a = sistNaabar();
  if (a) {
    const i = SK.rader.findIndex(r => r.a?.key === a.key);
    nabeSier(T(`${visNavn(a)} er nåbar. Fortsetter der.`, `${visNavn(a)} is in reach. Carrying on there.`), 'fornoyd', 'start-naabar');
    AN.autoSkann = true;
    bruk(i >= 0 ? SK.rader[i] : {type: 'anlegg', a}, {skann: true});
  }
}
setTimeout(sokVedStart, 1400);

/* «Just open it» means just that: a scan the search on start began is
   stopped, and the field keeps the site so Enter starts it again. */
function stoppAutoSkann() {
  if (!AN.autoSkann) return;
  AN.autoSkann = false;
  if (S.scanJob && document.body.classList.contains('skanner')) {
    cancelScan();
    nabeSier(T('Stoppet søket. Enter i feltet skanner når du vil.', 'Stopped the search. Enter in the field scans when you like.'), null, 'auto-stopp');
  }
}

// What a site is called on screen: its name, else its controllers' names.
function visNavn(a) {
  if (!a) return '';
  const m = typeof MINNE !== 'undefined' ? MINNE[a.key] : null;
  return a.navn || (m && typeof enhetsnavn === 'function' && enhetsnavn(m)) || a.key;
}

function sistNaabar() {
  const naa = Date.now() / 1000;
  return SK.anlegg.filter(a => a.naabar && a.enheter > 0 && a.sist && naa - a.sist < 14 * 86400)
    .sort((x, y) => y.sist - x.sist)[0] || null;
}

/* The start card stays: it is where you start, and the search on start
   only gets a head start behind it. The card says what is being scanned -
   on the site's own row when it is one, as a line under the greeting when
   it is a cable - and choosing that row then just goes in. Typing in the
   card's field first means you want something else, so nothing starts. */
function startskjermViker(cidr) {
  const lag = $('startskjerm');
  if (!lag) return true;
  if ($('ssOmr')?.value.trim()) return false;
  const a = cidr ? null : sistNaabar();
  window.SS_AUTO = a ? a.key : '';
  if (typeof merkAutoRad === 'function') merkAutoRad();
  if (cidr) {
    const linje = document.createElement('div');
    linje.className = 'ss-auto';
    linje.textContent = T(`Skanner kabelen i ${cidr} i bakgrunnen.`, `Scanning the cable in ${cidr} in the background.`);
    lag.querySelector('.ss-hilsen')?.after(linje);
  }
  return true;
}

/* ------------------------------------------------- the plant in one line */
function asNokkel() {
  return (S.scanRanges || []).map(r => r.trim()).filter(Boolean).sort().join(' ');
}
function asNavn() {
  const k = asNokkel();
  const a = SK.anlegg.find(x => x.key === k);
  const n = (a && a.navn) || (typeof MINNE !== 'undefined' && MINNE[k] && MINNE[k].navn) || '';
  if (/\p{L}/u.test(n)) return n;
  // No name given: the controllers' own, as on the start card.
  const e = typeof enhetsnavn === 'function' ? enhetsnavn({enheter: S.devices}) : '';
  return e ? `${e} (${k})` : (k || T('Anlegget', 'The plant'));
}

function anleggTall() {
  const ut = {total: S.devices.length, lest: 0, feilet: 0, alleStatus: true, punkter: 0, flagg: {}};
  for (const f of AN_REKKE) ut.flagg[f] = [];
  for (const d of S.devices) {
    const pts = S.cache[d.address];
    if (!pts) { if (PRE.failed.has(d.address)) ut.feilet++; continue; }
    ut.lest++;
    ut.punkter += pts.length;
    for (const p of pts) {
      if (p.status_lest !== true) ut.alleStatus = false;
      for (const f of p.status || []) if (ut.flagg[f]) ut.flagg[f].push({d, p});
    }
  }
  ut.ferdig = ut.total > 0 && ut.lest + ut.feilet >= ut.total && !PRE.jobs.size;
  return ut;
}

const anFlaggNavn = (f, n) => T(
  {'in-alarm': 'i alarm', 'fault': 'med feil', 'overridden': 'overstyrt', 'out-of-service': 'ute av drift'}[f],
  {'in-alarm': 'in alarm', 'fault': 'faulty', 'overridden': 'overridden', 'out-of-service': 'out of service'}[f]);

function anVerdi(p) {
  const v = fmtVal(p.value).t;
  return p.unit && v !== '—' ? `${v} ${p.unit}` : v;
}

function tegnAnlegg() {
  let el = $('anleggStatus');
  if (!el) {
    const warn = $('dupWarn');
    if (!warn) return;
    el = document.createElement('div');
    el.id = 'anleggStatus';
    el.className = 'as-status';
    el.setAttribute('aria-live', 'polite');
    warn.before(el);
    el.addEventListener('click', anKlikk);
  }
  const t = anleggTall();
  if (!t.total || !t.lest) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const tall = AN_REKKE.filter(f => t.flagg[f].length);
  const alvor = f => (f === 'in-alarm' || f === 'fault') ? 'bad' : 'warn';
  const fram = t.ferdig
    ? (t.feilet ? T(`${t.lest} av ${t.total} lest · ${t.feilet} svarte ikke`, `${t.lest} of ${t.total} read · ${t.feilet} did not answer`)
                : t.total === 1 ? T('lest', 'read') : T(`alle ${t.total} lest`, `all ${t.total} read`))
    : T(`så langt · ${t.lest} av ${t.total} lest`, `so far · ${t.lest} of ${t.total} read`);
  let hoved;
  if (tall.length) {
    hoved = tall.map(f => `<button type="button" class="as-tall ${alvor(f)}${AN.apen === f ? ' apen' : ''}" data-f="${f}"
        aria-expanded="${AN.apen === f}"><b>${t.flagg[f].length}</b> ${anFlaggNavn(f)}</button>`).join('');
  } else if (t.ferdig && t.alleStatus && !t.feilet) {
    hoved = `<span class="as-rolig">${T('Ingen flagg på noen punkter', 'Nothing flagged on any point')}</span>`;
  } else {
    hoved = `<span class="as-tom">${T('Ingen flagg funnet', 'Nothing flagged found')}</span>`;
  }
  if (t.ferdig) anSammenlign(t);
  const sist = AN.forrige && AN.forrige.key === asNokkel() ? anSistTekst(AN.forrige) : '';
  let liste = '';
  if (AN.apen && t.flagg[AN.apen]?.length) {
    const grupper = anGrupper(t.flagg[AN.apen]);
    const rad = ({d, p}) => `<button type="button" class="as-rad" data-ip="${esc(d.address)}" data-obj="${esc(p.objid)}" title="${esc(p.name || p.objid)}">
         <span class="as-pkt">${esc(anKort(d, p))}</span>
         <span class="as-ver">${esc(anVerdi(p))}</span>
       </button>`;
    liste = `<div class="as-liste">${grupper.map(g => {
      const vis = g.enkle.length <= 8 ? g.enkle.length : (grupper.length === 1 ? 10 : 4);
      const skjult = g.rader.length - vis;
      return `<div class="as-gruppe">
        <button type="button" class="as-ghode" data-apne="${esc(g.d.address)}" title="${T('Åpne regulatoren med disse punktene', 'Open the controller with these points')}">
          <span>${esc(g.d.object_name || g.d.address)}</span><b>${g.rader.length}</b></button>
        ${g.klynger.map(k => `<button type="button" class="as-felles" data-apne="${esc(g.d.address)}" data-q="${esc(k.vis)}" title="${T('Åpne regulatoren med bare disse punktene', 'Open the controller with only these points')}"><b>${k.alle ? T('alle', 'all') : k.n}</b> ${T('under', 'under')} ${esc(k.vis)}</button>`).join('')}
        ${g.klynger.length ? `<div class="as-aarsak">${g.klynger.length === 1
            ? T('Trolig én felles årsak, som en forbindelse som er nede.', 'Probably one cause, like a link that is down.')
            : T('Trolig én årsak for hver del, som forbindelser som er nede.', 'Probably one cause for each part, like links that are down.')}</div>` : ''}
        ${g.enkle.slice(0, vis).map(rad).join('')}
        ${skjult > 0 ? `<button type="button" class="as-mer" data-apne="${esc(g.d.address)}">${g.klynger.length && !vis
            ? T(`åpne alle ${g.rader.length}`, `open all ${g.rader.length}`)
            : T(`og ${skjult} til · åpne`, `and ${skjult} more · open`)}</button>` : ''}
      </div>`;
    }).join('')}</div>`;
  }
  const html = `<div class="as-linje">
      <span class="as-tittel">${T('Anlegget', 'The plant')}</span>
      <span class="as-tallene">${hoved}</span>
    </div>
    <div class="as-linje2">
      <span class="as-fram">${fram}${sist ? ` · <span class="as-sist">${sist}</span>` : ''}</span>
      <button type="button" class="as-kopier" data-kopier title="${T('Kopier status som tekst, til servicerapporten', 'Copy the status as text, for the service report')}">${T('Kopier', 'Copy')}</button>
    </div>${liste}`;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.toggle('bad', tall.some(f => alvor(f) === 'bad'));
  el.classList.toggle('warn', tall.length > 0 && !tall.some(f => alvor(f) === 'bad'));
}

async function anKlikk(e) {
  const b = e.target.closest('[data-f]');
  if (b) { AN.apen = AN.apen === b.dataset.f ? '' : b.dataset.f; tegnAnlegg(); return; }
  if (e.target.closest('[data-kopier]')) { anKopier(e.target.closest('[data-kopier]')); return; }
  const apne = e.target.closest('[data-apne]');
  if (apne) {
    const f = AN.apen;
    await selectDevice(apne.dataset.apne);
    if (S.activeDev?.address !== apne.dataset.apne) return;
    settFlaggfilter(f);
    S.filters.q = apne.dataset.q || ''; $('q').value = S.filters.q;
    renderPoints();
    return;
  }
  const r = e.target.closest('.as-rad');
  if (r) {
    const f = AN.apen;
    await selectDevice(r.dataset.ip);
    if (S.activeDev?.address !== r.dataset.ip) return;
    settFlaggfilter(f);
    S.filters.q = ''; $('q').value = '';
    renderPoints();
    selectPoint(r.dataset.obj);
  }
}


/* The flagged points of one kind, per controller, most first.

   A JACE with 600 faulty points rarely has 600 faults. Its points are
   grouped by where they come from - BACnet IP.564001-OU001, BACnet
   IP.360003 - and when nearly everything under one such part is flagged,
   that part is named once instead: it is one link down, one unit gone.
   Measured on a real site: 607 faults on 564001-OS001 were 527 under the
   integration to OU001 (which itself answered with none) and the rest
   under the one to 360003. Only what is left over is listed one by one. */
function anGrupper(rader) {
  const per = new Map();
  for (const x of rader) {
    if (!per.has(x.d.address)) per.set(x.d.address, {d: x.d, rader: []});
    per.get(x.d.address).rader.push(x);
  }
  const grupper = [...per.values()].sort((a, b) => b.rader.length - a.rader.length);
  for (const g of grupper) {
    g.klynger = g.rader.length >= 8 ? anKlynger(g) : [];
    g.enkle = g.rader.filter(x => !g.klynger.some(k => (x.p.name || '').startsWith(k.pre)));
  }
  return grupper;
}

function anKlynger(g) {
  const pts = S.cache[g.d.address] || [];
  const deler = s => s.split(/(?<=[./])/);
  const forelder = pre => deler(pre).slice(0, -1).join('');
  const felles = typeof commonNamePrefix === 'function' ? commonNamePrefix(pts) || '' : '';
  const tellF = new Map(), tellA = new Map();
  const legg = (m, n) => {
    const d = deler(n);
    let pre = '';
    for (let k = 0; k < d.length - 1 && k < 8; k++) { pre += d[k]; m.set(pre, (m.get(pre) || 0) + 1); }
  };
  for (const x of g.rader) legg(tellF, x.p.name || '');
  for (const p of pts) legg(tellA, p.name || '');
  // A part counts when it holds at least eight of the flags, nearly
  // everything under it is flagged, and it is not the controller itself.
  const del = pre => pre.length > felles.length && (tellF.get(pre) || 0) >= 8
    && tellF.get(pre) / (tellA.get(pre) || 1) >= 0.8 && (tellA.get(pre) || 0) < pts.length * 0.98;
  const dybde = pre => deler(pre).length;
  const barn = pre => [...tellF.keys()].filter(k => k !== pre && k.startsWith(pre) && dybde(k) === dybde(pre) + 1);
  // Down to the parts that say most: BACnet IP is split into the units
  // under it when they carry nearly all of its flags between them. Only
  // into units - names with a number, 564001-OU001 or 360003 - not into
  // the folders inside one (Plan 2, Energimålere): a unit that is gone
  // takes all its folders with it, and that is one cause, not three.
  const enhet = pre => /\d{3}/.test(deler(pre).pop() || '');
  const ned = pre => {
    const b = barn(pre).filter(k => del(k) && enhet(k));
    const sum = b.reduce((n, k) => n + tellF.get(k), 0);
    return b.length && sum >= 0.9 * tellF.get(pre) ? b.flatMap(ned) : [pre];
  };
  const topp = [...tellF.keys()].filter(k => del(k) && !del(forelder(k)));
  const valgt = [...new Set(topp.flatMap(ned))].sort((a, b) => tellF.get(b) - tellF.get(a)).slice(0, 4);
  return valgt.map(pre => ({
    pre, n: tellF.get(pre), alle: tellF.get(pre) === g.rader.length,
    vis: (pre.startsWith(felles) ? pre.slice(felles.length) : pre).replace(/[./]$/, '') || pre,
  }));
}

// A point's name without what every point on its controller starts with.
const AN_FELLES = new WeakMap();
function anKort(d, p) {
  const n = p.name || p.objid;
  const pts = S.cache[d.address] || [];
  if (!AN_FELLES.has(pts)) AN_FELLES.set(pts, typeof commonNamePrefix === 'function' ? commonNamePrefix(pts) || '' : '');
  const f = AN_FELLES.get(pts);
  return f && n.startsWith(f) && n.length > f.length ? n.slice(f.length) : n;
}

/* ------------------------------------------------- copying, comparing */
function anTekst(t) {
  const n = new Date();
  const linjer = [`${asNavn()} · ${n.toLocaleDateString('nb-NO')} ${n.toLocaleTimeString('nb-NO', {hour: '2-digit', minute: '2-digit'})}`];
  linjer.push(t.ferdig
    ? T(`${t.total} ${t.total === 1 ? 'enhet' : 'enheter'}, ${t.lest} lest${t.feilet ? `, ${t.feilet} svarte ikke` : ''}, ${t.punkter} punkter`,
        `${t.total} ${t.total === 1 ? 'device' : 'devices'}, ${t.lest} read${t.feilet ? `, ${t.feilet} did not answer` : ''}, ${t.punkter} points`)
    : T(`${t.lest} av ${t.total} enheter lest så langt, ${t.punkter} punkter`, `${t.lest} of ${t.total} devices read so far, ${t.punkter} points`));
  const med = AN_REKKE.filter(f => t.flagg[f].length);
  if (!med.length) linjer.push(t.ferdig && t.alleStatus && !t.feilet
    ? T('Ingen punkter i alarm, med feil, overstyrt eller ute av drift.', 'No points in alarm, faulty, overridden or out of service.')
    : T('Ingen flagg funnet i det som er lest.', 'Nothing flagged in what was read.'));
  // Per controller, and a long run with one cause as one line: a report
  // with 600 lines of the same fault is read by nobody.
  for (const f of med) {
    linjer.push('', `${t.flagg[f].length} ${anFlaggNavn(f)}:`);
    for (const g of anGrupper(t.flagg[f])) {
      linjer.push(`  ${g.d.object_name || g.d.address} (${g.rader.length})`);
      for (const k of g.klynger) linjer.push(`    ${k.alle ? T('alle', 'all') : k.n} ${T('under', 'under')} ${k.vis}`);
      const vis = g.enkle.length <= 8 ? g.enkle.length : 5;
      for (const x of g.enkle.slice(0, vis)) linjer.push(`    ${anKort(x.d, x.p)}  ${anVerdi(x.p)}`);
      if (g.enkle.length > vis) linjer.push(`    ${T(`… og ${g.enkle.length - vis} til`, `… and ${g.enkle.length - vis} more`)}`);
    }
  }
  return linjer.join('\r\n');
}

async function anKopier(knapp) {
  const tekst = anTekst(anleggTall());
  try { await navigator.clipboard.writeText(tekst); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = tekst; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  knapp.textContent = T('Kopiert', 'Copied');
  knapp.classList.add('ok');
  setTimeout(() => { knapp.textContent = T('Kopier', 'Copy'); knapp.classList.remove('ok'); }, 1600);
}

/* What was flagged last time at this site, kept per site: the overrides
   you came to remove, and whether they are gone. */
function anLagret() { return loadPrefs().anleggStatus || {}; }

function anSistTekst(f) {
  const dato = new Date(f.t).toLocaleDateString('nb-NO', {day: 'numeric', month: 'short'});
  const n = f.tall['overridden'] || 0, a = (f.tall['in-alarm'] || 0) + (f.tall['fault'] || 0);
  if (!n && !a) return T(`sist ${dato}: ingen`, `last ${dato}: none`);
  return T(`sist ${dato}: ${[n && `${n} overstyrt`, a && `${a} alarm/feil`].filter(Boolean).join(', ')}`,
           `last ${dato}: ${[n && `${n} overridden`, a && `${a} alarm/fault`].filter(Boolean).join(', ')}`);
}

function anSammenlign(t) {
  const key = asNokkel();
  if (!key || AN.sammenlignet === key) return;
  AN.sammenlignet = key;
  const alle = anLagret();
  const forrige = alle[key];
  const ider = f => t.flagg[f].map(({d, p}) => `${d.address}|${p.objid}`);
  const naa = {t: Date.now(), key, tall: {}, overstyrt: ider('overridden')};
  for (const f of AN_REKKE) naa.tall[f] = t.flagg[f].length;
  if (forrige && Date.now() - forrige.t > 3600 * 1000) {
    AN.forrige = forrige;
    const foer = new Set(forrige.overstyrt || []), nye = new Set(naa.overstyrt);
    const borte = [...foer].filter(x => !nye.has(x)).length;
    const til = [...nye].filter(x => !foer.has(x)).length;
    if (borte && !til) nabeSier(T(`${borte} av overstyringene fra sist er borte.`, `${borte} of the overrides from last time are gone.`), 'fornoyd', 'sist:' + key);
    else if (til && foer.size) nabeSier(T(`${til} nye overstyringer siden sist.`, `${til} new overrides since last time.`), 'nervos', 'sist:' + key);
  } else if (forrige) {
    AN.forrige = null;
  }
  // The comparison is with the previous visit, so a visit replaces the record
  // only once it is an hour old - a rescan five minutes later is the same visit.
  if (!forrige || Date.now() - forrige.t > 3600 * 1000) {
    alle[key] = naa;
    const nokler = Object.keys(alle).sort((a, b) => alle[b].t - alle[a].t).slice(0, 60);
    savePrefs({anleggStatus: Object.fromEntries(nokler.map(k => [k, alle[k]]))});
  }
}

(function kobl() {
  const _tegn = renderDevices;
  renderDevices = function () { const r = _tegn.apply(this, arguments); tegnAnlegg(); return r; };
  // The first scan of the day on a known site opens the controller you had
  // open when you left it. Later scans leave the choice to you.
  const _skann = runScan;
  runScan = async function () {
    AN.sammenlignet = ''; AN.forrige = null; AN.apen = '';
    const forste = !AN.skannet;
    AN.skannet = true;
    const r = await _skann.apply(this, arguments);
    const sist = (loadPrefs().sistEnhet || {})[asNokkel()];
    const d = forste && sist && !S.activeDev && S.devices.find(x => x.address === sist.ip && x.device_instance === sist.inst);
    if (d) {
      selectDevice(d.address);
      nabeSier(T(`Åpnet ${d.object_name || d.address} igjen, der du slapp.`, `Opened ${d.object_name || d.address} again, where you left off.`), null, 'fortsett');
    }
    return r;
  };
  if (!document.body.classList.contains('skanner')) $('scanBtn').onclick = runScan;
  const _velg = selectDevice;
  selectDevice = function (ip) {
    const key = asNokkel();
    const d = S.devices.find(x => x.address === ip);
    if (key && d) {
      const alle = loadPrefs().sistEnhet || {};
      alle[key] = {ip, inst: d.device_instance};
      const nokler = Object.keys(alle).slice(-60);
      savePrefs({sistEnhet: Object.fromEntries(nokler.map(k => [k, alle[k]]))});
    }
    return _velg.apply(this, arguments);
  };
  setInterval(tegnAnlegg, 2000);
})();

/* ---------------------------------------------------- the setting */
(function innstilling() {
  const b = $('autoSokBtn');
  if (!b) return;
  const synk = () => {
    const paa = loadPrefs().autoSok !== false;
    b.classList.toggle('on', paa);
    b.setAttribute('aria-checked', String(paa));
    $('autoSokState').textContent = paa ? T('på', 'on') : T('av', 'off');
  };
  b.onclick = () => {
    const paa = loadPrefs().autoSok === false;
    savePrefs({autoSok: paa});
    synk();
    toast(paa ? T('NABE søker selv når den starter', 'NABE looks for itself when it starts')
              : T('NABE venter på deg når den starter', 'NABE waits for you when it starts'));
  };
  synk();
})();
