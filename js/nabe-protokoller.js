/* NABE - BACnet, Modbus and KNX side by side.

   Three things sit in plain view instead of in a settings page:

   1. Beside the Scan button, a small arrow opens what the scan looks for (BACnet, Modbus on port 502, KNX on UDP 3671)
      and what can be added by hand. All three are on by default, so a building is scanned once; at least one stays on.
   2. Above the device list, a filter shows everything or one protocol, with the count of each. It appears when the
      list holds more than one.
   3. On a device row that lacks something, the action stands on the row: a KNX gateway with no ETS list says so and
      has an Import button, a Modbus device showing raw registers has a register map button and an Explore button.

   Everything is read only, as before. The windows under the menu (Modbus…, KNX…) stay for what none of this reaches:
   a serial port, a gateway on another port, routing, the full lists. */
'use strict';

(function protokoller() {
  const api2 = async (sti, kropp) => {
    const r = await fetch(sti, kropp === undefined ? {cache: 'no-store'}
      : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(kropp)});
    return r.json();
  };
  const PROT = [['bacnet', 'BACnet'], ['modbus', 'Modbus'], ['knx', 'KNX']];
  const paa = (p) => S._kunProt ? p === S._kunProt
    : loadPrefs().protSok !== false && loadPrefs()['prot' + p[0].toUpperCase() + p.slice(1)] !== false;
  const protAv = (d) => d.protocol === 'modbus' ? 'modbus' : d.protocol === 'knx' ? 'knx' : 'bacnet';
  let stopp = false;

  /* ------------------------------------------------ 1. what a scan looks for, beside the Scan button */
  // Regnes ut når menyen tegnes, så den følger språket som står på da
  const beskr = () => ({
    bacnet: ['BACnet', T('Enheter som svarer på Who-Is', 'Devices that answer Who-Is')],
    modbus: ['Modbus', T('Modbus TCP på port 502, bare lesing', 'Modbus TCP on port 502, read only')],
    knx: ['KNX', T('KNX-gatewayer på UDP 3671, kobler ikke til', 'KNX gateways on UDP 3671, connects to nothing')],
  });
  let pop = null, caret = null;

  function byggMeny() {
    const boks = document.querySelector('.scanbox');
    if (!boks || caret) return;
    boks.classList.add('scanbox-pos');
    caret = document.createElement('button');
    caret.type = 'button'; caret.id = 'scanMeny'; caret.className = 'btn scan-caret';
    caret.setAttribute('aria-haspopup', 'menu'); caret.setAttribute('aria-expanded', 'false');
    caret.setAttribute('aria-label', T('Hva skannet leter etter, og legg til manuelt', 'What the scan looks for, and add by hand'));
    caret.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    $('scanBtn').after(caret);
    pop = document.createElement('div');
    pop.id = 'scanPop'; pop.className = 'menu-pop scan-pop'; pop.setAttribute('role', 'menu'); pop.hidden = true;
    boks.append(pop);
    tegnMeny();
  }

  function tegnMeny() {
    if (!pop) return;
    const BESKR = beskr();
    pop.innerHTML = `<div class="scan-pop-t">${T('Skann etter', 'Scan for')}</div>
      ${PROT.map(([id]) => `<button type="button" class="menu-item scan-val${paa(id) ? ' on' : ''}" role="menuitemcheckbox" aria-checked="${paa(id)}" data-val="${id}">
        <span class="scan-val-t"><b>${esc(BESKR[id][0])}</b><small>${esc(BESKR[id][1])}</small></span><span class="scan-val-av">${paa(id) ? T('på', 'on') : T('av', 'off')}</span></button>`).join('')}
      <button type="button" class="menu-item scan-val${loadPrefs().protSpor !== false ? ' on' : ''}" role="menuitemcheckbox" aria-checked="${loadPrefs().protSpor !== false}" data-spor>
        <span class="scan-val-t"><b>${T('Spør hver gang', 'Ask every time')}</b><small>${T('Velg protokoller når du starter et skann', 'Choose protocols when you start a scan')}</small></span><span class="scan-val-av">${loadPrefs().protSpor !== false ? T('på', 'on') : T('av', 'off')}</span></button>
      <div class="menu-sep"></div>
      <div class="scan-pop-t">${T('Legg til selv', 'Add by hand')}</div>
      <button type="button" class="menu-item" role="menuitem" data-add="mb-ip">${T('Modbus-enhet (IP og port)', 'Modbus device (IP and port)')}</button>
      <button type="button" class="menu-item" role="menuitem" data-add="mb-ser">${T('Modbus på seriell port', 'Modbus on a serial port')}</button>
      <button type="button" class="menu-item" role="menuitem" data-add="kx-ip">${T('KNX-gateway (IP)', 'KNX gateway (IP)')}</button>
      <button type="button" class="menu-item" role="menuitem" data-add="kx-routing">${T('Lytt på KNX-routing', 'Listen to KNX routing')}</button>
      <div class="menu-sep"></div>
      <button type="button" class="menu-item" role="menuitem" data-add="kx-ets">${T('Importer ETS-liste …', 'Import ETS list …')}</button>
      <button type="button" class="menu-item" role="menuitem" data-add="mb-kart">${T('Importer registerkart …', 'Import register map …')}</button>`;
    // A small dot on the button says that something is switched off, so a scan that leaves one out is never a surprise
    if (caret) {
      const av = PROT.filter(([p]) => !paa(p)).map(([p]) => BESKR[p][0]);
      caret.classList.toggle('delvis', av.length > 0);
      caret.title = av.length ? T('Skannet hopper over ' + av.join(' og '), 'The scan skips ' + av.join(' and ')) : T('Skannet leter etter BACnet, Modbus og KNX', 'The scan looks for BACnet, Modbus and KNX');
    }
  }
  function lukkMeny() {
    if (pop) pop.hidden = true;
    if (caret) caret.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#scanMeny')) {
      pop.hidden = !pop.hidden;
      caret.setAttribute('aria-expanded', String(!pop.hidden));
      return;
    }
    const val = e.target.closest('#scanPop [data-val]');
    if (val) {
      // A switch keeps the menu open: more than one is often changed in a go
      const id = val.dataset.val;
      const naa = PROT.filter(([p]) => paa(p)).map(([p]) => p);
      if (paa(id) && naa.length === 1) { toast(T('Minst én må stå på', 'At least one has to stay on'), true); return; }
      savePrefs({protSok: true, ['prot' + id[0].toUpperCase() + id.slice(1)]: !paa(id)});
      tegnMeny();
      return;
    }
    if (e.target.closest('#scanPop [data-spor]')) { savePrefs({protSpor: loadPrefs().protSpor === false}); tegnMeny(); return; }
    const tillegg = e.target.closest('#scanPop [data-add]');
    if (tillegg) {
      lukkMeny();
      const a = tillegg.dataset.add;
      if (a === 'mb-ip') window.nabeMbHjelp.aapneSom('tcp');
      else if (a === 'mb-ser') window.nabeMbHjelp.aapneSom('ser');
      else if (a === 'kx-ip') window.aapneKnx();
      else if (a === 'kx-routing') window.nabeKnxHjelp.routing();
      else if (a === 'kx-ets') window.nabeKnxHjelp.importFil();
      else if (a === 'mb-kart') window.nabeMbHjelp.importFil();
      return;
    }
    if (pop && !e.target.closest('#scanPop')) lukkMeny();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lukkMeny(); });

  /* Modbus and KNX run on their own, each with its own stop: a Modbus gateway takes minutes for its whole range,
     and nothing else should wait for that. What is found goes into the list as it answers. */
  const loep = {};          // protocol -> {stopp, jobb} while it runs
  const vent = (ms) => new Promise(r => setTimeout(r, ms));
  function stoppProt(p) {
    const l = loep[p];
    if (!l) return;
    l.stopp = true;
    delete loep[p];
    if (l.jobb) api2('/api/job/' + l.jobb + '/cancel', {}).catch(() => {});
    tegnHent();
  }
  const stoppAlle = () => { stoppProt('modbus'); stoppProt('knx'); };

  /* One range for one protocol: start the job, follow it, put the devices in the list as they come. */
  async function ett(l, sti, kropp, omr) {
    const start = await api2(sti, kropp);
    if (start.status !== 'started') return [];
    l.jobb = start.job_id;
    if (l.stopp) { api2('/api/job/' + start.job_id + '/cancel', {}).catch(() => {}); return []; }
    let funnet = [];
    while (!l.stopp) {
      await vent(400);
      const j = await api2('/api/job/' + start.job_id);
      if (l.stopp) break;
      const naa = j.status === 'done' ? (j.result && j.result.devices) || [] : j.devices || [];
      if (naa.length && (naa.length > funnet.length || j.status === 'done')) {
        funnet = naa;
        mergeDevices(naa, omr);
        renderDevices();
      }
      if (j.status !== 'running') break;
    }
    return funnet;
  }

  /* `bare` is one protocol asked for with its own button; without it, the ones switched on. */
  window.skannProtokoller = async function (omraader, melding, bare) {
    const vil = ['modbus', 'knx'].filter(p => bare ? p === bare : paa(p));
    const antall = {modbus: 0, knx: 0};
    let stoppet = false;
    if (!omraader || !omraader.length || !vil.length) return antall;
    stopp = false;
    if (melding) melding(T('Søker også etter Modbus og KNX …', 'Also looking for Modbus and KNX …'));
    await Promise.all(vil.map(async (p) => {
      stoppProt(p);
      const l = loep[p] = {stopp: false, jobb: null};
      tegnHent();
      try {
        for (const omr of omraader) {
          if (l.stopp) break;
          const kropp = p === 'modbus' ? {subnet: omr, port: 502} : {subnet: omr, port: 3671, timeout: 2.0};
          const f = await ett(l, `/api/${p}/scan`, kropp, omr).catch(() => []);
          antall[p] += f.length;
        }
      } finally { stoppet = stoppet || l.stopp; if (loep[p] === l) delete loep[p]; tegnHent(); }
    }));
    if (antall.modbus || antall.knx) {
      const deler = [];
      if (antall.modbus) deler.push(T(`${antall.modbus} Modbus-enhet${antall.modbus === 1 ? '' : 'er'}`, `${antall.modbus} Modbus device${antall.modbus === 1 ? '' : 's'}`));
      if (antall.knx) deler.push(T(`${antall.knx} KNX-gateway${antall.knx === 1 ? '' : 'er'}`, `${antall.knx} KNX gateway${antall.knx === 1 ? '' : 's'}`));
      toast(T('Fant ', 'Found ') + deler.join(T(' og ', ' and ')));
    } else if (bare && !stoppet) toast(T(`Ingen ${bare === 'knx' ? 'KNX' : 'Modbus'}-enheter svarte`, `No ${bare === 'knx' ? 'KNX' : 'Modbus'} devices answered`), true);
    avtrykk();
    return antall;
  };
  window.nabeProtKjorer = (p) => p ? !!loep[p] : Object.keys(loep).length > 0;
  window.nabeProtPaa = (p) => paa(p);

  /* ------------------------------------------------ fetch one protocol at a time, above the list */
  let hentEl = null;
  function tegnHent() {
    const filter = $('protFilter');
    if (!filter) return;
    if (!hentEl) {
      hentEl = document.createElement('div');
      hentEl.id = 'protHent'; hentEl.className = 'prot-hent';
      hentEl.setAttribute('role', 'group');
      hentEl.setAttribute('aria-label', T('Hent én protokoll', 'Fetch one protocol'));
      filter.before(hentEl);
    }
    const omr = (S.scanRanges || []).join(', ');
    hentEl.hidden = !omr;
    if (!omr) return;
    const skanner = document.body.classList.contains('skanner');
    const html = `<span>${T('Hent', 'Fetch')}</span>` + PROT.map(([p, navn]) => {
      const gaar = !!loep[p];
      const n = S.devices.filter(d => protAv(d) === p).length;
      const tittel = gaar ? T(`Stopp søket etter ${navn}. Det som er funnet blir stående`, `Stop looking for ${navn}. What was found stays`)
        : T(`Søk bare etter ${navn} i ${omr}`, `Look only for ${navn} in ${omr}`);
      return `<button type="button" class="p-${p}${gaar ? ' gaar' : ''}" data-hent="${p}" title="${esc(tittel)}"${p === 'bacnet' && skanner ? ' disabled' : ''}>${
        gaar ? `<i class="spin-lite" aria-hidden="true"></i>${esc(navn)} <em>${n}</em><b>${T('Stopp', 'Stop')}</b>` : esc(navn)}</button>`;
    }).join('');
    // Bare ved endring: lista tegnes ofte, og en knapp som bygges på nytt under pekeren mister trykket
    if (hentEl._html !== html) { hentEl._html = html; hentEl.innerHTML = html; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#protHent [data-hent]');
    if (!b) return;
    const p = b.dataset.hent;
    if (loep[p]) { stoppProt(p); return; }
    const omr = (S.scanRanges || []).slice();
    if (!omr.length) return;
    if (p === 'bacnet') {
      if (document.body.classList.contains('skanner')) return;
      S._kunProt = 'bacnet';
      $('rangeInput').value = omr.join(', ');
      runScan();
    } else {
      window.skannProtokoller(omr, null, p).then(() => {
        if (omr.join() === (S.scanRanges || []).join()) husk(omr, S.devices.filter(d => !d._range || omr.includes(d._range)));
      }).catch(() => {});
    }
  });

  /* ------------------------------------------------ what to look for, asked when a scan starts */
  const velger = document.createElement('div');
  velger.id = 'skannValg'; velger.className = 'gs-overlay'; velger.setAttribute('role', 'dialog'); velger.setAttribute('aria-modal', 'true');
  velger.setAttribute('aria-labelledby', 'svTittel'); velger.hidden = true;
  document.body.append(velger);
  let velgSvar = null, valg = {};
  const HVA = {
    bacnet: () => T('Who-Is. Noen sekunder', 'Who-Is. A few seconds'),
    modbus: () => T('Port 502. Bak en gateway fylles lista underveis, hele området tar et par minutter', 'Port 502. Behind a gateway the list fills as it goes, the whole range takes a couple of minutes'),
    knx: () => T('Gatewayer på UDP 3671. Noen sekunder', 'Gateways on UDP 3671. A few seconds'),
  };
  function tegnValg() {
    const noen = PROT.some(([p]) => valg[p]);
    const spor = $('svIkkeSpor')?.checked || false;
    velger.innerHTML = `<div class="gs-modal sv-modal"><div class="gs-head"><span class="gd-tittel" id="svTittel">${T('Hva skal skannet lete etter?', 'What should the scan look for?')}</span>
        <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Avbryt', 'Cancel')}</span> ✕</button></div>
      <div class="sv-kropp">
        <div class="sp-meta">${esc($('rangeInput').value.trim())}</div>
        ${PROT.map(([p, navn]) => `<button type="button" class="sv-valg p-${p}${valg[p] ? ' paa' : ''}" data-sv="${p}" role="checkbox" aria-checked="${!!valg[p]}">
          <span class="sv-t"><b>${esc(navn)}</b><small>${esc(HVA[p]())}</small></span><span class="sv-av">${valg[p] ? T('Ja', 'Yes') : T('Nei', 'No')}</span></button>`).join('')}
        <label class="sv-spor"><input type="checkbox" id="svIkkeSpor"${spor ? ' checked' : ''}> ${T('Ikke spør igjen. Du kan endre det ved pila ved siden av Skann', 'Do not ask again. You can change it at the arrow beside Scan')}</label>
        <div class="op-knapper"><button type="button" class="btn" data-sv="alle">${T('Skann alle', 'Scan all')}</button>
          <button type="button" class="btn primary" data-sv="skann"${noen ? '' : ' disabled'}>${T('Skann', 'Scan')}</button></div>
      </div></div>`;
  }
  function velgFerdig(ok) {
    if (!velgSvar) return;
    if (ok) {
      savePrefs({protSok: true, protBacnet: !!valg.bacnet, protModbus: !!valg.modbus, protKnx: !!valg.knx, protSpor: !$('svIkkeSpor').checked});
      tegnMeny();
    }
    const svar = velgSvar;
    velgSvar = null;
    velger.hidden = true;
    svar(ok);
  }
  function velgProtokoller() {
    return new Promise((svar) => {
      velgSvar = svar;
      valg = Object.fromEntries(PROT.map(([p]) => [p, paa(p)]));
      velger.innerHTML = '';
      tegnValg();
      velger.hidden = false;
      setTimeout(() => velger.querySelector('[data-sv="skann"]')?.focus(), 30);
    });
  }
  velger.addEventListener('click', (e) => {
    if (e.target === velger || e.target.closest('.gs-close')) { velgFerdig(false); return; }
    const b = e.target.closest('[data-sv]');
    if (!b) return;
    const v = b.dataset.sv;
    if (v === 'skann') velgFerdig(true);
    else if (v === 'alle') { valg = {bacnet: true, modbus: true, knx: true}; velgFerdig(true); }
    else { valg[v] = !valg[v]; tegnValg(); velger.querySelector(`[data-sv="${v}"]`).focus(); }
  });
  document.addEventListener('keydown', (e) => {
    if (velger.hidden || !velgSvar) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); velgFerdig(false); }
    // Enter skanner, uansett hva som har fokus: mellomrom slår en protokoll av og på
    else if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); e.stopPropagation(); if (PROT.some(([p]) => valg[p])) velgFerdig(true); }
  }, true);

  /* Et skann du starter spør først (om du ikke har slått det av). Det automatiske andre forsøket, «skann dette bygget»
     og hent-knappene spør ikke. */
  const _skannValg = runScan;
  runScan = async function () {
    const stille = S._autoNeste || S._kunOmraade || S._kunProt;
    if (!stille && !document.body.classList.contains('skanner')) {
      if (velgSvar) return;
      if (loadPrefs().protSpor !== false && $('rangeInput').value.trim() && !(await velgProtokoller())) return;
      stoppAlle();
    }
    try { return await _skannValg.apply(this, arguments); }
    finally { S._kunProt = ''; tegnHent(); }
  };

  /* Who made a Modbus device that does not say: its own web page often does (the title, the Server header, the name a login
     asks for). Read once, quietly, after the scan; a page that wants a password is left alone. */
  async function avtrykk() {
    // Only where it helps: a Modbus device (nothing in its registers says who made it) and a BACnet device whose own
    // answer is blank or only names the platform. A device that already says who made it is not bothered.
    const generisk = (d) => { const v = vendorOf(d.vendor_name, d.vendor_id).label; return LEV_GENERISK.test(v) || LEV_PLATTFORM.has(v); };
    const ipAv = (d) => d.protocol === 'modbus' ? d.ip : String(d.address).split(':')[0];
    // First what the device says about itself: its model name and description often name the maker where the vendor field is blank
    // ("BACnet/IP for TwinCAT" is Beckhoff). Asked for a few at a time, only for the ones that are still unknown.
    const ukjente = S.devices.filter(d => (d.protocol === undefined || d.protocol === 'bacnet') && d.device_instance != null && !(d.address in S.identity) && generisk(d));
    for (let i = 0; i < ukjente.length && !stopp; i += 40) {
      try {
        const r = await api2('/api/identitet-batch', {enheter: ukjente.slice(i, i + 40).map(d => ({address: d.address, device_instance: d.device_instance}))});
        if (r.status !== 'done') continue;
        for (const [adr, idn] of Object.entries(r.identitet || {})) S.identity[adr] = Object.assign({}, S.identity[adr], idn);
        renderDevices();
      } catch { /* a bonus */ }
    }
    const sak = S.devices.filter(d => !d.web && d.protocol !== 'knx' && !d.serial && /^\d+\.\d+\.\d+\.\d+$/.test(ipAv(d)) && (d.protocol === 'modbus' || generisk(d)));
    const ips = [...new Set(sak.map(ipAv))];
    for (let i = 0; i < ips.length; i += 60) {
      try {
        const r = await api2('/api/web-avtrykk', {adresser: ips.slice(i, i + 60)});
        if (r.status !== 'done') continue;
        for (const d of sak) {
          const w = r.avtrykk[ipAv(d)];
          if (w === undefined) continue;
          d.web = w || {};
          if (w && w.leverandor) d.web_vendor = w.leverandor;
          if (w && w.mac) { d.mac = d.mac || w.mac; if (w.mac_vendor) d.mac_vendor = w.mac_vendor; }
        }
        renderDevices();
      } catch { /* the web page is a bonus, not a need */ }
    }
  }

  // Stopping the scan stops these two as well
  const gammel = window.cancelScan;
  if (typeof gammel === 'function') window.cancelScan = function () { stopp = true; stoppAlle(); return gammel.apply(this, arguments); };

  /* ------------------------------------------------ 2. filter above the list */
  let filter = 'alle';
  window.nabeProtOK = (d) => filter === 'alle' || protAv(d) === filter;
  window.nabeProtMeny = () => tegnMeny();      // etter språkbytte
  window.nabeProtFilterTegn = function () {
    tegnHent();
    const el = $('protFilter');
    if (!el) return;
    const tall = {bacnet: 0, modbus: 0, knx: 0};
    for (const d of S.devices) tall[protAv(d)]++;
    const flere = PROT.filter(([p]) => tall[p]).length > 1;
    if (!flere) filter = 'alle';
    el.hidden = !flere;
    if (!flere) return;
    if (filter !== 'alle' && !tall[filter]) filter = 'alle';
    el.innerHTML = [['alle', T('Alle', 'All'), S.devices.length], ...PROT.filter(([p]) => tall[p]).map(([p, n]) => [p, n, tall[p]])]
      .map(([id, navn, n]) => `<button type="button" data-filter="${id}" class="${filter === id ? 'sel' : ''}" aria-pressed="${filter === id}">${id === 'alle' ? '' : '<i></i>'}${esc(navn)} <em>${n}</em></button>`).join('');
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#protFilter [data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    renderDevices();
  });

  /* ------------------------------------------------ 3. what the row lacks */
  window.nabeProtHint = function (d) {
    if (d.protocol === 'knx' && !d.ruting_bare && window.nabeKnxHjelp && window.nabeKnxHjelp.klar() && !window.nabeKnxHjelp.harListe(d.address)) {
      return `<div class="dev-hint"><span>${T('Ingen ETS-liste, så punktene mangler navn.', 'No ETS list, so the points have no names.')}</span>
        <button type="button" data-prot="kx-import" data-adr="${esc(d.address)}">${T('Importer', 'Import')}</button></div>`;
    }
    if (d.protocol === 'modbus' && window.nabeMbHjelp && window.nabeMbHjelp.klar()) {
      const u = window.nabeMbHjelp.utforskStatus(d.address);
      if (u) {
        return `<div class="dev-hint" data-adr="${esc(d.address)}"><span class="spin-lite"></span><span>${T('Finner registre', 'Finding registers')}</span>
          <span class="utf-tall">${u.total ? T(`${u.done} av ${u.total}`, `${u.done} of ${u.total}`) : ''}</span>
          <button type="button" data-prot="mb-avbryt" data-adr="${esc(d.address)}">${T('Stopp', 'Stop')}</button></div>`;
      }
      if (!window.nabeMbHjelp.harKart(d.address)) {
        const lev = d.vendor_name || d.web_vendor;
        const kart = window.nabeMbHjelp.forslag(d);
        const forslag = kart.length ? kart.map(k => `<button type="button" data-prot="mb-bruk" data-adr="${esc(d.address)}" data-kart="${esc(k.id)}" title="${esc(T('Det lagrede kartet passer navnet på leverandøren eller modellen', 'The stored map fits the name of the maker or the model'))}">${T('Bruk', 'Use')} «${esc(k.name)}»</button>`).join('') : '';
        return `<div class="dev-hint" data-adr="${esc(d.address)}"><span>${lev ? T('Ser ut som ', 'Looks like ') + esc(lev) + '. ' : ''}${T('Ukjente registre.', 'Unknown registers.')}</span>${forslag}
          <button type="button" data-prot="mb-utforsk" data-adr="${esc(d.address)}" title="${esc(T('Prøver adressene i enheten og beholder de som svarer, så du får punkter å se på og gi navn. Bare lesing', 'Tries the addresses in the device and keeps those that answer, so you get points to look at and name. Read only'))}">${T('Finn registre', 'Find registers')}</button>
          <button type="button" data-prot="mb-kart" data-adr="${esc(d.address)}" title="${esc(T('Har du en liste med registernavn? Importer den, så får punktene navn', 'Have a list of register names? Import it and the points get names'))}">${T('Registerkart', 'Register map')}</button></div>`;
      }
    }
    return '';
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-prot]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const adr = b.dataset.adr;
    if (b.dataset.prot === 'kx-import') window.nabeKnxHjelp.importer(adr);
    else if (b.dataset.prot === 'mb-kart') window.nabeMbHjelp.importer(adr);
    else if (b.dataset.prot === 'mb-utforsk') window.nabeMbHjelp.utforsk(adr);
    else if (b.dataset.prot === 'mb-avbryt') window.nabeMbHjelp.avbryt(adr);
    else if (b.dataset.prot === 'mb-bruk') window.nabeMbHjelp.bruk(adr, b.dataset.kart);
  }, true);

  /* ------------------------------------------------ 4. right-click on a device */
  let ctx = null;
  function lukkCtx() { if (ctx) { ctx.remove(); ctx = null; } }
  async function kopier(tekst) {
    try { await navigator.clipboard.writeText(tekst); toast(T('Kopiert', 'Copied')); } catch { toast(tekst); }
  }
  async function aapneWeb(d) {
    const r = await api('/api/webside', {address: d.protocol === 'modbus' || d.protocol === 'knx' ? d.ip : d.address});
    if (r.status === 'done') toast(T(`Åpner ${r.url}`, `Opening ${r.url}`)); else toast(r.error || T('Fant ingen webside', 'Found no web page'), true);
  }
  function settLev(d, label) {
    const alle = Object.assign({}, loadPrefs().levOverstyr || {});
    if (label) alle[d.address] = label; else delete alle[d.address];
    savePrefs({levOverstyr: alle});
    renderDevices();
    toast(label ? T(`${d.object_name || d.address} ligger nå under ${label}`, `${d.object_name || d.address} is now under ${label}`) : T('Tilbake til automatisk gruppering', 'Back to automatic grouping'));
  }
  let ctxStatus = null;
  function ctxRader(d) {
    const rad = (t, fn, ekstra) => ({t, fn, ...(ekstra || {})});
    const felles = [
      rad(T('Åpne', 'Open'), () => selectDevice(d.address)),
      rad(T('Les på nytt', 'Read again'), () => { delete S.cache[d.address]; selectDevice(d.address, {force: true}); }),
    ];
    let egne = [];
    if (d.protocol === 'modbus') {
      const m = window.nabeMbHjelp;
      egne = [rad(T('Finn registre', 'Find registers'), () => m.utforsk(d.address)), rad(T('Velg registerkart …', 'Pick register map …'), () => m.importer(d.address))];
    } else if (d.protocol === 'knx') {
      const k = window.nabeKnxHjelp;
      egne = [rad(T('Importer ETS-liste …', 'Import ETS list …'), () => k.importer(d.address)), rad(T('Les alle lesbare …', 'Read all readable …'), () => k.lesAlle(d.address)),
        rad(T('Telegrammonitor', 'Telegram monitor'), () => k.monitor(d.address))];
      const tempo = [[5, T('Forsiktig', 'Careful')], [10, T('Vanlig', 'Normal')], [16, T('Raskt', 'Fast')]];
      const st = ctxStatus || {};
      const naa = Number(st.tempo) || 10;
      egne.push({sep: true}, {head: st.kjorer
        ? T(`Leser nå: ${st.spurt} av ${st.total}, ${String(st.rate || 0).replace('.', ',')} i sekundet${st.tunneler > 1 ? ', 2 tunneler' : ''}${st.bremset ? ', bremset av trafikk' : ''}`, `Reading now: ${st.spurt} of ${st.total}, ${st.rate || 0} a second${st.tunneler > 1 ? ', 2 tunnels' : ''}${st.bremset ? ', slowed by traffic' : ''}`)
        : T(`Leser ikke nå. ${st.verdier || 0} adresser har en verdi`, `Not reading now. ${st.verdier || 0} addresses have a value`)});
      egne.push(...tempo.map(([n, t]) => rad((naa === n ? '✓ ' : '') + t + T(`, ${n} i sekundet`, `, ${n} a second`), async () => { await api('/api/knx/tempo', {address: d.address, per_sekund: n}); toast(T(`Lesetempo: ${t.toLowerCase()}, ${n} i sekundet. Farten bremses også av seg selv når bussen er travel`, `Pace: ${t.toLowerCase()}, ${n} a second. It also slows by itself when the bus is busy`)); })));
    }
    // Who made it: the guesses, each one a click away, and the way back to automatic. What is chosen is remembered.
    const lev = [];
    if (d.protocol !== 'knx' && d.protocol !== 'modbus') {
      const over = levOverstyrt(d), naa = gruppeFor(d).label;
      const kand = levKandidater(d).filter(k => k.label !== naa);
      if (kand.length || over) {
        lev.push({sep: true}, {head: T('Leverandør', 'Maker')});
        for (const k of kand) lev.push(rad(T('Grupper som ', 'Group as ') + k.label + ' · ' + k.grunn, () => settLev(d, k.label)));
        if (over) lev.push(rad(T('Tilbake til automatisk', 'Back to automatic'), () => settLev(d, '')));
      }
    }
    const slutt = [
      {sep: true},
      rad(T('Kopier adresse', 'Copy address'), () => kopier(d.protocol === 'modbus' || d.protocol === 'knx' ? d.ip : d.address)),
      rad(T('Åpne i nettleser', 'Open in browser'), () => aapneWeb(d)),
      rad(T('Fjern fra lista', 'Remove from the list'), () => {
        S.devices = S.devices.filter(x => x.address !== d.address);
        if (S.activeDev && S.activeDev.address === d.address) S.activeDev = null;
        renderDevices();
      }),
    ];
    return [...felles, ...(egne.length ? [{sep: true}, ...egne] : []), ...lev, ...slutt];
  }
  document.addEventListener('contextmenu', (e) => {
    // Overskriften til et bygg (gruppert etter område): skann bare det på nytt, gi det navn
    const hode = e.target.closest('#devList .vgroup-head');
    if (hode && hode.querySelector('.vgroup-name.nett')) {
      e.preventDefault();
      lukkCtx();
      const omr = hode.dataset.vendor, navn = typeof nettNavn === 'function' ? nettNavn(omr) : '';
      const rad = (t, fn) => ({t, fn});
      visMeny([
        {head: navn || omr},
        rad(T('Skann bygget på nytt', 'Scan this building again'), () => window.skannBygg && window.skannBygg(omr)),
        rad(T('Gi navn …', 'Name it …'), () => navngiNett(omr, hode)),
        {sep: true},
        rad(T('Kopier området', 'Copy the range'), () => kopier(omr)),
      ], e.clientX, e.clientY);
      return;
    }
    const knapp = e.target.closest('#devList .dev[data-ip]');
    if (!knapp) { lukkCtx(); return; }
    const d = S.devices.find(x => x.address === knapp.dataset.ip);
    if (!d) return;
    e.preventDefault();
    lukkCtx();
    const x = e.clientX, y = e.clientY;
    if (d.protocol === 'knx') {
      // The menu says which mode the reading is in, so it is asked before the menu is drawn
      api2('/api/knx/lesestatus?address=' + encodeURIComponent(d.address)).then(s => { ctxStatus = s; visCtx(d, x, y); }).catch(() => { ctxStatus = null; visCtx(d, x, y); });
    } else visCtx(d, x, y);
  });
  function visCtx(d, xPos, yPos) { visMeny(ctxRader(d), xPos, yPos); }
  function visMeny(rader, xPos, yPos) {
    lukkCtx();
    ctx = document.createElement('div');
    ctx.className = 'menu-pop ctx-meny';
    ctx.setAttribute('role', 'menu');
    ctx.innerHTML = rader.map((r, i) => r.sep ? '<div class="menu-sep"></div>' : r.head ? `<div class="scan-pop-t">${esc(r.head)}</div>` : `<button type="button" class="menu-item" role="menuitem" data-i="${i}">${esc(r.t)}</button>`).join('');
    document.body.append(ctx);
    const b = ctx.getBoundingClientRect();
    ctx.style.left = Math.max(6, Math.min(xPos, innerWidth - b.width - 8)) + 'px';
    ctx.style.top = Math.max(6, Math.min(yPos, innerHeight - b.height - 8)) + 'px';
    ctx.addEventListener('click', (ev) => {
      const k = ev.target.closest('[data-i]');
      if (!k) return;
      const r = rader[+k.dataset.i];
      lukkCtx();
      try { r.fn(); } catch (err) { toast(String(err.message || err), true); }
    });
  }
  document.addEventListener('click', (e) => { if (ctx && !e.target.closest('.ctx-meny')) lukkCtx(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lukkCtx(); });
  window.addEventListener('blur', lukkCtx);
  document.addEventListener('scroll', lukkCtx, true);

  // COV is a BACnet thing: the choice is only there while a BACnet device is open
  const _velgBoks = window.selectDevice;
  if (typeof _velgBoks === 'function') {
    window.selectDevice = async function (adr) {
      const r = await _velgBoks.apply(this, arguments);
      const d = S.devices.find(x => x.address === adr);
      document.body.dataset.aktivProt = d ? protAv(d) : '';
      return r;
    };
  }
  /* ------------------------------------------------ 5. the list or map a device works from */
  const dato = (t) => t ? new Date(t * 1000).toLocaleString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {dateStyle: 'medium', timeStyle: 'short'}) : '';
  const stor = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB';
  const infoLag = document.createElement('div');
  infoLag.id = 'listeInfo'; infoLag.className = 'gs-overlay'; infoLag.setAttribute('role', 'dialog'); infoLag.setAttribute('aria-modal', 'true'); infoLag.hidden = true;
  document.body.append(infoLag);

  window.nabeListeInfo = async function (prot, adr) {
    const knx = prot === 'knx';
    const id = knx ? window.nabeKnxHjelp.listeId(adr) : window.nabeMbHjelp.kartId(adr);
    if (!id) { (knx ? window.aapneKnx : window.aapneModbus)(); return; }
    const i = await api2((knx ? '/api/knx/lister/info?id=' : '/api/modbus/kart/info?id=') + encodeURIComponent(id));
    if (i.status !== 'done') { toast(i.error || T('Fant ikke lista', 'Could not find the list'), true); return; }
    const rad = (navn, verdi) => verdi === '' || verdi === undefined || verdi === null ? '' : `<tr><td>${navn}</td><td>${verdi}</td></tr>`;
    const m = i.meta || {};
    const brukere = (i.brukes_av || []).map(a => a === '*' ? T('alle gatewayer', 'every gateway') : esc(String(a).replace(/^(kx|mb):/, ''))).join(', ');
    infoLag.innerHTML = `<div class="gs-modal op-modal op-bred"><div class="gs-head"><span class="gd-tittel">${knx ? T('ETS-liste', 'ETS list') : T('Registerkart', 'Register map')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="op-kropp">
        <div><div class="sim-h">${esc(i.navn)}</div><div class="sp-meta">${knx ? T('Én ETS-fil dekker hele anlegget', 'One ETS file covers the whole plant') : T('Kartet brukes av enheten du åpnet', 'The map is used by the device you opened')}</div></div>
        <table class="liste-tab"><tbody>
          ${rad(T('Opprinnelig fil', 'Original file'), esc(m.filnavn || ''))}
          ${rad(T('Importert', 'Imported'), dato(m.importert))}
          ${rad(T('Punkter', 'Points'), i.punkter + (knx ? ` · ${i.lesbare} ${T('kan leses', 'can be read')} · ${i.med_dpt} ${T('med datapunkttype', 'with a datapoint type')}` : ''))}
          ${knx ? rad(T('Linjer i prosjektet', 'Lines in the project'), i.antall_linjer ? `${i.antall_linjer} (${Object.entries(i.linjer).map(([l, n]) => `${l}: ${n}`).join(', ')}${i.antall_linjer > 8 ? ' …' : ''})` : T('ingen. Importer .knxproj-fila på nytt for å få dem, så spør hver gateway sin egen linje først', 'none. Import the .knxproj file again to get them, so each gateway asks its own line first')) : ''}
          ${!knx ? rad(T('Per type', 'By kind'), Object.entries(i.per_funksjon || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')) : ''}
          ${rad(T('Brukes av', 'Used by'), brukere)}
          ${rad(T('Lagret som', 'Stored as'), `<code class="liste-sti">${esc(i.sti)}</code> · ${stor(i.stoerrelse)}`)}
        </tbody></table>
        <div class="op-knapper">
          <button type="button" class="btn" data-li="mappe">${T('Vis i mappen', 'Show in folder')}</button>
          <button type="button" class="btn" data-li="last">${T('Last ned CSV', 'Download CSV')}</button>
          <button type="button" class="btn primary" data-li="vindu">${T('Bytt eller oppdater …', 'Change or update …')}</button>
        </div></div></div>`;
    infoLag.dataset.type = prot; infoLag.dataset.id = id;
    infoLag.hidden = false;
  };
  infoLag.addEventListener('click', async (e) => {
    if (e.target === infoLag || e.target.closest('.gs-close')) { infoLag.hidden = true; return; }
    const b = e.target.closest('[data-li]');
    if (!b) return;
    const knx = infoLag.dataset.type === 'knx';
    if (b.dataset.li === 'mappe') {
      const r = await api2('/api/apne-mappe', {type: infoLag.dataset.type, id: infoLag.dataset.id});
      if (r.status !== 'done') toast(r.error || T('Kunne ikke åpne mappen', 'Could not open the folder'), true);
    } else if (b.dataset.li === 'last') {
      if (knx) window.nabeKnxHjelp.lastNed(infoLag.dataset.id); else window.nabeMbHjelp.lastNed(infoLag.dataset.id);
    } else if (b.dataset.li === 'vindu') {
      infoLag.hidden = true;
      (knx ? window.aapneKnx : window.aapneModbus)();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !infoLag.hidden) { infoLag.hidden = true; e.stopPropagation(); } }, true);

  byggMeny();
})();
