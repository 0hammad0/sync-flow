import 'server-only';

import { unstable_cache } from 'next/cache';
import { getSessionDetail } from '@/features/admin/analytics/queries';
import { FILE_TYPE_LABELS, formatBytes } from '@/features/admin/files/format';
import { getFile } from '@/features/admin/files/queries';
import { ROOMS_TAG } from '@/features/admin/rooms/queries';
import { USERS_TAG } from '@/features/admin/users/queries';
import { can, type Permission } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import { getContainer } from '@/server/container';
import { fileIdCodecFromEnv } from '@/server/files/file-id';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import type { QueryShape } from './search-detect';
import {
  SEARCH_GROUP_MAX,
  SEARCH_GROUP_ORDER,
  type SearchGroupDto,
  type SearchGroupId,
  type SearchItemDto,
  type SearchResultDto,
} from './search-types';

// Command palette server search (16-command-palette.md "Search"). The action
// has already passed requireAdmin('analytics:read'); each group checks its own
// permission here: `can()` skips a group the role cannot see (silently, and
// without an `auth.denied` row), then `check()` (requireAdmin) enforces it.
//
// Firestore budget: at most 2 point reads per query (32 hex: share file +
// session), every other shape 0 or 1, all through repositories that ask
// QuotaGuard first (QuotaExceededError → `notice: 'budget'`, no throw).
// User lookups are Firebase Auth calls, not Firestore reads. Each lookup is
// cached under its screen's tag, so a repeated query costs nothing.

export type UserHit = { uid: string; email: string | null; disabled: boolean };
export type RoomHit = { code: string; expiresAt: string };
export type FileHit = { id: string; type: string; size: number };
export type SessionHit = { id: string; entryPath: string | null; country: string | null; pageviews: number };

export type SearchDeps = {
  /** requireAdmin in production. Throws when the role lacks `permission`. */
  check: (permission: Permission) => Promise<unknown>;
  /** Exact email (lower case) or uid. */
  findUser: (term: string) => Promise<UserHit | null>;
  getRoom: (code: string) => Promise<RoomHit | null>;
  /** A share file by its token. The token never leaves the server: the hit carries the opaque file id. */
  getShareFile: (token: string) => Promise<FileHit | null>;
  getSession: (id: string, canSeeIp: boolean) => Promise<SessionHit | null>;
};

const LABELS: Record<SearchGroupId, string> = {
  ip: 'IP address',
  user: 'User',
  room: 'Room',
  file: 'File',
  session: 'Session',
  block: 'Block',
};

const ROOM_TTL_S = 30;
const USER_TTL_S = 300;

/** `Error 5` style summary: a lookup error can hold a doc path (a share doc id is its token). */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? `${name} ${code}` : name;
}

class Collector {
  private readonly groups = new Map<SearchGroupId, SearchItemDto[]>();
  notice: SearchResultDto['notice'] = null;

  add(group: SearchGroupId, item: SearchItemDto) {
    const items = this.groups.get(group) ?? [];
    if (items.length < SEARCH_GROUP_MAX) items.push(item);
    this.groups.set(group, items);
  }

  has(group: SearchGroupId) {
    return (this.groups.get(group)?.length ?? 0) > 0;
  }

  /** Runs one lookup. A failure skips its rows and sets the notice; it never fails the whole search. */
  async lookup<T>(what: string, read: () => Promise<T>): Promise<T | null | undefined> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        this.notice = 'budget';
      } else {
        if (this.notice !== 'budget') this.notice = 'error';
        console.error(`[admin] palette: ${what} lookup failed ${crypto.randomUUID()}`, errorKind(error));
      }
      return undefined;
    }
  }

  result(): SearchResultDto {
    const groups: SearchGroupDto[] = SEARCH_GROUP_ORDER.filter((id) => this.has(id)).map((id) => ({
      id,
      label: LABELS[id],
      items: this.groups.get(id)!,
    }));
    return { groups, notice: this.notice };
  }
}

