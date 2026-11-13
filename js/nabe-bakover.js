/* NABE - look back.

   The points you pin to Watch are read quietly in the background by the server,
   whatever the page is doing, and the last two hours are kept. When something
   happens - a valve that will not settle, an alarm you only just noticed - the
   answer to "what was it doing before?" is already there, without having
   started a recording first.

   This file sends the watch list to the server, shows what it has recorded as one
   small chart per point, and speaks up when the hunting detector finds a loop
   that is swinging: "RT401 has been hunting since 14:10". */
'use strict';

(function bakover() {
  const MIN = [30, 60, 120];
  let minutter = 60, data = null, varsler = [], sendt = null, klar = false, tidtaker = 0;
  const rader = new Map();         // key -> {t, v, enhet}, for the pointer on the charts

  const lag = document.createElement('div');
  lag.id = 'bakoverOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'sbVakt';
  chip.className = 'sb-item sb-vakt';
  chip.hidden = true;
  chip.onclick = () => window.aapneBakover();
  document.querySelector('.statusbar')?.append(chip);

  const kl = (t) => new Date(t * 1000).toLocaleTimeString(SPRAAK === 'en' ? 'en-GB' : 'no', {hour: '2-digit', minute: '2-digit'});
  const per = (s) => s < 120 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1).replace('.', ',')} min`;
  const tall = (v) => typeof v === 'number' ? fmtVal(Math.round(v * 100) / 100).t : (v === 'active' ? T('på', 'on') : v === 'inactive' ? T('av', 'off') : '–');
  const numerisk = (v) => typeof v === 'number' ? v : v === 'active' ? 1 : v === 'inactive' ? 0 : null;
  const utenEnhet = (n) => String(n).replace(/ \([^)]*\)$/, '');

  /* A line for the series, broken where nothing was read for a while, so a gap
     is shown as a gap and not drawn across. */
  function bane(t, v, fra, til, w, h, lo, hi) {
    const dx = w / Math.max(1, til - fra), dy = h / Math.max(1e-9, hi - lo);
    let d = '', sist = null;
    for (let i = 0; i < t.length; i++) {
      const y = numerisk(v[i]);
      if (y === null) continue;
      const x = (t[i] - fra) * dx, yy = h - (y - lo) * dy;
      d += `${sist !== null && t[i] - sist <= 45 ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`;
      sist = t[i];
    }
    return d;
  }

  /* ----------------------------------------------- to the server */
  const sig = () => S.watch.map(w => w.ip + '~' + w.objid).join(';');
  async function send() {
    const s = sig();
    if (s === sendt) return;
    sendt = s;
    try {
      await api('/api/vakt/sett', {punkter: S.watch.map(w => ({address: w.ip, objid: w.objid, navn: w.name, enhet: w.unit || ''}))});
    } catch { sendt = null; }
  }
  /* Only what you change is sent. An empty list at start-up, before the saved
     one has come back, must not empty what the server has been recording. */
  etter('renderWatch', () => {
    if (!klar || sig() === sendt) return;
    clearTimeout(tidtaker);
    tidtaker = setTimeout(send, 600);
  });
  setTimeout(() => {
    klar = true;
    if (S.watch.length) send(); else sendt = '';
  }, 2600);

  /* ----------------------------------------------- hunting, announced */
  const SAGT = 'nabe_vakt_sagt';
  const sagt = () => { try { return JSON.parse(localStorage.getItem(SAGT)) || {}; } catch { return {}; } };
  async function sjekk() {
    let d;
    try { d = await (await fetch('/api/vakt', {cache: 'no-store'})).json(); } catch { return; }
    if (!d || d.status !== 'done') return;
    varsler = d.varsler || [];
    chip.hidden = !varsler.length;
    if (varsler.length) {
      chip.textContent = T(`${varsler.length} pendler`, `${varsler.length} hunting`);
      chip.title = varsler.map(v => `${utenEnhet(v.navn)}${v.siden_t ? ' · ' + T('siden ', 'since ') + kl(v.siden_t) : ''} · ${per(v.periode_s)}`).join('\n');
    }
    const s = sagt();
    for (const v of varsler) {
      // Said once per swing: the same loop, started at about the same time, is not announced again.
      if (s[v.navn] && Math.abs((s[v.navn] || 0) - (v.siden_t || 0)) < 1800) continue;
      s[v.navn] = v.siden_t || Date.now() / 1000;
      nabeSier(T(`${utenEnhet(v.navn)} pendler${v.siden_t ? ' siden ' + kl(v.siden_t) : ''}. Periode ${per(v.periode_s)}.`,
                 `${utenEnhet(v.navn)} is hunting${v.siden_t ? ' since ' + kl(v.siden_t) : ''}. Period ${per(v.periode_s)}.`), 'nervos', 'pendler:' + v.navn);
    }
    try { localStorage.setItem(SAGT, JSON.stringify(s)); } catch { /* private window */ }
  }
  setInterval(sjekk, 30000);
  setTimeout(sjekk, 5000);

  /* ----------------------------------------------- the chart rows */
  function radHtml(s) {
    const t = s.t, v = s.v, nu = data.nu, fra = data.fra;
    const nums = v.map(numerisk).filter(x => x !== null);
    const key = s.address + '|' + s.objid;
    rader.set(key, {t, v, enhet: s.enhet, fra, nu});
    if (!nums.length) {
      return `<div class="bk-rad" data-k="${esc(key)}"><div class="bk-hode"><span class="bk-navn">${esc(utenEnhet(s.navn))}</span>
        <span class="bk-verdi bk-ingen">${T('ingen målinger ennå', 'no readings yet')}</span></div></div>`;
    }
    let lo = Math.min(...nums), hi = Math.max(...nums);
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const vars = varsler.find(x => utenEnhet(x.navn) === utenEnhet(s.navn) || x.navn === s.navn);
    const sist = v[v.length - 1];
    return `<div class="bk-rad" data-k="${esc(key)}">
      <div class="bk-hode"><span class="bk-navn" title="${esc(s.navn)} · ${esc(s.address)}">${esc(utenEnhet(s.navn))}</span>
        <span class="bk-verdi">${esc(tall(sist))} ${esc(s.enhet || '')}</span></div>
      <svg class="bk-graf" viewBox="0 0 400 44" preserveAspectRatio="none" aria-hidden="true">
        <path d="${bane(t, v, fra, nu, 400, 44, lo, hi)}"/>
        <line class="bk-kors" x1="0" y1="0" x2="0" y2="44"/></svg>
      <div class="bk-meta"><span>${esc(tall(Math.min(...nums)))} – ${esc(tall(Math.max(...nums)))} ${esc(s.enhet || '')}</span>
        ${vars ? `<span class="bk-pend">${T('pendler', 'hunting')}${vars.siden_t ? ' ' + T('siden ', 'since ') + kl(vars.siden_t) : ''} · ${esc(per(vars.periode_s))}</span>` : ''}</div></div>`;
  }

  function tegnRader() {
    rader.clear();
    const el = $('bkListe');
    if (!el || !data) return;
    el.innerHTML = data.serier.length
      ? data.serier.map(radHtml).join('')
      : `<p class="op-tekst">${T('Ingen punkter følges ennå. Fest punkter med ☆ eller mellomrom, så begynner NABE å ta dem opp av seg selv.',
                                'No points are followed yet. Pin points with ☆ or space and NABE starts recording them by itself.')}</p>`;
    const fra = data.fra;
    $('bkAkse').innerHTML = `<span>${esc(kl(fra))}</span><span>${esc(kl(data.nu))}</span>`;
  }

  async function hent() {
    try { data = await api('/api/vakt/serier', {minutter}); } catch { data = null; }
    if (data && data.status !== 'done') data = null;
    // The axis starts where the recording does when that is later than the range
    // asked for, so a few minutes of data fill the chart instead of crowding its edge.
    if (data) {
      const forste = data.serier.filter(s => s.t.length).map(s => s.t[0]);
      data.fra = Math.max(data.nu - minutter * 60, forste.length ? Math.min(...forste) : data.nu - 60);
      if (data.nu - data.fra < 60) data.fra = data.nu - 60;
    }
    tegnRader();
  }

  function tegn() {
    lag.innerHTML = `<div class="gs-modal bk-modal"><div class="gs-head"><span class="gd-tittel">${T('Se bakover', 'Look back')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="bk-kropp">
        <div class="bk-topp"><span class="sp-meta">${T('Festede punkter leses i bakgrunnen og de siste to timene lagres', 'Pinned points are read in the background and the last two hours are kept')}</span>
          <select id="bkMin" class="field">${MIN.map(m => `<option value="${m}"${m === minutter ? ' selected' : ''}>${m < 60 ? T(`${m} min`, `${m} min`) : T(`${m / 60} t`, `${m / 60} h`)}</option>`).join('')}</select></div>
        <div class="bk-akse" id="bkAkse"></div>
        <div id="bkListe" class="bk-liste"></div>
        <div id="bkRes"></div>
        <div class="op-knapper"><button type="button" class="btn" data-bk="eksport">${T('Åpne som CSV', 'Open as CSV')}</button>
          <button type="button" class="btn primary" data-bk="pendling">${T('Se etter pendling', 'Look for hunting')}</button></div>
      </div></div>`;
  }

  /* The pointer on a chart says what the value was at that moment. */
  lag.addEventListener('pointermove', (e) => {
    const svg = e.target.closest?.('.bk-graf');
    if (!svg) return;
    const rad = svg.closest('.bk-rad'), r = rader.get(rad.dataset.k);
    if (!r || !r.t.length) return;
    const b = svg.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
    const tid = r.fra + f * (r.nu - r.fra);
    let i = 0;
    while (i < r.t.length - 1 && r.t[i + 1] <= tid) i++;
    const kors = svg.querySelector('.bk-kors');
    kors.style.visibility = 'visible';
    kors.setAttribute('x1', f * 400); kors.setAttribute('x2', f * 400);
    rad.querySelector('.bk-verdi').textContent = `${kl(r.t[i])}  ${tall(r.v[i])} ${r.enhet || ''}`;
  });
  lag.addEventListener('pointerout', (e) => {
    const svg = e.target.closest?.('.bk-graf');
    if (!svg || svg.contains(e.relatedTarget)) return;
    svg.querySelector('.bk-kors').style.visibility = 'hidden';
    const rad = svg.closest('.bk-rad'), r = rader.get(rad.dataset.k);
    if (r && r.v.length) rad.querySelector('.bk-verdi').textContent = `${tall(r.v[r.v.length - 1])} ${r.enhet || ''}`;
  });

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; clearInterval(timer); return; }
    const k = e.target.closest('[data-bk]')?.dataset.bk;
    if (k === 'pendling') {
      const r = await api('/api/vakt/pendling', {minutter});
      if (r.status !== 'done') { toast(r.error || T('Fikk ikke analysert', 'Could not analyse'), true); return; }
      $('bkRes').innerHTML = window.nabePendling ? window.nabePendling.pendlingHtml(r).replace(/<div class="op-knapper">.*$/s, '') : '';
    } else if (k === 'eksport') {
      const r = await api('/api/vakt/eksport', {minutter});
      if (r.status !== 'done') { toast(r.error || T('Fikk ikke eksportert', 'Could not export'), true); return; }
      api('/api/vis-fil', {sti: r.fil});
    }
  });
  lag.addEventListener('change', (e) => {
    if (e.target.id === 'bkMin') { minutter = Number(e.target.value); hent(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; clearInterval(timer); e.stopPropagation(); }
  }, true);

  let timer = 0;
  window.aapneBakover = async () => {
    await sjekk();
    tegn();
    lag.hidden = false;
    await hent();
    clearInterval(timer);
    // New readings come in while it is open.
    timer = setInterval(() => { if (!lag.hidden) hent(); }, 10000);
  };
  window.nabeVakt = {bane, kl};       // for the self-test

  // A way in from the watch list itself.
  const verktoy = document.querySelector('.watch-verktoy');
  if (verktoy) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-icon';
    b.id = 'watchBakover';
    b.textContent = '⟲';
    b.title = T('Se bakover: de siste to timene', 'Look back: the last two hours');
    b.onclick = () => window.aapneBakover();
    verktoy.prepend(b);
  }
})();
