/**
 * Shader compile and link helpers with readable errors. Sources are GLSL ES 3.00 bodies
 * without the `#version` line; `#version 300 es` and any `#define`s are prepended here,
 * and error messages quote the offending lines of the final source.
 */
import type { GlResources } from './resources';

export interface ShaderProgram {
  readonly name: string;
  readonly program: WebGLProgram;
  /** Active uniform locations by name (arrays also by their base name). */
  readonly uniforms: ReadonlyMap<string, WebGLUniformLocation>;
  /** Location of a uniform, or null if the driver optimized it away. */
  u(name: string): WebGLUniformLocation | null;
  use(): void;
}

/** Prepend the version line and defines to a shader body. */
export function withHeader(source: string, defines: readonly string[] = []): string {
  const header = ['#version 300 es', ...defines.map((d) => `#define ${d}`)].join('\n');
  return `${header}\n${source.replace(/^\s*\n/, '')}`;
}

/**
 * Turn a driver info log into a message that shows the failing lines with numbers.
 * Drivers report locations as `ERROR: 0:<line>:`; anything else is passed through.
 */
export function formatShaderError(
  name: string,
  stage: string,
  log: string,
  source: string,
): string {
  const lines = source.split('\n');
  const wanted = new Set<number>();
  for (const match of log.matchAll(/(?:ERROR|WARNING):\s*\d+:(\d+)/g)) {
    const line = Number(match[1]);
    for (let i = line - 2; i <= line + 2; i++) if (i >= 1 && i <= lines.length) wanted.add(i);
  }
  const excerpt = [...wanted]
    .sort((a, b) => a - b)
    .map((i) => `${String(i).padStart(4)} | ${lines[i - 1] ?? ''}`)
    .join('\n');
  return `${stage} shader "${name}" failed to compile:\n${log.trim()}${excerpt ? `\n${excerpt}` : ''}`;
}

export function compileShader(
  res: GlResources,
  type: number,
  source: string,
  name: string,
): WebGLShader {
  const gl = res.gl;
  const shader = res.shader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    const stage = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
    res.deleteShader(shader);
    throw new Error(formatShaderError(name, stage, log, source));
  }
  return shader;
}

export interface ProgramOptions {
  name: string;
  defines?: readonly string[];
}

/**
 * Link a program from a compiled (shared) vertex shader or a vertex source, and a
 * fragment source body. Throws a readable error on failure.
 */
export function createProgram(
  res: GlResources,
  vertex: WebGLShader | string,
  fragmentBody: string,
  options: ProgramOptions,
): ShaderProgram {
  const gl = res.gl;
  const { name, defines = [] } = options;
  const vs =
    typeof vertex === 'string'
      ? compileShader(res, gl.VERTEX_SHADER, withHeader(vertex, defines), `${name} (vertex)`)
      : vertex;
  const fs = compileShader(res, gl.FRAGMENT_SHADER, withHeader(fragmentBody, defines), name);
  const program = res.program();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    throw new Error(`Program "${name}" failed to link:\n${log.trim()}`);
  }
  // The fragment shader is only used by this program; free it once linked.
  gl.detachShader(program, fs);
  res.deleteShader(fs);

  const uniforms = new Map<string, WebGLUniformLocation>();
  const count = (gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number | null) ?? 0;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const location = gl.getUniformLocation(program, info.name);
    if (!location) continue;
    uniforms.set(info.name, location);
    if (info.name.endsWith('[0]')) uniforms.set(info.name.slice(0, -3), location);
  }
  return {
    name,
    program,
    uniforms,
    u: (uniform: string) => uniforms.get(uniform) ?? null,
    use: () => gl.useProgram(program),
  };
}
