/* NABE - the pointers. A catalog like the wardrobe: Peker tab, earned by work.

   Everything is drawn on one canvas over the window and driven by real
   springs with mass and speed, so a thing overshoots, stretches and settles
   instead of sliding to its place. The arrow stays the system's own cursor in
   NABE's shape, so it never lags a frame behind the hand; only the
   screwdriver replaces it. Nothing runs while the mouse is still.
   Loaded before nabe-garderobe.js, which shows PEKERE in its Peker tab. */
'use strict';

const PEKERE = [
  {id: 'vanlig', navn: ['Windows', 'Windows'], om: ['Vanlig musepeker, ingen effekter', 'The plain pointer, no effects'], krav: null,
   ikon: '<path d="M10 6l5 17 3-6 6-3z"/>'},
  {id: 'ring', navn: ['Ringen', 'The ring'], om: ['Henger etter på en fjær og legger seg rundt knapper', 'Hangs back on a spring and wraps buttons'], krav: null,
   ikon: '<rect x="6" y="9" width="20" height="14" rx="5"/>'},
  {id: 'kabel', navn: ['Patchkabel', 'Patch cable'], om: ['En kabel med plugg som dingler etter pila', 'A cable with a plug that swings from the arrow'],
   krav: ['skann', 5, ['5 skann', '5 scans']], ikon: '<path d="M8 6c0 12 14 6 14 16"/><rect x="18" y="22" width="8" height="6"/>'},
  {id: 'lille-nabe', navn: ['Lille NABE', 'Little NABE'], om: ['NABE følger etter, med klærne han har på', 'NABE tags along, in the clothes he has on'],
   krav: ['skann', 10, ['10 skann', '10 scans']], ikon: '<rect x="8" y="9" width="16" height="15" rx="4"/><circle cx="13" cy="15" r="1.6"/><circle cx="19" cy="15" r="1.6"/>'},
  {id: 'lille-nabo', navn: ['Lille NABO', 'Little NABO'], om: ['Naboen kommer på besøk', 'The neighbour comes along'],
   krav: ['varfil', 1, ['Lag én Variabel-fil', 'Make one Variabel file']], ikon: '<path d="M6 16l10-8 10 8v9H6z"/>'},
  {id: 'trend', navn: ['Trendlinja', 'The trend line'], om: ['Pila tegner en linje som tynnes ut bak seg', 'The arrow draws a line that thins out behind it'],
   krav: ['live', 3, ['Slå på Live tre ganger', 'Turn on Live three times']], ikon: '<path d="M4 22c6 0 6-12 12-12s6 8 12 4"/>'},
  {id: 'gnister', navn: ['Gnister', 'Sparks'], om: ['Et klikk slår gnister, litt som i et koblingsskap', 'A click throws sparks, a bit like in a panel'],
   krav: ['skriv', 1, ['Skriv til et anlegg', 'Write to a site']], ikon: '<path d="M16 5v7M16 20v7M5 16h7M20 16h7M8 8l5 5M19 19l5 5M24 8l-5 5M13 19l-5 5"/>'},
  {id: 'skrutrekker', navn: ['Skrutrekker', 'Screwdriver'], om: ['Bytter ut pila. Vipper med farta og vrir ved klikk', 'Replaces the arrow. Tilts with speed and twists on a click'],
   krav: ['enheter', 100, ['Finn 100 enheter', 'Find 100 devices']], ikon: '<path d="M6 6l10 10"/><rect x="15" y="15" width="7" height="13" rx="2" transform="rotate(-45 18 21)"/>'},
  {id: 'jet', navn: ['Jetflamme', 'Jet flame'], om: ['Flamme bak pila, fra jetpakka', 'A flame behind the arrow, off the jetpack'], spill: true, sjelden: true,
   krav: ['tunnelRekord', 100, ['100 poeng i Tunnelen', '100 points in the tunnel']], ikon: '<path d="M16 4c5 7 8 11 8 15a8 8 0 0 1-16 0c0-4 3-8 8-15z"/>'},
];

const pekerValgt = () => {
  const p = loadPrefs();
  return (p.garderobe && p.garderobe.peker) || (p.pekerAv ? 'vanlig' : 'ring');
};

