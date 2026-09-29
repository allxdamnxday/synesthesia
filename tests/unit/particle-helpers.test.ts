import { describe, expect, it } from 'vitest';
import { projectField, rangeScale } from '../../src/materials/visual/shared/fluid/projection';
import { ProjectedField, worldSize } from '../../src/materials/visual/shared/fieldSampling';
import {
  hash3,
  hashSigned,
  hashUnit,
  highSigned,
  lowSigned,
  mix32,
  valueNoise2,
} from '../../src/materials/visual/shared/hashNoise';
import { WAKE_PALETTE_BYTES } from '../../src/materials/visual/shared/wakePalette';
import { PALETTE_SIZE, luminance } from '../../src/materials/visual/shared/fluid/palette';

describe('counter-based hash noise', () => {
  it('is a pure function of its inputs', () => {
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(mix32(12345)).toBe(mix32(12345));
    expect(hash3(1, 2, 3)).not.toBe(hash3(1, 2, 4));
    expect(hash3(1, 2, 3)).not.toBe(hash3(2, 1, 3));
    // Values wrap modulo 2^32 like the integers they stand for.
    expect(hash3(-1, 0, 0)).toBe(hash3(0xffffffff, 0, 0));
    expect(hash3(2 ** 32 + 5, 0, 0)).toBe(hash3(5, 0, 0));
  });

  it('gives uniform values in range', () => {
    const n = 20000;
    let sum = 0;
    let sumSigned = 0;
    let min = 1;
    let max = 0;
    let minSigned = 1;
    let maxSigned = -1;
    const buckets = new Array<number>(10).fill(0);
    // Ranges are checked once from the extremes: 80,000 expect() calls in the loop made this
    // test slow enough to time out when the whole suite runs in parallel.
    for (let i = 0; i < n; i++) {
      const u = hashUnit(99, i, 7);
      const s = hashSigned(99, i, 8);
      sum += u;
      sumSigned += s;
      min = Math.min(min, u);
      max = Math.max(max, u);
      minSigned = Math.min(minSigned, s);
      maxSigned = Math.max(maxSigned, s);
      buckets[Math.floor(u * 10)] += 1;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(minSigned).toBeGreaterThanOrEqual(-1);
    expect(maxSigned).toBeLessThan(1);
    expect(sum / n).toBeCloseTo(0.5, 1);
    expect(sumSigned / n).toBeCloseTo(0, 1);
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
    for (const count of buckets) expect(Math.abs(count - n / 10)).toBeLessThan(n * 0.015);
  });

  it('splits one hash into two independent halves', () => {
    let corr = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const h = hash3(5, i, 0);
      const a = lowSigned(h);
      const b = highSigned(h);
      expect(Math.abs(a)).toBeLessThanOrEqual(1);
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
      corr += a * b;
    }
    expect(Math.abs(corr / n)).toBeLessThan(0.02);
  });

  it('value noise is smooth, seeded and stays in 0..1', () => {
    for (let k = 0; k < 200; k++) {
      const x = k * 0.137;
      const y = k * 0.071;
      const a = valueNoise2(3, x, y);
      const b = valueNoise2(3, x + 1e-4, y);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(Math.abs(a - b)).toBeLessThan(0.01);
    }
    expect(valueNoise2(3, 0.4, 0.4)).not.toBe(valueNoise2(4, 0.4, 0.4));
    // At lattice points it equals the lattice value.
    expect(valueNoise2(3, 2, 5)).toBeCloseTo(hashUnit(3, 2, 5), 12);
  });
});

/** A cols × rows field (top row first) filled by f(col, row) → [u, v]. */
function makeField(cols: number, rows: number, f: (c: number, r: number) => [number, number]) {
  const field = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [u, v] = f(c, r);
      field[(r * cols + c) * 2] = u;
      field[(r * cols + c) * 2 + 1] = v;
    }
  }
  return { field, cols, rows };
}

