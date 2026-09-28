/**
 * Runs an AudioWorklet processor file in Node for unit tests. The file is evaluated in a fresh
 * VM context that provides the AudioWorkletGlobalScope names (AudioWorkletProcessor,
 * registerProcessor, sampleRate, currentTime, currentFrame); `run` then drives the processor
 * block by block (128 frames) the way Chrome does:
 *
 * - k-rate parameters are one value per block (the value at the block's first frame);
 * - a-rate parameters are a one-value array when constant over the block, else 128 values.
 *
 * Parameter automation is given as step changes at sample indices, which is what
 * `setValueAtTime` produces.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export const BLOCK = 128;

export interface ParamDescriptor {
  name: string;
  defaultValue: number;
  automationRate: 'a-rate' | 'k-rate';
}

export interface FakePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(data: unknown): void;
}

export interface WorkletProcessor {
  port: FakePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

export interface ProcessorClass {
  new (): WorkletProcessor;
  readonly parameterDescriptors: ParamDescriptor[];
}

/** Evaluate a worklet file and return the processor class it registers under `name`. */
export function loadProcessor(file: string, name: string, sampleRate = 48000): ProcessorClass {
  const code = readFileSync(file, 'utf8');
  const registered = new Map<string, ProcessorClass>();
  class FakeProcessor {
    port: FakePort = { onmessage: null, postMessage: () => undefined };
  }
  runInNewContext(code, {
    AudioWorkletProcessor: FakeProcessor,
    registerProcessor: (n: string, cls: ProcessorClass) => registered.set(n, cls),
    sampleRate,
    currentTime: 0,
    currentFrame: 0,
  });
  const cls = registered.get(name);
  if (!cls) throw new Error(`${file} did not register "${name}"`);
  return cls;
}

/** Step changes of one parameter: [sample index, value] pairs in time order. */
export type Steps = readonly (readonly [number, number])[];

export interface RunOptions {
  /** Total frames to render. */
  frames: number;
  /** Output channels (default 2). */
  channels?: number;
  /** Parameter automation as step changes; parameters not listed keep their defaults. */
  params?: Record<string, Steps>;
  /** Mono input signal (default: no input connected). */
  input?: Float32Array;
  /** Called before each block with its first frame (to post messages, for example). */
  beforeBlock?: (frame: number, processor: WorkletProcessor) => void;
}

/** Render a processor; returns one Float32Array per output channel. */
export function run(
  cls: ProcessorClass,
  options: RunOptions,
  processor = new cls(),
): Float32Array[] {
  const channels = options.channels ?? 2;
  const out = Array.from({ length: channels }, () => new Float32Array(options.frames));
  const descriptors = cls.parameterDescriptors;
  const steps = options.params ?? {};
  // Current value of each parameter, and the index of its next pending step.
  const value = new Map<string, number>();
  const next = new Map<string, number>();
  for (const d of descriptors) {
    value.set(d.name, d.defaultValue);
    next.set(d.name, 0);
  }
  const valueAtFrame = (d: ParamDescriptor, frame: number): number => {
    const list = steps[d.name] ?? [];
    let v = value.get(d.name) ?? d.defaultValue;
    let i = next.get(d.name) ?? 0;
    while (i < list.length && (list[i]?.[0] ?? Infinity) <= frame) {
      v = list[i]?.[1] ?? v;
      i++;
    }
    value.set(d.name, v);
    next.set(d.name, i);
    return v;
  };

  for (let start = 0; start < options.frames; start += BLOCK) {
    options.beforeBlock?.(start, processor);
    const parameters: Record<string, Float32Array> = {};
    for (const d of descriptors) {
      const first = valueAtFrame(d, start);
      const list = steps[d.name] ?? [];
      const pending = next.get(d.name) ?? 0;
      const changesInBlock =
        d.automationRate === 'a-rate' &&
        pending < list.length &&
        (list[pending]?.[0] ?? Infinity) < start + BLOCK;
      if (changesInBlock) {
        const values = new Float32Array(BLOCK);
        values[0] = first;
        for (let s = 1; s < BLOCK; s++) values[s] = valueAtFrame(d, start + s);
        parameters[d.name] = values;
      } else {
        parameters[d.name] = Float32Array.of(first);
      }
    }
    const outputs = [Array.from({ length: channels }, () => new Float32Array(BLOCK))];
    const inputs: Float32Array[][] = options.input
      ? [[options.input.subarray(start, start + BLOCK)]]
      : [[]];
    if (options.input && (inputs[0]?.[0]?.length ?? 0) < BLOCK) {
      const padded = new Float32Array(BLOCK);
      padded.set(inputs[0]?.[0] ?? new Float32Array(0));
      inputs[0] = [padded];
    }
    processor.process(inputs, outputs, parameters);
    const n = Math.min(BLOCK, options.frames - start);
    for (let c = 0; c < channels; c++)
      out[c]?.set((outputs[0]?.[c] ?? new Float32Array(BLOCK)).subarray(0, n), start);
  }
  return out;
}

/** RMS of samples [from, to) of one channel. */
export function rmsOf(data: Float32Array, from = 0, to = data.length): number {
  let acc = 0;
  for (let i = from; i < to; i++) acc += (data[i] ?? 0) ** 2;
  return Math.sqrt(acc / Math.max(1, to - from));
}

/** Largest absolute sample of [from, to). */
export function peakOf(data: Float32Array, from = 0, to = data.length): number {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(data[i] ?? 0));
  return p;
}

/**
 * Fundamental frequency of [from, to) by normalized autocorrelation, searching periods for
 * fmin–fmax Hz, with parabolic interpolation of the peak.
 */
export function pitchOf(
  data: Float32Array,
  sampleRate: number,
  from: number,
  to: number,
  fmin = 50,
  fmax = 2000,
): number {
  const lagMin = Math.floor(sampleRate / fmax);
  const lagMax = Math.ceil(sampleRate / fmin);
  const n = to - from - lagMax;
  const corr = (lag: number): number => {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = from; i < from + n; i++) {
      const a = data[i] ?? 0;
      const b = data[i + lag] ?? 0;
      ab += a * b;
      aa += a * a;
      bb += b * b;
    }
    return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
  };
  const values: number[] = [];
  for (let lag = lagMin; lag <= lagMax; lag++) values.push(corr(lag));
  // The first peak above 90% of the best one (avoids octave errors on a clean tone).
  const best = Math.max(...values);
  let index = values.findIndex(
    (v, i) => v >= 0.9 * best && v >= (values[i - 1] ?? -1) && v >= (values[i + 1] ?? -1),
  );
  if (index < 0) index = values.indexOf(best);
  const a = values[index - 1] ?? values[index] ?? 0;
  const b = values[index] ?? 0;
  const c = values[index + 1] ?? values[index] ?? 0;
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return sampleRate / (lagMin + index + shift);
}
