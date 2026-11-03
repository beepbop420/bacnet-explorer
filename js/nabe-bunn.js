/* NABE - the bottom bar.

   It used to be a row of counts with a green dot that breathed whether or
   not anything happened. Now every moving thing in it measures something:

   - Live is a button. While it runs, a hairline under it fills up to the
     next read, so you can see when the values will change.
   - Reading the plant in the background is a bar of how many controllers
     are done, not a sentence that rewrites itself.
   - The rest is quiet text in groups, hairlines between them, and the
     message of the moment on the right.

   The elements other code writes into keep their ids; this only arranges
   them and adds the two bars. Loaded after app.js. */
'use strict';

(function bunnlinje() {
  const bar = document.querySelector('footer.statusbar');
  if (!bar) return;
  bar.classList.add('sb-ny');
  const live = $('sbLive');

  // Live as a button, with the beat underneath.
  const knapp = document.createElement('button');
  knapp.type = 'button';
  knapp.className = 'sb-live';
  knapp.title = T('Live av/på (L)', 'Live on/off (L)');
  live.parentElement.replaceWith(knapp);
  knapp.append(live);
  const takt = document.createElement('i');
  takt.className = 'sb-takt';
  knapp.append(takt);
  knapp.onclick = () => { if (!$('pollBtn').disabled) $('pollBtn').click(); };

  // The background read as a bar.
  const pre = $('sbPre');
  const fylt = document.createElement('i');
  fylt.className = 'sb-fylt';
  const preBar = document.createElement('span');
  preBar.className = 'sb-bar';
  preBar.append(fylt);
  pre.after(preBar);

  // Hairlines between groups.
  for (const id of ['sbRescan', 'sbSnap']) $(id)?.classList.add('sb-grense');

  /* The beat: restarted on every read, as long as the interval. */
  const _tick = pollTick;
  pollTick = async function () {
    if (S.live) {
      const ms = parseInt($('pollInt')?.value, 10) || 5000;
      takt.style.transition = 'none';
      takt.style.transform = 'scaleX(0)';
      void takt.offsetWidth;
      takt.style.transition = bevegelseAv() ? 'none' : `transform ${ms}ms linear`;
      takt.style.transform = 'scaleX(1)';
    }
    return _tick.apply(this, arguments);
  };
  const _stopp = stopPolling;
  stopPolling = function () {
    const r = _stopp.apply(this, arguments);
    takt.style.transition = 'transform .2s'; takt.style.transform = 'scaleX(0)';
    knapp.classList.remove('paa');
    return r;
  };
  const _start = startPolling;
  startPolling = function () {
    knapp.classList.add('paa');
    return _start.apply(this, arguments);
  };

  const _pre = renderPrefetchStatus;
  renderPrefetchStatus = function () {
    const r = _pre.apply(this, arguments);
    const total = S.devices.length;
    const lest = S.devices.filter(d => S.cache[d.address]).length;
    const feilet = S.devices.filter(d => PRE.failed.has(d.address)).length;
    const ferdig = !total || lest + feilet >= total;
    preBar.hidden = pre.hidden || ferdig;
    fylt.style.transform = `scaleX(${total ? (lest + feilet) / total : 0})`;
    return r;
  };
})();
