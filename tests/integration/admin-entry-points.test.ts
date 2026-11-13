import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every way into the admin (scripts/list-admin-entry-points.mjs, stdout) must
// be in this hand-written manifest with the check that guards it, and that
// check must be in its own code. A new page, route or action fails here until
// it is added; a later edit that drops or changes the check fails too.
// The 401/403 behaviour of the checks themselves is tested with each guard.

const ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/list-admin-entry-points.mjs');

type Entry = { kind: 'page' | 'route' | 'action'; path: string; export?: string; method?: string };
/** `check`: text that must be in the entry's code. `reason`: why there is none. */
type Guard = { check: string } | { check: null; reason: string };

const page = (permission: string): Guard => ({ check: `requireAdminPage('${permission}'` });
const route = (permission: string): Guard => ({ check: `requireAdminForRoute('${permission}')` });
const action = (permission: string): Guard => ({ check: `requireAdmin('${permission}')` });
/** users/actions.ts passes the permission through `run({ permission, … })`, which calls requireAdmin(step.permission). */
const userStep = (permission: string): Guard => ({ check: `run({ permission: '${permission}'` });

const P = 'src/app/admin/(shell)';
const MANIFEST: Record<string, Guard> = {
  [`page ${P}/[...missing]/page.tsx`]: page('analytics:read'),
  [`page ${P}/access/page.tsx`]: page('blocks:read'),
  [`page ${P}/audit/page.tsx`]: page('audit:read'),
  [`page ${P}/files/[fileId]/page.tsx`]: page('files:read'),
  [`page ${P}/files/@drawer/(.)[fileId]/page.tsx`]: page('files:read'),
  [`page ${P}/files/@drawer/page.tsx`]: { check: null, reason: 'renders null: closes the drawer slot' },
  [`page ${P}/files/page.tsx`]: page('files:read'),
  [`page ${P}/geography/page.tsx`]: page('analytics:read'),
  [`page ${P}/health/page.tsx`]: page('analytics:read'),
  [`page ${P}/live/page.tsx`]: page('analytics:read'),
  [`page ${P}/page.tsx`]: page('analytics:read'),
  [`page ${P}/pages/page.tsx`]: page('analytics:read'),
  [`page ${P}/rooms/page.tsx`]: page('rooms:read'),
  [`page ${P}/sessions/[sessionId]/page.tsx`]: page('analytics:read'),
  [`page ${P}/sessions/page.tsx`]: page('analytics:read'),
  [`page ${P}/sources/page.tsx`]: page('analytics:read'),
  [`page ${P}/users/[uid]/page.tsx`]: page('users:read'),
  [`page ${P}/users/page.tsx`]: page('users:read'),
  ['page src/app/admin/sign-in/page.tsx']: { check: null, reason: 'public sign-in page' },
  ['route src/app/api/admin/cron/rollup/route.ts GET']: { check: 'isCronAuthorized(' },
  ['route src/app/api/admin/cron/rollup/route.ts POST']: { check: 'isCronAuthorized(' },
  ['route src/app/api/admin/export/[table]/route.ts GET']: route('export:csv'),
  ['route src/app/api/admin/live/route.ts GET']: route('analytics:read'),
  ['action src/features/admin/access/actions.ts blockSubject']: action('blocks:write'),
  ['action src/features/admin/access/actions.ts unblockSubject']: action('blocks:write'),
  ['action src/features/admin/files/actions.ts deleteFile']: action('files:delete'),
  ['action src/features/admin/files/actions.ts deleteFiles']: action('files:delete'),
  ['action src/features/admin/rooms/actions.ts closeRoom']: action('rooms:close'),
  ['action src/features/admin/users/actions.ts disableUser']: userStep('users:disable'),
  ['action src/features/admin/users/actions.ts enableUser']: userStep('users:disable'),
  ['action src/features/admin/users/actions.ts revokeUserSessions']: userStep('users:revoke'),
  ['action src/features/admin/users/actions.ts setUserRole']: userStep('roles:write'),
};

const keyOf = (e: Entry) => [e.kind, e.path, e.method ?? e.export].filter(Boolean).join(' ');

/** The code of one exported function or const, up to the next top-level export (whole file for pages). */
function codeOf(e: Entry): string {
  const src = readFileSync(resolve(ROOT, e.path), 'utf8');
  const name = e.method ?? e.export;
  if (!name) return src;
  // A route const like `export const GET = runRollup;` is guarded by the function it points at.
  const alias = src.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([A-Za-z0-9_]+)\\s*;`));
  const target = alias ? alias[1] : name;
  const start = src.search(new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?(?:function|const)\\s+${target}\\b`));
  expect(start, `${e.path}: ${target} not found`).toBeGreaterThanOrEqual(0);
  const next = src.slice(start + 1).search(/\n(?:export\s+)?(?:async\s+)?(?:function|const)\s/);
  return src.slice(start, next === -1 ? undefined : start + 1 + next);
}

function scan(): Entry[] {
  const run = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Entry[];
}

describe('admin entry points', () => {
  const entries = scan();

  it('every scanned entry point is in the manifest, and the manifest has nothing stale', () => {
    const scanned = entries.map(keyOf).sort();
    expect(scanned).toEqual(Object.keys(MANIFEST).sort());
  });

  it.each(entries.map((e) => [keyOf(e), e] as const))('%s calls its guard', (key, entry) => {
    const guard = MANIFEST[key];
    expect(guard, `${key} is not in the manifest`).toBeDefined();
    if (!guard || guard.check === null) return;
    expect(codeOf(entry)).toContain(guard.check);
  });
});
