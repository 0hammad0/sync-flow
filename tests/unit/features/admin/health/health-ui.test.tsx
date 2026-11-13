import { render, screen } from '@testing-library/react';
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import CleanupCronSummary from '@/features/admin/health/components/CleanupCronSummary';
import CronRunsTable from '@/features/admin/health/components/CronRunsTable';
import { cronCheck, type CronRunDto } from '@/features/admin/health/cron-status';

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
