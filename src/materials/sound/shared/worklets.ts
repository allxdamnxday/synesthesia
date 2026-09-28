/**
 * AudioWorklet loading (SPEC 9.1: "AudioWorklet modules are self-hosted and loaded via
 * ctx.audioWorklet.addModule(); works in both context types").
 *
 * How to add a processor for a new material:
 * 1. Write a plain JS module `something.worklet.js` next to the material (no imports; ESLint
 *    already knows the AudioWorkletGlobalScope globals). Keep it deterministic.
 * 2. Import its URL with `import url from './something.worklet.js?url&no-inline'`.
 *    `?url` makes Vite serve it in dev and emit it as a hashed file in the build (resolved
 *    relative to the bundle, so the relative base works on any host); `no-inline` stops
 *    Vite from inlining small files as data: URLs.
 * 3. In the material's `build()`, `await loadWorklet(ctx, url)` before creating
 *    `new AudioWorkletNode(ctx, 'processor-name')`.
 *
 * Loading is cached per context, so several materials (or several instances) share one
 * `addModule` call.
 */
import onePoleUrl from './processors/onePole.worklet.js?url&no-inline';

const loaded = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

/** Load a worklet module into a context once; later calls reuse the same promise. */
export function loadWorklet(ctx: BaseAudioContext, url: string): Promise<void> {
  let perContext = loaded.get(ctx);
  if (!perContext) {
    perContext = new Map();
    loaded.set(ctx, perContext);
  }
  const existing = perContext.get(url);
  if (existing) return existing;
  const promise = ctx.audioWorklet.addModule(url).catch((err: unknown) => {
    // Let a later call retry (e.g. after a transient failure).
    perContext.delete(url);
    throw err instanceof Error ? err : new Error(String(err));
  });
  perContext.set(url, promise);
  return promise;
}

/** Processor name registered by the example one-pole worklet. */
export const ONE_POLE_PROCESSOR = 'sp-one-pole';
export const ONE_POLE_WORKLET_URL: string = onePoleUrl;

/**
 * Example: a one-pole smoother running in an AudioWorklet. `timeConstant` (seconds) is a
 * k-rate AudioParam. The node posts `{ type: 'running' }` on its port the first time it runs.
 */
export async function createOnePoleSmoother(
  ctx: BaseAudioContext,
  timeConstant = 0.01,
): Promise<AudioWorkletNode> {
  await loadWorklet(ctx, ONE_POLE_WORKLET_URL);
  const node = new AudioWorkletNode(ctx, ONE_POLE_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  node.parameters.get('timeConstant')?.setValueAtTime(timeConstant, 0);
  return node;
}
