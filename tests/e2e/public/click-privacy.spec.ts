import { expect, test, type Page } from '@playwright/test';

import { answerProbe, hidePage, type TrackerLog } from '../support/tracker';

/**
 * Click privacy (phase 4): no typed text and no message text in any click
 * the tracker sends. What a flush carries is what is stored (`/api/e` only
 * drops and caps, it never adds), so the flush bodies are the rows.
 *
 * The local server has no Firebase credentials, so a real room cannot be
 * joined here. The test builds the same DOM on a real public page: a chat
 * message list root with `data-private` (as ChatRoom.tsx renders it), a
 * composer with typed text, and the real tracker + click chunk.
 * With E2E_CHAT_ROOM (a room code on an emulator-backed server: CI job
 * `e2e-signed-in`, room seeded by tests/e2e/support/seed-emulator.mjs, and the
 * build's client SDK on the Firestore emulator), the second test sends a real
 * message and inspects the flushes too.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(!['w390', 'w1366'].includes(testInfo.project.name), 'phone and laptop widths');
});

const SECRET_MESSAGE = 'meet me at gate 7 with the keys';
const SECRET_TYPED = 'my typed draft hunter2';

async function trackerReady(page: Page, log: TrackerLog) {
  await expect.poll(() => log.probes.length, { timeout: 15_000 }).toBe(1);
  // The click chunk loads right after the tracker starts.
  await page.waitForTimeout(1_000);
}

async function pointerUp(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, composed: true, isPrimary: true, button: 0, clientX: r.x + 2, clientY: r.y + 2 }),
    );
  }, selector);
}

test('labels are dropped inside the message list and inputs; nothing typed or sent is in any click', async ({ page }) => {
  const log = await answerProbe(page, 'ok');
  await page.goto('/');
  await trackerReady(page, log);

  await page.evaluate(
    ({ message, typed }) => {
      const root = document.createElement('div');
      root.innerHTML = `
        <div data-chat-scroll data-private id="list">
          <div><p>${message}</p><a id="msg-link" href="#x">${message}</a><button id="msg-copy">Copy ${message}</button></div>
        </div>
        <form id="composer"><textarea id="draft">${typed}</textarea>
          <button type="button" id="send" data-track="chat-send">Send</button></form>`;
      document.body.appendChild(root);
    },
    { message: SECRET_MESSAGE, typed: SECRET_TYPED },
  );
  for (const sel of ['#msg-link', '#msg-copy', '#draft', '#send']) await pointerUp(page, sel);
  await hidePage(page);
  await expect.poll(() => log.flushes.length).toBeGreaterThan(0);

  const clicks = log.flushes.flatMap((f) => f.body.events).filter((e) => ['click', 'rage', 'dead'].includes(e.type)) as {
    type: string;
    target: string;
    label?: string | null;
  }[];
  expect(clicks.length).toBeGreaterThanOrEqual(3);
  const all = JSON.stringify(log.flushes.map((f) => f.body));
  expect(all).not.toContain('gate 7');
  expect(all).not.toContain('hunter2');
  expect(clicks.find((c) => c.target === 'chat-send')?.label).toBe('Send');
  for (const c of clicks.filter((c) => c.target !== 'chat-send')) expect(c.label ?? null).toBeNull();
});

test('a real room: send a message, then no message text in any stored click', async ({ page }) => {
  const room = process.env.E2E_CHAT_ROOM;
  test.fixme(!room, 'Needs E2E_CHAT_ROOM: a room code on an emulator-backed server.');
  // A stored chat name skips the "your name" step, so the composer shows at once
  // (ChatRoom.tsx reads STORED_NAME_KEY from localStorage).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('syncflow.chatName', 'E2E tester');
    } catch {}
  });
  const log = await answerProbe(page, 'ok');
  await page.goto(`/chat/${room}`);
  await trackerReady(page, log);
  // The composer by its placeholder: react-textarea-autosize appends a hidden
  // measuring <textarea aria-hidden> to <body>, so `textarea` alone can hit it.
  const draft = page.getByPlaceholder('Message', { exact: true });
  await expect(draft).toBeVisible();
  await draft.fill(SECRET_MESSAGE);
  await page.locator('[data-track="chat-send"]').click();
  await expect(page.getByText(SECRET_MESSAGE).first()).toBeVisible();
  await page.getByText(SECRET_MESSAGE).first().click();
  await hidePage(page);
  await expect.poll(() => log.flushes.length).toBeGreaterThan(0);
  const all = JSON.stringify(log.flushes.map((f) => f.body));
  expect(all).toContain('chat-send');
  expect(all).not.toContain('gate 7');
});
