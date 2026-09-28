/**
 * Extraction progress in plain words (pure; tested in tests/unit/prepare-format.test.ts).
 * The worker reports four phases; the bar gives each a share of the whole and estimates the
 * time left from how quickly the frames have gone so far.
 */
import type { ExtractionPhase, ExtractionProgress } from '../../signature/extractClient';
import { describeSeconds } from './format';

export const PHASE_WORDS: Readonly<Record<ExtractionPhase, string>> = {
  loading: 'Loading…',
  reading: 'Reading the clip…',
  analyzing: 'Finding the movement…',
  finishing: 'Finishing…',
};

/** Each phase's share of the progress bar, as [from, to]. */
const PHASE_SPANS: Readonly<Record<ExtractionPhase, readonly [number, number]>> = {
  loading: [0, 0.05],
  reading: [0.05, 0.1],
  analyzing: [0.1, 0.95],
  finishing: [0.95, 1],
};

/** Time allowed for the finishing phase (features, stats and hash take well under a second). */
export const FINISHING_ALLOWANCE_SEC = 0.5;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 0..1 across all phases. */
export function overallFraction(progress: ExtractionProgress | null): number {
  if (!progress) return 0;
  const [from, to] = PHASE_SPANS[progress.phase];
  const within = progress.total > 0 ? clamp01(progress.done / progress.total) : 0;
  return from + (to - from) * within;
}

/**
 * Seconds left, from the time spent finding the movement so far (`analyzingSec`), or null
 * while there isn't enough to go on (before a few frames are done).
 */
export function estimateRemainingSec(
  progress: ExtractionProgress | null,
  analyzingSec: number,
): number | null {
  if (!progress) return null;
  if (progress.phase === 'finishing') return progress.done >= progress.total ? 0 : null;
  if (progress.phase !== 'analyzing' || progress.done < 3 || !(analyzingSec > 0.25)) return null;
  const perFrame = analyzingSec / progress.done;
  return perFrame * Math.max(0, progress.total - progress.done) + FINISHING_ALLOWANCE_SEC;
}

/** "4 seconds so far", "12 seconds so far, about 9 seconds left", "…, almost done". */
export function progressTimeText(elapsedSec: number, remainingSec: number | null): string {
  const soFar = `${describeSeconds(elapsedSec)} so far`;
  if (remainingSec === null) return soFar;
  if (remainingSec < 1.5) return `${soFar}, almost done`;
  return `${soFar}, about ${describeSeconds(Math.ceil(remainingSec))} left`;
}
