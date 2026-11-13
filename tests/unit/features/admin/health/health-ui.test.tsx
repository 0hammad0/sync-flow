import { render, screen } from '@testing-library/react';
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import CleanupCronSummary from '@/features/admin/health/components/CleanupCronSummary';
import CronRunsTable from '@/features/admin/health/components/CronRunsTable';
import { cronCheck, rollupCheck, type CronRunDto } from '@/features/admin/health/cron-status';
import QuotaMeters from '@/features/admin/health/components/QuotaMeters';
import RollupCronSummary from '@/features/admin/health/components/RollupCronSummary';
import TrackingSummary from '@/features/admin/health/components/TrackingSummary';
import {
  ingestCheck,
  meterStatus,
  quotaBanner,
  samplingStatus,
  type QuotaUsageDto,
} from '@/features/admin/health/tracking-status';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
  usePathname: () => '/admin/health',
  useSearchParams: () => new URLSearchParams(),
}));

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

function run(hoursAgo: number, extra: Partial<CronRunDto> = {}): CronRunDto {
  const started = NOW - hoursAgo * 3_600_000;
  return {
    id: `r${hoursAgo}`,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(started + 850).toISOString(),
    durationMs: 850,
    status: 'ok',
    filesDeleted: 41,
    roomsDeleted: 3,
    sessionsDeleted: 7,
    filesFailed: 0,
    timeBudgetUsed: false,
    sessionsRolledUp: null,
    ipsNulled: null,
    stoppedAtCap: false,
    errorId: null,
    ...extra,
  };
}

describe('Health v1 UI', () => {
  it('summary shows the last run, status and counts, with no missed warning inside 26 h', () => {
    render(<CleanupCronSummary check={cronCheck([run(9)], NOW)} now={NOW} />);
    expect(screen.getByText('OK')).toBeTruthy();
    expect(screen.getByText('13 Nov, 03:00 UTC')).toBeTruthy();
    expect(screen.getByText('41')).toBeTruthy();
    expect(screen.queryByText(/Missed run/)).toBeNull();
  });

  it('summary warns about a missed run past 26 h', () => {
    render(<CleanupCronSummary check={cronCheck([run(30)], NOW)} now={NOW} />);
    expect(screen.getByText('Fail')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Missed run: the last cleanup started 30 h ago/);
  });

  it('table lists runs with status words and an empty state', () => {
    const { unmount } = render(<CronRunsTable runs={[run(9), run(33, { status: 'error', errorId: 'err-9' })]} />, {
      wrapper: withNuqsTestingAdapter(),
    });
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
    expect(screen.getAllByText('err-9').length).toBeGreaterThan(0);
    unmount();
    render(<CronRunsTable runs={[]} />, { wrapper: withNuqsTestingAdapter() });
    expect(screen.getAllByText('No run recorded yet').length).toBeGreaterThan(0);
  });
});

describe('rollupCheck', () => {
  it('no rows = no data, with the 04:00 UTC schedule', () => {
    expect(rollupCheck([], NOW)).toMatchObject({ status: 'no_data', reason: 'No run recorded yet. Runs daily at 04:00 UTC.' });
  });

  it('fails past 26 h or on error', () => {
    expect(rollupCheck([run(27)], NOW).status).toBe('fail');
    expect(rollupCheck([run(8, { status: 'error' })], NOW).status).toBe('fail');
  });

  it('warns at 200 s, not at 200 s exactly', () => {
    expect(rollupCheck([run(8, { durationMs: 200_000 })], NOW).status).toBe('ok');
    expect(rollupCheck([run(8, { durationMs: 200_001 })], NOW).status).toBe('warn');
  });

  it('warns when stopped at the cap 3 nights in a row, not 2', () => {
    const capped = { stoppedAtCap: true, status: 'partial' as const };
    expect(rollupCheck([run(8, capped), run(32, capped)], NOW).status).toBe('ok');
    expect(rollupCheck([run(8, capped), run(32, capped), run(56, capped)], NOW).status).toBe('warn');
  });

  it('a partial run (cap or time budget) is OK: the rest runs tomorrow', () => {
    expect(rollupCheck([run(8, { status: 'partial' })], NOW)).toMatchObject({ status: 'ok', reason: 'Ran on time. Leftover work continues tomorrow.' });
  });

  it('summary card shows rollup counts', () => {
    render(<RollupCronSummary check={rollupCheck([run(8, { sessionsRolledUp: 412, ipsNulled: 9 })], NOW)} now={NOW} />);
    expect(screen.getByRole('heading', { name: 'Rollup cron' })).toBeTruthy();
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
  });
});

