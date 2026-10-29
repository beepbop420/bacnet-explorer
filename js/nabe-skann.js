/* NABE - the scan box, rebuilt around one field.

   You type an address, a range or the name of a building. The sites you have
   been to stand under the field with a dot that says whether a route goes
   there right now, so the list answers "can I get there" before you click.
   Adapter and mode are one line you rarely touch; when Windows would have
   picked the wrong way NABE says so and takes the right one.

   The box also keeps an eye on things while you do something else: a tunnel
   coming up, a site you left overridden, a building with fewer controllers
   than last time. NABE and NABO react to it, briefly and in their own way.
   Loaded after nabe-finn.js and shares its globals. */
'use strict';

const SK = {
  anlegg: [], rader: [], valgt: -1, apen: false, rute: null, ruteFor: '',
  naabar: new Map(), forste: true, tastatur: false, skannIDag: {}, svar: 0,
  forrigeSvar: 0, t0: 0, sistSkrevet: 0,
};

/* ------------------------------------------------------------ the parts */
(function bygg() {
  const boks = document.querySelector('.scanbox');
  const ri = $('rangeInput');
  if (!boks || !ri) return;
  boks.classList.add('skann-ny');
  // The list under the field replaces the browser's own suggestion popup.
  ri.removeAttribute('list');
  ri.placeholder = T('IP, område eller anlegg', 'IP, range or site');
  ri.setAttribute('aria-controls', 'anleggListe');
  ri.setAttribute('aria-autocomplete', 'list');

  const lag = (tag, id, cls, html = '') => {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (cls) el.className = cls;
    el.innerHTML = html;
    return el;
  };
  const fremdrift = lag('span', 'feltFremdrift', 'felt-fremdrift');
  fremdrift.setAttribute('aria-live', 'polite');
  const vei = lag('div', 'veiLinje', 'vei-linje');
  const vakt = lag('div', 'rutevakt', 'rutevakt');
  vakt.hidden = true;
  const bbmd = lag('div', 'bbmdSeg', 'bbmd-seg', `
    <button type="button" data-m="auto">Auto</button>
    <button type="button" data-m="bbmd">${T('Via BBMD', 'Via BBMD')}</button>`);
  bbmd.hidden = true;
  const panel = lag('div', 'kortPanel', 'kort-panel');
  panel.hidden = true;
  panel.innerHTML = `<div class="kp-kort" id="kpKort"></div>
    <label class="kp-modus"><span>${T('Modus', 'Mode')}</span></label>`;
  panel.querySelector('.kp-modus').appendChild($('modeSel'));
  panel.appendChild($('localAddr'));
  const liste = lag('div', 'anleggListe', 'anlegg-liste');
  liste.setAttribute('role', 'listbox');

  ri.after(fremdrift);
  // BBMD and "check one" are the two small tools for a single address.
  const verktoy = lag('div', null, 'sk-verktoy');
  verktoy.append(bbmd, $('diagKjapp'));
  $('scanBtn').after(vei, vakt, verktoy, panel);
  $('omrForslag')?.after(liste);

  vei.addEventListener('click', (e) => { if (e.target.closest('.vei-endre')) settApen(!SK.apen); });
  bbmd.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    $('modeSel').value = b.dataset.m;
    $('modeSel').dispatchEvent(new Event('change'));
    tegnVei();
    if (b.dataset.m === 'bbmd') nabeSier(T('Via BBMD. Da får vi hele bygget, også MS/TP bak ruterne.',
      'Via BBMD. That gets the whole building, MS/TP behind the routers too.'), 'fornoyd', 'bbmd-valgt');
  });
  panel.addEventListener('click', async (e) => {
    const k = e.target.closest('.kp-rad');
    if (!k || k.classList.contains('i-bruk')) return;
    k.classList.add('plugg');
    figur('klem', 400);
    await connectTo(k.dataset.cidr);
    nabeSier(T(`Sender fra ${k.dataset.navn} nå.`, `Sending from ${k.dataset.navn} now.`), 'fornoyd');
    tegnKort(); tegnVei();
  });
  liste.addEventListener('click', (e) => {
    const r = e.target.closest('.an-rad');
    if (r) bruk(SK.rader[+r.dataset.i], {skann: true});
  });
  liste.addEventListener('mouseover', (e) => {
    if (e.target.closest('.an-over')) nabeKlasse('nervos', 1200);
  });
})();

