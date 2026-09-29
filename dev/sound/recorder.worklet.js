// Pass-through recorder for the sound harness: copies its stereo input to its output and
// posts the samples to the main thread in batches, tagged with the context frame where each
// batch starts. Harness-only (used to compare preview playback with the offline render).
//
// Frames are counted here, from the first render quantum on: every quantum passes through
// this node, in order. The `currentFrame` global can't be trusted quantum by quantum: when
// Chrome's audio thread runs late and renders several quanta back to back to catch up (it
// does while the main thread sets a ConvolverNode's buffer), consecutive calls can report the
// same frame and then jump ahead. Such bursts are reported ('burst') for the probe to count.

const BATCH = 8192;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(BATCH);
    this.right = new Float32Array(BATCH);
    this.fill = 0;
    this.batchStart = -1;
    /** Frame of the next quantum, counted here (-1 before the first). */
    this.frame = -1;
    /** Quanta in the current catch-up burst (reported frame lagging the counted one). */
    this.burst = 0;
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
    if (this.frame < 0) this.frame = currentFrame;
    if (currentFrame < this.frame) {
      this.burst++;
    } else {
      if (this.burst > 0) {
        this.port.postMessage({ type: 'burst', frame: this.frame, quanta: this.burst + 1 });
        this.burst = 0;
      }
      if (currentFrame > this.frame) {
        // Quanta that never reached this node: report them and start a new batch there.
        this.port.postMessage({ type: 'skip', frame: this.frame, to: currentFrame });
        if (this.fill > 0) {
          const left = this.left.slice(0, this.fill);
          const right = this.right.slice(0, this.fill);
          this.port.postMessage({ type: 'batch', frame: this.batchStart, left, right }, [
            left.buffer,
            right.buffer,
          ]);
          this.fill = 0;
        }
        this.batchStart = -1;
        this.frame = currentFrame;
      }
    }
    if (this.batchStart < 0) this.batchStart = this.frame;
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
        this.batchStart = this.frame + i + 1;
      }
    }
    this.frame += n;
    return true;
  }
}

registerProcessor('sp-recorder', RecorderProcessor);
