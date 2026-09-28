// Runs the spike 5 checks in headless Google Chrome and prints the report.
//
//   node spikes/05-fluid/run-headless.mjs              # starts a Vite dev server (StrictMode
//                                                      # double-mounts effects in dev)
//   node spikes/05-fluid/run-headless.mjs --url http://localhost:4173/spikes/05-fluid/
//   node spikes/05-fluid/run-headless.mjs --port 5204  # dev server port (default 5204)
//
// Exits 1 if a check fails or Chrome logs "Too many active WebGL contexts".
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = fileURLToPath(new URL('../..', import.meta.url));
let url = option('--url');
let server;
if (!url) {
  const port = Number(option('--port') ?? 5204);
  server = await createServer({
    root,
    server: { port, strictPort: true },
    logLevel: 'warn',
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    console.error(
      `Could not start a dev server on port ${port} (${error.message}). ` +
        'Pass --port <free port>, or --url to use a server that is already running.',
    );
    process.exit(2);
  }
  url = `http://localhost:${port}/spikes/05-fluid/`;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const messages = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error')
      messages.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  await page.goto(`${url}?run=1`);
  // These callbacks run in the page, where globalThis is the window.
  await page.waitForFunction(() => globalThis.spSpike5?.done, null, { timeout: 180_000 });
  const outcome = await page.evaluate(() => ({
    report: globalThis.spSpike5.report,
    error: globalThis.spSpike5.error,
    pass: globalThis.spSpike5.results?.pass ?? false,
  }));
  const tooMany = messages.filter((m) => /too many active webgl contexts/i.test(m));
  console.log(outcome.report || `The checks stopped: ${outcome.error}`);
  console.log('');
  console.log(`Mode: ${server ? 'Vite dev server (React StrictMode double-mounts effects)' : url}`);
  console.log(`"Too many active WebGL contexts" warnings: ${tooMany.length}`);
  console.log(`Console warnings and errors: ${messages.length}`);
  for (const m of messages) console.log(`  ${m}`);
  process.exitCode = outcome.pass && tooMany.length === 0 ? 0 : 1;
} finally {
  await browser.close();
  await server?.close();
}
