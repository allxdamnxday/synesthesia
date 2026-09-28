// Generate the SPEC 8.5 validation clips into tests/fixtures/.
//
//   node scripts/make-fixtures.mjs
//
// Needs ffmpeg (with libx264) on PATH. The clips are committed, so nobody else needs to
// run this. Frames are drawn here in Node (anti-aliased shapes over a lightly textured,
// static background so optical flow has structure everywhere) and piped to ffmpeg as raw
// 8-bit gray: 320×180, 30 fps, H.264 (yuv420p, low CRF).
//
// Moving shapes carry their own texture, which moves with them. Coordinates are pixels,
// y down; "clockwise" means clockwise as seen on screen.
//
//   dot-right.mp4               textured dot crossing left → right (stays inside the frame)
//   dot-up.mp4                  textured dot rising bottom → top
//   ring-expand.mp4             concentric rings, still for 0.4 s, then growing outward
//                               past the frame edges
//   ring-contract.mp4           the same, shrinking inward from past the frame edges
//   ring-expand-inside.mp4      one ring, still for 0.4 s, then growing; always well
//                               inside the frame
//   ring-contract-inside.mp4    the same ring shrinking
//   bar-rotate-cw.mp4           long textured bar through the center, turning clockwise
//                               (longer than the frame diagonal)
//   bar-rotate-cw-inside.mp4    short bar turning clockwise, well inside the frame
//   still.mp4                   nothing moves
//   still-noise.mp4             nothing moves, plus seeded per-frame sensor noise
//   dot-stop.mp4                dot rests, moves right at constant speed, stops
//                               abruptly, rests
//   pan-right.mp4               the whole picture slides right the whole time, like a
//                               camera pan (movement that never stops)
//
// Two kinds of rings and bars: SPEC 8.2 first defined divergence and curl as grid means
// of spatial derivatives, which add up to flow across (and around) the frame border, so
// the first fixtures reach past the frame. Extraction now fits an affine flow to the
// moving cells instead (see src/signature/features.ts); the `-inside` fixtures prove
// that movement that stays inside the frame registers.
import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tests', 'fixtures');
mkdirSync(outDir, { recursive: true });

const W = 320;
const H = 180;
const FPS = 30;

/** mulberry32: small seeded PRNG, floats in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise, width × height (default: the frame), 0..1 (two octaves). */
function valueNoise(seed, width = W, height = H) {
  const random = rng(seed);
  const out = new Float32Array(width * height);
  for (const [cell, amp] of [
    [20, 0.6],
    [7, 0.4],
  ]) {
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const lattice = Array.from({ length: gw * gh }, () => random());
    for (let y = 0; y < height; y++) {
      const fy = (y + 0.5) / cell;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < width; x++) {
        const fx = (x + 0.5) / cell;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = lattice[y0 * gw + x0];
        const b = lattice[y0 * gw + x0 + 1];
        const c = lattice[(y0 + 1) * gw + x0];
        const d = lattice[(y0 + 1) * gw + x0 + 1];
        const top = a + (b - a) * sx;
        out[y * width + x] += amp * (top + (c + (d - c) * sx - top) * sy);
      }
    }
  }
  return out;
}

/** A wider picture for the pan: 480 px wide, with more contrast than the background. */
const PAN_WIDTH = 480;
const PAN_PICTURE = valueNoise(2718, PAN_WIDTH, H).map((n) => 60 + 120 * n);

/** The static background: mid gray with a light texture (≈ 92..128). */
const BACKGROUND = valueNoise(8519).map((n) => 92 + 36 * n);

/** Coverage of a pixel by a shape with signed distance `sd` (negative inside), 1 px AA. */
function coverage(sd) {
  return Math.min(1, Math.max(0, 0.5 - sd));
}

/** Blend `value` over the image with `alpha` at pixel i. */
function over(img, i, value, alpha) {
  if (alpha > 0) img[i] = img[i] * (1 - alpha) + value * alpha;
}

/** Textured disc: bright, with a pattern fixed to the disc so its motion is measurable. */
function drawDot(img, cx, cy, radius) {
  const x0 = Math.max(0, Math.floor(cx - radius - 2));
  const x1 = Math.min(W, Math.ceil(cx + radius + 2));
  const y0 = Math.max(0, Math.floor(cy - radius - 2));
  const y1 = Math.min(H, Math.ceil(cy + radius + 2));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const lx = x + 0.5 - cx;
      const ly = y + 0.5 - cy;
      const a = coverage(Math.hypot(lx, ly) - radius);
      const pattern = 195 + 45 * Math.sin(0.7 * lx) * Math.sin(0.7 * ly);
      over(img, y * W + x, pattern, a);
    }
  }
}

/**
 * Concentric rings about the center at radii offset + k·spacing, each a soft bright band
 * (raised-cosine profile). Rings fade in near the center. They carry no pattern along
 * their length: their movement is radial, across their edges, which optical flow reads
 * directly. (A pattern such as sin(6θ) along the rings is chiral and made Farneback
 * report a spurious net rotation for a purely radial movement.)
 */
function drawRings(img, offset, spacing, width) {
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // Distance to the nearest ring radius.
      const phase = (((r - offset) % spacing) + spacing) % spacing;
      const d = Math.min(phase, spacing - phase);
      if (d >= width / 2) continue;
      const profile = 0.5 * (1 + Math.cos((2 * Math.PI * d) / width));
      const fade = Math.min(1, r / 16);
      over(img, y * W + x, 205, profile * fade);
    }
  }
}

/** One soft bright ring (raised-cosine profile) about the center. */
function drawRing(img, radius, width) {
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius);
      if (d >= width / 2) continue;
      over(img, y * W + x, 205, 0.5 * (1 + Math.cos((2 * Math.PI * d) / width)));
    }
  }
}

