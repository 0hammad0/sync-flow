import 'server-only';

import { OFF_MAX_AGE_S, REGION_COOKIE, REGION_MAX_AGE_S, type Region } from '@/features/tracking/cookies';

/**
 * Where visit statistics need opt-in consent (mode A): the EU, the EEA and
 * the UK, by Vercel's `x-vercel-ip-country`. Over-inclusive on purpose: EU
 * outermost regions and territories Vercel may report with their own code
 * (Åland, French overseas regions, Saint-Martin) and Gibraltar are asked too.
 */
const CONSENT_COUNTRIES = new Set(
  (
    'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE ' + // EU 27
    'IS LI NO ' + // EEA
    'GB ' + // UK
    'AX GF GP MQ RE YT MF GI'
  ).split(' '),
);

/**
 * `eu` (ask) or `ok` (no consent needed). On Vercel the country header is
 * always set; when it is missing there we cannot tell, so we ask. Off Vercel
 * (local runs) a missing header means "not a consent region".
 */
export function regionFor(country: string | null, onVercel: boolean): Exclude<Region, 'off'> {
  const code = country?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{2}$/.test(code)) return onVercel ? 'eu' : 'ok';
  return CONSENT_COUNTRIES.has(code) ? 'eu' : 'ok';
}

/** `Set-Cookie` value for the region / state cookie. Readable by the loader (not httpOnly); holds no identifier. */
export function regionCookie(value: Region, secure: boolean): string {
  const maxAge = value === 'off' ? OFF_MAX_AGE_S : REGION_MAX_AGE_S;
  return `${REGION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}
