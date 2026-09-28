/**
 * Measurements for auditioning sound materials without ears: RMS and jump envelopes, a YIN
 * pitch tracker, hashing, and WAV encoding. Harness-only code.
 */

export interface Envelopes {
  hopSec: number;
  /** RMS of the mono mix per hop. */
  rms: number[];
  /** Largest sample-to-sample jump (either channel) per hop. */
  jump: number[];
  /**
   * Largest second difference |x[n] − 2x[n−1] + x[n−2]| (either channel) per hop. Smooth
   * tones keep this small; a click (a step in the waveform) shows up as a spike.
   */
  click: number[];
}

/** In-place radix-2 FFT (re, im of length 2^n). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const xi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * Spectral centroid (Hz) of the mono mix per hop, from 2048-point Hann-windowed frames
 * (0 where the frame is near-silent). Higher means brighter.
 */
export function spectralCentroid(
  channels: readonly Float32Array[],
  sampleRate: number,
  hopSec = 0.01,
  minRms = 0.003,
): number[] {
  const mono = monoMix(channels);
  const size = 2048;
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const frames = Math.floor(mono.length / hop);
  const out: number[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    const start = Math.round(f * hop + hop / 2 - size / 2);
    let energy = 0;
    for (let i = 0; i < size; i++) {
      const x = mono[start + i] ?? 0;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      re[i] = x * w;
      im[i] = 0;
      energy += x * x;
    }
    if (Math.sqrt(energy / size) < minRms) {
      out.push(0);
      continue;
    }
    fft(re, im);
    let num = 0;
    let den = 0;
    for (let k = 1; k < size / 2; k++) {
      const mag = Math.hypot(re[k] ?? 0, im[k] ?? 0);
      num += mag * ((k * sampleRate) / size);
      den += mag;
    }
    out.push(den > 0 ? num / den : 0);
  }
  return out;
}

export function monoMix(channels: readonly Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (const data of channels) {
    for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) + (data[i] ?? 0) / channels.length;
  }
  return out;
}

export function envelopes(
  channels: readonly Float32Array[],
  sampleRate: number,
  hopSec = 0.01,
): Envelopes {
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const mono = monoMix(channels);
  const frames = Math.floor(mono.length / hop);
  const rms: number[] = [];
  const jump: number[] = [];
  const click: number[] = [];
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    let maxJump = 0;
    let maxClick = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const m = mono[i] ?? 0;
      acc += m * m;
      for (const data of channels) {
        if (i > 0) {
          const j = Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0));
          if (j > maxJump) maxJump = j;
        }
        if (i > 1) {
          const c = Math.abs((data[i] ?? 0) - 2 * (data[i - 1] ?? 0) + (data[i - 2] ?? 0));
          if (c > maxClick) maxClick = c;
        }
      }
    }
    rms.push(Math.sqrt(acc / hop));
    jump.push(maxJump);
    click.push(maxClick);
  }
  return { hopSec: hop / sampleRate, rms, jump, click };
}

export function overallRms(channels: readonly Float32Array[]): number {
  let acc = 0;
  let n = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) acc += (data[i] ?? 0) * (data[i] ?? 0);
    n += data.length;
  }
  return n > 0 ? Math.sqrt(acc / n) : 0;
}

export function peak(channels: readonly Float32Array[]): number {
  let p = 0;
  for (const data of channels)
    for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i] ?? 0));
  return p;
}

/**
 * YIN fundamental-frequency tracker (de Cheveigné & Kawahara 2002) on the mono mix,
 * decimated by 2. Returns Hz per hop (0 where unvoiced or too quiet).
 */
export function pitchTrack(
  channels: readonly Float32Array[],
  sampleRate: number,
  opts: { hopSec?: number; fmin?: number; fmax?: number; threshold?: number; minRms?: number } = {},
): number[] {
  const hopSec = opts.hopSec ?? 0.01;
  const mono = monoMix(channels);
  // Decimate by 2 with a two-tap average (enough anti-aliasing for fundamentals < 3 kHz).
  const sr = sampleRate / 2;
  const x = new Float32Array(Math.floor(mono.length / 2));
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * ((mono[2 * i] ?? 0) + (mono[2 * i + 1] ?? 0));
  const hop = Math.max(1, Math.round(hopSec * sr));
  const win = 1024;
  const tauMin = Math.max(2, Math.floor(sr / (opts.fmax ?? 2500)));
  const tauMax = Math.min(win - 1, Math.ceil(sr / (opts.fmin ?? 70)));
  const threshold = opts.threshold ?? 0.15;
  const minRms = opts.minRms ?? 0.003;
  const d = new Float64Array(tauMax + 2);
  const out: number[] = [];
  const frames = Math.floor(x.length / hop);
  for (let f = 0; f < frames; f++) {
    // Centre the analysis window on the hop.
    const start = Math.round(f * hop + hop / 2 - win / 2);
    if (start < 0 || start + win + tauMax + 1 >= x.length) {
      out.push(0);
      continue;
    }
    let energy = 0;
    for (let j = 0; j < win; j++) energy += (x[start + j] ?? 0) ** 2;
    if (Math.sqrt(energy / win) < minRms) {
      out.push(0);
      continue;
    }
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let acc = 0;
      for (let j = 0; j < win; j++) {
        const diff = (x[start + j] ?? 0) - (x[start + j + tau] ?? 0);
        acc += diff * diff;
      }
      d[tau] = acc;
    }
    // Cumulative mean normalized difference.
    let running = 0;
    const cmnd = new Float64Array(tauMax + 2);
    cmnd[0] = 1;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      running += d[tau] ?? 0;
      cmnd[tau] = running > 0 ? ((d[tau] ?? 0) * tau) / running : 1;
    }
    let tauEst = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if ((cmnd[tau] ?? 1) < threshold) {
        while (tau + 1 <= tauMax && (cmnd[tau + 1] ?? 1) < (cmnd[tau] ?? 1)) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst < 0) {
      out.push(0);
      continue;
    }
    // Parabolic interpolation.
    const a = cmnd[tauEst - 1] ?? 0;
    const b = cmnd[tauEst] ?? 0;
    const c = cmnd[tauEst + 1] ?? 0;
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const refined = tauEst + Math.max(-1, Math.min(1, shift));
    out.push(sr / refined);
  }
  return out;
}

/** Median of the non-zero values in [from, to) (0 if none). */
export function medianVoiced(values: readonly number[], from: number, to: number): number {
  const picked = values.slice(Math.max(0, from), Math.max(0, to)).filter((v) => v > 0);
  if (picked.length === 0) return 0;
  picked.sort((p, q) => p - q);
  return picked[Math.floor(picked.length / 2)] ?? 0;
}

/** SHA-256 hex of the raw float32 bytes of every channel, in order. */
export async function hashChannels(channels: readonly Float32Array[]): Promise<string> {
  const total = channels.reduce((n, c) => n + c.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const data of channels) {
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
    offset += data.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 16-bit PCM WAV for listening and download. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  const numCh = channels.length;
  const n = channels[0]?.length ?? 0;
  const dataBytes = n * numCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      view.setInt16(off, Math.round(v * 32767), true);
      off += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Pearson correlation of two equal-length series. */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] ?? 0;
    mb += b[i] ?? 0;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - ma;
    const db = (b[i] ?? 0) - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
