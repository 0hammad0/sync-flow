import { describe, expect, it } from 'vitest';

import { pagePath } from '@/features/tracking/client/page-path';
import { normalisePath } from '@/features/tracking/normalise-path';
import { ROUTE_PATTERNS } from '@/features/tracking/routes';

/** A concrete path for a pattern: each dynamic label becomes a secret-looking value. */
const concrete = (pattern: string) => pattern.replace('[code]', 'AB12CD').replace('[token]', 'tok_9f8e7d6c5b4a');

describe('pagePath (browser twin of normalisePath)', () => {
  it.each(ROUTE_PATTERNS.map((p) => [p]))('%s: same answer as normalisePath, and no code or token left', (pattern) => {
    const path = concrete(pattern);
    expect(pagePath(path)).toBe(pattern);
    expect(pagePath(path)).toBe(normalisePath(path));
    expect(pagePath(path)).not.toMatch(/AB12CD|tok_/);
  });

  it.each([
    '/admin',
    '/admin/health',
    '/api/e',
    '/chat/AB12CD/extra',
    '/share',
    '/share/a/b',
    '/send/x/y',
    '/nope',
    '',
  ])('%s is not a tracked page (never sent)', (path) => {
    expect(pagePath(path)).toBeNull();
    expect(normalisePath(path)).toBeNull();
  });
});
