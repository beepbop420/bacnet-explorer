/* NABE - edit a point of a Modbus device or a KNX gateway.
   The names, scales and types come from a register map or an ETS list. A name that is wrong, a scale that is off by ten or a
   datapoint type that was guessed is changed here, on the point, and kept in the list the device uses. A device with no list gets one
   of its own, so naming the registers that "Explore" finds is where the list is made. */
'use strict';

(function rediger() {
  const lag = document.createElement('div');
  lag.id = 'redigerOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const api2 = async (sti, kropp) => (await fetch(sti, kropp === undefined ? {cache: 'no-store'}
    : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(kropp)})).json();
  const felt = (id, navn, verdi, hjelp = '') => `<label class="rd-rad"><span>${navn}</span><input class="field" id="${id}" value="${esc(String(verdi ?? ''))}" spellcheck="false">${hjelp ? `<small>${hjelp}</small>` : ''}</label>`;

  async function aapne() {
    const p = S.pointIndex.get(S.selected), dev = S.activeDev;
    if (!p || !dev) return;
    const knx = dev.protocol === 'knx';
    let d = {};
    try { d = ((await api2('/api/object/detail', {address: dev.address, objid: p.objid})).properties) || {}; } catch { /* the form opens with what the point has */ }
    const typer = ['u16', 's16', 'u32', 's32', 'f32', 'u64', 'bool'].map(x => `<option${x === d['data-type'] ? ' selected' : ''}>${x}</option>`).join('');
    const ordrer = ['ABCD', 'CDAB', 'BADC', 'DCBA'].map(x => `<option${x === d['word-order'] ? ' selected' : ''}>${x}</option>`).join('');
    lag.innerHTML = `<div class="gs-modal dlg-modal rd-modal"><div class="gs-head"><span class="gd-tittel">${T('Rediger punkt', 'Edit point')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp">
        <div class="sp-meta">${knx ? esc(d['group-address'] || '') : esc((d['modbus-function'] || '') + ' ' + (d['modbus-address'] ?? ''))}</div>
        ${felt('rdNavn', T('Navn', 'Name'), d['object-name'] || p.name)}
        ${felt('rdBeskr', T('Beskrivelse', 'Description'), d.description || '')}
        ${knx ? felt('rdDpt', T('Datapunkttype', 'Datapoint type'), (d['datapoint-type'] && d['datapoint-type'] !== 'unknown' && d['datapoint-type'] !== 'ukjent') ? d['datapoint-type'] : '', T('For eksempel 9.001 (temperatur), 5.001 (prosent), 1.001 (av/på). Tomt gir et anslag.', 'For example 9.001 (temperature), 5.001 (percent), 1.001 (on/off). Empty gives a guess.'))
          : `${felt('rdEnhet', T('Enhet', 'Unit'), p.unit_symbol || '', T('°C, %, Pa, m3/h, kW …', '°C, %, Pa, m3/h, kW …'))}
             ${felt('rdSkala', T('Skala', 'Scale'), d.scale ?? 1, T('Verdien ganges med dette. 0,1 for en temperatur som ligger som 215 i registeret.', 'The value is multiplied by this. 0.1 for a temperature that is 215 in the register.'))}
             ${felt('rdOffset', T('Forskyvning', 'Offset'), d.offset ?? 0)}
             <label class="rd-rad"><span>${T('Type', 'Type')}</span><select class="field" id="rdType">${typer}</select></label>
             <label class="rd-rad"><span>${T('Ordrekkefølge', 'Word order')}</span><select class="field" id="rdOrden">${ordrer}</select></label>`}
        <div class="sp-meta" id="rdMelding"></div>
        <div class="op-knapper"><button type="button" class="btn" data-rd="avbryt">${T('Avbryt', 'Cancel')}</button><button type="button" class="btn primary" data-rd="lagre">${T('Lagre', 'Save')}</button></div>
      </div></div>`;
    lag.hidden = false;
    $('rdNavn').focus();
    $('rdNavn').select();
  }

  async function lagre() {
    const dev = S.activeDev, p = S.pointIndex.get(S.selected);
    if (!dev || !p) return;
    const knx = dev.protocol === 'knx';
    const num = (id) => parseFloat(String($(id).value).replace(',', '.'));
    const felter = knx ? {name: $('rdNavn').value, description: $('rdBeskr').value, dpt: $('rdDpt').value}
      : {name: $('rdNavn').value, description: $('rdBeskr').value, unit: $('rdEnhet').value, scale: num('rdSkala'), offset: num('rdOffset'), type: $('rdType').value, order: $('rdOrden').value};
    const r = await api2(knx ? '/api/knx/punkt' : '/api/modbus/punkt', {address: dev.address, objid: p.objid, felter});
    if (r.status !== 'done') { $('rdMelding').textContent = r.error || T('Fikk ikke lagret', 'Could not save'); return; }
    lag.hidden = true;
    toast(r.delt > 1 ? T(`Lagret. Listen brukes av ${r.delt} enheter, så endringen gjelder alle.`, `Saved. The list is used by ${r.delt} devices, so the change applies to all of them.`) : T('Lagret.', 'Saved.'));
    delete S.cache[dev.address];
    selectDevice(dev.address, {force: true});
  }

  lag.addEventListener('click', (e) => {
    if (e.target === lag || e.target.closest('.gs-close') || e.target.dataset.rd === 'avbryt') lag.hidden = true;
    else if (e.target.dataset.rd === 'lagre') lagre();
  });
  lag.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') lagre(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);

  // A button in the inspector for the points that come from a list a technician has made or imported
  function knapp() {
    const dev = S.activeDev;
    if (!dev || (dev.protocol !== 'modbus' && dev.protocol !== 'knx') || !S.selected) return;
    const tittel = document.querySelector('#inspector .insp-title');
    if (!tittel || tittel.querySelector('.rd-knapp')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn rd-knapp';
    b.textContent = T('Rediger', 'Edit');
    b.title = T('Endre navn, beskrivelse, enhet og skala for dette punktet', 'Change the name, description, unit and scale of this point');
    b.onclick = aapne;
    tittel.append(b);
  }
  if (typeof etter === 'function') etter('renderInspector', knapp);
  window.nabeRedigerPunkt = aapne;
})();
