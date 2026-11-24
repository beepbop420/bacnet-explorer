/* NABE - igangkjøring. Tre ting som hører sammen når en enhet skal kontrolleres:

   1. Protokollen fra FastEL (PHB-M0801, Excel): åpnes, og hver rad (+F=360.01-RT400) kobles til punktet i enheten.
   2. IO-lista limt inn fra Excel, uten protokollen, sammenlignet med punktene i enheten.
   3. Avkrysning: hvert punkt merkes OK eller Avvik, med verdi og klokkeslett. Fra protokollen lages en utfylt KOPI:
      originalen røres aldri, bare tomme felt fylles, og det du selv har skrevet står urørt.

   Lesing og lokal lagring. Ingenting skrives til anlegget. */
'use strict';

(function igang() {
  const NORM = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9æøå]+/g, '');
  const TYPER = {ai: 'analog-input', ao: 'analog-output', av: 'analog-value', bi: 'binary-input', bo: 'binary-output', bv: 'binary-value',
                 msi: 'multi-state-input', mso: 'multi-state-output', msv: 'multi-state-value'};
  const typeNorm = (t) => {
    const k = String(t || '').trim().toLowerCase();
    if (!k) return '';
    if (TYPER[k]) return TYPER[k];
    const m = k.replace(/[ _]+/g, '-');
    return Object.values(TYPER).includes(m) ? m : '';
  };
  // Samme enhet skrevet på ulike måter: det som står i lista og det BACnet kaller den
  const ENH = {degc: '°c', c: '°c', 'grc': '°c', celsius: '°c', grader: '°c', 'degrees-celsius': '°c',
               prosent: '%', percent: '%', pct: '%', '%rh': '%', 'percent-relative-humidity': '%',
               pascals: 'pa', kilopascals: 'kpa', kilowatts: 'kw', 'parts-per-million': 'ppm',
               'm3/h': 'm³/h', m3h: 'm³/h', 'cubic-meters-per-hour': 'm³/h', 'litres-per-second': 'l/s', 'liters-per-second': 'l/s',
               'volts': 'v', 'amperes': 'a', 'hertz': 'hz', 'seconds': 's', 'minutes': 'min', 'hours': 't', 'kilowatt-hours': 'kwh'};
  const enhetNorm = (u) => { const k = String(u || '').trim().toLowerCase().replace(/\s+/g, ''); return ENH[k] || k; };
  const erAnalog = (t) => String(t || '').startsWith('analog');

  /* Lista som tekst til rader. Første rad kan være overskrifter (Navn, Beskrivelse, Enhet, Type); uten dem leses første kolonne som navn. */
  function les(tekst) {
    const linjer = String(tekst || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!linjer.length) return [];
    const skille = linjer.some(l => l.includes('\t')) ? '\t' : (linjer[0].split(';').length >= linjer[0].split(',').length ? ';' : ',');
    const rader = linjer.map(l => l.split(skille).map(c => c.trim().replace(/^"(.*)"$/, '$1').trim()));
    const FELT = {
      navn: /^(navn|name|tag|punkt|punktnavn|signal|objekt|objektnavn|object.?name)$/i,
      besk: /^(besk|beskrivelse|description|desc|tekst|funksjon)/i,
      enhet: /^(enhet|unit|units)$/i,
      type: /^(type|objekttype|object.?type)$/i,
    };
    const idx = {};
    rader[0].forEach((c, i) => { for (const k of Object.keys(FELT)) if (!(k in idx) && FELT[k].test(c)) idx[k] = i; });
    const harHode = 'navn' in idx;
    if (!harHode) idx.navn = 0;
    const kol = (r, k) => (k in idx ? (r[idx[k]] || '') : '');
    return rader.slice(harHode ? 1 : 0).map(r => ({navn: kol(r, 'navn'), besk: kol(r, 'besk'), enhet: kol(r, 'enhet'), type: kol(r, 'type')}))
      .filter(r => r.navn);
  }

  /* Lista mot punktene. Navn sammenlignes uten store/små bokstaver og skilletegn; hvis det ikke treffer, godtas ett entydig
     treff der det ene navnet er slutten på det andre (lista har ofte uten systemprefikset). Flere mulige treff gjettes ikke på. */
  function sammenlign(io, punkter) {
    const per = new Map();
    for (const p of punkter) { const k = NORM(p.name || p.objid); if (!per.has(k)) per.set(k, []); per.get(k).push(p); }
    const brukt = new Set(), ut = [];
    for (const r of io) {
      const k = NORM(r.navn);
      let p = (per.get(k) || []).find(x => !brukt.has(x)) || null, omtrent = false;
      if (!p && k.length >= 4) {
        const kand = punkter.filter(x => { const n = NORM(x.name); return !brukt.has(x) && n.length >= 4 && (n.endsWith(k) || k.endsWith(n)); });
        if (kand.length === 1) { p = kand[0]; omtrent = true; }
      }
      if (!p) { ut.push({io: r, p: null, art: 'mangler', feil: []}); continue; }
      brukt.add(p);
      const feil = [];
      const t = typeNorm(r.type);
      if (t && t !== p.type) feil.push('type');
      // Enhet gir bare mening på analoge punkter; binære og flertilstand har tekster, ikke enheter
      if (r.enhet && erAnalog(p.type) && !(enhetNorm(r.enhet) === enhetNorm(p.unit_symbol) || enhetNorm(r.enhet) === enhetNorm(p.units))) feil.push('enhet');
      ut.push({io: r, p, art: feil.length ? 'avvik' : 'ok', feil, omtrent});
    }
    for (const p of punkter) if (!brukt.has(p)) ut.push({io: null, p, art: 'ekstra', feil: []});
    return ut;
  }

  /* ----------------------------------------------------------------- protokollen fra FastEL */
  /* Komponenten i protokollen står som +F=360.01-RT400: system 360, nummer 01 (= 001), koden RT400. */
  const TAG_RE = /(\d{3})\.(\d{2,4})-([A-ZÆØÅ]{1,3})(\d{1,4})/i;
  function tagFra(t) {
    const m = TAG_RE.exec(String(t || ''));
    return m ? {sys: m[1], nr: parseInt(m[2], 10), bokst: m[3].toUpperCase(), tall: parseInt(m[4], 10)} : null;
  }
  const SYSNR_I_NAVN = /(?<![0-9])[Ss]?3[1-8]0[._-]?[0-9]{2,3}(?![0-9])/;
  const ORD_SYN = {alarm: ['feil', 'fault', 'alarm'], utløst: ['utl', 'trip', 'alarm'], pådrag: ['padrag', 'pådrag', 'styr', 'out'], paav: ['paav', 'drift', 'start', 'run', 'cmd'],
                   service: ['service', 'serv'], temperatur: ['temp'], trykk: ['trykk', 'pres'], luftmengde: ['luft', 'flow', 'mengde']};
  /* Hva raden og punktet handler om: alarm, drift (på/av, status) eller pådrag. Peker de på hver sin ting, hører de ikke sammen,
     selv om koden i navnet er den samme (JP01 på/av og JP01 alarm er to ulike punkter). Uten ord i en av dem avgjør ikke dette noe. */
  const GRUPPER = {alarm: /alarm|feil|fault|utl[øo]st|trip/, drift: /p[aå]\/?av|drift|start|stopp|run|cmd|status/, padrag: /p[aå]drag|0-10\s?v|styresignal/};
  const grupperAv = (t) => { const l = String(t || '').toLowerCase(); return Object.keys(GRUPPER).filter(g => GRUPPER[g].test(l)); };
  const passerFunksjon = (rad, p) => {
    const r = grupperAv(rad.funk), q = grupperAv((p.name || '') + ' ' + (p.description || ''));
    return !r.length || !q.length || r.some(g => q.includes(g));
  };
  const ordAv = (s) => String(s || '').toLowerCase().replace(/p[aå]\/av/g, 'paav').match(/[a-zæøå]{3,}/g) || [];
  function poeng(rad, p) {
    const tekst = ((p.name || '') + ' ' + (p.description || '')).toLowerCase();
    let s = 0;
    for (const o of ordAv(`${rad.komp} ${rad.plass} ${rad.funk}`)) {
      if (tekst.includes(o)) s += 2;
      for (const syn of (ORD_SYN[o] || [])) if (tekst.includes(syn)) { s += 1; break; }
    }
    return s;
  }
  /* Radene i protokollen mot punktene i enheten. Koden må stå som eget ord i navnet (RT400, ikke RT4001). Står det et
     systemnummer i navnet, må det være det samme som i protokollen. Er flere igjen, avgjør ordene i raden (Alarm, Service ...);
     er det uavgjort, gjettes det ikke. */
  function kobl(rader, punkter) {
    return rader.map(r => {
      if (r.ledig) return {prot: r, p: null, art: 'ledig', feil: []};
      const tag = tagFra(r.system);
      if (!tag) return {prot: r, p: null, art: 'mangler', feil: [], arsak: 'tag'};
      const kode = new RegExp(`(?<![A-Za-z0-9])${tag.bokst}0*${tag.tall}(?![0-9])`, 'i');
      const sysRe = new RegExp(`(?<![0-9])[Ss]?${tag.sys}[._-]?0*${tag.nr}(?![0-9])`);
      let kand = punkter.filter(p => kode.test(p.name || ''));
      if (!kand.length) kand = punkter.filter(p => kode.test(p.description || ''));
      kand = kand.filter(p => (!SYSNR_I_NAVN.test(p.name || '') || sysRe.test(p.name || '')) && passerFunksjon(r, p));
      if (!kand.length) return {prot: r, p: null, art: 'mangler', feil: [], arsak: 'punkt'};
      if (kand.length === 1) return {prot: r, p: kand[0], art: 'ok', feil: []};
      const med = kand.filter(p => sysRe.test(p.name || ''));
      if (med.length === 1) return {prot: r, p: med[0], art: 'ok', feil: []};
      const rangert = (med.length ? med : kand).map(p => [poeng(r, p), p]).sort((a, b) => b[0] - a[0]);
      if (rangert[0][0] > 0 && rangert[0][0] > rangert[1][0]) return {prot: r, p: rangert[0][1], art: 'ok', feil: []};
      return {prot: r, p: null, art: 'flere', feil: [], kand: kand.length};
    });
  }

  const lagNokkel = () => 'nabe.igang.' + ((S.activeDev && S.activeDev.device_instance) ?? 'x');
  const hent = () => { try { return JSON.parse(localStorage.getItem(lagNokkel()) || '{}') || {}; } catch { return {}; } };
  const lagre = (d) => { try { localStorage.setItem(lagNokkel(), JSON.stringify(d)); } catch { /* uten lagring virker den like fullt, bare ikke etter omstart */ } };
  const SIGN_NOKKEL = 'nabe.igang.sign';
  const lesLokal = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const skrivLokal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ok */ } };

  let tilst = {io: [], sjekk: {}, prot: null}, prot = null, filter = 'alle', puls = 0;
  const lokal = () => (SPRAAK === 'en' ? 'en-GB' : 'nb-NO');
  const klokke = (t) => new Date(t * 1000).toLocaleTimeString(lokal(), {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  const verdiTekst = (p) => (p ? (fmtVal(p.value).t + (p.unit_symbol || '')).trim() : '');
  const arkNaa = () => (prot ? prot.ark.find(a => a.navn === tilst.prot.ark) || prot.ark[0] : null);
  const nokkelFor = (r) => r.prot ? `p|${(arkNaa() || {}).navn}|${r.prot.rad}` : NORM(r.p ? (r.p.name || r.p.objid) : r.io.navn);

  function rader() {
    const pts = S.points || [];
    const a = arkNaa();
    if (a) return kobl(a.rader, pts).filter(r => r.art !== 'ledig');
    if (tilst.io.length) return sammenlign(tilst.io, pts);
    const valgte = typeof selectedVisible === 'function' ? selectedVisible() : [];
    return (valgte.length ? valgte : pts).map(p => ({io: null, p, art: 'punkt', feil: []}));
  }
  const ART = {
    mangler: (r) => r.prot ? (r.arsak === 'tag' ? T('Ingen systemtagg i raden', 'No system tag in the row') : T('Fant ikke punktet i enheten', 'Could not find the point in the device')) : T('Mangler i enheten', 'Missing in the device'),
    flere: (r) => T(`${r.kand} mulige punkter, velg selv`, `${r.kand} possible points, pick one yourself`),
    ekstra: () => T('Ikke i lista', 'Not in the list'),
    avvik: (r) => r.feil.map(f => f === 'enhet' ? T(`Enhet: lista ${r.io.enhet}, enheten ${r.p.unit_symbol || r.p.units || 'ingen'}`, `Unit: list ${r.io.enhet}, device ${r.p.unit_symbol || r.p.units || 'none'}`)
      : T(`Type: lista ${r.io.type}, enheten ${r.p.type}`, `Type: list ${r.io.type}, device ${r.p.type}`)).join(' · '),
  };
  const FILTRE = [['alle', () => T('Alle', 'All')], ['mangler', () => T('Mangler', 'Missing')], ['flere', () => T('Flere treff', 'Several')], ['ekstra', () => T('Ekstra', 'Extra')],
                  ['avvik', () => T('Avviker', 'Differs')], ['ikke', () => T('Ikke sjekket', 'Not checked')], ['sjekket', () => T('Sjekket', 'Checked')]];
  const treffer = (r, f) => f === 'alle' ? true : f === 'ikke' ? !tilst.sjekk[nokkelFor(r)] : f === 'sjekket' ? !!tilst.sjekk[nokkelFor(r)] : r.art === f;

  /* Hva punktet gjør akkurat nå som er verdt en merknad: overstyrt, ute av drift eller feilmeldt, eller en verdi som ikke kan stemme */
  function flaggTekst(p) {
    if (!p) return '';
    const fl = Array.isArray(p.status) ? p.status : [];
    const ord = [];
    // Norsk uansett visningsspråk: teksten havner i en protokoll som leveres på norsk
    if (fl.includes('overridden')) ord.push('overstyrt');
    if (fl.includes('out-of-service')) ord.push('ute av drift');
    if (fl.includes('fault')) ord.push('feilmeldt');
    if (fl.includes('in-alarm')) ord.push('i alarm');
    const rar = typeof rarGrunn === 'function' ? rarGrunn(p) : '';
    if (rar) ord.push(rar);
    return ord.join(', ');
  }

  /* Det som skal inn i kopien. Hver rad får bare det NABE har grunnlag for:
     - merket OK av deg: I/O og Prog.-funksjon OK, dato og sign, og verdien du så som internt notat (Bilde (CP) lar NABE være)
     - merket Avvik: Prog.-funksjon Feil, merknaden din som Merknad og feilbeskrivelse
     - ikke merket: bare merknader om det NABE ser (punktet finnes ikke, overstyrt/feilmeldt), og med valget på også Prog.-funksjon OK
       for punkter som finnes og leser fornuftig. Det siste er en signatur for noe du ikke har sjekket selv, så det er av som standard. */
  function byggFyll(alle, v, ark) {
    const nu = new Date(), dato = nu.toLocaleDateString('nb-NO', {day: '2-digit', month: '2-digit', year: 'numeric'}).replace(/\//g, '.');
    const tid = nu.toLocaleTimeString('nb-NO', {hour: '2-digit', minute: '2-digit'});
    const stempel = v.sign ? `${dato}/${v.sign}` : dato;
    const f = [];
    const slikt = (rad, felt, verdi) => { if (verdi) f.push({ark, rad, felt, verdi}); };
    let alleOk = alle.length > 0;
    for (const r of alle) {
      const rad = r.prot.rad, s = tilst.sjekk[nokkelFor(r)], p = r.p;
      const bevis = p ? `NABE ${dato} ${tid}: ${verdiTekst(p)} (${p.name || p.objid})` : '';
      const flagg = flaggTekst(p);
      if (s && s.s === 'ok') {
        slikt(rad, 'io', 'OK'); slikt(rad, 'prog', 'OK'); slikt(rad, 'testet', stempel);
        slikt(rad, 'intern', `NABE ${new Date(s.t * 1000).toLocaleString('nb-NO', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}: ${s.v}${p ? ` (${p.name || p.objid})` : ''}`);
        if (v.merkFlagg && flagg) slikt(rad, 'merk', `Punktet står som ${flagg} i NABE`);
      } else if (s && s.s === 'avvik') {
        alleOk = false;
        const n = s.n || 'Avvik funnet under igangkjøring';
        slikt(rad, 'prog', 'Feil'); slikt(rad, 'merk', n); slikt(rad, 'feilbesk', n); slikt(rad, 'testet', stempel); slikt(rad, 'intern', bevis);
      } else {
        const plausibelt = p && !flagg;
        if (v.autoProg && plausibelt) {
          slikt(rad, 'prog', 'OK'); slikt(rad, 'testet', stempel);
          slikt(rad, 'intern', bevis + ' (lest av NABE, ikke krysset av manuelt)');
        } else alleOk = false;
        if (v.merkMangler && r.art === 'mangler') slikt(rad, 'merk', `Fant ikke punkt for ${[r.prot.komp, r.prot.funk].filter(Boolean).join(' ') || r.prot.system} i BACnet-enheten (NABE ${dato})`);
        else if (v.merkMangler && r.art === 'flere') slikt(rad, 'merk', `${r.kand} mulige punkter i BACnet-enheten, ikke koblet (NABE ${dato})`);
        else if (v.merkFlagg && flagg) slikt(rad, 'merk', `Punktet står som ${flagg} i NABE (${dato})`);
      }
    }
    if (v.ansvarlig) f.push({ark, topp: 'ansvarlig', verdi: v.ansvarlig});
    if (alleOk) f.push({ark, topp: 'ferdig', verdi: dato});
    return f;
  }

  function tegn() {
    const lag = $('igangOverlay');
    const dev = S.activeDev;
    const topp = (inn) => `<div class="gs-modal ig-modal"><div class="gs-head"><span class="gd-tittel">${T('Igangkjøring', 'Commissioning')}</span>${inn}`;
    if (!dev) {
      lag.innerHTML = `${topp('')}<button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
        <div class="op-kropp"><p class="op-tekst">${T('Åpne en enhet først.', 'Open a device first.')}</p></div></div>`;
      return;
    }
    const a = arkNaa();
    const alle = rader(), medListe = tilst.io.length > 0 && !a;
    const tall = {alle: alle.length};
    for (const [f] of FILTRE) if (f !== 'alle') tall[f] = alle.filter(r => treffer(r, f)).length;
    const synlige = alle.filter(r => treffer(r, filter));
    const filtre = FILTRE.filter(([f]) => f === 'alle' || f === 'ikke' || f === 'sjekket' || (a ? (f === 'mangler' || f === 'flere') : medListe && f !== 'flere'))
      .map(([f, n]) => `<button type="button" class="ig-chip${filter === f ? ' paa' : ''}" data-ig="filter" data-f="${f}">${esc(n())} <b>${tall[f]}</b></button>`).join('');
    const rad = (r) => {
      const k = nokkelFor(r), s = tilst.sjekk[k], p = r.p;
      const pr = r.prot;
      const navn = pr ? (pr.system || pr.komp) : (p ? (p.name || p.objid) : r.io.navn);
      const besk = pr ? [pr.komp, pr.plass, pr.funk].filter(Boolean).join(' · ') : ((r.io && r.io.besk) || (p && p.description) || '');
      const merk = r.art === 'mangler' ? ART.mangler(r) : r.art === 'flere' ? ART.flere(r) : r.art === 'ekstra' ? ART.ekstra() : r.art === 'avvik' ? ART.avvik(r) : '';
      const koblet = pr && p ? `<small class="sp-meta">→ ${esc(p.name || p.objid)}</small>` : '';
      const flagg = pr && p ? flaggTekst(p) : '';
      const knapper = p
        ? `<button type="button" class="ig-k${s && s.s === 'ok' ? ' ok' : ''}" data-ig="sjekk" data-s="ok" data-k="${esc(k)}">OK</button>
           <button type="button" class="ig-k${s && s.s === 'avvik' ? ' avvik' : ''}" data-ig="sjekk" data-s="avvik" data-k="${esc(k)}">${T('Avvik', 'Differs')}</button>`
        : '';
      const spor = s ? `<small class="sp-meta" title="${esc(s.n || '')}">${esc(s.v)} · ${esc(klokke(s.t))}${s.n ? ' · ' + esc(s.n) : ''}</small>` : '';
      return `<tr data-k="${esc(k)}"${p ? ` data-o="${esc(p.objid)}"` : ''}>
        <td class="ig-navn">${p && !pr ? `<a data-ig="gaa" data-o="${esc(p.objid)}">${esc(navn)}</a>` : esc(navn)}${besk ? `<small class="sp-meta">${esc(besk)}</small>` : ''}${koblet}</td>
        <td class="ig-art${r.art === 'ok' || r.art === 'punkt' ? (flagg ? ' funn' : '') : ' funn'}">${esc(merk || flagg)}${r.omtrent ? `<small class="sp-meta">${esc(T('koblet til ' + (p.name || ''), 'matched to ' + (p.name || '')))}</small>` : ''}</td>
        <td class="t ig-v" data-v="${p ? esc(p.objid) : ''}">${esc(verdiTekst(p))}</td>
        <td class="ig-sjekk">${knapper}${spor}</td></tr>`;
    };
    const oppsummering = a
      ? T(`${alle.length} rader i «${a.navn}»: ${alle.length - tall.mangler - tall.flere} koblet til et punkt, ${tall.mangler} uten punkt, ${tall.flere} med flere mulige. ${tall.sjekket} krysset av.`,
          `${alle.length} rows in “${a.navn}”: ${alle.length - tall.mangler - tall.flere} linked to a point, ${tall.mangler} without a point, ${tall.flere} with several possible. ${tall.sjekket} ticked off.`)
      : medListe
        ? T(`${tilst.io.length} i lista, ${tall.mangler} mangler i enheten, ${tall.ekstra} ekstra i enheten, ${tall.avvik} avviker.`,
            `${tilst.io.length} in the list, ${tall.mangler} missing in the device, ${tall.ekstra} extra in the device, ${tall.avvik} differ.`)
        : T('Åpne protokollen fra FastEL, eller lim inn IO-lista fra Excel. Uten dem kan du krysse av punktene du har valgt i tabellen (eller alle).',
            'Open the protocol from FastEL, or paste the IO list from Excel. Without them you can check off the points selected in the table (or all).');
    const sign = lesLokal(SIGN_NOKKEL) || {sign: '', ansvarlig: ''};
    const protLinje = `<div class="ig-prot">
        <label class="btn ig-fil">${T('Åpne protokoll…', 'Open protocol…')}<input type="file" id="igProt" accept=".xlsm,.xlsx" hidden></label>
        ${a ? `<span class="sp-meta ig-protnavn" title="${esc(prot.navn)}">${esc(prot.navn)}</span>
          ${prot.ark.length > 1 ? `<select id="igArk" class="field">${prot.ark.map(x => `<option value="${esc(x.navn)}"${x.navn === a.navn ? ' selected' : ''}>${esc(x.navn)}</option>`).join('')}</select>` : ''}
          <button type="button" class="btn" data-ig="lukkprot">${T('Lukk protokoll', 'Close protocol')}</button>` : ''}
      </div>`;
    const fyllPanel = a ? `<details class="ig-fyll"><summary>${T('Lag utfylt kopi av protokollen', 'Make a filled copy of the protocol')}</summary>
        <div class="ig-fyllrad"><label>${T('Sign.', 'Sign.')}<input id="igSign" class="field" value="${esc(sign.sign)}" placeholder="MaLi" maxlength="12"></label>
          <label>${T('Ansvarlig', 'Responsible')}<input id="igAnsv" class="field" value="${esc(sign.ansvarlig)}" placeholder="${esc(T('fullt navn, valgfritt', 'full name, optional'))}"></label></div>
        <label class="ig-valg"><input type="checkbox" id="igMangler" checked> ${T('Merknad der jeg ikke fant punktet', 'Remark where no point was found')}</label>
        <label class="ig-valg"><input type="checkbox" id="igFlagg" checked> ${T('Merknad ved overstyrte, ute av drift og feilmeldte punkter', 'Remark on overridden, out of service and faulty points')}</label>
        <label class="ig-valg"><input type="checkbox" id="igAuto"> ${T('Prog.-funksjon OK også for punkter jeg ikke har krysset av, når de finnes og leser fornuftig', 'Prog.-funksjon OK also for points I have not ticked, when they exist and read sensibly')}</label>
        <p class="op-tekst">${T('Bare tomme felt fylles. Det som står der fra før røres ikke, og originalen endres aldri. Bilde (CP) og kritiske funksjoner fyller du selv.', 'Only empty fields are filled. What is there already is not touched, and the original never changes. You fill Bilde (CP) and the critical functions yourself.')}</p>
        <div class="op-knapper"><button type="button" class="btn primary" data-ig="kopi">${T('Lag kopi', 'Make copy')}</button></div>
      </details>` : '';
    lag.innerHTML = `${topp(`<span class="gs-meta" style="border:0;padding:0 0 0 8px">${esc(dev.object_name || dev.address)}</span>`)}
        <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="ig-kropp">
        ${protLinje}
        ${a ? '' : `<details class="ig-lista"${medListe ? '' : ''}><summary>${T('IO-liste', 'IO list')}${medListe ? ` · ${tilst.io.length}` : ''}</summary>
          <textarea id="igTekst" class="field" rows="5" spellcheck="false" placeholder="${esc(T('Marker cellene i Excel, kopier og lim inn her. Kolonner: Navn, Beskrivelse, Enhet, Type (AI, AO, AV, BI, BO, BV, MSI, MSO, MSV). Første rad kan være overskrifter.', 'Select the cells in Excel, copy and paste here. Columns: Name, Description, Unit, Type (AI, AO, AV, BI, BO, BV, MSI, MSO, MSV). The first row may be headings.'))}"></textarea>
          <div class="op-knapper"><label class="btn ig-fil">${T('Les CSV-fil…', 'Read CSV file…')}<input type="file" id="igFil" accept=".csv,.tsv,.txt" hidden></label>
            ${medListe ? `<button type="button" class="btn" data-ig="tom">${T('Fjern lista', 'Remove the list')}</button>` : ''}
            <button type="button" class="btn primary" data-ig="les">${T('Les inn', 'Read in')}</button></div>
        </details>`}
        <p class="op-tekst">${esc(oppsummering)}</p>
        <div class="ig-filtre">${filtre}</div>
        <div class="ig-tabell"><table class="sp-tab"><thead><tr><th>${T('Punkt', 'Point')}</th><th>${T('Funn', 'Finding')}</th><th class="t">${T('Verdi nå', 'Value now')}</th><th>${T('Sjekk', 'Check')}</th></tr></thead>
          <tbody>${synlige.map(rad).join('') || `<tr><td colspan="4" class="sp-meta">${T('Ingen rader her.', 'No rows here.')}</td></tr>`}</tbody></table></div>
        ${fyllPanel}
        <div class="op-knapper"><button type="button" class="btn" data-ig="eksport">${T('Eksporter CSV', 'Export CSV')}</button></div>
      </div></div>`;
  }

  function oppdaterVerdier() {
    const lag = $('igangOverlay');
    if (!lag || lag.hidden) { clearInterval(puls); puls = 0; return; }
    lag.querySelectorAll('td[data-v]').forEach(td => {
      const p = td.dataset.v && S.pointIndex.get(td.dataset.v);
      if (p) { const t = verdiTekst(p); if (td.textContent !== t) td.textContent = t; }
    });
  }

  function eksport() {
    const alle = rader();
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const funn = (r) => r.art === 'ok' ? 'OK' : r.art === 'punkt' ? '' : r.art === 'avvik' ? ART.avvik(r) : ART[r.art](r);
    const linjer = [['Navn', 'Beskrivelse', 'Objekt', 'Enhet i lista', 'Enhet i enheten', 'Funn', 'Verdi ved sjekk', 'Status', 'Tidspunkt', 'Notat'].map(q).join(';')];
    for (const r of alle) {
      const s = tilst.sjekk[nokkelFor(r)], p = r.p, pr = r.prot;
      linjer.push([pr ? (pr.system || pr.komp) : (p ? (p.name || p.objid) : r.io.navn), pr ? [pr.komp, pr.plass, pr.funk].filter(Boolean).join(' · ') : ((r.io && r.io.besk) || (p && p.description) || ''),
        p ? p.objid : '', r.io ? r.io.enhet : '', p ? (p.unit_symbol || '') : '',
        funn(r), s ? s.v : '', s ? (s.s === 'ok' ? 'OK' : 'Avvik') : '', s ? new Date(s.t * 1000).toLocaleString(lokal()) : '', s ? (s.n || '') : ''].map(q).join(';'));
    }
    const trygt = String((S.activeDev && S.activeDev.object_name) || 'enhet').replace(/[^A-Za-z0-9ÆØÅæøå_.-]+/g, '_').slice(0, 40);
    downloadText(linjer.join('\r\n'), `Igangkjoring_${trygt}_${new Date().toISOString().slice(0, 10)}.csv`);
    toast(T(`${alle.length} rader eksportert`, `${alle.length} rows exported`));
  }

  async function lastProtokoll(fil) {
    const r = await fetch('/api/igang/les?navn=' + encodeURIComponent(fil.name), {method: 'POST', body: await fil.arrayBuffer()}).then(x => x.json()).catch(() => ({status: 'error'}));
    if (r.status !== 'done') { toast(r.error || T('Fikk ikke lest protokollen', 'Could not read the protocol'), true); return; }
    prot = r;
    // Arket som passer enheten: tavlenummeret står i enhetsnavnet, ellers første
    const navn = String((S.activeDev && S.activeDev.object_name) || '');
    const treff = r.ark.find(x => x.info.tavle && navn.includes(x.info.tavle)) || r.ark[0];
    tilst.prot = {id: r.id, navn: r.navn, ark: treff.navn};
    filter = 'alle'; lagre(tilst); tegn();
    toast(T(`Protokollen er lest: ${r.ark.length} ark, ${treff.rader.length} rader i «${treff.navn}»`, `Protocol read: ${r.ark.length} sheets, ${treff.rader.length} rows in “${treff.navn}”`));
  }

  async function lagKopi(lag) {
    const a = arkNaa();
    if (!a) return;
    const v = {sign: $('igSign').value.trim(), ansvarlig: $('igAnsv').value.trim(), merkMangler: $('igMangler').checked, merkFlagg: $('igFlagg').checked, autoProg: $('igAuto').checked};
    skrivLokal(SIGN_NOKKEL, {sign: v.sign, ansvarlig: v.ansvarlig});
    if (v.autoProg && !v.sign) { toast(T('Skriv sign. først: de fylte radene får navnet ditt', 'Enter your sign. first: the filled rows carry your name'), true); return; }
    const fyllinger = byggFyll(rader().filter(r => r.prot), v, a.navn);
    if (!fyllinger.length) { toast(T('Ingenting å fylle inn ennå. Kryss av punkter først.', 'Nothing to fill in yet. Tick off some points first.'), true); return; }
    const svar = await fetch('/api/igang/fyll', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: tilst.prot.id, fyllinger})}).catch(() => null);
    if (!svar || !svar.ok) {
      const feil = svar ? await svar.json().catch(() => ({})) : {};
      toast(feil.error || T('Fikk ikke laget kopien', 'Could not make the copy'), true);
      return;
    }
    const blob = await svar.blob(), lenke = document.createElement('a');
    lenke.href = URL.createObjectURL(blob);
    lenke.download = decodeURIComponent(svar.headers.get('X-Nabe-Filnavn') || 'protokoll_NABE.xlsm');
    lenke.click();
    setTimeout(() => URL.revokeObjectURL(lenke.href), 2000);
    toast(T(`Kopi laget: ${svar.headers.get('X-Nabe-Fylt')} felt fylt, ${svar.headers.get('X-Nabe-Hoppet')} hoppet over (hadde innhold fra før)`,
            `Copy made: ${svar.headers.get('X-Nabe-Fylt')} fields filled, ${svar.headers.get('X-Nabe-Hoppet')} skipped (already had content)`));
  }

  async function aapne() {
    let lag = $('igangOverlay');
    if (!lag) {
      lag = document.createElement('div');
      lag.id = 'igangOverlay';
      lag.className = 'gs-overlay';
      lag.setAttribute('role', 'dialog');
      lag.setAttribute('aria-modal', 'true');
      document.body.append(lag);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);
      lag.addEventListener('change', async (e) => {
        if (e.target.id === 'igFil' && e.target.files[0]) $('igTekst').value = await e.target.files[0].text();
        else if (e.target.id === 'igProt' && e.target.files[0]) await lastProtokoll(e.target.files[0]);
        else if (e.target.id === 'igArk') { tilst.prot.ark = e.target.value; filter = 'alle'; lagre(tilst); tegn(); }
      });
      lag.addEventListener('click', async (e) => {
        if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
        const el = e.target.closest('[data-ig]');
        if (!el) return;
        const op = el.dataset.ig;
        if (op === 'les') {
          const io = les($('igTekst').value);
          if (!io.length) { toast(T('Fant ingen rader i lista', 'Found no rows in the list'), true); return; }
          tilst.io = io; filter = 'alle'; lagre(tilst); tegn();
        } else if (op === 'tom') { tilst.io = []; filter = 'alle'; lagre(tilst); tegn(); }
        else if (op === 'lukkprot') { tilst.prot = null; prot = null; filter = 'alle'; lagre(tilst); tegn(); }
        else if (op === 'filter') { filter = el.dataset.f; tegn(); }
        else if (op === 'gaa') { lag.hidden = true; selectPoint(el.dataset.o); }
        else if (op === 'eksport') eksport();
        else if (op === 'kopi') await lagKopi(lag);
        else if (op === 'sjekk') {
          const k = el.dataset.k, rad = rader().find(r => nokkelFor(r) === k);
          if (!rad || !rad.p) return;
          if (tilst.sjekk[k] && tilst.sjekk[k].s === el.dataset.s) delete tilst.sjekk[k];   // samme knapp en gang til tar den bort
          else {
            let notat = '';
            if (el.dataset.s === 'avvik') {
              notat = await nabeDialog(T('Hva er avviket? (kan stå tomt)', 'What is the deviation? (may be left empty)'), {standard: ''});
              if (notat === null) return;
            }
            tilst.sjekk[k] = {s: el.dataset.s, v: verdiTekst(rad.p), t: Math.floor(Date.now() / 1000), n: String(notat || '').trim()};
          }
          const apen = lag.querySelector('.ig-fyll')?.open;
          lagre(tilst); tegn();
          if (apen) lag.querySelector('.ig-fyll').open = true;
        }
      });
    }
    tilst = Object.assign({io: [], sjekk: {}, prot: null}, hent());
    prot = null;
    if (tilst.prot && tilst.prot.id) {
      const r = await fetch('/api/igang/hent?id=' + encodeURIComponent(tilst.prot.id)).then(x => x.json()).catch(() => ({status: 'error'}));
      if (r.status === 'done') prot = r; else tilst.prot = null;
    }
    filter = 'alle';
    tegn();
    lag.hidden = false;
    clearInterval(puls);
    puls = setInterval(oppdaterVerdier, 3000);
  }

  window.nabeIgang = {les, sammenlign, tagFra, kobl, byggFyll: (a, v, ark, s) => { tilst = {io: [], sjekk: s || {}, prot: {ark}}; prot = {ark: [{navn: ark, rader: []}], navn: ''}; return byggFyll(a, v, ark); }};   // for selvtesten
  window.aapneIgang = aapne;
  const knapp = $('igangBtn');
  if (knapp) knapp.onclick = () => { closeMenus(); aapne(); };
})();
