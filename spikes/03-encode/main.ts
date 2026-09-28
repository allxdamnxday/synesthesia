/**
 * Spike 3 (SPEC 16, M0): encode a 3 s canvas animation plus a generated tone to MP4
 * (AVC + AAC) with Mediabunny at 1280×720 and 1920×1080, the way the render pipeline will
 * (SPEC 10.2): audio rendered first in an OfflineAudioContext, frames drawn from the frame
 * index and added with timestamp i / fps, audio added last, `fastStart: 'in-memory'`.
 *
 * Alignment markers: frame 30 (t = 1.000 s) is a white full-frame flash and the audio has
 * a sharp click starting exactly at 1.000 s. The page reads each MP4 back with Mediabunny
 * and reports where both land; spikes/03-encode/verify.mjs does the same with ffmpeg.
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny';
import {
  environmentRows,
  collectEnvironment,
  getRenderDefaults,
} from '../../src/render/capabilities';
import { RENDER_VIDEO_QUALITY } from '../../src/render/capabilities/codecs';

const FPS = 30;
const DURATION_S = 3;
const FRAME_COUNT = FPS * DURATION_S;
const FLASH_FRAME = 30;
const SAMPLE_RATE = 48_000;
const CLICK_TIME_S = 1;
/** The tone never exceeds 0.12, so anything above this is the click. */
const ONSET_THRESHOLD = 0.3;

type SizeLabel = '720p' | '1080p';
const SIZES: Record<SizeLabel, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export interface FileCheck {
  durationS: number;
  videoPackets: number;
  audioSampleRate: number | null;
  audioChannels: number | null;
  /** Presentation time of the first bright frame. */
  flashS: number | null;
  /** Presentation time of the first sample above the threshold. */
  clickS: number | null;
  offsetMs: number | null;
}

export interface EncodeResult {
  size: SizeLabel;
  width: number;
  height: number;
  fileName: string;
  bytes: number;
  mimeType: string;
  videoConfig: string;
  videoCodecString: string | null;
  videoPackets: number;
  audioCodec: 'aac' | 'opus';
  audioBitrate: number;
  audioCodecString: string | null;
  audioPackets: number;
  /** The encoder's first audio packet (negative timestamp = priming samples). */
  firstAudioPacket: { timestamp: number; duration: number } | null;
  /** Where the click starts in the rendered AudioBuffer (48000 expected). */
  renderedClickSample: number;
  videoLoopMs: number;
  totalMs: number;
  msPerFrame: number;
  check: FileCheck | null;
  checkError: string | null;
  url: string;
}

/** The soundtrack: a soft 440 Hz tone with fades and a sharp click at exactly 1.000 s. */
async function renderSoundtrack(): Promise<{ buffer: AudioBuffer; clickSample: number }> {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: DURATION_S * SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
  });

  const tone = new OscillatorNode(context, { type: 'sine', frequency: 440 });
  const toneGain = new GainNode(context, { gain: 0 });
  toneGain.gain.setValueAtTime(0, 0);
  toneGain.gain.linearRampToValueAtTime(0.12, 0.25);
  toneGain.gain.setValueAtTime(0.12, DURATION_S - 0.25);
  toneGain.gain.linearRampToValueAtTime(0, DURATION_S);
  tone.connect(toneGain).connect(context.destination);
  tone.start(0);
  tone.stop(DURATION_S);

  // A decaying 1 kHz burst that starts at full amplitude (cosine), so its onset is sharp.
  const clickLength = Math.round(0.02 * SAMPLE_RATE);
  const click = new AudioBuffer({
    length: clickLength,
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
  });
  const clickData = click.getChannelData(0);
  for (let i = 0; i < clickLength; i++) {
    clickData[i] =
      0.9 * Math.cos((2 * Math.PI * 1000 * i) / SAMPLE_RATE) * Math.exp(-i / (0.004 * SAMPLE_RATE));
  }
  const clickSource = new AudioBufferSourceNode(context, { buffer: click });
  clickSource.connect(context.destination);
  clickSource.start(CLICK_TIME_S);

  const buffer = await context.startRendering();
  const left = buffer.getChannelData(0);
  let clickSample = -1;
  for (let i = 0; i < left.length; i++) {
    if (Math.abs(left[i] ?? 0) > ONSET_THRESHOLD) {
      clickSample = i;
      break;
    }
  }
  return { buffer, clickSample };
}

