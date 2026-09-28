// One-pole smoother: y[n] = y[n-1] + a * (x[n] - y[n-1]), a = 1 - exp(-1 / (tau * sampleRate)).
//
// The example AudioWorklet processor for Synesthesia sound materials. It proves the
// self-hosted worklet path (a plain JS module imported with Vite's `?url&no-inline`, loaded
// with audioWorklet.addModule) in both AudioContext and OfflineAudioContext. Materials that
// need custom DSP (Resonance, Pulse) follow the same pattern.
//
// Deterministic: no randomness, no clocks. Processor state lives on the instance.

class OnePoleProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'timeConstant',
        defaultValue: 0.01,
        minValue: 0.00001,
        maxValue: 60,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    /** @type {number[]} last output per channel */
    this.state = [];
    this.reported = false;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const tau = parameters.timeConstant[0];
    const a = 1 - Math.exp(-1 / (Math.max(0.00001, tau) * sampleRate));
    for (let c = 0; c < output.length; c++) {
      const x = input && input[c] ? input[c] : null;
      const y = output[c];
      let s = this.state[c] ?? 0;
      for (let i = 0; i < y.length; i++) {
        s += a * ((x ? x[i] : 0) - s);
        y[i] = s;
      }
      this.state[c] = s;
    }
    if (!this.reported) {
      // Tell the main thread once that the processor ran (used by the harness check).
      this.reported = true;
      this.port.postMessage({ type: 'running', frame: currentFrame });
    }
    return true;
  }
}

registerProcessor('sp-one-pole', OnePoleProcessor);
