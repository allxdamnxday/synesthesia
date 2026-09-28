/**
 * WebGL2 capability probe (SPEC 14.1, 9.4).
 *
 * The fluid materials render into float or half-float textures and sample them with
 * linear filtering; the signature field is uploaded every step as Float32 data into an
 * RG16F texture and sampled bilinearly. This probe tests exactly those paths on the real
 * GPU instead of trusting extension lists:
 *
 * - For R/RG/RGBA × 16F/32F: framebuffer completeness; a shader writes -1.5, 2.25 and
 *   1000 (and derived values) and we read them back; a 2×1 texture uploaded from Float32
 *   data (texels 0 and 1) is sampled at the midpoint with LINEAR filtering (expect 0.5).
 * - Signature upload: a 4×3 RG field (values in -4..2.5) uploaded with `texImage2D(RG16F,
 *   ..., FLOAT)` is sampled bilinearly at texel centres and midpoints and compared with a
 *   CPU bilinear reference. RGBA16F is tried as the fallback if RG16F fails.
 *
 * Required: RGBA16F renderable, values outside 0..1 survive, and linear filtering works.
 * R16F/RG16F are nice to have (the solver falls back to RGBA). Every GL object is deleted
 * and the context is lost when done.
 */
import { checkBase } from './definitions';
import type { CapabilityCheck, GpuInfo } from './types';
import { delay, errorMessage } from './util';

export type FloatFormatName = 'R16F' | 'RG16F' | 'RGBA16F' | 'R32F' | 'RG32F' | 'RGBA32F';

export const FLOAT_FORMATS: readonly FloatFormatName[] = [
  'R16F',
  'RG16F',
  'RGBA16F',
  'R32F',
  'RG32F',
  'RGBA32F',
];

/** Values the write/readback test stores: negative, above 1, and large. */
export const READBACK_VALUES = [-1.5, 2.25, 1000] as const;

/** What the write shader stores in each channel for value `v`. Exactly representable in half floats. */
export function expectedChannels(v: number): [number, number, number, number] {
  return [v, -v, v * 0.5, v * 2];
}

const FILTER_TOLERANCE = 1e-3;
const UPLOAD_TOLERANCE = 2e-3;

export type ReadbackOutcome = 'ok' | 'mismatch' | 'unreadable';
export type FilterOutcome = 'ok' | 'mismatch' | 'untested';

export interface FloatFormatResult {
  format: FloatFormatName;
  channels: 1 | 2 | 4;
  halfFloat: boolean;
  /** Storage was allocated without a GL error. */
  allocated: boolean;
  /** A framebuffer with this texture as its colour attachment is complete. */
  renderable: boolean;
  /** Shader-written values read back correctly; null when not renderable. */
  readback: ReadbackOutcome | null;
  /** The values read back for pixel 0..2, channel 0 (for the report). */
  readbackValues: number[] | null;
  /** Linear filtering of Float32 data uploaded into this format, sampled at a texel midpoint. */
  linearFilter: FilterOutcome;
  /** The sampled value (0.5 expected). */
  filterValue: number | null;
  /** GL error or other note, if any. */
  note: string | null;
}

export interface SignatureUploadResult {
  format: 'RG16F' | 'RGBA16F';
  ok: boolean;
  /** Largest absolute difference from the CPU bilinear reference. */
  maxError: number | null;
  note: string | null;
}

export type WebGLExtensionName =
  | 'EXT_color_buffer_float'
  | 'EXT_color_buffer_half_float'
  | 'OES_texture_float_linear'
  | 'EXT_float_blend';

export const REPORTED_EXTENSIONS: readonly WebGLExtensionName[] = [
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
  'OES_texture_float_linear',
  'EXT_float_blend',
];

