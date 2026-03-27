// src/app.ts
import { AudioRecorder } from "./audio/AudioRecorder.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
import type { StorageProvider, Recording, StoredAudio } from "./storage/StorageProvider.js";
// import { CloudStorageProvider } from "./storage/CloudStorageProvider.js";

document.addEventListener("DOMContentLoaded", () => main());

async function main() {
  await getTracksFromStorage(); // from IndexedDB
  await loadAllTracksIntoUI();
  // bindTransportButtons();
  // initPlayhead();
  console.log("DAW Ready");
}


function getTimelineWidth() {
  const tracksContainer = document.getElementById("g_tracks")!;
  return tracksContainer.clientWidth;
}


const recorder = new AudioRecorder();
const storage = new LocalStorageProvider();  // ← Swap providers here
let activePlayers: HTMLAudioElement[] = [];
let tracksStorage: StoredAudio[];


async function getTracksFromStorage() {
  tracksStorage = await storage.list(); // from IndexedDB
  console.log(`Got ${tracksStorage.length} items from storage`);
}

async function loadAllTracksIntoUI() {
  g_tracks.innerHTML = "";
  await getTracksFromStorage();
  tracksStorage.forEach((rec, idx) => addTrack(rec, idx));
}

const g_recBtn = document.getElementById("g-record-btn")!;
// const g_stopBtn = document.getElementById("g-stop-btn")!;
const g_playBtn = document.getElementById("g-play-btn")!;
const g_tracks = document.getElementById("g_tracks")!;
async function startRecording() {
  await recorder.start();
}
g_recBtn.onclick = async () => {

  if (transportState === "idle") {
    // start recording
    await startRecording();
    setTransportState("recording");
  }
  else if (transportState === "recording") {
    // toggle off
    await stopRecording();
    stopPlayhead();
    onRecordingEnded();
    await getTracksFromStorage();
    loadAllTracksIntoUI();
  }
  else if (transportState === "playing") {
    // do nothing
    return;
  }
  // AI says to make sure the AudioElement.onstop changes the state to idle
};

// g_stopBtn.onclick = async () => {
//   stopAllPlayback();
//   await stopRecording();
//   stopPlayhead();
//   onRecordingEnded();
//   await getTracksFromStorage();
//   loadAllTracksIntoUI();
// };
g_playBtn.onclick = async () => {
  if (transportState === "idle") {
    await playAllTracks(tracksStorage, storage);
    startPlayhead();
    setTransportState("playing");
    return;
  }
  else if (transportState === "playing") {
    stopAllPlayback();
    stopPlayhead();
    onPlaybackEnded();
    return;
  }
  else if (transportState === "recording") {
    // stopAllPlayback();
    // await stopRecording();
    // stopPlayhead();
    // onRecordingEnded();
    // await getTracksFromStorage();
    // loadAllTracksIntoUI();
    return;
  }
};

// Transport State Machine
type TransportState = "idle" | "recording" | "playing";

let transportState: TransportState = "idle";

function setTransportState(state: TransportState) {
  console.log(`Transport State: ${transportState} => ${state}`);
  transportState = state;

  const recordBtn = document.getElementById("g-record-btn") as HTMLButtonElement;
  const playBtn = document.getElementById("g-play-btn") as HTMLButtonElement;

  recordBtn.classList.remove("active");
  playBtn.classList.remove("active");

  switch (state) {
    case "recording":
      recordBtn.classList.add("active");
      break;
    case "playing":
      playBtn.classList.add("active");
      break;
    case "idle":
    default:
      // nothing stays active
      console.log("Default state");
      break;
  }
}

/**
 * Call this:
 * After Stop is pressed
 * On overrun/out-of-memory
 * On user cancellation
 * On MediaRecorder "stop" event
 */
function onRecordingEnded() {
  setTransportState("idle");
}

/**
 * Track end events
 * stopAllTracks()
 * When you switch tracks
 * When you start a new recording
 * If browser runs out of audio memory, etc.
 */
function onPlaybackEnded() {
  setTransportState("idle");
}

async function stopRecording() {
  const blob = await recorder.stop();
  await storage.save(blob);
}

// not sure this is right
function stopAllPlayback() {
  console.log("stopping all playback");
  for (const player of activePlayers) {
    try {
      player.pause();
      player.currentTime = 0;
    } catch (e) {
      console.warn("Error stopping player:", e);
    }
  }

  // // Clear all players
  // activePlayers = [];

  // // Reset transport UI
  // setTransportState("idle");
}

// 
// Playhead
//
let playheadAnimationFrame = 0;
let playheadStartTime = 0;
function startPlayhead() {
  const playhead = document.getElementById("playhead")!;
  playheadStartTime = performance.now();
  animatePlayhead();
}


const PIXELS_PER_SECOND = 100;
const playhead = document.getElementById("playhead")!;

function animatePlayhead() {
  const elapsed = (performance.now() - playheadStartTime) / 1000;
  const x = elapsed * PIXELS_PER_SECOND;

  playhead.style.transform = `translateX(${x}px)`;
  playheadAnimationFrame = requestAnimationFrame(animatePlayhead);
}


