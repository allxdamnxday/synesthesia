/**
 * Counts the WebGL contexts this page creates and releases, and notices any context the
 * browser kills on its own (Chrome keeps at most 16 live contexts and silently loses the
 * oldest, logging "Too many active WebGL contexts").
 */
import { getVisualContext, releaseVisualContext } from '../../src/materials/visual/shared/gl';

export interface ContextCounts {
  created: number;
  released: number;
  live: number;
  /** Contexts lost while we still held them (the browser took them back). */
  unexpectedLosses: number;
}

const live = new Set<WebGL2RenderingContext>();
let created = 0;
let released = 0;
let unexpectedLosses = 0;

export function acquireContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  const gl = getVisualContext(canvas);
  if (!gl) return null;
  created++;
  live.add(gl);
  canvas.addEventListener('webglcontextlost', () => {
    if (live.has(gl)) unexpectedLosses++;
  });
  return gl;
}

export function releaseContext(gl: WebGL2RenderingContext): void {
  if (!live.delete(gl)) return;
  released++;
  releaseVisualContext(gl);
}

export function contextCounts(): ContextCounts {
  return { created, released, live: live.size, unexpectedLosses };
}
