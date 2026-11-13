'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Ban, Link2 } from 'lucide-react';
import type { SessionDetailDto } from '@/server/analytics/dto';
import { countryName } from '@/shared/lib/block-values';
import { copyText } from '@/shared/lib/clipboard';
import AdminButton from '@/shared/ui/AdminButton';
import Badge from '@/shared/ui/Badge';
import BlockDialog from '@/features/admin/access/components/BlockDialog';
import { formatUtc } from '@/features/admin/access/format';
import type { AccessActorDto } from '@/features/admin/access/types';
import { blockTargetFor, durationLabel, formatDuration, formatFullUtc } from '../format';
import { DEVICE_LABELS, SESSIONS_BACK_KEY } from '../constants';
import { IpCell } from './SessionRowCard';

/** sonner loads lazily (LazyToaster), so import it on use. */
async function toast(title: string, description?: string) {
  const { toast: t } = await import('sonner');
  t.success(title, description ? { description } : undefined);
}

/** "Sessions" with the list's last filters (kept in sessionStorage by the table). */
export function BackToSessions() {
  const [query, setQuery] = useState('');
  useEffect(() => {
    try {
      // Read after mount: the server render has no sessionStorage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery(sessionStorage.getItem(SESSIONS_BACK_KEY) ?? '');
    } catch {
      // Storage blocked: plain list.
    }
  }, []);
  return (
    <Link
      href={`/admin/sessions${query.startsWith('?') ? query : ''}`}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted pointer-fine:hover:text-fg"
    >
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="size-4" />
      Sessions
    </Link>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-edge py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-fg sm:text-right">{children}</dd>
    </div>
  );
}

const join = (parts: (string | null | undefined)[], sep = ' · ') => parts.filter(Boolean).join(sep);

function placeText(s: SessionDetailDto): string {
  const country = s.country ? `${countryName(s.country) ?? s.country} (${s.country})` : null;
  return join([s.city, s.region, country], ', ') || 'Unknown';
}

function vitalsText(v: NonNullable<SessionDetailDto['vitals']>): string | null {
  const parts = [
    v.lcp != null ? `LCP ${(v.lcp / 1000).toFixed(1)} s` : null,
    v.inp != null ? `INP ${Math.round(v.inp)} ms` : null,
    v.cls != null ? `CLS ${v.cls.toFixed(2)}` : null,
  ];
  return join(parts) || null;
}

type SessionHeaderProps = {
  session: SessionDetailDto;
  canBlock: boolean;
  canOpenUsers: boolean;
  actor: AccessActorDto | null;
};

/** Title, Copy link / Block IP, and the facts of one session (04-sessions.md "Detail"). */
export default function SessionHeader({ session: s, canBlock, canOpenUsers, actor }: SessionHeaderProps) {
  const [blockOpen, setBlockOpen] = useState(false);
  const target = canBlock && actor ? blockTargetFor(s) : null;
  const vitals = s.vitals ? vitalsText(s.vitals) : null;
  const utm = join([s.utmSource, s.utmMedium, s.utmCampaign], ' / ');
  const bounce = s.pageviews <= 1;

  return (
    <header className="mb-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold break-all text-fg">
            Session <span className="font-mono text-lg">{s.id.slice(0, 12)}…</span>
          </h1>
          <p className="mt-1 text-sm text-fg-muted">Started {formatFullUtc(s.startedAt)}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <AdminButton
            icon={Link2}
            fullWidth
            className="sm:w-auto"
            onClick={() => {
              void copyText(`${window.location.origin}/admin/sessions/${s.id}`).then(() => toast('Link copied'));
            }}
          >
            Copy link
          </AdminButton>
          {target && (
            <AdminButton variant="danger" icon={Ban} fullWidth className="sm:w-auto" onClick={() => setBlockOpen(true)}>
              {target.type === 'ip' ? 'Block IP' : 'Block range'}
            </AdminButton>
          )}
        </div>
      </div>

      <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg tabular-nums">
        <span aria-hidden="true">{formatDuration(s.durationMs)} total</span>
        <span className="sr-only">{durationLabel(s.durationMs)} total</span>
        <span aria-hidden="true" className="text-fg-faint">·</span>
        <span aria-hidden="true">{formatDuration(s.engagedMs)} visible</span>
        <span className="sr-only">{durationLabel(s.engagedMs)} visible</span>
        <span aria-hidden="true" className="text-fg-faint">·</span>
        <span>{s.pageviews === 1 ? '1 page' : `${s.pageviews} pages`}</span>
        {bounce && <Badge>Bounce</Badge>}
      </p>

      <dl className="grid gap-x-8 sm:grid-cols-2">
        <Item label="Place">
          {placeText(s)}
          {s.tz && <span className="block text-xs text-fg-muted">{s.tz}</span>}
        </Item>
        <Item label="Device">
          {join([s.device ? DEVICE_LABELS[s.device] : null, s.os, join([s.browser, s.browserVersion], ' ')]) || 'Unknown'}
          {s.viewport && (
            <span className="block text-xs text-fg-muted tabular-nums">
              {s.viewport.w} × {s.viewport.h}
            </span>
          )}
        </Item>
        <Item label="IP">
          <IpCell row={s} />
        </Item>
        <Item label="Source">
          {s.referrerHost ? `via ${s.referrerHost}` : 'Direct'}
          {utm && <span className="block text-xs text-fg-muted">UTM {utm}</span>}
        </Item>
        <Item label="User">
          {!s.userId ? (
            <span className="text-fg-muted">Not signed in</span>
          ) : canOpenUsers ? (
            <Link
              href={`/admin/users/${encodeURIComponent(s.userId)}`}
              className="font-mono text-[13px] break-all text-brand-text pointer-fine:hover:underline"
            >
              {s.userId}
            </Link>
          ) : (
            'Signed in'
          )}
        </Item>
        <Item label="Last event">{formatUtc(s.lastSeenAt)}</Item>
        {vitals && <Item label="Web vitals">{vitals}</Item>}
      </dl>

      {blockOpen && target && actor && (
        <BlockDialog
          open
          onOpenChange={setBlockOpen}
          actor={actor}
          initial={target}
          onCreated={(row) => {
            void toast(`Blocked ${row.value}`, row.expiresAt ? `Ends ${formatUtc(row.expiresAt)}` : 'Never ends.');
          }}
        />
      )}
    </header>
  );
}
