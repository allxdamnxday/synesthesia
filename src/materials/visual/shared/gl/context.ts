/**
 * Creating and releasing the WebGL2 context a visual material draws into. The canvas's
 * owner (Studio preview, render pipeline, harness pages) creates the context; materials
 * only borrow it through VisualContext.
 */

/**
 * Attributes for a material canvas. Opaque (the surround is true black whatever the page
 * colour), no depth/stencil/MSAA (materials anti-alias themselves), and the drawing buffer
 * isn't preserved (read pixels right after `draw()` in the same task).
 */
export const VISUAL_CONTEXT_ATTRIBUTES: Readonly<WebGLContextAttributes> = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  // On dual-GPU MacBook Pros this asks for the discrete GPU.
  powerPreference: 'high-performance',
};

/** Get (or create) a WebGL2 context on a canvas; null if WebGL2 isn't available. */
export function getVisualContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  attributes: WebGLContextAttributes = VISUAL_CONTEXT_ATTRIBUTES,
): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', attributes);
}

/**
 * Release a context now instead of waiting for garbage collection. Chrome keeps at most
 * 16 live WebGL contexts and silently kills the oldest beyond that ("Too many active
 * WebGL contexts"), so every canvas owner should call this when it is done.
 * After this the canvas can't be used for WebGL again; make a new canvas instead.
 */
export function releaseVisualContext(gl: WebGL2RenderingContext): void {
  if (gl.isContextLost()) return;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/**
 * Read the canvas's drawing buffer as RGBA bytes, bottom row first (GL order). Call it in
 * the same task as `draw()`: the buffer isn't preserved once the browser composites.
 */
export function readDrawingBuffer(gl: WebGL2RenderingContext, out?: Uint8Array): Uint8Array {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels =
    out && out.length === width * height * 4 ? out : new Uint8Array(width * height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}
