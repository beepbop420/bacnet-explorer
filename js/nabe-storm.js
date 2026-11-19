/* NABE - a storm on the network.

   Who-Is, I-Am and COV notifications that arrive by the hundred a second are not a plant working, they are a
   network about to give up: a controller stuck in a loop, a second tool asking everybody the same thing, a subscription
   that is renewed over and over. The server counts what comes in and what NABE itself sends, holds the rates over the last
   seconds up against limits, and says which address sends most, so the cable to pull is the right one.

   This file asks the server every ten seconds and speaks up: a mark in the status bar, a line in the traffic log, a
   remark once per storm, and a place in the service suggestions. It only listens: nothing is sent to the network for
   this beyond what NABE does anyway. */
'use strict';

(function storm() {
  let D = {aktiv: [], hist: [], rater: {}, terskler: {}};
  const SAGT = 'nabe_storm_sagt';
  const sagt = () => { try { return JSON.parse(localStorage.getItem(SAGT)) || {}; } catch { return {}; } };
  const komma = (n) => (SPRAAK === 'en' ? String(n) : String(n).replace('.', ','));

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'sbStorm';
  chip.className = 'sb-item sb-vakt sb-storm';
  chip.hidden = true;
  chip.onclick = () => { if (window.aapneTrafikk) window.aapneTrafikk(); };
  document.querySelector('.statusbar')?.append(chip);

  /* One line per storm: what it is, how big, and who sends most */
  function tekst(e) {
    const r = komma(e.rate), t = komma(e.terskel);
    const topp = e.topp && e.topp[0] ? T(` Mest fra ${e.topp[0][0]} (${komma(e.topp[0][1])} i sekundet).`, ` Most from ${e.topp[0][0]} (${komma(e.topp[0][1])} a second).`) : '';
    switch (e.type) {
      case 'whois': return T(`Who-Is-storm: ${r} i sekundet (grensen er ${t}).${topp}`, `Who-Is storm: ${r} a second (the limit is ${t}).${topp}`);
      case 'iam': return T(`I-Am-storm: ${r} i sekundet (grensen er ${t}).${topp}`, `I-Am storm: ${r} a second (the limit is ${t}).${topp}`);
      case 'cov': return T(`COV-storm: ${r} varsler i sekundet til sammen (grensen er ${t}).${topp}`, `COV storm: ${r} notifications a second in all (the limit is ${t}).${topp}`);
      case 'cov-kilde': return T(`${e.topp && e.topp[0] ? e.topp[0][0] : 'En enhet'} sender ${r} COV-varsler i sekundet (grensen er ${t}).`, `${e.topp && e.topp[0] ? e.topp[0][0] : 'A device'} sends ${r} COV notifications a second (the limit is ${t}).`);
      case 'ut-whois': return T(`NABE sender ${r} Who-Is i sekundet. Går et skann eller et søk i løkke?`, `NABE sends ${r} Who-Is a second. Is a scan or a search looping?`);
      case 'ut': return T(`NABE sender ${r} forespørsler i sekundet. Det er mye for ett nett.`, `NABE sends ${r} requests a second. That is a lot for one network.`);
      default: return `${e.type}: ${r}`;
    }
  }
  const ferdige = () => (D.hist || []).filter((e) => e.slutt && Date.now() / 1000 - e.slutt < 86400).slice(-5).reverse();

  /* The line in the traffic log: what is going on now, and what has been in the last day */
  function banner() {
    const a = D.aktiv || [], f = ferdige().filter((e) => !a.some((x) => x.id === e.id));
    if (!a.length && !f.length) return '';
    const min = (s) => { const m = Math.round((Date.now() / 1000 - s) / 60); return m < 1 ? T('nå', 'now') : m < 60 ? T(`${m} min siden`, `${m} min ago`) : T(`${Math.round(m / 60)} t siden`, `${Math.round(m / 60)} h ago`); };
    return a.map((e) => `<div class="st-ban aktiv"><b>${T('Storm nå', 'Storm now')}</b> ${esc(tekst(e))}</div>`).join('')
      + f.map((e) => `<div class="st-ban"><b>${T('Storm', 'Storm')} ${esc(min(e.slutt))}</b> ${esc(tekst(e))}</div>`).join('');
  }

  async function hent() {
    let d;
    try { d = await (await fetch('/api/storm', {cache: 'no-store'})).json(); } catch { return; }
    if (!d || d.status !== 'done') return;
    D = d;
    const a = d.aktiv || [];
    chip.hidden = !a.length;
    if (a.length) {
      chip.textContent = a.length === 1 ? T('Storm på nettet', 'Network storm') : T(`${a.length} stormer på nettet`, `${a.length} network storms`);
      chip.title = a.map(tekst).join('\n');
    }
    // Said once per storm, however long it goes on
    const s = sagt();
    for (const e of a) {
      const k = 'storm:' + e.type + ':' + e.id;
      if (s[k]) continue;
      s[k] = Date.now();
      nabeSier(tekst(e), 'nervos', k, true);
    }
    const nye = Object.fromEntries(Object.entries(s).filter(([, t]) => Date.now() - t < 7 * 86400 * 1000));
    try { localStorage.setItem(SAGT, JSON.stringify(nye)); } catch { /* private window */ }
    const b = document.getElementById('trStorm');
    if (b) b.innerHTML = banner();
  }
  setInterval(hent, 10000);
  setTimeout(hent, 4000);

  window.nabeStorm = {siste: () => D, tekst, banner, hent, ferdige};
})();
