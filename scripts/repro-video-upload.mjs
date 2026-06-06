// Reproduce the in-chat video upload through the REAL client path:
// headless Chrome -> paperclip file input -> XHR -> message bubble <video>.
// Usage: node scripts/repro-video-upload.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BASE = process.argv[2] || 'http://localhost:3001';
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

// Create a room
const room = await (await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ttlHours: 1, tz: 'UTC' }),
})).json();
if (!room.success) fail('create room: ' + JSON.stringify(room));
console.log('room:', room.code);

// A small fake-but-typed mp4 (4MB) — message flow doesn't care about codec
const dir = mkdtempSync(join(tmpdir(), 'sf-vid-'));
const vidPath = join(dir, 'clip.mp4');
writeFileSync(vidPath, Buffer.concat([Buffer.from('\x00\x00\x00\x20ftypisom'), Buffer.alloc(4 * 1024 * 1024)]));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 200)); });
const responses = [];
page.on('response', (r) => {
  if (r.url().includes('/attachments')) responses.push(`${r.request().method()} ${r.status()}`);
});
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('syncflow.chatName', 'VidTester');
  localStorage.setItem('syncflow.deviceId', 'device-vid-test-1111');
});
await page.goto(`${BASE}/chat/${room.code}`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('input[type="file"]', { timeout: 60000 });

// Upload through the real hidden input (same element the paperclip opens)
const input = await page.$('input[type="file"]');
await input.uploadFile(vidPath);

// Wait for either a <video> bubble or an error message
const result = await Promise.race([
  page.waitForSelector('video', { timeout: 30000 }).then(() => 'video'),
  page.waitForSelector('p.text-xs.text-red-600, [class*="text-red"]', { timeout: 30000 }).then(async () =>
    'error: ' + (await page.$eval('[class*="text-red"]', (el) => el.textContent))
  ),
]).catch(() => 'neither appeared within 30s');

console.log('attachment requests:', responses.join(', ') || 'NONE');
console.log('outcome:', result);

if (result !== 'video') {
  await page.screenshot({ path: 'scripts/video-upload-fail.png' });
  console.log('screenshot: scripts/video-upload-fail.png');
  await browser.close();
  fail(result);
}
// Confirm the video element points at our redirect endpoint
const src = await page.$eval('video', (el) => el.getAttribute('src'));
if (!src?.includes('/attachments?key=')) fail('video src wrong: ' + src);
console.log('PASS: video uploaded through the real UI and renders as <video> (src=' + src.slice(0, 60) + '...)');
await browser.close();
