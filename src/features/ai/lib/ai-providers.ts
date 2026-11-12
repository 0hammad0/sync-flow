// Server-side helpers for /api/ai. Each provider's SSE stream is turned into
// the same plain text stream, so the browser can't tell who answered.

import { geminiModel, type BuiltPrompt } from './ai-config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The OpenAI-style messages every provider gets for a prompt. */
export function chatMessages(prompt: BuiltPrompt): ChatMessage[] {
  return [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
}

/** Hands out the text deltas of an SSE body one by one; null once it ends. */
export interface DeltaReader {
  next(): Promise<string | null>;
  cancel(): void;
}

export function sseDeltas(
  body: ReadableStream<Uint8Array>,
  extract: (data: unknown) => string
): DeltaReader {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const ready: string[] = [];
  let buf = '';
  let ended = false;

  const take = (lines: string[]) => {
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const delta = extract(JSON.parse(data));
        if (delta) ready.push(delta);
      } catch {
        /* ignore malformed keep-alive lines */
      }
    }
  };

  return {
    async next() {
      while (!ready.length && !ended) {
        const { done, value } = await reader.read();
        if (done) {
          ended = true;
          take((buf + decoder.decode()).split('\n'));
        } else {
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          take(lines);
        }
      }
      return ready.shift() ?? null;
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  };
}

/**
 * Wait for the first piece of text, then stream it and the rest as plain
 * text. Returns null when the source ends or fails before any text — the
 * caller can still try another provider, since nothing reached the client.
 */
export async function startTextStream(
  src: DeltaReader
): Promise<ReadableStream<Uint8Array> | null> {
  let first: string | null = null;
  try {
    first = await src.next();
  } catch {
    /* treated as no text */
  }
  if (first === null) {
    src.cancel();
    return null;
  }
  const encoder = new TextEncoder();
  const head = first;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(head));
    },
    async pull(controller) {
      // A failure after text was sent just ends the answer (no switching).
      try {
        const delta = await src.next();
        if (delta === null) controller.close();
        else controller.enqueue(encoder.encode(delta));
      } catch {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      src.cancel();
    },
  });
}

/* ------------------------------ OpenRouter ------------------------------ */

interface OpenRouterChunk {
  choices?: { delta?: { content?: unknown } }[];
}

export function openRouterDelta(data: unknown): string {
  const delta = (data as OpenRouterChunk)?.choices?.[0]?.delta?.content;
  return typeof delta === 'string' ? delta : '';
}

/**
 * Upstream statuses worth retrying on Gemini: OpenRouter's own account,
 * routing or capacity problems. 400 (bad params), 403 (moderation or
 * guardrail block) and other 4xx come from the request itself, so they
 * are returned as before instead.
 */
export function openRouterShouldFallBack(status: number): boolean {
  return status < 400 || [401, 402, 404, 408, 429].includes(status) || status >= 500;
}

/* -------------------------------- Gemini -------------------------------- */

// How long Gemini gets to send its first piece of text.
const GEMINI_FIRST_TEXT_MS = 20_000;

/** Map OpenAI-style messages to a Gemini generateContent request body. */
export function geminiRequest(
  messages: ChatMessage[],
  prompt: BuiltPrompt,
  model: string,
  minimalThinking = /^gemini-([3-9]|\d\d)/.test(model)
) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  return {
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
    contents,
    generationConfig: {
      maxOutputTokens: prompt.maxTokens,
      // Gemini 3.6+ ignores this; older models still use it.
      temperature: prompt.temperature,
      // Gemini 3+ thinks by default and thinking tokens count toward
      // maxOutputTokens, so keep it minimal. Older models reject this field,
      // and some 3.x models don't offer "minimal" (streamGemini retries
      // without it on a 400).
      ...(minimalThinking && {
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
      }),
    },
  };
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: unknown; thought?: boolean }[] } }[];
}

export function geminiDelta(data: unknown): string {
  const parts = (data as GeminiChunk)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => !p?.thought && typeof p?.text === 'string')
    .map((p) => p.text as string)
    .join('');
}

/**
 * Ask Gemini once, streamed. Returns the plain text stream, or null when
 * Gemini fails or sends no text. The key goes in a header, never the URL.
 */
export async function streamGemini(
  apiKey: string,
  messages: ChatMessage[],
  prompt: BuiltPrompt,
  signal: AbortSignal
): Promise<ReadableStream<Uint8Array> | null> {
  const model = geminiModel();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), GEMINI_FIRST_TEXT_MS);
  const post = (body: ReturnType<typeof geminiRequest>) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      signal: AbortSignal.any([signal, deadline.signal]),
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const body = geminiRequest(messages, prompt, model);
    let res = await post(body);
    // A model that doesn't accept the thinking setting answers 400: ask
    // once more without it (same deadline).
    if (res.status === 400 && body.generationConfig.thinkingConfig) {
      await res.body?.cancel().catch(() => {});
      res = await post(geminiRequest(messages, prompt, model, false));
    }
    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json())?.error?.message || detail;
      } catch {
        /* keep status text */
      }
      console.error('AI fallback (Gemini) error:', String(detail).slice(0, 300));
      return null;
    }
    const stream = await startTextStream(sseDeltas(res.body, geminiDelta));
    if (!stream && !signal.aborted) console.error('AI fallback (Gemini) sent no text');
    return stream;
  } catch (err) {
    if (!signal.aborted) console.error('AI fallback (Gemini) failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
