/* NABE - the points that alarm most.

   An alarm list sorted by time puts what shouts every day next to what shouted once, and the one that shouted once is
   the one nobody has seen before. This keeps count, per plant, of how often each point has been found in alarm or
   fault, on how many different days, and shows the new and the rare first, and the ones that always shout after them.

   It only counts what NABE has seen: a point is looked at when its device is read, and between two reads
   nothing is seen. Kept in this browser, per plant, and nothing is sent anywhere. Nothing is read from the
   plant for this: it works on the status flags that have already been read. */
'use strict';

(function alarmhist() {
  const NOKKEL = 'nabe_alarmhist';
  const MAKS_PUNKT = 800, MAKS_ANLEGG = 8, MAKS_DAGER = 30;
  const KRONISK_DAGER = 3, KRONISK_ANDEL = 0.8, NY_TIMER = 24;

  const dagAv = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const lagre0 = () => { try { const x = JSON.parse(localStorage.getItem(NOKKEL)); return x && x.v === 1 && x.anlegg ? x : {v: 1, anlegg: {}}; } catch { return {v: 1, anlegg: {}}; } };
  let LAGER = lagre0();
  let lagreT = 0;
  function lagre() {
    clearTimeout(lagreT);
    lagreT = setTimeout(() => {
      const nok = Object.keys(LAGER.anlegg).sort((a, b) => (LAGER.anlegg[b].sist || 0) - (LAGER.anlegg[a].sist || 0)).slice(0, MAKS_ANLEGG);
      LAGER.anlegg = Object.fromEntries(nok.map((k) => [k, LAGER.anlegg[k]]));
      try { localStorage.setItem(NOKKEL, JSON.stringify(LAGER)); } catch { /* private window */ }
    }, 800);
  }

  const anlegg = (lager, nokkel) => (lager.anlegg[nokkel] = lager.anlegg[nokkel] || {enh: {}, pkt: {}, sist: 0});
  const legg = (liste, dag) => { if (!liste.includes(dag)) { liste.push(dag); if (liste.length > MAKS_DAGER) liste.shift(); } };

  /* One device read at `nu`: which of its points are in alarm or fault now. Returns how many were new. */
  function registrerEnhet(a, d, punkter, nu) {
    const dag = dagAv(nu), ip = d.address;
    // The first time a device is looked at, what is in alarm has been so for a while: that is where we start from, not news.
    const grunnlag = !a.enh[ip];
    const e = (a.enh[ip] = a.enh[ip] || {navn: d.object_name || ip, dager: []});
    e.navn = d.object_name || e.navn || ip;
    legg(e.dager, dag);
    let nye = 0;
    for (const p of punkter || []) {
      const flagg = p.status || [];
      const iAlarm = flagg.includes('in-alarm'), feil = flagg.includes('fault');
      const k = ip + '|' + p.objid;
      const x = a.pkt[k];
      if (!iAlarm && !feil) { if (x && x.naa) x.naa = false; continue; }
      if (!x) {
        a.pkt[k] = {navn: p.name || p.objid, enhet: e.navn, ip, objid: p.objid, n: 1, dager: [dag], forste: nu, sist: nu, naa: true, type: iAlarm ? 'alarm' : 'feil', kjent: false, grunnlag};
        if (!grunnlag) nye++;
        continue;
      }
      if (!x.naa) x.n++;
      x.naa = true; x.sist = nu; x.navn = p.name || x.navn; x.enhet = e.navn; x.type = iAlarm ? 'alarm' : 'feil';
      legg(x.dager, dag);
    }
    a.sist = nu;
    // The oldest that are not in alarm now go first when it grows too large
    const nok = Object.keys(a.pkt);
    if (nok.length > MAKS_PUNKT) {
      nok.filter((k) => !a.pkt[k].naa).sort((x, y) => a.pkt[x].sist - a.pkt[y].sist).slice(0, nok.length - MAKS_PUNKT).forEach((k) => delete a.pkt[k]);
    }
    return nye;
  }

  /* chronic: in alarm on nearly every day the device has been looked at, over at least three days.
     new: appeared after the device was first looked at, seen once, within the last day. The rest are rare. */
  function klassifiser(x, enhetDager, nu = Date.now()) {
    const obs = Math.max(enhetDager ? enhetDager.length : 0, x.dager.length);
    const kronisk = x.dager.length >= KRONISK_DAGER && x.dager.length / obs >= KRONISK_ANDEL;
    const ny = !kronisk && x.n === 1 && !x.grunnlag && nu - x.forste < NY_TIMER * 3600 * 1000;
    return {kronisk, ny, sjelden: !kronisk && !ny, obs};
  }

  /* Looks at every device that has been read since last time. */
  const SETT = new Map();
  function skann(nu = Date.now()) {
    if (typeof S === 'undefined' || !S.devices || !S.devices.length) return;
    const nokkel = typeof asNokkel === 'function' ? asNokkel() : '';
    if (!nokkel) return;
    const a = anlegg(LAGER, nokkel);
    let endret = false;
    for (const d of S.devices) {
      if (d.protocol && d.protocol !== 'bacnet') continue;
      const pts = S.cache[d.address], lest = S.cacheMeta[d.address] && S.cacheMeta[d.address].readAt;
      if (!pts || !lest) continue;
      // A device is counted once per reading, and the status flags only change when it is read again
      if (SETT.get(d.address) === lest) continue;
      SETT.set(d.address, lest);
      registrerEnhet(a, d, pts, nu);
      endret = true;
    }
    if (endret) lagre();
  }
  setInterval(skann, 15000);
  setTimeout(skann, 4000);

  const dagerObs = (a, p) => (a.enh[p.ip] ? a.enh[p.ip].dager : []);
  function liste(nu = Date.now()) {
    const nokkel = typeof asNokkel === 'function' ? asNokkel() : '';
    const a = nokkel && LAGER.anlegg[nokkel];
    if (!a) return [];
    return Object.values(a.pkt).map((p) => ({...p, ...klassifiser(p, dagerObs(a, p), nu)}));
  }
  const kronisk = (ip, objid) => {
    const nokkel = typeof asNokkel === 'function' ? asNokkel() : '';
    const a = nokkel && LAGER.anlegg[nokkel];
    const p = a && a.pkt[ip + '|' + objid];
    return !!(p && klassifiser(p, dagerObs(a, p)).kronisk);
  };
  function sett(ip, objid, felt, verdi) {
    const nokkel = typeof asNokkel === 'function' ? asNokkel() : '';
    const p = nokkel && LAGER.anlegg[nokkel] && LAGER.anlegg[nokkel].pkt[ip + '|' + objid];
    if (p) { p[felt] = verdi; lagre(); }
  }

  /* ------------------------------------------------------------------ the list */
  const lag = document.createElement('div');
  lag.id = 'alarmhistOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const kl = (ms) => {
    const d = new Date(ms), i = new Date();
    const tid = d.toLocaleTimeString(SPRAAK === 'en' ? 'en-GB' : 'no', {hour: '2-digit', minute: '2-digit'});
    return dagAv(ms) === dagAv(i.getTime()) ? T(`i dag ${tid}`, `today ${tid}`)
      : d.toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'short'}) + ' ' + tid;
  };
  function raadHtml(p) {
    const merke = [p.naa ? `<span class="ah-m naa">${T('i alarm nå', 'in alarm now')}</span>` : '',
      p.kronisk ? `<span class="ah-m">${T('roper ofte', 'shouts often')}</span>` : p.ny ? `<span class="ah-m ny">${T('ny', 'new')}</span>` : '',
      p.type === 'feil' ? `<span class="ah-m">${T('feil', 'fault')}</span>` : ''].join('');
    const dager = T(`${p.dager.length} av ${p.obs} ${p.obs === 1 ? 'dag' : 'dager'}`, `${p.dager.length} of ${p.obs} ${p.obs === 1 ? 'day' : 'days'}`);
    return `<tr data-ip="${esc(p.ip)}" data-o="${esc(p.objid)}"><td><div class="sp-navn">${esc(p.navn)} ${merke}</div>
      <div class="sp-meta">${esc(p.enhet)} · ${esc(dager)} · ${T('sett ' + p.n + (p.n === 1 ? ' gang' : ' ganger'), 'seen ' + p.n + (p.n === 1 ? ' time' : ' times'))} · ${esc(T('sist ', 'last ') + kl(p.sist))}</div></td>
      <td class="t"><button type="button" class="btn ah-kjent" data-kjent="${p.kjent ? '0' : '1'}">${p.kjent ? T('Angre', 'Undo') : T('Kjent', 'Known')}</button></td></tr>`;
  }
  const tabell = (rader) => `<table class="sp-tab ah-tab"><tbody>${rader.map(raadHtml).join('')}</tbody></table>`;

  function tegn() {
    const alle = liste();
    const synlige = alle.filter((p) => !p.kjent);
    const nye = synlige.filter((p) => !p.kronisk).sort((a, b) => (b.ny - a.ny) || (b.naa - a.naa) || b.sist - a.sist);
    const ofte = synlige.filter((p) => p.kronisk).sort((a, b) => b.dager.length - a.dager.length || b.n - a.n);
    const kjente = alle.filter((p) => p.kjent).sort((a, b) => b.sist - a.sist);
    const del = (tittel, rader, maks) => (rader.length ? `<div class="fo-gruppe">${esc(tittel)} · ${rader.length}</div>${tabell(rader.slice(0, maks))}${rader.length > maks ? `<div class="sp-meta ah-flere">${T(`og ${rader.length - maks} til`, `and ${rader.length - maks} more`)}</div>` : ''}` : '');
    const tom = !alle.length;
    lag.innerHTML = `<div class="gs-modal sp-modal ah-modal"><div class="gs-head"><span class="gd-tittel">${T('Mest alarmerende', 'Most alarming')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp"><div class="sp-meta">${T('De nye og sjeldne først. De som alltid roper skjuler dem ellers.', 'The new and the rare first. The ones that always shout would hide them otherwise.')}</div>
        <div class="sp-rull">${tom ? `<div class="fo-tom">${T('Ingen alarmer eller feil er sett i dette anlegget ennå. Det telles når en enhet leses.', 'No alarms or faults have been seen in this plant yet. They are counted when a device is read.')}</div>`
          : del(T('Nye og sjeldne', 'New and rare'), nye, 40) + del(T('Roper ofte', 'Shouts often'), ofte, 40) + del(T('Kjente', 'Known'), kjente, 20)}</div>
        <div class="sp-meta">${T('Telles når enheten leses på nytt. Mellom to lesninger ser NABE ingenting.', 'Counted when the device is read again. Between two reads NABE sees nothing.')}</div>
        ${tom ? '' : `<div class="op-knapper"><button type="button" class="btn" data-ah="tom">${T('Tøm historikken', 'Clear the history')}</button></div>`}</div></div>`;
  }
  async function gaaTil(ip, objid) {
    if (!S.activeDev || S.activeDev.address !== ip) {
      document.querySelector(`#devList .dev[data-ip="${CSS.escape(ip)}"]`)?.click();
      for (let i = 0; i < 80 && !(S.activeDev && S.activeDev.address === ip && S.pointIndex && S.pointIndex.get(objid)); i++)
        await new Promise((r) => setTimeout(r, 150));
    }
    if (typeof selectPoint === 'function' && S.pointIndex && S.pointIndex.get(objid)) {
      selectPoint(objid);
      document.querySelector(`#pointsWrap tr[data-o="${CSS.escape(objid)}"]`)?.scrollIntoView({block: 'center'});
    }
  }
  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const kj = e.target.closest('[data-kjent]');
    if (kj) { const tr = kj.closest('tr'); sett(tr.dataset.ip, tr.dataset.o, 'kjent', kj.dataset.kjent === '1'); tegn(); return; }
    if (e.target.closest('[data-ah="tom"]')) {
      if (!await nabeBekreft(T('Tømme alarmhistorikken for dette anlegget?', 'Clear the alarm history for this plant?'))) return;
      const nokkel = typeof asNokkel === 'function' ? asNokkel() : '';
      if (nokkel) delete LAGER.anlegg[nokkel];
      SETT.clear();
      lagre(); tegn();
      return;
    }
    const tr = e.target.closest('tr[data-ip]');
    if (tr) { lag.hidden = true; gaaTil(tr.dataset.ip, tr.dataset.o); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);

  window.aapneAlarmhist = () => { skann(); tegn(); lag.hidden = false; };
  window.nabeAlarmhist = {registrerEnhet, klassifiser, liste, kronisk, anlegg, dagAv, KRONISK_DAGER,
    eksport: () => (typeof asNokkel === 'function' && LAGER.anlegg[asNokkel()]) || null, tilbakestill: () => { LAGER = {v: 1, anlegg: {}}; SETT.clear(); }};
  if ($('alarmhistBtn')) $('alarmhistBtn').onclick = () => { closeMenus(); window.aapneAlarmhist(); };
})();
