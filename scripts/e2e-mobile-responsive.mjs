// Mobile responsiveness verification for the chat screen.
// Launches headless Chrome at small phone viewports, seeds a room with
// realistic content, and asserts:
//   1. no horizontal page scroll
//   2. NO element's bounding box extends past the viewport (incl. open
//      emoji panel and reaction popover — "nothing floats off screen")
//   3. the composer is on-screen and the chat exactly fills the viewport
// Saves screenshots to scripts/screenshots/.
// Usage: node scripts/e2e-mobile-responsive.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:3001';
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const DEVICE_ID = 'device-e2e-mobile-1111';
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

mkdirSync(new URL('./screenshots', import.meta.url), { recursive: true });

// --- Seed a room with realistic content via the API ---
const createRes = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'mobile e2e', ttlHours: 1, tz: 'UTC' }),
});
const room = await createRes.json();
if (!room.success) fail('create room: ' + JSON.stringify(room));

async function send(senderName, content, deviceId, extra = {}) {
  const res = await fetch(`${BASE}/api/chat/${room.code}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, content, tz: 'UTC', deviceId, ...extra }),
  });
  const data = await res.json();
  if (!data.success) fail(`seed send: ${JSON.stringify(data)}`);
  return data.id;
}
const firstId = await send('Alice', 'Hey! short message from the other side', 'device-alice-111111');
await send(
  'TestUser',
  'mine bubble with a really long unbroken token AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBCCCCCCCCCCCCCCCCCC and normal text after it to test wrapping on tiny screens',
  DEVICE_ID,
  { replyToId: firstId }
);
await send('Alice', '😂🎉❤️', 'device-alice-111111');
// react so pills render
await fetch(`${BASE}/api/chat/${room.code}/reactions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messageId: firstId, emoji: '👍', senderName: 'TestUser', deviceId: DEVICE_ID }),
});
// image attachment
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), 'pic.png');
form.append('originalName', 'pic.png');
form.append('senderName', 'Alice');
form.append('caption', 'an image');
form.append('tz', 'UTC');
const att = await (await fetch(`${BASE}/api/chat/${room.code}/attachments`, { method: 'POST', body: form })).json();
if (!att.success) fail('seed attachment: ' + JSON.stringify(att));
console.log(`seeded room ${room.code} (reply, reactions, long token, emoji, image)`);

// --- Browser checks ---
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const VIEWPORTS = [
  { name: 'iphone-se-320', width: 320, height: 568 },
  { name: 'android-360', width: 360, height: 740 },
  { name: 'iphone-14-390', width: 390, height: 844 },
];

