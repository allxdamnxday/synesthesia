#!/usr/bin/env node
// Spike 3 automation (dev-time only): build the app, serve it, open the spike page in
// headless Google Chrome, encode 720p and 1080p, save both MP4s into
// spikes/03-encode/output/, then run verify.mjs on them (needs ffmpeg/ffprobe on PATH).
//
//   node spikes/03-encode/run.mjs            (SPIKE_PORT defaults to 5203)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { formatVerification, verify } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = join(here, 'output');
const port = Number(process.env.SPIKE_PORT ?? 5203);

mkdirSync(outDir, { recursive: true });
await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
const server = await preview({
  root,
  configFile: join(root, 'vite.config.ts'),
  preview: { port, strictPort: true },
  logLevel: 'warn',
});

const files = [];
try {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('[page]', message.text());
    });
    page.on('pageerror', (error) => console.error('[page]', error.message));
    await page.goto(`http://localhost:${port}/spikes/03-encode/`);
    await page.waitForFunction(() => globalThis.spike03 !== undefined);
    await page.evaluate(() => globalThis.spike03.run(['720p', '1080p']));
    for (const size of ['720p', '1080p']) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click(`#download-${size}`),
      ]);
      const file = join(outDir, download.suggestedFilename());
      await download.saveAs(file);
      files.push(file);
    }
    const text = await page.evaluate(() => globalThis.spike03.text());
    writeFileSync(join(outDir, 'page-results.txt'), text);
    console.log(text);
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((done) => server.httpServer.close(() => done()));
}

let ok = true;
const reports = [];
for (const file of files) {
  const v = verify(file);
  const text = formatVerification(v);
  reports.push(text);
  console.log(text);
  ok &&= v.ok;
}
writeFileSync(join(outDir, 'verify-results.txt'), `${reports.join('\n\n')}\n`);
process.exit(ok ? 0 : 1);
