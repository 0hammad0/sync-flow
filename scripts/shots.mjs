// Visual QA screenshots: desktop + mobile, dark + light, scrolled header.
// Usage: node scripts/shots.mjs <baseUrl>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://localhost:3001';
const outDir = path.resolve('shots');
mkdirSync(outDir, { recursive: true });

const CHROME_PATHS = [
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const executablePath = CHROME_PATHS[0];

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();

async function snap(name, url, { width, height, theme = 'dark', scrollY = 0, full = false } = {}) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((t) => {
    try { localStorage.setItem('sf-theme', t); } catch {}
  }, theme);
  await page.goto(`${base}${url}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200)); // let entrance animations settle
  if (scrollY) {
    await page.evaluate((y) => window.scrollTo({ top: y }), scrollY);
    await new Promise((r) => setTimeout(r, 800));
  }
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: full });
  console.log(`${name}.png`);
}

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

await snap('home-desktop-dark', '/', { ...desktop, theme: 'dark' });
await snap('home-desktop-dark-scrolled', '/', { ...desktop, theme: 'dark', scrollY: 600 });
await snap('home-desktop-light', '/', { ...desktop, theme: 'light' });
await snap('home-mobile-dark', '/', { ...mobile, theme: 'dark' });
await snap('home-mobile-light-full', '/', { ...mobile, theme: 'light', full: true });
await snap('login-desktop-dark', '/login', { ...desktop, theme: 'dark' });
await snap('chat-mobile-dark', '/chat', { ...mobile, theme: 'dark' });
await snap('receive-desktop-dark', '/receive', { ...desktop, theme: 'dark' });

await browser.close();
