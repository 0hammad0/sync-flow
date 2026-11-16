import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// `npm run check:entry-points` (scripts/list-admin-entry-points.mjs), part 2:
// the visitor-block check. Runs the real script against a fixture tree.
const SCRIPT = resolve(__dirname, '../../../scripts/list-admin-entry-points.mjs');
let dirs: string[] = [];

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'entry-points-'));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  // `import ts from 'typescript'` resolves from the script's own node_modules.
  return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const CHECKED = `export async function POST() {\n  const blocked = await assertNotBlocked();\n  if (blocked) return x;\n  return y;\n}\n`;

describe('check:entry-points visitor-block check', () => {
  it('passes when every route handler and server action calls assertNotBlocked()', () => {
    const run = fixture({
      'src/app/api/upload/route.ts': CHECKED,
      'src/features/files/server/files.ts': `'use server';\nexport async function deleteFile(t: string): Promise<{ ok: boolean }> {\n  const blocked = await assertNotBlocked();\n  return { ok: !blocked };\n}\n`,
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(/2 action entry points/);
    expect(JSON.parse(run.stdout)).toEqual([]);
  });

  it('fails on a route handler without the check', () => {
    const run = fixture({ 'src/app/api/upload/route.ts': `export async function POST() {\n  return new Response('x');\n}\n` });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/src\/app\/api\/upload\/route\.ts POST: route does not call assertNotBlocked\(\)/);
  });

  it('fails on a use-server export without the check, even if a comment names it', () => {
    const run = fixture({
      'src/features/x/actions.ts': `// docs\n'use server';\nexport async function doIt() {\n  // assertNotBlocked() is called elsewhere\n  const s = 'assertNotBlocked()';\n  return s;\n}\n`,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/src\/features\/x\/actions\.ts doIt: action does not call/);
  });

  it('follows `export const GET = handler` aliases', () => {
    const ok = fixture({
      'src/app/api/thing/route.ts': `async function handler() {\n  await assertNotBlocked();\n}\nexport const GET = handler;\nexport const POST = handler;\n`,
    });
    expect(ok.status).toBe(0);
    const bad = fixture({ 'src/app/api/thing/route.ts': `async function handler() {}\nexport const GET = handler;\n` });
    expect(bad.status).toBe(1);
  });

  it('honours the allowlist: cron, sign-out, tracker', () => {
    const run = fixture({
      'src/app/api/cleanup/route.ts': `async function run() {}\nexport const GET = run;\nexport const POST = run;\n`,
      'src/app/api/admin/cron/rollup/route.ts': `export async function GET() {}\n`,
      'src/app/api/e/route.ts': `export async function POST() {}\n`,
      'src/app/api/session/route.ts': `${CHECKED}export async function DELETE() {}\n`,
    });
    expect(run.status).toBe(0);
  });

  it('passes an action that skips the check for one role only (unblockSubject, owner lockout)', () => {
    const run = fixture({
      'src/features/admin/access/actions.ts': `'use server';\nexport async function unblockSubject(input: unknown) {\n  const ctx = await requireAdmin('blocks:write');\n  enforceAdminWriteLimit(ctx);\n  if (ctx.role !== 'owner') {\n    const blocked = await assertNotBlocked();\n    if (blocked) return { ok: false };\n  }\n  return { ok: true };\n}\n`,
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(/1 action entry points/);
  });

  it('ignores files that are not entry points', () => {
    const run = fixture({ 'src/shared/lib/util.ts': `export async function helper() {}\n` });
    expect(run.status).toBe(0);
  });
});

// Part 3: the admin write-limit check (phase 5.4).
const adminAction = (body: string) =>
  `'use server';\nexport async function doIt(input: unknown) {\n  const blocked = await assertNotBlocked();\n  if (blocked) return { ok: false };\n${body}  return { ok: true };\n}\n`;

describe('check:entry-points admin write-limit check', () => {
  it('passes an admin action that calls enforceAdminWriteLimit() after requireAdmin()', () => {
    const run = fixture({
      'src/features/admin/x/actions.ts': adminAction(`  const ctx = await requireAdmin('x:write');\n  enforceAdminWriteLimit(ctx);\n`),
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(/Admin write-limit check: 1 admin actions/);
  });

  it('flags an admin write action without it, even if a comment or string names it', () => {
    const run = fixture({
      'src/features/admin/x/actions.ts': adminAction(`  // enforceAdminWriteLimit(ctx) later\n  const s = 'enforceAdminWriteLimit(ctx)';\n  await requireAdmin('x:write');\n`),
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/src\/features\/admin\/x\/actions\.ts doIt: admin action does not call enforceAdminWriteLimit\(\)/);
    expect(run.stderr).not.toMatch(/Visitor-block check failed/);
  });

  it('follows a shared helper in the same file (users/actions.ts run())', () => {
    const shared = (inner: string) =>
      `'use server';\nasync function run(p: string) {\n  const ctx = await requireAdmin(p);\n${inner}  return { ok: true };\n}\n` +
      `export async function a() {\n  const blocked = await assertNotBlocked();\n  if (blocked) return { ok: false };\n  return run('x:write');\n}\n`;
    expect(fixture({ 'src/features/admin/users/actions.ts': shared('  enforceAdminWriteLimit(ctx);\n') }).status).toBe(0);
    const bad = fixture({ 'src/features/admin/users/actions.ts': shared('') });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/users\/actions\.ts a: admin action does not call enforceAdminWriteLimit/);
  });

  it('does not apply to server actions outside the admin', () => {
    const run = fixture({ 'src/features/files/server/files.ts': adminAction('') });
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(/Admin write-limit check: 0 admin actions/);
  });
});
