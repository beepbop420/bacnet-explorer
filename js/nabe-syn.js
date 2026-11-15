/* NABE - colour vision and mood, in Settings.

   Colour vision: status is carried by colour in a lot of places, and for red-green
   colour blindness alarm, fault and warning come out as nearly the same brown. Three
   palettes that stay apart (red-green, blue-yellow, high contrast), and shapes beside
   the colours (▲ alarm, ◆ fault, ● overridden) so nothing depends on colour alone.
   The palettes are CSS, switched by an attribute on the root element; the same
   attribute is set early from a small script in the head, so there is no flash.

   Mood: how much NABE and NABO say of their own accord. Quiet keeps only what is
   useful, Normal is how they have always been, Chaos adds the odd remark when nothing
   has happened for a while. */
'use strict';

(function synOgHumor() {
  const FARGER = ['normal', 'rg', 'by', 'kontrast'];
  const farger = () => ({
    normal: T('Normal', 'Normal'),
    rg: T('Rød-grønn', 'Red-green'),
    by: T('Blå-gul', 'Blue-yellow'),
    kontrast: T('Høy kontrast', 'High contrast'),
  });
  const HUMOR = ['stille', 'normal', 'kaos'];
  const humor = () => ({stille: T('Stille', 'Quiet'), normal: T('Normal', 'Normal'), kaos: T('Kaos', 'Chaos')});

  const fargesyn = () => { const v = loadPrefs().fargesyn; return FARGER.includes(v) ? v : 'normal'; };
  const humorNiva = () => { const v = loadPrefs().humor; return HUMOR.includes(v) ? v : 'normal'; };
  // Shapes follow the palette unless they were switched on or off by hand.
  const formerPaa = () => { const f = loadPrefs().former; return typeof f === 'boolean' ? f : fargesyn() !== 'normal'; };

  function bruk() {
    const rot = document.documentElement;
    if (fargesyn() === 'normal') rot.removeAttribute('data-fargesyn'); else rot.setAttribute('data-fargesyn', fargesyn());
    if (formerPaa()) rot.setAttribute('data-former', ''); else rot.removeAttribute('data-former');
  }

  /* The two rows are built here rather than written into index.html, so their text
     is in both languages from the start. */
  function bygg() {
    const side = document.getElementById('settOppsett');
    if (!side || document.getElementById('fargesynBtn')) return;
    const gruppe = (tittel, html) => { const g = document.createElement('div'); g.className = 'sett-gruppe'; g.innerHTML = `<div class="tema-tittel">${tittel}</div>${html}`; return g; };
    const rad = (id, navn, liten, bryter) => `<button id="${id}" class="sett-rad${bryter ? ' bryter' : ''}"${bryter ? ' role="switch"' : ''}>${navn}
        <small>${liten}</small><span id="${id.replace('Btn', 'State')}" class="menu-state"></span></button>`;
    const syn = gruppe(T('Fargesyn', 'Colour vision'),
      rad('fargesynBtn', T('Fargesyn', 'Colour vision'), T('Farger som holder seg adskilt også ved rød-grønn og blå-gul fargeblindhet', 'Colours that stay apart for red-green and blue-yellow colour blindness'))
      + rad('formerBtn', T('Former i tillegg til farge', 'Shapes as well as colour'), T('▲ alarm, ◆ feil, ● overstyrt, ved siden av fargen. Følger fargesyn til du velger selv', '▲ alarm, ◆ fault, ● overridden, next to the colour. Follows colour vision until you choose'), true)
      + `<div class="syn-prov" id="synProv" aria-hidden="true"></div>`);
    const hum = gruppe(T('NABE og NABO', 'NABE and NABO'),
      rad('humorBtn', T('Humørnivå', 'Mood'), T('Stille: bare det som hjelper. Normal: som vanlig. Kaos: også en og annen bemerkning når det er stille', 'Quiet: only what helps. Normal: as usual. Chaos: the odd remark when it is quiet too')));
    const skriving = [...side.querySelectorAll('.sett-gruppe')].find(g => g.querySelector('#roBtn'));
    if (skriving) { skriving.before(syn); skriving.before(hum); } else { side.append(syn, hum); }
    document.getElementById('fargesynBtn').onclick = () => {
      const neste = FARGER[(FARGER.indexOf(fargesyn()) + 1) % FARGER.length];
      savePrefs({fargesyn: neste});
      bruk(); synk();
      toast(T(`Fargesyn: ${farger()[neste]}`, `Colour vision: ${farger()[neste]}`));
    };
    document.getElementById('formerBtn').onclick = () => {
      savePrefs({former: !formerPaa()});
      bruk(); synk();
    };
    document.getElementById('humorBtn').onclick = () => {
      const neste = HUMOR[(HUMOR.indexOf(humorNiva()) + 1) % HUMOR.length];
      savePrefs({humor: neste});
      synk();
      toast(T(`Humørnivå: ${humor()[neste]}`, `Mood: ${humor()[neste]}`));
    };
  }

  function synk() {
    bygg();
    const f = document.getElementById('fargesynState');
    if (f) f.textContent = farger()[fargesyn()];
    document.getElementById('fargesynBtn')?.classList.toggle('on', fargesyn() !== 'normal');
    const s = document.getElementById('formerState');
    if (s) s.textContent = formerPaa() ? T('på', 'on') : T('av', 'off');
    document.getElementById('formerBtn')?.classList.toggle('on', formerPaa());
    const h = document.getElementById('humorState');
    if (h) h.textContent = humor()[humorNiva()];
    // What the colours look like right now, with the real classes, so the choice is seen and not guessed.
    const prov = document.getElementById('synProv');
    if (prov) prov.innerHTML = `<em class="dev-st bad">${T('alarm', 'alarm')}</em><em class="dev-st feil">${T('feil', 'fault')}</em><em class="dev-st warn">${T('overstyrt', 'overridden')}</em><em class="dev-st syn-ok">${T('normal', 'normal')}</em>`;
  }

  bruk();
  etter('syncMenuStates', synk);
  synk();
  window.nabeSyn = {fargesyn, humorNiva, formerPaa};
})();
