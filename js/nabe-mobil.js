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

  /* Test oppsettet: kabel, port, brannmur, hotspot og telefonoppslag, hver med hva du kan gjøre.
     Tilstand står med symbol og ord (✓ ▲ ✕ –), aldri med farge alene. */
  const MERKE = {ok: '✓', merk: '!', feil: '✕', ukjent: '–'};
  const FIKS = {start: ['start', 'Slå på', 'Turn on'], brannmur: ['brannmur', 'Åpne', 'Open'], hotspot: ['hotspot-paa', 'Slå på', 'Turn on'], lokal: ['lokal', 'Koble direkte', 'Connect directly']};
  const nb = (par) => (Array.isArray(par) ? T(par[0], par[1]) : '');

  function sjekkHtml() {
    const tittel = `<div class="lk-etikett">${T('Test oppsettet', 'Check the setup')}</div>`;
    if (MB.sjekker) return `<div class="lk-blokk">${tittel}<div class="lk-dempet">${T('Sjekker kabel, port, brannmur og hotspot…', 'Checking cable, port, firewall and hotspot…')}</div></div>`;
    const s = MB.sjekk;
    if (!s) return '';
    const sm = s.sammendrag || {};
    const bra = sm.ok || 0, tot = (s.sjekk || []).length;
    const rader = (s.sjekk || []).map(r => {
      const f = FIKS[r.fiks];
      return `<div class="mb-sj ${esc(r.status)}"><span class="mk" aria-hidden="true">${MERKE[r.status] || '–'}</span>
        <span><b>${esc(nb(r.tittel))}</b>${r.detalj && r.detalj[0] ? `<span class="lk-dempet"> ${esc(nb(r.detalj))}</span>` : ''}</span>
        ${f ? `<button class="btn" data-mb="${f[0]}">${T(f[1], f[2])}</button>` : '<span></span>'}</div>`;
    }).join('');
    return `<div class="lk-blokk">${tittel}<div class="lk-dempet">${T(`${bra} av ${tot} i orden`, `${bra} of ${tot} in order`)}${sm.feil ? T(`, ${sm.feil} feil`, `, ${sm.feil} failed`) : ''}${sm.merk ? T(`, ${sm.merk} å se på`, `, ${sm.merk} to look at`) : ''}</div>
      <div class="mb-sjliste">${rader}</div>
      <div class="lk-handling"><button class="btn" data-mb="sjekk">${T('Test på nytt', 'Check again')}</button><button class="btn" data-mb="sjekk-kopier">${T('Kopier som melding', 'Copy as a message')}</button></div></div>`;
  }

  async function kjorSjekk() {
    MB.sjekker = true;
    tegn();
    const r = await post('/api/mobil/sjekk');
    MB.sjekk = r.status === 'done' ? r : null;
    MB.sjekker = false;
    if (lag0()) lag0().dataset.n = '';
    tegn();
  }
  const lag0 = () => $('mobilOverlay');

  function sjekkTekst() {
    const s = MB.sjekk;
    if (!s) return '';
    return 'NABE, oppsett ' + new Date().toLocaleString() + '\n' + (s.sjekk || []).map(r => `${MERKE[r.status] || '-'} ${nb(r.tittel)}${r.detalj && r.detalj[0] ? ' - ' + nb(r.detalj) : ''}`).join('\n');
  }

  /* Loggen: hva telefonen gjorde, med navn på telefonen. Ligger i en fil, så den overlever at porten slås av. */
  function loggLinjer() {
    const l = MB.loggFull || (MB.data && MB.data.logg) || [];
    return MB.loggAapen ? l : l.slice(0, 6);
  }
  const loggTid = (t) => new Date(t * 1000).toTimeString().slice(0, 8);
  function loggHtml() {
    const alle = MB.loggFull || (MB.data && MB.data.logg) || [];
    if (!alle.length) return '';
    return `<div class="lk-blokk"><div class="lk-etikett">${T('Logg', 'Log')}</div>
      ${loggLinjer().map(l => `<div class="lk-dempet">${loggTid(l.t)} · ${l.navn ? esc(l.navn) + ' · ' : ''}${esc(l.tekst)}</div>`).join('')}
      <div class="lk-handling"><button class="btn" data-mb="logg-mer">${MB.loggAapen ? T('Færre', 'Fewer') : T('Vis alt', 'Show all')}</button>
        <button class="btn" data-mb="logg-kopier">${T('Kopier', 'Copy')}</button><button class="btn" data-mb="logg-csv">${T('Last ned', 'Download')}</button>
        <button class="btn" data-mb="logg-tom">${T('Tøm', 'Clear')}</button></div></div>`;
  }
  function loggCsv(l) {
    const c = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    return ['tid;telefon;ip;type;enhet;punkt;verdi;ok;tekst'].concat(l.slice().reverse().map(r =>
      [new Date(r.t * 1000).toLocaleString(), r.navn, r.ip, r.type, r.enhet, r.punkt, r.verdi, r.ok === undefined ? '' : (r.ok ? 'ja' : 'nei'), r.tekst].map(c).join(';'))).join('\n');
  }

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
    const nokkel = JSON.stringify([d.paa, d.kode, d.skriv, d.maks_min, d.okter, d.adresser, d.brannmur, d.hotspot, d.hotspotVenter, d.hotspotFeil, d.par, (d.logg || [])[0], d.okter && d.okter.length, MB.sjekk, MB.sjekker, MB.loggAapen, (MB.loggFull || []).length]);
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
        <div class="lk-handling"><button class="btn primary" data-mb="start">${T('Slå på mobiltilgang', 'Turn on mobile access')}</button>
          <button class="btn" data-mb="sjekk">${T('Test oppsettet', 'Check the setup')}</button></div>
        ${sjekkHtml()}
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
          : (d.hotspot_sperret
            ? `<div class="lk-feil" style="color:var(--warn)">! ${T('Hotspot er sperret på denne PC-en (IT-regler).', 'The hotspot is blocked on this PC (IT rules).')}</div>
              <div class="lk-handling"><button class="btn" data-mb="hotspot">${T('Se innstillingene', 'See the settings')}</button></div>`
            : `<div class="lk-handling"><button class="btn primary" data-mb="hotspot-paa"${d.hotspotVenter ? ' disabled' : ''}>${d.hotspotVenter ? T('Starter hotspot…', 'Starting hotspot…') : T('Slå på hotspot', 'Turn on hotspot')}</button>
            <button class="btn" data-mb="hotspot">${T('Innstillinger', 'Settings')}</button></div>
            ${d.hotspotFeil ? `<div class="lk-feil">${esc(d.hotspotFeil)}</div>` : ''}`)}
        <div class="lk-liten">${d.hotspot_sperret
          ? T('Slå på hotspot på telefonen og koble PC-en til det. Det virker uten internett. Eller koble telefonen til PC-en med USB og slå på USB-deling i telefonen. Så viser adressen over seg selv.',
            'Turn on the hotspot on the phone and join the PC to it. It works without internet. Or connect the phone to the PC with USB and turn on USB tethering in the phone. The address above then shows by itself.')
          : T('Ingen felles nett? Slå på «Mobilt hotspot» i Windows og koble telefonen til det. Det virker uten internett. Eller motsatt: slå på hotspot på telefonen og koble PC-en til det.',
            'No shared network? Turn on “Mobile hotspot” in Windows and join the phone to it. It works without internet. Or the other way round: turn on the hotspot on the phone and join the PC to it.')}</div></div>
        ${d.brannmur === false ? (() => {
          const off = d.wifi_profil && d.wifi_profil.kat === 'Public';
          return `<div class="lk-blokk"><div class="lk-feil" style="color:var(--warn)">${off
            ? T(`✕ Windows slipper ikke telefonen inn. Nettet «${esc(d.wifi_profil.navn)}» er offentlig, og da er alt utenfra stengt til det finnes en regel.`, `✕ Windows does not let the phone in. The network “${esc(d.wifi_profil.navn)}” is public, and then everything from outside is shut until there is a rule.`)
            : T('! Windows-brannmuren kan stoppe telefonen.', '! The Windows firewall may block the phone.')}</div>
          <div class="lk-handling"><button class="btn${off ? ' primary' : ''}" data-mb="brannmur">${T('Åpne for lokalt nett', 'Open for the local network')}</button></div>
          <div class="lk-liten">${T('Regelen gjelder bare det lokale nettet og bare porten til NABE. Windows spør om administrator.', 'The rule covers only the local network and only the NABE port. Windows asks for an administrator.')}</div></div>`;
        })() : ''}
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
        ${sjekkHtml() || `<div class="lk-handling"><button class="btn" data-mb="sjekk">${T('Test oppsettet', 'Check the setup')}</button></div>`}
        ${loggHtml()}
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
      else if (k === 'sjekk') { MB.opptatt = false; await kjorSjekk(); return; }
      else if (k === 'sjekk-kopier') {
        try { await navigator.clipboard.writeText(sjekkTekst()); toast(T('Kopiert. Lim den inn i en melding.', 'Copied. Paste it into a message.')); } catch { toast(T('Kunne ikke kopiere', 'Could not copy')); }
        r = null;
      }
      else if (k === 'lokal') { if (window.nabeLokal) { lukk(); window.nabeLokal.apne(); } r = null; }
      else if (k === 'logg-mer') {
        MB.loggAapen = !MB.loggAapen;
        if (MB.loggAapen) { const j = await fetch('/api/mobil/logg', {cache: 'no-store'}).then(x => x.json()).catch(() => null); if (j && j.logg) MB.loggFull = j.logg; }
        r = null;
      }
      else if (k === 'logg-kopier' || k === 'logg-csv') {
        const j = await fetch('/api/mobil/logg', {cache: 'no-store'}).then(x => x.json()).catch(() => null);
        const l = (j && j.logg) || [];
        if (k === 'logg-csv') downloadText(loggCsv(l), 'nabe-mobil-logg.csv');
        else { try { await navigator.clipboard.writeText(l.slice().reverse().map(x => `${new Date(x.t * 1000).toLocaleString()} ${x.navn ? x.navn + ' ' : ''}${x.tekst}`).join('\n')); toast(T('Loggen er kopiert', 'The log is copied')); } catch { toast(T('Kunne ikke kopiere', 'Could not copy')); } }
        r = null;
      }
      else if (k === 'logg-tom') {
        if (await nabeBekreft(T('Tømme loggen over hva telefonen har gjort? Det kan ikke angres.', 'Clear the log of what the phone has done? This cannot be undone.'))) { await post('/api/mobil/logg/tom'); MB.loggFull = null; MB.loggAapen = false; }
        r = null;
      }
      else if (k === 'hotspot') r = await post('/api/mobil/hotspot');
      else if (k === 'brannmur') { r = await post('/api/mobil/brannmur'); if (r.status === 'avbrutt') toast(r.error); else if (r.paa !== undefined) dia('mobilBrannmur'); }
      if (r && r.status === 'error') { MB.data = Object.assign({}, MB.data, {feil: r.error}); }
      else if (r && r.paa !== undefined) MB.data = r;
    } finally { MB.opptatt = false; }
    // Etter et tiltak fra sjekklisten sier listen fra seg selv om det ble bra.
    if (MB.sjekk && ['start', 'brannmur', 'hotspot-paa', 'hotspot-av', 'stopp'].includes(k)) await kjorSjekk();
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
  if ($('mobilTopBtn')) $('mobilTopBtn').onclick = () => window.aapneMobil();
})();
