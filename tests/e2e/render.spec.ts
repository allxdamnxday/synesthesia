/**
 * Offline render to MP4 (SPEC 10, 15.1; Milestone 4), driven through the harness page
 * dev/render (window.spRender). The page returns each MP4's bytes; this side writes them
 * to a file and checks it with ffprobe and ffmpeg (dev-time tools, on PATH).
 *
 * Acceptance covered here: valid MP4 (H.264 + AAC-LC 48 kHz stereo); frame count and
 * duration within one frame; audio and video aligned within one frame at an onset; two
 * renders of the same composition give the same frames and sound; 1080p renders with sane
 * progress; cancelling stops cleanly and leaves no file; folder saving never overwrites.
 * The render dialog is exercised end to end (downloads, folder, cancel, Esc).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const SIGNATURE_URL = './__fixtures__/sample.sig.json';

// Mirrors dev/render/harness.ts (the node test project can't import it).
interface RenderBytesOptions {
  signatureUrl?: string;
  visual?: string;
  sound?: string;
  props?: { visual?: Record<string, number>; sound?: Record<string, number> };
  timeline?: Partial<{
    speed: number;
    loops: number;
    loopMode: 'loop' | 'pingpong';
    tailSec: number;
    smoothing: number;
    signatureStrength: number;
  }>;
  seconds?: number;
  seed?: number;
  width?: number;
  height?: number;
  fps?: 30 | 60;
  quality?: 'draft' | 'standard' | 'high';
  normalize?: boolean;
  sidecar?: boolean;
  mute?: { visual?: boolean; sound?: boolean };
  destination?: 'memory' | 'opfs';
  opfsDir?: string;
  cancelAtFrame?: number;
  pauseAtFrame?: number;
  pauseMs?: number;
  returnBytes?: boolean;
  missingVisualMaterial?: string;
  failAtStep?: number;
  encoding?: { audioCodec: 'aac' | 'opus' | null; audioBitrate: number | null };
}
interface RenderResultSummary {
  fileName: string;
  destination: 'folder' | 'download' | 'memory';
  folderName: string | null;
  sidecarFileName: string | null;
  sidecarText: string | null;
  bytes: number;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSec: number;
  timelineSec: number;
  audio: { codec: string | null; bitrate: number | null; muted: boolean; normalized: boolean };
  visualMuted: boolean;
  warnings: string[];
}
interface RenderBytesResult {
  ok: boolean;
  cancelled: boolean;
  error: { name: string; message: string; code?: string; detail?: string } | null;
  base64: string | null;
  result: RenderResultSummary | null;
  progress: {
    phases: string[];
    calls: number;
    monotonic: boolean;
    lastFramesDone: number;
    frameCount: number;
    framesDuringPause: number;
  };
  timing: {
    totalMs: number;
    soundMs: number;
    framesMs: number;
    finishMs: number;
    msPerFrame: number;
  };
  onsets: number[];
  folderListing: { name: string; size: number }[] | null;
}
interface ReadBack {
  durationSec: number;
  frames: number;
  flashTimes: number[];
  clickTimes: number[];
  sampleRate: number | null;
  channels: number | null;
}
interface SpRender {
  ready: boolean;
  renderToBytes(o: RenderBytesOptions): Promise<RenderBytesResult>;
  readBackBase64(base64: string): Promise<ReadBack>;
  listOpfs(dir: string): Promise<{ name: string; size: number }[]>;
  clearOpfs(dir: string): Promise<void>;
  openDialog(o?: RenderBytesOptions & { useOpfsFolder?: string }): Promise<void>;
  dialogClosedWith: string | null | undefined;
}
type Win = { spRender: SpRender };

// ------------------------------------------------------------------------------------------
// ffprobe / ffmpeg helpers (Node side)

function run(command: string, args: string[]): { stdout: Buffer; stderr: string } {
  const result = spawnSync(command, args, { maxBuffer: 1024 * 1024 * 1024 });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${String(result.stderr).slice(-2000)}`);
  }
  return { stdout: result.stdout, stderr: String(result.stderr) };
}

interface ProbeStream {
  codec_type: string;
  codec_name: string;
  profile?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  nb_read_frames?: string;
  duration?: string;
  avg_frame_rate?: string;
}
interface Probe {
  format: { format_name: string; duration: string };
  streams: ProbeStream[];
}

function ffprobe(file: string): Probe {
  const { stdout } = run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-count_frames',
    file,
  ]);
  return JSON.parse(String(stdout)) as Probe;
}

/** Top-level MP4 boxes, in order. */
function topBoxes(file: string): string[] {
  const buf = readFileSync(file);
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(offset + 8));
    else if (size === 0) size = buf.length - offset;
    if (size < 8) break;
    boxes.push(type);
    offset += size;
  }
  return boxes;
}

