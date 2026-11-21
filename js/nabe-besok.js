/* NABE - since last visit, and the visit report.

   When a plant has been read to the end, what was read is kept on this PC:
   every point's name, value and status. The next visit is compared with it,
   and the question a service technician actually has is answered: what is
   different from last time. New alarms, alarms that are gone, overrides
   somebody left behind, setpoints somebody moved, controllers that no longer
   answer.

   The same record can be saved as a file before work starts and compared
   with afterwards, which is the backup nobody takes until the day they need
   it.

   The report is one page with everything worth telling the customer, made to
   be printed or saved as PDF from the browser's own print dialog.

   Nothing here writes to a plant. Loaded after nabe-anlegg.js. */
'use strict';

(function besok() {
  const BES = {forrige: null, naa: null, sendt: '', sendtT: 0, kilde: '', alle: false};

  const rund = (v) => typeof v === 'number' ? Math.round(v * 1000) / 1000
    : v == null || typeof v === 'string' || typeof v === 'boolean' ? (v ?? null)
    : JSON.stringify(v).slice(0, 80);

  /* What the plant looks like now, small enough to keep. */
  function besokNaa() {
    const enheter = {};
    for (const d of S.devices) {
      const pts = S.cache[d.address];
      if (!pts) continue;
      const p = {};
      for (const x of pts) p[x.objid] = [x.name || '', rund(x.value), (x.status || []).join(','), x.unit || ''];
      enheter[d.address] = {n: d.object_name || '', i: d.device_instance ?? null, p};
    }
    return {t: Date.now() / 1000, key: asNokkel(), navn: asNavn(), enheter};
  }

  const endret = (a, b, alle) => {
    if (typeof a === 'number' && typeof b === 'number') {
      const d = Math.abs(a - b);
      // A setpoint is typed, so any change counts. A measurement moves by itself.
      return alle ? d > 0.5 && d > Math.abs(a) * 0.05 : d > 0.011;
    }
    return a !== b;
  };

  /* Pure: two records in, the differences out. `a` is the older one. */
  function besokDiff(a, b, alle) {
    const ut = {borte: [], nye: [], alarmNy: [], alarmBorte: [], feilNy: [], overNy: [], overBorte: [], verdi: []};
    if (!a || !b) return ut;
    const naaAdr = new Set(S.devices.map(d => d.address));
    for (const [ip, e] of Object.entries(a.enheter || {})) {
      if (!b.enheter[ip] && (b !== BES.naa || !naaAdr.has(ip))) ut.borte.push({ip, enhet: e.n || ip});
    }
    for (const [ip, e] of Object.entries(b.enheter || {})) {
      const f = (a.enheter || {})[ip];
      if (!f) { ut.nye.push({ip, enhet: e.n || ip}); continue; }
      for (const [objid, [navn, verdi, st, enhet]] of Object.entries(e.p)) {
        const g = f.p[objid];
        if (!g) continue;
        const rad = {ip, enhet: e.n || ip, objid, navn: navn || objid, fra: g[1], til: verdi, u: enhet || ''};
        const foer = new Set(String(g[2] || '').split(',')), naa = new Set(String(st || '').split(','));
        if (naa.has('in-alarm') && !foer.has('in-alarm')) ut.alarmNy.push(rad);
        if (!naa.has('in-alarm') && foer.has('in-alarm')) ut.alarmBorte.push(rad);
        if (naa.has('fault') && !foer.has('fault')) ut.feilNy.push(rad);
        if (naa.has('overridden') && !foer.has('overridden')) ut.overNy.push(rad);
        if (!naa.has('overridden') && foer.has('overridden')) ut.overBorte.push(rad);
        if ((alle || erSettpunktNavn(navn)) && endret(g[1], verdi, alle)) ut.verdi.push(rad);
      }
    }
    return ut;
  }
  const antall = (d) => Object.values(d).reduce((n, l) => n + l.length, 0);

  const DELER = () => [
    ['alarmNy', T('Nye alarmer', 'New alarms'), 'bad'],
    ['feilNy', T('Nye feil', 'New faults'), 'bad'],
    ['borte', T('Enheter som ikke svarer lenger', 'Devices that no longer answer'), 'bad'],
    ['overNy', T('Nye overstyringer', 'New overrides'), 'warn'],
    ['verdi', BES.alle ? T('Endrede verdier', 'Changed values') : T('Endrede settpunkt', 'Changed setpoints'), ''],
    ['nye', T('Nye enheter', 'New devices'), ''],
    ['alarmBorte', T('Alarmer som er borte', 'Alarms that are gone'), 'ok'],
    ['overBorte', T('Overstyringer som er fjernet', 'Overrides that were removed'), 'ok'],
  ];

  const naar = (t) => {
    const d = new Date(t * 1000);
    const dager = Math.round((Date.now() - d) / 86400000);
    const dato = d.toLocaleDateString(T('no', 'en-GB'), {day: 'numeric', month: 'short', year: 'numeric'});
    return dager < 1 ? T('i dag', 'today') + ' ' + d.toLocaleTimeString('no', {hour: '2-digit', minute: '2-digit'})
      : `${dato} (${dager} ${T(dager === 1 ? 'dag siden' : 'dager siden', dager === 1 ? 'day ago' : 'days ago')})`;
  };
  const vis = (v, u) => v == null ? '—' : (typeof v === 'number' ? fmtVal(v).t : String(v)) + (u ? ' ' + u : '');

  /* ------------------------------------------------------------- keeping */
  async function lagre() {
    const key = asNokkel();
    if (!key || !Object.keys(S.cache).length) return;
    if (BES.sendt === key && Date.now() - BES.sendtT < 30 * 60000) return;
    BES.sendt = key; BES.sendtT = Date.now();
    const naa = besokNaa();
    try {
      const d = await api('/api/besok', {key, data: naa});
      if (d.status !== 'done') return;
      BES.naa = naa;
      if (!BES.kilde) BES.forrige = d.forrige || null;
      if (d.forrige) {
        const diff = besokDiff(d.forrige, naa, false);
        const n = antall(diff);
        const verst = diff.alarmNy.length + diff.feilNy.length + diff.borte.length;
        if (window.nabeStatus) window.nabeStatus.siden(n, verst);
        if (n && typeof nabeSier === 'function') {
          nabeSier(T(`Siden sist: ${n} ${n === 1 ? 'ting er' : 'ting er'} annerledes. Se «Siden sist» i menyen.`,
                     `Since last visit: ${n} ${n === 1 ? 'thing is' : 'things are'} different. See "Since last visit" in the menu.`),
                   verst ? 'nervos' : 'fornoyd', 'besok:' + key, true);
        }
      }
    } catch { BES.sendt = ''; }
  }
  if (typeof anSammenlign === 'function') etter('anSammenlign', () => { lagre(); });

  /* -------------------------------------------------------------- overlay */
  const lag = document.createElement('div');
  lag.id = 'besokOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  function tegn() {
    const naa = BES.naa = besokNaa();
    const f = BES.forrige;
    const diff = besokDiff(f, naa, BES.alle);
    const n = antall(diff);
    const kropp = !f
      ? `<div class="gs-empty">${T('Dette er første gang NABE leser dette anlegget til ende. Neste besøk blir sammenlignet med dette.', 'This is the first time NABE has read this plant to the end. The next visit is compared with this one.')}</div>`
      : !n ? `<div class="gs-empty">${T('Ingenting er annerledes. Enten er anlegget stabilt, eller så har ingen turt å røre det.', 'Nothing is different. Either the plant is stable, or nobody dared touch it.')}</div>`
      : DELER().filter(([k]) => diff[k].length).map(([k, tittel, kl]) => `
        <div class="bs-del"><div class="bs-tittel ${kl}"><span>${esc(tittel)}</span><b>${diff[k].length}</b></div>
        ${diff[k].slice(0, 80).map(r => `<button type="button" class="bs-rad" data-ip="${esc(r.ip)}" data-o="${esc(r.objid || '')}">
          <span class="bs-enhet">${esc(r.enhet)}</span><span class="bs-navn">${esc(r.navn || '')}</span>
          <span class="bs-verdi">${r.objid ? (k === 'verdi' ? `${esc(vis(r.fra, ''))} → <b>${esc(vis(r.til, r.u))}</b>` : esc(vis(r.til, r.u))) : esc(r.ip)}</span></button>`).join('')}
        ${diff[k].length > 80 ? `<div class="bs-mer">+ ${diff[k].length - 80}</div>` : ''}</div>`).join('');
    lag.innerHTML = `<div class="gs-modal sp-modal"><div class="gs-head"><span class="gd-tittel">${T('Siden sist', 'Since last visit')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp">
        <div class="sp-topp"><span>${f ? esc((BES.kilde ? BES.kilde + ' · ' : '') + T('sammenlignet med ', 'compared with ') + naar(f.t)) : esc(asNavn() || '')}</span>
          <label class="tr-feil" title="${esc(T('Tar med målinger som har flyttet seg mye, ikke bare settpunkt', 'Includes measurements that moved a lot, not only setpoints'))}"><input type="checkbox" id="bsAlle"${BES.alle ? ' checked' : ''}> ${T('Alle verdier', 'All values')}</label></div>
        <div class="sp-rull bs-rull">${kropp}</div>
        <div class="op-knapper"><input type="file" id="bsFil" accept=".json" hidden>
          <button type="button" class="btn" data-bs="fil" title="${esc(T('Sammenlign anlegget slik det er nå med en fil du lagret tidligere', 'Compare the plant as it is now with a file you saved earlier'))}">${T('Sammenlign med fil…', 'Compare with file…')}</button>
          <button type="button" class="btn" data-bs="lagre" title="${esc(T('Alle leste verdier til en fil. Ta den før du endrer noe.', 'Every value read, to a file. Take it before you change anything.'))}">${T('Lagre verdiene til fil', 'Save the values to a file')}</button>
          <button type="button" class="btn" data-bs="rapport">${T('Besøksrapport…', 'Visit report…')}</button></div>
      </div></div>`;
  }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const rad = e.target.closest('.bs-rad');
    if (rad) {
      lag.hidden = true;
      await selectDevice(rad.dataset.ip);
      if (rad.dataset.o && S.activeDev?.address === rad.dataset.ip) {
        await selectPoint(rad.dataset.o);
        const tr = document.querySelector(`#pointsWrap tbody tr[data-o="${CSS.escape(rad.dataset.o)}"]`);
        if (tr) tr.scrollIntoView({block: 'center'});
      }
      return;
    }
    const b = e.target.closest('[data-bs]');
    if (!b) return;
    if (b.dataset.bs === 'lagre') {
      const n = besokNaa();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      downloadText(JSON.stringify(n), `nabe-verdier-${(n.navn || 'anlegg').replace(/[^\p{L}\p{N}]+/gu, '-')}-${stamp}.json`, false);
      toast(T(`${Object.values(n.enheter).reduce((s, x) => s + Object.keys(x.p).length, 0)} verdier lagret`, `${Object.values(n.enheter).reduce((s, x) => s + Object.keys(x.p).length, 0)} values saved`));
    } else if (b.dataset.bs === 'fil') {
      $('bsFil').click();
    } else if (b.dataset.bs === 'rapport') {
      lag.hidden = true;
      window.aapneRapport();
    }
  });
  lag.addEventListener('change', async (e) => {
    if (e.target.id === 'bsAlle') { BES.alle = e.target.checked; tegn(); return; }
    if (e.target.id !== 'bsFil' || !e.target.files[0]) return;
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!d || typeof d.enheter !== 'object' || !d.t) throw new Error('format');
      BES.forrige = d;
      BES.kilde = e.target.files[0].name;
      tegn();
    } catch {
      toast(T('Den fila er ikke lagret fra NABE', 'That file was not saved from NABE'), true);
    }
  });

  window.aapneBesok = function () {
    if (!S.devices.length) { toast(T('Skann et anlegg først', 'Scan a plant first')); return; }
    tegn();
    lag.hidden = false;
  };
  window.besokDiff = besokDiff;
  window.besokNaa = besokNaa;

  /* --------------------------------------------------------------- report */
  const rap = document.createElement('div');
  rap.id = 'rapOverlay';
  rap.className = 'gs-overlay';
  rap.setAttribute('role', 'dialog');
  rap.setAttribute('aria-modal', 'true');
  rap.hidden = true;
  document.body.append(rap);

  function rapportData() {
    const t = anleggTall();
    const flagg = (f) => t.flagg[f].map(({d, p}) => [d.object_name || d.address, p.name || p.objid, anVerdi(p)]);
    const klokker = siteWarnings().filter(s => s.nokkel === 'klokke').flatMap(s => s.rader.map(r => [r.navn || r.id, r.adresse, r.tekst]));
    const avvik = settpunktAvvik(S.cache).sort((a, b) => b.rel - a.rel).slice(0, 15)
      .map(a => [(S.devices.find(d => d.address === a.ip) || {}).object_name || a.ip, a.p.name || a.p.objid,
                 `${fmtVal(a.p.value).t} ${T('mot', 'against')} ${fmtVal(a.sp.value).t} ${a.p.unit || ''}`.trim()]);
    const notater = S.devices.map(d => [d.object_name || d.address, d.address, noteFor(d)]).filter(x => x[2]);
    const diff = BES.forrige && !BES.kilde ? besokDiff(BES.forrige, BES.naa || besokNaa(), false) : null;
    return {t, flagg, klokker, avvik, notater, diff};
  }
  function rapportDeler() {
    const r = rapportData();
    const deler = [];
    if (r.diff && antall(r.diff)) {
      deler.push([T('Siden forrige besøk', 'Since the previous visit') + ' · ' + naar(BES.forrige.t),
        DELER().filter(([k]) => r.diff[k].length).map(([k, tittel]) => [tittel, String(r.diff[k].length),
          r.diff[k].slice(0, 4).map(x => x.navn || x.enhet).join(', ') + (r.diff[k].length > 4 ? ' …' : '')])]);
    }
    let fo = {synlige: [], skjulte: []};
    try { fo = typeof window.forslagNaa === 'function' ? window.forslagNaa() : fo; } catch { /* the sheet stands without it */ }
    deler.push([T('Forslag til service', 'Service suggestions'), fo.synlige.map((p) => [p.tittel, String(p.rader.length || ''), p.rader.slice(0, 3).map((x) => x.navn).join(', ') + (p.rader.length > 3 ? ' …' : '')])]);
    deler.push([T('Utført eller satt til side', 'Done or put aside'), fo.skjulte.map((p) => [p.tittel, p.state === 'utfort' ? T('utført', 'done') : T('utsatt', 'aside'), ''])]);
    deler.push([T('I alarm', 'In alarm'), r.flagg('in-alarm')]);
    deler.push([T('Med feil', 'Faulty'), r.flagg('fault')]);
    deler.push([T('Overstyrt', 'Overridden'), r.flagg('overridden')]);
    deler.push([T('Ute av drift', 'Out of service'), r.flagg('out-of-service')]);
    deler.push([T('Feil klokke', 'Wrong clock'), r.klokker]);
    deler.push([T('Størst avvik fra settpunkt', 'Largest deviations from setpoint'), r.avvik]);
    deler.push([T('Notater', 'Notes'), r.notater]);
    deler.push([T('Prøv og se svar', 'Try and see the response'), svarRader(SVAR)]);
    deler.push([T('Fra telefonen', 'From the phone'), telefonRader(TELEFON)]);
    deler.push([T('Hva NABE gjorde mot anlegget', 'What NABE did to the plant'), bevisRader(BEVIS)]);
    return {r, deler: deler.filter(([, rader]) => rader.length)};
  }
  /* Tester kjørt det siste døgnet på enheter i dette anlegget, med tallene som ble målt. Bevis, ikke protokoll:
     igangkjøringsprotokollen er der den alltid har vært. */
  let SVAR = [], TELEFON = [];
  const hmKort = (t) => new Date(t * 1000).toLocaleTimeString(T('no', 'en-GB'), {hour: '2-digit', minute: '2-digit'});
  function svarRader(l) {
    return (l || []).map((t) => {
      const r = t.resultat || {};
      const tall = r.dom === 'ingen' ? T('ingen tydelig respons', 'no clear response')
        : [r.per_10 != null ? T('per 10 %: ', 'per 10 %: ') + Math.abs(r.per_10).toFixed(2) : '', r.dode_s != null ? T('dødtid ', 'dead time ') + r.dode_s + ' s' : '', r.t63_s != null ? '63 % ' + r.t63_s + ' s' : ''].filter(Boolean).join(' · ');
      return [`${t.padrag_navn || t.padrag} → ${t.maaling_navn || t.maaling}`, tall, hmKort(t.t) + (t.status === 'avbrutt' ? ' · ' + T('avbrutt', 'cancelled') : '') + (t.sluppet ? '' : ' · ' + T('slipp ikke bekreftet', 'release not confirmed'))];
    });
  }
  function telefonRader(l) {
    return (l || []).map((x) => [x.navn || T('Telefon', 'Phone'), x.tekst, hmKort(x.t)]);
  }
  /* What NABE sent, from the traffic log: the answer to "what did you do on our network" */
  let BEVIS = null;
  function bevisRader(b) {
    if (!b || !b.antall) return [];
    const hm = (t) => new Date(t * 1000).toLocaleTimeString(T('no', 'en-GB'), {hour: '2-digit', minute: '2-digit'});
    const dag = (t) => new Date(t * 1000).toLocaleDateString(T('no', 'en-GB'), {day: 'numeric', month: 'short'});
    const n = (x) => Number(x).toLocaleString(T('nb-NO', 'en-GB'));
    const lik = dag(b.fra) === dag(b.til);
    return [
      [T('Lesinger', 'Reads'), n(b.lesinger), ''],
      [T('Skriv til anlegget', 'Writes to the plant'), n(b.skriv), b.skriv ? T('mot ', 'to ') + b.skrivMot.join(', ') : T('ingenting er endret', 'nothing was changed')],
      ...(b.abonnement ? [[T('Abonnement på endringer (COV)', 'Subscriptions to changes (COV)'), n(b.abonnement), T('slutter av seg selv', 'end by themselves')]] : []),
      [T('Enheter spurt', 'Devices asked'), n(b.enheter), ''],
      [T('Tidsrom', 'Period'), lik ? `${hm(b.fra)} ${T('til', 'to')} ${hm(b.til)}` : `${dag(b.fra)} ${hm(b.fra)} ${T('til', 'to')} ${dag(b.til)} ${hm(b.til)}`, ''],
      ...(b.feil ? [[T('Forespørsler som ikke ble besvart', 'Requests not answered'), n(b.feil), '']] : []),
      ...(b.avkortet ? [[T('Merk', 'Note'), T('Bare de siste forespørslene er med', 'Only the latest requests are included'), '']] : []),
    ];
  }
  function rapportTekst() {
    const {r, deler} = rapportDeler();
    const linjer = [`${asNavn() || asNokkel()} · ${new Date().toLocaleDateString(T('no', 'en-GB'))}`,
      T(`${r.t.lest} av ${r.t.total} enheter lest, ${r.t.punkter} punkter`, `${r.t.lest} of ${r.t.total} devices read, ${r.t.punkter} points`), ''];
    for (const [tittel, rader] of deler) {
      linjer.push(`${tittel} (${rader.length})`);
      for (const x of rader.slice(0, 40)) linjer.push('  ' + x.filter(Boolean).join(' · '));
      if (rader.length > 40) linjer.push(`  + ${rader.length - 40}`);
      linjer.push('');
    }
    return linjer.join('\n');
  }
  function tegnRapport() {
    const {r, deler} = rapportDeler();
    const dato = new Date().toLocaleDateString(T('no', 'en-GB'), {day: 'numeric', month: 'long', year: 'numeric'});
    rap.innerHTML = `<div class="gs-modal sp-modal rap-modal"><div class="gs-head rap-skjerm"><span class="gd-tittel">${T('Besøksrapport', 'Visit report')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp"><div class="sp-rull rap-ark" id="rapArk">
        <div class="rap-hode"><h1>${esc(asNavn() || asNokkel())}</h1>
          <div>${esc(dato)} · ${esc(asNokkel())}</div>
          <div>${T(`${r.t.lest} av ${r.t.total} enheter lest · ${r.t.punkter} punkter`, `${r.t.lest} of ${r.t.total} devices read · ${r.t.punkter} points`)}</div></div>
        ${deler.length ? '' : `<p>${T('Ingen alarmer, ingen feil, ingen overstyringer. Skriv det ut og heng det på veggen.', 'No alarms, no faults, no overrides. Print it and hang it on the wall.')}</p>`}
        ${deler.map(([tittel, rader]) => `<h2>${esc(tittel)} <small>${rader.length}</small></h2>
          <table class="rap-tab"><tbody>${rader.slice(0, 60).map(x => `<tr><td>${esc(x[0] || '')}</td><td>${esc(x[1] || '')}</td><td>${esc(x[2] || '')}</td></tr>`).join('')}</tbody></table>
          ${rader.length > 60 ? `<div class="bs-mer">+ ${rader.length - 60}</div>` : ''}`).join('')}
        <div class="rap-fot">NABE ${esc(typeof NABE_VERSJON !== 'undefined' ? NABE_VERSJON : '')} · ${T('lest fra anlegget, ingenting er endret av rapporten', 'read from the plant, the report changed nothing')}</div>
      </div>
      <div class="op-knapper rap-skjerm"><button type="button" class="btn" data-rap="kopier">${T('Kopier som tekst', 'Copy as text')}</button>
        <button type="button" class="btn" data-rap="html">${T('Lagre som fil', 'Save as a file')}</button>
        <button type="button" class="btn primary" data-rap="skriv">${T('Skriv ut eller lagre som PDF', 'Print or save as PDF')}</button></div></div></div>`;
  }
  rap.addEventListener('click', async (e) => {
    if (e.target === rap || e.target.closest('.gs-close')) { rap.hidden = true; return; }
    const b = e.target.closest('[data-rap]');
    if (!b) return;
    if (b.dataset.rap === 'html') {
      lagreRapportHtml();
    } else if (b.dataset.rap === 'kopier') {
      try { await navigator.clipboard.writeText(rapportTekst()); toast(T('Rapporten er kopiert', 'The report is copied')); }
      catch { toast(T('Fikk ikke kopiert', 'Could not copy'), true); }
    } else {
      document.body.classList.add('skriver-rapport');
      const ferdig = () => { document.body.classList.remove('skriver-rapport'); window.removeEventListener('afterprint', ferdig); };
      window.addEventListener('afterprint', ferdig);
      window.print();
    }
  });
  /* The sheet as one file that opens in any browser, with nothing else needed. It is what the customer gets. */
  const RAP_CSS = 'body{font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#1b1f24;background:#fff}'
    + '.rap-hode{padding-bottom:10px;border-bottom:1px solid #d8dde3;font-size:13px;color:#5b6570;line-height:1.6}.rap-hode h1{margin:0 0 2px;font-size:22px;font-weight:600;color:#1b1f24}'
    + 'h2{margin:22px 0 4px;font-size:13px;font-weight:600;color:#38414a}h2 small{margin-left:6px;font-weight:500;color:#7a858f}'
    + 'table{width:100%;border-collapse:collapse;font-size:13px}td{padding:5px 8px 5px 0;border-bottom:1px solid #e6e9ed;vertical-align:top}td:first-child{width:30%;color:#38414a}td:last-child{text-align:right;white-space:nowrap}'
    + '.rap-fot{margin-top:28px;font-size:12px;color:#7a858f}.bs-mer{font-size:12px;color:#7a858f;padding:4px 0}'
    + '@media (prefers-color-scheme:dark){body{background:#14171a;color:#e3e7eb}.rap-hode{border-color:#2d343a;color:#9aa5af}.rap-hode h1{color:#e3e7eb}h2{color:#c5ccd3}td{border-color:#262c31}td:first-child{color:#c5ccd3}}'
    + '@media print{body{margin:0;max-width:none}}';
  function rapportHtml() {
    const ark = document.getElementById('rapArk');
    if (!ark) return '';
    const navn = asNavn() || asNokkel();
    return `<!doctype html><html lang="${SPRAAK === 'en' ? 'en' : 'nb'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(navn)}</title><style>${RAP_CSS}</style></head><body>${ark.innerHTML}</body></html>`;
  }
  function lagreRapportHtml() {
    const html = rapportHtml();
    if (!html) return;
    const trygt = (asNavn() || 'anlegg').replace(/[^\wæøåÆØÅ.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'anlegg';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], {type: 'text/html;charset=utf-8'}));
    a.download = `NABE-rapport-${trygt}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(T('Rapporten er lagret som fil', 'The report is saved as a file'));
  }
  window.rapportHtml = rapportHtml;
  window.aapneRapport = async function () {
    if (!S.devices.length) { toast(T('Skann et anlegg først', 'Scan a plant first')); return; }
    BEVIS = null;
    try {
      const d = await Promise.race([fetch('/api/bevis', {cache: 'no-store'}).then((r) => r.json()), new Promise((ok) => setTimeout(() => ok(null), 2000))]);
      if (d && d.status === 'done') BEVIS = d;
    } catch { /* the report stands without it */ }
    SVAR = []; TELEFON = [];
    try {
      const siden = Date.now() / 1000 - 24 * 3600;
      const adr = new Set(S.devices.map((d) => d.address));
      const [a, b] = await Promise.race([
        Promise.all([fetch('/api/test/svar-historikk?siden=' + siden, {cache: 'no-store'}).then((r) => r.json()), fetch('/api/mobil/logg', {cache: 'no-store'}).then((r) => r.json())]),
        new Promise((ok) => setTimeout(() => ok([null, null]), 2000))]);
      if (a && a.tester) SVAR = a.tester.filter((t) => adr.has(t.address)).reverse();
      if (b && b.logg) TELEFON = b.logg.filter((x) => x.t >= siden && ['skriv', 'slipp', 'test'].includes(x.type) && (!x.enhet || adr.has(x.enhet))).reverse();
    } catch { /* ditto */ }
    tegnRapport();
    rap.hidden = false;
  };
  window.rapportTekst = rapportTekst;

  if ($('besokBtn')) $('besokBtn').onclick = () => { closeMenus(); window.aapneBesok(); };
  if ($('rapportBtn')) $('rapportBtn').onclick = () => { closeMenus(); window.aapneRapport(); };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!rap.hidden) { rap.hidden = true; e.stopPropagation(); }
    else if (!lag.hidden) { lag.hidden = true; e.stopPropagation(); }
  }, true);
})();