/* ---------------------------------------------------------- the road */
SK.kort = [];
function kortNavn(ip) {
  const liste = (KORTVAKT.liste || []).length ? KORTVAKT.liste : SK.kort;
  return (liste.find(i => i.ip === ip) || {}).interface || '';
}
fetch('/api/interfaces').then(r => r.json()).then(d => { SK.kort = d.interfaces || []; tegnVei(); }).catch(() => {});

function tegnVei() {
  const el = $('veiLinje');
  if (!el) return;
  const ip = SK.rute?.ip || String(S.localAddr || '').split(/[/:]/)[0];
  const navn = SK.rute?.interface || kortNavn(ip);
  const modus = $('modeSel').value;
  const mtekst = modus === 'auto' ? 'auto' : $('modeSel').selectedOptions[0]?.textContent.toLowerCase();
  el.innerHTML = ip
    ? `<span class="vei-tekst">via <b>${esc(navn || ip)}</b>${navn ? ` <span class="mono">${esc(ip)}</span>` : ''} · ${esc(mtekst)}</span>
       <button type="button" class="vei-endre">${SK.apen ? T('lukk', 'close') : T('endre', 'change')}</button>`
    : `<span class="vei-tekst">${T('Ingen nettverkskort i bruk', 'No adapter in use')}</span>
       <button type="button" class="vei-endre">${T('velg', 'pick')}</button>`;
  tegnBbmd();
}

async function tegnKort() {
  const boks = $('kpKort');
  if (!boks) return;
  let liste = KORTVAKT.liste || [];
  if (!liste.length) {
    try { liste = (await (await fetch('/api/interfaces')).json()).interfaces || []; } catch {}
  }
  const bundet = String(S.localAddr || '').split(/[/:]/)[0];
  boks.innerHTML = liste.map(k => `
    <button type="button" class="kp-rad${k.ip === bundet ? ' i-bruk' : ''}" data-cidr="${esc(k.cidr)}" data-navn="${esc(k.interface)}">
      <b>${esc(k.interface)}</b><span class="mono">${esc(k.cidr)}</span>
      <span class="kp-merke">${k.ip === bundet ? T('i bruk', 'in use') : (k.prefix === 32 ? 'VPN' : '')}</span>
    </button>`).join('') || `<div class="lite">${T('Fant ingen nettverkskort', 'No adapters found')}</div>`;
}

function settApen(apen) {
  SK.apen = apen;
  $('kortPanel').hidden = !apen;
  document.querySelector('.scanbox')?.classList.toggle('apen', apen);
  if (apen) { tegnKort(); figur('lurer', 900); blikk(0, 2.4, 900); }
  tegnVei();
}

/* BBMD only when it could matter: one bare address in the field, a site
   that was scanned that way, or the mode already set to it. */
function tegnBbmd() {
  const seg = $('bbmdSeg');
  if (!seg) return;
  const omr = parseRanges($('rangeInput').value);
  const enIp = omr.length === 1 && !/[/\-*]/.test(omr[0]) && /^\d+\.\d+\.\d+\.\d+$/.test(omr[0]);
  const modus = $('modeSel').value;
  const site = SK.anlegg.find(a => a.key === omr.slice().sort().join(' '));
  const vis = enIp || modus === 'bbmd' || site?.modus === 'bbmd';
  const var_ = !seg.hidden;
  seg.hidden = !vis;
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('sel',
    b.dataset.m === (modus === 'bbmd' ? 'bbmd' : 'auto')));
  if (vis && !var_ && enIp && modus !== 'bbmd') {
    nabeSier(T('Én IP. Er det byggets BBMD, gir «Via BBMD» deg hele bygget.',
      'One IP. If it is the building\'s BBMD, "Via BBMD" gets you all of it.'), null, 'bbmd-tips');
  }
}