const USAGE: QuotaUsageDto = {
  day: '2026-11-13',
  used: { reads: 100, writes: 100, deletes: 0 },
  caps: { reads: 10_000, writes: 5_000, deletes: 5_000 },
  defaultCaps: true,
  stoppedUntil: null,
};
const withUsed = (used: Partial<QuotaUsageDto['used']>): QuotaUsageDto => ({ ...USAGE, used: { ...USAGE.used, ...used } });

describe('quota meters and banner', () => {
  it('meter status edges: 69.99% ok, 70% warn, 100% fail', () => {
    expect(meterStatus(3_499, 5_000)).toBe('ok');
    expect(meterStatus(3_500, 5_000)).toBe('warn');
    expect(meterStatus(4_999, 5_000)).toBe('warn');
    expect(meterStatus(5_000, 5_000)).toBe('fail');
  });

  it('no banner under 70%', () => {
    expect(quotaBanner(withUsed({ writes: 3_499 }))).toBeNull();
  });

  it('amber at 70% writes, and says sampling is on', () => {
    expect(quotaBanner(withUsed({ writes: 3_600 }))).toEqual({
      tone: 'warning',
      text: "Firestore writes at 72% of today's admin + tracker cap. Tracking is sampled: 1 in 2 sessions is kept.",
    });
  });

  it('amber on reads alone does not claim sampling', () => {
    expect(quotaBanner(withUsed({ reads: 7_000 }))?.text).toBe("Firestore reads at 70% of today's admin + tracker cap.");
  });

  it('red at 100%, naming what stops', () => {
    expect(quotaBanner(withUsed({ writes: 5_000, reads: 10_000 }))).toEqual({
      tone: 'danger',
      text: "Today's Firestore writes and reads budget is used up. Tracking is paused. Admin pages show cached numbers. It resets at 00:00 UTC.",
    });
  });

  it('red when Firestore itself stopped us', () => {
    expect(quotaBanner({ ...USAGE, stoppedUntil: '2026-11-14T08:00:00.000Z' })?.tone).toBe('danger');
  });

  it('meters show used of cap, percent and a status word per kind', () => {
    render(<QuotaMeters usage={withUsed({ writes: 3_600 })} />);
    const writes = screen.getByRole('meter', { name: 'Firestore writes used today' });
    expect(writes.getAttribute('aria-valuetext')).toBe('3,600 of 5,000');
    expect(screen.getByText('3,600 of 5,000 · 72%')).toBeTruthy();
    expect(screen.getByText('Warn')).toBeTruthy();
    expect(screen.getAllByText('OK')).toHaveLength(2);
    expect(screen.getByText(/default caps/)).toBeTruthy();
  });

  it('sampling status follows the write meter', () => {
    expect(samplingStatus(USAGE).status).toBe('ok');
    expect(samplingStatus(withUsed({ writes: 3_500 })).status).toBe('warn');
    expect(samplingStatus(withUsed({ writes: 5_000 })).status).toBe('fail');
  });
});

describe('ingest check', () => {
  const counts = (accepted: number, error: number) => ({ accepted, error, dropped: 0, sampledOut: 0 });

  it('tracking off is not a failure', () => {
    expect(ingestCheck(false, counts(0, 0))).toMatchObject({ status: 'no_data', reason: 'Tracking is off.' });
  });

  it('on with no events in 24 h fails', () => {
    expect(ingestCheck(true, counts(0, 0)).status).toBe('fail');
  });

  it('error rate edges: < 1% ok, 1% warn, 5% warn, > 5% fail', () => {
    expect(ingestCheck(true, counts(991, 9)).status).toBe('ok');
    expect(ingestCheck(true, counts(990, 10)).status).toBe('warn');
    expect(ingestCheck(true, counts(950, 50)).status).toBe('warn');
    expect(ingestCheck(true, counts(949, 51)).status).toBe('fail');
  });

  it('card shows Off and how to turn it on', () => {
    render(<TrackingSummary enabled={false} ingest={counts(0, 0)} usage={USAGE} />);
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByText(/Tracking is off\. No visit data is collected/)).toBeTruthy();
  });

  it('card shows On, counts and the failed share', () => {
    render(<TrackingSummary enabled ingest={{ accepted: 980, error: 20, dropped: 3, sampledOut: 0 }} usage={USAGE} />);
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('1,003')).toBeTruthy();
    expect(screen.getByText('20 (2.0%)')).toBeTruthy();
    expect(screen.getByText('Warn')).toBeTruthy();
  });
});
