/* NABE - the darker humour, and the fun that grows with use
   Loaded after app.js and shares its globals (S, $, api, toast, nabeSier ...).
   Kept apart so app.js does not have to carry everything. */
'use strict';

/* ---------------------------------------------------------- gallows humour
   Requested darker. Aimed at the trade, the plant and the situation - never
   at a person who is not in the room. */
const NABE_MORKE = [
  ['Prioritet 1. Hvis noe brenner, var det ikke meg.', 'Priority 1. If something catches fire, it was not me.'],
  ['Denne regulatoren ble sist rørt av noen som har sluttet.', 'This controller was last touched by someone who has since left.'],
  ['Overstyrt i tre år. Midlertidig.', 'Overridden for three years. Temporarily.'],
  ['Igangkjøring er feilsøking med kaffe og dårlig samvittighet.', 'Commissioning is debugging with coffee and a guilty conscience.'],
  ['Garantien gikk ut i går. Selvfølgelig gjorde den det.', 'The warranty expired yesterday. Of course it did.'],
  ['Hvis det ikke står i TFM-lista, finnes det ikke. Som lønnsøkningen din.', 'If it is not in the tag list it does not exist. Like your pay rise.'],
  ['Dokumentasjon? Vi har mot.', 'Documentation? We have courage.'],
  ['Jeg er bare en nettside, men selv jeg vet at P1 er en dårlig idé.', 'I am just a web page, and even I know P1 is a bad idea.'],
  ['Sweep pågår. Skrikene du hører er bare UDP-pakker som ikke kom fram.', 'Sweep running. The screams are just UDP packets that did not make it.'],
  ['Alarmer forsvinner ikke av at du ser en annen vei. Jeg har prøvd.', 'Alarms do not go away if you look the other way. I have tried.'],
  ['Denne WAGO-en har sett ting ingen PLS burde se.', 'This WAGO has seen things no PLC should see.'],
  ['Fredag 15:59. Perfekt tidspunkt å endre settpunkt og forsvinne.', 'Friday 15:59. Perfect time to change a setpoint and vanish.'],
  ['Kunden sa det «bare var en liten endring». Det er tre måneder siden.', 'The customer said it was "just a small change". That was three months ago.'],
  ['Vi støtter BACnet. BACnet støtter ikke oss.', 'We support BACnet. BACnet does not support us.'],
  ['Hver gang noen skriver Null til prioritet 16, dør en regulator litt.', 'Every time someone writes Null to priority 16, a controller dies a little.'],
  ['Jeg har sett regulatorer gå offline av ren skam.', 'I have seen controllers go offline out of pure shame.'],
];
(function blandInnMorkt() {
  const m = nabeMerke();
  if (!m) return;
  // Every other click-line is a dark one, on top of the original set.
  m.addEventListener('click', () => {
    if (NABE.klikk !== 3 || Math.random() < 0.5) return;
    if (document.body.classList.contains('skanner')) return;
    const [nb, en] = NABE_MORKE[Math.floor(Math.random() * NABE_MORKE.length)];
    setTimeout(() => nabeSnakk(T(nb, en)), 30);
  });
})();

/* What NABE says about the device you just opened. One line, once per
   device per session, and only when there is something worth saying. */
const _rentFoer = nabeRentAnlegg;
nabeRentAnlegg = function (d, pts) {
  if (!d || !pts || pts.length < 20) return;
  const c = flagCounts(pts);
  const feil = (c['in-alarm'] || 0) + (c['fault'] || 0);
  const over = (c['overridden'] || 0) + (c['out-of-service'] || 0);
  if (feil >= 20) nabeSier(T(`${feil} feil. Den er ikke ødelagt, den er bare ærlig.`, `${feil} faults. It is not broken, it is just honest.`), 'skvatt', 'feil:' + d.address);
  else if (over >= 10) nabeSier(T(`${over} overstyrte punkter. Vaktmesteren kommer til å hate noen.`, `${over} overridden points. The caretaker is going to hate someone.`), 'nervos', 'over:' + d.address);
  else _rentFoer(d, pts);
};

// The empty scan, said darker.
const _tomFoer = nabeEtterSkann;
nabeEtterSkann = function (n) {
  if (n === 0) {
    const linjer = [
      ['Ingen svarte. Som på julebordet.', 'Nobody answered. Like the office party.'],
      ['Ingen enheter. Enten er nettet tomt, eller så har noen trukket ut kabelen og gått hjem.', 'No devices. Either the network is empty or someone pulled the cable and went home.'],
      ['Stille. For stille.', 'Quiet. Too quiet.'],
    ];
    const [nb, en] = linjer[Math.floor(Math.random() * linjer.length)];
    setTimeout(() => nabeSnakk(T(nb, en)), 600);
    return;
  }
  _tomFoer(n);
};

/* ------------------------------------------------------- more days out */
(function flereKostymer() {
  const m = nabeMerke();
  if (!m) return;
  const d = new Date(), mnd = d.getMonth() + 1, dag = d.getDate(), aar = d.getFullYear();
  // Easter Sunday (Anonymous Gregorian algorithm); ears from Palm Sunday to Easter Monday.
  const a = aar % 19, b = Math.floor(aar / 100), c = aar % 100, dd = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const paaske = new Date(aar, Math.floor((h + l - 7 * mm + 114) / 31) - 1, ((h + l - 7 * mm + 114) % 31) + 1);
  const dager = Math.round((new Date(aar, mnd - 1, dag) - paaske) / 864e5);
  if (dager >= -7 && dager <= 1) m.classList.add('paaske');
  if ((mnd === 1 && dag === 1) || (mnd === 12 && dag === 31)) m.classList.add('nyttaar');
  if (d.getDay() === 5 && dag === 13) m.classList.add('fredag13');
})();

