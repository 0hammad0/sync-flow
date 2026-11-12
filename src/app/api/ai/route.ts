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

export const runtime = 'nodejs';

const UNAVAILABLE = 'AI is unavailable right now. Try again later.';

// Global daily budget for the operator's OpenRouter key. In-memory, so it is
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
  if (!apiKey) {
    // Operator-facing detail stays in the logs, not in the user's face.
    console.warn('AI request rejected: OPENROUTER_API_KEY is not set');
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

  const models = modelList();
  // Client hit Stop (or closed the tab) → stop paying for upstream tokens.
  const callUpstream = () =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: request.signal,
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
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });

  // Free models get congested; when every fallback is momentarily 429'd,
  // honor the upstream Retry-After hint (up to two retries) before giving up.
  const MAX_RETRIES = 2;
  let upstream: Response;
  try {
    upstream = await callUpstream();
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('AI upstream fetch failed:', err);
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 502 });
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
      return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 502 });
    }
  }

  if (!upstream.ok || !upstream.body) {
    console.error('AI upstream error:', detail.slice(0, 300));
    if (congested) return tooManyRequests('AI is busy right now. Try again in a minute.');
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 502 });
  }

  // Re-emit OpenRouter's SSE as a plain text stream of content deltas —
  // the client just reads body chunks and appends.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              /* ignore malformed keep-alive lines */
            }
          }
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
