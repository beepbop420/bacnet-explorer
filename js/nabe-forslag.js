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

    // Values that cannot be right: -50 degrees, 0 ppm CO2, humidity over 100
    const urimelig = data.urimelig || [];
    const perUr = new Map();
    for (const u of urimelig) (perUr.get(u.ip) || perUr.set(u.ip, []).get(u.ip)).push(u);
    legg({id: 'urimelig', prio: 2,
      tittel: T(`${urimelig.length} ${urimelig.length === 1 ? 'punkt' : 'punkter'} med verdi som ikke kan stemme`, `${urimelig.length} ${urimelig.length === 1 ? 'point' : 'points'} with a value that cannot be right`),
      hvorfor: T('-50 grader, 0 ppm CO2 eller 120 % fuktighet er sjelden en måling. Som regel er det en føler som ikke er koblet til.', '-50 degrees, 0 ppm CO2 or 120 % humidity is seldom a measurement. Usually it is a sensor that is not connected.'),
      sjekk: [T('Mål ved inngangen. Åpen krets og kortslutning gir hver sin verdi, og feilkoden sier hvilken.', 'Measure at the input. An open circuit and a short give different values, and the error value says which.'),
              T('Står flere på samme modul, sjekk forsyningen til modulen før du går til hver føler.', 'If several sit on one module, check the module’s supply before going to each sensor.')],
      rader: [...perUr].map(([ip, l]) => rad(ip, T(`${l.length} ${l.length === 1 ? 'urimelig' : 'urimelige'}, for eksempel ${l[0].navn} = ${l[0].verdi}`, `${l.length} impossible, for example ${l[0].navn} = ${l[0].verdi}`), l[0].objid))});

    // An analog input that has not moved at all: the wire, or a value left fixed
    const flate = data.flate || [];
    legg({id: 'flat', prio: 3,
      tittel: T(`${flate.length} ${flate.length === 1 ? 'måling står' : 'målinger står'} helt stille`, `${flate.length} ${flate.length === 1 ? 'measurement stands' : 'measurements stand'} perfectly still`),
      hvorfor: T('En levende føler flytter seg litt. En som står helt stille har ofte mistet ledningen, eller er satt til en fast verdi.', 'A live sensor moves a little. One that stands perfectly still has often lost its wire, or been set to a fixed value.'),
      sjekk: [T('Se først om punktet er overstyrt eller ute av drift.', 'First see whether the point is overridden or out of service.'),
              T('Ellers: ledning og føler. Dette sees bare for enheten som er åpen mens Live går.', 'Otherwise: the wire and the sensor. This is seen only for the device that is open while Live runs.')],
      rader: flate.map((f) => rad(f.ip, T(`${f.navn} uendret i ${f.minutter} min`, `${f.navn} unchanged for ${f.minutter} min`), f.objid))});

    // Starting and stopping too often, counted from the points NABE follows in the background
    const syk = data.sykluser || [];
    const sykMange = syk.filter((x) => x.dom === 'mange');
    legg({id: 'sykluser', prio: sykMange.length ? 2 : 3,
      tittel: T(`${syk.length} ${syk.length === 1 ? 'utstyr starter' : 'utstyr starter'} ofte`, `${syk.length} ${syk.length === 1 ? 'item starts' : 'items start'} often`),
      hvorfor: T('Hyppig av og på sliter motor og kontaktor lenge før noe alarmerer. Seks starter i timen er der mange produsenter setter grensen for en kompressor.', 'Frequent on and off wears out a motor and contactor long before anything alarms. Six starts an hour is where many makers draw the line for a compressor.'),
      sjekk: [T('Se på reguleringen: for smalt dødbånd, for kort minste gangtid eller en føler som svinger gir ofte dette.', 'Look at the control: too narrow a dead band, too short a minimum run time or a sensor that swings often gives this.'),
              T('Er det bare noen få minutter mellom starter, mangler det trolig en minste av-tid.', 'If there are only a few minutes between starts, a minimum off time is probably missing.')],
      rader: syk.map((x) => rad(x.address, `${String(x.navn).replace(/ \([^)]*\)$/, '')} · ${String(x.per_time).replace('.', ',')} ${T('i timen', 'an hour')}`, x.objid))});
    const tips = data.tips || [];
    legg({id: 'syk-tips', prio: 3,
      tittel: T(`${tips.length} ${tips.length === 1 ? 'punkt' : 'punkter'} kan sjekkes for hyppige starter`, `${tips.length} ${tips.length === 1 ? 'point' : 'points'} can be checked for frequent starts`),
      hvorfor: T('NABE teller starter per time for festede punkter. Ingen av disse følges nå.', 'NABE counts starts an hour for pinned points. None of these is followed now.'),
      sjekk: [T('Fest dem med ☆, la det gå en halvtime, og se i «Se bakover».', 'Pin them with ☆, let half an hour pass, and look in “Look back”.')],
      rader: tips.map((x) => rad(x.ip, x.navn, x.objid))});

    // Alarms: what is new first, and what shouts all the time after it
    const ah = data.alarmhist || [];
    const ahNye = ah.filter((x) => x.ny && !x.kjent), ahOfte = ah.filter((x) => x.kronisk && !x.kjent);
    legg({id: 'alarm-nye', prio: 2,
      tittel: T(`${ahNye.length} ${ahNye.length === 1 ? 'ny alarm' : 'nye alarmer'} siste døgn`, `${ahNye.length} new ${ahNye.length === 1 ? 'alarm' : 'alarms'} in the last day`),
      hvorfor: T('Disse har ikke stått i alarm før, så ingen har sett dem ennå.', 'These have not been in alarm before, so nobody has seen them yet.'),
      sjekk: [T('Se hva som skjedde da alarmen kom. «Se bakover» viser de siste to timene for festede punkter.', 'See what happened when the alarm came. “Look back” shows the last two hours for pinned points.')],
      rader: ahNye.map((x) => rad(x.ip, `${x.navn}`, x.objid))});
    legg({id: 'alarm-ofte', prio: 3,
      tittel: T(`${ahOfte.length} ${ahOfte.length === 1 ? 'punkt alarmerer' : 'punkter alarmerer'} nesten hver gang`, `${ahOfte.length} ${ahOfte.length === 1 ? 'point alarms' : 'points alarm'} nearly every time`),
      hvorfor: T('Det som alltid roper skjuler det nye. Enten er det en feil som ikke blir rettet, eller en grense som er satt for stramt.', 'What always shouts hides what is new. Either it is a fault that is not fixed, or a limit set too tight.'),
      sjekk: [T('Rett feilen eller løsne grensen, så alarmlista igjen forteller noe. Marker dem som «kjent» i «Mest alarmerende» i mellomtiden.', 'Fix the fault or loosen the limit, so the alarm list says something again. Mark them “known” in “Most alarming” meanwhile.')],
      rader: ahOfte.map((x) => rad(x.ip, T(`${x.navn} · ${x.dager.length} dager`, `${x.navn} · ${x.dager.length} days`), x.objid))});

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
    const vk = data.virkning || [];
    legg({id: 'virkning', prio: 2,
      tittel: T(`${vk.length} pådrag uten effekt`, `${vk.length} ${vk.length === 1 ? 'actuator' : 'actuators'} with no effect`),
      hvorfor: T('Pådraget står på 100 % og målingen følger ikke etter. Da gjør reguleringen alt den kan, og feilen ligger utenfor den.', 'The output stands at 100 % and the measurement does not follow. The control is doing all it can, and the fault lies outside it.'),
      sjekk: [T('Ventil: kjenn om røret blir varmt, og se at motoren faktisk beveger seg.', 'Valve: feel whether the pipe gets warm, and see that the actuator really moves.'),
              T('Sjekk pumpe og tilførsel (temperatur og trykk) før du går til føleren.', 'Check the pump and the supply (temperature and pressure) before going to the sensor.'),
              T('Sitter føleren i et rom pådraget ikke virker på?', 'Does the sensor sit in a room the output does not act on?')],
      rader: vk.map((x) => rad(x.address || '', `${utenEnhet(x.maling)} ${String(x.verdi).replace('.', ',')}${x.settpunkt != null ? ' ' + T('mot', 'against') + ' ' + String(x.settpunkt).replace('.', ',') : ''} · ${T('pådrag fullt i', 'output full for')} ${minTid(x.siden_s)}`, x.objid))});
    const vt = data.virkningTips || [];
    legg({id: 'virkning-tips', prio: 3,
      tittel: T(`${vt.length} romregulatorer kan sjekkes for pådrag uten effekt`, `${vt.length} room controllers can be checked for an actuator with no effect`),
      hvorfor: T('NABE ser om ventilen står fullt uten at temperaturen følger. Det trenger måling og ventil festet i overvåkingslista, og settpunktet hvis det finnes.', 'NABE sees whether the valve stands full without the temperature following. It needs the measurement and the valve pinned in the watch list, and the setpoint if there is one.'),
      sjekk: [T('Fest måling og ventil med ☆. Etter et kvarter sier NABE fra hvis det ikke virker.', 'Pin the measurement and the valve with ☆. After a quarter of an hour NABE says if it does not work.')],
      rader: vt.map((x) => rad(x.ip, x.navn, x.objid))});

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
    const rf = data.regelfeil || [];
    legg({id: 'regelfeil', prio: 2,
      tittel: T(`${rf.length} feil i regelfila`, `${rf.length} ${rf.length === 1 ? 'mistake' : 'mistakes'} in the rules file`),
      hvorfor: T('Reglene med feil er ikke tatt med. De andre gjelder.', 'The rules with mistakes are left out. The others apply.'),
      sjekk: [T('Åpne fila, rett det som står under og trykk «Last på nytt» nederst.', 'Open the file, fix what is listed below and press “Reload” at the bottom.')],
      rader: rf.map((m) => ({ip: '', navn: '', tekst: m, objid: '', lang: true}))});

    // Equal MAC on different addresses, and devices whose ID changed between two scans
    const mac = data.sammeMac || [];
    legg({id: 'mac', prio: 3,
      tittel: T(`${mac.length} MAC-${mac.length === 1 ? 'adresse' : 'adresser'} går igjen på flere IP-adresser`, `${mac.length} MAC ${mac.length === 1 ? 'address shows' : 'addresses show'} on several IP addresses`),
      hvorfor: T('Samme MAC bak to IP-adresser er vanlig bak en ruter eller proxy, men kan også være en IP som er brukt to ganger.', 'The same MAC behind two IP addresses is usual behind a router or proxy, but can also be an IP used twice.'),
      sjekk: [T('Er det ikke en ruter eller proxy: se etter to enheter som har fått samme IP, for eksempel fra et kopiert oppsett.', 'If it is not a router or proxy: look for two devices that were given the same IP, for example from a copied setup.')],
      rader: mac.map((m) => rad(m.enheter[0].address, `${m.mac} · ${m.enheter.map((d) => vertAdr(d.address)).join(', ')}`))});
    const endret = data.endretId || [];
    legg({id: 'endret-id', prio: 3,
      tittel: T(`${endret.length} ${endret.length === 1 ? 'enhet har' : 'enheter har'} skiftet enhets-ID siden forrige skann`, `${endret.length} ${endret.length === 1 ? 'device has' : 'devices have'} changed device ID since the last scan`),
      hvorfor: T('Samme adresse, nytt enhets-ID. Noen har endret det, eller en annen enhet har tatt over adressen.', 'The same address, a new device ID. Somebody changed it, or another device has taken over the address.'),
      sjekk: [T('Passer det ikke med en endring du kjenner til, sjekk hvilken enhet som står på adressen nå.', 'If it does not fit a change you know of, check which device is on the address now.')],
      rader: endret.map((x) => rad(x.ip, T(`ID ${x.fra} ble ${x.til}`, `ID ${x.fra} became ${x.til}`)))});

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

  const PUMPE = /pump|kompress|compress|sirkul|vifte|\bfan\b|kjel|boiler|motor/i;
  const verdiTekst = (p) => `${fmtVal(p.value).t}${p.unit_symbol ? ' ' + p.unit_symbol : ''}`;
  /* What the server has counted for the pinned points, the rules file and the storm state: asked together, and
     none of them is allowed to hold the list back for more than a moment. */
  async function hentEkstra() {
    const frist = (p) => Promise.race([p, new Promise((ok) => setTimeout(() => ok(null), 2500))]);
    const vakt = async () => { try { const d = await (await fetch('/api/vakt', {cache: 'no-store'})).json(); return d && d.status === 'done' ? d : null; } catch { return null; } };
    const [v] = await Promise.all([frist(vakt()),
      frist(window.nabeRegler ? window.nabeRegler.last() : null), frist(window.nabeStorm ? window.nabeStorm.hent() : null)]);
    return {sykluser: (v && v.sykluser) || [], virkning: (v && v.virkning) || []};
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
    const egne = R && R.regler.length ? window.nabeRegler.evaluer(R.regler, S.devices, S.cache, (d) => { try { return gruppeFor(d).label; } catch { return ''; } }) : [];
    const flate = [];
    if (S.activeDev && typeof flatVerdi === 'function') {
      for (const p of S.points || []) if (flatVerdi(p)) flate.push({ip: S.activeDev.address, objid: p.objid, navn: p.name || p.objid, minutter: Math.max(1, Math.round((Date.now() - p._flatEndret) / 60000))});
    }
    const N = window.nabeNett;
    const rutere = Array.isArray(S.rutere) ? S.rutere : [];
    return {devices: S.devices, cache: S.cache, failed: PRE.failed, varsler, avvik, urimelig, flate, sykluser, virkning, virkningTips, egne,
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
    // The user's own rules and what is wrong with their file are written by them (or already in the right language): the language sweep leaves them alone
    return `<section class="fo-post p${p.prio}${p.egen || p.id === 'regelfeil' ? ' egen' : ''}">
      <div class="fo-tittel"><span class="fo-prikk" aria-hidden="true"></span>${esc(p.tittel)}</div>
      <div class="fo-hvorfor">${esc(p.hvorfor)}</div>
      <ul class="fo-sjekk">${p.sjekk.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <div class="fo-rader">${vis.map((r) => `<button type="button" class="fo-rad${r.lang ? ' lang' : ''}" data-ip="${esc(r.ip)}" data-o="${esc(r.objid)}">
        <b>${esc(r.navn)}</b>${r.tekst ? `<span>${esc(r.tekst)}</span>` : ''}</button>`).join('')}
        ${rest > 0 ? `<span class="fo-flere">${T(`og ${rest} til`, `and ${rest} more`)}</span>` : ''}</div>
    </section>`;
  }

  let SISTE = null, EKSTRA = {};
  function tegn(ekstra) {
    EKSTRA = ekstra || EKSTRA;
    const r = SISTE = bygForslag(data(EKSTRA));
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
    tegn({});
    lag.hidden = false;
    // What the server has counted, the rules file and the storm state come a moment later and fill in
    const ekstra = await hentEkstra();
    if (!lag.hidden) tegn(ekstra);
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
  if ($('forslagBtn')) $('forslagBtn').onclick = () => { closeMenus(); window.aapneForslag(); };
})();
