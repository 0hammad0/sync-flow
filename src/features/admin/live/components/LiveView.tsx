'use client';

import { useCallback, useEffect } from 'react';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { Pause, Play } from 'lucide-react';
import type { AccessActorDto } from '@/features/admin/access/types';
import type { LiveDto } from '@/features/admin/analytics/types';
import AdminButton from '@/shared/ui/AdminButton';
import EmptyState from '@/shared/ui/EmptyState';
import NoDataYet from '@/shared/ui/illustrations/NoDataYet';
import PollingProvider from '../PollingProvider';
import { useClock } from '../hooks/useClock';
import { useLivePoll } from '../hooks/useLivePoll';
import LiveEventFeed from './LiveEventFeed';
import LiveMap from './LiveMap';
import { LiveHeader } from './LiveSkeleton';
import LiveStatus from './LiveStatus';
import LiveSummary from './LiveSummary';
import LiveVisitorsTable from './LiveVisitorsTable';

type LiveViewProps = {
  /** Server-rendered first data (no client fetch on first paint). */
  initial: LiveDto;
  /** The signed-in admin: their own visit gets a "You" badge. */
  selfUid: string;
  /** Set when the role may block (`blocks:write` + `ip:read`): rows get "Block this IP…". */
  blockActor?: AccessActorDto | null;
};

const pausedParser = parseAsStringLiteral(['1'] as const).withOptions({ history: 'replace' });

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function Live({ initial, selfUid, blockActor = null }: LiveViewProps) {
  // Pause lives in the URL (`?paused=1`), so a reload keeps it.
  const [pausedParam, setPausedParam] = useQueryState('paused', pausedParser);
  const paused = pausedParam === '1';
  const { snapshot, mode, refetch, resumeIdle } = useLivePoll(initial, paused);
  const now = useClock();
  const data = snapshot.data ?? initial;
  const stopped = snapshot.status === 'unauthorized' || snapshot.status === 'forbidden' || snapshot.status === 'budget';

  const togglePause = useCallback(() => {
    if (paused) {
      void setPausedParam(null);
      refetch();
    } else {
      void setPausedParam('1');
    }
  }, [paused, refetch, setPausedParam]);

  // Shortcut P (not while typing, not with a modifier).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause]);

  const empty = data.online === 0 && data.listed === 0;

  return (
    <>
      <LiveHeader
        controls={
          <>
            <LiveStatus
              mode={mode}
              status={snapshot.status}
              updatedAt={snapshot.updatedAt}
              now={now}
              onResumeIdle={resumeIdle}
              onRetry={refetch}
            />
            {!stopped && (
              <AdminButton size="sm" icon={paused ? Play : Pause} aria-pressed={paused} aria-keyshortcuts="P" onClick={togglePause}>
                {paused ? 'Resume' : 'Pause'}
              </AdminButton>
            )}
          </>
        }
      />

      {empty ? (
        <EmptyState
          size="page"
          illustration={<NoDataYet />}
          title="Nobody is on the site right now"
          body="This page checks every 30 seconds."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <LiveSummary data={data} updatedAt={snapshot.updatedAt} />
          <div className="grid gap-4 lg:grid-cols-5">
            <LiveMap sessions={data.sessions} className="lg:col-span-2" />
            <LiveVisitorsTable sessions={data.sessions} at={data.at} selfUid={selfUid} blockActor={blockActor} className="lg:col-span-3" />
          </div>
          <LiveEventFeed events={data.events} />
        </div>
      )}
    </>
  );
}

/**
 * Live (03-live.md): server-rendered first data, then a poll every 30 s while
 * the tab is visible (T-26). The TanStack Query provider is scoped to this view.
 */
export default function LiveView(props: LiveViewProps) {
  return (
    <PollingProvider>
      <Live {...props} />
    </PollingProvider>
  );
}
