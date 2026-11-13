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

  it('ignores files that are not entry points', () => {
    const run = fixture({ 'src/shared/lib/util.ts': `export async function helper() {}\n` });
    expect(run.status).toBe(0);
  });
});
