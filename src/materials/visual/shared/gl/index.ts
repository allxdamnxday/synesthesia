/** Small WebGL2 helpers shared by visual materials. */
export { GlResources, type GlResourceCounts } from './resources';
export {
  compileShader,
  createProgram,
  formatShaderError,
  withHeader,
  type ProgramOptions,
  type ShaderProgram,
} from './shader';
export {
  FULLSCREEN_TRIANGLE,
  createFullscreenTriangle,
  resetPassState,
  type FullscreenTriangle,
} from './geometry';
export {
  bindTexture,
  clearTarget,
  createDoubleRenderTarget,
  createRenderTarget,
  createTexture,
  deleteDoubleRenderTarget,
  deleteRenderTarget,
  detectRenderTargets,
  resetUnpackState,
  type DoubleRenderTarget,
  type RenderTarget,
  type RenderTargetOverrides,
  type RenderTargetSupport,
  type TextureFormat,
  type TextureOptions,
} from './targets';
export {
  VISUAL_CONTEXT_ATTRIBUTES,
  getVisualContext,
  readDrawingBuffer,
  releaseVisualContext,
} from './context';
