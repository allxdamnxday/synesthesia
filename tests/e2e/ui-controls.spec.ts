import { expect, test } from '@playwright/test';

test.describe('slider', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./dev/ui/');
    await expect(page.getByRole('heading', { name: 'UI controls' })).toBeVisible();
  });

  test('click jumps, drag moves, double-click resets to baseline', async ({ page }) => {
    const track = page.getByRole('slider', { name: 'Viscosity' });
    const box = await track.boundingBox();
    if (!box) throw new Error('no slider box');
    const y = box.y + box.height / 2;
    await page.mouse.click(box.x + box.width * 0.8, y);
    await expect(page.getByTestId('value')).toHaveText('0.800');

    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId('value')).toHaveText('0.300');

    const phases = await page.evaluate(() =>
      (window as unknown as { spUi: { log: Array<{ phase: string }> } }).spUi.log.map(
        (e) => e.phase,
      ),
    );
    expect(phases).toContain('start');
    expect(phases).toContain('change');
    expect(phases[phases.length - 1]).toBe('end');

    await track.dblclick();
    await expect(page.getByTestId('value')).toHaveText('0.500');
  });

  test('shift-drag is fine control relative to the start', async ({ page }) => {
    const track = page.getByRole('slider', { name: 'Viscosity' });
    const box = await track.boundingBox();
    if (!box) throw new Error('no slider box');
    const y = box.y + box.height / 2;
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width * 0.9, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9 + box.width * 0.5, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    // Half the track width at 1/10 speed from 0.5 → 0.55 (no jump to 0.9).
    await expect(page.getByTestId('value')).toHaveText('0.550');
  });

  test('keyboard nudges and resets', async ({ page }) => {
    const track = page.getByRole('slider', { name: 'Viscosity' });
    await track.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('value')).toHaveText('0.510');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.getByTestId('value')).toHaveText('0.410');
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('value')).toHaveText('0.500');
    await expect(track).toHaveAttribute('aria-valuenow', '0.5');
  });

  test('a locked slider ignores input until unlocked', async ({ page }) => {
    const track = page.getByRole('slider', { name: 'Brightness' });
    await expect(track).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Unlock Brightness' }).click();
    await expect(track).not.toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('transport', () => {
  test('scrubbing seeks and snapshots store then recall', async ({ page }) => {
    await page.goto('./dev/ui/');
    const scrub = page.getByRole('slider', { name: 'Playhead' });
    const box = await scrub.boundingBox();
    if (!box) throw new Error('no scrub box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('position')).toHaveText('5.5');
    await scrub.press('ArrowRight');
    await expect(page.getByTestId('position')).toHaveText('6.5');
    await expect(page.getByText('0:06 / 0:11')).toBeVisible();

    await page.getByRole('button', { name: 'Store snapshot B' }).click();
    const b = page.getByRole('button', { name: /Snapshot B: recall/ });
    await expect(b).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    const loop = page.getByRole('button', { name: 'Loop' });
    await loop.click();
    await expect(loop).toHaveAttribute('aria-pressed', 'true');
  });
});
