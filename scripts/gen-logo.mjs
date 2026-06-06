// Renders public/logo.svg to public/logo.png (512px) and src/app/favicon.ico
// (PNG-embedded ICO, 32px) using puppeteer-core + installed Chrome.
// Usage: node scripts/gen-logo.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_PATHS = [
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = CHROME_PATHS.find((p) => {
  try { readFileSync(p); return true; } catch { return false; }
});
if (!executablePath) throw new Error('No Chrome/Edge found');

const svg = readFileSync(path.join(root, 'public', 'logo.svg'), 'utf8');

/** Wrap a single PNG buffer into a valid .ico file (Vista+ PNG-ICO). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // data size
  entry.writeUInt32LE(22, 12); // data offset (6 + 16)
  return Buffer.concat([header, entry, png]);
}

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();

  async function shot(size) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace(
        /width="\d+" height="\d+"/,
        `width="${size}" height="${size}"`
      )}</body></html>`
    );
    return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }

  const png512 = await shot(512);
  writeFileSync(path.join(root, 'public', 'logo.png'), png512);
  console.log('public/logo.png written (512px)');

  const png32 = await shot(32);
  writeFileSync(path.join(root, 'src', 'app', 'favicon.ico'), pngToIco(Buffer.from(png32), 32));
  console.log('src/app/favicon.ico written (32px PNG-ICO)');
} finally {
  await browser.close();
}