/* -------------------------------------------------------- route guard
   kort_for already sends from the right adapter. This says when that was
   not what Windows would have done, because then "no answers" would have
   been a routing fault and not the plant. */
let ruteTimer = 0;
function sjekkRute() {
  clearTimeout(ruteTimer);
  ruteTimer = setTimeout(async () => {
    const omr = parseRanges($('rangeInput').value)[0] || '';
    if (!/^\d+\.\d+\.\d+\.\d+/.test(omr)) { SK.rute = null; SK.ruteFor = ''; visVakt(null); tegnVei(); return; }
    if (omr === SK.ruteFor) return;
    let r = null;
    try { r = await (await fetch('/api/route?target=' + encodeURIComponent(omr))).json(); } catch {}
    SK.ruteFor = omr;
    SK.rute = r && r.status === 'done' ? r : null;
    tegnVei();
    const site = SK.anlegg.find(a => a.key.split(' ').includes(omr));
    if (SK.rute && SK.rute.windows && SK.rute.windows !== SK.rute.ip) {
      visVakt('advar', T(
        `Windows ville gått via <b>${esc(SK.rute.windows_interface || SK.rute.windows)}</b>. NABE bruker <b>${esc(SK.rute.interface || SK.rute.ip)}</b> i stedet.`,
        `Windows would have gone via <b>${esc(SK.rute.windows_interface || SK.rute.windows)}</b>. NABE uses <b>${esc(SK.rute.interface || SK.rute.ip)}</b> instead.`));
      nabeSier(T('Windows ville tatt feil vei. Ikke i dag.', 'Windows wanted the wrong way. Not today.'), 'skvatt', 'rute:' + omr);
    } else if (site && !site.naabar) {
      visVakt('av', T('Ingen kabel eller VPN går dit nå. Er tunnelen oppe?',
        'No cable or VPN goes there right now. Is the tunnel up?'));
    } else visVakt(null);
  }, 350);
}

function visVakt(type, html) {
  const el = $('rutevakt');
  if (!el) return;
  if (!type) { el.hidden = true; return; }
  el.className = 'rutevakt ' + type;
  el.innerHTML = html;
  if (el.hidden) { el.hidden = false; spill(el, 'inn', 400); }
}

/* --------------------------------------------------------- the sites */
function naarKort(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const dager = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (dager <= 0) return T('i dag', 'today');
  if (dager === 1) return T('i går', 'yesterday');
  if (dager < 14) return T(`${dager} dager siden`, `${dager} days ago`);
  return d.toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'no', {day: 'numeric', month: 'short'});
}

function erIpTekst(s) { return /^[\d.\/\-\s,;*xX]+$/.test(s); }

function treffAnlegg(q) {
  const ord = q.toLowerCase().split(/\s+/).filter(Boolean);
  return SK.anlegg.filter(a => {
    const tekst = [a.navn, a.key, ...(a.leverandorer || []).map(l => l[0]), ...(a.navnliste || [])]
      .join(' ').toLowerCase();
    return ord.every(o => tekst.includes(o));
  });
}

function byggRader() {
  const q = $('rangeInput').value.trim();
  const ql = q.toLowerCase();
  const rader = [];
  if (ql === 'nabo') rader.push({type: 'nabo'});
  if (ql === '?') { rader.push({type: 'tips'}); return rader; }
  if (!q) {
    for (const a of SK.anlegg.slice(0, 5)) rader.push({type: 'anlegg', a});
    // Routes of the adapter in use that are not a site yet: usually the
    // building you have not scanned before.
    for (const r of (FORSLAG.data?.ruter || [])) {
      if (rader.length >= 7) break;
      if (SK.anlegg.some(a => a.key.split(' ').includes(r.cidr))) continue;
      rader.push({type: 'rute', r});
    }
    return rader;
  }
  const treff = erIpTekst(q)
    ? SK.anlegg.filter(a => a.key.includes(q.replace(/[\s,;]+$/, '')))
    : treffAnlegg(q);
  for (const a of treff.slice(0, 6)) rader.push({type: 'anlegg', a});
  if (!rader.length && !erIpTekst(q)) rader.push({type: 'ingen', q});
  return rader;
}

