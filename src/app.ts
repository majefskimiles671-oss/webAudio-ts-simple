// ------------------------------------------------------------
// Imports
// ------------------------------------------------------------
import { AudioRecorder } from "./audio/AudioRecorder.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
import type { StorageProvider, Recording, StoredAudio } from "./storage/StorageProvider.js";

// ------------------------------------------------------------
// 1. GLOBALS + DOM REFERENCES
// ------------------------------------------------------------
const recorder = new AudioRecorder();
const storage = new LocalStorageProvider();

let tracksStorage: StoredAudio[] = [];
let activePlayers: HTMLAudioElement[] = [];

const g_recBtn = document.getElementById("g-record-btn") as HTMLButtonElement;
const g_playBtn = document.getElementById("g-play-btn") as HTMLButtonElement;
const g_tracks = document.getElementById("g_tracks") as HTMLElement;

const PIXELS_PER_SECOND = 100;

// playhead element (updated after UI refresh)
let playhead: HTMLElement;
let zoom = 1.0; // 1.0 = normal zoom


// ------------------------------------------------------------
// 2. TRANSPORT SYSTEM
//    - state
//    - record toggle
//    - play toggle
//    - timer
//    - playhead
// ------------------------------------------------------------

type TransportState = "idle" | "recording" | "playing";
let transportState: TransportState = "idle";

function setTransportState(state: TransportState) {
  console.log(`Transport: ${transportState} → ${state}`);
  transportState = state;

  g_recBtn.classList.toggle("active", state === "recording");
  g_playBtn.classList.toggle("active", state === "playing");
}

// -------- Timer --------
let timerStartTime = 0;
let timerRAF = 0;

function startTimer() {
  timerStartTime = performance.now();
  timerRAF = requestAnimationFrame(updateTimer);
}

function updateTimer() {
  const timerElem = document.querySelector(".timer") as HTMLElement;
  const elapsed = performance.now() - timerStartTime;

  const totalSeconds = elapsed / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((totalSeconds * 100) % 100);

  timerElem.textContent =
    `${minutes.toString().padStart(2, "0")}:` +
    `${seconds.toString().padStart(2, "0")}.` +
    `${hundredths.toString().padStart(2, "0")}`;

  timerRAF = requestAnimationFrame(updateTimer);
}

function stopTimer() {
  cancelAnimationFrame(timerRAF);
  (document.querySelector(".timer") as HTMLElement).textContent = "00:00.00";
}


// -------- Playhead --------
let playheadStartTime = 0;
let playheadRAF = 0;

function findPlayhead() {
  playhead = document.getElementById("playhead") as HTMLElement;
}

function startPlayhead() {
  playheadStartTime = performance.now();
  playheadRAF = requestAnimationFrame(animatePlayhead);
}

function animatePlayhead() {
  const elapsed = (performance.now() - playheadStartTime) / 1000;
  playhead.style.transform = `translateX(${elapsed * PIXELS_PER_SECOND * zoom}px)`;
  playheadRAF = requestAnimationFrame(animatePlayhead);
}

function stopPlayhead() {
  cancelAnimationFrame(playheadRAF);
  playhead.style.transform = "translateX(0px)";
}


// -------- Transport Button Handlers --------
g_recBtn.onclick = async () => {
  if (transportState === "idle") {
    await startRecording();
    startTimer();
    setTransportState("recording");
  }
  else if (transportState === "recording") {
    await stopRecording();
    stopTimer();
    stopPlayhead();
    setTransportState("idle");
    await reloadTracksIntoUI();
  }
};

g_playBtn.onclick = async () => {
  if (transportState === "idle") {
    startTimer();
    startPlayhead();
    await playAllTracks(tracksStorage, storage);
    setTransportState("playing");
  }
  else if (transportState === "playing") {
    stopTimer();
    stopAllPlayback();
    stopPlayhead();
    setTransportState("idle");
  }
};

// -------------- Zoom ----------------

