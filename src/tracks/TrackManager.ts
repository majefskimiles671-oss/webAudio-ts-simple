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
    await this.renderTracks();
  }


  async loadTracks() {
    this.tracks = await this.storage.list();
    this.tracks.sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true })
    );
  }

  async renderTracks() {
    const controlsCol = document.getElementById("tracks-controls")!;
    const timelineCol = document.getElementById("tracks-timeline")!;

    controlsCol.innerHTML = "";
    timelineCol.innerHTML = "";

    this.timelineWidthPx = 0;

    for (let i = 0; i < this.tracks.length; i++) {
      const rec = this.tracks[i]!;

      const template = document.getElementById("track-template") as HTMLTemplateElement;
      const clone = template.content.cloneNode(true) as DocumentFragment;

      const trackEl = clone.querySelector(".track") as HTMLElement;

      const controlsEl = trackEl.children[0] as HTMLElement;
      const timelineEl = trackEl.children[1] as HTMLElement;

      // Title
      const title = controlsEl.querySelector(".track-title")! as HTMLElement;
      title.textContent = rec.name ?? `Track ${i + 1}`;

      // Play button
      controlsEl.querySelector<HTMLElement>(".track-play")!.onclick = () => this.singleTrackPlay(rec);

      // Inspect button
      controlsEl.querySelector<HTMLElement>(".track-inspect")!.onclick = async () => {
        const blob = await this.storage.get(rec.id);
        console.log(await this.inspector.inspectBlob(blob));
      };

      // Delete button
      controlsEl.querySelector<HTMLElement>(".track-delete")!.onclick = async () => {
        await this.storage.delete(rec.id);
        await this.loadTracks();
        await this.renderTracks();
      };

      // Waveform
      const waveformElem = timelineEl.querySelector(".waveform") as HTMLElement;
      const width = rec.duration * PIXELS_PER_SECOND * this.zoom;
      this.timelineWidthPx = Math.max(this.timelineWidthPx, width);

      const blob = await this.storage.get(rec.id);
      await this.waveform.draw(waveformElem, blob, width);

      // Append
      controlsCol.appendChild(controlsEl);
      timelineCol.appendChild(timelineEl);
    }
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