function radHtml(r, i) {
  const valgt = i === SK.valgt ? ' valgt' : '';
  if (r.type === 'nabo') return `<button type="button" class="an-rad${valgt}" data-i="${i}" role="option">
      <span class="prikk ok"></span><span class="an-navn"><span class="an-tittel">NABO</span>
      <span class="an-under">${T('bor ved siden av · åpner NABO', 'lives next door · opens NABO')}</span></span><span class="an-ip">127.0.0.1</span></button>`;
  if (r.type === 'tips') return `<div class="an-tips">${T(
      'Skriv en IP, et område (10.1.2.0/24, 10.1.2.10-40) eller navnet på et anlegg. ↓ velger, Enter skanner, Esc stopper, Ctrl+L hopper hit.',
      'Type an IP, a range (10.1.2.0/24, 10.1.2.10-40) or a site name. ↓ picks, Enter scans, Esc stops, Ctrl+L jumps here.')}</div>`;
  if (r.type === 'ingen') return `<div class="an-tips">${T(
      `Ingen anlegg heter «${esc(r.q)}». Skriv en IP for et nytt.`,
      `No site called "${esc(r.q)}". Type an IP for a new one.`)}</div>`;
  if (r.type === 'rute') return `<button type="button" class="an-rad${valgt}" data-i="${i}" role="option">
      <span class="prikk ok"></span><span class="an-navn"><span class="an-tittel mono">${esc(r.r.cidr)}</span>
      <span class="an-under">${r.r.egen ? T('eget nett · ikke skannet før', 'own subnet · not scanned yet')
        : T('rute gjennom kortet · ikke skannet før', 'routed through the adapter · not scanned yet')}</span></span></button>`;
  const a = r.a;
  const n = a.naabar;
  const deler = [`${a.enheter} ${a.enheter === 1 ? T('enhet', 'device') : T('enheter', 'devices')}`, naarKort(a.sist)];
  if (a.overstyrt) deler.push(`<span class="an-over">${a.overstyrt} ${T('overstyrt', 'overridden')}</span>`);
  if (!n) deler.push(T('ingen rute nå', 'no route now'));
  else if (a.leverandorer?.length) deler.push(esc(a.leverandorer.map(l => `${l[0]} ${l[1]}`).join(' · ')));
  const tittel = n ? T(`Nåbar via ${n.interface} ${n.ip}`, `Reachable via ${n.interface} ${n.ip}`)
    : T('Ingen kabel eller VPN går dit nå', 'No cable or VPN goes there right now');
  return `<button type="button" class="an-rad${valgt}${n ? '' : ' av'}${SK.naabar.get(a.key) === 'ny' ? ' ny-naabar' : ''}" data-i="${i}" role="option" title="${esc(tittel)}">
      <span class="prikk${n ? ' ok' : ''}"></span>
      <span class="an-navn"><span class="an-tittel">${esc(a.navn || a.key)}</span><span class="an-under">${deler.join(' · ')}</span></span>
      ${a.navn ? `<span class="an-ip">${esc(a.key.split(' ')[0])}${a.key.includes(' ') ? ' …' : ''}</span>` : ''}</button>`;
}