/** Long textured bar through the center at `angle` (radians, clockwise on screen). */
function drawBar(img, angle, length, thickness) {
  const cx = W / 2;
  const cy = H / 2;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      // Bar-local coordinates: `along` the bar, `across` it (y down, so increasing angle
      // turns the bar clockwise on screen).
      const along = dx * ca + dy * sa;
      const across = -dx * sa + dy * ca;
      const sd = Math.max(Math.abs(along) - length / 2, Math.abs(across) - thickness / 2);
      const a = coverage(sd);
      if (a <= 0) continue;
      const value = 190 + 45 * Math.sin(along / 4) * (0.6 + 0.4 * Math.cos(across / 3));
      over(img, y * W + x, value, a);
    }
  }
}

/** Seeded Gaussian noise, one independent field per frame. */
function addNoise(img, frame, sigma) {
  const random = rng(0x5eed + frame * 7919);
  for (let i = 0; i < img.length; i += 2) {
    const u = 1 - random();
    const v = random();
    const m = sigma * Math.sqrt(-2 * Math.log(u));
    img[i] += m * Math.cos(2 * Math.PI * v);
    if (i + 1 < img.length) img[i + 1] += m * Math.sin(2 * Math.PI * v);
  }
}

function toBytes(img) {
  const out = Buffer.alloc(img.length);
  for (let i = 0; i < img.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(img[i])));
  return out;
}

function blank() {
  return Float32Array.from(BACKGROUND);
}

/** A still scene: two static textured shapes over the background. */
function stillScene() {
  const img = blank();
  drawDot(img, 100, 80, 24);
  drawBar(img, 0.4, 90, 16);
  return img;
}

const lerp = (a, b, t) => a + (b - a) * t;

const FIXTURES = [
  {
    file: 'dot-right.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      drawDot(img, lerp(50, 270, f / 74), 90, 22);
      return img;
    },
  },
  {
    file: 'dot-up.mp4',
    frames: 60,
    draw: (f) => {
      const img = blank();
      drawDot(img, 160, lerp(150, 30, f / 59), 20);
      return img;
    },
  },
  {
    // Still for 12 frames (0.4 s), then 2 px/frame outward; a new ring every 16 frames.
    // The rings cover most of the frame, so the still lead-in is what lets the auto noise
    // floor (SPEC 8.1: from the quietest 10% of frames) find the true, quiet level.
    file: 'ring-expand.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      drawRings(img, 2 * Math.max(0, f - 12), 32, 12);
      return img;
    },
  },
  {
    file: 'ring-contract.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      drawRings(img, -2 * Math.max(0, f - 12), 32, 12);
      return img;
    },
  },
  {
    // 60°/s clockwise; the bar (420 px) is longer than the frame diagonal (367 px).
    file: 'bar-rotate-cw.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      drawBar(img, -0.6 + (Math.PI / 3) * (f / FPS), 420, 36);
      return img;
    },
  },
  { file: 'still.mp4', frames: 60, draw: () => stillScene() },
  {
    // Noise is incompressible, so this clip uses a higher CRF to stay small; plenty of
    // frame-to-frame noise survives, much as it does in a phone's own encoding.
    file: 'still-noise.mp4',
    frames: 60,
    crf: 20,
    draw: (f) => {
      const img = stillScene();
      addNoise(img, f, 3);
      return img;
    },
  },
  {
    // Rests 9 frames (0.3 s), moves right 4 px/frame for 48 frames, stops dead, rests.
    file: 'dot-stop.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      const moving = Math.min(48, Math.max(0, f - 8));
      drawDot(img, 60 + 4 * moving, 90, 22);
      return img;
    },
  },
  {
    // Radius 14 px for 12 frames, grows 1.5 px/frame to 72.5 px over 39 frames, then holds.
    // Its outer edge stays at least 11 px from the frame edge.
    file: 'ring-expand-inside.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      drawRing(img, 14 + 1.5 * Math.min(39, Math.max(0, f - 12)), 12);
      return img;
    },
  },
  {
    file: 'ring-contract-inside.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      drawRing(img, 72.5 - 1.5 * Math.min(39, Math.max(0, f - 12)), 12);
      return img;
    },
  },
  {
    // 120 × 20 px bar turning clockwise at 60°/s about the center; its corners stay
    // within 61 px of the center, so at least 29 px from the frame edge.
    file: 'bar-rotate-cw-inside.mp4',
    frames: 75,
    draw: (f) => {
      const img = blank();
      drawBar(img, -0.6 + (Math.PI / 3) * (f / FPS), 120, 20);
      return img;
    },
  },
  {
    // The whole picture slides right 2 px/frame from the first frame to the last.
    file: 'pan-right.mp4',
    frames: 60,
    draw: (f) => {
      const img = new Float32Array(W * H);
      const offset = 140 - 2 * f; // content moves right as the window moves left
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) img[y * W + x] = PAN_PICTURE[y * PAN_WIDTH + x + offset];
      }
      return img;
    },
  },
];

async function encode({ file, frames, draw, crf = 14 }) {
  const path = join(outDir, file);
  const args = [
    ...['-hide_banner', '-loglevel', 'error', '-y'],
    ...['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-'],
    ...['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p'],
    ...['-movflags', '+faststart', path],
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  for (let f = 0; f < frames; f++) {
    if (!ff.stdin.write(toBytes(draw(f)))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  console.log(`${file}  ${frames} frames  ${(statSync(path).size / 1024).toFixed(0)} KB`);
}

for (const fixture of FIXTURES) await encode(fixture);