const zoomSlider = document.getElementById("zoom-slider") as HTMLInputElement;
const zoomLevels = [0.25, 0.5, 1, 2, 4];

zoomSlider.oninput = async () => {
  zoom = zoomLevels[parseInt(zoomSlider.value)]!;
  await reloadTracksIntoUI(); // redraws the waveforms using new zoom
};



// ------------------------------------------------------------
// 3. TRACK SYSTEM
//    - load tracks
//    - addTrack()
//    - deleteTrack()
//    - per-track play buttons
//    - playAllTracks()
// ------------------------------------------------------------

async function getTracksFromStorage() {
  tracksStorage = await storage.list();
  console.log(`Got ${tracksStorage.length} tracks`);
}
let isRedrawing = false;

async function reloadTracksIntoUI() {

  if (isRedrawing) return;
  isRedrawing = true;

  g_tracks.innerHTML = `<div id="playhead" class="playhead"></div>`;
  findPlayhead();

  await getTracksFromStorage();
  // want to await this!!!!
  tracksStorage.forEach((rec, idx) => addTrack(rec, idx));

  isRedrawing = false;
}
// make async!!!!!!
function addTrack(recording: Recording, index: number) {
  const template = document.getElementById("track-template")! as HTMLTemplateElement;
  const clone = template.content.cloneNode(true) as DocumentFragment;

  const trackEl = clone.querySelector(".track") as HTMLElement;
  trackEl.querySelector(".track-title")!.textContent = recording.name ?? null;

  const deleteBtn = trackEl.querySelector(".track-delete") as HTMLButtonElement;
  deleteBtn.onclick = () => deleteTrack(recording.id, trackEl);

  bindTrackPlayButton(trackEl, recording, storage);

  const waveformElem = trackEl.querySelector(".waveform");
  buildWaveform(waveformElem, recording);

  g_tracks.appendChild(clone);
}

async function deleteTrack(id: string, trackEl: HTMLElement) {
  await storage.delete(id);
  await getTracksFromStorage();
  trackEl.classList.add("fade-out");
  setTimeout(() => trackEl.remove(), 250);
}

async function playAllTracks(recordings: StoredAudio[], storage: StorageProvider) {
  for (const rec of recordings) {
    const blob = await storage.get(rec.id);
    const url = URL.createObjectURL(blob);

    let audio: HTMLAudioElement | null = new Audio(url);

    audio.onended = () => {
      activePlayers = activePlayers.filter(p => p !== audio);
      if (activePlayers.length === 0) {
        stopPlayhead();
        stopTimer();
        setTransportState("idle");
      }
      audio = null;
    };

    activePlayers.push(audio);
    audio.play();
  }
}

function stopAllPlayback() {
  console.log("Stopping all playback");
  for (const p of activePlayers) {
    try {
      p.pause();
      p.currentTime = 0;
    } catch (err) {
      console.warn("Error stopping player:", err);
    }
  }
  activePlayers = [];
}


// -------- Per-track Play Button --------
function bindTrackPlayButton(
  trackEl: HTMLElement,
  recording: { id: string },
  storage: StorageProvider
) {
  const playBtn = trackEl.querySelector(".track-play") as HTMLButtonElement;
  let audioEl: HTMLAudioElement | null = null;

  playBtn.onclick = async () => {
    // Stop if already playing
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl = null;
      playBtn.textContent = "▶";
      playBtn.classList.remove("playing");
      return;
    }

    // Start playback
    const blob = await storage.get(recording.id);
    const url = URL.createObjectURL(blob);

    audioEl = new Audio(url);
    audioEl.onended = () => {
      audioEl = null;
      playBtn.textContent = "▶";
      playBtn.classList.remove("playing");
    };

    playBtn.textContent = "⏹";
    playBtn.classList.add("playing");

    await audioEl.play();
  };
}


