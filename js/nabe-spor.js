/* NABE - ask NABE. Answers from what NABE has already read and from a small
   glossary of the trade. Runs on this PC: nothing leaves it, it works on a
   closed plant network, and it only knows what it is listed here to know, so
   it says so instead of guessing. Opened from the palette or by clicking
   the little NABE on a leash (Garderobe > Peker > Spør NABE). */
'use strict';

(function sporNabe() {
  const ORD = [
    [/prioritet|priority/, 'Prioritet', 'BACnet har 16 prioriteter for skriving, der 1 er sterkest. Høyeste aktive vinner. Operatører bruker gjerne 8. Det du setter, står til du frigir det.', 'BACnet has 16 write priorities, 1 being strongest. The highest active one wins. Operators usually use 8. What you set stays until you release it.'],
    [/relinquish/, 'Relinquish default', 'Verdien punktet faller tilbake på når ingen prioritet er satt.', 'The value a point falls back to when no priority is set.'],
    [/\bcov\b/, 'COV', 'Change of value: regulatoren sier fra selv når verdien endrer seg, i stedet for at noen spør hele tiden.', 'Change of value: the controller reports by itself when the value changes, instead of being asked all the time.'],
    [/\bbbmd\b/, 'BBMD', 'Sender BACnet-kringkasting videre mellom IP-nett. Uten den når ikke Who-Is forbi en ruter. På et anlegg er det ofte JACE-en.', 'Forwards BACnet broadcasts between IP networks. Without it Who-Is stops at a router. On a site it is often the JACE.'],
    [/ms\/?tp/, 'MS/TP', 'BACnet over RS-485, altså tvunnet par mellom regulatorene. Du når dem gjennom en ruter.', 'BACnet over RS-485, twisted pair between the controllers. You reach them through a router.'],
    [/who-?is|i-?am\b/, 'Who-Is', 'Spørsmålet «hvem er der?». Enhetene svarer med I-Am og forteller instansnummeret sitt.', 'The question “who is there?”. Devices answer with I-Am and give their instance number.'],
    [/\bede\b/, 'EDE', 'Engineering Data Exchange: et regnearkformat for å utveksle punktlister mellom verktøy.', 'Engineering Data Exchange: a spreadsheet format for passing point lists between tools.'],
    [/out.of.service|ute av drift/, 'Out of service', 'Punktet er koblet fra den fysiske verdien, og present value kan settes for hånd.', 'The point is cut off from the physical value, and present value can be set by hand.'],
    [/instans|instance/, 'Instans', 'Enhetens nummer på BACnet-nettet. Det må være unikt på hele nettet, ellers svarer feil enhet.', 'The device’s number on the BACnet network. It has to be unique on the whole network, or the wrong device answers.'],
    [/47808|bac0/, 'Port 47808', 'Standardporten for BACnet/IP, BAC0 i heksadesimal. Bare ett program på PC-en kan binde den om gangen.', 'The default BACnet/IP port, BAC0 in hexadecimal. Only one program on the PC can bind it at a time.'],
    [/tfm/, 'TFM', 'Tverrfaglig merkesystem: navnestrukturen som sier hvilket system og hvilken komponent et punkt hører til.', 'The Norwegian tagging system: the name structure that says which system and component a point belongs to.'],
    [/present.?value/, 'Present value', 'Verdien punktet har akkurat nå. Det er den du leser og skriver.', 'The value the point has right now. That is the one you read and write.'],
  ];
  const FORSLAG = [['Hva er overstyrt?', 'What is overridden?'], ['Er noe i alarm?', 'Is anything in alarm?'], ['Hvor mange punkter?', 'How many points?'], ['Hva betyr prioritet 8?', 'What does priority 8 mean?'], ['Finn RT401', 'Find RT401']];

  const tittel = (o) => T(o[1], {Prioritet: 'Priority', Instans: 'Instance'}[o[1]] || o[1]);
  const alle = () => Object.entries(S.cache || {}).flatMap(([ip, pts]) => (pts || []).map(p => ({ip, p})));
  const enhet = (ip) => { const d = S.devices.find(x => x.address === ip); return (d && d.object_name) || ip; };
  const navn = (p) => p.name || p.object_name || p.objid;
  const lestAv = () => T(`av ${Object.keys(S.cache || {}).length} leste enheter`, `of ${Object.keys(S.cache || {}).length} devices read`);
  const liste = (treff, maks = 8) => `<div class="sp-liste">${treff.slice(0, maks).map(({ip, p}) =>
    `<button type="button" class="sp-rad" data-ip="${esc(ip)}" data-objid="${esc(p.objid)}"><b>${esc(navn(p))}</b><span>${esc(enhet(ip))}${p.value === undefined || p.value === null ? '' : ` · ${esc(String(p.value))}${p.unit_symbol ? ' ' + esc(p.unit_symbol) : ''}`}</span></button>`).join('')}</div>
    ${treff.length > maks ? `<p>${T(`…og ${treff.length - maks} til.`, `…and ${treff.length - maks} more.`)}</p>` : ''}`;
  const flagg = (f, nb, en) => {
    const t = alle().filter(({p}) => hasFlag(p, f));
    return t.length ? `<p>${T(`${t.length} ${nb} ${lestAv()}:`, `${t.length} ${en} ${lestAv()}:`)}</p>${liste(t)}`
                    : `<p>${T(`Ingen ${nb} ${lestAv()}.`, `None ${en} ${lestAv()}.`)}</p>`;
  };
  const sok = (ord) => {
    const o = ord.toLowerCase().split(/\s+/).filter(x => x.length > 1);
    return o.length ? alle().filter(({p}) => { const s = `${navn(p)} ${p.description || ''} ${p.objid}`.toLowerCase(); return o.every(w => s.includes(w)); }) : [];
  };

  async function svar(q) {
    const s = q.toLowerCase().trim();
    const forklar = /betyr|hva er|what is|what does|mean|forklar|explain/.test(s) && ORD.find(([r]) => r.test(s));
    if (forklar) return `<p><b>${esc(tittel(forklar))}.</b> ${esc(T(forklar[2], forklar[3]))}</p>`;
    if (/overstyr|override|manuell|manual/.test(s)) {
      let mine = [];
      try { mine = (await (await fetch('/api/mine')).json()).overstyrt || []; } catch {}
      return flagg('overridden', 'overstyrte', 'overridden')
        + (mine.length ? `<p>${T(`${mine.length} av dem har du satt selv, og de må frigis før du går.`, `${mine.length} of them you set yourself, and they need releasing before you leave.`)}</p>` : '');
    }
    if (/alarm/.test(s)) return flagg('in-alarm', 'i alarm', 'in alarm');
    if (/\bfeil\b|fault/.test(s)) return flagg('fault', 'med feil', 'with faults');
    if (/ute av drift|out.of.service/.test(s)) return flagg('out-of-service', 'ute av drift', 'out of service');
    if (/hvor mange|how many|antall/.test(s)) {
      const lest = Object.keys(S.cache || {}).length;
      return `<p>${T(`${S.devices.length} enheter, ${lest} av dem lest, med ${alle().length} punkter.`, `${S.devices.length} devices, ${lest} of them read, with ${alle().length} points.`)}</p>`;
    }
    if (/skrev|skrevet|skrivelogg|write log|wrote/.test(s)) {
      const l = ((await (await fetch('/api/writelog')).json()).entries || []).slice(0, 5);
      if (!l.length) return `<p>${T('Ingenting skrevet ennå.', 'Nothing written yet.')}</p>`;
      return `<p>${T('Det siste du skrev:', 'The last you wrote:')}</p><div class="sp-liste">${l.map(e => `<div class="sp-rad"><b>${esc(e.objid || '')}</b><span>${esc(String(e.address || ''))} · ${esc(String(e.value))}${e.priority ? ` · pri ${esc(String(e.priority))}` : ''}</span></div>`).join('')}</div>`;
    }
    if (/opptak|record/.test(s)) { lukk(); aapneOpptak(); return ''; }
    if (/svarer ikke|ikke svar|not respond|no answer|nede\b/.test(s))
      return `<p>${T('Sjekk først at du er på riktig nett og at ingen andre program holder port 47808. Så kan jeg teste adressen for deg.', 'First check you are on the right network and that nothing else holds port 47808. Then I can test the address for you.')}</p><button type="button" class="btn" data-spor-diag>${T('Sjekk en adresse', 'Check an address')}</button>`;
    if (/hjelp|help|hva kan du|what can you/.test(s))
      return `<p>${T('Jeg ser det NABE har lest: overstyrte punkter, alarmer, feil, antall, og hvor et punkt er. Jeg kan også forklare BACnet-ord og vise det du har skrevet. Alt skjer på denne PC-en.', 'I see what NABE has read: overridden points, alarms, faults, counts, and where a point is. I can also explain BACnet words and show what you have written. It all happens on this PC.')}</p>`;
    const ren = s.replace(/^(hvor er|finn|søk etter|søk|where is|find|search for|search|hva er verdien på|verdien på|what is the value of)\s+/, '').replace(/[?.!]+$/, '');
    const treff = sok(ren);
    if (treff.length) return `<p>${T(`${treff.length} treff ${lestAv()}:`, `${treff.length} hits ${lestAv()}:`)}</p>${liste(treff)}`;
    const ord = ORD.find(([r]) => r.test(s));
    if (ord) return `<p><b>${esc(tittel(ord))}.</b> ${esc(T(ord[2], ord[3]))}</p>`;
    return `<p>${T('Det vet jeg ikke. Jeg finner bare det NABE har lest, og ord jeg kan.', 'I do not know that. I only find what NABE has read, and words I know.')}</p>`;
  }

  let lag = null;
  function lukk() { if (lag) lag.hidden = true; }
  async function spor(q) {
    if (!q.trim()) return;
    const ut = lag.querySelector('.sp-svar');
    const kropp = await svar(q).catch(() => `<p>${T('Noe gikk galt der.', 'Something went wrong there.')}</p>`);
    if (kropp) ut.innerHTML = `<div class="sp-q">${esc(q)}</div>${kropp}`;
  }
  function aapne() {
    if (!lag) {
      lag = document.createElement('div');
      lag.id = 'sporNabe';
      lag.className = 'sp-panel';
      lag.setAttribute('role', 'dialog');
      document.body.append(lag);
      lag.addEventListener('click', async (e) => {
        if (e.target.closest('.gs-close')) return lukk();
        const f = e.target.closest('[data-forslag]');
        if (f) { lag.querySelector('input').value = f.dataset.forslag; return spor(f.dataset.forslag); }
        if (e.target.closest('[data-spor-diag]')) { lukk(); return $('diagBtn').click(); }
        const r = e.target.closest('button.sp-rad');
        if (r) { lukk(); await selectDevice(r.dataset.ip); await selectPoint(r.dataset.objid); }
      });
      // Typing here is not a shortcut for the table behind.
      lag.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') lukk();
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') spor(e.target.value);
      });
    }
    lag.innerHTML = `<div class="sp-topp"><span class="gd-tittel">${T('Spør NABE', 'Ask NABE')}</span><button class="gs-close"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <input class="field" type="text" placeholder="${esc(T('Spør om anlegget eller et BACnet-ord', 'Ask about the site or a BACnet word'))}" autocomplete="off" spellcheck="false">
      <div class="sp-svar"><div class="sp-forslag">${FORSLAG.map(([nb, en]) => `<button type="button" class="btn" data-forslag="${esc(T(nb, en))}">${esc(T(nb, en))}</button>`).join('')}</div></div>`;
    lag.hidden = false;
    lag.querySelector('input').focus();
  }
  window.aapneSpor = aapne;
  PK.fig.addEventListener('click', aapne);
})();
