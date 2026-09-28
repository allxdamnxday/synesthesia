/**
 * The preview quality tier (SPEC 14.2). "Automatic" uses the benchmark stored in settings;
 * with no stored benchmark the Studio measures this computer once, on first open.
 */
import type { AppSettings } from '../library';
import type { Quality } from '../materials/types';

/** The tier to preview at, or null when this computer still has to be measured. */
export function resolvePreviewQuality(
  settings: Pick<AppSettings, 'previewQuality' | 'benchmark'>,
): Quality | null {
  if (settings.previewQuality !== 'auto') return settings.previewQuality;
  return settings.benchmark?.tier ?? null;
}

/** Used when measuring fails (hidden tab): a middle tier for this session only. */
export const FALLBACK_QUALITY: Quality = 'standard';
