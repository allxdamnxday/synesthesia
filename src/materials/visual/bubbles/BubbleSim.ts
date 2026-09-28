/**
 * The Descending bubbles simulation (CPU, typed arrays, no GL), so it can be unit tested
 * in Node and shared unchanged by preview and render.
 *
 * Each bubble follows a falling *path* (it sinks at its own speed and wanders a little)
 * plus a *displacement* that only the signature causes: the field, sampled at the bubble,
 * pushes the displacement, drag slows it, and an optional spring pulls it back to the
 * path. Splitting the two keeps the push readable (drag acts on the pushed motion, not on
 * the fall) and makes Elasticity's spring-back exact. A bubble lives until it sinks out of
 * view, and a new one starts above the top edge. A pushed bubble also wears out with its
 * pushed speed (faster at low Persistence): it pops, then re-forms on its undisturbed
 * path, so a short-lived wake heals instead of leaving a hole.
 *
 * Randomness: `reset(seed)` recreates a seeded PRNG and draws the keys for spawning;
 * every step draws exactly one more value (the key for this step's wandering), whatever
 * the state. Per-bubble values come from counter-based hashes of (key, slot, generation),
 * so they never depend on how many bubbles exist or which died first.
 *
 * Units: world coordinates in canvas short sides (origin bottom left, y up), seconds.
 */
import { createRng, hash32, hashString32, type Rng } from '../../../chance/prng';
import { ProjectedField, worldSize, type FieldInput } from '../shared/fieldSampling';
import {
  UNIFORM_TO_UNIT_VARIANCE,
  hash3,
  highSigned,
  hashUnit,
  lowSigned,
} from '../shared/hashNoise';
import type { BubbleSimParams } from './mapping';

/** Seed salt, so the bubbles' randomness differs from other materials given the same seed. */
const SALT = hashString32('bubbles');

/** Spawn attribute channels (mixed into the spawn key). */
const CH_X = 0x1000;
const CH_STREAM = 0x2000;
const CH_JITTER = 0x3000;
const CH_Y = 0x4000;
const CH_SIZE = 0x5000;
const CH_FRAGILITY = 0x6000;
const CH_DEFLECT = 0x7000;
const CH_PHASE = 0x8000;
const CH_WALK = 0x9000;
const CH_AXIS = 0xa000;
/** Channel for this step's wandering (mixed with the step key). */
const CH_STEP = 0x2f6b;

/** New bubbles start this far above the top edge (plus a seeded band), short sides. */
export const SPAWN_ABOVE = 0.05;
const SPAWN_BAND = 0.06;
/** A bubble this far below the bottom edge is gone. */
export const EXIT_BELOW = 0.06;
/** Horizontal margin: bubbles may start and wander this far past the sides. */
const SIDE_MARGIN = 0.04;
/** Stream spacing at low Dispersion: about this many strings per short side of width. */
const STREAMS_PER_UNIT = 6.5;
/** Speed of the pushed motion at which a bubble's glow is full (short sides per second). */
export const GLOW_SPEED = 0.35;
/** How quickly the glow rises to a new push (1/s). */
const GLOW_ATTACK = 25;
/** How quickly the wobble axis turns toward a new push. */
const AXIS_FOLLOW = 3;
const WOBBLE_MIN = -0.45;
const WOBBLE_MAX = 0.7;
/** Most wear a push adds per second, in units of full glow speed. */
const WEAR_SPEED_CAP = 2;
/** How long a worn-out bubble takes to pop (swell and fade), seconds. */
export const POP_SECONDS = 0.3;
/** How long a popped bubble takes to re-form on its path (grow and fade in), seconds. */
export const REFORM_SECONDS = 0.5;

export class BubbleSim {
  /** Most bubbles this instance can hold (the quality tier's cap). */
  readonly capacity: number;
  /** Bubbles in play: slots [0, count). */
  count = 0;
  /** Steps since reset. */
  steps = 0;
  /** Canvas size in world units (short sides). */
  worldWidth = 16 / 9;
  worldHeight = 1;

  /** Falling path (world units). */
  readonly px: Float64Array;
  readonly py: Float64Array;
  /** Displacement from the path caused by the signature, and its velocity. */
  readonly dx: Float64Array;
  readonly dy: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** The push as felt (low-passed field velocity). */
  readonly lx: Float64Array;
  readonly ly: Float64Array;
  /** Wandering velocity. */
  readonly wx: Float64Array;
  readonly wy: Float64Array;
  /** Size factor (1 = mean), fall factor, fragility factor, push deflection (−1..1). */
  readonly size: Float64Array;
  readonly fall: Float64Array;
  readonly fragility: Float64Array;
  readonly deflect: Float64Array;
  /**
   * Wear: 0..1 while whole; 1..2 while popping (1 + share of the pop done); 2..3 while
   * re-forming on the path (2 + share done), then whole again.
   */
  readonly wear: Float64Array;
  /** Glow: a vector along the last push, length = strength. */
  readonly gx: Float64Array;
  readonly gy: Float64Array;
  /** Wobble: stretch along the axis (negative squashes), its rate, and the axis. */
  readonly wob: Float64Array;
  readonly wobV: Float64Array;
  readonly axX: Float64Array;
  readonly axY: Float64Array;
  /** Spawn generation per slot. */
  readonly gen: Uint32Array;

