/**
 * CSP violation reports, report-only stage (phase 5, step 5.3).
 *
 * The collector only logs: one `console.warn` line per distinct violation,
 * read from the Vercel runtime logs. Nothing is written to Firestore (free
 * tier: a report storm must cost nothing), and nothing personal is logged:
 * no IP, no query strings, no script samples.
 */

/** One violation, trimmed to what deciding "allow or fix" needs. */
export type CspViolation = {
  directive: string;
  /** `inline`, `eval`, … or origin + path of the blocked URL (no query). */
  blocked: string;
  /** Path of the page that hit it (no query, no host). */
  page: string;
  /** Origin + path of the script that caused it, when the browser says. */
  source: string | null;
  line: number | null;
  disposition: string;
};

export const MAX_REPORT_BYTES = 16 * 1024;
const MAX_FIELD = 200;
const MAX_REPORTS_PER_BODY = 20;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const clip = (v: string): string => (v.length > MAX_FIELD ? `${v.slice(0, MAX_FIELD)}…` : v);

/** URL → origin + path; keywords (`inline`, `eval`, `self`, …) kept as they are. */
export function stripUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return clip(`${url.origin}${url.pathname}`);
    return clip(url.protocol.replace(/:$/, ''));
  } catch {
    return clip(value);
  }
}

function pagePath(value: string | null): string | null {
  if (!value) return null;
  try {
    return clip(new URL(value).pathname);
  } catch {
    return null;
  }
}

function toViolation(raw: Record<string, unknown>, legacy: boolean): CspViolation | null {
  const page = pagePath(str(legacy ? raw['document-uri'] : raw.documentURL));
  // Only admin pages send this policy; anything else is noise or forged.
  if (!page || !(page === '/admin' || page.startsWith('/admin/'))) return null;
  const directive =
    str(legacy ? (raw['effective-directive'] ?? raw['violated-directive']) : raw.effectiveDirective) ?? 'unknown';
  const line = legacy ? raw['line-number'] : raw.lineNumber;
  return {
    directive: clip(directive),
    blocked: stripUrl(str(legacy ? raw['blocked-uri'] : raw.blockedURL)) ?? 'unknown',
    page,
    source: stripUrl(str(legacy ? raw['source-file'] : raw.sourceFile)),
    line: typeof line === 'number' && Number.isFinite(line) ? line : null,
    disposition: clip(str(raw.disposition) ?? 'report'),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Both report formats:
 * - `report-uri` (Firefox, older Chromium): `{ "csp-report": { "document-uri", … } }`
 * - `report-to` Reporting API (Chromium): `[{ type: "csp-violation", body: { documentURL, … } }]`
 */
export function parseCspReports(json: unknown): CspViolation[] {
  if (isObject(json) && isObject(json['csp-report'])) {
    const v = toViolation(json['csp-report'], true);
    return v ? [v] : [];
  }
  if (!Array.isArray(json)) return [];
  const out: CspViolation[] = [];
  for (const item of json.slice(0, MAX_REPORTS_PER_BODY)) {
    if (!isObject(item) || item.type !== 'csp-violation' || !isObject(item.body)) continue;
    const v = toViolation(item.body, false);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Logs each distinct violation at most once per `windowMs` per instance, and
 * at most `maxPerWindow` lines per window overall, so a looping page or a
 * forged flood cannot fill the logs.
 */
export class CspReportLog {
  private readonly seen = new Map<string, number>();
  private windowStart = 0;
  private logged = 0;

  constructor(
    private readonly log: (line: string) => void = (line) => console.warn(line),
    private readonly windowMs = 10 * 60_000,
    private readonly maxPerWindow = 50,
    private readonly maxKeys = 500,
  ) {}

  /** Returns how many lines were written. */
  record(violations: readonly CspViolation[], now = Date.now()): number {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.logged = 0;
    }
    let written = 0;
    for (const v of violations) {
      if (this.logged >= this.maxPerWindow) break;
      const key = `${v.directive}|${v.blocked}|${v.page}|${v.source ?? ''}`;
      const last = this.seen.get(key);
      if (last !== undefined && now - last < this.windowMs) continue;
      if (this.seen.size >= this.maxKeys) this.seen.clear();
      this.seen.set(key, now);
      this.logged += 1;
      written += 1;
      this.log(`[csp-report] ${JSON.stringify(v)}`);
    }
    return written;
  }
}