/* ------------------------------------------------- your NABE career
   Behind the Konami code: what you and NABE have been through. The numbers
   are the ones the milestones already count. */
function visKarriere() {
  const t = teller();
  document.getElementById('karriere')?.remove();
  const lag = document.createElement('div');
  lag.id = 'karriere';
  lag.className = 'startskjerm';
  const rad = (n, nb, en) => `<div class="ss-rad" style="cursor:default"><span class="ss-rad-navn">${T(nb, en)}</span><span class="ss-rad-meta" style="font-size:14px;color:var(--fg)">${(n || 0).toLocaleString('no')}</span></div>`;
  const tittel = (t.skann || 0) > 100 ? T('Veteran', 'Veteran') : (t.skann || 0) > 20 ? T('Fast inventar', 'Part of the furniture') : T('Lærling', 'Apprentice');
  lag.innerHTML = `<div class="ss-kort">
    <div class="ss-logo">${NABE_SVG.replace('width="26" height="26"', 'width="72" height="72"')}</div>
    <h2 style="margin:4px 0 2px">${T('Din NABE-karriere', 'Your NABE career')}</h2>
    <div class="ss-under">${esc(tittel)}</div>
    <div class="ss-liste" style="margin-top:14px;text-align:left">
      ${rad(t.aapnet, 'Ganger åpnet', 'Times opened')}
      ${rad(t.skann, 'Skann', 'Scans')}
      ${rad(t.enheter, 'Enheter funnet', 'Devices found')}
      ${rad(t.punkter, 'Punkter lest', 'Points read')}
      ${rad(t.skriv, 'Skrivinger', 'Writes')}
      ${rad((t.sett || []).length, 'Milepæler', 'Milestones')}
    </div>
    <div class="ss-fakta">${T('Ingen av disse tallene forlater PC-en din. NABE bare husker dem, og dømmer stille.', 'None of these numbers leave your PC. NABE just remembers them, and judges quietly.')}</div>
  </div>`;
  document.body.appendChild(lag);
  lag.addEventListener('click', () => lag.remove());
}
let KARRIERE_I = 0;
const KARRIERE_KODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
document.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  KARRIERE_I = k === KARRIERE_KODE[KARRIERE_I] ? KARRIERE_I + 1 : (k === KARRIERE_KODE[0] ? 1 : 0);
  if (KARRIERE_I === KARRIERE_KODE.length) { KARRIERE_I = 0; setTimeout(visKarriere, 900); }
});

/* ------------------------------------------------------- small reactions */
// Staring at him.
let STIRR = 0;
nabeMerke()?.addEventListener('pointerenter', () => {
  clearTimeout(STIRR);
  STIRR = setTimeout(() => nabeSier(T('Du stirrer.', 'You are staring.'), 'skvatt', 'stirr'), 8000);
});
nabeMerke()?.addEventListener('pointerleave', () => clearTimeout(STIRR));

// Refreshing as a repair strategy.
try {
  const n = Date.now();
  const f = JSON.parse(sessionStorage.getItem('nabe_f5') || '[]').filter(t => n - t < 60000).concat(n);
  sessionStorage.setItem('nabe_f5', JSON.stringify(f));
  if (f.length >= 3) setTimeout(() => nabeSier(T('Å laste siden på nytt fikser ikke BACnet. Jeg har sjekket.', 'Reloading the page does not fix BACnet. I checked.'), 'skvatt'), 1500);
} catch {}

// An error toast gets a sigh.
const _toastFoer = toast;
toast = function (tekst, feil, ...rest) {
  if (feil && typeof nabeKlasse === 'function') nabeKlasse('trist', 2500);
  return _toastFoer(tekst, feil, ...rest);
};

// A scan that takes a while.
let LANG_SKANN = 0;
setInterval(() => {
  if (document.body.classList.contains('skanner')) {
    if (++LANG_SKANN === 60) nabeSier(T('Dette tar tid. Jeg strikker en sokk imens.', 'This is taking a while. I am knitting a sock meanwhile.'), null, 'strikk');
  } else LANG_SKANN = 0;
}, 1000);

// Long searches and old habits.
$('q')?.addEventListener('input', (e) => {
  const v = e.target.value;
  if (v.length > 45) nabeSier(T('Det er et søk, ikke en roman.', 'It is a search, not a novel.'), 'skvatt', 'roman');
  if (/^sudo\b/i.test(v.trim())) nabeSier(T('Nei. Ikke her heller.', 'No. Not here either.'), 'skvatt', 'sudo');
});

// A cramped window.
addEventListener('resize', () => {
  if (innerWidth < 1000) nabeSier(T('Trangt her inne.', 'Cramped in here.'), 'skvatt', 'trangt');
});

// Asleep long enough to dream.
setInterval(() => {
  const m = nabeMerke();
  if (m && m.classList.contains('sover') && Date.now() - NABE.sist > 5 * 60000)
    nabeSier(T('zZ… 4194303… zZ… nei, ikke prioritet 1… zZ', 'zZ… 4194303… zZ… no, not priority 1… zZ'), null, 'drom');
}, 30000);
