/* NABE - the simulator.

   A site you have read, run as BACnet devices on this PC: the same names,
   descriptions, units and values, on 127.0.0.2 and up. For practice, for
   showing what NABE does without a plant, and for trying the name check and
   the hunting detector without a VPN. It is a snapshot of what NABE has read,
   saved so it can be started again later with no plant in reach.

   While it runs the status bar says SIMULATOR, and the devices say so too, so
   nobody mistakes it for a plant. What is written to it is not remembered as an
   override, and it is never remembered as a site. */
'use strict';

(function simulator() {
  let sim = {kjorer: false, filer: []};

  const lag = document.createElement('div');
  lag.id = 'simOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  // The reminder in the status bar, for as long as it runs.
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'sbSim';
  chip.className = 'sb-item sb-sim';
  chip.hidden = true;
  chip.textContent = 'SIMULATOR';
  chip.title = T('Simulatoren går. Enhetene på 127.0.0.x er ikke et anlegg', 'The simulator is running. The devices on 127.0.0.x are not a plant');
  chip.onclick = () => window.aapneSimulator();
  document.querySelector('.statusbar')?.prepend(chip);

  const erSim = (adr) => String(adr || '').startsWith('127.');
  const dato = (t) => t ? new Date(t * 1000).toLocaleString(SPRAAK === 'en' ? 'en-GB' : 'no', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : '';

  async function hent() {
    try { sim = await (await fetch('/api/sim', {cache: 'no-store'})).json(); } catch { sim = {kjorer: false, filer: []}; }
    S.sim = sim;
    chip.hidden = !sim.kjorer;
    return sim;
  }

  /* The snapshot of what has been read: only what identifies a device and what a
     point is and says, not NABE's own bookkeeping. */
  function bygg(adresser) {
    return adresser.map(ip => {
      const d = S.devices.find(x => x.address === ip) || {};
      return {
        address: ip, device_instance: d.device_instance, object_name: d.object_name || null,
        vendor_name: d.vendor_name || null, vendor_id: d.vendor_id ?? null,
        punkter: (S.cache[ip] || []).map(p => ({
          objid: p.objid, type: p.type, instance: p.instance, name: p.name, description: p.description,
          units: p.units, value: p.value, state_text: p.state_text,
        })),
      };
    }).filter(e => e.device_instance != null && e.punkter.length);
  }

  const leste = () => S.devices.filter(d => S.cache[d.address] && S.cache[d.address].length && !erSim(d.address));
  const antallPkt = (e) => (e.punkter || []).length;

  function tegn() {
    const kropp = sim.kjorer ? kjorer() : ledig();
    lag.innerHTML = `<div class="gs-modal sim-modal"><div class="gs-head"><span class="gd-tittel">${T('Simulator', 'Simulator')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sim-kropp">${kropp}</div></div>`;
  }

  function kjorer() {
    const rader = (sim.enheter || []).map(e => `<tr><td class="mono">${esc(e.address)}</td><td>${esc(e.navn || '')}</td>
      <td class="sp-meta">${esc(e.original || '')}</td><td class="t">${e.punkter}</td></tr>`).join('');
    return `<div><div class="sim-h">${T('Simulatoren går', 'The simulator is running')} · ${esc(sim.navn || '')}</div>
      <div class="sp-meta">${T(`${(sim.enheter || []).length} enheter. Navn, beskrivelser og verdier er fra anlegget som ble lest`,
                              `${(sim.enheter || []).length} devices. Names, descriptions and values are from the site that was read`)}</div></div>
      <div class="sim-omr"><span>${T('Skann', 'Scan')} <code>${esc(sim.omrade || '')}</code></span>
        <button type="button" class="btn primary" data-sim="skann">${T('Skann simulatoren', 'Scan the simulator')}</button></div>
      <div class="sp-rull"><table class="sp-tab"><thead><tr><th>${T('Adresse', 'Address')}</th><th>${T('Navn', 'Name')}</th>
        <th>${T('Fra', 'From')}</th><th class="t">${T('Punkter', 'Points')}</th></tr></thead><tbody>${rader}</tbody></table></div>
      <div class="sim-knapper"><button type="button" class="btn" data-sim="stopp">${T('Stopp simulatoren', 'Stop the simulator')}</button></div>`;
  }

  function ledig() {
    const l = leste();
    const fraLest = l.length
      ? `${l.map(d => `<label class="sim-rad"><input type="checkbox" data-ip="${esc(d.address)}" checked>
          <span>${esc(d.object_name || String(d.device_instance))}</span>
          <span class="sp-meta">${esc(d.address)} · ${S.cache[d.address].length} ${T('punkter', 'points')}</span></label>`).join('')}
        <label class="sim-felt"><span>${T('Navn', 'Name')}</span><input id="simNavn" class="field" style="width:240px" value="${esc(l[0].object_name || '')}"></label>
        <label class="sim-felt"><span>${T('La sløyfer pendle (RT og SB)', 'Let loops hunt (RT and SB)')}</span><input type="checkbox" id="simPend"></label>
        <div class="sim-knapper"><button type="button" class="btn primary" data-sim="start">${T('Start simulator', 'Start simulator')}</button></div>`
      : `<p class="op-tekst">${T('Les en enhet først, så kan den simuleres. Eller start en lagret simulering under.', 'Read a device first and it can be simulated. Or start a saved one below.')}</p>`;
    const lagret = (sim.filer || []).length
      ? (sim.filer || []).map(f => `<div class="sim-lagret"><span>${esc(f.navn || f.fil)}</span>
          <span class="sp-meta">${f.enheter} ${T('enheter', 'devices')} · ${f.punkter} ${T('punkter', 'points')} · ${esc(dato(f.t))}</span>
          <span style="margin-left:auto;display:flex;gap:6px"><button type="button" class="btn" data-sim="fil" data-fil="${esc(f.fil)}">${T('Start', 'Start')}</button>
          <button type="button" class="btn" data-sim="slett" data-fil="${esc(f.fil)}" title="${T('Slett', 'Delete')}">✕</button></span></div>`).join('')
      : `<p class="op-tekst">${T('Ingen lagrede simuleringer ennå. Hver simulering du starter lagres her.', 'No saved simulations yet. Every simulation you start is saved here.')}</p>`;
    return `<div class="sim-h">${T('Fra enhetene du har lest', 'From the devices you have read')}</div>${fraLest}
      <div class="sim-h">${T('Lagrede simuleringer', 'Saved simulations')}</div>${lagret}`;
  }

  async function start(body) {
    const r = await api('/api/sim/start', body);
    if (r.status !== 'done') { toast(r.error || T('Fikk ikke startet simulatoren', 'Could not start the simulator'), true); return; }
    await hent();
    // The loopback is an adapter now; the page has to know it.
    if (typeof loadInterfaces === 'function') await loadInterfaces();
    await refreshStatus();
    toast(T(`Simulatoren går: ${(r.enheter || []).length} enheter på ${r.omrade}`, `The simulator is running: ${(r.enheter || []).length} devices on ${r.omrade}`));
    tegn();
  }

  async function stopp() {
    await api('/api/sim/stopp', {});
    // What was found there goes with it.
    const igjen = S.devices.filter(d => !erSim(d.address));
    if (!igjen.length) clearDiscovery();
    else { S.devices = igjen; if (S.activeDev && erSim(S.activeDev.address)) clearDiscovery(); renderDevices(); }
    await hent();
    if (typeof loadInterfaces === 'function') await loadInterfaces();
    await refreshStatus();
    toast(T('Simulatoren er stoppet', 'The simulator is stopped'));
    tegn();
  }

  function skann() {
    lag.hidden = true;
    const ri = $('rangeInput');
    ri.value = sim.omrade;
    ri.dispatchEvent(new Event('input', {bubbles: true}));
    // A quick sweep: broadcasts do not reach 127.0.0.x, the devices answer a direct question.
    if ([...$('modeSel').options].some(o => o.value === 'unicast_fast')) {
      $('modeSel').value = 'unicast_fast';
      $('modeSel').dispatchEvent(new Event('change'));
    }
    (async () => {
      if (!S.connected && typeof connectTo === 'function') await connectTo('127.0.0.1/8', {quiet: true});
      $('scanBtn').click();
    })();
  }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const k = e.target.closest('[data-sim]');
    if (!k) return;
    const hva = k.dataset.sim;
    if (hva === 'start') {
      const valgte = [...lag.querySelectorAll('input[data-ip]:checked')].map(x => x.dataset.ip);
      const enheter = bygg(valgte);
      if (!enheter.length) { toast(T('Velg minst én enhet', 'Choose at least one device'), true); return; }
      await start({navn: $('simNavn')?.value.trim() || '', enheter, pendling: !!$('simPend')?.checked});
    } else if (hva === 'fil') await start({fil: k.dataset.fil, pendling: false});
    else if (hva === 'slett') { await api('/api/sim/slett', {fil: k.dataset.fil}); await hent(); tegn(); }
    else if (hva === 'stopp') await stopp();
    else if (hva === 'skann') skann();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); }
  }, true);

  window.aapneSimulator = async () => { await hent(); tegn(); lag.hidden = false; };
  window.nabeSimulator = {bygg};      // for the self-test
  if ($('simBtn')) $('simBtn').onclick = () => { closeMenus(); window.aapneSimulator(); };

  // What the server says is running, now and whenever the page asks it for its status.
  hent();
  etter('refreshStatus', () => {
    const kjorer = !!(S.sim && S.sim.kjorer);
    chip.hidden = !kjorer;
    if (!kjorer) { sim.kjorer = false; sim.enheter = []; sim.omrade = ''; }
  });
})();
