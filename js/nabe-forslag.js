/* NABE - suggestions for service and troubleshooting.

   Everything the tool already knows about a plant, read through once and turned into a short list of what to look at first and
   what to check there. Nothing new is read from the plant: it works on the devices and points that are already in memory, so
   the list is only as complete as what has been read (it says how much that is). It suggests, it never changes anything.

   bygForslag() is a plain function of its input so it can be tested without a plant. */
'use strict';

(function forslag() {
  const MAKS_RADER = 6;
  const navnPaa = (d) => (d && (d.object_name || String(d.device_instance ?? ''))) || '';
  const vertAdr = (a) => String(a || '').replace(/^(mb|mr|ms|kx):/, '');
  const utenEnhet = (n) => String(n).replace(/ \([^)]*\)$/, '');
  const minTid = (s) => (s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1).replace('.', ',')} t`);

  /* data: {devices, cache, failed, varsler, avvik}
     varsler is what siteWarnings() gives, avvik what settpunktAvvik() gives. */
  function bygForslag(data) {
    const devices = data.devices || [], cache = data.cache || {}, failed = data.failed || new Set();
    const ut = [];
    if (window.nabeLaer) window.nabeLaer.nullstillTreff();
    const dev = (ip) => devices.find((d) => d.address === ip);
    // What the technician has said is not a problem on this plant (see nabe-laer.js): left out before anything is counted
    const L = window.nabeLaer ? window.nabeLaer.skjult : () => false;
    const P = (p) => ({o: p.objid, n: p.name || p.objid});
    const rad = (ip, tekst, objid, pts) => ({ip, navn: navnPaa(dev(ip)) || ip, tekst: tekst || '', objid: objid || '', pts: pts || []});
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
      // feil is every faulty point (a device with most of them faulty is a device problem whatever was set aside), feilV the ones still to show
      const t = {d, n: pts.length, feil: [], feilV: [], over: [], ute: [], alarm: []};
      for (const p of pts) {
        const s = p.status || [];
        if (s.includes('fault')) { t.feil.push(p); if (!L('feil-punkt', d.address, p.objid, p.name)) t.feilV.push(p); }
        if (s.includes('overridden') && !L('overstyrt', d.address, p.objid, p.name)) t.over.push(p);
        if (s.includes('out-of-service') && !L('ute', d.address, p.objid, p.name)) t.ute.push(p);
        if (s.includes('in-alarm') && !L('alarm', d.address, p.objid, p.name)) t.alarm.push(p);
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

    const enkelt = sorter('feilV').filter((t) => !hel.includes(t));
    const nFeil = enkelt.reduce((n, t) => n + t.feilV.length, 0);
    legg({id: 'feil-punkt', prio: 2,
      tittel: T(`${nFeil} ${nFeil === 1 ? "punkt" : "punkter"} med feil`, `${nFeil} faulty ${nFeil === 1 ? 'point' : 'points'}`),
      hvorfor: T('Enkeltpunkter med feil er som regel følere: ledningsbrudd, kortslutning eller verdi utenfor området.', 'Single faulty points are usually sensors: a broken wire, a short or a value out of range.'),
      sjekk: [T('Mål ved inngangen på regulatoren før du bytter føler. Åpen krets og kortslutning gir ulikt utslag.', 'Measure at the controller input before replacing the sensor. An open circuit and a short give different readings.')],
      rader: enkelt.map((t) => rad(t.d.address, T(`${t.feilV.length} med feil, for eksempel ${eks(t, 'feilV')}`, `${t.feilV.length} faulty, for example ${eks(t, 'feilV')}`), t.feilV[0].objid, t.feilV.map(P)))});

    const al = sorter('alarm');
    const nAl = al.reduce((n, t) => n + t.alarm.length, 0);
    legg({id: 'alarm', prio: 2,
      tittel: T(`${nAl} ${nAl === 1 ? "punkt" : "punkter"} i alarm`, `${nAl} ${nAl === 1 ? 'point' : 'points'} in alarm`),
      hvorfor: T('Start med dem som ikke hører til en feil du allerede kjenner.', 'Start with the ones that do not belong to a fault you already know.'),
      sjekk: [T('Åpne enhetens alarmliste for tidspunkt og årsak. En alarm som står igjen er ofte kvittert, men ikke rettet.', 'Open the device’s alarm list for time and cause. An alarm that stays is often acknowledged but not fixed.')],
      rader: al.map((t) => rad(t.d.address, T(`${t.alarm.length} i alarm, for eksempel ${eks(t, 'alarm')}`, `${t.alarm.length} in alarm, for example ${eks(t, 'alarm')}`), t.alarm[0].objid, t.alarm.map(P)))});

    // A measurement far from its setpoint: the numbers say what is missing, the list says where to look
    const avvik = (data.avvik || []).filter((a) => a.rel >= 0.1 && !L('avvik', a.ip, a.p.objid, a.p.name)).sort((a, b) => b.rel - a.rel);
    legg({id: 'avvik', prio: 2,
      tittel: T(`${avvik.length} ${avvik.length === 1 ? "måling" : "målinger"} langt fra settpunktet`, `${avvik.length} ${avvik.length === 1 ? 'measurement' : 'measurements'} far from the setpoint`),
      hvorfor: T('Måling og settpunkt skal møtes. Når de ikke gjør det, når ikke reguleringen fram.', 'Measurement and setpoint should meet. When they do not, the control is not getting through.'),
      sjekk: [T('Er pådraget på 0 eller 100 %: aktuator, ventil eller spjeld gjør ikke jobben, eller kapasiteten er for liten.', 'If the output is at 0 or 100 %: the actuator, valve or damper is not doing the job, or the capacity is too small.'),
              T('Er pådraget midt i: se etter overstyring og om føleren sitter riktig.', 'If the output is somewhere in between: look for an override and whether the sensor sits right.')],
      rader: avvik.slice(0, 30).map((a) => rad(a.ip, (a.p.name || a.p.objid) + ' · ' + Math.round(a.rel * 100) + ' %', a.p.objid, [P(a.p)]))});

    // Overrides: someone put the plant in hand, and it is easy to leave it there
    // BACnet does not say when an override was set. The visits NABE kept say the earliest they saw it, which is "at least this long"
    const alder = data.overAlder || {}, nuS = Date.now() / 1000;
    const dagerOver = (ip, p) => { const x = alder[ip + '|' + p.objid]; return x ? Math.floor((nuS - x.siden) / 86400) : null; };
    const ov = sorter('over').map((t) => ({...t, lengst: Math.max(-1, ...t.over.map((p) => dagerOver(t.d.address, p) ?? -1))}));
    ov.sort((a, b) => b.lengst - a.lengst || b.over.length - a.over.length);
    const nOv = ov.reduce((n, t) => n + t.over.length, 0);
    const nGamle = ov.reduce((n, t) => n + t.over.filter((p) => (dagerOver(t.d.address, p) ?? 0) >= 14).length, 0);
    const eldst = (t) => (t.lengst >= 2 ? T(` · lengst ${t.lengst} d`, ` · longest ${t.lengst} d`) : '');
    legg({id: 'overstyrt', prio: nOv >= 10 || nGamle ? 2 : 3,
      tittel: T(`${nOv} ${nOv === 1 ? "overstyrt punkt" : "overstyrte punkter"}${nGamle ? `, ${nGamle} i over to uker` : ''}`, `${nOv} overridden ${nOv === 1 ? 'point' : 'points'}${nGamle ? `, ${nGamle} for over two weeks` : ''}`),
      hvorfor: nGamle ? T('Et overstyrt punkt følger ikke reguleringen. Etter to uker er det sjelden med vilje: det ble glemt etter en servicerunde. Tiden er fra første besøk NABE så det overstyrt, så den er minst så lang.', 'An overridden point does not follow the control. After two weeks it is seldom on purpose: it was forgotten after a service round. The time runs from the first visit NABE saw it overridden, so it is at least that long.')
        : T('Et overstyrt punkt følger ikke reguleringen. Det er lett å glemme etter en servicerunde.', 'An overridden point does not follow the control. It is easy to forget after a service round.'),
      sjekk: [T('Spør hvem som la inn dem, og slipp dem som ikke trengs. Prioritet 8 er den manuelle.', 'Ask who set them, and release the ones that are not needed. Priority 8 is the manual one.')],
      rader: ov.map((t) => rad(t.d.address, T(`${t.over.length} overstyrt, for eksempel ${eks(t, 'over')}`, `${t.over.length} overridden, for example ${eks(t, 'over')}`) + eldst(t), t.over[0].objid, t.over.map(P)))});

    const ue = sorter('ute');
    const nUe = ue.reduce((n, t) => n + t.ute.length, 0);
    legg({id: 'ute', prio: 3,
      tittel: T(`${nUe} ${nUe === 1 ? "punkt" : "punkter"} ute av drift`, `${nUe} ${nUe === 1 ? 'point' : 'points'} out of service`),
      hvorfor: T('Et punkt ute av drift viser ikke lenger det som måles. Er det med vilje?', 'A point out of service no longer shows what is measured. Is that on purpose?'),
      sjekk: [T('Er det en kanal som ikke er i bruk, er det greit. Ellers er det en rest fra igangkjøring.', 'If it is a channel not in use, that is fine. Otherwise it is left over from commissioning.')],
      rader: ue.map((t) => rad(t.d.address, T(`${t.ute.length} ute av drift, for eksempel ${eks(t, 'ute')}`, `${t.ute.length} out of service, for example ${eks(t, 'ute')}`), t.ute[0].objid, t.ute.map(P)))});

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

    // Values that cannot be right: -50 degrees, 0 ppm CO2, humidity over 100
    const urimelig = (data.urimelig || []).filter((u) => !L('urimelig', u.ip, u.objid, u.navn));
    const perUr = new Map();
    for (const u of urimelig) (perUr.get(u.ip) || perUr.set(u.ip, []).get(u.ip)).push(u);
    legg({id: 'urimelig', prio: 2,
      tittel: T(`${urimelig.length} ${urimelig.length === 1 ? 'punkt' : 'punkter'} med verdi som ikke kan stemme`, `${urimelig.length} ${urimelig.length === 1 ? 'point' : 'points'} with a value that cannot be right`),
      hvorfor: T('-50 grader, 0 ppm CO2 eller 120 % fuktighet er sjelden en måling. Som regel er det en føler som ikke er koblet til.', '-50 degrees, 0 ppm CO2 or 120 % humidity is seldom a measurement. Usually it is a sensor that is not connected.'),
      sjekk: [T('Mål ved inngangen. Åpen krets og kortslutning gir hver sin verdi, og feilkoden sier hvilken.', 'Measure at the input. An open circuit and a short give different values, and the error value says which.'),
              T('Står flere på samme modul, sjekk forsyningen til modulen før du går til hver føler.', 'If several sit on one module, check the module’s supply before going to each sensor.')],
      rader: [...perUr].map(([ip, l]) => rad(ip, T(`${l.length} ${l.length === 1 ? 'urimelig' : 'urimelige'}, for eksempel ${l[0].navn} = ${l[0].verdi}`, `${l.length} impossible, for example ${l[0].navn} = ${l[0].verdi}`), l[0].objid, l.map((u) => ({o: u.objid, n: u.navn}))))});

    // An analog input that has not moved at all: the wire, or a value left fixed
    const flate = (data.flate || []).filter((f) => !L('flat', f.ip, f.objid, f.navn));
    legg({id: 'flat', prio: 3,
      tittel: T(`${flate.length} ${flate.length === 1 ? 'måling står' : 'målinger står'} helt stille`, `${flate.length} ${flate.length === 1 ? 'measurement stands' : 'measurements stand'} perfectly still`),
      hvorfor: T('En levende føler flytter seg litt. En som står helt stille har ofte mistet ledningen, eller er satt til en fast verdi.', 'A live sensor moves a little. One that stands perfectly still has often lost its wire, or been set to a fixed value.'),
      sjekk: [T('Se først om punktet er overstyrt eller ute av drift.', 'First see whether the point is overridden or out of service.'),
              T('Ellers: ledning og føler. Dette sees bare for enheten som er åpen mens Live går.', 'Otherwise: the wire and the sensor. This is seen only for the device that is open while Live runs.')],
      rader: flate.map((f) => rad(f.ip, T(`${f.navn} uendret i ${f.minutter} min`, `${f.navn} unchanged for ${f.minutter} min`), f.objid, [{o: f.objid, n: f.navn}]))});

    // Starting and stopping too often, counted from the points NABE follows in the background
    const syk = (data.sykluser || []).filter((x) => !L('sykluser', x.address, x.objid, x.navn));
    const sykMange = syk.filter((x) => x.dom === 'mange');
    legg({id: 'sykluser', prio: sykMange.length ? 2 : 3,
      tittel: T(`${syk.length} ${syk.length === 1 ? 'utstyr starter' : 'utstyr starter'} ofte`, `${syk.length} ${syk.length === 1 ? 'item starts' : 'items start'} often`),
      hvorfor: T('Hyppig av og på sliter motor og kontaktor lenge før noe alarmerer. Seks starter i timen er der mange produsenter setter grensen for en kompressor.', 'Frequent on and off wears out a motor and contactor long before anything alarms. Six starts an hour is where many makers draw the line for a compressor.'),
      sjekk: [T('Se på reguleringen: for smalt dødbånd, for kort minste gangtid eller en føler som svinger gir ofte dette.', 'Look at the control: too narrow a dead band, too short a minimum run time or a sensor that swings often gives this.'),
              T('Er det bare noen få minutter mellom starter, mangler det trolig en minste av-tid.', 'If there are only a few minutes between starts, a minimum off time is probably missing.')],
      rader: syk.map((x) => rad(x.address, `${String(x.navn).replace(/ \([^)]*\)$/, '')} · ${String(x.per_time).replace('.', ',')} ${T('i timen', 'an hour')}`, x.objid, [{o: x.objid, n: x.navn}]))});
    const tips = (data.tips || []).filter((x) => !L('syk-tips', x.ip, x.objid, x.navn));
    legg({id: 'syk-tips', prio: 3,
      tittel: T(`${tips.length} ${tips.length === 1 ? 'punkt' : 'punkter'} kan sjekkes for hyppige starter`, `${tips.length} ${tips.length === 1 ? 'point' : 'points'} can be checked for frequent starts`),
      hvorfor: T('NABE teller starter per time for festede punkter. Ingen av disse følges nå.', 'NABE counts starts an hour for pinned points. None of these is followed now.'),
      sjekk: [T('Fest dem med ☆, la det gå en halvtime, og se i «Se bakover».', 'Pin them with ☆, let half an hour pass, and look in “Look back”.')],
      rader: tips.map((x) => rad(x.ip, x.navn, x.objid, [{o: x.objid, n: x.navn}]))});

    // Alarms: what is new first, and what shouts all the time after it
    const ah = data.alarmhist || [];
    const ahNye = ah.filter((x) => x.ny && !x.kjent), ahOfte = ah.filter((x) => x.kronisk && !x.kjent && !L('alarm-ofte', x.ip, x.objid, x.navn));
    legg({id: 'alarm-nye', prio: 2,
      tittel: T(`${ahNye.length} ${ahNye.length === 1 ? 'ny alarm' : 'nye alarmer'} siste døgn`, `${ahNye.length} new ${ahNye.length === 1 ? 'alarm' : 'alarms'} in the last day`),
      hvorfor: T('Disse har ikke stått i alarm før, så ingen har sett dem ennå.', 'These have not been in alarm before, so nobody has seen them yet.'),
      sjekk: [T('Se hva som skjedde da alarmen kom. «Se bakover» viser de siste to timene for festede punkter.', 'See what happened when the alarm came. “Look back” shows the last two hours for pinned points.')],
      rader: ahNye.map((x) => rad(x.ip, `${x.navn}`, x.objid))});
    legg({id: 'alarm-ofte', prio: 3,
      tittel: T(`${ahOfte.length} ${ahOfte.length === 1 ? 'punkt alarmerer' : 'punkter alarmerer'} nesten hver gang`, `${ahOfte.length} ${ahOfte.length === 1 ? 'point alarms' : 'points alarm'} nearly every time`),
      hvorfor: T('Det som alltid roper skjuler det nye. Enten er det en feil som ikke blir rettet, eller en grense som er satt for stramt.', 'What always shouts hides what is new. Either it is a fault that is not fixed, or a limit set too tight.'),
      sjekk: [T('Rett feilen eller løsne grensen, så alarmlista igjen forteller noe. Marker dem som «kjent» i «Mest alarmerende» i mellomtiden.', 'Fix the fault or loosen the limit, so the alarm list says something again. Mark them “known” in “Most alarming” meanwhile.')],
      rader: ahOfte.map((x) => rad(x.ip, T(`${x.navn} · ${x.dager.length} dager`, `${x.navn} · ${x.dager.length} days`), x.objid, [{o: x.objid, n: x.navn}]))});

    // Routers and MS/TP: 32 devices is what one trunk takes without a repeater
    const rb = data.ruter || {rutere: [], utenRuter: []};
    const tunge = rb.rutere.filter((r) => r.niva !== 'ok');
    const utenTung = (rb.utenRuter || []).filter((n) => n.niva !== 'ok');
    const over = tunge.some((r) => r.niva === 'over') || utenTung.some((n) => n.niva === 'over');
    const nettRad = (r) => r.nett.filter((n) => n.niva !== 'ok').map((n) => rad(n.forste || '', T(`Ruter ${r.ruter}: nett ${n.nett} har ${n.mstp} MS/TP-enheter`, `Router ${r.ruter}: network ${n.nett} has ${n.mstp} MS/TP devices`)));
    legg({id: 'ruter', prio: over ? 2 : 3,
      tittel: T(`${tunge.length + utenTung.length} ${tunge.length + utenTung.length === 1 ? 'ruter eller nett bærer' : 'rutere og nett bærer'} mye`, `${tunge.length + utenTung.length} ${tunge.length + utenTung.length === 1 ? 'router or network carries' : 'routers and networks carry'} a lot`),
      hvorfor: T('Ett MS/TP-segment tar 32 enheter uten repeater. Over det blir svartidene lange og meldinger går tapt, og en ruter med mange nett er den første som stopper.', 'One MS/TP segment takes 32 devices without a repeater. Beyond that the answers get slow and messages are lost, and a router with many networks is the first to stall.'),
      sjekk: [T('Del nettet med en repeater eller en ekstra ruter.', 'Split the network with a repeater or an extra router.'),
              T('Sjekk at baudrate og Max_Master er satt riktig i alle enhetene på trunken.', 'Check that the baud rate and Max_Master are set right in every device on the trunk.')],
      rader: tunge.flatMap((r) => r.niva === 'tung' && !r.nett.some((n) => n.niva !== 'ok')
        ? [rad(r.nett.find((n) => n.forste) ? r.nett.find((n) => n.forste).forste : '', T(`Ruter ${r.ruter}: ${r.total} enheter bak seg`, `Router ${r.ruter}: ${r.total} devices behind it`))] : nettRad(r))
        .concat(utenTung.map((n) => rad(n.forste || '', T(`Nett ${n.nett}: ${n.mstp} MS/TP-enheter, ruteren er ikke funnet`, `Network ${n.nett}: ${n.mstp} MS/TP devices, the router was not found`))))});

    // An actuator at the end of its range with nothing following: from the pinned points, or a recording
    const vk = (data.virkning || []).filter((x) => !L('virkning', x.address || '', x.objid, x.maling));
    legg({id: 'virkning', prio: 2,
      tittel: T(`${vk.length} pådrag uten effekt`, `${vk.length} ${vk.length === 1 ? 'actuator' : 'actuators'} with no effect`),
      hvorfor: T('Pådraget står på 100 % og målingen følger ikke etter. Da gjør reguleringen alt den kan, og feilen ligger utenfor den.', 'The output stands at 100 % and the measurement does not follow. The control is doing all it can, and the fault lies outside it.'),
      sjekk: [T('Ventil: kjenn om røret blir varmt, og se at motoren faktisk beveger seg.', 'Valve: feel whether the pipe gets warm, and see that the actuator really moves.'),
              T('Sjekk pumpe og tilførsel (temperatur og trykk) før du går til føleren.', 'Check the pump and the supply (temperature and pressure) before going to the sensor.'),
              T('Sitter føleren i et rom pådraget ikke virker på?', 'Does the sensor sit in a room the output does not act on?')],
      rader: vk.map((x) => rad(x.address || '', `${utenEnhet(x.maling)} ${String(x.verdi).replace('.', ',')}${x.settpunkt != null ? ' ' + T('mot', 'against') + ' ' + String(x.settpunkt).replace('.', ',') : ''} · ${T('pådrag fullt i', 'output full for')} ${minTid(x.siden_s)}`, x.objid, [{o: x.objid, n: utenEnhet(x.maling)}]))});
    const vt = (data.virkningTips || []).filter((x) => !L('virkning-tips', x.ip, x.objid, x.navn));
    legg({id: 'virkning-tips', prio: 3,
      tittel: T(`${vt.length} romregulatorer kan sjekkes for pådrag uten effekt`, `${vt.length} room controllers can be checked for an actuator with no effect`),
      hvorfor: T('NABE ser om ventilen står fullt uten at temperaturen følger. Det trenger måling og ventil festet i overvåkingslista, og settpunktet hvis det finnes.', 'NABE sees whether the valve stands full without the temperature following. It needs the measurement and the valve pinned in the watch list, and the setpoint if there is one.'),
      sjekk: [T('Fest måling og ventil med ☆. Etter et kvarter sier NABE fra hvis det ikke virker.', 'Pin the measurement and the valve with ☆. After a quarter of an hour NABE says if it does not work.')],
      rader: vt.map((x) => rad(x.ip, x.navn, x.objid, [{o: x.objid, n: x.navn}]))});

    // A storm: what comes in and what NABE itself sends
    const sm = data.storm || {aktiv: [], ferdige: []};
    const smRader = sm.aktiv.length ? sm.aktiv : sm.ferdige;
    legg({id: 'storm', prio: sm.aktiv.length ? 1 : 3,
      tittel: sm.aktiv.length ? T(`Storm på nettet nå (${sm.aktiv.length})`, `Network storm now (${sm.aktiv.length})`) : T(`Storm på nettet siste døgn (${sm.ferdige.length})`, `Network storm in the last day (${sm.ferdige.length})`),
      hvorfor: T('Mange Who-Is, I-Am eller COV-varsler i sekundet tar kapasitet fra alt annet på nettet og gjør alle enhetene tregere.', 'Many Who-Is, I-Am or COV notifications a second take capacity from everything else on the network and slow every device down.'),
      sjekk: [T('Se hvem som sender mest, og stans den først. Ofte er det en enhet som står fast i en løkke.', 'See who sends most, and stop that one first. Often it is a device stuck in a loop.'),
              T('Trafikkloggen viser hva NABE selv sender.', 'The traffic log shows what NABE itself sends.')],
      rader: smRader.map((e) => rad(e.topp && e.topp[0] ? e.topp[0][0] : '', window.nabeStorm ? window.nabeStorm.tekst(e) : e.type))});

    // The user's own rules, and what is wrong with the file
    for (const p of data.egne || []) legg(p);
    // Alarms that go nowhere: built from what the devices said about their notification classes (nabe-alarmvei.js)
    for (const p of data.alarmvei || []) legg(p);
    const rf = data.regelfeil || [];
    legg({id: 'regelfeil', prio: 2,
      tittel: T(`${rf.length} feil i regelfila`, `${rf.length} ${rf.length === 1 ? 'mistake' : 'mistakes'} in the rules file`),
      hvorfor: T('Reglene med feil er ikke tatt med. De andre gjelder.', 'The rules with mistakes are left out. The others apply.'),
      sjekk: [T('Åpne fila, rett det som står under og trykk «Last på nytt» nederst.', 'Open the file, fix what is listed below and press “Reload” at the bottom.')],
      rader: rf.map((m) => ({ip: '', navn: '', tekst: m, objid: '', lang: true}))});

    // Running while the schedule says off
    const dt0 = data.driftstid || {liste: [], urLest: 0, urTotalt: 0};
    const dt = {...dt0, liste: dt0.liste.filter((x) => !L('driftstid', x.ip, x.objid, x.punkt))};
    legg({id: 'driftstid', prio: 2,
      tittel: T(`${dt.liste.length} ${dt.liste.length === 1 ? 'aggregat går' : 'aggregater går'} utenfor driftstid`, `${dt.liste.length} ${dt.liste.length === 1 ? 'unit runs' : 'units run'} outside the schedule`),
      hvorfor: T('Ukeprogrammet sier av, men utstyret går. Det koster energi og slitasje, og ingen alarm sier fra.', 'The schedule says off, but the equipment runs. It costs energy and wear, and no alarm says so.'),
      sjekk: [T('Er punktet overstyrt? Flagget står i tabellen.', 'Is the point overridden? The flag is in the table.'),
              T('Er programmet koblet til aggregatet i logikken, eller er det noe annet som styrer det?', 'Is the schedule tied to the unit in the logic, or is something else driving it?'),
              T('Nattkjøling, frostvern og ettergang er med vilje.', 'Night cooling, frost protection and run-on are on purpose.')],
      rader: dt.liste.map((x) => rad(x.ip, `${x.punkt} ${T('går', 'runs')} · ${x.program} ${T('sier av', 'says off')}${x.siden != null ? ' ' + minTid(x.siden * 60) : ''}${x.overstyrt ? ' · ' + T('overstyrt', 'overridden') : ''}`, x.objid, [{o: x.objid, n: x.punkt}]))});

    // Sensors that show the same on every visit, and devices that do not update at all
    const dd0 = data.dode || {punkter: [], enheter: [], analoge: 0, besok: 0};
    const dd = {...dd0, punkter: dd0.punkter.filter((x) => !L('dode', x.ip, x.objid, x.navn)), enheter: dd0.enheter.filter((e) => !L('dode-enhet', e.ip, ''))};
    const tallTekst = (x) => `${String(Number(Number(x.v).toPrecision(6))).replace('.', ',')}${x.symbol ? ' ' + x.symbol : ''}`.trim();
    const dato = (d) => new Date(d + 'T12:00:00').toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'short'});
    legg({id: 'dode', prio: 3,
      tittel: T(`${dd.punkter.length} ${dd.punkter.length === 1 ? 'føler har' : 'følere har'} aldri endret seg mellom besøkene`, `${dd.punkter.length} ${dd.punkter.length === 1 ? 'sensor has' : 'sensors have'} never changed between visits`),
      hvorfor: T('En føler som viser nøyaktig samme tall ved hvert besøk er som regel frakoblet, eller frosset på siste verdi.', 'A sensor that shows exactly the same number on every visit is usually disconnected, or frozen at its last value.'),
      sjekk: [T('Mål ved inngangen. Åpen krets og kortslutning gir hver sin verdi.', 'Measure at the input. An open circuit and a short give different values.'),
              T('Er verdien en kjent feilverdi, som -50 eller 3276,7? Da er den ikke koblet til.', 'Is the value a known error value, like -50 or 3276.7? Then it is not connected.'),
              T('Står den i et rom som ikke er i bruk? Da kan den være riktig.', 'Does it sit in a room that is not in use? Then it may be right.')],
      rader: dd.punkter.slice(0, 60).map((x) => rad(x.ip, `${x.navn} = ${tallTekst(x)} · ${x.dager} ${T('besøk siden', 'visits since')} ${dato(x.forste)}`, x.objid, [{o: x.objid, n: x.navn}]))});
    legg({id: 'dode-enhet', prio: 2,
      tittel: T(`${dd.enheter.length} ${dd.enheter.length === 1 ? 'enhet oppdaterer' : 'enheter oppdaterer'} ikke verdiene sine`, `${dd.enheter.length} ${dd.enheter.length === 1 ? 'device does' : 'devices do'} not update their values`),
      hvorfor: T('Nesten alle følerne på enheten viser det samme som ved forrige besøk. Da er det enheten og ikke følerne: logikken står, eller verdiene er frosset.', 'Nearly every sensor on the device shows what it did on the previous visit. Then it is the device and not the sensors: the logic is stopped, or the values are frozen.'),
      sjekk: [T('Er programmet i gang? Se status og siste omstart.', 'Is the program running? Look at the status and the last restart.'),
              T('Les enheten på nytt og se om verdiene beveger seg.', 'Read the device again and see whether the values move.')],
      rader: dd.enheter.map((e) => rad(e.ip, T(`${e.antall} av ${e.av} følere uendret i ${e.dager} besøk`, `${e.antall} of ${e.av} sensors unchanged over ${e.dager} visits`)))});
    legg({id: 'dode-tips', prio: 3, alltid: dd.analoge > 0 && dd.besok < 3,
      tittel: T(`Følere som aldri beveger seg: ${dd.besok} av 3 dager sett`, `Sensors that never move: ${dd.besok} of 3 days seen`),
      hvorfor: T('NABE husker hva hver føler viste ved forrige besøk. Etter tre ulike dager kan den si hvilke som aldri beveger seg.', 'NABE remembers what each sensor showed on the previous visit. After three different days it can say which ones never move.'),
      sjekk: [T('Åpne anlegget en ny dag, så teller den.', 'Open the plant on another day, and it counts.')], rader: []});

    // Equal MAC on different addresses, and devices whose ID changed between two scans
    const mac = data.sammeMac || [];
    legg({id: 'mac', prio: 3,
      tittel: T(`${mac.length} MAC-${mac.length === 1 ? 'adresse' : 'adresser'} går igjen på flere IP-adresser`, `${mac.length} MAC ${mac.length === 1 ? 'address shows' : 'addresses show'} on several IP addresses`),
      hvorfor: T('Samme MAC bak to IP-adresser er vanlig bak en ruter eller proxy, men kan også være en IP som er brukt to ganger.', 'The same MAC behind two IP addresses is usual behind a router or proxy, but can also be an IP used twice.'),
      sjekk: [T('Er det ikke en ruter eller proxy: se etter to enheter som har fått samme IP, for eksempel fra et kopiert oppsett.', 'If it is not a router or proxy: look for two devices that were given the same IP, for example from a copied setup.')],
      rader: mac.map((m) => rad(m.enheter[0].address, `${m.mac} · ${m.enheter.map((d) => vertAdr(d.address)).join(', ')}`))});
    const endret = (data.endretId || []).filter((x) => !L('endret-id', x.ip, ''));
    legg({id: 'endret-id', prio: 3,
      tittel: T(`${endret.length} ${endret.length === 1 ? 'enhet har' : 'enheter har'} skiftet enhets-ID siden forrige skann`, `${endret.length} ${endret.length === 1 ? 'device has' : 'devices have'} changed device ID since the last scan`),
      hvorfor: T('Samme adresse, nytt enhets-ID. Noen har endret det, eller en annen enhet har tatt over adressen.', 'The same address, a new device ID. Somebody changed it, or another device has taken over the address.'),
      sjekk: [T('Passer det ikke med en endring du kjenner til, sjekk hvilken enhet som står på adressen nå.', 'If it does not fit a change you know of, check which device is on the address now.')],
      rader: endret.map((x) => rad(x.ip, T(`ID ${x.fra} ble ${x.til}`, `ID ${x.fra} became ${x.til}`)))});

    ut.sort((a, b) => a.prio - b.prio);
    const lest = per.length;
    return {liste: ut, lest, totalt: devices.length, ur: {lest: dt.urLest || 0, totalt: dt.urTotalt || 0}, laert: window.nabeLaer ? window.nabeLaer.treff() : 0};
  }

  const lag = document.createElement('div');
  lag.id = 'forslagOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const PRIO = () => ({1: T('Se på først', 'Look at first'), 2: T('Verdt å se på', 'Worth a look'), 3: T('Når det passer', 'When it suits')});

  const PUMPE = /pump|kompress|compress|sirkul|vifte|\bfan\b|kjel|boiler|motor/i;
  const verdiTekst = (p) => `${fmtVal(p.value).t}${p.unit_symbol ? ' ' + p.unit_symbol : ''}`;
  /* What the server has counted for the pinned points, the rules file and the storm state: asked together, and
     none of them is allowed to hold the list back for more than a moment. */
  let DRIFT_LYTTER = false, ALARM_LYTTER = false;
  async function hentEkstra() {
    const frist = (p, ms = 2500) => Promise.race([p, new Promise((ok) => setTimeout(() => ok(null), ms))]);
    // The schedules take longest to read: the list is drawn again when they are in, if the window is still open
    if (window.nabeDrift && !DRIFT_LYTTER) { DRIFT_LYTTER = true; window.nabeDrift.pa(() => { if (!lag.hidden) tegn(); }); }
    const vakt = async () => { try { const d = await (await fetch('/api/vakt', {cache: 'no-store'})).json(); return d && d.status === 'done' ? d : null; } catch { return null; } };
    // The alarm routes are asked for in the background (the scan starts it too); the list is drawn again as the answers come in
    if (window.nabeAlarmvei) {
      if (!ALARM_LYTTER) { ALARM_LYTTER = true; window.nabeAlarmvei.pa(() => { if (!lag.hidden) tegn(); }); }
      window.nabeAlarmvei.kontroller();
    }
    // How long the overridden points have been so, from the visits NABE kept
    const alder = async () => { try { const d = await (await fetch('/api/besok/overstyrt?key=' + encodeURIComponent(asNokkel()), {cache: 'no-store'})).json(); return d && d.status === 'done' ? d : null; } catch { return null; } };
    const [v, al] = await Promise.all([frist(vakt()), frist(alder()),
      frist(window.nabeRegler ? window.nabeRegler.last() : null), frist(window.nabeStorm ? window.nabeStorm.hent() : null),
      frist(window.nabeDrift ? window.nabeDrift.kontroller() : null, 7000)]);
    return {sykluser: (v && v.sykluser) || [], virkning: (v && v.virkning) || [], overAlder: (al && al.punkter) || {}, overBesok: (al && al.besok) || 0};
  }
  function data(ekstra = {}) {
    const sykluser = ekstra.sykluser || [], virkning = ekstra.virkning || [];
    let varsler = [], avvik = [];
    try { varsler = siteWarnings(); } catch { /* none */ }
    try { avvik = settpunktAvvik(S.cache); } catch { /* none */ }
    const urimelig = [], tips = [];
    const fulgte = new Set((S.watch || []).map((w) => w.ip + '|' + w.objid));
    for (const d of S.devices || []) {
      for (const p of S.cache[d.address] || []) {
        if (typeof rarGrunn === 'function' && rarGrunn(p)) urimelig.push({ip: d.address, objid: p.objid, navn: p.name || p.objid, verdi: verdiTekst(p), grunn: rarGrunn(p)});
        else if (/^binary-(output|value)$/.test(p.type || '') && PUMPE.test(`${p.name || ''} ${p.description || ''}`) && !fulgte.has(d.address + '|' + p.objid)) tips.push({ip: d.address, objid: p.objid, navn: p.name || p.objid});
      }
    }
    // Room controllers with a valve behind them that nobody follows yet
    const virkningTips = [];
    if (!virkning.length && window.nabePendling) {
      for (const d of S.devices || []) {
        for (const p of S.cache[d.address] || []) {
          if (virkningTips.length >= 25) break;
          if (p.type !== 'analog-input' || !/(?:^|[^A-Za-z0-9])RT\d{2,4}(?!\d)/i.test(p.name || '') || fulgte.has(d.address + '|' + p.objid)) continue;
          const par = window.nabePendling.partnere([{address: d.address, objid: p.objid, navn: p.name, enhet: ''}]);
          if (par.some((q) => /(?:^|[^A-Za-z0-9])SB\d{2,4}(?!\d)/i.test(q.navn || '') && !fulgte.has(q.address + '|' + q.objid))) virkningTips.push({ip: d.address, objid: p.objid, navn: p.name || p.objid});
        }
      }
    }
    const R = window.nabeRegler ? window.nabeRegler.siste() : null;
    const driftstid = window.nabeDrift ? window.nabeDrift.siste() : null;
    const dode = window.nabePunktlogg ? window.nabePunktlogg.dode() : null;
    const egne = R && R.regler.length ? window.nabeRegler.evaluer(R.regler, S.devices, S.cache, (d) => { try { return gruppeFor(d).label; } catch { return ''; } }) : [];
    const flate = [];
    if (S.activeDev && typeof flatVerdi === 'function') {
      for (const p of S.points || []) if (flatVerdi(p)) flate.push({ip: S.activeDev.address, objid: p.objid, navn: p.name || p.objid, minutter: Math.max(1, Math.round((Date.now() - p._flatEndret) / 60000))});
    }
    const N = window.nabeNett;
    const rutere = Array.isArray(S.rutere) ? S.rutere : [];
    const alarmvei = window.nabeAlarmvei ? window.nabeAlarmvei.poster(S.devices, window.nabeLaer ? window.nabeLaer.skjult : null) : [];
    return {alarmvei, overAlder: ekstra.overAlder || {}, overBesok: ekstra.overBesok || 0, devices: S.devices, cache: S.cache, failed: PRE.failed, varsler, avvik, urimelig, flate, sykluser, virkning, virkningTips, egne, driftstid, dode,
      regelfeil: R ? R.feil : [],
      storm: window.nabeStorm ? {aktiv: window.nabeStorm.siste().aktiv || [], ferdige: window.nabeStorm.ferdige()} : {aktiv: [], ferdige: []},
      tips: sykluser.length ? [] : tips.slice(0, 30),
      alarmhist: window.nabeAlarmhist ? window.nabeAlarmhist.liste() : [],
      ruter: N ? N.ruterBelastning(rutere, S.devices) : {rutere: [], utenRuter: []},
      sammeMac: N ? N.sammeMac(S.devices) : [],
      endretId: Object.entries(S._endretId || {}).filter(([a]) => (S.devices || []).some((d) => d.address === a)).map(([ip, x]) => ({ip, ...x}))};
  }

  function postHtml(p) {
    const vis = p.rader.slice(0, MAKS_RADER);
    const rest = p.rader.length - vis.length;
    const Lr = window.nabeLaer, kanLaere = !!Lr && Lr.laerbar(p.id) && !p.egen;
    const GR = kanLaere ? Lr.grunner() : {};
    const raderHtml = vis.map((r, i) => {
      const rad = `<button type="button" class="fo-rad${r.lang ? ' lang' : ''}" data-ip="${esc(r.ip)}" data-o="${esc(r.objid)}" title="${esc(r.tekst)}">
        <b>${esc(r.navn)}</b>${r.tekst ? `<span>${esc(r.tekst)}</span>` : ''}</button>`;
      if (!kanLaere || !r.ip) return rad;
      const n = (r.pts || []).length;
      if (VELGER && VELGER.id === p.id && VELGER.i === i) {
        return `<div class="fo-vrap fo-velg">${rad}<span class="fo-grunn" role="group" aria-label="${esc(T('Hvorfor er det ikke feil?', 'Why is it not a fault?'))}">
          ${Object.entries(GR).map(([k, v]) => `<button type="button" data-fo="laer-ja" data-g="${k}" data-id="${esc(p.id)}" data-i="${i}">${esc(v)}</button>`).join('')}
          <button type="button" data-fo="laer-nei" class="fo-angre">${T('Avbryt', 'Cancel')}</button></span></div>`;
      }
      return `<div class="fo-vrap">${rad}<button type="button" class="fo-laer" data-fo="laer" data-id="${esc(p.id)}" data-i="${i}"
        title="${esc(T('Slutter å foreslå dette for dette anlegget. Du kan angre nederst i listen.', 'Stops suggesting this for this plant. You can undo it at the bottom of the list.'))}">${n > 1 ? T(`Ikke feil (${n})`, `Not a fault (${n})`) : T('Ikke feil', 'Not a fault')}</button></div>`;
    }).join('');
    const m = kanLaere ? Lr.monsterFor(p.id, p.rader) : null;
    const monsterHtml = m ? `<div class="fo-monster"><span>${T(`${m.laert} du har satt til side har «${m.ord}» i navnet. Gjelder det også de ${m.flere} andre her?`, `${m.laert} you have set aside have “${m.ord}” in the name. Does that also go for the other ${m.flere} here?`)}</span>
      <button type="button" data-fo="monster-ja" data-id="${esc(p.id)}" data-ord="${esc(m.ord)}">${T('Ja, alle med «' + m.ord + '»', 'Yes, all with “' + m.ord + '”')}</button>
      <button type="button" data-fo="monster-nei" data-id="${esc(p.id)}" data-ord="${esc(m.ord)}">${T('Nei', 'No')}</button></div>` : '';
    // The user's own rules and what is wrong with their file are written by them (or already in the right language): the language sweep leaves them alone
    return `<section class="fo-post p${p.prio}${p.egen || p.id === 'regelfeil' ? ' egen' : ''}">
      <div class="fo-tittel"><span class="fo-prio">${T('Prio', 'Prio')} ${p.prio}</span>${esc(p.tittel)}${p.kom ? `<span class="fo-ny">${p.kom === 'nye' ? T(`${p.nyeAntall} nye`, `${p.nyeAntall} new`) : T('tilbake', 'back')}</span>` : ''}</div>
      <div class="fo-hvorfor">${esc(p.hvorfor)}</div>
      <ul class="fo-sjekk">${p.sjekk.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <div class="fo-rader">${raderHtml}
        ${rest > 0 ? `<span class="fo-flere">${T(`og ${rest} til`, `and ${rest} more`)}</span>` : ''}</div>
      ${monsterHtml}
      ${window.nabeArbeid ? `<div class="fo-hand"><button type="button" data-fo="utfort" data-id="${esc(p.id)}">${T('Utført', 'Done')}</button>
        <button type="button" data-fo="utsett" data-id="${esc(p.id)}">${T('Utsett en uke', 'Put aside a week')}</button>
        <button type="button" data-fo="kopier" data-id="${esc(p.id)}">${T('Kopier som melding', 'Copy as message')}</button></div>` : ''}
    </section>`;
  }

  let SISTE = null, EKSTRA = {}, SYNLIGE = [], SKJULT_APEN = false, LAERT_APEN = false, VELGER = null;
  function tegn(ekstra) {
    EKSTRA = ekstra || EKSTRA;
    const r = SISTE = bygForslag(data(EKSTRA));
    const A = window.nabeArbeid;
    const delt = A ? A.del(r.liste) : {synlige: r.liste, skjulte: []};
    SYNLIGE = delt.synlige;
    let kropp;
    if (!r.totalt) kropp = `<div class="fo-tom">${T('Skann et anlegg først. Forslagene bygger på det som er lest.', 'Scan a plant first. The suggestions are built on what has been read.')}</div>`;
    else if (!r.liste.length) kropp = `<div class="fo-tom">${T('Ingenting å foreslå nå. Alt som er lest ser rolig ut.', 'Nothing to suggest now. Everything that has been read looks calm.')}</div>`;
    else if (!delt.synlige.length) kropp = `<div class="fo-tom">${T('Alt er satt til side eller utført. Det kommer tilbake hvis noe nytt dukker opp.', 'Everything is done or put aside. It comes back if something new turns up.')}</div>`;
    else {
      const grupper = PRIO();
      kropp = [1, 2, 3].map((n) => {
        const l = delt.synlige.filter((p) => p.prio === n);
        return l.length ? `<div class="fo-gruppe">${esc(grupper[n])}</div>${l.map(postHtml).join('')}` : '';
      }).join('');
    }
    if (delt.skjulte.length) {
      const dato = (ms) => new Date(ms).toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'short'});
      kropp += `<div class="fo-skjult"><button type="button" class="fo-skjult-k" data-fo="skjult-veksle" aria-expanded="${SKJULT_APEN}">${T(`Utført eller satt til side: ${delt.skjulte.length}`, `Done or put aside: ${delt.skjulte.length}`)}</button>
        ${SKJULT_APEN ? delt.skjulte.map((p) => `<div class="fo-skjult-rad"><span>${esc(p.tittel)}</span><span class="fo-skjult-n">${p.state === 'utfort' ? T('Utført ', 'Done ') + dato(p.t) : T('Utsatt til ', 'Aside until ') + dato(p.til)}</span>
          <button type="button" data-fo="vis" data-id="${esc(p.id)}">${T('Vis igjen', 'Show again')}</button></div>`).join('') : ''}</div>`;
    }
    const Lr = window.nabeLaer, lister = Lr ? Lr.liste() : [];
    if (lister.length) {
      const dato = (ms) => new Date(ms).toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO', {day: 'numeric', month: 'short', year: 'numeric'});
      const GR = Lr.grunner(), TY = Lr.typer();
      kropp += `<div class="fo-skjult fo-laert"><button type="button" class="fo-skjult-k" data-fo="laert-veksle" aria-expanded="${LAERT_APEN}">${T(`Dette har NABE lært på anlegget: ${lister.length}`, `What NABE has learned about this plant: ${lister.length}`)}</button>
        ${LAERT_APEN ? `<div class="fo-laert-om">${T('Det du har sagt er ikke feil. Det gjelder bare dette anlegget og bare den typen forslag, og det går ut av seg selv.', 'What you said is not a fault. It holds only for this plant and only for that kind of suggestion, and it runs out by itself.')}</div>`
          + lister.map((x) => `<div class="fo-skjult-rad"><span>${x.art === 'monster' ? T(`Alt med «${x.ord}» i navnet`, `Everything with “${x.ord}” in the name`) : `${esc(x.enhet)} · ${esc(x.navn)}`} <i>${esc(TY[x.id] || x.id)}</i></span>
            <span class="fo-skjult-n">${esc(GR[x.g] || '')} · ${x.utlopt ? T('utløpt', 'expired') : T('til ', 'until ') + dato(x.til)}</span>
            <button type="button" data-fo="laer-angre" data-art="${x.art}" data-nok="${esc(x.nok)}">${T('Angre', 'Undo')}</button></div>`).join('') : ''}</div>`;
    }
    const urTekst = r.ur && r.ur.totalt ? T(` Ukeprogram lest på ${r.ur.lest} av ${r.ur.totalt} enheter som har ur.`, ` Schedules read on ${r.ur.lest} of ${r.ur.totalt} devices that have them.`) : '';
    const laertTekst = r.laert ? T(` ${r.laert} ${r.laert === 1 ? 'punkt er' : 'punkter er'} holdt utenfor etter dine valg.`, ` ${r.laert} ${r.laert === 1 ? 'point is' : 'points are'} left out by your choices.`) : '';
    const grunnlag = r.totalt ? `<div class="fo-grunnlag">${T(`Bygger på ${r.lest} av ${r.totalt} enheter som er lest.`, `Based on ${r.lest} of ${r.totalt} devices read.`)}${urTekst}${window.nabeAlarmvei ? window.nabeAlarmvei.grunnlag() : ''}${laertTekst}</div>` : '';
    const RG = window.nabeRegler ? window.nabeRegler.siste() : null;
    const fot = window.nabeRegler ? `<div class="fo-fot"><span>${RG && RG.finnes ? T(`Egne regler: ${RG.regler.length} av ${RG.antall} i bruk`, `Own rules: ${RG.regler.length} of ${RG.antall} in use`) : T('Egne regler: ingen fil ennå', 'Own rules: no file yet')}</span>
      <span class="fo-fot-k"><button type="button" class="btn" data-fo="regler-aapne" title="${esc(T('Åpner fila i Notisblokk. Finnes den ikke, lages en mal med eksempler.', 'Opens the file in Notepad. If there is none, a template with examples is made.'))}">${T('Åpne regelfila', 'Open the rules file')}</button>
      <button type="button" class="btn" data-fo="regler-last">${T('Last på nytt', 'Reload')}</button></span></div>` : '';
    lag.innerHTML = `<div class="gs-modal fo-modal"><div class="gs-head"><span class="gd-tittel">${T('Forslag til service', 'Service suggestions')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="fo-kropp">${grunnlag}${kropp}</div>${fot}</div>`;
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

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const k = e.target.closest('[data-fo]');
    const Lr = window.nabeLaer;
    if (k && Lr && ['laer', 'laer-ja', 'laer-nei', 'laert-veksle', 'laer-angre', 'monster-ja', 'monster-nei'].includes(k.dataset.fo)) {
      const rull = lag.querySelector('.fo-kropp') && lag.querySelector('.fo-kropp').scrollTop;
      const p = SISTE && SISTE.liste.find((x) => x.id === k.dataset.id);
      const rad = p && p.rader[Number(k.dataset.i)];
      let ok = true;
      if (k.dataset.fo === 'laer') VELGER = {id: k.dataset.id, i: Number(k.dataset.i)};
      else if (k.dataset.fo === 'laer-nei') VELGER = null;
      else if (k.dataset.fo === 'laert-veksle') LAERT_APEN = !LAERT_APEN;
      else if (k.dataset.fo === 'laer-ja' && rad) {
        VELGER = null;
        ok = await Lr.laer(p.id, [rad], k.dataset.g);
        toast(ok ? T('NABE husker det. Du kan angre nederst i listen.', 'NABE will remember. You can undo it at the bottom of the list.') : T('Fikk ikke lagret valget i fila. Det gjelder til du lukker NABE.', 'Could not save the choice to the file. It holds until you close NABE.'), !ok);
        if (ok) LAERT_APEN = true;
      } else if (k.dataset.fo === 'monster-ja') { ok = await Lr.taMonster(k.dataset.id, k.dataset.ord); toast(ok ? T(`Alt med «${k.dataset.ord}» settes til side på dette anlegget`, `Everything with “${k.dataset.ord}” is set aside on this plant`) : T('Fikk ikke lagret valget i fila', 'Could not save the choice to the file'), !ok); }
      else if (k.dataset.fo === 'monster-nei') await Lr.avslaMonster(k.dataset.id, k.dataset.ord);
      else if (k.dataset.fo === 'laer-angre') { ok = k.dataset.art === 'monster' ? await Lr.angreMonster(...k.dataset.nok.split('|')) : await Lr.angre(k.dataset.nok); if (ok) toast(T('Angret. Det kommer med i forslagene igjen.', 'Undone. It is back in the suggestions.')); }
      tegn();
      if (rull && lag.querySelector('.fo-kropp')) lag.querySelector('.fo-kropp').scrollTop = rull;
      if (window.nabeStatus) window.nabeStatus.send();
      return;
    }
    if (k && window.nabeArbeid && ['utfort', 'utsett', 'kopier', 'vis', 'skjult-veksle'].includes(k.dataset.fo)) {
      const A = window.nabeArbeid, p = SISTE && SISTE.liste.find((x) => x.id === k.dataset.id);
      if (k.dataset.fo === 'skjult-veksle') SKJULT_APEN = !SKJULT_APEN;
      else if (k.dataset.fo === 'vis') A.vis(k.dataset.id);
      else if (!p) return;
      else if (k.dataset.fo === 'kopier') {
        try { await navigator.clipboard.writeText(A.melding(p, `${asNavn() || asNokkel()} · ${new Date().toLocaleDateString(SPRAAK === 'en' ? 'en-GB' : 'nb-NO')}`)); toast(T('Kopiert som melding', 'Copied as a message')); }
        catch { toast(T('Fikk ikke kopiert', 'Could not copy'), true); }
        return;
      } else { A.marker(p, k.dataset.fo === 'utfort' ? 'utfort' : 'utsatt', 7); toast(k.dataset.fo === 'utfort' ? T('Merket som utført', 'Marked as done') : T('Satt til side i en uke', 'Put aside for a week')); }
      const rull = lag.querySelector('.fo-kropp') && lag.querySelector('.fo-kropp').scrollTop;
      tegn();
      if (rull && lag.querySelector('.fo-kropp')) lag.querySelector('.fo-kropp').scrollTop = rull;
      return;
    }
    if (k && window.nabeRegler) {
      if (k.dataset.fo === 'regler-aapne') { await window.nabeRegler.aapne(); return; }
      if (k.dataset.fo === 'regler-last') {
        const r = await window.nabeRegler.last();
        toast(r.feil.length ? T(`${r.feil.length} feil i regelfila, se forslagene`, `${r.feil.length} mistakes in the rules file, see the suggestions`) : T(`${r.regler.length} regler i bruk`, `${r.regler.length} rules in use`), r.feil.length > 0);
        tegn();
        return;
      }
    }
    const b = e.target.closest('.fo-rad');
    // A row with no address (a message, not a device) does nothing: the list stays open
    if (b && b.dataset.ip) { lag.hidden = true; gaaTil(b.dataset.ip, b.dataset.o); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); }
  }, true);

  window.aapneForslag = async () => {
    await Promise.race([Promise.all([window.nabeArbeid && window.nabeArbeid.last(), window.nabeLaer && window.nabeLaer.last()]), new Promise((ok) => setTimeout(ok, 1500))]);
    tegn({});
    lag.hidden = false;
    // What the server has counted, the rules file and the storm state come a moment later and fill in
    const ekstra = await hentEkstra();
    if (!lag.hidden) tegn(ekstra);
    if (window.nabeStatus) window.nabeStatus.send();
  };
  /* The list as plain text, for the support package and for pasting into a message. */
  window.forslagTekst = async () => {
    const r = bygForslag(data(await hentEkstra()));
    const linjer = [`${asNavn() || asNokkel()} · ${new Date().toLocaleDateString(T('no', 'en-GB'))}`, T(`Bygger på ${r.lest} av ${r.totalt} enheter som er lest.`, `Based on ${r.lest} of ${r.totalt} devices read.`), ''];
    for (const p of r.liste) {
      linjer.push(`[${p.prio}] ${p.tittel}`, '  ' + p.hvorfor, ...p.sjekk.map((s) => '  - ' + s), ...p.rader.slice(0, 20).map((x) => `  > ${x.navn}${x.tekst ? ' · ' + x.tekst : ''}`), '');
    }
    return linjer.join('\n');
  };
  window.bygForslag = bygForslag;
  /* What is open and what is done, as the list stands now (the visit report uses it) */
  window.forslagNaa = () => {
    if (!S.devices || !S.devices.length) return {synlige: [], skjulte: [], laert: 0, lest: 0, totalt: 0};
    const r = bygForslag(data(EKSTRA));
    return {...(window.nabeArbeid ? window.nabeArbeid.del(r.liste) : {synlige: r.liste, skjulte: []}), laert: r.laert, lest: r.lest, totalt: r.totalt};
  };
  if ($('apiBtn')) $('apiBtn').onclick = () => { closeMenus(); window.open('/docs', '_blank', 'noopener'); };
  if ($('forslagBtn')) $('forslagBtn').onclick = () => { closeMenus(); window.aapneForslag(); };
})();
