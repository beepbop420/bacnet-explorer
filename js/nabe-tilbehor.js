/* NABE and NABO - more for the wardrobe.

   Fifteen more pieces, drawn on the same grid as the others, each earned by doing the
   job and not by clicking: a rain hat for forty visits, a stethoscope for fifty thousand
   points read. They talk to each other when they are put on (see DIA_PLAGG).
   Loaded after the wardrobe, which builds its catalogue from PLAGG when it is opened. */
'use strict';

(function tilbehor() {
  if (typeof PLAGG === 'undefined') return;
  const k = (teller, n, nb, en) => [teller, n, [nb, en]];
  const NYE = [
    // --- head
    {id: 'sydvest', plass: 'hode', navn: ['Sydvest', 'Rain hat'], krav: k('aapnet', 40, 'Åpne NABE 40 ganger', 'Open NABE 40 times'),
     nabe: '<path d="M5 9.4Q5 2.6 16 2.6T27 9.4Z" fill="#f2c230"/><path d="M2 9.2H30L31.4 13Q16 10.6 .6 13Z" fill="#d9a900"/><path d="M5 9.4Q16 7.4 27 9.4" fill="none" stroke="#b88a00" stroke-width=".6"/>',
     nabo: '<path d="M8.2 11Q8.2 4.6 16 4.6T23.8 11Z" fill="#f2c230"/><path d="M6 10.8H26L27 13.6Q16 11.8 5 13.6Z" fill="#d9a900"/>'},
    {id: 'brannhjelm', plass: 'hode', navn: ['Brannhjelm', 'Fire helmet'], krav: k('skriv', 50, 'Skriv 50 ganger', 'Write 50 times'),
     nabe: '<path d="M4.6 9.6Q4.6 2.4 16 2.4T27.4 9.6Z" fill="#d62839"/><rect x="2.6" y="8.8" width="26.8" height="2" rx="1" fill="#a51d2d"/><path d="M12.6 3.2h6.8l1.4 4.6h-9.6z" fill="#f2c230" stroke="#c99a00" stroke-width=".4"/>',
     nabo: '<path d="M7.8 11Q8 4.2 16 4.2T24.2 11Z" fill="#d62839"/><rect x="6.4" y="10.2" width="19.2" height="1.8" rx=".9" fill="#a51d2d"/><path d="M13.4 4.8h5.2l1 3.6h-7.2z" fill="#f2c230"/>'},
    {id: 'orebeskyttere', plass: 'hode', navn: ['Hørselvern', 'Ear defenders'], krav: k('live', 10, 'Slå på Live ti ganger', 'Turn Live on ten times'),
     nabe: '<path d="M3.8 15Q3.8 3.2 16 3.2T28.2 15" fill="none" stroke="#3a3a3e" stroke-width="2"/><rect x="0.6" y="11" width="5.2" height="9" rx="2" fill="#e8742a"/><rect x="26.2" y="11" width="5.2" height="9" rx="2" fill="#e8742a"/>',
     nabo: '<path d="M7 15Q7 5 16 5T25 15" fill="none" stroke="#3a3a3e" stroke-width="1.6"/><rect x="4.4" y="12" width="4" height="6.4" rx="1.6" fill="#e8742a"/><rect x="23.6" y="12" width="4" height="6.4" rx="1.6" fill="#e8742a"/>'},
    {id: 'sykkelhjelm', plass: 'hode', navn: ['Sykkelhjelm', 'Bike helmet'], krav: k('varfil', 5, 'Lag 5 Variabel-filer', 'Make 5 Variabel files'),
     nabe: '<path d="M5 9.6Q5 2.6 16 2.6T27 9.6Z" fill="#2c6be0"/><path d="M8 5.4Q16 2.4 24 5.4M10 7.8Q16 4.8 22 7.8" stroke="#9cc2ff" stroke-width=".7" fill="none"/><rect x="4.4" y="8.8" width="23.2" height="1.8" rx=".9" fill="#1f4fae"/>',
     nabo: '<path d="M8.2 11Q8.2 4.6 16 4.6T23.8 11Z" fill="#2c6be0"/><path d="M10 7.4Q16 5 22 7.4" stroke="#9cc2ff" stroke-width=".6" fill="none"/><rect x="7.4" y="10.2" width="17.2" height="1.6" rx=".8" fill="#1f4fae"/>'},
    {id: 'bandana', plass: 'hode', navn: ['Bandana', 'Bandana'], krav: k('skann', 100, '100 skann', '100 scans'),
     nabe: '<path d="M5 10Q5 3.6 16 3.6T27 10Q16 7.6 5 10Z" fill="#d62839"/><path d="M27 9.6L31.2 8L30 12.4Z" fill="#a51d2d"/><circle cx="12" cy="6.4" r=".7" fill="#fff"/><circle cx="17.6" cy="5.8" r=".7" fill="#fff"/><circle cx="22" cy="7" r=".7" fill="#fff"/>',
     nabo: '<path d="M8.4 11Q8.4 5.6 16 5.6T23.6 11Q16 9 8.4 11Z" fill="#d62839"/><path d="M23.6 10.6L27 9.4L26.2 12.8Z" fill="#a51d2d"/>'},
    // --- face
    {id: 'klovnenese', plass: 'ansikt', navn: ['Klovnenese', 'Clown nose'], krav: k('kos', 50, 'Klapp NABE 50 ganger', 'Pat NABE 50 times'),
     nabe: '<circle cx="16" cy="19.4" r="2.8" fill="#e63946"/><circle cx="15.2" cy="18.6" r=".8" fill="#ff9aa2"/>',
     nabo: '<circle cx="16" cy="16.8" r="1.8" fill="#e63946"/>'},
    {id: 'ansiktsmaske', plass: 'ansikt', navn: ['Munnbind', 'Face mask'], krav: k('skann', 75, '75 skann', '75 scans'),
     nabe: '<path d="M5.6 18.4H26.4L25 25.6Q16 28.4 7 25.6Z" fill="#9fd3f0" stroke="#5aa1c8" stroke-width=".6"/><path d="M5.6 18.4L2.6 16.4M26.4 18.4L29.4 16.4" stroke="#5aa1c8" stroke-width=".7"/><path d="M8 21h16M8.4 23h15.2" stroke="#7bbbe0" stroke-width=".5"/>',
     nabo: '<path d="M10.4 15.6H21.6L21 19.6Q16 21 11 19.6Z" fill="#9fd3f0" stroke="#5aa1c8" stroke-width=".5"/>'},
    // --- neck
    {id: 'stetoskop', plass: 'hals', navn: ['Stetoskop', 'Stethoscope'], krav: k('punkter', 50000, 'Les 50 000 punkter', 'Read 50,000 points'),
     nabe: '<path d="M9.4 24.6Q11 31 16 31.2Q21 31 22.6 24.6" fill="none" stroke="#2b2b2e" stroke-width="1.2"/><circle cx="16" cy="31.4" r="1.9" fill="#9aa4b1" stroke="#6b7480" stroke-width=".5"/>',
     nabo: '<path d="M10.6 21.2Q12 26 16 26.2Q20 26 21.4 21.2" fill="none" stroke="#2b2b2e" stroke-width="1"/><circle cx="16" cy="26.4" r="1.4" fill="#9aa4b1"/>'},
    {id: 'noklering', plass: 'hals', navn: ['Nøkkelkjede', 'Key chain'], krav: k('enheter', 1000, 'Finn 1000 enheter', 'Find 1000 devices'),
     nabe: '<path d="M5.2 25.6Q16 30.4 26.8 25.6" fill="none" stroke="#3a3a3e" stroke-width="1"/><circle cx="16" cy="30" r="1.6" fill="none" stroke="#c9a227" stroke-width=".9"/><path d="M16 31.6v1.2l1 .8M16 32l-1 .8" stroke="#c9a227" stroke-width=".7" fill="none"/>',
     nabo: '<path d="M9.4 21.8Q16 25 22.6 21.8" fill="none" stroke="#3a3a3e" stroke-width=".8"/><circle cx="16" cy="25.2" r="1.2" fill="none" stroke="#c9a227" stroke-width=".7"/>'},
    // --- extra
    {id: 'kaffekopp', plass: 'ekstra', navn: ['Kaffekopp', 'Coffee cup'], krav: k('natt', 3, 'Skann sent tre ganger', 'Scan late three times'),
     nabe: '<rect x="28.6" y="18.6" width="4.2" height="5.6" rx=".8" fill="#fafafa" stroke="#cfcfcf" stroke-width=".4"/><path d="M32.8 19.8Q35 20.6 32.8 23" fill="none" stroke="#cfcfcf" stroke-width=".6"/><path d="M29.8 17.4Q30.4 16 29.8 14.8M31.6 17.4Q32.2 16 31.6 14.8" stroke="#b8c0cc" stroke-width=".5" fill="none"/>',
     nabo: '<rect x="24.4" y="14.6" width="3.4" height="4.4" rx=".7" fill="#fafafa" stroke="#cfcfcf" stroke-width=".3"/><path d="M27.8 15.6Q29.4 16.2 27.8 18" fill="none" stroke="#cfcfcf" stroke-width=".5"/>'},
    {id: 'multimeter', plass: 'ekstra', navn: ['Multimeter', 'Multimeter'], krav: k('skriv', 30, 'Skriv 30 ganger', 'Write 30 times'),
     nabe: '<rect x="28.6" y="14" width="4.6" height="9" rx=".9" fill="#f2c230" stroke="#c99a00" stroke-width=".4"/><rect x="29.2" y="14.8" width="3.4" height="2.6" fill="#9ad0a0"/><circle cx="30.9" cy="20" r="1.3" fill="#2b2b2e"/><path d="M29.4 23v4M32.4 23v4" stroke="#d62839" stroke-width=".6"/>',
     nabo: '<rect x="24.4" y="11.6" width="3.6" height="7" rx=".7" fill="#f2c230" stroke="#c99a00" stroke-width=".3"/><rect x="24.9" y="12.2" width="2.6" height="2" fill="#9ad0a0"/>'},
    {id: 'kabelrull', plass: 'ekstra', navn: ['Kabelrulle', 'Cable reel'], krav: k('enheter', 200, 'Finn 200 enheter', 'Find 200 devices'),
     nabe: '<circle cx="30.4" cy="25" r="3.6" fill="#2b2b2e" stroke="#c9a227" stroke-width=".7"/><circle cx="30.4" cy="25" r="1.2" fill="#c9a227"/><path d="M27 25.6Q22 29 14 29.6" fill="none" stroke="#e8742a" stroke-width=".8"/>',
     nabo: '<circle cx="25.6" cy="21.6" r="2.6" fill="#2b2b2e" stroke="#c9a227" stroke-width=".5"/><circle cx="25.6" cy="21.6" r=".9" fill="#c9a227"/>'},
    {id: 'ballong', plass: 'ekstra', navn: ['Ballong', 'Balloon'], krav: k('varfil', 3, 'Lag 3 Variabel-filer', 'Make 3 Variabel files'),
     nabe: '<path d="M30 2.4Q35 2.4 35 7.2Q35 11.4 30 12.4Q25 11.4 25 7.2Q25 2.4 30 2.4Z" fill="#e63946"/><path d="M29.2 12.4L30.8 12.4L30 13.6Z" fill="#c22f3b"/><path d="M30 13.6Q28 18 29.6 22" fill="none" stroke="#9aa4b1" stroke-width=".4"/>',
     nabo: '<path d="M26.4 3Q30 3 30 6.6Q30 9.6 26.4 10.4Q22.8 9.6 22.8 6.6Q22.8 3 26.4 3Z" fill="#e63946"/><path d="M26.4 10.4Q25 14 26.2 17" fill="none" stroke="#9aa4b1" stroke-width=".3"/>'},
    {id: 'termos', plass: 'ekstra', navn: ['Termos', 'Flask'], krav: k('live', 5, 'Slå på Live fem ganger', 'Turn Live on five times'),
     nabe: '<rect x="-3.2" y="17" width="4.6" height="10" rx="1.4" fill="#2a9d8f"/><rect x="-3.2" y="15.4" width="4.6" height="2.4" rx=".8" fill="#e9f5f3"/><rect x="-2.2" y="20" width="2.6" height="3" fill="#21867a"/>',
     nabo: '<rect x="3" y="14" width="3.4" height="8" rx="1" fill="#2a9d8f"/><rect x="3" y="12.8" width="3.4" height="2" rx=".7" fill="#e9f5f3"/>'},
    {id: 'flagg', plass: 'ekstra', navn: ['Flagg', 'Flag'], krav: k('aapnet', 100, 'Åpne NABE 100 ganger', 'Open NABE 100 times'),
     nabe: '<path d="M-1.6 6V27" stroke="#8a5a2b" stroke-width=".9"/><rect x="-1.2" y="6.4" width="8.4" height="6" fill="#d62839"/><path d="M1.6 6.4v6M-1.2 9.4h8.4" stroke="#fff" stroke-width="1.7"/><path d="M1.6 6.4v6M-1.2 9.4h8.4" stroke="#2c6be0" stroke-width=".8"/>',
     nabo: '<path d="M3.8 7V22" stroke="#8a5a2b" stroke-width=".7"/><rect x="4" y="7.2" width="6" height="4.2" fill="#d62839"/><path d="M6.2 7.2v4.2M4 9.3h6" stroke="#fff" stroke-width="1.2"/><path d="M6.2 7.2v4.2M4 9.3h6" stroke="#2c6be0" stroke-width=".6"/>'},
  ];
  // «Flosshatt» already exists as a name for another piece: the tall one is called «Høy hatt».
  for (const p of NYE) if (!PLAGG.some(x => x.id === p.id)) PLAGG.push(p);

  // What they say when each is put on: from the content file, as the wardrobe wants it.
  if (typeof PLAGG_REPLIKK !== 'undefined' && typeof DIA_PLAGG !== 'undefined' && typeof nabeDialogDel === 'function') {
    for (const [id, linjer] of Object.entries(DIA_PLAGG)) {
      PLAGG_REPLIKK[id] = linjer.map(s => {
        const o = /^O: /.test(s);
        const [nb, en] = nabeDialogDel(s.slice(3));
        return [o ? 'nabo' : 'nabe', nb, en];
      });
    }
  }
  // Device numbers with a story, as a hover note.
  if (typeof NABE_INSTANS !== 'undefined' && typeof DIA_INST !== 'undefined' && typeof nabeDialogDel === 'function') {
    for (const [nr, s] of Object.entries(DIA_INST)) if (!NABE_INSTANS[nr]) NABE_INSTANS[nr] = nabeDialogDel(s);
  }
})();
