/**
 * The Filaments simulation (CPU, typed arrays, no GL), so it can be unit tested in Node
 * and shared unchanged by preview and render.
 *
 * Each strand is a chain of POINTS_PER_STRAND points rooted at a seeded anchor. At rest
 * it lies along a smooth seeded flow with a gentle kelp-like wave. The flow points every
 * way (like hair whorls or wood grain), so no direction of movement is favored: a push
 * toward a strand's root would only buckle it and a push away would only pull it taut,
 * which made a wink's close and open look unequal on hanging strands. Low Dispersion
 * combs the strands into a hanging curtain; high Dispersion tangles them. Every step:
 *   1. the signature field, sampled at each point through the Range projection, pushes
 *      the point (low-passed by Viscosity, scattered by Dispersion); drag slows it; a
 *      spring pulls it back toward its resting place (Elasticity);
 *   2. position-based constraints keep the segments at their length (inextensible) and
 *      the strand near its resting curve (bending stiffness from Rigidity); the root
 *      stays on its anchor;
 *   3. velocities are what the constraints left of the motion.
 * The positions at the start of the step are kept (`ox`, `oy`) so the renderer can paint
 * the area each segment swept.
 *
 * A strand that is still (every point slower than a pixel a second or so), unpushed and
 * not pulled by its spring falls asleep: it keeps its shape and costs nothing until the
 * movement reaches it or its spring would move it. Most movements touch only part of the
 * water, so this saves most of the constraint work; the decision depends only on the
 * state, so preview and render agree.
 *
 * Randomness: `reset(seed)` recreates a seeded PRNG and draws the keys for anchors and
 * shapes; every step draws exactly one more value (the key for this step's jitter),
 * whatever the state. Per-strand and per-point values come from counter-based hashes, so
 * they never depend on how many strands exist.
 *
 * Units: world coordinates in canvas short sides (origin bottom left, y up), seconds.
 */
import { createRng, hash32, hashString32, type Rng } from '../../../chance/prng';
import { ProjectedField, worldSize, type FieldInput } from '../shared/fieldSampling';
import { hash3, hashUnit, highSigned, lowSigned, valueNoise2 } from '../shared/hashNoise';
import type { FilamentSimParams } from './mapping';

/** Seed salt, so the filaments' randomness differs from other materials given the same seed. */
const SALT = hashString32('filaments');

/** Points per strand (the root and the tip included). */
export const POINTS_PER_STRAND = 20;
/** Constraint iterations per step. */
const ITERATIONS = 6;
/** New strands (Density raised during play) fade in over this long, seconds. */
const FADE_IN_SECONDS = 0.6;
/** The resting flow: noise cells per short side, and its second octave's weight. */
const COMB_FREQUENCY = 1.3;
const COMB_DETAIL = 0.35;
/** Mean length of the flow's noise vector (two centred value-noise channels). */
const FLOW_NOISE_SCALE = 0.17;
/** The kelp-like wave along each strand: amplitude (radians) and wavelength (short sides). */
const WAVE_AMPLITUDE = 0.22;
const WAVE_LENGTH = 0.11;
/** Largest per-point deflection of the push at full scatter, radians. */
const SCATTER_ANGLE = 1.4;
/** Strands may reach this far past the canvas edges (in strand lengths). */
const EDGE_MARGIN = 0.25;

/** Plastic-number constants for the R2 low-discrepancy sequence (anchor placement). */
const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;

/** Strands solved side by side (see solveStrands). */
const LANES = 4;
/**
 * Sleep thresholds: speed (short sides per second, about half a pixel a second at 1080p),
 * felt push, and spring pull (short sides per second²) below which a strand may sleep.
 */
const SLEEP_SPEED = 5e-4;
const SLEEP_PUSH = 1e-5;
const SLEEP_PULL = 5e-3;
/**
 * A push slower than this (short sides per second) neither wakes a sleeping strand nor
 * keeps one awake: it would move the strand by a fraction of a pixel. (Smooth fields,
 * like the synthetic wink's, are faintly nonzero almost everywhere.)
 */
const WAKE_PUSH = 2e-3;