describe('projected field sampling', () => {
  it('measures the canvas in short sides', () => {
    expect(worldSize(1920, 1080)).toEqual({ width: 1920 / 1080, height: 1 });
    expect(worldSize(1080, 1920)).toEqual({ width: 1, height: 1920 / 1080 });
  });

  it('fits a matching field to the whole canvas at Range 0.5, like the fluid solver', () => {
    const p = new ProjectedField();
    p.set(
      makeField(32, 18, () => [0.1, 0]),
      0.5,
      1920,
      1080,
    );
    const rect = p.rect;
    expect(rect.x).toBeCloseTo(0, 12);
    expect(rect.y).toBeCloseTo(0, 12);
    expect(rect.width).toBeCloseTo(1920 / 1080, 9);
    expect(rect.height).toBeCloseTo(1, 9);
    expect(rect.diagonal).toBeCloseTo(Math.hypot(1920 / 1080, 1), 9);
    // Same rectangle as projectField gives the force shader (canvas-normalized).
    const r = projectField(0.5, 32 / 18, 1920 / 1080);
    expect(rect.width / (1920 / 1080)).toBeCloseTo(r.width, 9);
  });

  it('keeps the field aspect: a square field sits centred on a wide canvas', () => {
    const p = new ProjectedField();
    p.set(
      makeField(10, 10, () => [0.1, 0]),
      0.5,
      1600,
      900,
    );
    const rect = p.rect;
    expect(rect.width).toBeCloseTo(1, 9);
    expect(rect.height).toBeCloseTo(1, 9);
    expect(rect.x).toBeCloseTo((1600 / 900 - 1) / 2, 9);
    // Outside the rectangle there is no push.
    expect(p.sample(0.05, 0.5)).toBe(0);
    expect(p.u).toBe(0);
  });

  it("returns each cell's vector at its centre, in short sides per second with y up", () => {
    const p = new ProjectedField();
    const input = makeField(4, 2, (c, r) => [0.1 * (c + 1), r === 0 ? 0.3 : -0.2]);
    p.set(input, 0.5, 400, 200); // field and canvas both 2:1 → fills it
    const diag = Math.hypot(2, 1);
    // Cell (col 1, row 0) is the top row: centre at x = 1.5/4 of the width, y = 0.75 up.
    const mask = p.sample(2 * (1.5 / 4), 0.75);
    expect(mask).toBe(1);
    expect(p.u).toBeCloseTo(0.2 * diag, 6);
    expect(p.v).toBeCloseTo(-0.3 * diag, 6); // image y down → world y up
    // Bottom row, col 3.
    p.sample(2 * (3.5 / 4), 0.25);
    expect(p.u).toBeCloseTo(0.4 * diag, 6);
    expect(p.v).toBeCloseTo(0.2 * diag, 6);
  });

  it('interpolates bilinearly between cell centres', () => {
    const p = new ProjectedField();
    p.set(
      makeField(4, 4, (c) => [c, 0]),
      0.5,
      400,
      400,
    );
    const diag = Math.hypot(1, 1);
    // Halfway between the centres of columns 1 and 2.
    p.sample(0.5, 0.5);
    expect(p.u).toBeCloseTo(1.5 * diag, 6);
  });

  it('fades the push out over the outermost half cell', () => {
    const p = new ProjectedField();
    p.set(
      makeField(10, 10, () => [0.5, 0]),
      0.5,
      500,
      500,
    );
    expect(p.sample(0.5, 0.5)).toBe(1);
    const edge = p.sample(0.01, 0.5); // a fifth of a cell from the left edge
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(p.sample(0, 0.5)).toBe(0);
  });

  it('scales with Range: a magnified movement is larger and faster', () => {
    const fitted = new ProjectedField();
    const magnified = new ProjectedField();
    const input = makeField(8, 8, () => [0.2, 0]);
    fitted.set(input, 0.5, 800, 800);
    magnified.set(input, 1, 800, 800);
    expect(magnified.rect.diagonal / fitted.rect.diagonal).toBeCloseTo(rangeScale(1), 9);
    fitted.sample(0.5, 0.5);
    magnified.sample(0.5, 0.5);
    expect(magnified.u / fitted.u).toBeCloseTo(rangeScale(1), 6);
    expect(magnified.maxSpeed).toBeCloseTo(0.2 * magnified.rect.diagonal, 6);
  });

  it('treats missing, short and non-finite fields as still', () => {
    const p = new ProjectedField();
    p.set({ field: new Float32Array(0), cols: 0, rows: 0 }, 0.5, 100, 100);
    expect(p.sample(0.5, 0.5)).toBe(0);
    const broken = makeField(2, 2, () => [Number.NaN, Number.POSITIVE_INFINITY]);
    p.set(broken, 0.5, 100, 100);
    expect(p.maxSpeed).toBe(0);
    p.sample(0.5, 0.5);
    expect(p.u).toBe(0);
    expect(p.v).toBe(0);
    p.set({ field: new Float32Array([0.1, 0]), cols: 2, rows: 2 }, 0.5, 100, 100);
    expect(Number.isFinite(p.maxSpeed)).toBe(true);
  });
});

describe('wake palette', () => {
  it("colors a wink's close (down) and open (up) differently, never near black", () => {
    const at = (turn: number) => {
      const i = Math.floor(turn * PALETTE_SIZE) * 4;
      return [
        (WAKE_PALETTE_BYTES[i] ?? 0) / 255,
        (WAKE_PALETTE_BYTES[i + 1] ?? 0) / 255,
        (WAKE_PALETTE_BYTES[i + 2] ?? 0) / 255,
      ] as const;
    };
    const up = at(0.25);
    const down = at(0.75);
    expect(Math.hypot(up[0] - down[0], up[1] - down[1], up[2] - down[2])).toBeGreaterThan(0.3);
    expect(luminance(up)).toBeGreaterThan(0.15);
    expect(luminance(down)).toBeGreaterThan(0.15);
  });
});