function tegnListe() {
  const el = $('anleggListe');
  if (!el) return;
  const forrige = SK.rader.map(r => r.a?.key || r.type).join('|');
  SK.rader = byggRader();
  const klikkbare = SK.rader.filter(r => r.type === 'anlegg' || r.type === 'rute' || r.type === 'nabo').length;
  if (SK.valgt >= klikkbare) SK.valgt = klikkbare - 1;
  el.hidden = !SK.rader.length || document.body.classList.contains('skanner');
  el.innerHTML = (!$('rangeInput').value.trim() && SK.anlegg.length
    ? `<div class="an-hode">${T('Anlegg', 'Sites')}</div>` : '') + SK.rader.map(radHtml).join('');
  // Rows come in one after another the first time, not on every keystroke.
  const naa = SK.rader.map(r => r.a?.key || r.type).join('|');
  if (naa !== forrige && SK.forste && !bevegelseAv()) {
    SK.forste = false;
    el.querySelectorAll('.an-rad').forEach((r, i) => {
      r.animate([{opacity: 0, transform: 'translateY(4px)'}, {opacity: 1, transform: 'none'}],
        {duration: 260, delay: 40 * i, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards'});
    });
  }
}

/* The list refreshes on its own every few seconds. What changed is what the
   app has to say: a site that just became reachable, or one that dropped. */
async function hentAnlegg() {
  if (document.hidden || S.scanJob) return;
  let d;
  try { d = await (await fetch('/api/anlegg', {cache: 'no-store'})).json(); } catch { return; }
  if (!d || d.status !== 'done') return;
  const forste = !SK.anlegg.length && !SK.lastet;
  SK.lastet = true;
  const ble = [], borte = [];
  for (const a of d.anlegg) {
    const var_ = SK.naabar.get(a.key);
    if (var_ === undefined) { SK.naabar.set(a.key, a.naabar ? 'ja' : 'nei'); continue; }
    if (a.naabar && var_ === 'nei') { ble.push(a); SK.naabar.set(a.key, 'ny'); }
    else if (!a.naabar && var_ !== 'nei') { borte.push(a); SK.naabar.set(a.key, 'nei'); }
    else if (a.naabar && var_ === 'ny') SK.naabar.set(a.key, 'ja');
  }
  SK.anlegg = d.anlegg;
  tegnListe();
  tegnBbmd();
  if (forste) proaktivStart();
  const tomt = !$('rangeInput').value.trim();
  if (ble.length) {
    const a = ble[0];
    figur('hopp', 550);
    if (tomt) {
      const i = SK.rader.findIndex(r => r.a?.key === a.key);
      if (i >= 0) { SK.valgt = i; tegnListe(); }
    }
    nabeSier(T(`${a.navn || a.key} er innen rekkevidde nå.${tomt ? ' Enter i feltet skanner.' : ''}`,
      `${a.navn || a.key} is in reach now.${tomt ? ' Enter in the field scans it.' : ''}`), 'fornoyd');
  } else if (borte.length && borte.length < 4) {
    figur('dukk', 450);
    nabeSier(T(`Mistet veien til ${borte[0].navn || borte[0].key}.`, `Lost the way to ${borte[0].navn || borte[0].key}.`), 'trist');
  }
}
setInterval(hentAnlegg, 6000);
setTimeout(hentAnlegg, 600);

/* On start, once: the site you can reach, and what you left overridden. */
function proaktivStart() {
  const naabare = SK.anlegg.filter(a => a.naabar);
  const igjen = SK.anlegg.find(a => a.overstyrt && a.naabar) || SK.anlegg.find(a => a.overstyrt);
  setTimeout(() => {
    if (igjen) {
      nabeSier(T(`${igjen.overstyrt} ${igjen.overstyrt === 1 ? 'punkt står' : 'punkter står'} fortsatt overstyrt på ${igjen.navn || igjen.key}.`,
        `${igjen.overstyrt} ${igjen.overstyrt === 1 ? 'point is' : 'points are'} still overridden at ${igjen.navn || igjen.key}.`), 'nervos', 'igjen:' + igjen.key);
      return;
    }
    if (naabare.length === 1 && !$('rangeInput').value.trim() && !S.devices.length) {
      SK.valgt = SK.rader.findIndex(r => r.a?.key === naabare[0].key);
      tegnListe();
      nabeSier(T(`${naabare[0].navn || naabare[0].key} er nåbar. Enter i feltet, så er vi i gang.`,
        `${naabare[0].navn || naabare[0].key} is reachable. Enter in the field and we are off.`), 'fornoyd', 'start-naabar');
    }
  }, 4200);
  // Nothing typed after a while: the field suggests the reachable site in
  // its placeholder, a letter at a time.
  setTimeout(() => {
    const a = SK.anlegg.find(x => x.naabar);
    const ri = $('rangeInput');
    if (!a || ri.value || S.devices.length || document.activeElement === ri || bevegelseAv()) return;
    skrivPlassholder(ri, (a.navn || a.key) + ' ↵');
  }, 22000);
}

function skrivPlassholder(ri, tekst) {
  let i = 0;
  const steg = () => {
    if (ri.value) { ri.placeholder = T('IP, område eller anlegg', 'IP, range or site'); return; }
    ri.placeholder = tekst.slice(0, ++i);
    if (i < tekst.length) setTimeout(steg, 55 + Math.random() * 60);
    else setTimeout(() => { if (!ri.value) ri.placeholder = T('IP, område eller anlegg', 'IP, range or site'); }, 9000);
  };
  steg();
}

/* --------------------------------------------------------- picking one */
function bruk(r, {skann = false} = {}) {
  if (!r) return;
  if (r.type === 'nabo') {
    $('rangeInput').value = '';
    tegnListe();
    if (typeof aapneNabo === 'function') aapneNabo();
    return;
  }
  const v = r.type === 'rute' ? r.r.cidr : r.a.key.split(' ').join(', ');
  brukOmrade(v);
  SK.valgt = -1;
  sjekkRute();
  tegnListe();
  if (r.type === 'anlegg') {
    const a = r.a;
    if (!a.naabar) {
      figur('dukk', 450);
      const rad = $('anleggListe').querySelector('.an-rad');
      spill(rad, 'nei', 420);
      nabeSier(T(`Ingen vei til ${a.navn || a.key} nå. VPN-en er nok nede.`,
        `No way to ${a.navn || a.key} right now. The VPN is probably down.`), 'trist', 'ingen-vei:' + a.key);
      $('scanBtn').focus();
      return;
    }
    const dager = a.sist ? (Date.now() / 1000 - a.sist) / 86400 : 0;
    if (dager > 180) {
      figur('nys', 900);
      nabeSier(T(`Støvete. ${Math.round(dager)} dager siden sist.`, `Dusty. ${Math.round(dager)} days since last time.`), null, 'stov:' + a.key);
    }
  }
  if (skann && r.type === 'anlegg' && !$('scanBtn').disabled && !document.body.classList.contains('skanner')) runScan();
  else $('scanBtn').focus();
}

/* A name in the field becomes its ranges before the scan, so «hopp» and
   Skann does what it looks like it does. */
function oversettFelt() {
  const ri = $('rangeInput');
  const q = ri.value.trim();
  if (!q || erIpTekst(q)) return true;
  const a = treffAnlegg(q)[0];
  if (!a) {
    spill(ri, 'nei', 420);
    nabeSier(T(`Kjenner ikke «${q}». Skriv en IP, så husker jeg den etterpå.`,
      `I do not know "${q}". Type an IP and I will remember it afterwards.`), null);
    return false;
  }
  brukOmrade(a.key.split(' ').join(', '));
  return true;
}


/* ------------------------------------------------------- the keyboard */
$('rangeInput').onkeydown = (e) => {
  const klikkbare = SK.rader.filter(r => r.type === 'anlegg' || r.type === 'rute' || r.type === 'nabo');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!klikkbare.length) return;
    e.preventDefault();
    const ned = e.key === 'ArrowDown';
    SK.valgt = Math.max(-1, Math.min(klikkbare.length - 1, SK.valgt + (ned ? 1 : -1)));
    SK.tastatur = true;
    blikk(ned ? 0.6 : -0.6, ned ? 2.4 : 0.8, 700);
    tegnListe();
    $('anleggListe').querySelector('.an-rad.valgt')?.scrollIntoView({block: 'nearest'});
    return;
  }
  if (e.key === 'Escape') {
    if (S.scanJob) { e.preventDefault(); cancelScan(); figur('dukk', 450); return; }
    if (SK.valgt >= 0) { e.preventDefault(); SK.valgt = -1; tegnListe(); }
    return;
  }
  if (e.key !== 'Enter' || $('scanBtn').disabled) return;
  e.preventDefault();
  if (SK.tastatur && !loadPrefs().tastaturRos) {
    savePrefs({tastaturRos: true});
    setTimeout(() => nabeSier(T('Tastatur. Respekt.', 'Keyboard. Respect.'), 'fornoyd'), 400);
  }
  if (SK.valgt >= 0 && klikkbare[SK.valgt]) {
    const r = klikkbare[SK.valgt];
    bruk(r, {skann: true});
    if (r.type === 'rute') runScan();
    return;
  }
  runScan();
};

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'l' || e.altKey) return;
  e.preventDefault();
  const ri = $('rangeInput');
  ri.focus(); ri.select();
  spill(ri, 'sveip', 600);
  blikk(-1, 2.4, 800);
});

