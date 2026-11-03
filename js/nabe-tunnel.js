/* NABE - «Tunnelen», for when there is no way out.

   When not a single site can be reached - the VPN is down, the train is in
   a tunnel - the empty middle of the window says so quietly, and offers
   something to do while waiting: NABE stuck in the dead tunnel himself.

   Hold Space (or the mouse) to rise, let go to sink. Firewalls come at him
   with a gap to get through; I-Am replies are there to collect; now and then
   a BBMD, which carries him through one wall. It speeds up slowly. The best
   run is remembered. When a site comes back in reach the game steps aside,
   and NABE says so.

   Drawn on a canvas in the theme's own colours - hairlines, one accent - and
   only ever started by a key press. Loaded after nabe-skann.js. */
'use strict';

const TUN = {el: null, lerret: null, ctx: null, spill: null, rekord: 0, sett: false};
try { TUN.rekord = Number(localStorage.getItem('nabe_tunnel_rekord')) || 0; } catch {}

const TUN_SLUTT = [
  ['Timeout. Som vanlig.', 'Timeout. As usual.'],
  ['Droppet av en brannmur fra 2009.', 'Dropped by a firewall from 2009.'],
  ['Pakken kom fram. Bare ikke NABE.', 'The packet got through. NABE did not.'],
  ['TTL 0.', 'TTL 0.'],
  ['Noen dro ut kabelen.', 'Someone pulled the cable.'],
  ['Who-Is? Ingen.', 'Who-Is? Nobody.'],
];

/* ------------------------------------------------------------- when */
function tunnelTid() {
  // Not a single site in reach, nothing read, no device open.
  const anlegg = (typeof SK !== 'undefined' && SK.anlegg) || [];
  return anlegg.length > 0 && !anlegg.some(a => a.naabar) && !S.devices.length && !S.activeDev;
}

function tunnelVakt() {
  const wrap = $('pointsWrap');
  if (!wrap) return;
  const tid = tunnelTid();
  if (tid && !document.getElementById('tunnel')) monter(wrap);
  if (!tid && TUN.el) {
    if (TUN.spill) nabeSier(T('Tunnelen er oppe igjen. Spillet får vente.', 'The tunnel is up again. The game can wait.'), 'fornoyd', 'tunnel-oppe');
    avmonter();
  }
}
setInterval(tunnelVakt, 3000);
setTimeout(tunnelVakt, 2500);

function monter(wrap) {
  const el = document.createElement('div');
  el.id = 'tunnel';
  el.className = 'tunnel';
  el.innerHTML = `<div class="tunnel-topp">
      <span class="tunnel-tittel">${T('Ingen vei ut', 'No way out')}</span>
      <span class="tunnel-tekst">${T('Ingen anlegg kan nås herfra nå. Mens du venter på VPN-en:', 'No site can be reached from here right now. While you wait for the VPN:')}</span>
    </div>
    <canvas class="tunnel-lerret" tabindex="0" aria-label="${T('Tunnelen, et lite spill', 'The tunnel, a small game')}"></canvas>
    <div class="tunnel-hint">${T('Trykk <kbd>mellomrom</kbd> for å kjøre gjennom tunnelen. Hold for å stige.', 'Press <kbd>space</kbd> to run the tunnel. Hold to rise.')}<span class="tunnel-rekord"></span></div>`;
  wrap.appendChild(el);
  TUN.el = el;
  TUN.lerret = el.querySelector('canvas');
  TUN.ctx = TUN.lerret.getContext('2d');
  storrelse();
  tegnRekord();
  tegnStille();
  TUN.lerret.addEventListener('pointerdown', (e) => { e.preventDefault(); trykk(true); });
  TUN.lerret.addEventListener('pointerup', () => trykk(false));
  TUN.lerret.addEventListener('pointerleave', () => trykk(false));
}

function avmonter() {
  if (TUN.spill) cancelAnimationFrame(TUN.spill.raf);
  TUN.spill = null;
  TUN.el?.remove();
  TUN.el = null;
}

function storrelse() {
  const c = TUN.lerret;
  if (!c) return;
  const b = Math.min(720, c.parentElement.clientWidth - 32), h = 220, r = window.devicePixelRatio || 1;
  c.style.width = b + 'px'; c.style.height = h + 'px';
  c.width = Math.round(b * r); c.height = Math.round(h * r);
  TUN.ctx.setTransform(r, 0, 0, r, 0, 0);
  TUN.b = b; TUN.h = h;
}
window.addEventListener('resize', () => { if (TUN.el) { storrelse(); if (!TUN.spill) tegnStille(); } });

function tegnRekord() {
  const el = TUN.el?.querySelector('.tunnel-rekord');
  if (el) el.textContent = TUN.rekord ? T(` · rekord ${TUN.rekord}`, ` · best ${TUN.rekord}`) : '';
}

