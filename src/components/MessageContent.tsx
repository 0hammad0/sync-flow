'use client';

// Rich rendering for chat message text: URL linkification with one-click
// copy, auto-detected code snippets with VS Code-style highlighting, and
// copy buttons for long messages. Dependency-free — a few regex tokenizers
// cover the common languages well enough for chat-sized snippets.

import { useEffect, useState } from 'react';
import { Check, Copy, Sparkles, X } from 'lucide-react';
import { getAiAvailability, streamAi, stripInlineMarkdown } from '@/lib/ai-client';

/* ------------------------------- copying -------------------------------- */

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; fall back to execCommand.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function InlineCopyButton({
  text,
  title = 'Copy',
  label,
  light,
  mine,
}: {
  text: string;
  title?: string;
  label?: string;
  light?: boolean; // on the dark snippet header
  mine?: boolean;  // inside my (colored) bubble
}) {
  const [copied, setCopied] = useState(false);
  const tone = light
    ? 'text-[#9d9d9d] hover:text-white'
    : mine
      ? 'text-white/70 hover:text-white'
      : 'text-fg-faint hover:text-fg';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copyText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={`inline-flex items-center gap-1 align-baseline text-[10px] cursor-pointer transition-colors ${tone}`}
      title={copied ? 'Copied!' : title}
      aria-label={copied ? 'Copied' : title}
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}

/* ----------------------------- linkification ---------------------------- */

// Source only — each render builds its own RegExp so the stateful
// `lastIndex` of a `g` regex is never shared between renders.
const URL_RE_SOURCE = String.raw`https?:\/\/[^\s<>"']+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"']*`;

// Render text with URLs as clickable links, each followed by a tiny copy
// icon — works mid-paragraph because everything stays inline.
export function LinkifiedText({
  text,
  mine,
  className = 'text-sm whitespace-pre-wrap break-words',
}: {
  text: string;
  mine: boolean;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  const urlRe = new RegExp(URL_RE_SOURCE, 'gi');
  for (let m = urlRe.exec(text); m; m = urlRe.exec(text)) {
    // Trailing punctuation is almost always sentence punctuation, not URL.
    const url = m[0].replace(/[.,;:!?)\]}>'"]+$/, '');
    if (!url) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    parts.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`underline underline-offset-2 ${
          mine ? 'text-white hover:text-white/80' : 'text-brand-text hover:opacity-80'
        }`}
        style={{ wordBreak: 'break-all' }}
      >
        {url}
      </a>,
      <span key={key++} className="whitespace-nowrap">
        {' '}
        <InlineCopyButton text={href} title="Copy link" mine={mine} />
      </span>
    );
    last = m.index + url.length;
  }
  if (parts.length === 0) {
    return (
      <div className={className} style={{ wordBreak: 'break-word' }}>
        {text}
      </div>
    );
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <div className={className} style={{ wordBreak: 'break-word' }}>
      {parts}
    </div>
  );
}

/* ---------------------------- code detection ---------------------------- */

export type CodeLang =
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'html'
  | 'css'
  | 'python'
  | 'sql'
  | 'bash'
  | 'code';

const FENCE_LANGS: Record<string, CodeLang> = {
  js: 'javascript', jsx: 'javascript', javascript: 'javascript', mjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
  json: 'json',
  html: 'html', xml: 'html', svg: 'html',
  css: 'css', scss: 'css',
  py: 'python', python: 'python',
  sql: 'sql',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash',
};

export interface DetectedCode {
  code: string;
  lang: CodeLang;
}

function countMatches(re: RegExp, s: string): number {
  return (s.match(re) || []).length;
}

