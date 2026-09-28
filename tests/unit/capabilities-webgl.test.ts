import { describe, expect, it } from 'vitest';
import {
  errorMessage,
  formatBitrate,
  formatBytes,
  TimeoutError,
  withTimeout,
} from '../../src/render/capabilities/util';
import {
  bilinearSample,
  closeTo,
  expectedChannels,
  formatFloatMatrix,
  halfToFloat,
  isSoftwareRenderer,
  READBACK_VALUES,
  UPLOAD_FIELD,
  UPLOAD_SAMPLE_POINTS,
  uploadFieldData,
} from '../../src/render/capabilities/webgl';

/** Every value a half float can hold. */
const HALF_VALUES = new Set(Array.from({ length: 0x10000 }, (_, bits) => halfToFloat(bits)));

describe('half floats', () => {
  it('decodes known bit patterns', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3e00)).toBe(1.5);
    expect(halfToFloat(0x63d0)).toBe(1000);
    expect(halfToFloat(0x7bff)).toBe(65504);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Number.POSITIVE_INFINITY);
    expect(halfToFloat(0x7e00)).toBeNaN();
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
  });

  it('uses readback values that half floats hold exactly (so 16F and 32F compare alike)', () => {
    for (const v of READBACK_VALUES) {
      for (const channel of expectedChannels(v))
        expect(HALF_VALUES.has(channel), `${channel}`).toBe(true);
    }
  });

  it('uses a signature test field that half floats hold exactly', () => {
    for (const value of uploadFieldData()) expect(HALF_VALUES.has(value), `${value}`).toBe(true);
  });
});

describe('bilinear reference', () => {
  it('gives 0.5 at the midpoint of a 0/1 texture pair and clamps at the edges', () => {
    const texels = [0, 1];
    expect(bilinearSample(texels, 2, 1, 1, 0.5, 0.5)).toEqual([0.5]);
    expect(bilinearSample(texels, 2, 1, 1, 0, 0.5)).toEqual([0]);
    expect(bilinearSample(texels, 2, 1, 1, 1, 0.5)).toEqual([1]);
    expect(bilinearSample(texels, 2, 1, 1, 0.25, 0.5)).toEqual([0]);
  });

  it('samples the upload field only where filter weights are 0, ½ or 1', () => {
    // GPUs quantise filter weights (often to 1/256); these points are exact regardless.
    const { cols, rows } = UPLOAD_FIELD;
    for (const [u, v] of UPLOAD_SAMPLE_POINTS) {
      for (const [coord, size] of [
        [u, cols],
        [v, rows],
      ] as const) {
        const x = Math.min(size - 0.5, Math.max(0.5, coord * size)) - 0.5;
        const fraction = x - Math.floor(x);
        expect([0, 0.5]).toContain(Math.round(fraction * 1e9) / 1e9);
      }
    }
  });

  it('matches hand-computed values on the upload field', () => {
    const field = uploadFieldData();
    const { cols, rows } = UPLOAD_FIELD;
    // Texel (0,0) centre and the clamped corner are the first texel.
    expect(bilinearSample(field, cols, rows, 2, 0.5 / 4, 0.5 / 3)).toEqual([-1.5, -2.5]);
    expect(bilinearSample(field, cols, rows, 2, 0, 0)).toEqual([-1.5, -2.5]);
    // Midway between (1,1) = (-0.25, -0.5) and (2,1) = (0.75, -1).
    expect(bilinearSample(field, cols, rows, 2, 2 / 4, 1.5 / 3)).toEqual([0.25, -0.75]);
    // Centre of (1,1), (2,1), (1,2), (2,2).
    const [u, v] = bilinearSample(field, cols, rows, 2, 2 / 4, 2 / 3);
    expect(u).toBeCloseTo((-0.25 + 0.75 + 0 + 1) / 4, 12);
    expect(v).toBeCloseTo((-0.5 - 1 + 2 + 1.5) / 4, 12);
  });
});

describe('small helpers', () => {
  it('compares with relative tolerance', () => {
    expect(closeTo(1000.5, 1000)).toBe(true);
    expect(closeTo(1002, 1000)).toBe(false);
    expect(closeTo(1, 1)).toBe(true);
    expect(closeTo(Number.NaN, 1)).toBe(false);
  });

  it('spots software renderers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe(
      true,
    );
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 650)')).toBe(
      false,
    );
    expect(isSoftwareRenderer(null)).toBe(false);
  });

  it('prints the float matrix as an aligned table', () => {
    const table = formatFloatMatrix([
      {
        format: 'RGBA16F',
        channels: 4,
        halfFloat: true,
        allocated: true,
        renderable: true,
        readback: 'ok',
        readbackValues: [-1.5, 2.25, 1000],
        linearFilter: 'ok',
        filterValue: 0.5,
        note: null,
      },
      {
        format: 'R32F',
        channels: 1,
        halfFloat: false,
        allocated: true,
        renderable: false,
        readback: null,
        readbackValues: null,
        linearFilter: 'mismatch',
        filterValue: 0,
        note: null,
      },
    ]);
    expect(table.split('\n')).toEqual([
      'Format   Renderable       Readback  Linear filter',
      'RGBA16F  yes              ok        ok (0.5000)',
      'R32F     no (incomplete)  -         mismatch (0.0000)',
    ]);
  });

  it('formats bytes, bitrates and errors', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(3_200)).toBe('3.2 KB');
    expect(formatBytes(6_442_450_944)).toBe('6.4 GB');
    expect(formatBytes(Number.NaN)).toBe('unknown');
    expect(formatBitrate(192_000)).toBe('192 kbps');
    expect(errorMessage(new TypeError('bad'))).toBe('TypeError: bad');
    expect(errorMessage(new Error('plain'))).toBe('plain');
    expect(errorMessage('text')).toBe('text');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });

  it('times out hung promises and passes results through', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'fast')).resolves.toBe(7);
    await expect(withTimeout(new Promise(() => undefined), 10, 'hung')).rejects.toBeInstanceOf(
      TimeoutError,
    );
    await expect(withTimeout(Promise.reject(new Error('no')), 50, 'failing')).rejects.toThrow('no');
  });
});