/* ------------------------------------------------------------- input */
function trykk(ned) {
  if (!TUN.el) return;
  if (ned && (!TUN.spill || TUN.spill.slutt)) { start(); return; }
  if (TUN.spill) TUN.spill.opp = ned;
}
document.addEventListener('keydown', (e) => {
  if (!TUN.el || (e.key !== ' ' && e.key !== 'ArrowUp')) return;
  // Not while typing somewhere else.
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  e.preventDefault();
  if (!e.repeat) trykk(true);
});
document.addEventListener('keyup', (e) => { if (TUN.el && (e.key === ' ' || e.key === 'ArrowUp')) trykk(false); });

/* ------------------------------------------------------------- the run */
function farger() {
  const cs = getComputedStyle(document.body);
  const v = (n, f) => (cs.getPropertyValue(n) || '').trim() || f;
  return {fg: v('--fg', '#ddd'), fg2: v('--fg-2', '#aaa'), fg3: v('--fg-3', '#888'), linje: v('--line-2', '#444'),
          aksent: v('--accent', '#6aa7ff'), ok: v('--ok', '#0ac80a'), feil: v('--err', '#e5484d'), panel: v('--panel', '#161618'), warn: v('--warn', '#ffc900')};
}

function start() {
  const s = {y: TUN.h / 2, vy: 0, opp: false, x: 0, fart: 2.6, murer: [], pakker: [], poeng: 0, skjold: 0,
             neste: 140, slutt: false, t: 0, raf: 0, sist: performance.now()};
  TUN.spill = s;
  TUN.el.classList.add('i-gang');
  const steg = (naa) => {
    const dt = Math.min(2.5, (naa - s.sist) / 16.67);
    s.sist = naa;
    oppdater(s, dt);
    tegn(s);
    if (!s.slutt) s.raf = requestAnimationFrame(steg);
  };
  s.raf = requestAnimationFrame(steg);
}

function oppdater(s, dt) {
  const H = TUN.h, kant = 14;
  s.t += dt;
  s.fart = 2.6 + Math.min(4, s.t / 900);
  s.vy += (s.opp ? -0.32 : 0.26) * dt;
  s.vy = Math.max(-4.2, Math.min(4.2, s.vy)) * 0.985;
  s.y += s.vy * dt;
  if (s.y < kant + 9 || s.y > H - kant - 9) return over(s, T('Traff tunnelveggen.', 'Hit the tunnel wall.'));
  s.x += s.fart * dt;
  // New firewalls: a gap that narrows a little as it goes.
  s.neste -= s.fart * dt;
  if (s.neste <= 0) {
    const gap = Math.max(64, 104 - s.t / 60);
    const midt = kant + gap / 2 + 6 + Math.random() * (H - 2 * kant - gap - 12);
    s.murer.push({x: TUN.b + 10, midt, gap, forbi: false});
    // An I-Am in the gap, now and then a BBMD.
    s.pakker.push({x: TUN.b + 10 + 90 + Math.random() * 60, y: kant + 18 + Math.random() * (H - 2 * kant - 36),
                   bbmd: Math.random() < 0.08});
    s.neste = 190 + Math.random() * 90;
  }
  const nx = 64;
  for (const m of s.murer) {
    m.x -= s.fart * dt;
    if (!m.forbi && m.x + 8 < nx - 10) { m.forbi = true; s.poeng += 1; }
    if (m.x < nx + 10 && m.x + 8 > nx - 10 && Math.abs(s.y - m.midt) > m.gap / 2 - 9) {
      if (s.skjold > 0) { s.skjold--; m.gjennom = true; m.x = -100; }
      else return over(s, T('Stoppet av en brannmur.', 'Stopped by a firewall.'));
    }
  }
  for (const p of s.pakker) {
    p.x -= s.fart * dt;
    if (!p.tatt && Math.abs(p.x - nx) < 14 && Math.abs(p.y - s.y) < 14) {
      p.tatt = true;
      if (p.bbmd) s.skjold = 1; else s.poeng += 3;
    }
  }
  s.murer = s.murer.filter(m => m.x > -20);
  s.pakker = s.pakker.filter(p => p.x > -30 && !p.tatt);
}

function over(s, grunn) {
  s.slutt = true;
  s.grunn = grunn;
  s.quip = TUN_SLUTT[Math.floor(Math.random() * TUN_SLUTT.length)];
  // The career keeps count: runs, and the best ever - the wardrobe's tunnel
  // items are earned on these.
  if (typeof tell === 'function') tell('tunnelRunder');
  try {
    const k = typeof teller === 'function' ? teller() : null;
    if (k && s.poeng > (k.tunnelRekord || 0)) { k.tunnelRekord = s.poeng; localStorage.setItem(TELLER_NOKKEL, JSON.stringify(k)); }
  } catch {}
  if (s.poeng > TUN.rekord) {
    TUN.rekord = s.poeng; s.rekord = true;
    try { localStorage.setItem('nabe_tunnel_rekord', String(s.poeng)); } catch {}
    tegnRekord();
  }
  TUN.el?.classList.remove('i-gang');
  tegn(s);
}

/* ------------------------------------------------------------- drawing */
function rundRekt(c, x, y, b, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + b, y, x + b, y + h, r); c.arcTo(x + b, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + b, y, r); c.closePath();
}

