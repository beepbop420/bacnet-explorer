/* NABE - his body language
   The mood engine in app.js decides how he feels. This is how it shows: he
   breathes (CSS), fidgets when nobody is looking, likes being petted, does
   not like being dragged, yawns before he falls asleep, hops when he wakes,
   winks when a write goes through and dances after a good scan.
   Loaded after app.js and shares its globals (NABE, nabeMerke, nabeSier ...).
   Nothing here fires with reduced motion on. */
'use strict';

const FIGUR = {sistFikle: Date.now(), nesteFikle: 30000, gjespet: false, borte: 0};

/* Play a body class once. Removing it first restarts the animation if it is
   already running. */
function figur(k, ms) {
  const m = nabeMerke();
  if (!m || bevegelseAv()) return;
  m.classList.remove(k);
  void m.offsetWidth;
  m.classList.add(k);
  clearTimeout(figur['t' + k]);
  figur['t' + k] = setTimeout(() => m.classList.remove(k), ms);
}

/* Where he looks when he is busy with something of his own. Wins over the
   pointer until it is cleared. */
NABE.blikk = null;
const _figurTegn = nabeTegn;
nabeTegn = function () {
  _figurTegn();
  const m = nabeMerke();
  if (!NABE.blikk || !m || m.classList.contains('sover') || m.classList.contains('svimmel')) return;
  const g = m.querySelector('.nabe-pupiller');
  if (g) g.style.transform = `translate(${NABE.blikk[0]}px, ${NABE.blikk[1]}px)`;
};
function blikk(dx, dy, ms) {
  NABE.blikk = dx === null ? null : [dx, dy];
  nabeOppdater();
  clearTimeout(blikk.t);
  if (ms) blikk.t = setTimeout(() => { NABE.blikk = null; nabeOppdater(); }, ms);
}

function opptatt() {
  const m = nabeMerke();
  return !m || m.classList.contains('sover') || m.classList.contains('ser') || m.classList.contains('dras')
    || document.body.classList.contains('skanner') || document.hidden
    || document.getElementById('nabeBoble')?.classList.contains('inne');
}

/* ------------------------------------------------- when nobody is looking */
const FIKLING = [
  // Whistles, looking innocently at the ceiling.
  [4, () => { blikk(1.4, -2.2, 2800); figur('plystre', 2800); }],
  // Checks that nobody is watching.
  [3, () => {
    blikk(-2.2, 0.2);
    setTimeout(() => blikk(2.2, 0.2), 800);
    setTimeout(() => blikk(null), 1600);
  }],
  // Flicks his own antenna.
  [3, () => { blikk(0, -2.6, 1100); figur('boing', 900); }],
  // A long stretch, eyes shut.
  [2, () => { figur('strekk', 1600); nabeKlasse('blunk', 900); }],
  // Tilts his head at something only he can see.
  [2, () => { figur('lurer', 1600); blikk(-1.2, -1, 1600); }],
  // Dust in port 47808.
  [1, () => {
    figur('nys', 900);
    setTimeout(() => figur('boing', 900), 560);
  }],
  // Blows a bubble. It pops. He is surprised every time.
  [2, () => {
    blikk(0, 1.6, 2200);
    figur('tyggis', 2200);
    setTimeout(() => figur('hikk', 220), 1700);
  }],
  // Juggles a couple of bits.
  [2, () => { blikk(0, -2.6, 3200); figur('sjonglere', 3200); }],
  // Says hi in Morse with his LED, to nobody in particular.
  [1, () => morse('.... ..')],
];
const FIKLE_SUM = FIKLING.reduce((s, f) => s + f[0], 0);

setInterval(() => {
  const m = nabeMerke();
  if (!m || bevegelseAv()) return;
  const stille = Date.now() - NABE.sist;
  // A yawn and a stretch just before he nods off.
  if (stille > 105000 && stille < 120000 && !FIGUR.gjespet && !opptatt()) {
    FIGUR.gjespet = true;
    figur('gjesp', 1800); figur('strekk', 1600);
    return;
  }
  if (stille < 5000) FIGUR.gjespet = false;
  if (opptatt() || Date.now() - FIGUR.sistFikle < FIGUR.nesteFikle) return;
  FIGUR.sistFikle = Date.now();
  FIGUR.nesteFikle = 25000 + Math.random() * 30000;
  let r = Math.random() * FIKLE_SUM;
  for (const [vekt, gjor] of FIKLING) { if ((r -= vekt) < 0) { gjor(); break; } }
}, 1000);

