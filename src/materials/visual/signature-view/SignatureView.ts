/**
 * V0 Signature (SPEC 9.4): the diagnostic "bare wake". A short stroke per grid cell,
 * pointing the way that part of the movement goes and brightening with its speed, on
 * true black; still cells keep a faint dot so the field's extent stays visible. An
 * optional readout shows a few normalized features as labelled bars. Used on the
 * Prepare screen and selectable in Studio. It shows the field directly, with no memory,
 * so a frame depends only on the signature at that moment.
 */
import { FEATURE_NAMES, type FeatureName, type SignatureFrame } from '../../../signature/types';
import { readProperty } from '../../properties';
import type { PropertyDef, PropertyValues, VisualContext, VisualMaterial } from '../../types';
import {
  GlResources,
  bindTexture,
  createProgram,
  createTexture,
  resetPassState,
  resetUnpackState,
  type ShaderProgram,
} from '../shared/gl';
import {
  REST_BRIGHTNESS,
  STROKE_BRIGHT_SPEED,
  STROKE_MAX_CELLS,
  STROKE_TRAVEL_SEC,
  fieldLayout,
  readoutLayout,
  type ReadoutLayout,
} from './layout';
import { READOUT_FONT_FAMILY, drawReadout, type ReadoutValues } from './readout';
import { PANEL_FRAGMENT, PANEL_VERTEX, STROKE_FRAGMENT, STROKE_VERTEX } from './shaders';

export const SHOW_READOUT_PROPERTY: PropertyDef = {
  id: 'showReadout',
  label: 'Show readout',
  description:
    'Show bars for velocity, acceleration, expansion, rotation, continuity, density and direction.',
  kind: 'choice',
  shared: false,
  default: 0,
  choices: ['Off', 'On'],
  primary: true,
};

export const SIGNATURE_VIEW_META = {
  id: 'signature',
  version: 1,
  name: 'Signature',
  description:
    'The bare wake: a short stroke for each part of the movement, pointing the way it moves and brightening as it speeds up.',
  properties: [SHOW_READOUT_PROPERTY],
};

/** Grid used before the first frame arrives (the default extraction grid). */
const DEFAULT_COLS = 32;
const DEFAULT_ROWS = 18;
/** How strongly direction tints the strokes (0 = all pearl). */
const DIRECTION_HUE = 0.35;

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Panel {
  canvas: Canvas2D;
  ctx: Context2D;
  texture: WebGLTexture;
  layout: ReadoutLayout;
}

function emptyFeatures(): Record<FeatureName, number> {
  const values = {} as Record<FeatureName, number>;
  for (const name of FEATURE_NAMES) values[name] = 0;
  return values;
}

function createCanvas2D(
  width: number,
  height: number,
): { canvas: Canvas2D; ctx: Context2D } | null {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  return null;
}

export class SignatureView implements VisualMaterial {
  readonly id = SIGNATURE_VIEW_META.id;
  readonly version = SIGNATURE_VIEW_META.version;
  readonly name = SIGNATURE_VIEW_META.name;
  readonly description = SIGNATURE_VIEW_META.description;
  readonly properties = SIGNATURE_VIEW_META.properties;

  private gl: WebGL2RenderingContext | null = null;
  private res: GlResources | null = null;
  private strokes: ShaderProgram | null = null;
  private panelProgram: ShaderProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private fieldTex: WebGLTexture | null = null;
  private texCols = 0;
  private texRows = 0;
  private cols = DEFAULT_COLS;
  private rows = DEFAULT_ROWS;
  private field = new Float32Array(DEFAULT_COLS * DEFAULT_ROWS * 2);
  private fieldDirty = true;
  private readonly values: ReadoutValues & { normalized: Record<FeatureName, number> } = {
    normalized: emptyFeatures(),
    direction: 0,
    movement: 0,
    coherence: 0,
  };
  private showReadout = 0;
  private panel: Panel | null = null;

  async init(ctx: VisualContext): Promise<void> {
    this.dispose();
    const gl = ctx.gl;
    const res = new GlResources(gl);
    try {
      this.gl = gl;
      this.res = res;
      this.strokes = createProgram(res, STROKE_VERTEX, STROKE_FRAGMENT, {
        name: 'signature strokes',
      });
      this.panelProgram = createProgram(res, PANEL_VERTEX, PANEL_FRAGMENT, {
        name: 'signature readout',
      });
      // Strokes and the panel are generated from gl_VertexID/gl_InstanceID: no attributes.
      this.vao = res.vertexArray();
      this.reset(ctx.seed);
    } catch (error) {
      this.dispose();
      throw error;
    }
    // Load the readout font before the first frame so every frame uses the same face.
    // (GL objects already exist; dispose() during this wait frees them.)
    if (typeof document !== 'undefined' && 'fonts' in document) {
      try {
        await document.fonts.load(`13px ${READOUT_FONT_FAMILY}`);
      } catch {
        // Fall back to the system face.
      }
    }
  }

  reset(_seed: number): void {
    this.field.fill(0);
    this.fieldDirty = true;
    for (const name of FEATURE_NAMES) this.values.normalized[name] = 0;
    this.values.direction = 0;
    this.values.movement = 0;
    this.values.coherence = 0;
  }

