/** Per-feature statistics used for normalization (SPEC 8.1 step 11, 8.2). */
import { percentileOfSorted } from '../lib/math';
import { FEATURE_NAMES, type FeatureStats, type SignatureFeatures } from './types';

function finite(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

/** min, max, mean, p05, p95 of one feature (all 0 for an empty series). */
export function featureStats(values: ArrayLike<number>): FeatureStats {
  const n = values.length;
  if (n === 0) return { min: 0, max: 0, mean: 0, p05: 0, p95: 0 };
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  return {
    min: finite(sorted[0]),
    max: finite(sorted[n - 1]),
    mean: finite(sum / n),
    p05: finite(percentileOfSorted(sorted, 5)),
    p95: finite(percentileOfSorted(sorted, 95)),
  };
}

/** Stats for every feature, keyed by feature name (onsets are not a per-frame series). */
export function computeStats(features: SignatureFeatures): Record<string, FeatureStats> {
  const stats: Record<string, FeatureStats> = {};
  for (const name of FEATURE_NAMES) stats[name] = featureStats(features[name]);
  return stats;
}