const info = (id: string, title: string): SearchItemDto => ({ id, title, subtitle: null, href: null, action: null, copy: null });

/**
 * Server groups for one detected query. `shape` comes from detectQuery();
 * `text` and `partial-ip` have nothing to look up and return no groups.
 */
export async function runAdminSearch(ctx: AdminContext, shape: QueryShape, deps: SearchDeps): Promise<SearchResultDto> {
  const out = new Collector();
  /** can() first (silent skip), then the real check (T-6). */
  const allowed = async (...permissions: Permission[]) => {
    if (!permissions.every((p) => can(ctx.role, p))) return false;
    for (const p of permissions) await deps.check(p);
    return true;
  };
  const canSeeIp = can(ctx.role, 'ip:read');

  switch (shape.kind) {
    case 'ip': {
      // Sessions refuses IP search without ip:read, so a viewer gets no IP group at all.
      if (!(await allowed('analytics:read', 'ip:read'))) break;
      const { ip } = shape;
      out.add('ip', {
        id: 'ip:sessions',
        title: `Sessions from ${ip}`,
        subtitle: 'Every day, newest 100',
        href: `/admin/sessions?q=${encodeURIComponent(ip)}`,
        action: null,
        copy: ip,
      });
      if (await allowed('blocks:write')) {
        out.add('ip', { id: 'ip:block', title: `Block ${ip}…`, subtitle: null, href: null, action: { id: 'block', type: 'ip', value: ip }, copy: ip });
      }
      if (await allowed('blocks:read')) {
        out.add('ip', {
          id: 'ip:blocks',
          title: `Blocks matching ${ip}`,
          subtitle: 'Access control',
          href: `/admin/access?q=${encodeURIComponent(ip)}`,
          action: null,
          copy: ip,
        });
      }
      break;
    }

    case 'email':
    case 'uid': {
      if (!(await allowed('users:read'))) break;
      const term = shape.kind === 'email' ? shape.email : shape.uid;
      const user = await out.lookup('user', () => deps.findUser(term));
      if (user === undefined) break;
      if (!user) {
        out.add('user', info('user:none', shape.kind === 'email' ? 'No user with this email.' : 'No user with this id.'));
        break;
      }
      out.add('user', {
        id: `user:${user.uid}`,
        title: user.email ?? 'No email on this account',
        subtitle: user.disabled ? `${user.uid} · Disabled` : user.uid,
        href: `/admin/users/${encodeURIComponent(user.uid)}`,
        action: null,
        copy: user.uid,
      });
      if (await allowed('analytics:read')) {
        out.add('user', {
          id: `user:sessions:${user.uid}`,
          title: 'Sessions by this user',
          subtitle: null,
          href: `/admin/sessions?q=${encodeURIComponent(user.uid)}`,
          action: null,
          copy: null,
        });
      }
      if (await allowed('blocks:write')) {
        out.add('user', {
          id: `user:block:${user.uid}`,
          title: 'Block this user…',
          subtitle: null,
          href: null,
          action: { id: 'block', type: 'uid', value: user.uid },
          copy: user.uid,
        });
      }
      break;
    }

    case 'room': {
      if (!(await allowed('rooms:read'))) break;
      const room = await out.lookup('room', () => deps.getRoom(shape.code));
      if (room === undefined) break;
      if (!room) {
        out.add('room', info('room:none', 'No live room with this code.'));
        break;
      }
      const expired = Date.parse(room.expiresAt) <= Date.now();
      out.add('room', {
        id: `room:${room.code}`,
        title: room.code,
        subtitle: expired ? 'Expired, not swept yet' : 'Live room',
        href: `/admin/rooms?code=${room.code}`,
        action: null,
        copy: room.code,
      });
      break;
    }

    case 'hex32': {
      // A share token and a session id have the same shape: try both (edge case 1).
      const [fileOk, sessionOk] = [await allowed('files:read'), await allowed('analytics:read')];
      const [file, session] = await Promise.all([
        fileOk ? out.lookup('file', () => deps.getShareFile(shape.value)) : Promise.resolve(undefined),
        sessionOk ? out.lookup('session', () => deps.getSession(shape.value, canSeeIp)) : Promise.resolve(undefined),
      ]);
      if (file) {
        out.add('file', {
          id: `file:${file.id}`,
          title: 'Shared file',
          subtitle: `${file.type} · ${formatBytes(file.size)}`,
          href: `/admin/files/${file.id}`,
          action: null,
          copy: file.id,
        });
      }
      if (session) {
        out.add('session', {
          id: `session:${session.id}`,
          title: `Session ${session.id.slice(0, 8)}…`,
          subtitle: [session.entryPath ?? '/', session.country ?? 'Unknown country', `${session.pageviews} pages`].join(' · '),
          href: `/admin/sessions/${session.id}`,
          action: null,
          copy: session.id,
        });
      }
      const looked = (fileOk && file !== undefined) || (sessionOk && session !== undefined);
      if (!file && !session && looked) {
        out.add(sessionOk ? 'session' : 'file', info('hex:none', 'No shared file or session with this id.'));
      }
      break;
    }

    case 'block-ref': {
      // The access screen only searches by value for roles that see values.
      if (!(await allowed('blocks:read', 'ip:read'))) break;
      out.add('block', {
        id: `block:${shape.ref}`,
        title: `Find block ${shape.ref}`,
        subtitle: 'Access control',
        href: `/admin/access?q=${encodeURIComponent(shape.ref)}`,
        action: null,
        copy: shape.ref,
      });
      break;
    }

    case 'partial-ip':
    case 'text':
      break;
  }

  return out.result();
}

