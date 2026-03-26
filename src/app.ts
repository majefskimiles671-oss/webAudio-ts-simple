// src/app.ts
import { AudioRecorder } from "./audio/AudioRecorder.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
import type { StorageProvider, Recording, StoredAudio } from "./storage/StorageProvider.js";
// import { CloudStorageProvider } from "./storage/CloudStorageProvider.js";

const recorder = new AudioRecorder();
const storage = new LocalStorageProvider();  // ← Swap providers here
let tracksStorage: StoredAudio[];
await getTracksFromStorage(); // from IndexedDB

async function getTracksFromStorage() {
  tracksStorage = await storage.list(); // from IndexedDB
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

g_recBtn.onclick = () => recorder.start();
g_stopBtn.onclick = async () => {
  const blob = await recorder.stop();
  await storage.save(blob);
  loadAllTracksIntoUI();
};
g_playBtn.onclick = async () => {
  await playAllTracks(tracksStorage, storage);
};

async function playAllTracks(recordings: Recording[], storage: StorageProvider) {
  for (const rec of recordings) {
    const blob = await storage.get(rec.id);
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audio.play();
  }
}

function addTrack(recording: any, index: any) {
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
    audioEl.onended = () => {
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
