/**
 * Writes tests/fixtures/sample.sig.json: a small, valid signature of an analytic wink
 * (an eyelid closes, holds, then opens) for tests and harness pages. No clip involved.
 *
 * Plain JavaScript on purpose (no build step). It reimplements only what a file needs:
 * the wink field (as in src/signature/synthetic.ts), the SPEC 8.2 features and stats,
 * the little-endian float32 base64 field encoding, and the content hash over the
 * canonical bytes documented in src/signature/hash.ts. tests/unit/sampleFixture.test.ts
 * checks the result with the app's own parser and hash, so any drift is caught.
 *
 * The output is deterministic: running it again produces an identical file.
 *
 *   node scripts/make-sample-signature.mjs
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FEATURE_NAMES = [
  'energy',
  'peak',
  'flowX',
  'flowY',
  'direction',
  'coherence',
  'divergence',
  'curl',
  'acceleration',
  'surge',
  'jerk',
  'continuity',
  'density',
  'centroidX',
  'centroidY',
  'spread',
];

const FPS = 30;
const COLS = 16;
const ROWS = 9;
const FRAMES = Math.round(2.2 * FPS);
const NOISE_FLOOR = 0.02;
const EPS = 1e-6;

function bump(t, start, end) {
  if (t <= start || t >= end) return 0;
  const s = Math.sin((Math.PI * (t - start)) / (end - start));
  return s * s;
}

function gaussian(dx, dy, radius) {
  return Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
}

/** The synthetic wink: lid closes (down), holds, opens (up); the cheek lifts a little. */
function wink(x, y, t) {
  const lid = gaussian(x - 0.5, (y - 0.42) * 1.6, 0.16);
  const close = bump(t, 0.6, 0.9);
  const open = bump(t, 1.15, 1.45);
  const cheek = gaussian(x - 0.5, y - 0.72, 0.14) * bump(t, 0.62, 0.95);
  const v = lid * (1.8 * close - 1.7 * open) - 0.35 * cheek;
  const u = lid * 0.12 * (close - open) * (x - 0.5) * 4;
  return [u, v];
}

/** Percentile with linear interpolation between closest ranks (NumPy's default). */
function percentile(values, p) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** −0 → 0, so the file never depends on how a JSON writer treats negative zero. */
const z = (x) => (x === 0 ? 0 : x);

// Field: FRAMES × ROWS × COLS × (u, v), rounded to float32 like the real extractor.
const cells = COLS * ROWS;
const field = new Float32Array(FRAMES * cells * 2);
for (let f = 0; f < FRAMES; f++) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const [u, v] = wink((c + 0.5) / COLS, (r + 0.5) / ROWS, f / FPS);
      const i = (f * cells + r * COLS + c) * 2;
      field[i] = u;
      field[i + 1] = v;
    }
  }
}

// Per-frame features (SPEC 8.2).
const features = Object.fromEntries(FEATURE_NAMES.map((n) => [n, new Array(FRAMES).fill(0)]));
const at = (f, r, c, k) => {
  const rr = Math.min(ROWS - 1, Math.max(0, r));
  const cc = Math.min(COLS - 1, Math.max(0, c));
  return field[(f * cells + rr * COLS + cc) * 2 + k];
};
for (let f = 0; f < FRAMES; f++) {
  const mags = [];
  let sumU = 0;
  let sumV = 0;
  let sumM = 0;
  let wx = 0;
  let wy = 0;
  let dense = 0;
  let div = 0;
  let curl = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const u = at(f, r, c, 0);
      const v = at(f, r, c, 1);
      const m = Math.hypot(u, v);
      mags.push(m);
      sumU += u;
      sumV += v;
      sumM += m;
      wx += m * ((c + 0.5) / COLS);
      wy += m * ((r + 0.5) / ROWS);
      if (m > NOISE_FLOOR) dense++;
      // Central differences in field units (one-sided at the edges).
      const hx = (Math.min(COLS - 1, c + 1) - Math.max(0, c - 1)) / COLS;
      const hy = (Math.min(ROWS - 1, r + 1) - Math.max(0, r - 1)) / ROWS;
      div += (at(f, r, c + 1, 0) - at(f, r, c - 1, 0)) / hx;
      div += (at(f, r + 1, c, 1) - at(f, r - 1, c, 1)) / hy;
      curl += (at(f, r, c + 1, 1) - at(f, r, c - 1, 1)) / hx;
      curl -= (at(f, r + 1, c, 0) - at(f, r - 1, c, 0)) / hy;
    }
  }
  const fx = sumU / cells;
  const fy = sumV / cells;
  const cx = sumM > 0 ? wx / sumM : 0.5;
  const cy = sumM > 0 ? wy / sumM : 0.5;
  let spread = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const dx = (c + 0.5) / COLS - cx;
      const dy = (r + 0.5) / ROWS - cy;
      spread += mags[r * COLS + c] * (dx * dx + dy * dy);
    }
  }
  features.energy[f] = sumM / cells;
  features.peak[f] = percentile(mags, 95);
  features.flowX[f] = fx;
  features.flowY[f] = fy;
  features.direction[f] = Math.atan2(-fy, fx);
  features.coherence[f] = Math.hypot(sumU, sumV) / (sumM + EPS);
  features.divergence[f] = div / cells;
  features.curl[f] = curl / cells;
  features.density[f] = dense / cells;
  features.centroidX[f] = cx;
  features.centroidY[f] = cy;
  features.spread[f] = sumM > 0 ? Math.sqrt(spread / sumM) : 0;
}
for (let f = 1; f < FRAMES; f++) {
  const ax = features.flowX[f] - features.flowX[f - 1];
  const ay = features.flowY[f] - features.flowY[f - 1];
  features.acceleration[f] = Math.hypot(ax, ay) * FPS;
  features.surge[f] = (features.energy[f] - features.energy[f - 1]) * FPS;
  features.jerk[f] = Math.abs(features.acceleration[f] - features.acceleration[f - 1]) * FPS;
}
const jerkP95 = percentile(features.jerk, 95);
for (let f = 0; f < FRAMES; f++) {
  features.continuity[f] = jerkP95 > 0 ? 1 / (1 + features.jerk[f] / jerkP95) : 1;
}
for (const name of FEATURE_NAMES) features[name] = features[name].map(z);

