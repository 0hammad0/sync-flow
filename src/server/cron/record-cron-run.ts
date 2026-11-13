import 'server-only';

/**
 * STUB (phase 2 wave 1). The real version comes from phase 1 step 1.7
 * (`admin_cron_runs`) and replaces this file at merge.
 * Contract: writes one run record; never throws.
 */
export async function recordCronRun(run: {
  job: string;
  startedAt: Date;
  endedAt: Date;
  status: 'ok' | 'partial' | 'failed';
  counts: Record<string, number>;
  error?: string | null;
}): Promise<void> {
  void run;
}
