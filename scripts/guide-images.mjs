/**
 * Make the pictures the in-app guide shows from the screenshots docs/USER_GUIDE.md uses.
 *
 *   node scripts/guide-images.mjs        # after changing the guide's pictures or screenshots
 *
 * Reads the guide, finds every `images/guide/*.png` it shows, and writes a web-sized WebP of
 * each (at most 1280 px wide) to src/guide/images/, where Vite bundles it and the offline
 * cache picks it up. Their sizes go to src/guide/images.json so the page can reserve space
 * for them. Pictures the guide no longer uses are removed. The encoding runs in Google Chrome
 * (the same browser the tests use), so there is no image-processing dependency.
 * scripts/capture-guide.mjs runs this after capturing new screenshots.
 */
/* global createImageBitmap, OffscreenCanvas -- used inside page.evaluate, which runs in Chrome */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const guideFile = join(root, 'docs', 'USER_GUIDE.md');
const outDir = join(root, 'src', 'guide', 'images');
const sizesFile = join(root, 'src', 'guide', 'images.json');

/** Wide enough for a large window; screenshots are 1440 px wide. */
const MAX_WIDTH = 1280;
/** WebP quality: small text stays crisp at 2× zoom; 0.7 starts to blur it. */
const QUALITY = 0.85;

/** The `images/guide/*.png` paths the guide shows, in order, each once. */
export function guidePictures(markdown) {
  const found = [...markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)].map((m) => m[1]);
  return [...new Set(found.filter((src) => /^(?:\.\/)?images\/guide\/[\w.-]+\.png$/.test(src)))];
}

/** Encode every picture the guide uses; `browser` is a Playwright Chromium browser. */
export async function makeGuideImages(browser) {
  const pictures = guidePictures(readFileSync(guideFile, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  const page = await browser.newPage();
  const sizes = {};
  let total = 0;
  for (const src of pictures) {
    const name = basename(src, '.png');
    const png = readFileSync(join(root, 'docs', src.replace(/^\.\//, '')));
    const result = await page.evaluate(
      async ({ base64, maxWidth, quality }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });
        const full = await createImageBitmap(blob);
        const scale = Math.min(1, maxWidth / full.width);
        const width = Math.round(full.width * scale);
        const height = Math.round(full.height * scale);
        full.close();
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'high',
        });
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No 2D canvas');
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
        const out = new Uint8Array(await webp.arrayBuffer());
        let binary = '';
        for (let i = 0; i < out.length; i += 0x8000) {
          binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
        }
        return { type: webp.type, width, height, base64: btoa(binary) };
      },
      { base64: png.toString('base64'), maxWidth: MAX_WIDTH, quality: QUALITY },
    );
    if (result.type !== 'image/webp') throw new Error(`Chrome didn't encode WebP (${result.type})`);
    const file = `${name}.webp`;
    const data = Buffer.from(result.base64, 'base64');
    writeFileSync(join(outDir, file), data);
    sizes[src.replace(/^\.\//, '')] = { file, width: result.width, height: result.height };
    total += data.length;
    console.log(
      `${file}  ${result.width}×${result.height}  ${(data.length / 1024).toFixed(1)} KiB`,
    );
  }
  await page.close();

  const keep = new Set(Object.values(sizes).map((s) => s.file));
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.webp') && !keep.has(file)) {
      rmSync(join(outDir, file));
      console.log(`removed ${file} (no longer in the guide)`);
    }
  }
  writeFileSync(sizesFile, `${JSON.stringify(sizes, null, 2)}\n`);
  console.log(
    `${pictures.length} pictures, ${(total / 1024).toFixed(1)} KiB in total ` +
      `(the screenshots: ${(pictures.reduce((sum, src) => sum + statSync(join(root, 'docs', src)).size, 0) / 1024).toFixed(1)} KiB)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await makeGuideImages(browser);
  } finally {
    await browser.close();
  }
}
