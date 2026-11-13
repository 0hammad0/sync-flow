// DTOs for the rooms screen. Counts, sizes and times only [D-4]: no message
// text, no file names, no previews or links to content. Never a raw doc.

/** One live (or expired, not yet swept) room. `null` = that number could not be read. */
export type RoomRowDto = {
  code: string;
  name: string | null;
  ttlHours: number;
  /** ISO strings: DTOs cross the server/client boundary and the cache. */
  createdAt: string;
  expiresAt: string;
  /** Creator uid (signed-in creator) or null (guest). Never an email here. */
  createdBy: string | null;
  onlineCount: number | null;
  messageCount: number | null;
  /** Objects under `chat/{code}/` in R2: attachments, voice notes, long-text bodies. */
  fileCount: number | null;
  totalBytes: number | null;
};

export type RoomDetailDto = RoomRowDto & {
  creatorTz: string | null;
  voiceCount: number | null;
};

/** One closed room from `a_rooms`. */
export type RoomHistoryRowDto = {
  code: string;
  name: string | null;
  ttlHours: number;
  createdAt: string;
  closedAt: string;
  /** `cron` (expired) or the closing admin's uid. */
  closedBy: string;
  createdBy: string | null;
  messageCount: number | null;
  fileCount: number | null;
  totalBytes: number | null;
  voiceCount: number | null;
  /** Highest online count seen by the admin or at close. A lower bound, not a true peak. */
  peakOnline: number | null;
};

/** Every key a room DTO may carry. A test fails if a DTO grows a field outside this list. */
export const ROOM_DETAIL_KEYS = [
  'code',
  'name',
  'ttlHours',
  'createdAt',
  'expiresAt',
  'createdBy',
  'onlineCount',
  'messageCount',
  'fileCount',
  'totalBytes',
  'creatorTz',
  'voiceCount',
] as const satisfies readonly (keyof RoomDetailDto)[];

export const ROOM_HISTORY_KEYS = [
  'code',
  'name',
  'ttlHours',
  'createdAt',
  'closedAt',
  'closedBy',
  'createdBy',
  'messageCount',
  'fileCount',
  'totalBytes',
  'voiceCount',
  'peakOnline',
] as const satisfies readonly (keyof RoomHistoryRowDto)[];
