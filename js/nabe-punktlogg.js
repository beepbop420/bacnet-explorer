/* NABE - sensors that never move.

   A sensor that shows exactly the same number on every visit for weeks is rarely a calm room: it is a sensor that has been
   disconnected, or a reading frozen at its last value. To see it, what each analog input showed has to be remembered from
   one visit to the next, and that is what this keeps: per plant, per point, the last value, on how many different days it
   was exactly that, and since when. A value that changes starts the count again.

   It is kept in a file on this PC (see /api/punktlogg), not in the browser, so a cleared browser profile or a new PC does
   not take weeks of visits with it. The page holds the picture and sends it over every minute or so.

   Only analog inputs on BACnet devices are looked at, and only what has actually been read: nothing is asked of the plant
   for this. Setpoints and settings are left out (they are meant to stand still), and so is a zero where zero is a true
   reading (a fan that is off, no flow). When nearly every sensor on a device is unchanged, it is the device that is
   not updating, and it is said that way. */
'use strict';

(function punktlogg() {
  const MIN_DAGER = 3, MAKS_PKT = 8000, MAKS_DAGER = 60, SKRIVE_MS = 60000, REG_MS = 30 * 60 * 1000;
  const dagAv = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dagNr = (dag) => Date.parse(dag + 'T12:00:00') / 864e5;
  const lik = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const ny = (nokkel) => ({v: 1, nokkel, enh: {}, pkt: {}});

  /* One device read at `nu`: what each analog input showed. [value, days alike, first day, last day, name, unit, unit symbol] */
  function registrer(D, d, punkter, nu) {
    const dag = dagAv(nu), ip = d.address;
    const e = D.enh[ip] || (D.enh[ip] = {n: '', dager: []});
    e.n = d.object_name || e.n || ip;
    if (!e.dager.includes(dag)) { e.dager.push(dag); if (e.dager.length > MAKS_DAGER) e.dager.shift(); }
    let endret = 0;
    for (const p of punkter || []) {
      if (p.type !== 'analog-input' || typeof p.value !== 'number' || !isFinite(p.value) || p.unread) continue;
      if ((p.status || []).includes('out-of-service')) continue;
      const k = ip + '|' + p.objid, x = D.pkt[k], navn = p.name || p.objid;
      if (!x || !lik(x[0], p.value)) { D.pkt[k] = [p.value, 1, dag, dag, navn, String(p.units || ''), String(p.unit_symbol || '')]; endret++; continue; }
      x[4] = navn;
      if (x[3] !== dag) { x[1]++; x[3] = dag; endret++; }
    }
    const nok = Object.keys(D.pkt);
    if (nok.length > MAKS_PKT) nok.sort((a, b) => D.pkt[a][3].localeCompare(D.pkt[b][3])).slice(0, nok.length - MAKS_PKT).forEach((k) => delete D.pkt[k]);
    return endret;
  }

  /* A zero is a true reading for a fan that is off, a closed damper, no flow */
  const nullErSant = (v, u) => v === 0 && /^(percent|pascals|kilopascals|hectopascals|bars|millibars)$|per-(second|hour|minute)/.test(u);
  const innstilling = (navn) => (typeof erSettpunktNavn === 'function' && erSettpunktNavn(navn) !== null) || /(^|[^a-z0-9])(sp|spt|setpunkt|settpunkt|grense|konfig|config|offset|kalib)([^a-z0-9]|$)/i.test(navn || '');

  /* The points that have been the same on at least `min` different days, over at least two days. A device where nearly all are
     the same is one row of its own. */
  function finnDode(D, min = MIN_DAGER) {
    const per = {};
    for (const [k, x] of Object.entries(D.pkt)) {
      const i = k.indexOf('|'), ip = k.slice(0, i);
      (per[ip] = per[ip] || []).push({ip, objid: k.slice(i + 1), v: x[0], dager: x[1], forste: x[2], siste: x[3], navn: x[4], enhet: x[5], symbol: x[6] || ''});
    }
    const punkter = [], enheter = [];
    let analoge = 0, besok = 0;
    for (const [ip, l] of Object.entries(per)) {
      const e = D.enh[ip] || {n: ip, dager: []};
      besok = Math.max(besok, e.dager.length);
      const aktuelle = l.filter((x) => !innstilling(x.navn) && !nullErSant(x.v, x.enhet));
      analoge += aktuelle.length;
      if (e.dager.length < min) continue;
      const dode = aktuelle.filter((x) => x.dager >= min && dagNr(x.siste) - dagNr(x.forste) >= 2);
      if (!dode.length) continue;
      if (aktuelle.length >= 5 && dode.length / aktuelle.length >= 0.8) {
        enheter.push({ip, navn: e.n || ip, antall: dode.length, av: aktuelle.length, dager: Math.max(...dode.map((x) => x.dager))});
        continue;
      }
      punkter.push(...dode);
    }
    punkter.sort((a, b) => b.dager - a.dager);
    return {punkter, enheter, analoge, besok};
  }

  /* ---------------------------------------------------- the file, and the picture */
  let D = null, nokkel = '', skitten = false, sistLagret = 0, DODE = new Map(), RES = {punkter: [], enheter: [], analoge: 0, besok: 0};
  const SETT = new Map(), SIST = new Map();
  const planNokkel = () => (typeof asNokkel === 'function' ? asNokkel() : '');

  function bygDode() {
    RES = D ? finnDode(D) : {punkter: [], enheter: [], analoge: 0, besok: 0};
    DODE = new Map();
    for (const x of RES.punkter) (DODE.get(x.ip) || DODE.set(x.ip, new Map()).get(x.ip)).set(x.objid, x);
  }
  async function last(k) {
    let d = null;
    try { d = (await (await fetch('/api/punktlogg?nokkel=' + encodeURIComponent(k), {cache: 'no-store'})).json()).data; } catch { /* a fresh picture is better than none */ }
    D = d && d.v === 1 && d.nokkel === k ? d : ny(k);
    nokkel = k;
    SETT.clear(); SIST.clear();
    bygDode();
  }
  async function lagre() {
    if (!D || !skitten) return;
    skitten = false;
    sistLagret = Date.now();
    try { await api('/api/punktlogg', {nokkel: D.nokkel, data: D}); } catch { skitten = true; }
  }
  async function tikk() {
    if (typeof S === 'undefined' || !S.devices || !S.devices.length) return;
    const k = planNokkel();
    if (!k) return;
    if (k !== nokkel || !D) { if (D && skitten) await lagre(); await last(k); }
    const nu = Date.now();
    let endret = 0;
    for (const d of S.devices) {
      if (d.protocol && d.protocol !== 'bacnet') continue;
      const pts = S.cache[d.address], lest = S.cacheMeta[d.address] && S.cacheMeta[d.address].readAt;
      if (!pts || !lest || SETT.get(d.address) === lest || nu - (SIST.get(d.address) || 0) < REG_MS) continue;
      SETT.set(d.address, lest);
      SIST.set(d.address, nu);
      endret += registrer(D, d, pts, nu);
    }
    if (endret) { skitten = true; bygDode(); }
    if (skitten && nu - sistLagret > SKRIVE_MS) lagre();
  }
  setInterval(tikk, 20000);
  setTimeout(tikk, 6000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) lagre(); });

  /* The note on a value in the table: the same for this many days, since this day */
  function dodTittel(p) {
    if (typeof S === 'undefined' || !S.activeDev || !p) return '';
    const x = DODE.get(S.activeDev.address) && DODE.get(S.activeDev.address).get(p.objid);
    if (!x || typeof p.value !== 'number' || !lik(x.v, p.value)) return '';
    const sidenTekst = new Date(x.forste + 'T12:00:00').toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'short'});
    return T(`Samme verdi ved ${x.dager} besøk (siden ${sidenTekst}). En levende føler flytter seg som regel litt.`, `The same value on ${x.dager} visits (since ${sidenTekst}). A live sensor usually moves a little.`);
  }
  window.dodTittel = dodTittel;
  window.nabePunktlogg = {ny, registrer, finnDode, last, lagre, oppdater: bygDode, dode: () => RES, siste: () => D, dodTittel, MIN_DAGER,
    tilbakestill: () => { D = null; nokkel = ''; RES = {punkter: [], enheter: [], analoge: 0, besok: 0}; DODE = new Map(); }};
})();
