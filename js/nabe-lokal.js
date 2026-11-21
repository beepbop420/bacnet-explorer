/* NABE - koble direkte til en enhet.

   Du står rett på kabelen og må sette IP selv. NABE finner enheten, foreslår
   en ledig adresse i samme nett (den du brukte sist, om du har vært der),
   setter den på kortet og skanner. Husker nettet til neste gang, og viser
   en knapp for å gå tilbake til automatisk adresse så lenge NABE har
   endret noe. Bare PC-ens eget kort endres, og Windows spør om
   administrator. Ingenting skrives til anlegg. Se lokalnett.py. */
'use strict';

const LOKAL = {tilstand: null, fase: 'start', fant: null, apen: false, opptatt: false, hintet: false};

const dia = (navn, c) => { try { if (typeof nabeDia === 'function') nabeDia(navn, c || {}); } catch { /* en replikk er aldri verdt en feil */ } };

async function lokalPost(sti, body) {
  try { return await api(sti, body || {}); }
  catch (e) { return {status: 'error', error: e.message}; }
}

async function lokalHent() {
  try {
    const r = await fetch('/api/lokal', {cache: 'no-store'});
    if (!r.ok) return;
    LOKAL.tilstand = await r.json();
  } catch { return; }
  lokalRad();
  // The box is only redrawn on its first page: later pages hold what you typed and which adapter you picked.
  const felt = $('lkIpManuell');
  if (LOKAL.apen && LOKAL.fase === 'start' && !(felt && (felt.value || document.activeElement === felt))) lokalTegn();
  const k = (LOKAL.tilstand.kort || []).find(x => x.kabel && x.linklokal);
  if (k && !LOKAL.hintet && !(LOKAL.tilstand.satt || []).length) {
    LOKAL.hintet = true;
    if (typeof nabeSier === 'function') nabeSier(T(`Kabelen på ${k.navn} har ingen ordentlig adresse. Trykk «Finn enheten», så ordner vi det.`,
      `The cable on ${k.navn} has no proper address. Press “Find the device” and we will sort it out.`), 'fornoyd', 'lokal-linklokal', true);
  }
}

/* The small line under the scan field and on the start screen: a quiet link, or a sentence when it matters. */
function lokalRadHtml() {
  const t = LOKAL.tilstand || {};
  const satt = (t.satt || [])[0];
  const ukjent = (t.kort || []).find(x => x.kabel && x.linklokal);
  if (satt) {
    return ['aktiv', `<span>${T(`${esc(satt.kort)} står på fast IP ${esc(satt.ip)} fra NABE.`, `${esc(satt.kort)} is on the fixed IP ${esc(satt.ip)} set by NABE.`)}</span>
      <button type="button" class="lokal-knapp" data-lk="tilbake" data-kort="${esc(satt.kort)}">${T('Tilbake til automatisk', 'Back to automatic')}</button>`];
  }
  if (ukjent) {
    return ['aktiv', `<span>${T(`Kabel uten adresse på ${esc(ukjent.navn)}.`, `Cable without an address on ${esc(ukjent.navn)}.`)}</span>
      <button type="button" class="lokal-knapp" data-lk="apne">${T('Finn enheten', 'Find the device')}</button>`];
  }
  return ['', `<button type="button" class="lokal-lenke" data-lk="apne" title="${T('Når du står rett på kabelen og må sette IP selv', 'When you are plugged straight in and must set the IP yourself')}">${T('Koble direkte til en enhet', 'Connect directly to a device')}</button>`];
}

function lokalRad() {
  const boks = document.querySelector('.scanbox');
  let rad = $('lokalRad');
  if (!rad && boks) {
    rad = document.createElement('div');
    rad.id = 'lokalRad';
    const etter = $('veiLinje') || $('scanBtn');
    if (etter) etter.after(rad); else boks.appendChild(rad);
  }
  const [klasse, html] = lokalRadHtml();
  document.querySelectorAll('#lokalRad, .ss-lokal').forEach(el => {
    el.className = ('lokal-rad ' + klasse + (el.classList.contains('ss-lokal') ? ' ss-lokal' : '')).trim();
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  });
}

