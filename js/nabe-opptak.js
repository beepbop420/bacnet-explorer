/* NABE - recording. The server reads the chosen points on a fixed interval and
   writes each row to a CSV in the data folder, so a recording goes on while
   the window is minimised or you are on another controller. It only ever
   reads. Started from the … menu or the palette; the status bar shows it. */
'use strict';

(function opptak() {
  const sb = document.createElement('button');
  sb.id = 'sbOpptak';
  sb.type = 'button';
  sb.className = 'sb-item sb-opptak';
  sb.hidden = true;
  document.querySelector('.statusbar')?.prepend(sb);
  let puls = 0;

  const kilde = () => {
    const finn = (ip, objid) => (S.cache[ip] || []).find(p => p.objid === objid) || {};
    const rad = (ip, objid) => { const p = finn(ip, objid); return {address: ip, objid, navn: p.name || p.object_name || objid, enhet: p.unit_symbol || ''}; };
    const valgte = [...S.sel].map(k => { const i = k.indexOf('|'); return rad(k.slice(0, i), k.slice(i + 1)); });
    const fulgte = S.watch.map(w => rad(w.ip, w.objid));
    return {valgte, fulgte};
  };
  /* The valve and the setpoint that belong to a room sensor: RT401 and SB401 in
     the same system, and its -SP. A hunting loop shows in both, and the
     setpoint says what the sensor was meant to hold. */
  const PEND_RE = /(?:^|[^A-Za-z0-9])(RT|SB)(\d{2,4})(?!\d)/i;
  function partnere(rader) {
    const ut = [], har = new Set(rader.map(r => r.address + '|' + r.objid));
    for (const r of rader) {
      const liste = S.cache[r.address] || [], p = liste.find(q => q.objid === r.objid);
      const m = p && PEND_RE.exec(p.name || '');
      if (!m || m[1].toUpperCase() !== 'RT') continue;
      const funn = [liste.find(q => { const k = PEND_RE.exec(q.name || ''); return k && k[1].toUpperCase() === 'SB' && k[2] === m[2] && systemAv(q) === systemAv(p); }),
                    settpunktParFor(liste).get(p)];
      for (const q of funn) {
        if (!q || har.has(r.address + '|' + q.objid)) continue;
        har.add(r.address + '|' + q.objid);
        ut.push({address: r.address, objid: q.objid, navn: q.name || q.objid, enhet: q.unit_symbol || ''});
      }
    }
    return ut;
  }
  const klokke = (t) => new Date(t * 1000).toLocaleTimeString(SPRAAK === 'en' ? 'en-GB' : 'no', {hour: '2-digit', minute: '2-digit'});
  const periodeTekst = (s) => s < 120 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1).replace('.', ',')} min`;
  const utenEnhet = (n) => String(n).replace(/ \([^)]*\)$/, '');
  const PAR_TEKST = {
    sloyfe: () => T('Sløyfa pendler', 'The loop is hunting'),
    ulik: () => T('Begge svinger, men ulik periode', 'Both swing, with different periods'),
    forstyrrelse: () => T('Bare målingen svinger. Forstyrrelse utenfra?', 'Only the measurement swings. Disturbance from outside?'),
    padrag: () => T('Pådraget svinger, men målingen følger ikke', 'The actuator swings, but the measurement does not follow'),
    rolig: () => T('Rolig', 'Calm'),
  };
  function pendlingHtml(r) {
    const ser = new Map(r.serier.map(x => [x.navn, x]));
    const par = r.par.map(p => {
      const a = ser.get(p.maling), b = ser.get(p.padrag), per = (a && a.periode_s) || (b && b.periode_s);
      const f = p.forsinkelse_s;
      const sidenT = (a && a.siden_t) || (b && b.siden_t);
      const info = [per && p.dom !== 'rolig' ? T(`periode ${periodeTekst(per)}`, `period ${periodeTekst(per)}`) : '',
        sidenT ? T(`siden kl. ${klokke(sidenT)}`, `since ${klokke(sidenT)}`) : '',
        (p.dom === 'sloyfe' || p.dom === 'ulik') && Math.abs(f) >= 1
          ? (f > 0 ? T(`målingen følger ${Math.abs(f)} s etter pådraget`, `the measurement follows ${Math.abs(f)} s after the actuator`)
                   : T(`målingen går ${Math.abs(f)} s foran pådraget`, `the measurement leads the actuator by ${Math.abs(f)} s`)) : ''].filter(Boolean).join(' · ');
      return `<div class="pe-rad ${p.dom}"><div><b>${esc(utenEnhet(p.maling))}</b> <span class="sp-meta">${T('mot', 'against')}</span> <b>${esc(utenEnhet(p.padrag))}</b></div>
        <div class="pe-dom">${esc(PAR_TEKST[p.dom] ? PAR_TEKST[p.dom]() : p.dom)}</div>${info ? `<div class="sp-meta">${esc(info)}</div>` : ''}</div>`;
    }).join('');
    const funnet = r.serier.filter(x => x.dom !== 'nei');
    const tab = funnet.length ? `<table class="sp-tab"><thead><tr><th>${T('Punkt', 'Point')}</th><th class="t">${T('Poeng', 'Score')}</th><th class="t">${T('Periode', 'Period')}</th><th class="t">${T('Amplitude', 'Amplitude')}</th></tr></thead><tbody>${
      funnet.map(x => `<tr><td>${esc(utenEnhet(x.navn))}${x.dom === 'mulig' ? ` <span class="sp-meta">${T('mulig', 'possible')}</span>` : ''}${x.siden_t ? ` <span class="sp-meta">${T('siden', 'since')} ${klokke(x.siden_t)}</span>` : ''}</td><td class="t">${x.score}</td>
        <td class="t">${esc(periodeTekst(x.periode_s))}</td><td class="t">${esc(String(x.amplitude).replace('.', ','))} ${esc(x.enhet)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="op-tekst">${T('Ingen pendling funnet i dette opptaket.', 'No hunting found in this recording.')}</p>`;
    return `${par}${tab}<div class="op-knapper"><button type="button" class="btn" data-op="tilbake">${T('Tilbake', 'Back')}</button></div>`;
  }
  const tid = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} t ${Math.floor(s % 3600 / 60)} min` : `${Math.floor(s / 60)} min`);

  async function status() {
    try { return await (await fetch('/api/opptak')).json(); } catch { return {aktiv: false}; }
  }
  function visStatus(o) {
    sb.hidden = !o.aktiv;
    if (o.aktiv) {
      sb.textContent = T(`Opptak ${o.rader} rader · ${tid(o.varighet)}`, `Recording ${o.rader} rows · ${tid(o.varighet).replace(' t ', ' h ')}`);
      sb.title = T(`${o.punkter} punkter hvert ${o.intervall}. sekund. Klikk for å se`, `${o.punkter} points every ${o.intervall} seconds. Click to see`);
    }
    clearTimeout(puls);
    if (o.aktiv) puls = setTimeout(async () => visStatus(await status()), 5000);
  }

  async function tegn() {
    const lag = $('opptakOverlay'), o = await status(), {valgte, fulgte} = kilde();
    const kilder = [[valgte, T('Valgte punkter', 'Selected points')], [fulgte, T('Overvåkede punkter', 'Watched points')]];
    const forste = kilder.find(([l]) => l.length);
    const ekstra = kilder.map(([l]) => partnere(l));
    const pendKnapp = o.fil && o.rader >= 20
      ? `<div class="op-felt"><span>${T(`Siste opptak: ${o.rader} rader`, `Latest recording: ${o.rader} rows`)}</span><button type="button" class="btn" data-op="pendling">${T('Se etter pendling', 'Look for hunting')}</button></div>` : '';
    const kort = o.aktiv
      ? `<p class="op-tekst">${T(`Tar opp ${o.punkter} punkter hvert ${o.intervall}. sekund. ${o.rader} rader så langt, ${o.bom} uten svar.`, `Recording ${o.punkter} points every ${o.intervall} seconds. ${o.rader} rows so far, ${o.bom} with no answer.`)}</p>
         <div class="op-knapper"><button type="button" class="btn" data-op="vis">${T('Vis fila', 'Show the file')}</button><button type="button" class="btn primary" data-op="stopp">${T('Stopp opptaket', 'Stop recording')}</button></div>${pendKnapp}`
      : !forste
        ? `<p class="op-tekst">${T('Velg punkter i tabellen, eller fest dem i Overvåking, så kan de tas opp.', 'Select points in the table, or pin them in Watch, and they can be recorded.')}</p>`
        : `<label class="op-felt"><span>${T('Hva', 'What')}</span><select id="opKilde" class="field">${kilder.filter(([l]) => l.length).map(([l, n], i) => `<option value="${i}">${esc(n)} (${l.length})</option>`).join('')}</select></label>
           <label class="op-felt"><span>${T('Hvor ofte', 'How often')}</span><select id="opHvert" class="field"><option value="5">${T('Hvert 5. sekund', 'Every 5 seconds')}</option><option value="30" selected>${T('Hvert 30. sekund', 'Every 30 seconds')}</option><option value="60">${T('Hvert minutt', 'Every minute')}</option><option value="300">${T('Hvert 5. minutt', 'Every 5 minutes')}</option></select></label>
           <label class="op-felt"><span>${T('Hvor lenge', 'How long')}</span><select id="opLenge" class="field"><option value="1">${T('1 time', '1 hour')}</option><option value="8">${T('8 timer', '8 hours')}</option><option value="24" selected>${T('24 timer', '24 hours')}</option><option value="168">${T('En uke', 'A week')}</option><option value="">${T('Til jeg stopper', 'Until I stop it')}</option></select></label>
           ${ekstra.some(x => x.length) ? `<label class="op-felt"><span>${T('Ta med pådrag og settpunkt', 'Include actuator and setpoint')}</span><input type="checkbox" id="opPadrag" checked></label>` : ''}
           <p class="op-tekst">${T('Opptaket leser bare, og går selv om du bytter enhet. NABE må stå åpen og ha kontakt med anlegget.', 'Recording only reads, and goes on when you change device. NABE has to stay open and in touch with the site.')}</p>
           <div class="op-knapper"><button type="button" class="btn primary" data-op="start">${T('Start opptak', 'Start recording')}</button></div>${pendKnapp}`;
    lag.innerHTML = `<div class="gs-modal op-modal"><div class="gs-head"><span class="gd-tittel">${T('Opptak av punkter', 'Recording points')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div><div class="op-kropp">${kort}</div></div>`;
    lag._kilder = kilder.filter(([l]) => l.length);
    lag._ekstra = kilder.map((k, i) => [k, ekstra[i]]).filter(([k]) => k[0].length).map(([, e]) => e);
    lag.querySelector('.gs-modal').classList.remove('op-bred');
    lag._fil = o.fil;
  }

  async function aapne() {
    let lag = $('opptakOverlay');
    if (!lag) {
      lag = document.createElement('div');
      lag.id = 'opptakOverlay';
      lag.className = 'gs-overlay';
      lag.setAttribute('role', 'dialog');
      lag.setAttribute('aria-modal', 'true');
      document.body.append(lag);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);
      lag.addEventListener('click', async (e) => {
        if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
        const op = e.target.closest('[data-op]')?.dataset.op;
        if (op === 'start') {
          const valgt = Number($('opKilde').value);
          let punkter = lag._kilder[valgt][0];
          if ($('opPadrag')?.checked) punkter = punkter.concat(lag._ekstra[valgt] || []);
          const r = await api('/api/opptak/start', {punkter, intervall: Number($('opHvert').value), timer: Number($('opLenge').value) || null});
          if (r.status !== 'done') { toast(r.error || T('Fikk ikke startet opptaket', 'Could not start recording'), true); return; }
          lag.hidden = true;
          toast(T(`Opptak startet: ${punkter.length} punkter`, `Recording started: ${punkter.length} points`));
          visStatus(await status());
        } else if (op === 'stopp') {
          const r = await api('/api/opptak/stopp', {});
          visStatus(await status());
          lag.hidden = true;
          toast(T(`Opptak stoppet: ${r.rader} rader`, `Recording stopped: ${r.rader} rows`));
          if (r.fil) api('/api/vis-fil', {sti: r.fil});
        } else if (op === 'vis') api('/api/vis-fil', {sti: lag._fil});
        else if (op === 'pendling') {
          const r = await api('/api/pendling', {});
          if (r.status !== 'done') { toast(r.error || T('Fikk ikke analysert opptaket', 'Could not analyse the recording'), true); return; }
          lag.querySelector('.gs-modal').classList.add('op-bred');
          lag.querySelector('.op-kropp').innerHTML = pendlingHtml(r);
        } else if (op === 'tilbake') await tegn();
      });
    }
    await tegn();
    lag.hidden = false;
  }

  window.nabePendling = {partnere, pendlingHtml};   // for the self-test
  window.aapneOpptak = aapne;
  $('opptakBtn').onclick = () => { closeMenus(); aapne(); };
  sb.onclick = aapne;
  status().then(visStatus);
})();
