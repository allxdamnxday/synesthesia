// Modal resonator bank for A4 Resonance (SPEC 9.5): up to 12 modes, each a pair of complex
// one-pole resonators ("twins", sharing the mode's gain 62/38, slightly detuned and spread
// apart in stereo by Dispersion, each mode staying balanced between left and right).
//
//   z[n] = r·e^(iθ)·z[n−1] + gs·strike[n] + gb·bow[n],   output = Im(z)
//
// A complex resonator keeps its amplitude and phase continuous when θ changes, so the pitch
// can bounce and glide without clicks. An impulse starts each mode in sine phase (no step).
//
// Excitation:
// - bow: the node's input (seeded noise shaped by the material), scaled per mode by
//   gain·√(1 − r²) so the singing level doesn't depend on how long the mode rings;
// - strikes: when the `strike` parameter changes value, a mallet pulse (a Hann window of
//   `mallet` seconds, unit area, times `velocity`) starts at that exact sample. Short pulses
//   excite every mode (a hard strike); long ones mostly the low modes (a muffled one). A
//   strike can also kick the pitch spring (`bounce` cents, `bounceHz`, `bounceDecay` s).
// - reset: when `reset` changes, every mode fades to silence within 2 ms (used under the
//   engine's fade when playback starts or jumps).
//
// Per-mode frequency (Hz), ring time (T60, s) and gain are k-rate parameters written by the
// material; `damp` adds a decay rate (natural-log amplitude per second) to every mode.
//
// Deterministic: no randomness, no clocks, no port messages. Everything, including stopping
// (`alive` set to 0 when the material is disposed), goes through AudioParams.

const MODES = 12;
const VOICES = MODES * 2;
const LN_1000 = Math.log(1000);
const MAX_STRIKES = 4;
const RESET_SAMPLES = 96;
const RESET_FACTOR = Math.exp(Math.log(1e-5) / RESET_SAMPLES);
const BOUNCE_BLOCK = 16;
const TWO_PI = 2 * Math.PI;
/**
 * How far each mode's twins spread (scaled by `width`), alternating sides. The fundamental
 * spreads least, so the body keeps a clear place.
 */
const SPREAD = [0.45, -0.6, 0.85, -0.4, 1, -0.75, 0.5, -0.95, 0.7, -0.3, 0.9, -0.55];
/** Share of `detune` each mode's twins get (uneven, so the beats don't pulse in step). */
const DETUNE_SHAPE = [0.5, 0.9, 0.7, 1, 0.6, 0.85, 0.75, 1, 0.65, 0.9, 0.8, 1];
/**
 * Each mode's gain is split unevenly between its twins, as in a real bell's slightly
 * asymmetric mode pairs: detuned twins then shimmer (about ±8 dB) instead of beating to
 * silence.
 */
const TWIN_SHARE = [0.62, 0.38];
/** (weaker share / stronger share)², for balancing the twins' stereo placement. */
const TWIN_POWER_RATIO = (TWIN_SHARE[1] / TWIN_SHARE[0]) ** 2;

/**
 * Equal-power pan positions (−1 … 1) for a mode's twins spread by `s` (−1 … 1): the weaker
 * twin goes to −s, and the stronger one just far enough the other way that the mode's energy
 * stays balanced between left and right. The body widens without leaning to one side.
 */
function twinPositions(s) {
  const weak = -s;
  const strong = (2 / Math.PI) * Math.asin(TWIN_POWER_RATIO * Math.sin((Math.PI / 2) * s));
  return [strong, weak];
}

const FREQ = [];
const DECAY = [];
const GAIN = [];
for (let i = 0; i < MODES; i++) {
  FREQ.push(`freq${i}`);
  DECAY.push(`decay${i}`);
  GAIN.push(`gain${i}`);
}

function valueAt(values, index) {
  return values.length > 1 ? values[index] : values[0];
}

class ModalBankProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const list = [];
    for (let i = 0; i < MODES; i++) {
      list.push({
        name: FREQ[i],
        defaultValue: 0,
        minValue: 0,
        maxValue: 1e5,
        automationRate: 'k-rate',
      });
      list.push({
        name: DECAY[i],
        defaultValue: 1,
        minValue: 1e-3,
        maxValue: 1e3,
        automationRate: 'k-rate',
      });
      list.push({
        name: GAIN[i],
        defaultValue: 0,
        minValue: -1e3,
        maxValue: 1e3,
        automationRate: 'k-rate',
      });
    }
    const kRate = (name, defaultValue) => ({
      name,
      defaultValue,
      minValue: -1e9,
      maxValue: 1e9,
      automationRate: 'k-rate',
    });
    const aRate = (name, defaultValue) => ({
      name,
      defaultValue,
      minValue: -1e9,
      maxValue: 1e9,
      automationRate: 'a-rate',
    });
    list.push(kRate('damp', 0), kRate('width', 0), kRate('detune', 0), kRate('alive', 1));
    list.push(
      aRate('strike', 0),
      aRate('velocity', 0),
      aRate('mallet', 0.0005),
      aRate('bounce', 0),
      aRate('bounceHz', 6),
      aRate('bounceDecay', 0.2),
      aRate('reset', 0),
    );
    return list;
  }

  constructor() {
    super();
    // Resonator state and coefficients, one entry per twin (mode m → twins 2m, 2m + 1).
    this.zr = new Float64Array(VOICES);
    this.zi = new Float64Array(VOICES);
    this.cr = new Float64Array(VOICES);
    this.ci = new Float64Array(VOICES);
    this.radius = new Float64Array(VOICES);
    this.theta = new Float64Array(VOICES);
    this.gs = new Float64Array(VOICES);
    this.gb = new Float64Array(VOICES);
    this.pl = new Float64Array(VOICES);
    this.pr = new Float64Array(VOICES);
    this.active = new Int32Array(VOICES);
    this.activeCount = 0;
    // Last k-rate values seen (NaN forces the first update).
    this.freq = new Float64Array(MODES).fill(Number.NaN);
    this.decay = new Float64Array(MODES).fill(Number.NaN);
    this.gain = new Float64Array(MODES).fill(Number.NaN);
    this.damp = Number.NaN;
    this.width = Number.NaN;
    this.detune = Number.NaN;
    // Strikes in progress: position, length, amplitude.
    this.sPos = new Float64Array(MAX_STRIKES);
    this.sLen = new Float64Array(MAX_STRIKES);
    this.sAmp = new Float64Array(MAX_STRIKES);
    this.strikeCount = 0;
    // Pitch spring: bend (cents) = Im(P); P rotates and decays after each kick.
    this.bRe = 0;
    this.bIm = 0;
    this.bMulRe = 1;
    this.bMulIm = 0;
    this.bending = false;
    this.bendRatio = 1;
    this.lastStrike = 0;
    this.lastReset = 0;
    this.resetLeft = 0;
  }

  /** Read the k-rate parameters; recompute what changed. */
  readStatic(parameters) {
    let tableChanged = false;
    for (let i = 0; i < MODES; i++) {
      const f = parameters[FREQ[i]][0];
      const d = parameters[DECAY[i]][0];
      const g = parameters[GAIN[i]][0];
      if (f !== this.freq[i] || d !== this.decay[i] || g !== this.gain[i]) {
        this.freq[i] = f;
        this.decay[i] = d;
        this.gain[i] = g;
        tableChanged = true;
      }
    }
    const width = parameters.width[0];
    const detune = parameters.detune[0];
    if (width !== this.width || detune !== this.detune) {
      this.width = width;
      this.detune = detune;
      tableChanged = true;
    }
    const damp = Math.max(0, parameters.damp[0]);
    const dampChanged = damp !== this.damp;
    this.damp = damp;
    if (tableChanged) this.updateTable();
    if (tableChanged || dampChanged) this.updateRadius();
    if (tableChanged || dampChanged) this.updateRotation();
  }

  /** Frequencies, input gains and stereo placement of every twin. */
  updateTable() {
    const width = Math.max(0, Math.min(1, this.width));
    const detune = Math.max(0, this.detune);
    const limit = 0.9 * Math.PI;
    for (let m = 0; m < MODES; m++) {
      const f = this.freq[m];
      const t60 = Math.max(0.005, this.decay[m]);
      const g = this.gain[m];
      const cents = DETUNE_SHAPE[m] * detune;
      const rNat = Math.exp(-LN_1000 / (t60 * sampleRate));
      const bowNorm = Math.sqrt(Math.max(0, 1 - rNat * rNat));
      const positions = twinPositions(SPREAD[m] * width);
      for (let t = 0; t < 2; t++) {
        const j = 2 * m + t;
        const sign = t === 0 ? -1 : 1;
        const theta = (TWO_PI * f * Math.pow(2, (sign * cents) / 2400)) / sampleRate;
        const ok = f > 0 && theta < limit && Number.isFinite(g);
        this.theta[j] = ok ? theta : 0;
        this.gs[j] = ok ? TWIN_SHARE[t] * g : 0;
        this.gb[j] = ok ? TWIN_SHARE[t] * g * bowNorm : 0;
        const phi = (Math.PI / 4) * (1 + positions[t]);
        this.pl[j] = Math.cos(phi);
        this.pr[j] = Math.sin(phi);
      }
    }
  }

  /** Per-sample decay of every twin: its own ring time plus the damper. */
  updateRadius() {
    for (let m = 0; m < MODES; m++) {
      const t60 = Math.max(0.005, this.decay[m]);
      const ok = this.freq[m] > 0 && Number.isFinite(t60);
      const r = ok ? Math.exp(-(LN_1000 / t60 + this.damp) / sampleRate) : 0;
      this.radius[2 * m] = this.theta[2 * m] > 0 ? r : 0;
      this.radius[2 * m + 1] = this.theta[2 * m + 1] > 0 ? r : 0;
    }
  }

  /** Complex coefficients r·e^(iθ·bend). */
  updateRotation() {
    const bend = this.bendRatio;
    for (let j = 0; j < VOICES; j++) {
      const th = this.theta[j] * bend;
      this.cr[j] = this.radius[j] * Math.cos(th);
      this.ci[j] = this.radius[j] * Math.sin(th);
    }
  }

  /** Twins worth computing this block: sounding, or able to be excited. */
  updateActive() {
    let count = 0;
    for (let j = 0; j < VOICES; j++) {
      const ringing = Math.abs(this.zr[j]) + Math.abs(this.zi[j]) > 1e-12;
      if (!ringing) {
        this.zr[j] = 0;
        this.zi[j] = 0;
      }
      if (ringing || this.gs[j] !== 0 || this.gb[j] !== 0) this.active[count++] = j;
    }
    this.activeCount = count;
  }

  beginStrike(velocity, mallet, bounce, bounceHz, bounceDecay) {
    if (this.resetLeft > 0) {
      // A strike right at a reset (both at the start of playback): the output is silent
      // under the engine's fade, so finish the reset at once and strike a quiet body.
      this.resetLeft = 0;
      this.zr.fill(0);
      this.zi.fill(0);
    }
    const len = Math.max(2, Math.min(512, Math.round(mallet * sampleRate)));
    if (this.strikeCount === MAX_STRIKES) {
      // Drop the oldest (nearly finished) pulse.
      for (let q = 1; q < MAX_STRIKES; q++) {
        this.sPos[q - 1] = this.sPos[q];
        this.sLen[q - 1] = this.sLen[q];
        this.sAmp[q - 1] = this.sAmp[q];
      }
      this.strikeCount--;
    }
    const q = this.strikeCount++;
    this.sPos[q] = 0;
    this.sLen[q] = len;
    this.sAmp[q] = Math.max(0, velocity);
    if (bounce !== 0 && Number.isFinite(bounce)) {
      const decay = Math.exp(-BOUNCE_BLOCK / (Math.max(0.01, bounceDecay) * sampleRate));
      const angle = (TWO_PI * Math.max(0, bounceHz) * BOUNCE_BLOCK) / sampleRate;
      this.bMulRe = decay * Math.cos(angle);
      this.bMulIm = decay * Math.sin(angle);
      this.bRe += bounce;
      this.bending = true;
    }
  }

  beginReset() {
    this.resetLeft = RESET_SAMPLES;
    this.strikeCount = 0;
    this.bRe = 0;
    this.bIm = 0;
    if (this.bending) {
      this.bending = false;
      this.bendRatio = 1;
      this.updateRotation();
    }
  }

  /** Advance the pitch spring by one block of BOUNCE_BLOCK samples. */
  stepBounce() {
    const re = this.bRe * this.bMulRe - this.bIm * this.bMulIm;
    const im = this.bRe * this.bMulIm + this.bIm * this.bMulRe;
    this.bRe = re;
    this.bIm = im;
    if (Math.abs(re) + Math.abs(im) < 0.02) {
      this.bRe = 0;
      this.bIm = 0;
      this.bending = false;
      this.bendRatio = 1;
    } else {
      this.bendRatio = Math.pow(2, im / 1200);
    }
    this.updateRotation();
  }

  process(inputs, outputs, parameters) {
    // The material sets `alive` to 0 when it is disposed: stop, so the node can be released.
    if (!(parameters.alive[0] > 0)) return false;
    const output = outputs[0];
    const left = output[0];
    const right = output.length > 1 ? output[1] : null;
    const n = left.length;
    const input = inputs[0];
    const bow = input && input.length > 0 ? input[0] : null;

    this.readStatic(parameters);
    this.updateActive();

    const strike = parameters.strike;
    const reset = parameters.reset;
    const zr = this.zr;
    const zi = this.zi;
    const cr = this.cr;
    const ci = this.ci;
    const gs = this.gs;
    const gb = this.gb;
    const pl = this.pl;
    const pr = this.pr;

    for (let s = 0; s < n; s++) {
      const resetValue = valueAt(reset, s);
      if (resetValue !== this.lastReset) {
        this.lastReset = resetValue;
        this.beginReset();
      }
      const strikeValue = valueAt(strike, s);
      if (strikeValue !== this.lastStrike) {
        this.lastStrike = strikeValue;
        this.beginStrike(
          valueAt(parameters.velocity, s),
          valueAt(parameters.mallet, s),
          valueAt(parameters.bounce, s),
          valueAt(parameters.bounceHz, s),
          valueAt(parameters.bounceDecay, s),
        );
        this.updateActive();
      }
      if (this.bending && s % BOUNCE_BLOCK === 0) this.stepBounce();

      // Mallet pulses: unit-area Hann windows.
      let xs = 0;
      if (this.strikeCount > 0) {
        let kept = 0;
        for (let q = 0; q < this.strikeCount; q++) {
          const len = this.sLen[q];
          const pos = this.sPos[q];
          xs += (this.sAmp[q] * (1 - Math.cos((TWO_PI * (pos + 0.5)) / len))) / len;
          if (pos + 1 < len) {
            this.sPos[kept] = pos + 1;
            this.sLen[kept] = len;
            this.sAmp[kept] = this.sAmp[q];
            kept++;
          }
        }
        this.strikeCount = kept;
      }
      const xb = bow ? bow[s] : 0;

      let l = 0;
      let r = 0;
      for (let a = 0; a < this.activeCount; a++) {
        const j = this.active[a];
        const re = zr[j];
        const im = zi[j];
        const nr = cr[j] * re - ci[j] * im + gs[j] * xs + gb[j] * xb;
        const ni = cr[j] * im + ci[j] * re;
        zr[j] = nr;
        zi[j] = ni;
        l += ni * pl[j];
        r += ni * pr[j];
      }
      if (this.resetLeft > 0) {
        for (let a = 0; a < this.activeCount; a++) {
          const j = this.active[a];
          zr[j] *= RESET_FACTOR;
          zi[j] *= RESET_FACTOR;
        }
        if (--this.resetLeft === 0) {
          zr.fill(0);
          zi.fill(0);
        }
      }
      if (right) {
        left[s] = l;
        right[s] = r;
      } else {
        left[s] = 0.5 * (l + r);
      }
    }
    return true;
  }
}

registerProcessor('sp-modal-bank', ModalBankProcessor);