// ------------------------------------------------------------
// 4. WAVEFORM SYSTEM
// ------------------------------------------------------------
async function buildWaveform(
  waveformElem: Element | null,
  recording: StoredAudio
) {
  if (!waveformElem) return;

  const blob = await storage.get(recording.id);
  const arrayBuffer = await blob.arrayBuffer();

  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const duration = audioBuffer.duration;
  const width = Math.max(50, duration * PIXELS_PER_SECOND * zoom);
  const height = 80;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.classList.add("waveform-canvas");

  waveformElem.innerHTML = "";
  waveformElem.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  const data = audioBuffer.getChannelData(0);

  const step = Math.ceil(data.length / width);
  const amp = height / 2;

  ctx.fillStyle = "#9acd32";
  ctx.clearRect(0, 0, width, height);

  for (let x = 0; x < width; x++) {
    let min = 1.0;
    let max = -1.0;

    for (let j = x * step; j < (x + 1) * step; j++) {
      const v = data[j] ?? 0;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }

    ctx.fillRect(x, (1 + min) * amp, 1, Math.max(1, (max - min) * amp * 2));
  }

  audioCtx.close();
}


// ------------------------------------------------------------
// 5. STORAGE + RECORDER SYSTEM
// ------------------------------------------------------------
async function startRecording() {
  await recorder.start();
  showMeter();
}

async function stopRecording() {
  const blob = await recorder.stop();
  await storage.save(blob);
  stopMeter();
  hideMeter();
}

let meterAnalyser: AnalyserNode | null = null;
let meterDataArray: Uint8Array<ArrayBuffer> | null = null;
let meterAudioCtx: AudioContext | null = null;
let meterRAF = 0;

function connectMeterToStream(stream: MediaStream) {
  meterAudioCtx = new AudioContext();
  const source = meterAudioCtx.createMediaStreamSource(stream);

  meterAnalyser = meterAudioCtx.createAnalyser();
  meterAnalyser.fftSize = 2048;

  source.connect(meterAnalyser);

  meterDataArray = new Uint8Array(meterAnalyser.fftSize);
  updateMeter();
}

function updateMeter() {
  if (!meterAnalyser || !meterDataArray) return;

  meterAnalyser.getByteTimeDomainData(meterDataArray);

  // Compute RMS (Root Mean Square) for loudness
  let sum = 0;
  for (let i = 0; i < meterDataArray.length; i++) {
    const v = (meterDataArray[i]! - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / meterDataArray.length);

  // Convert RMS to decibels
  const db = 20 * Math.log10(rms || 0.00001); // clamp noise floor

  // Convert to 0–100%
  let percent = ((db + 60) / 60) * 100;
  percent = Math.min(Math.max(percent, 0), 100);

  const bar = document.getElementById("meter-bar")!;
  const value = document.getElementById("meter-value")!;
  bar.style.width = percent + "%";

  // Display human-friendly text
  value.textContent = db === -Infinity ? "-∞ dB" : db.toFixed(1) + " dB";

  meterRAF = requestAnimationFrame(updateMeter);
}

recorder.onstream = (stream) => {
  connectMeterToStream(stream);
};


// recorder.onstop = (blob) => {
//   hideMeter();           // <<< NEW
//   stopTimer();
//   setTransportState("idle");
//   saveRecording(blob);
// };


// recorder.onerror = () => {
//   hideMeter();
//   stopTimer();
//   setTransportState("idle");
// };


function showMeter() {
  const meter = document.getElementById("meter");
  meter?.classList.add("visible");
}

function hideMeter() {
  const meter = document.getElementById("meter");
  meter?.classList.remove("visible");
}

/*
call:
stopMeter();
hideMeter();
*/

function stopMeter() {
  cancelAnimationFrame(meterRAF);
  meterAudioCtx?.close();
  meterAudioCtx = null;
  meterAnalyser = null;
  meterDataArray = null;

  const bar = document.getElementById("meter-bar")!;
  bar.style.width = "0%";
  const value = document.getElementById("meter-value")!;
  value.textContent = "-∞ dB";
}




// ------------------------------------------------------------
// 6. MAIN ENTRY POINT
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => main());

async function main() {
  await reloadTracksIntoUI();
  console.log("DAW Ready");
}