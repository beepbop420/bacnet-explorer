/* NABE - the pointer engine. One canvas over the window, springs with mass and
   speed, and four builders the styles in nabe-pekere.js are made from: a stream
   of particles, a trace behind the arrow, something that follows, and a rope.
   The arrow stays the system's own cursor unless a style draws its own, so it
   never lags a frame behind the hand. No style marks what can be pressed: the
   pointer plays, the interface stays the interface. Nothing runs while the
   mouse is still. */
'use strict';

const pekerValgt = () => {
  const p = loadPrefs();
  return (p.garderobe && p.garderobe.peker) || (p.pekerAv ? 'vanlig' : 'trend');
};

const PK = (function motor() {
  const TEKST = 'input,textarea,select,[contenteditable],.splitter';
  const lerret = document.createElement('canvas');
  lerret.id = 'pekerLerret';
  const fig = document.createElement('div');
  fig.id = 'pekerFig';
  fig.hidden = true;
  document.body.append(lerret, fig);
  const c = lerret.getContext('2d');
  const farge = {fg: '#ececee', accent: '#6aa7ff', warn: '#ffc900', err: '#ff5a4d', bg: '#111113'};
  const flate = {B: 0, H: 0};
  function mal() {
    const d = window.devicePixelRatio || 1;
    flate.B = innerWidth; flate.H = innerHeight;
    lerret.width = flate.B * d; lerret.height = flate.H * d;
    c.setTransform(d, 0, 0, d, 0, 0);
  }
  function lesFarger() {
    const s = getComputedStyle(document.documentElement);
    for (const k of Object.keys(farge)) farge[k] = s.getPropertyValue('--' + k).trim() || farge[k];
  }

  // d is how far the mouse went this frame: streams are spent by distance, so
  // they end when the hand stops.
  const ro = {hold: false};
  const mus = {x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, d: 0, inne: false, sist: 0, tekst: false};
  const fjaer = (s, maal, k, d, dt) => { s.v += (k * (maal - s.x) - d * s.v) * dt; s.x += s.v * dt; };
  const f = (x) => ({x, v: 0});
  const klem = (v, a, b) => Math.max(a, Math.min(b, v));
  const fart = () => Math.hypot(mus.vx, mus.vy);
  const tilf = (a, b) => a + Math.random() * (b - a);

  /* A stream: o.per px per particle, o.lag() makes one, o.tegn(p, u) draws it
     with u going from 1 to 0. o.g pulls down, o.luft slows it. */
  function strom(o) {
    const G = [];
    let igjen = 0;
    const ny = (x, y, lag) => { const p = Object.assign({x, y, vx: 0, vy: 0, liv: 1}, lag(x, y)); p.maks = p.liv; G.push(p); };
    return {
      ping: o.ping,
      start() { G.length = 0; igjen = 0; },
      steg(dt) {
        if (o.per) {
          igjen += mus.d / o.per;
          while (igjen >= 1) {
            igjen -= 1;
            const u = Math.random();
            if (G.length < 420) ny(mus.x - (mus.x - mus.px) * u, mus.y - (mus.y - mus.py) * u, o.lag);
          }
        }
        const luft = o.luft === undefined ? .985 : o.luft;
        for (let i = G.length - 1; i >= 0; i--) {
          const p = G[i];
          p.liv -= dt;
          if (p.liv <= 0) { G.splice(i, 1); continue; }
          p.vy += (o.g || 0) * dt; p.vx *= luft; p.vy *= luft;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (o.opp) o.opp(p, dt);
        }
      },
      tegn() {
        c.save();
        if (o.lys) c.globalCompositeOperation = 'lighter';
        for (const p of G) o.tegn(p, p.liv / p.maks);
        c.restore();
      },
      klikk(x, y) { if (o.klikk) for (let i = 0; i < o.klikk; i++) ny(x, y, o.smell || o.lag); },
      rolig: () => !G.length,
    };
  }

  /* A trace: the last o.ms of the path, drawn by o.tegn(L, t). */
  function spor(o) {
    const L = [];
    return {
      ping: o.ping,
      start() { L.length = 0; },
      steg(dt, t) {
        if (mus.d > .2) L.push(Object.assign({x: mus.x, y: mus.y, t, v: fart()}, o.lag && o.lag()));
        while (L.length && t - L[0].t > o.ms) L.shift();
      },
      tegn() { if (L.length > 1) { c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; o.tegn(L, performance.now()); c.restore(); } },
      klikk() {},
      rolig: () => !L.length,
    };
  }

  /* Something that follows on a spring. o.tegn(x, y, s) with s the state:
     s.x, s.y are the springs, s.vinkel the heading, s.vei the distance rolled. */
  function folger(o) {
    const s = {x: f(0), y: f(0), vinkel: 0, vei: 0, rot: f(0), spinn: 0};
    const k = o.k || 130, d = o.d || 13, ox = o.ox === undefined ? 20 : o.ox, oy = o.oy === undefined ? 22 : o.oy;
    return {
      ping: o.ping,
      start() { s.x.x = s.mx = mus.x + ox; s.y.x = s.my = mus.y + oy; s.x.v = s.y.v = 0; if (o.start) o.start(s); },
      stopp() { if (o.stopp) o.stopp(s); },
      steg(dt) {
        // Ask NABE stands still while his speech bubble is out.
        if (!(o.snor && ro.hold)) { s.mx = mus.x + ox; s.my = mus.y + oy; }
        fjaer(s.x, s.mx, k, d, dt); fjaer(s.y, s.my, k, d, dt);
        const v = Math.hypot(s.x.v, s.y.v);
        if (v > 40) s.vinkel = Math.atan2(s.y.v, s.x.v);
        s.vei += v * dt;
        fjaer(s.rot, klem(s.x.v * .0009, -.6, .6), 170, 11, dt);
        s.spinn += (Math.min(fart(), 2400) * .012 - s.spinn) * Math.min(1, dt * 3);
        if (o.steg) o.steg(s, dt);
      },
      tegn() { c.save(); c.translate(s.x.x, s.y.x); o.tegn(s); c.restore(); },
      klikk() { s.y.v -= 340; if (o.klikk) o.klikk(s); },
      rolig: () => Math.abs(s.x.v) + Math.abs(s.y.v) + Math.abs(s.rot.v) < 3 && s.spinn < .05,
    };
  }

  /* A rope of points with weight, hung from the arrow. o.g negative floats. */
  function tau(o) {
    const P = [], n = o.ledd, l = o.lengde, g = o.g === undefined ? 1500 : o.g;
    let uro = 0;
    return {
      ping: o.ping, egenPil: o.egenPil,
      start() {
        P.length = 0;
        for (let i = 0; i < n; i++) { const y = mus.y + Math.sign(g) * i * l; P.push({x: mus.x, y, px: mus.x, py: y}); }
      },
      steg(dt) {
        uro = 0;
        for (let i = 1; i < n; i++) {
          const p = P[i], vx = (p.x - p.px) * .985, vy = (p.y - p.py) * .985;
          p.px = p.x; p.py = p.y;
          p.x += vx; p.y += vy + g * dt * dt;
          uro += Math.abs(vx) + Math.abs(vy);
        }
        P[0].x = mus.x + 1; P[0].y = mus.y + 1;
        for (let m = 0; m < 6; m++) {
          for (let i = 1; i < n; i++) {
            const a = P[i - 1], b = P[i], dx = b.x - a.x, dy = b.y - a.y, h = Math.hypot(dx, dy) || 1, e = (h - l) / h;
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
        for (let i = 1; i < n - 1; i++) c.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
        c.lineTo(P[n - 1].x, P[n - 1].y);
        o.linje();
        const e = P[n - 1], h = P[n - 2];
        c.translate(e.x, e.y);
        c.rotate(Math.atan2(e.y - h.y, e.x - h.x) - Math.PI / 2);
        o.ende();
        c.restore();
        if (o.over) o.over();
      },
      klikk() { for (let i = 1; i < n; i++) P[i].py += i * .9; },
      // A hanging rope keeps trembling by a hair; it can rest all the same.
      rolig: (t) => uro < .25 || t - mus.sist > 3000,
    };
  }

  /* A click goes out like a Who-Is, for the styles that want it. */
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
  const STIL = {vanlig: {steg() {}, tegn() {}, klikk() {}, rolig: () => true}};
  let stil = STIL.vanlig, id = 'vanlig', gaar = false, sist = 0;
  function ramme(t) {
    try {
      const dt = klem((t - sist) / 1000, .004, .033);
      sist = t;
      mus.d = Math.hypot(mus.x - mus.px, mus.y - mus.py);
      mus.vx += ((mus.x - mus.px) / dt - mus.vx) * .4;
      mus.vy += ((mus.y - mus.py) / dt - mus.vy) * .4;
      stil.steg(dt, t);
      mus.px = mus.x; mus.py = mus.y;
      c.clearRect(0, 0, flate.B, flate.H);
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

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || id === 'vanlig') return;
    mus.x = e.clientX; mus.y = e.clientY; mus.sist = performance.now();
    mus.tekst = !!(e.target.closest && e.target.closest(TEKST));
    if (!mus.inne) {
      mus.inne = true; mus.px = mus.x; mus.py = mus.y; mus.vx = mus.vy = 0;
      if (stil.start) stil.start();
    }
    vekk();
  }, {passive: true});
  document.documentElement.addEventListener('mouseleave', () => { mus.inne = false; vekk(); });
  window.addEventListener('resize', mal);
  etter('applyTheme', () => setTimeout(lesFarger, 60));
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || id === 'vanlig') return;
    stil.klikk(e.clientX, e.clientY);
    if (stil.ping) pinger.push({x: e.clientX, y: e.clientY, t: 0});
    vekk();
  }, {passive: true});

  function bruk(ny) {
    if (stil.stopp) stil.stopp();
    id = bevegelseAv() ? 'vanlig' : (STIL[ny] ? ny : 'vanlig');
    stil = STIL[id];
    mus.inne = false;
    document.documentElement.classList.toggle('peker-paa', id !== 'vanlig');
    document.documentElement.classList.toggle('peker-egen', !!stil.egenPil);
    c.clearRect(0, 0, flate.B, flate.H);
    const s = $('pekerState'), p = typeof PEKERE !== 'undefined' && PEKERE.find(x => x.id === pekerValgt());
    if (s && p) s.textContent = T(p.navn[0], p.navn[1]);
  }
  mal(); lesFarger();
  etter('brukBevegelse', () => bruk(pekerValgt()));
  $('pekerBtn').onclick = () => { $('temaOverlay').hidden = true; aapneGarderobe('peker'); };
  return {c, mus, farge, flate, fig, ro, fjaer, f, klem, fart, tilf, strom, spor, folger, tau, STIL, bruk, tilstand: () => ({id, gaar})};
})();
