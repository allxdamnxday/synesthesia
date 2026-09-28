#!/usr/bin/env node
// Spike 4 automation (dev-time only): build the app, serve it, open the spike page in
// headless Google Chrome for each GPU power preference and print the results.
//
//   node spikes/04-float-targets/run.mjs     (SPIKE_PORT defaults to 5203)

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const port = Number(process.env.SPIKE_PORT ?? 5203);

await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'error' });
const server = await preview({
  root,
  configFile: join(root, 'vite.config.ts'),
  preview: { port, strictPort: true },
  logLevel: 'warn',
});

let ok = true;
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error('[page]', error.message));
    await page.goto(`http://localhost:${port}/spikes/04-float-targets/`);
    await page.waitForFunction(() => globalThis.spike04 !== undefined);
    await page.evaluate(() => globalThis.spike04.done);
    for (const power of ['default', 'high-performance', 'low-power']) {
      await page.check(`input[name="power"][value="${power}"]`);
      await page.waitForFunction(
        (p) => globalThis.spike04.text().includes(`Power preference: ${p}`),
        power,
      );
      const text = await page.evaluate(() => globalThis.spike04.text());
      console.log(text);
      ok &&= text.includes(
        'Required (RGBA16F renderable, keeps values outside 0..1, linear filtering): PASS',
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((done) => server.httpServer.close(() => done()));
}
process.exit(ok ? 0 : 1);
