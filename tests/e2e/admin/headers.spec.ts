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
});
