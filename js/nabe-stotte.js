/* NABE - support package.

   What somebody else needs to look at a plant from afar, in one file: the devices, the service suggestions, the traffic
   log, the routers, the alarm history and how NABE is set up, with a few words on what the trouble is. You choose what goes
   in and see what is in it before it is sent. The file is made on this PC and shown in Explorer; NABE sends it nowhere.
   Passwords, keys and values written to a plant are never in it. */
'use strict';

(function stotte() {
  const lag = document.createElement('div');
  lag.id = 'stotteOverlay';
  lag.className = 'gs-overlay';
  lag.setAttribute('role', 'dialog');
  lag.setAttribute('aria-modal', 'true');
  lag.hidden = true;
  document.body.append(lag);

  const DELER = () => [
    ['enheter', T('Enhetslista', 'The device list'), T('Adresse, navn, leverandør, modell og antall feil per enhet', 'Address, name, vendor, model and the faults per device')],
    ['forslag', T('Forslag til service', 'Service suggestions'), T('Lista slik den står nå', 'The list as it stands now')],
    ['trafikk', T('Trafikkloggen', 'The traffic log'), T('De siste forespørslene og svarene, med tider og feilkoder', 'The latest requests and answers, with times and error codes')],
    ['rutere', T('Rutere og nett bak dem', 'Routers and the networks behind them'), T('Hvilke nett som ligger bak hvilken ruter', 'Which networks sit behind which router')],
    ['alarmer', T('Alarmhistorikk', 'Alarm history'), T('Hva som har stått i alarm og hvor ofte', 'What has stood in alarm and how often')],
    ['innstillinger', T('Valg i NABE', 'NABE settings'), T('Språk, versjon og noen enkle innstillinger', 'Language, version and a few plain settings')],
  ];
  const valgt = new Set(['enheter', 'forslag', 'trafikk', 'rutere', 'innstillinger']);

  const celle = (v) => { const x = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  function enhetsCsv() {
    const rader = [['adresse', 'instans', 'navn', 'protokoll', 'leverandor', 'modell', 'omrade', 'mac', 'punkter', 'feil', 'alarm', 'overstyrt', 'ute_av_drift']];
    for (const d of S.devices || []) {
      const pts = S.cache[d.address];
      const c = pts && typeof flagCounts === 'function' ? flagCounts(pts) : null;
      let lev = '';
      try { lev = (gruppeFor(d).label || ''); } catch { /* none */ }
      rader.push([d.address, d.device_instance ?? '', d.object_name || '', d.protocol || 'bacnet', lev, d.model_name || '', d._range || '', d.mac || '',
        pts ? pts.length : '', c ? c['fault'] || 0 : '', c ? c['in-alarm'] || 0 : '', c ? c['overridden'] || 0 : '', c ? c['out-of-service'] || 0 : '']);
    }
    return rader.map((r) => r.map(celle).join(';')).join('\r\n');
  }
  const KLIENT = ['flatMin', 'utenBevegelse', 'protBacnet', 'protModbus', 'protKnx', 'grenseLyd', 'anSkjult', 'tema'];
  function klient() {
    const p = (() => { try { return loadPrefs(); } catch { return {}; } })();
    const ut = {spraak: typeof SPRAAK !== 'undefined' ? SPRAAK : '', nabeVersjon: typeof NABE_VERSJON !== 'undefined' ? NABE_VERSJON : ''};
    for (const k of KLIENT) if (['boolean', 'number', 'string'].includes(typeof p[k])) ut[k] = p[k];
    return ut;
  }

  function tegn(res) {
    const n = (S.devices || []).length;
    if (res) {
      lag.innerHTML = `<div class="gs-modal sp-modal st-modal"><div class="gs-head"><span class="gd-tittel">${T('Støttepakke', 'Support package')}</span>
        <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
        <div class="sp-kropp"><p class="op-tekst">${T('Fila er laget. Den er ikke sendt noe sted.', 'The file is made. It has not been sent anywhere.')}</p>
          <div class="st-fil"><code>${esc(res.fil)}</code><span class="sp-meta">${Math.max(1, Math.round(res.bytes / 1024))} kB · ${res.innhold.length} ${T('filer', 'files')}: ${esc(res.innhold.join(', '))}</span></div>
          <div class="op-knapper"><button type="button" class="btn" data-st="kopier">${T('Kopier sti', 'Copy path')}</button>
            <button type="button" class="btn primary" data-st="vis">${T('Vis i Utforsker', 'Show in Explorer')}</button></div></div></div>`;
      lag._res = res;
      return;
    }
    lag.innerHTML = `<div class="gs-modal sp-modal st-modal"><div class="gs-head"><span class="gd-tittel">${T('Støttepakke', 'Support package')}</span>
      <button class="gs-close" style="margin-left:auto"><span class="lbl">${T('Lukk', 'Close')}</span> ✕</button></div>
      <div class="sp-kropp"><p class="op-tekst">${T('Samler det en annen trenger for å se på anlegget, i én fil. Du velger hva som er med. Ingenting sendes fra NABE.', 'Gathers what somebody else needs to look at the plant, in one file. You choose what goes in. Nothing is sent from NABE.')}</p>
        <div class="st-deler">${DELER().map(([k, t, f]) => `<label class="st-del"><input type="checkbox" data-del="${k}" ${valgt.has(k) ? 'checked' : ''}>
          <span><b>${esc(t)}${k === 'enheter' ? ` <span class="sp-meta">(${n})</span>` : ''}</b><span class="sp-meta">${esc(f)}</span></span></label>`).join('')}</div>
        <label class="st-merknad">${T('Hva er problemet? (valgfritt)', 'What is the problem? (optional)')}<textarea id="stMerknad" class="field" rows="3" maxlength="4000"></textarea></label>
        <div class="sp-meta">${T('Med: IP-adresser og navn på enheter og punkter. Ikke med: passord, nøkler og verdier som er skrevet til anlegget. Se gjennom fila før du sender den.', 'Included: IP addresses and the names of devices and points. Not included: passwords, keys and values written to a plant. Look through the file before you send it.')}</div>
        <div class="op-knapper"><button type="button" class="btn primary" data-st="lag" ${valgt.size ? '' : 'disabled'}>${T('Lag fil', 'Make the file')}</button></div></div></div>`;
  }

  async function lagFil(knapp) {
    knapp.disabled = true;
    const med = [...valgt];
    const kropp = {med, merknad: ($('stMerknad') || {}).value || '', klient: med.includes('innstillinger') ? klient() : {}};
    if (med.includes('enheter')) kropp.enheter = enhetsCsv();
    if (med.includes('forslag') && typeof window.forslagTekst === 'function') { try { kropp.forslag = await window.forslagTekst(); } catch { kropp.forslag = ''; } }
    if (med.includes('rutere')) kropp.rutere = {rutere: S.rutere || [], belastning: window.nabeNett ? window.nabeNett.ruterBelastning(S.rutere || [], S.devices || []) : null};
    if (med.includes('alarmer') && window.nabeAlarmhist) kropp.alarmer = window.nabeAlarmhist.eksport();
    const r = await api('/api/stotte', kropp);
    if (r.status !== 'done') { toast(r.error || T('Fikk ikke laget fila', 'Could not make the file'), true); knapp.disabled = false; return; }
    tegn(r);
  }

  lag.addEventListener('click', async (e) => {
    if (e.target === lag || e.target.closest('.gs-close')) { lag.hidden = true; return; }
    const b = e.target.closest('[data-st]');
    if (!b) return;
    if (b.dataset.st === 'lag') await lagFil(b);
    else if (b.dataset.st === 'vis') api('/api/vis-fil', {sti: lag._res.fil});
    else if (b.dataset.st === 'kopier') { try { await navigator.clipboard.writeText(lag._res.fil); toast(T('Kopiert', 'Copied')); } catch { toast(lag._res.fil); } }
  });
  lag.addEventListener('change', (e) => {
    const k = e.target.dataset && e.target.dataset.del;
    if (!k) return;
    if (e.target.checked) valgt.add(k); else valgt.delete(k);
    const knapp = lag.querySelector('[data-st="lag"]');
    if (knapp) knapp.disabled = !valgt.size;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lag.hidden) { lag.hidden = true; e.stopPropagation(); } }, true);

  window.aapneStotte = () => { tegn(); lag.hidden = false; };
  window.nabeStotte = {enhetsCsv, klient};
  if ($('stotteBtn')) $('stotteBtn').onclick = () => { closeMenus(); window.aapneStotte(); };
})();
