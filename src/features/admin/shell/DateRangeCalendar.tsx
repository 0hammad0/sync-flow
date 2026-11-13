'use client';

import { useState, type FormEvent } from 'react';
import AdminButton from '@/shared/ui/AdminButton';
import Input from '@/shared/ui/Input';
import { MAX_SPAN_DAYS, isIsoDay, spanDays, utcDayOf } from '@/features/admin/analytics/range';

type DateRangeCalendarProps = {
  initialFrom: string | null;
  initialTo: string | null;
  onApply: (from: string, to: string) => void;
};

/**
 * Custom range: two native date fields (the browser's calendar, keyboard
 * and screen-reader ready, no date library). Loaded lazily by
 * DateRangePicker. `from > to` is swapped on apply (02-overview.md); more
 * than 365 days is refused with a message.
 */
export default function DateRangeCalendar({ initialFrom, initialTo, onApply }: DateRangeCalendarProps) {
  // Today in UTC, read once when the panel opens (client only: ssr is off).
  const [today] = useState(() => utcDayOf(Date.now()));
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');

  const valid = isIsoDay(from) && isIsoDay(to);
  const [start, end] = valid && from > to ? [to, from] : [from, to];
  const tooLong = valid && spanDays(start, end) > MAX_SPAN_DAYS;
  const error = tooLong ? `Pick ${MAX_SPAN_DAYS} days or fewer.` : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || tooLong) return;
    onApply(start, end > today ? today : end);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <div className="flex flex-col gap-2">
        <Input label="From" type="date" size="sm" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" size="sm" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
      <AdminButton type="submit" variant="primary" size="sm" fullWidth disabled={!valid || tooLong}>
        Apply
      </AdminButton>
    </form>
  );
}