interface DecodedFrame {
  n: number;
  time: number;
  luma: number;
}

/** Decode the video as a player would (edit lists applied) and log each frame's mean luma. */
function decodeFrames(file: string): DecodedFrame[] {
  const { stderr } = run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-copyts',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-vf',
    'showinfo',
    '-f',
    'null',
    '-',
  ]);
  const frames: DecodedFrame[] = [];
  const line =
    /Parsed_showinfo_\d+.*?\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:(-?[\d.eE+-]+).*?mean:\[(\d+)/g;
  for (const m of stderr.matchAll(line)) {
    frames.push({ n: Number(m[1]), time: Number(m[3]), luma: Number(m[4]) });
  }
  return frames;
}

interface DecodedAudio {
  start: number;
  rate: number;
  channels: number;
  /** Interleaved float32 samples. */
  samples: Float32Array;
}

function decodeAudio(file: string): DecodedAudio {
  const { stdout, stderr } = run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-copyts',
    '-i',
    file,
    '-map',
    '0:a:0',
    '-af',
    'ashowinfo',
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    'pipe:1',
  ]);
  // e.g. "n:0 pts:0 pts_time:0 fmt:fltp channels:2 chlayout:stereo rate:48000 nb_samples:1024"
  const first = /Parsed_ashowinfo_\d+[^\n]*/.exec(stderr)?.[0] ?? '';
  const field = (name: string, fallback: number) => {
    const m = new RegExp(`\\b${name}:(-?[\\d.eE+-]+)`).exec(first);
    return m ? Number(m[1]) : fallback;
  };
  const bytes = new Uint8Array(stdout);
  const aligned = bytes.slice(0, bytes.byteLength - (bytes.byteLength % 4));
  return {
    start: field('pts_time', 0),
    rate: field('rate', 48000),
    channels: field('channels', 2),
    samples: new Float32Array(aligned.buffer),
  };
}

/** Times where the first channel rises above `threshold` after 50 ms of quiet. */
function clickTimes(audio: DecodedAudio, threshold = 0.3): number[] {
  const times: number[] = [];
  let quiet = Number.POSITIVE_INFINITY;
  const frames = audio.samples.length / audio.channels;
  for (let i = 0; i < frames; i++) {
    const loud = Math.abs(audio.samples[i * audio.channels] ?? 0) > threshold;
    if (loud && quiet > 0.05 * audio.rate) times.push(audio.start + i / audio.rate);
    quiet = loud ? 0 : quiet + 1;
  }
  return times;
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return peak;
}

/** One MD5 per decoded video frame. */
function frameMd5s(file: string): string[] {
  const { stdout } = run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-f',
    'framemd5',
    '-',
  ]);
  return String(stdout)
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(',').pop()?.trim() ?? '');
}

/** Average PSNR (dB) between two videos' frames; Infinity when identical. */
function psnr(a: string, b: string): number {
  const { stderr } = run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    a,
    '-i',
    b,
    '-lavfi',
    '[0:v][1:v]psnr',
    '-f',
    'null',
    '-',
  ]);
  const m = /average:(inf|[\d.]+)/.exec(stderr);
  if (!m) throw new Error(`No PSNR in: ${stderr.slice(-500)}`);
  return m[1] === 'inf' ? Number.POSITIVE_INFINITY : Number(m[1]);
}

/**
 * When the flash for an onset at `onset` seconds should appear: the test material flashes
 * on the first frame drawn after the 1/60 s step containing the onset. Onsets on a step
 * boundary (within float noise) may land in either neighbouring step.
 */
function expectedFlashTimes(onset: number, fps: number): number[] {
  const stepsPerFrame = 60 / fps;
  const x = onset * 60;
  const nearest = Math.round(x);
  const steps = Math.abs(x - nearest) < 1e-6 ? [nearest - 1, nearest] : [Math.floor(x)];
  return steps.map((k) => (Math.floor(k / stepsPerFrame) + 1) / fps);
}

