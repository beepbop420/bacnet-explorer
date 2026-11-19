/* NABE - suggestions for service and troubleshooting.

   Everything the tool already knows about a plant, read through once and turned into a short list of what to look at first and
   what to check there. Nothing new is read from the plant: it works on the devices and points that are already in memory, so
   the list is only as complete as what has been read (it says how much that is). It suggests, it never changes anything.

   bygForslag() is a plain function of its input so it can be tested without a plant. */
'use strict';

(function forslag() {
  const MAKS_RADER = 6;
  const navnPaa = (d) => (d && (d.object_name || String(d.device_instance ?? ''))) || '';

  /* data: {devices, cache, failed, varsler, avvik}
     varsler is what siteWarnings() gives, avvik what settpunktAvvik() gives. */
  function bygForslag(data) {
    const devices = data.devices || [], cache = data.cache || {}, failed = data.failed || new Set();
    const ut = [];
    const dev = (ip) => devices.find((d) => d.address === ip);
    const rad = (ip, tekst, objid) => ({ip, navn: navnPaa(dev(ip)) || ip, tekst: tekst || '', objid: objid || ''});
    const legg = (p) => { if (p.rader.length || p.alltid) ut.push(p); };

    // What the plant itself already warns about: same device ID twice, silent devices, wrong clocks
    for (const v of data.varsler || []) {
      if (v.nokkel === 'dup') {
        legg({id: 'dup', prio: 1, tittel: v.tittel,
          hvorfor: T('To enheter med samme ID gjør at lesing og skriving kan treffe feil sentral.', 'Two devices with the same ID mean a read or a write can reach the wrong controller.'),
          sjekk: [T('Finn hvilken av dem som er ny eller kopiert, og gi den et eget enhets-ID.', 'Find which of them is new or copied, and give it its own device ID.'),
                  T('Sjekk om nettet er koblet sammen to steder (to rutere eller en gammel kabel).', 'Check whether the network is joined in two places (two routers or an old cable).')],
          rader: v.rader.map((r) => rad(r.ip, r.id + ' · ' + r.adresse))});
      } else if (v.nokkel === 'mangler') {
        legg({id: 'mangler', prio: 2, tittel: v.tittel,
          hvorfor: T('Disse har svart her før. Det er sjelden én og én; som regel er det felles årsak.', 'These have answered here before. It is rarely one at a time; there is usually a shared cause.'),
          sjekk: [T('Kjør «Sweep, grundig» først. Over VPN mister en rask sweep ofte noen.', 'Run “Sweep, thorough” first. Over a VPN a quick sweep often misses a few.'),
                  T('Svarer de fortsatt ikke: se etter strøm, bryter eller kabel som de har felles.', 'If they still do not answer: look for the power, switch or cable they share.')],
          rader: v.rader.map((r) => rad(r.ip, (r.tekst || '') + (r.id && r.id !== '?' ? ' · ' + r.id : '')))});
      } else if (v.nokkel === 'klokke') {
        legg({id: 'klokke', prio: 3, tittel: v.tittel,
          hvorfor: T('Ukeprogram går etter enhetens egen klokke, og trendlogger stemples med den.', 'Weekly schedules run on the device’s own clock, and trend logs are stamped with it.'),
          sjekk: [T('Flere enheter feil på én gang tyder på manglende tidssynk, én enkelt på batteri eller på at klokka aldri er stilt.', 'Several devices off at once points to missing time sync; a single one to its battery or a clock that was never set.'),
                  T('Gjelder det nøyaktig én time: tidssone eller sommertid er feil i enheten.', 'If it is exactly one hour: the time zone or daylight saving is wrong in the device.')],
          rader: v.rader.map((r) => rad(r.ip, r.tekst))});
      }
    }

    // Per device: faulty, overridden, out of service and alarms
    const per = [];
    for (const d of devices) {
      const pts = cache[d.address];
      if (!pts || !pts.length) continue;
      const t = {d, n: pts.length, feil: [], over: [], ute: [], alarm: []};
      for (const p of pts) {
        const s = p.status || [];
        if (s.includes('fault')) t.feil.push(p);
        if (s.includes('overridden')) t.over.push(p);
        if (s.includes('out-of-service')) t.ute.push(p);
        if (s.includes('in-alarm')) t.alarm.push(p);
      }
      per.push(t);
    }
    const sorter = (felt) => per.filter((t) => t[felt].length).sort((a, b) => b[felt].length - a[felt].length);
    const eks = (t, felt) => t[felt].slice(0, 2).map((p) => p.name || p.objid).join(', ');

    // Most of a device faulty is the device (or a module on it), not its sensors
    const hel = sorter('feil').filter((t) => t.feil.length >= 4 && t.feil.length / t.n >= 0.6);
    legg({id: 'feil-enhet', prio: 1,
      tittel: T(`${hel.length} ${hel.length === 1 ? 'enhet' : 'enheter'} har mest av punktene med feil`, `${hel.length} ${hel.length === 1 ? 'device has' : 'devices have'} most of the points faulty`),
      hvorfor: T('Når nesten alle punkter feiler samtidig, er det sjelden følerne. Det er buss, IO-modul eller forsyning.', 'When nearly all points fail together it is seldom the sensors. It is the bus, an IO module or the supply.'),
      sjekk: [T('Se etter en lampe som er slukket eller rød på modulen, og mål forsyningen til den.', 'Look for a lamp that is off or red on the module, and measure its supply.'),
              T('Har flere enheter samme leverandør i listen: sjekk det de har felles før du går til hver enkelt.', 'If several devices share a vendor in the list: check what they have in common before going to each one.')],
      rader: hel.map((t) => rad(t.d.address, T(`${t.feil.length} av ${t.n} med feil`, `${t.feil.length} of ${t.n} faulty`)))});

    const enkelt = sorter('feil').filter((t) => !hel.includes(t));
    const nFeil = enkelt.reduce((n, t) => n + t.feil.length, 0);
    legg({id: 'feil-punkt', prio: 2,
      tittel: T(`${nFeil} ${nFeil === 1 ? "punkt" : "punkter"} med feil`, `${nFeil} faulty ${nFeil === 1 ? 'point' : 'points'}`),
      hvorfor: T('Enkeltpunkter med feil er som regel følere: ledningsbrudd, kortslutning eller verdi utenfor området.', 'Single faulty points are usually sensors: a broken wire, a short or a value out of range.'),
      sjekk: [T('Mål ved inngangen på regulatoren før du bytter føler. Åpen krets og kortslutning gir ulikt utslag.', 'Measure at the controller input before replacing the sensor. An open circuit and a short give different readings.')],
      rader: enkelt.map((t) => rad(t.d.address, T(`${t.feil.length} med feil, for eksempel ${eks(t, 'feil')}`, `${t.feil.length} faulty, for example ${eks(t, 'feil')}`), t.feil[0].objid))});

    const al = sorter('alarm');
    const nAl = al.reduce((n, t) => n + t.alarm.length, 0);
    legg({id: 'alarm', prio: 2,
      tittel: T(`${nAl} ${nAl === 1 ? "punkt" : "punkter"} i alarm`, `${nAl} ${nAl === 1 ? 'point' : 'points'} in alarm`),
      hvorfor: T('Start med dem som ikke hører til en feil du allerede kjenner.', 'Start with the ones that do not belong to a fault you already know.'),
      sjekk: [T('Åpne enhetens alarmliste for tidspunkt og årsak. En alarm som står igjen er ofte kvittert, men ikke rettet.', 'Open the device’s alarm list for time and cause. An alarm that stays is often acknowledged but not fixed.')],
      rader: al.map((t) => rad(t.d.address, T(`${t.alarm.length} i alarm, for eksempel ${eks(t, 'alarm')}`, `${t.alarm.length} in alarm, for example ${eks(t, 'alarm')}`), t.alarm[0].objid))});

    // A measurement far from its setpoint: the numbers say what is missing, the list says where to look
    const avvik = (data.avvik || []).filter((a) => a.rel >= 0.1).sort((a, b) => b.rel - a.rel);
    legg({id: 'avvik', prio: 2,
      tittel: T(`${avvik.length} ${avvik.length === 1 ? "måling" : "målinger"} langt fra settpunktet`, `${avvik.length} ${avvik.length === 1 ? 'measurement' : 'measurements'} far from the setpoint`),
      hvorfor: T('Måling og settpunkt skal møtes. Når de ikke gjør det, når ikke reguleringen fram.', 'Measurement and setpoint should meet. When they do not, the control is not getting through.'),
      sjekk: [T('Er pådraget på 0 eller 100 %: aktuator, ventil eller spjeld gjør ikke jobben, eller kapasiteten er for liten.', 'If the output is at 0 or 100 %: the actuator, valve or damper is not doing the job, or the capacity is too small.'),
              T('Er pådraget midt i: se etter overstyring og om føleren sitter riktig.', 'If the output is somewhere in between: look for an override and whether the sensor sits right.')],
      rader: avvik.slice(0, 30).map((a) => rad(a.ip, (a.p.name || a.p.objid) + ' · ' + Math.round(a.rel * 100) + ' %', a.p.objid))});

    // Overrides: someone put the plant in hand, and it is easy to leave it there
    const ov = sorter('over');
    const nOv = ov.reduce((n, t) => n + t.over.length, 0);
    legg({id: 'overstyrt', prio: nOv >= 10 ? 2 : 3,
      tittel: T(`${nOv} ${nOv === 1 ? "overstyrt punkt" : "overstyrte punkter"}`, `${nOv} overridden ${nOv === 1 ? 'point' : 'points'}`),
      hvorfor: T('Et overstyrt punkt følger ikke reguleringen. Det er lett å glemme etter en servicerunde.', 'An overridden point does not follow the control. It is easy to forget after a service round.'),
      sjekk: [T('Spør hvem som la inn dem, og slipp dem som ikke trengs. Prioritet 8 er den manuelle.', 'Ask who set them, and release the ones that are not needed. Priority 8 is the manual one.')],
      rader: ov.map((t) => rad(t.d.address, T(`${t.over.length} overstyrt, for eksempel ${eks(t, 'over')}`, `${t.over.length} overridden, for example ${eks(t, 'over')}`), t.over[0].objid))});

    const ue = sorter('ute');
    const nUe = ue.reduce((n, t) => n + t.ute.length, 0);
    legg({id: 'ute', prio: 3,
      tittel: T(`${nUe} ${nUe === 1 ? "punkt" : "punkter"} ute av drift`, `${nUe} ${nUe === 1 ? 'point' : 'points'} out of service`),
      hvorfor: T('Et punkt ute av drift viser ikke lenger det som måles. Er det med vilje?', 'A point out of service no longer shows what is measured. Is that on purpose?'),
      sjekk: [T('Er det en kanal som ikke er i bruk, er det greit. Ellers er det en rest fra igangkjøring.', 'If it is a channel not in use, that is fine. Otherwise it is left over from commissioning.')],
      rader: ue.map((t) => rad(t.d.address, T(`${t.ute.length} ute av drift, for eksempel ${eks(t, 'ute')}`, `${t.ute.length} out of service, for example ${eks(t, 'ute')}`), t.ute[0].objid))});

    // Devices that answer, but could not be read
    const feilet = devices.filter((d) => failed.has(d.address));
    legg({id: 'lesefeil', prio: 2,
      tittel: T(`${feilet.length} ${feilet.length === 1 ? 'enhet' : 'enheter'} lot seg ikke lese`, `${feilet.length} ${feilet.length === 1 ? 'device' : 'devices'} could not be read`),
      hvorfor: T('De svarer på Who-Is, men lesingen kom ikke gjennom. Listene under er derfor ikke komplette.', 'They answer Who-Is, but the read did not get through. The lists here are therefore not complete.'),
      sjekk: [T('Prøv igjen. Gjentar det seg: enheten er opptatt, har for mange objekter for én lesing, eller linken er dårlig.', 'Try again. If it repeats: the device is busy, has too many objects for one read, or the link is poor.')],
      rader: feilet.map((d) => rad(d.address, ''))});

    // The same name on three or more devices (every Beckhoff controller ships as Beckhoff_0)
    const navn = new Map();
    for (const d of devices) if (d.object_name) (navn.get(d.object_name) || navn.set(d.object_name, []).get(d.object_name)).push(d);
    const dubl = [...navn].filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length);
    legg({id: 'navn', prio: 3,
      tittel: T(`${dubl.length} ${dubl.length === 1 ? "navn brukes" : "navn brukes"} på flere enheter`, `${dubl.length} ${dubl.length === 1 ? 'name is' : 'names are'} used on several devices`),
      hvorfor: T('Samme navn på mange enheter gjør alarmlister og trender uleselige. Det er verst ved overlevering.', 'The same name on many devices makes alarm lists and trends unreadable. It matters most at handover.'),
      sjekk: [T('NABO kan gi dem unike navn ut fra adresse og instans.', 'NABO can give them unique names from the address and instance.')],
      rader: dubl.map(([n, l]) => rad(l[0].address, `«${n}» ×${l.length}`))});

    ut.sort((a, b) => a.prio - b.prio);
    const lest = per.length;
    return {liste: ut, lest, totalt: devices.length};
  }

  const lag = document.createElement('div');
  lag.id = 'forslagOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const PRIO = () => ({1: T('Se på først', 'Look at first'), 2: T('Verdt å se på', 'Worth a look'), 3: T('Når det passer', 'When it suits')});

  function data() {
    let varsler = [], avvik = [];
    try { varsler = siteWarnings(); } catch { /* none */ }
    try { avvik = settpunktAvvik(S.cache); } catch { /* none */ }
    return {devices: S.devices, cache: S.cache, failed: PRE.failed, varsler, avvik};
  }

  function postHtml(p) {
    const vis = p.rader.slice(0, MAKS_RADER);
    const rest = p.rader.length - vis.length;
    return `<section class="fo-post p${p.prio}">
      <div class="fo-tittel"><span class="fo-prikk" aria-hidden="true"></span>${esc(p.tittel)}</div>
      <div class="fo-hvorfor">${esc(p.hvorfor)}</div>
      <ul class="fo-sjekk">${p.sjekk.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <div class="fo-rader">${vis.map((r) => `<button type="button" class="fo-rad" data-ip="${esc(r.ip)}" data-o="${esc(r.objid)}">
        <b>${esc(r.navn)}</b>${r.tekst ? `<span>${esc(r.tekst)}</span>` : ''}</button>`).join('')}
        ${rest > 0 ? `<span class="fo-flere">${T(`og ${rest} til`, `and ${rest} more`)}</span>` : ''}</div>
    </section>`;
  }

  function tegn() {
    const r = bygForslag(data());
    let kropp;
    if (!r.totalt) kropp = `<div class="fo-tom">${T('Skann et anlegg først. Forslagene bygger på det som er lest.', 'Scan a plant first. The suggestions are built on what has been read.')}</div>`;
    else if (!r.liste.length) kropp = `<div class="fo-tom">${T('Ingenting å foreslå nå. Alt som er lest ser rolig ut.', 'Nothing to suggest now. Everything that has been read looks calm.')}</div>`;
    else {
      const grupper = PRIO();
      kropp = [1, 2, 3].map((n) => {
        const l = r.liste.filter((p) => p.prio === n);
        return l.length ? `<div class="fo-gruppe">${esc(grupper[n])}</div>${l.map(postHtml).join('')}` : '';
      }).join('');
    }
    const grunnlag = r.totalt ? `<div class="fo-grunnlag">${T(`Bygger på ${r.lest} av ${r.totalt} enheter som er lest.`, `Based on ${r.lest} of ${r.totalt} devices read.`)}</div>` : '';
    lag.innerHTML = `<div class="gs-modal fo-modal"><div class="gs-head"><span class="gd-tittel">${T('Forslag til service', 'Service suggestions')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="fo-kropp">${grunnlag}${kropp}</div></div>`;
  }

  async function gaaTil(ip, objid) {
    if (!S.activeDev || S.activeDev.address !== ip) {
      document.querySelector(`#devList .dev[data-ip="${CSS.escape(ip)}"]`)?.click();
      if (objid) for (let i = 0; i < 80 && !(S.activeDev && S.activeDev.address === ip && S.pointIndex && S.pointIndex.get(objid)); i++)
        await new Promise((r) => setTimeout(r, 150));
    }
    if (objid && typeof selectPoint === 'function') {
      selectPoint(objid);
      document.querySelector(`#pointsWrap tr[data-o="${CSS.escape(objid)}"]`)?.scrollIntoView({block: 'center'});
    }
  }

  lag.addEventListener('click', (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const b = e.target.closest('.fo-rad');
    if (b) { lag.hidden = true; gaaTil(b.dataset.ip, b.dataset.o); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); }
  }, true);

  window.aapneForslag = () => { tegn(); lag.hidden = false; };
  window.bygForslag = bygForslag;
  if ($('forslagBtn')) $('forslagBtn').onclick = () => { closeMenus(); window.aapneForslag(); };
})();