const PEKER = (function motor() {
  const MAAL = 'button,a[href],[role=button],summary,.dev,.ss-rad,.ctx-stat,.menu-item';
  const TEKST = 'input,textarea,select,[contenteditable],.splitter';
  const lerret = document.createElement('canvas');
  lerret.id = 'pekerLerret';
  const fig = document.createElement('div');
  fig.id = 'pekerFig';
  fig.hidden = true;
  document.body.append(lerret, fig);
  const c = lerret.getContext('2d');
  const farge = {fg: '#ececee', accent: '#6aa7ff', warn: '#ffc900', err: '#ff5a4d'};
  let B = 0, H = 0;
  function mal() {
    const d = window.devicePixelRatio || 1;
    B = innerWidth; H = innerHeight;
    lerret.width = B * d; lerret.height = H * d;
    c.setTransform(d, 0, 0, d, 0, 0);
  }
  function lesFarger() {
    const s = getComputedStyle(document.documentElement);
    for (const [k, v] of [['fg', '--fg'], ['accent', '--accent'], ['warn', '--warn'], ['err', '--err']]) farge[k] = s.getPropertyValue(v).trim() || farge[k];
  }

  const mus = {x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, inne: false, sist: 0, tekst: false, knapp: false};
  const fjaer = (s, maal, k, d, dt) => { s.v += (k * (maal - s.x) - d * s.v) * dt; s.x += s.v * dt; };
  const f = (x) => ({x, v: 0});
  const klem = (v, a, b) => Math.max(a, Math.min(b, v));
  const fart = () => Math.hypot(mus.vx, mus.vy);

  /* ---- the ring */
  const R = {x: f(0), y: f(0), b: f(22), h: f(22), r: f(11), fyll: f(0), lys: f(0), strekk: f(0)};
  let vinkel = 0, fast = null, fare = false;
  const magnet = {el: null, dx: 0, dy: 0};
  function slipp() {
    const e = magnet.el;
    if (!e) return;
    if (e.isConnected && (magnet.dx || magnet.dy)) {
      e.style.translate = '';
      e.animate([{translate: `${magnet.dx}px ${magnet.dy}px`}, {translate: '0px 0px'}], {duration: 380, easing: 'cubic-bezier(.3,1.5,.5,1)'});
    }
    magnet.el = null; magnet.dx = magnet.dy = 0;
  }
  function sikt(el) {
    const q = el && el.isConnected ? el.getBoundingClientRect() : null;
    const ok = q && q.width && q.width <= 420 && q.height <= 96;
    if (!ok) { slipp(); fast = null; fare = false; return; }
    if (magnet.el !== el) slipp();
    // Measured without the pull, or the pull would pull itself.
    const venstre = q.left - magnet.dx, topp = q.top - magnet.dy;
    const dx = klem((mus.x - venstre - q.width / 2) * .13, -9, 9), dy = klem((mus.y - topp - q.height / 2) * .2, -6, 6);
    fast = {x: venstre - 3 + dx, y: topp - 3 + dy, b: q.width + 6, h: q.height + 6, r: (parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) + 3};
    fare = el.matches('.fare,#wSend');
    // Small things come a little towards the hand.
    if (q.width <= 200 && !el.matches('.dev,.ss-rad')) {
      magnet.el = el; magnet.dx = dx * .5; magnet.dy = dy * .5;
      el.style.translate = `${magnet.dx}px ${magnet.dy}px`;
    }
  }
  const ring = {
    start() { R.x.x = mus.x - 11; R.y.x = mus.y - 11; },
    stopp() { slipp(); fast = null; },
    steg(dt, naa) {
      const m = fast || {x: mus.x - 11, y: mus.y - 11, b: 22, h: 22, r: 11};
      const k = fast ? 420 : 760, d = fast ? 24 : 27;
      fjaer(R.x, m.x, k, d, dt); fjaer(R.y, m.y, k, d, dt);
      fjaer(R.b, m.b, k, d, dt); fjaer(R.h, m.h, k, d, dt); fjaer(R.r, m.r, 300, 26, dt);
      fjaer(R.fyll, fast ? 1 : 0, 200, 22, dt);
      fjaer(R.lys, fast || naa - mus.sist < 900 ? 1 : 0, 60, 14, dt);
      const v = Math.hypot(R.x.v, R.y.v);
      if (v > 60) vinkel = Math.atan2(R.y.v, R.x.v);
      fjaer(R.strekk, fast ? 0 : klem(v / 2600, 0, .6), 300, 20, dt);
    },
    tegn() {
      const a = klem(R.lys.x, 0, 1);
      if (a < .01) return;
      const b = Math.max(R.b.x, 4), h = Math.max(R.h.x, 4), s = klem(R.strekk.x, -.2, .7);
      c.save();
      c.translate(R.x.x + b / 2, R.y.x + h / 2);
      if (Math.abs(s) > .004) { c.rotate(vinkel); c.scale(1 + s, 1 - s * .55); c.rotate(-vinkel); }
      c.beginPath();
      c.roundRect(-b / 2, -h / 2, b, h, klem(R.r.x, 0, Math.min(b, h) / 2));
      c.globalAlpha = a * (.42 + .4 * klem(R.fyll.x, 0, 1));
      c.strokeStyle = fare ? farge.err : farge.fg;
      c.lineWidth = 1.5;
      if (document.body.classList.contains('skanner')) c.setLineDash([5, 4]);
      c.stroke();
      c.globalAlpha = a * .06 * klem(R.fyll.x, 0, 1);
      c.fillStyle = fare ? farge.err : farge.fg;
      c.fill();
      c.restore();
    },
    klikk() { R.b.v -= 260; R.h.v -= 260; R.x.v += 130; R.y.v += 130; },
    rolig(naa) {
      return Math.abs(R.x.v) + Math.abs(R.y.v) + Math.abs(R.b.v) + Math.abs(R.h.v) < 3 && (fast || R.lys.x < .01 && naa - mus.sist > 900);
    },
  };

  /* ---- the cable: a rope of points with weight, and a plug on the end */
  const P = [];
  const LEDD = 15, LENGDE = 9;
  let rolig = 0;
  const kabel = {
    start() { P.length = 0; for (let i = 0; i < LEDD; i++) P.push({x: mus.x, y: mus.y + i * LENGDE, px: mus.x, py: mus.y + i * LENGDE}); },
    steg(dt) {
      let flytt = 0;
      for (let i = 1; i < LEDD; i++) {
        const p = P[i], vx = (p.x - p.px) * .985, vy = (p.y - p.py) * .985;
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy + 1500 * dt * dt;
        flytt += Math.abs(vx) + Math.abs(vy);
      }
      rolig = flytt;
      P[0].x = mus.x + 1; P[0].y = mus.y + 1;
      for (let n = 0; n < 6; n++) {
        for (let i = 1; i < LEDD; i++) {
          const a = P[i - 1], b = P[i], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, e = (l - LENGDE) / l;
          if (i > 1) { a.x += dx * e / 2; a.y += dy * e / 2; b.x -= dx * e / 2; b.y -= dy * e / 2; }
          else { b.x -= dx * e; b.y -= dy * e; }
        }
      }
    },
    tegn() {
      if (!P.length) return;
      c.save();
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < LEDD - 1; i++) c.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
      c.lineTo(P[LEDD - 1].x, P[LEDD - 1].y);
      c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 4.5; c.stroke();
      c.strokeStyle = farge.accent; c.lineWidth = 2.8; c.stroke();
      const e = P[LEDD - 1], g = P[LEDD - 2];
      c.translate(e.x, e.y);
      c.rotate(Math.atan2(e.y - g.y, e.x - g.x) - Math.PI / 2);
      c.fillStyle = '#e8e8ea'; c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1;
      c.beginPath(); c.roundRect(-5, -1, 10, 13, 1.5); c.fill(); c.stroke();
      c.fillStyle = '#c9a227';
      for (let i = -3; i <= 3; i += 2) c.fillRect(i - .4, 8, .9, 3.5);
      c.restore();
    },
    klikk() { for (let i = 1; i < LEDD; i++) P[i].py += i * .9; },
    rolig() { return rolig < .25; },
  };

  /* ---- a brother on a spring */
  const F = {x: f(0), y: f(0), rot: f(0)};
  const bror = (hvem) => ({
    start() {
      F.x.x = mus.x + 18; F.y.x = mus.y + 22;
      fig.innerHTML = (typeof forhaand === 'function' ? forhaand(hvem) : '');
      const s = fig.querySelector('svg');
      if (s) { s.classList.add('gard-forhånd'); if (typeof kle === 'function') kle(s, hvem, Object.assign({}, gardPrefs()[hvem])); }
      fig.hidden = false;
    },
    stopp() { fig.hidden = true; fig.innerHTML = ''; },
    steg(dt) {
      fjaer(F.x, mus.x + 18, 130, 13, dt);
      fjaer(F.y, mus.y + 22, 130, 13, dt);
      fjaer(F.rot, klem(F.x.v * .035, -28, 28), 170, 11, dt);
    },
    tegn() { fig.style.transform = `translate(${F.x.x}px,${F.y.x}px) rotate(${F.rot.x}deg)`; },
    klikk() { F.y.v -= 340; },
    rolig() { return Math.abs(F.x.v) + Math.abs(F.y.v) + Math.abs(F.rot.v) < 3; },
  });

  /* ---- a line that thins out */
  const L = [];
  const trend = {
    start() { L.length = 0; },
    steg(dt, naa) {
      L.push({x: mus.x, y: mus.y, t: naa});
      while (L.length && naa - L[0].t > 340) L.shift();
    },
    tegn() {
      if (L.length < 3) return;
      c.save();
      c.lineCap = 'round'; c.strokeStyle = farge.accent;
      for (let i = 1; i < L.length; i++) {
        const u = i / L.length;
        c.globalAlpha = u * .85;
        c.lineWidth = .6 + u * 3.2;
        c.beginPath(); c.moveTo(L[i - 1].x, L[i - 1].y); c.lineTo(L[i].x, L[i].y); c.stroke();
      }
      c.restore();
    },
    klikk() {},
    rolig(naa) { return !L.length || (L[L.length - 1].x === L[0].x && L[L.length - 1].y === L[0].y && naa - mus.sist > 360); },
  };

  /* ---- things that fly: sparks and flame */
  const G = [];
  const flyg = (dt, tyngde) => {
    for (let i = G.length - 1; i >= 0; i--) {
      const p = G[i];
      p.liv -= dt;
      if (p.liv <= 0) { G.splice(i, 1); continue; }
      p.vy += tyngde * dt; p.vx *= .985; p.vy *= .985;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  };
  const gnister = {
    start() { G.length = 0; },
    steg(dt) { flyg(dt, 900); },
    tegn() {
      c.save(); c.lineCap = 'round';
      for (const p of G) {
        const u = p.liv / p.maks;
        c.globalAlpha = Math.min(1, u * 1.6);
        c.strokeStyle = u > .55 ? '#fff' : farge.warn;
        c.lineWidth = 1 + u;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * .022, p.y - p.vy * .022); c.stroke();
      }
      c.restore();
    },
    klikk(x, y) {
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * 420, l = .25 + Math.random() * .4;
        G.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, liv: l, maks: l});
      }
    },
    rolig() { return !G.length; },
  };
  const jet = {
    start() { G.length = 0; },
    steg(dt) {
      const n = Math.min(4, Math.floor(fart() / 260));
      for (let i = 0; i < n; i++) {
        const l = .18 + Math.random() * .24;
        G.push({x: mus.x + (Math.random() - .5) * 6, y: mus.y + (Math.random() - .5) * 6,
                vx: -mus.vx * .12 + (Math.random() - .5) * 60, vy: -mus.vy * .12 + (Math.random() - .5) * 60, liv: l, maks: l});
      }
      flyg(dt, -160);
    },
    tegn() {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const p of G) {
        const u = p.liv / p.maks;
        c.globalAlpha = u * .7;
        c.fillStyle = u > .6 ? '#ffe9a8' : u > .3 ? '#ff9a2e' : '#d8401f';
        c.beginPath(); c.arc(p.x, p.y, 1.5 + u * 5, 0, 7); c.fill();
      }
      c.restore();
    },
    klikk() {},
    rolig() { return !G.length; },
  };

  /* ---- the screwdriver: the only one that replaces the arrow */
  const S2 = {tilt: f(-.62), vri: f(0)};
  const skrutrekker = {
    egenPil: true,
    start() {},
    steg(dt) {
      fjaer(S2.tilt, -.62 + klem(mus.vx * .00032, -.6, .6), 240, 13, dt);
      fjaer(S2.vri, 0, 420, 14, dt);
    },
    tegn() {
      if (mus.tekst) return;
      c.save();
      c.translate(mus.x, mus.y);
      c.rotate(S2.tilt.x);
      const v = 1 - Math.abs(Math.sin(S2.vri.x)) * .35;
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1;
      c.fillStyle = '#cfd0d6';
      c.beginPath(); c.moveTo(-1.1, 0); c.lineTo(1.1, 0); c.lineTo(1.8, 3); c.lineTo(1.8, 21); c.lineTo(-1.8, 21); c.lineTo(-1.8, 3); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = farge.warn;
      c.beginPath(); c.roundRect(-5.5 * v, 20, 11 * v, 18, 3.5); c.fill(); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,.35)';
      for (const x of [-2.2, 0, 2.2]) { c.beginPath(); c.moveTo(x * v, 24); c.lineTo(x * v, 35); c.stroke(); }
      c.restore();
    },
    klikk() { S2.vri.v += 26; S2.tilt.v += 5; },
    rolig() { return Math.abs(S2.tilt.v) + Math.abs(S2.vri.v) < .05; },
  };
  const vanlig = {steg() {}, tegn() {}, klikk() {}, rolig: () => true};
  const STIL = {vanlig, ring, kabel, 'lille-nabe': bror('nabe'), 'lille-nabo': bror('nabo'), trend, gnister, skrutrekker, jet};

  /* ---- a click goes out like a Who-Is */
  const pinger = [];
  function pingTegn(dt) {
    for (let i = pinger.length - 1; i >= 0; i--) {
      const p = pinger[i];
      p.t += dt / .46;
      if (p.t >= 1) { pinger.splice(i, 1); continue; }
      const u = 1 - Math.pow(1 - p.t, 3);
      c.save();
      c.globalAlpha = .5 * (1 - p.t);
      c.strokeStyle = farge.fg; c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, 4 + u * 38, 0, 7); c.stroke();
      c.restore();
    }
  }

  /* ---- the loop: runs only while something moves */
  let stil = vanlig, id = 'vanlig', gaar = false, sist = 0;
  function ramme(t) {
    try {
      const dt = klem((t - sist) / 1000, .004, .033);
      sist = t;
      mus.vx += ((mus.x - mus.px) / dt - mus.vx) * .4;
      mus.vy += ((mus.y - mus.py) / dt - mus.vy) * .4;
      mus.px = mus.x; mus.py = mus.y;
      stil.steg(dt, t);
      c.clearRect(0, 0, B, H);
      if (mus.inne) stil.tegn();
      pingTegn(dt);
      if (stil.rolig(t) && !pinger.length && t - mus.sist > 120) gaar = false;
      else requestAnimationFrame(ramme);
    } catch (e) {
      // A hidden arrow and a broken effect would leave nothing to point with.
      console.error(e);
      gaar = false;
      bruk('vanlig');
    }
  }
  function vekk() {
    if (gaar) return;
    gaar = true;
    sist = performance.now();
    requestAnimationFrame(ramme);
  }

  const paa = () => id !== 'vanlig';
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !paa()) return;
    mus.x = e.clientX; mus.y = e.clientY; mus.sist = performance.now();
    mus.tekst = !!(e.target.closest && e.target.closest(TEKST));
    if (!mus.inne) {
      mus.inne = true; mus.px = mus.x; mus.py = mus.y;
      stil.start && stil.start();
    }
    if (stil === ring) sikt(e.buttons ? null : e.target.closest && e.target.closest(MAAL));
    vekk();
  }, {passive: true});
  document.documentElement.addEventListener('mouseleave', () => {
    mus.inne = false;
    if (stil === ring) slipp();
    vekk();
  });
  const paaNytt = () => {
    if (!mus.inne || stil !== ring) return;
    const u = document.elementFromPoint(mus.x, mus.y);
    sikt(u && u.closest(MAAL));
    vekk();
  };
  document.addEventListener('scroll', paaNytt, {capture: true, passive: true});
  window.addEventListener('resize', () => { mal(); paaNytt(); });
  etter('renderDevices', paaNytt);
  etter('applyTheme', () => setTimeout(lesFarger, 60));

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || !paa()) return;
    stil.klikk(e.clientX, e.clientY);
    if (stil !== gnister) pinger.push({x: e.clientX, y: e.clientY, t: 0});
    vekk();
  }, {passive: true});

  function bruk(ny) {
    stil.stopp && stil.stopp();
    id = bevegelseAv() ? 'vanlig' : (STIL[ny] ? ny : 'ring');
    stil = STIL[id];
    mus.inne = false;
    document.documentElement.classList.toggle('peker-paa', id !== 'vanlig');
    document.documentElement.classList.toggle('peker-egen', !!stil.egenPil);
    c.clearRect(0, 0, B, H);
    const s = $('pekerState'), p = PEKERE.find(x => x.id === pekerValgt());
    if (s && p) s.textContent = T(p.navn[0], p.navn[1]);
  }
  mal(); lesFarger();
  etter('brukBevegelse', () => bruk(pekerValgt()));
  // After the wardrobe has loaded: a brother needs its drawings.
  setTimeout(() => bruk(pekerValgt()));
  $('pekerBtn').onclick = () => { $('temaOverlay').hidden = true; aapneGarderobe('peker'); };
  return {bruk, tilstand: () => ({id, x: R.x, b: R.b, fast: !!fast, magnet: magnet.dx, gaar})};
})();

