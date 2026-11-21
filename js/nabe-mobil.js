/* NABE - mobiltilgang, siden på PC-en.

   På en igangkjøring er det sjelden VPN, og PC-en står langt fra tavla. Her slår du
   på en egen port som telefonen kan nå på PC-ens hotspot eller samme nett, og
   styrer hva telefonen får lov til. Selve mobilsiden er nabe_mobil.html.
   Alt som skrives fra telefonen slippes av seg selv etter høyst N minutter, og
   skriving er av til du slår den på her. Se nabe_mobil.py. */
'use strict';

(function () {
  const MB = {data: null, timer: null, opptatt: false, egenAv: false};
  const dia = (navn, c) => { try { if (typeof nabeDia === 'function') nabeDia(navn, c || {}); } catch { /* en replikk er aldri verdt en feil */ } };

  async function post(sti, body) {
    try { return await api(sti, body || {}); } catch (e) { return {status: 'error', error: e.message}; }
  }

  async function hent() {
    try {
      const r = await fetch('/api/mobil', {cache: 'no-store'});
      if (r.ok) {
        const for_ = MB.data;
        MB.data = await r.json();
        if (for_) { MB.data.hotspotVenter = for_.hotspotVenter; MB.data.hotspotFeil = for_.hotspotFeil; }
        if (for_ && for_.paa && !MB.data.paa && !MB.egenAv) dia('mobilAutoAv');
        if (for_ && !(for_.okter || []).length && (MB.data.okter || []).length) dia('mobilKoblet');
      }
    } catch { return; }
    tegn();
  }

  function min(s) { return Math.max(0, Math.round(s / 60)); }

  /* Skann med kameraet: Wi-Fi først når hotspot er på, deretter siden med koden i adressen.
     Koden i adressen logger telefonen inn med en gang, så ingenting skal skrives. */
  function lagQr(d, adr) {
    if (!window.nabeQr || !adr.length || !d.kode) return '';
    const fig = (svg, tekst, klasse) => `<figure class="mb-qr-fig${klasse ? ' ' + klasse : ''}">${svg}<figcaption>${tekst}</figcaption></figure>`;
    const hs = d.hotspot && d.hotspot.paa && d.hotspot.ssid ? d.hotspot : null;
    const koblet = !!(d.okter && d.okter.length);
    const paaWifi = hs && (hs.klienter || 0) > 0;
    const ut = [];
    let tekst = '';
    try {
      const side = nabeQr.svg(adr[0].url + '/m?k=' + d.kode, {px: paaWifi ? 190 : 150, label: 'NABE'});
      if (hs && !paaWifi && !koblet) {
        // Steg 1: telefonen er ikke på hotspotet ennå. Koden for Wi-Fi først, siden som neste.
        ut.push(fig(nabeQr.svg(nabeQr.wifi(hs.ssid, hs.passord), {px: 170, label: 'Wi-Fi'}), T('1. Koble til ', '1. Join ') + esc(hs.ssid)));
        ut.push(fig(side, T('2. Så denne', '2. Then this'), 'neste'));
        tekst = T('Skann den første, så den andre. Én kode kan ikke gjøre begge deler.', 'Scan the first, then the second. One code cannot do both.');
      } else if (hs && paaWifi && !koblet) {
        // Steg 2: telefonen er på Wi-Fi. Da er det bare siden som mangler.
        ut.push(fig(side, T('Telefonen er på Wi-Fi. Skann denne nå', 'The phone is on the Wi-Fi. Scan this now')));
      } else {
        ut.push(fig(side, hs ? T('Skann for å åpne NABE', 'Scan to open NABE') : T('Samme Wi-Fi som PC-en, skann med kameraet', 'Same Wi-Fi as the PC, scan with the camera')));
      }
    } catch { return ''; }
    return `<div class="mb-qr">${ut.join('')}</div>${tekst ? `<div class="lk-dempet" style="margin:-4px 0 10px">${tekst}</div>` : ''}`;
  }

  function tegn() {
    const lag = $('mobilOverlay');
    if (!lag || lag.hidden) return;
    const d = MB.data || {};
    // Keep what you are typing: only redraw when the data actually changed.
    const nokkel = JSON.stringify([d.paa, d.kode, d.skriv, d.maks_min, d.okter, d.adresser, d.brannmur, d.hotspot, d.hotspotVenter, d.hotspotFeil, d.par, (d.logg || [])[0], d.okter && d.okter.length]);
    if (lag.dataset.n === nokkel && lag.querySelector('.lk-modal')) return;
    lag.dataset.n = nokkel;
    let inn;
    if (!d.paa) {
      inn = `<p class="lk-ingress">${T('Styr testen fra telefonen i stedet for å fjernstyre PC-en. Telefonen kobler til NABE her på PC-en, uten VPN og uten TeamViewer.',
        'Run the test from the phone instead of remote-controlling the PC. The phone connects to NABE on this PC, without VPN and without TeamViewer.')}</p>
        <div class="lk-blokk"><div class="lk-etikett">${T('Slik virker det', 'How it works')}</div>
        <ul class="lk-grunner">
          <li>${T('Telefonen kobler til PC-ens hotspot eller samme nett, og åpner en adresse.', 'The phone joins the PC’s hotspot or the same network and opens an address.')}</li>
          <li>${T('Du skriver en engangskode som vises her. Koden og tilgangen utløper av seg selv.', 'You type a one-time code shown here. The code and the access expire by themselves.')}</li>
          <li>${T('Skriving er av til du slår den på. Alt telefonen setter slippes av seg selv.', 'Writing is off until you turn it on. Everything the phone sets is released by itself.')}</li>
        </ul></div>
        <div class="lk-handling"><button class="btn primary" data-mb="start">${T('Slå på mobiltilgang', 'Turn on mobile access')}</button></div>
        ${d.feil ? `<div class="lk-feil">${esc(d.feil)}</div>` : ''}`;
    } else {
      const hot = (d.adresser || []).filter(a => a.type === 'hotspot');
      const lan = (d.adresser || []).filter(a => a.type !== 'hotspot');
      const adr = (hot.length ? hot : lan).slice(0, 3);
      const url = adr.length ? adr.map(a => `<div class="lk-rad mb-urlrad"><span class="mb-url">${esc(a.url)}</span><span class="lk-dempet">${esc(a.kort)}${a.type === 'hotspot' ? ' · hotspot' : ''}</span></div>`).join('')
        : `<div class="lk-dempet">${T('Ingen nett å dele ennå. Slå på hotspot i Windows, så dukker adressen opp her.', 'No network to share yet. Turn on the hotspot in Windows and the address shows up here.')}</div>`;
      const qrHtml = lagQr(d, adr);
      const koblet = (d.okter || []).length ? `<div class="mb-ok"><span aria-hidden="true">✓</span>${T('Telefonen er inne', 'The phone is in')}: ${esc(d.okter[0].navn)} <span class="lk-dempet">${esc(d.okter[0].ip)}</span></div>` : '';
      const andre = hot.length && lan.length ? `<div class="lk-dempet">${T('Samme nett: ', 'Same network: ')}${lan.slice(0, 2).map(a => esc(a.url)).join(', ')}</div>` : '';
      inn = `${koblet}<div class="lk-blokk"><div class="lk-etikett">1 · ${T('Åpne på telefonen', 'Open on the phone')}</div>${qrHtml}${url}${andre}
        ${d.hotspot && d.hotspot.paa ? `<div class="lk-rad"><span>${T('Hotspot er på', 'Hotspot is on')}: <b>${esc(d.hotspot.ssid || '')}</b></span><span class="lk-dempet">${T('passord', 'password')} <span class="lk-mono">${esc(d.hotspot.passord || '')}</span></span></div>
            <div class="lk-handling"><button class="btn" data-mb="hotspot-av"${d.hotspotVenter ? ' disabled' : ''}>${d.hotspotVenter ? T('Slår av…', 'Turning off…') : T('Slå av hotspot', 'Turn off hotspot')}</button></div>`
          : `<div class="lk-handling"><button class="btn primary" data-mb="hotspot-paa"${d.hotspotVenter ? ' disabled' : ''}>${d.hotspotVenter ? T('Starter hotspot…', 'Starting hotspot…') : T('Slå på hotspot', 'Turn on hotspot')}</button>
            <button class="btn" data-mb="hotspot">${T('Innstillinger', 'Settings')}</button></div>
            ${d.hotspotFeil ? `<div class="lk-feil">${esc(d.hotspotFeil)}</div>` : ''}`}
        <div class="lk-liten">${T('Ingen felles nett? Slå på «Mobilt hotspot» i Windows og koble telefonen til det. Det virker uten internett. Eller motsatt: slå på hotspot på telefonen og koble PC-en til det.',
          'No shared network? Turn on “Mobile hotspot” in Windows and join the phone to it. It works without internet. Or the other way round: turn on the hotspot on the phone and join the PC to it.')}</div></div>
        ${d.brannmur === false ? `<div class="lk-blokk"><div class="lk-feil" style="color:var(--warn)">${T('Windows-brannmuren kan stoppe telefonen.', 'The Windows firewall may block the phone.')}</div>
          <div class="lk-handling"><button class="btn" data-mb="brannmur">${T('Åpne for lokalt nett', 'Open for the local network')}</button></div></div>` : ''}
        <div class="lk-blokk"><div class="lk-etikett">${qrHtml ? T('Får du ikke skannet? Skriv koden', 'Cannot scan? Type the code') : '2 · ' + T('Skriv koden', 'Type the code')}</div>
          ${d.kode ? `<div class="mb-kode${qrHtml ? ' liten' : ''}">${esc(d.kode)}</div><div class="lk-dempet">${T('Gyldig i ' + min(d.kode_rest_s) + ' min', 'Valid for ' + min(d.kode_rest_s) + ' min')}</div>`
            : `<div class="lk-dempet">${T('Koden er utløpt.', 'The code has expired.')}</div>`}
          <div class="lk-handling"><button class="btn" data-mb="kode">${T('Ny kode', 'New code')}</button></div></div>
        <div class="lk-blokk"><div class="lk-etikett">${T('Hva telefonen får lov til', 'What the phone may do')}</div>
          <label class="mb-valg"><input type="checkbox" data-mb="skriv" ${d.skriv ? 'checked' : ''}> <span>${T('Tillat skriving fra mobil', 'Allow writing from the phone')}</span></label>
          <label class="mb-valg"><span>${T('Slipp alt automatisk etter', 'Release everything after')}</span>
            <select data-mb="maks">${[5, 10, 15, 30, 60].map(m => `<option value="${m}"${m === d.maks_min ? ' selected' : ''}>${m} min</option>`).join('')}</select></label>
          <div class="lk-liten">${T('Prioritet 8 eller svakere. Telefonen kan alltid slippe. Fra PC-en ser du alt under Overstyrt.', 'Priority 8 or weaker. The phone can always release. From the PC you see everything under Overridden.')}</div></div>
        ${(d.okter || []).length ? `<div class="lk-blokk"><div class="lk-etikett">${T('Tilkoblet', 'Connected')}</div>${d.okter.map(o => `<div class="lk-rad"><span>${esc(o.navn)} <span class="lk-dempet">${esc(o.ip)}</span></span>
          <span class="lk-hale">${o.par ? `<span class="lk-dempet">${T('husket', 'remembered')}</span>` : (o.kan_pare ? `<button class="btn" data-mb="par" data-id="${esc(o.id)}" title="${T('Gjenkjennes på hotspotet neste gang, uten kode', 'Recognised on the hotspot next time, without a code')}">${T('Husk', 'Remember')}</button>` : '')}
          <button class="btn" data-mb="kast" data-id="${esc(o.id)}">${T('Kast ut', 'Disconnect')}</button></span></div>`).join('')}</div>` : ''}
        ${(d.par && d.par.liste.length) || (d.okter || []).some(o => o.kan_pare) ? `<div class="lk-blokk"><div class="lk-etikett">${T('Husket', 'Remembered')}</div>
          ${(d.par.liste || []).map(e => `<div class="lk-rad"><span>${esc(e.navn)} <span class="lk-dempet lk-mono">${esc(e.mac)}</span>${e.tilkoblet ? ' <span class="lk-dempet">· ' + T('tilkoblet', 'connected') + '</span>' : ''}</span>
            <button class="btn" data-mb="par-glem" data-id="${esc(e.id)}">${T('Glem', 'Forget')}</button></div>`).join('') || `<div class="lk-dempet">${T('Ingen ennå. Trykk Husk ved en tilkoblet telefon.', 'None yet. Press Remember next to a connected phone.')}</div>`}
          <div class="lk-liten">${T('En husket telefon logges inn av seg selv når den er på hotspotet. Ingen kode og ingen QR. Skriving styres fortsatt herfra.', 'A remembered phone is signed in by itself when it is on the hotspot. No code and no QR. Writing is still controlled from here.')}</div>
          <label class="mb-valg"><input type="checkbox" data-mb="par-lan" ${d.par.lan ? 'checked' : ''}> <span>${T('Også på vanlig Wi-Fi (mindre trygt)', 'Also on regular Wi-Fi (less safe)')}</span></label></div>` : ''}
        ${(d.logg || []).length ? `<div class="lk-blokk"><div class="lk-etikett">${T('Logg', 'Log')}</div>${d.logg.slice(0, 8).map(l => `<div class="lk-dempet">${new Date(l.t * 1000).toTimeString().slice(0, 8)} · ${esc(l.tekst)}</div>`).join('')}</div>` : ''}
        <div class="lk-handling"><button class="btn" data-mb="stopp">${T('Slå av mobiltilgang', 'Turn off mobile access')}</button></div>
        <div class="lk-liten">${T('Slår seg av av seg selv om ' + Math.floor(d.av_rest_s / 3600) + ' t ' + (Math.floor(d.av_rest_s / 60) % 60) + ' min.', 'Turns itself off in ' + Math.floor(d.av_rest_s / 3600) + ' h ' + (Math.floor(d.av_rest_s / 60) % 60) + ' min.')}</div>`;
    }
    lag.innerHTML = `<div class="gs-modal lk-modal">
      <div class="gs-head"><span class="lk-tittel">${T('Mobil', 'Mobile')}</span>
        <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="lk-innhold">${inn}</div></div>`;
  }

  async function klikk(e) {
    const lag = $('mobilOverlay');
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const b = e.target.closest('[data-mb]');
    if (!b || b.type === 'checkbox' || b.tagName === 'SELECT') return;
    const k = b.dataset.mb;
    if (MB.opptatt) return;
    MB.opptatt = true;
    try {
      let r;
      if (k === 'start') { r = await post('/api/mobil/start'); if (r && r.paa) { MB.egenAv = false; dia('mobilPaa'); } }
      else if (k === 'stopp') { MB.egenAv = true; r = await post('/api/mobil/stopp'); dia('mobilAv'); }
      else if (k === 'kode') r = await post('/api/mobil/ny-kode');
      else if (k === 'hotspot-paa' || k === 'hotspot-av') {
        const paa = k === 'hotspot-paa';
        const d0 = MB.data || {};
        if (paa && d0.wifi_klient && !await nabeBekreft(T(`PC-en er koblet til Wi-Fi (${d0.wifi_klient}). Windows kan måtte flytte hotspot til samme kanal og kutte den tilkoblingen en liten stund. Fortsette?`,
            `This PC is connected to Wi-Fi (${d0.wifi_klient}). Windows may have to move the hotspot to the same channel and drop that connection for a moment. Continue?`))) { r = null; }
        else {
          MB.data = Object.assign({}, d0, {hotspotVenter: true, hotspotFeil: null});
          tegn();
          const h = await post(paa ? '/api/mobil/hotspot/paa' : '/api/mobil/hotspot/av');
          if (h.status === 'done' && h.mobil) { MB.data = h.mobil; dia(paa ? 'hotspotPaa' : 'hotspotAv'); }
          else MB.data = Object.assign({}, MB.data, {hotspotVenter: false, hotspotFeil: h.error || T('Noe gikk galt.', 'Something went wrong.')});
          r = null;
        }
      }
      else if (k === 'par') { r = await post('/api/mobil/par', {id: b.dataset.id}); if (r.status === 'error') { toast(r.error); r = null; } else dia('mobilPar'); }
      else if (k === 'par-glem') r = await post('/api/mobil/par/glem', {id: b.dataset.id});
      else if (k === 'kast') r = await post('/api/mobil/kast', {id: b.dataset.id});
      else if (k === 'hotspot') r = await post('/api/mobil/hotspot');
      else if (k === 'brannmur') { r = await post('/api/mobil/brannmur'); if (r.status === 'avbrutt') toast(r.error); else if (r.paa !== undefined) dia('mobilBrannmur'); }
      if (r && r.status === 'error') { MB.data = Object.assign({}, MB.data, {feil: r.error}); }
      else if (r && r.paa !== undefined) MB.data = r;
    } finally { MB.opptatt = false; }
    if (lag) lag.dataset.n = '';
    tegn();
  }

  async function endre(e) {
    const el = e.target.closest('[data-mb]');
    if (!el) return;
    if (el.dataset.mb === 'skriv') {
      if (el.checked && !await nabeBekreft(T('Slå på skriving fra mobil? Telefonen kan da sette verdier i anlegget (prioritet 8, slippes automatisk).', 'Allow writing from the phone? The phone can then set values in the plant (priority 8, released automatically).'))) { el.checked = false; return; }
      MB.data = await post('/api/mobil/skriv', {tillat: el.checked});
      if (el.checked) dia('mobilSkrivPaa');
    } else if (el.dataset.mb === 'par-lan') {
      MB.data = await post('/api/mobil/par/lan', {tillat: el.checked});
    } else if (el.dataset.mb === 'maks') {
      MB.data = await post('/api/mobil/maks', {min: +el.value});
    }
    tegn();
  }

  function lukk() {
    const lag = $('mobilOverlay');
    if (lag) lag.hidden = true;
    clearInterval(MB.timer);
  }

  window.aapneMobil = function () {
    let lag = $('mobilOverlay');
    if (!lag) {
      lag = document.createElement('div');
      lag.id = 'mobilOverlay';
      lag.className = 'gs-overlay';
      lag.setAttribute('role', 'dialog');
      lag.setAttribute('aria-modal', 'true');
      document.body.appendChild(lag);
      lag.addEventListener('click', klikk);
      lag.addEventListener('change', endre);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lukk(); e.stopPropagation(); } }, true);
    }
    lag.hidden = false;
    lag.dataset.n = '';
    hent();
    clearInterval(MB.timer);
    MB.timer = setInterval(hent, 2000);
  };

  if ($('mobilBtn')) $('mobilBtn').onclick = () => { closeMenus(); window.aapneMobil(); };
})();
