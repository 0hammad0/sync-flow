export interface FileRecord {
  id: string;
  token: string;
  file_path: string;
  original_name: string;
  size: number;
  mime_type: string;
  owner_id: string | null;
  created_at: string;
  is_encrypted: boolean;
  expires_at: string | null;
  max_downloads: number | null;
  download_count: number;
}

export interface UploadResult {
  success: boolean;
  shareUrl?: string;
  token?: string;
  error?: string;
}

export interface DownloadInfo {
  success: boolean;
  signedUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  error?: string;
  isEncrypted?: boolean;
  createdAt?: string;
  expiresAt?: string | null;
  downloadsRemaining?: number | null;
  token?: string;
}

export interface FileWithUrl extends FileRecord {
  shareUrl: string;
}

export interface UploadOptions {
  encrypted?: boolean;
  expiresInHours?: number;
  maxDownloads?: number;
}

export type UploadStage = 'idle' | 'preparing' | 'encrypting' | 'uploading' | 'completed' | 'error';

export interface UploadProgress {
  stage: UploadStage;
  percent: number;
  bytesUploaded?: number;
  totalBytes?: number;
}

// Chat: temporary rooms for real-time messaging.
export interface ChatRoom {
  code: string;
  name: string | null;
  created_at: string;       // ISO UTC
  expires_at: string;       // ISO UTC
  ttl_hours: 1 | 24 | 168;
  created_by: string | null;
  creator_tz: string | null;
}

// Media/file shared in a chat message. Body lives in R2 under
// chat/{roomCode}/... so the whole room's storage can be deleted by prefix
// when the room expires.
export interface ChatAttachment {
  key: string;        // R2 object key
  name: string;       // original filename
  size: number;       // bytes
  mime_type: string;
  // True when this is the body of a long TEXT message (over the inline
  // Firestore limit): message.content holds a preview, the full text lives
  // in R2 and renders expanded in the bubble, not as a file card.
  is_long_text?: boolean;
}

// Compact reference to the message being replied to — denormalized so a
// quote renders without a second read, WhatsApp-style.
export interface ChatReplyRef {
  id: string;
  sender_name: string;
  snippet: string;          // first ~120 chars of text, or the attachment name
  attachment_kind: 'image' | 'video' | 'audio' | 'file' | null;
}

// Ephemeral presence doc at rooms/{code}/presence/{deviceId}. Server-written
// (heartbeats), client-read in real time. Online/typing are derived
// client-side from the timestamps — nothing has to be written to "go offline".
export interface ChatPresence {
  device_id: string;
  name: string;
  last_seen: string;          // ISO UTC, server-stamped
  typing_until: string | null; // ISO UTC — typing while this is in the future
}

// Who reacted: a stable per-device id plus the display name at reaction time.
// Identity is the id — two people sharing a display name stay distinct.
export interface ChatReactor {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  sender_name: string;
  sender_id: string | null;
  // Per-device id of the sender (random UUID minted in the browser).
  // Used for "is this my message" — display names can collide.
  sender_device_id?: string | null;
  content: string;          // text, or caption when attachment is present (may be '')
  created_at: string;       // ISO UTC, server-stamped
  sender_tz: string;        // IANA
  // 'system' = join/leave announcements rendered as a centered pill;
  // absent/'chat' = a normal user message bubble.
  kind?: 'chat' | 'system';
  attachment?: ChatAttachment | null;
  reply_to?: ChatReplyRef | null;
  // emoji -> reactors (one reaction per device). Old messages may still hold
  // plain name strings — normalizeReactors() upgrades them on read.
  reactions?: Record<string, ChatReactor[]>;
}
