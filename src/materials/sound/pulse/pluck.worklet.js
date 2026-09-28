// Karplus-Strong plucked strings for A5 Pulse (SPEC 9.5): a pool of 16 strings, up to 12
// sounding at once, each a delay line with a one-zero low-pass and a loss in its loop:
//
//   y[n] = exc[n] + g · ((1 − S)·y[n − D] + S·y[n − D − 1])
//
// D (fractional, 4-point Hermite interpolation) + S sets the pitch, g the ring time (T60) and
// S the brightness (0.06 bright … 0.5 dark). The excitation is a seeded noise burst: one
// period plus the attack, low-passed by `tone`, combed for a pick position, with a raised-
// cosine fade-in over the attack (a soft finger) and a short fade-out, so no pluck starts or
// ends with a step.
//
// Events arrive as parameter changes (see src/materials/sound/shared/triggers.ts): when
// `trigger` changes value, a pluck starts at that exact sample using freq, velocity, decay
// (T60 s), tone, pan, bend (semitones of twang, the pluck starts sharp and bounces), bendHz,
// bendDecay (s), attack (s) and seed (24-bit noise seed) read at the same sample. When `reset`
// changes, every string fades out within 2 ms. A string that must give way to a new pluck
// fades out over 4 ms instead of stopping dead.
//
// Deterministic: noise comes from a SplitMix32 generator seeded by the `seed` parameter; no
// clocks. Sound is driven only through AudioParams; the port carries a single lifecycle
// message ('dispose') that stops the processor.

const POOL = 16;
const MAX_PLAYING = 12;
const SIZE = 4096;
const MASK = SIZE - 1;
const EXC_MAX = 6144;
const STEAL_FADE_SEC = 0.004;
const RESET_FADE_SEC = 0.002;
/** A string counts as finished once its estimated level falls below this. */
const SILENT = 2e-4;
const BEND_BLOCK = 16;
const PICK_POSITION = 0.12;
const PICK_DEPTH = 0.85;
/** DC blocker pole (about 4 Hz at 48 kHz). */
const DC_POLE = 0.9995;
const TWO_PI = 2 * Math.PI;
const PARAMS = [
  ['trigger', 0],
  ['freq', 440],
  ['velocity', 0.5],
  ['decay', 0.5],
  ['tone', 0.5],
  ['pan', 0],
  ['bend', 0],
  ['bendHz', 8],
  ['bendDecay', 0.1],
  ['attack', 0.001],
  ['seed', 1],
  ['reset', 0],
];

function valueAt(values, index) {
  return values.length > 1 ? values[index] : values[0];
}

