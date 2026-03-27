import { AudioEngine } from "./audio/AudioEngine.js";
import { AudioInspector } from "./audio/AudioInspector.js";
import { AudioRecorder } from "./audio/AudioRecorder.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
import { TrackManager } from "./tracks/TrackManager.js";
import { WaveformRenderer } from "./tracks/WaveformRenderer.js";
import { TransportController } from "./transport/TransportController.js";

document.addEventListener("DOMContentLoaded", async () => {
  const audio = new AudioEngine();
  const inspector = new AudioInspector(audio);
  const recorder = new AudioRecorder();
  const storage = new LocalStorageProvider();
  const waveform = new WaveformRenderer(audio);
  const tracks = new TrackManager(storage, audio, waveform, inspector);
  const transport = new TransportController(audio, tracks, recorder);

  await tracks.loadTracks();
  await tracks.renderTracks(document.getElementById("g_tracks")!, 1);

  transport.bindUI();
});