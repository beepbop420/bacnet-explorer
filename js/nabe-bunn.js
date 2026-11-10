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

  /* COV: how many points the plant pushes by itself, and a quiet warning for
     the ones that stopped. Hidden while nothing is subscribed. */
  const cov = document.createElement('div');
  cov.className = 'sb-item sb-grense';
  cov.id = 'sbCov';
  cov.hidden = true;
  $('sbSnap').after(cov);
  etter('api', (d, sti) => {
    if (sti !== '/api/poll' || !d || d.status !== 'done') return;
    const stille = d.cov_stille || {};
    const navn = [];
    for (const [ip, ider] of Object.entries(stille)) {
      for (const id of ider) {
        const p = (S.cache[ip] || []).find?.(x => x.objid === id);
        navn.push(`${ip} ${(p && p.name) || id}`);
      }
    }
    const n = d.cov || 0;
    cov.hidden = !n && !navn.length;
    cov.classList.toggle('stille', navn.length > 0);
    cov.textContent = navn.length
      ? T(`COV ${n} · ${navn.length} stille`, `COV ${n} · ${navn.length} silent`)
      : `COV ${n}`;
    cov.title = navn.length
      ? T('Varslene har sluttet å komme. Punktene leses i stedet, og NABE abonnerer på nytt.\n',
          'The notifications stopped. These points are read instead, and NABE subscribes again.\n') + navn.join('\n')
      : T('Punkter anlegget melder selv, uten at NABE spør', 'Points the plant reports by itself, without NABE asking');
  });

  /* The beat: restarted on every read, as long as the interval. */
  foer('pollTick', () => {
    if (S.live) {
      const ms = parseInt($('pollInt')?.value, 10) || 5000;
      takt.style.transition = 'none';
      takt.style.transform = 'scaleX(0)';
      void takt.offsetWidth;
      takt.style.transition = bevegelseAv() ? 'none' : `transform ${ms}ms linear`;
      takt.style.transform = 'scaleX(1)';
    }
  });
  etter('stopPolling', () => {
    takt.style.transition = 'transform .2s'; takt.style.transform = 'scaleX(0)';
    knapp.classList.remove('paa');
  });
  foer('startPolling', () => knapp.classList.add('paa'));

  etter('renderPrefetchStatus', () => {
    const total = S.devices.length;
    const lest = S.devices.filter(d => S.cache[d.address]).length;
    const feilet = S.devices.filter(d => PRE.failed.has(d.address)).length;
    const ferdig = !total || lest + feilet >= total;
    preBar.hidden = pre.hidden || ferdig;
    fylt.style.transform = `scaleX(${total ? (lest + feilet) / total : 0})`;
  });
})();
