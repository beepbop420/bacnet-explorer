/* NABE - ask NABE. Answers from what NABE has already read and from the
   reference in nabe-kunnskap.js. Runs on this PC: nothing leaves it, it works
   on a closed plant network, and it says so when it does not know. With the
   local AI on, the AI words the answer, but only from a source shown under it,
   and with no source it is not asked. Opened from the palette or by clicking
   the little NABE by the arrow (Garderobe > Peker > Spør NABE), who then talks in a speech bubble. */
'use strict';

(function sporNabe() {
  const pluss = (l) => { const [nb, en] = l[Math.floor(Math.random() * l.length)]; return T(nb, en); };
  const HILSEN = [
    ['Ja? Jeg telte akkurat til 47808.', 'Yes? I had just counted to 47808.'],
    ['Du vekket meg. Håper det er en god grunn.', 'You woke me. I hope it is for a good reason.'],
    ['Spør i vei. Jeg later som jeg tenker.', 'Ask away. I will pretend to think.'],
    ['NABO sier du burde spurt ham. Han tar feil.', 'NABO says you should have asked him. He is wrong.'],
    ['Takk for at du stoppet. Jeg er ikke laget for løping.', 'Thanks for stopping. I was not built for running.'],
    ['Hvis det gjelder prioritet 8, var det ikke meg.', 'If this is about priority 8, it was not me.'],
  ];
  const VET_IKKE = [
    ['Det står ikke i boka mi. Jeg spurte NABO, og han sa ping.', 'That is not in my book. I asked NABO, and he said ping.'],
    ['Aner ikke. Men jeg nikker overbevisende.', 'No idea. But I am nodding convincingly.'],
    ['Der gikk jeg tom. Prøv med et ord fra faget.', 'I am out of ideas. Try a word from the trade.'],
  ];
  const INGEN = [
    ['Mistenkelig stille.', 'Suspiciously quiet.'],
    ['Enten er alt bra, eller så har noen koblet fra ledningen.', 'Either all is well, or someone has pulled the wire.'],
    ['Jeg sjekket to ganger. Det ene var på liksom.', 'I checked twice. Once was pretend.'],
  ];
  const FORSLAG = [['Hva er overstyrt?', 'What is overridden?'], ['Er noe i alarm?', 'Is anything in alarm?'], ['Hvor mange punkter?', 'How many points?'], ['Hva betyr prioritet 8?', 'What does priority 8 mean?'], ['Finn RT401', 'Find RT401']];

  /* The reference: words of the question against an article's own words,
     title and text. A question that hits nothing strongly gets nothing. */
  const STOPP = new Set('hva hvor hvem hvordan hvorfor når er det den de en et på i og å til for med av om kan jeg du vi skal må har betyr står the a an is are what how why when where do does of to in on and can i you'.split(' '));
  const ordene = (s) => s.toLowerCase().replace(/[?.,!:;()]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOPP.has(w));
  const INDEKS = KUNNSKAP.map(k => ({k, n: k.n.toLowerCase().split(/\s+/), t: (k.t[0] + ' ' + k.t[1]).toLowerCase(), x: (k.x[0] + ' ' + k.x[1]).toLowerCase()}));
  const slaaOpp = (q) => {
    const w = ordene(q);
    return INDEKS.map(i => {
      let p = 0;
      for (const o of w) {
        if (i.n.includes(o)) p += 4;
        else if (o.length > 3 && i.n.some(n => n.startsWith(o) || o.startsWith(n) && n.length > 3)) p += 3;
        if (i.t.includes(o)) p += 2;
        if (o.length > 2 && i.x.includes(o)) p += 1;
      }
      return {k: i.k, p};
    }).filter(r => r.p >= 4).sort((a, b) => b.p - a.p).filter((r, _, l) => r.p >= l[0].p * .6).slice(0, 2).map(r => r.k);
  };
  const artikkel = (k) => `<div class="sp-kilde"><small>${esc(k.emne)}</small><b>${esc(T(k.t[0], k.t[1]))}</b>${esc(T(k.x[0], k.x[1]))}</div>`;
  let nr = 0;
  // The source stands by itself at once; the AI's wording arrives above it.
  async function kiOver(q, kilder, n) {
    let s = {};
    try { s = await (await fetch('/api/ki')).json(); } catch {}
    const ut = lag.querySelector('.sp-ki');
    if (s.tilstand !== 'klar' || !ut) { ut?.remove(); return; }
    ut.innerHTML = `<small>${T('Lokal KI formulerer…', 'The local AI is wording it…')}</small>`;
    const r = await api('/api/ki/svar', {sporsmal: q, kilder: kilder.map(k => T(k.x[0], k.x[1]))}).catch(() => ({}));
    if (n !== nr) return;
    if (r.status !== 'done') { ut.remove(); return; }
    ut.innerHTML = `${esc(r.tekst)}<small>${T('Forslag fra lokal KI. Sjekk mot kilden under.', 'A suggestion from the local AI. Check it against the source below.')}</small>`;
  }

  const alle = () => Object.entries(S.cache || {}).flatMap(([ip, pts]) => (pts || []).map(p => ({ip, p})));
  const enhet = (ip) => { const d = S.devices.find(x => x.address === ip); return (d && d.object_name) || ip; };
  const navn = (p) => p.name || p.object_name || p.objid;
  const lestAv = () => T(`av ${Object.keys(S.cache || {}).length} leste enheter`, `of ${Object.keys(S.cache || {}).length} devices read`);
  const liste = (treff, maks = 8) => `<div class="sp-liste">${treff.slice(0, maks).map(({ip, p}) =>
    `<button type="button" class="sp-rad" data-ip="${esc(ip)}" data-objid="${esc(p.objid)}"><b>${esc(navn(p))}</b><span>${esc(enhet(ip))}${p.value === undefined || p.value === null ? '' : ` · ${esc(String(p.value))}${p.unit_symbol ? ' ' + esc(p.unit_symbol) : ''}`}</span></button>`).join('')}</div>
    ${treff.length > maks ? `<p>${T(`…og ${treff.length - maks} til.`, `…and ${treff.length - maks} more.`)}</p>` : ''}`;
  const flagg = (f, nb, en) => {
    const t = alle().filter(({p}) => hasFlag(p, f));
    return t.length ? `<p>${T(`${t.length} ${nb} ${lestAv()}:`, `${t.length} ${en} ${lestAv()}:`)}</p>${liste(t)}`
                    : `<p>${T(`Ingen ${nb} ${lestAv()}.`, `None ${en} ${lestAv()}.`)} ${pluss(INGEN)}</p>`;
  };
  const sok = (ord) => {
    const o = ord.toLowerCase().split(/\s+/).filter(x => x.length > 1);
    return o.length ? alle().filter(({p}) => { const s = `${navn(p)} ${p.description || ''} ${p.objid}`.toLowerCase(); return o.every(w => s.includes(w)); }) : [];
  };

  async function svar(q) {
    const s = q.toLowerCase().trim();
    const kilder = slaaOpp(s);
    const kilde = () => { kiNeste = {q, kilder}; return `<div class="sp-ki"></div>${kilder.map(artikkel).join('')}`; };
    if (/betyr|hva er|what is|what does|mean|forklar|explain|hvordan|how|forskjell|difference/.test(s) && kilder.length) return kilde();
    if (/overstyr|override|manuell|manual/.test(s)) {
      let mine = [];
      try { mine = (await (await fetch('/api/mine')).json()).overstyrt || []; } catch {}
      return flagg('overridden', 'overstyrte', 'overridden')
        + (mine.length ? `<p>${T(`${mine.length} av dem har du satt selv, og de må frigis før du går.`, `${mine.length} of them you set yourself, and they need releasing before you leave.`)}</p>` : '');
    }
    if (/alarm/.test(s)) return flagg('in-alarm', 'i alarm', 'in alarm');
    if (/\bfeil\b|fault/.test(s)) return flagg('fault', 'med feil', 'with faults');
    if (/ute av drift|out.of.service/.test(s)) return flagg('out-of-service', 'ute av drift', 'out of service');
    if (/hvor mange|how many|antall/.test(s)) {
      const lest = Object.keys(S.cache || {}).length;
      return `<p>${T(`${S.devices.length} enheter, ${lest} av dem lest, med ${alle().length} punkter.`, `${S.devices.length} devices, ${lest} of them read, with ${alle().length} points.`)}</p>`;
    }
    if (/skrev|skrevet|skrivelogg|write log|wrote/.test(s)) {
      const l = ((await (await fetch('/api/writelog')).json()).entries || []).slice(0, 5);
      if (!l.length) return `<p>${T('Ingenting skrevet ennå.', 'Nothing written yet.')}</p>`;
      return `<p>${T('Det siste du skrev:', 'The last you wrote:')}</p><div class="sp-liste">${l.map(e => `<div class="sp-rad"><b>${esc(e.objid || '')}</b><span>${esc(String(e.address || ''))} · ${esc(String(e.value))}${e.priority ? ` · pri ${esc(String(e.priority))}` : ''}</span></div>`).join('')}</div>`;
    }
    if (/opptak|record/.test(s)) { lukk(); aapneOpptak(); return ''; }
    if (/svarer ikke|ikke svar|not respond|no answer|nede\b/.test(s))
      return `${kilde()}<button type="button" class="btn" data-spor-diag>${T('Sjekk en adresse', 'Check an address')}</button>`;
    if (/hjelp|help|hva kan du|what can you/.test(s))
      return `<p>${T('Jeg ser det NABE har lest: overstyrte punkter, alarmer, feil, antall, og hvor et punkt er. Jeg kan også forklare BACnet-ord og vise det du har skrevet. Alt skjer på denne PC-en.', 'I see what NABE has read: overridden points, alarms, faults, counts, and where a point is. I can also explain BACnet words and show what you have written. It all happens on this PC.')}</p>`;
    const ren = s.replace(/^(hvor er|finn|søk etter|søk|where is|find|search for|search|hva er verdien på|verdien på|what is the value of)\s+/, '').replace(/[?.!]+$/, '');
    if (kilder.length && !/^(hvor er|finn|find|where is)\b/.test(s)) return kilde();
    const treff = sok(ren);
    if (treff.length) return `<p>${T(`${treff.length} treff ${lestAv()}:`, `${treff.length} hits ${lestAv()}:`)}</p>${liste(treff)}`;
    if (kilder.length) return kilde();
    return `<p>${pluss(VET_IKKE)}</p>`;
  }

  let lag = null, kiNeste = null;
  function lukk() { if (lag) lag.hidden = true; PK.ro.hold = false; PK.fig.classList.remove('klikkbar'); }
  async function spor(q) {
    if (!q.trim()) return;
    const ut = lag.querySelector('.sp-svar');
    const kropp = await svar(q).catch(() => `<p>${T('Noe gikk galt der.', 'Something went wrong there.')}</p>`);
    if (kropp) ut.innerHTML = `<div class="sp-q">${esc(q)}</div>${kropp}`;
    const n = ++nr;
    if (kiNeste) { kiOver(kiNeste.q, kiNeste.kilder, n); kiNeste = null; }
  }
  function aapne(ved) {
    if (!lag) {
      lag = document.createElement('div');
      lag.id = 'sporNabe';
      lag.className = 'sp-panel';
      lag.setAttribute('role', 'dialog');
      document.body.append(lag);
      lag.addEventListener('click', async (e) => {
        if (e.target.closest('.gs-close')) return lukk();
        const f = e.target.closest('[data-forslag]');
        if (f) { lag.querySelector('input').value = f.dataset.forslag; return spor(f.dataset.forslag); }
        if (e.target.closest('[data-spor-diag]')) { lukk(); return $('diagBtn').click(); }
        const r = e.target.closest('button.sp-rad');
        if (r) { lukk(); await selectDevice(r.dataset.ip); await selectPoint(r.dataset.objid); }
      });
      // Typing here is not a shortcut for the table behind.
      lag.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') lukk();
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') spor(e.target.value);
      });
    }
    lag.innerHTML = `<div class="sp-topp"><span class="gd-tittel">${T('Spør NABE', 'Ask NABE')}</span><button class="gs-close"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <input class="field" type="text" placeholder="${esc(T('Spør om anlegget eller et BACnet-ord', 'Ask about the site or a BACnet word'))}" autocomplete="off" spellcheck="false">
      <div class="sp-svar">${ved && ved.left !== undefined ? `<p class="sp-hilsen">${esc(pluss(HILSEN))}</p>` : ''}<div class="sp-forslag">${FORSLAG.map(([nb, en]) => `<button type="button" class="btn" data-forslag="${esc(T(nb, en))}">${esc(T(nb, en))}</button>`).join('')}</div></div>`;
    lag.hidden = false;
    // From the bubble it opens where the bubble was, as more of the same.
    const her = ved && ved.left !== undefined;
    lag.classList.toggle('ved', !!her);
    lag.style.left = lag.style.top = lag.style.maxHeight = '';
    if (her) {
      const b = lag.offsetWidth, topp = Math.max(12, Math.min(ved.top, innerHeight - 300));
      lag.style.left = `${Math.max(12, Math.min(ved.left, innerWidth - b - 12))}px`;
      lag.style.top = `${topp}px`;
      lag.style.maxHeight = `${innerHeight - topp - 12}px`;
    }
    lag.querySelector('input').focus();
  }

  /* Standing still for him. He follows the arrow while the hand moves; rest it
     a moment and he stops right beside it and can be clicked, and stays until
     the arrow is well away. Nothing pops up: he is just there to be caught. */
  const fig = PK.fig, HVILE = 350, SLIPP = 170;
  let hvile = 0, roX = 0, roY = 0;
  const stans = () => { if (PK.tilstand().id === 'spor-nabe') { PK.ro.hold = true; fig.classList.add('klikkbar'); } };
  const slipp = () => { PK.ro.hold = false; fig.classList.remove('klikkbar'); };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (PK.ro.hold) {
      if (lag && !lag.hidden) return;
      const r = fig.getBoundingClientRect();
      if (Math.hypot(e.clientX - r.left - 15, e.clientY - r.top - 15) > SLIPP) slipp();
      return;
    }
    // A hand on a mouse is never quite still: a few pixels is still resting.
    if (Math.hypot(e.clientX - roX, e.clientY - roY) < 6) return;
    roX = e.clientX; roY = e.clientY;
    clearTimeout(hvile);
    hvile = setTimeout(stans, HVILE);
  }, {passive: true});
  fig.addEventListener('click', () => {
    const r = fig.getBoundingClientRect();
    aapne({left: r.right + 12, top: r.top - 8});
  });
  /* The setting: install, watch it come, take it away again. */
  const KI_TEKST = {motor: ['henter motor', 'fetching engine'], modell: ['laster ned', 'downloading'], sjekk: ['sjekker fila', 'checking the file'], test: ['måler farten', 'measuring speed']};
  let kiVakt = 0;
  async function kiVis() {
    const s = await (await fetch('/api/ki')).json().catch(() => ({}));
    const el = $('kiState');
    clearTimeout(kiVakt);
    if (s.tilstand === 'laster') kiVakt = setTimeout(kiVis, 2000);
    if (!el) return s;
    const st = KI_TEKST[s.steg];
    el.textContent = s.tilstand === 'laster' ? `${st ? T(st[0], st[1]) : ''}${s.steg === 'modell' ? ` ${Math.round(s.fremdrift * 100)} %` : ''}`
      : s.tilstand === 'klar' ? T('på', 'on') : s.tilstand === 'treg' ? T('for treg', 'too slow')
      : s.tilstand === 'feil' ? T('feilet', 'failed') : T('av', 'off');
    return s;
  }
  $('kiBtn').onclick = async () => {
    const s = await kiVis();
    if (s.tilstand === 'laster') return;
    if (s.tilstand === 'klar' || s.tilstand === 'treg') {
      const tekst = s.tilstand === 'treg'
        ? T(`Denne PC-en klarer bare ${s.tok_s} tokens i sekundet, så NABE lar KI-en stå av. Fjerne den og få igjen 5 GB?`, `This PC only manages ${s.tok_s} tokens a second, so NABE leaves the AI off. Remove it and get 5 GB back?`)
        : T(`Lokal KI er på (${s.tok_s} tokens i sekundet). Fjerne den og få igjen 5 GB?`, `The local AI is on (${s.tok_s} tokens a second). Remove it and get 5 GB back?`);
      if (confirm(tekst)) { await api('/api/ki/fjern', {}); kiVis(); }
    } else if (confirm(T('Laste ned lokal KI? Det er 5 GB, og alt kjører på denne PC-en. Svarene er forslag og vises med kilden sin.', 'Download the local AI? It is 5 GB, and all of it runs on this PC. Answers are suggestions and shown with their source.'))) {
      await api('/api/ki/installer', {});
      setTimeout(kiVis, 400);
    }
  };
  etter('openTema', kiVis);
  kiVis();
  /* The way that never depends on timing or on hitting anything that moves: a
     button that stays in the top bar, and Ctrl+J. */
  const veksle = () => {
    if (lag && !lag.hidden) { lukk(); return; }
    aapne();
  };
  $('sporBtn').onclick = veksle;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); e.stopPropagation(); veksle(); }
  }, true);
  window.aapneSpor = () => aapne();
})();
