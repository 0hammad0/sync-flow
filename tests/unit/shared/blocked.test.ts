import { describe, expect, it } from 'vitest';
import { BLOCKED_MESSAGE, blockedError, blockedHref, blockedRef, blockedText } from '@/shared/lib/blocked';

const REF = 'ABCDEF-2611141402';

describe('blocked handler', () => {
  it('reads the ref from every shape a block reaches the browser in', () => {
    expect(blockedRef({ success: false, error: 'blocked', ref: REF })).toBe(REF);
    expect(blockedRef(new Error(`{"error":"blocked","ref":"${REF}"}`))).toBe(REF);
    expect(blockedRef(`{"error":"blocked","ref":"${REF}"}`)).toBe(REF);
    expect(blockedRef(blockedText(REF))).toBe(REF);
  });

  it('is null (blocked, no ref) or undefined (not a block)', () => {
    expect(blockedRef({ error: 'blocked' })).toBeNull();
    expect(blockedRef(BLOCKED_MESSAGE)).toBeNull();
    expect(blockedRef({ error: 'invalid' })).toBeUndefined();
    expect(blockedRef(new Error('Network error'))).toBeUndefined();
    expect(blockedRef('{"error":"blocked"')).toBeUndefined();
    expect(blockedRef(null)).toBeUndefined();
  });

  it('blockedError gives the flow text or null', () => {
    expect(blockedError({ error: 'blocked', ref: REF })).toBe(`${BLOCKED_MESSAGE} (ref ${REF})`);
    expect(blockedError('Upload failed')).toBeNull();
  });

  it('links to the explainer page', () => {
    expect(blockedHref(REF)).toBe(`/blocked?ref=${REF}`);
    expect(blockedHref(null)).toBe('/blocked');
  });
});
