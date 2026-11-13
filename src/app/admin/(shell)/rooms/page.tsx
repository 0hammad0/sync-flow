import type { Metadata } from 'next';
import { after } from 'next/server';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Info } from 'lucide-react';
import RoomHistoryTable from '@/features/admin/rooms/components/RoomHistoryTable';
import RoomsTable from '@/features/admin/rooms/components/RoomsTable';
import {
  getRoomDetail,
  listRoomHistory,
  listRooms,
  notePeakOnline,
  type RoomHistoryPageDto,
  type RoomsPage,
} from '@/features/admin/rooms/queries';
import { roomsParamsSchema } from '@/features/admin/rooms/schemas';
import type { RoomDetailDto } from '@/features/admin/rooms/types';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import { FIRST_PAGE_CURSOR } from '@/shared/ui/data-table/url-state';

export const metadata: Metadata = { title: 'Rooms' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function loadError(what: string, e: unknown): { reason: string; errorId: string } {
  const errorId = crypto.randomUUID();
  console.error(`[admin] ${what} failed ${errorId}`, e);
  return { reason: 'Try again in a moment.', errorId };
}

// 12-rooms.md. Metadata only [D-4]: counts, sizes and times. A page view, so
// no blocklist read here (T-27); closeRoom does its own check.
export default async function RoomsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('rooms:read', '/admin/rooms');
  const raw = await searchParams;
  const params = roomsParamsSchema.parse({
    status: first(raw.status),
    ttl: first(raw.ttl),
    q: first(raw.q) || undefined,
    cursor: first(raw.cursor) || undefined,
    code: first(raw.code) || undefined,
  });
  const page = { prevCursor: params.cursor ? FIRST_PAGE_CURSOR : null };
  const canSeeUsers = can(ctx.role, 'users:read');

  let body;
  if (params.status === 'history') {
    let data: RoomHistoryPageDto | null = null;
    let error: { reason: string; errorId?: string } | undefined;
    try {
      data = await listRoomHistory(params.cursor ?? null);
    } catch (e) {
      error = loadError('room history', e);
    }
    body = (
      <RoomHistoryTable
        rows={data?.rows ?? []}
        page={{ ...page, nextCursor: data?.nextCursor ?? null }}
        canSeeUsers={canSeeUsers}
        error={error}
      />
    );
  } else {
    let data: RoomsPage | null = null;
    let error: { reason: string; errorId?: string } | undefined;
    let sheet: { code: string; detail: RoomDetailDto | null } | null = null;
    try {
      const [list, detail] = await Promise.all([listRooms(params), params.code ? getRoomDetail(params.code) : null]);
      data = list;
      if (params.code) sheet = { code: params.code, detail };
    } catch (e) {
      error = loadError('rooms list', e);
    }
    // peak_online from what this view saw, after the response (never slows the page).
    const seen = [...(data?.rows ?? []), ...(sheet?.detail ? [sheet.detail] : [])];
    if (seen.some((r) => (r.onlineCount ?? 0) > 0)) after(() => notePeakOnline(seen));

    body = (
      <RoomsTable
        rows={data?.rows ?? []}
        status={params.status}
        ttl={params.ttl ?? null}
        page={{ ...page, nextCursor: data?.nextCursor ?? null }}
        sheet={sheet}
        nowMs={data?.checkedAt ?? 0}
        canClose={can(ctx.role, 'rooms:close')}
        canSeeUsers={canSeeUsers}
        adminEmail={ctx.email}
        error={error}
      />
    );
  }

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Rooms</h1>
        <p className="mt-1 text-sm text-fg-muted">Live chat rooms. Message text is never shown.</p>
        <p className="mt-3 flex items-start gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <Info aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
          Counts, sizes and times only. No messages, images, voice notes or file names are read or shown here.
        </p>
      </header>
      <NuqsAdapter>{body}</NuqsAdapter>
    </>
  );
}
