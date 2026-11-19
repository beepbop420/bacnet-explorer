/* NABE - what is open at each plant, for the start page.

   The start page lists the plants NABE remembers. This adds what the suggestions said the last time they were counted
   there: how many are open, how many of them to look at first, how many are new since it was last marked, and the
   three that matter most. A few numbers per plant, kept with the plant in sites.json. The suggestions themselves are
   built again from the plant at the next visit, so nothing here can go out of date in a way that matters: it says "as
   of the last visit" and shows when that was.

   Counted when a scan has been read to the end, when the suggestions are opened, and when something is marked done,
   put aside or taught. Nothing here asks the plant for anything. */
'use strict';

(function anlegg() {
  let timer = 0, sist = '', SIDEN = null;
  /* How much was different from the previous visit, told by the visit comparison when a scan has been read to the end */
  const siden = (n, verst) => { SIDEN = {key: typeof asNokkel === 'function' ? asNokkel() : '', n, verst}; send(); };

  async function tell() {
    const key = typeof asNokkel === 'function' ? asNokkel() : '';
    if (!key || !S.devices || !S.devices.length || typeof window.forslagNaa !== 'function') return;
    if (key.split(' ').every((r) => r.startsWith('127.'))) return;         // the simulator is not a plant to come back to
    await Promise.all([window.nabeArbeid && window.nabeArbeid.last(), window.nabeLaer && window.nabeLaer.last()]);
    const d = window.forslagNaa();
    if (!d.lest) return;                                                    // nothing read yet: "all calm" would be a guess
    const apne = d.synlige.filter((p) => p.rader.length);
    const tall = (n) => apne.filter((p) => p.prio === n).length;
    const status = {p1: tall(1), p2: tall(2), p3: tall(3), nye: apne.filter((p) => p.kom).length, utfort: d.skjulte.length, laert: d.laert || 0,
      lest: d.lest, totalt: d.totalt, topp: apne.slice(0, 3).map((p) => ({id: p.id, tittel: p.tittel, prio: p.prio}))};
    if (SIDEN && SIDEN.key === key) status.siden = {n: SIDEN.n, verst: SIDEN.verst};
    const tekst = key + JSON.stringify(status);
    if (tekst === sist) return;
    sist = tekst;
    try {
      const r = await api('/api/sites/status', {key, status});
      if (r.status === 'done' && typeof MINNE !== 'undefined' && MINNE) MINNE[key] = r.site;
    } catch { sist = ''; }
  }
  const send = () => { clearTimeout(timer); timer = setTimeout(tell, 1200); };

  /* One line for a plant on the start page: what is open, in words first */
  function linje(s) {
    const st = s && s.status;
    if (!st) return null;
    const apne = (st.p1 || 0) + (st.p2 || 0) + (st.p3 || 0);
    const topp = (st.topp || []).map((x) => x.tittel).join('\n');
    const dag = st.t ? Math.floor((Date.now() / 1000 - st.t) / 86400) : 0;
    const gammel = dag >= 1 ? T(` (talt for ${dag} d siden)`, ` (counted ${dag} d ago)`) : '';
    if (!apne) {
      return {klasse: 'ro', tittel: T('Ingenting å følge opp ved siste telling', 'Nothing to follow up at the last count') + gammel,
        html: `<i></i>${st.utfort ? T('Alt utført', 'All done') : T('Rolig', 'Calm')}`};
    }
    const deler = [`<b>${apne}</b> ${apne === 1 ? T('åpent', 'open') : T('åpne', 'open')}`];
    if (st.p1) deler.push(T(`${st.p1} å se på først`, `${st.p1} to look at first`));
    if (st.nye) deler.push(`<span class="ny">${T(`${st.nye} ${st.nye === 1 ? 'ny' : 'nye'}`, `${st.nye} new`)}</span>`);
    const tr = trend(s);
    if (tr) deler.push(tr);
    const sid = st.siden && st.siden.n ? '\n' + T(`${st.siden.n} ${st.siden.n === 1 ? 'ting' : 'ting'} var annerledes enn forrige besøk`, `${st.siden.n} ${st.siden.n === 1 ? 'thing was' : 'things were'} different from the previous visit`) : '';
    return {klasse: st.p1 ? 'p1' : st.p2 ? 'p2' : '', tittel: topp + sid + gammel, html: `<i></i>${deler.join(' · ')}`};
  }
  /* Better or worse than the last time it was counted on another day: in words, so it reads the same to everyone */
  function trend(s) {
    const st = s.status, h = Array.isArray(s.hist) ? s.hist : [];
    const naa = (st.p1 || 0) + (st.p2 || 0) + (st.p3 || 0);
    const f = [...h].reverse().find((x) => x && x.t < st.t - 12 * 3600);
    if (!f || f.a === naa) return '';
    const d = naa - f.a;
    return T(`${Math.abs(d)} ${d < 0 ? 'færre' : 'flere'} enn sist`, `${Math.abs(d)} ${d < 0 ? 'fewer' : 'more'} than last time`);
  }
  /* The summary over the list: how many plants have something to look at first */
  function oppsummer(steder) {
    const med = steder.filter(([, s]) => s.status && s.status.p1 > 0).length;
    const apne = steder.filter(([, s]) => s.status && (s.status.p1 + s.status.p2 + s.status.p3) > 0).length;
    if (med) return T(`${med} ${med === 1 ? 'anlegg har' : 'anlegg har'} noe å se på først`, `${med} ${med === 1 ? 'site has' : 'sites have'} something to look at first`);
    if (apne) return T(`${apne} ${apne === 1 ? 'anlegg har' : 'anlegg har'} åpne forslag`, `${apne} ${apne === 1 ? 'site has' : 'sites have'} open suggestions`);
    return '';
  }

  if (typeof etter === 'function') etter('anSammenlign', send);
  window.nabeStatus = {send, tell, linje, oppsummer, siden, trend};
})();
