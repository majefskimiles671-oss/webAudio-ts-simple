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

      // Compute real duration
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const duration = buf.length / buf.sampleRate;
      ctx.close();

      if (this.onstop) this.onstop(blob, duration);
    };

    this.mediaRecorder.start();
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
  }
}