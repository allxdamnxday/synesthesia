import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/materials/types';
import { pickQualityTier } from '../../src/perf/benchmark';
import { planSteps, stepsToReach } from '../../src/perf/fixedStep';
import { FpsMeter } from '../../src/perf/fpsMeter';

describe('fixed-step clock', () => {
  it('runs one step per 60 Hz frame and carries remainders', () => {
    expect(planSteps(0, 1 / 60, FIXED_DT).steps).toBe(1);
    let acc = 0;
    let total = 0;
    // 120 Hz display: every other frame steps.
    for (let i = 0; i < 120; i++) {
      const p = planSteps(acc, 1 / 120, FIXED_DT);
      acc = p.accumulator;
      total += p.steps;
    }
    expect(total).toBe(60);
    // 30 fps: two steps a frame.
    expect(planSteps(0, 1 / 30, FIXED_DT).steps).toBe(2);
  });

  it('keeps real time over a long run with jittery frames', () => {
    let acc = 0;
    let total = 0;
    const frames = [0.016, 0.017, 0.0165, 0.018, 0.015];
    for (let i = 0; i < 6000; i++) {
      const p = planSteps(acc, frames[i % frames.length] ?? 0.016, FIXED_DT);
      acc = p.accumulator;
      total += p.steps;
    }
    const seconds = (6000 / frames.length) * frames.reduce((a, b) => a + b, 0);
    expect(Math.abs(total * FIXED_DT - seconds)).toBeLessThan(FIXED_DT);
  });

  it('caps the steps per frame and drops the backlog instead of spiralling', () => {
    const p = planSteps(0, 0.2, FIXED_DT, 4);
    expect(p.steps).toBe(4);
    expect(p.dropped).toBe(true);
    expect(p.accumulator).toBe(0);
  });

  it('ignores nonsense elapsed times', () => {
    expect(planSteps(0, Number.NaN, FIXED_DT).steps).toBe(0);
    expect(planSteps(0, -1, FIXED_DT).steps).toBe(0);
    expect(planSteps(0, 30, FIXED_DT).steps).toBe(4);
  });

  it('seeks by whole steps', () => {
    expect(stepsToReach(1, FIXED_DT)).toBe(60);
    expect(stepsToReach(0, FIXED_DT)).toBe(0);
    expect(stepsToReach(2.2, FIXED_DT)).toBe(132);
  });
});

describe('fps meter', () => {
  it('averages over its window', () => {
    const meter = new FpsMeter(1000);
    for (let i = 0; i <= 120; i++) meter.tick(i * (1000 / 60));
    expect(meter.fps).toBeCloseTo(60, 0);
    meter.reset();
    expect(meter.fps).toBe(0);
  });
});

describe('quality tier choice', () => {
  it('picks the highest tier that sustains 30 fps', () => {
    expect(pickQualityTier({ draft: 60, standard: 58, high: 45 })).toBe('high');
    expect(pickQualityTier({ draft: 60, standard: 41, high: 22 })).toBe('standard');
    expect(pickQualityTier({ draft: 35, standard: 24, high: 12 })).toBe('draft');
    expect(pickQualityTier({ draft: 20, standard: 15, high: 9 })).toBe('draft');
    expect(pickQualityTier({ draft: 60, standard: 29.9, high: 30 })).toBe('high');
    expect(pickQualityTier({ draft: 60, standard: 50, high: 40 }, 45)).toBe('standard');
  });
});