/* Woken up: a startled little hop. Runs before app.js has cleared 'sover'. */
window.addEventListener('pointermove', () => {
  if (nabeMerke()?.classList.contains('sover')) setTimeout(() => figur('hopp', 550), 60);
}, {capture: true, passive: true});

/* Back after a while away: pleased to see you, not that he would say so. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { FIGUR.borte = Date.now(); return; }
  if (FIGUR.borte && Date.now() - FIGUR.borte > 60000) setTimeout(() => figur('hopp', 550), 300);
});

/* --------------------------------------------------- petting and poking */
const KOS = {snu: [], ret: 0, sist: 0};
(function hendene() {
  const m = nabeMerke();
  if (!m) return;
  const lenke = m.closest('a');
  if (lenke) lenke.setAttribute('draggable', 'false');

  // Every click squashes him a little; now and then the antenna goes too.
  m.addEventListener('click', () => {
    figur('klem', 380);
    if (Math.random() < 0.3) figur('boing', 900);
  });

  // Petting: the pointer stroked back and forth over him, slowly.
  m.addEventListener('pointermove', (e) => {
    if (DRA.aktiv || Math.abs(e.movementX) < 1) return;
    const naa = Date.now(), ret = Math.sign(e.movementX);
    if (KOS.ret && ret !== KOS.ret) KOS.snu.push(naa);
    KOS.ret = ret;
    KOS.snu = KOS.snu.filter(t => naa - t < 2200);
    if (KOS.snu.length >= 5 && naa - KOS.sist > 5000 && !bevegelseAv()) {
      KOS.snu = []; KOS.sist = naa;
      nabeKlasse('kos', 2600);
      figur('hjerte', 1600);
      setTimeout(() => figur('hjerte', 1600), 900);
      nabeSier(T('... ikke si det til noen.', '... do not tell anyone.'), null, 'kos');
      tell('kos');
    }
  });
})();

