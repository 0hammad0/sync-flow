'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, Copy, ExternalLink, Radio, UserRound } from 'lucide-react';
import BlockDialog from '@/features/admin/access/components/BlockDialog';
import { formatUtc } from '@/features/admin/access/format';
import type { AccessActorDto } from '@/features/admin/access/types';
import type { LiveSessionDto } from '@/features/admin/analytics/types';
import { blockTargetFor } from '@/features/admin/sessions/format';
import { copyText } from '@/shared/lib/clipboard';
import Badge from '@/shared/ui/Badge';
import EmptyState from '@/shared/ui/EmptyState';
import RowActions, { type RowAction } from '@/shared/ui/data-table/RowActions';
import { formatDuration } from '@/shared/ui/charts/format';
import { deviceLabel, locationLabel, shortIp, timeOnSiteMs, visibleLiveSessions } from '../format';

// Active visitors (03-live.md "Active visitors"): a table from a 480 px panel,
// two-line cards under it. Rows are keyed by session id, so a poll only
// touches rows that changed. A visitor who left stays one more poll at 50%.

type Props = {
  sessions: readonly LiveSessionDto[];
  /** Poll time: "time on site" is measured to it. */
  at: string;
  selfUid: string;
  /** Set when the role may block (`blocks:write` + `ip:read`); used for the self-block checks. */
  blockActor?: AccessActorDto | null;
  className?: string;
};

type BlockTarget = { type: 'ip' | 'cidr'; value: string };

const FADE_IN = 'motion-safe:animate-[opacityIn_var(--dur-2)_var(--ease-enter)]';
const HEAD = 'px-3 text-left text-xs font-medium text-fg-muted';

async function notifyCopied() {
  const { toast } = await import('sonner');
  toast.success('IP copied');
}

async function notifyBlocked(value: string, expiresAt: string | null) {
  const { toast } = await import('sonner');
  toast.success(`Blocked ${value}`, { description: expiresAt ? `Ends ${formatUtc(expiresAt)}` : 'Never ends.' });
}

function useRowActions(canBlock: boolean, onBlock: (t: BlockTarget) => void): (s: LiveSessionDto) => RowAction[] {
  const router = useRouter();
  return (s) => {
    const items: RowAction[] = [
      { type: 'item', label: 'Open session', icon: ExternalLink, onSelect: () => router.push(`/admin/sessions/${s.sessionId}`) },
    ];
    // Masked IPs never reach this role's browser; only a real one can be copied.
    if (s.ip && !s.ipMasked) {
      const ip = s.ip;
      items.push({ type: 'item', label: 'Copy IP', icon: Copy, onSelect: () => void copyText(ip).then(notifyCopied) });
    }
    if (s.userId) {
      const uid = s.userId;
      items.push({ type: 'item', label: 'Open user', icon: UserRound, onSelect: () => router.push(`/admin/users/${encodeURIComponent(uid)}`) });
    }
    // Same as the sessions table: a full IP blocks the IP, a retention-truncated one its range.
    const target = canBlock ? blockTargetFor(s) : null;
    if (target) {
      items.push({
        type: 'item',
        label: target.type === 'ip' ? 'Block this IP…' : 'Block this range…',
        icon: Ban,
        tone: 'danger',
        onSelect: () => onBlock(target),
      });
    }
    return items;
  };
}

function Location({ s, selfUid }: { s: LiveSessionDto; selfUid: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link href={`/admin/sessions/${s.sessionId}`} className="truncate text-fg underline-offset-2 pointer-fine:hover:underline">
        {locationLabel(s.country, s.city)}
      </Link>
      {s.userId !== null && s.userId === selfUid && <Badge tone="brand">You</Badge>}
      {!s.active && <span className="sr-only">(left)</span>}
    </span>
  );
}