export interface WebGLProbe {
  /** 'startup' tests only RGBA16F; 'full' runs the whole matrix and the signature upload. */
  scope: 'startup' | 'full';
  /** true: a WebGL2 context was created; false: definitely not; null: the probe threw first. */
  available: boolean | null;
  /** The browser's reason when context creation failed (webglcontextcreationerror). */
  contextError: string | null;
  version: string | null;
  shadingLanguageVersion: string | null;
  gpu: GpuInfo | null;
  softwareRenderer: boolean;
  maxTextureSize: number | null;
  extensions: Record<WebGLExtensionName, boolean>;
  formats: FloatFormatResult[];
  signatureUpload: SignatureUploadResult[];
  /** The target sampled values were read back from. */
  sampleTarget: 'RGBA32F' | 'RGBA16F' | null;
  /** The context was lost while probing, so negative results are inconclusive. */
  contextLost: boolean;
  /** An unexpected exception (reported as a warning, never as a missing capability). */
  unexpectedError: string | null;
}

// ---------------------------------------------------------------------------------------
// Pure helpers (unit tested)

/** IEEE 754 half-float bits → number. */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/**
 * CPU reference for GL_LINEAR sampling with CLAMP_TO_EDGE at texture coordinate (u, v).
 * `data` is row-major, `channels` values per texel; row 0 is at v = 0.
 */
export function bilinearSample(
  data: ArrayLike<number>,
  cols: number,
  rows: number,
  channels: number,
  u: number,
  v: number,
): number[] {
  const x = u * cols - 0.5;
  const y = v * rows - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx = (i: number) => Math.min(cols - 1, Math.max(0, i));
  const cy = (j: number) => Math.min(rows - 1, Math.max(0, j));
  const at = (i: number, j: number, c: number) => data[(cy(j) * cols + cx(i)) * channels + c] ?? 0;
  const out: number[] = [];
  for (let c = 0; c < channels; c++) {
    const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
    const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
    out.push(top * (1 - fy) + bottom * fy);
  }
  return out;
}

/** Relative-or-absolute closeness used by the readback test. */
export function closeTo(actual: number, expected: number, tolerance = 1e-3): boolean {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

/** Renderer strings that mean WebGL runs on the CPU (slow previews). */
export function isSoftwareRenderer(renderer: string | null): boolean {
  return (
    !!renderer &&
    /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(renderer)
  );
}

/** The signature-upload test field: 4 × 3 cells of (u, v), all exactly representable in half floats. */
export const UPLOAD_FIELD = { cols: 4, rows: 3 } as const;

export function uploadFieldData(): Float32Array {
  const { cols, rows } = UPLOAD_FIELD;
  const data = new Float32Array(cols * rows * 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = (row * cols + col) * 2;
      data[i] = col - 1.5 + row * 0.25;
      data[i + 1] = (row - 1) * 2.5 - col * 0.5;
    }
  }
  return data;
}

/** Texel centres, midpoints, a four-texel centre and clamped corners (bilinear weights 0, ½ or 1). */
export const UPLOAD_SAMPLE_POINTS: readonly (readonly [number, number])[] = [
  [0.5 / 4, 0.5 / 3],
  [3.5 / 4, 2.5 / 3],
  [2 / 4, 1.5 / 3],
  [1.5 / 4, 1 / 3],
  [2 / 4, 2 / 3],
  [1 / 4, 1.5 / 3],
  [0, 0],
  [1, 1],
];

