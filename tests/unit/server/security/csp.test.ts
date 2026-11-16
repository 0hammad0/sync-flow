import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CSP_HEADER,
  THEME_SCRIPT_HASH,
  adminCsp,
  adminCspHeaders,
  authDomainOrigin,
  isAdminPagePath,
  makeNonce,
} from '@/server/security/csp';
import { THEME_INIT_SCRIPT } from '@/shared/lib/theme-init-script';

// Next.js extracts the nonce with this pattern (get-script-nonce-from-header.js).
const NEXT_NONCE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

describe('adminCsp', () => {
  it('is the exact production policy', () => {
    expect(adminCsp({ nonce: 'N0nce+/=', dev: false, authDomain: 'demo.firebaseapp.com' })).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-N0nce+/=' 'strict-dynamic' ${THEME_SCRIPT_HASH} https://apis.google.com`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
        "frame-src 'self' https://demo.firebaseapp.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'report-uri /api/csp-report',
        'report-to csp',
      ].join('; '),
    );
  });

  it("adds 'unsafe-eval' in dev only", () => {
    expect(adminCsp({ nonce: 'a', dev: true, authDomain: undefined })).toContain("'unsafe-eval'");
    expect(adminCsp({ nonce: 'a', dev: false, authDomain: undefined })).not.toContain('unsafe-eval');
  });

  it('never allows unsafe-inline scripts', () => {
    const script = adminCsp({ nonce: 'a', dev: true, authDomain: undefined })
      .split('; ')
      .find((d) => d.startsWith('script-src'))!;
    expect(script).not.toContain('unsafe-inline');
  });

  it('the theme hash is sha256 of the exact inline script text', () => {
    const expected = createHash('sha256').update(THEME_INIT_SCRIPT, 'utf8').digest('base64');
    expect(THEME_SCRIPT_HASH).toBe(`'sha256-${expected}'`);
  });
});

describe('authDomainOrigin', () => {
  it.each([
    ['demo.firebaseapp.com', 'https://demo.firebaseapp.com'],
    ['auth.example.com:8443', 'https://auth.example.com:8443'],
    [undefined, null],
    ['', null],
    ["x.com; script-src *", null],
    ['https://x.com', null],
  ])('%s → %s', (input, expected) => {
    expect(authDomainOrigin(input)).toBe(expected);
  });
});

describe('nonce', () => {
  it('matches the pattern Next reads and is unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const nonce = makeNonce();
      expect(`'nonce-${nonce}'`).toMatch(NEXT_NONCE);
      seen.add(nonce);
    }
    expect(seen.size).toBe(1000);
  });

  it('adminCspHeaders puts one nonce in policy, request headers and x-nonce', () => {
    const h = adminCspHeaders(new Request('https://sync.test/admin', { headers: { cookie: 'a=b' } }), {
      NODE_ENV: 'production',
    });
    expect(h.policy).toContain(`'nonce-${h.nonce}'`);
    expect(h.requestHeaders.get(CSP_HEADER)).toBe(h.policy);
    expect(h.requestHeaders.get('x-nonce')).toBe(h.nonce);
    expect(h.requestHeaders.get('cookie')).toBe('a=b');
    expect(Object.fromEntries(h.responseHeaders)).toEqual({
      [CSP_HEADER]: h.policy,
      'Reporting-Endpoints': 'csp="https://sync.test/api/csp-report"',
    });
  });
});

describe('isAdminPagePath', () => {
  it.each([
    ['/admin', true],
    ['/admin/', true],
    ['/admin/sign-in', true],
    ['/administrator', false],
    ['/api/admin/files', false],
    ['/', false],
  ])('%s → %s', (path, expected) => {
    expect(isAdminPagePath(path)).toBe(expected);
  });
});
