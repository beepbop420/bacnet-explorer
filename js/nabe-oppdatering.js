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

  async function hent() {
    try { d = await (await fetch('/api/oppdatering', {cache: 'no-store'})).json(); } catch { d = null; }
    const klar = !!(d && d.ny && d.kanOppdatere && d.signert);
    chip.hidden = !klar;
    if (klar) {
      chip.textContent = T(`Oppdatering ${d.ny}`, `Update ${d.ny}`);
      chip.title = T('En ny versjon av NABE er klar. Klikk for å oppdatere', 'A new version of NABE is ready. Click to update');
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
    if (['laster', 'sjekker', 'pakker ut', 'starter'].includes(j.status)) {
      return `<div class="oppd-gar"><span class="spin"></span><span>${esc(j.tekst || T('Jobber', 'Working'))}</span></div>
        <p class="op-tekst">${T('Ikke lukk NABE. Det lukkes av seg selv når alt er sjekket.', 'Do not close NABE. It closes by itself once everything is checked.')}</p>`;
    }
    if (j.status === 'klar') {
      return `<p class="op-tekst">${T(`Versjon ${esc(j.versjon || d.ny)} er klar. NABE lukkes og starter på nytt.`, `Version ${esc(j.versjon || d.ny)} is ready. NABE closes and starts again.`)}</p>
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

  function tegn() {
    lag.innerHTML = `<div class="gs-modal op-modal"><div class="gs-head"><span class="gd-tittel">${T('Oppdatering', 'Update')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="op-kropp">${kropp()}</div></div>`;
  }

  async function folg() {
    clearInterval(timer);
    timer = setInterval(async () => {
      await hent();
      if (lag.hidden) { clearInterval(timer); return; }
      tegn();
      const s = d && d.jobb && d.jobb.status;
      if (s === 'klar') {
        clearInterval(timer);
        // The installer waits for NABE to close; closing the window is what lets it start.
        if (window.pywebview && window.pywebview.api && window.pywebview.api.lukk) setTimeout(() => window.pywebview.api.lukk(), 1500);
      } else if (s === 'feil') clearInterval(timer);
    }, 700);
  }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; clearInterval(timer); return; }
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

  window.aapneOppdatering = async () => { await hent(); tegn(); lag.hidden = false; };
  // Looked at once, a little after start, when the rest has settled.
  setTimeout(hent, 9000);
})();
