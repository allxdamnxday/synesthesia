/**
 * Runs capability checks for the startup gate and the Diagnostics screen (SPEC 14.1).
 *
 * - `runStartupChecks()`: the required, fast checks only (WebGL2, half-float targets with
 *   linear filtering, Web Audio + AudioWorklet).
 * - `runAllChecks()`: everything, progressively; quick checks first, the real encodes last.
 *
 * A probe that throws unexpectedly becomes a warning, never a failure, so Chrome is never
 * blocked by a bug in a check. Only required checks with a definite 'fail' block startup.
 */
import { assessAudio, probeAudio } from './audio';
import { assessAudioEncode, assessDecode, assessVideoEncode } from './codecAssess';
import type { RenderSupport } from './codecAssess';
import { CHECK_DEFINITIONS, checkBase, pendingCheck, STARTUP_CHECK_IDS } from './definitions';
import { collectEnvironment } from './environment';
import { assessStorage, probeStorage } from './storage';
import type { CapabilityCheck, CheckId, EnvironmentInfo, GpuInfo } from './types';
import { errorMessage } from './util';
import { assessWebGL, probeWebGL } from './webgl';

/** Codec probes import Mediabunny; load them only when needed. */
const loadCodecs = () => import('./codecs');

/** Every check in Diagnostics order, all pending. */
export function pendingChecks(ids?: readonly CheckId[]): CapabilityCheck[] {
  const wanted = ids ?? CHECK_DEFINITIONS.map((d) => d.id);
  return CHECK_DEFINITIONS.filter((d) => wanted.includes(d.id)).map((d) => pendingCheck(d.id));
}

/** Replace rows by id, keeping the existing order; unknown ids are appended. */
export function mergeChecks(
  current: readonly CapabilityCheck[],
  updates: readonly CapabilityCheck[],
): CapabilityCheck[] {
  const next = [...current];
  for (const update of updates) {
    const index = next.findIndex((c) => c.id === update.id);
    if (index >= 0) next[index] = update;
    else next.push(update);
  }
  return next;
}

/** A check whose probe threw: a warning with the error as detail, never a failure. */
export function inconclusiveCheck(id: CheckId, error: unknown): CapabilityCheck {
  return {
    ...checkBase(id),
    status: 'warn',
    summary: "This check couldn't finish.",
    detail: `Unexpected error: ${errorMessage(error)}`,
  };
}

/** Required checks that definitely failed. Only these block the app at startup. */
export function blockingFailures(checks: readonly CapabilityCheck[]): CapabilityCheck[] {
  return checks.filter((c) => c.importance === 'required' && c.status === 'fail');
}

/** Run a probe and assess it; if either throws, the rows become inconclusive warnings. */
async function checked<T>(
  ids: readonly CheckId[],
  probe: () => Promise<T>,
  assess: (result: T) => CapabilityCheck[],
): Promise<CapabilityCheck[]> {
  try {
    return assess(await probe());
  } catch (error) {
    return ids.map((id) => inconclusiveCheck(id, error));
  }
}

/** The required checks, quickly (a few tiny WebGL draws and one offline audio render). */
export async function runStartupChecks(): Promise<CapabilityCheck[]> {
  const [graphics, sound] = await Promise.all([
    checked(
      ['webgl2', 'float-targets'],
      () => probeWebGL({ scope: 'startup' }),
      (probe) => assessWebGL(probe),
    ),
    checked(
      ['audio-worklet'],
      () => probeAudio(),
      (probe) => [assessAudio(probe)],
    ),
  ]);
  return mergeChecks(pendingChecks(STARTUP_CHECK_IDS), [...graphics, ...sound]);
}

export interface AllChecksResult {
  checks: CapabilityCheck[];
  environment: EnvironmentInfo | null;
  /** Real-encode results for the render dialog; null if the encodes didn't run. */
  renderSupport: RenderSupport | null;
}

export interface RunAllOptions {
  /** Called once the environment block is known (before the slow encode checks). */
  onEnvironment?: (environment: EnvironmentInfo) => void;
  /** Stop early (for example when Diagnostics closes). Rows stop updating. */
  signal?: AbortSignal;
}

const ENCODE_IDS: readonly CheckId[] = ['avc-720p', 'avc-1080p', 'avc-square', 'audio-encode'];

/**
 * Every check, reporting rows through `onUpdate` as they finish (the first call has every
 * row pending). Quick checks run first; the real encodes run last, one at a time.
 */
export async function runAllChecks(
  onUpdate: (checks: CapabilityCheck[]) => void,
  options: RunAllOptions = {},
): Promise<AllChecksResult> {
  const { signal } = options;
  let checks = pendingChecks();
  let environment: EnvironmentInfo | null = null;
  let renderSupport: RenderSupport | null = null;
  const publish = (rows: readonly CapabilityCheck[]) => {
    checks = mergeChecks(checks, rows);
    if (!signal?.aborted) onUpdate(checks);
  };
  const result = (): AllChecksResult => ({
    checks: checks.map((c) =>
      c.status === 'pending' ? inconclusiveCheck(c.id, 'the run was stopped') : c,
    ),
    environment,
    renderSupport,
  });
  onUpdate(checks);

  // Graphics first: its GPU strings feed the environment block.
  const graphics: { gpu: GpuInfo | null } = { gpu: null };
  publish(
    await checked(
      ['webgl2', 'float-targets', 'float-formats'],
      async () => {
        const probe = await probeWebGL({ scope: 'full' });
        graphics.gpu = probe.gpu;
        return probe;
      },
      assessWebGL,
    ),
  );
  if (signal?.aborted) return result();

  await Promise.all([
    // Without WebGL2's strings, the environment reads the GPU through WebGL 1 if it can.
    collectEnvironment(graphics.gpu ? { gpu: graphics.gpu } : {})
      .then((env) => {
        environment = env;
        if (!signal?.aborted) options.onEnvironment?.(env);
      })
      .catch(() => undefined),
    checked(
      ['audio-worklet'],
      () => probeAudio(),
      (probe) => [assessAudio(probe)],
    ).then(publish),
    checked(
      ['folder-saving', 'persistent-storage', 'storage-space'],
      () => probeStorage(),
      assessStorage,
    ).then(publish),
    checked(
      ['h264-decode', 'hevc-decode'],
      async () => (await loadCodecs()).probeDecode(),
      assessDecode,
    ).then(publish),
  ]);
  if (signal?.aborted) return result();

  // The expensive part: tiny real encodes at each size, then audio.
  try {
    const codecs = await loadCodecs();
    renderSupport = await codecs.probeRenderSupport({
      fresh: true,
      onResult: (event) =>
        publish([
          event.kind === 'video'
            ? assessVideoEncode(event.result)
            : assessAudioEncode(event.result),
        ]),
    });
  } catch (error) {
    publish(
      ENCODE_IDS.filter((id) => checks.find((c) => c.id === id)?.status === 'pending').map((id) =>
        inconclusiveCheck(id, error),
      ),
    );
  }
  return result();
}
