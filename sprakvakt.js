// Language guard for the self-test. Every text and title/placeholder/
// aria-label in index.html is run through the page's own translator; what
// comes out still Norwegian is printed, and the exit code says how many.
// usage: node sprakvakt.js <repo>
const fs = require('fs'), path = require('path');
const repo = process.argv[2];
const app = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');
const fra = app.indexOf('const ORDBOK = {'), til = app.indexOf('const ATTR_SPRAAK');
const oversett = new Function(app.slice(fra, til) + '; return oversettTekst;')();
const NORSK = /[æøåÆØÅ]|\b(og|ikke|av|på|til|med|fra|som|er|verdi|prioritet|enhet|enheter|punkt|punkter|skann|søk|lukk|vis|skjul|lagre|uten|alle|nytt|feil|skriv|frigi|leser|anlegg|anlegget|ingen|eller|når|etter|denne|dette|har|kan|må|blir|lest|svarte|mangler|sjekk|velg|fjern|avbryt|overstyrt|minutter|sekunder|automatisk|leverandør)\b/i;
let html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
html = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const ut = new Set();
const sjekk = (s, hva) => {
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || !NORSK.test(s) || /Martin Lillebø/.test(s)) return;
  const o = oversett(s, true);
  if (o === s || NORSK.test(o)) ut.add(`${hva}: ${s}${o !== s ? '   ->   ' + o : ''}`);
};
for (const m of html.matchAll(/>([^<>]+)</g)) sjekk(m[1], 'tekst');
for (const m of html.matchAll(/\b(title|placeholder|aria-label)="([^"]*)"/g)) sjekk(m[2], m[1]);
console.log([...ut].join('\n'));
console.error(ut.size + ' i index.html');
process.exit(Math.min(ut.size, 100));