/** One frame, from the frame index only. Frame 30 is a white full-frame flash. */
function drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, frame: number) {
  if (frame === FLASH_FRAME) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }
  ctx.fillStyle = '#0e1a24';
  ctx.fillRect(0, 0, width, height);

  // A Water-coloured disc sweeping left to right on a gentle wave.
  const progress = frame / (FRAME_COUNT - 1);
  const x = width * (0.1 + 0.8 * progress);
  const y = height * (0.5 + 0.2 * Math.sin(2 * Math.PI * progress));
  ctx.fillStyle = '#7fb7c9';
  ctx.beginPath();
  ctx.arc(x, y, height * 0.08, 0, 2 * Math.PI);
  ctx.fill();

  // Timeline with a Honey tick where the flash and click happen.
  const barX = width * 0.1;
  const barW = width * 0.8;
  ctx.fillStyle = '#5e6f7a';
  ctx.fillRect(barX, height * 0.9, barW, Math.max(2, height * 0.006));
  ctx.fillStyle = '#d9a441';
  ctx.fillRect(barX + barW * (CLICK_TIME_S / DURATION_S) - 2, height * 0.88, 4, height * 0.045);
  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(barX + barW * progress - 1, height * 0.885, 2, height * 0.035);

  ctx.fillStyle = '#e8e4da';
  ctx.font = `${Math.round(height * 0.05)}px system-ui, sans-serif`;
  ctx.fillText(
    `frame ${frame} of ${FRAME_COUNT}   t = ${(frame / FPS).toFixed(3)} s`,
    width * 0.05,
    height * 0.12,
  );
}

/** Read an MP4 back and find the flash frame and the click onset (presentation times). */
async function checkFile(bytes: ArrayBuffer): Promise<FileCheck> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const durationS = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const videoPackets = video ? (await video.computePacketStats()).packetCount : 0;

    let flashS: number | null = null;
    if (video) {
      const sink = new CanvasSink(video, { width: 32, height: 18, fit: 'fill', poolSize: 1 });
      // Read pixels through our own small canvas, flagged for frequent readback.
      const probe = document.createElement('canvas');
      probe.width = 32;
      probe.height = 18;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No 2D context');
      for await (const wrapped of sink.canvases(0.5, 1.5)) {
        ctx.drawImage(wrapped.canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, 32, 18).data;
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          sum +=
            0.2126 * (pixels[i] ?? 0) +
            0.7152 * (pixels[i + 1] ?? 0) +
            0.0722 * (pixels[i + 2] ?? 0);
        }
        if (sum / (pixels.length / 4) > 200) {
          flashS = wrapped.timestamp;
          break;
        }
      }
    }

    let clickS: number | null = null;
    let audioSampleRate: number | null = null;
    let audioChannels: number | null = null;
    if (audio) {
      audioSampleRate = await audio.getSampleRate();
      audioChannels = await audio.getNumberOfChannels();
      const sink = new AudioBufferSink(audio);
      search: for await (const { buffer, timestamp } of sink.buffers(0.5, 1.5)) {
        const left = buffer.getChannelData(0);
        for (let i = 0; i < left.length; i++) {
          if (Math.abs(left[i] ?? 0) > ONSET_THRESHOLD) {
            clickS = timestamp + i / buffer.sampleRate;
            break search;
          }
        }
      }
    }
    const offsetMs = flashS !== null && clickS !== null ? (clickS - flashS) * 1000 : null;
    return { durationS, videoPackets, audioSampleRate, audioChannels, flashS, clickS, offsetMs };
  } finally {
    input.dispose();
  }
}

function describeConfig(config: VideoEncoderConfig | null): string {
  if (!config) return 'unknown';
  const rate =
    config.bitrateMode === 'quantizer'
      ? 'quantizer rate control'
      : `${config.bitrateMode ?? 'variable'} ${Math.round((config.bitrate ?? 0) / 1000)} kbps`;
  return `${config.codec}, ${rate}, hardware acceleration ${config.hardwareAcceleration ?? 'no-preference'}`;
}

