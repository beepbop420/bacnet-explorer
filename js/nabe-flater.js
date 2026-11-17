/* NABE - two ways of giving the middle of the screen more room.

   The device list as a strip. A list of controllers is needed to move
   between them, not while working in one. Folded, it is a narrow column with
   one tile per device: the end of its address, coloured by its state, its
   name when you point at it. One button folds it and unfolds it.

   The point panel in tabs. Properties, the priority array, every property
   the object has, and the write form used to follow each other down one long
   panel that had to be scrolled on a laptop. Now the value stays on top and
   the rest sits behind tabs, and the panel remembers which one you use.

   Loaded after app.js and nabe-skjema.js. */
'use strict';

(function flater() {
  /* ------------------------------------------------------------ the strip */
  const hode = document.querySelector('.pane-devices .pane-head');
  const knapp = document.createElement('button');
  knapp.type = 'button';
  knapp.id = 'listeSmalBtn';
  knapp.className = 'liste-smal-btn';
  if (hode) hode.prepend(knapp);
  const smal = () => document.body.classList.contains('liste-smal') || document.body.classList.contains('sk-stor');
  function synk() {
    const s = smal();
    knapp.textContent = s ? '»' : '«';
    knapp.title = s ? T('Vis enhetslista', 'Show the device list') : T('Fold enhetslista til en stripe', 'Fold the device list into a strip');
    knapp.setAttribute('aria-label', knapp.title);
    knapp.setAttribute('aria-expanded', String(!s));
  }
  knapp.onclick = () => {
    if (document.body.classList.contains('sk-stor')) {
      // the schematic asked for the room: giving the list back is a choice about the schematic
      savePrefs({skjemaStor: false, listeSmal: false});
      document.body.classList.remove('sk-stor', 'liste-smal');
      if (typeof renderPoints === 'function' && S.activeDev) renderPoints();
    } else {
      const ny = !document.body.classList.contains('liste-smal');
      savePrefs({listeSmal: ny});
      document.body.classList.toggle('liste-smal', ny);
    }
    synk();
  };
  try { document.body.classList.toggle('liste-smal', !!loadPrefs().listeSmal); } catch { /* unfolded */ }
  synk();
  etter('renderPoints', synk);

  /* The tile's text: the last part of the address, which is what tells devices apart on a site. */
  etter('renderDevices', () => {
    document.querySelectorAll('#devList .dev').forEach(b => {
      if (b.querySelector('.dev-smal')) return;
      const ip = b.dataset.ip || '';
      const m = /\.(\d+)$/.exec(ip);
      const s = document.createElement('span');
      s.className = 'dev-smal';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = m ? '.' + m[1] : ip.slice(-4);
      b.append(s);
      if (!b.title) b.title = (b.querySelector('.dev-name')?.textContent || '').trim() + ' · ' + ip;
    });
  });

  /* ------------------------------------------------------------- the tabs */
  const FANER = [['egenskaper', 'Egenskaper', 'Properties'], ['skriv', 'Skriv', 'Write'], ['mer', 'Historikk', 'History']];
  function hvilken(sect) {
    if (sect.querySelector('.wf, #writeVal, .ro-notice') || /^(Skriv verdi|Write value)/.test(sect.querySelector('.sect-head')?.textContent.trim() || '')) return 'skriv';
    if (sect.id === 'alleSect' || /^(Egenskaper|Properties|Prioritetsarray|Priority array)/.test(sect.querySelector('.sect-head')?.textContent.trim() || '')) return 'egenskaper';
    return 'mer';
  }
  function faner() {
    const el = $('inspector');
    if (!el || !S.selected || !S.pointIndex.get(S.selected)) return;
    const sekter = [...el.querySelectorAll(':scope > .sect')].filter(s => !s.hidden && s.textContent.trim());
    if (sekter.length < 2 || el.querySelector('.insp-faner')) return;
    const per = {};
    sekter.forEach(s => { const f = hvilken(s); s.dataset.fane = f; (per[f] = per[f] || []).push(s); });
    const finnes = FANER.filter(([id]) => per[id]);
    if (finnes.length < 2) { sekter.forEach(s => delete s.dataset.fane); return; }
    let valgt = loadPrefs().inspFane;
    if (!per[valgt]) valgt = finnes[0][0];
    const rad = document.createElement('div');
    rad.className = 'insp-faner';
    rad.setAttribute('role', 'tablist');
    rad.innerHTML = finnes.map(([id, nb, en]) => `<button type="button" role="tab" data-if="${id}">${T(nb, en)}</button>`).join('');
    sekter[0].before(rad);
    const vis = (id) => {
      rad.querySelectorAll('button').forEach(b => { const s = b.dataset.if === id; b.classList.toggle('sel', s); b.setAttribute('aria-selected', s); });
      sekter.forEach(s => s.classList.toggle('skjult-fane', s.dataset.fane !== id));
    };
    rad.onclick = (e) => { const b = e.target.closest('[data-if]'); if (!b) return; savePrefs({inspFane: b.dataset.if}); vis(b.dataset.if); };
    vis(valgt);
  }
  etter('renderInspector', faner);
  window.nabeFlater = {faner, synk};
})();