export default function LiveVisitorsTable({ sessions, at, selfUid, blockActor = null, className = '' }: Props) {
  const rows = useMemo(() => visibleLiveSessions(sessions, at), [sessions, at]);
  // Rows from the first (server) render do not fade in; later arrivals do.
  const [firstIds] = useState(() => new Set(sessions.map((s) => s.sessionId)));
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const actionsFor = useRowActions(blockActor !== null, setBlockTarget);
  const activeCount = rows.filter((s) => s.active).length;

  return (
    <section aria-labelledby="live-visitors-title" className={`@container min-w-0 rounded-lg border border-edge bg-surface ${className}`}>
      <div className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-2">
        <h2 id="live-visitors-title" className="text-sm font-semibold text-fg">
          Active visitors
        </h2>
        <span className="text-xs text-fg-muted tabular-nums">{activeCount.toLocaleString('en-US')} active</span>
      </div>

      {rows.length === 0 && (
        <EmptyState
          size="inline"
          icon={<Radio />}
          title="Nobody is on the site right now"
          body="This page checks every 30 seconds."
          className="px-4"
        />
      )}

      {/* Table from 480 px of panel width. */}
      <table className={`hidden w-full table-fixed border-collapse text-[13px] ${rows.length > 0 ? '@[480px]:table' : ''}`}>
        <caption className="sr-only">Active visitors, most recent first</caption>
        <thead>
          <tr className="h-9 border-y border-edge bg-surface-2">
            <th scope="col" className={HEAD}>
              Location
            </th>
            <th scope="col" className={HEAD}>
              Page
            </th>
            <th scope="col" className={`${HEAD} w-26 text-right`}>
              Time on site
            </th>
            <th scope="col" className={`${HEAD} hidden w-36 @[640px]:table-cell`}>
              IP
            </th>
            <th scope="col" className={`${HEAD} hidden w-20 @[800px]:table-cell`}>
              Device
            </th>
            <th scope="col" className="w-12">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const ms = timeOnSiteMs(s, at);
            return (
              <tr
                key={s.sessionId}
                className={`group h-[var(--admin-row-h)] border-b border-edge last:border-b-0 ${s.active ? '' : 'opacity-50'} ${firstIds.has(s.sessionId) ? '' : FADE_IN}`}
              >
                <td className="px-3">
                  <Location s={s} selfUid={selfUid} />
                </td>
                <td className="truncate px-3 text-fg" title={s.currentPath ?? undefined}>
                  {s.currentPath ?? '—'}
                </td>
                <td className="px-3 text-right text-fg tabular-nums">{ms === null ? '—' : formatDuration(ms / 1000)}</td>
                <td className="hidden truncate px-3 font-mono text-xs text-fg-muted @[640px]:table-cell" title={s.ip ?? undefined}>
                  {shortIp(s.ip)}
                </td>
                <td className="hidden px-3 text-fg-muted @[800px]:table-cell">{deviceLabel(s.device)}</td>
                <td className="px-1 text-right">
                  <RowActions label={`Actions for ${locationLabel(s.country, s.city)}`} items={actionsFor(s)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Cards under 480 px. */}
      <ul aria-label="Active visitors" className="flex flex-col @[480px]:hidden">
        {rows.map((s) => {
          const ms = timeOnSiteMs(s, at);
          return (
            <li
              key={s.sessionId}
              className={`group flex items-start gap-2 border-t border-edge px-4 py-2.5 ${s.active ? '' : 'opacity-50'} ${firstIds.has(s.sessionId) ? '' : FADE_IN}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Location s={s} selfUid={selfUid} />
                  <span className="shrink-0 text-fg-muted">· {deviceLabel(s.device)}</span>
                </span>
                <span className="truncate text-fg-muted">
                  {s.currentPath ?? '—'} · <span className="tabular-nums">{ms === null ? '—' : formatDuration(ms / 1000)}</span>
                </span>
              </div>
              <RowActions label={`Actions for ${locationLabel(s.country, s.city)}`} items={actionsFor(s)} />
            </li>
          );
        })}
      </ul>

      {blockTarget && blockActor && (
        <BlockDialog
          key={`${blockTarget.type}:${blockTarget.value}`}
          open
          onOpenChange={(open) => {
            if (!open) setBlockTarget(null);
          }}
          actor={blockActor}
          initial={blockTarget}
          onCreated={(row) => void notifyBlocked(row.value, row.expiresAt)}
        />
      )}
    </section>
  );
}
