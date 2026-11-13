import Badge from '@/shared/ui/Badge';
import type { UserRowDto } from '../types';

const LABELS = { owner: 'Owner', moderator: 'Moderator', viewer: 'Viewer' } as const;

/** `owner` brand, others neutral, "—" for no role (13-users.md "Role badge"). */
export default function RoleBadge({ role }: { role: UserRowDto['role'] }) {
  if (!role) return <span className="text-fg-muted">—</span>;
  return <Badge tone={role === 'owner' ? 'brand' : 'neutral'}>{LABELS[role]}</Badge>;
}
