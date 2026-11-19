/* NABE - the suggestions as a worklist.

   A list that is read again from the top every visit is no help when half of it is already done. Each suggestion can be
   marked done or put aside for a week, and NABE remembers it per plant, in a file on this PC (see /api/arbeidsliste).

   What is put aside stays away only as long as it is the same problem: when a point turns up that was not in the list
   when it was marked, the suggestion comes back with a note on how many are new. A week aside ends by itself.

   Nothing here asks the plant for anything. */
'use strict';

(function arbeidsliste() {
  const MAKS_NOKLER = 500, DAG = 864e5, SKRIVE_MS = 800;
  let D = null, nokkel = '', timer = 0;
  const ny = (k) => ({v: 1, nokkel: k, poster: {}});
  const planNokkel = () => (typeof asNokkel === 'function' ? asNokkel() : '');
  const radNokkel = (r) => (r.ip ? `${r.ip}|${r.objid || ''}|${r.navn || ''}` : String(r.navn || ''));
  // Most titles begin with how many there are ("3 faulty points"), and rows are often one per device, so the count tells what the rows cannot
  const antallI = (p) => { const n = parseInt(String(p.tittel || ''), 10); return Number.isFinite(n) ? n : null; };
  const noekler = (p) => [...new Set((p.rader || []).map(radNokkel))].sort();

  async function last() {
    const k = planNokkel();
    if (!k) { D = null; nokkel = ''; return; }
    if (D && k === nokkel) return;
    let d = null;
    try { d = (await (await fetch('/api/arbeidsliste?nokkel=' + encodeURIComponent(k), {cache: 'no-store'})).json()).data; } catch { /* a clean list is better than none */ }
    D = d && d.v === 1 && d.nokkel === k && d.poster && typeof d.poster === 'object' ? d : ny(k);
    nokkel = k;
  }
  function lagreSnart() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!D) return;
      try { await api('/api/arbeidsliste', {nokkel: D.nokkel, data: D}); } catch { /* the choice still holds in this window */ }
      if (window.nabeStatus) window.nabeStatus.send();
    }, SKRIVE_MS);
  }

  /* Splits the suggestions into those to show and those put aside. A put-aside one with something new in it is shown again. */
  function del(liste) {
    const synlige = [], skjulte = [], nu = Date.now();
    for (const p of liste || []) {
      const x = D && D.poster[p.id];
      if (!x) { synlige.push(p); continue; }
      const na = noekler(p), kjent = new Set(x.k || []);
      // Past the cap only the count can say whether something is new
      let nye = na.length > MAKS_NOKLER ? Math.max(0, (p.rader || []).length - (x.n || 0)) : na.filter((k) => !kjent.has(k)).length;
      const tall = antallI(p);
      if (!nye && tall !== null && typeof x.c === 'number' && tall > x.c) nye = tall - x.c;
      const utlopt = x.s === 'utsatt' && x.til && x.til <= nu;
      if (nye || utlopt) synlige.push({...p, kom: nye ? 'nye' : 'tilbake', nyeAntall: nye});
      else skjulte.push({...p, state: x.s, til: x.til || 0, t: x.t || 0});
    }
    return {synlige, skjulte};
  }

  function marker(p, state, dager) {
    if (!D) D = ny(planNokkel());
    const nu = Date.now();
    D.poster[p.id] = {s: state, til: state === 'utsatt' ? nu + (dager || 7) * DAG : 0, k: noekler(p).slice(0, MAKS_NOKLER), n: (p.rader || []).length, c: antallI(p), t: nu};
    lagreSnart();
  }
  function vis(id) { if (D && D.poster[id]) { delete D.poster[id]; lagreSnart(); } }

  /* One suggestion as a message to a colleague or the customer */
  function melding(p, plan) {
    const rader = (p.rader || []).slice(0, 15).map((r) => `  - ${r.navn}${r.tekst ? ' (' + r.tekst + ')' : ''}`);
    const flere = (p.rader || []).length - rader.length;
    return [plan ? `${plan}` : '', p.tittel, '', p.hvorfor, '', ...(p.sjekk && p.sjekk.length ? [T('Å sjekke:', 'To check:'), ...p.sjekk.map((s) => '  - ' + s), ''] : []),
      ...(rader.length ? [T('Gjelder:', 'Concerns:'), ...rader, ...(flere > 0 ? [T(`  og ${flere} til`, `  and ${flere} more`)] : [])] : [])].filter((x, i, a) => !(x === '' && (i === 0 || a[i - 1] === ''))).join('\n').trim();
  }

  window.nabeArbeid = {last, del, marker, vis, melding, siste: () => D, DAG,
    tilbakestill: () => { D = null; nokkel = ''; }};
})();