// ------------------------------------------------------------------------------------------
// Page helpers

const errors: string[] = [];

async function open(page: Page): Promise<void> {
  errors.length = 0;
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.route('**/__fixtures__/*', (route) =>
    route.fulfill({ path: join(FIXTURES, basename(new URL(route.request().url()).pathname)) }),
  );
  await page.goto('./dev/render/');
  await page.waitForFunction(() => (window as unknown as Win).spRender?.ready === true);
}

function render(page: Page, opts: RenderBytesOptions): Promise<RenderBytesResult> {
  return page.evaluate((o) => (window as unknown as Win).spRender.renderToBytes(o), {
    signatureUrl: SIGNATURE_URL,
    ...opts,
  });
}

/** Render and write the MP4 to the test's output folder. */
async function renderToFile(
  page: Page,
  testInfo: TestInfo,
  name: string,
  opts: RenderBytesOptions,
): Promise<{ file: string; out: RenderBytesResult }> {
  const out = await render(page, opts);
  expect(out.error, JSON.stringify(out.error)).toBeNull();
  expect(out.ok).toBe(true);
  expect(out.base64).toBeTruthy();
  const file = testInfo.outputPath(name);
  writeFileSync(file, Buffer.from(out.base64 ?? '', 'base64'));
  return { file, out };
}

function note(testInfo: TestInfo, type: string, description: string): void {
  testInfo.annotations.push({ type, description });
  console.log(`[${type}] ${description}`);
}

// ------------------------------------------------------------------------------------------