// Onsets: surge above 2.5σ with energy above the floor, 100 ms refractory period.
const surge = features.surge;
const mu = surge.reduce((a, b) => a + b, 0) / FRAMES;
const sigma = Math.sqrt(surge.reduce((a, b) => a + (b - mu) * (b - mu), 0) / FRAMES);
const onsets = [];
let lastOnset = -Infinity;
for (let f = 0; f < FRAMES; f++) {
  if (surge[f] > 2.5 * sigma && features.energy[f] > NOISE_FLOOR && f / FPS - lastOnset >= 0.1) {
    onsets.push(f);
    lastOnset = f / FPS;
  }
}

const stats = {};
for (const name of FEATURE_NAMES) {
  const values = features[name];
  stats[name] = {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: z(values.reduce((a, b) => a + b, 0) / values.length),
    p05: z(percentile(values, 5)),
    p95: z(percentile(values, 95)),
  };
}

// Field bytes (little-endian float32) and the content hash (src/signature/hash.ts).
const fieldBytes = Buffer.alloc(field.length * 4);
field.forEach((v, i) => fieldBytes.writeFloatLE(v, i * 4));
const header = Buffer.alloc(20);
header.writeDoubleLE(FPS, 0);
header.writeUInt32LE(FRAMES, 8);
header.writeUInt32LE(COLS, 12);
header.writeUInt32LE(ROWS, 16);
const featureBytes = Buffer.alloc(FEATURE_NAMES.length * FRAMES * 8);
let offset = 0;
for (const name of FEATURE_NAMES) {
  for (const v of features[name]) {
    featureBytes.writeDoubleLE(v, offset);
    offset += 8;
  }
}
const onsetBytes = Buffer.alloc(4 + onsets.length * 8);
onsetBytes.writeUInt32LE(onsets.length, 0);
onsets.forEach((v, i) => onsetBytes.writeDoubleLE(v, 4 + i * 8));
const contentHash = createHash('sha256')
  .update(Buffer.concat([header, fieldBytes, featureBytes, onsetBytes]))
  .digest('hex');

const signature = {
  format: 'sp-signature',
  version: 1,
  id: '5a3c1e2f-8b7d-4c6a-9e0f-1d2b3c4a5e6f',
  name: 'Sample wink',
  createdAt: '2026-09-28T00:00:00.000Z',
  contentHash,
  source: {
    fileName: 'sample-wink.mp4',
    nativeFps: FPS,
    width: 1280,
    height: 720,
    trim: { startSec: 0, endSec: FRAMES / FPS },
    rotate: 0,
    mirror: false,
    focusArea: { x: 0.35, y: 0.3, w: 0.3, h: 0.3 },
  },
  preferredSpeed: 1,
  extraction: {
    method: 'farneback',
    params: { pyrScale: 0.5, levels: 3, winsize: 15, iterations: 3, polyN: 5, polySigma: 1.2 },
    analysisWidth: 320,
    noiseFloor: NOISE_FLOOR,
    noiseFloorMode: 'auto',
    temporalSmoothingFrames: 3,
  },
  frameRate: FPS,
  frameCount: FRAMES,
  grid: { cols: COLS, rows: ROWS },
  field: { encoding: 'f32-base64', data: fieldBytes.toString('base64') },
  features: { ...features, onsets },
  stats,
};

/** Readable JSON: two-space indent, arrays of numbers on one line (as the app writes). */
function format(value, indent) {
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return `[${value.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const inner = `${indent}  `;
    const lines = Object.entries(value).map(
      ([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`,
    );
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

const out = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'sample.sig.json');
writeFileSync(out, `${format(signature, '')}\n`);
console.log(`Wrote ${out}: ${FRAMES} frames, ${COLS}×${ROWS} grid, onsets ${onsets.join(', ')}`);
console.log(`contentHash ${contentHash}`);
