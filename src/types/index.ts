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
