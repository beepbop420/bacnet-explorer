/* NABE - what the technician has taught it about a plant.

   "This sensor is disconnected on purpose" is said once, and the suggestions stop bringing it up. Four rules keep that honest:

   1. It holds for one point on one plant, and for one kind of suggestion. A new point of the same kind still shows up,
      and the same point is still reported for anything else (an alarm is not hidden because a flat line was).
   2. It is never silent. What NABE has been told is a list the technician can read, with the reason and the date, and
      every line can be undone. The suggestions say how many points are held back.
   3. It runs out. Faults and alarms come back after 90 days, the rest after 180, so a choice made once is not made for ever.
   4. It follows the device, not the IP address: a device that gets a new address is still the same device.

   When the same word turns up in three or more of the points that have been set aside ("reserve", "ledig"), NABE offers to
   set aside the rest with that word on this plant. It only offers. A no is remembered.

   Kept per plant in a file on this PC (see /api/laering). Nothing here asks the plant for anything. */
'use strict';

(function laer() {
  const DAG = 864e5, LANG = 180 * DAG, KORT = 90 * DAG;
  // Only the kinds of suggestion where "it is meant to be like this" is a fair answer. Duplicate IDs, silent devices,
  // storms and unreadable devices are never put aside by a click.
  const KORT_FRIST = new Set(['feil-punkt', 'alarm', 'alarm-ofte', 'avvik']);
  const LAERBAR = new Set(['dode', 'dode-enhet', 'flat', 'urimelig', 'ute', 'overstyrt', 'feil-punkt', 'alarm', 'avvik', 'alarm-ofte',
    'syk-tips', 'virkning-tips', 'driftstid', 'sykluser', 'virkning', 'endret-id']);
  const GRUNNER = () => ({vilje: T('Med vilje', 'On purpose'), ikkebruk: T('Ikke i bruk', 'Not in use'), kjent: T('Kjent og akseptert', 'Known and accepted')});
  const TYPER = () => ({dode: T('aldri endret', 'never changed'), 'dode-enhet': T('oppdaterer ikke', 'not updating'), flat: T('står stille', 'stands still'),
    urimelig: T('urimelig verdi', 'impossible value'), ute: T('ute av drift', 'out of service'), overstyrt: T('overstyrt', 'overridden'),
    'feil-punkt': T('feil', 'fault'), alarm: T('alarm', 'alarm'), avvik: T('langt fra settpunkt', 'far from setpoint'), 'alarm-ofte': T('alarmerer ofte', 'alarms often'),
    'syk-tips': T('hyppige starter', 'frequent starts'), 'virkning-tips': T('pådrag uten effekt', 'no effect'), driftstid: T('utenfor driftstid', 'outside schedule'),
    sykluser: T('starter ofte', 'starts often'), virkning: T('pådrag uten effekt', 'no effect'), 'endret-id': T('nytt enhets-ID', 'new device ID')});

  let D = null, nokkel = '', TREFF = new Set();
  const ny = (k) => ({v: 1, nokkel: k, poster: {}, monster: [], avslatt: []});
  const planNokkel = () => (typeof asNokkel === 'function' ? asNokkel() : '');
  const enhetNokkel = (ip) => {
    const d = (typeof S !== 'undefined' && S.devices || []).find((x) => x.address === ip);
    return d && d.device_instance != null ? '#' + d.device_instance : String(ip || '');
  };
  const enhetNavn = (ip) => {
    const d = (typeof S !== 'undefined' && S.devices || []).find((x) => x.address === ip);
    return (d && (d.object_name || d.device_instance)) || ip || '';
  };
  const frist = (id) => (KORT_FRIST.has(id) ? KORT : LANG);
  const postNokkel = (id, ip, objid) => `${id}|${enhetNokkel(ip)}|${objid || ''}`;
  const ord = (navn) => [...new Set(String(navn || '').replace(/([a-zæøå])([A-ZÆØÅ])/g, '$1 $2').toLowerCase().split(/[^a-z0-9æøå]+/)
    .filter((w) => w.length >= 3 && !/\d/.test(w)))];

  async function last() {
    const k = planNokkel();
    if (!k) { D = null; nokkel = ''; return; }
    if (D && k === nokkel) return;
    let d = null;
    try { d = (await (await fetch('/api/laering?nokkel=' + encodeURIComponent(k), {cache: 'no-store'})).json()).data; } catch { /* a clean slate is better than none */ }
    D = d && d.v === 1 && d.nokkel === k && d.poster && typeof d.poster === 'object' ? {...ny(k), ...d} : ny(k);
    nokkel = k;
  }
  async function lagre() {
    if (!D) return true;
    try { const r = await api('/api/laering', {nokkel: D.nokkel, data: D}); return r.status === 'done'; } catch { return false; }
  }

  /* Is this point set aside for this kind of suggestion? Called for the few points a suggestion would list, not for every point. */
  function skjult(id, ip, objid, navn) {
    if (!D || !LAERBAR.has(id)) return false;
    const nu = Date.now();
    const x = D.poster[postNokkel(id, ip, objid)];
    let treff = !!(x && x.til > nu);
    if (!treff && navn && D.monster.length) {
      const o = ord(navn);
      treff = D.monster.some((m) => m.id === id && m.til > nu && o.includes(m.ord));
    }
    if (treff) TREFF.add(`${id}|${enhetNokkel(ip)}|${objid || ''}`);
    return treff;
  }
  const nullstillTreff = () => { TREFF = new Set(); };
  const treff = () => TREFF.size;

  /* rader: [{ip, objid, pts: [{o, n}]}] from one suggestion. A row with points sets aside those points, a row without one sets aside the device. */
  async function laerPunkter(id, rader, grunn) {
    if (!LAERBAR.has(id)) return false;
    if (!D) D = ny(planNokkel());
    const nu = Date.now();
    for (const r of rader) {
      const pts = r.pts && r.pts.length ? r.pts : [{o: r.objid || '', n: ''}];
      for (const p of pts) {
        D.poster[postNokkel(id, r.ip, p.o)] = {id, o: p.o || '', n: p.n || '', e: enhetNokkel(r.ip), en: enhetNavn(r.ip), g: grunn || 'vilje', t: nu, til: nu + frist(id)};
      }
    }
    return lagre();
  }
  async function angre(nok) { if (D && D.poster[nok]) { delete D.poster[nok]; return lagre(); } return true; }

  /* A word shared by three or more of the points that have been set aside, and what it would take with it here */
  function monsterFor(id, rader) {
    if (!D || !LAERBAR.has(id)) return null;
    const nu = Date.now(), tell = new Map();
    for (const x of Object.values(D.poster)) if (x.id === id && x.til > nu && x.n) for (const w of ord(x.n)) tell.set(w, (tell.get(w) || 0) + 1);
    let best = null;
    for (const [w, n] of tell) {
      if (n < 3 || D.avslatt.includes(`${id}|${w}`) || D.monster.some((m) => m.id === id && m.ord === w)) continue;
      const flere = (rader || []).reduce((s, r) => s + (r.pts || []).filter((p) => ord(p.n).includes(w)).length, 0);
      if (flere && (!best || flere > best.flere)) best = {id, ord: w, laert: n, flere};
    }
    return best;
  }
  async function taMonster(id, w, grunn) {
    if (!D) return false;
    const nu = Date.now();
    D.monster.push({id, ord: w, g: grunn || 'vilje', t: nu, til: nu + frist(id)});
    return lagre();
  }
  async function avslaMonster(id, w) { if (D && !D.avslatt.includes(`${id}|${w}`)) { D.avslatt.push(`${id}|${w}`); return lagre(); } return true; }
  async function angreMonster(id, w) { if (D) { D.monster = D.monster.filter((m) => !(m.id === id && m.ord === w)); return lagre(); } return true; }

  /* What NABE has been told, for the list the technician can read and undo */
  function liste() {
    if (!D) return [];
    const nu = Date.now(), ut = [];
    for (const [nok, x] of Object.entries(D.poster)) ut.push({art: 'punkt', nok, id: x.id, navn: x.n || (x.o ? x.o : T('hele enheten', 'the whole device')), enhet: x.en, g: x.g, t: x.t, til: x.til, utlopt: x.til <= nu});
    for (const m of D.monster) ut.push({art: 'monster', nok: `${m.id}|${m.ord}`, id: m.id, ord: m.ord, g: m.g, t: m.t, til: m.til, utlopt: m.til <= nu});
    return ut.sort((a, b) => (a.art === b.art ? b.t - a.t : a.art === 'monster' ? -1 : 1));
  }
  const antall = () => (D ? Object.keys(D.poster).length + D.monster.length : 0);

  window.nabeLaer = {last, skjult, nullstillTreff, treff, laer: laerPunkter, angre, monsterFor, taMonster, avslaMonster, angreMonster, liste, antall,
    laerbar: (id) => LAERBAR.has(id), grunner: GRUNNER, typer: TYPER, ord, siste: () => D, tilbakestill: () => { D = null; nokkel = ''; }};
})();
