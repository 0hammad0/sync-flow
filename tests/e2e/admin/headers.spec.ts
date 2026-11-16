import { expect, test } from '@playwright/test';

// next.config.ts headers() for /admin/** (04-auth-and-security.md "Headers for /admin").
// They must be on every admin response, including the proxy's sign-in redirect
// and the public sign-in page. No session needed.
const EXPECTED = {
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'private, no-store',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

// One viewport is enough: headers do not depend on width.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'w1366', 'headers are viewport-independent');
});

for (const path of ['/admin', '/admin/files?type=chat', '/admin/sign-in']) {
  test(`${path} sends the admin headers`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    for (const [name, value] of Object.entries(EXPECTED)) {
      expect(headers[name], name).toBe(value);
    }
  });
}

test('public pages do not get the admin headers', async ({ request }) => {
  const headers = (await request.get('/privacy')).headers();
  expect(headers['x-robots-tag']).toBeUndefined();
  expect(headers['x-frame-options']).toBeUndefined();
  expect(headers['content-security-policy-report-only']).toBeUndefined();
});

// Step 5.3: report-only CSP with a per-request nonce, admin pages only.
const CSP = 'content-security-policy-report-only';
const nonceOf = (policy: string) => policy.match(/'nonce-([A-Za-z0-9+/]+={0,2})'/)?.[1];

test('admin pages: every inline script is allowed by the nonce or the theme hash', async ({ request }) => {
  const response = await request.get('/admin/sign-in');
  const policy = response.headers()[CSP];
  expect(policy).toBeTruthy();
  expect(response.headers()['content-security-policy']).toBeUndefined();
  const nonce = nonceOf(policy);
  expect(nonce).toBeTruthy();

  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  expect(scripts.length).toBeGreaterThan(1);
  const { createHash } = await import('node:crypto');
  for (const [, attrs, body] of scripts) {
    if (attrs.includes(`nonce="${nonce}"`)) continue;
    const hash = createHash('sha256').update(body).digest('base64');
    expect(policy, `script without nonce must match a hash: ${body.slice(0, 60)}`).toContain(`'sha256-${hash}'`);
  }
});

/**
 * Violations already known in the report-only stage. Each must be fixed (or
 * consciously allowed in the policy) before switching to enforce.
 * - `script-src eval`: the shared client chunk carries Node polyfills whose
 *   `is-generator-function` calls `Function()` once, inside try/catch.
 */
const KNOWN_VIOLATIONS = new Set(['script-src eval']);

test('admin sign-in: no CSP violations beyond the known list', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
  });
  await page.goto('/admin/sign-in');
  await page.waitForLoadState('networkidle');
  const seen = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(seen.filter((v) => !KNOWN_VIOLATIONS.has(v))).toEqual([]);
});

test('admin pages: a fresh nonce per request', async ({ request }) => {
  const a = nonceOf((await request.get('/admin/sign-in')).headers()[CSP]);
  const b = nonceOf((await request.get('/admin/sign-in')).headers()[CSP]);
  expect(a).toBeTruthy();
  expect(a).not.toBe(b);
});
