import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * The 8 widths from the admin Definition of Done (320 → 1920). Touch widths
 * use a coarse pointer, so hover-only UI is caught there. Chromium only:
 * one engine keeps CI fast; Safari-only bugs are checked on a real phone.
 */
const VIEWPORTS = [
  { name: 'w320', width: 320, height: 568, touch: true, mobile: true },
  { name: 'w390', width: 390, height: 844, touch: true, mobile: true },
  { name: 'w700', width: 700, height: 1000, touch: true, mobile: false },
  { name: 'w834', width: 834, height: 1194, touch: true, mobile: false },
  { name: 'w1024', width: 1024, height: 768, touch: false, mobile: false },
  { name: 'w1366', width: 1366, height: 768, touch: false, mobile: false },
  { name: 'w1536', width: 1536, height: 864, touch: false, mobile: false },
  { name: 'w1920', width: 1920, height: 1080, touch: false, mobile: false },
] as const;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: VIEWPORTS.map((v) => ({
    name: v.name,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: v.width, height: v.height },
      hasTouch: v.touch,
      isMobile: v.mobile,
    },
  })),
  // Runs the production build (`npm run build` first). Locally an already
  // running server on the port is reused.
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
