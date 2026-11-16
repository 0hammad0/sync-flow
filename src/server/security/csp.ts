import { createHash, randomBytes } from 'node:crypto';
import { THEME_INIT_SCRIPT } from '@/shared/lib/theme-init-script';

/**
 * Admin Content Security Policy (phase 5, step 5.3).
 *
 * Stage 1: REPORT-ONLY. Browsers log and report violations but block nothing.
 * The phase doc requires 7 days of clean reports before switching to
 * `Content-Security-Policy` (see CSP_HEADER below and the switch notes in
 * docs/admin/04-phases/phase-5-hardening.md).
 *
 * Only `/admin/**` pages get it: a nonce needs a per-request render, and
 * public pages must stay static. `/api/admin/**` answers JSON, not documents.
 */
export const CSP_HEADER = 'Content-Security-Policy-Report-Only';

/** Same-origin collector: console log only, never Firestore (free tier). */
export const CSP_REPORT_PATH = '/api/csp-report';
/** Reporting API group name used by `report-to` and `Reporting-Endpoints`. */
export const CSP_REPORT_GROUP = 'csp';

/**
 * Firebase Auth hosts the admin reaches from the browser:
 * - identitytoolkit: `sendSignInLinkToEmail` on /admin/sign-in, project config.
 * - securetoken: ID-token refresh behind `onAuthStateChanged` (the shared
 *   Header subscribes on every page, admin included).
 * The R2 host is left out on purpose: the admin never loads files (D-4).
 * Firestore admin reads are server-only, so no Firestore host.
 */
export const FIREBASE_AUTH_CONNECT = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'];
/**
 * `getAuth()` loads gapi from here on mobile browsers and Safari (proactive
 * popup/redirect resolver init). With 'strict-dynamic' a modern browser
 * allows it through the trusted loader anyway; the host is the fallback for
 * browsers without 'strict-dynamic'.
 */
export const FIREBASE_AUTH_SCRIPT = 'https://apis.google.com';

/** `'sha256-…'` source for the root layout's inline theme script. */
export const THEME_SCRIPT_HASH = `'sha256-${createHash('sha256').update(THEME_INIT_SCRIPT).digest('base64')}'`;

/** `/admin` and everything under it (pages and their server actions). */
export function isAdminPagePath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

/** 128 random bits, base64: matches Next's nonce pattern `[A-Za-z0-9+/]+={0,2}`. */
export function makeNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * `https://<authDomain>` for the Auth iframe (`/__/auth/iframe`, loaded with
 * gapi above). Null when unset or not a bare host, so a bad env value never
 * injects extra directives.
 */
export function authDomainOrigin(authDomain: string | undefined): string | null {
  if (!authDomain || !/^[a-z0-9.-]+(?::\d+)?$/i.test(authDomain)) return null;
  return `https://${authDomain}`;
}

export type AdminCspOptions = {
  nonce: string;
  /** React dev needs eval for its error overlays; never in production. */
  dev: boolean;
  authDomain: string | undefined;
};

export function adminCsp({ nonce, dev, authDomain }: AdminCspOptions): string {
  const frame = authDomainOrigin(authDomain);
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${THEME_SCRIPT_HASH} ${FIREBASE_AUTH_SCRIPT}${dev ? " 'unsafe-eval'" : ''}`,
    // Inline style attributes (Radix positioning, charts) cannot carry a
    // nonce, and a nonce here would switch 'unsafe-inline' off. Style
    // injection is the lower risk; scripts are what the nonce protects.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${FIREBASE_AUTH_CONNECT.join(' ')}`,
    `frame-src 'self'${frame ? ` ${frame}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Replaces X-Frame-Options once enforced; until then X-Frame-Options
    // (next.config.ts) is what actually stops framing.
    "frame-ancestors 'none'",
    // Firefox only knows report-uri; Chromium prefers report-to when both exist.
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ];
  return directives.join('; ');
}

export type AdminCspHeaders = {
  nonce: string;
  policy: string;
  /** For `NextResponse.next({ request: { headers } })`: Next reads the nonce from here. */
  requestHeaders: Headers;
  /** Set on the response the proxy returns. */
  responseHeaders: [string, string][];
};

/**
 * One fresh nonce per request. Next.js reads it from the CSP request header
 * (it accepts the report-only name too) and stamps it on its own inline and
 * bundle scripts during the dynamic render. `x-nonce` is there for any
 * Server Component that needs it for a `<Script nonce>`.
 */
export function adminCspHeaders(
  request: Request,
  env: { NODE_ENV?: string; NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string } = process.env,
): AdminCspHeaders {
  const nonce = makeNonce();
  const policy = adminCsp({
    nonce,
    dev: env.NODE_ENV === 'development',
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(CSP_HEADER, policy);
  const reportUrl = new URL(CSP_REPORT_PATH, request.url).toString();
  return {
    nonce,
    policy,
    requestHeaders,
    responseHeaders: [
      [CSP_HEADER, policy],
      ['Reporting-Endpoints', `${CSP_REPORT_GROUP}="${reportUrl}"`],
    ],
  };
}
