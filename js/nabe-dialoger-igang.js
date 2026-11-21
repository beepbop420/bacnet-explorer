/* NABE and NABO - commissioning: plugged straight in, and the phone on the cabinet.

   Same format and same voice as nabe-dialoger-innhold.js, added to the same tables.
   These are the moments a technician actually has: calling down a cable, borrowing an
   address, handing the phone the keys. Dry, short, and true about the trade. */
'use strict';

Object.assign(DIA_INNHOLD, {

  // ------------------------------------------------------- plugged straight in
  lokalFinn: {pause: 60000, kans: 0.6, l: [
    'Jeg ser etter noen å snakke med på kabelen. | I am looking for someone to talk to on the cable.',
    'Roper ned i kabelen. Noen må være hjemme. | Calling down the cable. Someone has to be home.',
    'Who-Is ut av hvert kort. Kabelen er alt vi har. | Who-Is out of every adapter. The cable is all we have.',
    'Jeg lytter i tre sekunder. Det er lenger enn de fleste regulatorer trenger. | I listen for three seconds. That is longer than most controllers need.',
    'O: broadcast uten ruter. som å rope i en tunnel | broadcast without a router. like shouting into a tunnel',
    'O: lytter. ingen dhcp, ingen unnskyldninger | listening. no dhcp, no excuses',
  ]},

  lokalFant: {pause: 60000, kans: 0.9, l: [
    'Der var du. Du står bare i feil nett. | There you are. You are just in the wrong network.',
    'Funnet. Du og regulatoren bor i hvert deres nabolag. Jeg flytter deg. | Found. You and the controller live in different neighbourhoods. I will move you.',
    'En regulator i et annet nett. Klassisk. | A controller in another network. Classic.',
    'O: 169.254 er ikke en adresse. det er en unnskyldning | 169.254 is not an address. it is an excuse',
    ['N: Fant en enhet utenfor nettet ditt. | Found a device outside your network.', 'O: foreslå en ip | suggest an ip', 'N: .200. Den er alltid ledig. Nesten. | .200. It is always free. Almost.'],
    {hvis: c => c.husket, e: 'Her har vi vært før. Jeg husket adressen, noe anleggsdokumentasjonen aldri gjør. | We have been here before. I remembered the address, which the plant documentation never does.'},
  ]},

  lokalIngen: {pause: 60000, kans: 0.9, l: [
    'Ingenting på kabelen. Sitter den i, og lyser porten? | Nothing on the cable. Is it plugged in, and is the port light on?',
    'Stille. Jeg skylder ikke på BACnet før vi har sjekket kabelen. | Silent. I am not blaming BACnet until we have checked the cable.',
    'Ingen svarte. Skriv IP-en du vet at den har, så regner jeg derfra. | Nobody answered. Type the IP you know it has and I will work from there.',
    'Enten sitter ikke kabelen, eller så har Windows meninger om kringkasting. | Either the cable is not in, or Windows has opinions about broadcasts.',
    'O: link-lys: av. dette er en kabel, ikke et nettverk | link light: off. this is a cable, not a network',
  ]},

  lokalSatt: {pause: 30000, kans: 1, l: [
    'IP satt. Jeg husker den, så du slipper å lete i innstillinger neste gang. | IP set. I will remember it, so you can skip the settings next time.',
    'Nå er du i riktig nett. Resten er dine problemer. | Now you are in the right network. The rest is your problem.',
    'Satt, og skrevet ned. Jeg er mer pålitelig enn en lapp på tavla. | Set, and written down. I am more reliable than a note on the cabinet.',
    'O: ip ok. husk å sette den tilbake | ip ok. remember to put it back',
    'O: statisk ip. som i 2004 | static ip. like it is 2004',
  ]},

  lokalTilbake: {pause: 30000, kans: 1, l: [
    'Tilbake på automatisk. Windows og jeg er venner igjen. | Back on automatic. Windows and I are friends again.',
    'Kortet er ryddet. Den som bruker PC-en etter deg skylder deg en kaffe. | The adapter is tidied up. Whoever uses this PC after you owes you a coffee.',
    'Du fikk låne adressen. Nå er den levert tilbake. | You were allowed to borrow the address. Now it is returned.',
    'O: dhcp. endelig | dhcp. finally',
  ]},

  // ----------------------------------------------------------- the phone
  mobilPaa: {pause: 60000, kans: 1, l: [
    'Mobiltilgang på. Nå kan du gå til tavla uten å bære PC-en med. | Mobile access on. Now you can walk to the cabinet without carrying the PC.',
    'Telefonen får en kode. Ikke send den på SMS til kunden. | The phone gets a code. Do not text it to the customer.',
    'Døra står på gløtt. Jeg holder øye med den. | The door is ajar. I am keeping an eye on it.',
    'Ingen VPN, ingen TeamViewer, bare en telefon og en tavle. | No VPN, no TeamViewer, just a phone and a cabinet.',
    'O: port åpen. jeg logger alt | port open. i log everything',
    ['N: Mobil på. | Mobile on.', 'O: ingen teamviewer? | no teamviewer?', 'N: Ingen teamviewer. | No teamviewer.'],
  ]},

  mobilKoblet: {pause: 60000, kans: 1, l: [
    'Telefonen er inne. Gå og se på tavla, jeg passer PC-en. | The phone is in. Go and look at the cabinet, I will mind the PC.',
    'Tilkoblet. Du slipper å gå tilbake til PC-en for å trykke på noe. | Connected. You no longer have to walk back to the PC to press something.',
    'Velkommen, telefon. Oppfør deg. | Welcome, phone. Behave.',
    'O: ny økt. jeg skriver alt ned | new session. i write everything down',
  ]},

  mobilSkrivPaa: {pause: 60000, kans: 1, l: [
    'Telefonen får skrive. Alt den setter slippes av seg selv. Jeg stoler på deg, men ikke på dekningen i kjelleren. | The phone may write. Everything it sets is released by itself. I trust you, but not the coverage in the basement.',
    'Skriving fra mobil på. Grensen er prioritet 8, og klokka går fra første trykk. | Writing from mobile on. The limit is priority 8, and the clock starts at the first press.',
    'O: skriving på. ikke tving noe du ikke vil slippe | writing on. do not force anything you do not want to release',
  ]},

  mobilBrannmur: {pause: 60000, kans: 1, l: [
    'Brannmuren slipper inn det lokale nettet og ingen andre. | The firewall lets in the local network and nobody else.',
    'Åpnet for nettet du står i. Internett må fortsatt banke på. | Opened for the network you are standing in. The internet still has to knock.',
  ]},

  mobilAv: {pause: 60000, kans: 1, l: [
    'Mobiltilgang av. Døra er låst igjen. | Mobile access off. The door is locked again.',
    'Av. Koden din er verdiløs nå, som en gammel Wi-Fi-kode på en kafé. | Off. Your code is worthless now, like an old Wi-Fi code in a café.',
    'O: port lukket | port closed',
  ]},

  hotspotPaa: {pause: 60000, kans: 1, l: [
    'Hotspot på. PC-en har fått sitt eget lille nett, uten at noen måtte bla i innstillinger. | Hotspot on. The PC has its own little network, without anyone paging through settings.',
    'Nett oppe. Skann den første koden, så er telefonen med. | Network up. Scan the first code and the phone is in.',
    'Windows startet hotspot uten å klage. Det skjer sjelden nok til å nevnes. | Windows started the hotspot without complaining. That happens rarely enough to be worth mentioning.',
    'O: ap oppe. passordet ligger i qr-koden, ikke i hodet ditt | ap up. the password is in the qr code, not in your head',
  ]},

  hotspotAv: {pause: 60000, kans: 1, l: [
    'Hotspot av. Nettet forsvant, og med det alle spørsmål om passordet. | Hotspot off. The network is gone, and with it every question about the password.',
    'Av. Wi-Fi-kortet er ditt igjen. | Off. The Wi-Fi adapter is yours again.',
    'O: ap nede | ap down',
  ]},

  // Kommentarene under en bekreftelse. Brukes av nabeDialog, uten pause og sjanse: den velger selv.
  popupSkriv: {pause: 1000, kans: 1, l: [
    'Anlegget merker dette. Det gjør ikke jeg. | The plant will notice this. I will not.',
    'Jeg har sett verre. Ikke mye verre. | I have seen worse. Not much worse.',
    'Dette skrives på ekte. Det er ingen øvelse. | This is written for real. It is not a drill.',
    'Mål to ganger, skriv en gang. | Measure twice, write once.',
    'Hvis noe svinger etterpå, var det ikke meg. | If something starts swinging afterwards, it was not me.',
    'O: write. det finnes ingen angrefunksjon på en pumpe | write. there is no undo on a pump',
    'O: du kan alltid frigi. det er veien tilbake | you can always release. it is the way back',
  ]},

  popupFrigi: {pause: 1000, kans: 1, l: [
    'Anlegget får styre selv igjen. Det klarer vanligvis det. | The plant gets to run itself again. It usually manages.',
    'Slipper taket. Ingen får æren for det som skjer videre. | Letting go. Nobody gets credit for what happens next.',
    'Ryddig. Slik skulle alle besøk sluttet. | Tidy. This is how every visit should end.',
    'O: null til prioriteten. tilbake til default | null to the priority. back to default',
  ]},

  popupSlett: {pause: 1000, kans: 1, l: [
    'Dette kan ikke angres. Jeg sier bare det. | This cannot be undone. I am just saying.',
    'Borte er borte. Det finnes ingen papirkurv i en regulator. | Gone is gone. There is no recycle bin in a controller.',
    'O: rm uten -i | rm without -i',
  ]},

  mobilPar: {pause: 30000, kans: 1, l: [
    'Husket. Neste gang trenger du hverken kode eller kamera. | Remembered. Next time you need neither code nor camera.',
    'Jeg kjenner den igjen nå. Telefonen din har fått et ansikt i NABE. | I recognise it now. Your phone has a face in NABE.',
    'Koble til hotspotet, så er du inne. Det er hele ritualet. | Join the hotspot and you are in. That is the whole ritual.',
    'O: mac lagret. spoofer du den, spoofer du den på hotspotet også | mac stored. if you spoof it, you spoof it on the hotspot too',
  ]},

  mobilAutoAv: {pause: 60000, kans: 1, l: [
    'Mobiltilgang slo seg av. Fire timer er lenge å stå åpen. | Mobile access turned itself off. Four hours is a long time to stand open.',
    'Jeg lukket mobilporten. Du glemte den, det gjør alle. | I closed the mobile port. You forgot it, everyone does.',
    'O: timeout. god ting | timeout. good thing',
  ]},
});
