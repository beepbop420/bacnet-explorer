/* NABE - update from inside the app.

   When a newer release exists, the status bar says so. One button downloads it,
   checks the maintainer's signature on it, closes NABE, installs and starts it
   again. The signature is what makes that safe to do by itself: a file that does
   not verify is thrown away and nothing is changed. Your sites, settings and
   write log live outside the program folder and are not touched.

   Only an installed NABE does this. A copy run from a source folder or a
   portable zip is never overwritten; there the button says where to download. */
'use strict';

(function oppdatering() {
  let d = null;          // the server's answer, null when GitHub could not be reached
  let timer = 0;

  const lag = document.createElement('div');
  lag.id = 'oppdOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'sbOppd';
  chip.className = 'sb-item sb-oppd';
  chip.hidden = true;
  chip.onclick = () => window.aapneOppdatering();
  document.querySelector('.statusbar')?.append(chip);

  let meldt = null;      // the version the technician has already been told about
  let sist = 0;          // when GitHub was last asked about

  async function hent() {
    try { d = await (await fetch('/api/oppdatering', {cache: 'no-store'})).json(); } catch { d = null; }
    sist = Date.now();
    const klar = !!(d && d.ny && d.kanOppdatere && d.signert);
    chip.hidden = !klar;
    if (klar) {
      chip.textContent = T(`Oppdatering ${d.ny}`, `Update ${d.ny}`);
      chip.title = T('En ny versjon av NABE er klar. Klikk for å oppdatere', 'A new version of NABE is ready. Click to update');
      // Said once, when it turns up while NABE is open: no restart is needed to find out
      if (meldt !== d.ny) {
        const forste = meldt === null && !chip.dataset.sett;
        meldt = d.ny;
        chip.dataset.sett = '1';
        chip.classList.add('puls');
        setTimeout(() => chip.classList.remove('puls'), 6000);
        if (!forste) toast(T(`NABE ${d.ny} er ute. Trykk på «Oppdatering» nederst for å hente den`, `NABE ${d.ny} is out. Press "Update" at the bottom to get it`));
      }
    }
    return d;
  }

  // Release notes are written in English and are a list; show them as one.
  const notater = (tekst) => String(tekst || '').split('\n')
    .map(l => l.trim()).filter(l => /^[-*] /.test(l)).slice(0, 12)
    .map(l => `<li>${esc(l.replace(/^[-*] /, ''))}</li>`).join('');

  function kropp() {
    if (!d || d.status !== 'done') {
      return `<p class="op-tekst">${T('Fikk ikke kontakt med GitHub. Prøv igjen når du har nett.', 'Could not reach GitHub. Try again when you are online.')}</p>`;
    }
    const j = d.jobb || {};
    if (j.status === 'klar') {
      return `<div class="oppd-ferdig"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${T('Ferdig', 'Done')}</span></div>
        <p class="op-tekst">${T(`Versjon ${esc(j.versjon || d.ny)} er klar. NABE lukkes og starter på nytt.`, `Version ${esc(j.versjon || d.ny)} is ready. NABE closes and starts again.`)}</p>
        ${window.pywebview ? '' : `<p class="op-tekst">${T('Lukk NABE for å fullføre. Den starter igjen av seg selv.', 'Close NABE to finish. It starts again by itself.')}</p>`}`;
    }
    if (!d.ny) {
      return `<p class="op-tekst">${T(`Du har den nyeste versjonen (${esc(d.her)}).`, `You have the newest version (${esc(d.her)}).`)}</p>`;
    }
    const liste = notater(d.notater);
    const feil = j.status === 'feil' ? `<p class="oppd-feil">${esc(j.feil)}</p>` : '';
    const topp = `<div><div class="sim-h">${T(`NABE ${esc(d.ny)} er ute`, `NABE ${esc(d.ny)} is out`)}</div>
      <div class="sp-meta">${T(`Du har ${esc(d.her)}`, `You have ${esc(d.her)}`)}</div></div>`;
    const nytt = liste ? `<ul class="oppd-nytt">${liste}</ul>` : '';
    if (!d.kanOppdatere || !d.signert) {
      return `${topp}${nytt}<p class="op-tekst">${!d.kanOppdatere
        ? T('Oppdatering i appen virker bare for installert NABE. Last ned den nye versjonen fra GitHub: github.com/beepbop420/bacnet-explorer/releases/latest',
            'Updating from inside the app only works for an installed NABE. Download the new version from GitHub: github.com/beepbop420/bacnet-explorer/releases/latest')
        : T('Denne utgivelsen er ikke signert, så appen installerer den ikke selv. Last den ned fra GitHub.',
            'This release is not signed, so the app does not install it. Download it from GitHub.')}</p>`;
    }
    const mine = (typeof MINE !== 'undefined' && MINE.size) ? MINE.size : 0;
    const advar = mine ? `<p class="oppd-feil">${T(`Du har ${mine} overstyrte punkter. Frigi dem før NABE lukkes.`, `You have ${mine} overridden points. Release them before NABE closes.`)}</p>` : '';
    return `${topp}${nytt}${feil}${advar}
      <p class="op-tekst">${T('NABE lastes ned, sjekkes mot signaturen, lukkes og starter igjen. Anlegg, innstillinger og skrivelogg beholdes.',
                              'NABE is downloaded, checked against the signature, closed and started again. Sites, settings and the write log are kept.')}</p>
      <div class="op-knapper"><button type="button" class="btn primary" data-oppd="start">${mine ? T('Oppdater likevel', 'Update anyway') : T(`Oppdater til ${esc(d.ny)}`, `Update to ${esc(d.ny)}`)}</button></div>`;
  }

  /* The job runs in four steps. Each has a few lines to read while it goes; they change slowly, one at a time. */
  const STEG = [
    ['laster', T('Laster ned', 'Downloading'), [
      T('Henter pakken. Den er tyngre enn den ser ut', 'Fetching the package. It is heavier than it looks'),
      T('Teller bytes, en etter en', 'Counting bytes, one at a time'),
      T('Venter på at GitHub finner den frem', 'Waiting for GitHub to find it'),
      T('Dette er den delen der man får seg en kaffe', 'This is the part where you get a coffee')]],
    ['sjekker', T('Sjekker signaturen', 'Checking the signature'), [
      T('Holder signaturen opp mot lyset', 'Holding the signature up to the light'),
      T('Vi stoler ikke på hvem som helst', 'We do not trust just anyone'),
      T('Sammenligner med nøkkelen i NABE', 'Comparing with the key inside NABE')]],
    ['pakker ut', T('Pakker ut', 'Unpacking'), [
      T('Skrur sammen de nye delene', 'Screwing the new parts together'),
      T('Legger filene på plass, pent og ryddig', 'Putting the files in place, neat and tidy'),
      T('Sjekker at ingenting havner utenfor mappa', 'Making sure nothing lands outside the folder')]],
    ['starter', T('Starter på nytt', 'Restarting'), [
      T('Slår av lyset og slår det på igjen', 'Turning the light off and on again'),
      T('NABO holder deg i hånden til vi er tilbake', 'NABO holds your hand until we are back'),
      T('Anlegg og innstillinger er i trygg avstand', 'Sites and settings are at a safe distance')]],
  ];
  let linjeTimer = 0, linjeNr = 0, linjeSteg = '';

  function gaarSkall() {
    return `<ol class="oppd-steg">${STEG.map(([id, navn]) => `<li data-s="${id}"><i></i><span>${esc(navn)}</span></li>`).join('')}</ol>
      <div class="oppd-stolpe" role="progressbar" aria-valuemin="0" aria-valuemax="100"><b></b></div>
      <div class="oppd-under"><span class="oppd-linje"></span><em class="oppd-tall"></em></div>
      <p class="op-tekst">${T('Ikke lukk NABE. Det lukkes av seg selv når alt er sjekket.', 'Do not close NABE. It closes by itself once everything is checked.')}</p>`;
  }

  // Only what changed is touched, so nothing flickers and the bar glides instead of jumping
  function oppdaterGaar(j) {
    const nr = Math.max(0, STEG.findIndex(s => s[0] === j.status));
    lag.querySelectorAll('.oppd-steg li').forEach((li, i) => {
      li.classList.toggle('ferdig', i < nr);
      li.classList.toggle('na', i === nr);
    });
    const mb = (x) => (x / 1048576).toFixed(1).replace('.', T(',', '.'));
    let pst = [4, 66, 82, 95][nr];
    let tall = '';
    if (nr === 0 && j.total > 0) {
      pst = Math.max(4, Math.min(60, (j.gjort / j.total) * 60));
      tall = T(`${mb(j.gjort)} av ${mb(j.total)} MB`, `${mb(j.gjort)} of ${mb(j.total)} MB`);
    }
    const stolpe = lag.querySelector('.oppd-stolpe');
    if (stolpe) { stolpe.firstElementChild.style.width = pst.toFixed(1) + '%'; stolpe.setAttribute('aria-valuenow', Math.round(pst)); }
    const t = lag.querySelector('.oppd-tall'); if (t) t.textContent = tall;
    if (linjeSteg !== j.status) { linjeSteg = j.status; linjeNr = 0; visLinje(); }
  }
  function visLinje() {
    clearInterval(linjeTimer);
    const el = lag.querySelector('.oppd-linje');
    const steg = STEG.find(s => s[0] === linjeSteg);
    if (!el || !steg) return;
    const sett = () => {
      el.classList.add('bort');
      setTimeout(() => { el.textContent = steg[2][linjeNr++ % steg[2].length]; el.classList.remove('bort'); }, 260);
    };
    el.textContent = steg[2][linjeNr++ % steg[2].length];
    linjeTimer = setInterval(sett, 3600);
  }

  function tegn() {
    // The frame is built once. Redrawing it every time the job reports back is what made the window stutter.
    if (!lag.querySelector('.op-modal')) {
      lag.innerHTML = `<div class="gs-modal op-modal"><div class="gs-head"><span class="gd-tittel">${T('Oppdatering', 'Update')}</span>
        <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
        <div class="op-kropp"></div></div>`;
    }
    const holder = lag.querySelector('.op-kropp');
    const j = (d && d.jobb) || {};
    const gar = !!(d && d.status === 'done' && ['laster', 'sjekker', 'pakker ut', 'starter'].includes(j.status));
    if (gar) {
      if (!holder.querySelector('.oppd-steg')) { holder.innerHTML = gaarSkall(); linjeSteg = ''; }
      oppdaterGaar(j);
    } else {
      clearInterval(linjeTimer);
      const html = kropp();
      if (holder._html !== html) { holder.innerHTML = html; holder._html = html; }
    }
  }

  async function folg() {
    clearInterval(timer);
    timer = setInterval(async () => {
      await hent();
      if (lag.hidden) { clearInterval(timer); clearInterval(linjeTimer); return; }
      tegn();
      const s = d && d.jobb && d.jobb.status;
      if (s === 'klar') {
        clearInterval(timer);
        // The installer waits for NABE to close; closing the window is what lets it start.
        if (window.pywebview && window.pywebview.api && window.pywebview.api.lukk) setTimeout(() => window.pywebview.api.lukk(), 1500);
      } else if (s === 'feil') clearInterval(timer);
    }, 450);
  }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; clearInterval(timer); clearInterval(linjeTimer); return; }
    if (e.target.closest('[data-oppd="start"]')) {
      const r = await api('/api/oppdater', {});
      if (r.status !== 'started') { toast(r.error || T('Fikk ikke startet oppdateringen', 'Could not start the update'), true); return; }
      await hent();
      tegn();
      folg();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; clearInterval(timer); e.stopPropagation(); }
  }, true);

  window.aapneOppdatering = async () => {
    lag.innerHTML = '';
    await hent(); tegn(); lag.hidden = false;
    // Opened in the middle of a job (the window was closed and opened again): carry on following it
    const s = d && d.jobb && d.jobb.status;
    if (['laster', 'sjekker', 'pakker ut', 'starter'].includes(s)) folg();
  };
  // Looked at once, a little after start, when the rest has settled. Then every ten minutes while NABE is open,
  // and when the window comes back after a while, so a new version never waits for a restart to be found.
  setTimeout(hent, 9000);
  setInterval(() => { if (lag.hidden && !document.hidden) hent(); }, 600000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && lag.hidden && Date.now() - sist > 300000) hent();
  });
})();
