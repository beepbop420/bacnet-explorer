/* NABE - limits on watched points, and a word when one is passed, also when the window is not in front.

   A bell on each pinned point sets what must hold for it: a lower and an upper limit, and for the points that call for it
   that it is not on for too long (a pump that runs the whole day, a door left open), that it is not unread for too long,
   and that it does not change too fast. The server reads the pinned points in the background whatever the page is doing
   (see "Se bakover"), judges each reading against the rules and keeps a short list of what happened: passed, still wrong
   after half an hour, back in order. This page asks that list every few seconds and tells you: a message in the window, a
   desktop notification if the browser allows it, and a short tone if you want one. Two readings in a row are needed before
   it is said, so one stray value is not an event.

   Nothing is written to the plant. The rules live in this browser and go to the server only so it can watch them. */
'use strict';

(function grenser() {
  const SIST = 'nabe_grense_sist';
  const nokkel = (ip, objid) => ip + '|' + objid;
  const alle = () => { try { return loadPrefs().grenser || {}; } catch { return {}; } };
  const hent = (ip, objid) => alle()[nokkel(ip, objid)] || null;
  const lyd = () => { try { return loadPrefs().grenseLyd !== false; } catch { return true; } };
  const tall = (v) => (typeof v === 'number' ? fmtVal(Math.round(v * 100) / 100).t : String(v));
  const TOM = {lav: null, hoy: null, paa: null, stille: null, fart: null};
  const harNoe = (g) => !!g && Object.values(g).some((v) => typeof v === 'number');

  function lagreGrense(ip, objid, g) {
    const a = {...alle()};
    if (!harNoe(g)) delete a[nokkel(ip, objid)]; else a[nokkel(ip, objid)] = {...TOM, ...g};
    savePrefs({grenser: a});
  }

  /* ----------------------------------------------------- what is wrong now, from the events */
  let HENDELSER = [], antallGrenser = 0, forste = true;
  // One rule on one point is one thing: the last word on each decides whether it is still wrong
  const aktive = (ev) => {
    const sist = new Map();
    for (const e of ev) sist.set(e.address + '|' + e.objid + '|' + (e.regel || 'grense'), e);
    return [...sist.values()].filter((e) => e.type !== 'tilbake');
  };

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'sbGrense';
  chip.className = 'sb-item sb-vakt sb-grense';
  chip.hidden = true;
  chip.onclick = () => window.aapneGrenser();
  document.querySelector('.statusbar')?.append(chip);

  const minTekst = (m) => (m < 120 ? `${tall(m)} min` : `${tall(Math.round(m / 6) / 10)} ${T('t', 'h')}`);
  function tekst(e) {
    const regel = e.regel || 'grense', forts = e.type === 'fortsatt' ? T('Fortsatt: ', 'Still: ') : '';
    if (regel === 'paa') return e.type === 'tilbake' ? T('Av igjen', 'Off again') : forts + T(`På i ${minTekst(e.verdi)} (grensen er ${tall(e.grense)} min)`, `On for ${minTekst(e.verdi)} (the limit is ${tall(e.grense)} min)`);
    if (regel === 'stille') return e.type === 'tilbake' ? T('Svarer igjen', 'Answering again') : forts + T(`Ikke lest på ${minTekst(e.verdi)} (grensen er ${tall(e.grense)} min)`, `Not read for ${minTekst(e.verdi)} (the limit is ${tall(e.grense)} min)`);
    if (regel === 'fart') {
      const opp = e.verdi > 0, u = e.enhet || '';
      return e.type === 'tilbake' ? T('Roligere igjen', 'Calmer again') : forts + T(`Endrer seg ${tall(Math.abs(e.verdi))} ${u} i minuttet, ${opp ? 'opp' : 'ned'} (grensen er ${tall(e.grense)})`, `Changing ${tall(Math.abs(e.verdi))} ${u} a minute, ${opp ? 'up' : 'down'} (the limit is ${tall(e.grense)})`);
    }
    const g = e.grense !== null && e.grense !== undefined ? `${tall(e.grense)} ${e.enhet || ''}`.trim() : '';
    const v = `${tall(e.verdi)} ${e.enhet || ''}`.trim();
    if (e.type === 'tilbake') return T(`Tilbake innenfor grensene: ${v}`, `Back inside the limits: ${v}`);
    const over = e.type === 'over' || (e.type === 'fortsatt' && e.verdi > (e.grense ?? 0));
    const dir = over ? T('over', 'above') : T('under', 'below');
    return e.type === 'fortsatt' ? T(`Fortsatt ${dir} ${g}: ${v}`, `Still ${dir} ${g}: ${v}`) : T(`${over ? 'Over' : 'Under'} ${g}: ${v}`, `${over ? 'Above' : 'Below'} ${g}: ${v}`);
  }
  const utenEnhet = (n) => String(n).replace(/ \([^)]*\)$/, '');

  /* ------------------------------------------------------------- telling you */
  let ctx = null;
  function pip() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.22 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 0.22);
      });
    } catch { /* no sound is not a failure */ }
  }
  let tittel0 = null, blinker = 0;
  function blink(tekst0) {
    if (!document.hidden) return;
    if (tittel0 === null) tittel0 = document.title;
    clearInterval(blinker);
    let paa = false;
    blinker = setInterval(() => { document.title = (paa = !paa) ? '⚠ ' + tekst0 : tittel0; }, 900);
    const slutt = () => { clearInterval(blinker); if (tittel0 !== null) document.title = tittel0; tittel0 = null; document.removeEventListener('visibilitychange', slutt); window.removeEventListener('focus', slutt); };
    document.addEventListener('visibilitychange', slutt);
    window.addEventListener('focus', slutt);
  }
  function varsle(e) {
    const navn = utenEnhet(e.navn);
    const melding = `${navn}: ${tekst(e)}`;
    toast(melding, e.type !== 'tilbake');
    if (e.type === 'tilbake') return;
    if (lyd()) pip();
    blink(navn);
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(navn, {body: tekst(e), tag: 'nabe-grense:' + e.address + '|' + e.objid + '|' + (e.regel || 'grense'), silent: true});
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch { /* the window message is there anyway */ }
  }

  /* ----------------------------------------------------------------- polling */
  let sistId = (() => { try { return Number(localStorage.getItem(SIST)) || 0; } catch { return 0; } })();
  async function sjekk() {
    if (!antallGrenser && !forste && !Object.keys(alle()).length) return;
    let d;
    try { d = await (await fetch('/api/vakt', {cache: 'no-store'})).json(); } catch { return; }
    if (!d || d.status !== 'done') return;
    antallGrenser = d.grenser || 0;
    HENDELSER = d.hendelser || [];
    const maks = HENDELSER.reduce((m, e) => Math.max(m, e.id), 0);
    if (maks < sistId) sistId = 0;                               // the server was restarted: its numbers began again
    const nye = HENDELSER.filter((e) => e.id > sistId);
    const nu = Date.now() / 1000;
    if (nye.length) {
      sistId = maks;
      try { localStorage.setItem(SIST, String(sistId)); } catch { /* private window */ }
      const ferske = nye.filter((e) => nu - e.t < 180);
      const eldre = nye.filter((e) => nu - e.t >= 180 && e.type !== 'tilbake' && e.type !== 'fortsatt');
      // What happened while the page was closed is one line, not a row of tones
      if (eldre.length) toast(T(`${eldre.length} grensevarsler mens du var borte. Se statuslinja.`, `${eldre.length} limit alerts while you were away. See the status bar.`), true);
      ferske.forEach(varsle);
    }
    forste = false;
    const ak = aktive(HENDELSER).filter((e) => hent(e.address, e.objid));
    chip.hidden = !ak.length;
    if (ak.length) {
      chip.textContent = T(`${ak.length} utenfor grense`, `${ak.length} outside limit`);
      chip.title = ak.map((e) => `${utenEnhet(e.navn)}: ${tekst(e)}`).join('\n');
    }
    markerBjeller(ak);
  }
  setInterval(sjekk, 6000);
  setTimeout(sjekk, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sjekk(); });

  /* ------------------------------------------------------------------- bells */
  function oppsummering(g) {
    const d = [];
    if (g.lav != null || g.hoy != null) d.push(T(`${g.lav == null ? '–' : g.lav} til ${g.hoy == null ? '–' : g.hoy}`, `${g.lav == null ? '–' : g.lav} to ${g.hoy == null ? '–' : g.hoy}`));
    if (g.paa) d.push(T(`på over ${g.paa} min`, `on over ${g.paa} min`));
    if (g.stille) d.push(T(`ikke lest på ${g.stille} min`, `unread for ${g.stille} min`));
    if (g.fart) d.push(T(`endring over ${g.fart} i minuttet`, `change over ${g.fart} a minute`));
    return d.join(' · ');
  }
  function markerBjeller(ak = aktive(HENDELSER)) {
    const ute = new Set(ak.map((e) => nokkel(e.address, e.objid)));
    document.querySelectorAll('#watchList .watch-row').forEach((rad, i) => {
      const w = S.watch[i], b = rad.querySelector('.gr-bjelle');
      if (!w || !b) return;
      const g = hent(w.ip, w.objid);
      b.classList.toggle('paa', harNoe(g));
      b.classList.toggle('ute', ute.has(nokkel(w.ip, w.objid)));
      b.title = harNoe(g) ? T(`Varsler: ${oppsummering(g)}`, `Alerts: ${oppsummering(g)}`) : T('Sett grenser og få varsel', 'Set limits and get an alert');
    });
  }
  const BJELLE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2c-2.3 0-3.7 1.7-3.7 4v2.3L2.8 11h10.4l-1.5-2.5V6.2c0-2.3-1.4-4-3.7-4Z"/><path d="M6.6 12.6a1.5 1.5 0 0 0 2.8 0"/></svg>';
  function settInn() {
    document.querySelectorAll('#watchList .watch-row').forEach((rad) => {
      if (rad.querySelector('.gr-bjelle')) return;
      const x = rad.querySelector('.watch-r1 .x');
      if (!x) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gr-bjelle';
      b.innerHTML = BJELLE;
      x.before(b);
    });
    markerBjeller();
  }
  etter('renderWatch', settInn);
  setTimeout(settInn, 600);

  /* ----------------------------------------------------------------- the box */
  const pop = document.createElement('div');
  pop.className = 'gr-pop';
  pop.hidden = true;
  document.body.append(pop);
  let aapenFor = null;
  const lukkPop = () => { pop.hidden = true; aapenFor = null; };
  /* What kind of point it is decides what can be asked of it: a number has limits and a pace, a switch has a time it may stay on */
  function slag(w) {
    const p = (S.cache[w.ip] || []).find((q) => q.objid === w.objid);
    if (!p) return {tall: true, binar: true};
    const binar = /^binary-/.test(p.type || '');
    return {tall: !binar && !/^multi-state/.test(p.type || ''), binar};
  }
  const felt = (id, etikett, verdi, enhet) => `<label><span>${etikett}</span><input type="number" step="any" min="0" id="${id}" value="${verdi == null ? '' : verdi}" placeholder="${esc(T('ingen', 'none'))}"><i class="gr-enhet">${esc(enhet || '')}</i></label>`;
  function aapnePop(knapp, w) {
    const g = {...TOM, ...(hent(w.ip, w.objid) || {})}, sl = slag(w);
    const blokkert = 'Notification' in window && Notification.permission === 'denied';
    const mer = [sl.binar ? felt('grPaa', T('På lenger enn', 'On for more than'), g.paa, 'min') : '', felt('grStille', T('Ikke lest på', 'Unread for'), g.stille, 'min'),
      sl.tall ? felt('grFart', T('Endrer seg mer enn', 'Changes more than'), g.fart, (w.unit || '') + T('/min', '/min')) : ''].filter(Boolean).join('');
    pop.innerHTML = `<div class="gr-tittel">${esc(utenEnhet(w.name))}</div>
      ${sl.tall ? `<div class="gr-felt"><label>${T('Under', 'Below')}<input type="number" step="any" id="grLav" value="${g.lav == null ? '' : g.lav}" placeholder="${esc(T('ingen', 'none'))}"></label>
        <label>${T('Over', 'Above')}<input type="number" step="any" id="grHoy" value="${g.hoy == null ? '' : g.hoy}" placeholder="${esc(T('ingen', 'none'))}"></label>
        <span class="gr-enhet">${esc(w.unit || '')}</span></div>` : ''}
      <div class="gr-mer"><div class="gr-mer-h">${T('Flere varsler', 'More alerts')}</div>${mer}</div>
      <label class="gr-lyd"><input type="checkbox" id="grLyd" ${lyd() ? 'checked' : ''}> ${T('Kort lyd ved varsel', 'A short tone on an alert')}</label>
      <div class="sp-meta">${T('Du får beskjed i vinduet, og som skrivebordsvarsel hvis nettleseren tillater det, også når vinduet ikke er foran. NABE må være åpen.', 'You are told in the window, and as a desktop notification if the browser allows it, also when the window is not in front. NABE has to be open.')}
        ${blokkert ? ' ' + T('Skrivebordsvarsel er blokkert i nettleseren.', 'Desktop notifications are blocked in the browser.') : ''}</div>
      <div class="gr-knapper"><button type="button" class="btn" data-gr="fjern">${T('Fjern', 'Remove')}</button>
        <button type="button" class="btn primary" data-gr="lagre">${T('Lagre', 'Save')}</button></div>`;
    pop.hidden = false;
    const r = knapp.getBoundingClientRect(), b = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - b.width - 8, r.right - b.width)) + 'px';
    const topp = r.bottom + 6 + b.height > window.innerHeight ? r.top - b.height - 6 : r.bottom + 6;
    pop.style.top = Math.max(8, Math.min(topp, window.innerHeight - b.height - 8)) + 'px';
    aapenFor = w;
    (sl.tall ? $('grLav') : $('grPaa') || $('grStille')).focus();
  }
  async function lagrePop(fjern) {
    const w = aapenFor;
    if (!w) return;
    const les = (id) => { const el = $(id); if (!el) return null; const v = el.value.trim().replace(',', '.'); return v === '' || !isFinite(Number(v)) ? null : Number(v); };
    const g = fjern ? {...TOM} : {lav: les('grLav'), hoy: les('grHoy'), paa: les('grPaa'), stille: les('grStille'), fart: les('grFart')};
    if (g.lav !== null && g.hoy !== null && g.lav >= g.hoy) { toast(T('Nedre grense må være lavere enn øvre.', 'The lower limit has to be below the upper.'), true); return; }
    for (const k of ['paa', 'stille', 'fart']) if (g[k] !== null && g[k] <= 0) { toast(T('Tidene og farten må være større enn null.', 'The times and the pace have to be above zero.'), true); return; }
    savePrefs({grenseLyd: $('grLyd').checked});
    lagreGrense(w.ip, w.objid, g);
    // A tap on the button is the moment a browser lets us ask about notifications and start a sound
    if (harNoe(g)) {
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* none */ }
      if ($('grLyd').checked) { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch { /* none */ } }
    }
    lukkPop();
    markerBjeller();
    if (window.nabeVakt && window.nabeVakt.send) await window.nabeVakt.send();
    toast(!harNoe(g) ? T('Varslene er fjernet', 'The alerts are removed') : T('Varslene er satt. NABE følger punktet i bakgrunnen.', 'The alerts are set. NABE follows the point in the background.'));
    sjekk();
  }
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gr]');
    if (b) lagrePop(b.dataset.gr === 'fjern');
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lagrePop(false); } else if (e.key === 'Escape') { e.stopPropagation(); lukkPop(); } });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.gr-bjelle');
    if (b) {
      const rad = b.closest('.watch-row'), i = [...document.querySelectorAll('#watchList .watch-row')].indexOf(rad), w = S.watch[i];
      if (w) { if (aapenFor === w && !pop.hidden) lukkPop(); else aapnePop(b, w); }
      return;
    }
    if (!pop.hidden && !e.target.closest('.gr-pop')) lukkPop();
  });

  /* ------------------------------------------------------------- the history */
  const lag = document.createElement('div');
  lag.id = 'grenseOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);
  const kl = (t) => new Date(t * 1000).toLocaleTimeString(SPRAAK === 'en' ? 'en-GB' : 'no', {hour: '2-digit', minute: '2-digit'});
  function tegn() {
    const ev = HENDELSER.slice().reverse().slice(0, 60);
    const ute = new Set(aktive(HENDELSER).map((e) => e.address + '|' + e.objid + '|' + (e.regel || 'grense')));
    lag.innerHTML = `<div class="gs-modal sp-modal"><div class="gs-head"><span class="gd-tittel">${T('Grensevarsler', 'Limit alerts')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp"><div class="sp-rull"><table class="sp-tab"><tbody>${ev.length ? ev.map((e) => `<tr data-ip="${esc(e.address)}" data-o="${esc(e.objid)}">
        <td><div class="sp-navn">${esc(utenEnhet(e.navn))}${e.type !== 'tilbake' && ute.has(e.address + '|' + e.objid + '|' + (e.regel || 'grense')) ? ` <span class="ah-m naa">${T('ute nå', 'outside now')}</span>` : ''}</div>
        <div class="sp-meta">${esc(tekst(e))}</div></td><td class="t">${esc(kl(e.t))}</td></tr>`).join('')
        : `<tr><td class="sp-tom">${T('Ingen varsler ennå. Sett grenser med klokka på et festet punkt.', 'No alerts yet. Set limits with the bell on a pinned point.')}</td></tr>`}</tbody></table></div></div></div>`;
  }
  lag.addEventListener('click', (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const tr = e.target.closest('tr[data-ip]');
    if (tr) { lag.hidden = true; document.querySelector(`#devList .dev[data-ip="${CSS.escape(tr.dataset.ip)}"]`)?.click(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);
  window.aapneGrenser = async () => { await sjekk(); tegn(); lag.hidden = false; };

  window.nabeGrenser = {hent, tekst, aktive, lagre: lagreGrense, settInn, oppsummering, tilstand: () => ({hendelser: HENDELSER, sistId})};
})();
