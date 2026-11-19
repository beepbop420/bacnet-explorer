/* NABE - the network under the devices: which routers carry how many, and who answers from the same address.

   A BACnet router puts the equipment behind it on a network of its own, and a device there is addressed
   "network:station" (50:2), not by an IP. An MS/TP trunk takes 32 devices without a repeater, and a router that
   carries a hundred of them is a router that will be the first to stall. This counts what has been found per network
   and per router, and says when it is near or over.

   Two more things about addresses: two devices that answer from one address in the same scan (one of them is not
   where it should be), and two addresses that show the same MAC (a proxy, a router interface or a card in a loop).

   Plain functions of their input, so they can be tested without a plant. */
'use strict';

(function nett() {
  const MSTP_MAKS = 32, MSTP_NAER = 24, RUTER_TUNG = 64;

  /* "50:2" is station 2 on network 50. A plain IP, with or without a port, is not routed. */
  const nettAv = (adr) => {
    const m = /^(\d{1,5}):(.+)$/.exec(String(adr || ''));
    return m && !/^\d{1,3}(\.\d{1,3}){3}$/.test(m[1]) ? {nett: +m[1], mac: m[2]} : null;
  };
  /* A station number up to 254 is MS/TP; a longer one is some other routed network, which has no limit of 32. */
  const erMstp = (mac) => /^\d{1,3}$/.test(mac) && +mac <= 254;
  const bacnet = (d) => !d.protocol || d.protocol === 'bacnet';

  function ruterBelastning(rutere, devices) {
    const perNett = new Map();
    for (const d of devices || []) {
      if (!bacnet(d)) continue;
      const a = nettAv(d.address);
      if (!a) continue;
      const e = perNett.get(a.nett) || {nett: a.nett, enheter: [], mstp: 0};
      e.enheter.push(d);
      if (erMstp(a.mac)) e.mstp++;
      perNett.set(a.nett, e);
    }
    const niva = (mstp) => (mstp >= MSTP_MAKS ? 'over' : mstp >= MSTP_NAER ? 'naer' : 'ok');
    const rad = (e) => ({nett: e.nett, antall: e.enheter.length, mstp: e.mstp, niva: niva(e.mstp), forste: e.enheter[0] ? e.enheter[0].address : ''});
    const brukt = new Set();
    const ut = [];
    for (const r of rutere || []) {
      const nett = (r.nett || []).map((n) => rad(perNett.get(n) || {nett: n, enheter: [], mstp: 0}));
      nett.forEach((e) => brukt.add(e.nett));
      const total = nett.reduce((t, e) => t + e.antall, 0);
      ut.push({ruter: r.ruter, nett, total,
        niva: nett.some((e) => e.niva === 'over') ? 'over' : total >= RUTER_TUNG ? 'tung' : nett.some((e) => e.niva === 'naer') ? 'naer' : 'ok'});
    }
    // Networks with devices on them and no router found: it did not answer, or it is out of this adapter's reach
    const utenRuter = [...perNett.values()].filter((e) => !brukt.has(e.nett)).map(rad);
    ut.sort((a, b) => ({over: 0, tung: 1, naer: 2, ok: 3}[a.niva] - {over: 0, tung: 1, naer: 2, ok: 3}[b.niva]) || b.total - a.total);
    return {rutere: ut, utenRuter, maks: MSTP_MAKS, naer: MSTP_NAER, tung: RUTER_TUNG};
  }

  /* Same MAC on different hosts. The same host on two ports is one machine, and is left alone. */
  const normMac = (m) => String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  const vert = (adr) => String(adr || '').replace(/^(mb|mr|ms|kx):/, '').replace(/:\d+$/, '').replace(/\/\d+$/, '');
  function sammeMac(devices) {
    const per = new Map();
    for (const d of devices || []) {
      const m = normMac(d.mac);
      if (m.length !== 12 || /^(0{12}|f{12})$/.test(m)) continue;
      const e = per.get(m) || {mac: m, enheter: []};
      e.enheter.push(d);
      per.set(m, e);
    }
    return [...per.values()].filter((e) => new Set(e.enheter.map((d) => vert(d.address))).size > 1)
      .map((e) => ({mac: e.mac.replace(/(..)(?=.)/g, '$1:'), enheter: e.enheter}));
  }

  /* Two answers from one address in one scan, with different device IDs. `iDenne` is the scan's own memory; a device
     that has changed its ID between two scans is a different thing (somebody renumbered it) and only noted. */
  const ny = () => ({sett: new Map(), konflikt: new Set()});
  function noterAdresse(eksisterende, d, iDenne) {
    if (!d || !bacnet(d) || d.device_instance == null || nettAv(d.address)) return;
    const forrige = iDenne.sett.get(d.address);
    if (forrige != null && forrige !== d.device_instance) {
      const s = ((S._sammeAdr = S._sammeAdr || {})[d.address] = (S._sammeAdr[d.address] || {ider: [], t: Date.now()}));
      for (const i of [forrige, d.device_instance]) if (!s.ider.includes(i)) s.ider.push(i);
      iDenne.konflikt.add(d.address);
    } else if (forrige == null && eksisterende && eksisterende.device_instance != null && eksisterende.device_instance !== d.device_instance) {
      (S._endretId = S._endretId || {})[d.address] = {fra: eksisterende.device_instance, til: d.device_instance, t: Date.now()};
    }
    iDenne.sett.set(d.address, d.device_instance);
  }
  /* After one batch: an address that answered with one ID only is no longer in conflict. */
  function ferdigMed(iDenne) {
    if (!S._sammeAdr) return;
    for (const a of iDenne.sett.keys()) if (!iDenne.konflikt.has(a)) delete S._sammeAdr[a];
  }
  /* What siteWarnings reads: only addresses that are still in the list, and cleared when the scan no longer shows two. */
  function sammeAdresse(devices) {
    const na = new Set((devices || []).map((d) => d.address));
    const s = S._sammeAdr || {};
    return Object.entries(s).filter(([a]) => na.has(a)).map(([adresse, x]) => ({adresse, ider: x.ider.slice().sort((a, b) => a - b)}));
  }

  window.nabeNett = {ruterBelastning, sammeMac, sammeAdresse, noterAdresse, ferdigMed, ny, nettAv, erMstp};
})();
