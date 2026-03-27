// src/audio/AudioInspector.ts
import { AudioEngine } from "./AudioEngine.js";

export class AudioInspector {
  constructor(private audio: AudioEngine) {}

  async inspectBlob(blob: Blob) {
    const arrayBuf = await blob.arrayBuffer();
    const buffer = await this.audio.audioCtx.decodeAudioData(arrayBuf);

    return this.inspectBuffer(buffer);
  }

  inspectBuffer(buffer: AudioBuffer) {
    const sampleRate = buffer.sampleRate;
    const duration = buffer.duration;
    const channels = buffer.numberOfChannels;

    // Stats per channel
    const channelStats = [];
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);

      let peak = 0;
      let sum = 0;
      let clipped = false;

      for (let i = 0; i < data.length; i++) {
        const v = data[i]!;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        if (Math.abs(v) >= 1.0) clipped = true;
      }

      const rms = Math.sqrt(sum / data.length);
      const rmsDb = 20 * Math.log10(rms || 0.0000001);
      const peakDb = 20 * Math.log10(peak || 0.0000001);

      channelStats.push({
        peak,
        peakDb,
        rms,
        rmsDb,
        clipped
      });
    }

    return {
      sampleRate,
      duration,
      channels,
      channelStats,
      bitDepth: 32 // always 32-bit float inside WebAudio
    };
  }
}
