// src/transport/TransportController.ts
import { AudioEngine } from "../audio/AudioEngine.js";
import { TrackManager, PIXELS_PER_SECOND } from "../tracks/TrackManager.js";
import { AudioRecorder } from "../audio/AudioRecorder.js";
import type { StoredAudio } from "../storage/StorageProvider.js";

export type TransportState = "idle" | "recording" | "playing";

export class TransportController {
  state: TransportState = "idle";

  playheadRAF = 0;
  playheadStart = 0;
  timerRAF = 0;
  timerStart = 0;

  constructor(
    private audio: AudioEngine,
    private tracks: TrackManager,
    private recorder: AudioRecorder
  ) {}

  bindUI() {
    const rec = document.getElementById("g-record-btn")!;
    const play = document.getElementById("g-play-btn")!;
    const trackArea = document.getElementById("track-area")!;

    rec.onclick = async () => {
      if (this.state === "idle") {
        await this.startRecording();
      } else if (this.state === "recording") {
        await this.stopRecording();
      }
    };

    play.onclick = async () => {
      if (this.state === "idle") {
        this.startPlay();
      } else if (this.state === "playing") {
        this.stopPlay();
      }
    };
  }

  setState(s: TransportState) {
    this.state = s;
    const rec = document.getElementById("g-record-btn")!;
    const play = document.getElementById("g-play-btn")!;

    rec.classList.toggle("active", s === "recording");
    play.classList.toggle("active", s === "playing");
  }

  // -------------------------
  // RECORDING
  // -------------------------
  async startRecording() {
    this.setState("recording");
    this.startTimer();

    this.recorder.onstop = async (blob, duration) => {
      await this.audio.audioCtx.resume();
      await this.tracks.saveRecording(blob, duration);
      await this.tracks.loadTracks();
      await this.tracks.renderTracks(
        document.getElementById("g_tracks")!,
        1
      );
      this.setState("idle");
    };

    await this.recorder.start();
  }

  async stopRecording() {
    this.stopTimer();
    await this.recorder.stop();
  }

  // -------------------------
  // PLAYBACK
  // -------------------------
  startPlay() {
    this.setState("playing");
    this.startTimer();
    this.startPlayhead();

    this.audio.stopAll();

    for (const rec of this.tracks.tracks) {
      this.playTrack(rec);
    }
  }

  async playTrack(rec: StoredAudio) {
    const blob = await this.tracks.getRecordingBlob(rec.id);
    const buffer = await this.audio.decode(blob);

    this.audio.playBuffer(buffer, () => this.onTrackEnded());
  }

  onTrackEnded() {
    if (this.audio["activeSources"].length === 0) {
      this.stopPlay();
    }
  }

  stopPlay() {
    this.setState("idle");
    this.stopTimer();
    this.stopPlayhead();
    this.audio.stopAll();
    this.resetScroll();
  }

  // -------------------------
  // TIMER
  // -------------------------
  startTimer() {
    this.timerStart = performance.now();
    this.updateTimer();
  }

  updateTimer() {
    const timerElem = document.querySelector(".timer") as HTMLElement;
    const elapsed = performance.now() - this.timerStart;

    const total = elapsed / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    const hundredths = Math.floor((total * 100) % 100);

    timerElem.textContent =
      `${minutes.toString().padStart(2, "0")}:` +
      `${seconds.toString().padStart(2, "0")}.` +
      `${hundredths.toString().padStart(2, "0")}`;

    this.timerRAF = requestAnimationFrame(() => this.updateTimer());
  }

  stopTimer() {
    cancelAnimationFrame(this.timerRAF);
    (document.querySelector(".timer") as HTMLElement).textContent = "00:00.00";
  }

  // -------------------------
  // PLAYHEAD
  // -------------------------
  startPlayhead() {
    this.playheadStart = performance.now();
    this.updatePlayhead();
  }

  updatePlayhead() {
    const elapsed = (performance.now() - this.playheadStart) / 1000;
    const x = elapsed * PIXELS_PER_SECOND * this.tracks.zoom;

    const playhead = document.getElementById("playhead")!;
    const clamped = Math.min(x, this.tracks.timelineWidthPx);
    playhead.style.transform = `translateX(${clamped}px)`;

    this.autoScroll(clamped);

    this.playheadRAF = requestAnimationFrame(() => this.updatePlayhead());
  }

  stopPlayhead() {
    cancelAnimationFrame(this.playheadRAF);
    const playhead = document.getElementById("playhead")!;
    playhead.style.transform = "translateX(0px)";
  }

  autoScroll(x: number) {
    const area = document.getElementById("track-area")!;
    const rightEdge = area.scrollLeft + area.clientWidth;
    const threshold = 80;

    if (x > rightEdge - threshold) {
      area.scrollLeft = x - area.clientWidth + threshold;
    }
  }

  resetScroll() {
    const area = document.getElementById("track-area")!;
    area.scrollLeft = 0;
  }
}