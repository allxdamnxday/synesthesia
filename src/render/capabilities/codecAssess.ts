/**
 * Codec capability results and how they become Diagnostics rows and render defaults
 * (SPEC 10.3, 14.1). Pure: the probes that fill these types live in `codecs.ts`, which
 * imports Mediabunny; this module doesn't, so the startup path stays small.
 */
import { checkBase } from './definitions';
import type { CapabilityCheck, CheckId } from './types';
import { formatBitrate, formatBytes } from './util';

export type RenderResolution = '1080p' | '720p' | 'square';

/** Output sizes offered by the render dialog (SPEC 10.1). */
export const RENDER_SIZES: Record<
  RenderResolution,
  { width: number; height: number; label: string }
> = {
  '1080p': { width: 1920, height: 1080, label: '1080p (1920×1080)' },
  '720p': { width: 1280, height: 720, label: '720p (1280×720)' },
  square: { width: 1080, height: 1080, label: 'square (1080×1080)' },
};

/** Tried in order. Windows' Media Foundation AAC encoder only accepts 96/128/160/192 kbps. */
export const AAC_BITRATES = [192_000, 160_000, 128_000, 96_000] as const;
export const OPUS_BITRATES = [160_000, 128_000, 96_000] as const;
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_CHANNELS = 2;

export const QUICKTIME_OPUS_WARNING = 'Some players, such as QuickTime, may not play this audio.';

export const HEVC_GUIDANCE =
  'On iPhone, set Settings > Camera > Formats > Most Compatible and record again, or convert the clip to MP4 (H.264).';

export interface VideoEncodeResult {
  resolution: RenderResolution;
  width: number;
  height: number;
  /** A tiny real encode produced packets and an MP4. */
  ok: boolean;
  /** VideoEncoder exists. */
  webCodecs: boolean;
  /** Mediabunny's canEncodeVideo (config-level) answer; null when not asked. */
  configSupported: boolean | null;
  frames: number;
  packets: number;
  /** Size of the tiny MP4. */
  bytes: number;
  /** Codec string from the encoder's decoder config (for example 'avc1.640028'). */
  codecString: string | null;
  /** The chosen rate control, for example 'quantizer 22' or 'variable, 6105000 bps'. */
  rateControl: string | null;
  /** The encode didn't finish in time (inconclusive, never a definite "missing"). */
  timedOut: boolean;
  error: string | null;
}

export interface AudioEncodeAttempt {
  codec: 'aac' | 'opus';
  bitrate: number;
  ok: boolean;
  packets: number;
  codecString: string | null;
  timedOut: boolean;
  error: string | null;
}

export interface AudioCodecOutcome {
  ok: boolean;
  /** The bitrate that produced packets (bits per second). */
  bitrate: number | null;
  codecString: string | null;
  attempts: AudioEncodeAttempt[];
}

export interface AudioEncodeResult {
  /** AudioEncoder exists. */
  webCodecs: boolean;
  aac: AudioCodecOutcome;
  /** Only tried when AAC fails. */
  opus: AudioCodecOutcome | null;
}

export interface DecodeEntry {
  key: 'h264-1080p' | 'h264-4k' | 'hevc-1080p' | 'hevc-main10-4k';
  label: string;
  codec: string;
  width: number;
  height: number;
  supported: boolean | null;
  error: string | null;
}

export interface DecodeResult {
  webCodecs: boolean;
  entries: DecodeEntry[];
}

/** Everything the render milestone needs to choose output settings. */
export interface RenderSupport {
  video: Record<RenderResolution, VideoEncodeResult>;
  audio: AudioEncodeResult;
}

export interface RenderDefaults {
  /** Which output sizes encode on this machine. */
  resolutions: Record<RenderResolution, boolean>;
  /**
   * The largest landscape size that encodes: '1080p', else '720p', else null (no MP4 video).
   * The render dialog may still default to 720p on slow machines (SPEC 10.1).
   */
  largestResolution: '1080p' | '720p' | null;
  /** 'aac' when it encodes; 'opus' as the fallback; null when neither does. */
  audioCodec: 'aac' | 'opus' | null;
  /** The bitrate (bits per second) confirmed by a real encode. */
  audioBitrate: number | null;
  /** Plain-language notes for the render dialog (720p only, Opus warning, ...). */
  notes: string[];
}