// One click handler for every place the line shows up.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.lokal-rad [data-lk]');
  if (!b) return;
  if (b.dataset.lk === 'tilbake') lokalTilbake(b.dataset.kort);
  else lokalApne();
});

// The start screen is rebuilt every time it opens; put the line in each new one.
new MutationObserver(() => {
  const h = document.querySelector('.ss-handlinger');
  if (h && !h.querySelector('.ss-lokal')) {
    const el = document.createElement('div');
    el.className = 'lokal-rad ss-lokal';
    h.appendChild(el);
    lokalRad();
  }
}).observe(document.body, {childList: true});

/* ------------------------------------------------------------------ the box */
function lokalApne() {
  let lag = $('lokalOverlay');
  if (!lag) {
    lag = document.createElement('div');
    lag.id = 'lokalOverlay';
    lag.className = 'gs-overlay';
    lag.setAttribute('role', 'dialog');
    lag.setAttribute('aria-modal', 'true');
    document.body.appendChild(lag);
    lag.addEventListener('click', lokalKlikk);
    lag.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'lkIpManuell') lokalFinn(e.target.value.trim()); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; LOKAL.apen = false; e.stopPropagation(); } }, true);
  }
  LOKAL.fase = 'start';
  LOKAL.fant = null;
  LOKAL.apen = true;
  lag.hidden = false;
  lokalTegn();
  lokalHent();
}

function lokalLukk() {
  const lag = $('lokalOverlay');
  if (lag) lag.hidden = true;
  LOKAL.apen = false;
}

function lokalKortInfo(navn) {
  const k = ((LOKAL.tilstand || {}).kort || []).find(x => x.navn === navn);
  if (!k) return '';
  if (!k.adresser.length) return T('ingen adresse', 'no address');
  const a = k.adresser[0];
  return a.ip.startsWith('169.254.') ? T('ingen ordentlig adresse', 'no proper address') : `${a.ip}/${a.prefix}`;
}

function lokalTegn() {
  const lag = $('lokalOverlay');
  if (!lag) return;
  const t = LOKAL.tilstand || {};
  let inn = '';
  if (LOKAL.fase === 'leter') {
    inn = `<div class="lk-tom"><div class="lk-stolpe"><span></span></div>${T('Spør kabelen etter enheter…', 'Asking the cable for devices…')}</div>`;
  } else if (LOKAL.fase === 'resultat') {
    inn = lokalResultat();
  } else {
    inn = lokalStart(t);
  }
  lag.innerHTML = `<div class="gs-modal lk-modal">
    <div class="gs-head">
      <span class="lk-tittel">${T('Koble direkte', 'Connect directly')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button>
    </div>
    <div class="lk-innhold">${inn}</div>
  </div>`;
}

function lokalStart(t) {
  const husket = t.husket || [];
  const satt = t.satt || [];
  const sattHtml = satt.length ? `<div class="lk-blokk">
      <div class="lk-etikett">${T('NABE har satt', 'Set by NABE')}</div>
      ${satt.map(s => `<div class="lk-rad"><span><b>${esc(s.kort)}</b> ${esc(s.ip)}/${esc(String(s.prefix || 24))}</span>
        <button class="btn" data-lk="tilbake" data-kort="${esc(s.kort)}">${T('Tilbake til automatisk', 'Back to automatic')}</button></div>`).join('')}
    </div>` : '';
  const huskHtml = husket.length ? `<div class="lk-blokk">
      <div class="lk-etikett">${T('Brukt før', 'Used before')}</div>
      ${husket.slice(0, 5).map(h => `<div class="lk-rad"><span class="lk-mono">${esc(h.nett)}</span>
        <span class="lk-dempet">${esc(h.ip)}</span>
        <span class="lk-hale"><button class="btn" data-lk="bruk" data-nett="${esc(h.nett)}">${T('Bruk', 'Use')}</button>
        <button class="lk-glem" data-lk="glem" data-nett="${esc(h.nett)}" title="${T('Glem dette nettet', 'Forget this network')}" aria-label="${T('Glem', 'Forget')}">✕</button></span></div>`).join('')}
    </div>` : '';
  return `<p class="lk-ingress">${T('Står du rett på kabelen og må sette IP selv? NABE finner enheten, foreslår en ledig adresse i samme nett og skanner.',
    'Plugged straight in and need to set the IP yourself? NABE finds the device, suggests a free address in the same network and scans.')}</p>
    <div class="lk-handling"><button class="btn primary" data-lk="finn">${T('Finn enheten på kabelen', 'Find the device on the cable')}</button></div>
    <div class="lk-blokk">
      <div class="lk-etikett">${T('Eller skriv IP-en enheten har', 'Or type the IP the device has')}</div>
      <div class="lk-felt"><input id="lkIpManuell" class="lk-input" inputmode="decimal" placeholder="192.168.1.10" autocomplete="off" spellcheck="false">
        <button class="btn" data-lk="manuell">${T('Foreslå', 'Suggest')}</button></div>
    </div>
    ${sattHtml}${huskHtml}`;
}

