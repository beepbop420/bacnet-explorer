/* NABE - the pointer catalog: forty-six of them, made from the builders in
   nabe-peker.js. Shown in the Peker tab of the wardrobe, and earned like the
   items: a click on an open card picks it, a locked one stays locked. */
'use strict';

// In a function of its own: the short names here would collide with the app's.
const {PEKERE, pekerKatalog} = (function katalog() {
const {c: PC, mus: PM, farge: PF, flate: PFL, fig: PFIG, fjaer: PJ, f: Pf, klem: PKL, fart: PV, tilf: PT} = PK;
const PILSTI = new Path2D('M0 0l5.6 17.2c.3 1 1.7 1 2.1.1l2.6-6.1 6.2-2.4c1-.4 1-1.7 0-2.1z');

/* ---- lines */
const stilLinje = (ms, farge, bredde) => PK.spor({ms, tegn(L) {
  PC.strokeStyle = farge();
  for (let i = 1; i < L.length; i++) {
    const u = i / L.length;
    PC.globalAlpha = u * .85;
    PC.lineWidth = .6 + u * bredde;
    PC.beginPath(); PC.moveTo(L[i - 1].x, L[i - 1].y); PC.lineTo(L[i].x, L[i].y); PC.stroke();
  }
}});
const sti = (L) => { PC.beginPath(); PC.moveTo(L[0].x, L[0].y); for (let i = 1; i < L.length; i++) PC.lineTo(L[i].x, L[i].y); };

const lyn = (() => {
  const s = PK.folger({k: 60, d: 11, ox: 0, oy: 0, tegn(q) {
    if (PV() < 160) return;
    const dx = PM.x - q.x.x, dy = PM.y - q.y.x, l = Math.hypot(dx, dy);
    if (l < 12) return;
    PC.strokeStyle = '#cfe0ff'; PC.shadowColor = PF.accent; PC.shadowBlur = 10;
    for (let n = 0; n < 2; n++) {
      PC.lineWidth = n ? .8 : 1.6;
      PC.beginPath(); PC.moveTo(0, 0);
      const trinn = Math.max(4, Math.floor(l / 16));
      for (let i = 1; i < trinn; i++) PC.lineTo(dx * i / trinn + PT(-9, 9), dy * i / trinn + PT(-9, 9));
      PC.lineTo(dx, dy); PC.stroke();
    }
  }});
  return s;
})();

const kjede = (ledd, k, tegn) => {
  const P = [];
  return {
    start() { P.length = 0; for (let i = 0; i < ledd; i++) P.push({x: Pf(PM.x), y: Pf(PM.y)}); },
    steg(dt) { P.forEach((p, i) => { const m = i ? P[i - 1] : {x: {x: PM.x}, y: {x: PM.y}}; PJ(p.x, m.x.x, k, 15, dt); PJ(p.y, m.y.x, k, 15, dt); }); },
    tegn() { for (let i = P.length - 1; i >= 0; i--) { PC.save(); tegn(P[i].x.x, P[i].y.x, i, ledd); PC.restore(); } },
    klikk() { P.forEach((p, i) => { p.y.v -= 200 - i * 8; }); },
    rolig: () => P.every(p => Math.abs(p.x.v) + Math.abs(p.y.v) < 2),
  };
};

const maal = (() => {
  let a = null;
  return {
    start() {}, steg() {}, klikk(x, y) { a = {x, y}; }, rolig: () => true,
    tegn() {
      if (!a) return;
      const dx = PM.x - a.x, dy = PM.y - a.y, l = Math.hypot(dx, dy);
      if (l < 6) return;
      PC.save();
      PC.translate(a.x, a.y); PC.rotate(Math.atan2(dy, dx));
      PC.fillStyle = PF.warn; PC.fillRect(0, -6, l, 12);
      PC.fillStyle = '#16161a';
      for (let i = 0, n = 0; i < l; i += 10, n++) PC.fillRect(i, -6, 1, n % 10 ? (n % 5 ? 3 : 5) : 8);
      PC.restore();
      PC.save();
      PC.font = '600 11px Lexend,sans-serif';
      const tekst = `${Math.round(l)} px`, b = PC.measureText(tekst).width + 10;
      PC.fillStyle = '#16161a'; PC.beginPath(); PC.roundRect(PM.x + 14, PM.y + 12, b, 18, 3); PC.fill();
      PC.fillStyle = '#fff'; PC.fillText(tekst, PM.x + 19, PM.y + 25);
      PC.restore();
    },
  };
})();

const ror = (() => {
  const R = [];
  const CELLE = 22;
  return {
    start() { R.length = 0; },
    steg(dt, t) {
      const x = Math.round(PM.x / CELLE) * CELLE, y = Math.round(PM.y / CELLE) * CELLE, s = R[R.length - 1];
      if (!s || s.x !== x || s.y !== y) {
        if (s && s.x !== x && s.y !== y) R.push({x, y: s.y, t});
        R.push({x, y, t});
      }
      while (R.length && t - R[0].t > 1500) R.shift();
    },
    tegn() {
      if (R.length < 2) return;
      PC.save(); PC.lineJoin = 'round';
      for (const [dy, f] of [[-2.5, '#d8401f'], [2.5, '#2e7bd6']]) {
        PC.strokeStyle = f; PC.lineWidth = 3;
        for (let i = 1; i < R.length; i++) {
          PC.globalAlpha = i / R.length;
          PC.beginPath(); PC.moveTo(R[i - 1].x + dy, R[i - 1].y + dy); PC.lineTo(R[i].x + dy, R[i].y + dy); PC.stroke();
        }
      }
      PC.restore();
    },
    klikk() {}, rolig: () => !R.length,
  };
})();

/* ---- what the wind takes */
const blad = (x, y) => { PC.save(); PC.translate(x, y); };
const TEGN = {
  prikk: (f, r) => (p, u) => { PC.globalAlpha = u; PC.fillStyle = f(); PC.beginPath(); PC.arc(p.x, p.y, r(p, u), 0, 7); PC.fill(); },
  tekst: (font) => (p, u) => { PC.globalAlpha = Math.min(1, u * 1.5); PC.fillStyle = p.f || PF.fg; PC.font = font; PC.fillText(p.t, p.x, p.y); },
};
const flakk = (p, dt) => { p.a = (p.a || 0) + dt * 2; p.x += Math.sin(p.a + p.s) * .6; };

const tall = () => `${(PT(16, 24)).toFixed(1)} °C`;
const VERDIER = [tall, () => `${Math.round(PT(0, 100))} %`, () => `${Math.round(PT(400, 1100))} ppm`, () => `${(PT(.2, 4)).toFixed(1)} m³/s`, () => (Math.random() < .5 ? 'active' : 'inactive')];
const HEX = ['81', '0A', '0C', '10', '08', '00', 'C4', '1E', '3F', '55', 'FF', '2B'];

const gnist = (p, u) => {
  PC.lineCap = 'round'; PC.globalAlpha = Math.min(1, u * 1.6);
  PC.strokeStyle = u > .55 ? '#fff' : PF.warn; PC.lineWidth = 1 + u;
  PC.beginPath(); PC.moveTo(p.x, p.y); PC.lineTo(p.x - p.vx * .022, p.y - p.vy * .022); PC.stroke();
};
const smell = (min, max, opp = 120, l = [.25, .65]) => () => {
  const a = PT(0, 7), v = PT(min, max);
  return {vx: Math.cos(a) * v, vy: Math.sin(a) * v - opp, liv: PT(l[0], l[1])};
};
const KONFETTI = ['#282071', '#fbc30a', '#ececee', '#6aa7ff'];

const flamme = (p, u) => {
  PC.globalAlpha = u * .7;
  PC.fillStyle = u > .6 ? '#ffe9a8' : u > .3 ? '#ff9a2e' : '#d8401f';
  PC.beginPath(); PC.arc(p.x, p.y, 1.5 + u * 5, 0, 7); PC.fill();
};

/* ---- company */
const bror = (hvem, snor) => PK.folger({k: 130, d: 13, ox: 18, oy: 22, snor,
  start() {
    PFIG.classList.toggle('klikkbar', !!snor);
    if (snor) PFIG.title = T('Spør NABE', 'Ask NABE'); else PFIG.removeAttribute('title');
    PFIG.innerHTML = typeof forhaand === 'function' ? forhaand(hvem) : '';
    const s = PFIG.querySelector('svg');
    if (s) { s.classList.add('gard-forhånd'); if (typeof kle === 'function') kle(s, hvem, Object.assign({}, gardPrefs()[hvem])); }
    PFIG.hidden = false;
  },
  stopp() { PFIG.hidden = true; PFIG.innerHTML = ''; },
  tegn(s) { PFIG.style.transform = `translate(${s.x.x}px,${s.y.x}px) rotate(${s.rot.x * 46}deg)`; },
});

const hjul = (tenner, r, farge) => (s) => {
  PC.rotate(s.vei / r);
  PC.fillStyle = farge(); PC.beginPath();
  for (let i = 0; i < tenner * 2; i++) { const a = i * Math.PI / tenner, q = i % 2 ? r : r + 4; PC.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
  PC.closePath(); PC.fill();
  PC.globalCompositeOperation = 'destination-out'; PC.beginPath(); PC.arc(0, 0, r * .4, 0, 7); PC.fill();
};

const bladSpinn = {v: 0};
const vifte = PK.folger({k: 120, d: 13, ox: 24, oy: 24, steg(s, dt) { bladSpinn.v += s.spinn * dt * 5; }, tegn() {
  PC.strokeStyle = PF.fg; PC.globalAlpha = .75; PC.lineWidth = 1.5; PC.beginPath(); PC.arc(0, 0, 15, 0, 7); PC.stroke();
  PC.globalAlpha = .9; PC.rotate(bladSpinn.v); PC.fillStyle = PF.fg;
  for (let i = 0; i < 3; i++) { PC.rotate(Math.PI * 2 / 3); PC.beginPath(); PC.ellipse(0, -7, 3.6, 7, .4, 0, 7); PC.fill(); }
}});

const maaler = (() => {
  const n = Pf(0);
  return PK.folger({k: 150, d: 15, ox: 26, oy: 30, steg(s, dt) { PJ(n, PKL(PV() / 3000, 0, 1), 140, 9, dt); }, tegn() {
    PC.fillStyle = PF.bg; PC.strokeStyle = PF.fg; PC.lineWidth = 1.2;
    PC.beginPath(); PC.arc(0, 0, 21, Math.PI, 0); PC.closePath(); PC.fill(); PC.stroke();
    PC.strokeStyle = PF.err; PC.lineWidth = 2.4; PC.beginPath(); PC.arc(0, 0, 17, -.7, 0); PC.stroke();
    PC.save(); PC.rotate(-Math.PI / 2 + (PKL(n.x, -.05, 1.1) - .5) * Math.PI);
    PC.strokeStyle = PF.warn; PC.lineWidth = 1.8; PC.beginPath(); PC.moveTo(0, 0); PC.lineTo(0, -17); PC.stroke(); PC.restore();
    PC.fillStyle = PF.fg; PC.font = '9px Lexend,sans-serif'; PC.textAlign = 'center';
    PC.fillText(`${(PV() / 1000).toFixed(1)} m/s`, 0, 11);
  }});
})();

const flua = (() => {
  const s = {x: Pf(0), y: Pf(0), a: 0};
  return {
    start() { s.x.x = PM.x + 30; s.y.x = PM.y; },
    steg(dt, t) {
      const flyr = t - PM.sist < 500;
      s.a += dt * 13;
      PJ(s.x, PM.x + (flyr ? Math.cos(s.a) * 34 + PT(-16, 16) : 14), 70, 8, dt);
      PJ(s.y, PM.y + (flyr ? Math.sin(s.a * 1.7) * 26 + PT(-16, 16) : 18), 70, 8, dt);
    },
    tegn() {
      PC.save(); PC.translate(s.x.x, s.y.x); PC.rotate(Math.atan2(s.y.v, s.x.v));
      PC.fillStyle = PF.fg; PC.globalAlpha = .35;
      for (const k of [-1, 1]) { PC.beginPath(); PC.ellipse(-1, k * 3.2, 4, 1.8, k * .5 + Math.sin(s.a * 5) * .3, 0, 7); PC.fill(); }
      PC.globalAlpha = 1; PC.beginPath(); PC.ellipse(0, 0, 3.6, 2, 0, 0, 7); PC.fill();
      PC.restore();
    },
    klikk() { s.x.v += PT(-500, 500); s.y.v -= 500; },
    rolig: () => Math.abs(s.x.v) + Math.abs(s.y.v) < 3,
  };
})();

const lommelykt = {
  start() {}, steg() {}, klikk() {}, rolig: () => true,
  tegn() {
    const g = PC.createRadialGradient(PM.x, PM.y, 60, PM.x, PM.y, 190);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)');
    PC.fillStyle = g; PC.fillRect(0, 0, PFL.B, PFL.H);
  },
};

const radar = (() => {
  const S = [];
  return {
    start() { S.length = 0; }, klikk(x, y) { S.push({x, y, t: 0}); },
    steg(dt) { for (let i = S.length - 1; i >= 0; i--) { S[i].t += dt / 1.1; if (S[i].t >= 1) S.splice(i, 1); } },
    tegn() {
      for (const s of S) {
        PC.save(); PC.translate(s.x, s.y); PC.strokeStyle = '#5dff9a'; PC.fillStyle = '#5dff9a';
        PC.globalAlpha = .5 * (1 - s.t);
        for (const r of [28, 56, 84]) { PC.lineWidth = 1; PC.beginPath(); PC.arc(0, 0, r, 0, 7); PC.stroke(); }
        const a = s.t * Math.PI * 2 - Math.PI / 2;
        PC.globalAlpha = .28 * (1 - s.t);
        PC.beginPath(); PC.moveTo(0, 0); PC.arc(0, 0, 84, a - .7, a); PC.closePath(); PC.fill();
        PC.restore();
      }
    },
    rolig: () => !S.length,
  };
})();

/* ---- instead of the arrow */
const SK = {tilt: Pf(-.62), vri: Pf(0)};
const skrutrekker = {
  egenPil: true, start() {},
  steg(dt) { PJ(SK.tilt, -.62 + PKL(PM.vx * .00032, -.6, .6), 240, 13, dt); PJ(SK.vri, 0, 420, 14, dt); },
  tegn() {
    if (PM.tekst) return;
    PC.save(); PC.translate(PM.x, PM.y); PC.rotate(SK.tilt.x);
    const v = 1 - Math.abs(Math.sin(SK.vri.x)) * .35;
    PC.strokeStyle = 'rgba(0,0,0,.6)'; PC.lineWidth = 1; PC.fillStyle = '#cfd0d6';
    PC.beginPath(); PC.moveTo(-1.1, 0); PC.lineTo(1.1, 0); PC.lineTo(1.8, 3); PC.lineTo(1.8, 21); PC.lineTo(-1.8, 21); PC.lineTo(-1.8, 3); PC.closePath(); PC.fill(); PC.stroke();
    PC.fillStyle = PF.warn; PC.beginPath(); PC.roundRect(-5.5 * v, 20, 11 * v, 18, 3.5); PC.fill(); PC.stroke();
    PC.strokeStyle = 'rgba(0,0,0,.35)';
    for (const x of [-2.2, 0, 2.2]) { PC.beginPath(); PC.moveTo(x * v, 24); PC.lineTo(x * v, 35); PC.stroke(); }
    PC.restore();
  },
  klikk() { SK.vri.v += 26; SK.tilt.v += 5; },
  rolig: () => Math.abs(SK.tilt.v) + Math.abs(SK.vri.v) < .05,
};

const blyant = (() => {
  const b = PK.spor({ms: 1600, tegn(L) { PC.strokeStyle = PF.fg; PC.lineWidth = 1.3; for (let i = 1; i < L.length; i++) { PC.globalAlpha = .7 * i / L.length; PC.beginPath(); PC.moveTo(L[i - 1].x, L[i - 1].y); PC.lineTo(L[i].x, L[i].y); PC.stroke(); } }});
  const v = Pf(-.6);
  return Object.assign({}, b, {
    egenPil: true,
    steg(dt, t) { b.steg(dt, t); PJ(v, -.6 + PKL(PM.vx * .0003, -.5, .5), 200, 12, dt); },
    tegn() {
      b.tegn();
      if (PM.tekst) return;
      PC.save(); PC.translate(PM.x, PM.y); PC.rotate(v.x);
      PC.strokeStyle = 'rgba(0,0,0,.55)'; PC.lineWidth = 1;
      PC.fillStyle = '#e6c9a0'; PC.beginPath(); PC.moveTo(0, 0); PC.lineTo(3.4, 8); PC.lineTo(-3.4, 8); PC.closePath(); PC.fill(); PC.stroke();
      PC.fillStyle = '#39393f'; PC.beginPath(); PC.moveTo(0, 0); PC.lineTo(1.2, 3); PC.lineTo(-1.2, 3); PC.closePath(); PC.fill();
      PC.fillStyle = PF.warn; PC.fillRect(-3.4, 8, 6.8, 22); PC.strokeRect(-3.4, 8, 6.8, 22);
      PC.fillStyle = '#d86a6a'; PC.fillRect(-3.4, 30, 6.8, 5); PC.strokeRect(-3.4, 30, 6.8, 5);
      PC.restore();
    },
  });
})();

Object.assign(PK.STIL, {
  ring: PK.folger({k: 760, d: 27, ox: 0, oy: 0, ping: true, tegn(s) {
    const st = PKL(Math.hypot(s.x.v, s.y.v) / 2600, 0, .6);
    PC.rotate(s.vinkel); PC.scale(1 + st, 1 - st * .55);
    PC.strokeStyle = PF.fg; PC.globalAlpha = .5; PC.lineWidth = 1.5;
    PC.beginPath(); PC.arc(0, 0, 11, 0, 7); PC.stroke();
  }}),
  trend: stilLinje(340, () => PF.accent, 3.2),
  kritt: PK.spor({ms: 900, lag: () => ({j: [PT(-2, 2), PT(-2, 2), PT(-2, 2), PT(-2, 2)]}), tegn(L) {
    PC.strokeStyle = PF.fg; PC.lineWidth = 1.2;
    for (let i = 1; i < L.length; i++) {
      const p = L[i], q = L[i - 1];
      PC.globalAlpha = .75 * i / L.length;
      for (let n = 0; n < 4; n += 2) { PC.beginPath(); PC.moveTo(q.x + p.j[n], q.y + p.j[n + 1]); PC.lineTo(p.x + p.j[n + 1], p.y + p.j[n]); PC.stroke(); }
    }
  }}),
  blekk: PK.spor({ms: 1200, tegn(L) {
    PC.strokeStyle = PF.fg;
    for (let i = 1; i < L.length; i++) {
      PC.globalAlpha = i / L.length;
      PC.lineWidth = PKL(7 - L[i].v / 420, 1, 7);
      PC.beginPath(); PC.moveTo(L[i - 1].x, L[i - 1].y); PC.lineTo(L[i].x, L[i].y); PC.stroke();
    }
  }}),
  oscilloskop: PK.spor({ms: 800, tegn(L, t) {
    PC.globalCompositeOperation = 'lighter'; PC.strokeStyle = '#5dff9a'; PC.shadowColor = '#5dff9a'; PC.shadowBlur = 8; PC.lineWidth = 1.4;
    for (let i = 2; i < L.length; i++) {
      const b = (p, n) => Math.sin(n * .9 + p.t * .01) * 7;
      PC.globalAlpha = i / L.length;
      PC.beginPath(); PC.moveTo(L[i - 1].x, L[i - 1].y + b(L[i - 1], i - 1)); PC.lineTo(L[i].x, L[i].y + b(L[i], i)); PC.stroke();
    }
  }}),
  sperreteip: PK.spor({ms: 520, tegn(L) {
    PC.lineCap = 'butt'; sti(L);
    PC.strokeStyle = PF.warn; PC.lineWidth = 9; PC.stroke();
    PC.setLineDash([9, 9]); PC.strokeStyle = '#16161a'; PC.stroke();
  }}),
  ror,
  buss: PK.spor({ms: 1000, tegn(L, t) {
    sti(L); PC.setLineDash([2, 5]); PC.strokeStyle = PF.fg; PC.globalAlpha = .55; PC.lineWidth = 1.5; PC.stroke();
    PC.setLineDash([]); PC.globalAlpha = 1; PC.fillStyle = PF.accent;
    for (let i = Math.floor(t / 40) % 7; i < L.length; i += 7) PC.fillRect(L[i].x - 3, L[i].y - 3, 6, 6);
  }}),
  lyn,
  larve: kjede(11, 340, (x, y, i, n) => { PC.globalAlpha = 1 - i / n * .5; PC.fillStyle = i ? PF.accent : PF.fg; PC.beginPath(); PC.arc(x, y + 14, 6.5 - i * .35, 0, 7); PC.fill(); }),
  ekko: kjede(6, 240, (x, y, i, n) => { PC.globalAlpha = .34 * (1 - i / n); PC.translate(x, y); PC.fillStyle = PF.fg; PC.fill(PILSTI); }),
  maalebaand: maal,
  sno: PK.strom({per: 26, g: 26, luft: 1, lag: () => ({vx: PT(-14, 14), vy: PT(20, 50), liv: PT(1.1, 2), s: PT(0, 6), r: PT(1, 2.6)}), opp: flakk,
    tegn: TEGN.prikk(() => '#f4f7ff', (p) => p.r)}),
  bobler: PK.strom({per: 34, g: -90, luft: .99, lag: () => ({vx: PT(-20, 20), vy: PT(-30, -10), liv: PT(.7, 1.4), s: PT(0, 6), r: PT(2.5, 7)}), opp: flakk,
    tegn(p, u) { PC.globalAlpha = Math.min(1, u * 2) * .7; PC.strokeStyle = PF.accent; PC.lineWidth = 1; PC.beginPath(); PC.arc(p.x, p.y, p.r, 0, 7); PC.stroke(); }}),
  damp: PK.strom({per: 16, g: -70, luft: .97, lag: () => ({vx: PT(-16, 16), vy: PT(-30, -6), liv: PT(.5, 1), r: PT(4, 9)}),
    tegn(p, u) { PC.globalAlpha = u * .16; PC.fillStyle = PF.fg; PC.beginPath(); PC.arc(p.x, p.y, p.r + (1 - u) * 16, 0, 7); PC.fill(); }}),
  lov: PK.strom({per: 46, g: 60, luft: .98, lag: () => ({vx: PT(-30, 30), vy: PT(0, 30), liv: PT(1.1, 2), s: PT(0, 6), r: PT(0, 6), f: ['#d9822b', '#c9a227', '#b04a2a'][Math.floor(PT(0, 3))]}),
    opp(p, dt) { flakk(p, dt); p.r += dt * 3; },
    tegn(p, u) { blad(p.x, p.y); PC.rotate(p.r); PC.globalAlpha = Math.min(1, u * 2); PC.fillStyle = p.f; PC.beginPath(); PC.ellipse(0, 0, 5.5, 2.6, 0, 0, 7); PC.fill(); PC.restore(); }}),
  bits: PK.strom({per: 20, g: 130, lag: () => ({vy: PT(10, 40), liv: PT(.6, 1.1), t: Math.random() < .5 ? '0' : '1', f: '#5dff9a'}), tegn: TEGN.tekst('11px Cascadia Mono,Consolas,monospace')}),
  hex: PK.strom({per: 30, g: 40, lag: () => ({vx: PT(-40, 40), vy: PT(-50, 30), liv: PT(.7, 1.2), t: HEX[Math.floor(PT(0, HEX.length))]}), tegn: TEGN.tekst('10px Cascadia Mono,Consolas,monospace')}),
  verdier: PK.strom({per: 90, g: -20, lag: () => ({vx: PT(-14, 14), vy: PT(-34, -12), liv: PT(.9, 1.5), t: VERDIER[Math.floor(PT(0, VERDIER.length))](), f: PF.accent}), tegn: TEGN.tekst('500 11px Lexend,sans-serif')}),
  lekkasje: PK.strom({per: 30, g: 900, luft: 1, klikk: 8, lag: () => ({vy: PT(10, 60), vx: PT(-8, 8), liv: 1.3}), smell: smell(60, 180, 160, [.4, .8]),
    tegn(p, u) { PC.globalAlpha = .85; PC.fillStyle = PF.accent; PC.beginPath(); PC.ellipse(p.x, p.y, 1.8, 3.2, 0, 0, 7); PC.fill(); }}),
  stjerner: PK.strom({per: 28, g: 18, lys: true, lag: () => ({vx: PT(-20, 20), vy: PT(-20, 20), liv: PT(.5, 1.1), r: PT(1.5, 4)}),
    tegn(p, u) { PC.globalAlpha = u; PC.strokeStyle = '#fff3c4'; PC.lineWidth = 1; const r = p.r * (.6 + u); PC.beginPath(); PC.moveTo(p.x - r, p.y); PC.lineTo(p.x + r, p.y); PC.moveTo(p.x, p.y - r); PC.lineTo(p.x, p.y + r); PC.stroke(); }}),
  nordlys: PK.strom({per: 9, g: 0, luft: 1, lys: true, lag: () => ({vy: PT(-14, -4), liv: PT(.7, 1.3), h: PT(50, 110)}),
    tegn(p, u) {
      const g = PC.createLinearGradient(0, p.y - p.h, 0, p.y);
      g.addColorStop(0, 'rgba(120,90,255,0)'); g.addColorStop(.6, 'rgba(80,255,170,.5)'); g.addColorStop(1, 'rgba(80,255,170,0)');
      PC.globalAlpha = u * .3; PC.fillStyle = g; PC.fillRect(p.x - 3, p.y - p.h, 6, p.h);
    }}),
  gnister: PK.strom({g: 900, klikk: 18, lag: smell(160, 580), tegn: gnist}),
  sveis: PK.strom({per: 9, g: 800, klikk: 22, lag: smell(60, 300, 60, [.15, .4]), smell: smell(200, 640), tegn: gnist}),
  konfetti: PK.strom({g: 520, luft: .975, klikk: 26, lag: () => { const a = PT(-2.6, -.5), v = PT(180, 520); return {vx: Math.cos(a) * v, vy: Math.sin(a) * v, liv: PT(.8, 1.4), s: PT(0, 6), r: PT(0, 6), f: KONFETTI[Math.floor(PT(0, 4))]}; },
    opp(p, dt) { p.r += dt * 9; }, tegn(p, u) { blad(p.x, p.y); PC.rotate(p.r); PC.globalAlpha = Math.min(1, u * 2); PC.fillStyle = p.f; PC.fillRect(-3, -1.6, 6, 3.2); PC.restore(); }}),
  jet: PK.strom({per: 5, g: -160, lys: true, lag: () => ({vx: -PM.vx * .12 + PT(-30, 30), vy: -PM.vy * .12 + PT(-30, 30), liv: PT(.18, .42)}), tegn: flamme}),
  krusning: PK.strom({per: 70, luft: 1, klikk: 3, lag: () => ({liv: 1, r: 0}), opp(p, dt) { p.r += dt * 70; },
    tegn(p, u) { PC.globalAlpha = u * .45; PC.strokeStyle = PF.accent; PC.lineWidth = 1.2; PC.beginPath(); PC.ellipse(p.x, p.y, p.r, p.r * .45, 0, 0, 7); PC.stroke(); }}),
  radar,
  drone: PK.folger({k: 60, d: 7, ox: 34, oy: -26, tegn(s) {
    PC.rotate(s.rot.x); PC.strokeStyle = PF.fg; PC.fillStyle = PF.fg; PC.lineWidth = 2;
    PC.beginPath(); PC.moveTo(-15, 0); PC.lineTo(15, 0); PC.stroke();
    PC.beginPath(); PC.roundRect(-6, -3, 12, 7, 2); PC.fill();
    for (const x of [-15, 15]) { PC.globalAlpha = .55; PC.beginPath(); PC.ellipse(x, -3, 8 * Math.abs(Math.cos(s.vei * .3)) + 2, 1.2, 0, 0, 7); PC.fill(); PC.globalAlpha = 1; }
    PC.fillStyle = PF.err; PC.beginPath(); PC.arc(0, 4, 1.4, 0, 7); PC.fill();
  }}),
  flua,
  ballong: PK.tau({ledd: 11, lengde: 8, g: -420, linje() { PC.strokeStyle = PF.fg; PC.globalAlpha = .6; PC.lineWidth = 1; PC.stroke(); PC.globalAlpha = 1; },
    ende() { PC.fillStyle = PF.err; PC.beginPath(); PC.ellipse(0, 13, 10, 13, 0, 0, 7); PC.fill(); PC.fillStyle = 'rgba(255,255,255,.35)'; PC.beginPath(); PC.ellipse(-3, 16, 2.4, 4, .3, 0, 7); PC.fill(); }}),
  lodd: PK.tau({ledd: 9, lengde: 9, g: 1800, linje() { PC.strokeStyle = PF.fg; PC.lineWidth = 1; PC.stroke(); },
    ende() { PC.fillStyle = '#c9a227'; PC.strokeStyle = 'rgba(0,0,0,.5)'; PC.beginPath(); PC.moveTo(-5, 0); PC.lineTo(5, 0); PC.lineTo(0, 15); PC.closePath(); PC.fill(); PC.stroke(); }}),
  kabel: PK.tau({ledd: 15, lengde: 9, linje() { PC.strokeStyle = 'rgba(0,0,0,.45)'; PC.lineWidth = 4.5; PC.stroke(); PC.strokeStyle = PF.accent; PC.lineWidth = 2.8; PC.stroke(); },
    ende() { PC.fillStyle = '#e8e8ea'; PC.strokeStyle = 'rgba(0,0,0,.5)'; PC.lineWidth = 1; PC.beginPath(); PC.roundRect(-5, -1, 10, 13, 1.5); PC.fill(); PC.stroke(); PC.fillStyle = '#c9a227'; for (let i = -3; i <= 3; i += 2) PC.fillRect(i - .4, 8, .9, 3.5); }}),
  kompass: PK.folger({k: 150, d: 15, ox: 24, oy: 26, tegn(s) {
    PC.fillStyle = PF.bg; PC.strokeStyle = PF.fg; PC.lineWidth = 1.2; PC.beginPath(); PC.arc(0, 0, 14, 0, 7); PC.fill(); PC.stroke();
    PC.rotate(s.vinkel + Math.PI / 2);
    PC.fillStyle = PF.err; PC.beginPath(); PC.moveTo(0, -11); PC.lineTo(3, 0); PC.lineTo(-3, 0); PC.closePath(); PC.fill();
    PC.fillStyle = PF.fg; PC.beginPath(); PC.moveTo(0, 11); PC.lineTo(3, 0); PC.lineTo(-3, 0); PC.closePath(); PC.fill();
  }}),
  tannhjul: PK.folger({k: 150, d: 15, ox: 24, oy: 24, tegn: hjul(9, 11, () => PF.fg)}),
  vifte,
  fartsmaaler: maaler,
  papirfly: PK.folger({k: 80, d: 10, ox: -24, oy: 20, tegn(s) {
    PC.rotate(s.vinkel); PC.fillStyle = PF.fg; PC.beginPath(); PC.moveTo(15, 0); PC.lineTo(-11, -8); PC.lineTo(-6, 0); PC.lineTo(-11, 8); PC.closePath(); PC.fill();
    PC.strokeStyle = PF.bg; PC.lineWidth = 1; PC.beginPath(); PC.moveTo(15, 0); PC.lineTo(-6, 0); PC.stroke();
  }}),
  'lille-nabe': bror('nabe'),
  'lille-nabo': bror('nabo'),
  'spor-nabe': bror('nabe', 170),
  lommelykt,
  skrutrekker,
  blyant,
  probe: PK.tau({ledd: 13, lengde: 10, egenPil: true, linje() { PC.strokeStyle = PF.err; PC.lineWidth = 2.2; PC.stroke(); },
    ende() { PC.fillStyle = '#16161a'; PC.beginPath(); PC.roundRect(-3, -2, 6, 8, 1.5); PC.fill(); },
    over() {
      if (PM.tekst) return;
      PC.save(); PC.translate(PM.x, PM.y); PC.rotate(-.5);
      PC.fillStyle = '#cfd0d6'; PC.fillRect(-.8, 0, 1.6, 9);
      PC.fillStyle = PF.err; PC.strokeStyle = 'rgba(0,0,0,.5)'; PC.beginPath(); PC.roundRect(-3.6, 9, 7.2, 22, 2.5); PC.fill(); PC.stroke();
      PC.restore();
    }}),
});

const PEKER_GRUPPER = [
  ['grunn', ['Enkle', 'Simple']], ['linje', ['Linjer', 'Lines']], ['sky', ['Partikler', 'Particles']],
  ['venn', ['Følgesvenner', 'Company']], ['klikk', ['Klikk', 'Clicks']], ['verktoy', ['Verktøy i hånda', 'Tools in hand']],
];
const P_ = (id, gruppe, nb, en, omNb, omEn, krav, ikon, ekstra) => Object.assign({id, gruppe, navn: [nb, en], om: [omNb, omEn], krav, ikon}, ekstra);
const K = (k, n, nb, en) => [k, n, [nb, en]];
const PEKERE = [
  P_('vanlig', 'grunn', 'Windows', 'Windows', 'Vanlig musepeker, ingen effekter', 'The plain pointer, no effects', null, '<path d="M10 6l5 17 3-6 6-3z"/>'),
  P_('trend', 'grunn', 'Trendlinja', 'The trend line', 'En linje som tynnes ut bak pila', 'A line that thins out behind the arrow', null, '<path d="M4 22c6 0 6-12 12-12s6 8 12 4"/>'),
  P_('ring', 'grunn', 'Ringen', 'The ring', 'En ring på fjær som henger etter', 'A ring on a spring that hangs back', null, '<circle cx="16" cy="16" r="9"/>'),
  P_('kritt', 'linje', 'Kritt', 'Chalk', 'Som på tavla i teknisk rom', 'Like the board in the plant room', null, '<path d="M5 22l8-8 4 3 10-9" stroke-dasharray="3 2"/>'),
  P_('blekk', 'linje', 'Blekk', 'Ink', 'Tykk når du går sakte, tynn i farta', 'Thick when slow, thin at speed', K('aapnet', 5, 'Åpne NABE 5 ganger', 'Open NABE 5 times'), '<path d="M5 24c8-16 14 4 22-14" stroke-width="3"/>'),
  P_('oscilloskop', 'linje', 'Oscilloskop', 'Oscilloscope', 'Grønn stråle som svinger', 'A green trace that oscillates', K('punkter', 500, 'Les 500 punkter', 'Read 500 points'), '<path d="M3 16c3-10 5-10 7 0s4 10 7 0 4-10 7 0 3 6 5 4"/>'),
  P_('sperreteip', 'linje', 'Sperreteip', 'Barrier tape', 'Gul og svart bak pila', 'Yellow and black behind the arrow', K('skriv', 3, 'Skriv 3 ganger', 'Write 3 times'), '<path d="M4 20l24-9" stroke-width="5" stroke-dasharray="4 4"/>'),
  P_('ror', 'linje', 'Tur og retur', 'Flow and return', 'Rør i rette vinkler, rødt og blått', 'Pipes at right angles, red and blue', K('skann', 3, '3 skann', '3 scans'), '<path d="M5 24V12h12v8h10M5 20V8h16v8h6"/>'),
  P_('buss', 'linje', 'MS/TP-buss', 'MS/TP bus', 'Pakker som går langs ledningen', 'Packets running along the wire', K('enheter', 25, 'Finn 25 enheter', 'Find 25 devices'), '<path d="M4 16h24" stroke-dasharray="2 3"/><rect x="11" y="13" width="6" height="6"/>'),
  P_('lyn', 'linje', 'Lyn', 'Lightning', 'Slår mellom pila og det som henger etter', 'Strikes between the arrow and what lags behind', K('natt', 1, 'Skann etter kl. 22', 'Scan after 10 pm'), '<path d="M18 4L9 18h7l-3 10 10-15h-7z"/>'),
  P_('larve', 'linje', 'Larven', 'The caterpillar', 'Ledd for ledd etter pila', 'Link by link behind the arrow', null, '<circle cx="9" cy="18" r="3"/><circle cx="15" cy="15" r="3"/><circle cx="22" cy="13" r="3"/>'),
  P_('ekko', 'linje', 'Ekko', 'Echo', 'Spøkelsespiler som henger etter', 'Ghost arrows lagging behind', K('skann', 15, '15 skann', '15 scans'), '<path d="M8 6l4 14 3-5 5-2zM15 10l4 14 3-5 5-2z"/>'),
  P_('maalebaand', 'linje', 'Målebånd', 'Tape measure', 'Klikk, så måler du derfra', 'Click, and you measure from there', K('enheter', 10, 'Finn 10 enheter', 'Find 10 devices'), '<rect x="3" y="12" width="26" height="8"/><path d="M8 12v4M13 12v3M18 12v4M23 12v3"/>'),
  P_('sno', 'sky', 'Snø', 'Snow', 'Rolig snøfall fra pila', 'Quiet snowfall from the arrow', null, '<path d="M16 5v22M6 10l20 12M26 10L6 22"/>'),
  P_('bobler', 'sky', 'Bobler', 'Bubbles', 'Luft i anlegget', 'Air in the system', K('skann', 2, '2 skann', '2 scans'), '<circle cx="12" cy="20" r="5"/><circle cx="21" cy="11" r="3.5"/>'),
  P_('damp', 'sky', 'Damp', 'Steam', 'Lavtrykk, varmt', 'Low pressure, hot', K('aapnet', 3, 'Åpne NABE 3 ganger', 'Open NABE 3 times'), '<path d="M10 26c-4-6 4-8 0-14M18 26c-4-6 4-8 0-14"/>'),
  P_('lov', 'sky', 'Høstløv', 'Autumn leaves', 'Blader som blåser av', 'Leaves blowing off', K('aapnet', 10, 'Åpne NABE 10 ganger', 'Open NABE 10 times'), '<path d="M7 25C7 12 15 6 26 6c0 11-6 19-19 19zM7 25L19 13"/>'),
  P_('bits', 'sky', 'Bits', 'Bits', 'Nuller og enere drypper', 'Zeros and ones dripping', K('punkter', 100, 'Les 100 punkter', 'Read 100 points'), '<path d="M8 8v10M21 8a4 5 0 1 1-.1 0"/>'),
  P_('hex', 'sky', 'Hex-dump', 'Hex dump', 'Bytes rett fra kabelen', 'Bytes straight off the wire', K('punkter', 1000, 'Les 1000 punkter', 'Read 1000 points'), '<path d="M6 9v14M13 9v14M6 16h7M19 9l8 14M27 9l-8 14"/>'),
  P_('verdier', 'sky', 'Verdier', 'Values', '21.5 °C og ppm flyter opp', '21.5 °C and ppm float up', K('live', 1, 'Slå på Live', 'Turn on Live'), '<path d="M16 5v14"/><circle cx="16" cy="23" r="4"/>'),
  P_('lekkasje', 'sky', 'Lekkasje', 'Leak', 'Drypper, og spruter ved klikk', 'Drips, and sprays on a click', K('skann', 8, '8 skann', '8 scans'), '<path d="M16 5c5 7 7 11 7 14a7 7 0 0 1-14 0c0-3 2-7 7-14z"/>'),
  P_('stjerner', 'sky', 'Stjernestøv', 'Stardust', 'Små glimt bak pila', 'Small glints behind the arrow', K('varfil', 2, 'Lag 2 Variabel-filer', 'Make 2 Variabel files'), '<path d="M16 5v22M5 16h22M10 10l12 12M22 10L10 22"/>'),
  P_('nordlys', 'sky', 'Nordlys', 'Northern lights', 'Grønne gardiner over pila', 'Green curtains above the arrow', K('natt', 3, 'Skann sent 3 ganger', 'Scan late 3 times'), '<path d="M4 24c4-14 6-14 8-4s4 10 7-2 6-12 9-6"/>'),
  P_('sveis', 'sky', 'Sveising', 'Welding', 'Gnister hele veien', 'Sparks all the way', K('skriv', 10, 'Skriv 10 ganger', 'Write 10 times'), '<path d="M6 26L20 12M20 12l3-7M20 12l7-3M20 12l6 5"/>'),
  P_('jet', 'sky', 'Jetflamme', 'Jet flame', 'Fra jetpakka', 'Off the jetpack', K('tunnelRekord', 100, '100 poeng i Tunnelen', '100 points in the tunnel'), '<path d="M16 4c5 7 8 11 8 15a8 8 0 0 1-16 0c0-4 3-8 8-15z"/>', {spill: true, sjelden: true}),
  P_('kabel', 'venn', 'Patchkabel', 'Patch cable', 'Dingler etter pila', 'Swings from the arrow', K('skann', 5, '5 skann', '5 scans'), '<path d="M8 6c0 12 14 6 14 16"/><rect x="18" y="22" width="8" height="6"/>'),
  P_('lille-nabe', 'venn', 'Lille NABE', 'Little NABE', 'Følger etter, med klærne på', 'Tags along, clothes on', K('skann', 10, '10 skann', '10 scans'), '<rect x="8" y="9" width="16" height="15" rx="4"/><circle cx="13" cy="15" r="1.6"/><circle cx="19" cy="15" r="1.6"/>'),
  P_('spor-nabe', 'venn', 'Spør NABE', 'Ask NABE', 'Sitter i snor ved pila. Klikk på ham for å spørre', 'Sits on a leash by the arrow. Click him to ask', null, '<rect x="6" y="10" width="14" height="13" rx="4"/><path d="M24 8c3 0 4 3 2 5s-2 2-2 4M24 21v1"/>'),
  P_('lille-nabo', 'venn', 'Lille NABO', 'Little NABO', 'Naboen kommer på besøk', 'The neighbour comes along', K('varfil', 1, 'Lag én Variabel-fil', 'Make one Variabel file'), '<path d="M6 16l10-8 10 8v9H6z"/>'),
  P_('drone', 'venn', 'Inspeksjonsdrone', 'Inspection drone', 'Svever og vipper etter pila', 'Hovers and tilts after the arrow', K('enheter', 50, 'Finn 50 enheter', 'Find 50 devices'), '<path d="M5 15h22"/><rect x="12" y="13" width="8" height="6" rx="2"/><path d="M2 11h8M22 11h8"/>'),
  P_('flua', 'venn', 'Flua', 'The fly', 'Surrer rundt og lander når du stopper', 'Buzzes around and lands when you stop', null, '<ellipse cx="16" cy="17" rx="4" ry="6"/><ellipse cx="9" cy="12" rx="5" ry="3"/><ellipse cx="23" cy="12" rx="5" ry="3"/>'),
  P_('ballong', 'venn', 'Ballong', 'Balloon', 'Stiger på snor over pila', 'Rises on a string above the arrow', K('aapnet', 20, 'Åpne NABE 20 ganger', 'Open NABE 20 times'), '<ellipse cx="16" cy="12" rx="8" ry="9"/><path d="M16 21c-3 3 3 4 0 8"/>'),
  P_('lodd', 'venn', 'Loddesnor', 'Plumb line', 'Tungt lodd som pendler', 'A heavy bob that swings', K('skann', 20, '20 skann', '20 scans'), '<path d="M16 4v14M11 18h10l-5 10z"/>'),
  P_('kompass', 'venn', 'Kompass', 'Compass', 'Nåla viser hvor du er på vei', 'The needle shows where you are heading', K('enheter', 5, 'Finn 5 enheter', 'Find 5 devices'), '<circle cx="16" cy="16" r="11"/><path d="M20 10l-3 8-5 4 3-8z"/>'),
  P_('tannhjul', 'venn', 'Tannhjul', 'Gear', 'Ruller med på veien', 'Rolls along', K('skann', 30, '30 skann', '30 scans'), '<circle cx="16" cy="16" r="6"/><path d="M16 4v5M16 23v5M4 16h5M23 16h5M8 8l3 3M21 21l3 3M24 8l-3 3M11 21l-3 3"/>'),
  P_('vifte', 'venn', 'Vifte', 'Fan', 'Går fortere jo fortere du går', 'Spins faster the faster you go', K('live', 2, 'Slå på Live to ganger', 'Turn on Live twice'), '<circle cx="16" cy="16" r="11"/><path d="M16 16c-1-6 2-8 5-7M16 16c6 1 8 4 6 7M16 16c-5 3-8 2-9-1"/>'),
  P_('fartsmaaler', 'venn', 'Fartsmåler', 'Speedometer', 'Viser hvor fort musa går, i m/s', 'Shows how fast the mouse goes, in m/s', K('skann', 12, '12 skann', '12 scans'), '<path d="M4 22a12 12 0 0 1 24 0zM16 22l6-9"/>'),
  P_('papirfly', 'venn', 'Papirfly', 'Paper plane', 'Svinger inn i banen din', 'Banks into your path', K('nabo', 3, 'Bruk NABO 3 ganger', 'Use NABO 3 times'), '<path d="M4 15L28 5l-8 22-5-9z"/>'),
  P_('gnister', 'klikk', 'Gnister', 'Sparks', 'Et klikk slår gnister', 'A click throws sparks', K('skriv', 1, 'Skriv til et anlegg', 'Write to a site'), '<path d="M16 5v7M16 20v7M5 16h7M20 16h7M8 8l5 5M19 19l5 5M24 8l-5 5M13 19l-5 5"/>'),
  P_('konfetti', 'klikk', 'Konfetti', 'Confetti', 'Litt feiring per klikk', 'A little party per click', K('varfil', 5, 'Lag 5 Variabel-filer', 'Make 5 Variabel files'), '<path d="M6 8h4M22 6l3 3M12 16l3 2M24 18h4M7 24l3-2M18 25l2 3"/>'),
  P_('krusning', 'klikk', 'Krusning', 'Ripples', 'Ringer i vannet', 'Rings in the water', null, '<ellipse cx="16" cy="16" rx="12" ry="6"/><ellipse cx="16" cy="16" rx="6" ry="3"/>'),
  P_('radar', 'klikk', 'Radar', 'Radar', 'Et klikk sveiper rundt som en Who-Is', 'A click sweeps round like a Who-Is', K('skann', 25, '25 skann', '25 scans'), '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="5"/><path d="M16 16l8-8"/>'),
  P_('lommelykt', 'klikk', 'Lommelykt', 'Flashlight', 'Mørkt teknisk rom, lys der du peker', 'A dark plant room, light where you point', K('natt', 5, 'Skann sent 5 ganger', 'Scan late 5 times'), '<path d="M12 4h8l-1 9v14h-6V13z"/>'),
  P_('skrutrekker', 'verktoy', 'Skrutrekker', 'Screwdriver', 'Vipper med farta og vrir ved klikk', 'Tilts with speed and twists on a click', K('enheter', 100, 'Finn 100 enheter', 'Find 100 devices'), '<path d="M6 6l10 10"/><rect x="15" y="15" width="7" height="13" rx="2" transform="rotate(-45 18 21)"/>'),
  P_('blyant', 'verktoy', 'Blyant', 'Pencil', 'Tegner en strek du kan følge', 'Draws a line you can follow', K('aapnet', 15, 'Åpne NABE 15 ganger', 'Open NABE 15 times'), '<path d="M6 26l3-8L22 5l5 5-13 13z"/>'),
  P_('probe', 'verktoy', 'Målepinne', 'Test probe', 'Rød probe med ledning', 'A red probe with its lead', K('skriv', 5, 'Skriv 5 ganger', 'Write 5 times'), '<path d="M5 5l6 6"/><rect x="10" y="10" width="6" height="13" rx="2" transform="rotate(-45 13 16)"/><path d="M20 22c4 4 8 2 8-2"/>'),
];

/* The Peker tab in the wardrobe. */
function pekerKatalog() {
  const t = tellerNaa(), valgt = pekerValgt();
  const kort = (p) => {
    const aapen = laastOpp(p), paa = valgt === p.id;
    const [k, n, tekst] = p.krav || [];
    const har = p.krav ? Math.min(t[k] || 0, n) : 0;
    return `<button type="button" class="gd-kort pk-kort${aapen ? '' : ' laast'}${paa ? ' paa' : ''}${p.spill ? ' spill' : ''}${p.sjelden ? ' sjelden' : ''}" data-peker="${p.id}" title="${esc(T(p.om[0], p.om[1]))}">
      <span class="gd-fig"><svg class="pk-ikon" viewBox="0 0 32 32" aria-hidden="true">${p.ikon}</svg></span>
      <span class="gd-navn">${esc(pn(p))}</span>
      ${aapen ? `<span class="gd-krav">${esc(T(p.om[0], p.om[1]))}</span><span class="gd-status">${paa ? T('I bruk', 'In use') : ''}</span>`
              : `<span class="gd-krav">${esc(T(tekst[0], tekst[1]))}</span><span class="gd-bar"><i style="transform:scaleX(${har / n})"></i></span><span class="gd-tall">${har} / ${n}</span>`}
    </button>`;
  };
  return `<div class="gd-hoved">
    <div class="gd-scene pk-scene">
      <div class="pk-tittel">${T('Klikk et åpent kort for å bruke det', 'Click an open card to use it')}</div>
      <div class="gd-scene-tekst">${esc(T('Pekerne kommer av arbeid, ikke av klikking.', 'Pointers come from work, not from clicking.'))}</div>
    </div>
    <div class="gd-katalog">${PEKER_GRUPPER.map(([g, navn]) => `
      <div class="gd-plass">${esc(T(navn[0], navn[1]))}</div>
      <div class="gd-rutenett">${PEKERE.filter(p => p.gruppe === g).map(kort).join('')}</div>`).join('')}</div>
  </div>`;
}

return {PEKERE, pekerKatalog};
})();