/* ------------------------------------------------------- the field */
function spill(el, k, ms) {
  if (!el || bevegelseAv()) return;
  el.classList.remove(k);
  void el.offsetWidth;
  el.classList.add(k);
  setTimeout(() => el.classList.remove(k), ms);
}

(function koblFelt() {
  const ri = $('rangeInput');
  let forrigeTreff = '';
  ri.addEventListener('input', () => {
    SK.valgt = -1;
    SK.tastatur = false;
    // He watches you type, and nods when it turns into a site he knows.
    if (Date.now() - SK.sistSkrevet > 1500) blikk(-0.8, 2.4, 1400);
    SK.sistSkrevet = Date.now();
    tegnListe();
    sjekkRute();
    tegnBbmd();
    const q = ri.value.trim();
    const treff = q && !erIpTekst(q) ? treffAnlegg(q) : [];
    const n = treff.length === 1 ? treff[0].key : '';
    if (n && n !== forrigeTreff) figur('nikk', 520);
    if (!treff.length && q.length > 3 && !erIpTekst(q) && q.toLowerCase() !== 'nabo') figur('lurer', 900);
    forrigeTreff = n;
  });
  ri.addEventListener('focus', () => tegnListe());
  ri.addEventListener('paste', (e) => {
    const tekst = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const adr = hentAdresser(tekst);
    if (!adr || !adr.length) return;
    // nabe-finn has already cleaned it; this is only the reaction.
    setTimeout(() => {
      spill(ri, 'ryddet', 700);
      figur('hikk', 240);
      if (/255\.\d+\.\d+\.\d+/.test(tekst)) nabeSier(T('Spiste masken. Smakte 255.', 'Ate the mask. Tasted like 255.'), 'fornoyd', 'maske');
      else if (adr.length > 2) nabeSier(T(`${adr.length} adresser plukket ut av teksten.`, `${adr.length} addresses picked out of the text.`), 'fornoyd', 'plukk');
    }, 0);
  });
  // An empty field and a hand on Skann: he points at the field.
  $('scanBtn').addEventListener('mouseenter', () => {
    if (ri.value.trim() || S.scanJob) return;
    blikk(-2, 2.2, 1000);
    spill(ri, 'hint', 900);
  });
  $('modeSel').addEventListener('change', tegnVei);
  // The routes are rows in the list now; the placeholder says what to type.
  const _forslag = tegnForslag;
  tegnForslag = function () {
    const r = _forslag.apply(this, arguments);
    if (!ri.placeholder.endsWith('↵')) ri.placeholder = T('IP, område eller anlegg', 'IP, range or site');
    tegnListe();
    return r;
  };
  const _sprak = settSprak;
  settSprak = function () {
    const r = _sprak.apply(this, arguments);
    ri.placeholder = T('IP, område eller anlegg', 'IP, range or site');
    tegnVei(); tegnListe();
    return r;
  };
  const _status = refreshStatus;
  refreshStatus = async function () {
    const r = await _status.apply(this, arguments);
    tegnVei();
    return r;
  };
  tegnVei();
})();

