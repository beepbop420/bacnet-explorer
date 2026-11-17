/* NABE - Modbus.
   Modbus TCP devices next to the BACnet ones, read only. A scan finds the servers on port 502 and the units
   behind them; a register map (CSV or JSON, imported here) gives the registers their names, types, scale and
   units; and from then on the device is in the list like any other, with the same table, watch list,
   recording, export and schematic. Without a map the first registers are shown as they are, so there is
   something to see and to name. Opened from the ⋯ menu or the palette. Nothing here writes to a plant. */
'use strict';

(function modbus() {
  let kart = [], tilordning = {}, funnet = [], melding = '', opptatt = false;

  const lag = document.createElement('div');
  lag.id = 'modbusOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const MAL = 'address;function;type;name;scale;unit;description;order;bit\r\n'
    + '0;holding;s16;Temperatur;0,1;°C;Romtemperatur;;\r\n'
    + '1;holding;s16;Settpunkt;0,1;°C;Settpunkt rom;;\r\n'
    + '2;holding;u16;Varmepådrag;1;%;Pådrag varmeventil;;\r\n'
    + '3;holding;u16;Drift;;;Drift;;0\r\n'
    + '4;holding;f32;Effekt;1;kW;Effekt;CDAB;\r\n'
    + '0;coil;bool;Relé 1;;;Relé 1;;\r\n'
    + '0;input;u16;Tilstand;1;;Tilstand;;\r\n';

  const modbusEnheter = () => S.devices.filter(d => d.protocol === 'modbus');
  const api2 = async (sti, kropp) => {
    const r = await fetch(sti, kropp === undefined ? {cache: 'no-store'}
      : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(kropp)});
    return r.json();
  };

  async function hentKart() {
    try {
      const d = await api2('/api/modbus/kart');
      if (d.status === 'done') { kart = d.kart; tilordning = d.tilordning; }
    } catch { /* the next open tries again */ }
  }

  function tegn() {
    const enheter = modbusEnheter();
    const kartValg = (adr) => `<option value="">${T('Ingen (rå registre)', 'None (raw registers)')}</option>`
      + kart.map(k => `<option value="${esc(k.id)}"${tilordning[adr] === k.id ? ' selected' : ''}>${esc(k.name)} (${k.points})</option>`).join('');
    lag.innerHTML = `<div class="gs-modal sp-modal mb-modal"><div class="gs-head"><span class="gd-tittel">Modbus</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp">
        <div class="mb-sek"><div class="mb-tittel">${T('Skann etter Modbus TCP', 'Scan for Modbus TCP')}</div>
          <div class="sp-meta">${T('Finner enheter på port 502 og hva som svarer bak dem. Bare lesing.', 'Finds devices on port 502 and what answers behind them. Read only.')}</div>
          <div class="mb-rad"><input class="field" id="mbOmraade" placeholder="10.0.0.0/24" value="${esc(localStorage.getItem('nabe.mbOmraade') || ($('rangeInput') ? $('rangeInput').value.split(/[\\s,;]+/)[0] : ''))}" spellcheck="false">
            <input class="field mb-port" id="mbPort" value="502" inputmode="numeric" aria-label="Port">
            <button type="button" class="btn primary" data-mb="skann"${opptatt ? ' disabled' : ''}>${opptatt ? T('Skanner …', 'Scanning …') : T('Skann', 'Scan')}</button></div>
          <div class="sp-meta" id="mbMelding">${esc(melding)}</div></div>
        <div class="mb-sek"><div class="mb-tittel">${T('Enheter', 'Devices')} <span class="sp-meta">${enheter.length}</span></div>
          ${enheter.length ? `<table class="sp-tab"><thead><tr><th>${T('Enhet', 'Device')}</th><th>${T('Adresse', 'Address')}</th><th>${T('Registerkart', 'Register map')}</th><th></th></tr></thead><tbody>
            ${enheter.map(d => `<tr><td>${esc(d.object_name || '')}</td><td class="tr-mono">${esc(d.ip)}:${d.port} #${d.unit}</td>
              <td><select class="field mb-kart" data-adr="${esc(d.address)}">${kartValg(d.address)}</select></td>
              <td><button type="button" class="btn" data-mb="aapne" data-adr="${esc(d.address)}">${T('Åpne', 'Open')}</button></td></tr>`).join('')}</tbody></table>`
            : `<div class="sp-meta">${T('Ingen Modbus-enheter ennå. Skann over, eller gi en adresse direkte.', 'No Modbus devices yet. Scan above, or give an address directly.')}</div>`}</div>
        <div class="mb-sek"><div class="mb-tittel">${T('Registerkart', 'Register maps')} <span class="sp-meta">${kart.length}</span></div>
          <div class="sp-meta">${T('Et registerkart gir registrene navn, type, skalering og enhet. CSV med overskrifter (address, function, type, name, scale, unit, description) eller JSON.', 'A register map gives the registers a name, type, scale and unit. CSV with a header row (address, function, type, name, scale, unit, description) or JSON.')}</div>
          ${kart.length ? `<table class="sp-tab"><tbody>${kart.map(k => `<tr><td>${esc(k.name)}</td><td class="sp-meta">${k.points} ${T('punkter', 'points')}</td>
            <td style="text-align:right"><button type="button" class="btn" data-mb="slett" data-id="${esc(k.id)}">${T('Slett', 'Delete')}</button></td></tr>`).join('')}</tbody></table>` : ''}
          <div class="op-knapper"><button type="button" class="btn" data-mb="mal">${T('Last ned mal', 'Download template')}</button>
            <button type="button" class="btn primary" data-mb="importer">${T('Importer registerkart …', 'Import register map …')}</button></div>
          <input type="file" id="mbFil" accept=".csv,.json,.txt,text/csv,application/json" hidden></div>
      </div></div>`;
  }

  function sett(msg) { melding = msg; const e = $('mbMelding'); if (e) e.textContent = msg; }

  async function skann() {
    const omr = ($('mbOmraade').value || '').trim();
    const port = parseInt($('mbPort').value, 10) || 502;
    if (!omr) { sett(T('Skriv inn et IP-område.', 'Enter an IP range.')); return; }
    try { localStorage.setItem('nabe.mbOmraade', omr); } catch { /* private window */ }
    opptatt = true; sett(T('Skanner port ', 'Scanning port ') + port + ' …'); tegn();
    try {
      const start = await api2('/api/modbus/scan', {subnet: omr, port});
      if (start.status !== 'started') throw new Error(start.error || T('Skann feilet', 'Scan failed'));
      for (;;) {
        await new Promise(r => setTimeout(r, 400));
        const j = await api2('/api/job/' + start.job_id);
        if (j.status === 'running') {
          sett(`${j.phase || ''} ${j.done || 0}/${j.total || 0}${j.found ? ' · ' + j.found + ' ' + T('enheter', 'units') : ''}`.trim());
          continue;
        }
        if (j.status === 'error') throw new Error(j.error || T('Skann feilet', 'Scan failed'));
        funnet = (j.result && j.result.devices) || [];
        mergeDevices(funnet, omr);
        renderDevices();
        sett(funnet.length
          ? T(`Fant ${funnet.length} enheter på ${(j.result.open_hosts || []).length} maskiner.`, `Found ${funnet.length} units on ${(j.result.open_hosts || []).length} hosts.`)
          : T('Ingen Modbus-enheter svarte. Port 502 kan være stengt, eller enheten bruker en annen enhets-ID.', 'No Modbus devices answered. Port 502 may be closed, or the device uses another unit ID.'));
        break;
      }
    } catch (e) { sett(e.message); }
    opptatt = false; tegn();
  }

  async function importer(fil) {
    if (!fil) return;
    if (fil.size > 2_000_000) { toast(T('Filen er for stor', 'The file is too large'), true); return; }
    const tekst = await fil.text();
    const navn = fil.name.replace(/\.[^.]+$/, '');
    const d = await api2('/api/modbus/kart', {navn, tekst});
    if (d.status !== 'done') { toast(d.error || T('Kunne ikke lese registerkartet', 'Could not read the register map'), true); return; }
    toast(T(`Registerkart «${navn}» importert: ${d.punkter} punkter.`, `Register map "${navn}" imported: ${d.punkter} points.`));
    await hentKart(); tegn();
  }

  async function tilordne(adr, id) {
    const d = await api2('/api/modbus/tilordne', {address: adr, kart: id || null});
    if (d.status !== 'done') { toast(d.error || T('Fikk ikke tilordnet', 'Could not assign'), true); return; }
    tilordning[adr] = id || undefined;
    delete S.cache[adr];
    if (S.activeDev && S.activeDev.address === adr) selectDevice(adr, {force: true});
    toast(id ? T('Registerkartet er tilordnet. Punktene leses på nytt.', 'The register map is assigned. The points are read again.') : T('Enheten viser rå registre igjen.', 'The device shows raw registers again.'));
  }

  const lukk = () => { lag.hidden = true; };
  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const b = e.target.closest('[data-mb]');
    if (!b) return;
    const k = b.dataset.mb;
    if (k === 'skann') skann();
    else if (k === 'importer') $('mbFil').click();
    else if (k === 'mal') downloadText(MAL, 'nabe-modbus-registerkart-mal.csv');
    else if (k === 'aapne') { lukk(); selectDevice(b.dataset.adr); }
    else if (k === 'slett') {
      if (!await nabeBekreft(T('Slette registerkartet? Enheter som bruker det viser rå registre igjen.', 'Delete the register map? Devices that use it show raw registers again.'), {ok: T('Slett', 'Delete')})) return;
      await api2('/api/modbus/slett', {kart: b.dataset.id});
      await hentKart(); tegn();
    }
  });
  lag.addEventListener('change', (e) => {
    if (e.target.id === 'mbFil') { importer(e.target.files[0]); e.target.value = ''; }
    else if (e.target.classList.contains('mb-kart')) tilordne(e.target.dataset.adr, e.target.value);
  });
  lag.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'mbOmraade') skann(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lukk(); e.stopPropagation(); }
  }, true);

  window.aapneModbus = async () => {
    await hentKart();
    tegn();
    lag.hidden = false;
    const f = $('mbOmraade'); if (f) f.focus();
  };
  if ($('modbusBtn')) $('modbusBtn').onclick = () => { closeMenus(); window.aapneModbus(); };
})();