// ---------------------------------------------------------------------------
// Production lookups. Each is cached under the tag its screen already clears.

const cachedUser = unstable_cache(
  async (term: string): Promise<UserHit | null> => {
    const user = await getContainer().users.find(term);
    return user ? { uid: user.uid, email: user.email, disabled: user.disabled } : null;
  },
  ['admin-palette-user'],
  { tags: [USERS_TAG], revalidate: USER_TTL_S },
);

/** 1 read (QuotaGuard-checked in the repository). Metadata only [D-4]: no room name. */
const cachedRoom = unstable_cache(
  async (code: string): Promise<RoomHit | null> => {
    const room = await getContainer().rooms.get(code);
    return room ? { code: room.code, expiresAt: room.expiresAt.toISOString() } : null;
  },
  ['admin-palette-room'],
  { tags: [ROOMS_TAG], revalidate: ROOM_TTL_S },
);

const fileIds = fileIdCodecFromEnv();

/** Turns a query result failure back into the error the Collector understands. */
function failed(state: 'budget' | 'error' | 'setup' | 'index'): never {
  if (state === 'budget') throw new QuotaExceededError('reads', 'cap');
  throw new Error(`lookup ${state}`);
}

export const searchLookups: Omit<SearchDeps, 'check'> = {
  findUser: cachedUser,
  getRoom: cachedRoom,
  async getShareFile(token) {
    // Same path as the file detail page: getFile (1 read, cached 5 min, `files` tag).
    const id = fileIds.encode({ kind: 'share', token });
    const result = await getFile(id, false);
    if (result.state === 'not_found') return null;
    if (result.state !== 'ok') failed(result.state);
    return { id: result.file.id, type: FILE_TYPE_LABELS[result.file.type], size: result.file.size };
  },
  async getSession(id, canSeeIp) {
    // Same path as the session detail page: 1 read, cached 5 min, `rollups` tag.
    const result = await getSessionDetail(id, { canSeeIp });
    if (result.state !== 'ok') failed(result.state);
    const s = result.data;
    return s ? { id: s.id, entryPath: s.entryPath, country: s.country, pageviews: s.pageviews } : null;
  },
};
