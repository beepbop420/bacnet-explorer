/* NABE - tunnel guard, Variabel file, the last visit
   Loaded after app.js and shares its globals (S, $, api, toast, nabeSier ...).
   Kept apart so app.js does not have to carry everything. */
'use strict';

/* --------------------------------------------------------- tunnel guard
   Connecting or dropping WireGuard or FortiClient used to need a restart of
   NABE, sometimes of the PC. The stack was bound to the address the adapter
   had at start; when the tunnel went away the socket went with it, and when
   it came back - often with the very same address - the old socket stayed
   deaf.

   Every three seconds the adapter list is compared with the last one. When
   something changed, the dropdown is refreshed, and NABE rebinds if the
   adapter it was using vanished or came back, or if the range you are
   working on is now routed through a new one. It waits while a scan runs,
   and it says what it did. */
const KORTVAKT = {sig: '', liste: []};

async function kortvakt() {
  if (S.scanJob || document.hidden) return;
  let d;
  try { d = await (await fetch('/api/interfaces', {cache: 'no-store'})).json(); } catch { return; }
  const liste = (d && d.interfaces) || [];
  const sig = liste.map(i => i.cidr).sort().join(',');
  if (!KORTVAKT.sig) { KORTVAKT.sig = sig; KORTVAKT.liste = liste; return; }
  if (sig === KORTVAKT.sig) return;

  const gamle = KORTVAKT.liste;
  KORTVAKT.sig = sig; KORTVAKT.liste = liste;
  const nye = liste.filter(i => !gamle.some(g => g.cidr === i.cidr));
  const borte = gamle.filter(g => !liste.some(i => i.cidr === g.cidr));
  await loadInterfaces();

  const bundetIp = String(S.localAddr || '').split(/[/:]/)[0];
  const bundetBorte = borte.some(g => g.ip === bundetIp);
  const bundetTilbake = nye.some(i => i.ip === bundetIp);
  const omr = parseRanges($('rangeInput').value)[0];

  if (bundetBorte || bundetTilbake) {
    // The socket on that address is dead either way: rebind, preferably to
    // whatever now carries the range in the field.
    let maal = null;
    if (omr) {
      try {
        const r = await (await fetch('/api/route?target=' + encodeURIComponent(omr))).json();
        if (r && r.status === 'done') maal = r.cidr;
      } catch {}
    }
    if (!maal) maal = (liste[0] || {}).cidr;
    if (maal) {
      await connectTo(maal, {quiet: true});
      const navn = (liste.find(i => maal.startsWith(i.ip)) || {}).interface || maal;
      nabeSier(bundetBorte
        ? T(`Tunnelen forsvant. Byttet til ${navn}.`, `The tunnel went away. Switched to ${navn}.`)
        : T(`${navn} er tilbake. Koblet til på nytt.`, `${navn} is back. Reconnected.`), 'skvatt');
    }
    return;
  }
  if (nye.length) {
    const navn = nye.map(i => i.interface).join(', ');
    // A new adapter: take it if the range is routed through it now.
    const foer = S.localAddr;
    if (omr) await kortForMaal(omr);
    nabeSier(S.localAddr !== foer
      ? T(`Ny forbindelse: ${navn}. Jeg bruker den.`, `New connection: ${navn}. Using it.`)
      : T(`Ny forbindelse: ${navn}.`, `New connection: ${navn}.`), 'skvatt');
  }
}
setInterval(kortvakt, 3000);

/* ------------------------------------------------------------ Variabel file
   The «Variabel» file the old generator makes from an EDE, made straight from what NABE
   has read - no EDE round trip, and the device field right.

   Format, from the old generator's own exports (several real sites):
   UTF-8 with BOM, CRLF, semicolons, 33 fields per row.
     1 BacnetNetwork      2 site name        3 <Prefix>.<device>
     4 tag path, dots      5 object type no.  6 instance
     7 default (empty)     8 unit in words    9 decimals
    10 states 0=Av|1=På   11 description, SD code removed
    12 trend Interval|00:05:00                13 alarm class
    14 alarm text         15 alarm source <site> <sys>.<sub>-<comp>
    16-33 empty.
   SD codes in the description decide trend and alarm: the digit is the
   alarm class (0 = none), the letter T means trend, 0 means no trend.
   Without a code a point gets neither trend nor alarm - measured on 1350
   such points in the old generator's own exports.

   The one place the old generator gets it wrong is field 3: it takes the device from the
   EDE file name (Device1234_2026-10-23_EDE becomes ABC.2026_10_23). Here it
   is the device's own name, so NTI finds the device in the station. */
const VAR_TYPE = {
  'analog-input': 0, 'analog-output': 1, 'analog-value': 2,
  'binary-input': 3, 'binary-output': 4, 'binary-value': 5,
  'multi-state-input': 13, 'multi-state-output': 14, 'multi-state-value': 19,
};

function varEnhet(units) {
  if (!units || typeof units !== 'string' || units === 'no-units') return 'null';
  let u = units.replace(/-/g, ' ').replace(/^degrees /, '').toLowerCase();
  // the old generator writes the unit in the singular - pascal, bar, kilowatt hour, cubic
  // meter - except where it is a rate: liters per second stays plural.
  if (!/ per /.test(u))
    u = u.split(' ').map(w => /s$/.test(w) && !/^(celsius|fahrenheit|hertz|lux|siemens)$/.test(w) ? w.slice(0, -1) : w).join(' ');
  return u;
}

// An SD code stands on its own, but an underscore may join it to the text:
// SD1T_Romtemp is as much a code as SD1T Romtemp.
const VAR_SD_RE = /(?<![A-Za-z0-9])SD(\d)([0-9T])(?![A-Za-z0-9])/i;
function varSd(tekst) {
  const m = VAR_SD_RE.exec(tekst || '');
  if (!m) return {klasse: 0, trend: false, rest: (tekst || '').trim()};
  // Every code goes, not just the first, so none is left to be doubled.
  const rest = varUtenSd(tekst);
  return {klasse: Number(m[1]), trend: m[2].toUpperCase() === 'T', rest};
}

function varUtenSd(tekst) {
  return String(tekst || '').replace(new RegExp(VAR_SD_RE.source, 'gi'), ' ')
    .replace(/\s{2,}/g, ' ').replace(/^[\s\-–:_]+|[\s\-–:_]+$/g, '');
}




/* ------------------------------------------------------- the last visit
   The start screen tells you how you left each plant: overridden and faulty
   points across every device read, kept per site in this browser. "3
   overridden when you left" is the thing worth knowing before you go back. */
function huskBesok() {
  const k = tagNokkel();
  if (!k) return;
  let over = 0, feil = 0, enheter = 0;
  for (const d of S.devices) {
    const pts = S.cache[d.address];
    if (!pts) continue;
    enheter++;
    const c = flagCounts(pts);
    over += (c['overridden'] || 0) + (c['out-of-service'] || 0);
    feil += (c['in-alarm'] || 0) + (c['fault'] || 0);
  }
  try {
    const alle = JSON.parse(localStorage.getItem('nabe_besok') || '{}');
    alle[k] = {over, feil, enheter, t: Date.now()};
    localStorage.setItem('nabe_besok', JSON.stringify(alle));
  } catch {}
}
function sisteBesok(k) {
  try { return (JSON.parse(localStorage.getItem('nabe_besok') || '{}'))[k] || null; } catch { return null; }
}
