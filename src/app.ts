// src/app.ts
import { AudioRecorder } from "./audio/AudioRecorder.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
import type { StorageProvider, Recording, StoredAudio } from "./storage/StorageProvider.js";
// import { CloudStorageProvider } from "./storage/CloudStorageProvider.js";

const recorder = new AudioRecorder();
const storage = new LocalStorageProvider();  // ← Swap providers here
let activePlayers: HTMLAudioElement[] = [];
let tracksStorage: StoredAudio[];
await getTracksFromStorage(); // from IndexedDB

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
const g_stopBtn = document.getElementById("g-stop-btn")!;
const g_playBtn = document.getElementById("g-play-btn")!;
const g_tracks = document.getElementById("tracks")!;

g_recBtn.onclick = async () => {
  console.log(1);
  if (transportState === "recording") {
    // already recording, ignore or stop
    return;
  }
  console.log(2);
  setTransportState("recording");
  console.log(3);
  await recorder.start();
  console.log("Should be recording");
};

g_stopBtn.onclick = async () => {
  stopAllPlayback();   // optional if you have this
  stopRecording();     // optional
  setTransportState("idle");
};
g_playBtn.onclick = async () => {
  if (transportState === "playing") {
    stopAllPlayback();
    return;
  }
  setTransportState("playing");
  await playAllTracks(tracksStorage, storage);
};

// Transport State Machine
type TransportState = "idle" | "recording" | "playing";

let transportState: TransportState = "idle";

function setTransportState(state: TransportState) {
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

function stopRecording() {
  recorder.stop();
  onRecordingEnded();
}

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

  // Clear all players
  activePlayers = [];

  // Reset transport UI
  setTransportState("idle");
}


async function playAllTracks(recordings: Recording[], storage: StorageProvider) {
  for (const rec of recordings) {
    const blob = await storage.get(rec.id);
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    activePlayers.push(audio);
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

  // Append to track list
  g_tracks?.appendChild(clone);
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

      // activePlayers = activePlayers.filter(p => p !== audioEl); // may not be needed for per-track playback
      // If no more players, reset transport state
      // if (activePlayers.length === 0) {
      //   setTransportState("idle");
      // } // not for per-track playback

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

loadAllTracksIntoUI();
