import { describe, expect, it } from 'vitest';
import {
  createRng,
  hash32,
  hashString32,
  sampleWithoutReplacement,
  shuffleInPlace,
  toDisplaySeed,
} from '../../src/chance/prng';
import { sanitizeFileName, timelineDuration, defaultTimeline } from '../../src/engine/composition';
import { mean, percentile, smoothstep, std, wrapAngle } from '../../src/lib/math';
import {
  baselineValues,
  readProperty,
  sharedProperty,
  SHARED_PROPERTY_IDS,
} from '../../src/materials/properties';
import { decodeField, encodeField } from '../../src/signature/fieldCodec';

describe('prng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(123456);
    const b = createRng(123456);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('differs between nearby seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 100 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBe(0);
  });

  it('produces values in [0, 1) with a sane mean', () => {
    const rng = createRng(42);
    const values = Array.from({ length: 20000 }, () => rng());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(mean(values)).toBeCloseTo(0.5, 1);
  });

  it('matches frozen reference values (cross-machine stability)', () => {
    const rng = createRng(2026);
    const first = [rng(), rng(), rng()];
    // Frozen at first run. If this changes, every saved composition changes: bump versions.
    expect(first).toMatchSnapshot();
    expect(hash32(1, 2, 3)).toMatchSnapshot();
    expect(hashString32('water')).toMatchSnapshot();
  });

  it('hash32 is order-sensitive and deterministic', () => {
    expect(hash32(5, 7)).toBe(hash32(5, 7));
    expect(hash32(5, 7)).not.toBe(hash32(7, 5));
    expect(hash32(5)).not.toBe(hash32(5, 0));
  });

  it('display seeds are 6 digits', () => {
    for (let i = 0; i < 100; i++) {
      const s = toDisplaySeed(hash32(i, 99));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1_000_000);
    }
  });

  it('shuffles deterministically and keeps every item', () => {
    const a = shuffleInPlace(createRng(9), [1, 2, 3, 4, 5, 6, 7, 8]);
    const b = shuffleInPlace(createRng(9), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const picked = sampleWithoutReplacement(createRng(3), ['a', 'b', 'c', 'd'], 2);
    expect(new Set(picked).size).toBe(2);
  });
});

describe('math helpers', () => {
  it('percentile interpolates like NumPy', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([0, 10], 95)).toBeCloseTo(9.5);
  });

  it('smoothstep handles a degenerate edge as a step', () => {
    expect(smoothstep(0, 0, 0)).toBe(0);
    expect(smoothstep(0, 0, 1e-9)).toBe(1);
    expect(smoothstep(1, 2, 1.5)).toBeCloseTo(0.5);
  });

  it('std and wrapAngle', () => {
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe('field codec', () => {
  it('round-trips float32 values exactly', () => {
    const values = new Float32Array([0, -1.5, 3.25, 1e-7, -0, 123456.789, Math.PI]);
    const decoded = decodeField(encodeField(values));
    expect(Array.from(decoded)).toEqual(Array.from(values));
  });

  it('handles large fields', () => {
    const values = new Float32Array(10 * 30 * 32 * 18 * 2).map((_, i) => Math.sin(i));
    const decoded = decodeField(encodeField(values));
    expect(decoded.length).toBe(values.length);
    expect(decoded[12345]).toBe(values[12345]);
  });
});

describe('shared property vocabulary', () => {
  it('has the nine SPEC properties with 0.5 baselines', () => {
    expect(SHARED_PROPERTY_IDS).toHaveLength(9);
    const defs = SHARED_PROPERTY_IDS.map((id) => sharedProperty(id, 'visual'));
    expect(Object.values(baselineValues(defs)).every((v) => v === 0.5)).toBe(true);
  });

  it('readProperty falls back and clamps', () => {
    const def = sharedProperty('viscosity', 'sound', { default: 0.3 });
    expect(readProperty({}, def)).toBe(0.3);
    expect(readProperty({ viscosity: 2 }, def)).toBe(1);
    expect(readProperty({ viscosity: Number.NaN }, def)).toBe(0.3);
    const choice = {
      id: 'palette',
      default: 0,
      kind: 'choice' as const,
      choices: ['a', 'b', 'c'],
    };
    expect(readProperty({ palette: 7 }, choice)).toBe(2);
  });
});

describe('composition timeline', () => {
  it('length = duration / speed × loops + tail', () => {
    const t = { ...defaultTimeline(1), speed: 0.5, loops: 2, tailSec: 3 };
    expect(timelineDuration(10, t)).toBeCloseTo(43);
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('Wink 01 / take: 2')).toBe('Wink-01-take-2');
    expect(sanitizeFileName('***')).toBe('untitled');
  });
});
