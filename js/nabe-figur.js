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
    setTimeout(() => nabeSier(T('Au. Jeg er DIN-skinnemontert.', 'Ouch. I am DIN-rail mounted.'), null, 'dra'), 500);
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