/** SplitMix32: floats in [0, 1) from a 32-bit seed. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  };
}

class PluckString {
  constructor() {
    this.buf = new Float32Array(SIZE);
    this.exc = new Float32Array(EXC_MAX);
    /** 0 idle, 1 sounding, 2 fading out. */
    this.state = 0;
    this.w = 0;
    this.period = 100;
    this.delay = 100;
    this.lowpass = 0.3;
    this.loss = 0.99;
    this.prev = 0;
    this.excLen = 0;
    this.age = 0;
    this.pl = Math.SQRT1_2;
    this.pr = Math.SQRT1_2;
    this.level = 0;
    this.levelStep = 1;
    this.fade = 1;
    this.fadeStep = 0;
    this.bRe = 0;
    this.bIm = 0;
    this.bMulRe = 1;
    this.bMulIm = 0;
    this.bending = false;
  }

  start(p) {
    const sr = sampleRate;
    const freq = Math.min(sr / 6, Math.max(30, p.freq));
    const period = sr / freq;
    const tone = Math.min(1, Math.max(0, p.tone));
    const t60 = Math.max(0.02, p.decay);
    const velocity = Math.max(0, p.velocity);
    this.period = period;
    this.lowpass = 0.5 - 0.44 * tone;
    this.delay = period - this.lowpass;
    this.loss = Math.min(0.99995, Math.pow(10, -3 / (t60 * freq)));
    this.prev = 0;
    this.buf.fill(0);
    this.w = 0;
    this.age = 0;
    this.state = 1;
    this.fade = 1;
    this.fadeStep = 0;
    this.level = velocity;
    this.levelStep = Math.pow(10, -3 / (t60 * sr));
    const angle = (Math.min(1, Math.max(-1, p.pan)) + 1) * (Math.PI / 4);
    this.pl = Math.cos(angle);
    this.pr = Math.sin(angle);

    // Excitation: seeded noise → one-pole low-pass (tone) → pick comb → DC removed → windowed.
    const attack = Math.max(4, Math.min(2048, Math.round(p.attack * sr)));
    const len = Math.min(EXC_MAX, Math.ceil(period) + attack);
    const random = makeRandom(Math.round(p.seed));
    const cutoff = Math.min(0.45 * sr, 250 * Math.pow(2, 6 * tone));
    const a = 1 - Math.exp((-TWO_PI * cutoff) / sr);
    const exc = this.exc;
    let lp = 0;
    for (let n = 0; n < len; n++) {
      lp += a * (random() * 2 - 1 - lp);
      exc[n] = lp;
    }
    const pick = Math.max(1, Math.round(PICK_POSITION * period));
    for (let n = len - 1; n >= pick; n--) exc[n] -= PICK_DEPTH * exc[n - pick];
    // Window (raised-cosine fade in over the attack, short fade out), then remove the DC with
    // the same window shape so the burst still starts and ends at zero.
    const fadeOut = Math.max(1, Math.min(64, len >> 2));
    const windowAt = (n) => {
      let w = 1;
      if (n < attack) w *= 0.5 - 0.5 * Math.cos((Math.PI * (n + 0.5)) / attack);
      const fromEnd = len - 1 - n;
      if (fromEnd < fadeOut) w *= 0.5 - 0.5 * Math.cos((Math.PI * (fromEnd + 0.5)) / fadeOut);
      return w;
    };
    let sum = 0;
    let weight = 0;
    for (let n = 0; n < len; n++) {
      const w = windowAt(n);
      exc[n] *= w;
      sum += exc[n];
      weight += w;
    }
    const offset = weight > 0 ? sum / weight : 0;
    let energy = 0;
    for (let n = 0; n < len; n++) {
      const x = exc[n] - offset * windowAt(n);
      exc[n] = x;
      energy += x * x;
    }
    // The burst carries the energy of one period at RMS velocity / 2, however long it is.
    const target = 0.5 * velocity * Math.sqrt(period);
    const scale = energy > 0 ? target / Math.sqrt(energy) : 0;
    for (let n = 0; n < len; n++) exc[n] *= scale;
    this.excLen = len;

    // Twang: the bend (semitones) starts at p.bend and spirals to zero.
    this.bRe = Number.isFinite(p.bend) ? p.bend : 0;
    this.bIm = 0;
    this.bending = this.bRe !== 0;
    if (this.bending) {
      const decay = Math.exp(-BEND_BLOCK / (Math.max(0.005, p.bendDecay) * sr));
      const turn = (TWO_PI * Math.max(0, p.bendHz) * BEND_BLOCK) / sr;
      this.bMulRe = decay * Math.cos(turn);
      this.bMulIm = decay * Math.sin(turn);
      this.delay = period / Math.pow(2, this.bRe / 12) - this.lowpass;
    }
  }

  fadeOut(seconds) {
    if (this.state === 0) return;
    this.state = 2;
    const step = 1 / Math.max(1, seconds * sampleRate);
    this.fadeStep = Math.max(this.fadeStep, step);
  }

  stepBend() {
    const re = this.bRe * this.bMulRe - this.bIm * this.bMulIm;
    const im = this.bRe * this.bMulIm + this.bIm * this.bMulRe;
    this.bRe = re;
    this.bIm = im;
    if (Math.abs(re) + Math.abs(im) < 1e-4) {
      this.bRe = 0;
      this.bIm = 0;
      this.bending = false;
    }
    this.delay = this.period / Math.pow(2, this.bRe / 12) - this.lowpass;
  }

  /** Add this string's output for samples [from, to) into left/right. */
  render(left, right, from, to) {
    const buf = this.buf;
    const exc = this.exc;
    const excLen = this.excLen;
    const S = this.lowpass;
    const keep = 1 - S;
    const loss = this.loss;
    const pl = this.pl;
    const pr = this.pr;
    let w = this.w;
    let prev = this.prev;
    let age = this.age;
    let fade = this.fade;
    const fadeStep = this.fadeStep;
    let delay = this.delay;
    for (let s = from; s < to; s++) {
      if (this.bending && (age & (BEND_BLOCK - 1)) === 0) {
        this.stepBend();
        delay = this.delay;
      }
      const pos = w - delay;
      const i = Math.floor(pos);
      const fr = pos - i;
      const xm1 = buf[(i - 1) & MASK];
      const x0 = buf[i & MASK];
      const x1 = buf[(i + 1) & MASK];
      const x2 = buf[(i + 2) & MASK];
      const c1 = 0.5 * (x1 - xm1);
      const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
      const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
      const value = ((c3 * fr + c2) * fr + c1) * fr + x0;
      const y = loss * (keep * value + S * prev) + (age < excLen ? exc[age] : 0);
      prev = value;
      buf[w] = y;
      w = (w + 1) & MASK;
      age++;
      let out = y;
      if (fadeStep > 0) {
        fade -= fadeStep;
        if (fade <= 0) {
          fade = 0;
          this.state = 0;
          break;
        }
        out *= fade;
      }
      left[s] += out * pl;
      right[s] += out * pr;
    }
    this.w = w;
    this.prev = prev;
    this.age = age;
    this.fade = fade;
    this.level *= Math.pow(this.levelStep, to - from);
    if (this.state === 1 && age >= excLen && this.level < SILENT) this.state = 0;
    if (this.state === 0) this.fadeStep = 0;
  }
}

class PluckProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMS.map(([name, defaultValue]) => ({
      name,
      defaultValue,
      minValue: -1e9,
      maxValue: 1e9,
      automationRate: 'a-rate',
    }));
  }

  constructor() {
    super();
    this.strings = [];
    for (let i = 0; i < POOL; i++) this.strings.push(new PluckString());
    this.lastTrigger = 0;
    this.lastReset = 0;
    this.scratch = new Float32Array(128);
    this.dcX = [0, 0];
    this.dcY = [0, 0];
    // Lifecycle only (never sound): the material says 'dispose' and the processor stops.
    this.alive = true;
    this.port.onmessage = (event) => {
      if (event.data === 'dispose') this.alive = false;
    };
  }

  /** A string for a new pluck: an idle one, or the quietest (which fades out first). */
  allocate() {
    let playing = 0;
    let quietest = null;
    for (const string of this.strings) {
      if (string.state !== 1) continue;
      playing++;
      if (!quietest || string.level < quietest.level) quietest = string;
    }
    if (playing >= MAX_PLAYING && quietest) quietest.fadeOut(STEAL_FADE_SEC);
    for (const string of this.strings) if (string.state === 0) return string;
    // Every string is busy: take the fading one that is closest to silence.
    let best = this.strings[0];
    for (const string of this.strings) {
      if (string.level * string.fade < best.level * best.fade) best = string;
    }
    return best;
  }

  pluck(parameters, index) {
    const read = (name) => valueAt(parameters[name], index);
    this.allocate().start({
      freq: read('freq'),
      velocity: read('velocity'),
      decay: read('decay'),
      tone: read('tone'),
      pan: read('pan'),
      bend: read('bend'),
      bendHz: read('bendHz'),
      bendDecay: read('bendDecay'),
      attack: read('attack'),
      seed: read('seed'),
    });
  }

  renderStrings(left, right, from, to) {
    if (to <= from) return;
    for (const string of this.strings) {
      if (string.state !== 0) string.render(left, right, from, to);
    }
  }

  process(_inputs, outputs, parameters) {
    if (!this.alive) return false;
    const output = outputs[0];
    const left = output[0];
    const right = output.length > 1 ? output[1] : this.scratch;
    const n = left.length;
    left.fill(0);
    right.fill(0);

    const trigger = parameters.trigger;
    const reset = parameters.reset;
    const scan = trigger.length > 1 || reset.length > 1 ? n : 1;
    let from = 0;
    for (let s = 0; s < scan; s++) {
      const r = valueAt(reset, s);
      const t = valueAt(trigger, s);
      const isReset = r !== this.lastReset;
      const isTrigger = t !== this.lastTrigger;
      if (!isReset && !isTrigger) continue;
      this.renderStrings(left, right, from, s);
      from = s;
      if (isReset) {
        this.lastReset = r;
        for (const string of this.strings) string.fadeOut(RESET_FADE_SEC);
      }
      if (isTrigger) {
        this.lastTrigger = t;
        this.pluck(parameters, s);
      }
    }
    this.renderStrings(left, right, from, n);
    if (output.length === 1) {
      for (let s = 0; s < n; s++) left[s] = 0.5 * (left[s] + right[s]);
    }

    // DC blocker per channel.
    for (let c = 0; c < Math.min(2, output.length); c++) {
      const data = output[c];
      let x1 = this.dcX[c];
      let y1 = this.dcY[c];
      for (let s = 0; s < n; s++) {
        const x = data[s];
        const y = x - x1 + DC_POLE * y1;
        x1 = x;
        y1 = y;
        data[s] = y;
      }
      this.dcX[c] = x1;
      this.dcY[c] = y1;
    }
    return true;
  }
}

registerProcessor('sp-pluck', PluckProcessor);
