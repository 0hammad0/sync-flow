/**
 * Every public page the tracker may report, as a normalised pattern.
 * Built from `src/app/**`: tests/unit/tracking/normalise-path.test.ts walks
 * the app directory and fails when a public page is added, renamed or
 * removed without updating this list.
 *
 * Dynamic segments get a fixed label, never the value: room codes, file
 * share tokens and send-session tokens are capabilities and must never reach
 * analytics. `/admin/**` is never tracked, so it is not here.
 *
 * Shared by the client tracker and the server ingest: plain data, no imports.
 */
export const ROUTE_PATTERNS = [
  '/',
  '/auth/callback',
  '/chat',
  '/chat/[code]',
  '/dashboard',
  '/login',
  '/privacy',
  '/receive',
  '/send',
  '/send/[token]',
  '/share/[token]',
  '/terms',
] as const;

export type RoutePattern = (typeof ROUTE_PATTERNS)[number];

/**
 * Label used in a pattern for each dynamic folder name under `src/app`.
 * `[roomCode]` → `[code]`; both token kinds → `[token]`.
 */
export const DYNAMIC_SEGMENT_LABELS: Readonly<Record<string, string>> = {
  roomCode: '[code]',
  sessionToken: '[token]',
  token: '[token]',
};
