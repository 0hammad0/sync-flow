'use client';

import SegmentedControl from '@/shared/ui/SegmentedControl';
import { ROOM_STATUSES, type RoomStatusParam } from '../schemas';

const LABELS: Record<RoomStatusParam, string> = { live: 'Live', expiring: 'Expiring < 1 h', history: 'History' };

/** Live / Expiring / History. History reads `a_rooms` (closed rooms). */
export default function RoomStatusFilter({
  value,
  onChange,
}: {
  value: RoomStatusParam;
  onChange: (next: RoomStatusParam) => void;
}) {
  return (
    <SegmentedControl
      label="Room status"
      size="sm"
      value={value}
      onValueChange={onChange}
      items={ROOM_STATUSES.map((s) => ({ value: s, label: LABELS[s] }))}
    />
  );
}