/* ----------------------------------------------- progress in the field */
const _skannEtt = scanOneRange;
scanOneRange = function (subnet, mode, thorough, onProgress) {
  return _skannEtt.call(this, subnet, mode, thorough, (j) => {
    onProgress(j);
    const el = $('feltFremdrift');
    if (!el) return;
    const svar = S.devices.length;
    el.textContent = j.total
      ? T(`${j.done}/${j.total} · ${svar} svar`, `${j.done}/${j.total} · ${svar} replies`)
      : T(`${svar} svar`, `${svar} replies`);
    el.classList.add('aktiv');
    if (svar > SK.svar) { SK.svar = svar; spill(el, 'bump', 260); }
  });
};

const _skannStart = runScan;
runScan = async function () {
  const ri = $('rangeInput');
  if (!oversettFelt()) return;
  SK.avbrutt = false;
  SK.svar = 0; SK.t0 = performance.now();
  const boks = document.querySelector('.scanbox');
  boks?.classList.add('skanner-na');
  $('anleggListe').hidden = true;
  // Late scans: the lights are on next door too.
  const t = new Date().getHours();
  const hus = $('naboHus');
  if (hus && (t >= 22 || t < 5)) hus.classList.add('lys');
  const nokkel = parseRanges(ri.value).sort().join(' ');
  SK.skannIDag[nokkel] = (SK.skannIDag[nokkel] || 0) + 1;
  if (SK.skannIDag[nokkel] === 5) nabeSier(T('Femte gang på dette anlegget i dag. Glemt noe?', 'Fifth time at this site today. Forgot something?'), null, 'femte:' + nokkel);
  try { return await _skannStart.apply(this, arguments); }
  finally {
    boks?.classList.remove('skanner-na');
    hus?.classList.remove('lys');
    const el = $('feltFremdrift');
    if (el) {
      const s = Math.round((performance.now() - SK.t0) / 1000);
      const n = S.devices.length;
      el.textContent = n ? T(`${n} ${n === 1 ? 'enhet' : 'enheter'} · ${s} s`, `${n} ${n === 1 ? 'device' : 'devices'} · ${s} s`)
        : T('ingen svar', 'no replies');
      el.classList.add('ferdig');
      if (!n) spill(ri, 'nei', 420);
      clearTimeout(el.t);
      el.t = setTimeout(() => { el.classList.remove('aktiv', 'ferdig'); el.textContent = ''; }, 3200);
    }
    tegnListe();
  }
};
$('scanBtn').onclick = runScan;
const _skannAvbryt = cancelScan;
cancelScan = function () { SK.avbrutt = true; return _skannAvbryt.apply(this, arguments); };

