/* NABE - QR-kode uten avhengigheter.

   Byte-modus, feilretting L eller M, versjon 1 til 10 (opptil 213 byte). Nok til en
   adresse med kode, og til en Wi-Fi-kode med nettnavn og passord. Tegnes som SVG,
   alltid svart på hvitt med stille sone, uansett tema, fordi en skanner trenger
   kontrasten. Rekkefølgen følger ISO 18004; testet mot segno og OpenCV. */
(function (root) {
  'use strict';

  // GF(256) med polynom 0x11D
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

  function rsGenerator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const neste = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { neste[j] ^= g[j]; neste[j + 1] ^= mul(g[j], EXP[i]); }
      g = neste;
    }
    return g;
  }
  function rsRest(data, n) {
    const g = rsGenerator(n), rest = new Array(n).fill(0);
    for (const b of data) {
      const f = b ^ rest[0];
      rest.shift(); rest.push(0);
      if (f) for (let i = 0; i < n; i++) rest[i] ^= mul(g[i + 1], f);
    }
    return rest;
  }

  // [ecc per blokk, antall blokker gruppe 1, data per blokk gruppe 1, antall gruppe 2, data per blokk gruppe 2]
  const EC = {
    L: {1: [7, 1, 19, 0, 0], 2: [10, 1, 34, 0, 0], 3: [15, 1, 55, 0, 0], 4: [20, 1, 80, 0, 0], 5: [26, 1, 108, 0, 0],
        6: [18, 2, 68, 0, 0], 7: [20, 2, 78, 0, 0], 8: [24, 2, 97, 0, 0], 9: [30, 2, 116, 0, 0], 10: [18, 2, 68, 2, 69]},
    M: {1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0],
        6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44]},
  };
  const FORMAT_BITS = {L: 1, M: 0};
  const dataCw = (v, e) => { const t = EC[e][v]; return t[1] * t[2] + t[3] * t[4]; };

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(unescape(encodeURIComponent(s))).map(c => c.charCodeAt(0));
  }

  function lagKodeord(bytes, v, e) {
    const bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4);
    put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const kapasitet = dataCw(v, e) * 8;
    put(0, Math.min(4, kapasitet - bits.length));
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    for (let pad = 0xEC; cw.length < dataCw(v, e); pad ^= 0xEC ^ 0x11) cw.push(pad);

    const [ecc, n1, d1, n2, d2] = EC[e][v];
    const blokker = [], eccBlokker = [];
    let pos = 0;
    for (let i = 0; i < n1 + n2; i++) {
      const len = i < n1 ? d1 : d2;
      const blokk = cw.slice(pos, pos + len);
      pos += len;
      blokker.push(blokk);
      eccBlokker.push(rsRest(blokk, ecc));
    }
    const ut = [];
    const maks = Math.max(d1, d2);
    for (let i = 0; i < maks; i++) blokker.forEach(b => { if (i < b.length) ut.push(b[i]); });
    for (let i = 0; i < ecc; i++) eccBlokker.forEach(b => ut.push(b[i]));
    return ut;
  }

  function posisjoner(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
    const steg = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const ut = [6];
    for (let p = size - 7; ut.length < n; p -= steg) ut.splice(1, 0, p);
    return ut;
  }

  const MASKER = [
    (i, j) => (i + j) % 2 === 0,
    (i, j) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
    (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
    (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0,
  ];

  function straff(m) {
    const n = m.length;
    let p = 0, morke = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (m[a][b]) morke++;
    const linje = (get) => {
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b <= n; b++) {
          if (b < n && get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) p += 3 + (run - 5); run = 1; }
        }
        let s = '0000';
        for (let b = 0; b < n; b++) s += get(a, b) ? '1' : '0';
        s += '0000';
        for (const mal of ['10111010000', '00001011101']) { let k = -1; while ((k = s.indexOf(mal, k + 1)) >= 0) p += 40; }
      }
    };
    linje((a, b) => m[a][b]);
    linje((a, b) => m[b][a]);
    for (let a = 0; a < n - 1; a++) for (let b = 0; b < n - 1; b++) {
      const c = m[a][b];
      if (c === m[a][b + 1] && c === m[a + 1][b] && c === m[a + 1][b + 1]) p += 3;
    }
    const total = n * n;
    p += 10 * (Math.ceil(Math.abs(morke * 20 - total * 10) / total) - 1);
    return p;
  }

  function lag(tekst, valg) {
    valg = valg || {};
    const e = valg.ecc === 'L' ? 'L' : 'M';
    const bytes = utf8(String(tekst));
    let v = 0;
    for (let k = 1; k <= 10; k++) {
      if (4 + (k < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(k, e) * 8) { v = k; break; }
    }
    if (!v) throw new Error('For lang tekst til QR-kode (maks ' + (dataCw(10, e) - 3) + ' byte)');
    const size = v * 4 + 17;
    const kode = lagKodeord(bytes, v, e);

    const mod = Array.from({length: size}, () => new Array(size).fill(false));
    const fn = Array.from({length: size}, () => new Array(size).fill(false));
    const sett = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { sett(6, i, i % 2 === 0); sett(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) sett(x, y, dist !== 2 && dist !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = posisjoner(v);
    al.forEach((cy, i) => al.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sett(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));

    const formatInfo = (maske) => {
      const data = FORMAT_BITS[e] << 3 | maske;
      let rest = data;
      for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
      const bits = (data << 10 | rest) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) sett(8, i, bit(i));
      sett(8, 7, bit(6)); sett(8, 8, bit(7)); sett(7, 8, bit(8));
      for (let i = 9; i < 15; i++) sett(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) sett(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) sett(8, size - 15 + i, bit(i));
      sett(8, size - 8, true);
    };
    formatInfo(0);   // reserverer plassen

    if (v >= 7) {
      let rest = v;
      for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1F25);
      const bits = v << 12 | rest;
      for (let i = 0; i < 18; i++) {
        const d = ((bits >>> i) & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3);
        sett(a, b, d); sett(b, a, d);
      }
    }

    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, oppover = ((right + 1) & 2) === 0, y = oppover ? size - 1 - vert : vert;
          if (!fn[y][x] && k < kode.length * 8) { mod[y][x] = ((kode[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0; k++; }
        }
      }
    }

    const bruk = (maske) => {
      const m = mod.map(r => r.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKER[maske](y, x)) m[y][x] = !m[y][x];
      return m;
    };
    // Formatbitene skrives på nytt for hver maske som prøves, og til slutt for den valgte.
    let beste = -1, bestePoeng = Infinity;
    const prov = valg.mask === 0 || valg.mask ? [valg.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
    for (const maske of prov) {
      formatInfo(maske);
      const m = bruk(maske);
      const p = straff(m);
      if (p < bestePoeng) { bestePoeng = p; beste = maske; }
    }
    formatInfo(beste);
    return {size, version: v, mask: beste, ecc: e, modules: bruk(beste)};
  }

  function svg(tekst, valg) {
    valg = valg || {};
    const q = lag(tekst, valg), kant = valg.border == null ? 4 : valg.border, n = q.size + kant * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) {
      let x = 0;
      while (x < q.size) {
        if (!q.modules[y][x]) { x++; continue; }
        let b = x;
        while (b < q.size && q.modules[y][b]) b++;
        d += 'M' + (x + kant) + ',' + (y + kant) + 'h' + (b - x) + 'v1h-' + (b - x) + 'z';
        x = b;
      }
    }
    const px = valg.px || 200;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges" role="img"'
      + ' aria-label="' + (valg.label || 'QR') + '"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  // Wi-Fi-kode: telefonen kobler til ved å skanne. Spesialtegn skjermes med bakstrek.
  function wifi(ssid, passord) {
    const e = s => String(s || '').replace(/([\\;,:"])/g, '\\$1');
    return 'WIFI:T:' + (passord ? 'WPA' : 'nopass') + ';S:' + e(ssid) + ';' + (passord ? 'P:' + e(passord) + ';' : '') + ';';
  }

  const api = {make: lag, svg: svg, wifi: wifi};
  root.nabeQr = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
