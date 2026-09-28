// Run a spike page in headless Google Chrome and print its plain-text results.
//
//   node spikes/01-opencv/run-headless.mjs <baseUrl> <pagePath>
//   node spikes/01-opencv/run-headless.mjs http://localhost:5201/ spikes/01-opencv/
//
// Start the server first (`npx vite --port 5201 --strictPort`, or `npx vite build` then
// `npx vite preview --port 4201 --strictPort`). Chrome gets --expose-gc so pages can force
// garbage collection (spike 2 uses it to surface unclosed-frame warnings).
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5201/';
const pagePath = process.argv[3] ?? 'spikes/01-opencv/';
const url = new URL(pagePath, base).href;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--js-flags=--expose-gc'],
});
try {
  const page = await browser.newPage();
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));
  await page.goto(url);
  // These callbacks run in the page, where globalThis is the window.
  await page.waitForFunction(() => globalThis.spikeDone === true, null, { timeout: 300_000 });
  const text = await page.evaluate(() => globalThis.spikeResultsText);
  console.log(text);
  if (consoleLines.length > 0) {
    console.log('\nConsole output:');
    for (const line of consoleLines) console.log(`  ${line}`);
  }
} finally {
  await browser.close();
}
