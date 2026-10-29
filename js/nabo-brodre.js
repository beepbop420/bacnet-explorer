/* NABO - the little brother at his keyboard.

   NABE does the talking; his little brother types. Now and then a few keys,
   now and then a line on his terminal beside him: plain mono text and a
   thin cursor. Most of what he types is about
   his big brother - he pings him, answers his Morse, types "<3" when NABE
   sulks and "lol" when NABE is dizzy - and some of it is about you: he
   types along when you type, looks up when you point at him, and puts his
   head down on the keys when everyone has gone to sleep.

   Nothing here fires with motion off, while a dialog is open, or while
   NABE is speaking - the line would sit where his bubble goes.
   Loaded after nabo.js and shares its globals. */
'use strict';

const BROR = {ko: [], skriver: false, sistTap: 0, hand: 0, sistFeil: 0, sistC: 0, sovT: 0, sovLinje: false};

function bror() { return $('naboHus'); }
function nabeSnakker() { return document.getElementById('nabeBoble')?.classList.contains('inne'); }
function brorStille() {
  const h = bror();
  return !h || bevegelseAv() || document.hidden || !!$('startskjerm')
    || !!document.querySelector('.gs-overlay:not([hidden])') || !!document.querySelector('.nabo-ball');
}

function brorKlasse(k, ms) {
  const h = bror();
  if (!h) return;
  h.classList.add(k);
  clearTimeout(brorKlasse['t' + k]);
  if (ms) brorKlasse['t' + k] = setTimeout(() => h.classList.remove(k), ms);
}

/* One key: a hand goes down, the other one next time. */
function brorTap() {
  const h = bror();
  if (!h || bevegelseAv() || h.classList.contains('sover') || Date.now() - BROR.sistTap < 70) return;
  BROR.sistTap = Date.now();
  BROR.hand ^= 1;
  h.classList.remove('tap', 'h');
  void h.offsetWidth;
  h.classList.add('tap');
  if (BROR.hand) h.classList.add('h');
  clearTimeout(brorTap.t);
  brorTap.t = setTimeout(() => h.classList.remove('tap', 'h'), 160);
}

/* A line on his terminal, typed a letter at a time. Lines queue; one at a
   time, and a new one waits for the last to fade. */
function brorSkriv(tekst, {fart = 55, holde = 2400, tvang = false} = {}) {
  if (!tvang && brorStille()) return;
  BROR.ko.push({tekst, fart, holde});
  if (BROR.ko.length > 3) BROR.ko.splice(1, 1);
  if (!BROR.skriver) nesteLinje();
}

function nesteLinje() {
  const jobb = BROR.ko.shift();
  const h = bror();
  if (!jobb || !h || bevegelseAv()) { BROR.skriver = false; return; }
  BROR.skriver = true;
  h.querySelector('.nabo-term')?.remove();
  const el = document.createElement('span');
  el.className = 'nabo-term';
  el.setAttribute('aria-hidden', 'true');
  h.appendChild(el);
  h.classList.add('taster');
  let i = 0;
  const steg = () => {
    if (nabeSnakker()) { el.remove(); h.classList.remove('taster'); BROR.skriver = false; BROR.ko = []; return; }
    el.textContent = jobb.tekst.slice(0, ++i);
    if (i < jobb.tekst.length) { setTimeout(steg, jobb.fart * (0.6 + Math.random() * 0.9)); return; }
    h.classList.remove('taster', 'fort');
    setTimeout(() => {
      el.classList.add('ut');
      setTimeout(() => { el.remove(); nesteLinje(); }, 500);
    }, jobb.holde);
  };
  setTimeout(steg, 180);
}

/* -------------------------------------------------- left to himself */
const LINJER = [
  'ping nabe', 'git commit -m "fikset"', 'tail -f nabe.log', 'echo $NABO', 'who-is 0-4194303',
  'ede2btg --stille', ':wq', 'sudo lag kaffe', 'grep -r RT401 .', 'ls ~/anlegg', 'cat /dev/naboer',
  'top -o nabe', 'git push --force # tuller',
]
const NATT = ['// TODO: legg deg', 'sleep 28800', 'echo "god natt"'];

(function selv() {
  const plan = () => setTimeout(() => {
    const h = bror();
    if (h && !brorStille() && !h.classList.contains('sover') && !nabeSnakker() && !document.body.classList.contains('skanner')) {
      if (Math.random() < 0.4) {
        const t = new Date().getHours();
        const liste = (t >= 22 || t < 5) && Math.random() < 0.6 ? NATT : LINJER;
        brorSkriv(liste[Math.floor(Math.random() * liste.length)]);
      } else {
        // Just a few keys. Probably fixing a typo.
        brorKlasse('taster', 500 + Math.random() * 1400);
      }
    }
    plan();
  }, 22000 + Math.random() * 38000);
  plan();
})();

