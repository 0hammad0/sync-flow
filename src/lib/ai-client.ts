'use client';

// Thin client for /api/ai. The route streams plain text (already unwrapped
// from the provider's SSE), so consuming it is just reading body chunks.

export class AiError extends Error {}

export interface AiPayload {
  task: 'replies' | 'summary' | 'rewrite' | 'translate' | 'explain';
  transcript?: string;
  me?: string;
  text?: string;
  instruction?: string;
  target?: string;
  code?: string;
  lang?: string;
}

/**
 * POST the task and stream the response. `onUpdate` receives the full
 * accumulated text after every chunk (convenient for setState). Returns
 * the final trimmed text.
 */
export async function streamAi(
  payload: AiPayload,
  onUpdate?: (fullText: string) => void
): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `AI request failed (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* keep default */
    }
    throw new AiError(message);
  }

  if (!res.body) throw new AiError('Empty AI response');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    if (full) onUpdate?.(full);
  }
  return full.trim();
}

export interface AiAvailability {
  enabled: boolean;
  tasks: string[];
}

let availabilityPromise: Promise<AiAvailability> | null = null;

/**
 * Which AI tasks the server currently offers (cached per page load).
 * UI components call this and only render controls for available tasks —
 * with no API key configured, every AI control simply disappears.
 */
export function getAiAvailability(): Promise<AiAvailability> {
  availabilityPromise ??= fetch('/api/ai')
    .then((r) => (r.ok ? r.json() : { enabled: false, tasks: [] }))
    .catch(() => ({ enabled: false, tasks: [] }));
  return availabilityPromise;
}

/**
 * Free models sprinkle markdown (backticks, **bold**) into answers even
 * when told not to; AI panels render plain text, so strip the tokens.
 */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,4}\s+/gm, '');
}

/** Browser language as a human name ("English", "Urdu") for translate targets. */
export function browserLanguageName(): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(
      navigator.language.split('-')[0]
    );
    return name || 'English';
  } catch {
    return 'English';
  }
}