/* ------------------------------------------------ compared with last time
   The site memory has the controllers that answered last time. A building
   that comes back complete gets a nod, one with a controller missing gets
   named - that is the one to walk over to. */
const _skannHusk = husk;
husk = async function (omraader, enheter) {
  const key = (omraader || []).map(r => r.trim()).filter(Boolean).sort().join(' ');
  const foer = MINNE[key];
  const r = await _skannHusk.apply(this, arguments);
  const naa = enheter || [];
  if (naa.length && !SK.avbrutt) {
    if (!foer) {
      const hus = $('naboHus');
      if (hus && !bevegelseAv()) { hus.classList.add('puff'); setTimeout(() => hus.classList.remove('puff'), 1600); }
      nabeSier(T('Nytt anlegg. Naboen skriver det i boka.', 'A new site. The neighbour writes it down.'), 'fornoyd');
    } else {
      const gamle = new Set((foer.enheter || []).map(d => d.address));
      const nye = new Set(naa.map(d => d.address));
      const mangler = (foer.enheter || []).filter(d => !nye.has(d.address));
      const ekstra = naa.filter(d => !gamle.has(d.address));
      if (mangler.length && mangler.length <= 5) {
        nabeSier(T(`Mangler ${mangler.length} fra sist: ${mangler.map(d => d.object_name || d.address).slice(0, 3).join(', ')}.`,
          `${mangler.length} missing since last time: ${mangler.map(d => d.object_name || d.address).slice(0, 3).join(', ')}.`), 'nervos');
      } else if (ekstra.length && !mangler.length) {
        figur('dans', 1200);
        nabeSier(T(`+${ekstra.length} siden sist. Noen har vært her.`, `+${ekstra.length} since last time. Someone has been here.`), 'skvatt');
      } else if (!mangler.length && naa.length === gamle.size && naa.length > 1) {
        nabeSier(T(`Alle ${naa.length} er der. Som sist.`, `All ${naa.length} are there. Same as last time.`), 'fornoyd', 'komplett:' + key);
      }
    }
  }
  setTimeout(hentAnlegg, 300);
  return r;
};

tegnListe();