  private rng: Rng = createRng(0);
  private spawnKey = 0;
  private streamKey = 0;
  private stepKey = 0;
  private streamCount = 1;
  private readonly field = new ProjectedField();
  private canvasWidth = 1600;
  private canvasHeight = 900;

  constructor(capacity: number, width = 1600, height = 900) {
    this.capacity = Math.max(1, Math.floor(capacity));
    const n = this.capacity;
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.dx = new Float64Array(n);
    this.dy = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.lx = new Float64Array(n);
    this.ly = new Float64Array(n);
    this.wx = new Float64Array(n);
    this.wy = new Float64Array(n);
    this.size = new Float64Array(n);
    this.fall = new Float64Array(n);
    this.fragility = new Float64Array(n);
    this.deflect = new Float64Array(n);
    this.wear = new Float64Array(n);
    this.gx = new Float64Array(n);
    this.gy = new Float64Array(n);
    this.wob = new Float64Array(n);
    this.wobV = new Float64Array(n);
    this.axX = new Float64Array(n);
    this.axY = new Float64Array(n);
    this.gen = new Uint32Array(n);
    this.setCanvas(width, height);
  }

  /** The canvas's pixel size (only its aspect ratio matters to the simulation). */
  setCanvas(width: number, height: number): void {
    this.canvasWidth = Math.max(1, width);
    this.canvasHeight = Math.max(1, height);
    const world = worldSize(this.canvasWidth, this.canvasHeight);
    this.worldWidth = world.width;
    this.worldHeight = world.height;
    this.streamCount = Math.max(3, Math.round(STREAMS_PER_UNIT * this.worldWidth));
  }

  /** The initial state for this seed. The first step fills the water (see `populate`). */
  reset(seed: number): void {
    this.rng = createRng(hash32(seed, SALT));
    this.spawnKey = Math.floor(this.rng() * 4294967296) >>> 0;
    this.streamKey = Math.floor(this.rng() * 4294967296) >>> 0;
    this.stepKey = 0;
    this.count = 0;
    this.steps = 0;
    this.gen.fill(0);
  }

  /** True once the water holds bubbles (after the first step, or `populate`). */
  get populated(): boolean {
    return this.count > 0;
  }

  /**
   * Fill the water as if bubbles had been falling for a long time (every bubble at a
   * seeded point of its fall), so the movement meets a full field from t = 0. Runs on
   * the first step after reset with that step's properties; a host may also call it
   * before any step to show t = 0 (the first step then fills again, identically when the
   * properties match).
   */
  populate(p: BubbleSimParams): void {
    const n = Math.min(this.capacity, Math.max(0, Math.floor(p.count)));
    for (let i = 0; i < n; i++) {
      this.gen[i] = 0;
      this.spawn(i, p, hashUnit(this.spawnKey + CH_PHASE, i, 0));
    }
    this.count = n;
  }