function tegnNabe(c, x, y, f, tilt, skjold) {
  c.save(); c.translate(x, y); c.rotate(tilt);
  if (skjold) { c.strokeStyle = f.ok; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 15, 0, Math.PI * 2); c.stroke(); }
  c.strokeStyle = f.fg; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, -9); c.lineTo(0, -13); c.stroke();
  c.fillStyle = f.warn; c.beginPath(); c.arc(0, -13.5, 1.6, 0, Math.PI * 2); c.fill();
  c.fillStyle = f.fg; rundRekt(c, -10, -9, 20, 18, 5); c.fill();
  c.fillStyle = f.panel;
  c.beginPath(); c.arc(-4, -1, 3.2, 0, Math.PI * 2); c.arc(4, -1, 3.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = f.fg; c.beginPath(); c.arc(-3.2, -1, 1.4, 0, Math.PI * 2); c.arc(4.8, -1, 1.4, 0, Math.PI * 2); c.fill();
  c.restore();
}

function tunnelVegger(c, f, forskyv) {
  const B = TUN.b, H = TUN.h, kant = 14;
  c.strokeStyle = f.linje; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, kant); c.lineTo(B, kant); c.moveTo(0, H - kant); c.lineTo(B, H - kant); c.stroke();
  // Cable joints passing: the sense of speed, nothing more.
  c.strokeStyle = f.fg3; c.globalAlpha = 0.35;
  for (let x = -(forskyv % 48); x < B; x += 48) {
    c.beginPath(); c.moveTo(x, kant - 4); c.lineTo(x, kant); c.moveTo(x + 24, H - kant); c.lineTo(x + 24, H - kant + 4); c.stroke();
  }
  c.globalAlpha = 1;
}

function tegnStille() {
  const c = TUN.ctx, f = farger();
  if (!c) return;
  c.clearRect(0, 0, TUN.b, TUN.h);
  tunnelVegger(c, f, 0);
  tegnNabe(c, 64, TUN.h / 2, f, 0, false);
  c.fillStyle = f.fg3; c.font = '11px ' + (getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace');
  c.fillText('VPN: ' + T('nede', 'down'), TUN.b - 74, 32);
}

function tegn(s) {
  const c = TUN.ctx, f = farger(), B = TUN.b, H = TUN.h, kant = 14;
  const mono = getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace';
  c.clearRect(0, 0, B, H);
  tunnelVegger(c, f, s.x);
  for (const m of s.murer) {
    c.fillStyle = f.feil; c.globalAlpha = 0.85;
    rundRekt(c, m.x, kant, 8, m.midt - m.gap / 2 - kant, 2); c.fill();
    rundRekt(c, m.x, m.midt + m.gap / 2, 8, H - kant - (m.midt + m.gap / 2), 2); c.fill();
    c.globalAlpha = 1;
  }
  for (const p of s.pakker) {
    c.strokeStyle = p.bbmd ? f.ok : f.aksent; c.lineWidth = 1.2;
    rundRekt(c, p.x - 13, p.y - 7, 26, 14, 4); c.stroke();
    c.fillStyle = p.bbmd ? f.ok : f.aksent; c.font = `600 8px ${mono}`; c.textAlign = 'center';
    c.fillText(p.bbmd ? 'BBMD' : 'I-Am', p.x, p.y + 3); c.textAlign = 'start';
  }
  tegnNabe(c, 64, s.y, f, Math.max(-0.35, Math.min(0.35, s.vy * 0.08)), s.skjold > 0);
  c.fillStyle = f.fg2; c.font = `600 12px ${mono}`;
  c.textAlign = 'right'; c.fillText(String(s.poeng), B - 12, 32); c.textAlign = 'start';
  if (s.slutt) {
    c.fillStyle = f.panel; c.globalAlpha = 0.82; c.fillRect(0, kant + 1, B, H - 2 * kant - 2); c.globalAlpha = 1;
    c.textAlign = 'center';
    c.fillStyle = f.fg; c.font = '600 14px ' + (getComputedStyle(document.body).getPropertyValue('--sans') || 'sans-serif');
    c.fillText(T(s.quip[0], s.quip[1]), B / 2, H / 2 - 12);
    c.fillStyle = f.fg3; c.font = '12px ' + (getComputedStyle(document.body).getPropertyValue('--sans') || 'sans-serif');
    c.fillText(`${s.grunn} ${s.rekord ? T('Ny rekord: ', 'New best: ') : T('Poeng: ', 'Score: ')}${s.poeng}`, B / 2, H / 2 + 10);
    c.fillText(T('Mellomrom for en tur til', 'Space for another run'), B / 2, H / 2 + 30);
    c.textAlign = 'start';
  }
}

// Also from the command palette, for anyone who wants a go anyway.
window.aapneTunnel = () => {
  const wrap = $('pointsWrap');
  if (!wrap) return;
  if (!TUN.el) monter(wrap);
  TUN.lerret?.focus();
};
