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
    [/varmegjenvinn|gjenvinner|varmegj|heat\s*recovery|exchanger|\bexch|rotor|rotary|roterende|veksler luft|\brhx\b|\bphx\b|\bchx\b|\bhx\b|plate\s*exch/, 'gjenvinner'],
    [/varmebatteri|ettervarme|heating\s*coil|heat\s*coil|\bheater\b|\bheatcv|heating y\d|re\s*-?\s*heat|pre\s*-?\s*heat|preheater|\bheat\s*(valve|input|output)\b|\bheat\s*water/, 'varmebatteri'],
    [/kjølebatteri|kjolebatteri|cooling\s*coil|cool\s*coil|\bcooler\b|\bcoolcv|cool\s*(input|output|valve|level)|\bcooling\b|\bchilled\b|\bcw\b|cool\w*\s*water/, 'kjolebatteri'],
    [/tilluftsvifte|avtrekksvifte|vifte|\bsaf\b|\beaf\b|\bfan\b|ventilator|\bmtr\s*fan|\bblower\b|\bmotor\b|\bmtr\b/, 'vifte'],
    [/sirkulasjonspumpe|sirk\.?\s*pumpe|pumpe|\bpump/, 'pumpe'],
    [/ekspansjon|expansion/, 'ekspansjon'],
    [/stengeventil|serviceventil|sperreventil|avstengningsventil|shut-?off|isolation valve|isolasjonsventil/, 'stengeventil'],
    [/ventilmotor|reguleringsventil|varmeventil|ventil(?!asjon)|\bvalve/, 'ventil'],
    [/spjeldmotor|spjeld|\bdamper|\bdamp\b|\bbd\b|\bflap\b/, 'spjeld'],
    [/varmepumpe|\bvp\d|heat\s*pump/, 'varmepumpe'],
    [/el\.?\s*kjele?|elkjel|electric\s*boiler/, 'elkjel'],
    [/akkutank|akkumulator|buffer\s*tank|tank/, 'tank'],
    [/varmeveksler|veksler|heat\s*exchanger/, 'veksler'],
    [/energimåler|energimaler|energy\s*meter|måler\b/, 'energimaaler'],
    [/difftrykk|diff\.?\s*trykk|differential\s*pressure|\bdp\b|duct\s*pa\b/, 'difftrykk'],
    [/trykkgiver|trykk|pressure|\bpa\b/, 'trykk'],
    [/luftmengde|mengde|gjennomstrømning|air\s*flow|airflow|\bflow\b/, 'mengde'],
    [/fukt|humidity/, 'fukt'],
    [/temperaturføler|tempgiver|temperatur|temp\b|temp\.|temperature/, 'temp'],
    [/bevegelse|tilstedeværelse|motion|presence|occupancy/, 'bevegelse'],
  ],

  /* Which coil or exchanger a point is about. Recovery first: "heat exchanger" is not a heating coil. */
  HVOR: [
    [/gjenvinn|recovery|exchanger|\bexch|rotor|rotary|\brhx\b|\bphx\b|\bchx\b|\bhx\b|veksler|\bexc\b/, 'gjenvinner'],
    [/pre\s*-?\s*heat|forvarme|prheat|\bphw|\bph\s+(fp|pmp|heat)/, 'forvarme'],
    [/re\s*-?\s*heat|ettervarme|\bht\s+rh\b|\brhw/, 'ettervarme'],
    [/varmebatteri|heating\s*coil|heat\s*coil|\bheater\b|\bheatcv|heating y\d|\bheat\w*|varme|\bhw\b|\bht\b|combi/, 'varmebatteri'],
    [/kjølebatteri|kjolebatteri|cooling\s*coil|cool\s*coil|\bcooler\b|\bcoolcv|\bcool\w*|chill|\bcw\b|kj[øo]l|\bcl\b/, 'kjolebatteri'],
  ],

  /* Names a vendor builds from a prefix, with nothing to split on: BDInletRelPos, BVHeat1SetPrc.
     Tested on the name alone. `rolle` comes from the end of the name. */
  NAVN: [
    [/^BD(Inlet|Inl)/i, {art: 'spjeld', sted: 'inntak'}],
    [/^BDSupBak/i, {art: 'spjeld', sted: 'tilluft'}],
    [/^BDSup/i, {art: 'spjeld', sted: 'tilluft'}],
    [/^BDExhBak/i, {art: 'spjeld', sted: 'avkast'}],
    [/^BDExh/i, {art: 'spjeld', sted: 'avkast'}],
    [/^BDExt/i, {art: 'spjeld', sted: 'avtrekk'}],
    [/^BDRec/i, {art: 'spjeld', hvor: 'gjenvinner'}],
    [/^BD(Smoke|SMBP)/i, {art: 'spjeld', hvor: 'gjenvinner'}],
    [/^BD(ByPas|Dryin)/i, {art: 'spjeld', hvor: 'gjenvinner'}],
    [/^BVPrHeat/i, {art: 'ventil', hvor: 'forvarme'}],
    [/^BVHeat2/i, {art: 'ventil', hvor: 'ettervarme'}],
    [/^BVHeat1/i, {art: 'ventil', hvor: 'varmebatteri'}],
    [/^BV(Comb|Opt)/i, {art: 'ventil', hvor: 'varmebatteri'}],
    [/^BVCool/i, {art: 'ventil', hvor: 'kjolebatteri'}],
    [/^BVFlExc/i, {art: 'ventil', hvor: 'gjenvinner'}],
  ],
  NAVNROLLE: [[/RelPos$/i, 'paadrag'], [/(SetPrc|SetPos)$/i, 'manuell']],

  /* Where in the plant it sits. Air first, then water. */
  STED: [
    // After the recovery unit on the extract side is the exhaust: both words in one text say so.
    [/(etter|efter|after)[^|]{0,22}(gjenvinn|gjv|vgv|vvx|veksler|rotor|recovery|exchanger|\bhru\b|wheel)[^|]{0,30}(avtrekk|extract|avkast|exhaust|fortluft)|(avtrekk|extract)[^|]{0,30}(etter|efter|after)[^|]{0,22}(gjenvinn|gjv|vgv|vvx|recovery|exchanger)/, 'avkast'],
    [/(etter|efter|after)\s*(varme)?\s*(gjenvinn|gjv|vgv|vvx|veksler|rotor|recovery|exchanger|\bhru\b|wheel)|etter\s*gj\w*v|ettergjenvinn/, 'ettergjenvinner'],
    [/(after|etter)\s*(the\s*)?(pre\s*-?\s*heat|forvarme)/, 'inntak'],
    [/retur\s*(varme|kjøle|kjole)?batteri|batteri\s*retur|vannretur|return\s*(water|heating|coil)|frostprotectiontemp|frost\s*protection\s*temp|(heat|hot|cool|chilled)\w*\s*water\s*(batt|temp|coil)|\bwater\s*batt|batt\w*\s*temp|\bcw\s*(inlet|temp|batt)|\bhw\s*(batt|temp)|combi\s*batt|water\s*coil|^water\s*temp/, 'batteriretur'],
    [/avkast|fortluft|utkast|avblås|avblas|exhaust|\bexh\b|\bexhst\b/, 'avkast'],
    [/avtrekk|extract|\beaf\b|\bext\b|\bea\b|return\s*air|retur\s*luft|returluft|romluft|room\s*air\s*(return|extract)|\bra\b/, 'avtrekk'],
    [/inntak|uteluft|ute\s*luft|friskluft|frisk\s*luft|fresh\s*air|outdoor\s*air|outside\s*air|intake|\boat\b|\boa\b|\bfresh\b|\boutdoor\b|out\s*door|\bout\s*temp/, 'inntak'],
    [/\btur\b|turtemp|turtrykk|turvann|flow\s*temp|supply\s*water|\bftemp/, 'tur'],
    [/tilluft|innblåsing|innblasing|supply\s*air|supply\s*(temp|setp|pid|controller|fan|pressure|flow)|\bsat\b|\bsaf\b|\bsupply|\bsup\b|\bsupp\b|\bsa\b/, 'tilluft'],
    [/utetemp|ute\b|utendørs|outdoor|outside/, 'ute'],
    [/romtemp|\brom\b|room|sone|zone/, 'rom'],
    [/\bretur\b|returtemp|returtrykk|return|\brtemp/, 'retur'],
  ],

  /* What the point is to its component, read from the tail of the name.
     The tail is what is left after the component code: "_SP", ".Feil", "_JV_AU". */
  HALE: [
    [/^(virkningsgrad|efficiency|eta)$/, 'virkningsgrad'],
    [/^(pv|mv\d?|verdi|value|ai|kv|tmp|temp)$/, 'pv'],
    [/^(sp|spk|spakt|aktsp\w*|wsp\d?|sp_?akt|setp|setpoint|sp_?arb|b_dag)$/, 'sp'],
    [/^(sp\w+|.*_sp|.*setpoint.*|.*_hyst|hyst\w*)$/, 'innstilling'],
    [/^(ao|au|c|gn|y\d?|out|output|paadrag|\w{2}_a[ou]|cv\d?|pos|position|flow)$/, 'paadrag'],
    [/^(man|manuell|manual|\w{2}_manuell|\w+manual)$/, 'manuell'],
    [/^(am|auto|kmd|sw|vender|\w{2}_auto|tw|mode|modus)$/, 'vender'],
    [/^(drift|d|run|running|status|ds|kv_drift|\w{2}_drift)$/, 'drift'],
    [/^(start|st|do|bo|s\d?|\w{2}_do|cmd|on)$/, 'start'],
    [/^(feil|al|alarm|err|error|fault|\w{2}_feil|\w+_al|\w+alarm|viftevakt|trykkvakt|frost\w*|qt_di)$/, 'alarm'],
  ],

  /* The same, from the description, for names with no tail to read. */
  ROLLE: [
    [/arbeidende settpunkt|aktuelt? \w*settpunkt|kalkulert settpunkt|calculated setpoint|working setpoint/, 'sp'],
    [/(pressure|humidity|filter|co2|voc|temperature)\s+level|level\b.*(pa|ppm)\b/, 'pv'],
    [/\blevel\b|operation level|output level|input level|regulator level/, 'paadrag'],
    [/settpunkt|setpoint|ønsket|børverdi|knekkpunkt|hysterese|grense|limit|minimum|maksimum|maks\b|min\b|max\b|deviation|gain|forsinkelse|delay|ettertid|scale factor/, 'innstilling'],
    [/reg\s*set|regset|regulator\s+\w+[- ]?set\b|\bregulator\b/, 'sp'],
    [/efficiency|virkningsgrad|\beta\b/, 'virkningsgrad'],
    [/manuell|manuelt|manual|if manual mode/, 'manuell'],
    [/vender|auto-?\/?manu|auto\/man|\bmodus\b|\bmode\b/, 'vender'],
    [/feil|alarm|fault|error|vakt\b|trip|utløst/, 'alarm'],
    [/driftstid|gangtid|running time|run\s*time|timeteller/, 'annet'],
    [/controller output|regulator utgang|pid/, 'annet'],
    [/pådrag|paadrag|control signal|output signal|styresignal|utgang|output set|actual position|\bposition\b/, 'paadrag'],
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

  /* A device that names its points in words (no component codes) has hundreds of settings for every
     reading. These words say a point is a setting or a calculation, never a part of the plant. */
  INNSTILLING_ORD: /utekomp[ _]?[xy]\d|kompkurve|user\s*set|userset|setpoint|set\s*point|\bset\b|regset|\bsp\b|limit|hyst|gain|calib|\bmode\b|\bfunc|\btype|\bsel\b|curve|\bmin\b|\bmax\b|enable|param|config|reset|offset|\bstep|delay|\btime\b|\bdays?\b|inverse|invers|interval|zero|period|schedule|\bstop\b|stage|triggered|i\/o-?\s*module|external\s*operation|\bio\d?_|_io\d|bacnet|modbus|\bblock|extern\w*\s*signal|\bpb\b|\balr\b|\balarm\b|\bit\b|\bx\d|offs|freeze|frz|\bfire|bypass|bypas|\bwint|\bsum\b|\bcomp\b|standby|\bdis\b|\bcalc|\bavr\b|supervis/i,

  /* For analog inputs, which are read-only: a regulator's own setpoint ("RegSet") is a reading, the
     user's setting is not, and neither are limits, versions, motor telemetry or energy counters. */
  INNSTILLING_AI: /utekomp[ _]?[xy]\d|kompkurve|user\s*set|userset|limit|hyst|calib|\bmode\b|\bfunc|\btype|\bsel\b|curve|\bmin\b|\bmax\b|maxflow|minflow|enable|param|config|reset|offset|\bstep|delay|\btime\b|\bdays?\b|inverse|invers|interval|zero|period|schedule|\bstop\b|stage|triggered|i\/o-?\s*module|external\s*operation|\bio\d?_|_io\d|bacnet|modbus|\bpb\b|\balr|\balarm\b|\bit\b|\bx\d|freeze|frz|\bfire|bypass|bypas|\bwint|\bsum\b|\bcomp\b|standby|\bdis\b|supervis|version|\bver\b|boot|restime|rest\s*day|\bnew\b|energy|\bsfp\b|miru|extern\w*\s*signal|component|flow[\s-]*press|flowpress|\bnom\b|\bblock|greenzone/i,

  /* Words that mean a mode switch stands in automatic. Anything else is "in hand". */
  AUTO: /^(auto|automatisk|automatic|reg|normal|fjern|remote|sd)$/,
};
