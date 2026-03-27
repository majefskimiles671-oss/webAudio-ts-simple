// src/tracks/WaveformRenderer.ts
import { AudioEngine } from "../audio/AudioEngine.js";

export class WaveformRenderer {
  constructor(private audio: AudioEngine) {}

  async draw(
    elem: Element,
    blob: Blob,
    width: number,
    height: number = 80
  ) {
    const buffer = await this.audio.decode(blob);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.classList.add("waveform-canvas");

    elem.innerHTML = "";
    elem.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    const data = buffer.getChannelData(0);

    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.fillStyle = "#9acd32";

    for (let x = 0; x < width; x++) {
      let min = 1, max = -1;
      for (let j = x * step; j < (x + 1) * step; j++) {
        const v = data[j] ?? 0;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }

      ctx.fillRect(
        x,
        (1 + min) * amp,
        1,
        Math.max(1, (max - min) * amp * 2)
      );
    }
  }
}