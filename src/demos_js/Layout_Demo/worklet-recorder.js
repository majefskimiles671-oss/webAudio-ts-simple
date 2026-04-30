// worklet-recorder.js
// AudioWorklet processor for sample-accurate microphone recording.
// Runs on the audio render thread — no main-thread jitter.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._active = false;
    this.port.onmessage = ({ data }) => { this._active = data === 'start'; };
  }

  process(inputs) {
    if (!this._active) return true;
    const input = inputs[0];
    if (!input || !input[0]?.length) return true;

    // Send all available channels (typically 1 for a mic, 2 for a stereo interface)
    const channels = input.map(ch => ch.slice());
    this.port.postMessage({ channels, t: currentTime });
    return true;
  }
}

registerProcessor('recorder', RecorderProcessor);
