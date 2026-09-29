/**
 * The sound harness's undoing of the output limiter (dev/sound/analysis.ts), which the preview
 * click checks use after a seek: exact below the limiter's knee, and a faithful inverse of the
 * WaveShaper curve above it.
 */
import { describe, expect, it } from 'vitest';
import { beforeLimiter, envelopes, LIMITER_HEADROOM, limiterInput } from '../../dev/sound/analysis';
import { softClipCurve } from '../../src/materials/sound/shared/masterChain';

const SR = 48000;
const CURVE = softClipCurve();

/** A WaveShaper as Web Audio defines it: linear interpolation between curve points. */
function shape(curve: Float32Array, x: number): number {
  const last = curve.length - 1;
  const v = (last / 2) * (x + 1);
  if (v <= 0) return curve[0] ?? 0;
  if (v >= last) return curve[last] ?? 0;
  const k = Math.floor(v);
  const f = v - k;
  return Math.fround((1 - f) * (curve[k] ?? 0) + f * (curve[k + 1] ?? 0));
}

/** The master chain's limiter: divide by the headroom, then the soft clip curve. */
const limit = (x: number): number => shape(CURVE, x / LIMITER_HEADROOM);

describe('the harness undoes the output limiter', () => {
  it('matches the chain: the curve is the identity at the harness headroom', () => {
    // masterChain.ts divides by its headroom before a curve spanning ±headroom; the harness
    // must use the same headroom, or its inverse would scale everything.
    const half = (CURVE.length - 1) / 2;
    expect((CURVE[half + 1] ?? 0) * half).toBe(LIMITER_HEADROOM);
    for (const x of [-0.8, -0.5, -0.123, 0, 0.001, 0.5, 0.79]) expect(limit(x)).toBeCloseTo(x, 6);
  });

  it('returns every sample below the knee bit for bit', () => {
    for (let i = -8000; i <= 8000; i++) {
      const y = Math.fround(i / 10000);
      expect(limiterInput(y)).toBe(y);
    }
    // Some awkward float32 values too.
    for (const y of [1e-8, -3.4e-7, 0.1, 0.3, 0.7999999, -0.7654321]) {
      expect(limiterInput(Math.fround(y))).toBe(Math.fround(y));
    }
  });

  it('recovers the input from the limited output well past full scale', () => {
    let worst = 0;
    for (let x = -1.6; x <= 1.6; x += 0.0005) {
      worst = Math.max(worst, Math.abs(limiterInput(limit(x)) - x));
    }
    expect(worst).toBeLessThan(1e-4);
    // Rising everywhere, and symmetric.
    let prev = Number.NEGATIVE_INFINITY;
    for (let y = -0.999; y <= 0.999; y += 0.001) {
      const x = limiterInput(Math.fround(y));
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(limiterInput(Math.fround(-y))).toBeCloseTo(-x, 5);
      prev = x;
    }
  });

  it('gives an output at full scale the input nearest zero that reaches it', () => {
    const top = CURVE[CURVE.length - 1] ?? 1;
    const x = limiterInput(top);
    expect(x).toBeGreaterThan(1.5);
    expect(x).toBeLessThanOrEqual(LIMITER_HEADROOM);
    expect(limit(x)).toBe(top);
    expect(limit(x - 0.01)).toBeLessThan(top);
  });

  it('shows a loud, smooth tone as smooth as it was made', () => {
    // A 1 kHz tone 2.3 dB over full scale: the limiter rounds off every peak.
    const n = SR / 10;
    const made = new Float32Array(n);
    const limited = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      made[i] = 1.3 * Math.sin((2 * Math.PI * 1000 * i) / SR);
      limited[i] = limit(made[i] ?? 0);
    }
    const roughness = (data: Float32Array[]): number => Math.max(...envelopes(data, SR).click);
    const own = roughness([made]);
    // Rounding the peaks reads as roughness after the limiter…
    expect(roughness([limited])).toBeGreaterThan(1.5 * own);
    // …and none of it is left before it.
    const [recovered = new Float32Array(0)] = beforeLimiter([limited]);
    expect(roughness([recovered])).toBeCloseTo(own, 3);
  });
});
