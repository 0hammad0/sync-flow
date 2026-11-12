// Dependency-free so both the proxy (middleware) and client code can use it.

/**
 * A same-site relative path to return to after sign-in, or null. Rejects
 * absolute URLs, protocol-relative "//host", backslash tricks, control
 * characters, and auth pages (which would bounce straight back).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  try {
    const url = new URL(raw, 'http://same.site');
    if (url.origin !== 'http://same.site') return null;
    if (url.pathname === '/login' || url.pathname.startsWith('/auth/')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
