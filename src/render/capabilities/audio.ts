/**
 * Web Audio + AudioWorklet probe (SPEC 14.1).
 *
 * Renders a few blocks in an OfflineAudioContext through a tiny self-hosted worklet
 * (`public/worklets/diagnostic-processor.js`) that outputs a constant, then checks the
 * rendered samples. No realtime AudioContext is created, so nothing trips the autoplay
 * policy and nothing is heard.
 */
import { checkBase } from './definitions';
import type { CapabilityCheck } from './types';
import { errorMessage, TimeoutError, withTimeout } from './util';

export const DIAGNOSTIC_PROCESSOR_NAME = 'sp-diagnostic-constant';
export const DIAGNOSTIC_VALUE = 0.25;
const SAMPLE_RATE = 48_000;
const RENDER_FRAMES = 128 * 16;

export interface AudioProbe {
  /** An AudioContext or OfflineAudioContext constructor exists. */
  webAudio: boolean;
  /** AudioWorkletNode exists and contexts expose `audioWorklet`. */
  audioWorklet: boolean;
  /** The processor module loaded (null when not attempted). */
  moduleLoaded: boolean | null;
  /** The rendered output matched the processor's constant (null when not rendered). */
  outputOk: boolean | null;
  /** Observed sample value near the end of the render. */
  observedValue: number | null;
  sampleRate: number;
  /** Which step failed, if any. */
  failure: 'missing-web-audio' | 'missing-worklet' | 'module-load' | 'render' | 'unexpected' | null;
  error: string | null;
  workletUrl: string;
  secureContext: boolean;
}

/** The processor's URL. The app is built with a relative base, so resolve against the document. */
export function defaultWorkletUrl(): string {
  return new URL('worklets/diagnostic-processor.js', document.baseURI).href;
}

/** Probe Web Audio and AudioWorklet. Never throws. */
export async function probeAudio(
  options: { workletUrl?: string; timeoutMs?: number } = {},
): Promise<AudioProbe> {
  const secure = typeof isSecureContext === 'boolean' ? isSecureContext : false;
  const probe: AudioProbe = {
    webAudio: false,
    audioWorklet: false,
    moduleLoaded: null,
    outputOk: null,
    observedValue: null,
    sampleRate: SAMPLE_RATE,
    failure: null,
    error: null,
    workletUrl: '',
    secureContext: secure,
  };
  const timeoutMs = options.timeoutMs ?? 8000;
  try {
    probe.workletUrl = options.workletUrl ?? defaultWorkletUrl();
    probe.webAudio =
      typeof OfflineAudioContext === 'function' || typeof AudioContext === 'function';
    if (!probe.webAudio || typeof OfflineAudioContext !== 'function') {
      probe.failure = 'missing-web-audio';
      return probe;
    }
    const context = new OfflineAudioContext({
      numberOfChannels: 2,
      length: RENDER_FRAMES,
      sampleRate: SAMPLE_RATE,
    });
    probe.audioWorklet =
      typeof AudioWorkletNode === 'function' &&
      'audioWorklet' in context &&
      context.audioWorklet !== undefined;
    if (!probe.audioWorklet) {
      probe.failure = 'missing-worklet';
      return probe;
    }

    try {
      await withTimeout(context.audioWorklet.addModule(probe.workletUrl), timeoutMs, 'addModule');
      probe.moduleLoaded = true;
    } catch (error) {
      probe.moduleLoaded = false;
      probe.failure = error instanceof TimeoutError ? 'unexpected' : 'module-load';
      probe.error = errorMessage(error);
      return probe;
    }

    const node = new AudioWorkletNode(context, DIAGNOSTIC_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { value: DIAGNOSTIC_VALUE },
    });
    node.connect(context.destination);

    let rendered: AudioBuffer;
    try {
      rendered = await withTimeout(context.startRendering(), timeoutMs, 'startRendering');
    } catch (error) {
      probe.failure = error instanceof TimeoutError ? 'unexpected' : 'render';
      probe.error = errorMessage(error);
      return probe;
    }

    // Check the second half of the render in both channels (the first block may be silent
    // on implementations that start worklet nodes one quantum late).
    let ok = rendered.numberOfChannels === 2 && rendered.length === RENDER_FRAMES;
    for (let c = 0; c < rendered.numberOfChannels && ok; c++) {
      const data = rendered.getChannelData(c);
      for (let i = RENDER_FRAMES / 2; i < RENDER_FRAMES; i++) {
        if (Math.abs((data[i] ?? 0) - DIAGNOSTIC_VALUE) > 1e-6) {
          ok = false;
          break;
        }
      }
    }
    probe.observedValue = rendered.getChannelData(0)[RENDER_FRAMES - 1] ?? null;
    probe.outputOk = ok;
    if (!ok) probe.failure = 'render';
  } catch (error) {
    probe.failure = 'unexpected';
    probe.error = errorMessage(error);
  }
  return probe;
}

const SECURE_HINT =
  'This page is not a secure context, which hides AudioWorklet. Open the instrument from its https:// address (or localhost).';

/**
 * The Web Audio + AudioWorklet row. Only definite negatives fail (missing APIs, wrong
 * output); a module that didn't load or a hung render is a warning, since it can be a
 * transient network or browser problem rather than a missing capability.
 */
export function assessAudio(probe: AudioProbe): CapabilityCheck {
  const base = checkBase('audio-worklet');
  const facts = [
    `Web Audio: ${probe.webAudio ? 'yes' : 'no'}; AudioWorklet: ${probe.audioWorklet ? 'yes' : 'no'}`,
    probe.moduleLoaded !== null
      ? `Processor module: ${probe.moduleLoaded ? 'loaded' : 'failed'} (${probe.workletUrl})`
      : undefined,
    probe.outputOk !== null
      ? `Offline render at ${probe.sampleRate} Hz: ${probe.outputOk ? 'ok' : 'wrong output'} (last sample ${
          probe.observedValue ?? '?'
        }, expected ${DIAGNOSTIC_VALUE})`
      : undefined,
    probe.error ? `Error: ${probe.error}` : undefined,
    !probe.secureContext ? SECURE_HINT : undefined,
  ]
    .filter(Boolean)
    .join('\n');

  switch (probe.failure) {
    case null:
      return {
        ...base,
        status: 'pass',
        summary: 'Web Audio and AudioWorklet work.',
        detail: facts,
      };
    case 'missing-web-audio':
      return {
        ...base,
        status: 'fail',
        summary: "Web Audio isn't available, so the sound materials can't play.",
        detail: facts,
      };
    case 'missing-worklet':
      return {
        ...base,
        status: 'fail',
        summary: probe.secureContext
          ? "AudioWorklet isn't available, so some sound materials can't play."
          : "AudioWorklet isn't available because the page isn't opened from a secure (https) address.",
        detail: facts,
      };
    case 'render':
      return {
        ...base,
        status: 'fail',
        summary: "AudioWorklet runs but doesn't produce the expected sound.",
        detail: facts,
      };
    case 'module-load':
      return {
        ...base,
        status: 'warn',
        summary:
          "The sound test module didn't load. Reload the page; if this keeps happening, send the report.",
        detail: facts,
      };
    case 'unexpected':
      return {
        ...base,
        status: 'warn',
        summary: "The sound check couldn't finish.",
        detail: facts,
      };
  }
}
