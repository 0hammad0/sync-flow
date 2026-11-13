// One shared handler for "this visitor is blocked" in the public flows
// (upload, send, chat, download, delete, reshare). Spec:
// docs/admin/03-features/10-access-control.md ("What the blocked visitor sees").
//
// A block reaches the browser in three shapes:
// 1. `/api/**` JSON:          { success: false, error: 'blocked', ref }
// 2. A server action result:  { success: false, error: 'blocked', ref }
// 3. A server action the proxy stopped: the Next client throws
//    `new Error('{"error":"blocked","ref":"…"}')` (403 text/plain body).
// The flows keep their `error: string` state, so the blocked case travels as
// blockedText(ref) and <ActionError> turns it back into message + link.

export const BLOCKED_MESSAGE = "You can't do this right now.";

const TEXT = /^You can't do this right now\.(?: \(ref ([A-Z0-9-]{1,40})\))?$/;

/** The error string a flow stores for a blocked action. Reads well even where it is shown as plain text. */
export function blockedText(ref?: string | null): string {
  return ref ? `${BLOCKED_MESSAGE} (ref ${ref})` : BLOCKED_MESSAGE;
}

/** The ref of a blocked response, result, thrown error or blockedText string; `undefined` when it is not a block. */
export function blockedRef(value: unknown): string | null | undefined {
  if (typeof value === 'string') {
    const text = TEXT.exec(value);
    if (text) return text[1] ?? null;
    if (!value.startsWith('{"error":"blocked"')) return undefined;
    try {
      return blockedRef(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (value instanceof Error) return blockedRef(value.message);
  if (value && typeof value === 'object' && (value as { error?: unknown }).error === 'blocked') {
    const ref = (value as { ref?: unknown }).ref;
    return typeof ref === 'string' ? ref : null;
  }
  return undefined;
}

/** blockedText() for a blocked value, else null. `if (b) return setError(b)`. */
export function blockedError(value: unknown): string | null {
  const ref = blockedRef(value);
  return ref === undefined ? null : blockedText(ref);
}

/** The plain explainer page. Never reads the blocklist; the ref comes from here. */
export function blockedHref(ref: string | null): string {
  return ref ? `/blocked?ref=${encodeURIComponent(ref)}` : '/blocked';
}