/* Typing along with you, a key for a key, wherever you type. */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
  const el = document.activeElement;
  if (!el || !(/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)) return;
  if (!BROR.skriver) brorTap();
}, true);

/* Ctrl+C anywhere: he knows what that used to mean. */
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c' || Date.now() - BROR.sistC < 30000) return;
  if (window.getSelection()?.toString()) { BROR.sistC = Date.now(); brorSkriv('^C', {holde: 1200}); }
}, true);

/* Point at him and he stops and looks up. */
(function blikkOpp() {
  const h = bror();
  if (!h) return;
  h.addEventListener('mouseenter', () => { h.classList.add('ser'); h.classList.remove('taster'); });
  h.addEventListener('mouseleave', () => h.classList.remove('ser'));
})();

/* ----------------------------------------------------------- at start */
(function oppstart() {
  let n = 0;
  const vent = setInterval(() => {
    if (++n > 120) { clearInterval(vent); return; }
    if ($('startskjerm') || !bror()) return;
    clearInterval(vent);
    setTimeout(() => {
      brorSkriv('nabo --start', {holde: 600});
      brorSkriv('✓ klar', {holde: 1600});
    }, 1400);
  }, 500);
})();

/* -------------------------------------------- the brothers, together */
// Big brother's moods, read off his class list.
(function lytt() {
  const m = nabeMerke();
  if (!m) return;
  let for_ = new Set(m.classList);
  new MutationObserver(() => {
    const naa = new Set(m.classList);
    const ny = (k) => naa.has(k) && !for_.has(k);
    if (ny('trist')) { brorKlasse('ser', 1800); setTimeout(() => brorSkriv('<3', {holde: 1600}), 500); }
    else if (ny('svimmel')) brorSkriv('lol', {holde: 1400});
    else if (ny('snurr')) brorSkriv('sudo !!', {holde: 1600});
    else if (ny('snakker')) { const h = bror(); h?.querySelector('.nabo-term')?.remove(); h?.classList.remove('taster'); brorKlasse('ser', 2600); }
    for_ = naa;
  }).observe(m, {attributes: true, attributeFilter: ['class']});
})();

/* Ping and pong: a word sent along the top bar and back. */
function sendOrd(fra, til, ord) {
  return new Promise((ok) => {
    if (!fra || !til || bevegelseAv()) { ok(); return; }
    const a = fra.getBoundingClientRect(), b = til.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'nabo-pakke';
    el.textContent = ord;
    document.body.appendChild(el);
    const y = a.top + a.height / 2 - 14;
    const x0 = a.left + a.width / 2, x1 = b.left + b.width / 2;
    // Hops, a few pixels at a time, the way a packet would if you could see one.
    const frames = Array.from({length: 9}, (_, i) => ({transform: `translate(${x0 + (x1 - x0) * i / 8 - 10}px, ${y - (i % 2) * 2}px)`}));
    el.animate(frames, {duration: 700, easing: 'steps(8, end)'}).finished
      .then(() => { el.remove(); ok(); }, () => { el.remove(); ok(); });
  });
}

async function pingPong() {
  const m = nabeMerke(), h = bror();
  if (!m || !h || brorStille() || m.classList.contains('sover') || h.classList.contains('sover') || nabeSnakker()) return;
  if (typeof figur === 'function') figur('boing', 900);
  await sendOrd(m, h, 'ping');
  brorTap();
  await new Promise(r => setTimeout(r, 260));
  await sendOrd(h, m, 'pong');
  if (typeof figur === 'function') figur('hikk', 220);
}
window.naboPing = pingPong;
(function pingPlan() {
  setTimeout(() => { pingPong(); pingPlan(); }, 180000 + Math.random() * 240000);
})();

/* NABE says hi in Morse with his LED; little brother answers in kind. */
if (typeof morse === 'function') {
  const _morse = morse;
  morse = function (kode) {
    const r = _morse.apply(this, arguments);
    const varighet = [...kode].reduce((t, c) => t + (c === ' ' ? 450 : c === '-' ? 600 : 300), 0);
    setTimeout(() => { brorSkriv(kode, {fart: 120, holde: 800}); brorSkriv('HI', {holde: 1400}); }, varighet + 400);
    return r;
  };
}

