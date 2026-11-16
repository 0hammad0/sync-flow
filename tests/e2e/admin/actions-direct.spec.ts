import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Phase 5: every admin server action, called directly (a hand-made POST with
 * the `Next-Action` header, no UI, no session cookie), is refused before the
 * action body runs, and a cross-origin call is stopped by Next's origin check.
 * No session and no Firebase needed: runs in CI as is.
 *
 * Action ids come from the build (`.next/server/server-reference-manifest.json`),
 * so run `npm run build` first. Measured on Next 16.4.6, no session cookie:
 *
 *   POST <action's admin page>          307 → /admin/sign-in?next=…  (proxy)
 *   POST /privacy (public page)         200 `{}` application/json
 *       Next forwards the call to the action's admin page; the proxy answers
 *       that with the same 307, and Next turns a non-RSC answer into `{}`.
 *   POST /privacy + x-action-forwarded  409 "Server Action unavailable."
 *       (forged header): the action's module only loads on its own pages.
 *   Cross-origin POST /privacy          500 RSC error row, digest only
 *       ("Invalid Server Actions request", logged server side).
 *   Cross-origin POST <admin page>      307: the proxy answers before Next.
 *
 * So over HTTP an anonymous caller never reaches requireAdmin(): the proxy
 * redirect is the first refusal. requireAdmin() inside each action (the real
 * check, T-6) is covered by the unit / integration action tests.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'w1366', 'HTTP only: viewport-independent');
});

type ManifestEntry = { workers: Record<string, unknown>; filename?: string; exportedName?: string };
type AdminAction = { id: string; name: string; file: string; url: string };

const ROOT = process.cwd();
const OTHER_SITE = 'https://evil.example';
const PUBLIC_PAGE = '/privacy';

/** `app/admin/(shell)/users/[uid]/page` → `/admin/users/e2e-probe`. Prefers a plain worker (no slot, no param). */
function urlOf(workers: string[]): string {
  const worker = [...workers].sort((a, b) => Number(/[@[]/.test(a)) - Number(/[@[]/.test(b)))[0];
  const segments = worker
    .replace(/^app\//, '')
    .replace(/\/page$/, '')
    .split('/')
    .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'))
    .map((s) => (s.startsWith('[') ? 'e2e-probe' : s));
  return `/${segments.join('/')}`;
}

function adminActions(): AdminAction[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.next/server/server-reference-manifest.json'), 'utf8')) as {
    node: Record<string, ManifestEntry>;
  };
  return Object.entries(manifest.node)
    .filter(([, e]) => e.filename?.startsWith('src/features/admin/'))
    .map(([id, e]) => ({ id, name: e.exportedName!, file: e.filename!, url: urlOf(Object.keys(e.workers)) }))
    .sort((a, b) => `${a.file}${a.name}`.localeCompare(`${b.file}${b.name}`));
}

/** The source list CI already checks (`npm run check:entry-points`), actions only. */
function sourceActions(): string[] {
  const run = spawnSync(process.execPath, ['scripts/list-admin-entry-points.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const entries = JSON.parse(run.stdout) as { kind: string; path: string; export?: string }[];
  return entries.filter((e) => e.kind === 'action').map((e) => `${e.path}#${e.export}`).sort();
}

const ACTIONS = adminActions();

/** An action call as the Next client sends it: JSON args, text/plain, RSC accept. */
function callAction(
  request: APIRequestContext,
  path: string,
  id: string,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return request.post(path, {
    headers: {
      'next-action': id,
      'content-type': 'text/plain;charset=UTF-8',
      accept: 'text/x-component',
      ...headers,
    },
    data: JSON.stringify([{ code: 'ABCDEF', id: 'e2e-probe', uid: 'e2e-probe', reason: 'e2e' }]),
    maxRedirects: 0,
  });
}

/** Nothing an action returns (`{ ok, data }` / `{ ok:false, error }`) and no session cookie set. */
async function expectNoActionResult(response: APIResponse) {
  const body = await response.text();
  expect(body).not.toContain('"ok"');
  expect(body).not.toContain('"data"');
  expect(response.headers()['set-cookie'] ?? '').not.toContain('__session=');
}

test('the build has every admin action the source declares', () => {
  expect(ACTIONS.length).toBeGreaterThan(0);
  expect(ACTIONS.map((a) => `${a.file}#${a.name}`).sort()).toEqual(sourceActions());
});

for (const action of ACTIONS) {
  test.describe(`${action.name} (${action.file})`, () => {
    test(`POST ${action.url}, no session: 307 to /admin/sign-in`, async ({ request, baseURL }) => {
      const response = await callAction(request, action.url, action.id, { origin: baseURL! });
      expect(response.status()).toBe(307);
      expect(response.headers()['location']).toBe(`/admin/sign-in?next=${encodeURIComponent(action.url)}`);
      expect(response.headers()['content-type'] ?? '').not.toContain('text/x-component');
      await expectNoActionResult(response);
    });

    test(`POST ${PUBLIC_PAGE} (forwarded to its admin page), no session: 200 {}`, async ({ request, baseURL }) => {
      const response = await callAction(request, PUBLIC_PAGE, action.id, { origin: baseURL! });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
      expect(await response.text()).toBe('{}');
      await expectNoActionResult(response);
    });

    test(`POST ${PUBLIC_PAGE} with a forged x-action-forwarded: 409, action not loadable there`, async ({ request, baseURL }) => {
      const response = await callAction(request, PUBLIC_PAGE, action.id, { origin: baseURL!, 'x-action-forwarded': '1' });
      expect(response.status()).toBe(409);
      expect(response.headers()['x-nextjs-action-not-found']).toBe('1');
      expect((await response.text()).trim()).toBe('Server Action unavailable.');
    });

    test('cross-origin: refused (500 by Next on a public page, 307 by the proxy on its admin page)', async ({ request }) => {
      const onPublic = await callAction(request, PUBLIC_PAGE, action.id, { origin: OTHER_SITE });
      expect(onPublic.status()).toBe(500);
      expect(onPublic.headers()['content-type']).toContain('text/x-component');
      // Flight rows: row 1 is the rejected action, an error with a digest only.
      expect(await onPublic.text()).toMatch(/^1:E\{"digest":"\d+"\}$/m);
      await expectNoActionResult(onPublic);

      const onAdmin = await callAction(request, action.url, action.id, { origin: OTHER_SITE });
      expect(onAdmin.status()).toBe(307);
      await expectNoActionResult(onAdmin);
    });
  });
}
