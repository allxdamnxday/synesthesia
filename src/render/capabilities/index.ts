/**
 * Capability checks (SPEC 10.3, 14.1): public surface.
 *
 * Importing this module never loads Mediabunny; the codec probes are loaded on demand.
 * The render milestone should call `getRenderDefaults()` to choose the output sizes and
 * the audio codec and bitrate (see `RenderDefaults`).
 */
import type { RenderDefaults, RenderSupport } from './codecAssess';
import type { RenderProbeEvent } from './codecs';

export type * from './types';
export {
  CHECK_DEFINITIONS,
  GROUP_LABELS,
  STARTUP_CHECK_IDS,
  checkBase,
  type CheckDefinition,
} from './definitions';
export {
  blockingFailures,
  inconclusiveCheck,
  mergeChecks,
  pendingChecks,
  runAllChecks,
  runStartupChecks,
  type AllChecksResult,
  type RunAllOptions,
} from './runChecks';
export {
  environmentRows,
  formatReport,
  summarizeChecks,
  type CheckSummary,
  type LabelledValue,
  type ReportInput,
} from './report';
export { collectEnvironment, isChromiumBrowser } from './environment';
export {
  assessWebGL,
  formatFloatMatrix,
  probeWebGL,
  type FloatFormatResult,
  type WebGLProbe,
  type WebGLProbeOptions,
} from './webgl';
export { assessAudio, probeAudio, type AudioProbe } from './audio';
export { assessStorage, probeStorage, type StorageProbe } from './storage';
export {
  AAC_BITRATES,
  OPUS_BITRATES,
  QUICKTIME_OPUS_WARNING,
  RENDER_SIZES,
  pickRenderDefaults,
  type AudioEncodeResult,
  type DecodeResult,
  type RenderDefaults,
  type RenderResolution,
  type RenderSupport,
  type VideoEncodeResult,
} from './codecAssess';

/**
 * What the render dialog should offer on this machine: available sizes, the audio codec
 * ('aac' or the 'opus' fallback) and the bitrate confirmed by a real encode, plus
 * plain-language notes. The probe runs once per page load (Diagnostics refreshes it).
 */
export async function getRenderDefaults(
  options: { fresh?: boolean } = {},
): Promise<RenderDefaults> {
  const codecs = await import('./codecs');
  return codecs.getRenderDefaults(options);
}

/** The raw real-encode results behind {@link getRenderDefaults}. */
export async function probeRenderSupport(
  options: { fresh?: boolean; onResult?: (event: RenderProbeEvent) => void } = {},
): Promise<RenderSupport> {
  const codecs = await import('./codecs');
  return codecs.probeRenderSupport(options);
}
