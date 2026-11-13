import { describe, expect, it } from 'vitest';
import {
  effectivePin,
  isPinShortcut,
  isTypingTarget,
  nextPin,
  parseSidebarCookie,
  sidebarCookie,
} from '@/features/admin/shell/sidebar-state';

describe('parseSidebarCookie', () => {
  it('keeps the two stored values', () => {
    expect(parseSidebarCookie('pinned')).toBe('pinned');
    expect(parseSidebarCookie('rail')).toBe('rail');
  });

  it('falls back to auto for missing or unknown values', () => {
    for (const raw of [undefined, null, '', 'auto', 'PINNED', 'pinned; x', '1']) {
      expect(parseSidebarCookie(raw)).toBe('auto');
    }
  });
});

describe('sidebarCookie', () => {
  it('is path /admin, 1 year, SameSite=Lax', () => {
    expect(sidebarCookie('pinned', false)).toBe('sf_admin_sidebar=pinned; Path=/admin; Max-Age=31536000; SameSite=Lax');
  });

  it('adds Secure on https', () => {
    expect(sidebarCookie('rail', true)).toBe('sf_admin_sidebar=rail; Path=/admin; Max-Age=31536000; SameSite=Lax; Secure');
  });
});

describe('effectivePin (04-responsive.md "Sidebar default per viewport")', () => {
  const cases: [Parameters<typeof effectivePin>[0], number, 'pinned' | 'rail'][] = [
    ['auto', 800, 'rail'],
    ['auto', 1024, 'rail'],
    ['auto', 1279, 'rail'],
    ['auto', 1280, 'pinned'],
    ['rail', 1920, 'rail'],
    ['pinned', 834, 'rail'],
    ['pinned', 1024, 'pinned'],
  ];
  it.each(cases)('%s at %i px → %s', (mode, width, expected) => {
    expect(effectivePin(mode, width)).toBe(expected);
  });

  it('nextPin flips what is on screen', () => {
    expect(nextPin('auto', 1366)).toBe('rail');
    expect(nextPin('auto', 1100)).toBe('pinned');
    expect(nextPin('pinned', 1100)).toBe('rail');
    expect(nextPin('rail', 1920)).toBe('pinned');
  });
});

describe('isPinShortcut', () => {
  const key = (over: Partial<KeyboardEvent>) =>
    ({ key: 'b', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, ...over }) as KeyboardEvent;

  it('accepts ⌘B and Ctrl+B (any case)', () => {
    expect(isPinShortcut(key({ metaKey: true }))).toBe(true);
    expect(isPinShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isPinShortcut(key({ ctrlKey: true, key: 'B' }))).toBe(true);
  });

  it('rejects plain B, other keys, extra modifiers and key repeat', () => {
    expect(isPinShortcut(key({}))).toBe(false);
    expect(isPinShortcut(key({ metaKey: true, key: 'k' }))).toBe(false);
    expect(isPinShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isPinShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPinShortcut(key({ metaKey: true, repeat: true }))).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it('is true in inputs, textareas, selects and contenteditable', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false elsewhere', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY', isContentEditable: false })).toBe(false);
  });
});