test.describe('offline render to MP4', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('a 2 s composition at 720p30 is a valid MP4 with H.264 and AAC-LC 48 kHz stereo', async ({
    page,
  }, testInfo) => {
    const { file, out } = await renderToFile(page, testInfo, '720p30-2s.mp4', {
      seconds: 2,
      width: 1280,
      height: 720,
      fps: 30,
    });
    const result = out.result;
    expect(result).not.toBeNull();
    expect(result?.frameCount).toBe(60);
    expect(result?.fileName).toBe('SP_Sample-wink_Sample-wink-Water-and-Water_004217.mp4');
    expect(result?.mimeType).toMatch(/^video\/mp4; codecs="avc1\.\w+, mp4a\.40\.2"$/);

    const probe = ffprobe(file);
    const video = probe.streams.find((s) => s.codec_type === 'video');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    expect(probe.format.format_name).toContain('mp4');
    expect(video?.codec_name).toBe('h264');
    expect([video?.width, video?.height]).toEqual([1280, 720]);
    expect(video?.avg_frame_rate).toBe('30/1');
    expect(Math.abs(Number(video?.nb_read_frames) - 60)).toBeLessThanOrEqual(1);
    expect(audio?.codec_name).toBe('aac');
    expect(audio?.profile).toBe('LC');
    expect(audio?.sample_rate).toBe('48000');
    expect(audio?.channels).toBe(2);
    const duration = Number(probe.format.duration);
    expect(Math.abs(duration - 2)).toBeLessThanOrEqual(1 / 30);
    expect(Math.abs(Number(video?.duration) - 2)).toBeLessThanOrEqual(1 / 30);
    // Fast start: the index comes before the media, so players can start straight away.
    const boxes = topBoxes(file);
    expect(boxes.indexOf('moov')).toBeGreaterThan(-1);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));

    // Progress: phases in order, frames one at a time, ending on the last frame.
    expect(out.progress.phases).toEqual(['starting', 'sound', 'frames', 'finishing', 'done']);
    expect(out.progress.monotonic).toBe(true);
    expect(out.progress.lastFramesDone).toBe(60);
    // The sound is normalized to −1 dBFS (a codec may overshoot a little).
    const decoded = decodeAudio(file);
    expect(peakOf(decoded.samples)).toBeGreaterThan(0.7);
    expect(peakOf(decoded.samples)).toBeLessThan(1);
    note(
      testInfo,
      'ffprobe',
      `${probe.format.format_name}; video ${video?.codec_name} ${video?.profile} ${video?.width}x${video?.height} ${video?.avg_frame_rate}, ${video?.nb_read_frames} frames, ${video?.duration} s; audio ${audio?.codec_name} ${audio?.profile} ${audio?.sample_rate} Hz x${audio?.channels}; file ${duration} s; boxes ${boxes.join(' ')}`,
    );
  });

  for (const { speed, fps } of [
    { speed: 1, fps: 30 },
    { speed: 0.96, fps: 30 },
    { speed: 1, fps: 60 },
  ] as const) {
    test(`audio and video align within one frame at each onset (speed ${speed}, ${fps} fps)`, async ({
      page,
    }, testInfo) => {
      const { file, out } = await renderToFile(page, testInfo, `align-${speed}-${fps}.mp4`, {
        visual: 'test-flash',
        sound: 'test-click',
        timeline: { speed, tailSec: 1, loops: 1, smoothing: 0 },
        width: 1280,
        height: 720,
        fps,
        quality: 'draft',
      });
      expect(out.onsets.length).toBeGreaterThanOrEqual(2);
      const frames = decodeFrames(file);
      const flashes = frames.filter((f) => f.luma >= 128);
      const clicks = clickTimes(decodeAudio(file));
      expect(flashes.length).toBe(out.onsets.length);
      expect(clicks.length).toBe(out.onsets.length);

      const frameMs = 1000 / fps;
      const offsets: string[] = [];
      out.onsets.forEach((onset, i) => {
        const flash = flashes[i]?.time ?? Number.NaN;
        const click = clicks[i] ?? Number.NaN;
        // The sound is sample-accurate: the click starts at the onset.
        expect(Math.abs(click - onset) * 1000).toBeLessThan(0.5);
        // The picture is frame-accurate: the flash is exactly where the stepping puts it.
        const expected = expectedFlashTimes(onset, fps);
        expect(expected.some((t) => Math.abs(t - flash) < 0.0005)).toBe(true);
        // M4 acceptance: within one frame, and the picture never comes before the sound.
        const offsetMs = (click - flash) * 1000;
        expect(Math.abs(offsetMs)).toBeLessThanOrEqual(frameMs + 0.5);
        expect(flash).toBeGreaterThanOrEqual(click - 0.0005);
        offsets.push(
          `onset ${onset.toFixed(4)} s: click ${click.toFixed(5)} s, flash frame ${flashes[i]?.n} at ${flash.toFixed(4)} s, offset ${offsetMs.toFixed(2)} ms`,
        );
      });

      // The page's own read-back (Mediabunny, what the Mac check uses) agrees with ffmpeg.
      const back = await page.evaluate(
        (b64) => (window as unknown as Win).spRender.readBackBase64(b64),
        out.base64 ?? '',
      );
      expect(back.flashTimes.length).toBe(flashes.length);
      back.flashTimes.forEach((t, i) =>
        expect(Math.abs(t - (flashes[i]?.time ?? 0))).toBeLessThan(0.001),
      );
      back.clickTimes.forEach((t, i) => expect(Math.abs(t - (clicks[i] ?? 0))).toBeLessThan(0.001));
      note(testInfo, 'alignment', `speed ${speed}, ${fps} fps: ${offsets.join('; ')}`);
    });
  }

  test('rendering the same composition twice gives the same frames and sound', async ({
    page,
  }, testInfo) => {
    const opts: RenderBytesOptions = {
      timeline: { tailSec: 1 },
      width: 1280,
      height: 720,
      fps: 30,
      seed: 31337,
    };
    const a = await renderToFile(page, testInfo, 'repeat-a.mp4', opts);
    const b = await renderToFile(page, testInfo, 'repeat-b.mp4', opts);

    // There is a wake to compare (not an empty black video).
    const lumas = decodeFrames(a.file).map((f) => f.luma);
    expect(Math.max(...lumas)).toBeGreaterThan(20);

    const md5a = frameMd5s(a.file);
    const md5b = frameMd5s(b.file);
    expect(md5a.length).toBe(a.out.result?.frameCount);
    const sameFrames = md5a.every((m, i) => m === md5b[i]);
    const quality = sameFrames ? Number.POSITIVE_INFINITY : psnr(a.file, b.file);
    expect(quality).toBeGreaterThanOrEqual(50);

    const soundA = decodeAudio(a.file).samples;
    const soundB = decodeAudio(b.file).samples;
    expect(soundA.length).toBe(soundB.length);
    let maxDiff = 0;
    for (let i = 0; i < soundA.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs((soundA[i] ?? 0) - (soundB[i] ?? 0)));
    }
    expect(maxDiff).toBeLessThan(1e-4);

    const bytesA = readFileSync(a.file);
    const bytesB = readFileSync(b.file);
    let differing = 0;
    for (let i = 0; i < Math.max(bytesA.length, bytesB.length); i++) {
      if (bytesA[i] !== bytesB[i]) differing++;
    }
    note(
      testInfo,
      'determinism',
      `${md5a.length} frames ${sameFrames ? 'identical (framemd5)' : `PSNR ${quality.toFixed(1)} dB`}; decoded sound max difference ${maxDiff}; files ${bytesA.length} and ${bytesB.length} bytes, ${differing} bytes differ (the header's creation time)`,
    );
  });

  test('a 1080p30 render works and reports sane progress', async ({ page }, testInfo) => {
    const { file, out } = await renderToFile(page, testInfo, '1080p30.mp4', {
      seconds: 4,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(out.result?.frameCount).toBe(120);
    expect(out.progress.phases).toEqual(['starting', 'sound', 'frames', 'finishing', 'done']);
    expect(out.progress.monotonic).toBe(true);
    // One report per phase change plus one per frame.
    expect(out.progress.calls).toBeGreaterThanOrEqual(120);
    expect(out.progress.lastFramesDone).toBe(120);
    const probe = ffprobe(file);
    const video = probe.streams.find((s) => s.codec_type === 'video');
    expect([video?.width, video?.height]).toEqual([1920, 1080]);
    expect(Math.abs(Number(video?.nb_read_frames) - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(probe.format.duration) - 4)).toBeLessThanOrEqual(1 / 30);
  });

  test('square and 60 fps renders have the right shape and frame count', async ({
    page,
  }, testInfo) => {
    const { file } = await renderToFile(page, testInfo, 'square60.mp4', {
      seconds: 1.5,
      width: 1080,
      height: 1080,
      fps: 60,
    });
    const probe = ffprobe(file);
    const video = probe.streams.find((s) => s.codec_type === 'video');
    expect([video?.width, video?.height]).toEqual([1080, 1080]);
    expect(video?.avg_frame_rate).toBe('60/1');
    expect(Math.abs(Number(video?.nb_read_frames) - 90)).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(probe.format.duration) - 1.5)).toBeLessThanOrEqual(1 / 60);
    // The wake is drawn (the wink is under way by the end).
    const lumas = decodeFrames(file).map((f) => f.luma);
    expect(Math.max(...lumas)).toBeGreaterThan(17);
  });

  test('cancelling mid-render stops cleanly and leaves nothing in the folder', async ({
    page,
  }, testInfo) => {
    const dir = 'cancel-test';
    await page.evaluate((d) => (window as unknown as Win).spRender.clearOpfs(d), dir);
    const out = await render(page, {
      seconds: 4,
      width: 1920,
      height: 1080,
      fps: 30,
      destination: 'opfs',
      opfsDir: dir,
      sidecar: true,
      cancelAtFrame: 20,
    });
    expect(out.cancelled).toBe(true);
    expect(out.error).toBeNull();
    expect(out.result).toBeNull();
    expect(out.progress.phases).toEqual(['starting', 'sound', 'frames']);
    expect(out.progress.lastFramesDone).toBe(20);
    expect(out.folderListing).toEqual([]);

    // The next render works and gets the plain name: nothing was left behind.
    const next = await render(page, {
      seconds: 1,
      width: 1280,
      height: 720,
      fps: 30,
      destination: 'opfs',
      opfsDir: dir,
      returnBytes: false,
    });
    expect(next.ok).toBe(true);
    expect(next.folderListing?.map((e) => e.name)).toEqual([
      'SP_Sample-wink_Sample-wink-Water-and-Water_004217.mp4',
    ]);
    note(
      testInfo,
      'cancel',
      `stopped at frame ${out.progress.lastFramesDone} of 120; folder empty`,
    );
  });

  test('a failing render explains itself and leaves nothing in the folder', async ({ page }) => {
    const dir = 'fail-test';
    await page.evaluate((d) => (window as unknown as Win).spRender.clearOpfs(d), dir);
    const out = await render(page, {
      seconds: 1,
      destination: 'opfs',
      opfsDir: dir,
      missingVisualMaterial: 'honey',
    });
    expect(out.ok).toBe(false);
    expect(out.cancelled).toBe(false);
    expect(out.error?.code).toBe('material-missing');
    expect(out.error?.message).toContain('“honey”');
    expect(out.folderListing).toEqual([]);

    // A failure halfway through the frames, with the file already streaming: removed too.
    const midway = await render(page, {
      seconds: 2,
      destination: 'opfs',
      opfsDir: dir,
      sidecar: true,
      failAtStep: 60,
    });
    expect(midway.ok).toBe(false);
    expect(midway.error?.code).toBe('unknown');
    expect(midway.error?.detail).toContain('Test failure after 60 steps');
    // Frames 0–30 need 60 steps; frame 31 needs step 61, which fails.
    expect(midway.progress.lastFramesDone).toBe(31);
    expect(midway.folderListing).toEqual([]);
  });

  test('saving into a folder never overwrites and keeps the composition file alongside', async ({
    page,
  }, testInfo) => {
    const dir = 'folder-test';
    await page.evaluate((d) => (window as unknown as Win).spRender.clearOpfs(d), dir);
    const opts: RenderBytesOptions = {
      seconds: 1,
      width: 1280,
      height: 720,
      fps: 30,
      destination: 'opfs',
      opfsDir: dir,
      sidecar: true,
    };
    const first = await render(page, opts);
    const second = await render(page, opts);
    const stem = 'SP_Sample-wink_Sample-wink-Water-and-Water_004217';
    expect(first.result?.fileName).toBe(`${stem}.mp4`);
    expect(first.result?.sidecarFileName).toBe(`${stem}.spcomp.json`);
    expect(second.result?.fileName).toBe(`${stem} (2).mp4`);
    expect(second.result?.sidecarFileName).toBe(`${stem} (2).spcomp.json`);
    expect(second.folderListing?.map((e) => e.name)).toEqual([
      `${stem} (2).mp4`,
      `${stem} (2).spcomp.json`,
      `${stem}.mp4`,
      `${stem}.spcomp.json`,
    ]);
    // Streamed straight to the folder, the MP4 is complete and valid.
    const file = testInfo.outputPath('folder.mp4');
    writeFileSync(file, Buffer.from(second.base64 ?? '', 'base64'));
    expect(
      ffprobe(file)
        .streams.map((s) => s.codec_name)
        .sort(),
    ).toEqual(['aac', 'h264']);
    expect(second.folderListing?.find((e) => e.name === `${stem} (2).mp4`)?.size).toBe(
      second.result?.bytes,
    );
    // The sidecar is the composition, recording the size it was rendered at.
    const sidecar = JSON.parse(second.result?.sidecarText ?? '{}') as {
      format: string;
      render: { width: number; height: number; fps: number };
    };
    expect(sidecar.format).toBe('sp-composition');
    expect(sidecar.render).toEqual({ width: 1280, height: 720, fps: 30 });
  });

  test('falls back to Opus sound, or no sound track, when AAC is unavailable', async ({
    page,
  }, testInfo) => {
    const opus = await renderToFile(page, testInfo, 'opus.mp4', {
      seconds: 1,
      encoding: { audioCodec: 'opus', audioBitrate: 128_000 },
    });
    expect(opus.out.result?.audio.codec).toBe('opus');
    const opusAudio = ffprobe(opus.file).streams.find((s) => s.codec_type === 'audio');
    expect(opusAudio?.codec_name).toBe('opus');
    expect(opusAudio?.sample_rate).toBe('48000');
    expect(opusAudio?.channels).toBe(2);

    const silent = await renderToFile(page, testInfo, 'no-sound.mp4', {
      seconds: 1,
      encoding: { audioCodec: null, audioBitrate: null },
    });
    expect(silent.out.result?.audio.codec).toBeNull();
    const streams = ffprobe(silent.file).streams.map((s) => s.codec_type);
    expect(streams).toEqual(['video']);
  });

  test('muted fields render black frames and silence', async ({ page }, testInfo) => {
    const { file, out } = await renderToFile(page, testInfo, 'muted.mp4', {
      seconds: 1,
      width: 1280,
      height: 720,
      fps: 30,
      mute: { visual: true, sound: true },
    });
    expect(out.result?.visualMuted).toBe(true);
    expect(out.result?.audio.muted).toBe(true);
    const frames = decodeFrames(file);
    expect(frames.length).toBe(30);
    expect(Math.max(...frames.map((f) => f.luma))).toBeLessThanOrEqual(17);
    const sound = decodeAudio(file);
    expect(sound.samples.length).toBeGreaterThan(0);
    expect(peakOf(sound.samples)).toBe(0);
  });

  test('pausing holds the frames until resumed', async ({ page }) => {
    const out = await render(page, {
      seconds: 1,
      width: 1280,
      height: 720,
      fps: 30,
      pauseAtFrame: 10,
      pauseMs: 700,
      returnBytes: false,
    });
    expect(out.ok).toBe(true);
    expect(out.progress.framesDuringPause).toBe(0);
    expect(out.timing.framesMs).toBeGreaterThanOrEqual(700);
    expect(out.progress.lastFramesDone).toBe(30);
  });

  test('render speed at High quality, and an album projection', async ({ page }, testInfo) => {
    // A ~10 s track: the sample wink (2.2 s) four times, then 1.2 s of tail.
    const lines: string[] = [];
    const perFrame: Record<string, number> = {};
    for (const [label, width, height] of [
      ['720p', 1280, 720],
      ['1080p', 1920, 1080],
    ] as const) {
      await render(page, { seconds: 1, width, height, fps: 30, returnBytes: false }); // warm up
      const out = await render(page, {
        timeline: { loops: 4, tailSec: 1.2 },
        width,
        height,
        fps: 30,
        quality: 'high',
        returnBytes: false,
      });
      expect(out.ok).toBe(true);
      expect(out.result?.frameCount).toBe(300);
      perFrame[label] = out.timing.msPerFrame;
      const trackSec = out.timing.totalMs / 1000;
      lines.push(
        `${label}30 High: ${out.timing.msPerFrame.toFixed(1)} ms per frame; sound ${out.timing.soundMs.toFixed(0)} ms, frames ${out.timing.framesMs.toFixed(0)} ms, finishing ${out.timing.finishMs.toFixed(0)} ms; a 10 s track takes ${trackSec.toFixed(1)} s, so a 25-track album about ${((25 * trackSec) / 60).toFixed(1)} minutes`,
      );
      expect(out.timing.msPerFrame).toBeLessThan(200);
    }
    note(testInfo, 'speed', lines.join(' | '));
  });
});

