/* NABE - Modbus.
   Modbus TCP devices next to the BACnet ones, read only. A scan finds the servers on port 502 and the units
   behind them; a register map (CSV or JSON, imported here) gives the registers their names, types, scale and
   units; and from then on the device is in the list like any other, with the same table, watch list,
   recording, export and schematic. Without a map the first registers are shown as they are, so there is
   something to see and to name. Opened from the ⋯ menu or the palette. Nothing here writes to a plant. */
'use strict';

(function modbus() {
  let kart = [], tilordning = {}, funnet = [], melding = '', opptatt = false, notater = [], transport = 'tcp', porter = null;

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

  async function hentPorter() {
    try { porter = await api2('/api/modbus/serial/porter'); if (porter && porter.pyserial === false) sett(T('Seriell krever pyserial, som mangler i denne utgaven.', 'Serial needs pyserial, which is missing in this edition.')); } catch { porter = {porter: []}; }
    tegn();
  }

  async function hentKart() {
    try {
      const d = await api2('/api/modbus/kart');
      if (d.status === 'done') { kart = d.kart; tilordning = d.tilordning; }
    } catch { /* the next open tries again */ }
    if (klar && window.renderDevices) renderDevices();
  }
  let klar = false;

  const hjelp = () => transport === 'ser'
    ? T('Spør hver enhets-ID på bussen, én om gangen. Seriell buss har én master og går sakte, så hold området lite. Bare lesing.', 'Asks each unit ID on the bus, one at a time. A serial bus has one master and is slow, so keep the range small. Read only.')
    : transport === 'rtu'
      ? T('For en seriell gateway som slipper RTU-bytene rett gjennom (ofte port 4001 eller 502). Bare lesing.', 'For a serial gateway that passes the RTU bytes straight through (often port 4001 or 502). Read only.')
      : T('Finner enheter på port 502 og hva som svarer bak dem. Bare lesing.', 'Finds devices on port 502 and what answers behind them. Read only.');
  const enhetsliste = (t) => { const ut = new Set(); for (const del of String(t || '').split(/[,;\s]+/)) { const m = /^(\d+)(?:-(\d+))?$/.exec(del); if (!m) continue; const a = +m[1], b = +(m[2] || m[1]); for (let i = Math.max(1, a); i <= Math.min(247, b) && ut.size < 247; i++) ut.add(i); } return [...ut]; };

  function tegn() {
    const enheter = modbusEnheter();
    const kartValg = (adr) => `<option value="">${T('Ingen (rå registre)', 'None (raw registers)')}</option>`
      + kart.map(k => `<option value="${esc(k.id)}"${tilordning[adr] === k.id ? ' selected' : ''}>${esc(k.name)} (${k.points})</option>`).join('');
    lag.innerHTML = `<div class="gs-modal sp-modal mb-modal"><div class="gs-head"><span class="gd-tittel">Modbus</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp">
        <div class="mb-sek"><div class="mb-tittel">${T('Skann etter Modbus', 'Scan for Modbus')}</div>
          <div class="sp-meta" id="mbHjelp">${hjelp()}</div>
          <div class="mb-rad mb-valg"><label>${T('Forbindelse', 'Connection')}
              <select class="field" id="mbTransport"><option value="tcp"${transport === 'tcp' ? ' selected' : ''}>Modbus TCP</option><option value="rtu"${transport === 'rtu' ? ' selected' : ''}>${T('RTU over TCP (seriell gateway)', 'RTU over TCP (serial gateway)')}</option><option value="ser"${transport === 'ser' ? ' selected' : ''}>${T('Seriell port (RTU)', 'Serial port (RTU)')}</option></select></label></div>
          <div class="mb-rad mb-ser"${transport === 'ser' ? '' : ' hidden'}>
            <select class="field" id="mbCom" aria-label="${T('Port', 'Port')}">${(porter && porter.porter.length) ? porter.porter.map(p => `<option value="${esc(p.port)}">${esc(p.port)} ${esc(p.name)}</option>`).join('') : `<option value="">${T('Ingen serielle porter funnet', 'No serial ports found')}</option>`}</select>
            <select class="field" id="mbBaud" aria-label="baud">${[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map(b => `<option${b === 19200 ? ' selected' : ''}>${b}</option>`).join('')}</select>
            <select class="field" id="mbParitet" aria-label="${T('Paritet', 'Parity')}"><option value="N">8N1</option><option value="E">8E1</option><option value="O">8O1</option><option value="N2">8N2</option></select>
            <input class="field mb-port" id="mbEnheter" value="1-32" aria-label="${T('Enhets-ID', 'Unit IDs')}" spellcheck="false"></div>
          <div class="mb-rad mb-tcp"${transport === 'ser' ? ' hidden' : ''}><input class="field" id="mbOmraade" placeholder="10.0.0.0/24" value="${esc(localStorage.getItem('nabe.mbOmraade') || ($('rangeInput') ? $('rangeInput').value.split(/[\\s,;]+/)[0] : ''))}" spellcheck="false">
            <input class="field mb-port" id="mbPort" value="502" inputmode="numeric" aria-label="Port">
            <button type="button" class="btn primary" data-mb="skann"${opptatt ? ' disabled' : ''}>${opptatt ? T('Skanner …', 'Scanning …') : T('Skann', 'Scan')}</button></div>
          <div class="sp-meta" id="mbMelding">${esc(melding)}</div></div>
        <div class="mb-sek"><div class="mb-tittel">${T('Enheter', 'Devices')} <span class="sp-meta">${enheter.length}</span></div>
          ${enheter.length ? `<table class="sp-tab"><thead><tr><th>${T('Enhet', 'Device')}</th><th>${T('Adresse', 'Address')}</th><th>${T('Registerkart', 'Register map')}</th><th></th></tr></thead><tbody>
            ${enheter.map(d => `<tr><td>${esc(d.object_name || '')}</td><td class="tr-mono">${esc(d.ip)}:${d.port} #${d.unit}</td>
              <td><select class="field mb-kart" data-adr="${esc(d.address)}">${kartValg(d.address)}</select></td>
              <td style="white-space:nowrap"><button type="button" class="btn" data-mb="utforsk" data-adr="${esc(d.address)}" title="${esc(T('Modbus har ingen liste over hva enheten inneholder. Dette finner hvilke registre som svarer, så du kan gi dem navn.', 'Modbus has no list of what a device holds. This finds which registers answer, so you can name them.'))}">${T('Utforsk', 'Explore')}</button>
                <button type="button" class="btn" data-mb="aapne" data-adr="${esc(d.address)}">${T('Åpne', 'Open')}</button></td></tr>`).join('')}</tbody></table>`
            : `<div class="sp-meta">${T('Ingen Modbus-enheter ennå. Skann over, eller gi en adresse direkte.', 'No Modbus devices yet. Scan above, or give an address directly.')}</div>`}</div>
        <div class="mb-sek"><div class="mb-tittel">${T('Registerkart', 'Register maps')} <span class="sp-meta">${kart.length}</span></div>
          <div class="sp-meta">${T('Et registerkart gir registrene navn, type, skalering og enhet. CSV, Excel (.xlsx), JSON, Regin EXOL-lister og Niagara-eksport av Modbus-punkter.', 'A register map gives the registers a name, type, scale and unit. CSV, Excel (.xlsx), JSON, Regin EXOL lists and Niagara exports of Modbus points.')}</div>
          ${kart.length ? `<table class="sp-tab"><tbody>${kart.map(k => `<tr><td>${esc(k.name)}</td><td class="sp-meta">${k.points} ${T('punkter', 'points')}</td>
            <td class="mb-knapper"><button type="button" class="btn" data-mb="last" data-id="${esc(k.id)}" title="${esc(T('Last ned kartet som CSV, med endringene du har gjort i appen', 'Download the map as CSV, with the changes you made in the app'))}">${T('Last ned', 'Download')}</button>
              <button type="button" class="btn" data-mb="oppdater" data-id="${esc(k.id)}" title="${esc(T('Velg en ny versjon av filen. Endringer du har gjort selv i appen beholdes, og du får se hva som er nytt.', 'Pick a new version of the file. Changes you made yourself in the app are kept, and you see what is new.'))}">${T('Oppdater …', 'Update …')}</button>
              <button type="button" class="btn" data-mb="slett" data-id="${esc(k.id)}">${T('Slett', 'Delete')}</button></td></tr>`).join('')}</tbody></table>` : ''}
          <div class="mb-rad mb-valg"><label>${T('Adresser teller fra', 'Addresses count from')}
              <select class="field" id="mbBase"><option value="">${T('Auto', 'Auto')}</option><option value="0">0</option><option value="1">1</option></select></label>
            <label>${T('Reelle verdier (Regin R)', 'Reals (Regin R)')}
              <select class="field" id="mbSkala"><option value="0.1">× ${T('0,1', '0.1')}</option><option value="1">× 1</option><option value="0.01">× ${T('0,01', '0.01')}</option></select></label></div>
          <div class="sp-meta mb-notater" id="mbNotater">${(notater || []).map(n => `<div>${esc(n)}</div>`).join('')}</div>
          <div class="op-knapper"><button type="button" class="btn" data-mb="mal">${T('Last ned mal', 'Download template')}</button>
            <button type="button" class="btn primary" data-mb="importer">${T('Importer registerkart …', 'Import register map …')}</button></div>
          <input type="file" id="mbFil" accept=".csv,.xlsx,.json,.txt,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div>
      </div></div>`;
  }

  function sett(msg) { melding = msg; const e = $('mbMelding'); if (e) e.textContent = msg; }

  async function skann() {
    const ser = transport === 'ser';
    const omr = ser ? ($('mbCom').value || '') : ($('mbOmraade').value || '').trim();
    const port = ser ? 0 : (parseInt($('mbPort').value, 10) || 502);
    if (!omr) { sett(ser ? T('Velg en seriell port.', 'Choose a serial port.') : T('Skriv inn et IP-område.', 'Enter an IP range.')); return; }
    if (!ser) { try { localStorage.setItem('nabe.mbOmraade', omr); } catch { /* private window */ } }
    const par = ser ? $('mbParitet').value : 'N';
    const enheter = ser ? enhetsliste($('mbEnheter').value) : null;
    opptatt = true; sett(ser ? T('Spør bussen på ', 'Asking the bus on ') + omr + ' …' : T('Skanner port ', 'Scanning port ') + port + ' …'); tegn();
    try {
      const start = ser
        ? await api2('/api/modbus/serial/skann', {port: omr, baud: parseInt($('mbBaud').value, 10), parity: par[0], stopbits: par === 'N2' ? 2 : 1, units: enheter})
        : await api2('/api/modbus/scan', {subnet: omr, port, framing: transport === 'rtu' ? 'rtu' : 'tcp'});
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
        const kjente = funnet.filter(d => d.forslag && d.forslag.brukt);
        if (kjente.length) await hentKart();
        sett(funnet.length
          ? T(`Fant ${funnet.length} enheter på ${(j.result.open_hosts || []).length} maskiner.`, `Found ${funnet.length} units on ${(j.result.open_hosts || []).length} hosts.`)
            + (kjente.length ? T(` Brukte kjente registerkart for ${kjente.length}: ${[...new Set(kjente.map(d => d.forslag.navn))].join(', ')}. Bytt i lista hvis det er feil.`, ` Used known register maps for ${kjente.length}: ${[...new Set(kjente.map(d => d.forslag.navn))].join(', ')}. Change it in the list if it is wrong.`) : '')
          : ser ? T('Ingen enheter svarte på bussen. Sjekk baudrate, paritet og at A og B ikke er byttet om.', 'No units answered on the bus. Check the baud rate, the parity and that A and B are not swapped.')
          : T('Ingen Modbus-enheter svarte. Port 502 kan være stengt, eller enheten bruker en annen enhets-ID.', 'No Modbus devices answered. Port 502 may be closed, or the device uses another unit ID.'));
        break;
      }
    } catch (e) { sett(e.message); }
    opptatt = false; tegn();
  }

  async function utforsk(adr) {
    sett(T('Leser registre …', 'Reading registers …'));
    try {
      const start = await api2('/api/modbus/utforsk', {address: adr});
      if (start.status !== 'started') throw new Error(start.error || T('Utforsking feilet', 'Exploring failed'));
      for (;;) {
        await new Promise(r => setTimeout(r, 400));
        const j = await api2('/api/job/' + start.job_id);
        if (j.status === 'running') { sett(`${j.phase || ''} ${j.done || 0}/${j.total || 0}`.trim()); continue; }
        if (j.status === 'error') throw new Error(j.error || T('Utforsking feilet', 'Exploring failed'));
        const r = j.result || {};
        sett(T(`Fant ${r.count} registre som svarer. De ligger som et registerkart du kan gi navn.`, `Found ${r.count} registers that answer. They are kept as a register map you can name.`));
        delete S.cache[adr];
        await hentKart(); tegn();
        if (S.activeDev && S.activeDev.address === adr) selectDevice(adr, {force: true});
        break;
      }
    } catch (e) { sett(e.message); }
  }

  let oppdaterNavn = '';     // set when a file is picked to replace a map that is already there

  async function importer(fil) {
    if (!fil) return;
    if (fil.size > 6_000_000) { toast(T('Filen er for stor', 'The file is too large'), true); return; }
    const buf = new Uint8Array(await fil.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const innhold = btoa(s);
    const navn = oppdaterNavn || fil.name.replace(/\.[^.]+$/, '');
    oppdaterNavn = '';
    const base = $('mbBase') ? $('mbBase').value : '';
    const d = await api2('/api/modbus/kart', {navn, innhold, filnavn: fil.name, base: base === '' ? null : parseInt(base, 10), real_skala: parseFloat($('mbSkala') ? $('mbSkala').value : '0.1') || 0.1});
    if (d.status !== 'done') { notater = []; toast(d.error || T('Kunne ikke lese registerkartet', 'Could not read the register map'), true); await hentKart(); tegn(); return; }
    notater = [...window.nabeListeEndringer(d.endringer), ...(d.merknader || [])];
    toast(d.endringer ? T(`Registerkart «${navn}» oppdatert: ${d.punkter} punkter.`, `Register map "${navn}" updated: ${d.punkter} points.`)
      : T(`Registerkart «${navn}» importert: ${d.punkter} punkter.`, `Register map "${navn}" imported: ${d.punkter} points.`));
    await hentKart(); tegn();
    return d;
  }

  /* What a re-imported list changed: a summary line, then a few examples of each kind. Shared with the KNX window. */
  window.nabeListeEndringer = function (e) {
    if (!e) return [];
    const rader = [];
    const sum = [];
    if (e.nye.antall) sum.push(T(`${e.nye.antall} nye`, `${e.nye.antall} new`));
    if (e.omdopt.antall) sum.push(T(`${e.omdopt.antall} omdøpt`, `${e.omdopt.antall} renamed`));
    if (e.borte.antall) sum.push(T(`${e.borte.antall} borte`, `${e.borte.antall} gone`));
    rader.push((sum.length ? T('Lista er oppdatert: ', 'The list is updated: ') + sum.join(', ') + '.' : T('Lista er oppdatert, ingen forskjell.', 'The list is updated, no difference.'))
      + (e.beholdt ? ' ' + T(`${e.beholdt} egne endringer er beholdt.`, `${e.beholdt} of your own changes are kept.`) : ''));
    for (const [k, tittel] of [['nye', T('Nye', 'New')], ['omdopt', T('Omdøpt', 'Renamed')], ['borte', T('Borte', 'Gone')]]) {
      if (e[k].antall) rader.push(`${tittel}: ${e[k].eksempler.join(' · ')}${e[k].antall > e[k].eksempler.length ? ' …' : ''}`);
    }
    return rader;
  };

  async function lastNed(id) {
    const d = await api2('/api/modbus/kart/innhold?id=' + encodeURIComponent(id));
    if (d.status !== 'done') { toast(d.error || T('Kunne ikke hente kartet', 'Could not fetch the map'), true); return; }
    const tall = (v) => String(v).replace('.', ',');
    const rader = ['address;function;type;name;scale;unit;description;order;bit;offset'].concat(d.punkter.map(p => [p.address, p.function, p.type, p.name, tall(p.scale), p.unit, p.description,
      p.order === 'ABCD' ? '' : p.order, p.bit === null || p.bit === undefined ? '' : p.bit, p.offset ? tall(p.offset) : ''].map(x => String(x ?? '').replace(/[;\r\n]+/g, ' ')).join(';')));
    downloadText(rader.join('\r\n') + '\r\n', d.navn.replace(/[^\w.-]+/g, '_') + '.csv');
  }

  async function tilordne(adr, id) {
    const enhet = S.devices.find(x => x.address === adr) || {};
    const d = await api2('/api/modbus/tilordne', {address: adr, kart: id || null, vendor: enhet.vendor_name || '', model: enhet.model_name || ''});
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
    else if (k === 'importer') { oppdaterNavn = ''; $('mbFil').click(); }
    else if (k === 'last') lastNed(b.dataset.id);
    else if (k === 'oppdater') { oppdaterNavn = (kart.find(m => m.id === b.dataset.id) || {}).name || ''; $('mbFil').click(); }
    else if (k === 'mal') downloadText(MAL, 'nabe-modbus-registerkart-mal.csv');
    else if (k === 'utforsk') utforsk(b.dataset.adr);
    else if (k === 'aapne') { lukk(); selectDevice(b.dataset.adr); }
    else if (k === 'slett') {
      if (!await nabeBekreft(T('Slette registerkartet? Enheter som bruker det viser rå registre igjen.', 'Delete the register map? Devices that use it show raw registers again.'), {ok: T('Slett', 'Delete')})) return;
      await api2('/api/modbus/slett', {kart: b.dataset.id});
      await hentKart(); tegn();
    }
  });
  lag.addEventListener('change', (e) => {
    if (e.target.id === 'mbTransport') { transport = e.target.value; if (transport === 'ser' && !porter) hentPorter(); tegn(); }
    else if (e.target.id === 'mbFil') { importer(e.target.files[0]); e.target.value = ''; }
    else if (e.target.classList.contains('mb-kart')) tilordne(e.target.dataset.adr, e.target.value);
  });
  lag.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'mbOmraade') skann(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lukk(); e.stopPropagation(); }
  }, true);

  /* From the device list: pick a register map for this device, or explore what it answers. */
  function velgFilFor(adr) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.csv,.xlsx,.json,.txt';
    i.onchange = async () => {
      const dev = S.devices.find(x => x.address === adr) || {};
      const d = await importer(i.files[0]);
      if (!d || d.status !== 'done') return;
      await api2('/api/modbus/tilordne', {address: adr, kart: d.id, vendor: dev.vendor_name || '', model: dev.model_name || ''});
      await hentKart();
      delete S.cache[adr];
      if (S.activeDev && S.activeDev.address === adr) selectDevice(adr, {force: true});
    };
    i.click();
  }
  async function utforskFra(adr) {
    await utforsk(adr);
    await hentKart();
    delete S.cache[adr];
    if (S.activeDev && S.activeDev.address === adr) selectDevice(adr, {force: true});
  }
  window.nabeMbHjelp = {klar: () => klar, harKart: (adr) => !!tilordning[adr], importer: velgFilFor, utforsk: utforskFra};
  hentKart().then(() => { klar = true; if (window.renderDevices) renderDevices(); });

  window.aapneModbus = async () => {
    await hentKart();
    tegn();
    lag.hidden = false;
    const f = $('mbOmraade'); if (f) f.focus();
  };
  if ($('modbusBtn')) $('modbusBtn').onclick = () => { closeMenus(); window.aapneModbus(); };
})();
