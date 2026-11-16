import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/*
 * Live (phase 3, step 3.5). Spec: docs/admin/03-features/03-live.md, T-26.
 *
 * Signed-out tests need nothing. Signed-in tests need E2E_ADMIN_SESSION (an
 * owner session cookie from the Firebase Auth emulator), like shell.spec.ts;
 * without it they are `fixme`. The poll endpoint is answered by page.route,
 * so these tests check the client rules, not Firestore.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const NO_SESSION_REASON =
  'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator (no e2e auth seam exists yet).';

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

function livePayload(online: number) {
  const at = new Date().toISOString();
  return {
    state: 'ok',
    data: {
      at,
      online,
      listed: online,
      byDevice: { desktop: online, mobile: 0, tablet: 0, unknown: 0 },
      topPath: online ? '/' : null,
      sessions: Array.from({ length: online }, (_, i) => ({
        sessionId: `${i}`.padStart(32, 'a'),
        ip: '203.0.113.•••',
        ipMasked: true,
        ipTruncated: false,
        country: 'PK',
        region: null,
        city: 'Lahore',
        lat: null,
        lon: null,
        device: 'desktop',
        browser: 'Chrome',
        currentPath: '/',
        startedAt: at,
        lastSeenAt: at,
        userId: null,
        active: true,
      })),
      events: [],
    },
  };
}

type Counter = { n: number };

/** Counts full Live polls (not the top-bar count). */
async function countLivePolls(page: Page, online = 2) {
  const counter: Counter = { n: 0 };
  await page.route(/\/api\/admin\/live$/, async (route) => {
    counter.n += 1;
    await route.fulfill({ json: livePayload(online) });
  });
  return counter;
}

/**
 * Opens Live and waits for hydration. "Updated … ago" renders only after the
 * client clock has subscribed (the server renders "Live"), which is the same
 * commit where the poll timer and the idle watcher start. Moving the fake
 * clock before that moves it past timers that do not exist yet.
 */
async function openLive(page: Page) {
  await page.goto('/admin/live');
  await expect(page.locator('time', { hasText: /^Updated / })).toBeVisible();
}

/**
 * Moves the fake clock one 30 s poll at a time until poll number `n` has hit
 * the route. Fake time runs ahead of the real network: a tick that lands while
 * the previous request is still in flight joins that request (TanStack never
 * runs two fetches of one query), so one jump of 60 s is not two polls.
 */
async function nextPoll(page: Page, counter: Counter, n: number) {
  await expect(async () => {
    if (counter.n < n) await page.clock.runFor(30_000);
    expect(counter.n).toBe(n);
  }).toPass({ intervals: [250], timeout: 10_000 });
}

async function hideTab(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, hidden);
}

test.describe('signed out', () => {
  test('/admin/live redirects to sign-in', async ({ request }) => {
    const response = await request.get('/admin/live', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/admin/sign-in?next=%2Fadmin%2Flive');
  });

  test('the poll endpoint answers 401 JSON, never a redirect', async ({ request }) => {
    const response = await request.get('/api/admin/live', { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
  });

  test('first paint has data with no client fetch; the range picker is hidden', async ({ page }) => {
    const polls = await countLivePolls(page);
    await openLive(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Live' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Date range/ })).toHaveCount(0);
    await expect(page.getByText(/online|Nobody is on the site right now/).first()).toBeVisible();
    // Hydrated, and a couple of 1 s clock re-renders later: still no request.
    await page.waitForTimeout(2_000);
    expect(polls.n).toBe(0);
  });

  test('polls every 30 s while visible, none while hidden, one at once on return', async ({ page }) => {
    await page.clock.install();
    const polls = await countLivePolls(page);
    await openLive(page);
    await page.clock.runFor(30_000);
    await expect.poll(() => polls.n).toBe(1);
    await nextPoll(page, polls, 2);

    await hideTab(page, true);
    await page.clock.runFor(120_000);
    expect(polls.n).toBe(2);

    await hideTab(page, false);
    await expect.poll(() => polls.n).toBe(3);
  });

  test('stops after 10 min without input: "Paused, click to resume"', async ({ page }) => {
    await page.clock.install();
    const polls = await countLivePolls(page);
    await openLive(page);
    await page.clock.runFor(10 * 60_000);
    const resume = page.getByRole('button', { name: 'Paused, click to resume' }).first();
    await expect(resume).toBeVisible();
    // The last tick can share its instant with the idle check; let that request land.
    await page.waitForTimeout(500);
    const stopped = polls.n;
    await page.clock.runFor(120_000);
    expect(polls.n).toBe(stopped);

    await resume.click();
    await expect.poll(() => polls.n).toBe(stopped + 1);
  });

  test('Pause stops requests (and sets ?paused=1); Resume fetches at once', async ({ page }) => {
    await page.clock.install();
    const polls = await countLivePolls(page);
    await openLive(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page).toHaveURL(/paused=1/);
    await page.clock.runFor(120_000);
    expect(polls.n).toBe(0);

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(() => polls.n).toBe(1);
  });

  test('a failing poll keeps the data and says so', async ({ page }) => {
    await page.clock.install();
    const failures: Counter = { n: 0 };
    await page.route(/\/api\/admin\/live$/, (route) => {
      failures.n += 1;
      return route.fulfill({ status: 500, json: { state: 'error', errorId: 'e' } });
    });
    await openLive(page);
    for (const n of [1, 2]) {
      await nextPoll(page, failures, n);
      await expect(page.getByText('Update failed. Retrying in 30 s.')).toBeVisible();
    }
    await nextPoll(page, failures, 3);
    await expect(page.getByText('Live updates stopped.')).toBeVisible();
    // Stopped means stopped: no fourth request.
    await page.clock.runFor(120_000);
    expect(failures.n).toBe(3);
  });

  test('no horizontal scroll', async ({ page }) => {
    await page.goto('/admin/live');
    await expect(page.getByRole('heading', { level: 1, name: 'Live' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
