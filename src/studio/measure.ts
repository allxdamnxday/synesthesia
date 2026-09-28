/**
 * First Studio open (SPEC 14.2): measure this computer once and remember the result, so
 * "Automatic" preview quality picks the most detailed tier it shows smoothly. The
 * benchmark runs on a canvas the size of the preview, placed where the preview goes, so
 * the measured frames include compositing, at the Standard pixel ratio (the middle of the
 * preview's range; High previews may use a little more).
 */
import { updateSettings, type BenchmarkResult } from '../library';
import type { Quality } from '../materials/types';
import { releaseVisualContext } from '../materials/visual/shared/gl';
import { runQualityBenchmark } from '../perf/benchmark';
import { backingSize, fitAspect } from './layout';

export async function measureThisComputer(
  host: HTMLElement,
  aspect: number,
  signal?: AbortSignal,
): Promise<Quality> {
  const rect = host.getBoundingClientRect();
  const box = fitAspect(rect.width, rect.height, aspect);
  const size = backingSize(box.width, box.height, window.devicePixelRatio, 'standard');
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    display: 'block',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  host.append(canvas);
  try {
    const result = await runQualityBenchmark(canvas, { durationMs: 3000, signal });
    const stored: BenchmarkResult = {
      tier: result.tier,
      fpsByTier: result.fpsByTier,
      measuredAt: new Date().toISOString(),
    };
    await updateSettings({ benchmark: stored });
    return result.tier;
  } finally {
    const gl = canvas.getContext('webgl2');
    if (gl) releaseVisualContext(gl);
    canvas.remove();
  }
}
