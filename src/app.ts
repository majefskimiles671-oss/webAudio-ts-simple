import { AudioEngine } from "./audio/AudioEngine.js";
import { AudioRecorder } from "./audio/AudioRecorder.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
import { TrackManager } from "./tracks/TrackManager.js";
import { WaveformRenderer } from "./tracks/WaveformRenderer.js";
import { TransportController } from "./transport/TransportController.js";

document.addEventListener("DOMContentLoaded", async () => {
  const audio = new AudioEngine();
  const recorder = new AudioRecorder();
  const storage = new LocalStorageProvider();
  const waveform = new WaveformRenderer(audio);
  const tracks = new TrackManager(storage, audio, waveform);
  const transport = new TransportController(audio, tracks, recorder);


  const zoomLevels = [0.25, 0.5, 1, 2, 4];
  const zoomSlider = document.getElementById("zoom-slider") as HTMLInputElement;

  zoomSlider.oninput = async () => {
    const idx = parseInt(zoomSlider.value);
    const zoom = zoomLevels[idx]!;
    await tracks.setZoom(zoom, document.getElementById("g_tracks")!);
  };


  await tracks.loadTracks();
  await tracks.renderTracks(document.getElementById("g_tracks")!, 1);

  transport.bindUI();
});