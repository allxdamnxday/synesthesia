/**
 * Tracks every WebGL object a material creates so `dispose()` can free all of them.
 * Create GL objects through a `GlResources` (never straight from `gl`) and call
 * `dispose()` once when the material is disposed. Deleting on a lost context is a
 * harmless no-op, so disposing after context loss is safe.
 */
export interface GlResourceCounts {
  textures: number;
  framebuffers: number;
  buffers: number;
  vertexArrays: number;
  programs: number;
  shaders: number;
}

export class GlResources {
  readonly gl: WebGL2RenderingContext;
  private readonly textures = new Set<WebGLTexture>();
  private readonly framebuffers = new Set<WebGLFramebuffer>();
  private readonly buffers = new Set<WebGLBuffer>();
  private readonly vertexArrays = new Set<WebGLVertexArrayObject>();
  private readonly programs = new Set<WebGLProgram>();
  private readonly shaders = new Set<WebGLShader>();
  private disposed = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  texture(): WebGLTexture {
    return this.track(this.textures, () => this.gl.createTexture(), 'texture');
  }

  framebuffer(): WebGLFramebuffer {
    return this.track(this.framebuffers, () => this.gl.createFramebuffer(), 'framebuffer');
  }

  buffer(): WebGLBuffer {
    return this.track(this.buffers, () => this.gl.createBuffer(), 'buffer');
  }

  vertexArray(): WebGLVertexArrayObject {
    return this.track(this.vertexArrays, () => this.gl.createVertexArray(), 'vertex array');
  }

  program(): WebGLProgram {
    return this.track(this.programs, () => this.gl.createProgram(), 'program');
  }

  shader(type: number): WebGLShader {
    return this.track(this.shaders, () => this.gl.createShader(type), 'shader');
  }

  deleteTexture(texture: WebGLTexture): void {
    if (this.textures.delete(texture)) this.gl.deleteTexture(texture);
  }

  deleteFramebuffer(framebuffer: WebGLFramebuffer): void {
    if (this.framebuffers.delete(framebuffer)) this.gl.deleteFramebuffer(framebuffer);
  }

  deleteShader(shader: WebGLShader): void {
    if (this.shaders.delete(shader)) this.gl.deleteShader(shader);
  }

  /** Live object counts (for tests and diagnostics). */
  counts(): GlResourceCounts {
    return {
      textures: this.textures.size,
      framebuffers: this.framebuffers.size,
      buffers: this.buffers.size,
      vertexArrays: this.vertexArrays.size,
      programs: this.programs.size,
      shaders: this.shaders.size,
    };
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Free every tracked object. Safe to call more than once. */
  dispose(): void {
    const gl = this.gl;
    for (const x of this.framebuffers) gl.deleteFramebuffer(x);
    for (const x of this.textures) gl.deleteTexture(x);
    for (const x of this.vertexArrays) gl.deleteVertexArray(x);
    for (const x of this.buffers) gl.deleteBuffer(x);
    for (const x of this.programs) gl.deleteProgram(x);
    for (const x of this.shaders) gl.deleteShader(x);
    this.framebuffers.clear();
    this.textures.clear();
    this.vertexArrays.clear();
    this.buffers.clear();
    this.programs.clear();
    this.shaders.clear();
    this.disposed = true;
  }

  private track<T extends object>(set: Set<T>, create: () => T | null, what: string): T {
    if (this.disposed) {
      throw new Error(`Tried to create a WebGL ${what} after dispose(); create a new instance.`);
    }
    // The DOM typings say these never return null, but they do on a lost context.
    const value = create();
    if (value === null) {
      throw new Error(`Could not create a WebGL ${what}: the graphics context was lost.`);
    }
    set.add(value);
    return value;
  }
}
