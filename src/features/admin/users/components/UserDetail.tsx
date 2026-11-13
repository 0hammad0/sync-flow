import type { ReactNode } from 'react';
import Link from 'next/link';
import Badge from '@/shared/ui/Badge';
import { formatAgo, formatBytes, formatDay, formatNumber, formatUtc } from '@/features/admin/format';
import type { UserDetailDto } from '../types';
import RoleBadge from './RoleBadge';
import UserActions, { type UserActionPermissions } from './UserActions';

type UserDetailProps = {
  user: UserDetailDto;
  isSelf: boolean;
  can: UserActionPermissions;
  adminEmail: string | null;
  nowMs: number;
};

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-edge py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-sm break-all text-fg tabular-nums sm:text-right">{children}</dd>
    </div>
  );
}

/**
 * /admin/users/[uid] (13-users.md). File count and storage only, never file
 * names [D-6]. Self: no actions, and the server refuses them anyway.
 */
export default function UserDetail({ user, isSelf, can, adminEmail, nowMs }: UserDetailProps) {
  const anyAction = can.disable || can.revoke || can.roles;
  return (
    <div className="max-w-3xl">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold break-all text-fg">
            {user.email ?? user.uid}
            {user.disabled && <Badge tone="danger">Disabled</Badge>}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-fg-muted">
            Role: <RoleBadge role={user.role} />
          </p>
        </div>
        {isSelf ? (
          <p className="text-sm text-fg-muted">This is you. Actions on your own account are not available.</p>
        ) : (
          anyAction && <UserActions user={user} can={can} adminEmail={adminEmail} />
        )}
      </header>
      <dl>
        <Item label="uid">
          <span className="font-mono text-[13px]">{user.uid}</span>
        </Item>
        <Item label="Joined">{formatDay(user.createdAt)}</Item>
        <Item label="Last sign-in">{formatUtc(user.lastSignInAt)}</Item>
        <Item label="Last seen">
          {formatAgo(user.lastSeenAt, nowMs)}
          <span className="block text-xs text-fg-muted">From sign-in data only.</span>
        </Item>
        <Item label="Files">{formatNumber(user.fileCount)}</Item>
        <Item label="Storage">{formatBytes(user.fileBytes)}</Item>
      </dl>
      <p className="mt-3 text-xs text-fg-muted">
        Counts and sizes of shared files only. File names and contents are never shown.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/admin/users" className="text-fg-muted hover:text-fg hover:underline">
          <span aria-hidden="true">←</span> Back to users
        </Link>
      </p>
    </div>
  );
}
