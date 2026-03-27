// src/audio/AudioRecorder.ts
export class AudioRecorder {
  private mediaRecorder?: MediaRecorder;
  private chunks: BlobPart[] = [];

  onstop: ((blob: Blob, duration: number) => void) | null = null;
  onstream: ((stream: MediaStream) => void) | null = null;

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.onstream) this.onstream(stream);

    this.mediaRecorder = new MediaRecorder(stream);
    this.chunks = [];

    this.mediaRecorder.ondataavailable = e => {
      this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(this.chunks, { type: "audio/webm" });

      // Compute exact duration
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const duration = buf.length / buf.sampleRate;

      if (this.onstop) this.onstop(blob, duration);
      ctx.close();
    };

    this.mediaRecorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise(resolve => {
      if (!this.mediaRecorder) return resolve(new Blob([]));
      const mr = this.mediaRecorder;

      mr.onstop = () => resolve(new Blob(this.chunks, { type: "audio/webm" }));
      mr.stop();
    });
  }
}