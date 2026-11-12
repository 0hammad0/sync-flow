// Central configuration for every AI feature. This is the one file to edit
// as the AI layer evolves: add a task, tune a prompt, change models, or
// flip features off — the API route and the UI adapt automatically.
//
// Env knobs (all optional):
//   OPENROUTER_API_KEY   — required for AI to be enabled at all
//   OPENROUTER_MODEL     — primary model (default: first FALLBACK_MODELS entry)
//   AI_TASKS_DISABLED    — comma list to turn tasks off, e.g. "replies,translate"
//   AI_RATE_LIMIT        — requests/min per IP (default 15)
//   AI_DAILY_LIMIT       — total requests/day per server instance (default 500)

import { rewriteInstruction } from './rewrite-presets';

export const AI_TASK_IDS = ['replies', 'summary', 'rewrite', 'translate', 'explain'] as const;
export type AiTask = (typeof AI_TASK_IDS)[number];

// Free-tier models, best first. OpenRouter's `models` array is fallback
// routing: if the primary is rate-limited or down, the next one answers.
// Free-model availability shifts over time — check the current list at
// https://openrouter.ai/models?max_price=0 and reorder here (or set
// OPENROUTER_MODEL) when the primary gets flaky.
const FALLBACK_MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
];

export function modelList(): string[] {
  const primary = process.env.OPENROUTER_MODEL || FALLBACK_MODELS[0];
  // OpenRouter accepts at most 3 entries in the `models` routing array.
  return [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)].slice(0, 3);
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function disabledTasks(): Set<string> {
  return new Set(
    (process.env.AI_TASKS_DISABLED || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Task ids currently usable: key present and not disabled. */
export function enabledTasks(): AiTask[] {
  if (!isAiConfigured()) return [];
  const off = disabledTasks();
  return AI_TASK_IDS.filter((t) => !off.has(t));
}

export function aiRateLimitPerMinute(): number {
  const n = Number(process.env.AI_RATE_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export function aiDailyLimit(): number {
  const n = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

/* ----------------------------- task prompts ----------------------------- */

export interface AiRequestBody {
  task?: string;
  room?: string; // code of the live chat room the request comes from
  transcript?: string; // replies / summary
  me?: string; // replies: who is asking
  text?: string; // rewrite / translate
  preset?: string; // rewrite: id from REWRITE_PRESETS
  target?: string; // translate: language name
  code?: string; // explain
  lang?: string; // explain
}

export interface BuiltPrompt {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

function clip(s: unknown, max: number): string {
  return typeof s === 'string' ? s.slice(0, max) : '';
}

// Language names go into the system prompt, so only allow what a language
// name looks like ("English", "Brazilian Portuguese", "Chinese (Traditional)").
function languageName(s: unknown): string {
  const v = clip(s, 40).trim();
  return /^[\p{L} ()-]{2,40}$/u.test(v) ? v : '';
}

interface TaskDef {
  build: (body: AiRequestBody) => { system: string; user: string } | null;
  maxTokens: number;
  temperature: number;
}

const TASKS: Record<AiTask, TaskDef> = {
  replies: {
    maxTokens: 120,
    temperature: 0.9,
    build: (body) => {
      const transcript = clip(body.transcript, 12_000);
      const me = clip(body.me, 64).replace(/\s+/g, ' ').trim() || 'the user';
      if (!transcript) return null;
      return {
        system:
          'You suggest quick chat replies. Given a conversation, suggest 3 different short replies that the named participant could plausibly send next. ' +
          'Output exactly 3 replies, one per line, with no numbering, bullets, quotes, or explanations. ' +
          "Match the conversation's language and tone. Keep each reply under 12 words.",
        // The name is user-chosen, so it rides in the user turn, not the system prompt.
        user: `Participant: ${me}\n\nConversation:\n${transcript}`,
      };
    },
  },
  summary: {
    maxTokens: 400,
    temperature: 0.4,
    build: (body) => {
      const transcript = clip(body.transcript, 16_000);
      if (!transcript) return null;
      return {
        system:
          'Summarize this chat conversation for someone who just joined the room. ' +
          'Use 3-5 "- " bullet points, each under 12 words. Prioritize: decisions made, open questions, files shared. ' +
          'Skip minor details — this renders in a small panel. ' +
          "Be concrete (use names). Write in the conversation's dominant language. " +
          'Plain text only — no markdown, no backticks, no bold. No preamble, just the bullets.',
        user: transcript,
      };
    },
  },
  rewrite: {
    maxTokens: 1_000,
    temperature: 0.4,
    build: (body) => {
      const text = clip(body.text, 6_000);
      // Fixed server-side presets only — never free text from the client.
      const instruction = rewriteInstruction(body.preset);
      if (!text || !instruction) return null;
      return {
        system:
          'You rewrite chat messages. Apply the instruction to the message. ' +
          'Return ONLY the rewritten message — no preamble, no quotes, no explanation. ' +
          'Preserve meaning, line breaks, and any code blocks unless the instruction says otherwise.' +
          `\nInstruction: ${instruction}`,
        user: text,
      };
    },
  },
  translate: {
    maxTokens: 1_000,
    temperature: 0.3,
    build: (body) => {
      const text = clip(body.text, 6_000);
      const target = languageName(body.target) || 'English';
      if (!text) return null;
      return {
        system:
          `Translate the message into ${target}. Return ONLY the translation — no explanations or notes. ` +
          'Preserve formatting, emoji, names, and code; translate only natural language.',
        user: text,
      };
    },
  },
  explain: {
    maxTokens: 350,
    temperature: 0.3,
    build: (body) => {
      const code = clip(body.code, 8_000);
      const lang = clip(body.lang, 24);
      if (!code) return null;
      return {
        system:
          'Explain this code snippet for a chat conversation: what it does and anything notable, risky, or buggy. ' +
          'If it is an error message or stack trace, explain what went wrong and the likely fix. ' +
          'Plain short sentences or brief "- " bullets, no headers, under 150 words.',
        user: lang ? `Language: ${lang}\n\n${code}` : code,
      };
    },
  },
};

/** Build the full prompt for a request, or null if invalid/disabled. */
export function buildPrompt(body: AiRequestBody): BuiltPrompt | null {
  const task = (body.task || '') as AiTask;
  if (!AI_TASK_IDS.includes(task) || disabledTasks().has(task)) return null;
  const def = TASKS[task];
  const prompt = def.build(body);
  if (!prompt) return null;
  return { ...prompt, maxTokens: def.maxTokens, temperature: def.temperature };
}