  step(frame: SignatureFrame, props: PropertyValues, _dt: number): void {
    const n = frame.cols * frame.rows * 2;
    if (frame.cols !== this.cols || frame.rows !== this.rows || this.field.length !== n) {
      this.cols = Math.max(1, frame.cols);
      this.rows = Math.max(1, frame.rows);
      this.field = new Float32Array(this.cols * this.rows * 2);
    }
    const available = Math.min(this.field.length, frame.field.length);
    this.field.set(frame.field.subarray(0, available));
    if (available < this.field.length) this.field.fill(0, available);
    this.fieldDirty = true;
    for (const name of FEATURE_NAMES) this.values.normalized[name] = frame.normalized[name] ?? 0;
    this.values.direction = frame.features.direction ?? 0;
    this.values.movement = frame.normalized.energy ?? 0;
    this.values.coherence = frame.features.coherence ?? 0;
    this.setProperties(props);
  }

  /** Apply display-only properties without advancing time (proposed optional method). */
  setProperties(props: PropertyValues): void {
    this.showReadout = readProperty(props, SHOW_READOUT_PROPERTY);
  }

  draw(): void {
    const gl = this.gl;
    const strokes = this.strokes;
    if (!gl || !strokes || !this.res || gl.isContextLost()) return;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    resetPassState(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.uploadField();
    const layout = fieldLayout(this.cols, this.rows, width, height);
    strokes.use();
    gl.uniform1i(strokes.u('uField'), bindTexture(gl, 0, this.fieldTex as WebGLTexture));
    gl.uniform2i(strokes.u('uCells'), this.cols, this.rows);
    gl.uniform4f(strokes.u('uRect'), layout.x, layout.y, layout.width, layout.height);
    gl.uniform2f(strokes.u('uCanvas'), width, height);
    gl.uniform1f(strokes.u('uCellPx'), layout.cellPx);
    gl.uniform1f(strokes.u('uDiagonalPx'), layout.diagonalPx);
    gl.uniform1f(strokes.u('uStrokePx'), layout.strokePx);
    gl.uniform1f(strokes.u('uTravelSec'), STROKE_TRAVEL_SEC);
    gl.uniform1f(strokes.u('uMaxCells'), STROKE_MAX_CELLS);
    gl.uniform1f(strokes.u('uBrightSpeed'), STROKE_BRIGHT_SPEED);
    gl.uniform1f(strokes.u('uRest'), REST_BRIGHTNESS);
    gl.uniform1f(strokes.u('uHue'), DIRECTION_HUE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.cols * this.rows);

    if (this.showReadout === 1) this.drawPanel(width, height);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  resize(_width: number, _height: number): void {
    // Layout follows the drawing buffer each frame; the readout canvas is re-made on demand.
    this.releasePanel();
  }

  dispose(): void {
    this.res?.dispose();
    this.res = null;
    this.gl = null;
    this.strokes = null;
    this.panelProgram = null;
    this.vao = null;
    this.fieldTex = null;
    this.texCols = 0;
    this.texRows = 0;
    this.panel = null;
  }

  private uploadField(): void {
    const gl = this.gl;
    const res = this.res;
    if (!gl || !res) return;
    if (!this.fieldTex || this.texCols !== this.cols || this.texRows !== this.rows) {
      if (this.fieldTex) res.deleteTexture(this.fieldTex);
      this.fieldTex = createTexture(
        res,
        this.cols,
        this.rows,
        { internalFormat: gl.RG32F, format: gl.RG, type: gl.FLOAT, channels: 2 },
        { filter: gl.NEAREST },
      );
      this.texCols = this.cols;
      this.texRows = this.rows;
      this.fieldDirty = true;
    }
    if (!this.fieldDirty) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    resetUnpackState(gl);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RG, gl.FLOAT, this.field);
    this.fieldDirty = false;
  }

  private drawPanel(width: number, height: number): void {
    const gl = this.gl;
    const program = this.panelProgram;
    const res = this.res;
    if (!gl || !program || !res) return;
    const layout = readoutLayout(width, height);
    if (
      !this.panel ||
      this.panel.layout.width !== layout.width ||
      this.panel.layout.height !== layout.height
    ) {
      this.releasePanel();
      const surface = createCanvas2D(layout.width, layout.height);
      if (!surface) return;
      const texture = createTexture(
        res,
        layout.width,
        layout.height,
        { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, channels: 4 },
        { filter: gl.NEAREST },
      );
      this.panel = { ...surface, texture, layout };
    }
    const panel = this.panel;
    drawReadout(panel.ctx, layout, this.values);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, panel.texture);
    resetUnpackState(gl);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, panel.canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    program.use();
    gl.uniform4f(program.u('uRect'), layout.x, layout.y, layout.width, layout.height);
    gl.uniform2f(program.u('uCanvas'), width, height);
    gl.uniform1i(program.u('uPanel'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private releasePanel(): void {
    if (this.panel && this.res) this.res.deleteTexture(this.panel.texture);
    this.panel = null;
  }
}
