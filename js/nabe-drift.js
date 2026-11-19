/* NABE - running outside the schedule.

   An air handler that runs at three in the morning on a Sunday costs energy and wear for nothing, and it is not an alarm
   anywhere: the plant is doing what it was told, only not what the schedule says. This sets the weekly schedule beside
   the points that say something is running, and names the ones that run while the schedule says off.

   A schedule and a piece of equipment are tied by the system number they share (360.001 in both names), or, on a device
   with only one schedule, by the device. Only points that say something is running count (drift, gang, vifte, pumpe,
   run, fan ...), not alarms, hand switches or filter states. Ten to fifteen minutes after the schedule turns off are left
   alone, since a fan that runs on is meant to. What the schedule says now is its own present value, so calendar
   exceptions count; the controller's own clock decides, not the PC's.

   Reading the schedules is the one thing this asks of the plant, and only on devices that have schedule objects; the
   values that decide are read again just before it is said. Plain functions of their input, so they can be tested
   without a plant. */
'use strict';

(function drift() {
  const GRACE_MIN = 15;
  const PAA = new Set(['1', 'true', 'active', 'on', 'på', 'pa', 'drift', 'høy', 'hoy', 'high', 'comfort', 'komfort', 'dag', 'normal']);
  const AV = new Set(['0', 'false', 'inactive', 'off', 'av', 'stopp', 'stoppet', 'lav', 'low', 'natt', 'standby', 'spar']);
  const klass = (v) => { const s = String(v ?? '').toLowerCase().trim(); return PAA.has(s) ? 'paa' : AV.has(s) ? 'av' : null; };
  const SYS = /(?:^|\D)(\d{3})[._\-](\d{3})(?!\d)/;
  const sysAv = (n) => { const m = SYS.exec(String(n || '')); return m ? `${m[1]}.${m[2]}` : ''; };
  const KJOR = /(^|[^a-z0-9æøå])(drift|gang|kj[øo]r\w*|run\w*|vifte|fan|pumpe|pump|sf|tf|motor|aggr\w*)([^a-z0-9æøå]|$)/i;
  const EKSKL = /alarm|feil|fault|trip|utl[øo]s|sperr|(^|[^a-z0-9])(hand|man|manuell|auto)([^a-z0-9]|$)|overstyr|frost|brann|filter|vakt|program|tidsur/i;
  const tilMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };

  /* The state a weekly schedule holds at a given time: the last entry at or before it that day, or else the last entry
     of the nearest day before that has any. weekly[0] is Monday. */
  function tilstandVed(uke, dag, min) {
    const dagen = (i) => ((uke[i] && uke[i].entries) || []).map((e) => ({min: tilMin(e.time), v: e.value})).filter((e) => e.min !== null).sort((a, b) => a.min - b.min);
    const idag = dagen(dag).filter((e) => e.min <= min);
    if (idag.length) return idag[idag.length - 1].v;
    for (let k = 1; k <= 7; k++) { const e = dagen(((dag - k) % 7 + 7) % 7); if (e.length) return e[e.length - 1].v; }
    return null;
  }

  /* How long the schedule has said off, in minutes, counted back from `na` (the controller's own time). null when the
     weekly schedule cannot say (it is empty, or it does not agree that it is off now). */
  function minSidenAv(uke, na) {
    if (!Array.isArray(uke) || !uke.length) return null;
    const dag = (na.getDay() + 6) % 7, min = na.getHours() * 60 + na.getMinutes();
    if (klass(tilstandVed(uke, dag, min)) !== 'av') return null;
    const arr = [];
    for (let k = 0; k <= 7; k++) {
      const d = ((dag - k) % 7 + 7) % 7;
      for (const e of (uke[d] && uke[d].entries) || []) {
        const m = tilMin(e.time);
        if (m === null) continue;
        const t = m - k * 1440;
        if (t <= min) arr.push({t, c: klass(e.value)});
      }
    }
    arr.sort((a, b) => a.t - b.t);
    if (!arr.length) return null;
    let j = arr.length - 1;
    if (arr[j].c !== 'av') return null;
    while (j > 0 && arr[j - 1].c === 'av') j--;
    return min - arr[j].t;
  }

  /* Equipment that runs while its schedule says off. `urCache`: ip -> {klar, schedules[]}, as the schedule view holds them. */
  function kandidater(devices, cache, urCache, nu, drift = () => null) {
    const ut = [];
    for (const d of devices || []) {
      const c = urCache && urCache[d.address];
      const ur = c && c.klar ? c.schedules || [] : [];
      const pts = cache[d.address] || [];
      if (!ur.length || !pts.length) continue;
      const drf = drift(d.address), na = new Date(nu + (typeof drf === 'number' ? drf * 1000 : 0));
      const sett = new Set();
      for (const s of ur) {
        if (klass(s.value) !== 'av') continue;
        const siden = minSidenAv(s.weekly, na);
        if (siden !== null && siden < GRACE_MIN) continue;
        const sys = sysAv(s.name) || sysAv(s.description);
        for (const p of pts) {
          if (!/^binary-/.test(p.type || '') || p.value !== 'active' || sett.has(p.objid)) continue;
          if ((p.status || []).includes('out-of-service')) continue;
          const tekst = `${p.name || ''} ${p.description || ''}`;
          if (!KJOR.test(tekst) || EKSKL.test(tekst)) continue;
          // Tied by the system they share; with none to go by, only a device that has a single schedule
          if (sys ? sysAv(p.name) !== sys : ur.length !== 1) continue;
          sett.add(p.objid);
          const lest = S0().cacheMeta && S0().cacheMeta[d.address] && S0().cacheMeta[d.address].readAt;
          ut.push({ip: d.address, enhet: d.object_name || d.address, program: s.name || s.objid, programObjid: s.objid, punkt: p.name || p.objid, objid: p.objid,
            siden, overstyrt: (p.status || []).includes('overridden'), lestMin: lest ? Math.round((nu - lest) / 60000) : null});
        }
      }
    }
    ut.sort((a, b) => (b.siden ?? 1e9) - (a.siden ?? 1e9));
    return ut;
  }
  const S0 = () => (typeof S === 'undefined' ? {} : S);

  /* ------------------------------------------------- asking the plant, a little */
  let SISTE = {liste: [], urLest: 0, urTotalt: 0, tid: 0}, pagar = null;
  const lyttere = [];
  const harUr = (d) => ((S.cacheMeta[d.address] || {}).type_counts || {}).schedule > 0 || !!(S.urCache && S.urCache[d.address] && S.urCache[d.address].klar && (S.urCache[d.address].schedules || []).length);

  async function kontrollerNu() {
    const devs = (S.devices || []).filter((d) => (!d.protocol || d.protocol === 'bacnet') && S.cache[d.address] && harUr(d)).slice(0, 40);
    const ko = devs.filter((d) => !(S.urCache[d.address] && S.urCache[d.address].klar));
    const arbeid = async () => { for (let d = ko.shift(); d; d = ko.shift()) { try { await urLes(d); } catch { /* the next one */ } } };
    await Promise.all([arbeid(), arbeid(), arbeid()]);
    const drf = (ip) => ((S.identity || {})[ip] || {})['clock-drift'];
    let liste = kandidater(devs, S.cache, S.urCache, Date.now(), drf);
    // What decides is read again, so it is not the value from ten minutes ago that is said
    if (liste.length) {
      const mal = {};
      for (const k of liste) (mal[k.ip] = mal[k.ip] || []).push(k.programObjid, k.objid);
      try {
        const r = await api('/api/poll', {targets: mal, cov: false});
        if (r.status === 'done') {
          for (const [ip, v] of Object.entries(r.values || {})) {
            for (const s of (S.urCache[ip] && S.urCache[ip].schedules) || []) if (s.objid in v && v[s.objid] !== null) s.value = v[s.objid];
            for (const p of S.cache[ip] || []) if (p.objid in v && v[p.objid] !== null) p.value = v[p.objid];
          }
          liste = kandidater(devs, S.cache, S.urCache, Date.now(), drf);
        }
      } catch { /* what was read before has to do */ }
    }
    SISTE = {liste, urLest: devs.filter((d) => S.urCache[d.address] && S.urCache[d.address].klar).length, urTotalt: devs.length, tid: Date.now()};
    lyttere.forEach((f) => { try { f(SISTE); } catch { /* a listener is not worth stopping for */ } });
    return SISTE;
  }
  function kontroller() {
    if (typeof S === 'undefined' || !S.devices || !S.devices.length) return Promise.resolve(SISTE);
    if (pagar) return pagar;
    pagar = kontrollerNu().finally(() => { pagar = null; });
    return pagar;
  }

  window.nabeDrift = {kandidater, minSidenAv, tilstandVed, klass, sysAv, kontroller, siste: () => SISTE, pa: (f) => lyttere.push(f), GRACE_MIN};
})();
