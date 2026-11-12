import { NextRequest, NextResponse } from 'next/server';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { getRoom, isRoomExpired } from '@/shared/lib/firebase/chat';
import { isValidRoomCode } from '@/shared/lib/utils';
import {
  aiDailyLimit,
  aiRateLimitPerMinute,
  buildPrompt,
  enabledTasks,
  isAiConfigured,
  modelList,
  type AiRequestBody,
} from '@/features/ai/lib/ai-config';
import {
  chatMessages,
  openRouterDelta,
  openRouterShouldFallBack,
  sseDeltas,
  startTextStream,
  streamGemini,
} from '@/features/ai/lib/ai-providers';

export const runtime = 'nodejs';

const UNAVAILABLE = 'AI is unavailable right now. Try again later.';

// With Gemini as a fallback, OpenRouter gets this long to send its first text.
const OPENROUTER_FIRST_TEXT_MS = 15_000;

/** The plain text stream the browser reads, whichever provider answered. */
function textResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Global daily budget for the operator's AI keys. In-memory, so it is
// per server instance (each warm instance gets its own allowance) — good
// enough to stop a runaway client from spending the key overnight.
let dayKey = '';
let dayCount = 0;
function takeDailySlot(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (dayCount >= aiDailyLimit()) return false;
  dayCount++;
  return true;
}

/**
 * GET — feature discovery. The UI calls this once and only renders AI
 * controls for the tasks that are actually available, so features can be
 * enabled/disabled purely through env config.
 */
export async function GET() {
  return NextResponse.json({ enabled: isAiConfigured(), tasks: enabledTasks() });
}

/**
 * POST — run an AI task; the response is a plain text stream. Only usable
 * from inside a live chat room: the body must carry the code of an existing,
 * unexpired room, so the operator's key is not an open proxy.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !geminiKey) {
    // Operator-facing detail stays in the logs, not in the user's face.
    console.warn('AI request rejected: neither OPENROUTER_API_KEY nor GEMINI_API_KEY is set');
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
  }

  // Free-tier models are heavily rate-limited upstream anyway; keep one
  // client from burning the whole allowance.
  const rl = rateLimit(`ai:${clientKey(request)}`, aiRateLimitPerMinute(), 60_000);
  if (!rl.allowed) {
    return tooManyRequests('Too many AI requests — try again in a moment.', rl.retryAfterMs);
  }

  let body: AiRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const code = typeof body.room === 'string' ? body.room.toUpperCase() : '';
  if (!isValidRoomCode(code)) {
    return NextResponse.json(
      { success: false, error: 'AI only works inside a chat room.' },
      { status: 403 }
    );
  }

  const prompt = buildPrompt(body);
  if (!prompt) {
    return NextResponse.json(
      { success: false, error: 'Invalid, incomplete, or disabled AI task' },
      { status: 400 }
    );
  }

  try {
    const room = await getRoom(code);
    if (!room || isRoomExpired(room)) {
      return NextResponse.json(
        { success: false, error: 'AI only works inside an active chat room.' },
        { status: 403 }
      );
    }
  } catch (err) {
    console.error('AI room check failed:', err);
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
  }

  if (!takeDailySlot()) {
    return tooManyRequests('AI has reached its daily limit. Try again tomorrow.');
  }

  // OpenRouter couldn't answer: Gemini (if set) tries once, otherwise the
  // client gets `failure`, the same reply as before Gemini existed. Runs
  // after the limits above, so one request still counts once.
  const messages = chatMessages(prompt);
  const fallBack = async (failure: Response): Promise<Response> => {
    if (!geminiKey) return failure;
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const stream = await streamGemini(geminiKey, messages, prompt, request.signal);
    if (stream) return textResponse(stream);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return failure;
  };
  const unavailable = (status: number) =>
    NextResponse.json({ success: false, error: UNAVAILABLE }, { status });

  if (!apiKey) return fallBack(unavailable(503));

  // With a fallback ready, cap the wait for OpenRouter's first text and skip
  // the congestion retries — Gemini answers sooner. The timer stops once
  // text arrives, so long answers are never cut.
  const deadline = new AbortController();
  const timer = geminiKey
    ? setTimeout(() => deadline.abort(), OPENROUTER_FIRST_TEXT_MS)
    : undefined;
  const signal = geminiKey ? AbortSignal.any([request.signal, deadline.signal]) : request.signal;

  const answerWithOpenRouter = async (): Promise<Response> => {
    const models = modelList();
    // Client hit Stop (or closed the tab) → stop paying for upstream tokens.
    const callUpstream = () =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter attribution headers (optional but recommended).
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'SyncFlow',
        },
        body: JSON.stringify({
          model: models[0],
          models,
          stream: true,
          max_tokens: prompt.maxTokens,
          temperature: prompt.temperature,
          messages,
        }),
      });

    // Free models get congested; when every fallback is momentarily 429'd,
    // honor the upstream Retry-After hint (up to two retries) before giving up.
    const MAX_RETRIES = geminiKey ? 0 : 2;
    let upstream: Response;
    try {
      upstream = await callUpstream();
    } catch (err) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      console.error('AI upstream fetch failed:', err);
      return fallBack(unavailable(502));
    }
    let detail = '';
    let congested = false;
    for (let attempt = 0; (!upstream.ok || !upstream.body) && attempt <= MAX_RETRIES; attempt++) {
      let retryAfter = 0;
      detail = `HTTP ${upstream.status}`;
      try {
        const err = await upstream.json();
        detail = err?.error?.metadata?.raw || err?.error?.message || detail;
        congested = err?.error?.code === 429 || upstream.status === 429;
        if (congested) {
          retryAfter = Number(err?.error?.metadata?.retry_after_seconds) || 5;
        }
      } catch {
        /* keep status text */
      }
      if (retryAfter === 0 || attempt === MAX_RETRIES) break;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
      if (request.signal.aborted) return new Response(null, { status: 499 });
      try {
        upstream = await callUpstream();
      } catch {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        return fallBack(unavailable(502));
      }
    }

    if (!upstream.ok || !upstream.body) {
      console.error('AI upstream error:', detail.slice(0, 300));
      const failure = congested
        ? tooManyRequests('AI is busy right now. Try again in a minute.')
        : unavailable(502);
      return openRouterShouldFallBack(congested ? 429 : upstream.status)
        ? fallBack(failure)
        : failure;
    }

    // Re-emit OpenRouter's SSE as a plain text stream of content deltas —
    // the client just reads body chunks and appends. Nothing is sent until
    // the first text arrives, so a provider switch never mixes answers.
    const stream = await startTextStream(sseDeltas(upstream.body, openRouterDelta));
    clearTimeout(timer);
    if (stream) return textResponse(stream);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    // OpenRouter reports errors inside a 200 stream; none of it was text.
    console.error('AI upstream sent no text');
    return fallBack(textResponse(new ReadableStream({ start: (c) => c.close() })));
  };

  try {
    return await answerWithOpenRouter();
  } finally {
    clearTimeout(timer);
  }
}