/* The Peker tab in the wardrobe. */
function pekerKatalog() {
  const t = tellerNaa(), valgt = pekerValgt();
  return `<div class="gd-hoved">
    <div class="gd-scene pk-scene">
      <div class="pk-tittel">${T('Prøv her', 'Try it here')}</div>
      <div class="pk-prove"><button type="button" class="btn">${T('Knapp', 'Button')}</button><button type="button" class="btn">${T('Enda en', 'Another')}</button><button type="button" class="btn primary">${T('Skann', 'Scan')}</button></div>
      <div class="gd-scene-tekst">${esc(T('Pekerne kommer av arbeid, ikke av klikking.', 'Pointers come from work, not from clicking.'))}</div>
    </div>
    <div class="gd-katalog"><div class="gd-rutenett">${PEKERE.map((p) => {
      const aapen = laastOpp(p), paa = valgt === p.id;
      const [k, n, tekst] = p.krav || [];
      const har = p.krav ? Math.min(t[k] || 0, n) : 0;
      return `<button type="button" class="gd-kort pk-kort${aapen ? '' : ' laast'}${paa ? ' paa' : ''}${p.spill ? ' spill' : ''}${p.sjelden ? ' sjelden' : ''}" data-peker="${p.id}" title="${esc(T(p.om[0], p.om[1]))}">
        <span class="gd-fig"><svg class="pk-ikon" viewBox="0 0 32 32" aria-hidden="true">${p.ikon}</svg></span>
        <span class="gd-navn">${esc(pn(p))}</span>${p.spill ? `<span class="gd-merke">${T('Fra Tunnelen', 'From the tunnel')}</span>` : ''}
        ${aapen ? `<span class="gd-krav">${esc(T(p.om[0], p.om[1]))}</span><span class="gd-status">${paa ? T('I bruk', 'In use') : ''}</span>`
                : `<span class="gd-krav">${esc(T(tekst[0], tekst[1]))}</span><span class="gd-bar"><i style="transform:scaleX(${har / n})"></i></span><span class="gd-tall">${har} / ${n}</span>`}
      </button>`;
    }).join('')}</div></div>
  </div>`;
}
