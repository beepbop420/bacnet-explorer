/* NABE - tunnel guard, BTG file, the last visit
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

/* ------------------------------------------------------------ BTG file
   The «Variabel» file BTG makes from an EDE, made straight from what NABE
   has read - no EDE round trip, and the device field right.

   Format, from BTG's own exports (several real sites):
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
   Without a code every point gets a trend and no alarm, as BTG does.

   The one place BTG gets it wrong is field 3: it takes the device from the
   EDE file name (Device1234_2026-10-23_EDE becomes ABC.2026_10_23). Here it
   is the device's own name, so NTI finds the device in the station. */
const BTG_TYPE = {
  'analog-input': 0, 'analog-output': 1, 'analog-value': 2,
  'binary-input': 3, 'binary-output': 4, 'binary-value': 5,
  'multi-state-input': 13, 'multi-state-output': 14, 'multi-state-value': 19,
};
const BTG_HELE = new Set(['percent', 'pascal', 'parts per million', 'volt', 'null', 'percent relative humidity']);

function btgEnhet(units) {
  if (!units || typeof units !== 'string' || units === 'no-units') return 'null';
  let u = units.replace(/-/g, ' ').replace(/^degrees /, '').toLowerCase();
  // BTG writes the unit in the singular - pascal, bar, kilowatt hour, cubic
  // meter - except where it is a rate: liters per second stays plural.
  if (!/ per /.test(u))
    u = u.split(' ').map(w => /s$/.test(w) && !/^(celsius|fahrenheit|hertz|lux|siemens)$/.test(w) ? w.slice(0, -1) : w).join(' ');
  return u;
}

function btgSti(navn, cluster) {
  const biter = String(navn || '').trim().split(/[-_\s.]+/).filter(Boolean);
  return (cluster ? cluster + '.' : '') + biter.join('.');
}

function btgSd(tekst) {
  const m = /\bSD(\d)([0-9T])\b/i.exec(tekst || '');
  if (!m) return {klasse: 0, trend: true, rest: (tekst || '').trim()};
  const rest = (tekst || '').replace(m[0], '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–:]+|[\s\-–:]+$/g, '');
  return {klasse: Number(m[1]), trend: m[2].toUpperCase() === 'T', rest};
}

function btgRad(p, t, anlegg, enhetNavn) {
  const type = BTG_TYPE[p.type];
  if (type === undefined) return null;
  const analog = type <= 2;
  const sti = btgSti(p.name, t.cluster);
  const sd = btgSd(p.description || '');
  const beskr = sd.rest || p.name || '';
  const enhet = analog ? btgEnhet(p.units) : '';
  const desimaler = analog ? (BTG_HELE.has(enhet) ? 0 : 1) : 0;
  let tilstander = '';
  if (Array.isArray(p.state_text) && p.state_text.length) {
    tilstander = (type >= 3 && type <= 5)
      ? `0=${p.state_text[0] || 'Av'}|1=${p.state_text[1] || 'På'}`
      : p.state_text.map((s, i) => `${i + 1}=${s}`).join('|');
  }
  const biter = sti.split('.');
  const kilde = sd.klasse
    ? `${anlegg} ${biter.length >= 3 ? `${biter[0]}.${biter[1]}-${biter[2]}` : sti}` : '';
  const f = new Array(33).fill('');
  f[0] = 'BacnetNetwork'; f[1] = anlegg; f[2] = enhetNavn; f[3] = sti;
  f[4] = String(type); f[5] = String(p.instance ?? ''); f[7] = enhet;
  f[8] = String(desimaler); f[9] = tilstander; f[10] = beskr;
  f[11] = sd.trend ? 'Interval|00:05:00' : '';
  if (sd.klasse) { f[12] = String(sd.klasse); f[13] = beskr; f[14] = kilde; }
  // Semicolons inside a description would shift every field after it.
  return f.map(x => String(x).replace(/[;\r\n]/g, ' ')).join(';');
}

function lagBtgFil() {
  const t = tagInnstillinger();
  const k = tagNokkel();
  const anlegg = (t.anleggsnavn || (k && MINNE[k] && MINNE[k].navn) || '').trim();
  if (!t.prefiks || !anlegg) {
    toast(T('Fyll inn prefiks og anleggsnavn først.', 'Fill in prefix and site name first.'), true);
    $(t.prefiks ? 'tgAnlegg' : 'tgPrefiks')?.focus();
    return;
  }
  const rader = [];
  let enheter = 0;
  for (const d of S.devices) {
    const pts = S.cache[d.address];
    if (!pts || !pts.length) continue;
    enheter++;
    let dnavn = String(d.object_name || d.device_instance).trim();
    if (dnavn.toLowerCase().startsWith(t.prefiks.toLowerCase()))
      dnavn = dnavn.slice(t.prefiks.length).replace(/^[._\-\s]+/, '');
    const enhetNavn = `${t.prefiks}.${dnavn.replace(/[\s\-.]+/g, '_')}`;
    for (const p of pts) {
      const r = btgRad(p, t, anlegg, enhetNavn);
      if (r) rader.push(r);
    }
  }
  if (!rader.length) {
    toast(T('Ingen leste enheter ennå. Åpne enhetene du vil ha med.', 'No devices read yet. Open the devices you want included.'), true);
    return;
  }
  const n = new Date(), to = x => String(x).padStart(2, '0');
  const stempel = `${n.getFullYear()}-${to(n.getMonth() + 1)}-${to(n.getDate())} ${to(n.getHours())}${to(n.getMinutes())}${to(n.getSeconds())}`;
  const filnavn = `${t.prefiks} Variabel ${anlegg} ${stempel}.csv`.replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob(['﻿' + rader.join('\r\n') + '\r\n'], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filnavn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(T(`BTG-fil laget: ${rader.length} punkter fra ${enheter} enheter`, `BTG file made: ${rader.length} points from ${enheter} devices`));
  nabeSier(T('BTG-fil laget. BTG selv er litt fornærmet.', 'BTG file made. BTG itself is a little offended.'), 'fornoyd', 'btg');
}
document.addEventListener('click', (e) => { if (e.target.closest?.('#tgBtg')) lagBtgFil(); });


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
