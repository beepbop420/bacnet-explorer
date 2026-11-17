/* NABE - the dictionaries behind the schematic.

   Only data. The interpreter in nabe-skjema.js reads a point's name and
   description against these lists and fills in what it can from each: a
   component code in the tag (RT40, JV401), a word in the description
   ("tilluft", "supply air"), the tail of the name (_SP, .Feil), and the BACnet
   object type when nothing else says it.

   To teach NABE a new habit of naming, add a line here. Earlier lines win, so
   the narrow word goes above the wide one ("filtervakt" before "trykk").

   Every pattern is tested on text that has been lower-cased and had æøå kept,
   so write them in lower case. */
'use strict';

const SKJEMA_ORDBOK = {

  /* Two-letter component codes (TFM and what Norwegian plants use around it). */
  KODE: {
    RT: 'temp', RP: 'trykk', RD: 'difftrykk', RF: 'mengde', RH: 'fukt', RM: 'fukt',
    RY: 'kvalitet', RQ: 'kvalitet', RB: 'bevegelse', RE: 'effekt', RN: 'nivaa',
    JV: 'vifte', JP: 'pumpe', JK: 'kompressor',
    SB: 'ventil', SC: 'ventil', SA: 'ventil', SM: 'stengeventil',
    SK: 'spjeld', KA: 'spjeld', SQ: 'vav', SV: 'vav',
    LX: 'gjenvinner', LV: 'varmebatteri', LK: 'kjolebatteri', LR: 'radiator', LB: 'varmebatteri',
    QD: 'filter', QT: 'frost', QF: 'filter',
    IK: 'varmepumpe', IE: 'elkjel', IV: 'system', IB: 'kjel', IF: 'fjernvarme',
    OE: 'energimaaler', OF: 'energimaaler', OM: 'energimaaler',
    XZ: 'system', OU: 'system', OS: 'system', XS: 'system', XO: 'system', DI: 'system',
    FO: 'omformer', UP: 'system', LZ: 'system', NT: 'tank', LI: 'varmekabel',
  },

  /* What a component is, said in words. Used when there is no code, and to
     correct a code that is used for several things (RY is both smoke and CO2). */
  TYPE: [
    [/filtervakt|filter\s*guard|filter alarm|filter/, 'filter'],
    [/røyk|royk|smoke|brannspjeld/, 'royk'],
    [/co2|luftkvalitet|air quality|voc/, 'co2'],
    [/frostvakt|frost\s*prot|frostfare|frost/, 'frost'],
    [/virkningsgrad|efficiency/, 'gjenvinner'],
    [/varmegjenvinn|gjenvinner|varmegj|heat\s*recovery|exchanger|\bexch|rotor|roterende|veksler luft/, 'gjenvinner'],
    [/varmebatteri|ettervarme|heating\s*coil|heat\s*coil|\bheater\b|\bheatcv|heating y\d/, 'varmebatteri'],
    [/kjølebatteri|kjolebatteri|cooling\s*coil|cool\s*coil|\bcooler\b|\bcoolcv/, 'kjolebatteri'],
    [/tilluftsvifte|avtrekksvifte|vifte|\bsaf\b|\beaf\b|\bfan\b|ventilator/, 'vifte'],
    [/sirkulasjonspumpe|sirk\.?\s*pumpe|pumpe|\bpump/, 'pumpe'],
    [/stengeventil|serviceventil|sperreventil|avstengningsventil|shut-?off|isolation valve|isolasjonsventil/, 'stengeventil'],
    [/ventilmotor|reguleringsventil|varmeventil|ventil(?!asjon)|\bvalve/, 'ventil'],
    [/spjeldmotor|spjeld|\bdamper/, 'spjeld'],
    [/varmepumpe|\bvp\d|heat\s*pump/, 'varmepumpe'],
    [/el\.?\s*kjele?|elkjel|electric\s*boiler/, 'elkjel'],
    [/akkutank|akkumulator|buffer\s*tank|tank/, 'tank'],
    [/varmeveksler|veksler|heat\s*exchanger/, 'veksler'],
    [/energimåler|energimaler|energy\s*meter|måler\b/, 'energimaaler'],
    [/difftrykk|diff\.?\s*trykk|differential\s*pressure/, 'difftrykk'],
    [/trykkgiver|trykk|pressure/, 'trykk'],
    [/luftmengde|mengde|gjennomstrømning|air\s*flow|airflow|\bflow\b/, 'mengde'],
    [/fukt|humidity/, 'fukt'],
    [/temperaturføler|tempgiver|temperatur|temp\b|temp\.|temperature/, 'temp'],
    [/bevegelse|tilstedeværelse|motion|presence|occupancy/, 'bevegelse'],
  ],

  /* Where in the plant it sits. Air first, then water. */
  STED: [
    // After the recovery unit on the extract side is the exhaust: both words in one text say so.
    [/(etter|efter|after)[^|]{0,22}(gjenvinn|gjv|vgv|vvx|veksler|rotor|recovery|exchanger|\bhru\b|wheel)[^|]{0,30}(avtrekk|extract|avkast|exhaust|fortluft)|(avtrekk|extract)[^|]{0,30}(etter|efter|after)[^|]{0,22}(gjenvinn|gjv|vgv|vvx|recovery|exchanger)/, 'avkast'],
    [/(etter|efter|after)\s*(varme)?\s*(gjenvinn|gjv|vgv|vvx|veksler|rotor|recovery|exchanger|\bhru\b|wheel)|etter\s*gj\w*v|ettergjenvinn/, 'ettergjenvinner'],
    [/retur\s*(varme|kjøle|kjole)?batteri|batteri\s*retur|vannretur|return\s*(water|heating|coil)|frostprotectiontemp|frost\s*protection\s*temp/, 'batteriretur'],
    [/avkast|fortluft|utkast|avblås|avblas|exhaust/, 'avkast'],
    [/avtrekk|extract|\beaf\b|return\s*air|retur\s*luft|returluft|romluft|room\s*air\s*(return|extract)/, 'avtrekk'],
    [/inntak|uteluft|ute\s*luft|friskluft|frisk\s*luft|fresh\s*air|outdoor\s*air|outside\s*air|intake|\boat\b/, 'inntak'],
    [/\btur\b|turtemp|turtrykk|turvann|flow\s*temp|supply\s*water|\bftemp/, 'tur'],
    [/tilluft|innblåsing|innblasing|supply\s*air|supply\s*(temp|setp|pid|controller|fan|pressure|flow)|\bsat\b|\bsaf\b|\bsupply/, 'tilluft'],
    [/utetemp|ute\b|utendørs|outdoor|outside/, 'ute'],
    [/romtemp|\brom\b|room|sone|zone/, 'rom'],
    [/\bretur\b|returtemp|returtrykk|return|\brtemp/, 'retur'],
  ],

  /* What the point is to its component, read from the tail of the name.
     The tail is what is left after the component code: "_SP", ".Feil", "_JV_AU". */
  HALE: [
    [/^(virkningsgrad|efficiency|eta)$/, 'virkningsgrad'],
    [/^(pv|mv\d?|verdi|value|ai|kv|tmp|temp)$/, 'pv'],
    [/^(sp|spk|spakt|aktsp\w*|wsp\d?|sp_?akt|setp|setpoint|sp_?arb)$/, 'sp'],
    [/^(sp\w+|.*_sp|.*setpoint.*|.*_hyst|hyst\w*)$/, 'innstilling'],
    [/^(ao|au|c|gn|y\d?|out|output|paadrag|\w{2}_a[ou]|cv\d?)$/, 'paadrag'],
    [/^(man|manuell|manual|\w{2}_manuell|\w+manual)$/, 'manuell'],
    [/^(am|auto|kmd|sw|vender|\w{2}_auto|tw|mode|modus)$/, 'vender'],
    [/^(drift|d|run|running|status|ds|kv_drift|\w{2}_drift)$/, 'drift'],
    [/^(start|st|do|bo|s\d?|\w{2}_do|cmd|on)$/, 'start'],
    [/^(feil|al|alarm|err|error|fault|\w{2}_feil|\w+_al|\w+alarm|viftevakt|trykkvakt|frost\w*|qt_di)$/, 'alarm'],
  ],

  /* The same, from the description, for names with no tail to read. */
  ROLLE: [
    [/arbeidende settpunkt|aktuelt? \w*settpunkt|kalkulert settpunkt|calculated setpoint|working setpoint/, 'sp'],
    [/settpunkt|setpoint|ønsket|børverdi|knekkpunkt|hysterese|grense|limit|minimum|maksimum|maks\b|min\b|max\b|deviation|gain|forsinkelse|delay|ettertid|scale factor/, 'innstilling'],
    [/^efficiency\b|kalkulert virkningsgrad|virkningsgrad$/, 'virkningsgrad'],
    [/manuell|manuelt|manual|if manual mode/, 'manuell'],
    [/vender|auto-?\/?manu|auto\/man|\bmodus\b|\bmode\b/, 'vender'],
    [/feil|alarm|fault|error|vakt\b|trip|utløst/, 'alarm'],
    [/driftstid|gangtid|running time|run\s*time|timeteller/, 'annet'],
    [/controller output|regulator utgang|pid/, 'annet'],
    [/pådrag|paadrag|control signal|output signal|styresignal|utgang/, 'paadrag'],
    [/driftsignal|drift\b|i drift|running|run\s*indication/, 'drift'],
    [/start|stopp|åpne|steng|open|close/, 'start'],
  ],

  /* What kind of plant a system number belongs to (first two digits, NS 3451). */
  SYSTEM: [
    [/^310|^33/, 'sprinkler'], [/^31/, 'sanitaer'], [/^32/, 'varme'], [/^35/, 'kjoling'],
    [/^36/, 'ventilasjon'], [/^37/, 'kjoling'], [/^43|^44/, 'el'], [/^56/, 'sd'],
  ],

  /* The component kinds each view is built from. */
  VENT: ['vifte', 'gjenvinner', 'varmebatteri', 'kjolebatteri', 'filter', 'spjeld'],
  VARME: ['pumpe', 'ventil', 'varmepumpe', 'elkjel', 'kjel', 'veksler', 'tank', 'fjernvarme'],

  /* Words that mean a mode switch stands in automatic. Anything else is "in hand". */
  AUTO: /^(auto|automatisk|automatic|reg|normal|fjern|remote|sd)$/,
};
