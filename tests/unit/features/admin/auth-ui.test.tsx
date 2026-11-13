import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  sendMagicLink: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/shared/lib/firebase/client', () => ({
  sendMagicLink: firebase.sendMagicLink,
  clientAuth: () => ({}),
  authErrorMessage: (err: { code?: string }) =>
    err?.code === 'auth/too-many-requests' ? 'Too many attempts. Wait a few minutes and try again.' : 'Something went wrong. Please try again.',
}));
vi.mock('firebase/auth', () => ({ signOut: firebase.signOut }));
vi.mock('@/shared/lib/auth-state', () => ({ clearAuthHint: vi.fn() }));

import AdminSignInForm from '@/features/admin/auth/AdminSignInForm';
import Forbidden from '@/features/admin/auth/Forbidden';
import { signOutAdmin } from '@/features/admin/auth/sign-out';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('AdminSignInForm', () => {
  it('has a labelled email field and validates before sending', async () => {
    const user = userEvent.setup();
    render(<AdminSignInForm next="/admin/files?type=chat" />);
    const field = screen.getByRole('textbox', { name: 'Email' });
    expect(field.getAttribute('type')).toBe('email');
    expect(field.getAttribute('autocomplete')).toBe('email');

    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter your email.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain('admin-sign-in-error');

    await user.type(field, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(screen.getByRole('alert').textContent).toMatch(/doesn’t look right/);
    expect(firebase.sendMagicLink).not.toHaveBeenCalled();
  });

  it('sends the link with the admin next path and shows "Check your email"', async () => {
    const user = userEvent.setup();
    firebase.sendMagicLink.mockResolvedValue(undefined);
    render(<AdminSignInForm next="/admin/files?type=chat" />);

    await user.type(screen.getByRole('textbox', { name: 'Email' }), ' sara@example.com ');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));

    expect(firebase.sendMagicLink).toHaveBeenCalledWith('sara@example.com', '/admin/files?type=chat');
    const heading = screen.getByRole('heading', { name: 'Check your email' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('sara@example.com').tagName).toBe('STRONG');
    expect((screen.getByRole('button', { name: /Resend in 30 s/ }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy();
  });

  it('shows Firebase errors in plain words', async () => {
    const user = userEvent.setup();
    firebase.sendMagicLink.mockRejectedValue({ code: 'auth/network-request-failed' });
    render(<AdminSignInForm next="/admin" />);
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'sara@example.com');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(screen.getByRole('alert').textContent).toBe('Could not send the link. Check your connection and try again.');
  });
});

describe('Forbidden', () => {
  it('names the signed-in account and offers sign out and back to site', () => {
    render(<Forbidden email="sara@example.com" />);
    expect(screen.getByRole('heading', { level: 1, name: 'This account isn’t an admin' })).toBeTruthy();
    expect(screen.getByText('sara@example.com').tagName).toBe('STRONG');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to site' }).getAttribute('href')).toBe('/');
  });

  it('works without an email', () => {
    render(<Forbidden email={null} />);
    expect(screen.getByText(/an account with no email/)).toBeTruthy();
  });
});

describe('signOutAdmin', () => {
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    firebase.signOut.mockResolvedValue(undefined);
  });

  it('clears the session, signs the client out and opens the sign-in page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await signOutAdmin()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/session', { method: 'DELETE' });
    expect(firebase.signOut).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/admin/sign-in');
  });

  it('everywhere: uses ?everywhere=1 and shows the notice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await signOutAdmin({ everywhere: true })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/session?everywhere=1', { method: 'DELETE' });
    expect(replace).toHaveBeenCalledWith('/admin/sign-in?notice=everywhere');
  });

  it('everywhere with a failed revoke: says other devices are still signed in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":false}', { status: 500 })));
    const result = await signOutAdmin({ everywhere: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/couldn’t sign out your other devices/);
    expect(firebase.signOut).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('network failure: stays signed in and says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const result = await signOutAdmin();
    expect(result.ok).toBe(false);
    expect(firebase.signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
