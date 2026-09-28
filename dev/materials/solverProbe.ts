/**
 * Exercises the FluidSolver's extension points the way Smoke will use them: a custom
 * temperature field (createFieldTarget), a heat pass and a buoyancy pass (createPass,
 * blit) in the beforeProjection hook, and advect() in the afterAdvection hook. It is a
 * working sketch for the Smoke and Honey authors as much as a test.
 */
import { FIXED_DT } from '../../src/materials/types';
import {
  DEFAULT_STEP_PARAMS,
  FluidSolver,
  buildPalette,
} from '../../src/materials/visual/shared/fluid';
import {
  bindTexture,
  getVisualContext,
  readDrawingBuffer,
  releaseVisualContext,
} from '../../src/materials/visual/shared/gl';
import { meanLuma, sha256Hex } from '../../src/perf/offscreenRender';
import { createSyntheticSampler } from '../../src/signature/synthetic';

/** Adds heat in a soft blob low in the bowl. */
const HEAT_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uTemperature;
uniform float uAmount;
out vec4 fragColor;
void main () {
  float t = texture(uTemperature, vUv).x;
  vec2 d = vUv - vec2(0.5, 0.25);
  t += uAmount * exp(-dot(d, d) / 0.004);
  fragColor = vec4(t, 0.0, 0.0, 1.0);
}
`;

/** Warm fluid rises: adds temperature × lift to the upward velocity. */
const BUOYANCY_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uTemperature;
uniform float uLift;
out vec4 fragColor;
void main () {
  vec2 v = texture(uVelocity, vUv).xy;
  float t = texture(uTemperature, vUv).x;
  fragColor = vec4(v + vec2(0.0, uLift * t), 0.0, 1.0);
}
`;

export interface SolverProbeResult {
  withHooks: { hash: string; meanLuma: number };
  withoutHooks: { hash: string; meanLuma: number };
  hookCalls: number;
  glErrors: number;
}

async function run(
  useHooks: boolean,
): Promise<{ hash: string; meanLuma: number; calls: number; errors: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const gl = getVisualContext(canvas);
  if (!gl) throw new Error('WebGL2 is not available.');
  const solver = new FluidSolver(gl, { quality: 'draft', width: 320, height: 180 });
  let calls = 0;
  try {
    solver.setPalette(buildPalette(() => [0.9, 0.9, 0.9]));
    if (useHooks) {
      const temperature = solver.createFieldTarget('r');
      const heat = solver.createPass(HEAT_FRAGMENT, 'probe heat');
      const lift = solver.createPass(BUOYANCY_FRAGMENT, 'probe buoyancy');
      solver.hooks = {
        beforeProjection: ({ gl: g, solver: s, params }) => {
          calls++;
          heat.use();
          g.uniform1f(heat.u('uAmount'), 2 * params.dt);
          g.uniform1i(heat.u('uTemperature'), bindTexture(g, 0, temperature.read.texture));
          s.blit(temperature.write);
          temperature.swap();
          lift.use();
          g.uniform1f(lift.u('uLift'), 40 * params.dt);
          g.uniform1i(lift.u('uVelocity'), bindTexture(g, 0, s.velocity.read.texture));
          g.uniform1i(lift.u('uTemperature'), bindTexture(g, 1, temperature.read.texture));
          s.blit(s.velocity.write);
          s.velocity.swap();
        },
        afterAdvection: ({ solver: s, params }) => {
          calls++;
          s.advect(temperature, params.dt, 0.5);
        },
      };
    }
    const sampler = createSyntheticSampler('sweep');
    for (let i = 0; i < 90; i++) {
      const frame = sampler.sample(i * FIXED_DT);
      solver.step(frame, { ...DEFAULT_STEP_PARAMS, dt: FIXED_DT });
    }
    solver.display({ exposure: 1, saturation: 1, surfaceLight: 0 });
    const pixels = readDrawingBuffer(gl);
    let errors = 0;
    while (gl.getError() !== gl.NO_ERROR) errors++;
    return { hash: await sha256Hex(pixels), meanLuma: meanLuma(pixels), calls, errors };
  } finally {
    solver.dispose();
    releaseVisualContext(gl);
  }
}

export async function solverHookProbe(): Promise<SolverProbeResult> {
  const withHooks = await run(true);
  const withoutHooks = await run(false);
  return {
    withHooks: { hash: withHooks.hash, meanLuma: withHooks.meanLuma },
    withoutHooks: { hash: withoutHooks.hash, meanLuma: withoutHooks.meanLuma },
    hookCalls: withHooks.calls,
    glErrors: withHooks.errors + withoutHooks.errors,
  };
}
