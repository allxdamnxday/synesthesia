// Pass-through recorder for the sound harness: copies its stereo input to its output and
// posts the samples to the main thread in batches, tagged with the context frame where each
// batch starts. Harness-only (used to compare preview playback with the offline render).

const BATCH = 8192;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(BATCH);
    this.right = new Float32Array(BATCH);
    this.fill = 0;
    this.batchStart = -1;
    this.port.onmessage = (event) => {
      if (event.data === 'flush') this.flush();
    };
  }

  flush() {
    if (this.fill === 0) {
      this.port.postMessage({ type: 'flushed' });
      return;
    }
    const left = this.left.slice(0, this.fill);
    const right = this.right.slice(0, this.fill);
    this.port.postMessage({ type: 'batch', frame: this.batchStart, left, right }, [
      left.buffer,
      right.buffer,
    ]);
    this.fill = 0;
    this.batchStart = -1;
    this.port.postMessage({ type: 'flushed' });
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const l = input[0];
    const r = input[1] || input[0];
    for (let c = 0; c < output.length; c++) {
      const src = input[c] || input[0];
      if (src) output[c].set(src);
    }
    const n = output[0] ? output[0].length : 128;
    if (this.batchStart < 0) this.batchStart = currentFrame;
    for (let i = 0; i < n; i++) {
      this.left[this.fill] = l ? l[i] : 0;
      this.right[this.fill] = r ? r[i] : 0;
      this.fill++;
      if (this.fill === BATCH) {
        const left = this.left;
        const right = this.right;
        this.port.postMessage({ type: 'batch', frame: this.batchStart, left, right }, [
          left.buffer,
          right.buffer,
        ]);
        this.left = new Float32Array(BATCH);
        this.right = new Float32Array(BATCH);
        this.fill = 0;
        this.batchStart = currentFrame + i + 1;
      }
    }
    return true;
  }
}

registerProcessor('sp-recorder', RecorderProcessor);
