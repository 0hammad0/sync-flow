#!/usr/bin/env node
/**
 * Fails the build when a route ships too much JavaScript on first load.
 * Run after `next build`.
 *
 * Method (measured in admin phase 0.1): Next 16 writes
 * `.next/diagnostics/route-bundle-stats.json`, a list of
 * `{ route, firstLoadChunkPaths }`. Each chunk is gzipped (level 9) and summed.
 *
 * Budgets:
 * - Public routes: at most PUBLIC_MAX_BYTES. Baseline 2026-11-13: largest is
 *   484,800 B (`/`), so this catches a ~10 KB regression.
 * - Admin routes: at most ADMIN_EXTRA_BYTES above the shared floor (the
 *   smallest route, i.e. what every page already loads). Lazy chunks
 *   (charts, map, calendar) are not first load and do not count.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const STATS = '.next/diagnostics/route-bundle-stats.json';
const PUBLIC_MAX_BYTES = 495_000;
const ADMIN_EXTRA_BYTES = 120 * 1024;

if (!existsSync(STATS)) {
  console.error(`${STATS} not found. Run \`npm run build\` first (Next 16 Turbopack).`);
  process.exit(1);
}

const stats = JSON.parse(readFileSync(STATS, 'utf8'));
const gzCache = new Map();
const gz = (file) => {
  if (!gzCache.has(file)) gzCache.set(file, gzipSync(readFileSync(file), { level: 9 }).length);
  return gzCache.get(file);
};

const rows = stats
  .filter((s) => Array.isArray(s.firstLoadChunkPaths))
  .map((s) => ({
    route: s.route,
    bytes: s.firstLoadChunkPaths.filter((f) => f.endsWith('.js')).reduce((sum, f) => sum + gz(f), 0),
  }))
  .sort((a, b) => b.bytes - a.bytes);

if (rows.length === 0) {
  console.error(`${STATS} has no routes. Its format may have changed in this Next version.`);
  process.exit(1);
}

const isAdmin = (route) => route === '/admin' || route.startsWith('/admin/');
const floor = Math.min(...rows.filter((r) => !isAdmin(r.route)).map((r) => r.bytes));
const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

let failed = 0;
for (const { route, bytes } of rows) {
  const limit = isAdmin(route) ? floor + ADMIN_EXTRA_BYTES : PUBLIC_MAX_BYTES;
  const over = bytes > limit;
  if (over) failed++;
  console.log(`${over ? 'FAIL' : 'ok  '}  ${kib(bytes).padStart(10)}  / ${kib(limit).padEnd(10)} ${route}`);
}
console.log(`\nShared floor: ${kib(floor)}. ${rows.length} routes, ${failed} over budget.`);
process.exit(failed ? 1 : 0);
