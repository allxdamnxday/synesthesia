// Generate the spike 2 test clips (SPEC 16, M0 spike 2) into spikes/fixtures/.
//
//   node scripts/make-spike-clips.mjs
//
// Needs ffmpeg (with libx264 and libx265) on PATH. The clips are committed, so nobody
// else needs to run this.
//
// Every frame shows its own frame index as a barcode in the top half of the displayed
// picture: 12 equal-width blocks across the frame, most significant bit on the left,
// white = 1, black = 0 (rows 0..H/4), and the same 12 blocks inverted underneath
// (rows H/4..H/2) so a reader can reject a bad read. The bottom half is a seeded texture
// that scrolls every frame, so the encoder has real work (motion, B-frames).
//
// Clips:
//   h264-30fps.mp4          H.264 High profile with B-frames, 30 fps, 3 s, 640×360
//   h264-30fps.mov          the same stream in a MOV container
//   portrait-2997-rot90.mov H.264, 30000/1001 fps, 3 s. Coded 640×360 with a display
//                           matrix that rotates 90° clockwise (like an iPhone held
//                           upright), so it displays as 360×640. The barcode only reads
//                           correctly once the rotation is applied.
//   hevc-30fps.mov          HEVC (libx265, hvc1 tag) of the same content as the MP4
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'spikes', 'fixtures');
mkdirSync(outDir, { recursive: true });

export const BITS = 12;
const WHITE = 235;
const BLACK = 16;

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

/** Tileable smooth texture (value noise, 2 octaves), size×size, values 0..1. */
function makeTexture(size, seed) {
  const random = rng(seed);
  const tex = new Float32Array(size * size);
  for (const [cell, amp] of [
    [32, 0.6],
    [8, 0.4],
  ]) {
    const n = size / cell;
    const lattice = Array.from({ length: n * n }, () => random());
    for (let y = 0; y < size; y++) {
      const fy = y / cell;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = x / cell;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const at = (i, j) => lattice[(j % n) * n + (i % n)];
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        tex[y * size + x] += amp * (top + (bottom - top) * sy);
      }
    }
  }
  return tex;
}

const TEX_SIZE = 256;
const texture = makeTexture(TEX_SIZE, 1234);

/** Draw frame `index` in display orientation (width × height), 8-bit gray. */
function drawDisplayFrame(index, width, height) {
  const img = new Uint8Array(width * height);
  const barH = Math.floor(height / 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value;
      if (y < 2 * barH) {
        const bit = Math.min(BITS - 1, Math.floor((x * BITS) / width));
        const on = ((index >> (BITS - 1 - bit)) & 1) === 1;
        const inverted = y >= barH;
        value = on !== inverted ? WHITE : BLACK;
      } else {
        // Scroll 3 px right and 1 px down per frame.
        const tx = (((x - 3 * index) % TEX_SIZE) + TEX_SIZE) % TEX_SIZE;
        const ty = (((y - index) % TEX_SIZE) + TEX_SIZE) % TEX_SIZE;
        value = 40 + 180 * texture[ty * TEX_SIZE + tx];
      }
      img[y * width + x] = Math.round(value);
    }
  }
  return img;
}

/**
 * The coded frame for a clip whose display matrix rotates 90° clockwise: displaying
 * rotates coded (x, y) to (codedHeight − 1 − y, x), so coded(x, y) = display(ch − 1 − y, x).
 */
function toCodedForCw90(display, displayWidth, displayHeight) {
  const codedWidth = displayHeight;
  const codedHeight = displayWidth;
  const coded = new Uint8Array(codedWidth * codedHeight);
  for (let y = 0; y < codedHeight; y++) {
    for (let x = 0; x < codedWidth; x++) {
      coded[y * codedWidth + x] = display[x * displayWidth + (codedHeight - 1 - y)];
    }
  }
  return coded;
}

async function encode({
  file,
  width,
  height,
  rate,
  frames,
  frameAt,
  codecArgs,
  inputArgs = [],
  outputArgs = [],
}) {
  const path = join(outDir, file);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-s',
    `${width}x${height}`,
    '-r',
    rate,
    ...inputArgs,
    '-i',
    '-',
    ...codecArgs,
    '-pix_fmt',
    'yuv420p',
    ...outputArgs,
    path,
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  for (let i = 0; i < frames; i++) {
    if (!ff.stdin.write(frameAt(i))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  return path;
}

function report(path) {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,profile,width,height,r_frame_rate,nb_read_frames,has_b_frames:stream_side_data=rotation',
      '-of',
      'compact=p=0:nk=0',
      path,
    ],
    { encoding: 'utf8' },
  );
  const kb = (statSync(path).size / 1024).toFixed(0);
  console.log(
    `${path.slice(root.length + 1)}  ${kb} KB  ${probe.stdout.trim().replace(/\n/g, ' ')}`,
  );
}

const x264 = [
  '-c:v',
  'libx264',
  '-profile:v',
  'high',
  '-preset',
  'medium',
  '-crf',
  '28',
  '-bf',
  '3',
  '-g',
  '60',
];

const mp4 = await encode({
  file: 'h264-30fps.mp4',
  width: 640,
  height: 360,
  rate: '30',
  frames: 90,
  frameAt: (i) => drawDisplayFrame(i, 640, 360),
  codecArgs: x264,
  outputArgs: ['-movflags', '+faststart'],
});
report(mp4);

// Same encoded stream, MOV container.
const mov = join(outDir, 'h264-30fps.mov');
const remux = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-c', 'copy', '-f', 'mov', mov],
  {
    stdio: 'inherit',
  },
);
if (remux.status !== 0) throw new Error('remux to MOV failed');
report(mov);

// Portrait, 29.97 fps, coded landscape + display matrix. In ffmpeg 8 -display_rotation is
// an input option in counter-clockwise degrees (a 90° clockwise display rotation, as on
// an upright iPhone, is -90). It is only written to the output on a stream copy, so the
// clip is encoded first and then remuxed with the rotation.
const portraitRaw = await encode({
  file: 'portrait-unrotated.tmp.mov',
  width: 640,
  height: 360,
  rate: '30000/1001',
  frames: 90,
  frameAt: (i) => toCodedForCw90(drawDisplayFrame(i, 360, 640), 360, 640),
  codecArgs: x264,
  outputArgs: ['-f', 'mov'],
});
const portrait = join(outDir, 'portrait-2997-rot90.mov');
const rotate = spawnSync(
  'ffmpeg',
  [
    ...['-hide_banner', '-loglevel', 'error', '-y'],
    ...['-display_rotation:v:0', '-90', '-i', portraitRaw],
    ...['-c', 'copy', '-f', 'mov', portrait],
  ],
  { stdio: 'inherit' },
);
if (rotate.status !== 0) throw new Error('adding the display rotation failed');
rmSync(portraitRaw);
report(portrait);

const hevc = await encode({
  file: 'hevc-30fps.mov',
  width: 640,
  height: 360,
  rate: '30',
  frames: 90,
  frameAt: (i) => drawDisplayFrame(i, 640, 360),
  codecArgs: [
    '-c:v',
    'libx265',
    '-preset',
    'medium',
    '-crf',
    '30',
    '-tag:v',
    'hvc1',
    '-x265-params',
    'log-level=error:keyint=60',
  ],
  outputArgs: ['-f', 'mov'],
});
report(hevc);
