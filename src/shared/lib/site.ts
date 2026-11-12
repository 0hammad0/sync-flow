/** Public project links — the only contact route is GitHub Issues. */
export const REPO_URL = 'https://github.com/0hammad0/sync-flow';
export const ISSUES_URL = 'https://github.com/0hammad0/sync-flow/issues';
export const LICENSE_URL = 'https://github.com/0hammad0/sync-flow/blob/main/LICENSE';

/** Base URL for metadata, sitemap and robots (same rules as the root layout). */
export function siteUrl(): URL {
  if (process.env.NEXT_PUBLIC_APP_URL) return new URL(process.env.NEXT_PUBLIC_APP_URL);
  if (process.env.VERCEL_URL) return new URL(`https://${process.env.VERCEL_URL}`);
  return new URL('http://localhost:3000');
}
