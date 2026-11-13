import { describe, expect, it } from 'vitest';
import { initialsFor, noticeFor, roleLabel, signInHref } from '@/features/admin/shell/account';

describe('initialsFor', () => {
  it.each([
    ['hammad.k@example.com', 'HK'],
    ['sara_ali@example.com', 'SA'],
    ['owner@example.com', 'O'],
    ['.x@example.com', 'X'],
    ['', '?'],
    [null, '?'],
  ])('%s → %s', (email, expected) => {
    expect(initialsFor(email)).toBe(expected);
  });
});

describe('roleLabel', () => {
  it('is sentence case', () => {
    expect([roleLabel('owner'), roleLabel('moderator'), roleLabel('viewer')]).toEqual(['Owner', 'Moderator', 'Viewer']);
  });
});

describe('signInHref', () => {
  it('returns to the admin path and query, URL-encoded', () => {
    expect(signInHref('/admin')).toBe('/admin/sign-in?next=%2Fadmin');
    expect(signInHref('/admin/files', 'type=chat')).toBe('/admin/sign-in?next=%2Fadmin%2Ffiles%3Ftype%3Dchat');
    expect(signInHref('/admin/files', '?type=chat')).toBe('/admin/sign-in?next=%2Fadmin%2Ffiles%3Ftype%3Dchat');
  });

  it('drops next for non-admin paths and for the sign-in page itself', () => {
    expect(signInHref('/dashboard')).toBe('/admin/sign-in');
    expect(signInHref('/administrator')).toBe('/admin/sign-in');
    expect(signInHref('/admin/sign-in', 'next=/admin')).toBe('/admin/sign-in');
  });

  it('adds a notice before next', () => {
    expect(signInHref('/admin', '', 'disabled')).toBe('/admin/sign-in?notice=disabled&next=%2Fadmin');
    expect(signInHref('/admin/sign-in', '', 'everywhere')).toBe('/admin/sign-in?notice=everywhere');
  });

  it('noticeFor maps only a disabled account', () => {
    expect(noticeFor('disabled')).toBe('disabled');
    expect(noticeFor('revoked')).toBeUndefined();
    expect(noticeFor('invalid_session')).toBeUndefined();
  });
});
