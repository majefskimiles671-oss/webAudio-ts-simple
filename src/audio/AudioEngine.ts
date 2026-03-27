// src/audio/AudioEngine.ts
export class AudioEngine {
  public audioCtx: AudioContext;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor() {
    this.audioCtx = new AudioContext();
  }

  async decode(blob: Blob): Promise<AudioBuffer> {
    const array = await blob.arrayBuffer();
    return await this.audioCtx.decodeAudioData(array);
  }

  playBuffer(
    buffer: AudioBuffer,
    onEnded: () => void,
    when: number = 0
  ) {
    const src = this.audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.audioCtx.destination);

    this.activeSources.push(src);

    src.onended = () => {
      this.activeSources = this.activeSources.filter(s => s !== src);
      onEnded();
    };

    src.start(this.audioCtx.currentTime + when);
  }

  stopAll() {
    for (const src of this.activeSources) {
      try { src.stop(); } catch {}
    }
    this.activeSources = [];
  }

  warm() {
    const buf = this.audioCtx.createBuffer(1, 1, this.audioCtx.sampleRate);
    const src = this.audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.audioCtx.destination);
    src.start();
  }
}