/** A fixed-width text table of the float-format matrix (Diagnostics detail and spike 4). */
export function formatFloatMatrix(formats: readonly FloatFormatResult[]): string {
  const header = ['Format', 'Renderable', 'Readback', 'Linear filter'];
  const rows = formats.map((f) => [
    f.format,
    f.renderable ? 'yes' : f.allocated ? 'no (incomplete)' : 'no (allocation failed)',
    f.readback === null ? '-' : f.readback,
    f.linearFilter === 'untested'
      ? 'untested'
      : `${f.linearFilter} (${f.filterValue === null ? '?' : f.filterValue.toFixed(4)})`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}

function extensionLine(extensions: Record<WebGLExtensionName, boolean>): string {
  return REPORTED_EXTENSIONS.map((name) => `${name} ${extensions[name] ? 'yes' : 'no'}`).join(', ');
}

function formatOk(f: FloatFormatResult | undefined): boolean {
  return !!f && f.renderable && f.readback === 'ok' && f.linearFilter === 'ok';
}

// ---------------------------------------------------------------------------------------
// Assessment (pure)

const GRAPHICS_HELP =
  'If WebGL2 is missing, check that Chrome Settings > System > "Use graphics acceleration when available" is on, update Chrome, and look at chrome://gpu.';

function webgl2Row(probe: WebGLProbe): CapabilityCheck {
  const base = checkBase('webgl2');
  if (probe.available === false) {
    return {
      ...base,
      status: 'fail',
      summary: "WebGL2 isn't available, so the wakes can't be drawn.",
      detail: [
        "getContext('webgl2') returned null (tried twice).",
        `Browser's reason: ${probe.contextError ?? 'none given'}`,
        GRAPHICS_HELP,
      ].join('\n'),
    };
  }
  if (probe.available === null) {
    return {
      ...base,
      status: 'warn',
      summary: "The graphics check couldn't finish.",
      detail: `Unexpected error: ${probe.unexpectedError ?? 'unknown'}`,
    };
  }
  const detail = [
    `Version: ${probe.version ?? '?'}; ${probe.shadingLanguageVersion ?? '?'}`,
    `GPU: ${probe.gpu?.renderer ?? '?'} (vendor: ${probe.gpu?.vendor ?? '?'}; from ${
      probe.gpu?.source === 'debug-renderer-info' ? 'WEBGL_debug_renderer_info' : 'RENDERER'
    })`,
    `MAX_TEXTURE_SIZE: ${probe.maxTextureSize ?? '?'}`,
    `Extensions: ${extensionLine(probe.extensions)}`,
  ].join('\n');
  if (probe.softwareRenderer) {
    return {
      ...base,
      status: 'warn',
      summary: 'WebGL2 works, but in software, so previews will be slow.',
      detail: `${detail}\n${GRAPHICS_HELP}`,
    };
  }
  return { ...base, status: 'pass', summary: 'WebGL2 is available.', detail };
}

function floatTargetsRow(probe: WebGLProbe): CapabilityCheck {
  const base = checkBase('float-targets');
  if (probe.available === false) {
    return {
      ...base,
      status: 'fail',
      summary: "Can't be checked without WebGL2.",
    };
  }
  const f = probe.formats.find((r) => r.format === 'RGBA16F');
  const inconclusive = (summary: string, extra?: string): CapabilityCheck => ({
    ...base,
    status: 'warn',
    summary,
    detail: [
      extra,
      probe.contextLost ? 'The WebGL context was lost during the check.' : undefined,
      probe.unexpectedError ? `Unexpected error: ${probe.unexpectedError}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  if (probe.available === null || !f) {
    return inconclusive("The graphics check couldn't finish.");
  }
  const detail = [
    `RGBA16F: allocated ${f.allocated ? 'yes' : 'no'}, renderable ${f.renderable ? 'yes' : 'no'}, readback ${
      f.readback ?? '-'
    }${f.readbackValues ? ` [${f.readbackValues.join(', ')}] (expected ${READBACK_VALUES.join(', ')})` : ''}, linear filter ${
      f.linearFilter
    }${f.filterValue !== null ? ` (${f.filterValue.toFixed(4)}, expected 0.5)` : ''}`,
    f.note ? `Note: ${f.note}` : undefined,
    `Sampled through: ${probe.sampleTarget ?? 'none'}`,
    probe.unexpectedError ? `Unexpected error: ${probe.unexpectedError}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  // A lost context makes every negative result meaningless: never report it as missing.
  if (probe.contextLost && !formatOk(f)) {
    return inconclusive(
      'The graphics check was interrupted, so half-float support is unknown.',
      detail,
    );
  }
  if (!f.renderable) {
    return {
      ...base,
      status: 'fail',
      summary: "Half-float render targets aren't supported here, so the fluid materials can't run.",
      detail,
    };
  }
  if (f.readback === 'mismatch') {
    return {
      ...base,
      status: 'fail',
      summary:
        "Half-float render targets don't keep values outside 0 to 1, so the fluid materials can't run.",
      detail,
    };
  }
  if (f.linearFilter === 'mismatch') {
    return {
      ...base,
      status: 'fail',
      summary:
        "Half-float textures can't be sampled smoothly (linear filtering), so the fluid materials can't run.",
      detail,
    };
  }
  if (f.readback !== 'ok' || f.linearFilter !== 'ok') {
    return {
      ...base,
      status: 'warn',
      summary: "Half-float render targets were created, but the results couldn't be confirmed.",
      detail,
    };
  }
  return {
    ...base,
    status: 'pass',
    summary: 'Half-float render targets work, with smooth (linear) sampling.',
    detail,
  };
}

function floatFormatsRow(probe: WebGLProbe): CapabilityCheck {
  const base = checkBase('float-formats');
  if (probe.available !== true) {
    return {
      ...base,
      status: 'warn',
      summary: "Can't be checked without WebGL2.",
      detail: probe.unexpectedError ? `Unexpected error: ${probe.unexpectedError}` : undefined,
    };
  }
  const byName = (name: FloatFormatName) => probe.formats.find((f) => f.format === name);
  const compactOk = formatOk(byName('R16F')) && formatOk(byName('RG16F'));
  const rg16Upload = probe.signatureUpload.find((u) => u.format === 'RG16F');
  const rgbaUpload = probe.signatureUpload.find((u) => u.format === 'RGBA16F');
  const uploadLines = probe.signatureUpload.map(
    (u) =>
      `Signature upload (Float32 -> ${u.format}, bilinear): ${u.ok ? 'ok' : 'failed'}${
        u.maxError !== null ? `, max error ${u.maxError.toExponential(1)}` : ''
      }${u.note ? ` (${u.note})` : ''}`,
  );
  const fullFloat = (['R32F', 'RG32F', 'RGBA32F'] as const)
    .map((name) => `${name} ${formatOk(byName(name)) ? 'ok' : 'no'}`)
    .join(', ');
  const detail = [
    formatFloatMatrix(probe.formats),
    '',
    ...uploadLines,
    `Full-float (32F, not required): ${fullFloat}`,
    probe.contextLost ? 'The WebGL context was lost during the check.' : undefined,
    probe.unexpectedError ? `Unexpected error: ${probe.unexpectedError}` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  if (compactOk && rg16Upload?.ok) {
    return {
      ...base,
      status: 'pass',
      summary: 'Compact half-float formats and the signature texture upload work.',
      detail,
    };
  }
  if (formatOk(byName('RGBA16F')) && (rg16Upload?.ok || rgbaUpload?.ok)) {
    return {
      ...base,
      status: 'warn',
      summary:
        'Some compact formats are missing, so the fluid uses four-channel textures (a little slower).',
      detail,
    };
  }
  return {
    ...base,
    status: 'warn',
    summary: "Compact float formats and the signature texture upload couldn't be confirmed.",
    detail,
  };
}

/** Rows for WebGL2 and half-float targets (always), plus the full matrix row for 'full' probes. */
export function assessWebGL(probe: WebGLProbe): CapabilityCheck[] {
  const rows = [webgl2Row(probe), floatTargetsRow(probe)];
  if (probe.scope === 'full') rows.push(floatFormatsRow(probe));
  return rows;
}

// ---------------------------------------------------------------------------------------
// Browser probe

const VERTEX_SHADER = `#version 300 es
void main() {
  // Full-screen triangle from gl_VertexID; no vertex buffers needed.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const WRITE_SHADER = `#version 300 es
precision highp float;
uniform vec3 uValues;
out vec4 outColor;
void main() {
  int i = int(gl_FragCoord.x);
  float v = i == 0 ? uValues.x : (i == 1 ? uValues.y : uValues.z);
  outColor = vec4(v, -v, v * 0.5, v * 2.0);
}`;

const SAMPLE_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uTex;
uniform vec2 uCoords[16];
out vec4 outColor;
void main() {
  int i = int(gl_FragCoord.x);
  outColor = texture(uTex, uCoords[i]);
}`;

interface FormatSpec {
  internal: number;
  format: number;
  channels: 1 | 2 | 4;
  halfFloat: boolean;
}

function formatSpec(gl: WebGL2RenderingContext, name: FloatFormatName): FormatSpec {
  switch (name) {
    case 'R16F':
      return { internal: gl.R16F, format: gl.RED, channels: 1, halfFloat: true };
    case 'RG16F':
      return { internal: gl.RG16F, format: gl.RG, channels: 2, halfFloat: true };
    case 'RGBA16F':
      return { internal: gl.RGBA16F, format: gl.RGBA, channels: 4, halfFloat: true };
    case 'R32F':
      return { internal: gl.R32F, format: gl.RED, channels: 1, halfFloat: false };
    case 'RG32F':
      return { internal: gl.RG32F, format: gl.RG, channels: 2, halfFloat: false };
    case 'RGBA32F':
      return { internal: gl.RGBA32F, format: gl.RGBA, channels: 4, halfFloat: false };
  }
}

/** Clear the GL error queue and return the first error in it (or NO_ERROR). */
function drainErrors(gl: WebGL2RenderingContext): number {
  let first: number = gl.NO_ERROR;
  for (let i = 0; i < 16; i++) {
    const error = gl.getError();
    if (error === gl.NO_ERROR) break;
    if (first === gl.NO_ERROR) first = error;
  }
  return first;
}

function hex(n: number): string {
  return `0x${n.toString(16)}`;
}

/** Tracks every GL object so the probe can always clean up. */
class GLSession {
  private readonly textures: WebGLTexture[] = [];
  private readonly framebuffers: WebGLFramebuffer[] = [];
  private readonly programs: WebGLProgram[] = [];
  private readonly shaders: WebGLShader[] = [];
  private readonly vaos: WebGLVertexArrayObject[] = [];

  constructor(readonly gl: WebGL2RenderingContext) {}

  texture(): WebGLTexture {
    const t = this.gl.createTexture();
    this.textures.push(t);
    return t;
  }

  framebuffer(): WebGLFramebuffer {
    const f = this.gl.createFramebuffer();
    this.framebuffers.push(f);
    return f;
  }

  vao(): WebGLVertexArrayObject {
    const v = this.gl.createVertexArray();
    this.vaos.push(v);
    return v;
  }

  program(fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('createShader returned null');
      this.shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader) ?? ''}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    this.programs.push(program);
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    return program;
  }

  dispose(): void {
    const gl = this.gl;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindVertexArray(null);
      gl.useProgram(null);
      for (const t of this.textures) gl.deleteTexture(t);
      for (const f of this.framebuffers) gl.deleteFramebuffer(f);
      for (const p of this.programs) gl.deleteProgram(p);
      for (const s of this.shaders) gl.deleteShader(s);
      for (const v of this.vaos) gl.deleteVertexArray(v);
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
}

/** A texture of `spec` with nearest or linear sampling and clamped edges. Returns the GL error. */
function allocateTexture(
  session: GLSession,
  spec: FormatSpec,
  width: number,
  height: number,
  data: Float32Array | null,
  linear: boolean,
): { texture: WebGLTexture; error: number } {
  const gl = session.gl;
  const texture = session.texture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  drainErrors(gl);
  // Uploads always use FLOAT data (legal for 16F internal formats too): this is the signature path.
  const type = data ? gl.FLOAT : spec.halfFloat ? gl.HALF_FLOAT : gl.FLOAT;
  gl.texImage2D(gl.TEXTURE_2D, 0, spec.internal, width, height, 0, spec.format, type, data);
  const error = drainErrors(gl);
  return { texture, error };
}

function attach(
  session: GLSession,
  texture: WebGLTexture,
): { fbo: WebGLFramebuffer; status: number } {
  const gl = session.gl;
  const fbo = session.framebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { fbo, status: gl.checkFramebufferStatus(gl.FRAMEBUFFER) };
}

function componentsOf(gl: WebGL2RenderingContext, format: number): number {
  if (format === gl.RED) return 1;
  if (format === gl.RG) return 2;
  if (format === gl.RGB) return 3;
  return 4;
}

/**
 * Read `width` × 1 pixels of the bound framebuffer as RGBA floats. RGBA/FLOAT is the
 * standard combination; otherwise use the implementation's preferred read format.
 */
function readRow(
  gl: WebGL2RenderingContext,
  width: number,
): { values: Float32Array | null; note: string | null } {
  drainErrors(gl);
  const rgba = new Float32Array(width * 4);
  gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, rgba);
  const error = drainErrors(gl);
  if (error === gl.NO_ERROR) return { values: rgba, note: null };

  const format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
  const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;
  const n = componentsOf(gl, format);
  let raw: number[] | null = null;
  if (type === gl.FLOAT) {
    const buf = new Float32Array(width * n);
    gl.readPixels(0, 0, width, 1, format, type, buf);
    if (drainErrors(gl) === gl.NO_ERROR) raw = Array.from(buf);
  } else if (type === gl.HALF_FLOAT) {
    const buf = new Uint16Array(width * n);
    gl.readPixels(0, 0, width, 1, format, type, buf);
    if (drainErrors(gl) === gl.NO_ERROR) raw = Array.from(buf, halfToFloat);
  }
  if (!raw) {
    return {
      values: null,
      note: `readPixels failed (GL error ${hex(error)}); implementation read format ${hex(format)}/${hex(type)}`,
    };
  }
  const out = new Float32Array(width * 4);
  for (let i = 0; i < width; i++) {
    for (let c = 0; c < 4; c++) out[i * 4 + c] = c < n ? (raw[i * n + c] ?? 0) : c === 3 ? 1 : 0;
  }
  return { values: out, note: `read as ${hex(format)}/${hex(type)}` };
}

interface Tools {
  session: GLSession;
  writeProgram: WebGLProgram;
  sampleProgram: WebGLProgram;
  sampleTarget: { fbo: WebGLFramebuffer; name: 'RGBA32F' | 'RGBA16F' } | null;
}

const SAMPLE_TARGET_WIDTH = 16;

function createSampleTarget(session: GLSession): Tools['sampleTarget'] {
  const gl = session.gl;
  for (const name of ['RGBA32F', 'RGBA16F'] as const) {
    const { texture, error } = allocateTexture(
      session,
      formatSpec(gl, name),
      SAMPLE_TARGET_WIDTH,
      1,
      null,
      false,
    );
    if (error !== gl.NO_ERROR) continue;
    const { fbo, status } = attach(session, texture);
    if (status === gl.FRAMEBUFFER_COMPLETE) return { fbo, name };
  }
  return null;
}

/** Sample `texture` at the given coordinates into the sample target and read the results. */
function sampleAt(
  tools: Tools,
  texture: WebGLTexture,
  points: readonly (readonly [number, number])[],
): { values: Float32Array | null; note: string | null } {
  const { session, sampleProgram, sampleTarget } = tools;
  const gl = session.gl;
  if (!sampleTarget) return { values: null, note: 'no float target to sample into' };
  gl.bindFramebuffer(gl.FRAMEBUFFER, sampleTarget.fbo);
  gl.viewport(0, 0, points.length, 1);
  gl.useProgram(sampleProgram);
  const coords = new Float32Array(32);
  points.forEach(([u, v], i) => {
    coords[i * 2] = u;
    coords[i * 2 + 1] = v;
  });
  gl.uniform2fv(gl.getUniformLocation(sampleProgram, 'uCoords'), coords);
  gl.uniform1i(gl.getUniformLocation(sampleProgram, 'uTex'), 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return readRow(gl, points.length);
}

function testFormat(tools: Tools, name: FloatFormatName): FloatFormatResult {
  const { session, writeProgram } = tools;
  const gl = session.gl;
  const spec = formatSpec(gl, name);
  const result: FloatFormatResult = {
    format: name,
    channels: spec.channels,
    halfFloat: spec.halfFloat,
    allocated: false,
    renderable: false,
    readback: null,
    readbackValues: null,
    linearFilter: 'untested',
    filterValue: null,
    note: null,
  };
  const notes: string[] = [];

  // 1. Render target: allocate, attach, write values from a shader, read them back.
  const width = READBACK_VALUES.length;
  const target = allocateTexture(session, spec, width, 1, null, false);
  result.allocated = target.error === gl.NO_ERROR;
  if (!result.allocated) notes.push(`texImage2D error ${hex(target.error)}`);
  if (result.allocated) {
    const { status } = attach(session, target.texture);
    result.renderable = status === gl.FRAMEBUFFER_COMPLETE;
    if (!result.renderable) notes.push(`framebuffer status ${hex(status)}`);
  }
  if (result.renderable) {
    gl.viewport(0, 0, width, 1);
    gl.useProgram(writeProgram);
    gl.uniform3f(gl.getUniformLocation(writeProgram, 'uValues'), ...READBACK_VALUES);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const { values, note } = readRow(gl, width);
    if (note) notes.push(note);
    if (!values) {
      result.readback = 'unreadable';
    } else {
      let ok = true;
      READBACK_VALUES.forEach((v, i) => {
        const expected = expectedChannels(v);
        for (let c = 0; c < spec.channels; c++) {
          if (!closeTo(values[i * 4 + c] ?? Number.NaN, expected[c] ?? 0)) ok = false;
        }
      });
      result.readback = ok ? 'ok' : 'mismatch';
      result.readbackValues = READBACK_VALUES.map((_, i) => values[i * 4] ?? Number.NaN);
    }
  }

  // 2. Linear filtering of uploaded Float32 data: texels 0 and 1, sampled at the midpoint.
  const texels = new Float32Array(2 * spec.channels);
  texels.fill(1, spec.channels);
  const source = allocateTexture(session, spec, 2, 1, texels, true);
  if (source.error !== gl.NO_ERROR) {
    notes.push(`Float32 upload error ${hex(source.error)}`);
  } else {
    const { values, note } = sampleAt(tools, source.texture, [[0.5, 0.5]]);
    if (!values) {
      if (note) notes.push(note);
    } else {
      const value = values[0] ?? Number.NaN;
      result.filterValue = value;
      result.linearFilter = Math.abs(value - 0.5) <= FILTER_TOLERANCE ? 'ok' : 'mismatch';
      if (result.linearFilter === 'mismatch' && value === 0) {
        notes.push('sampled 0: texture incomplete for LINEAR (not filterable)');
      }
    }
  }
  result.note = notes.length > 0 ? notes.join('; ') : null;
  return result;
}

function testSignatureUpload(tools: Tools, name: 'RG16F' | 'RGBA16F'): SignatureUploadResult {
  const gl = tools.session.gl;
  const spec = formatSpec(gl, name);
  const field = uploadFieldData();
  const { cols, rows } = UPLOAD_FIELD;
  let data = field;
  if (spec.channels === 4) {
    data = new Float32Array(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) {
      data[i * 4] = field[i * 2] ?? 0;
      data[i * 4 + 1] = field[i * 2 + 1] ?? 0;
    }
  }
  const { texture, error } = allocateTexture(tools.session, spec, cols, rows, data, true);
  if (error !== gl.NO_ERROR) {
    return { format: name, ok: false, maxError: null, note: `upload error ${hex(error)}` };
  }
  const { values, note } = sampleAt(tools, texture, UPLOAD_SAMPLE_POINTS);
  if (!values) return { format: name, ok: false, maxError: null, note };
  let maxError = 0;
  UPLOAD_SAMPLE_POINTS.forEach(([u, v], i) => {
    const expected = bilinearSample(field, cols, rows, 2, u, v);
    for (let c = 0; c < 2; c++) {
      const diff = Math.abs((values[i * 4 + c] ?? Number.NaN) - (expected[c] ?? 0));
      maxError = Number.isNaN(diff) ? Number.POSITIVE_INFINITY : Math.max(maxError, diff);
    }
  });
  return { format: name, ok: maxError <= UPLOAD_TOLERANCE, maxError, note };
}

/** GPU strings from an existing context. */
export function readGpuInfoFrom(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuInfo {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext) {
    return {
      vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)),
      renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
      source: 'debug-renderer-info',
    };
  }
  return {
    vendor: String(gl.getParameter(gl.VENDOR)),
    renderer: String(gl.getParameter(gl.RENDERER)),
    source: 'renderer-parameter',
  };
}

/** GPU strings from a throwaway context, or null when WebGL is unavailable. */
export function readGpuInfo(): GpuInfo | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return null;
    try {
      return readGpuInfoFrom(gl);
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    return null;
  }
}

function createContext(powerPreference: WebGLPowerPreference): {
  gl: WebGL2RenderingContext | null;
  error: string | null;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  let error: string | null = null;
  const onError = (event: Event) => {
    const message = (event as WebGLContextEvent).statusMessage;
    if (message) error = message;
  };
  canvas.addEventListener('webglcontextcreationerror', onError);
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference,
    failIfMajorPerformanceCaveat: false,
  });
  canvas.removeEventListener('webglcontextcreationerror', onError);
  return { gl, error };
}