/* Dragging: he comes along a bit, on a rubber band, then springs back. */
const DRA = {aktiv: false, x0: 0, y0: 0, ned: false};
(function dra() {
  const m = nabeMerke();
  if (!m) return;
  const gummi = v => 16 * Math.tanh(v / 40);
  m.addEventListener('dragstart', e => e.preventDefault());
  m.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || bevegelseAv()) return;
    DRA.ned = true; DRA.x0 = e.clientX; DRA.y0 = e.clientY;
    m.setPointerCapture?.(e.pointerId);
  });
  m.addEventListener('pointermove', (e) => {
    if (!DRA.ned) return;
    const dx = e.clientX - DRA.x0, dy = e.clientY - DRA.y0;
    if (!DRA.aktiv && Math.hypot(dx, dy) < 5) return;
    if (!DRA.aktiv) { DRA.aktiv = true; m.classList.remove('fjaer'); m.classList.add('dras'); nabeTie(); }
    const gx = gummi(dx), gy = gummi(dy);
    // Leans after the pointer and stretches along the pull.
    m.style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px) rotate(${(gx * 0.8).toFixed(1)}deg)`;
    DRA.gx = gx; DRA.gy = gy;
  });
  const slipp = () => {
    DRA.ned = false;
    if (!DRA.aktiv) return;
    DRA.aktiv = false;
    m.classList.remove('dras');
    m.style.transform = '';
    m.style.setProperty('--dx', DRA.gx.toFixed(1) + 'px');
    m.style.setProperty('--dy', DRA.gy.toFixed(1) + 'px');
    figur('fjaer', 700);
    setTimeout(() => figur('boing', 900), 120);
    // The release is not a click.
    m.addEventListener('click', e => { e.stopImmediatePropagation(); e.preventDefault(); }, {capture: true, once: true});
    tell('dratt');
    const igjen = (teller().dratt || 0) > 5;
    setTimeout(() => igjen
      ? nabeSier(T('Igjen? Jeg husker forrige gang.', 'Again? I remember last time.'), 'trist', 'dra')
      : nabeSier(T('Au. Jeg er DIN-skinnemontert.', 'Ouch. I am DIN-rail mounted.'), null, 'dra'), 500);
  };
  m.addEventListener('pointerup', slipp);
  m.addEventListener('pointercancel', slipp);
})();

/* ------------------------------------------------------- reading along */
(function lesMed() {
  const q = document.getElementById('q');
  if (!q) return;
  q.addEventListener('input', () => {
    if (bevegelseAv()) return;
    // Eyes run along the line as you type, and back to you when you stop.
    const andel = Math.min(1, q.value.length / 28);
    blikk(-2 + 4 * andel, 2.2, 1500);
    if (q.value.endsWith('?')) figur('lurer', 1400);
  });
})();

/* ------------------------------------------------- reacting to the work */
// A good scan is worth a hop; a big one is worth a dance.
const _figurEtterSkann = nabeEtterSkann;
nabeEtterSkann = function (n) {
  _figurEtterSkann(n);
  if (n >= 10) setTimeout(() => figur('dans', 1400), 250);
  else if (n > 0) setTimeout(() => figur('hopp', 550), 250);
};

// A write that went through gets a wink. A release, a relieved hop.
const _figurApi = api;
api = async function (path, body) {
  const r = await _figurApi(path, body);
  if (path === '/api/write' && r && r.status === 'done') {
    if (body && body.release) figur('hopp', 550);
    else { nabeKlasse('vink', 1100); }
  }
  return r;
};

/* Hiccups. Rare - about one session in twelve - and they pass. */
if (Math.random() < 1 / 12) {
  setTimeout(function hikke(igjen = 4) {
    if (opptatt() || bevegelseAv()) { setTimeout(() => hikke(igjen), 20000); return; }
    figur('hikk', 220);
    if (igjen > 1) setTimeout(() => hikke(igjen - 1), 1300 + Math.random() * 900);
    else setTimeout(() => nabeSier(T('Hikk. Unnskyld. Pakketap.', 'Hic. Sorry. Packet loss.'), null, 'hikke'), 900);
  }, 120000 + Math.random() * 480000);
}

/* Windows' "animation effects" off and no choice made in NABE: he stands
   still, and says once why, so the stillness is not mistaken for a bug. */
setTimeout(() => {
  if (loadPrefs().utenBevegelse === undefined && bevegelseAv())
    nabeSier(T('Windows har skrudd av animasjoner, så jeg står stille. Slå dem på under Innstillinger hvis du vil se meg danse.',
               'Windows has turned animations off, so I am standing still. Turn them on under Settings if you want to see me dance.'),
             'trist', 'stille');
}, 6000);

/* ===================================================== round two: he notices */

/* Morse on the LED. A dot is a short flash, a dash a long one. */
function morse(kode) {
  const m = nabeMerke();
  if (!m || bevegelseAv()) return;
  blikk(0, -2.6, kode.length * 400 + 600);
  let t = 0;
  for (const c of kode) {
    if (c === ' ') { t += 450; continue; }
    const lengde = c === '-' ? 450 : 150;
    setTimeout(() => m.classList.add('led-paa'), t);
    setTimeout(() => m.classList.remove('led-paa'), t + lengde);
    t += lengde + 150;
  }
}

/* Where did you go? The pointer leaves the window and he looks after it;
   gone a while and he starts to wonder; back again and he is pleased. */
const UTE = {naar: 0, t: 0};
document.addEventListener('pointerout', (e) => {
  if (e.relatedTarget || bevegelseAv()) return;
  const m = nabeMerke();
  if (!m) return;
  const r = m.getBoundingClientRect();
  const vx = e.clientX - (r.left + 13), vy = e.clientY - (r.top + 13);
  const len = Math.hypot(vx, vy) || 1;
  UTE.naar = Date.now();
  blikk(vx / len * 2.4, vy / len * 2.4);
  clearTimeout(UTE.t);
  UTE.t = setTimeout(() => figur('lurer', 1800), 4000);
});
document.addEventListener('pointerover', (e) => {
  if (!UTE.naar || e.relatedTarget) return;
  clearTimeout(UTE.t);
  const borte = Date.now() - UTE.naar;
  UTE.naar = 0;
  blikk(null);
  if (borte > 4000) figur('hopp', 550);
});

/* Ducks when the pointer comes at him fast. More so if he has been dragged
   around a lot - he remembers. */
const DUKK = {x: 0, y: 0, t: 0, sist: 0};
window.addEventListener('pointermove', (e) => {
  const naa = performance.now();
  const m = nabeMerke();
  if (m && !bevegelseAv() && !DRA.ned && DUKK.t) {
    const r = m.getBoundingClientRect();
    const cx = r.left + 13, cy = r.top + 13;
    const for_ = Math.hypot(DUKK.x - cx, DUKK.y - cy), naa_ = Math.hypot(e.clientX - cx, e.clientY - cy);
    const fart = (for_ - naa_) / Math.max(1, naa - DUKK.t);      // px/ms towards him
    const redd = (teller().dratt || 0) > 5;
    if (naa_ < (redd ? 90 : 55) && fart > (redd ? 1.2 : 2.2) && naa - DUKK.sist > 4000) {
      DUKK.sist = naa;
      figur('dukk', 450);
      nabeKlasse('blunk', 220);
    }
  }
  DUKK.x = e.clientX; DUKK.y = e.clientY; DUKK.t = naa;
}, {passive: true});

/* Shy: rest the pointer on him and after a few seconds he looks away and
   goes a bit pink. (At eight seconds he tells you that you are staring.) */
(function sjenert() {
  const m = nabeMerke();
  if (!m) return;
  let t = 0;
  m.addEventListener('pointerenter', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (DRA.ned || bevegelseAv()) return;
      blikk(2.4, 1.2, 2600);
      nabeKlasse('rodmer', 2600);
    }, 3000);
  });
  m.addEventListener('pointerleave', () => clearTimeout(t));
})();

/* Scrolling a list: his eyes go with it. */
window.addEventListener('wheel', (e) => {
  if (bevegelseAv() || !e.target.closest?.('#devList, #pointsWrap, .tl-tab, #watchList')) return;
  blikk(0, Math.sign(e.deltaY) * 2.4, 700);
}, {passive: true});

/* Copying: the LED flashes like a camera. */
document.addEventListener('copy', () => {
  if (bevegelseAv()) return;
  figur('blits', 260);
  nabeKlasse('blunk', 160);
});

/* An error makes him flinch, on top of the sigh. */
const _figurToast = toast;
toast = function (tekst, feil, ...rest) {
  if (feil) figur('dukk', 450);
  return _figurToast(tekst, feil, ...rest);
};

/* Hot and cold. Open a temperature point and he feels it. */
const _figurVelg = selectPoint;
selectPoint = async function (objid) {
  const r = await _figurVelg(objid);
  const p = S.pointIndex && S.pointIndex.get(objid);
  const v = p && p.value;
  if (p && typeof v === 'number' && p.units === 'degrees-celsius' && !bevegelseAv()) {
    const tall = (Math.round(v * 10) / 10).toLocaleString('no');
    if (v >= 40) {
      nabeKlasse('varm', 3000);
      nabeSier(T(`${tall} °C. Jeg svetter med.`, `${tall} °C. I am sweating along.`), null, 'varm');
    } else if (v <= 5 && v !== 0) {     // exactly 0 is usually a sensor that is not there
      figur('fryser', 2000);
      nabeSier(T(`${tall} °C. Brr. Noen har glemt å lukke spjeldet.`, `${tall} °C. Brr. Someone forgot to close the damper.`), null, 'kald');
    }
  }
  return r;
};

/* He remembers you. Petted often enough and he is pleased to see you when
   the start screen goes; there is a milestone or two on the way. */
MILEPAELER.kos = [[10, 'Ti ganger klappet. Vi snakker ikke om det.', 'Petted ten times. We do not talk about it.'],
                  [50, 'Femti. Jeg har sluttet å late som jeg ikke liker det.', 'Fifty. I have stopped pretending I do not like it.']];
MILEPAELER.dratt = [[10, 'Ti ganger dratt i. Jeg har ringt verneombudet.', 'Dragged ten times. I have called the safety rep.']];
(function hilsDeg() {
  if ((teller().kos || 0) < 5) return;
  let n = 0;
  const vent = setInterval(() => {
    if (document.getElementById('startskjerm') && ++n < 120) return;
    clearInterval(vent);
    setTimeout(() => { figur('hopp', 550); nabeKlasse('rodmer', 1800); }, 500);
  }, 500);
})();

/* One thing at a time. A line that arrives while he is still talking waits
   its turn instead of cutting the first one off. Clicking him still
   interrupts - that goes straight to nabeSnakk. */
const SIER_KO = [];
const _figurSier = nabeSier;
nabeSier = function (tekst, humor, nokkel) {
  const snakker = document.getElementById('nabeBoble')?.classList.contains('inne');
  if (!snakker) return _figurSier(tekst, humor, nokkel);
  if (nokkel && (NABE_SAGT.has(nokkel) || SIER_KO.some(x => x[2] === nokkel))) return;
  SIER_KO.push([tekst, humor, nokkel]);
  if (SIER_KO.length > 2) SIER_KO.shift();
};
setInterval(() => {
  if (!SIER_KO.length || document.getElementById('nabeBoble')?.classList.contains('inne')) return;
  _figurSier(...SIER_KO.shift());
}, 900);