/** Length constraint: points i and i + 1 one segment apart (i fixed when it is a root). */
function keepLength(
  x: Float64Array,
  y: Float64Array,
  i: number,
  root: boolean,
  segment: number,
): void {
  const dx = x[i + 1] - x[i];
  const dy = y[i + 1] - y[i];
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-12) return;
  const k = (d - segment) / d;
  if (root) {
    x[i + 1] -= k * dx;
    y[i + 1] -= k * dy;
  } else {
    const h = 0.5 * k;
    x[i] += h * dx;
    y[i] += h * dy;
    x[i + 1] -= h * dx;
    y[i + 1] -= h * dy;
  }
}

/**
 * Curve constraint: interior point b pulled toward where its resting curve puts it
 * relative to its neighbours a = b − 1 and c = b + 1 (target = chord midpoint + along·C +
 * across·perp(C)), the correction spread over a, b, c by their share of the constraint's
 * gradient (a stays put when it is a root).
 */
function keepCurve(
  x: Float64Array,
  y: Float64Array,
  restAlong: Float64Array,
  restAcross: Float64Array,
  b: number,
  rootA: boolean,
  stiffness: number,
): void {
  const a = b - 1;
  const c = b + 1;
  const xa = x[a];
  const ya = y[a];
  const xc = x[c];
  const yc = y[c];
  const cx = xc - xa;
  const cy = yc - ya;
  const along = restAlong[b];
  const across = restAcross[b];
  const ex = x[b] - (0.5 * (xa + xc) + along * cx - across * cy);
  const ey = y[b] - (0.5 * (ya + yc) + along * cy + across * cx);
  const ka = 0.5 - along;
  const kc = 0.5 + along;
  const q = across * across;
  const s = stiffness / (1 + (rootA ? 0 : ka * ka + q) + kc * kc + q);
  x[b] -= s * ex;
  y[b] -= s * ey;
  // a moves by s·(ka·e + across·J e), c by s·(kc·e − across·J e), J e = (−ey, ex).
  if (!rootA) {
    x[a] = xa + s * (ka * ex - across * ey);
    y[a] = ya + s * (ka * ey + across * ex);
  }
  x[c] = xc + s * (kc * ex + across * ey);
  y[c] = yc + s * (kc * ey - across * ex);
}

/**
 * Constraint iterations (Gauss–Seidel) for the strands listed in `strands[from …
 * from + count)`: length along each strand from the root out, then its resting curve.
 * The strands advance side by side, constraint by constraint: each constraint waits on
 * the one before it on the same strand, so interleaving independent strands lets the
 * CPU overlap them. The result is identical to solving the strands one at a time.
 */
function solveStrands(
  x: Float64Array,
  y: Float64Array,
  restAlong: Float64Array,
  restAcross: Float64Array,
  strands: Int32Array,
  from: number,
  count: number,
  segment: number,
  bendStep: number,
): void {
  const N = POINTS_PER_STRAND;
  for (let it = 0; it < ITERATIONS; it++) {
    for (let j = 0; j < N - 1; j++) {
      for (let l = 0; l < count; l++) {
        keepLength(x, y, strands[from + l] * N + j, j === 0, segment);
      }
    }
    if (!(bendStep > 0)) continue;
    for (let j = 1; j < N - 1; j++) {
      for (let l = 0; l < count; l++) {
        keepCurve(x, y, restAlong, restAcross, strands[from + l] * N + j, j === 1, bendStep);
      }
    }
  }
}

/** Hash channels. */
const CH_TINT = 0x1100;
const CH_GLOW = 0x1200;
const CH_WAVE = 0x1300;
const CH_DEFLECT = 0x1400;
const CH_STEP = 0x5f3a;

export class FilamentSim {
  /** Most strands this instance can hold (the quality tier's cap). */
  readonly capacity: number;
  readonly pointsPerStrand = POINTS_PER_STRAND;
  /** Strands in play: [0, count). */
  count = 0;
  /** Steps since reset. */
  steps = 0;
  /** Canvas size in world units (short sides). */
  worldWidth = 16 / 9;
  worldHeight = 1;