test.describe('render dialog', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('renders to downloads and reports the file', async ({ page }, testInfo) => {
    await page.evaluate(
      (url) => (window as unknown as Win).spRender.openDialog({ signatureUrl: url, seconds: 1 }),
      SIGNATURE_URL,
    );
    const dialog = page.getByRole('dialog', { name: 'Render MP4' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog.getByText('“Sample wink · Water and Water” · 1 second')).toBeVisible();
    // Defaults: High quality, loudness on, composition file off.
    await expect(dialog.getByRole('radio', { name: 'High' })).toBeChecked();
    await expect(dialog.getByRole('switch', { name: 'Even out loudness' })).toBeChecked();
    await expect(
      dialog.getByRole('switch', { name: 'Also save the composition file' }),
    ).not.toBeChecked();
    await dialog.getByRole('radio', { name: '720p 1280 × 720' }).check();
    await dialog.getByRole('radio', { name: 'Downloads' }).check();

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Render', exact: true }).click();
    const saved = await download;
    const name = 'SP_Sample-wink_Sample-wink-Water-and-Water_004217.mp4';
    expect(saved.suggestedFilename()).toBe(name);
    const finished = page.getByRole('dialog', { name: 'Render finished' });
    await expect(finished).toBeVisible();
    await expect(finished.getByText(`“${name}” was saved to your downloads.`)).toBeVisible();
    await expect(finished.getByRole('button', { name: 'Close' })).toBeFocused();

    const file = testInfo.outputPath('dialog.mp4');
    await saved.saveAs(file);
    const video = ffprobe(file).streams.find((s) => s.codec_type === 'video');
    expect([video?.width, video?.height]).toEqual([1280, 720]);

    await finished.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Win).spRender.dialogClosedWith)).toBe(
      name,
    );
  });

  test('saves into the chosen folder, can be cancelled, and closes with Esc', async ({ page }) => {
    const dir = 'dialog-test';
    await page.evaluate((d) => (window as unknown as Win).spRender.clearOpfs(d), dir);
    await page.evaluate(
      ({ url, d }) =>
        (window as unknown as Win).spRender.openDialog({
          signatureUrl: url,
          timeline: { loops: 8, tailSec: 10 },
          useOpfsFolder: d,
        }),
      { url: SIGNATURE_URL, d: dir },
    );
    const dialog = page.getByRole('dialog', { name: 'Render MP4' });
    await expect(dialog.getByText(`Renders go into “${dir}”.`)).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /^A folder/ })).toBeChecked();
    await dialog.getByRole('radio', { name: '1080p 1920 × 1080' }).check();
    await dialog.getByRole('button', { name: 'Render', exact: true }).click();

    const rendering = page.getByRole('dialog', { name: 'Rendering' });
    await expect(rendering.getByText(/Drawing frames… \d+ of \d+/)).toBeVisible();
    // Esc does nothing while rendering.
    await page.keyboard.press('Escape');
    await expect(rendering).toBeVisible();
    await expect(rendering.getByRole('button', { name: 'Cancel render' })).toBeFocused();
    await rendering.getByRole('button', { name: 'Cancel render' }).click();

    const back = page.getByRole('dialog', { name: 'Render MP4' });
    await expect(back.getByText('The render was cancelled. Nothing was saved.')).toBeVisible();
    // Focus stays in the dialog, ready to render again.
    await expect(back.getByRole('button', { name: 'Render', exact: true })).toBeFocused();
    expect(
      await page.evaluate((d) => (window as unknown as Win).spRender.listOpfs(d), dir),
    ).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Win).spRender.dialogClosedWith)).toBe(
      null,
    );
  });

  test('a render that fails says why in plain words and can be tried again', async ({ page }) => {
    await page.evaluate(
      (url) =>
        (window as unknown as Win).spRender.openDialog({
          signatureUrl: url,
          seconds: 1,
          missingVisualMaterial: 'honey',
        }),
      SIGNATURE_URL,
    );
    const dialog = page.getByRole('dialog', { name: 'Render MP4' });
    await dialog.getByRole('radio', { name: 'Downloads' }).check();
    await dialog.getByRole('button', { name: 'Render', exact: true }).click();
    await expect(
      dialog.getByText(
        'This composition uses a material this version of the instrument doesn’t have (“honey”).',
      ),
    ).toBeVisible();
    await expect(dialog.getByText('Details for Braden')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Win).spRender.dialogClosedWith)).toBe(
      null,
    );
  });

  test('a folder render finishes with the file name and where it went', async ({ page }) => {
    const dir = 'dialog-done';
    await page.evaluate((d) => (window as unknown as Win).spRender.clearOpfs(d), dir);
    await page.evaluate(
      ({ url, d }) =>
        (window as unknown as Win).spRender.openDialog({
          signatureUrl: url,
          seconds: 1,
          useOpfsFolder: d,
        }),
      { url: SIGNATURE_URL, d: dir },
    );
    const dialog = page.getByRole('dialog', { name: 'Render MP4' });
    await dialog.getByRole('radio', { name: '720p 1280 × 720' }).check();
    await dialog.getByText('Also save the composition file').click();
    await expect(
      dialog.getByRole('switch', { name: 'Also save the composition file' }),
    ).toBeChecked();
    await dialog.getByRole('button', { name: 'Render', exact: true }).click();
    const finished = page.getByRole('dialog', { name: 'Render finished' });
    const stem = 'SP_Sample-wink_Sample-wink-Water-and-Water_004217';
    await expect(finished.getByText(`“${stem}.mp4” is in the folder “${dir}”.`)).toBeVisible();
    await expect(
      finished.getByText(`The composition file “${stem}.spcomp.json” is next to it.`),
    ).toBeVisible();
    const listing = await page.evaluate(
      (d) => (window as unknown as Win).spRender.listOpfs(d),
      dir,
    );
    expect(listing.map((e) => e.name)).toEqual([`${stem}.mp4`, `${stem}.spcomp.json`]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Win).spRender.dialogClosedWith)).toBe(
      `${stem}.mp4`,
    );
  });
});
