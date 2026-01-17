import { randomBytes } from 'crypto';

// Constants
export const MAX_USER_FILES = 10;

export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

export function sanitizeFileName(fileName: string): string {
  // Remove or replace characters that are problematic for file systems/URLs
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 255);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getBaseUrl(): string {
  // First check explicit app URL (works on both client and server)
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  // Server-side: use Vercel URL
  if (typeof window === 'undefined') {
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
    return 'http://localhost:3000';
  }

  // Client-side: use current origin
  return window.location.origin;
}
