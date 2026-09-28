// Diagnostic AudioWorklet processor (SPEC 14.1: Web Audio + AudioWorklet check).
// Writes a constant value to every output channel so the capability check can render a
// few blocks in an OfflineAudioContext and confirm the worklet thread really runs.
// Plain JavaScript, self-hosted in public/ so it loads the same way in dev and in builds.

class DiagnosticConstantProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const value = options && options.processorOptions ? options.processorOptions.value : undefined;
    this.value = typeof value === 'number' ? value : 0.25;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (output) {
      for (const channel of output) channel.fill(this.value);
    }
    return true;
  }
}

registerProcessor('sp-diagnostic-constant', DiagnosticConstantProcessor);
