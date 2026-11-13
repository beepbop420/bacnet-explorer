/* NABE - pick up where you left off.

   The points you pinned to Watch used to live only in the open window: close
   NABE and the list was gone, and with it the ten minutes it took to find the
   points worth following. Now the list is kept per site (the ranges that were
   scanned), on this PC, and comes back by itself when that site is opened with
   an empty Watch. A list that is already there is never replaced; the saved one
   waits behind a button instead.

   Only what identifies a point is kept - device address, object, name, unit -
   not its values. The values come from the first poll, as they always do. */
'use strict';

(function fortsett() {
  const NOKKEL = 'nabe_watch_v1';
  const MAKS_ANLEGG = 20;
  let klar = false;           // not before start-up has had its chance to restore
  let sistSig = '';

  const les = () => { try { return JSON.parse(localStorage.getItem(NOKKEL)) || {}; } catch { return {}; } };
  const skriv = (d) => { try { localStorage.setItem(NOKKEL, JSON.stringify(d)); } catch { /* private window */ } };
  const sig = () => S.watch.map(w => w.ip + '~' + w.objid).join(';');

  /* The site is the ranges that were scanned, as on the start card. Before the
     first scan of a session that is what the field remembered from last time. */
  function omrNokkel() {
    const r = S.scanRanges && S.scanRanges.length ? S.scanRanges : parseRanges($('rangeInput')?.value || '');
    return r.map(x => String(x).trim()).filter(Boolean).sort().join(' ') || '_uten';
  }

  function lagre() {
    const d = les(), k = omrNokkel();
    if (S.watch.length) {
      d[k] = {t: Date.now(), punkter: S.watch.map(w => ({ip: w.ip, objid: w.objid, name: w.name, unit: w.unit}))};
    } else delete d[k];
    // The newest sites only: the list should not grow for as long as the PC lives.
    const nyeste = Object.entries(d).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, MAKS_ANLEGG);
    skriv(Object.fromEntries(nyeste));
    sistSig = sig();
  }

  const lagret = (k = omrNokkel()) => (les()[k] || {}).punkter || [];

  function gjenopprett(k = omrNokkel(), {stille = false} = {}) {
    const punkter = lagret(k);
    if (!punkter.length) return 0;
    S._watchGjenoppretter = true;
    S.watch = punkter.map(p => {
      // What the page already knows about the point is better than what was saved.
      const q = (S.cache[p.ip] || []).find(x => x.objid === p.objid);
      return {ip: p.ip, objid: p.objid, name: (q && q.name) || p.name, unit: (q && q.unit_symbol) || p.unit || '',
              hist: [], value: q ? q.value : undefined};
    });
    renderWatch();
    renderPoints();
    S._watchGjenoppretter = false;
    sistSig = sig();
    if (!stille) toast(T(`Overvåkingslista er hentet tilbake: ${S.watch.length} punkter`,
                         `Watch list restored: ${S.watch.length} points`));
    return S.watch.length;
  }

  /* The list is saved when it changes, never when the key does: scanning another
     site with pins from this one must not copy them there. */
  etter('renderWatch', () => {
    if (S._watchGjenoppretter) return;
    if (klar && sig() !== sistSig) lagre();
    // An empty Watch with a saved list behind it says so, and offers it.
    const el = $('watchList');
    const n = lagret().length;
    if (el && !S.watch.length && n && !el.querySelector('.watch-hent')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn watch-hent';
      b.textContent = T(`Åpne lagret liste (${n})`, `Open saved list (${n})`);
      b.onclick = () => gjenopprett(undefined, {});
      el.append(b);
    }
  });

  // A finished scan is the moment the site is known: restore into an empty Watch.
  etter('husk', () => { if (!S.watch.length) gjenopprett(); });

  // At start-up, for the site the field remembered; then saving may begin.
  setTimeout(() => {
    if (!S.watch.length) gjenopprett(undefined, {});
    sistSig = sig();
    klar = true;
    renderWatch();
  }, 1800);

  window.fortsettHent = () => {
    if (!gjenopprett()) toast(T('Ingen lagret overvåkingsliste for dette anlegget', 'No saved watch list for this site'), true);
  };
  window.nabeFortsett = {lagre, gjenopprett, lagret, omrNokkel, klar: () => { klar = true; }};   // for the self-test
})();