function guessLang(code: string): CodeLang {
  const t = code.trim();

  // JSON: strict parse, but only for object/array bodies (not bare numbers).
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      /* fall through */
    }
  }
  if (/^\s*<(!DOCTYPE|!doctype|[a-zA-Z][\w-]*)(\s|>)/.test(t) && /<\/[a-zA-Z][\w-]*>|\/>/.test(t)) {
    return 'html';
  }
  if (countMatches(/\b(def |elif |lambda |None|self\.|print\()/g, t) >= 2 || /^(def |from \w+ import |import \w+$)/m.test(t)) {
    return 'python';
  }
  if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/i.test(t) && /\b(FROM|VALUES|SET|WHERE|INTO)\b/i.test(t)) {
    return 'sql';
  }
  if (/^\s*(\$ |#!\/|sudo |npm |npx |git |curl |cd |brew |apt )/m.test(t) && !/[{};]\s*$/m.test(t)) {
    return 'bash';
  }
  if (countMatches(/\b(interface|type \w+ =|: (string|number|boolean|void)|as const|readonly)\b/g, t) >= 1 &&
      countMatches(/\b(const|let|function|=>|import|export|return)\b/g, t) >= 1) {
    return 'typescript';
  }
  if (countMatches(/\b(const|let|var|function|return|import|export|new|await|async)\b|=>|console\./g, t) >= 2) {
    return 'javascript';
  }
  if (/[.#]?[\w-]+\s*\{[^{}]*:[^{}]*;[^{}]*\}/.test(t)) {
    return 'css';
  }
  return 'code';
}

/**
 * Decide whether a message is code and, if so, what language. Fenced blocks
 * always win (and the fences are stripped); otherwise strong multi-line
 * signals are required so normal prose never turns into a snippet.
 */
export function detectCode(content: string): DetectedCode | null {
  const t = content.trim();

  // Whole message is a single fenced block → unwrap it.
  const fence = t.match(/^```([\w+-]*)\s*\n([\s\S]*?)\n?```$/);
  if (fence) {
    const body = fence[2];
    const lang = FENCE_LANGS[fence[1].toLowerCase()] || guessLang(body);
    return { code: body, lang };
  }
  if (t.startsWith('```') || t.includes('\n```')) {
    return { code: t, lang: guessLang(t) };
  }

  // JSON object/array pasted directly (single line counts too).
  if (/^[{[]/.test(t) && /[}\]]$/.test(t) && t.length > 8) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'object' && parsed !== null) return { code: t, lang: 'json' };
    } catch {
      /* not JSON */
    }
  }

  const lines = t.split('\n');
  if (lines.length < 2) return null;

  const lang = guessLang(t);
  if (lang !== 'code') return { code: t, lang };

  // Fallback: heavily indented multi-line text reads as code.
  let indented = 0;
  for (const line of lines) {
    if (/^(\t| {2,})/.test(line)) indented++;
    if (indented >= 3) return { code: t, lang: 'code' };
  }
  return null;
}

/* --------------------------- syntax highlighting ------------------------ */

// VS Code Dark+ palette.
const TOKEN_COLORS: Record<string, string> = {
  comment: '#6a9955',
  string: '#ce9178',
  number: '#b5cea8',
  keyword: '#569cd6',
  property: '#9cdcfe',
  tag: '#4ec9b0',
  variable: '#9cdcfe',
};

interface TokenRule {
  type: keyof typeof TOKEN_COLORS;
  source: string;
}

const JS_RULES: TokenRule[] = [
  { type: 'comment', source: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` },
  { type: 'string', source: String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\x60(?:[^\x60\\]|\\.)*\x60` },
  { type: 'keyword', source: String.raw`\b(?:const|let|var|function|return|if|else|for|while|do|class|extends|new|import|export|from|default|async|await|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|in|of|this|super|null|undefined|true|false|void|delete|yield|static|interface|type|enum|implements|public|private|protected|readonly|as|satisfies)\b` },
  { type: 'number', source: String.raw`\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b` },
];