async function encode(size: SizeLabel): Promise<EncodeResult> {
  const { width, height } = SIZES[size];
  const defaults = await getRenderDefaults();
  if (!defaults.audioCodec || defaults.audioBitrate === null) {
    throw new Error(`No audio codec encodes here: ${defaults.notes.join(' ')}`);
  }
  const audioCodec = defaults.audioCodec;
  const audioBitrate = defaults.audioBitrate;
  const { buffer: soundtrack, clickSample } = await renderSoundtrack();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('No 2D context');
  const stage = document.getElementById('stage');
  stage?.replaceChildren(canvas);

  const seen: {
    videoConfig: VideoEncoderConfig | null;
    videoCodecString: string | null;
    videoPackets: number;
    audioCodecString: string | null;
    audioPackets: number;
    firstAudioPacket: { timestamp: number; duration: number } | null;
  } = {
    videoConfig: null,
    videoCodecString: null,
    videoPackets: 0,
    audioCodecString: null,
    audioPackets: 0,
    firstAudioPacket: null,
  };

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new Quality(RENDER_VIDEO_QUALITY),
    onEncoderConfig: (config) => {
      seen.videoConfig = config;
    },
    onEncodedPacket: (_packet, meta) => {
      seen.videoPackets++;
      if (meta?.decoderConfig?.codec) seen.videoCodecString = meta.decoderConfig.codec;
    },
  });
  const audioSource = new AudioBufferSource({
    codec: audioCodec,
    quality: new Quality({ bitrate: audioBitrate }),
    onEncodedPacket: (packet, meta) => {
      // A negative first timestamp means encoder priming, which Mediabunny trims with an edit list.
      seen.firstAudioPacket ??= { timestamp: packet.timestamp, duration: packet.duration };
      seen.audioPackets++;
      if (meta?.decoderConfig?.codec) seen.audioCodecString = meta.decoderConfig.codec;
    },
  });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  output.addAudioTrack(audioSource);
  await output.start();

  const started = performance.now();
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    drawFrame(ctx, width, height, frame);
    await videoSource.add(frame / FPS, 1 / FPS);
    if (frame % 15 === 14) {
      setStatus(`Encoding ${size}: frame ${frame + 1} of ${FRAME_COUNT}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const videoLoopMs = performance.now() - started;
  await audioSource.add(soundtrack);
  await output.finalize();
  const totalMs = performance.now() - started;
  const mimeType = await output.getMimeType();

  const bytes = target.buffer;
  if (!bytes) throw new Error('The encoder produced no file');
  const fileName = `sp-spike03-${size}.mp4`;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));

  let check: FileCheck | null = null;
  let checkError: string | null = null;
  try {
    check = await checkFile(bytes);
  } catch (error) {
    checkError = error instanceof Error ? error.message : String(error);
  }

  return {
    size,
    width,
    height,
    fileName,
    bytes: bytes.byteLength,
    mimeType,
    videoConfig: describeConfig(seen.videoConfig),
    videoCodecString: seen.videoCodecString,
    videoPackets: seen.videoPackets,
    audioCodec,
    audioBitrate,
    audioCodecString: seen.audioCodecString,
    audioPackets: seen.audioPackets,
    firstAudioPacket: seen.firstAudioPacket,
    renderedClickSample: clickSample,
    videoLoopMs,
    totalMs,
    msPerFrame: totalMs / FRAME_COUNT,
    check,
    checkError,
    url,
  };
}

// ---------------------------------------------------------------------------------------
// Page

const results = new Map<SizeLabel, EncodeResult>();
let environmentLines: string[] = [];

function setStatus(text: string) {
  const status = document.getElementById('status');
  if (status) status.textContent = text;
}

const FRAME_MS = 1000 / FPS;

function alignmentVerdict(check: FileCheck | null): { ok: boolean; text: string } {
  if (!check || check.offsetMs === null) return { ok: false, text: 'not measured' };
  const ok = Math.abs(check.offsetMs) <= FRAME_MS;
  return {
    ok,
    text: `${check.offsetMs >= 0 ? '+' : ''}${check.offsetMs.toFixed(1)} ms (${ok ? 'within one frame' : 'more than one frame'})`,
  };
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderRow(r: EncodeResult) {
  const tbody = document.getElementById('results');
  if (!tbody) return;
  tbody.querySelector(`tr[data-size="${r.size}"]`)?.remove();
  const tr = document.createElement('tr');
  tr.dataset.size = r.size;

  tr.append(cell(`${r.size} (${r.width}×${r.height})`));
  const fileCell = document.createElement('td');
  const link = document.createElement('a');
  link.id = `download-${r.size}`;
  link.href = r.url;
  link.download = r.fileName;
  link.textContent = `Download ${r.fileName}`;
  fileCell.append(link, document.createElement('br'), `${(r.bytes / 1024).toFixed(0)} KB`);
  tr.append(fileCell);
  tr.append(
    cell(
      `${r.mimeType}\nVideo: ${r.videoConfig}\nAudio: ${r.audioCodec.toUpperCase()} ${r.audioBitrate / 1000} kbps (${
        r.audioCodecString ?? '?'
      })`,
    ),
  );
  tr.append(
    cell(
      `${r.msPerFrame.toFixed(1)} ms per frame (${r.totalMs.toFixed(0)} ms total)\n${r.videoPackets} video and ${r.audioPackets} audio packets\nClick in the rendered audio: sample ${r.renderedClickSample}`,
    ),
  );
  const verdict = alignmentVerdict(r.check);
  const checkCell = cell(
    r.check
      ? `Duration ${r.check.durationS.toFixed(3)} s, ${r.check.videoPackets} frames\nFlash at ${
          r.check.flashS?.toFixed(3) ?? '?'
        } s, click at ${r.check.clickS?.toFixed(4) ?? '?'} s\nOffset ${verdict.text}`
      : `Couldn't read the file back: ${r.checkError ?? 'unknown error'}`,
    verdict.ok ? 'pass' : 'fail',
  );
  tr.append(checkCell);
  for (const td of tr.querySelectorAll('td')) td.style.whiteSpace = 'pre-line';
  tbody.append(tr);
}