  /** Advance one fixed step. */
  step(input: FieldInput, p: BubbleSimParams, dt: number): void {
    if (this.steps === 0) this.populate(p);
    const n = Math.min(this.capacity, Math.max(0, Math.floor(p.count)));
    // More bubbles (Density raised during play): the new ones start above the top edge.
    for (let i = this.count; i < n; i++) {
      this.gen[i] += 1;
      this.spawn(i, p, -1);
    }
    this.count = n;
    // Exactly one draw per step, whatever the state.
    this.stepKey = Math.floor(this.rng() * 4294967296) >>> 0;
    this.field.set(input, p.range, this.canvasWidth, this.canvasHeight);

    const W = this.worldWidth;
    const H = this.worldHeight;
    const invDt = dt > 0 ? 1 / dt : 0;
    const popRate = Math.max(0, p.popRate);
    const popStep = dt / POP_SECONDS;
    const reformStep = dt / REFORM_SECONDS;
    const lagK = p.lagSec > 0 ? 1 - Math.exp(-dt / p.lagSec) : 1;
    const dragDecay = Math.exp(-Math.max(0, p.drag) * dt);
    const glowDecay = Math.exp(-Math.max(0, p.glowDecay) * dt);
    const glowAttack = 1 - Math.exp(-GLOW_ATTACK * dt);
    const walkDecay = p.walkTime > 0 ? Math.exp(-dt / p.walkTime) : 0;
    const walkKick = p.walk * Math.sqrt(1 - walkDecay * walkDecay) * UNIFORM_TO_UNIT_VARIANCE;
    const omega = 2 * Math.PI * Math.max(0, p.wobbleFreq);
    const omega2 = omega * omega;
    const damping = 2 * Math.max(0, p.wobbleDamping) * omega;
    const drive = Math.max(0, p.wobbleDrive) * omega2;
    const spring = Math.max(0, p.spring);
    const gain = p.forceGain;
    const scatter = p.scatter;
    const fallSpeed = p.fallSpeed;
    const invGlowSpeed = 1 / GLOW_SPEED;
    const field = this.field;
    const pushing = field.maxSpeed > 0;

    const { px, py, dx, dy, vx, vy, lx, ly, wx, wy, wear, gx, gy, wob, wobV, axX, axY } = this;
    for (let i = 0; i < n; i++) {
      // Popping bubbles finish their pop, then re-form on their path and fade back in.
      let state = wear[i];
      if (state >= 2) {
        state += reformStep;
        if (state >= 3) state = 0;
      } else if (state >= 1) {
        state += popStep;
        if (state >= 2) {
          state = 2;
          this.settle(i);
        }
      }
      wear[i] = state;
      let popping = state >= 1 && state < 2;
      let x = px[i] + dx[i];
      let y = py[i] + dy[i];
      // Bubbles that sank out of view (or were thrown far off) start again above the top.
      if (y < -EXIT_BELOW || y > H + 0.6 || x < -0.3 || x > W + 0.3) {
        this.gen[i] += 1;
        this.spawn(i, p, -1);
        x = px[i];
        y = py[i];
        popping = false;
      }

      // The push the bubble feels here (scattered by Dispersion, low-passed by Viscosity).
      let fu = 0;
      let fv = 0;
      if (pushing && !popping && field.sample(x, y) > 0) {
        fu = field.u;
        fv = field.v;
        if (scatter > 0) {
          const a = scatter * this.deflect[i];
          const c = Math.cos(a);
          const s = Math.sin(a);
          const ru = c * fu - s * fv;
          fv = s * fu + c * fv;
          fu = ru;
        }
      }
      const fx = lx[i] + (fu - lx[i]) * lagK;
      const fy = ly[i] + (fv - ly[i]) * lagK;
      lx[i] = fx;
      ly[i] = fy;

      // Pushed motion: force, drag, spring back to the path.
      const ovx = vx[i];
      const ovy = vy[i];
      const nvx = ovx * dragDecay + (gain * fx - spring * dx[i]) * dt;
      const nvy = ovy * dragDecay + (gain * fy - spring * dy[i]) * dt;
      vx[i] = nvx;
      vy[i] = nvy;
      dx[i] += nvx * dt;
      dy[i] += nvy * dt;

      // Wobble: acceleration stretches the bubble along it; the stretch rings.
      const accX = (nvx - ovx) * invDt;
      const accY = (nvy - ovy) * invDt;
      const acc = Math.sqrt(accX * accX + accY * accY);
      if (acc > 1e-9) {
        let ux = accX / acc;
        let uy = accY / acc;
        if (ux * axX[i] + uy * axY[i] < 0) {
          ux = -ux;
          uy = -uy;
        }
        const k = acc * dt * AXIS_FOLLOW;
        const w = k / (1 + k);
        const ax = axX[i] + (ux - axX[i]) * w;
        const ay = axY[i] + (uy - axY[i]) * w;
        const len = Math.sqrt(ax * ax + ay * ay);
        if (len > 1e-9) {
          axX[i] = ax / len;
          axY[i] = ay / len;
        }
      }
      let wv = wobV[i] + (drive * acc - omega2 * wob[i] - damping * wobV[i]) * dt;
      let wb = wob[i] + wv * dt;
      if (wb < WOBBLE_MIN) {
        wb = WOBBLE_MIN;
        if (wv < 0) wv = 0;
      } else if (wb > WOBBLE_MAX) {
        wb = WOBBLE_MAX;
        if (wv > 0) wv = 0;
      }
      wobV[i] = wv;
      wob[i] = wb;

      // Glow: rises quickly with the pushed speed, fades with Persistence.
      const tx = nvx * invGlowSpeed;
      const ty = nvy * invGlowSpeed;
      const t2 = tx * tx + ty * ty;
      const g0x = gx[i];
      const g0y = gy[i];
      if (!popping && t2 > g0x * g0x + g0y * g0y) {
        gx[i] = g0x + (tx - g0x) * glowAttack;
        gy[i] = g0y + (ty - g0y) * glowAttack;
      } else {
        gx[i] = g0x * glowDecay;
        gy[i] = g0y * glowDecay;
      }

      // Wear: the harder a bubble is pushed, the sooner it pops (Persistence).
      if (wear[i] < 1 && popRate > 0 && t2 > 0) {
        const pushed = Math.sqrt(t2);
        const worn =
          wear[i] +
          popRate * this.fragility[i] * (pushed < WEAR_SPEED_CAP ? pushed : WEAR_SPEED_CAP) * dt;
        wear[i] = worn < 1 ? worn : 1;
      }

      // Wandering (seeded, one hash per bubble per step) and the fall.
      const h = hash3(this.stepKey, i, CH_STEP);
      const nwx = wx[i] * walkDecay + walkKick * lowSigned(h);
      const nwy = wy[i] * walkDecay + walkKick * highSigned(h);
      wx[i] = nwx;
      wy[i] = nwy;
      px[i] += nwx * dt;
      py[i] += (nwy - fallSpeed * this.fall[i]) * dt;
    }
    this.steps++;
  }

