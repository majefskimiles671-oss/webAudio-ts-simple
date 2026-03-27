// src/tracks/TrackManager.ts
import type { StorageProvider, Recording } from "../storage/StorageProvider.js";
import { AudioEngine } from "../audio/AudioEngine.js";
import { AudioInspector } from "../audio/AudioInspector.js";
import { WaveformRenderer } from "./WaveformRenderer.js";

export const PIXELS_PER_SECOND = 100;


export class TrackManager {
  tracks: Recording[] = [];
  timelineWidthPx = 0;
  public zoom = 1.0;

  constructor(
    private storage: StorageProvider,
    private audio: AudioEngine,
    private waveform: WaveformRenderer,
    private inspector: AudioInspector
  ) { }


  public async setZoom(z: number, container: HTMLElement) {
    this.zoom = z;
    await this.renderTracks(container, this.zoom);
  }


  async loadTracks() {
    this.tracks = await this.storage.list();
    this.tracks.sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true })
    );
  }

  async renderTracks(container: HTMLElement, zoom: number) {
    container.innerHTML = `<div id="playhead" class="playhead"></div>`;

    this.timelineWidthPx = 0;

    for (const rec of this.tracks) {
      const width = Math.max(50, rec.duration * PIXELS_PER_SECOND * zoom);
      this.timelineWidthPx = Math.max(this.timelineWidthPx, width);
    }

    for (let i = 0; i < this.tracks.length; i++) {
      await this.renderTrack(container, this.tracks[i]!, i, zoom);
    }
  }

  async renderTrack(
    container: HTMLElement,
    rec: Recording,
    index: number,
    zoom: number
  ) {
    const template = document.getElementById("track-template") as HTMLTemplateElement;
    const clone = template.content.cloneNode(true) as DocumentFragment;

    const el = clone.querySelector(".track") as HTMLElement;

    const inspectBtn = el.querySelector(".track-inspect") as HTMLButtonElement;

    inspectBtn.onclick = async () => {
      const blob = await this.storage.get(rec.id);
      const info = await this.inspector.inspectBlob(blob);

      console.log("Audio Info for", rec.name, info);
      const stat = info.channelStats[0]!;
      // OPTIONAL: pretty-print as an alert or panel
      alert(
        `Track: ${rec.name ?? "(unnamed)"}\n` +
        `Sample rate: ${info.sampleRate}\n` +
        `Duration: ${info.duration.toFixed(2)} sec\n` +
        `Channels: ${info.channels}\n` +
        `Peak: ${stat.peakDb.toFixed(1)} dBFS\n` +
        `RMS: ${stat.rmsDb.toFixed(1)} dBFS\n` +
        `Clipped: ${stat.clipped ? 'YES' : 'no'}`
      );
    };


    const title = el.querySelector(".track-title")! as HTMLElement;
    title.textContent = rec.name ?? `Track ${index + 1}`;
    this.makeTitleEditable(title, rec);

    const deleteBtn = el.querySelector(".track-delete") as HTMLElement;
    deleteBtn.onclick = async () => {
      await this.storage.delete(rec.id);
      await this.loadTracks();
      await this.renderTracks(container, zoom);
    };

    const playBtn = el.querySelector(".track-play") as HTMLElement;
    playBtn.onclick = () => this.singleTrackPlay(rec);

    const waveformElem = el.querySelector(".waveform")!;
    const width = Math.max(50, rec.duration * PIXELS_PER_SECOND * zoom);
    const blob = await this.storage.get(rec.id);

    await this.waveform.draw(waveformElem, blob, width);

    container.appendChild(clone);
  }

  async singleTrackPlay(rec: Recording) {
    const blob = await this.storage.get(rec.id);
    const buffer = await this.audio.decode(blob);

    this.audio.stopAll();
    this.audio.playBuffer(buffer, () => { });
  }

  makeTitleEditable(title: HTMLElement, rec: Recording) {
    title.onclick = () => {
      if (title.classList.contains("editing")) return;

      const input = document.createElement("input");
      input.value = title.textContent ?? "";
      input.classList.add("track-title-input");

      title.classList.add("editing");
      title.innerHTML = "";
      title.appendChild(input);
      input.focus();
      input.select();

      const commit = async () => {
        const newName = input.value.trim() || title.textContent;
        title.classList.remove("editing");
        title.textContent = newName;
        await this.storage.updateName(rec.id, newName);
      };

      input.onblur = commit;
      input.onkeydown = e => {
        if (e.key === "Enter") {
          commit();
          input.blur();
        }
      };
    };
  }

  public async saveRecording(blob: Blob, duration: number, name?: string) {
    return await this.storage.save(blob, duration, name);
  }

  public async getRecordingBlob(id: string): Promise<Blob> {
    return await this.storage.get(id);
  }

  public async updateTrackName(id: string, newName: string) {
    return await this.storage.updateName(id, newName);
  }

  public async deleteTrack(id: string) {
    return await this.storage.delete(id);
  }
}