/* --------------------------------------------------------- the scan */
(function skann() {
  let paa = false;
  new MutationObserver(() => {
    const naa = document.body.classList.contains('skanner');
    if (naa === paa) return;
    paa = naa;
    const h = bror();
    if (!h) return;
    if (naa) {
      const omr = (S.scanRanges || [])[0] || '';
      h.classList.add('taster', 'fort');
      brorSkriv(`> who-is ${omr}`.trim(), {fart: 28, holde: 999999});
    } else {
      h.classList.remove('taster', 'fort');
      h.querySelector('.nabo-term')?.remove();
      BROR.ko = []; BROR.skriver = false;
      const n = S.devices.length;
      if (typeof SK !== 'undefined' && SK.avbrutt) brorSkriv('^C', {holde: 1400});
      else if (n) brorSkriv(n >= 5 ? `✓ ${n} I-Am · gg` : `✓ ${n} I-Am`, {holde: 1800});
      else brorSkriv('0 I-Am · timeout', {fart: 35, holde: 2200});
    }
  }).observe(document.body, {attributes: true, attributeFilter: ['class']});
  // Every answer is a key under his hands.
  if (typeof skannSvar === 'function') {
    const _svar = skannSvar;
    skannSvar = function () { const r = _svar.apply(this, arguments); brorTap(); return r; };
  }
})();

/* A Variabel file saved: he types it out the way it used to be done. */
if (typeof naboLagre === 'function') {
  const _lagre = naboLagre;
  naboLagre = function (navn) {
    const r = _lagre.apply(this, arguments);
    const kort = String(navn || 'VARIABEL').replace(/\.csv$/i, '').slice(0, 18).toUpperCase();
    brorKlasse('fort', 1400);
    brorSkriv(`save ${kort.toLowerCase()}.csv`, {fart: 30, holde: 600, tvang: true});
    brorSkriv('✓ lagret', {holde: 1600, tvang: true});
    return r;
  };
}

/* Errors: he notes the exit code. Once a minute at most, never for a warning. */
if (typeof toast === 'function') {
  const _toast = toast;
  toast = function (msg, isErr) {
    const r = _toast.apply(this, arguments);
    if (isErr && Date.now() - BROR.sistFeil > 60000) { BROR.sistFeil = Date.now(); brorSkriv('exit 1', {holde: 1600}); }
    return r;
  };
}

/* ------------------------------------------------------- night shift
   When both have been asleep a good while his head goes down on the keys,
   and the keys do what keys do under a head. Once per nap. */
setInterval(() => {
  const h = bror();
  if (!h) return;
  if (!h.classList.contains('sover')) {
    BROR.sovT = 0; BROR.sovLinje = false;
    if (h.classList.contains('knock')) {
      h.classList.remove('knock');
      setTimeout(() => brorSkriv('✓ våken', {holde: 1400}), 500);
    }
    return;
  }
  if (!BROR.sovT) BROR.sovT = Date.now();
  if (!BROR.sovLinje && Date.now() - BROR.sovT > 90000 && !bevegelseAv() && !document.hidden) {
    BROR.sovLinje = true;
    h.classList.add('knock');
    brorSkriv('zzzzzzzzzzzzzzzzzzzzzz', {fart: 140, holde: 4000, tvang: true});
  }
}, 2000);

/* ---------------------------------------------------- follow the rabbit
   "matrix" in the scan field or in NABO's search: green characters fall
   from where he sits, for a moment. */
function regn() {
  const h = bror();
  if (!h || bevegelseAv()) return;
  const r = h.getBoundingClientRect();
  const tegn = '0123456789ABCDEF';
  for (let k = 0; k < 14; k++) {
    const el = document.createElement('span');
    el.className = 'nabo-regn';
    el.textContent = Array.from({length: 6}, () => tegn[Math.floor(Math.random() * tegn.length)]).join('\n');
    el.style.whiteSpace = 'pre';
    el.style.left = (r.left - 30 + Math.random() * (r.width + 160)) + 'px';
    el.style.top = (r.bottom - 20) + 'px';
    document.body.appendChild(el);
    el.animate([{transform: 'translateY(-30px)', opacity: 0}, {opacity: 1, offset: .2}, {transform: 'translateY(260px)', opacity: 0}],
      {duration: 1600 + Math.random() * 900, delay: Math.random() * 600, easing: 'steps(16, end)', fill: 'backwards'})
      .finished.then(() => el.remove(), () => el.remove());
  }
  brorSkriv('wake up, NABE…', {fart: 90, holde: 1800, tvang: true});
}
document.addEventListener('input', (e) => {
  if (!['rangeInput', 'naboSok'].includes(e.target.id)) return;
  if (e.target.value.trim().toLowerCase() === 'matrix') regn();
});