function resultsText(): string {
  const lines = ['Spike 3: encode MP4 results', ...environmentLines, ''];
  for (const size of ['720p', '1080p'] as const) {
    const r = results.get(size);
    if (!r) continue;
    const verdict = alignmentVerdict(r.check);
    lines.push(
      `${r.size} (${r.width}x${r.height}): ${r.fileName}, ${r.bytes} bytes`,
      `  MIME: ${r.mimeType}`,
      `  Video: ${r.videoConfig}; packets ${r.videoPackets}`,
      `  Audio: ${r.audioCodec} ${r.audioBitrate} bps (${r.audioCodecString ?? '?'}); packets ${r.audioPackets}; first packet at ${
        r.firstAudioPacket
          ? `${r.firstAudioPacket.timestamp.toFixed(5)} s, ${r.firstAudioPacket.duration.toFixed(5)} s long`
          : '?'
      }`,
      `  Encode: ${r.msPerFrame.toFixed(1)} ms/frame, ${r.totalMs.toFixed(0)} ms total (video loop ${r.videoLoopMs.toFixed(0)} ms)`,
      `  Rendered click sample: ${r.renderedClickSample} (expected ${CLICK_TIME_S * SAMPLE_RATE})`,
      r.check
        ? `  Read back: duration ${r.check.durationS.toFixed(4)} s, ${r.check.videoPackets} video packets, audio ${r.check.audioSampleRate ?? '?'} Hz x ${r.check.audioChannels ?? '?'}, flash ${r.check.flashS?.toFixed(4) ?? '?'} s, click ${r.check.clickS?.toFixed(4) ?? '?'} s, offset ${verdict.text}`
        : `  Read back failed: ${r.checkError ?? '?'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function run(sizes: SizeLabel[]) {
  const buttons = document.querySelectorAll<HTMLButtonElement>('button[id^="encode-"]');
  buttons.forEach((b) => (b.disabled = true));
  try {
    for (const size of sizes) {
      setStatus(`Encoding ${size}…`);
      const result = await encode(size);
      results.set(size, result);
      renderRow(result);
    }
    setStatus('Done.');
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    const report = document.getElementById('report');
    if (report && results.size > 0) {
      report.hidden = false;
      report.textContent = resultsText();
    }
  }
}

document.getElementById('encode-720p')?.addEventListener('click', () => void run(['720p']));
document.getElementById('encode-1080p')?.addEventListener('click', () => void run(['1080p']));
document
  .getElementById('encode-both')
  ?.addEventListener('click', () => void run(['720p', '1080p']));
document.getElementById('copy')?.addEventListener('click', () => {
  void navigator.clipboard.writeText(resultsText()).then(
    () => setStatus('Results copied.'),
    () => setStatus('Copying was blocked; select the text below instead.'),
  );
});

void collectEnvironment().then((env) => {
  environmentLines = environmentRows(env)
    .filter((row) => ['Browser', 'Operating system', 'CPU', 'GPU'].includes(row.label))
    .map((row) => `${row.label}: ${row.value}`);
});

declare global {
  interface Window {
    /** For spikes/03-encode/run.mjs. */
    spike03?: {
      run: (sizes: SizeLabel[]) => Promise<void>;
      results: () => EncodeResult[];
      text: () => string;
    };
  }
}
window.spike03 = { run, results: () => [...results.values()], text: resultsText };
