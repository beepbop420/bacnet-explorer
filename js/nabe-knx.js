/* NABE - KNX.
   KNXnet/IP gateways next to the BACnet devices, read only. A scan finds the gateways with a description request
   (it connects to nothing); the group addresses and their names come from the ETS project, imported here as the
   project file or as the CSV export; and from then on the gateway is in the list like any other. NABE holds one
   tunnel and listens to the bus, so values arrive as they change. It sends nothing but reads, at five a second.
   Without an ETS list the group addresses heard on the bus are shown as they are. Opened from the ⋯ menu or the
   palette. Nothing here writes to a plant. */
'use strict';

(function knx() {
  let lister = [], tilordning = {}, melding = '', opptatt = false;

  const lag = document.createElement('div');
  lag.id = 'knxOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const gatewayer = () => S.devices.filter(d => d.protocol === 'knx');
  const api2 = async (sti, kropp) => {
    const r = await fetch(sti, kropp === undefined ? {cache: 'no-store'}
      : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(kropp)});
    return r.json();
  };
  const base64 = (buf) => {
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };

  async function hentLister() {
    try {
      const d = await api2('/api/knx/lister');
      if (d.status === 'done') { lister = d.lister; tilordning = d.tilordning; }
    } catch { /* the next open tries again */ }
  }

  function tegn() {
    const enheter = gatewayer();
    const valg = (adr) => `<option value="">${T('Ingen (hørt på bussen)', 'None (heard on the bus)')}</option>`
      + lister.map(k => `<option value="${esc(k.id)}"${tilordning[adr] === k.id ? ' selected' : ''}>${esc(k.name)} (${k.points})</option>`).join('');
    lag.innerHTML = `<div class="gs-modal sp-modal mb-modal"><div class="gs-head"><span class="gd-tittel">KNX</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp">
        <div class="mb-sek"><div class="mb-tittel">${T('Skann etter KNX-gatewayer', 'Scan for KNX gateways')}</div>
          <div class="sp-meta">${T('Finner KNXnet/IP-gatewayer på UDP 3671 med en beskrivelsesforespørsel. Kobler ikke til noe.', 'Finds KNXnet/IP gateways on UDP 3671 with a description request. Connects to nothing.')}</div>
          <div class="mb-rad"><input class="field" id="kxOmraade" placeholder="10.0.0.0/24" value="${esc(localStorage.getItem('nabe.kxOmraade') || ($('rangeInput') ? $('rangeInput').value.split(/[\\s,;]+/)[0] : ''))}" spellcheck="false">
            <input class="field mb-port" id="kxPort" value="3671" inputmode="numeric" aria-label="Port">
            <button type="button" class="btn primary" data-kx="skann"${opptatt ? ' disabled' : ''}>${opptatt ? T('Skanner …', 'Scanning …') : T('Skann', 'Scan')}</button></div>
          <div class="sp-meta" id="kxMelding">${esc(melding)}</div></div>
        <div class="mb-sek"><div class="mb-tittel">${T('Gatewayer', 'Gateways')} <span class="sp-meta">${enheter.length}</span></div>
          ${enheter.length ? `<table class="sp-tab"><thead><tr><th>${T('Gateway', 'Gateway')}</th><th>${T('Adresse', 'Address')}</th><th>${T('ETS-liste', 'ETS list')}</th><th></th></tr></thead><tbody>
            ${enheter.map(d => `<tr><td>${esc(d.object_name || '')}<div class="sp-meta">${esc(d.knx_address || '')}${d.secure ? ' · ' + T('KNX Secure: støttes ikke', 'KNX Secure: not supported') : ''}${!d.tunnelling ? ' · ' + T('ingen tunnel', 'no tunnelling') : ''}</div></td>
              <td class="tr-mono">${esc(d.ip)}:${d.port}</td>
              <td><select class="field mb-kart" data-adr="${esc(d.address)}">${valg(d.address)}</select></td>
              <td><button type="button" class="btn" data-kx="aapne" data-adr="${esc(d.address)}"${d.secure || !d.tunnelling ? ' disabled' : ''}>${T('Åpne', 'Open')}</button></td></tr>`).join('')}</tbody></table>`
            : `<div class="sp-meta">${T('Ingen KNX-gatewayer ennå. Skann over.', 'No KNX gateways yet. Scan above.')}</div>`}</div>
        <div class="mb-sek"><div class="mb-tittel">${T('ETS-lister', 'ETS lists')} <span class="sp-meta">${lister.length}</span></div>
          <div class="sp-meta">${T('Gruppeadressene fra ETS gir punktene navn og datapunkttype. Importer prosjektfilen (.knxproj, uten passord) eller CSV-eksporten av gruppeadresser.', 'The group addresses from ETS give the points a name and a datapoint type. Import the project file (.knxproj, no password) or the CSV export of group addresses.')}</div>
          ${lister.length ? `<table class="sp-tab"><tbody>${lister.map(k => `<tr><td>${esc(k.name)}</td><td class="sp-meta">${k.points} ${T('gruppeadresser', 'group addresses')}</td>
            <td style="text-align:right"><button type="button" class="btn" data-kx="slett" data-id="${esc(k.id)}">${T('Slett', 'Delete')}</button></td></tr>`).join('')}</tbody></table>` : ''}
          <div class="op-knapper"><button type="button" class="btn primary" data-kx="importer">${T('Importer ETS-liste …', 'Import ETS list …')}</button></div>
          <input type="file" id="kxFil" accept=".knxproj,.csv,.txt,.zip" hidden></div>
      </div></div>`;
  }

  function sett(msg) { melding = msg; const e = $('kxMelding'); if (e) e.textContent = msg; }

  async function skann() {
    const omr = ($('kxOmraade').value || '').trim();
    const port = parseInt($('kxPort').value, 10) || 3671;
    if (!omr) { sett(T('Skriv inn et IP-område.', 'Enter an IP range.')); return; }
    try { localStorage.setItem('nabe.kxOmraade', omr); } catch { /* private window */ }
    opptatt = true; sett(T('Skanner UDP ', 'Scanning UDP ') + port + ' …'); tegn();
    try {
      const start = await api2('/api/knx/scan', {subnet: omr, port});
      if (start.status !== 'started') throw new Error(start.error || T('Skann feilet', 'Scan failed'));
      for (;;) {
        await new Promise(r => setTimeout(r, 400));
        const j = await api2('/api/job/' + start.job_id);
        if (j.status === 'running') { sett(`${j.phase || ''} ${j.done || 0}/${j.total || 0}${j.found ? ' · ' + j.found : ''}`.trim()); continue; }
        if (j.status === 'error') throw new Error(j.error || T('Skann feilet', 'Scan failed'));
        const funnet = (j.result && j.result.devices) || [];
        mergeDevices(funnet, omr);
        renderDevices();
        sett(funnet.length ? T(`Fant ${funnet.length} KNX-gatewayer.`, `Found ${funnet.length} KNX gateways.`)
          : T('Ingen KNX-gatewayer svarte. Gatewayen kan stå på en annen port, eller bak en ruter som ikke slipper UDP gjennom.', 'No KNX gateways answered. The gateway may be on another port, or behind a router that does not pass UDP.'));
        break;
      }
    } catch (e) { sett(e.message); }
    opptatt = false; tegn();
  }

  async function importer(fil) {
    if (!fil) return;
    if (fil.size > 40_000_000) { toast(T('Filen er for stor', 'The file is too large'), true); return; }
    const navn = fil.name.replace(/\.[^.]+$/, '');
    const d = await api2('/api/knx/lister', {navn, innhold: base64(await fil.arrayBuffer()), filnavn: fil.name});
    if (d.status !== 'done') { toast(d.error || T('Kunne ikke lese ETS-lista', 'Could not read the ETS list'), true); return; }
    toast(T(`ETS-lista «${navn}» importert: ${d.punkter} gruppeadresser.`, `ETS list "${navn}" imported: ${d.punkter} group addresses.`));
    await hentLister(); tegn();
  }

  async function tilordne(adr, id) {
    const d = await api2('/api/knx/tilordne', {address: adr, liste: id || null});
    if (d.status !== 'done') { toast(d.error || T('Fikk ikke tilordnet', 'Could not assign'), true); return; }
    tilordning[adr] = id || undefined;
    delete S.cache[adr];
    if (S.activeDev && S.activeDev.address === adr) selectDevice(adr, {force: true});
    toast(id ? T('ETS-lista er tilordnet. Punktene leses på nytt.', 'The ETS list is assigned. The points are read again.') : T('Gatewayen viser det som høres på bussen.', 'The gateway shows what is heard on the bus.'));
  }

  const lukk = () => { lag.hidden = true; };
  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const b = e.target.closest('[data-kx]');
    if (!b || b.disabled) return;
    const k = b.dataset.kx;
    if (k === 'skann') skann();
    else if (k === 'importer') $('kxFil').click();
    else if (k === 'aapne') { lukk(); selectDevice(b.dataset.adr); }
    else if (k === 'slett') {
      if (!await nabeBekreft(T('Slette ETS-lista? Gatewayer som bruker den viser det som høres på bussen.', 'Delete the ETS list? Gateways that use it show what is heard on the bus.'), {ok: T('Slett', 'Delete')})) return;
      await api2('/api/knx/slett', {liste: b.dataset.id});
      await hentLister(); tegn();
    }
  });
  lag.addEventListener('change', (e) => {
    if (e.target.id === 'kxFil') { importer(e.target.files[0]); e.target.value = ''; }
    else if (e.target.classList.contains('mb-kart')) tilordne(e.target.dataset.adr, e.target.value);
  });
  lag.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'kxOmraade') skann(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lukk(); e.stopPropagation(); }
  }, true);

  window.aapneKnx = async () => {
    await hentLister();
    tegn();
    lag.hidden = false;
    const f = $('kxOmraade'); if (f) f.focus();
  };
  if ($('knxBtn')) $('knxBtn').onclick = () => { closeMenus(); window.aapneKnx(); };
})();
