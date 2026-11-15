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
  const sier = (nokkel, nb, en, humor) => nabeSier(T(nb, en), humor || null, nokkel, true);
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

  etter('renderDevices', () => { dupNavn(); toKort(); });
  etter('renderSiteWarnings', klokker);

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
  window.nabeRaad = {dupNavn, klokker, toKort, REPLIKKER};
})();