function emptyProbe(scope: WebGLProbe['scope']): WebGLProbe {
  return {
    scope,
    available: null,
    contextError: null,
    version: null,
    shadingLanguageVersion: null,
    gpu: null,
    softwareRenderer: false,
    maxTextureSize: null,
    extensions: {
      EXT_color_buffer_float: false,
      EXT_color_buffer_half_float: false,
      OES_texture_float_linear: false,
      EXT_float_blend: false,
    },
    formats: [],
    signatureUpload: [],
    sampleTarget: null,
    contextLost: false,
    unexpectedError: null,
  };
}

export interface WebGLProbeOptions {
  /** 'startup' (fast, RGBA16F only) or 'full' (the whole matrix and the signature upload). */
  scope?: 'startup' | 'full';
  /** Match the renderer that will use the result. Defaults to the browser's choice. */
  powerPreference?: WebGLPowerPreference;
}

/** Probe WebGL2 and float render targets on the real GPU. Never throws. */
export async function probeWebGL(options: WebGLProbeOptions = {}): Promise<WebGLProbe> {
  const scope = options.scope ?? 'full';
  const probe = emptyProbe(scope);
  let session: GLSession | null = null;
  try {
    let created = createContext(options.powerPreference ?? 'default');
    if (!created.gl) {
      // Context creation can fail transiently (for example while the GPU process restarts).
      await delay(300);
      created = createContext(options.powerPreference ?? 'default');
    }
    const gl = created.gl;
    if (!gl) {
      probe.available = false;
      probe.contextError = created.error;
      return probe;
    }
    probe.available = true;
    session = new GLSession(gl);

    probe.version = String(gl.getParameter(gl.VERSION));
    probe.shadingLanguageVersion = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
    probe.gpu = readGpuInfoFrom(gl);
    probe.softwareRenderer = isSoftwareRenderer(probe.gpu.renderer);
    probe.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    for (const name of REPORTED_EXTENSIONS) {
      // Enabling EXT_color_buffer_float is what makes float formats renderable in WebGL2.
      probe.extensions[name] = gl.getExtension(name) !== null;
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(session.vao());

    const tools: Tools = {
      session,
      writeProgram: session.program(WRITE_SHADER),
      sampleProgram: session.program(SAMPLE_SHADER),
      sampleTarget: createSampleTarget(session),
    };
    probe.sampleTarget = tools.sampleTarget?.name ?? null;

    const formats: readonly FloatFormatName[] = scope === 'full' ? FLOAT_FORMATS : ['RGBA16F'];
    for (const name of formats) probe.formats.push(testFormat(tools, name));

    if (scope === 'full') {
      const rg = testSignatureUpload(tools, 'RG16F');
      probe.signatureUpload.push(rg);
      if (!rg.ok) probe.signatureUpload.push(testSignatureUpload(tools, 'RGBA16F'));
    }
    probe.contextLost = gl.isContextLost();
  } catch (error) {
    probe.unexpectedError = errorMessage(error);
    if (session) probe.contextLost = session.gl.isContextLost();
  } finally {
    try {
      session?.dispose();
    } catch {
      // Cleanup is best effort; the context is garbage collected with its canvas.
    }
  }
  return probe;
}
