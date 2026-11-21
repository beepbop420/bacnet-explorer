/* NABE - alarms that go nowhere.

   An alarm is raised by a point or an event enrollment, sent through a notification class, and delivered to the
   recipients in that class. Any break in that chain and the alarm is raised and heard by no one: the class has nobody
   in it, the class the point names does not exist, or the recipients listen for no transitions. It is the dullest and
   most expensive fault at handover, because nothing looks wrong until the day it matters.

   Each BACnet device is asked once per visit (see /api/device/alarmvei), a few at a time and after the scan, so the
   plant is not asked for more while it is still being read. Everything is read, nothing is written.

   analyserEnhet() and poster() are plain functions of what was read, so they can be tested without a plant. */
'use strict';

(function alarmvei() {
  const CACHE = new Map();
  let kjorer = null, ferdig = 0, totalt = 0, feilet = 0, lyttere = [];
  const erBacnet = (d) => d && d.device_instance != null && !/^(mb|mr|ms|kx):/.test(String(d.address || ''));
  const nokkelFor = (ip) => (typeof asNokkel === 'function' ? asNokkel() : '') + '|' + ip;
  const klasseNr = (k) => (typeof k.nummer === 'number' ? k.nummer : Number(String(k.objid || '').split(',')[1]));
  /* A recipient that listens for no transition is a recipient in name only */
  const lytter = (m) => !Array.isArray(m.overganger) || m.overganger.length > 0;

  /* What one device's alarm chain looks like. r is the answer from the server. */
  function analyserEnhet(r, instanser) {
    const klasser = r.klasser || [];
    const kl = new Map(klasser.map((k) => [klasseNr(k), k]));
    const kilder = Object.entries(r.kilder || {}).map(([objid, v]) => ({objid, navn: v.navn || objid, nummer: Number(v.nummer), paa: v.paa, innm: false}));
    for (const i of r.innmeldinger || []) if (i.nummer != null) kilder.push({objid: i.objid, navn: i.navn || i.objid, nummer: Number(i.nummer), paa: null, innm: true});
    const tom = new Map(), mangler = new Map(), av = [], ukjent = [];
    const bruker = new Map();
    for (const s of kilder) {
      (bruker.get(s.nummer) || bruker.set(s.nummer, []).get(s.nummer)).push(s);
      // A point with every transition switched off raises nothing, so it is not an alarm that goes nowhere: it is one that is off
      if (!s.innm && Array.isArray(s.paa) && !s.paa.length) { av.push(s); continue; }
      const k = kl.get(s.nummer);
      if (!k) { (mangler.get(s.nummer) || mangler.set(s.nummer, []).get(s.nummer)).push(s); continue; }
      if (!Array.isArray(k.mottakere)) continue;                         // not read: not the same as empty
      const levende = k.mottakere.filter(lytter);
      if (!levende.length) {
        const t = tom.get(s.nummer) || tom.set(s.nummer, {klasse: k, kilder: [], arsak: k.mottakere.length ? 'overganger' : 'tom'}).get(s.nummer);
        t.kilder.push(s);
      }
    }
    // A recipient that is a device NABE has not seen: usual when the supervisor is on another network, so only a note
    for (const [nr, lst] of bruker) {
      const k = kl.get(nr);
      for (const m of (k && Array.isArray(k.mottakere) ? k.mottakere : [])) {
        const id = m.enhet ? Number(String(m.enhet).split(',')[1]) : null;
        if (id != null && instanser && !instanser.has(id) && lst.length) ukjent.push({klasse: nr, enhet: id});
      }
    }
    const ingen = !klasser.length && !kilder.length && (r.antall_objekter || 0) >= 10 && r.punkter_lest !== false;
    return {tom, mangler, av, ukjent, ingen, kilder: kilder.length, klasser: klasser.length};
  }

  /* The suggestions, for the list. skjul(id, ip, objid) says what the technician has set aside. */
  function poster(devices, skjul) {
    const sk = skjul || (() => false);
    const instanser = new Set((devices || []).map((d) => d.device_instance).filter((x) => x != null));
    const tom = [], mangler = [], av = [], ukjent = [], ingen = [];
    let nTom = 0, nMangler = 0, nAv = 0;
    for (const d of devices || []) {
      const c = CACHE.get(nokkelFor(d.address));
      if (!c || c.feil || c.status !== 'done') continue;
      const a = analyserEnhet(c, instanser), navn = d.object_name || d.address;
      const rad = (tekst, objid) => ({ip: d.address, navn, tekst, objid: objid || '', pts: []});
      const eks = (l) => l.slice(0, 2).map((s) => s.navn).join(', ');
      if (!sk('alarmvei-tom', d.address, '')) {
        for (const [nr, t] of a.tom) {
          nTom += t.kilder.length;
          tom.push(rad(t.arsak === 'tom'
            ? T(`klasse ${nr} har ingen mottakere, ${t.kilder.length} melder dit, for eksempel ${eks(t.kilder)}`, `class ${nr} has no recipients, ${t.kilder.length} report to it, for example ${eks(t.kilder)}`)
            : T(`klasse ${nr}: mottakerne lytter ikke på noen overganger, ${t.kilder.length} melder dit, for eksempel ${eks(t.kilder)}`, `class ${nr}: the recipients listen for no transitions, ${t.kilder.length} report to it, for example ${eks(t.kilder)}`), t.kilder[0].objid));
        }
      }
      if (!sk('alarmvei-mangler', d.address, '')) {
        for (const [nr, l] of a.mangler) {
          nMangler += l.length;
          mangler.push(rad(T(`klasse ${nr} finnes ikke, ${l.length} melder dit, for eksempel ${eks(l)}`, `class ${nr} does not exist, ${l.length} report to it, for example ${eks(l)}`), l[0].objid));
        }
      }
      if (a.av.length && !sk('alarmvei-av', d.address, '')) { nAv += a.av.length; av.push(rad(T(`${a.av.length} har klasse, men alarm er slått av, for eksempel ${eks(a.av)}`, `${a.av.length} have a class but alarms are switched off, for example ${eks(a.av)}`), a.av[0].objid)); }
      if (a.ukjent.length && !sk('alarmvei-ukjent', d.address, '')) {
        const u = [...new Set(a.ukjent.map((x) => x.enhet))];
        ukjent.push(rad(T(`alarmer går til enhet ${u.slice(0, 3).join(', ')}${u.length > 3 ? ' …' : ''}`, `alarms go to device ${u.slice(0, 3).join(', ')}${u.length > 3 ? ' …' : ''}`)));
      }
      if (a.ingen && !sk('alarmvei-ingen', d.address, '')) ingen.push(rad(T('ingen varselklasser og ingen punkter med alarmoppsett', 'no notification classes and no points set up for alarms')));
    }
    const ut = [];
    const legg = (p) => { if (p.rader.length) ut.push(p); };
    legg({id: 'alarmvei-tom', prio: 1,
      tittel: T(`${nTom} ${nTom === 1 ? 'alarmkilde melder' : 'alarmkilder melder'} til en klasse som ikke har noen å si fra til`, `${nTom} alarm ${nTom === 1 ? 'source reports' : 'sources report'} to a class with nobody to tell`),
      hvorfor: T('Alarmen blir reist i enheten, men sendes til ingen. Ingen ser den på driftssentralen eller i en e-post, og det merkes først den dagen det trengs.', 'The alarm is raised in the device but sent to no one. Nobody sees it at the supervisor or in an email, and it is noticed only on the day it matters.'),
      sjekk: [T('Henter driftssentralen alarmene ved å spørre enheten i stedet for å bli varslet, er en tom liste normal. Spør hvordan den er satt opp.', 'If the supervisor fetches the alarms by asking the device instead of being notified, an empty list is normal. Ask how it is set up.'),
              T('Ellers: åpne varselklassen og legg inn mottaker, driftssentralen som enhet eller dens adresse.', 'Otherwise: open the notification class and add a recipient, the supervisor as a device or its address.'),
              T('Sjekk at mottakeren lytter på alle tre overganger (til alarm, til feil, tilbake til normal).', 'Check that the recipient listens for all three transitions (to alarm, to fault, back to normal).')],
      rader: tom});
    legg({id: 'alarmvei-mangler', prio: 1,
      tittel: T(`${nMangler} ${nMangler === 1 ? 'alarmkilde peker' : 'alarmkilder peker'} på en varselklasse som ikke finnes`, `${nMangler} alarm ${nMangler === 1 ? 'source points' : 'sources point'} at a notification class that does not exist`),
      hvorfor: T('Klassen punktet melder gjennom er ikke laget i enheten. Alarmen har ingen vei ut.', 'The class the point reports through has not been made in the device. The alarm has no way out.'),
      sjekk: [T('Lag klassen i enheten, eller flytt punktene til en klasse som finnes. Ofte er det en rest fra en kopiert applikasjon.', 'Make the class in the device, or move the points to one that exists. Often it is left over from a copied application.')],
      rader: mangler});
    legg({id: 'alarmvei-av', prio: 3,
      tittel: T(`${nAv} ${nAv === 1 ? 'punkt har' : 'punkter har'} varselklasse, men alarmen er slått av`, `${nAv} ${nAv === 1 ? 'point has' : 'points have'} a notification class but alarms are switched off`),
      hvorfor: T('Ingen overganger er slått på i event-enable. Er det med vilje, er det greit. Ellers kommer aldri alarmen.', 'No transitions are enabled in event-enable. If it is on purpose, that is fine. Otherwise the alarm never comes.'),
      sjekk: [T('Stemmer det med alarmlista i prosjektet? Slå på til alarm, til feil og til normal der alarm er ment å virke.', 'Does it match the alarm list in the project? Enable to-alarm, to-fault and to-normal where an alarm is meant to work.')],
      rader: av});
    legg({id: 'alarmvei-ukjent', prio: 3,
      tittel: T(`${ukjent.length} ${ukjent.length === 1 ? 'enhet sender' : 'enheter sender'} alarmer til en enhet NABE ikke har sett`, `${ukjent.length} ${ukjent.length === 1 ? 'device sends' : 'devices send'} alarms to a device NABE has not seen`),
      hvorfor: T('Er driftssentralen på et annet nett, er det vanlig. Er den byttet eller fjernet, går alarmene til en enhet som ikke finnes.', 'If the supervisor is on another network, that is usual. If it was replaced or removed, the alarms go to a device that does not exist.'),
      sjekk: [T('Sjekk at enhets-ID-en er riktig og at driftssentralen er på nett. Skann nettet den står på om du kan.', 'Check that the device ID is right and the supervisor is online. Scan the network it is on if you can.')],
      rader: ukjent});
    legg({id: 'alarmvei-ingen', prio: 3,
      tittel: T(`${ingen.length} ${ingen.length === 1 ? 'enhet har' : 'enheter har'} ingen alarmoppsett i det hele tatt`, `${ingen.length} ${ingen.length === 1 ? 'device has' : 'devices have'} no alarm setup at all`),
      hvorfor: T('Ingen varselklasser og ingen punkter som melder alarm. Er alarmene laget i driftssentralen i stedet, er det greit.', 'No notification classes and no points reporting alarms. If the alarms are made in the supervisor instead, that is fine.'),
      sjekk: [T('Spør hvor alarmene for denne enheten er laget, og at de er lagt inn et sted.', 'Ask where the alarms for this device are made, and that they are set up somewhere.')],
      rader: ingen});
    return ut;
  }

  const nokkelNaa = () => (typeof asNokkel === 'function' ? asNokkel() : '');
  /* Asks the BACnet devices that have been read, two at a time. Done again only for the ones not asked this visit. */
  function kontroller() {
    if (kjorer) return kjorer;
    const kandidater = (S.devices || []).filter((d) => erBacnet(d) && !CACHE.has(nokkelFor(d.address)));
    if (!kandidater.length) return Promise.resolve();
    totalt = (S.devices || []).filter(erBacnet).length;
    ferdig = totalt - kandidater.length; feilet = 0;
    const kopi = [...kandidater];
    const en = async () => {
      while (kopi.length) {
        const d = kopi.shift(), nok = nokkelFor(d.address);
        let svar;
        try { svar = await Promise.race([api('/api/device/alarmvei', {address: d.address, device_instance: d.device_instance}), new Promise((ok) => setTimeout(() => ok({status: 'error', error: 'timeout'}), 120000))]); } catch (e) { svar = {status: 'error', error: String(e)}; }
        if (svar && svar.status === 'done') CACHE.set(nok, svar); else { CACHE.set(nok, {feil: true}); feilet++; }
        ferdig++;
        for (const f of lyttere) try { f(); } catch { /* a listener may not break the check */ }
      }
    };
    kjorer = Promise.all([en(), en()]).then(() => { kjorer = null; for (const f of lyttere) try { f(); } catch { /* as above */ } if (window.nabeStatus) window.nabeStatus.send(); });
    return kjorer;
  }
  const fremdrift = () => ({kjorer: !!kjorer, ferdig, totalt, feilet});
  /* One line under the list: how far the check has come */
  function grunnlag() {
    if (!totalt) return '';
    if (kjorer) return T(` Alarmveier sjekkes: ${ferdig} av ${totalt} enheter.`, ` Alarm routes being checked: ${ferdig} of ${totalt} devices.`);
    return T(` Alarmveier sjekket på ${totalt - feilet} av ${totalt} enheter.`, ` Alarm routes checked on ${totalt - feilet} of ${totalt} devices.`);
  }
  /* In the bottom bar, where it is seen without opening anything: how far the check is, then what it found. The words
     carry it, the colour only underlines it. */
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'sbAlarm';
  chip.className = 'sb-item sb-grense sb-alarm';
  chip.hidden = true;
  chip.onclick = () => { if (typeof window.aapneForslag === 'function') window.aapneForslag(); };
  const sbSnap = document.getElementById('sbCov') || document.getElementById('sbSnap');
  if (sbSnap) sbSnap.after(chip);
  function tegnChip() {
    if (!totalt && !CACHE.size) { chip.hidden = true; return; }
    const ps = poster(S.devices, null);
    const n = (id) => { const p = ps.find((x) => x.id === id); return p ? Number((p.tittel.match(/^\d+/) || [0])[0]) : 0; };
    const dod = n('alarmvei-tom') + n('alarmvei-mangler');
    chip.hidden = false;
    chip.classList.toggle('dod', dod > 0);
    if (kjorer) { chip.textContent = T(`Alarmveier ${ferdig}/${totalt}`, `Alarm routes ${ferdig}/${totalt}`); chip.title = T('NABE leser hvor alarmene går, en enhet av gangen', 'NABE is reading where the alarms go, one device at a time'); return; }
    chip.textContent = dod ? T(`Alarmveier · ${dod} uten vei`, `Alarm routes · ${dod} with no way out`) : T('Alarmveier ok', 'Alarm routes ok');
    chip.title = dod ? T('Alarmer som blir reist, men ikke sendt til noen. Åpner forslagene.', 'Alarms that are raised but sent to no one. Opens the suggestions.')
      : T('Alle alarmkilder melder til en klasse med mottaker', 'Every alarm source reports to a class with a recipient');
  }
  lyttere.push(tegnChip);
  /* Said once per plant, by NABO: this is the kind of thing nobody looks for */
  function si() {
    const ps = poster(S.devices, null);
    const nn = ps.filter((p) => p.id === 'alarmvei-tom' || p.id === 'alarmvei-mangler').reduce((s, p) => s + Number((p.tittel.match(/^\d+/) || [0])[0]), 0);
    if (nn && typeof nabeSier === 'function') nabeSier(T(`${nn} ${nn === 1 ? 'alarm går' : 'alarmer går'} ikke til noen. Se «Forslag til service».`, `${nn} ${nn === 1 ? 'alarm goes' : 'alarms go'} to no one. See “Service suggestions”.`), 'nervos', 'alarmvei:' + nokkelNaa(), true);
  }
  lyttere.push(() => { if (!kjorer && totalt && ferdig >= totalt) si(); });

  window.nabeAlarmvei = {analyserEnhet, poster, kontroller, fremdrift, grunnlag, pa: (f) => { lyttere.push(f); },
    tilbakestill: () => { CACHE.clear(); kjorer = null; ferdig = totalt = feilet = 0; tegnChip(); }, settInn: (ip, svar) => { CACHE.set(nokkelFor(ip), svar); tegnChip(); }};
  if (typeof etter === 'function') etter('anSammenlign', () => { setTimeout(() => { kontroller(); }, 4000); });
})();
