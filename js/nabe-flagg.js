/* NABE - fresh flags.

   The status flags of a point are read once, when the device is opened. A fault
   that came up while a controller was starting stayed on screen after it had
   cleared, and an alarm that came later was not there at all. While Live runs,
   the flagged points and the ones on screen are read again every twenty seconds,
   with the reason for each flag: the reliability behind a fault, the event state
   behind an alarm. The table changes only when something did. */
'use strict';

(function flagg() {
  let sist = 0, opptatt = false;

  async function oppdater() {
    const ip = S.activeDev.address, pts = S.points;
    if (!pts.length) return;
    const flagget = pts.filter(p => hasFlag(p, 'fault') || hasFlag(p, 'in-alarm')).map(p => p.objid).slice(0, 100);
    const synlige = visiblePoints().slice(0, 150).map(p => p.objid);
    const ider = [...new Set([...flagget, ...synlige])].slice(0, 250);
    if (!ider.length) return;
    const d = await api('/api/device/flagg', {address: ip, objids: ider});
    if (!d || d.status !== 'done' || !S.activeDev || S.activeDev.address !== ip) return;
    let endret = 0;
    for (const [objid, f] of Object.entries(d.flagg || {})) {
      const p = S.pointIndex.get(objid);
      // A flag that could not be read says nothing: it is never taken as "cleared".
      if (!p || !f.lest) continue;
      const grunn = (x) => [x.reliability, x.event_state, x.alarm_value].join('|');
      const nytt = f.status.join(','), gammelt = (p.status || []).join(',');
      if (nytt !== gammelt || (f.status.length && grunn(f) !== grunn(p))) {
        p.status = f.status;
        p.status_lest = true;
        p.reliability = f.reliability;
        p.event_state = f.event_state;
        p.alarm_value = f.alarm_value;
        endret++;
      }
    }
    if (endret) {
      renderPoints();
      renderDevices();
      if (typeof renderCtx === 'function') renderCtx();
      if (typeof tegnAnlegg === 'function') tegnAnlegg();
      if (S.selected && typeof renderInspector === 'function') renderInspector();
    }
  }

  etter('pollTick', async () => {
    if (!S.live || !S.activeDev || opptatt || Date.now() - sist < 20000) return;
    opptatt = true;
    sist = Date.now();
    try { await oppdater(); } catch { /* the next round tries again */ } finally { opptatt = false; }
  });
})();
