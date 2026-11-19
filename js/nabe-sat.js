/* NABE - commissioning check (SAT).

   A list of the points that have to be right before the plant is handed over, each with the range it should be in.
   NABE finds every point in the plant, reads it, and ticks off the ones that answer, are not faulty, overridden or out
   of service, and sit inside their range. What is left is what someone has to look at, and can be approved by hand with
   a note. The result is a report to print or save as PDF, and a CSV.

   The list is a paste or a file with the columns Device; Point; Min; Max; Note (the last three are optional), or it is made
   from the selected points or the open device. It is kept in this browser, per plant. Nothing is written to the plant:
   the check only reads. */
'use strict';

(function sat() {
  const NOKKEL = 'nabe_sat';
  const lagre0 = () => { try { return JSON.parse(localStorage.getItem(NOKKEL)) || {}; } catch { return {}; } };
  let LAGER = lagre0(), lagreT = 0, MOTT = '';
  const lagre = () => { clearTimeout(lagreT); lagreT = setTimeout(() => { try { localStorage.setItem(NOKKEL, JSON.stringify(LAGER)); } catch { /* private window */ } }, 500); };
  const plant = () => (typeof asNokkel === 'function' && asNokkel()) || 'ukjent';
  const liste = () => (LAGER[plant()] = LAGER[plant()] || {navn: '', av: '', rader: [], kjort: 0});

  /* ------------------------------------------------------------ the list in */
  const tallEller = (v) => { const x = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); return x !== '' && isFinite(Number(x)) ? Number(x) : null; };
  const FELT = [['enhet', /^(enhet|device|regulator|controller)$/i], ['punkt', /^(punkt|point|tag|navn|name)$/i], ['lav', /^(min|under|lav|low|nedre)$/i],
                ['hoy', /^(maks|max|over|h[oø]y|high|[oø]vre)$/i], ['merknad', /^(merknad|kommentar|note|notat|comment)$/i]];
  function parsPunktliste(tekst) {
    const linjer = String(tekst || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!linjer.length) return [];
    const skille = linjer.some((l) => l.includes(';')) ? ';' : linjer.some((l) => l.includes('\t')) ? '\t' : ',';
    const celler = linjer.map((l) => l.split(skille).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
    let kol = ['enhet', 'punkt', 'lav', 'hoy', 'merknad'], start = 0;
    const hode = celler[0].map((c) => (FELT.find(([, re]) => re.test(c)) || [''])[0]);
    if (hode.filter(Boolean).length >= 2 && hode.includes('punkt')) { kol = hode; start = 1; }
    else if (celler.every((c) => c.length === 1)) kol = ['punkt'];
    return celler.slice(start).map((c) => {
      const r = {enhet: '', punkt: '', lav: null, hoy: null, merknad: ''};
      kol.forEach((k, i) => {
        if (!k || c[i] === undefined) return;
        if (k === 'lav' || k === 'hoy') r[k] = tallEller(c[i]); else r[k] = c[i];
      });
      return r;
    }).filter((r) => r.punkt);
  }

  /* --------------------------------------------------------------- finding it */
  const norm = (t) => String(t || '').toLowerCase().replace(/[\s_\-.]/g, '');
  function finnEnhet(enhet, devices) {
    const e = String(enhet || '').trim();
    if (!e) return {alle: true};
    const el = e.toLowerCase();
    let treff = devices.filter((d) => String(d.device_instance) === e);
    if (!treff.length) treff = devices.filter((d) => d.address === e || String(d.address).startsWith(e + ':') || String(d.address).replace(/^(mb|mr|ms|kx):/, '') === e);
    if (!treff.length) treff = devices.filter((d) => String(d.object_name || '').toLowerCase() === el);
    if (!treff.length) treff = devices.filter((d) => norm(d.object_name) === norm(e) && norm(e));
    return treff.length === 1 ? {d: treff[0]} : treff.length > 1 ? {flere: treff} : {ingen: true};
  }
  /* AI 10000, ai,10000 and ai10000 all mean analog-input,10000: what a drawing or an IO list says. */
  const TYPER = {ai: 'analog-input', ao: 'analog-output', av: 'analog-value', bi: 'binary-input', bo: 'binary-output', bv: 'binary-value',
                 mi: 'multi-state-input', mo: 'multi-state-output', mv: 'multi-state-value', msi: 'multi-state-input', mso: 'multi-state-output', msv: 'multi-state-value'};
  function objidFraKortform(t) {
    const m = /^(ai|ao|av|bi|bo|bv|msi|mso|msv|mi|mo|mv)[\s,_.\-]*(\d+)$/i.exec(String(t).trim());
    return m ? TYPER[m[1].toLowerCase()] + ',' + m[2] : '';
  }
  /* The point by its name, else by its object id, else by name with spaces, dashes and case ignored. */
  function finnPunkt(rad, devices, cache) {
    const kandidater = [];
    const e = finnEnhet(rad.enhet, devices);
    if (e.ingen) return {status: 'ingen-enhet'};
    if (e.flere) return {status: 'flere-enheter', antall: e.flere.length};
    const enheter = e.d ? [e.d] : devices;
    const navn = String(rad.punkt).trim(), nl = navn.toLowerCase(), nn = norm(navn);
    const kortObjid = objidFraKortform(navn);
    for (const d of enheter) {
      const pts = cache[d.address];
      if (!pts) { kandidater.push({d, ulest: true}); continue; }
      let p = pts.filter((q) => String(q.name || '') === navn);
      if (!p.length) p = pts.filter((q) => String(q.name || '').toLowerCase() === nl || String(q.objid) === navn);
      if (!p.length && nn) p = pts.filter((q) => norm(q.name) === nn);
      if (!p.length && kortObjid) p = pts.filter((q) => q.objid === kortObjid);
      p.forEach((q) => kandidater.push({d, p: q}));
    }
    const funnet = kandidater.filter((k) => k.p);
    if (funnet.length === 1) return {status: 'funnet', d: funnet[0].d, p: funnet[0].p};
    if (funnet.length > 1) return {status: 'flere-punkter', antall: funnet.length};
    const ulest = kandidater.filter((k) => k.ulest);
    if (ulest.length && e.d) return {status: 'ulest', d: ulest[0].d};
    return {status: 'ingen-punkt', ulest: ulest.length};
  }

  /* ---------------------------------------------------------------- the verdict */
  const TILSTANDER = {
    ok: 'ok', utenfor: 'avvik', urimelig: 'avvik', feil: 'avvik', ikke: 'avvik', 'ingen-enhet': 'avvik', 'ingen-punkt': 'avvik', 'flere-enheter': 'avvik',
    'flere-punkter': 'avvik', ulest: 'varsel', over: 'varsel', ute: 'varsel', alarm: 'varsel',
  };
  const STATUSTEKST = () => ({ok: T('OK', 'OK'), utenfor: T('Utenfor område', 'Out of range'), urimelig: T('Urimelig verdi', 'Impossible value'), feil: T('Feil', 'Fault'),
    ikke: T('Svarer ikke', 'No answer'), 'ingen-enhet': T('Enheten finnes ikke', 'No such device'), 'ingen-punkt': T('Punktet finnes ikke', 'No such point'),
    'flere-enheter': T('Flere enheter treffer', 'Several devices match'), 'flere-punkter': T('Flere punkter treffer', 'Several points match'),
    ulest: T('Enheten er ikke lest', 'Device not read'), over: T('Overstyrt', 'Overridden'), ute: T('Ute av drift', 'Out of service'), alarm: T('I alarm', 'In alarm')});
  function vurder(rad, p, verdi) {
    const v = verdi !== undefined ? verdi : p.value;
    if (v === null || v === undefined || p.unread) return {status: 'ikke'};
    const flagg = p.status || [];
    if (flagg.includes('fault')) return {status: 'feil'};
    if (typeof v === 'number') {
      if (typeof rarGrunn === 'function' && rarGrunn({...p, value: v})) return {status: 'urimelig', grunn: rarGrunn({...p, value: v})};
      if ((rad.lav !== null && v < rad.lav) || (rad.hoy !== null && v > rad.hoy)) return {status: 'utenfor'};
    }
    if (flagg.includes('out-of-service')) return {status: 'ute'};
    if (flagg.includes('overridden')) return {status: 'over'};
    if (flagg.includes('in-alarm')) return {status: 'alarm'};
    return {status: 'ok'};
  }
  const ferdig = (r) => !!(r.res && (r.res.status === 'ok' || r.godkjent === true));
  function oppsummer(rader) {
    const ut = {total: rader.length, ok: 0, godkjent: 0, avvik: 0, varsel: 0, ikkeKjort: 0};
    for (const r of rader) {
      if (!r.res) { ut.ikkeKjort++; continue; }
      if (r.res.status === 'ok') ut.ok++;
      else if (r.godkjent === true) ut.godkjent++;
      else if (TILSTANDER[r.res.status] === 'varsel') ut.varsel++;
      else ut.avvik++;
    }
    ut.ferdige = ut.ok + ut.godkjent;
    return ut;
  }

  /* ----------------------------------------------------------------- reading */
  let KJORER = false;
  async function lesEnhet(d) {
    const ip = d.address;
    const startet = await api('/api/device/points', {address: ip, device_instance: d.device_instance, background: true});
    if (startet.status !== 'started') throw new Error('start');
    const r = await pollJob(startet.job_id, null, null);
    if (!r || !r.points || r.cancelled) throw new Error('lest');
    cachePoints(ip, r.points);
    S.cacheMeta[ip] = {type_counts: r.type_counts || {}, total_objects: r.total_objects || 0, readAt: Date.now()};
    if (r.identity && Object.keys(r.identity).length) S.identity[ip] = r.identity;
  }
  async function kjor(fremdrift) {
    if (KJORER) return;
    KJORER = true;
    const L = liste();
    try {
      const devices = S.devices || [];
      // Devices the list names that have not been read, or were read long ago: their status flags are what is judged
      const trenger = new Map();
      for (const r of L.rader) {
        const e = finnEnhet(r.enhet, devices);
        for (const d of e.d ? [e.d] : e.flere || (e.alle ? devices : [])) {
          const lest = S.cacheMeta[d.address] && S.cacheMeta[d.address].readAt;
          if (!S.cache[d.address] || (lest && Date.now() - lest > 600000)) trenger.set(d.address, d);
        }
      }
      let gjort = 0;
      const kø = [...trenger.values()];
      const arbeid = async () => {
        while (kø.length) {
          const d = kø.shift();
          try { await lesEnhet(d); } catch { PRE.failed.add(d.address); }
          gjort++;
          if (fremdrift) fremdrift(T(`Leser enheter ${gjort} av ${trenger.size}`, `Reading devices ${gjort} of ${trenger.size}`));
        }
      };
      await Promise.all([arbeid(), arbeid(), arbeid()]);
      // Fresh values for every point found: one poll, the same one Live uses
      const funn = L.rader.map((r) => ({r, f: finnPunkt(r, devices, S.cache)}));
      const mal = {};
      for (const {f} of funn) if (f.status === 'funnet') (mal[f.d.address] = mal[f.d.address] || []).push(f.p.objid);
      let ferske = {};
      if (Object.keys(mal).length) {
        try { const d = await api('/api/poll', {targets: mal, cov: false}); if (d.status === 'done') ferske = d.values || {}; } catch { /* the values already read are used */ }
      }
      const nu = Date.now();
      for (const {r, f} of funn) {
        if (f.status !== 'funnet') { r.res = {status: f.status, t: nu}; r.verdi = null; continue; }
        const v = (ferske[f.d.address] || {})[f.p.objid];
        const verdi = v !== undefined ? v : f.p.value;
        if (v !== undefined && f.p.value !== v) f.p.value = v;
        r.res = {...vurder(r, f.p, verdi), t: nu};
        r.verdi = typeof verdi === 'number' ? Math.round(verdi * 1000) / 1000 : verdi;
        r.enh = f.p.unit_symbol || '';
        r.funnet = {ip: f.d.address, objid: f.p.objid, enhet: f.d.object_name || f.d.address, navn: f.p.name || f.p.objid};
      }
      L.kjort = nu;
      lagre();
    } finally { KJORER = false; }
  }

  /* ------------------------------------------------------------------ the view */
  const lag = document.createElement('div');
  lag.id = 'satOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);
  let visImport = false, msg = '';
  const tallTekst = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v));
  const omrTekst = (r) => (r.lav === null && r.hoy === null ? '' : `${tallTekst(r.lav) || '–'} ${T('til', 'to')} ${tallTekst(r.hoy) || '–'}`);
  const klokke = (t) => new Date(t).toLocaleString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

  function radHtml(r, i) {
    const s = r.res ? r.res.status : '', k = s ? TILSTANDER[s] : '';
    const verdi = r.res && r.res.status !== 'ingen-enhet' && r.res.status !== 'ingen-punkt' && r.verdi !== null && r.verdi !== undefined ? `${tallTekst(r.verdi)} ${esc(r.enh || '')}` : '';
    const chip = r.res ? `<span class="sat-chip ${k}${r.godkjent === true && s !== 'ok' ? ' godkjent' : ''}" ${r.res.grunn ? `title="${esc(r.res.grunn)}"` : ''}>${esc(STATUSTEKST()[s] || s)}</span>` : `<span class="sat-chip">–</span>`;
    return `<tr data-i="${i}"><td><div class="sp-navn">${esc(r.punkt)}</div><div class="sp-meta">${esc(r.enhet || T('alle enheter', 'all devices'))}${r.merknad ? ' · ' + esc(r.merknad) : ''}</div></td>
      <td class="t">${esc(verdi)}</td>
      <td class="t sat-omr"><input class="sat-in" data-felt="lav" value="${esc(tallTekst(r.lav))}" inputmode="decimal" aria-label="${esc(T('Nedre grense', 'Lower limit'))}"><span>–</span><input class="sat-in" data-felt="hoy" value="${esc(tallTekst(r.hoy))}" inputmode="decimal" aria-label="${esc(T('Øvre grense', 'Upper limit'))}"></td>
      <td>${chip}</td>
      <td class="t">${r.res && s !== 'ok' ? `<label class="sat-godkjenn" title="${esc(T('Godkjent for hånd', 'Approved by hand'))}"><input type="checkbox" data-felt="godkjent" ${r.godkjent === true ? 'checked' : ''}></label>` : r.res ? '✓' : ''}</td>
      <td><input class="sat-in sat-kom" data-felt="kommentar" value="${esc(r.kommentar || '')}" placeholder="${esc(T('Kommentar', 'Comment'))}" aria-label="${esc(T('Kommentar', 'Comment'))}"></td>
      <td class="t">${r.funnet ? `<button type="button" class="sat-gaa" data-gaa="${i}" title="${esc(T('Gå til punktet', 'Go to the point'))}">›</button>` : ''}<button type="button" class="sat-x" data-fjern="${i}" aria-label="${esc(T('Fjern raden', 'Remove the row'))}">✕</button></td></tr>`;
  }

  function oppsummeringHtml() {
    const L = liste(), o = oppsummer(L.rader);
    if (!o.total) return '';
    return `<div class="sat-sum"><span><b>${o.ferdige}</b> ${T('av', 'of')} ${o.total} ${T('godkjent', 'approved')}</span>
      ${o.avvik ? `<span class="avvik">${o.avvik} ${T('avvik', o.avvik === 1 ? 'deviation' : 'deviations')}</span>` : ''}${o.varsel ? `<span class="varsel">${o.varsel} ${T('å se på', 'to look at')}</span>` : ''}
      ${o.ikkeKjort ? `<span>${o.ikkeKjort} ${T('ikke kontrollert', 'not checked')}</span>` : ''}${L.kjort ? `<span class="sp-meta">${T('kontrollert', 'checked')} ${esc(klokke(L.kjort))}</span>` : ''}</div>`;
  }
  function tegn() {
    const L = liste();
    const tom = !L.rader.length;
    lag.innerHTML = `<div class="gs-modal sp-modal sat-modal"><div class="gs-head"><span class="gd-tittel">${T('Idriftsettelse', 'Commissioning')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp">
        <div class="sat-topp"><label>${T('Kontroll', 'Check')}<input class="field" id="satNavn" value="${esc(L.navn)}" placeholder="${esc(T('for eksempel SAT, 1. etasje', 'for example SAT, first floor'))}"></label>
          <label>${T('Utført av', 'Done by')}<input class="field" id="satAv" value="${esc(L.av)}"></label></div>
        <div id="satSum">${oppsummeringHtml()}</div>
        ${visImport || tom ? `<div class="sat-import"><div class="sp-meta">${T('Lim inn punktlista, eller velg en fil. Kolonner: Enhet; Punkt; Min; Maks; Merknad. Bare Punkt må være med.', 'Paste the point list, or choose a file. Columns: Device; Point; Min; Max; Note. Only Point is required.')}</div>
          <textarea id="satTekst" class="field" rows="6" spellcheck="false" placeholder="Enhet;Punkt;Min;Maks&#10;RTU-1;RT401;19;23&#10;RTU-1;FS401;;;Fjernes etter test"></textarea>
          <div class="op-knapper"><input type="file" id="satFil" accept=".csv,.txt,.tsv" hidden>
            <button type="button" class="btn" data-sat="fil">${T('Velg fil…', 'Choose file…')}</button>
            <button type="button" class="btn" data-sat="valgte">${T('Fra valgte punkter', 'From selected points')}</button>
            <button type="button" class="btn" data-sat="enhet">${T('Fra åpen enhet', 'From the open device')}</button>
            <button type="button" class="btn primary" data-sat="legg">${T('Legg til', 'Add')}</button></div></div>` : ''}
        <div class="sp-rull sat-rull">${tom ? '' : `<table class="sp-tab sat-tab"><thead><tr><th>${T('Punkt', 'Point')}</th><th class="t">${T('Verdi', 'Value')}</th><th class="t">${T('Område', 'Range')}</th><th>${T('Resultat', 'Result')}</th><th class="t">${T('Godkjent', 'Approved')}</th><th>${T('Kommentar', 'Comment')}</th><th></th></tr></thead>
          <tbody id="satRader">${L.rader.map(radHtml).join('')}</tbody></table>`}</div>
        <div class="sp-meta" id="satMsg">${esc(msg)}</div>
        <div class="op-knapper">${tom ? '' : `<button type="button" class="btn" data-sat="importer">${T('Legg til flere…', 'Add more…')}</button><button type="button" class="btn" data-sat="tom">${T('Tøm lista', 'Clear the list')}</button>
          <button type="button" class="btn" data-sat="csv">${T('Lagre som CSV', 'Save as CSV')}</button><button type="button" class="btn" data-sat="rapport">${T('Rapport…', 'Report…')}</button>
          <button type="button" class="btn primary" data-sat="kjor">${T('Kjør kontroll', 'Run the check')}</button>`}</div></div></div>`;
  }

  /* ----------------------------------------------------------------- the report */
  function rapportHtml() {
    const L = liste(), o = oppsummer(L.rader), S0 = STATUSTEKST();
    const dato = new Date().toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'long', year: 'numeric'});
    const avvik = L.rader.filter((r) => r.res && r.res.status !== 'ok' && r.godkjent !== true);
    const rad = (r) => `<tr><td>${esc(r.funnet ? r.funnet.enhet : r.enhet || '')}</td><td>${esc(r.punkt)}</td><td class="t">${esc(r.res && r.verdi !== null && r.verdi !== undefined ? tallTekst(r.verdi) + ' ' + (r.enh || '') : '')}</td>
      <td class="t">${esc(omrTekst(r))}</td><td>${esc(r.res ? S0[r.res.status] + (r.godkjent === true && r.res.status !== 'ok' ? ' · ' + T('godkjent', 'approved') : '') : T('ikke kontrollert', 'not checked'))}</td><td>${esc([r.merknad, r.kommentar].filter(Boolean).join(' · '))}</td></tr>`;
    const tab = (rader) => `<table class="rap-tab sat-rap-tab"><thead><tr><th>${T('Enhet', 'Device')}</th><th>${T('Punkt', 'Point')}</th><th class="t">${T('Verdi', 'Value')}</th><th class="t">${T('Område', 'Range')}</th><th>${T('Resultat', 'Result')}</th><th>${T('Merknad', 'Note')}</th></tr></thead><tbody>${rader.map(rad).join('')}</tbody></table>`;
    return `<div class="gs-modal sp-modal rap-modal sat-rap"><div class="gs-head rap-skjerm"><span class="gd-tittel">${T('Rapport', 'Report')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp"><div class="sp-rull rap-ark"><div class="rap-hode"><h1>${esc(L.navn || T('Idriftsettelse', 'Commissioning'))}</h1>
        <div>${esc(asNavn() || asNokkel())} · ${esc(dato)}${L.av ? ' · ' + esc(L.av) : ''}</div>
        <div>${T(`${o.ferdige} av ${o.total} punkter godkjent`, `${o.ferdige} of ${o.total} points approved`)}${o.avvik ? ' · ' + T(`${o.avvik} avvik`, `${o.avvik} deviations`) : ''}${o.varsel ? ' · ' + T(`${o.varsel} å se på`, `${o.varsel} to look at`) : ''}${o.ikkeKjort ? ' · ' + T(`${o.ikkeKjort} ikke kontrollert`, `${o.ikkeKjort} not checked`) : ''}${L.kjort ? ' · ' + T('kontrollert ', 'checked ') + esc(klokke(L.kjort)) : ''}</div></div>
        ${avvik.length ? `<h2>${T('Avvik og det som må sees på', 'Deviations and what needs a look')} <small>${avvik.length}</small></h2>${tab(avvik)}` : ''}
        <h2>${T('Alle punkter', 'All points')} <small>${L.rader.length}</small></h2>${tab(L.rader)}
        <div class="sat-signatur"><span>${T('Dato og signatur', 'Date and signature')}</span></div>
        <div class="rap-fot">NABE ${esc(typeof NABE_VERSJON !== 'undefined' ? NABE_VERSJON : '')} · ${T('lest fra anlegget, ingenting er endret av kontrollen', 'read from the plant, the check changed nothing')}</div></div>
      <div class="op-knapper rap-skjerm"><button type="button" class="btn" data-sat="tilbake">${T('Tilbake', 'Back')}</button>
        <button type="button" class="btn primary" data-sat="skriv">${T('Skriv ut eller lagre som PDF', 'Print or save as PDF')}</button></div></div></div>`;
  }
  function csvTekst() {
    const S0 = STATUSTEKST();
    const celle = (v) => { const x = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const rader = [[T('Enhet', 'Device'), T('Punkt', 'Point'), T('Verdi', 'Value'), T('Enhet (måleenhet)', 'Unit'), 'Min', 'Maks', T('Resultat', 'Result'), T('Godkjent', 'Approved'), T('Merknad', 'Note'), T('Kommentar', 'Comment')]];
    for (const r of liste().rader) {
      rader.push([r.funnet ? r.funnet.enhet : r.enhet, r.punkt, tallTekst(r.verdi), r.enh || '', tallTekst(r.lav), tallTekst(r.hoy), r.res ? S0[r.res.status] : '',
        r.res ? (r.res.status === 'ok' ? T('ja', 'yes') : r.godkjent === true ? T('ja, for hånd', 'yes, by hand') : T('nei', 'no')) : '', r.merknad || '', r.kommentar || '']);
    }
    return rader.map((r) => r.map(celle).join(';')).join('\r\n');
  }

  /* -------------------------------------------------------------------- doing */
  function leggTil(nye) {
    const L = liste();
    const har = new Set(L.rader.map((r) => `${r.enhet}|${r.punkt}`));
    let n = 0;
    for (const r of nye) { const k = `${r.enhet}|${r.punkt}`; if (har.has(k)) continue; har.add(k); L.rader.push({...r}); n++; }
    lagre();
    msg = nye.length ? T(`${n} lagt til${nye.length - n ? `, ${nye.length - n} fantes fra før` : ''}.`, `${n} added${nye.length - n ? `, ${nye.length - n} were already there` : ''}.`) : T('Fant ingen punkter å legge til.', 'Found no points to add.');
    visImport = false;
    tegn();
  }
  async function gaaTil(r) {
    if (!r.funnet) return;
    lag.hidden = true;
    const {ip, objid} = r.funnet;
    if (!S.activeDev || S.activeDev.address !== ip) {
      document.querySelector(`#devList .dev[data-ip="${CSS.escape(ip)}"]`)?.click();
      for (let i = 0; i < 80 && !(S.activeDev && S.activeDev.address === ip && S.pointIndex && S.pointIndex.get(objid)); i++) await new Promise((x) => setTimeout(x, 150));
    }
    if (typeof selectPoint === 'function' && S.pointIndex && S.pointIndex.get(objid)) {
      selectPoint(objid);
      document.querySelector(`#pointsWrap tr[data-o="${CSS.escape(objid)}"]`)?.scrollIntoView({block: 'center'});
    }
  }
  const lesFelt = () => { const L = liste(); L.navn = ($('satNavn') || {}).value ?? L.navn; L.av = ($('satAv') || {}).value ?? L.av; };

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lesFelt(); lagre(); lag.hidden = true; return; }
    const L = liste();
    const fjern = e.target.closest('[data-fjern]'), gaa = e.target.closest('[data-gaa]');
    if (fjern) { lesFelt(); L.rader.splice(Number(fjern.dataset.fjern), 1); lagre(); tegn(); return; }
    if (gaa) { gaaTil(L.rader[Number(gaa.dataset.gaa)]); return; }
    const k = e.target.closest('[data-sat]')?.dataset.sat;
    if (!k) return;
    lesFelt();
    if (k === 'fil') $('satFil').click();
    else if (k === 'legg') leggTil(parsPunktliste($('satTekst').value));
    else if (k === 'importer') { visImport = true; msg = ''; tegn(); }
    else if (k === 'valgte') {
      const nye = [...(S.sel || [])].map((key) => { const i = key.indexOf('|'), ip = key.slice(0, i), objid = key.slice(i + 1); const d = S.devices.find((x) => x.address === ip), p = (S.cache[ip] || []).find((q) => q.objid === objid); return p ? {enhet: (d && (d.object_name || d.address)) || ip, punkt: p.name || p.objid, lav: null, hoy: null, merknad: ''} : null; }).filter(Boolean);
      leggTil(nye);
    } else if (k === 'enhet') {
      const d = S.activeDev, pts = d ? (S.cache[d.address] || S.points || []) : [];
      leggTil(pts.filter((p) => p.name).map((p) => ({enhet: d.object_name || d.address, punkt: p.name, lav: null, hoy: null, merknad: ''})));
    } else if (k === 'tom') {
      if (!await nabeBekreft(T('Tømme punktlista og resultatene for dette anlegget?', 'Clear the point list and the results for this plant?'))) return;
      LAGER[plant()] = {navn: L.navn, av: L.av, rader: [], kjort: 0}; lagre(); msg = ''; tegn();
    } else if (k === 'kjor') {
      const b = e.target.closest('button');
      b.disabled = true;
      try { await kjor((t) => { const m = $('satMsg'); if (m) m.textContent = t; }); msg = ''; } catch (x) { msg = T('Kontrollen ble ikke ferdig: ', 'The check did not finish: ') + (x.message || x); }
      tegn();
    } else if (k === 'csv') downloadText(csvTekst(), `idriftsettelse_${new Date().toISOString().slice(0, 10)}.csv`);
    else if (k === 'rapport') { MOTT = 'rapport'; lag.innerHTML = rapportHtml(); }
    else if (k === 'tilbake') { MOTT = ''; tegn(); }
    else if (k === 'skriv') {
      document.body.classList.add('skriver-sat');
      const ferdigPrint = () => { document.body.classList.remove('skriver-sat'); window.removeEventListener('afterprint', ferdigPrint); };
      window.addEventListener('afterprint', ferdigPrint);
      window.print();
    }
  });
  lag.addEventListener('change', async (e) => {
    const L = liste();
    if (e.target.id === 'satFil' && e.target.files[0]) {
      try { $('satTekst').value = await e.target.files[0].text(); } catch { msg = T('Fikk ikke lest fila', 'Could not read the file'); }
      return;
    }
    const tr = e.target.closest('tr[data-i]'), f = e.target.dataset.felt;
    if (!tr || !f) return;
    const r = L.rader[Number(tr.dataset.i)];
    if (!r) return;
    if (f === 'godkjent') r.godkjent = e.target.checked;
    else if (f === 'kommentar') r.kommentar = e.target.value;
    else if (f === 'lav' || f === 'hoy') {
      r[f] = tallEller(e.target.value);
      // The range changed: judged again from the value already read, so nothing has to be read again
      if (r.funnet) { const p = (S.cache[r.funnet.ip] || []).find((q) => q.objid === r.funnet.objid); if (p) r.res = {...vurder(r, p, r.verdi), t: Date.now()}; }
    }
    lagre();
    // Only the result cells and the sum are replaced, so a Tab from one field to the next keeps its place
    if (f === 'godkjent' || f === 'lav' || f === 'hoy') {
      const ny = document.createElement('tbody');
      ny.innerHTML = radHtml(r, Number(tr.dataset.i));
      const nr = ny.firstElementChild;
      [3, 4].forEach((c) => { tr.children[c].innerHTML = nr.children[c].innerHTML; });
      $('satSum').innerHTML = oppsummeringHtml();
    }
  });
  lag.addEventListener('input', (e) => { if (e.target.id === 'satNavn' || e.target.id === 'satAv') { lesFelt(); lagre(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);

  window.aapneSat = () => {
    if (!S.devices.length) { toast(T('Skann et anlegg først', 'Scan a plant first')); return; }
    msg = ''; visImport = false; MOTT = '';
    tegn();
    lag.hidden = false;
  };
  window.nabeSat = {objidFraKortform, parsPunktliste, finnEnhet, finnPunkt, vurder, oppsummer, ferdig, csvTekst, liste, kjor, leggTil: (r) => { const L = liste(); r.forEach((x) => L.rader.push({...x})); }, tilbakestill: () => { LAGER = {}; }};
  if ($('satBtn')) $('satBtn').onclick = () => { closeMenus(); window.aapneSat(); };
})();
