#!/usr/bin/env node
/**
 * Entry-point checks for CI (`npm run check:entry-points`).
 *
 * 1. Admin entry points (stdout, unchanged): every way into the admin, i.e.
 *    pages, route handlers and server actions, as a JSON array of
 *    { kind, path, export?, method? }. The integration test compares it with
 *    a hand-written manifest of required permissions.
 *
 * 2. Visitor-block check (T-27, phase 1.5): every action entry point (each
 *    route handler under src/app/api and each export of a 'use server' file)
 *    must call `assertNotBlocked(` in its own body, or be on BLOCK_ALLOWLIST
 *    with a reason. Problems go to stderr and the script exits 1.
 *    The proxy blocks action requests anyway; this is the second check
 *    (T-6 style), so a matcher gap cannot silently open a route.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const BLOCK_CHECK = 'assertNotBlocked';

/**
 * Action entry points that may skip `assertNotBlocked()`. `path` is a
 * repo-relative path or a RegExp; `name` limits it to one method or export.
 */
const BLOCK_ALLOWLIST = [
  { path: 'src/app/api/cleanup/route.ts', reason: 'CRON_SECRET cron: never blocked (T-27)' },
  { path: /^src\/app\/api\/admin\/cron\//, reason: 'CRON_SECRET cron: never blocked (T-27)' },
  { path: /^src\/app\/api\/e\//, reason: 'tracker: drops a blocked visitor itself with findBlock() and answers 204 (T-27)' },
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
const exportsOf = (src) =>
  [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// 1. Admin entry points (stdout)

const entries = [];

for (const file of walk(join(ROOT, 'src/app/admin'))) {
  if (file.endsWith('page.tsx')) entries.push({ kind: 'page', path: rel(file) });
}

const routeFiles = [...walk(join(ROOT, 'src/app/admin')), ...walk(join(ROOT, 'src/app/api/admin'))].filter((f) =>
  f.endsWith('route.ts')
);
for (const file of routeFiles) {
  for (const name of exportsOf(readFileSync(file, 'utf8'))) {
    if (METHODS.includes(name)) entries.push({ kind: 'route', path: rel(file), method: name });
  }
}

for (const file of walk(join(ROOT, 'src/features/admin'))) {
  if (!/actions\.tsx?$/.test(file)) continue;
  for (const name of exportsOf(readFileSync(file, 'utf8'))) {
    entries.push({ kind: 'action', path: rel(file), export: name });
  }
}

entries.sort((a, b) => `${a.path}${a.method ?? a.export ?? ''}`.localeCompare(`${b.path}${b.method ?? b.export ?? ''}`));
process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);

// ---------------------------------------------------------------------------
// 2. Visitor-block check (parsed with the TypeScript compiler, so comments,
//    strings and return types cannot fool it)

/** A file whose first statement is the 'use server' directive. */
function isServerActionFile(sf) {
  const first = sf.statements[0];
  return Boolean(
    first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use server'
  );
}

const hasExport = (node) => (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Top-level functions and consts by name, and the exported names. */
function declarations(sf) {
  const locals = new Map();
  const exported = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      locals.set(stmt.name.text, stmt);
      if (hasExport(stmt)) exported.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        locals.set(decl.name.text, decl);
        if (hasExport(stmt)) exported.push(decl.name.text);
      }
    }
  }
  return { locals, exported };
}

/** The function body behind a name, following `const GET = handler` aliases. null = not a plain function. */
function bodyOf(locals, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const node = locals.get(name);
  if (!node) return null;
  if (ts.isFunctionDeclaration(node)) return node.body ?? null;
  const init = node.initializer;
  if (!init) return null;
  if (ts.isIdentifier(init)) return bodyOf(locals, init.text, seen);
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init.body;
  return null;
}

function callsBlockCheck(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === BLOCK_CHECK) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function allowed(path, name) {
  return BLOCK_ALLOWLIST.find(
    (rule) =>
      (typeof rule.path === 'string' ? rule.path === path : rule.path.test(path)) && (!rule.name || rule.name === name)
  );
}

const actionEntries = [];
for (const file of walk(join(ROOT, 'src'))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const path = rel(file);
  const src = readFileSync(file, 'utf8');
  const isRoute = path.startsWith('src/app/') && /\/route\.ts$/.test(path);
  // Cheap pre-filter: only parse files that can hold an entry point.
  if (!isRoute && !src.includes('use server')) continue;
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (!isRoute && !isServerActionFile(sf)) continue;
  const { locals, exported } = declarations(sf);
  for (const name of exported) {
    if (isRoute && !METHODS.includes(name)) continue;
    actionEntries.push({ kind: isRoute ? 'route' : 'action', path, name, body: bodyOf(locals, name) });
  }
}

const problems = [];
for (const entry of actionEntries) {
  if (allowed(entry.path, entry.name)) continue;
  if (!entry.body) {
    problems.push(`${entry.path} ${entry.name}: not a plain function, so the check cannot be seen; write it as one or allowlist it`);
  } else if (!callsBlockCheck(entry.body)) {
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
  process.exit(1);
}
process.stderr.write(`Visitor-block check: ${actionEntries.length} action entry points, all checked or allowlisted.\n`);