// Bounding-box audit: nothing may stick out horizontally; report offenders.
async function auditOffscreen(page, label) {
  const offenders = await page.evaluate(() => {
    const vw = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (r.right > vw + 1 || r.left < -1) {
        bad.push(
          `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} ` +
          `left=${Math.round(r.left)} right=${Math.round(r.right)} (vw=${vw})`
        );
      }
    }
    return bad.slice(0, 8);
  });
  if (offenders.length > 0) fail(`[${label}] elements off screen:\n  ${offenders.join('\n  ')}`);
  const hScroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (hScroll > 1) fail(`[${label}] page has horizontal scroll (${hScroll}px)`);
}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: true, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(
    (name, dev) => {
      localStorage.setItem('syncflow.chatName', name);
      localStorage.setItem('syncflow.deviceId', dev);
    },
    'TestUser',
    DEVICE_ID
  );
  await page.goto(`${BASE}/chat/${room.code}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('textarea', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500)); // let snapshot render

  // 1+2: nothing off screen in the resting state
  await auditOffscreen(page, `${vp.name} resting`);

  // 3: composer fully visible & chat fills the viewport (no dead gap > 4px)
  const layout = await page.evaluate(() => {
    const form = document.querySelector('form');
    const r = form.getBoundingClientRect();
    return { formBottom: r.bottom, formTop: r.top, vh: window.innerHeight };
  });
  if (layout.formBottom > layout.vh + 1) {
    fail(`[${vp.name}] composer pushed off screen (bottom=${layout.formBottom}, vh=${layout.vh})`);
  }
  if (layout.vh - layout.formBottom > 4) {
    fail(`[${vp.name}] chat does not stretch to bottom (gap=${Math.round(layout.vh - layout.formBottom)}px)`);
  }

  // 4: emoji panel open → still nothing off screen
  await page.click('button[aria-label="Open emoji picker"]');
  await new Promise((r) => setTimeout(r, 350));
  await auditOffscreen(page, `${vp.name} emoji-panel`);
  await page.screenshot({ path: new URL(`./screenshots/${vp.name}-emoji.png`, import.meta.url).pathname.slice(1) });
  await page.click('button[aria-label="Open emoji picker"]');

  // 5: reaction popover open on first AND last message → on screen
  const reactBtns = await page.$$('button[aria-label="React to message"]');
  for (const [i, btn] of [[0, reactBtns[0]], [1, reactBtns[reactBtns.length - 1]]]) {
    await btn.click();
    await new Promise((r) => setTimeout(r, 350));
    await auditOffscreen(page, `${vp.name} reaction-popover-${i}`);
    await btn.click(); // close
    await new Promise((r) => setTimeout(r, 150));
  }

  // 5b: outside click/touch closes the reaction popover
  await reactBtns[0].click();
  await new Promise((r) => setTimeout(r, 300));
  if (!(await page.$('button[aria-label^="React with"]'))) fail(`[${vp.name}] reaction popover did not open`);
  await page.click('textarea'); // a guaranteed-outside tap target
  await new Promise((r) => setTimeout(r, 300));
  if (await page.$('button[aria-label^="React with"]')) {
    fail(`[${vp.name}] reaction popover did NOT close on outside click`);
  }

  // 5c: composer textarea auto-grows with content and caps at ~6 rows
  const h1 = await page.$eval('textarea', (el) => el.getBoundingClientRect().height);
  await page.focus('textarea');
  for (let i = 0; i < 9; i++) {
    await page.keyboard.type(`line ${i + 1}`);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
  }
  await new Promise((r) => setTimeout(r, 300));
  const h2 = await page.$eval('textarea', (el) => el.getBoundingClientRect().height);
  if (h2 <= h1 + 10) fail(`[${vp.name}] textarea did not auto-grow (${h1} -> ${h2})`);
  if (h2 > 200) fail(`[${vp.name}] textarea grew past its max-rows cap (${h2}px)`);
  await auditOffscreen(page, `${vp.name} grown-composer`);
  const grown = await page.evaluate(() => {
    const form = document.querySelector('form');
    return { bottom: form.getBoundingClientRect().bottom, vh: window.innerHeight };
  });
  if (grown.bottom > grown.vh + 1) fail(`[${vp.name}] grown composer pushed off screen`);
  await page.screenshot({ path: new URL(`./screenshots/${vp.name}-composer-grown.png`, import.meta.url).pathname.slice(1) });
  // clear draft
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // 6: image viewer modal → on screen AND covers the sticky site header
  const imgBtn = await page.$('button[aria-label^="View image"]');
  if (!imgBtn) fail(`[${vp.name}] image button not found`);
  await imgBtn.click();
  await page.waitForSelector('[role="dialog"][aria-label^="Viewing"]', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 400));
  await auditOffscreen(page, `${vp.name} media-viewer`);
  const headerCovered = await page.evaluate(() => {
    const el = document.elementFromPoint(10, 10); // top-left, inside site header area
    return !!el?.closest('[role="dialog"]');
  });
  if (!headerCovered) fail(`[${vp.name}] media viewer does not cover the site header (z-index)`);
  await page.screenshot({ path: new URL(`./screenshots/${vp.name}-viewer.png`, import.meta.url).pathname.slice(1) });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));

  await page.screenshot({ path: new URL(`./screenshots/${vp.name}-chat.png`, import.meta.url).pathname.slice(1) });
  console.log(`${vp.name}: resting, emoji panel, reaction popovers, media viewer — all within viewport; composer at bottom edge`);
  await page.close();
}

await browser.close();
console.log('PASS: chat is fully responsive at 320/360/390px — nothing renders off screen');
