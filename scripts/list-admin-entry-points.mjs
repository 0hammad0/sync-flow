#!/usr/bin/env node
/**
 * Lists every way into the admin: pages, route handlers and server actions.
 * The integration test compares this list with a hand-written manifest of
 * required permissions, so a new entry point can't ship without an auth test.
 *
 * Output: JSON array of { kind, path, export?, method? } on stdout.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

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
