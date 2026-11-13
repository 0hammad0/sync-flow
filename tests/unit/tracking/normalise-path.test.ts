import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalisePath, referrerHost, utmFromSearch } from '@/features/tracking/normalise-path';
import { DYNAMIC_SEGMENT_LABELS, ROUTE_PATTERNS } from '@/features/tracking/routes';

const APP = join(process.cwd(), 'src/app');

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return /^page\.(t|j)sx?$/.test(name) ? [full] : [];
  });
}

/** `src/app/chat/[roomCode]/page.tsx` → `/chat/[code]`. Route groups `(x)` vanish. */
function patternOf(file: string): string {
  const segments = relative(APP, file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => {
      const dynamic = /^\[(.+)\]$/.exec(s);
      if (!dynamic) return s;
      const label = DYNAMIC_SEGMENT_LABELS[dynamic[1]];
      if (!label) throw new Error(`No label for dynamic segment ${s} in ${file}. Add it to DYNAMIC_SEGMENT_LABELS.`);
      return label;
    });
  return `/${segments.join('/')}`;
}

describe('route allowlist', () => {
  it('matches every public page under src/app (admin excluded)', () => {
    // /admin/** is never tracked, so it is skipped before mapping.
    const fromApp = pageFiles(APP)
      .filter((f) => relative(APP, f).split(sep)[0] !== 'admin')
      .map(patternOf);
    expect([...new Set(fromApp)].sort()).toEqual([...ROUTE_PATTERNS].sort());
  });
});

describe('normalisePath', () => {
  it.each(ROUTE_PATTERNS.filter((p) => !p.includes('[')))('keeps the static page %s', (pattern) => {
    expect(normalisePath(pattern)).toBe(pattern);
    expect(normalisePath(`${pattern}?utm_source=x&q=secret#frag`)).toBe(pattern);
    if (pattern !== '/') expect(normalisePath(`${pattern}/`)).toBe(pattern);
  });

  const SECRETS = ['AB12CD34', 'ab12cd34', 'tok_9f8e7d6c5b4a', 'x', 'room%20code', 'Zm9vYmFy-_.~'];

  it.each([
    ['/chat/', '/chat/[code]'],
    ['/share/', '/share/[token]'],
    ['/send/', '/send/[token]'],
  ])('replaces the secret in %s<secret> with %s', (prefix, pattern) => {
    for (const secret of SECRETS) {
      const out = normalisePath(`${prefix}${secret}?k=${secret}#${secret}`);
      expect(out).toBe(pattern);
      expect(out).not.toContain(secret);
    }
  });

  it('accepts absolute URLs and keeps only the pattern', () => {
    expect(normalisePath('https://syncflow.example/chat/AB12CD?utm_source=x')).toBe('/chat/[code]');
    expect(normalisePath('http://localhost:3000/share/abc')).toBe('/share/[token]');
  });

  it('collapses duplicate slashes', () => {
    expect(normalisePath('//chat//AB12CD//')).toBe('/chat/[code]');
  });

  it.each([
    '/admin',
    '/admin/files',
    '/admin/sign-in',
    '/api/e',
    '/api/chat/AB12CD/messages',
    '/chat/AB12CD/extra',
    '/share',
    '/send/a/b',
    '/Chat/AB12CD',
    '/wp-login.php',
    '/_next/static/chunk.js',
    '/robots.txt',
    'chat/AB12CD',
    'javascript:alert(1)',
    'https://evil.example',
    '',
    '/'.repeat(3000),
  ])('drops %s (not a tracked page)', (path) => {
    const out = normalisePath(path);
    // `https://evil.example` has path `/`, which is our home page pattern; never the host.
    if (path === 'https://evil.example') expect(out).toBe('/');
    else expect(out).toBeNull();
  });

  it('drops non-strings', () => {
    for (const value of [null, undefined, 42, {}, ['/chat']]) expect(normalisePath(value)).toBeNull();
  });
});

describe('utmFromSearch', () => {
  it('keeps only utm_source, utm_medium and utm_campaign', () => {
    expect(utmFromSearch('?utm_source=news&utm_medium=email&utm_campaign=launch&utm_term=x&code=AB12CD&token=t')).toEqual({
      utm_source: 'news',
      utm_medium: 'email',
      utm_campaign: 'launch',
    });
  });

  it('drops empty values, trims and caps at 100 chars', () => {
    expect(utmFromSearch('utm_source=%20%20&utm_medium=' + 'm'.repeat(150))).toEqual({ utm_medium: 'm'.repeat(100) });
    expect(utmFromSearch('')).toEqual({});
  });
});

describe('referrerHost', () => {
  it.each([
    ['https://News.Example.com/a/b?c=d', 'news.example.com'],
    ['news.example.com', 'news.example.com'],
    ['android-app://com.google.android.gm/', 'com.google.android.gm'],
    ['https://localhost:3000/chat/AB12CD', 'localhost'],
  ])('%s → %s', (input, host) => {
    expect(referrerHost(input)).toBe(host);
  });

  it.each(['', 'not a host!', 'https://', null, 42])('rejects %s', (input) => {
    expect(referrerHost(input)).toBeNull();
  });
});
