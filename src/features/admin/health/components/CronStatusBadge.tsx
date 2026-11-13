import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import Badge from '@/shared/ui/Badge';
import type { CheckStatus } from '../cron-status';

const LOOK = {
  ok: { tone: 'success', icon: CircleCheck, label: 'OK' },
  partial: { tone: 'warning', icon: TriangleAlert, label: 'Partial' },
  warn: { tone: 'warning', icon: TriangleAlert, label: 'Warn' },
  error: { tone: 'danger', icon: CircleX, label: 'Error' },
  fail: { tone: 'danger', icon: CircleX, label: 'Fail' },
  no_data: { tone: 'neutral', icon: Info, label: 'No data' },
} as const;

/** Icon + word: colour is never the only signal (14-health.md "Status"). */
export default function CronStatusBadge({ status }: { status: CheckStatus | 'partial' | 'error' }) {
  const look = LOOK[status];
  return (
    <Badge tone={look.tone} icon={look.icon}>
      {look.label}
    </Badge>
  );
}