  /** Per point (strand f, point j at f × POINTS_PER_STRAND + j): position now, */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** ... at the start of the last step, */
  readonly ox: Float64Array;
  readonly oy: Float64Array;
  /** ... velocity, */
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** ... resting place, */
  readonly rx: Float64Array;
  readonly ry: Float64Array;
  /** ... the push as felt (low-passed), */
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  /** ... the resting curve in its neighbours' frame (along and across the chord), */
  readonly restAlong: Float64Array;
  readonly restAcross: Float64Array;
  /** ... and a fixed deflection of the push (−1..1). */
  readonly deflect: Float64Array;
  /** Per strand: tint (−1..1), brightness factor, appearance (0..1), segment length. */
  readonly tint: Float64Array;
  readonly glow: Float64Array;
  readonly appear: Float64Array;
  readonly segment: Float64Array;
  /** Per strand: 1 while asleep (still, unpushed, unpulled). */
  readonly asleep: Uint8Array;
  /**
   * Let still strands sleep (see the file header). Tests may turn it off to compare; the
   * difference is a fraction of a pixel.
   */
  sleeping = true;

  private readonly awake: Int32Array;
  private readonly pushed: Uint8Array;
  private rng: Rng = createRng(0);
  private shapeKey = 0;
  private stepKey = 0;
  private offsetU = 0;
  private offsetV = 0;
  private shapeLength = -1;
  private shapeTangle = -1;
  private readonly field = new ProjectedField();
  private canvasWidth = 1600;
  private canvasHeight = 900;

  constructor(capacity: number, width = 1600, height = 900) {
    this.capacity = Math.max(1, Math.floor(capacity));
    const n = this.capacity * POINTS_PER_STRAND;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.ox = new Float64Array(n);
    this.oy = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.rx = new Float64Array(n);
    this.ry = new Float64Array(n);
    this.fx = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.restAlong = new Float64Array(n);
    this.restAcross = new Float64Array(n);
    this.deflect = new Float64Array(n);
    this.tint = new Float64Array(this.capacity);
    this.glow = new Float64Array(this.capacity);
    this.appear = new Float64Array(this.capacity);
    this.segment = new Float64Array(this.capacity);
    this.asleep = new Uint8Array(this.capacity);
    this.awake = new Int32Array(this.capacity);
    this.pushed = new Uint8Array(this.capacity);
    this.setCanvas(width, height);
  }

  /** Strands awake after the last step (for tests and diagnostics). */
  get awakeCount(): number {
    let n = 0;
    for (let f = 0; f < this.count; f++) if (this.asleep[f] === 0) n++;
    return n;
  }

  /** The canvas's pixel size (only its aspect ratio matters to the simulation). */
  setCanvas(width: number, height: number): void {
    this.canvasWidth = Math.max(1, width);
    this.canvasHeight = Math.max(1, height);
    const world = worldSize(this.canvasWidth, this.canvasHeight);
    this.worldWidth = world.width;
    this.worldHeight = world.height;
  }

  /** The initial state for this seed. The first step lays the strands out (`populate`). */
  reset(seed: number): void {
    this.rng = createRng(hash32(seed, SALT));
    this.shapeKey = Math.floor(this.rng() * 4294967296) >>> 0;
    this.offsetU = this.rng();
    this.offsetV = this.rng();
    this.stepKey = 0;
    this.count = 0;
    this.steps = 0;
    this.shapeLength = -1;
    this.shapeTangle = -1;
  }

  get populated(): boolean {
    return this.count > 0;
  }

  /**
   * Lay out `p.count` strands at rest. Runs on the first step after reset with that
   * step's properties; a host may also call it before any step to show t = 0.
   */
  populate(p: FilamentSimParams): void {
    const n = Math.min(this.capacity, Math.max(0, Math.floor(p.count)));
    this.shapeLength = p.length;
    this.shapeTangle = p.tangle;
    for (let f = 0; f < n; f++) {
      this.buildStrand(f, p);
      this.placeAtRest(f);
      this.appear[f] = 1;
    }
    this.count = n;
  }

