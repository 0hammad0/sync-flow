import { NextRequest, NextResponse } from 'next/server';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import {
  aiRateLimitPerMinute,
  buildPrompt,
  enabledTasks,
  isAiConfigured,
  modelList,
  type AiRequestBody,
} from '@/lib/ai-config';

export const runtime = 'nodejs';

/**
 * GET — feature discovery. The UI calls this once and only renders AI
 * controls for the tasks that are actually available, so features can be
 * enabled/disabled purely through env config.
 */
export async function GET() {
  return NextResponse.json({ enabled: isAiConfigured(), tasks: enabledTasks() });
}

/** POST — run an AI task; the response is a plain text stream. */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'AI is not configured — add OPENROUTER_API_KEY to the environment.' },
      { status: 503 }
    );
  }

  // Free-tier models are heavily rate-limited upstream anyway; keep one
  // client from burning the whole allowance.
  const rl = rateLimit(`ai:${clientKey(request)}`, aiRateLimitPerMinute(), 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many AI requests — try again in a moment.' },
      {
        status: 429,
        headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() },
      }
    );
  }

  let body: AiRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const prompt = buildPrompt(body);
  if (!prompt) {
    return NextResponse.json(
      { success: false, error: 'Invalid, incomplete, or disabled AI task' },
      { status: 400 }
    );
  }

  const models = modelList();
  const callUpstream = () =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
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
  let upstream = await callUpstream();
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
    upstream = await callUpstream();
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      {
        success: false,
        error: congested
          ? 'AI agent is busy right now — try again later.'
          : `AI agent is unavailable right now — try again later. (${detail.slice(0, 160)})`,
      },
      { status: congested ? 429 : 502 }
    );
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