/** Decide render settings from probe results (SPEC 10.3). */
export function pickRenderDefaults(support: RenderSupport): RenderDefaults {
  const resolutions: Record<RenderResolution, boolean> = {
    '1080p': support.video['1080p'].ok,
    '720p': support.video['720p'].ok,
    square: support.video.square.ok,
  };
  const largestResolution = resolutions['1080p'] ? '1080p' : resolutions['720p'] ? '720p' : null;
  const notes: string[] = [];
  if (!largestResolution) {
    notes.push("MP4 export isn't available in this browser.");
  } else if (largestResolution === '720p') {
    notes.push("1080p isn't available on this computer, so renders are 720p only.");
  }

  let audioCodec: RenderDefaults['audioCodec'] = null;
  let audioBitrate: number | null = null;
  if (support.audio.aac.ok) {
    audioCodec = 'aac';
    audioBitrate = support.audio.aac.bitrate;
  } else if (support.audio.opus?.ok) {
    audioCodec = 'opus';
    audioBitrate = support.audio.opus.bitrate;
    notes.push(`Renders use Opus audio. ${QUICKTIME_OPUS_WARNING}`);
  } else {
    notes.push("Sound can't be added to MP4 files in this browser.");
  }
  return { resolutions, largestResolution, audioCodec, audioBitrate, notes };
}

const VIDEO_ROW_IDS: Record<RenderResolution, CheckId> = {
  '720p': 'avc-720p',
  '1080p': 'avc-1080p',
  square: 'avc-square',
};

function videoDetail(r: VideoEncodeResult): string {
  return [
    `${r.width}×${r.height}, ${r.frames} frames: ${r.packets} packets, MP4 ${formatBytes(r.bytes)}`,
    `WebCodecs VideoEncoder: ${r.webCodecs ? 'yes' : 'no'}; canEncodeVideo: ${
      r.configSupported === null ? 'not asked' : r.configSupported ? 'yes' : 'no'
    }`,
    r.codecString ? `Codec string: ${r.codecString}` : undefined,
    r.rateControl ? `Rate control: ${r.rateControl}` : undefined,
    r.timedOut ? 'The encode timed out.' : undefined,
    r.error ? `Error: ${r.error}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/** One export row per output size. */
export function assessVideoEncode(r: VideoEncodeResult): CapabilityCheck {
  const base = checkBase(VIDEO_ROW_IDS[r.resolution]);
  const detail = videoDetail(r);
  const size = RENDER_SIZES[r.resolution].label;
  if (r.ok) {
    return { ...base, status: 'pass', summary: `Can export ${size} MP4 video.`, detail };
  }
  if (r.timedOut) {
    return {
      ...base,
      status: 'warn',
      summary: `The ${size} export test didn't finish in time, so it's unconfirmed.`,
      detail,
    };
  }
  if (r.resolution === '720p') {
    return {
      ...base,
      status: 'fail',
      summary: r.webCodecs
        ? "Can't export MP4 video on this computer."
        : "Can't export MP4 video: this browser has no video encoder (WebCodecs).",
      detail,
    };
  }
  if (r.resolution === '1080p') {
    return {
      ...base,
      status: 'warn',
      summary: "1080p export isn't available here, so renders will be 720p only.",
      detail,
    };
  }
  return {
    ...base,
    status: 'warn',
    summary: "Square (1080×1080) export isn't available here.",
    detail,
  };
}

function audioAttemptLines(outcome: AudioCodecOutcome | null): string[] {
  if (!outcome) return [];
  return outcome.attempts.map(
    (a) =>
      `${a.codec.toUpperCase()} ${formatBitrate(a.bitrate)}: ${
        a.ok ? `ok, ${a.packets} packets${a.codecString ? `, ${a.codecString}` : ''}` : 'failed'
      }${a.timedOut ? ' (timed out)' : ''}${a.error && !a.ok ? ` (${a.error})` : ''}`,
  );
}

/** The MP4 audio row: AAC preferred, Opus the fallback (SPEC 10.3). */
export function assessAudioEncode(r: AudioEncodeResult): CapabilityCheck {
  const base = checkBase('audio-encode');
  const detail = [
    `WebCodecs AudioEncoder: ${r.webCodecs ? 'yes' : 'no'}; ${AUDIO_SAMPLE_RATE} Hz, ${AUDIO_CHANNELS} channels`,
    ...audioAttemptLines(r.aac),
    ...audioAttemptLines(r.opus),
  ].join('\n');
  if (r.aac.ok) {
    return {
      ...base,
      status: 'pass',
      summary: `Can export AAC audio at ${formatBitrate(r.aac.bitrate ?? 0)}, which plays everywhere.`,
      detail,
    };
  }
  if (r.opus?.ok) {
    return {
      ...base,
      status: 'warn',
      summary: `AAC isn't available, so renders will use Opus audio. ${QUICKTIME_OPUS_WARNING}`,
      detail,
    };
  }
  const timedOut = [...r.aac.attempts, ...(r.opus?.attempts ?? [])].some((a) => a.timedOut);
  if (timedOut) {
    return {
      ...base,
      status: 'warn',
      summary: "The audio export test didn't finish in time, so it's unconfirmed.",
      detail,
    };
  }
  return {
    ...base,
    status: 'fail',
    summary: "Can't add sound to MP4 files in this browser (neither AAC nor Opus encodes).",
    detail,
  };
}

