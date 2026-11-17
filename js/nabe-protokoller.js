/* NABE - Modbus and KNX in the same scan as BACnet.

   A scan of a range looks for BACnet devices. When this is on (it is, by default), the same range is also
   looked through for Modbus TCP servers (port 502) and KNXnet/IP gateways (UDP 3671), and what answers
   joins the device list next to the BACnet devices. A building is scanned once.

   Both are read only, as before: a Modbus scan opens a connection and reads, a KNX scan sends a description
   request and connects to nothing. The windows under the menu (Modbus…, KNX…) stay for what a scan does not
   reach: a serial port, a gateway on another port, an ETS list, a register map. */
'use strict';

(function protokoller() {
  const api2 = async (sti, kropp) => {
    const r = await fetch(sti, kropp === undefined ? {cache: 'no-store'}
      : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(kropp)});
    return r.json();
  };
  const paa = () => loadPrefs().protSok !== false;
  let stopp = false;

  /* One range for one protocol: start the job, follow it, return the devices it found. */
  async function ett(sti, kropp, omr) {
    const start = await api2(sti, kropp);
    if (start.status !== 'started') return [];
    for (let i = 0; i < 600 && !stopp; i++) {
      await new Promise(r => setTimeout(r, 400));
      const j = await api2('/api/job/' + start.job_id);
      if (j.status === 'running') continue;
      if (j.status !== 'done') return [];
      const funnet = (j.result && j.result.devices) || [];
      mergeDevices(funnet, omr);
      return funnet;
    }
    return [];
  }

  window.skannProtokoller = async function (omraader, melding) {
    if (!paa() || !omraader || !omraader.length) return {modbus: 0, knx: 0};
    stopp = false;
    let mb = 0, kx = 0;
    if (melding) melding(T('Søker også etter Modbus og KNX …', 'Also looking for Modbus and KNX …'));
    for (const omr of omraader) {
      if (stopp) break;
      const [a, b] = await Promise.all([
        ett('/api/modbus/scan', {subnet: omr, port: 502}, omr).catch(() => []),
        ett('/api/knx/scan', {subnet: omr, port: 3671, timeout: 2.0}, omr).catch(() => []),
      ]);
      mb += a.length; kx += b.length;
      if (a.length || b.length) renderDevices();
    }
    if (mb || kx) {
      const deler = [];
      if (mb) deler.push(T(`${mb} Modbus-enhet${mb === 1 ? '' : 'er'}`, `${mb} Modbus device${mb === 1 ? '' : 's'}`));
      if (kx) deler.push(T(`${kx} KNX-gateway${kx === 1 ? '' : 'er'}`, `${kx} KNX gateway${kx === 1 ? '' : 's'}`));
      toast(T('Fant også ', 'Also found ') + deler.join(T(' og ', ' and ')));
    }
    return {modbus: mb, knx: kx};
  };

  // Stopping the scan stops the wait for these two as well
  const gammel = window.cancelScan;
  if (typeof gammel === 'function') window.cancelScan = function () { stopp = true; return gammel.apply(this, arguments); };

  const b = $('protSokBtn');
  if (b) {
    const synk = () => {
      b.classList.toggle('on', paa());
      b.setAttribute('aria-checked', String(paa()));
      $('protSokState').textContent = paa() ? T('på', 'on') : T('av', 'off');
    };
    b.onclick = () => {
      savePrefs({protSok: !paa()});
      synk();
      toast(paa() ? T('Skann leter også etter Modbus og KNX', 'A scan also looks for Modbus and KNX')
                  : T('Skann leter bare etter BACnet', 'A scan only looks for BACnet'));
    };
    synk();
  }
})();