// function animatePlayhead() {
//   const playhead = document.getElementById("playhead")!;
//   const elapsed = (performance.now() - playheadStartTime) / 1000; // seconds

//   const px = elapsed * 100; // 100px per second (or whatever your timeline scale is)
//   playhead.style.transform = `translateX(${px}px)`;
//   const timelineWidth = getTimelineWidth();
//   const x = Math.min(px, timelineWidth);
//   playhead.style.transform = `translateX(${x}px)`;
//   playheadAnimationFrame = requestAnimationFrame(animatePlayhead);
// }

function stopPlayhead() {
  console.log("stopPlayhead");
  cancelAnimationFrame(playheadAnimationFrame);
  const playhead = document.getElementById("playhead")!;
  playhead.style.transform = "translateX(0px)";
}


async function playAllTracks(recordings: Recording[], storage: StorageProvider) {
  for (const rec of recordings) {
    const blob = await storage.get(rec.id);
    const url = URL.createObjectURL(blob);

    let audio: HTMLAudioElement | null = new Audio(url);
    audio.onended = () => {
      activePlayers = activePlayers.filter(p => p !== audio);
      console.log(`activePlayers count onended: ${activePlayers.length}`);
      // If no more players, reset transport state
      if (activePlayers.length === 0) {
        stopPlayhead();
        setTransportState("idle");
      }
      audio = null;
    };
    activePlayers.push(audio);
    console.log(`activePlayers count: ${activePlayers.length}`);
    audio.play();
  }
}

function addTrack(recording: any, index: any) {
  console.log("addtrack");
  const template = document.getElementById("track-template")! as HTMLTemplateElement;
  const clone = template.content.cloneNode(true) as DocumentFragment;
  const trackEl = clone.querySelector(".track") as HTMLElement;

  trackEl.querySelector(".track-title")!.textContent = recording.name;

  const deleteBtn = trackEl.querySelector(".track-delete") as HTMLButtonElement;
  deleteBtn.onclick = () => deleteTrack(recording.id, trackEl, storage);

  const playBtn = trackEl.querySelector(".track-play") as HTMLButtonElement;
  bindTrackPlayButton(trackEl, recording, storage);

  const waveformElem = trackEl.querySelector(".waveform");
  buildWaveform(waveformElem, recording, index);

  // Append to track list
  g_tracks?.appendChild(clone);
}


async function buildWaveform(
  waveformElem: Element | null,
  recording: Recording,
  index: number
) {
  if (!waveformElem) return;

  const blob = await storage.get(recording.id);
  const arrayBuffer = await blob.arrayBuffer();

  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const duration = audioBuffer.duration;

  // Choose your DAW scale (100px/sec is a good start)
  const PIXELS_PER_SECOND = 100;
  const width = Math.max(50, duration * PIXELS_PER_SECOND);
  const height = 80;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.classList.add("waveform-canvas");

  waveformElem.innerHTML = "";
  waveformElem.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  const data = audioBuffer.getChannelData(0);

  // Draw
  const step = Math.ceil(data.length / width);
  const amp = height / 2;

  ctx.fillStyle = "#9acd32";
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < width; i++) {
    let min = 1.0;
    let max = -1.0;
    for (let j = i * step; j < (i + 1) * step; j++) {
      const v = data[j] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp * 2));
  }

  audioCtx.close();
}


async function deleteTrack(id: string, trackEl: HTMLElement, storage: StorageProvider) {
  await storage.delete(id);
  await getTracksFromStorage();
  trackEl.classList.add("fade-out");
  setTimeout(() => trackEl.remove(), 250);
}

function bindTrackPlayButton(
  trackEl: HTMLElement,
  recording: { id: string },
  storage: StorageProvider
) {
  const playBtn = trackEl.querySelector(".track-play") as HTMLButtonElement;

  // Attach a per-track state object
  let audioEl: HTMLAudioElement | null = null;

  playBtn.onclick = async () => {
    // If already playing → stop it
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl = null;
      playBtn.textContent = "▶";
      playBtn.classList.remove("playing");
      return;
    }

    // Otherwise: start playing
    const blob = await storage.get(recording.id);
    const url = URL.createObjectURL(blob);

    audioEl = new Audio(url);
    // activePlayers.push(audioEl);
    audioEl.onended = () => {

      activePlayers = activePlayers.filter(p => p !== audioEl); // may not be needed for per-track playback
      // If no more players, reset transport state
      if (activePlayers.length === 0) {
        setTransportState("idle");
      } // maybe not for per-track playback?

      // Reset UI when done playing
      audioEl = null;
      playBtn.textContent = "▶";
      playBtn.classList.remove("playing");
    };

    playBtn.textContent = "⏹";  // stop icon
    playBtn.classList.add("playing");

    await audioEl.play();
  };
}


// document.addEventListener("DOMContentLoaded", () => main());

// async function main() {
//   await loadAllTracksIntoUI();
//   bindTransportButtons();
//   initPlayhead();
//   console.log("DAW Ready");
// }
