import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

/** The GPU string as WebGL reports it, to compare with the copied report. */
async function gpuRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  });
}

const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';

test('Diagnostics runs every check and copies a complete report', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await page.goto('./#/diagnostics');
  await expect(page.getByRole('heading', { level: 1, name: 'Diagnostics' })).toBeVisible();

  const rows = page.locator('[data-check-id]');
  await expect(rows).toHaveCount(13);
  await expect(page.locator('[data-check-id][data-status="pending"]')).toHaveCount(0, {
    timeout: 90_000,
  });

  // Every check reached a final status, and the required ones pass on this machine.
  const results = await rows.evaluateAll((elements) =>
    elements.map((el) => ({
      id: el.getAttribute('data-check-id'),
      status: el.getAttribute('data-status'),
      importance: el.getAttribute('data-importance'),
    })),
  );
  for (const r of results) expect(['pass', 'warn', 'fail'], `${r.id}`).toContain(r.status);
  const required = results.filter((r) => r.importance === 'required');
  expect(required.map((r) => r.id)).toEqual([
    'webgl2',
    'float-targets',
    'audio-worklet',
    'avc-720p',
    'h264-decode',
  ]);
  for (const r of required) expect(r.status, `${r.id}`).toBe('pass');
  await expect(page.getByText('All required checks passed.')).toBeVisible();

  // Technical detail is one click away.
  const webgl = page.locator('[data-check-id="webgl2"]');
  await webgl.getByText('Technical detail').click();
  await expect(webgl.getByText('MAX_TEXTURE_SIZE')).toBeVisible();

  await page.getByRole('button', { name: 'Copy report' }).click();
  await expect(page.getByText('Report copied.')).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  const renderer = await gpuRenderer(page);
  expect(renderer.length).toBeGreaterThan(0);
  expect(report).toContain('Synesthesia diagnostics report');
  expect(report).toContain(renderer);
  expect(report).toContain('WebGL2');
  expect(report).toContain('AAC');
  expect(report).toContain(browser.version());
  expect(report).toContain('Benchmark: not yet available');

  // Run again resets the rows and finishes again.
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.locator('[data-check-id][data-status="pending"]')).toHaveCount(0, {
    timeout: 90_000,
  });
  await expect(page.getByRole('button', { name: 'Run again' })).toBeEnabled();

  expect(errors).toEqual([]);
});

test('Copy report falls back to a selected text box when the clipboard refuses', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
      },
    });
  });
  await page.goto('./#/diagnostics');
  await page.getByRole('button', { name: 'Copy report' }).click();

  const box = page.getByRole('textbox', { name: 'Diagnostics report' });
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('readonly', '');
  await expect(page.getByText(/press (Ctrl|Cmd)\+C to copy it/)).toBeVisible();
  const state = await box.evaluate((el) => {
    const area = el as HTMLTextAreaElement;
    return {
      focused: document.activeElement === area,
      start: area.selectionStart,
      end: area.selectionEnd,
      length: area.value.length,
      head: area.value.split('\n')[0],
    };
  });
  expect(state.head).toBe('Synesthesia diagnostics report');
  expect(state.focused).toBe(true);
  expect(state.start).toBe(0);
  expect(state.end).toBe(state.length);
});

test('the startup gate explains a missing capability and keeps Diagnostics reachable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Simulate a machine without WebGL2.
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
      ?.value as (this: HTMLCanvasElement, type: string, options?: unknown) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        return type === 'webgl2' ? null : original.call(this, type, options);
      },
    });
  });
  await page.goto('./');
  await expect(
    page.getByRole('heading', { level: 1, name: "Synesthesia can't start here yet" }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-sp-startup', 'blocked');
  await expect(
    page.getByText('Graphics acceleration (WebGL2), which draws the wakes.'),
  ).toBeVisible();
  // Half-float targets fail too without WebGL2, but only the root cause is listed.
  await expect(page.getByText('High-precision graphics', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Update Google Chrome', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Library' })).toHaveCount(0);

  await page.getByRole('link', { name: 'See diagnostics' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Diagnostics' })).toBeVisible();
  await expect(page.locator('[data-check-id="webgl2"]')).toHaveAttribute('data-status', 'fail', {
    timeout: 30_000,
  });
});

test('the startup gate never blocks when a check throws unexpectedly', async ({ page }) => {
  await page.addInitScript(() => {
    // A broken check (an audio context that throws) is not a missing capability.
    Object.defineProperty(window, 'OfflineAudioContext', {
      configurable: true,
      writable: true,
      value: class {
        constructor() {
          throw new Error('simulated failure');
        }
      },
    });
  });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-sp-startup', 'ok');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
});

test.describe('outside Chrome', () => {
  test.use({ userAgent: SAFARI_UA });

  test('shows a dismissible browser notice', async ({ page }) => {
    await page.addInitScript(() => {
      // Safari and Firefox have no User-Agent Client Hints.
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        configurable: true,
        get: () => undefined,
      });
    });
    await page.goto('./');
    const notice = page.getByText(
      'Synesthesia is made for Google Chrome. Some parts may not work in this browser.',
    );
    await expect(notice).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss the browser notice' }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
    await expect(notice).toHaveCount(0);
  });
});