  /** Advance one fixed step. */
  step(input: FieldInput, p: FilamentSimParams, dt: number): void {
    if (this.steps === 0) this.populate(p);
    const n = Math.min(this.capacity, Math.max(0, Math.floor(p.count)));
    if (p.length !== this.shapeLength || p.tangle !== this.shapeTangle) {
      this.reshape(p);
    }
    // More strands (Density raised during play): they grow in at rest and fade in.
    for (let f = this.count; f < n; f++) {
      this.buildStrand(f, p);
      this.placeAtRest(f);
      this.appear[f] = 0;
    }
    this.count = n;
    // Exactly one draw per step, whatever the state.
    this.stepKey = Math.floor(this.rng() * 4294967296) >>> 0;
    this.field.set(input, p.range, this.canvasWidth, this.canvasHeight);

    const N = POINTS_PER_STRAND;
    const invDt = dt > 0 ? 1 / dt : 0;
    const lagK = p.lagSec > 0 ? 1 - Math.exp(-dt / p.lagSec) : 1;
    const dragDecay = Math.exp(-Math.max(0, p.drag) * dt);
    const gain = p.forceGain;
    const spring = Math.max(0, p.spring);
    const bend = Math.min(1, Math.max(0, p.bend));
    const bendStep = 1 - (1 - bend) ** (1 / ITERATIONS);
    const scatter = Math.max(0, p.scatter);
    const appearStep = dt / FADE_IN_SECONDS;
    const field = this.field;
    const pushing = field.maxSpeed > 0;
    const { x, y, ox, oy, vx, vy, rx, ry, fx, fy, asleep, pushed } = this;
    const awakeList = this.awake;
    let awake = 0;

    // 1. Forces: the push, drag and the spring toward rest. Sleeping strands only check
    // whether something would move them.
    for (let f = 0; f < n; f++) {
      if (this.appear[f] < 1) this.appear[f] = Math.min(1, this.appear[f] + appearStep);
      const base = f * N;
      if (asleep[f] === 1) {
        if (!this.shouldWake(base, pushing, spring)) {
          for (let i = base; i < base + N; i++) {
            ox[i] = x[i];
            oy[i] = y[i];
          }
          continue;
        }
        asleep[f] = 0;
      }
      awakeList[awake++] = f;
      let anyPush = 0;
      // The root stays on its anchor.
      ox[base] = x[base] = rx[base];
      oy[base] = y[base] = ry[base];
      vx[base] = 0;
      vy[base] = 0;
      for (let j = 1; j < N; j++) {
        const i = base + j;
        const px = x[i];
        const py = y[i];
        ox[i] = px;
        oy[i] = py;
        let pu = 0;
        let pv = 0;
        if (pushing && field.sample(px, py) > 0) {
          pu = field.u;
          pv = field.v;
          if (pu * pu + pv * pv > WAKE_PUSH * WAKE_PUSH) anyPush = 1;
          if (scatter > 0) {
            const a = SCATTER_ANGLE * scatter * this.deflect[i];
            const c = Math.cos(a);
            const s = Math.sin(a);
            const ru = c * pu - s * pv;
            pv = s * pu + c * pv;
            pu = ru;
            // A little turbulence on top, fresh every step.
            const h = hash3(this.stepKey, i, CH_STEP);
            const m = scatter * 0.35 * Math.sqrt(pu * pu + pv * pv);
            pu += m * lowSigned(h);
            pv += m * highSigned(h);
          }
        }
        const lx = fx[i] + (pu - fx[i]) * lagK;
        const ly = fy[i] + (pv - fy[i]) * lagK;
        fx[i] = lx;
        fy[i] = ly;
        const nvx = vx[i] * dragDecay + (gain * lx + spring * (rx[i] - px)) * dt;
        const nvy = vy[i] * dragDecay + (gain * ly + spring * (ry[i] - py)) * dt;
        vx[i] = nvx;
        vy[i] = nvy;
        x[i] = px + nvx * dt;
        y[i] = py + nvy * dt;
      }
      pushed[f] = anyPush;
    }

    // 2. Constraints: length (the roots are fixed) and the resting curve. Every strand
    // has the same segment length (they share Length).
    const segment = n > 0 ? this.segment[0] : 0;
    for (let k = 0; k < awake; k += LANES) {
      const lanes = Math.min(LANES, awake - k);
      solveStrands(x, y, this.restAlong, this.restAcross, awakeList, k, lanes, segment, bendStep);
    }

    // 3. Velocity is what the constraints left of the motion; still strands fall asleep.
    const sleepSpeed2 = SLEEP_SPEED * SLEEP_SPEED;
    const sleepPush2 = SLEEP_PUSH * SLEEP_PUSH;
    for (let k = 0; k < awake; k++) {
      const f = awakeList[k];
      const base = f * N;
      let still = this.sleeping && pushed[f] === 0;
      for (let i = base + 1; i < base + N; i++) {
        const nvx = (x[i] - ox[i]) * invDt;
        const nvy = (y[i] - oy[i]) * invDt;
        vx[i] = nvx;
        vy[i] = nvy;
        if (
          still &&
          (nvx * nvx + nvy * nvy > sleepSpeed2 || fx[i] * fx[i] + fy[i] * fy[i] > sleepPush2)
        ) {
          still = false;
        }
      }
      if (still && !this.shouldWake(base, false, spring)) {
        asleep[f] = 1;
        for (let i = base; i < base + N; i++) {
          vx[i] = 0;
          vy[i] = 0;
          fx[i] = 0;
          fy[i] = 0;
        }
      }
    }
    this.steps++;
  }

