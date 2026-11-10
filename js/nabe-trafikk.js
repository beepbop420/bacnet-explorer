/* NABE - traffic log.
   Every BACnet request NABE sends and what came back, from a ring buffer in
   the server: when, to whom, how long it took, how many tries, and the error
   code when it failed. For the day a controller is slow or silent and the
   question is whether it is the device, the network or NABE. Memory only; the
   export is a file you ask for. Opened from the ⋯ menu or the palette. */
'use strict';

(function trafikklogg() {
  let rader = [], seq = 0, oppsummering = {}, perKort = {}, pause = false, timer = 0;
  let fEnhet = '', fTjeneste = '', fFeil = false, valgNokkel = '';

  const lag = document.createElement('div');
  lag.id = 'trafikkOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const tid = (t) => {
    const d = new Date(t * 1000);
    return d.toLocaleTimeString('no', {hour12: false}) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  };
  const SVAR = {ok: 'OK', feil: T('feil', 'error'), avvist: T('avvist', 'rejected'),
                avbrutt: T('avbrutt', 'aborted'), tidsgrense: T('tidsgrense', 'timeout'), sendt: T('sendt', 'sent')};
  const kortFlere = () => new Set(rader.map(r => r.kort).filter(Boolean)).size > 1;
  const kortNavn = (ip) => ((S.kort || []).find(k => k.ip === ip) || {}).interface || ip;
  const filtrert = () => rader.filter(r =>
    (!fEnhet || r.til === fEnhet) && (!fTjeneste || r.tjeneste === fTjeneste)
    && (!fFeil || !['ok', 'sendt'].includes(r.svar)));

  async function hent(fra) {
    try {
      const d = await (await fetch('/api/trafikk?etter=' + fra, {cache: 'no-store'})).json();
      if (d.status !== 'done') return;
      rader = rader.concat(d.rader).slice(-5000);
      seq = d.seq;
      oppsummering = d.oppsummering || {};
      perKort = d.kort || {};
    } catch { /* the next tick tries again */ }
  }

  function skjelett() {
    lag.innerHTML = `<div class="gs-modal sp-modal tr-modal"><div class="gs-head"><span class="gd-tittel">${T('Trafikklogg', 'Traffic log')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp"><div id="trSum" class="tr-sum"></div>
        <div class="sp-topp"><span id="trAnt"></span><span class="tr-filter">
          <select id="trEnhet" class="field"></select><select id="trTjeneste" class="field"></select>
          <label class="tr-feil"><input type="checkbox" id="trFeil"> ${T('Bare feil', 'Errors only')}</label></span></div>
        <div class="sp-rull"><table class="sp-tab"><thead><tr><th>${T('Tid', 'Time')}</th><th>${T('Enhet', 'Device')}</th><th>${T('Tjeneste', 'Service')}</th>
          <th>${T('Objekt', 'Object')}</th><th class="t">ms</th><th>${T('Svar', 'Reply')}</th><th>${T('Forsøk / kode', 'Tries / code')}</th></tr></thead><tbody id="trRader"></tbody></table></div>
        <div class="op-knapper"><button type="button" class="btn" data-tr="pause"></button><button type="button" class="btn" data-tr="tom">${T('Tøm', 'Clear')}</button>
          <button type="button" class="btn" data-tr="csv">CSV</button><button type="button" class="btn" data-tr="json">JSON</button></div></div></div>`;
  }
  function valg(sel, tom, liste, valgt) {
    sel.innerHTML = `<option value="">${tom}</option>` + liste.map(x => `<option${x === valgt ? ' selected' : ''}>${esc(x)}</option>`).join('');
  }
  function oppdater() {
    if (!$('trRader')) return;
    const enheter = Object.keys(oppsummering).sort();
    const tjenester = [...new Set(rader.map(r => r.tjeneste))].sort();
    const nokkel = enheter.join() + '|' + tjenester.join();
    if (nokkel !== valgNokkel) {
      valgNokkel = nokkel;
      valg($('trEnhet'), T('Alle enheter', 'All devices'), enheter, fEnhet);
      valg($('trTjeneste'), T('Alle tjenester', 'All services'), tjenester, fTjeneste);
    }
    const sumRad = (navn, o, klasse = '') => `<div class="tr-sum-rad ${klasse}"><span>${esc(navn)}</span><span>${o.antall}</span>
        <span class="${o.feil ? 'tr-feil-tall' : ''}">${o.feil} ${T('feil', 'errors')}</span><span>${o.snitt} ms</span><span>p95 ${o.p95} ms</span></div>`;
    const kortRader = Object.entries(perKort).map(([ip, o]) => sumRad(kortNavn(ip), o, 'tr-sum-kort'));
    const enhetRader = Object.entries(oppsummering)
      .sort((a, b) => b[1].feil - a[1].feil || b[1].snitt - a[1].snitt).slice(0, 5)
      .map(([ip, o]) => sumRad(ip, o));
    $('trSum').innerHTML = (kortRader.length > 1 ? kortRader.join('') : '') + enhetRader.join('')
      || `<div class="sp-meta">${T('Ingen trafikk ennå.', 'No traffic yet.')}</div>`;
    const alle = filtrert();
    $('trAnt').textContent = T(`${alle.length} av ${rader.length}`, `${alle.length} of ${rader.length}`);
    const flere = kortFlere();
    $('trRader').innerHTML = alle.slice(-300).reverse().map(r => `<tr>
      <td class="tr-mono">${esc(tid(r.t))}</td><td>${esc(r.til)}${flere && r.kort ? `<div class="sp-meta">${T('via', 'via')} ${esc(kortNavn(r.kort))}</div>` : ''}</td><td>${esc(r.tjeneste)}</td>
      <td>${esc(r.obj)}${r.prop ? `<span class="sp-meta"> ${esc(r.prop)}</span>` : ''}</td>
      <td class="t">${r.svar === 'sendt' ? '' : r.ms}</td>
      <td class="${r.svar === 'ok' || r.svar === 'sendt' ? 'sp-meta' : 'tr-ugreit'}">${esc(SVAR[r.svar] || r.svar)}</td>
      <td class="sp-meta">${r.forsok > 1 ? esc(T(`forsøk ${r.forsok}`, `try ${r.forsok}`)) + (r.kode ? ' · ' : '') : ''}${esc(r.kode || '')}</td></tr>`).join('');
    const p = lag.querySelector('[data-tr="pause"]');
    if (p) p.textContent = pause ? T('Fortsett', 'Resume') : T('Pause', 'Pause');
  }
  function tikk() {
    if (lag.hidden) { clearInterval(timer); timer = 0; return; }
    if (pause) return;
    hent(seq).then(oppdater);
  }
  function lukk() { lag.hidden = true; clearInterval(timer); timer = 0; }

  function eksport(type) {
    const alle = filtrert();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    if (type === 'json') { downloadText(JSON.stringify(alle, null, 1), `nabe-trafikk-${stamp}.json`, false); return; }
    const celle = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linjer = [['tid', 'enhet', 'kort', 'tjeneste', 'objekt', 'egenskap', 'ms', 'svar', 'kode', 'forsok'].join(';')]
      .concat(alle.map(r => [new Date(r.t * 1000).toISOString(), r.til, r.kort || '', r.tjeneste, r.obj, r.prop, String(r.ms).replace('.', ','),
                             r.svar, r.kode, r.forsok].map(celle).join(';')));
    downloadText(linjer.join('\r\n'), `nabe-trafikk-${stamp}.csv`);
  }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const k = e.target.closest('[data-tr]')?.dataset.tr;
    if (k === 'pause') { pause = !pause; oppdater(); }
    else if (k === 'tom') {
      await fetch('/api/trafikk/tom', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
      rader = []; oppsummering = {}; oppdater();
    } else if (k === 'csv' || k === 'json') eksport(k);
  });
  lag.addEventListener('change', (e) => {
    if (e.target.id === 'trEnhet') fEnhet = e.target.value;
    else if (e.target.id === 'trTjeneste') fTjeneste = e.target.value;
    else if (e.target.id === 'trFeil') fFeil = e.target.checked;
    else return;
    oppdater();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lukk(); e.stopPropagation(); }
  }, true);

  window.aapneTrafikk = async () => {
    rader = []; seq = 0; pause = false; valgNokkel = '';
    skjelett();
    lag.hidden = false;
    await hent(0);
    oppdater();
    clearInterval(timer);
    timer = setInterval(tikk, 1500);
  };
  if ($('trafikkBtn')) $('trafikkBtn').onclick = () => { closeMenus(); window.aapneTrafikk(); };
})();
