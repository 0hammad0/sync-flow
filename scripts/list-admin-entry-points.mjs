#!/usr/bin/env node
/**
 * Entry-point checks for CI (`npm run check:entry-points`).
 *
 * Parsing lives in ./admin-entry-points-lib.mjs (shared with the test, which
 * also feeds it fixture sources). Fail closed: anything it cannot classify
 * fails the run (check 4).
 *
 * 1. Admin entry points (stdout): every way into the admin, i.e. pages,
 *    route handlers and server actions, as a JSON array of
 *    { kind, path, export?, method? }. Pages under src/app/admin; route
 *    handlers and every export of a 'use server' file (any file name, every
 *    export form) under src/app/admin, src/app/api/admin and
 *    src/features/admin; plus any page, route or 'use server' file elsewhere
 *    that calls requireAdmin / requireAdminPage / requireAdminForRoute.
 *    The integration test compares it with a hand-written manifest of
 *    required guards and checks each guard runs first.
 *
 * 2. Visitor-block check (T-27, phase 1.5): every action entry point (each
 *    route handler under src/app and each export of a 'use server' file)
 *    must call `assertNotBlocked(` in its own body, or be on BLOCK_ALLOWLIST
 *    with a reason. Problems go to stderr and the script exits 1.
 *    The proxy blocks action requests anyway; this is the second check
 *    (T-6 style), so a matcher gap cannot silently open a route.
 *
 * 3. Admin write-limit check (phase 5.4): every export of an admin
 *    'use server' file (the action entries of check 1) must call
 *    `enforceAdminWriteLimit(` (30 writes a minute per admin), in its own
 *    body or in a function of the same file that it calls (users/actions.ts
 *    calls it once in its shared `run()`). A read-only action goes on
 *    WRITE_LIMIT_ALLOWLIST with a reason. Same stderr + exit 1 as check 2.
 *
 * 4. Unclassifiable entry points: an inline 'use server' function anywhere
 *    under src, or an export form whose body cannot be seen in a
 *    'use server' or route file (`export * from`, `export { x } from`,
 *    destructured exports, classes…). Same stderr + exit 1.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BLOCK_CHECK, WRITE_LIMIT, calls, scanSources } from './admin-entry-points-lib.mjs';

const ROOT = process.cwd();

/**
 * Admin server actions that may skip `enforceAdminWriteLimit()`: read-only
 * ones only (nothing written, nothing deleted). Same shape as BLOCK_ALLOWLIST.
 */
const WRITE_LIMIT_ALLOWLIST = [
  {
    path: 'src/features/admin/shell/actions.ts',
    name: 'searchAdmin',
    reason: 'command palette search: read only (at most 2 point reads through QuotaGuard), nothing written',
  },
];

/**
 * Action entry points that may skip `assertNotBlocked()`. `path` is a
 * repo-relative path or a RegExp; `name` limits it to one method or export.
 *
 * Not here on purpose: `unblockSubject` (src/features/admin/access/actions.ts).
 * The proxy lets `POST /admin/access` through (isBlockExempt, owner lockout) and
 * the action skips its check for an owner only, so it still calls
 * assertNotBlocked() for every other role and stays under this check.
 */
const BLOCK_ALLOWLIST = [
  { path: 'src/app/api/cleanup/route.ts', reason: 'CRON_SECRET cron: never blocked (T-27)' },
  { path: /^src\/app\/api\/admin\/cron\//, reason: 'CRON_SECRET cron: never blocked (T-27)' },
  { path: /^src\/app\/api\/e\//, reason: 'tracker: drops a blocked visitor itself with findBlock() and answers 204 (T-27)' },
  {
    path: 'src/app/api/csp-report/route.ts',
    name: 'POST',
    reason: 'browser CSP reports: rate-limited console log only, no data read or written, always 204; a blocklist read per report would cost more than the report',
  },
  { path: 'src/app/api/session/route.ts', name: 'DELETE', reason: 'sign-out must always work (T-27)' },
  { path: 'src/app/blocked/route.ts', name: 'GET', reason: 'the blocked explainer: a page view that must never read the blocklist' },
  { path: 'src/app/api/ai/route.ts', name: 'GET', reason: 'read-only feature discovery, no data; the proxy still checks it' },
  {
    path: 'src/app/api/chat/[roomCode]/route.ts',
    name: 'GET',
    reason: 'read-only room metadata (also public through client Firestore reads); the proxy still checks it',
  },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rel = (f) => relative(ROOT, f).split(sep).join('/');

function allowed(path, name, list = BLOCK_ALLOWLIST) {
  return list.find(
    (rule) =>
      (typeof rule.path === 'string' ? rule.path === path : rule.path.test(path)) && (!rule.name || rule.name === name)
  );
}

const files = walk(join(ROOT, 'src')).map((file) => ({ path: rel(file), src: readFileSync(file, 'utf8') }));
const { entries, actionEntries, unknown } = scanSources(files);

// ---------------------------------------------------------------------------
// 1. Admin entry points (stdout)

process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);

// ---------------------------------------------------------------------------
// 2 + 3. Visitor-block and admin write-limit checks

const problems = [];
const limitProblems = [];
let adminActions = 0;
for (const entry of actionEntries) {
  if (entry.admin) {
    adminActions += 1;
    if (!allowed(entry.path, entry.name, WRITE_LIMIT_ALLOWLIST)) {
      if (!entry.body) {
        limitProblems.push(`${entry.path} ${entry.name}: not a plain function, so the check cannot be seen; write it as one or allowlist it`);
      } else if (!calls(entry.body, WRITE_LIMIT, entry.locals)) {
        limitProblems.push(`${entry.path} ${entry.name}: admin action does not call enforceAdminWriteLimit()`);
      }
    }
  }
  if (allowed(entry.path, entry.name)) continue;
  if (!entry.body) {
    problems.push(`${entry.path} ${entry.name}: not a plain function, so the check cannot be seen; write it as one or allowlist it`);
  } else if (!calls(entry.body, BLOCK_CHECK)) {
    problems.push(`${entry.path} ${entry.name}: ${entry.kind} does not call assertNotBlocked()`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `\nVisitor-block check failed (${problems.length}). Call assertNotBlocked() first thing, ` +
      `or add the entry to BLOCK_ALLOWLIST in scripts/list-admin-entry-points.mjs with a reason:\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      '\n'
  );
}
if (limitProblems.length > 0) {
  process.stderr.write(
    `\nAdmin write-limit check failed (${limitProblems.length}). Call enforceAdminWriteLimit(ctx) right after requireAdmin(), ` +
      `or, for a read-only action, add it to WRITE_LIMIT_ALLOWLIST in scripts/list-admin-entry-points.mjs with a reason:\n` +
      limitProblems.map((p) => `  - ${p}`).join('\n') +
      '\n'
  );
}
if (unknown.length > 0) {
  process.stderr.write(
    `\nEntry-point scan failed (${unknown.length}): these cannot be classified, so no check can see them:\n` +
      unknown.map((p) => `  - ${p}`).join('\n') +
      '\n'
  );
}
if (problems.length > 0 || limitProblems.length > 0 || unknown.length > 0) process.exit(1);
process.stderr.write(`Visitor-block check: ${actionEntries.length} action entry points, all checked or allowlisted.\n`);
process.stderr.write(`Admin write-limit check: ${adminActions} admin actions, all limited or allowlisted.\n`);
