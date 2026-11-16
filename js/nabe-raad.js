/* NABE - things worth saying before anyone asks.

   Each one watches for something a technician would want to know, and says it once
   per site and session: the same name on several controllers, a plant whose clocks
   disagree, a clock stuck on a date from the factory, two adapters carrying two sites.
   Spoken through nabeSier with the "useful" flag, so they get through when the mood
   is set to Quiet.

   In the Chaos mood there is also the odd remark when nothing has happened for a
   while. Never while a dialog is open, never twice in a row the same. */
'use strict';

(function raad() {
  const SAGT = new Set();
  const sier = (nokkel, nb, en, humor) => {
    if (SAGT.has(nokkel)) return;
    SAGT.add(nokkel);
    nabeSier(T(nb, en), humor || null, nokkel, true);
  };
  const navnPaa = (d) => d.object_name || d.address;

  /* The same name on several devices: Beckhoff ships every controller as «Beckhoff_0». */
  function dupNavn() {
    if (document.body.classList.contains('skanner')) return;
    const per = new Map();
    for (const d of S.devices) if (d.object_name) per.set(d.object_name, (per.get(d.object_name) || 0) + 1);
    for (const [navn, n] of per) {
      if (n < 3) continue;
      sier('raad:dup:' + navn,
        `${n} enheter heter «${navn}». NABO kan gi dem unike navn.`,
        `${n} devices are called "${navn}". NABO can make them unique.`, 'skvatt');
      return;
    }
  }

  /* Clocks: one device off is a device, most of a site off is a plant with no time sync. */
  function klokker() {
    let sek;
    // Said when every device has been read, so the count is the real one and not the one so far.
    try { if (typeof anleggTall === 'function' && !anleggTall().ferdig) return; } catch { return; }
    try { sek = siteWarnings().find(s => s.nokkel === 'klokke'); } catch { return; }
    if (!sek) return;
    const perSted = new Map(), totalt = new Map();
    for (const d of S.devices) if (d._range) totalt.set(d._range, (totalt.get(d._range) || 0) + 1);
    for (const r of sek.rader) {
      const d = S.devices.find(x => x.address === r.ip);
      const fast = /(\d{4}-\d{2}-\d{2})/.exec(r.tekst || '');
      if (fast && /stuck at|står på/.test(r.tekst)) {
        sier('raad:fast:' + r.ip, `${d ? navnPaa(d) : r.ip}: klokka står fast på ${fast[1]}. Batteriet?`,
          `${d ? navnPaa(d) : r.ip}: clock stuck on ${fast[1]}. The battery?`);
        continue;
      }
      if (d && d._range) perSted.set(d._range, (perSted.get(d._range) || 0) + 1);
    }
    for (const [omr, n] of perSted) {
      const m = totalt.get(omr) || 0;
      if (n < 3 || n / Math.max(m, 1) < 0.5) continue;
      const navn = (typeof nettNavn === 'function' && nettNavn(omr)) || omr;
      sier('raad:klokke:' + omr, `${navn}: ${n} av ${m} går feil. Ingen tidssynk?`,
        `${navn}: ${n} of ${m} are off. No time sync?`);
    }
  }

  /* Two adapters carrying two sites, said once: nothing to switch between. */
  let SAGT_KORT = false;
  function toKort() {
    if (SAGT_KORT || !S.connected || (S.kort || []).length < 2) return;
    const omr = new Set(S.devices.map(d => d._range).filter(Boolean));
    if (omr.size < 2) return;
    SAGT_KORT = true;
    const navn = S.kort.map(k => k.interface || k.ip).slice(0, 2).join(' og ');
    const en = S.kort.map(k => k.interface || k.ip).slice(0, 2).join(' and ');
    sier('raad:to-kort', `${navn} samtidig. Hvert anlegg går ut av sitt kort.`,
      `${en} at once. Each site goes out of its own adapter.`, 'fornoyd');
  }

  /* A slow link, said once per adapter: the plant is not slow, the road to it is.
     Three measurements in a row, so one late answer is not a diagnosis. */
  const TREG_MS = 300, tregTeller = {};
  function tregLenke() {
    for (const k of S.kort || []) {
      const ms = (S.kortMs || {})[k.ip];
      if (!ms || !k.enheter) continue;
      tregTeller[k.ip] = ms >= TREG_MS ? (tregTeller[k.ip] || 0) + 1 : 0;
      if (tregTeller[k.ip] < 3) continue;
      const navn = k.interface || k.ip;
      sier('raad:treg:' + k.ip,
        `${navn} svarer på ${ms} ms. Veien dit er treg, ikke anlegget.`,
        `${navn} answers in ${ms} ms. The road is slow, not the plant.`);
    }
  }

  /* What the plant looks like once all of it is read: one remark on the thing
     that stands out, and the records this plant holds. Kept per plant on this PC. */
  const rekorder = () => loadPrefs().rekorder || {};
  function funn() {
    let t;
    try { t = anleggTall(); } catch { return; }
    if (!t.ferdig || t.lest < 2) return;
    const key = asNokkel();
    if (!key || SAGT.has('raad:funn:' + key)) return;
    SAGT.add('raad:funn:' + key);
    const feil = t.flagg['fault'].length, alarm = t.flagg['in-alarm'].length, over = t.flagg['overridden'].length;
    let verst = 0, verstD = null;
    for (const d of S.devices) {
      const sek = clockDrift(d.address);
      // A clock stuck on a factory date is a dead battery, not a record.
      if (sek === null || Math.abs(sek) > 2592000) continue;
      if (Math.abs(sek) > Math.abs(verst)) { verst = sek; verstD = d; }
    }
    const alle = rekorder(), foer = alle[key] || {};
    const naa = {klokke: Math.max(Math.abs(verst), foer.klokke || 0), feil: Math.max(feil, foer.feil || 0), t: Date.now()};
    const nokler = Object.keys(alle).concat(key).filter((k, i, a) => a.indexOf(k) === i).slice(-40);
    alle[key] = naa;
    savePrefs({rekorder: Object.fromEntries(nokler.map(k => [k, alle[k]]))});

    if (verstD && foer.klokke && Math.abs(verst) > foer.klokke * 1.2 && Math.abs(verst) > 1800) {
      sier('raad:rekord:' + key,
        `Ny rekord her: ${navnPaa(verstD)} går ${driftText(verst)}. Den forrige var ${driftText(foer.klokke).replace(/ (foran|etter)$/, '')}.`,
        `A new record here: ${navnPaa(verstD)} is ${driftText(verst)}. The previous was ${driftText(foer.klokke).replace(/ (ahead|behind)$/, '')}.`, 'skvatt');
      return;
    }
    if (feil >= 100) {
      sier('raad:feil:' + key,
        `${feil} punkter med feil. Enten er en buss nede, eller så er dette anleggets personlighet.`,
        `${feil} faulty points. Either a bus is down, or this is the personality of the plant.`, 'nervos');
    } else if (over >= 10) {
      sier('raad:over:' + key,
        `${over} overstyringer. Noen har hatt en travel dag i hånd.`,
        `${over} overrides. Somebody has had a busy day in hand.`, 'nervos');
    } else if (!alarm && !feil && t.total >= 5) {
      sier('raad:rolig:' + key,
        `${t.total} enheter og ingen alarmer. Jeg tar et skjermbilde, ingen kommer til å tro oss.`,
        `${t.total} devices and no alarms. I am taking a screenshot, nobody will believe us.`, 'fornoyd');
    }
  }

  etter('renderDevices', () => { dupNavn(); toKort(); });
  etter('renderSiteWarnings', () => { klokker(); funn(); });
  if (typeof tegnVei === 'function') etter('tegnVei', tregLenke);

  /* Chaos: the odd remark when it has been quiet for a while. */
  const REPLIKKER = [
    ['Jeg har talt til 47808. Den holder.', 'I have counted to 47808. It holds.'],
    ['Prioritet 8 er ikke et kjærlighetsspråk.', 'Priority 8 is not a love language.'],
    ['Hvis jeg hadde hender, hadde jeg ikke rørt overstyringene.', 'If I had hands, I would not touch the overrides.'],
    ['Teknisk rom er det eneste stedet der 18 grader er varmt.', 'A plant room is the only place where 18 degrees is warm.'],
    ['En regulator uten riktig klokke er som en vaktmester uten nøkkel.', 'A controller with the wrong clock is a caretaker without a key.'],
    ['Segmentering støttes ikke. Det gjelder meg også.', 'Segmentation not supported. Same here.'],
    ['Kaffen din er kald nå. Jeg sier ikke mer.', 'Your coffee is cold by now. I will say no more.'],
    ['Noen må passe på VPN-en. Det blir meg.', 'Somebody has to watch the VPN. That is me.'],
    ['Jeg har sett RT401 pendle. Vi snakker ikke om det.', 'I have seen RT401 hunting. We do not talk about it.'],
    ['Pst. Alt er rolig. Ikke tell det høyt.', 'Psst. All is quiet. Do not say it out loud.'],
  ];
  let SIST = -1;
  function kaos() {
    if (window.nabeSyn && nabeSyn.humorNiva() !== 'kaos') return;
    if (typeof NABE === 'undefined' || Date.now() - NABE.sist < 75000) return;
    if (document.querySelector('.gs-overlay:not([hidden]), #naboOverlay:not([hidden])')) return;
    if (document.body.classList.contains('skanner') || document.getElementById('nabeBoble')?.classList.contains('inne')) return;
    let i;
    do { i = Math.floor(Math.random() * REPLIKKER.length); } while (i === SIST && REPLIKKER.length > 1);
    SIST = i;
    nabeSier(T(...REPLIKKER[i]), 'fornoyd');
  }
  (function neste() {
    setTimeout(() => { kaos(); neste(); }, (6 + Math.random() * 4) * 60000);
  })();
  window.nabeRaad = {dupNavn, klokker, toKort, tregLenke, funn, REPLIKKER};
})();