function lokalResultat() {
  const r = LOKAL.fant || {};
  const t = LOKAL.tilstand || {};
  const forslag = r.forslag || [];
  const rx = r.rx;
  if (!forslag.length) {
    const hort = r.hort || [];
    if (hort.length) {
      const ip = hort[0].ip;
      return `<p class="lk-ingress">${T(`NABE hørte ${esc(ip)}${hort.length > 1 ? ` og ${hort.length - 1} til` : ''}, og PC-en står allerede i samme nett. Da er det bare å skanne.`,
        `NABE heard ${esc(ip)}${hort.length > 1 ? ` and ${hort.length - 1} more` : ''}, and the PC is already in that network. Just scan.`)}</p>
        <div class="lk-handling"><button class="btn primary" data-lk="skann" data-omr="${esc(ip)}">${T('Skann', 'Scan')}</button>
        <button class="btn" data-lk="tilbakestart">${T('Tilbake', 'Back')}</button></div>`;
    }
    return `<p class="lk-ingress">${T('NABE hørte ingenting på kabelen.', 'NABE heard nothing on the cable.')}</p>
      <ul class="lk-grunner">
        <li>${T('Sjekk at kabelen sitter og at lyset på porten lyser.', 'Check that the cable is in and the port light is on.')}</li>
        <li>${rx === false ? T('NABE fikk ikke lytte på BACnet-porten. Svar som sendes til alle kan da gå tapt.', 'NABE could not listen on the BACnet port. Replies sent to everyone may be lost.')
          : T('Windows kan stoppe svar fra et ukjent nett. Tillat NABE på «offentlig» nett i brannmuren, eller skriv IP-en under.', 'Windows may block replies from an unknown network. Allow NABE on “public” networks in the firewall, or type the IP below.')}</li>
        <li>${T('Står enheten på BACnet MS/TP eller i et annet VLAN, hører ikke NABE den herfra.', 'A device on MS/TP or another VLAN cannot be heard from here.')}</li>
      </ul>
      <div class="lk-felt"><input id="lkIpManuell" class="lk-input" inputmode="decimal" placeholder="192.168.1.10" autocomplete="off" spellcheck="false">
        <button class="btn" data-lk="manuell">${T('Foreslå', 'Suggest')}</button></div>
      <div class="lk-handling"><button class="btn" data-lk="finn">${T('Prøv igjen', 'Try again')}</button>
        <button class="btn" data-lk="tilbakestart">${T('Tilbake', 'Back')}</button></div>`;
  }
  const kortene = (t.kort || []).filter(k => k.kabel);
  return forslag.map((f, i) => {
    const e = f.enheter || [];
    const hva = e.length
      ? T(`${e[0].instans != null ? 'Enhet ' + e[0].instans + ' på ' : ''}${esc(e[0].ip)}${e.length > 1 ? ` og ${e.length - 1} til` : ''}`,
          `${e[0].instans != null ? 'Device ' + e[0].instans + ' at ' : ''}${esc(e[0].ip)}${e.length > 1 ? ` and ${e.length - 1} more` : ''}`)
      : T('Nettet du brukte sist', 'The network you used last time');
    const fakta = f.kort ? `${esc(f.kort)}: ${esc(lokalKortInfo(f.kort))}` : '';
    const velg = kortene.map(k => `<option value="${esc(k.navn)}"${k.navn === f.kort ? ' selected' : ''}>${esc(k.navn)}</option>`).join('');
    const prefixer = [8, 16, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(p => `<option value="${p}"${p === f.prefix ? ' selected' : ''}>/${p}</option>`).join('');
    return `<div class="lk-kort" data-i="${i}">
      <div class="lk-hva"><b>${hva}</b></div>
      <div class="lk-dempet">${T('Nett', 'Network')} ${esc(f.nett)}${fakta ? ' · ' + T('PC-en: ', 'This PC: ') + fakta : ''}</div>
      <div class="lk-sett">
        <label><span>${T('Kort', 'Adapter')}</span><select class="lk-kortvalg">${velg}</select></label>
        <label><span>${T('Ny adresse', 'New address')}</span><input class="lk-input lk-ip" value="${esc(f.ip || '')}" spellcheck="false" autocomplete="off"></label>
        <label><span>${T('Maske', 'Mask')}</span><select class="lk-prefix">${prefixer}</select></label>
      </div>
      <div class="lk-handling">
        <button class="btn primary" data-lk="sett" data-i="${i}">${T('Sett IP og skann', 'Set IP and scan')}</button>
        <button class="btn" data-lk="kommando" data-i="${i}">${T('Vis kommando', 'Show command')}</button>
        <button class="btn" data-lk="tilbakestart">${T('Tilbake', 'Back')}</button>
      </div>
      ${f.husket ? `<div class="lk-dempet">${T('Samme adresse som sist du var her.', 'Same address as last time you were here.')}</div>` : ''}
      <div class="lk-kommando" hidden></div>
      <div class="lk-feil" role="alert" hidden></div>
      <div class="lk-liten">${T('Windows ber om administrator. NABE husker adressen og viser en knapp for å gå tilbake til automatisk. Ingenting skrives til anlegget.',
        'Windows asks for administrator. NABE remembers the address and shows a button to go back to automatic. Nothing is written to the plant.')}</div>
    </div>`;
  }).join('');
}

/* ------------------------------------------------------------------ actions */
function lokalKort(el) {
  const k = el.closest('.lk-kort');
  return {
    i: +k.dataset.i, boks: k,
    kort: k.querySelector('.lk-kortvalg').value,
    ip: k.querySelector('.lk-ip').value.trim(),
    prefix: +k.querySelector('.lk-prefix').value,
  };
}

async function lokalFinn(ip) {
  if (LOKAL.opptatt) return;
  LOKAL.opptatt = true;
  LOKAL.fase = 'leter';
  lokalTegn();
  if (!ip) dia('lokalFinn');
  const r = await lokalPost('/api/lokal/finn', ip ? {ip} : {});
  LOKAL.opptatt = false;
  if (r.status !== 'done') {
    LOKAL.fase = 'start'; lokalTegn();
    toast(r.error || T('Klarte ikke å lete', 'Could not look'), true);
    return;
  }
  LOKAL.tilstand = Object.assign({}, LOKAL.tilstand, {kort: r.kort, windows: r.windows, admin: r.admin});
  LOKAL.fant = r;
  LOKAL.fase = 'resultat';
  lokalTegn();
  if ((r.forslag || []).length) dia('lokalFant', {husket: !!r.forslag[0].husket});
  else if (!ip && !(r.hort || []).length) dia('lokalIngen');
}

async function lokalSett(el) {
  const v = lokalKort(el);
  const feil = v.boks.querySelector('.lk-feil');
  feil.hidden = true;
  el.disabled = true;
  const gammel = el.textContent;
  el.textContent = T('Venter på Windows…', 'Waiting for Windows…');
  const r = await lokalPost('/api/lokal/sett', {kort: v.kort, ip: v.ip, prefix: v.prefix});
  el.disabled = false;
  el.textContent = gammel;
  if (r.status === 'done') {
    toast(T(`${v.kort} står nå på ${r.ip}.`, `${v.kort} is now on ${r.ip}.`));
    dia('lokalSatt');
    lokalLukk();
    await lokalHent();
    await kobleTilPaaNytt();
    const omr = $('rangeInput');
    if (omr) omr.value = r.nett;
    runScan();
    return;
  }
  feil.hidden = false;
  feil.textContent = r.error || T('Noe gikk galt.', 'Something went wrong.');
  if (r.status !== 'avbrutt' && r.kommando) {
    const k = v.boks.querySelector('.lk-kommando');
    k.hidden = false;
    k.innerHTML = `<div class="lk-dempet">${T('Kjør dette i et PowerShell-vindu som administrator:', 'Run this in a PowerShell window as administrator:')}</div><pre>${esc(r.kommando)}</pre>`;
  }
}

async function lokalKommando(el) {
  const v = lokalKort(el);
  const k = v.boks.querySelector('.lk-kommando');
  if (!k.hidden) { k.hidden = true; return; }
  const r = await lokalPost('/api/lokal/sett', {kort: v.kort, ip: v.ip, prefix: v.prefix, torr: true});
  const feil = v.boks.querySelector('.lk-feil');
  if (r.status !== 'done') { feil.hidden = false; feil.textContent = r.error; return; }
  feil.hidden = true;
  k.hidden = false;
  k.innerHTML = `<div class="lk-dempet">${T('Kjør dette i et PowerShell-vindu som administrator:', 'Run this in a PowerShell window as administrator:')}</div>
    <pre>${esc(r.kommando)}</pre><button class="btn" data-lk="kopier">${T('Kopier', 'Copy')}</button>`;
  k.dataset.tekst = r.kommando;
}

async function lokalTilbake(kort) {
  const r = await lokalPost('/api/lokal/tilbake', {kort});
  if (r.status === 'done') {
    toast(r.ingenting ? T('Der var ingenting å rydde.', 'Nothing to undo.')
      : T(`${kort} er tilbake på automatisk adresse.`, `${kort} is back on an automatic address.`));
    await lokalHent();
    if (!r.ingenting) { kobleTilPaaNytt(); dia('lokalTilbake'); }
  } else {
    toast(r.error || T('Klarte ikke å gå tilbake', 'Could not go back'), true);
  }
}

function lokalKlikk(e) {
  const lag = $('lokalOverlay');
  if (e.target === lag || e.target.closest('.gs-close')) { lokalLukk(); return; }
  const b = e.target.closest('[data-lk]');
  if (!b) return;
  switch (b.dataset.lk) {
    case 'finn': lokalFinn(''); break;
    case 'manuell': lokalFinn(($('lkIpManuell') || {}).value || ''); break;
    case 'tilbakestart': LOKAL.fase = 'start'; lokalTegn(); break;
    case 'bruk': {
      const h = ((LOKAL.tilstand || {}).husket || []).find(x => x.nett === b.dataset.nett);
      if (!h) break;
      LOKAL.fant = {hort: [], rx: null, forslag: [{nett: h.nett, prefix: h.prefix || 24, enheter: [], ip: h.ip, kort: h.kort, husket: true}]};
      LOKAL.fase = 'resultat'; lokalTegn();
      break;
    }
    case 'glem': lokalPost('/api/lokal/glem', {nett: b.dataset.nett}).then(lokalHent); break;
    case 'sett': lokalSett(b); break;
    case 'kommando': lokalKommando(b); break;
    case 'kopier': {
      const tekst = b.closest('.lk-kommando').dataset.tekst || '';
      navigator.clipboard.writeText(tekst).then(() => toast(T('Kopiert', 'Copied'))).catch(() => toast(T('Kunne ikke kopiere', 'Could not copy'), true));
      break;
    }
    case 'tilbake': lokalTilbake(b.dataset.kort); break;
    case 'skann': {
      lokalLukk();
      const omr = $('rangeInput');
      if (omr) omr.value = b.dataset.omr;
      runScan();
      break;
    }
  }
}

window.nabeLokal = {apne: lokalApne, hent: lokalHent};
lokalHent();
setInterval(() => { if (!document.hidden) lokalHent(); }, 20000);
