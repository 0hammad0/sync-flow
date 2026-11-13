import { describe, expect, it } from 'vitest';

import { parsePagesParams } from '@/features/admin/pages/schemas';

describe('pages URL params', () => {
  it('defaults: all pages, most viewed first, first page, no panel', () => {
    expect(parsePagesParams({})).toEqual({ q: '', mode: 'all', sort: '-pageviews', cursor: 0, path: null, pathIsKnown: false });
    expect(parsePagesParams(undefined)).toMatchObject({ mode: 'all', sort: '-pageviews' });
  });

  it('unknown mode falls back to all, silently', () => {
    expect(parsePagesParams({ mode: 'bounces' }).mode).toBe('all');
    expect(parsePagesParams({ mode: 'entry' })).toMatchObject({ mode: 'entry', sort: '-entries' });
    expect(parsePagesParams({ mode: ['exit', 'entry'] })).toMatchObject({ mode: 'exit', sort: '-exits' });
  });

  it('keeps a sort the mode allows, else the mode default', () => {
    expect(parsePagesParams({ sort: 'avgScroll' }).sort).toBe('avgScroll');
    expect(parsePagesParams({ sort: '-entries' }).sort).toBe('-pageviews');
    expect(parsePagesParams({ mode: 'exit', sort: '-visitors' }).sort).toBe('-exits');
    expect(parsePagesParams({ sort: '-__proto__' }).sort).toBe('-pageviews');
  });

  it('cursor is a row offset; anything else is the first page', () => {
    expect(parsePagesParams({ cursor: '25' }).cursor).toBe(25);
    expect(parsePagesParams({ cursor: '-25' }).cursor).toBe(0);
    expect(parsePagesParams({ cursor: 'abc' }).cursor).toBe(0);
    expect(parsePagesParams({ cursor: '99999999' }).cursor).toBe(0);
  });

  it('trims and caps the search', () => {
    expect(parsePagesParams({ q: '  /chat ' }).q).toBe('/chat');
    expect(parsePagesParams({ q: 'x'.repeat(500) }).q).toHaveLength(200);
  });

  it('flags ?path= that is not a tracked route (no query runs for it)', () => {
    expect(parsePagesParams({ path: '/chat/[code]' })).toMatchObject({ path: '/chat/[code]', pathIsKnown: true });
    expect(parsePagesParams({ path: '/chat/ABCD2345' })).toMatchObject({ path: '/chat/ABCD2345', pathIsKnown: false });
    expect(parsePagesParams({ path: '_other' })).toMatchObject({ pathIsKnown: false });
    expect(parsePagesParams({ path: '' })).toMatchObject({ path: null, pathIsKnown: false });
  });
});
