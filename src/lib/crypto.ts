/**
 * Client-side encryption using AES-256-GCM via Web Crypto API.
 * Key is stored in URL fragment (#key) and never sent to server.
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV for GCM

/**
 * Check if Web Crypto API is available
 */
export function isEncryptionSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined'
  );
}

/**
 * Generate a new AES-256 key
 */
export async function generateKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Export key to URL-safe base64 string
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64Url(rawKey);
}

/**
 * Import key from URL-safe base64 string
 */
export async function importKey(base64Key: string): Promise<CryptoKey> {
  const rawKey = base64UrlToArrayBuffer(base64Key);
  return await crypto.subtle.importKey(
    'raw',
    rawKey,
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    false, // not extractable
    ['decrypt']
  );
}

/**
 * Encrypt file data. Returns IV + ciphertext.
 */
export async function encryptFile(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<ArrayBuffer> {
  // Generate random 96-bit IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Encrypt data
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv,
    },
    key,
    data
  );

  // Prepend IV to ciphertext
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);

  return result.buffer;
}

/**
 * Decrypt file data. Expects IV + ciphertext format.
 */
export async function decryptFile(
  encryptedData: ArrayBuffer,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const data = new Uint8Array(encryptedData);

  // Extract IV and ciphertext
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  // Decrypt
  return await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv,
    },
    key,
    ciphertext
  );
}

/**
 * Convert ArrayBuffer to URL-safe base64 (no +, /, or =)
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Convert URL-safe base64 to ArrayBuffer
 */
function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  // Restore standard base64
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Extract encryption key from URL fragment
 */
export function getKeyFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash;
  if (!hash || hash.length <= 1) return null;

  return hash.substring(1); // Remove the '#'
}
