/* NABE - BACnet, Modbus and KNX side by side.

   Three things sit in plain view instead of in a settings page:

   1. Under the scan field, three switches say what a scan looks for: BACnet, Modbus (port 502), KNX (UDP 3671).
      All on by default, so a building is scanned once. At least one stays on.
   2. Above the device list, a filter shows everything or one protocol, with the count of each. It appears when the
      list holds more than one.
   3. On a device row that lacks something, the action stands on the row: a KNX gateway with no ETS list says so and
      has an Import button, a Modbus device showing raw registers has a register map button and an Explore button.

   Everything is read only, as before. The windows under the menu (Modbus…, KNX…) stay for what none of this reaches:
   a serial port, a gateway on another port, routing, the full lists. */
'use strict';

(function protokoller() {
  const api2 = async (sti, kropp) => {
    const r = await fetch(sti, kropp === undefined ? {cache: 'no-store'}
      : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(kropp)});
    return r.json();
  };
  const PROT = [['bacnet', 'BACnet'], ['modbus', 'Modbus'], ['knx', 'KNX']];
  const paa = (p) => loadPrefs().protSok !== false && loadPrefs()['prot' + p[0].toUpperCase() + p.slice(1)] !== false;
  const protAv = (d) => d.protocol === 'modbus' ? 'modbus' : d.protocol === 'knx' ? 'knx' : 'bacnet';
  let stopp = false;

  /* ------------------------------------------------ 1. what a scan looks for */
  function tegnVal() {
    const el = $('protVal');
    if (!el) return;
    el.innerHTML = PROT.map(([id, navn]) => `<button type="button" data-val="${id}" role="switch" aria-checked="${paa(id)}" class="${paa(id) ? 'on' : ''}"
      title="${esc(id === 'bacnet' ? T('Leter etter BACnet-enheter', 'Looks for BACnet devices')
        : id === 'modbus' ? T('Leter etter Modbus TCP på port 502. Bare lesing', 'Looks for Modbus TCP on port 502. Read only')
        : T('Leter etter KNX-gatewayer på UDP 3671. Kobler ikke til noe', 'Looks for KNX gateways on UDP 3671. Connects to nothing'))}"><i></i>${navn}</button>`).join('');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#protVal [data-val]');
    if (!b) return;
    const id = b.dataset.val;
    const naa = PROT.filter(([p]) => paa(p)).map(([p]) => p);
    if (paa(id) && naa.length === 1) { toast(T('Minst én må stå på', 'At least one has to stay on'), true); return; }
    // The old single switch is gone: leaving it as it was would switch Modbus and KNX off for good
    savePrefs({protSok: true, ['prot' + id[0].toUpperCase() + id.slice(1)]: !paa(id)});
    tegnVal();
  });

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
    const mb = paa('modbus'), kx = paa('knx');
    if (!omraader || !omraader.length || (!mb && !kx)) return {modbus: 0, knx: 0};
    stopp = false;
    let nMb = 0, nKx = 0;
    if (melding) melding(T('Søker også etter Modbus og KNX …', 'Also looking for Modbus and KNX …'));
    for (const omr of omraader) {
      if (stopp) break;
      const [a, b] = await Promise.all([
        mb ? ett('/api/modbus/scan', {subnet: omr, port: 502}, omr).catch(() => []) : [],
        kx ? ett('/api/knx/scan', {subnet: omr, port: 3671, timeout: 2.0}, omr).catch(() => []) : [],
      ]);
      nMb += a.length; nKx += b.length;
      if (a.length || b.length) renderDevices();
    }
    if (nMb || nKx) {
      const deler = [];
      if (nMb) deler.push(T(`${nMb} Modbus-enhet${nMb === 1 ? '' : 'er'}`, `${nMb} Modbus device${nMb === 1 ? '' : 's'}`));
      if (nKx) deler.push(T(`${nKx} KNX-gateway${nKx === 1 ? '' : 'er'}`, `${nKx} KNX gateway${nKx === 1 ? '' : 's'}`));
      toast(T('Fant også ', 'Also found ') + deler.join(T(' og ', ' and ')));
    }
    return {modbus: nMb, knx: nKx};
  };

  // Stopping the scan stops the wait for these two as well
  const gammel = window.cancelScan;
  if (typeof gammel === 'function') window.cancelScan = function () { stopp = true; return gammel.apply(this, arguments); };

  /* ------------------------------------------------ 2. filter above the list */
  let filter = 'alle';
  window.nabeProtOK = (d) => filter === 'alle' || protAv(d) === filter;
  window.nabeProtFilterTegn = function () {
    const el = $('protFilter');
    if (!el) return;
    const tall = {bacnet: 0, modbus: 0, knx: 0};
    for (const d of S.devices) tall[protAv(d)]++;
    const flere = PROT.filter(([p]) => tall[p]).length > 1;
    if (!flere) filter = 'alle';
    el.hidden = !flere;
    if (!flere) return;
    if (filter !== 'alle' && !tall[filter]) filter = 'alle';
    el.innerHTML = [['alle', T('Alle', 'All'), S.devices.length], ...PROT.filter(([p]) => tall[p]).map(([p, n]) => [p, n, tall[p]])]
      .map(([id, navn, n]) => `<button type="button" data-filter="${id}" class="${filter === id ? 'sel' : ''}" aria-pressed="${filter === id}">${esc(navn)} <em>${n}</em></button>`).join('');
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#protFilter [data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    renderDevices();
  });

  /* ------------------------------------------------ 3. what the row lacks */
  window.nabeProtHint = function (d) {
    if (d.protocol === 'knx' && !d.ruting_bare && window.nabeKnxHjelp && window.nabeKnxHjelp.klar() && !window.nabeKnxHjelp.harListe(d.address)) {
      return `<div class="dev-hint"><span>${T('Ingen ETS-liste, så punktene mangler navn.', 'No ETS list, so the points have no names.')}</span>
        <button type="button" data-prot="kx-import" data-adr="${esc(d.address)}">${T('Importer', 'Import')}</button></div>`;
    }
    if (d.protocol === 'modbus' && window.nabeMbHjelp && window.nabeMbHjelp.klar() && !window.nabeMbHjelp.harKart(d.address)) {
      return `<div class="dev-hint"><span>${T('Viser rå registre.', 'Showing raw registers.')}</span>
        <button type="button" data-prot="mb-kart" data-adr="${esc(d.address)}">${T('Registerkart', 'Register map')}</button>
        <button type="button" data-prot="mb-utforsk" data-adr="${esc(d.address)}">${T('Utforsk', 'Explore')}</button></div>`;
    }
    return '';
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-prot]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const adr = b.dataset.adr;
    if (b.dataset.prot === 'kx-import') window.nabeKnxHjelp.importer(adr);
    else if (b.dataset.prot === 'mb-kart') window.nabeMbHjelp.importer(adr);
    else if (b.dataset.prot === 'mb-utforsk') window.nabeMbHjelp.utforsk(adr);
  }, true);

  tegnVal();
})();
