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
              <td style="white-space:nowrap">${tilordning[d.address] ? `<button type="button" class="btn" data-kx="lesalle" data-adr="${esc(d.address)}"${d.secure || !d.tunnelling ? ' disabled' : ''} title="${esc(T('Spør bussen én gang om hver gruppeadresse som har lesefanen på, fem i sekundet', 'Asks the bus once for each group address with the read flag on, five a second'))}">${T('Les alle lesbare', 'Read all readable')}</button> ` : ''}<button type="button" class="btn" data-kx="monitor" data-adr="${esc(d.address)}"${d.secure || !d.tunnelling ? ' disabled' : ''} title="${esc(T('Viser hvem som sier hva på bussen nå, slik ETS sin gruppemonitor gjør', 'Shows who says what on the bus right now, like the ETS group monitor'))}">${T('Monitor', 'Monitor')}</button>
                <button type="button" class="btn" data-kx="aapne" data-adr="${esc(d.address)}"${d.secure || !d.tunnelling ? ' disabled' : ''}>${T('Åpne', 'Open')}</button></td></tr>`).join('')}</tbody></table>`
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

  async function lesAlle(adr) {
    const liste = lister.find(l => l.id === tilordning[adr]);
    const n = liste ? liste.lesbare : 0;
    if (!n) { sett(T('Ingen adresser i lista har lesefanen på, så det er ingenting å spørre om.', 'No address in the list has the read flag on, so there is nothing to ask for.')); return; }
    const min = Math.ceil(n / 5 / 60);
    if (!await nabeBekreft(T(`Dette spør bussen om ${n} gruppeadresser, fem i sekundet, og tar omtrent ${min} min. Hver spørring er ett telegram på bussen. Fortsette?`, `This asks the bus for ${n} group addresses, five a second, and takes about ${min} min. Each request is one telegram on the bus. Continue?`), {ok: T('Spør', 'Ask')})) return;
    sett(T('Spør bussen …', 'Asking the bus …'));
    try {
      const start = await api2('/api/knx/les-alle', {address: adr});
      if (start.status !== 'started') throw new Error(start.error || T('Feilet', 'Failed'));
      for (;;) {
        await new Promise(r => setTimeout(r, 1000));
        const j = await api2('/api/job/' + start.job_id);
        if (j.status === 'running') { sett(`${j.phase || ''} ${j.done || 0}/${j.total || 0}`.trim()); continue; }
        if (j.status === 'error') throw new Error(j.error || T('Feilet', 'Failed'));
        const r = j.result || {};
        sett(T(`Spurte ${r.spurt} adresser og fikk verdi fra ${r.nye_verdier} til.`, `Asked ${r.spurt} addresses and got a value from ${r.nye_verdier} more.`));
        delete S.cache[adr];
        if (S.activeDev && S.activeDev.address === adr) selectDevice(adr, {force: true});
        break;
      }
    } catch (e) { sett(e.message); }
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

  /* A group monitor: every telegram the tunnel hears, with the source, the group address and its ETS name, and what it says. */
  const mon = document.createElement('div');
  mon.id = 'knxMonOverlay';
  mon.className = 'gs-overlay';
  mon.setAttribute('role', 'dialog');
  mon.setAttribute('aria-modal', 'true');
  mon.hidden = true;
  document.body.append(mon);
  let monAdr = '', monSeq = 0, monRader = [], monPause = false, monTimer = 0, monFilter = '';
  const monTid = (t) => { const d = new Date(t * 1000); return d.toLocaleTimeString('no', {hour12: false}) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
  function monTegn() {
    const q = monFilter.trim().toLowerCase();
    const rader = monRader.filter(r => !q || (r.ga + ' ' + r.navn + ' ' + r.kilde).toLowerCase().includes(q));
    const tb = $('kxMonRader');
    if (!tb) return;
    tb.innerHTML = rader.slice(-300).reverse().map(r => `<tr><td class="tr-mono">${esc(monTid(r.t))}</td><td class="tr-mono">${esc(r.kilde)}</td><td class="tr-mono">${esc(r.ga)}</td>
      <td>${esc(r.navn)}</td><td class="sp-meta">${esc(r.type === 'write' ? T('skriver', 'writes') : r.type === 'response' ? T('svarer', 'answers') : T('spør', 'asks'))}</td>
      <td class="tr-mono">${r.type === 'read' ? '' : esc(String(r.verdi === null || r.verdi === undefined ? r.raa : r.verdi)) + (r.enhet ? ' ' + esc(r.enhet) : '')}${r.gjettet ? ' <span class="sp-meta">?</span>' : ''}</td></tr>`).join('');
    $('kxMonAnt').textContent = T(`${rader.length} av ${monRader.length}`, `${rader.length} of ${monRader.length}`);
    const p = $('kxMonPause'); if (p) p.textContent = monPause ? T('Fortsett', 'Resume') : T('Pause', 'Pause');
  }
  async function monHent() {
    if (mon.hidden) { clearInterval(monTimer); monTimer = 0; return; }
    if (monPause) return;
    try {
      const d = await api2('/api/knx/monitor?address=' + encodeURIComponent(monAdr) + '&etter=' + monSeq);
      if (d.status === 'error') { $('kxMonMelding').textContent = d.error; return; }
      $('kxMonMelding').textContent = '';
      monSeq = d.seq; monRader = monRader.concat(d.rader).slice(-3000);
      monTegn();
    } catch { /* the next tick tries again */ }
  }
  window.aapneMonitor = (adr) => {
    monAdr = adr; monSeq = 0; monRader = []; monPause = false; monFilter = '';
    mon.innerHTML = `<div class="gs-modal sp-modal tr-modal"><div class="gs-head"><span class="gd-tittel">${T('KNX-monitor', 'KNX monitor')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp"><div class="sp-topp"><span id="kxMonAnt"></span><span class="tr-filter"><input class="field" id="kxMonFilter" placeholder="${T('Filter: adresse, navn eller kilde', 'Filter: address, name or source')}" spellcheck="false"></span></div>
        <div class="sp-meta" id="kxMonMelding"></div>
        <div class="sp-rull"><table class="sp-tab"><thead><tr><th>${T('Tid', 'Time')}</th><th>${T('Kilde', 'Source')}</th><th>${T('Adresse', 'Address')}</th><th>${T('Navn', 'Name')}</th><th></th><th>${T('Verdi', 'Value')}</th></tr></thead><tbody id="kxMonRader"></tbody></table></div>
        <div class="op-knapper"><button type="button" class="btn" id="kxMonPause"></button><button type="button" class="btn" id="kxMonTom">${T('Tøm', 'Clear')}</button></div></div></div>`;
    mon.hidden = false;
    monTegn();
    monHent();
    clearInterval(monTimer); monTimer = setInterval(monHent, 1500);
  };
  mon.addEventListener('click', (e) => {
    if (e.target === mon || e.target.closest('.gs-close')) { mon.hidden = true; clearInterval(monTimer); monTimer = 0; }
    else if (e.target.id === 'kxMonPause') { monPause = !monPause; monTegn(); }
    else if (e.target.id === 'kxMonTom') { monRader = []; monTegn(); }
  });
  mon.addEventListener('input', (e) => { if (e.target.id === 'kxMonFilter') { monFilter = e.target.value; monTegn(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mon.hidden) { mon.hidden = true; e.stopPropagation(); } }, true);

  const lukk = () => { lag.hidden = true; };
  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const b = e.target.closest('[data-kx]');
    if (!b || b.disabled) return;
    const k = b.dataset.kx;
    if (k === 'skann') skann();
    else if (k === 'importer') $('kxFil').click();
    else if (k === 'lesalle') lesAlle(b.dataset.adr);
    else if (k === 'monitor') aapneMonitor(b.dataset.adr);
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