  /** A popped bubble re-forms where it would have been had nothing pushed it. */
  private settle(i: number): void {
    this.dx[i] = 0;
    this.dy[i] = 0;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.lx[i] = 0;
    this.ly[i] = 0;
    this.gx[i] = 0;
    this.gy[i] = 0;
    this.wob[i] = 0;
    this.wobV[i] = 0;
  }

  /**
   * (Re)start slot i. `phase` < 0: a new bubble just above the top edge. `phase` in
   * [0, 1): a bubble that has already fallen for that share of its fall (steady state).
   */
  private spawn(i: number, p: BubbleSimParams, phase: number): void {
    const key = this.spawnKey;
    const g = this.gen[i];
    const W = this.worldWidth;
    const H = this.worldHeight;

    const u = hashUnit(key + CH_SIZE, i, g);
    const size = 0.55 + 1.3 * u ** 2.3;
    this.size[i] = size;
    // Bigger bubbles sink faster, so the fall has depth.
    const fall = 0.55 + 0.45 * size;
    this.fall[i] = fall;
    this.fragility[i] = 0.6 + 0.8 * hashUnit(key + CH_FRAGILITY, i, g);
    this.deflect[i] = hashUnit(key + CH_DEFLECT, i, g) * 2 - 1;

    // Across: a string of bubbles at a seeded place (low Dispersion) → anywhere (high).
    const k = Math.min(
      this.streamCount - 1,
      Math.floor(hashUnit(key + CH_STREAM, i, g) * this.streamCount),
    );
    const streamX =
      ((k + 0.5 + 0.35 * (hashUnit(this.streamKey, k, 0) * 2 - 1)) / this.streamCount) * W +
      0.006 * (hashUnit(key + CH_JITTER, i, g) * 2 - 1);
    const evenX = -SIDE_MARGIN + (W + 2 * SIDE_MARGIN) * hashUnit(key + CH_X, i, g);
    let x = streamX + (evenX - streamX) * p.spread;
    const spawnY = H + SPAWN_ABOVE + SPAWN_BAND * hashUnit(key + CH_Y, i, g);
    let y = spawnY;
    if (phase >= 0) {
      // Steady state: the bubble has already fallen part of the way through the water.
      const drop = phase * (spawnY + EXIT_BELOW);
      y = spawnY - drop;
      // The wandering it would have done on the way.
      const age = drop / Math.max(1e-6, p.fallSpeed * fall);
      const reach = p.walk * Math.sqrt(2 * p.walkTime * Math.min(age, 60));
      x += reach * UNIFORM_TO_UNIT_VARIANCE * (hashUnit(key + CH_WALK, i, g) * 2 - 1);
    }
    this.px[i] = x;
    this.py[i] = y;
    this.dx[i] = 0;
    this.dy[i] = 0;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.lx[i] = 0;
    this.ly[i] = 0;
    const walkKick = p.walk * UNIFORM_TO_UNIT_VARIANCE;
    const hw = hash3(key + CH_WALK, i, g);
    this.wx[i] = walkKick * lowSigned(hw);
    this.wy[i] = walkKick * highSigned(hw);
    this.wear[i] = 0;
    this.gx[i] = 0;
    this.gy[i] = 0;
    this.wob[i] = 0;
    this.wobV[i] = 0;
    const a = hashUnit(key + CH_AXIS, i, g) * Math.PI;
    this.axX[i] = Math.cos(a);
    this.axY[i] = Math.sin(a);
  }
}
