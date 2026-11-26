/* NABE - mobiltilgang, siden på PC-en.

   På en igangkjøring er det sjelden VPN, og PC-en står langt fra tavla. Her slår du
   på en egen port som telefonen kan nå på PC-ens hotspot eller samme nett, og
   styrer hva telefonen får lov til. Selve mobilsiden er nabe_mobil.html.
   Alt som skrives fra telefonen slippes av seg selv etter høyst N minutter, og
   skriving er av til du slår den på her. Se nabe_mobil.py. */
'use strict';

(function () {
  const MB = {data: null, timer: null, opptatt: false, egenAv: false};
  const dia = (navn, c) => { try { if (typeof nabeDia === 'function') nabeDia(navn, c || {}); } catch { /* en replikk er aldri verdt en feil */ } };

  async function post(sti, body) {
    try { return await api(sti, body || {}); } catch (e) { return {status: 'error', error: e.message}; }
  }

  async function hent() {
    try {
      const r = await fetch('/api/mobil', {cache: 'no-store'});
      if (r.ok) {
        const for_ = MB.data;
        MB.data = await r.json();
        if (for_) { MB.data.hotspotVenter = for_.hotspotVenter; MB.data.hotspotFeil = for_.hotspotFeil; }
        if (for_ && for_.paa && !MB.data.paa && !MB.egenAv) dia('mobilAutoAv');
        if (for_ && !(for_.okter || []).length && (MB.data.okter || []).length) dia('mobilKoblet');
      }
    } catch { return; }
    tegn();
  }

  function min(s) { return Math.max(0, Math.round(s / 60)); }

  /* Test oppsettet: kabel, port, brannmur, hotspot og telefonoppslag, hver med hva du kan gjøre.
     Tilstand står med symbol og ord (✓ ▲ ✕ –), aldri med farge alene. */
  const MERKE = {ok: '✓', merk: '!', feil: '✕', ukjent: '–'};
  const FIKS = {start: ['start', 'Slå på', 'Turn on'], brannmur: ['brannmur', 'Åpne', 'Open'], hotspot: ['hotspot-paa', 'Slå på', 'Turn on'], lokal: ['lokal', 'Koble direkte', 'Connect directly'], lokk: ['lokk', 'Åpne', 'Open']};

  /* Tre veier inn, hver med sin veiviser. Hovedveien er at telefonen deler nettet sitt til PC-en: det trenger ingenting
     installert. Tailscale er reserven. Stegene hakes av etter det NABE selv ser, så man vet hvor det stopper. */
  const METODER = () => [['telefon', T('Telefonens nett', 'Phone network'), T('anbefalt', 'recommended')], ['tailscale', 'Tailscale', T('reserve', 'backup')], ['annet', T('Andre veier', 'Other ways'), '']];
  const VEINAVN = () => ({wifi: 'Wi-Fi', bluetooth: 'Bluetooth', usb: T('USB-kabel', 'USB cable')});
  function metodeAv(d) {
    if (MB.metode) return MB.metode;
    let husket = '';
    try { husket = localStorage.getItem('nabe.mobilVei') || ''; } catch { /* privat vindu */ }
    const adr = d.adresser || [];
    if (adr.some(a => a.type === 'delt')) return 'telefon';
    if ((d.okter || []).some(o => o.vei === 'tailscale')) return 'tailscale';
    return ['telefon', 'tailscale', 'annet'].includes(husket) ? husket : 'telefon';
  }
  const steg = (nr, ferdig, tittel, inn, aktiv) => `<li class="mb-steg${ferdig ? ' ok' : ''}${aktiv ? ' naa' : ''}"><span class="mb-nr" aria-hidden="true">${ferdig ? '✓' : nr}</span>
    <div class="mb-stegt"><b>${tittel}</b>${ferdig ? `<span class="skjult-sr"> (${T('gjort', 'done')})</span>` : ''}${inn || ''}</div></li>`;
  /* Stegene tegnes etter tur: det første som ikke er gjort er «her er du», og bare det viser alt innholdet sitt. */
  function stegliste(liste) {
    const forste = liste.findIndex(x => !x.ferdig);
    return `<ol class="mb-stegliste">${liste.map((x, i) => steg(i + 1, x.ferdig, x.tittel, i === forste || x.alltid ? x.inn : (x.ferdig ? x.kort || '' : ''), i === forste)).join('')}</ol>`;
  }
  const tekst = (t) => `<p class="mb-hjelp">${t}</p>`;
  const knapper = (...k) => `<div class="lk-handling">${k.join('')}</div>`;
  const knapp = (data, t, primaer) => `<button type="button" class="btn${primaer ? ' primary' : ''}" ${data}>${t}</button>`;

  function brannmurSteg(d) {
    const offentlig = d.wifi_profil && d.wifi_profil.kat === 'Public';
    return {ferdig: d.brannmur === true, tittel: T('Slipp telefonen gjennom brannmuren', 'Let the phone through the firewall'),
      kort: '', inn: d.brannmur === false
        ? tekst(T('Gjøres én gang på hver PC. Windows spør om administrator. Har du ikke det, kopier teksten og send den til IT.', 'Done once on each PC. Windows asks for an administrator. Without one, copy the text and send it to IT.')
          + (offentlig ? ' ' + T('Nettet er satt som offentlig, så uten regelen kommer ingen inn.', 'The network is set as public, so without the rule nobody gets in.') : ''))
          + knapper(knapp('data-mb="brannmur"', T('Åpne i brannmuren', 'Open in the firewall'), true), knapp('data-mb="it-tekst"', T('Kopier til IT', 'Copy for IT')))
        : tekst(T('Sjekker brannmuren …', 'Checking the firewall …'))};
  }
  function kodeBlokk(d) {
    return `<div class="mb-kodelinje"><span class="lk-dempet">${T('Får du ikke skannet? Skriv koden', 'Cannot scan? Type the code')}</span>
      ${d.kode ? `<span class="mb-kode liten">${esc(d.kode)}</span><span class="lk-dempet">${T('gyldig i ' + min(d.kode_rest_s) + ' min', 'valid for ' + min(d.kode_rest_s) + ' min')}</span>` : `<span class="lk-dempet">${T('Koden er utløpt.', 'The code has expired.')}</span>`}
      ${knapp('data-mb="kode"', T('Ny kode', 'New code'))}</div>`;
  }
  /* Skann og husk er de samme stegene for alle veiene. */
  function skannOgHusk(d, vei, klar) {
    const adr = (d.adresser || []).filter(a => a.type === vei);
    const inne = (d.okter || []).find(o => o.vei === vei);
    const nadd = d.nadd && d.nadd[vei] !== undefined;
    const skann = {ferdig: !!inne, tittel: T('Skann med kameraet på telefonen', 'Scan with the camera on the phone'),
      kort: inne ? tekst(`${esc(inne.navn)} ${T('er inne', 'is in')}`) : '',
      inn: !klar || !adr.length ? tekst(T('QR-koden kommer her når stegene over er gjort.', 'The QR code appears here when the steps above are done.'))
        : (lagQr(d, adr) || '') + `<div class="mb-urlrad"><span class="mb-url">${esc(adr[0].url)}</span></div>` + kodeBlokk(d)
          + (nadd ? `<div class="mb-tlf paa">${T('Telefonen når PC-en. Mangler bare innlogging.', 'The phone reaches the PC. Only sign-in is left.')}</div>`
            : tekst(T('Åpner siden seg ikke, har telefonen ikke nådd PC-en ennå. Se «Får du ikke kontakt?» under.', 'If the page does not open, the phone has not reached the PC yet. See “No contact?” below.')))};
    const husk = {ferdig: !!(inne && inne.par), tittel: T('Husk telefonen', 'Remember the phone'),
      kort: inne && inne.par ? tekst(T('Neste gang kommer den inn uten kode.', 'Next time it gets in without a code.')) : '',
      inn: inne ? tekst(T('Da slipper den inn uten kode neste gang, også på et nytt nett.', 'Then it gets in without a code next time, on a new network too.'))
        + knapper(knapp(`data-mb="par" data-id="${esc(inne.id)}"`, T('Husk ', 'Remember ') + esc(inne.navn), true)) : tekst(T('Når telefonen er inne.', 'When the phone is in.'))};
    return [skann, husk];
  }
  const feilsok = (linjer) => `<details class="mb-feilsok"${MB.feilsokAapen ? ' open' : ''}><summary>${T('Får du ikke kontakt?', 'No contact?')}</summary><ul>${linjer.map(l => `<li>${l}</li>`).join('')}</ul></details>`;

  function telefonVei(d) {
    const delt = (d.adresser || []).filter(a => a.type === 'delt');
    const koblet = delt[0];
    const hvordan = MB.kobl || 'wifi';
    const HJELP = {
      wifi: T('Trykk knappen, velg navnet på telefonen i lista og skriv passordet som står på telefonen. Enklest.', 'Press the button, choose the phone’s name in the list and type the password shown on the phone. Easiest.'),
      bluetooth: T('Bruk denne når PC-ens Wi-Fi trengs til anlegget. Par telefonen under Bluetooth. Velg så telefonen under «Enheter og skrivere», høyreklikk, «Koble til via», «Tilgangspunkt».', 'Use this when the PC’s Wi-Fi is needed for the plant. Pair the phone under Bluetooth. Then in “Devices and Printers”, right-click the phone, “Connect using”, “Access point”.'),
      usb: T('Sett kabelen i. Android: slå på «USB-internettdeling». iPhone: velg «Stol på» på telefonen. iPhone over USB trenger Apples driver, som ikke finnes på alle PC-er. Bruk da Wi-Fi.', 'Plug in the cable. Android: turn on “USB tethering”. iPhone: choose “Trust” on the phone. iPhone over USB needs Apple’s driver, which not every PC has. Use Wi-Fi then.'),
    };
    const velg = `<div class="mb-veier" role="group">${['wifi', 'bluetooth', 'usb'].map(k => `<button type="button" data-mb="kobl" data-kobl="${k}" class="${hvordan === k ? 'sel' : ''}" aria-pressed="${hvordan === k}">${VEINAVN()[k]}</button>`).join('')}</div>`;
    const liste = [
      {ferdig: !!koblet, tittel: T('Slå på internettdeling på telefonen', 'Turn on the hotspot on the phone'),
        inn: tekst(T('iPhone: Innstillinger, «Delt internett» (Personal Hotspot), slå på «Tillat andre å koble til». La skjermen stå til PC-en er koblet til.', 'iPhone: Settings, Personal Hotspot, turn on “Allow Others to Join”. Leave that screen open until the PC has joined.'))
          + tekst(T('Android: Innstillinger, Nettverk, «Wi-Fi-sone» eller «Internettdeling».', 'Android: Settings, Network, “Hotspot & tethering”.'))},
      {ferdig: !!koblet, alltid: !koblet, tittel: T('Koble PC-en til telefonen', 'Join the PC to the phone'),
        kort: koblet ? tekst(`${T('Koblet til med', 'Joined with')} ${VEINAVN()[koblet.vei] || ''} · <span class="lk-mono">${esc(koblet.ip)}</span>`) : '',
        inn: velg + tekst(HJELP[hvordan]) + knapper(
          hvordan === 'wifi' ? knapp('data-mb="apne" data-hva="wifi"', T('Vis Wi-Fi-nettene', 'Show the Wi-Fi networks'), true)
            : hvordan === 'bluetooth' ? knapp('data-mb="apne" data-hva="bluetooth"', T('Åpne Bluetooth', 'Open Bluetooth'), true) + knapp('data-mb="apne" data-hva="pan"', T('Enheter og skrivere', 'Devices and Printers')) : '')
          + tekst(T('Steget hakes av når PC-en er koblet til.', 'The step ticks off when the PC has joined.'))},
      brannmurSteg(d), ...skannOgHusk(d, 'delt', !!koblet && d.brannmur !== false),
    ];
    return (d.utenom && koblet ? `<div class="lk-feil" style="color:var(--warn)">! ${T('Et VPN på PC-en tar trafikken til telefonen. Koble fra VPN-et mens telefonen brukes, eller be IT slå på tilgang til lokalt nett.', 'A VPN on the PC takes the traffic to the phone. Disconnect it while using the phone, or ask IT to enable local network access.')}</div>` : '')
      + tekst(T('Telefonen deler nettet sitt til PC-en. Ingenting må installeres, og det virker uansett hvor dere er. PC-en bruker da telefonens mobildata til internett.', 'The phone shares its network with the PC. Nothing needs installing, and it works wherever you are. The PC then uses the phone’s mobile data for internet.'))
      + stegliste(liste) + feilsok([
        T('Skru av VPN på telefonen mens du bruker NABE.', 'Turn off any VPN on the phone while using NABE.'),
        T('iPhone: slå på «Maksimer kompatibilitet» under Delt internett hvis PC-en ikke finner nettet.', 'iPhone: turn on “Maximise Compatibility” under Personal Hotspot if the PC cannot find the network.'),
        T('Står PC-en på VPN mot anlegget og telefonen ikke når inn, koble fra et øyeblikk for å se om det er årsaken.', 'If the PC is on a VPN to the plant and the phone cannot get in, disconnect for a moment to see whether that is the cause.'),
        d.fast ? `${T('Fast adresse som kan legges på hjemskjermen:', 'Fixed address you can add to the home screen:')} <span class="lk-mono">${esc(d.fast)}</span>` : '',
        T('Virker det fortsatt ikke: «Test oppsettet» nederst sier hva som mangler.', 'Still nothing: “Check the setup” at the bottom says what is missing.'),
      ].filter(Boolean));
  }

  function tailscaleVei(d) {
    const ts = d.tailscale;
    if (!ts) return tekst(T('Sjekker Tailscale …', 'Checking Tailscale …'));
    const tlf = ts.telefoner || [], paa = tlf.find(x => x.paa);
    const liste = [
      {ferdig: !!ts.installert, tittel: T('Installer Tailscale på PC-en', 'Install Tailscale on the PC'),
        inn: tekst(T('Krever administrator. Avklar med IT først.', 'Needs an administrator. Check with IT first.')) + knapper(knapp('data-mb="apne" data-hva="tailscale-last"', T('Åpne nedlastingssiden', 'Open the download page'), true))},
      {ferdig: !!ts.paa, tittel: T('Logg inn på PC-en med din egen konto', 'Sign in on the PC with your own account'),
        kort: ts.konto ? tekst(`${T('Innlogget som', 'Signed in as')} <b>${esc(ts.konto)}</b>. ${T('Er det ikke deg, logg ut og inn med din egen.', 'If that is not you, sign out and in with your own.')}`) : '',
        inn: tekst(T('Klikk Tailscale-ikonet nede ved klokka og logg inn. Bruk din egen konto, ikke en kollegas: hver konto er sitt eget private nett.', 'Click the Tailscale icon by the clock and sign in. Use your own account, not a colleague’s: each account is its own private network.'))},
      {ferdig: !!(ts.paa && tlf.length), tittel: T('Installer Tailscale på telefonen, samme konto', 'Install Tailscale on the phone, same account'),
        kort: tlf.length ? tekst(tlf.map(x => esc(x.navn)).join(', ')) : '',
        inn: tekst(T('Hent «Tailscale» i App Store eller Google Play og logg inn med nøyaktig samme konto som på PC-en.', 'Get “Tailscale” from the App Store or Google Play and sign in with exactly the same account as on the PC.'))},
      {ferdig: !!paa, tittel: T('Slå på Tailscale på telefonen', 'Turn on Tailscale on the phone'),
        kort: paa ? tekst(`${esc(paa.navn)} ${T('er på', 'is on')} · ${paa.direkte ? T('direkte', 'direct') : T('via relé, litt tregere', 'via a relay, a little slower')}`) : '',
        inn: tekst(T('Åpne appen og slå på bryteren. iPhone kan bare ha én VPN på om gangen, så jobbens VPN må være av imens.', 'Open the app and flip the switch. An iPhone can only run one VPN at a time, so the work VPN has to be off meanwhile.'))},
      brannmurSteg(d), ...skannOgHusk(d, 'tailscale', !!(ts.paa && (d.adresser || []).some(a => a.type === 'tailscale'))),
    ];
    // Tailscale slipper selv inn på sitt eget nett på de fleste PC-er: brannmuren vises bare når noe faktisk stopper
    if (d.brannmur === false && d.nadd && d.nadd.tailscale !== undefined) liste[4].ferdig = true;
    return tekst(T('Reserven når telefonen ikke kan dele nett. Må installeres på PC og telefon. Gratisplanen til Tailscale gjelder bare privat bruk, så avklar med arbeidsgiver.', 'The backup for when the phone cannot share its network. Has to be installed on PC and phone. Tailscale’s free plan is for personal use only, so check with your employer.'))
      + stegliste(liste)
      + knapper(knapp('data-mb="ki-tekst"', T('Kopier hjelpetekst til en KI', 'Copy a help prompt for an AI')))
      + feilsok([
        T('Flere VPN på PC-en går fint samtidig så lenge de ikke bruker de samme adressene. Et VPN som tar all trafikk kan likevel stenge ute Tailscale: koble det fra og prøv.', 'Several VPNs can run at once on the PC as long as they do not use the same addresses. A VPN that takes all traffic can still shut Tailscale out: disconnect it and try.'),
        T('På telefonen kan bare én VPN være på om gangen.', 'On the phone only one VPN can be on at a time.'),
        T('Begge må ha internett (mobildata holder).', 'Both need internet (mobile data is enough).'),
      ]);
  }

  function annenVei(d) {
    const andre = (d.adresser || []).filter(a => a.type === 'hotspot' || a.type === 'lan');
    const vei = andre.some(a => a.type === 'hotspot') ? 'hotspot' : 'lan';
    const adr = andre.filter(a => a.type === vei);
    const hotspot = d.hotspot && d.hotspot.paa
      ? `<div class="lk-rad"><span>${T('Hotspot er på', 'Hotspot is on')}: <b>${esc(d.hotspot.ssid || '')}</b></span><span class="lk-dempet">${T('passord', 'password')} <span class="lk-mono">${esc(d.hotspot.passord || '')}</span></span></div>` + knapper(`<button class="btn" data-mb="hotspot-av"${d.hotspotVenter ? ' disabled' : ''}>${d.hotspotVenter ? T('Slår av…', 'Turning off…') : T('Slå av hotspot', 'Turn off hotspot')}</button>`)
      : (d.hotspot_sperret ? `<div class="lk-feil" style="color:var(--warn)">! ${T('Hotspot er sperret på denne PC-en (IT-regler). Bruk telefonens nett i stedet.', 'The hotspot is blocked on this PC (IT rules). Use the phone network instead.')}</div>`
        : knapper(`<button class="btn" data-mb="hotspot-paa"${d.hotspotVenter ? ' disabled' : ''}>${d.hotspotVenter ? T('Starter hotspot…', 'Starting hotspot…') : T('Slå på hotspot på PC-en', 'Turn on the PC hotspot')}</button>`, knapp('data-mb="hotspot"', T('Innstillinger', 'Settings'))) + (d.hotspotFeil ? `<div class="lk-feil">${esc(d.hotspotFeil)}</div>` : ''));
    return tekst(T('Samme Wi-Fi som PC-en, eller hotspot fra PC-en der det er lov. Mange bedriftsnett og gjestenett skjuler enhetene for hverandre.', 'The same Wi-Fi as the PC, or a hotspot from the PC where allowed. Many company and guest networks hide devices from each other.'))
      + hotspot + stegliste([brannmurSteg(d), ...skannOgHusk(d, vei, !!adr.length && d.brannmur !== false)]);
  }

  function veiviser(d) {
    const m = metodeAv(d);
    const faner = `<div class="mb-metoder" role="tablist">${METODER().map(([k, t, u]) => `<button type="button" role="tab" data-mb="metode" data-metode="${k}" class="${m === k ? 'sel' : ''}" aria-selected="${m === k}">${esc(t)}${u ? `<small>${esc(u)}</small>` : ''}</button>`).join('')}</div>`;
    return faner + (m === 'tailscale' ? tailscaleVei(d) : m === 'annet' ? annenVei(d) : telefonVei(d))
      + (d.vaken ? tekst(T('PC-en holdes våken så lenge mobiltilgangen er på.', 'The PC is kept awake while mobile access is on.')) : '');
  }

  /* Tekst til IT om brannmurregelen, og en ferdig bestilling til en KI om Tailscale. Ingen navn eller adresser tas med. */
  const itTekst = (d) => T(
    `Hei. Jeg trenger en brannmurregel på PC-en min så telefonen kan nå NABE (feilsøkingsverktøy) på lokalt nett. Kjør dette i PowerShell som administrator:\n\nNew-NetFirewallRule -DisplayName 'NABE mobil' -Direction Inbound -Protocol TCP -LocalPort ${d.port} -Action Allow -RemoteAddress LocalSubnet,100.64.0.0/10 -Profile Any\n\nRegelen gjelder bare lokalt nett (og Tailscale) og bare port ${d.port}. Programmet lytter bare mens jeg har slått mobiltilgang på, og krever engangskode.`,
    `Hi. I need a firewall rule on my PC so my phone can reach NABE (a troubleshooting tool) on the local network. Please run this in PowerShell as administrator:\n\nNew-NetFirewallRule -DisplayName 'NABE mobil' -Direction Inbound -Protocol TCP -LocalPort ${d.port} -Action Allow -RemoteAddress LocalSubnet,100.64.0.0/10 -Profile Any\n\nThe rule covers only the local network (and Tailscale) and only port ${d.port}. The program only listens while I have mobile access turned on, and requires a one-time code.`);
  function kiTekst(d) {
    const ts = d.tailscale || {}, tlf = ts.telefoner || [];
    const ja = (v) => v ? T('ja', 'yes') : T('nei', 'no');
    return T(
      `Hjelp meg å koble telefonen min til programmet NABE på jobb-PC-en over Tailscale. Ta ett steg om gangen og vent på svar fra meg før neste.\n\nStatus akkurat nå (lest av programmet):\n- PC: Windows 11\n- Tailscale installert på PC: ${ja(ts.installert)}\n- Pålogget og på: ${ja(ts.paa)}\n- Telefoner i samme Tailscale-nett: ${tlf.length} (på nå: ${ja(tlf.some(x => x.paa))})\n- Brannmurregel for programmet: ${d.brannmur === true ? 'ja' : d.brannmur === false ? 'nei' : 'ukjent'}\n- Telefonen har nådd PC-en over Tailscale: ${ja(d.nadd && d.nadd.tailscale !== undefined)}\n\nKrav: Jeg skal bruke min egen Tailscale-konto, ikke en kollegas, og samme konto på PC og telefon. Minn meg på å avklare med arbeidsgiver (gratisplanen gjelder bare privat bruk). En iPhone kan bare ha én VPN på om gangen. Ikke be om passord eller koder. Når alt er på, åpner jeg adressen programmet viser (http://<PC-ens Tailscale-adresse>:${d.port}) på telefonen og skriver engangskoden.`,
      `Help me connect my phone to the program NABE on my work PC over Tailscale. Take one step at a time and wait for my answer before the next.\n\nStatus right now (read by the program):\n- PC: Windows 11\n- Tailscale installed on PC: ${ja(ts.installert)}\n- Signed in and on: ${ja(ts.paa)}\n- Phones in the same Tailscale network: ${tlf.length} (on now: ${ja(tlf.some(x => x.paa))})\n- Firewall rule for the program: ${d.brannmur === true ? 'yes' : d.brannmur === false ? 'no' : 'unknown'}\n- The phone has reached the PC over Tailscale: ${ja(d.nadd && d.nadd.tailscale !== undefined)}\n\nRequirements: I will use my own Tailscale account, not a colleague’s, and the same account on PC and phone. Remind me to check with my employer (the free plan is for personal use only). An iPhone can only run one VPN at a time. Do not ask for passwords or codes. When everything is on, I open the address the program shows (http://<the PC’s Tailscale address>:${d.port}) on the phone and type the one-time code.`);
  }

  const nb = (par) => (Array.isArray(par) ? T(par[0], par[1]) : '');

  function sjekkHtml() {
    const tittel = `<div class="lk-etikett">${T('Test oppsettet', 'Check the setup')}</div>`;
    if (MB.sjekker) return `<div class="lk-blokk">${tittel}<div class="lk-dempet">${T('Sjekker kabel, port, brannmur og hotspot…', 'Checking cable, port, firewall and hotspot…')}</div></div>`;
    const s = MB.sjekk;
    if (!s) return '';
    const sm = s.sammendrag || {};
    const bra = sm.ok || 0, tot = (s.sjekk || []).length;
    const rader = (s.sjekk || []).map(r => {
      const f = FIKS[r.fiks];
      return `<div class="mb-sj ${esc(r.status)}"><span class="mk" aria-hidden="true">${MERKE[r.status] || '–'}</span>
        <span><b>${esc(nb(r.tittel))}</b>${r.detalj && r.detalj[0] ? `<span class="lk-dempet"> ${esc(nb(r.detalj))}</span>` : ''}</span>
        ${f ? `<button class="btn" data-mb="${f[0]}">${T(f[1], f[2])}</button>` : '<span></span>'}</div>`;
    }).join('');
    return `<div class="lk-blokk">${tittel}<div class="lk-dempet">${T(`${bra} av ${tot} i orden`, `${bra} of ${tot} in order`)}${sm.feil ? T(`, ${sm.feil} feil`, `, ${sm.feil} failed`) : ''}${sm.merk ? T(`, ${sm.merk} å se på`, `, ${sm.merk} to look at`) : ''}</div>
      <div class="mb-sjliste">${rader}</div>
      <div class="lk-handling"><button class="btn" data-mb="sjekk">${T('Test på nytt', 'Check again')}</button><button class="btn" data-mb="sjekk-kopier">${T('Kopier som melding', 'Copy as a message')}</button></div></div>`;
  }

  async function kjorSjekk() {
    MB.sjekker = true;
    tegn();
    const r = await post('/api/mobil/sjekk');
    MB.sjekk = r.status === 'done' ? r : null;
    MB.sjekker = false;
    if (lag0()) lag0().dataset.n = '';
    tegn();
  }
  const lag0 = () => $('mobilOverlay');

  function sjekkTekst() {
    const s = MB.sjekk;
    if (!s) return '';
    return 'NABE, oppsett ' + new Date().toLocaleString() + '\n' + (s.sjekk || []).map(r => `${MERKE[r.status] || '-'} ${nb(r.tittel)}${r.detalj && r.detalj[0] ? ' - ' + nb(r.detalj) : ''}`).join('\n');
  }

  /* Loggen: hva telefonen gjorde, med navn på telefonen. Ligger i en fil, så den overlever at porten slås av. */
  function loggLinjer() {
    const l = MB.loggFull || (MB.data && MB.data.logg) || [];
    return MB.loggAapen ? l : l.slice(0, 6);
  }
  const loggTid = (t) => new Date(t * 1000).toTimeString().slice(0, 8);
  function loggHtml() {
    const alle = MB.loggFull || (MB.data && MB.data.logg) || [];
    if (!alle.length) return '';
    return `<div class="lk-blokk"><div class="lk-etikett">${T('Logg', 'Log')}</div>
      ${loggLinjer().map(l => `<div class="lk-dempet">${loggTid(l.t)} · ${l.navn ? esc(l.navn) + ' · ' : ''}${esc(l.tekst)}</div>`).join('')}
      <div class="lk-handling"><button class="btn" data-mb="logg-mer">${MB.loggAapen ? T('Færre', 'Fewer') : T('Vis alt', 'Show all')}</button>
        <button class="btn" data-mb="logg-kopier">${T('Kopier', 'Copy')}</button><button class="btn" data-mb="logg-csv">${T('Last ned', 'Download')}</button>
        <button class="btn" data-mb="logg-tom">${T('Tøm', 'Clear')}</button></div></div>`;
  }
  function loggCsv(l) {
    const c = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    return ['tid;telefon;ip;type;enhet;punkt;verdi;ok;tekst'].concat(l.slice().reverse().map(r =>
      [new Date(r.t * 1000).toLocaleString(), r.navn, r.ip, r.type, r.enhet, r.punkt, r.verdi, r.ok === undefined ? '' : (r.ok ? 'ja' : 'nei'), r.tekst].map(c).join(';'))).join('\n');
  }

  /* Skann med kameraet: Wi-Fi først når hotspot er på, deretter siden med koden i adressen.
     Koden i adressen logger telefonen inn med en gang, så ingenting skal skrives. */
  function lagQr(d, adr) {
    if (!window.nabeQr || !adr.length || !d.kode) return '';
    const fig = (svg, tekst, klasse) => `<figure class="mb-qr-fig${klasse ? ' ' + klasse : ''}">${svg}<figcaption>${tekst}</figcaption></figure>`;
    const hs = d.hotspot && d.hotspot.paa && d.hotspot.ssid ? d.hotspot : null;
    const koblet = !!(d.okter && d.okter.length);
    const paaWifi = hs && (hs.klienter || 0) > 0;
    const ut = [];
    let tekst = '';
    try {
      const side = nabeQr.svg(adr[0].url + '/m?k=' + d.kode, {px: paaWifi ? 190 : 150, label: 'NABE'});
      if (adr[0].type !== 'hotspot' && adr[0].type !== 'lan') {
        // Tailscale og telefonens nett trenger ikke noe Wi-Fi å bli med i først: bare siden
        return `<div class="mb-qr">${fig(side, T('Skann med kameraet', 'Scan with the camera'))}</div>`;
      }
      if (hs && !paaWifi && !koblet) {
        // Steg 1: telefonen er ikke på hotspotet ennå. Koden for Wi-Fi først, siden som neste.
        ut.push(fig(nabeQr.svg(nabeQr.wifi(hs.ssid, hs.passord), {px: 170, label: 'Wi-Fi'}), T('1. Koble til ', '1. Join ') + esc(hs.ssid)));
        ut.push(fig(side, T('2. Så denne', '2. Then this'), 'neste'));
        tekst = T('Skann den første, så den andre. Én kode kan ikke gjøre begge deler.', 'Scan the first, then the second. One code cannot do both.');
      } else if (hs && paaWifi && !koblet) {
        // Steg 2: telefonen er på Wi-Fi. Da er det bare siden som mangler.
        ut.push(fig(side, T('Telefonen er på Wi-Fi. Skann denne nå', 'The phone is on the Wi-Fi. Scan this now')));
      } else {
        ut.push(fig(side, hs ? T('Skann for å åpne NABE', 'Scan to open NABE') : T('Samme Wi-Fi som PC-en, skann med kameraet', 'Same Wi-Fi as the PC, scan with the camera')));
      }
    } catch { return ''; }
    return `<div class="mb-qr">${ut.join('')}</div>${tekst ? `<div class="lk-dempet" style="margin:-4px 0 10px">${tekst}</div>` : ''}`;
  }

  function tegn() {
    const lag = $('mobilOverlay');
    if (!lag || lag.hidden) return;
    const d = MB.data || {};
    // Keep what you are typing: only redraw when the data actually changed.
    const nokkel = JSON.stringify([d.tailscale, d.vaken, MB.metode, MB.kobl, d.nadd && Object.keys(d.nadd), d.utenom, d.fast, d.paa, d.kode, d.skriv, d.maks_min, d.okter, d.adresser, d.brannmur, d.hotspot, d.hotspotVenter, d.hotspotFeil, d.par, (d.logg || [])[0], d.okter && d.okter.length, MB.sjekk, MB.sjekker, MB.loggAapen, (MB.loggFull || []).length]);
    if (lag.dataset.n === nokkel && lag.querySelector('.lk-modal')) return;
    lag.dataset.n = nokkel;
    let inn;
    if (!d.paa) {
      inn = `<p class="lk-ingress">${T('Styr testen fra telefonen i stedet for å fjernstyre PC-en. Telefonen kobler til NABE her på PC-en, uten TeamViewer.',
        'Run the test from the phone instead of remote-controlling the PC. The phone connects to NABE on this PC, without TeamViewer.')}</p>
        <div class="lk-blokk"><div class="lk-etikett">${T('Slik virker det', 'How it works')}</div>
        <ul class="lk-grunner">
          <li>${T('Telefonen deler nettet sitt til PC-en og åpner en adresse. Ingenting å installere. Samme Wi-Fi virker også, og Tailscale er reserven.', 'The phone shares its network with the PC and opens an address. Nothing to install. The same Wi-Fi works too, and Tailscale is the backup.')}</li>
          <li>${T('Du skriver en engangskode som vises her. Koden og tilgangen utløper av seg selv.', 'You type a one-time code shown here. The code and the access expire by themselves.')}</li>
          <li>${T('Skriving er av til du slår den på. Alt telefonen setter slippes av seg selv.', 'Writing is off until you turn it on. Everything the phone sets is released by itself.')}</li>
        </ul></div>
        <div class="lk-handling"><button class="btn primary" data-mb="start">${T('Slå på mobiltilgang', 'Turn on mobile access')}</button>
          <button class="btn" data-mb="sjekk">${T('Test oppsettet', 'Check the setup')}</button></div>
        ${sjekkHtml()}
        ${d.feil ? `<div class="lk-feil">${esc(d.feil)}</div>` : ''}`;
    } else {
      const koblet = (d.okter || []).length ? `<div class="mb-ok"><span aria-hidden="true">✓</span>${T('Telefonen er inne', 'The phone is in')}: ${esc(d.okter[0].navn)} <span class="lk-dempet">${esc(d.okter[0].ip)}</span></div>` : '';
      inn = `${koblet}<div class="lk-blokk">${veiviser(d)}</div>
        <div class="lk-blokk"><div class="lk-etikett">${T('Hva telefonen får lov til', 'What the phone may do')}</div>
          <label class="mb-valg"><input type="checkbox" data-mb="skriv" ${d.skriv ? 'checked' : ''}> <span>${T('Tillat skriving fra mobil', 'Allow writing from the phone')}</span></label>
          <label class="mb-valg"><span>${T('Slipp alt automatisk etter', 'Release everything after')}</span>
            <select data-mb="maks">${[5, 10, 15, 30, 60].map(m => `<option value="${m}"${m === d.maks_min ? ' selected' : ''}>${m} min</option>`).join('')}</select></label>
          <div class="lk-liten">${T('Prioritet 8 eller svakere. Telefonen kan alltid slippe. Fra PC-en ser du alt under Overstyrt.', 'Priority 8 or weaker. The phone can always release. From the PC you see everything under Overridden.')}</div></div>
        ${(d.okter || []).length ? `<div class="lk-blokk"><div class="lk-etikett">${T('Tilkoblet', 'Connected')}</div>${d.okter.map(o => `<div class="lk-rad"><span>${esc(o.navn)} <span class="lk-dempet">${esc(o.ip)}</span></span>
          <span class="lk-hale">${o.par ? `<span class="lk-dempet">${T('husket', 'remembered')}</span>` : (o.kan_pare ? `<button class="btn" data-mb="par" data-id="${esc(o.id)}" title="${o.tailscale ? T('Gjenkjennes over Tailscale neste gang, uten kode', 'Recognised over Tailscale next time, without a code') : T('Gjenkjennes neste gang, uten kode', 'Recognised next time, without a code')}">${T('Husk', 'Remember')}</button>` : '')}
          <button class="btn" data-mb="kast" data-id="${esc(o.id)}">${T('Kast ut', 'Disconnect')}</button></span></div>`).join('')}</div>` : ''}
        ${(d.par && d.par.liste.length) || (d.okter || []).some(o => o.kan_pare) ? `<div class="lk-blokk"><div class="lk-etikett">${T('Husket', 'Remembered')}</div>
          ${(d.par.liste || []).map(e => `<div class="lk-rad"><span>${esc(e.navn)} <span class="lk-dempet lk-mono">${esc(e.mac)}</span>${e.tilkoblet ? ' <span class="lk-dempet">· ' + T('tilkoblet', 'connected') + '</span>' : ''}</span>
            <button class="btn" data-mb="par-glem" data-id="${esc(e.id)}">${T('Glem', 'Forget')}</button></div>`).join('') || `<div class="lk-dempet">${T('Ingen ennå. Trykk Husk ved en tilkoblet telefon.', 'None yet. Press Remember next to a connected phone.')}</div>`}
          <div class="lk-liten">${T('En husket telefon logges inn av seg selv på telefonens delte nett, PC-ens hotspot og Tailscale. Ingen kode og ingen QR. Skriving styres fortsatt herfra.', 'A remembered phone is signed in by itself on the phone’s shared network, the PC hotspot and Tailscale. No code and no QR. Writing is still controlled from here.')}</div>
          <label class="mb-valg"><input type="checkbox" data-mb="par-lan" ${d.par.lan ? 'checked' : ''}> <span>${T('Også på vanlig Wi-Fi (mindre trygt)', 'Also on regular Wi-Fi (less safe)')}</span></label></div>` : ''}
        ${sjekkHtml() || `<div class="lk-handling"><button class="btn" data-mb="sjekk">${T('Test oppsettet', 'Check the setup')}</button></div>`}
        ${loggHtml()}
        <div class="lk-handling"><button class="btn" data-mb="stopp">${T('Slå av mobiltilgang', 'Turn off mobile access')}</button></div>
        <div class="lk-liten">${T('Mobiltilgangen slås av automatisk om ' + Math.floor(d.av_rest_s / 3600) + ' t ' + (Math.floor(d.av_rest_s / 60) % 60) + ' min.', 'Turns itself off in ' + Math.floor(d.av_rest_s / 3600) + ' h ' + (Math.floor(d.av_rest_s / 60) % 60) + ' min.')}</div>`;
    }
    const rullet = lag.querySelector('.lk-innhold')?.scrollTop || 0;
    lag.innerHTML = `<div class="gs-modal lk-modal">
      <div class="gs-head"><span class="lk-tittel">${T('Mobil', 'Mobile')}</span>
        <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="lk-innhold">${inn}</div></div>`;
    const ru = lag.querySelector('.lk-innhold');
    if (ru) ru.scrollTop = rullet;
  }

  async function klikk(e) {
    const lag = $('mobilOverlay');
    if (e.target === lag || e.target.closest('.gs-close')) { lukk(); return; }
    const b = e.target.closest('[data-mb]');
    if (!b || b.type === 'checkbox' || b.tagName === 'SELECT') return;
    const k = b.dataset.mb;
    if (MB.opptatt) return;
    MB.opptatt = true;
    try {
      let r;
      if (k === 'start') { r = await post('/api/mobil/start'); if (r && r.paa) { MB.egenAv = false; dia('mobilPaa'); meldAktiv(); } }
      else if (k === 'stopp') { MB.egenAv = true; r = await post('/api/mobil/stopp'); dia('mobilAv'); }
      else if (k === 'kode') r = await post('/api/mobil/ny-kode');
      else if (k === 'hotspot-paa' || k === 'hotspot-av') {
        const paa = k === 'hotspot-paa';
        const d0 = MB.data || {};
        if (paa && d0.wifi_klient && !await nabeBekreft(T(`PC-en er koblet til Wi-Fi (${d0.wifi_klient}). Windows kan måtte flytte hotspot til samme kanal og kutte den tilkoblingen en liten stund. Fortsette?`,
            `This PC is connected to Wi-Fi (${d0.wifi_klient}). Windows may have to move the hotspot to the same channel and drop that connection for a moment. Continue?`))) { r = null; }
        else {
          MB.data = Object.assign({}, d0, {hotspotVenter: true, hotspotFeil: null});
          tegn();
          const h = await post(paa ? '/api/mobil/hotspot/paa' : '/api/mobil/hotspot/av');
          if (h.status === 'done' && h.mobil) { MB.data = h.mobil; dia(paa ? 'hotspotPaa' : 'hotspotAv'); }
          else MB.data = Object.assign({}, MB.data, {hotspotVenter: false, hotspotFeil: h.error || T('Noe gikk galt.', 'Something went wrong.')});
          r = null;
        }
      }
      else if (k === 'par') { r = await post('/api/mobil/par', {id: b.dataset.id}); if (r.status === 'error') { toast(r.error); r = null; } else dia('mobilPar'); }
      else if (k === 'par-glem') r = await post('/api/mobil/par/glem', {id: b.dataset.id});
      else if (k === 'kast') r = await post('/api/mobil/kast', {id: b.dataset.id});
      else if (k === 'sjekk') { MB.opptatt = false; await kjorSjekk(); return; }
      else if (k === 'sjekk-kopier') {
        try { await navigator.clipboard.writeText(sjekkTekst()); toast(T('Kopiert. Lim den inn i en melding.', 'Copied. Paste it into a message.')); } catch { toast(T('Kunne ikke kopiere', 'Could not copy')); }
        r = null;
      }
      else if (k === 'metode') { MB.metode = b.dataset.metode; try { localStorage.setItem('nabe.mobilVei', MB.metode); } catch { /* privat vindu */ } r = null; }
      else if (k === 'kobl') { MB.kobl = b.dataset.kobl; r = null; }
      else if (k === 'apne') { r = await post('/api/mobil/apne', {hva: b.dataset.hva}); if (r.status === 'done') r = null; }
      else if (k === 'it-tekst' || k === 'ki-tekst') {
        const t_ = k === 'it-tekst' ? itTekst(MB.data || {}) : kiTekst(MB.data || {});
        try { await navigator.clipboard.writeText(t_); toast(k === 'it-tekst' ? T('Kopiert. Send den til IT.', 'Copied. Send it to IT.') : T('Kopiert. Lim den inn i KI-en du bruker.', 'Copied. Paste it into the AI you use.')); } catch { toast(T('Kunne ikke kopiere', 'Could not copy'), true); }
        r = null;
      }
      else if (k === 'lokk') r = await post('/api/mobil/lokk');
      else if (k === 'lokal') { if (window.nabeLokal) { lukk(); window.nabeLokal.apne(); } r = null; }
      else if (k === 'logg-mer') {
        MB.loggAapen = !MB.loggAapen;
        if (MB.loggAapen) { const j = await fetch('/api/mobil/logg', {cache: 'no-store'}).then(x => x.json()).catch(() => null); if (j && j.logg) MB.loggFull = j.logg; }
        r = null;
      }
      else if (k === 'logg-kopier' || k === 'logg-csv') {
        const j = await fetch('/api/mobil/logg', {cache: 'no-store'}).then(x => x.json()).catch(() => null);
        const l = (j && j.logg) || [];
        if (k === 'logg-csv') downloadText(loggCsv(l), 'nabe-mobil-logg.csv');
        else { try { await navigator.clipboard.writeText(l.slice().reverse().map(x => `${new Date(x.t * 1000).toLocaleString()} ${x.navn ? x.navn + ' ' : ''}${x.tekst}`).join('\n')); toast(T('Loggen er kopiert', 'The log is copied')); } catch { toast(T('Kunne ikke kopiere', 'Could not copy')); } }
        r = null;
      }
      else if (k === 'logg-tom') {
        if (await nabeBekreft(T('Tømme loggen over hva telefonen har gjort? Det kan ikke angres.', 'Clear the log of what the phone has done? This cannot be undone.'))) { await post('/api/mobil/logg/tom'); MB.loggFull = null; MB.loggAapen = false; }
        r = null;
      }
      else if (k === 'hotspot') r = await post('/api/mobil/hotspot');
      else if (k === 'brannmur') { r = await post('/api/mobil/brannmur'); if (r.status === 'avbrutt') toast(r.error); else if (r.paa !== undefined) dia('mobilBrannmur'); }
      if (r && r.status === 'error') { MB.data = Object.assign({}, MB.data, {feil: r.error}); }
      else if (r && r.paa !== undefined) MB.data = r;
    } finally { MB.opptatt = false; }
    // Etter et tiltak fra sjekklisten sier listen fra seg selv om det ble bra.
    if (MB.sjekk && ['start', 'brannmur', 'hotspot-paa', 'hotspot-av', 'stopp'].includes(k)) await kjorSjekk();
    if (lag) lag.dataset.n = '';
    tegn();
  }

  async function endre(e) {
    const el = e.target.closest('[data-mb]');
    if (!el) return;
    if (el.dataset.mb === 'skriv') {
      if (el.checked && !await nabeBekreft(T('Slå på skriving fra mobil? Telefonen kan da sette verdier i anlegget (prioritet 8, slippes automatisk).', 'Allow writing from the phone? The phone can then set values in the plant (priority 8, released automatically).'))) { el.checked = false; return; }
      MB.data = await post('/api/mobil/skriv', {tillat: el.checked});
      if (el.checked) dia('mobilSkrivPaa');
    } else if (el.dataset.mb === 'par-lan') {
      MB.data = await post('/api/mobil/par/lan', {tillat: el.checked});
    } else if (el.dataset.mb === 'maks') {
      MB.data = await post('/api/mobil/maks', {min: +el.value});
    }
    tegn();
  }

  function lukk() {
    const lag = $('mobilOverlay');
    if (lag) lag.hidden = true;
    clearInterval(MB.timer);
  }

  window.aapneMobil = function () {
    let lag = $('mobilOverlay');
    if (!lag) {
      lag = document.createElement('div');
      lag.id = 'mobilOverlay';
      lag.className = 'gs-overlay';
      lag.setAttribute('role', 'dialog');
      lag.setAttribute('aria-modal', 'true');
      document.body.appendChild(lag);
      lag.addEventListener('click', klikk);
      lag.addEventListener('change', endre);
      lag.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('mb-feilsok')) MB.feilsokAapen = e.target.open; }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lukk(); e.stopPropagation(); } }, true);
    }
    lag.hidden = false;
    lag.dataset.n = '';
    MB.metode = '';
    hent();
    clearInterval(MB.timer);
    MB.timer = setInterval(hent, 2000);
  };

  /* Enheten du har åpen på PC-en tilbys øverst på telefonen: velg her, gå til tavla, og den ligger klar. */
  function meldAktiv() {
    const d = S.activeDev;
    if (d) post('/api/mobil/aktiv', {address: d.address, device_instance: Number.isInteger(d.device_instance) ? d.device_instance : null, navn: d.object_name || ''});
  }
  if (typeof etter === 'function') etter('selectDevice', () => setTimeout(meldAktiv, 250));

  if ($('mobilBtn')) $('mobilBtn').onclick = () => { closeMenus(); window.aapneMobil(); };
  if ($('mobilTopBtn')) $('mobilTopBtn').onclick = () => window.aapneMobil();
})();
