import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryFunction, guardFirstProblem, scanSources } from '../../scripts/admin-entry-points-lib.mjs';

// Every way into the admin (scripts/list-admin-entry-points.mjs, stdout) must
// be in this hand-written manifest with the check that guards it, and that
// check must run first in its own code (guardFirstProblem in
// scripts/admin-entry-points-lib.mjs has the exact rule: nothing awaited
// before the guard except the block check and the Next.js props promise).
// A new page, route or action fails here until it is added; a later edit
// that drops, changes or moves the check down fails too.
// The 401/403 behaviour of the checks themselves is tested with each guard.

const ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/list-admin-entry-points.mjs');

type Entry = { kind: 'page' | 'route' | 'action'; path: string; export?: string; method?: string };
/** The guard that must run first; see the Guard typedef in the lib. */
type Guard = { call: string; permission?: string; argText?: string; sync?: boolean; via?: Guard };
/** A guard, or `call: null` with the reason there is none. */
type Check = Guard | { call: null; reason: string };

const page = (permission: string): Check => ({ call: 'requireAdminPage', permission });
const route = (permission: string): Check => ({ call: 'requireAdminForRoute', permission });
const action = (permission: string): Check => ({ call: 'requireAdmin', permission });
/** users/actions.ts passes the permission through `run({ permission, … })`, which runs requireAdmin(step.permission) first. */
const userStep = (permission: string): Check => ({
  call: 'run',
  permission,
  via: { call: 'requireAdmin', argText: 'step.permission' },
});
/** Vercel Cron: no admin session, a sync CRON_SECRET check instead. */
const cron: Check = { call: 'isCronAuthorized', sync: true };

const P = 'src/app/admin/(shell)';
const MANIFEST: Record<string, Check> = {
  [`page ${P}/[...missing]/page.tsx`]: page('analytics:read'),
  [`page ${P}/access/page.tsx`]: page('blocks:read'),
  [`page ${P}/audit/page.tsx`]: page('audit:read'),
  [`page ${P}/clicks/page.tsx`]: page('analytics:read'),
  [`page ${P}/files/[fileId]/page.tsx`]: page('files:read'),
  [`page ${P}/files/@drawer/(.)[fileId]/page.tsx`]: page('files:read'),
  [`page ${P}/files/@drawer/page.tsx`]: { call: null, reason: 'renders null: closes the drawer slot' },
  [`page ${P}/files/page.tsx`]: page('files:read'),
  [`page ${P}/geography/page.tsx`]: page('analytics:read'),
  [`page ${P}/health/page.tsx`]: page('analytics:read'),
  [`page ${P}/live/page.tsx`]: page('analytics:read'),
  [`page ${P}/page.tsx`]: page('analytics:read'),
  [`page ${P}/pages/page.tsx`]: page('analytics:read'),
  [`page ${P}/rooms/page.tsx`]: page('rooms:read'),
  [`page ${P}/sessions/[sessionId]/page.tsx`]: page('analytics:read'),
  [`page ${P}/settings/page.tsx`]: page('settings:write'),
  [`page ${P}/sessions/page.tsx`]: page('analytics:read'),
  [`page ${P}/sources/page.tsx`]: page('analytics:read'),
  [`page ${P}/users/[uid]/page.tsx`]: page('users:read'),
  [`page ${P}/users/page.tsx`]: page('users:read'),
  ['page src/app/admin/sign-in/page.tsx']: { call: null, reason: 'public sign-in page' },
  ['route src/app/api/admin/cron/rollup/route.ts GET']: cron,
  ['route src/app/api/admin/cron/rollup/route.ts POST']: cron,
  ['route src/app/api/admin/export/[table]/route.ts GET']: route('export:csv'),
  ['route src/app/api/admin/live/route.ts GET']: route('analytics:read'),
  ['action src/features/admin/access/actions.ts blockSubject']: action('blocks:write'),
  ['action src/features/admin/access/actions.ts unblockSubject']: action('blocks:write'),
  ['action src/features/admin/files/actions.ts deleteFile']: action('files:delete'),
  ['action src/features/admin/files/actions.ts deleteFiles']: action('files:delete'),
  ['action src/features/admin/rooms/actions.ts closeRoom']: action('rooms:close'),
  ['action src/features/admin/settings/actions.ts addAdmin']: action('roles:write'),
  ['action src/features/admin/settings/actions.ts deleteSubjectData']: action('settings:write'),
  ['action src/features/admin/settings/actions.ts previewSubjectData']: action('settings:write'),
  ['action src/features/admin/settings/actions.ts rebuildAdminIndex']: action('roles:write'),
  ['action src/features/admin/settings/actions.ts updateSettings']: action('settings:write'),
  ['action src/features/admin/shell/actions.ts searchAdmin']: action('analytics:read'),
  ['action src/features/admin/users/actions.ts disableUser']: userStep('users:disable'),
  ['action src/features/admin/users/actions.ts enableUser']: userStep('users:disable'),
  ['action src/features/admin/users/actions.ts revokeUserSessions']: userStep('users:revoke'),
  ['action src/features/admin/users/actions.ts setUserRole']: userStep('roles:write'),
};

