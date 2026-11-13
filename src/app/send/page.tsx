'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from '@/shared/lib/direct-upload';
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@/shared/lib/limits';
import Button from '@/shared/ui/Button';
import ActionError from '@/shared/components/ActionError';
import { MonitorSmartphone } from 'lucide-react';

// Same alphabet as the server (no 0/O/1/I); anything else is dropped as typed.
const NOT_IN_CODE = new RegExp(`[^${SHORT_CODE_ALPHABET}]`, 'g');

function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(NOT_IN_CODE, '').slice(0, SHORT_CODE_LENGTH);
}

/** Phone → PC without a camera: type the short code shown on the computer. */
export default function SendCodePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== SHORT_CODE_LENGTH) return;
    setLoading(true);
    setError(null);
    const res = await postJson('/api/send/code', { code });
    if (res.success && typeof res.sessionToken === 'string') {
      router.push(`/send/${encodeURIComponent(res.sessionToken)}`);
      return;
    }
    setError(res.error || 'Something went wrong. Please try again.');
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full animate-fade-in">
        <div className="text-center mb-5">
          <span className="inline-flex w-12 h-12 mb-3 rounded-2xl bg-brand/10 text-brand-text items-center justify-center">
            <MonitorSmartphone className="w-6 h-6" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-1">Phone → PC</h1>
          <p className="text-sm text-fg-muted">Enter the code shown on your computer</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-edge rounded-3xl p-5 shadow-[var(--shadow-card)] space-y-3"
        >
          <label htmlFor="code" className="sr-only">
            Code
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            placeholder="ABC234"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            autoFocus
            className="input-base w-full px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] uppercase"
            aria-describedby={error ? 'code-error' : undefined}
          />
          {error && (
            <p id="code-error" role="alert" className="text-xs text-danger-text text-center">
              <ActionError text={error} />
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={code.length !== SHORT_CODE_LENGTH}
            loading={loading}
            loadingText="Checking…"
          >
            Continue
          </Button>
        </form>

        <p className="mt-4 text-xs text-fg-faint text-center">
          On your computer, open Phone → PC to get a code
        </p>
      </div>
    </div>
  );
}
