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
  const paa = (p) => loadPrefs().protSok !== false && loadPrefs()['prot' + p[0].toUpperCase() + p.slice(1)] !== false;
  const protAv = (d) => d.protocol === 'modbus' ? 'modbus' : d.protocol === 'knx' ? 'knx' : 'bacnet';
  let stopp = false;

  /* ------------------------------------------------ 1. what a scan looks for, beside the Scan button */
  const BESKR = {
    bacnet: [T('BACnet', 'BACnet'), T('Enheter som svarer på Who-Is', 'Devices that answer Who-Is')],
    modbus: [T('Modbus', 'Modbus'), T('Modbus TCP på port 502, bare lesing', 'Modbus TCP on port 502, read only')],
    knx: [T('KNX', 'KNX'), T('KNX-gatewayer på UDP 3671, kobler ikke til', 'KNX gateways on UDP 3671, connects to nothing')],
  };
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
    pop.innerHTML = `<div class="scan-pop-t">${T('Skann etter', 'Scan for')}</div>
      ${PROT.map(([id]) => `<button type="button" class="menu-item scan-val${paa(id) ? ' on' : ''}" role="menuitemcheckbox" aria-checked="${paa(id)}" data-val="${id}">
        <i class="prot-prikk p-${id}"></i><span class="scan-val-t"><b>${esc(BESKR[id][0])}</b><small>${esc(BESKR[id][1])}</small></span><span class="scan-val-av">${paa(id) ? T('på', 'on') : T('av', 'off')}</span></button>`).join('')}
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
    const valg = e.target.closest('#scanPop [data-add]');
    if (valg) {
      lukkMeny();
      const a = valg.dataset.add;
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

  /* One range for one protocol: start the job, follow it, return the devices it found. */
  async function ett(sti, kropp, omr) {
    const start = await api2(sti, kropp);
    if (start.status !== 'started') return [];
    for (let i = 0; i < 600 && !stopp; i++) {
      await new Promise(r => setTimeout(r, 400));
      const j = await api2('/api/job/' + start.job_id);
      if (j.status === 'running') continue;
      if (j.status !== 'done') return [];
      const funnet = (j.result && j.result.devices) || [];
      mergeDevices(funnet, omr);
      return funnet;
    }
    return [];
  }

  window.skannProtokoller = async function (omraader, melding) {
    const mb = paa('modbus'), kx = paa('knx');
    if (!omraader || !omraader.length || (!mb && !kx)) return {modbus: 0, knx: 0};
    stopp = false;
    let nMb = 0, nKx = 0;
    if (melding) melding(T('Søker også etter Modbus og KNX …', 'Also looking for Modbus and KNX …'));
    for (const omr of omraader) {
      if (stopp) break;
      const [a, b] = await Promise.all([
        mb ? ett('/api/modbus/scan', {subnet: omr, port: 502}, omr).catch(() => []) : [],
        kx ? ett('/api/knx/scan', {subnet: omr, port: 3671, timeout: 2.0}, omr).catch(() => []) : [],
      ]);
      nMb += a.length; nKx += b.length;
      if (a.length || b.length) renderDevices();
    }
    if (nMb || nKx) {
      const deler = [];
      if (nMb) deler.push(T(`${nMb} Modbus-enhet${nMb === 1 ? '' : 'er'}`, `${nMb} Modbus device${nMb === 1 ? '' : 's'}`));
      if (nKx) deler.push(T(`${nKx} KNX-gateway${nKx === 1 ? '' : 'er'}`, `${nKx} KNX gateway${nKx === 1 ? '' : 's'}`));
      toast(T('Fant også ', 'Also found ') + deler.join(T(' og ', ' and ')));
    }
    avtrykk();
    return {modbus: nMb, knx: nKx};
  };

  /* Who made a Modbus device that does not say: its own web page often does (the title, the Server header, the name a login
     asks for). Read once, quietly, after the scan; a page that wants a password is left alone. */
  async function avtrykk() {
    // Only where it helps: a Modbus device (nothing in its registers says who made it) and a BACnet device whose own
    // answer is blank or only names the platform. A device that already says who made it is not bothered.
    const generisk = (d) => { const v = vendorOf(d.vendor_name, d.vendor_id).label; return LEV_GENERISK.test(v) || LEV_PLATTFORM.has(v); };
    const ipAv = (d) => d.protocol === 'modbus' ? d.ip : String(d.address).split(':')[0];
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

  // Stopping the scan stops the wait for these two as well
  const gammel = window.cancelScan;
  if (typeof gammel === 'function') window.cancelScan = function () { stopp = true; return gammel.apply(this, arguments); };

  /* ------------------------------------------------ 2. filter above the list */
  let filter = 'alle';
  window.nabeProtOK = (d) => filter === 'alle' || protAv(d) === filter;
  window.nabeProtFilterTegn = function () {
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
  function visCtx(d, xPos, yPos) {
    lukkCtx();
    const rader = ctxRader(d);
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