const keyOf = (e: Entry) => [e.kind, e.path, e.method ?? e.export].filter(Boolean).join(' ');

/** Why the entry's guard does not run first, or null. A page is its default export. */
function guardProblem(e: Entry, guard: Guard): string | null {
  const name = e.method ?? e.export ?? 'default';
  const { fn, locals } = entryFunction(e.path, readFileSync(resolve(ROOT, e.path), 'utf8'), name);
  return guardFirstProblem(fn, guard, locals);
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

  it.each(entries.map((e) => [keyOf(e), e] as const))('%s runs its guard first', (key, entry) => {
    const guard = MANIFEST[key];
    expect(guard, `${key} is not in the manifest`).toBeDefined();
    if (!guard || guard.call === null) return;
    expect(guardProblem(entry, guard), key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The scanner and the guard-first rule on fixture sources: each former blind
// spot (security finding F4) is caught, and the allowed shapes still pass.

const ADMIN = 'src/features/admin/fixture';
const scanOne = (path: string, src: string) => scanSources([{ path, src }]);
function problemOf(src: string, guard: Guard, name = 'act', path = `${ADMIN}/actions.ts`): string | null {
  const { fn, locals } = entryFunction(path, src, name);
  return guardFirstProblem(fn, guard, locals);
}
const REQUIRE: Guard = { call: 'requireAdmin', permission: 'files:delete' };
const lines = (...l: string[]) => l.join('\n');

describe('entry-point scanner (fixtures)', () => {
  it("finds a 'use server' file under an admin area whatever its name", () => {
    const src = `'use server';\nexport async function wipe() {}\n`;
    expect(scanOne(`${ADMIN}/mutations.ts`, src).entries).toEqual([
      { kind: 'action', path: `${ADMIN}/mutations.ts`, export: 'wipe' },
    ]);
    expect(scanOne('src/app/admin/(shell)/files/server.tsx', src).entries).toHaveLength(1);
  });

  it("finds a 'use server' file outside the admin areas that calls an admin guard", () => {
    const src = `'use server';\nexport async function wipe() { await requireAdmin('files:delete'); }\n`;
    const { entries, actionEntries } = scanOne('src/features/files/server/admin-wipe.ts', src);
    expect(entries).toEqual([{ kind: 'action', path: 'src/features/files/server/admin-wipe.ts', export: 'wipe' }]);
    expect(actionEntries[0].admin).toBe(true); // so the write-limit check applies too
  });

  it('sees every export form, and resolves each one to its function', () => {
    const src = lines(
      `'use server';`,
      `async function a() { await requireAdmin('x'); }`,
      `const b = async () => { await requireAdmin('x'); };`,
      `export { a, b as renamed };`,
      `export type { Foo } from './types';`,
      `export type Bar = string;`,
      `export default async function () { await requireAdmin('x'); }`,
      `export async function c() { await requireAdmin('x'); }`,
      `export const d = async () => { await requireAdmin('x'); };`,
      `export const e = (async function () { await requireAdmin('x'); }) satisfies unknown;`,
    );
    const { entries, actionEntries, unknown } = scanOne(`${ADMIN}/actions.ts`, src);
    expect(unknown).toEqual([]);
    expect(entries.map((e) => e.export).sort()).toEqual(['a', 'c', 'd', 'default', 'e', 'renamed']);
    for (const entry of actionEntries) expect(entry.body, entry.name).not.toBeNull();
  });

  it('sees `export { x as GET }` and alias consts in a route file', () => {
    const src = `async function handler() {}\nexport { handler as GET };\nexport const POST = handler;\n`;
    expect(scanOne('src/app/api/admin/thing/route.ts', src).entries).toEqual([
      { kind: 'route', path: 'src/app/api/admin/thing/route.ts', method: 'GET' },
      { kind: 'route', path: 'src/app/api/admin/thing/route.ts', method: 'POST' },
    ]);
  });

  it.each([
    ['export * from', `export * from './impl';`],
    ['export { x } from', `export { wipe } from './impl';`],
    ['a destructured export', `export const { wipe } = makeActions();`],
    ['an exported class', `export class Wipe {}`],
  ])('fails closed on %s', (_, line) => {
    expect(scanOne(`${ADMIN}/actions.ts`, `'use server';\n${line}\n`).unknown).toHaveLength(1);
  });

  it('fails closed on a destructured route export (`export const { GET } = handlers`)', () => {
    expect(scanOne('src/app/api/admin/thing/route.ts', `export const { GET, POST } = handlers;\n`).unknown).toHaveLength(1);
  });

  it("fails closed on an inline 'use server' function in a server component, anywhere under src", () => {
    const src = lines(
      `export default async function Page() {`,
      `  async function wipe() {`,
      `    'use server';`,
      `    await db.delete();`,
      `  }`,
      `  return <form action={wipe} />;`,
      `}`,
    );
    for (const path of ['src/app/admin/(shell)/x/page.tsx', 'src/app/dashboard/page.tsx', 'src/features/x/Thing.tsx']) {
      const { unknown } = scanOne(path, src);
      expect(unknown, path).toHaveLength(1);
      expect(unknown[0]).toContain(`${path}:2: inline 'use server'`);
    }
    const arrow = `export function Form() { const go = async () => { "use server"; }; return go; }\n`;
    expect(scanOne('src/features/x/Form.tsx', arrow).unknown).toHaveLength(1);
  });
});

describe('guard-first rule (fixtures)', () => {
  it('fails a guard placed after another awaited call, which the old `toContain` check let through', () => {
    const src = lines(
      `'use server';`,
      `export async function act(input: unknown) {`,
      `  const blocked = await assertNotBlocked();`,
      `  if (blocked) return { ok: false };`,
      `  const row = await getContainer().files.get(input);`,
      `  const ctx = await requireAdmin('files:delete');`,
      `  return row;`,
      `}`,
    );
    expect(src).toContain(`requireAdmin('files:delete')`); // all the old test checked
    expect(problemOf(src, REQUIRE)).toMatch(/awaits `await getContainer\(\)\.files\.get\(input\)` before the guard/);
  });

  it.each([
    ['an await in a declaration', `const user = await currentUser();`],
    ['an await in a condition', `if (await isOwner()) return null;`],
    ['an await in an expression statement', `void (await audit());`],
    ['`for await`', `for await (const x of rows()) console.log(x);`],
    ['a nested function', `const later = async () => db.delete();`],
  ])('fails %s before the guard', (_, line) => {
    const src = `export async function act() {\n  ${line}\n  const ctx = await requireAdmin('files:delete');\n}\n`;
    expect(problemOf(src, REQUIRE)).not.toBeNull();
  });

  it.each([
    ['not awaited', `requireAdmin('files:delete');`, /not awaited/],
    ['in a branch', `if (input) { await requireAdmin('files:delete'); }`, /inside another expression/],
    ['wrapped in another call', `const ctx = await wrap(requireAdmin('files:delete'));`, /inside another expression/],
    ['with the wrong permission', `const ctx = await requireAdmin('files:read');`, /without 'files:delete'/],
    ['with an awaited argument', `const ctx = await requireAdmin(await pick());`, /awaits inside/],
  ])('fails a guard %s', (_, line, message) => {
    expect(problemOf(`export async function act(input: unknown) {\n  ${line}\n}\n`, REQUIRE)).toMatch(message);
  });

  it('fails a catch block that awaits around the guard (it can run before the guard)', () => {
    const src = lines(
      `export async function act(input: unknown) {`,
      `  try {`,
      `    const parsed = JSON.parse(String(input));`,
      `    const ctx = await requireAdmin('files:delete');`,
      `  } catch (e) {`,
      `    await logToFirestore(e);`,
      `  }`,
      `}`,
    );
    expect(problemOf(src, REQUIRE)).toMatch(/catch\/finally/);
  });

  it('fails a missing guard and a function it cannot see', () => {
    expect(problemOf(`export async function act() { await other(); }\n`, REQUIRE)).not.toBeNull();
    expect(problemOf(`export async function act() {}\n`, REQUIRE)).toMatch(/does not call requireAdmin/);
    expect(problemOf(`export const act = wrap(async () => {});\n`, REQUIRE)).toMatch(/not a plain function/);
  });

  it('passes the allowed shapes: block check, sync code and the props promise first; guard in a try', () => {
    const actionSrc = lines(
      `export async function act(input: unknown) {`,
      `  const blocked = await assertNotBlocked();`,
      `  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };`,
      `  if (isCrossSite(input)) return fail(403);`,
      `  try {`,
      `    const ctx = await requireAdmin('files:delete');`,
      `    await getContainer().files.delete(ctx, input);`,
      `  } catch (e) {`,
      `    return toActionFailure(e);`,
      `  }`,
      `}`,
    );
    expect(problemOf(actionSrc, REQUIRE)).toBeNull();

    const pageSrc = lines(
      `export default async function Page({ params }: { params: Promise<{ id: string }> }) {`,
      `  const { id } = await params;`,
      `  let ctx;`,
      `  try {`,
      `    ctx = await requireAdminPage('files:read', \`/admin/files/\${encodeURIComponent(id)}\`);`,
      `  } catch (e) {`,
      `    throw e;`,
      `  }`,
      `}`,
    );
    const pageGuard: Guard = { call: 'requireAdminPage', permission: 'files:read' };
    expect(problemOf(pageSrc, pageGuard, 'default', 'src/app/admin/x/page.tsx')).toBeNull();
  });

  it('follows `via` into a shared helper and checks its order too', () => {
    const src = (first: string) =>
      lines(
        `async function run(step: { permission: string }) {`,
        `  ${first}`,
        `  const ctx = await requireAdmin(step.permission);`,
        `}`,
        `export async function act() {`,
        `  const blocked = await assertNotBlocked();`,
        `  if (blocked) return null;`,
        `  return run({ permission: 'users:disable' });`,
        `}`,
      );
    const guard: Guard = { call: 'run', permission: 'users:disable', via: { call: 'requireAdmin', argText: 'step.permission' } };
    expect(problemOf(src(''), guard)).toBeNull();
    expect(problemOf(src('await getContainer().users.load();'), guard)).toMatch(/^run\(\): awaits/);
  });
});
