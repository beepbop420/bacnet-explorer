/* NABE and NABO - the part that decides when to speak.

   What they say is in nabe-dialoger-innhold.js. This picks a line for something that
   happened, and keeps the whole thing from becoming a chore:

   - Each event has its own pause and its own chance, and there is a gap between any two
     lines. Most of the time, nothing is said.
   - A line is not used again until all the others for that event have been, and that is
     remembered between sessions, so a long career does not hear the same ten sentences.
   - Never while you are typing, never over a dialog that is asking you something, and
     never at all in the Quiet mood. In Chaos the gaps are shorter and there is more
     idle talk.
   - Anything with a consequence (a write, a lost connection) is spoken once and short.

   Hooks sit on the functions the app already has, so nothing else had to change. */
'use strict';

(function dialoger() {
  const NOKKEL = 'nabe-dia';
  const les = () => { try { return JSON.parse(localStorage.getItem(NOKKEL)) || {}; } catch { return {}; } };
  const skriv = () => { try { localStorage.setItem(NOKKEL, JSON.stringify({brukt: D.brukt, mp: D.mp, sist: D.sistPers, dag: D.dag, versjon: D.versjon, sprak: D.sprak})); } catch { /* optional */ } };
  const lagret = les();
  const D = {
    sist: 0, brukt: lagret.brukt || {}, mp: lagret.mp || {}, sistPers: lagret.sist || {},
    dag: lagret.dag || '', versjon: lagret.versjon || '', sprak: lagret.sprak || '',
    start: Date.now(), hvile: 0, skannStart: 0, forrigeSilent: new Set(), forrigeKort: 0,
  };
  const niva = () => (window.nabeSyn && nabeSyn.humorNiva()) || 'normal';

  /* ----------------------------------------------------------- text */
  const del = (s) => {
    const p = String(s).split(' | ');
    if (p.length === 2) return p;
    if (p.length % 2 === 0) { const h = p.length / 2; return [p.slice(0, h).join(' | '), p.slice(h).join(' | ')]; }
    return [p[0], p.slice(1).join(' | ')];
  };
  const linje = (s) => {
    const o = /^O: /.test(s), n = /^N: /.test(s);
    const [nb, en] = del(o || n ? s.slice(3) : s);
    return {hvem: o ? 'nabo' : 'nabe', nb, en};
  };
  const fyll = (t, c) => String(t).replace(/\{(\w+)\}/g, (_, k) => (c[k] ?? ''));
  window.nabeDialogDel = del;

  /* ----------------------------------------------------------- quiet enough to speak */
  const skriver = () => Date.now() - (typeof GARD !== 'undefined' ? GARD.sistInput : 0) < 2500;
  const snakker = () => typeof nabeSnakker === 'function' && nabeSnakker();
  const overlegg = () => !!document.querySelector('.gs-overlay:not([hidden]), #startskjerm, .ss-overlay');
  function roligNok(reaktiv) {
    if (document.hidden || snakker()) return false;
    if (reaktiv) return !skriver();
    return !skriver() && !overlegg() && !document.body.classList.contains('skanner')
      && Date.now() - (typeof GARD !== 'undefined' ? GARD.sistInput : 0) > 20000;
  }

  /* ----------------------------------------------------------- picking */
  function velg(navn, c) {
    const def = DIA_INNHOLD[navn];
    if (!def) return null;
    const alle = def.l.map((x, i) => ({i, hvis: x && x.hvis ? x.hvis : null, e: x && x.hvis ? x.e : x}))
      .filter(x => { try { return !x.hvis || x.hvis(c); } catch { return false; } });
    if (!alle.length) return null;
    const k = (i) => navn + '#' + i;
    let kand = alle.filter(x => !D.brukt[k(x.i)]);
    if (!kand.length) { alle.forEach(x => delete D.brukt[k(x.i)]); kand = alle; }
    // A line written for exactly this situation is worth three plain ones.
    const sum = kand.reduce((a, x) => a + (x.hvis ? 3 : 1), 0);
    let r = Math.random() * sum, valgt = kand[0];
    for (const x of kand) { r -= x.hvis ? 3 : 1; if (r <= 0) { valgt = x; break; } }
    D.brukt[k(valgt.i)] = 1;
    return valgt.e;
  }

  function si(e, c) {
    if (Array.isArray(e)) {
      if (typeof samtale !== 'function') return false;
      samtale(e.map(s => { const l = linje(fyll(s, c)); return [l.hvem, l.nb, l.en]; }), {tvang: !!c._tvang});
      return true;
    }
    const l = linje(e);
    const tekst = T(fyll(l.nb, c), fyll(l.en, c));
    if (l.hvem === 'nabo') { if (typeof brorSkriv === 'function') brorSkriv(tekst, {holde: 3200, tvang: !!c._tvang}); else return false; }
    else nabeSier(tekst, null, null, false);
    return true;
  }

  /* An event happened. `reaktiv`: caused by what you just did, so it may speak over an open dialog. */
  function dia(navn, c = {}, {tvang = false, reaktiv = true} = {}) {
    const def = typeof DIA_INNHOLD !== 'undefined' && DIA_INNHOLD[navn];
    const n = niva();
    if (!def || n === 'stille') return false;
    const naa = Date.now();
    if (!tvang) {
      const kaos = n === 'kaos';
      if (naa - D.sist < (reaktiv ? (kaos ? 12000 : 25000) : (kaos ? 30000 : 60000))) return false;
      const pause = def.pause ?? 90000;
      if (naa - (D.sistPers[navn] || 0) < pause * (kaos ? 0.5 : 1)) return false;
      if (Math.random() > Math.min(1, (def.kans ?? 0.5) * (kaos ? 1.7 : 1))) return false;
      if (!roligNok(reaktiv)) return false;
    }
    const e = velg(navn, c);
    if (e == null) return false;
    c._tvang = tvang;
    if (!si(e, c)) return false;
    D.sist = naa;
    D.sistPers[navn] = naa;
    skriv();
    return true;
  }
  window.nabeDia = dia;

  /* ----------------------------------------------------------- a scan */
  const bucket = (n) => n === 0 ? 0 : n === 1 ? 1 : n <= 5 ? 2 : n <= 30 ? 3 : 4;
  if (typeof nabeEtterSkann === 'function') {
    etter('nabeEtterSkann', (r, n) => { clearTimeout(D.sakteT); dia('skannFerdig' + bucket(n), {n}); });
  }
  if (typeof runScan === 'function') {
    foer('runScan', () => {
      if (S._autoNeste) return;
      D.skannStart = Date.now();
      const omr = new Set((S.devices || []).map(d => d._range).filter(Boolean));
      dia('skannStart', {flere: (S.kort || []).length > 1 && omr.size > 0, natt: new Date().getHours() >= 22 || new Date().getHours() < 5});
      clearTimeout(D.sakteT);
      D.sakteT = setTimeout(() => { if (document.body.classList.contains('skanner')) dia('skannSakte', {}, {reaktiv: false}); }, 45000);
    });
  }

  /* ----------------------------------------------------------- a device or a point */
  if (typeof selectDevice === 'function') {
    etter('selectDevice', () => {
      const d = S.activeDev;
      if (!d) return;
      dia('enhetApnet', {v: d.vendor_name || '', navn: d.object_name || d.address, punkter: (S.points || []).length}, {reaktiv: true});
    });
  }
  if (typeof selectPoint === 'function') {
    etter('selectPoint', (r, objid) => {
      const p = S.pointIndex && S.pointIndex.get(objid);
      if (!p) return;
      dia('punktApnet', {n: p.name || '', u: `${p.unit_symbol || ''} ${p.units || ''}`, t: String(objid || p.type || ''), flagg: p.status || []});
    });
  }

  /* ----------------------------------------------------------- live */
  if (typeof startPolling === 'function') etter('startPolling', () => { D.liveStart = Date.now(); dia('livePa'); });
  if (typeof stopPolling === 'function') etter('stopPolling', () => { D.liveStart = 0; dia('liveAv'); });
  setInterval(() => { if (S.live && D.liveStart && Date.now() - D.liveStart > 20 * 60000) { dia('liveLenge', {}, {reaktiv: false}); D.liveStart = Date.now(); } }, 60000);

  /* ----------------------------------------------------------- writing */
  etter('api', (d, sti, body) => {
    if (sti !== '/api/write' || !d) return;
    if (d.status === 'done') dia(body && body.release ? 'frigi' : 'skrivFerdig');
    else dia('skrivNektet');
  });

  /* ----------------------------------------------------------- appearance and language */
  $('themeBtn')?.addEventListener('click', () => setTimeout(() => dia(document.documentElement.getAttribute('data-theme') === 'light' ? 'temaLys' : 'temaMork'), 700));
  {
    const sprak = (typeof SPRAAK !== 'undefined') ? SPRAAK : '';
    if (D.sprak && sprak && D.sprak !== sprak) setTimeout(() => dia(sprak === 'en' ? 'sprakEn' : 'sprakNo', {}, {tvang: true}), 2500);
    D.sprak = sprak; skriv();
  }

  /* ----------------------------------------------------------- the connection */
  if (typeof sambandEndret === 'function') etter('sambandEndret', (r, oppe) => dia(oppe ? 'sambandTilbake' : 'sambandTapt'));
  document.addEventListener('nabe:reconnect', (e) => dia(e.detail && e.detail.ok ? 'reconnectOk' : 'reconnectFeil', {}, {tvang: true}));
  if (typeof refreshStatus === 'function') {
    etter('refreshStatus', () => {
      const n = (S.kort || []).length;
      D.forrigeKort = n;
    });
  }
  if (typeof toast === 'function') etter('toast', (r, msg, feil) => { if (feil) dia('toastFeil'); });

  /* ----------------------------------------------------------- the devices answering, or not */
  if (typeof renderDevices === 'function') {
    etter('renderDevices', () => {
      if (typeof BORTE_NAA === 'undefined' || document.body.classList.contains('skanner')) return;
      const nu = BORTE_NAA;
      let nyStille = 0, tilbake = 0;
      for (const a of nu) if (!D.forrigeSilent.has(a)) nyStille++;
      for (const a of D.forrigeSilent) if (!nu.has(a)) tilbake++;
      if (D.forrigeSilent.size || nu.size || true) {
        if (nyStille && D.klar) dia('enhetStille');
        else if (tilbake && D.klar) dia('tilbakeOnline');
      }
      D.forrigeSilent = new Set(nu);
      D.klar = true;
    });
  }

  /* ----------------------------------------------------------- what the plant is like */
  if (typeof tegnAnlegg === 'function') {
    etter('tegnAnlegg', () => {
      let t;
      try { t = anleggTall(); } catch { return; }
      if (!t.total || !t.lest) return;
      const alarm = t.flagg['in-alarm'].length;
      if (alarm >= 50) dia('stortAlarm', {}, {reaktiv: false});
      else if (t.ferdig && t.alleStatus && !t.feilet && !AN_REKKE.some(f => t.flagg[f].length)) dia('altRolig', {}, {reaktiv: false});
      if (t.flagg['overridden'].length >= 15) dia('mangeOverstyrt', {}, {reaktiv: false});
      try { if (duplicateInstances().length) dia('duplikatInstans', {}, {reaktiv: false}); } catch { /* optional */ }
    });
  }
  etter('api', (d, sti) => {
    if (sti === '/api/poll' && d && d.cov_stille && Object.keys(d.cov_stille).length) dia('cov', {}, {reaktiv: false});
  });
  etter('pollTick', () => { if (document.querySelector('td.c-val.flat')) dia('flat', {}, {reaktiv: false}); });

  /* ----------------------------------------------------------- exports, search, palette */
  const knapp = (id, ev) => document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#' + id)) setTimeout(() => dia(ev), 1400); }, true);
  knapp('csvBtn', 'eksportCsv'); knapp('edeBtn', 'eksportEde'); knapp('rapOktBtn', 'eksportRapport'); knapp('snapBtn', 'snapshotTatt');
  if (typeof openCmd === 'function') etter('openCmd', () => dia('paletten'));

  const felt = (id, ordbok, omr) => {
    const el = $(id);
    if (!el) return;
    let t = 0;
    const gjor = () => {
      const v = el.value.trim().toLowerCase();
      const e = (omr ? DIA_OMR : DIA_SOK)[v];
      if (e && niva() !== 'stille') {
        const [nb, en] = del(e);
        nabeSier(T(nb, en), 'skvatt', 'dia-sok:' + id + ':' + v, false);
      }
    };
    el.addEventListener(omr ? 'change' : 'input', () => { clearTimeout(t); t = setTimeout(gjor, omr ? 0 : 800); });
  };
  felt('q', DIA_SOK); felt('tbSok', DIA_SOK); felt('devSok', DIA_SOK); felt('rangeInput', DIA_OMR, true);
  $('q')?.addEventListener('input', () => {
    clearTimeout($('q')._ingenT);
    $('q')._ingenT = setTimeout(() => {
      if ($('q').value.trim().length > 2 && S.activeDev && !document.querySelector('#pointsWrap tbody tr')) dia('sokIngen');
    }, 900);
  });

  /* ----------------------------------------------------------- the tools, once each in a while */
  const klikk = (vel, ev, ms = 700) => document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest(vel)) setTimeout(() => dia(ev), ms); }, true);
  klikk('#cmpBtn', 'sammenlignApnet'); klikk('#schBtn', 'ukeprogramApnet'); klikk('#colsBtn', 'kolonnerApnet');
  klikk('#fullBtn', 'fullskjerm'); klikk('#helpBtn', 'hurtigtaster'); klikk('.menu-item[data-flag], #fWrit', 'filterBrukt', 900);
  klikk('#noteSave', 'notatLagret', 900); klikk('#selPin', 'pinnet', 600);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#roBtn')) setTimeout(() => dia(S.readOnly ? 'lesemodusPa' : 'lesemodusAv'), 500); }, true);
  for (const [fn, ev] of [['aapneKart', 'kartApnet'], ['aapneTrafikk', 'trafikkApnet'], ['aapneBakover', 'bakoverApnet'], ['aapneAvvik', 'avvikApnet'], ['aapneSimulator', 'simulatorApnet'], ['aapneGarderobe', 'garderobeApnet']]) {
    if (typeof window[fn] === 'function') etter(fn, () => setTimeout(() => dia(ev), 900));
  }
  if (typeof togglePin === 'function') etter('togglePin', () => dia('pinnet'));
  // Many writes close together.
  const skrivinger = [];
  etter('api', (d, sti, body) => {
    if (sti !== '/api/write' || !d || d.status !== 'done' || (body && body.release)) return;
    const n = Date.now();
    skrivinger.push(n);
    while (skrivinger.length && n - skrivinger[0] > 5 * 60000) skrivinger.shift();
    if (skrivinger.length >= 5) dia('skrivFlere');
  });
  setTimeout(() => { const t = new Date(); if (t.getDate() === 1) dia('maaneskift', {}, {reaktiv: false}); if (t.getMonth() === 6 && t.getDate() <= 14) dia('sommerferie', {}, {reaktiv: false}); }, 40000);

  /* ----------------------------------------------------------- NABO */
  if (typeof aapneNabo === 'function') etter('aapneNabo', () => setTimeout(() => dia('naboApen'), 900));
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('#naboLukk, .nabo-unike, #naboVar');
    if (!t) return;
    if (t.id === 'naboLukk') setTimeout(() => dia('naboLukk'), 600);
    else if (t.classList.contains('nabo-unike')) setTimeout(() => dia('naboUnike', {}, {tvang: true}), 500);
    else setTimeout(() => dia('variabelLaget'), 1600);
  }, true);
  if (typeof tegnNabo === 'function') {
    etter('tegnNabo', () => {
      const f = document.querySelector('#naboSum .f');
      const n = f ? parseInt(f.textContent, 10) : 0;
      if (n > 200) dia('naboFeil', {}, {reaktiv: false});
    });
  }

  /* ----------------------------------------------------------- counters reaching a number */
  function milepel(hva) {
    const m = DIA_MILEPELER[hva];
    let tot = 0;
    try { tot = (teller() || {})[hva] || 0; } catch { return; }
    if (!m) return;
    let sist = null;
    for (const [grense, tekst] of Object.entries(m)) {
      const g = Number(grense), k = hva + ':' + g;
      if (tot >= g && !D.mp[k]) { D.mp[k] = 1; sist = tekst; }
    }
    if (!sist) return;
    skriv();
    const [nb, en] = del(sist);
    setTimeout(() => nabeSier(T(nb, en), 'fornoyd', null, true), 900);
  }
  if (typeof tell === 'function') etter('tell', (r, hva) => milepel(hva));

  /* ----------------------------------------------------------- time, and being quiet */
  function tidshendelse() {
    const t = new Date(), h = t.getHours(), dag = t.getDay(), mnd = t.getMonth() + 1, dato = t.getDate();
    const kaller = [];
    if (mnd === 12 && dato === 24) kaller.push('julaften');
    else if (mnd === 12 && dato === 31) kaller.push('nyttar');
    else if (mnd === 5 && dato === 1) kaller.push('arbeidernesdag');
    else if (mnd === 12) kaller.push('desember');
    else if (mnd === 1) kaller.push('januar');
    else if (mnd === 7) kaller.push('juli');
    // The Sunday of the clock change: the last one in March and in October.
    if ((mnd === 3 || mnd === 10) && dag === 0 && dato + 7 > new Date(t.getFullYear(), mnd, 0).getDate()) kaller.push('sommertid');
    if (dag === 0 || dag === 6) kaller.push('helg');
    else if (dag === 1 && h < 11) kaller.push('mandag');
    else if (dag === 5 && h >= 13) kaller.push('fredag');
    if (h >= 6 && h < 9) kaller.push('morgen');
    else if (h >= 9 && h < 11) kaller.push('formiddag');
    else if (h >= 11 && h < 13) kaller.push('lunsj');
    else if (h >= 13 && h < 17) kaller.push('ettermiddag');
    else if (h >= 17 && h < 22) kaller.push('kveld');
    else kaller.push('natt');
    for (const k of kaller) if (dia(k, {}, {reaktiv: false})) break;
  }
  setTimeout(tidshendelse, 20000);
  setInterval(tidshendelse, 25 * 60000);

  // The first time today, and the first time after an update.
  {
    const idag = new Date().toISOString().slice(0, 10);
    if (D.dag !== idag) {
      D.dag = idag; skriv();
      // After the start screen is gone, not over it.
      let v = 0;
      const t = setInterval(() => {
        if (document.querySelector('#startskjerm, .ss-overlay') && ++v < 30) return;
        clearInterval(t);
        setTimeout(() => dia('fortrinn', {}, {tvang: true}), 2500);
      }, 2000);
    }
    let forsok = 0;
    const versjon = setInterval(() => {
      if (typeof NABE_VERSJON === 'string' && NABE_VERSJON) {
        clearInterval(versjon);
        if (D.versjon && D.versjon !== NABE_VERSJON) setTimeout(() => dia('nyVersjon', {}, {tvang: true}), 9000);
        D.versjon = NABE_VERSJON; skriv();
      } else if (++forsok > 20) clearInterval(versjon);
    }, 500);
  }

  const okter = [[3600000, 'okt1'], [7200000, 'okt2'], [18000000, 'okt5'], [28800000, 'okt8']];
  setInterval(() => { for (const [ms, ev] of okter) if (Date.now() - D.start >= ms && !D['ok' + ev]) { D['ok' + ev] = true; dia(ev, {}, {tvang: true}); } }, 60000);

  // Idle, and back again.
  let hvileSagt = 0;
  setInterval(() => {
    const hvile = Date.now() - (typeof GARD !== 'undefined' ? GARD.sistInput : Date.now());
    D.hvile = Math.max(D.hvile, hvile);
    if (hvile > 30 * 60000 && hvileSagt < 3) { hvileSagt = 3; dia('stille30', {}, {reaktiv: false}); }
    else if (hvile > 10 * 60000 && hvileSagt < 2) { hvileSagt = 2; dia('stille10', {}, {reaktiv: false}); }
    else if (hvile > 2 * 60000 && hvileSagt < 1) { hvileSagt = 1; dia('stille2', {}, {reaktiv: false}); }
    else if (hvile < 5000 && hvileSagt) { if (D.hvile > 10 * 60000) dia('tilbake', {}, {tvang: false}); hvileSagt = 0; D.hvile = 0; }
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { D.borte = Date.now(); return; }
    if (D.borte && Date.now() - D.borte > 15 * 60000) setTimeout(() => dia('fokusTilbake', {}, {reaktiv: false}), 1200);
    D.borte = 0;
  });

  /* ----------------------------------------------------------- talking on their own */
  function idle() {
    const n = niva();
    if (n === 'stille' || !roligNok(false)) return;
    if (Date.now() - D.sist < (n === 'kaos' ? 90000 : 4 * 60000)) return;
    if (typeof brorStille === 'function' && brorStille()) return;
    const r = Math.random();
    const tekstLinje = (arr, hvem) => {
      const k = 'solo:' + hvem;
      let i;
      let kand = arr.map((_, j) => j).filter(j => !D.brukt[k + '#' + j]);
      if (!kand.length) { arr.forEach((_, j) => delete D.brukt[k + '#' + j]); kand = arr.map((_, j) => j); }
      i = kand[Math.floor(Math.random() * kand.length)];
      D.brukt[k + '#' + i] = 1;
      return arr[i];
    };
    if (r < 0.35) si('O: ' + tekstLinje(DIA_NABO_SOLO, 'nabo'), {});
    else if (r < 0.65) si(tekstLinje(DIA_NABE_SOLO, 'nabe'), {});
    else si(tekstLinje(DIA_PRAT, 'prat'), {});
    D.sist = Date.now();
    skriv();
  }
  (function neste() {
    const ms = (niva() === 'kaos' ? 2.5 : 6) * 60000 * (0.7 + Math.random() * 0.8);
    setTimeout(() => { idle(); neste(); }, ms);
  })();

  window.nabeDialoger = {dia, velg, D, linje, idle, antall: () => Object.values(DIA_INNHOLD).reduce((a, d) => a + d.l.length, 0)
    + Object.keys(DIA_SOK).length + Object.keys(DIA_OMR).length + Object.keys(DIA_INST).length + DIA_PRAT.length + DIA_NABO_SOLO.length + DIA_NABE_SOLO.length
    + Object.values(DIA_MILEPELER).reduce((a, m) => a + Object.keys(m).length, 0) + Object.keys(DIA_PLAGG).length};
})();
