// ISO 3166-1 alpha-2 ↔ numeric. Vercel geolocation sends alpha-2 (`PK`);
// world-atlas keys its shapes by the 3-digit numeric code (`586`).
// One packed string (5 chars per country: alpha-2 + numeric) keeps it ~1.3 KB.
const PACKED =
  'AD020AE784AF004AG028AI660AL008AM051AO024AQ010AR032AS016AT040AU036AW533AX248AZ031' +
  'BA070BB052BD050BE056BF854BG100BH048BI108BJ204BL652BM060BN096BO068BQ535BR076BS044' +
  'BT064BV074BW072BY112BZ084CA124CC166CD180CF140CG178CH756CI384CK184CL152CM120CN156' +
  'CO170CR188CU192CV132CW531CX162CY196CZ203DE276DJ262DK208DM212DO214DZ012EC218EE233' +
  'EG818EH732ER232ES724ET231FI246FJ242FK238FM583FO234FR250GA266GB826GD308GE268GF254' +
  'GG831GH288GI292GL304GM270GN324GP312GQ226GR300GS239GT320GU316GW624GY328HK344HM334' +
  'HN340HR191HT332HU348ID360IE372IL376IM833IN356IO086IQ368IR364IS352IT380JE832JM388' +
  'JO400JP392KE404KG417KH116KI296KM174KN659KP408KR410KW414KY136KZ398LA418LB422LC662' +
  'LI438LK144LR430LS426LT440LU442LV428LY434MA504MC492MD498ME499MF663MG450MH584MK807' +
  'ML466MM104MN496MO446MP580MQ474MR478MS500MT470MU480MV462MW454MX484MY458MZ508NA516' +
  'NC540NE562NF574NG566NI558NL528NO578NP524NR520NU570NZ554OM512PA591PE604PF258PG598' +
  'PH608PK586PL616PM666PN612PR630PS275PT620PW585PY600QA634RE638RO642RS688RU643RW646' +
  'SA682SB090SC690SD729SE752SG702SH654SI705SJ744SK703SL694SM674SN686SO706SR740SS728' +
  'ST678SV222SX534SY760SZ748TC796TD148TF260TG768TH764TJ762TK772TL626TM795TN788TO776' +
  'TR792TT780TV798TW158TZ834UA804UG800UM581US840UY858UZ860VA336VC670VE862VG092VI850' +
  'VN704VU548WF876WS882YE887YT175ZA710ZM894ZW716';

let byAlpha2: Map<string, string> | null = null;
let byNumeric: Map<string, string> | null = null;

function tables() {
  if (!byAlpha2 || !byNumeric) {
    byAlpha2 = new Map();
    byNumeric = new Map();
    for (let i = 0; i < PACKED.length; i += 5) {
      const a2 = PACKED.slice(i, i + 2);
      const num = PACKED.slice(i + 2, i + 5);
      byAlpha2.set(a2, num);
      byNumeric.set(num, a2);
    }
  }
  return { byAlpha2, byNumeric };
}

/** `PK` → `586`. Null for an unknown or non-country code. Case-insensitive. */
export function alpha2ToNumeric(code: string): string | null {
  return tables().byAlpha2.get(code.toUpperCase()) ?? null;
}

/** `586` (or `86`) → `PK`. Null when unknown. */
export function numericToAlpha2(id: string | number): string | null {
  return tables().byNumeric.get(String(id).padStart(3, '0')) ?? null;
}

// world-atlas 110m shapes with no ISO numeric id, keyed by their atlas name.
// Geolocation reports these places under the code below.
const NO_ID: Record<string, string> = { Kosovo: 'XK', Somaliland: 'SO', 'N. Cyprus': 'CY' };

/** Alpha-2 for a world-atlas feature: by its numeric id, else by its name for the few shapes without one. */
export function featureAlpha2(id: string | number | undefined, name: string | undefined): string | null {
  if (id !== undefined && id !== null && id !== '') return numericToAlpha2(id);
  return (name && NO_ID[name]) || null;
}