  /**
   * Would anything move sleeping strand (points base …)? The movement reaching one of its
   * points, or its spring pulling harder than SLEEP_PULL.
   */
  private shouldWake(base: number, pushing: boolean, spring: number): boolean {
    const end = base + POINTS_PER_STRAND;
    if (pushing) {
      const field = this.field;
      const wake2 = WAKE_PUSH * WAKE_PUSH;
      for (let i = base + 1; i < end; i++) {
        if (
          field.sample(this.x[i], this.y[i]) > 0 &&
          field.u * field.u + field.v * field.v > wake2
        ) {
          return true;
        }
      }
    }
    if (spring > 0) {
      const limit = (SLEEP_PULL / spring) ** 2;
      for (let i = base + 1; i < end; i++) {
        const dx = this.x[i] - this.rx[i];
        const dy = this.y[i] - this.ry[i];
        if (dx * dx + dy * dy > limit) return true;
      }
    }
    return false;
  }

  /** Mean distance of the strands' points from their resting places (for tests). */
  meanDisplacement(): number {
    const N = POINTS_PER_STRAND;
    let sum = 0;
    let n = 0;
    for (let f = 0; f < this.count; f++) {
      for (let j = 1; j < N; j++) {
        const i = f * N + j;
        sum += Math.hypot(this.x[i] - this.rx[i], this.y[i] - this.ry[i]);
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  }

  /** Put strand f's points on its resting places, still. */
  private placeAtRest(f: number): void {
    const N = POINTS_PER_STRAND;
    this.asleep[f] = 0;
    for (let j = 0; j < N; j++) {
      const i = f * N + j;
      this.x[i] = this.ox[i] = this.rx[i];
      this.y[i] = this.oy[i] = this.ry[i];
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.fx[i] = 0;
      this.fy[i] = 0;
    }
  }

  /** Length or Dispersion changed during play: new resting shapes; strands follow. */
  private reshape(p: FilamentSimParams): void {
    const N = POINTS_PER_STRAND;
    const scale = this.shapeLength > 0 ? p.length / this.shapeLength : 1;
    this.shapeLength = p.length;
    this.shapeTangle = p.tangle;
    for (let f = 0; f < this.count; f++) {
      const base = f * N;
      this.asleep[f] = 0;
      // Scale the current shape about the root so segment lengths match at once.
      const x0 = this.x[base];
      const y0 = this.y[base];
      for (let j = 1; j < N; j++) {
        const i = base + j;
        this.x[i] = x0 + (this.x[i] - x0) * scale;
        this.y[i] = y0 + (this.y[i] - y0) * scale;
        this.ox[i] = this.x[i];
        this.oy[i] = this.y[i];
      }
      const oldRootX = this.rx[base];
      const oldRootY = this.ry[base];
      this.buildStrand(f, p);
      // Keep the strand where it was: shift the new shape onto the current root.
      const sx = oldRootX - this.rx[base];
      const sy = oldRootY - this.ry[base];
      for (let j = 0; j < N; j++) {
        this.rx[base + j] += sx;
        this.ry[base + j] += sy;
      }
    }
  }

  /** Seeded anchor, resting shape and looks of strand f. */
  private buildStrand(f: number, p: FilamentSimParams): void {
    const N = POINTS_PER_STRAND;
    const base = f * N;
    const W = this.worldWidth;
    const H = this.worldHeight;
    const length = Math.max(1e-4, p.length);
    const segment = length / (N - 1);
    this.segment[f] = segment;
    this.tint[f] = hashUnit(this.shapeKey + CH_TINT, f, 0) * 2 - 1;
    this.glow[f] = 0.7 + 0.6 * hashUnit(this.shapeKey + CH_GLOW, f, 0);

    // Where the strand's middle lies: a low-discrepancy sequence over the canvas (plus a
    // margin), so strands cover it evenly whatever their number.
    const u = (this.offsetU + (f + 1) * R2_A) % 1;
    const v = (this.offsetV + (f + 1) * R2_B) % 1;
    const margin = EDGE_MARGIN * length;
    const midX = -margin + (W + 2 * margin) * u;
    const midY = -margin + (H + 2 * margin) * v;

    // Grow the resting shape from the first point along the flow (with a wave), then
    // shift it so its middle lands on (midX, midY). The flow's direction is a noise
    // vector (isotropic) plus a pull toward hanging down that fades as `tangle` grows.
    const freedom = Math.min(1, Math.max(0, p.tangle));
    const hang = (1 - freedom) * FLOW_NOISE_SCALE * 3;
    // Beyond full freedom, tangling shrinks the whorls.
    const frequency = COMB_FREQUENCY * (1 + 1.5 * Math.max(0, p.tangle - 1));
    const wavePhase = hashUnit(this.shapeKey + CH_WAVE, f, 0) * Math.PI * 2;
    const key = this.shapeKey;
    const channel = (k: number, px: number, py: number): number =>
      (valueNoise2(k, px * frequency, py * frequency) +
        COMB_DETAIL * valueNoise2(k + 7, px * frequency * 2.3, py * frequency * 2.3)) /
        (1 + COMB_DETAIL) -
      0.5;
    const heading = (px: number, py: number, s: number): number => {
      const hx = freedom * channel(key, px, py);
      const hy = freedom * channel(key + 3, px, py) - hang;
      return (
        Math.atan2(hy, hx) + WAVE_AMPLITUDE * Math.sin((2 * Math.PI * s) / WAVE_LENGTH + wavePhase)
      );
    };
    let px = midX;
    let py = midY;
    this.rx[base] = px;
    this.ry[base] = py;
    for (let j = 1; j < N; j++) {
      const a = heading(px, py, j * segment);
      px += segment * Math.cos(a);
      py += segment * Math.sin(a);
      this.rx[base + j] = px;
      this.ry[base + j] = py;
    }
    const mid = base + (N >> 1);
    const sx = midX - this.rx[mid];
    const sy = midY - this.ry[mid];
    for (let j = 0; j < N; j++) {
      this.rx[base + j] += sx;
      this.ry[base + j] += sy;
      this.deflect[base + j] = hashUnit(key + CH_DEFLECT, f, j) * 2 - 1;
    }

    // The resting curve, in each interior point's neighbour frame.
    for (let j = 1; j < N - 1; j++) {
      const i = base + j;
      const cx = this.rx[i + 1] - this.rx[i - 1];
      const cy = this.ry[i + 1] - this.ry[i - 1];
      const c2 = cx * cx + cy * cy;
      const ox = this.rx[i] - 0.5 * (this.rx[i - 1] + this.rx[i + 1]);
      const oy = this.ry[i] - 0.5 * (this.ry[i - 1] + this.ry[i + 1]);
      this.restAlong[i] = c2 > 0 ? (ox * cx + oy * cy) / c2 : 0;
      this.restAcross[i] = c2 > 0 ? (cx * oy - cy * ox) / c2 : 0;
    }
    this.restAlong[base] = 0;
    this.restAcross[base] = 0;
    this.restAlong[base + N - 1] = 0;
    this.restAcross[base + N - 1] = 0;
  }
}
