import { defineConfig } from '@playwright/test';

// Each parallel worker (or subagent) can pick its own port with E2E_PORT so test
// servers never collide. reuseExistingServer stays false so a test can never
// silently run against someone else's build.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}/`,
    // Google Chrome, not Playwright's bundled Chromium: Chromium lacks the
    // proprietary codecs (H.264, AAC) this app depends on. See docs/DECISIONS.md.
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npx vite build --logLevel warn && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
