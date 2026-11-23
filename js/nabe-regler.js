/* NABE - own rules for the service suggestions.

   What a technician knows about plants, written down as rules in a JSON file and shown with the other suggestions:
   "room temperatures under 19 degrees", "a pump that stands overridden", "a Beckhoff device with three alarms". A rule
   picks out points with conditions (name, type, unit, value, state, flags, device, vendor) and is shown when enough of
   them fit. The conditions are data, not code: nothing in the file is ever run, so a rule can only ask, never do.

   The file is made from a template the first time it is asked for and is never written over after that. A mistake in it
   is not silent: it comes up as a suggestion saying which rule and what is wrong, and a rule with a mistake is left out.
   The functions are plain ones of their input, so they can be tested without a plant. */
'use strict';

(function regler() {
  const FLAGG = ['in-alarm', 'fault', 'overridden', 'out-of-service'];
  const PROTOKOLL = ['bacnet', 'modbus', 'knx'];
  const REGEL_FELT = ['id', 'aktiv', 'tittel', 'hvorfor', 'sjekk', 'prio', 'minst', 'per_enhet', 'naar'];
  const NAAR_FELT = ['navn', 'beskrivelse', 'type', 'enhet', 'verdi', 'tilstand', 'status', 'ikke_status', 'enhetsnavn', 'leverandor', 'protokoll'];
  const OPERATORER = ['<', '>', '<=', '>=', '=', '!=', 'mellom', 'utenfor'];

  /* "navnn" for "navn": the closest known word within two letters, so a slip of the finger is told as one */
  function avstand(a, b) {
    const m = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }
  const mente = (x, liste) => {
    if (String(x).length < 3) return '';
    const best = liste.map((k) => [k, avstand(String(x).toLowerCase(), k)]).sort((p, q) => p[1] - q[1])[0];
    return best && best[1] <= 2 ? T(` Mente du «${best[0]}»?`, ` Did you mean "${best[0]}"?`) : '';
  };
  const txt = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (SPRAAK === 'en' ? v.en || v.no : v.no || v.en) || '' : '');
  const erTall = (x) => typeof x === 'number' && isFinite(x);

  function lagRegex(f, hva, felt) {
    if (typeof felt !== 'string' || !felt) { f(T(`«${hva}» må være et regulært uttrykk i anførselstegn.`, `"${hva}" has to be a regular expression in quotes.`)); return null; }
    try { return new RegExp(felt, 'i'); } catch (e) { f(T(`«${hva}» er ikke et gyldig regulært uttrykk (${e.message}).`, `"${hva}" is not a valid regular expression (${e.message}).`)); return null; }
  }
  function lagVerdi(f, v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { f(T('«verdi» må være et objekt, for eksempel {"<": 19}.', '"verdi" has to be an object, for example {"<": 19}.')); return null; }
    const fns = [];
    for (const [op, x] of Object.entries(v)) {
      if (!OPERATORER.includes(op)) { f(T(`«verdi» kjenner ikke «${op}».${mente(op, OPERATORER)} Gyldige: ${OPERATORER.join(' ')}.`, `"verdi" does not know "${op}".${mente(op, OPERATORER)} Valid: ${OPERATORER.join(' ')}.`)); continue; }
      if (op === 'mellom' || op === 'utenfor') {
        if (!Array.isArray(x) || x.length !== 2 || !x.every(erTall) || x[0] > x[1]) { f(T(`«${op}» må være to tall, det laveste først, for eksempel [18, 24].`, `"${op}" has to be two numbers, the lower first, for example [18, 24].`)); continue; }
        fns.push(op === 'mellom' ? (n) => n >= x[0] && n <= x[1] : (n) => n < x[0] || n > x[1]);
      } else {
        if (!erTall(x)) { f(T(`«${op}» må ha et tall, ikke tekst.`, `"${op}" has to have a number, not text.`)); continue; }
        fns.push({'<': (n) => n < x, '>': (n) => n > x, '<=': (n) => n <= x, '>=': (n) => n >= x, '=': (n) => n === x, '!=': (n) => n !== x}[op]);
      }
    }
    return fns.length ? fns : null;
  }
  function liste(f, hva, v, tillatt) {
    const l = typeof v === 'string' ? [v] : v;
    if (!Array.isArray(l) || !l.length || !l.every((x) => typeof x === 'string')) { f(T(`«${hva}» må være en liste med tekst.`, `"${hva}" has to be a list of text.`)); return null; }
    if (tillatt) for (const x of l) if (!tillatt.includes(x)) f(T(`«${hva}»: «${x}» er ikke gyldig.${mente(x, tillatt)} Gyldige: ${tillatt.join(', ')}.`, `"${hva}": "${x}" is not valid.${mente(x, tillatt)} Valid: ${tillatt.join(', ')}.`));
    return l;
  }

  /* The file's text in, the rules out (compiled), and every mistake with the rule it belongs to. */
  function valider(tekst) {
    let d;
    try { d = JSON.parse(String(tekst).replace(/^﻿/, '')); }
    catch (e) { return {regler: [], feil: [T(`Fila er ikke gyldig JSON: ${e.message}`, `The file is not valid JSON: ${e.message}`)], antall: 0}; }
    const rå = Array.isArray(d) ? d : d && Array.isArray(d.regler) ? d.regler : null;
    if (!rå) return {regler: [], feil: [T('Fila må ha en liste som heter «regler».', 'The file needs a list called "regler".')], antall: 0};
    const feil = [], ut = [], ider = new Set(), alleIder = [];
    rå.forEach((r, i) => {
      if (r && typeof r === 'object' && typeof r.id === 'string') alleIder.push(r.id);
      const hvilken = `${T('Regel', 'Rule')} ${i + 1}${r && typeof r === 'object' && r.id ? ` («${r.id}»)` : ''}`;
      const f = (m) => feil.push(`${hvilken}: ${m}`);
      if (!r || typeof r !== 'object' || Array.isArray(r)) { f(T('må være et objekt med { }.', 'has to be an object with { }.')); return; }
      const n0 = feil.length;
      for (const k of Object.keys(r)) if (!REGEL_FELT.includes(k) && !k.startsWith('_')) f(T(`ukjent felt «${k}».${mente(k, REGEL_FELT)}`, `unknown field "${k}".${mente(k, REGEL_FELT)}`));
      if (r.id !== undefined && (typeof r.id !== 'string' || !r.id)) f(T('«id» må være tekst.', '"id" has to be text.'));
      else if (r.id && ider.has(r.id)) f(T(`«id» ${r.id} er brukt før.`, `"id" ${r.id} is used before.`));
      if (r.id) ider.add(r.id);
      if (r.aktiv !== undefined && typeof r.aktiv !== 'boolean') f(T('«aktiv» må være true eller false.', '"aktiv" has to be true or false.'));
      if (!txt(r.tittel)) f(T('mangler «tittel».', 'is missing "tittel".'));
      if (r.hvorfor !== undefined && typeof txt(r.hvorfor) !== 'string') f(T('«hvorfor» må være tekst.', '"hvorfor" has to be text.'));
      let sjekk = [];
      if (r.sjekk !== undefined) {
        const l = typeof r.sjekk === 'string' || (r.sjekk && !Array.isArray(r.sjekk) && typeof r.sjekk === 'object') ? [r.sjekk] : r.sjekk;
        if (!Array.isArray(l) || !l.every((x) => typeof txt(x) === 'string' && txt(x))) f(T('«sjekk» må være en liste med tekst.', '"sjekk" has to be a list of text.')); else sjekk = l.map(txt);
      }
      if (r.prio !== undefined && ![1, 2, 3].includes(r.prio)) f(T('«prio» må være 1, 2 eller 3.', '"prio" has to be 1, 2 or 3.'));
      if (r.minst !== undefined && !(Number.isInteger(r.minst) && r.minst >= 1)) f(T('«minst» må være et heltall fra 1.', '"minst" has to be a whole number from 1.'));
      let perEnhet = 0;
      if (r.per_enhet !== undefined) {
        if (!r.per_enhet || typeof r.per_enhet !== 'object' || !Number.isInteger(r.per_enhet.minst) || r.per_enhet.minst < 1) f(T('«per_enhet» må være {"minst": 5}.', '"per_enhet" has to be {"minst": 5}.')); else perEnhet = r.per_enhet.minst;
      }
      const c = {};
      if (!r.naar || typeof r.naar !== 'object' || Array.isArray(r.naar) || !Object.keys(r.naar).filter((k) => !k.startsWith('_')).length) f(T('mangler «naar» med minst ett krav.', 'is missing "naar" with at least one condition.'));
      else {
        for (const [k, v] of Object.entries(r.naar)) {
          if (k.startsWith('_')) continue;
          const g = (m) => f(`«naar»: ${m}`);
          if (!NAAR_FELT.includes(k)) { g(T(`ukjent krav «${k}».${mente(k, NAAR_FELT)}`, `unknown condition "${k}".${mente(k, NAAR_FELT)}`)); continue; }
          if (k === 'navn' || k === 'beskrivelse' || k === 'enhetsnavn' || k === 'leverandor') c[k] = lagRegex(g, k, v);
          else if (k === 'type') c.type = liste(g, 'type', v);
          else if (k === 'enhet') { if (typeof v !== 'string' || !v) g(T('«enhet» må være tekst, for eksempel "degrees-celsius".', '"enhet" has to be text, for example "degrees-celsius".')); else c.enhet = v.toLowerCase(); }
          else if (k === 'verdi') c.verdi = lagVerdi(g, v);
          else if (k === 'tilstand') { if (v !== 'active' && v !== 'inactive') g(T('«tilstand» må være "active" eller "inactive".', '"tilstand" has to be "active" or "inactive".')); else c.tilstand = v; }
          else if (k === 'status' || k === 'ikke_status') c[k] = liste(g, k, v, FLAGG);
          else if (k === 'protokoll') c.protokoll = liste(g, 'protokoll', v, PROTOKOLL);
        }
        if (Object.values(c).some((x) => x === null)) { /* the mistake is already in the list */ }
      }
      if (feil.length > n0 || r.aktiv === false) return;      // a rule with a mistake is left out, and one that is off is not asked
      ut.push({id: r.id || `regel${i + 1}`, tittel: r.tittel, hvorfor: r.hvorfor, sjekk, prio: r.prio || 2, minst: r.minst || 1, perEnhet, c});
    });
    return {regler: ut, feil, antall: rå.length, ider: alleIder};
  }

  /* The rules judged against what has been read. `lev(d)` is the vendor of a device. */
  function passer(c, d, p, lev) {
    if (c.type && !c.type.includes(p.type)) return false;
    if (c.navn && !c.navn.test(String(p.name || ''))) return false;
    if (c.beskrivelse && !c.beskrivelse.test(String(p.description || ''))) return false;
    if (c.enhet && c.enhet !== String(p.units || '').toLowerCase() && c.enhet !== String(p.unit_symbol || '').toLowerCase()) return false;
    if (c.tilstand && p.value !== c.tilstand) return false;
    if (c.verdi && (typeof p.value !== 'number' || !isFinite(p.value) || !c.verdi.every((fn) => fn(p.value)))) return false;
    const flagg = p.status || [];
    if (c.status && !c.status.some((x) => flagg.includes(x))) return false;
    if (c.ikke_status && c.ikke_status.some((x) => flagg.includes(x))) return false;
    return true;
  }
  function evaluer(regler, devices, cache, lev = () => '') {
    const ut = [];
    for (const r of regler) {
      const c = r.c, rader = [];
      let n = 0;
      for (const d of devices || []) {
        const prot = d.protocol === 'modbus' || d.protocol === 'knx' ? d.protocol : 'bacnet';
        if (c.protokoll && !c.protokoll.includes(prot)) continue;
        if (c.enhetsnavn && !c.enhetsnavn.test(String(d.object_name || ''))) continue;
        if (c.leverandor && !c.leverandor.test(String(lev(d) || ''))) continue;
        const treff = (cache[d.address] || []).filter((p) => passer(c, d, p, lev));
        if (!treff.length || (r.perEnhet && treff.length < r.perEnhet)) continue;
        n += treff.length;
        const p = treff[0];
        rader.push({ip: d.address, navn: d.object_name || d.address, tekst: `${treff.length} ${treff.length === 1 ? T('treff', 'match') : T('treff', 'matches')} · ${p.name || p.objid}${typeof p.value === 'number' ? ' = ' + p.value : p.value ? ' = ' + p.value : ''}`, objid: p.objid, antall: treff.length});
      }
      if (n < r.minst) continue;
      const fyll = (s) => String(s).replace(/\{n\}/g, n).replace(/\{enheter\}/g, rader.length);
      ut.push({id: 'egen:' + r.id, prio: r.prio, tittel: fyll(txt(r.tittel)), hvorfor: fyll(txt(r.hvorfor) || ''), sjekk: r.sjekk.map(fyll), rader, egen: true});
    }
    return ut;
  }

  /* ----------------------------------------------------------- the file */
  let SISTE = {regler: [], feil: [], antall: 0, fil: '', finnes: false, lest: 0};
  async function last() {
    let d;
    try { d = await (await fetch('/api/regler', {cache: 'no-store'})).json(); } catch { return SISTE; }
    if (!d || d.status !== 'done') return SISTE;
    const bruker = d.finnes ? valider(d.tekst) : {regler: [], feil: [], antall: 0, ider: []};
    // The rules that come with NABE are on from the start. A rule in the own file with the same id replaces one
    // (or switches it off with "aktiv": false), so nothing has to be copied out to be changed.
    let std = {regler: []};
    try { if (d.standard) std = valider(d.standard); } catch { /* the built-in ones are never worth a broken page */ }
    const eget = new Set(bruker.ider || []);
    const standard = std.regler.filter((r) => !eget.has(r.id));
    SISTE = {...bruker, egne: bruker.regler.length, standard: standard.length, regler: standard.concat(bruker.regler), fil: d.fil, finnes: !!d.finnes, lest: Date.now()};
    return SISTE;
  }
  async function aapne() {
    const r = await api('/api/regler/aapne', {});
    if (r.status !== 'done') { toast(r.error || T('Fikk ikke åpnet fila', 'Could not open the file'), true); return null; }
    if (r.laget) toast(T('Laget en mal med eksempler, alle avslått. Slå på det du vil ha.', 'Made a template with examples, all switched off. Switch on the ones you want.'));
    return r;
  }

  window.nabeRegler = {valider, evaluer, last, aapne, siste: () => SISTE, mente};
})();