function decodeLine(e: DecodeEntry): string {
  const state = e.supported === null ? 'unknown' : e.supported ? 'yes' : 'no';
  return `${e.label} (${e.codec}, ${e.width}×${e.height}): ${state}${e.error ? ` (${e.error})` : ''}`;
}

/** Clip import rows: H.264 (required) and HEVC (optional, with the iPhone guidance). */
export function assessDecode(r: DecodeResult): CapabilityCheck[] {
  const find = (key: DecodeEntry['key']) => r.entries.find((e) => e.key === key);
  const detailFor = (keys: DecodeEntry['key'][]) =>
    [
      `WebCodecs VideoDecoder: ${r.webCodecs ? 'yes' : 'no'}`,
      ...keys
        .map((k) => find(k))
        .filter((e): e is DecodeEntry => !!e)
        .map(decodeLine),
    ].join('\n');

  const h264Base = checkBase('h264-decode');
  const h264Detail = detailFor(['h264-1080p', 'h264-4k']);
  const hd = find('h264-1080p');
  const uhd = find('h264-4k');
  let h264: CapabilityCheck;
  if (hd?.supported === true && uhd?.supported === true) {
    h264 = {
      ...h264Base,
      status: 'pass',
      summary: 'Can read H.264 clips (the usual MP4 format), up to 4K.',
      detail: h264Detail,
    };
  } else if (hd?.supported === true) {
    h264 = {
      ...h264Base,
      status: 'warn',
      summary: 'Can read H.264 clips up to 1080p; 4K clips may not open.',
      detail: h264Detail,
    };
  } else if (hd?.supported === false) {
    h264 = {
      ...h264Base,
      status: 'fail',
      summary: "Can't read H.264 clips in this browser.",
      detail: h264Detail,
    };
  } else {
    h264 = {
      ...h264Base,
      status: 'warn',
      summary: "H.264 clip support couldn't be checked.",
      detail: h264Detail,
    };
  }

  const hevcBase = checkBase('hevc-decode');
  const hevcDetail = detailFor(['hevc-1080p', 'hevc-main10-4k']);
  const hevc = find('hevc-1080p');
  const hevcHdr = find('hevc-main10-4k');
  let hevcRow: CapabilityCheck;
  if (hevc?.supported === true) {
    hevcRow = {
      ...hevcBase,
      status: 'pass',
      summary:
        hevcHdr?.supported === true
          ? 'Can read HEVC clips (the iPhone "High Efficiency" format), including 10-bit HDR.'
          : 'Can read HEVC clips (the iPhone "High Efficiency" format).',
      detail: hevcDetail,
    };
  } else {
    hevcRow = {
      ...hevcBase,
      status: 'warn',
      summary: `Can't read HEVC clips (the iPhone "High Efficiency" format). ${HEVC_GUIDANCE}`,
      detail: hevcDetail,
    };
  }
  return [h264, hevcRow];
}
