/* NABE - flow. The device list is drawn anew each time, so nothing in it can
   move by itself: a row that changes place would jump. Here each row starts
   from where it stood and glides to where it landed. The points glide in when
   you change controller, and the window's title bar joins the band across the top. */
(function flyt() {
  const fjaer = getComputedStyle(document.documentElement).getPropertyValue('--fjaer').trim() || 'ease-out';

  /* ---- rows that change place */
  const liste = $('devList');
  const rader = () => [...liste.querySelectorAll('.dev[data-ip]')];
  let forrige = new Map();
  etter('renderDevices', () => {
    const alle = rader();
    // Past a few hundred rows the measuring costs more than the glide gives.
    if (alle.length > 300) { forrige = new Map(); return; }
    const topp = liste.getBoundingClientRect().top - liste.scrollTop;
    const naa = new Map(alle.map(b => [b.dataset.ip, b.getBoundingClientRect().top - topp]));
    if (!bevegelseAv()) {
      for (const b of alle) {
        const fra = forrige.get(b.dataset.ip);
        if (fra === undefined) continue;
        const dy = fra - naa.get(b.dataset.ip);
        if (Math.abs(dy) < 2 || Math.abs(dy) > liste.clientHeight) continue;
        b.animate([{transform: `translateY(${dy}px)`}, {transform: 'none'}], {duration: 320, easing: fjaer});
      }
    }
    forrige = naa;
  });

  /* ---- another controller's points */
  let aktiv = null;
  etter('selectDevice', (_, ip) => {
    if (ip === aktiv) return;
    aktiv = ip;
    if (bevegelseAv()) return;
    $('pointsWrap').animate([{opacity: .35, transform: 'translateY(5px)'}, {opacity: 1, transform: 'none'}], {duration: 220, easing: fjaer});
  });

  /* ---- the title bar, in the desktop window only */
  const tittellinje = () => {
    const api = window.pywebview && window.pywebview.api;
    if (!api || !api.tittellinje) return;
    const s = getComputedStyle(document.documentElement);
    const merke = s.getPropertyValue('--merke').trim();
    api.tittellinje(merke, '#ffffff', merke, true);
  };
  etter('applyTheme', tittellinje);
  window.addEventListener('pywebviewready', tittellinje);
  tittellinje();
})();
