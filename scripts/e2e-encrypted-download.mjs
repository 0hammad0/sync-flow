// E2E test of the encrypted upload -> share -> download -> decrypt pipeline.
// Mirrors exactly what UploadForm.tsx and DownloadCard.tsx do in the browser.
// Usage: node scripts/e2e-encrypted-download.mjs [baseUrl]
const BASE = process.argv[2] || 'http://localhost:3001';
const subtle = globalThis.crypto.subtle;

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

// --- 1. Encrypt exactly like src/lib/crypto.ts ---
const original = new TextEncoder().encode(
  'syncflow encrypted e2e payload ' + 'x'.repeat(5000)
);
const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, original);
const payload = new Uint8Array(12 + ciphertext.byteLength);
payload.set(iv, 0);
payload.set(new Uint8Array(ciphertext), 12);

// Export key as URL-safe base64 (like exportKey())
const rawKey = new Uint8Array(await subtle.exportKey('raw', key));
const keyB64 = Buffer.from(rawKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// --- 2. Upload like UploadForm.tsx ---
const form = new FormData();
form.append('file', new Blob([payload], { type: 'application/octet-stream' }));
form.append('originalName', 'secret-e2e.txt');
form.append('mimeType', 'text/plain');
form.append('isEncrypted', 'true');
form.append('expiresInHours', '1');

const upRes = await fetch(`${BASE}/api/upload`, {
  method: 'POST',
  body: form,
  headers: { Host: new URL(BASE).host },
});
const up = await upRes.json();
if (!up.success) fail('upload: ' + JSON.stringify(up));
console.log('1. uploaded OK   shareUrl =', `${up.shareUrl}#${keyB64.slice(0, 8)}...`);

// --- 3. Load share page, extract signed URL (what the server action returns) ---
const shareHtml = await (await fetch(`${BASE}/share/${up.token}`)).text();
const m = shareHtml.match(/https:[^"]*?r2\.cloudflarestorage\.com[^"]*/);
if (!m) fail('no signed URL found in share page HTML');
const signedUrl = m[0].replace(/\\$/, '').replace(/\\u0026/g, '&');
console.log('2. share page OK, signed URL extracted');

// --- 4. Download like DownloadCard.handleDownload (encrypted branch) ---
const dlRes = await fetch(signedUrl, { headers: { Origin: BASE } });
if (!dlRes.ok) fail(`signed URL fetch: ${dlRes.status} ${dlRes.statusText}`);
const acao = dlRes.headers.get('access-control-allow-origin');
if (!acao) fail('No Access-Control-Allow-Origin header — browser fetch would be blocked by CORS');
console.log('3. download OK   CORS:', acao, '  bytes:', (await dlRes.clone().arrayBuffer()).byteLength);
const encryptedData = await dlRes.arrayBuffer();

// --- 5. Decrypt like importKey() + decryptFile() ---
let b64 = keyB64.replace(/-/g, '+').replace(/_/g, '/');
while (b64.length % 4) b64 += '=';
const importedKey = await subtle.importKey('raw', Buffer.from(b64, 'base64'), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
const data = new Uint8Array(encryptedData);
const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, importedKey, data.slice(12));

const ok = Buffer.from(decrypted).equals(Buffer.from(original));
if (!ok) fail('decrypted bytes do not match original');
console.log('4. decrypt OK    bytes match original:', decrypted.byteLength);
console.log('PASS: encrypted upload -> share -> download -> decrypt all working');
