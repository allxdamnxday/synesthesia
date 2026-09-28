/**
 * A single triangle that covers the viewport, and `blit()` to draw it into a render
 * target (or the default framebuffer). Vertex attribute 0 is the clip-space position.
 */
import type { GlResources } from './resources';
import type { RenderTarget } from './targets';

export interface FullscreenTriangle {
  /** Bind the triangle's vertex array. */
  bind(): void;
  /** Draw the bound program over `target` (null = the canvas), setting the viewport. */
  blit(target: RenderTarget | null): void;
}

/** Clip-space positions: one oversized triangle, so there is no diagonal seam. */
export const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

export function createFullscreenTriangle(res: GlResources): FullscreenTriangle {
  const gl = res.gl;
  const vao = res.vertexArray();
  const buffer = res.buffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    bind: () => gl.bindVertexArray(vao),
    blit(target) {
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.width, target.height);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      }
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/**
 * Put the fixed-function state every full-screen pass assumes: no blending, depth,
 * stencil, scissor or culling, all color channels writable.
 */
export function resetPassState(gl: WebGL2RenderingContext): void {
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.CULL_FACE);
  gl.colorMask(true, true, true, true);
}
