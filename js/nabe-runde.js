/* NABE - the round.

   The points you pin on a plant are the ones you look at every time you are
   there: the supply temperature, the pressure that tends to drift, the pump
   that has been in hand since March. The watch list used to be empty again
   on the next visit. Now it is kept per plant, and laid back in when the
   plant is scanned.

   No button and no setting: pinning is the whole interface. Emptying the
   list empties the round too. Loaded after nabe-anlegg.js. */
'use strict';

(function runde() {
  const MAKS_PUNKTER = 60, MAKS_ANLEGG = 40;
  const lagt = new Set();          // plants the round has been laid back for, this session
  let stille = false, sist = '';

  const alle = () => loadPrefs().runder || {};

  function husk() {
    if (stille) return;
    const key = asNokkel();
    // Not before the round has been laid back: an empty list at startup is not a decision.
    if (!key || !lagt.has(key)) return;
    const sig = key + '|' + S.watch.map(w => w.ip + w.objid).join(',');
    if (sig === sist) return;
    sist = sig;
    const r = alle();
    const mine = S.watch.map(w => ({ip: w.ip, objid: w.objid, name: w.name, unit: w.unit})).slice(0, MAKS_PUNKTER);
    if (mine.length) r[key] = {t: Date.now(), p: mine};
    else delete r[key];
    const nokler = Object.keys(r).sort((a, b) => r[b].t - r[a].t).slice(0, MAKS_ANLEGG);
    savePrefs({runder: Object.fromEntries(nokler.map(k => [k, r[k]]))});
  }

  function leggTilbake() {
    const key = asNokkel();
    if (!key || lagt.has(key) || !S.devices.length) return;
    lagt.add(key);
    const lagret = alle()[key];
    if (!lagret || !lagret.p || !lagret.p.length) return;
    const her = new Set(S.devices.map(d => d.address));
    const finnes = new Set(S.watch.map(w => w.ip + '|' + w.objid));
    let n = 0;
    for (const w of lagret.p) {
      if (!her.has(w.ip) || finnes.has(w.ip + '|' + w.objid)) continue;
      const p = (S.cache[w.ip] || []).find(x => x.objid === w.objid);
      S.watch.push({ip: w.ip, objid: w.objid, name: w.name, unit: w.unit || '', hist: [], value: p ? p.value : null});
      n++;
    }
    if (!n) return;
    stille = true;
    try { renderWatch(); if (S.activeDev) renderPoints(); } finally { stille = false; }
    if (typeof nabeSier === 'function') {
      nabeSier(T(`Runden din fra sist ligger i overvåkingen: ${n} punkter.`, `Your round from last time is in the watch list: ${n} points.`),
               'fornoyd', 'runde:' + key, true);
    }
  }

  etter('renderWatch', husk);
  etter('runScan', () => { setTimeout(leggTilbake, 400); });
  window.rundeLagret = () => alle()[asNokkel()] || null;
})();