const LANG_RULES: Record<CodeLang, TokenRule[]> = {
  javascript: JS_RULES,
  typescript: JS_RULES,
  json: [
    { type: 'property', source: String.raw`"(?:[^"\\]|\\.)*"(?=\s*:)` },
    { type: 'string', source: String.raw`"(?:[^"\\]|\\.)*"` },
    { type: 'keyword', source: String.raw`\b(?:true|false|null)\b` },
    { type: 'number', source: String.raw`-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b` },
  ],
  html: [
    { type: 'comment', source: String.raw`<!--[\s\S]*?-->` },
    { type: 'string', source: String.raw`"[^"]*"|'[^']*'` },
    { type: 'tag', source: String.raw`</?[a-zA-Z][\w-]*|/?>` },
    { type: 'property', source: String.raw`\b[\w-]+(?==)` },
  ],
  css: [
    { type: 'comment', source: String.raw`\/\*[\s\S]*?\*\/` },
    { type: 'string', source: String.raw`"[^"]*"|'[^']*'` },
    { type: 'property', source: String.raw`[\w-]+(?=\s*:)` },
    { type: 'number', source: String.raw`#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg|fr)?\b` },
  ],
  python: [
    { type: 'comment', source: String.raw`#[^\n]*` },
    { type: 'string', source: String.raw`(?:[rbfu]{0,2})(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")` },
    { type: 'keyword', source: String.raw`\b(?:def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|assert|del|not|and|or|in|is|None|True|False|self|async|await|print)\b` },
    { type: 'number', source: String.raw`\b\d[\d_]*(?:\.\d+)?\b` },
  ],
  sql: [
    { type: 'comment', source: String.raw`--[^\n]*` },
    { type: 'string', source: String.raw`'(?:[^'\\]|\\.)*'` },
    { type: 'keyword', source: String.raw`\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|NULL|IN|IS|LIKE|BETWEEN|DISTINCT|COUNT|SUM|AVG|MIN|MAX|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNION|ALL|CASE|WHEN|THEN|ELSE|END)\b` },
    { type: 'number', source: String.raw`\b\d+(?:\.\d+)?\b` },
  ],
  bash: [
    { type: 'comment', source: String.raw`#[^\n]*` },
    { type: 'string', source: String.raw`"(?:[^"\\]|\\.)*"|'[^']*'` },
    { type: 'variable', source: String.raw`\$\{?\w+\}?` },
    { type: 'keyword', source: String.raw`\b(?:if|then|else|elif|fi|for|do|done|while|case|esac|function|echo|export|sudo|cd|npm|npx|git|curl)\b` },
  ],
  code: [
    { type: 'string', source: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'` },
    { type: 'number', source: String.raw`\b\d[\d_]*(?:\.\d+)?\b` },
  ],
};

function highlight(code: string, lang: CodeLang): React.ReactNode[] {
  const rules = LANG_RULES[lang];
  const flags = lang === 'sql' ? 'gi' : 'g';
  const combined = new RegExp(rules.map((r) => `(${r.source})`).join('|'), flags);
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (let m = combined.exec(code); m; m = combined.exec(code)) {
    if (m[0] === '') {
      combined.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(code.slice(last, m.index));
    const ruleIdx = m.slice(1).findIndex((g) => g !== undefined);
    out.push(
      <span key={key++} style={{ color: TOKEN_COLORS[rules[ruleIdx].type] }}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/* ------------------------------ CodeSnippet ----------------------------- */

const LANG_LABEL: Record<CodeLang, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  python: 'Python',
  sql: 'SQL',
  bash: 'Shell',
  code: 'Code',
};

// VS Code-style block: dark editor background in both themes, header bar
// with the detected language, one-click copy, and an AI "Explain" that
// streams a plain-language explanation below the code.
export function CodeSnippet({ code, lang }: { code: string; lang: CodeLang }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [canExplain, setCanExplain] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getAiAvailability().then((a) => {
      if (!cancelled) setCanExplain(a.tasks.includes('explain'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const explain = async () => {
    if (explaining) return;
    if (explanation !== null) {
      setExplanation(null);
      return;
    }
    setExplaining(true);
    setAiError(null);
    setExplanation('');
    try {
      await streamAi({ task: 'explain', code, lang }, (t) => setExplanation(t));
    } catch (err) {
      setExplanation(null);
      setAiError(err instanceof Error ? err.message : 'AI request failed');
    }
    setExplaining(false);
  };

  return (
    <div
      className="rounded-lg overflow-hidden my-0.5 text-left border border-white/10"
      style={{ background: '#1e1e1e' }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10"
        style={{ background: '#252526' }}
      >
        <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#858585' }}>
          {LANG_LABEL[lang]}
        </span>
        <span className="flex items-center gap-3">
          {canExplain && (
          <button
            type="button"
            onClick={explain}
            disabled={explaining}
            className="inline-flex items-center gap-1 text-[10px] cursor-pointer transition-colors text-[#9d9d9d] hover:text-white disabled:opacity-60"
            title={explanation !== null ? 'Hide explanation' : 'Explain this code with AI'}
          >
            {explanation !== null && !explaining ? (
              <X className="w-3 h-3" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>{explaining ? 'Explaining…' : explanation !== null ? 'Hide' : 'Explain'}</span>
          </button>
          )}
          <InlineCopyButton text={code} title="Copy code" label="Copy" light />
        </span>
      </div>
      <pre
        className="text-xs sm:text-sm font-mono whitespace-pre overflow-x-auto p-3 leading-relaxed"
        style={{ color: '#d4d4d4' }}
      >
        <code>{highlight(code, lang)}</code>
      </pre>
      {(explanation !== null || aiError) && (
        <div className="px-3 py-2 border-t border-white/10 text-xs leading-relaxed" style={{ background: '#252526' }}>
          {aiError ? (
            <span className="text-red-400">{aiError}</span>
          ) : (
            <div className="whitespace-pre-wrap" style={{ color: '#c8c8c8' }}>
              <span className="inline-flex items-center gap-1 mr-1 font-medium" style={{ color: '#9d9d9d' }}>
                <Sparkles className="w-3 h-3" /> AI:
              </span>
              {stripInlineMarkdown(explanation ?? '') || '…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
