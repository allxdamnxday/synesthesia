import { describe, expect, it } from 'vitest';
import { cellRange, flowUnitScale, gridSize, poolFlow } from '../../src/signature/pool';

describe('grid size', () => {
  it('uses cols and rows = round(cols × h / w), rows clamped to 8–48', () => {
    expect(gridSize(32, 320, 180)).toEqual({ cols: 32, rows: 18 });
    expect(gridSize(32, 320, 240)).toEqual({ cols: 32, rows: 24 });
    expect(gridSize(32, 320, 569)).toEqual({ cols: 32, rows: 48 }); // portrait: 57 → 48
    expect(gridSize(32, 320, 40)).toEqual({ cols: 32, rows: 8 }); // 4 → 8
    expect(gridSize(16, 320, 180)).toEqual({ cols: 16, rows: 9 });
  });

  it('keeps cols sane', () => {
    expect(gridSize(1000, 320, 180).cols).toBe(64);
    expect(gridSize(0, 320, 180).cols).toBe(4);
    expect(gridSize(NaN, 320, 180).cols).toBe(32);
  });
});

describe('cell ranges', () => {
  it('cover every pixel exactly once when there are more pixels than cells', () => {
    for (const [count, size] of [
      [32, 320],
      [18, 180],
      [48, 569],
      [7, 100],
    ] as const) {
      const hits = new Array<number>(size).fill(0);
      for (let i = 0; i < count; i++) {
        const [a, b] = cellRange(i, count, size);
        expect(b).toBeGreaterThan(a);
        for (let x = a; x < b; x++) hits[x]++;
      }
      expect(hits.every((h) => h === 1)).toBe(true);
    }
  });

  it('are never empty, even with fewer pixels than cells', () => {
    for (let i = 0; i < 48; i++) {
      const [a, b] = cellRange(i, 48, 20);
      expect(b - a).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(20);
    }
  });
});

describe('pooling and units', () => {
  it('converts px/frame to field diagonals per second', () => {
    expect(flowUnitScale(320, 180, 30)).toBeCloseTo(30 / Math.hypot(320, 180), 12);
    // 3 px/frame at 320×180, 30 fps ≈ 0.245 diagonals/s.
    expect(3 * flowUnitScale(320, 180, 30)).toBeCloseTo(0.2451, 4);
  });

  it('averages uniform flow into every cell', () => {
    const w = 320;
    const h = 180;
    const flow = new Float32Array(w * h * 2);
    for (let i = 0; i < w * h; i++) {
      flow[2 * i] = 2;
      flow[2 * i + 1] = -1;
    }
    const out = poolFlow(flow, w, h, 32, 18, 30, new Float32Array(32 * 18 * 2));
    const scale = flowUnitScale(w, h, 30);
    for (let c = 0; c < 32 * 18; c++) {
      expect(out[2 * c]).toBeCloseTo(2 * scale, 6);
      expect(out[2 * c + 1]).toBeCloseTo(-1 * scale, 6);
    }
  });

  it('keeps movement in the cell where it happens', () => {
    const w = 320;
    const h = 180;
    const flow = new Float32Array(w * h * 2);
    // Half of cell (row 3, col 5) moves 4 px right: pixels x 50..54, y 30..39.
    for (let y = 30; y < 40; y++) for (let x = 50; x < 55; x++) flow[(y * w + x) * 2] = 4;
    const out = poolFlow(flow, w, h, 32, 18, 30, new Float32Array(32 * 18 * 2));
    const scale = flowUnitScale(w, h, 30);
    for (let r = 0; r < 18; r++) {
      for (let c = 0; c < 32; c++) {
        const u = out[(r * 32 + c) * 2];
        if (r === 3 && c === 5) expect(u).toBeCloseTo(2 * scale, 6);
        else expect(u).toBe(0);
      }
    }
  });

  it('never writes NaN', () => {
    const flow = new Float32Array(64 * 36 * 2).fill(NaN);
    const out = poolFlow(flow, 64, 36, 8, 8, 30, new Float32Array(8 * 8 * 2));
    expect(Array.from(out).every((x) => x === 0)).toBe(true);
  });
});
