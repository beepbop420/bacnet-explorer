/* NABE - the pointer. The arrow itself stays the system's real cursor, drawn
   in NABE's shape, so it never lags a frame behind the hand. Behind it a thin
   ring follows on a spring, and when you point at something you can press it
   lets go of the mouse and wraps the thing. A click sends a ping out from
   the tip, as a Who-Is goes out on the wire. Nothing runs while the mouse is
   still. Settings > Motion turns it off. */
(function peker() {
  const MAAL = 'button,a[href],[role=button],summary,.dev,.ss-rad,.ctx-stat,.menu-item';
  const pekerAv = () => loadPrefs().pekerAv === true;
  const ring = document.createElement('div');
  ring.id = 'peker';
  ring.hidden = true;
  document.body.append(ring);

  const naa = {x: 0, y: 0, b: 22, h: 22, r: 11};
  const maal = {...naa};
  const mus = {x: 0, y: 0, inne: false};
  let el = null, gaar = false, sist = 0;

  function sikt() {
    const f = el && el.isConnected ? el.getBoundingClientRect() : null;
    const fester = f && f.width && f.width <= 420 && f.height <= 96;
    ring.classList.toggle('fast', !!fester);
    ring.classList.toggle('fare', !!(fester && el.matches('.fare,#wSend')));
    if (fester) {
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      Object.assign(maal, {x: f.left - 3, y: f.top - 3, b: f.width + 6, h: f.height + 6, r: r + 3});
    } else {
      Object.assign(maal, {x: mus.x - 11, y: mus.y - 11, b: 22, h: 22, r: 11});
    }
  }

  function tegn() {
    ring.style.transform = `translate(${naa.x}px,${naa.y}px)`;
    ring.style.width = `${naa.b}px`;
    ring.style.height = `${naa.h}px`;
    ring.style.borderRadius = `${naa.r}px`;
  }

  function steg(t) {
    // The same pull whatever the screen's refresh rate.
    const k = 1 - Math.pow(.76, Math.min(50, t - sist) / 16.7);
    sist = t;
    let rest = 0;
    for (const n of ['x', 'y', 'b', 'h', 'r']) {
      naa[n] += (maal[n] - naa[n]) * k;
      rest += Math.abs(maal[n] - naa[n]);
    }
    tegn();
    if (rest > .3) requestAnimationFrame(steg);
    else gaar = false;
  }
  function start() {
    if (gaar) return;
    gaar = true;
    sist = performance.now();
    requestAnimationFrame(steg);
  }

  const paa = () => !pekerAv() && !bevegelseAv();
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !paa()) return;
    mus.x = e.clientX; mus.y = e.clientY;
    if (!mus.inne) {
      mus.inne = true;
      ring.hidden = false;
      Object.assign(naa, {x: mus.x - 11, y: mus.y - 11});
    }
    // A held button is a drag: the ring stays with the hand.
    el = e.buttons ? null : (e.target.closest && e.target.closest(MAAL));
    sikt();
    start();
  }, {passive: true});
  document.documentElement.addEventListener('mouseleave', () => { mus.inne = false; ring.hidden = true; });

  // The thing under the ring can move or be drawn anew with the mouse still.
  const paaNytt = () => {
    if (!mus.inne) return;
    const u = document.elementFromPoint(mus.x, mus.y);
    el = u && u.closest(MAAL);
    sikt();
    start();
  };
  document.addEventListener('scroll', paaNytt, {capture: true, passive: true});
  window.addEventListener('resize', paaNytt);
  etter('renderDevices', paaNytt);

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || !paa()) return;
    ring.animate([{scale: 1}, {scale: .93}, {scale: 1}], {duration: 240, easing: 'ease-out'});
    const p = document.createElement('i');
    p.className = 'peker-ping';
    p.style.left = `${e.clientX}px`;
    p.style.top = `${e.clientY}px`;
    document.body.append(p);
    p.animate([{transform: 'translate(-50%,-50%) scale(.1)', opacity: .55}, {transform: 'translate(-50%,-50%) scale(1)', opacity: 0}],
              {duration: 460, easing: 'cubic-bezier(.16,1,.3,1)'}).onfinish = () => p.remove();
  }, {passive: true});

  function brukPeker() {
    document.documentElement.classList.toggle('peker-paa', !pekerAv());
    if (!paa()) { ring.hidden = true; mus.inne = false; }
    const s = $('pekerState');
    if (s) s.textContent = pekerAv() ? T('av', 'off') : T('på', 'on');
    $('pekerBtn')?.setAttribute('aria-checked', String(!pekerAv()));
  }
  $('pekerBtn').onclick = () => { savePrefs({pekerAv: !pekerAv()}); brukPeker(); };
  etter('syncMenuStates', brukPeker);
  brukPeker();
})();
