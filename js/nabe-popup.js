/* NABE - hver popup får en identitet.

   De fleste overlegg deler skallet (.gs-overlay og .gs-modal), men de er til helt ulike ting. Her får hvert
   av dem et lite ikon og én linje om hva det er til for, under tittelen. Linjene er skrevet for hvert
   overlegg, ikke generert: de sier hva du kommer til å se, og når du skal bruke det.

   Overlegg bygges og tegnes på nytt av mange ulike filer, så dette legger seg på utsiden: en observatør ser
   etter nye overlegg og etter at et overlegg har fått nytt innhold, og pynter bare det som ikke allerede er
   pyntet. Overlegg uten oppføring her blir stående som de er. */
'use strict';

(function () {
  const IK = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IKON = {
    aktivitet: IK('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
    klokke: IK('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    maal: IK('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
    historie: IK('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
    pare: IK('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.6 1 1.3 1 2.3h6c0-1 .3-1.7 1-2.3A7 7 0 0 0 12 2z"/>'),
    skjorte: IK('<path d="M20.4 6.5 16 4a4 4 0 0 1-8 0L3.6 6.5l1.8 4.3L8 10v10h8V10l2.6.8z"/>'),
    nett: IK('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 5.5M12 11.5l5.5 5.5"/>'),
    chip: IK('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
    last: IK('<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>'),
    opptak: IK('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>'),
    brikke: IK('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    redning: IK('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>'),
    telefon: IK('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>'),
    kabel: IK('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>'),
    sammenlign: IK('<path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/>'),
    kolonner: IK('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
    adresse: IK('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    skjema: IK('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>'),
    rapport: IK('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>'),
    kalender: IK('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    innstillinger: IK('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    sjekk: IK('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
  };

  // id -> ikon og en linje om hva overlegget er til for. Funksjoner, så språket følger når det byttes.
  const IDENT = {
    trafikkOverlay: ['aktivitet', () => T('Alt NABE har sagt til anlegget, og hva det svarte.', 'Everything NABE said to the plant, and what it answered.')],
    alarmhistOverlay: ['klokke', () => T('Punktene som har ropt høyest siden du kom.', 'The points that have shouted loudest since you arrived.')],
    avvikOverlay: ['maal', () => T('Der målingen og ønsket verdi har sluttet å være venner.', 'Where the measurement and the setpoint have stopped being friends.')],
    bakoverOverlay: ['historie', () => T('Det som skjedde mens du så en annen vei.', 'What happened while you were looking the other way.')],
    forslagOverlay: ['pare', () => T('Det NABE la merke til, i den rekkefølgen det bør tas.', 'What NABE noticed, in the order it should be handled.')],
    gardOverlay: ['skjorte', () => T('Plagg låses opp av å gjøre jobben, ikke av å lete.', 'Garments are unlocked by doing the job, not by looking.')],
    grenseOverlay: ['klokke', () => T('Si fra hvor mye som er for mye, så sier NABE fra til deg.', 'Say how much is too much, and NABE tells you.')],
    kartOverlay: ['nett', () => T('Hvem som snakker med hvem, og hvem som står alene.', 'Who talks to whom, and who stands alone.')],
    knxOverlay: ['nett', () => T('Gruppeadresser på KNX. Bare lesing.', 'KNX group addresses. Read only.')],
    modbusOverlay: ['chip', () => T('Registre på Modbus. Bare lesing.', 'Modbus registers. Read only.')],
    oppdOverlay: ['last', () => T('Ny versjon, hentet og kontrollert mot signaturen først.', 'A new version, fetched and checked against the signature first.')],
    opptakOverlay: ['opptak', () => T('Se hva som skjer mens du gjør noe annet.', 'See what happens while you are doing something else.')],
    simOverlay: ['brikke', () => T('Et anlegg som ikke kan bli sint, til øving.', 'A plant that cannot get angry, for practice.')],
    stotteOverlay: ['redning', () => T('Alt en kollega trenger for å hjelpe, uten passord.', 'Everything a colleague needs to help, without passwords.')],
    mobilOverlay: ['telefon', () => T('Telefonen som fjernkontroll, uten TeamViewer.', 'The phone as a remote, without TeamViewer.')],
    lokalOverlay: ['kabel', () => T('Rett på kabelen, i samme nett som enheten.', 'Straight on the cable, in the same network as the device.')],
    cmpOverlay: ['sammenlign', () => T('To enheter ved siden av hverandre, og alt de er uenige om.', 'Two devices side by side, and everything they disagree on.')],
    colsOverlay: ['kolonner', () => T('Vis det du bruker, skjul resten.', 'Show what you use, hide the rest.')],
    diagOverlay: ['adresse', () => T('Når du vet IP-en men enheten ikke svarer.', 'When you know the IP and the device does not answer.')],
    edeOverlay: ['skjema', () => T('Prosjektert punktliste mot det som faktisk svarer.', 'The designed point list against what actually answers.')],
    raportOverlay: ['rapport', () => T('Det du fant, klart til å sendes videre.', 'What you found, ready to pass on.')],
    schOverlay: ['kalender', () => T('Ukeprogram og unntak, slik enheten har dem.', 'Weekly schedule and exceptions, as the device has them.')],
    temaOverlay: ['innstillinger', () => T('Slik du vil ha NABE.', 'The way you want NABE.')],
    satOverlay: ['sjekk', () => T('Igangkjøring, punkt for punkt, med kvittering.', 'Commissioning, point by point, with a receipt.')],
    besokOverlay: ['historie', () => T('Dette anlegget, slik det var sist du var her.', 'This plant, the way it was the last time you were here.')],
    oversiktOverlay: ['nett', () => T('Hele anlegget på én side.', 'The whole plant on one page.')],
    rapOverlay: ['rapport', () => T('Besøket, ført i pennen for deg.', 'The visit, written up for you.')],
  };

  function pynt(lag) {
    if (!lag || lag.classList.contains('dlg-lag')) return;
    const def = IDENT[lag.id];
    const modal = lag.querySelector('.gs-modal');
    const hode = modal && modal.querySelector('.gs-head');
    if (!def || !hode || modal.querySelector('.gs-under')) return;
    const tittel = hode.firstElementChild;
    if (tittel && !hode.querySelector('.gs-ikon')) {
      const ik = document.createElement('span');
      ik.className = 'gs-ikon';
      ik.innerHTML = IKON[def[0]] || '';
      hode.insertBefore(ik, hode.firstChild);
    }
    const under = document.createElement('div');
    under.className = 'gs-under';
    under.textContent = def[1]();
    hode.after(under);
  }

  function ettersyn(lag) {
    pynt(lag);
    if (lag._pyntet) return;
    lag._pyntet = true;
    // Direkte barn bare: overlegg som tegner seg på nytt bytter ut hele skallet, ikke bit for bit.
    new MutationObserver(() => pynt(lag)).observe(lag, {childList: true});
  }

  document.querySelectorAll('.gs-overlay').forEach(ettersyn);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.classList && n.classList.contains('gs-overlay')) ettersyn(n); });
  }).observe(document.body, {childList: true});

  window.nabePopup = {pynt, ikoner: Object.keys(IKON), ident: () => Object.keys(IDENT)};
})();
