// src/audio/AudioRecorder.ts
export class AudioRecorder {
  private mediaRecorder?: MediaRecorder;
  private chunks: Blob[] = [];

  constructor(private mimeType = "audio/webm") {}

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];

    this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.mimeType });

    this.mediaRecorder.ondataavailable = e => this.chunks.push(e.data);
    this.mediaRecorder.start();
  }

  async stop(): Promise<Blob> {
    return new Promise(resolve => {
      if (!this.mediaRecorder) throw new Error("Recorder not started");

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }
}