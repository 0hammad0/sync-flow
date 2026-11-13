import { describe, expect, it } from 'vitest';

import { isActionRequest, isBlockExempt } from '@/server/blocklist/is-action-request';

describe('isActionRequest', () => {
  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('/api/** with %s is an action', (method) => {
    expect(isActionRequest(method, '/api/upload')).toBe(true);
    expect(isActionRequest(method, '/api/chat/ABC123/messages')).toBe(true);
  });

  it('POST to a page (server action, with or without next-action) is an action', () => {
    expect(isActionRequest('POST', '/share/abc')).toBe(true);
    expect(isActionRequest('POST', '/')).toBe(true);
    expect(isActionRequest('post', '/dashboard')).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s page view is not an action', (method) => {
    for (const path of ['/', '/share/abc', '/admin', '/admin/access', '/blocked', '/dashboard']) {
      expect(isActionRequest(method, path)).toBe(false);
    }
  });

  it('never-blocked requests are not actions', () => {
    expect(isActionRequest('GET', '/api/cleanup')).toBe(false);
    expect(isActionRequest('POST', '/api/cleanup')).toBe(false);
    expect(isActionRequest('POST', '/api/admin/cron/rollup')).toBe(false);
    expect(isActionRequest('GET', '/api/admin/cron')).toBe(false);
    expect(isActionRequest('DELETE', '/api/session')).toBe(false);
    expect(isActionRequest('POST', '/api/e')).toBe(false);
  });

  it('only those exact routes are exempt', () => {
    expect(isActionRequest('POST', '/api/session')).toBe(true);
    expect(isActionRequest('POST', '/api/events')).toBe(true);
    expect(isActionRequest('POST', '/api/cleanup-now')).toBe(true);
    expect(isActionRequest('POST', '/api/admin/files')).toBe(true);
    expect(isBlockExempt('DELETE', '/api/session/x')).toBe(false);
  });
});
