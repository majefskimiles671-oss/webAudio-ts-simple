// project-io.js
// Project Save / Load - File System Access API -----

// ============================================================
// State (Truth Layer) -----
// ============================================================

let projectId = null;
let projectFolderHandle = null;

function updateProjectNameDisplay() {
  const el = document.getElementById("project-name-display");
  if (el) el.textContent = projectFolderHandle?.name ?? "";
}

// ============================================================
// Helpers (Pure Computation Layer) -----
// ============================================================

function serializeProject() {
  return {
    version: 1,
    id:         projectId,
    theme:      document.body.getAttribute("data-theme") ?? "earth",
    notesMono:  document.body.getAttribute("data-notes-font") === "mono",
    viewState:  { ...viewState },
    activeScene: document.querySelector("#transport-scenes .transport-scene.active")?.textContent.trim() ?? null,
    sampleRate: SAMPLE_RATE,
    bpm:        tempoBPM,
    timeSignature: {
      beats:     timeSignature.beats,
      noteValue: timeSignature.noteValue,
    },
    tracks: tracks.map(track => ({
      id:      track.id,
      name:    track.name,
      gain:    track.gain,
      pan:     track.pan,
      opacity: track.opacity,
      scenes:  [...track.scenes],
      clips:  track.clips.map(clip => {
        const canvas = document.querySelector(`.waveform[data-clip-id="${clip.id}"] .waveform-canvas`);
        const amplitudesRaw = canvas?.dataset?.amplitudes;
        const amplitudes = amplitudesRaw ? JSON.parse(amplitudesRaw) : undefined;
        return {
          id:              clip.id,
          file:            `clip-${clip.id}.wav`,
          startSample:     clip.startSample,
          durationSamples: clip.durationSamples,
          loopStartSamples: clip.loopStartSamples ?? 0,
          loopEndSamples:   clip.loopEndSamples   ?? clip.durationSamples,
          amplitudes,
        };
      }),
    })),
    chordPanel: (typeof cdGetPanelState === "function") ? cdGetPanelState() : undefined,
    tuning: (typeof currentTuning !== "undefined") ? [...currentTuning.openMidiNotes] : [64, 59, 55, 50, 45, 40],
    chords: (typeof chords !== "undefined" ? chords : []).map(c => ({
      id:       c.id,
      name:     c.name,
      baseFret: c.baseFret,
      frets:    c.frets ?? 5,
      tops:     [...c.tops],
      dots:     c.dots.map(row => [...row]),
    })),
    markers: markers.map(m => ({
      id:         m.id,
      timeSample: Math.round(m.time * SAMPLE_RATE),
      note:       m.note ?? "",
      chordId:    m.chordId ?? null,
    })),
    video: videoFile
      ? {
          filename: "video" + (videoFile.name.match(/\.[^.]+$/) ?? [""])[0],
          opacity:  parseInt(document.getElementById("video-opacity-slider").value),
        }
      : null,
    calibratedLatencyMs: audioEngineGetCalibratedLatency(),
  };
}

// Minimal valid WAV — 44-byte header, mono 16-bit 48 kHz, 0 samples.
// Acts as a placeholder slot; real audio encoding comes later.
function buildPlaceholderWav() {
  const buf  = new ArrayBuffer(44);
  const view = new DataView(buf);
  const sr   = SAMPLE_RATE;

  const write = (offset, str) =>
    [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  write(0,  "RIFF");
  view.setUint32(4,  36, true);    // file size − 8 (header only, no samples)
  write(8,  "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16,     true); // fmt chunk size (PCM)
  view.setUint16(20,  1,     true); // audio format: PCM
  view.setUint16(22,  1,     true); // channels: mono
  view.setUint32(24, sr,     true); // sample rate
  view.setUint32(28, sr * 2, true); // byte rate (sr × 1 ch × 2 bytes)
  view.setUint16(32,  2,     true); // block align (1 ch × 2 bytes)
  view.setUint16(34, 16,     true); // bits per sample
  write(36, "data");
  view.setUint32(40, 0, true);      // data chunk size: 0 bytes

  return new Uint8Array(buf);
}

// ============================================================
// Authority (Meaning Layer) -----
// ============================================================

function deserializeProject(data) {
  // ----- Reset DOM and state -----

  removeVideo();
  audioEngineClearBuffers();
  tracks.forEach(t => { t.controlRow.remove(); t.timelineRow.remove(); });
  tracks.length = 0;

  if (recordingLaneTrack) {
    recordingLaneTrack.controlRow.remove();
    recordingLaneTrack.timelineRow.remove();
    recordingLaneTrack = null;
  }

  trackCount    = 0;
  markers.length = 0;
  selectedMarkerId = null;

  // ----- Restore musical state -----

  audioEngineSetCalibratedLatency(data.calibratedLatencyMs ?? 0);
  if (typeof updateCalibrateMenuItem === "function") updateCalibrateMenuItem();

  if (data.theme) setTheme(data.theme, { silent: true });
  document.body.setAttribute("data-notes-font", data.notesMono ? "mono" : "");
  if (data.viewState) {
    Object.assign(viewState, data.viewState);
    applyViewState();
  }

  const sr  = data.sampleRate ?? SAMPLE_RATE;
  tempoBPM  = data.bpm ?? 120;
  bpm       = tempoBPM;
  setTimeSignature(data.timeSignature.beats, data.timeSignature.noteValue);

  // ----- Restore tracks -----
  // Saved order is newest-first. Iterating in reverse (oldest first) and
  // prepending each track preserves the original DOM order after the loop.

  const savedTracks = data.tracks ?? [];
  for (let i = savedTracks.length - 1; i >= 0; i--) {
    const saved = savedTracks[i];
    const track = createTrack(saved.name, { prepend: true });

    // Gain
    track.gain = saved.gain ?? 80;
    const gainEl = track.controlRow.querySelector("gain-slider");
    if (gainEl) gainEl.value = track.gain;

    // Pan
    track.pan = saved.pan ?? 0;
    const panEl = track.controlRow.querySelector("pan-slider");
    if (panEl) panEl.value = track.pan;

    // Opacity
    track.opacity = saved.opacity ?? 100;
    const opEl = track.controlRow.querySelector(".row-opacity-slider");
    if (opEl) opEl.value = track.opacity;
    track.timelineRow.style.opacity = track.opacity / 100;

    // Scene assignments
    track.scenes = saved.scenes ?? [];
    track.scenes.forEach(letter => {
      const btn = Array.from(track.controlRow.querySelectorAll(".track-scene"))
        .find(b => b.textContent.trim() === letter);
      if (btn) btn.classList.add("active");
    });

    // Clips — restore state with saved IDs, then render waveform
    for (const savedClip of (saved.clips ?? [])) {
      const clip = {
        id:              savedClip.id,
        startSample:     savedClip.startSample,
        durationSamples: savedClip.durationSamples,
        loopStartSamples: savedClip.loopStartSamples ?? 0,
        loopEndSamples:   savedClip.loopEndSamples   ?? savedClip.durationSamples,
      };
      track.clips.push(clip);

      const startSeconds    = clip.startSample    / sr;
      const durationSeconds = clip.durationSamples / sr;

      const rowInner = track.timelineRow.querySelector(".row-inner");
      const waveform = document.createElement("div");
      waveform.className    = "waveform";
      waveform.dataset.clipId = clip.id;
      waveform.dataset.startSeconds = startSeconds;

      const canvas = document.createElement("canvas");
      canvas.className = "waveform-canvas";
      canvas.height    = 80;
      canvas.dataset.durationSeconds = durationSeconds;
      canvas.width     = Math.min(computeWaveformWidth(durationSeconds), MAX_CANVAS_PX);

      waveform.style.left  = `${secondsToPixels(startSeconds)}px`;
      waveform.style.width = `${computeWaveformWidth(durationSeconds)}px`;

      canvas.dataset.amplitudes = JSON.stringify(
        (Array.isArray(clip.amplitudes) && clip.amplitudes.length > 0)
          ? clip.amplitudes
          : generateWaveformData(256)
      );
      drawDummyWaveform(canvas);

      waveform.appendChild(canvas);
      attachClipDeleteButton(waveform);
      rowInner.appendChild(waveform);
    }

    tracks.unshift(track);
  }

  // ----- Restore markers -----

  for (const saved of (data.markers ?? [])) {
    markers.push({ id: saved.id, time: saved.timeSample / sr, note: saved.note ?? "", chordId: saved.chordId ?? null });
  }
  markers.sort((a, b) => a.time - b.time);
  selectedMarkerId = markers[0]?.id ?? null;

  // ----- Restore chords -----

  if (typeof currentTuning !== "undefined" && Array.isArray(data.tuning)) {
    currentTuning = tuning(data.tuning);
  }

  if (typeof chords !== "undefined") {
    chords.length = 0;
    for (const c of (data.chords ?? [])) {
      const f = c.frets ?? 5;
      chords.push({
        id:       c.id,
        name:     c.name ?? "",
        baseFret: c.baseFret ?? 1,
        frets:    f,
        tops:     c.tops ?? Array(6).fill(null),
        dots:     c.dots ?? Array.from({ length: 6 }, () => Array(f).fill(false)),
      });
    }
    if (typeof cdRenderDialog === "function") cdRenderDialog();
    if (typeof cdSetPanelState === "function") cdSetPanelState(data.chordPanel);
  }

  // ----- Fresh recording lane -----

  createRecordingLane();

  // ----- Re-render -----

  renderTempo();
  syncTimelineMinWidth();
  renderTimelineLayer();
  renderMarkerTransport();
  renderBottomPanel();
  if (data.activeScene) {
    document.querySelectorAll("#transport-scenes .transport-scene").forEach(btn => {
      btn.classList.toggle("active", btn.textContent.trim() === data.activeScene);
    });
  }
  updateSceneMask();
  updateSoloMask();
  syncTimelineOverlay();
  syncTimelineOverlayWidth();
}

// ============================================================
// Save / Open (File System Access API) -----
// ============================================================

async function loadVideoFromFolder(dataHandle, data) {
  if (!data.video?.filename) return;
  try {
    const vidHandle = await dataHandle.getFileHandle(data.video.filename);
    const file = await vidHandle.getFile();
    loadVideoFile(file, { opacity: data.video.opacity ?? 45 });
  } catch {
    // video file missing — skip silently
  }
}

async function saveProject() {
  try {
    if (!projectId) projectId = crypto.randomUUID();

    if (!projectFolderHandle) {
      const parent = await window.showDirectoryPicker({ mode: "readwrite" });
      projectFolderHandle = await parent.getDirectoryHandle(projectId, { create: true });
      updateProjectNameDisplay();
    }

    const dataHandle = await projectFolderHandle.getDirectoryHandle("data", { create: true });

    // Write project.json (project root only)
    const data = serializeProject();
    console.log("saveProject:", data);
    localStorage.setItem("previousProjectData", JSON.stringify(data));
    const jsonHandle = await projectFolderHandle.getFileHandle("project.json", { create: true });
    const jsonWriter = await jsonHandle.createWritable();
    await jsonWriter.write(JSON.stringify(data, null, 2));
    await jsonWriter.close();

    // Write WAV for each clip into data/
    for (const track of tracks) {
      for (const clip of track.clips) {
        const filename  = `clip-${clip.id}.wav`;
        const wavHandle = await dataHandle.getFileHandle(filename, { create: true });
        const wavWriter = await wavHandle.createWritable();
        const payload   = audioEngineHasBuffer(clip.id)
          ? audioEngineEncodeWav(audioEngineGetBuffer(clip.id))
          : buildPlaceholderWav();
        await wavWriter.write(payload);
        await wavWriter.close();
      }
    }

    // Write video file into data/
    if (videoFile && data.video) {
      const vidHandle = await dataHandle.getFileHandle(data.video.filename, { create: true });
      const vidWriter = await vidHandle.createWritable();
      await vidWriter.write(videoFile);
      await vidWriter.close();
    }

    clearDirty();
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Save failed:", err);
      alert("Save failed. See console for details.");
    }
  }
}

async function reconnectProjectFolder() {
  const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  let projectData;
  try {
    const jsonHandle = await folderHandle.getFileHandle('project.json');
    projectData = JSON.parse(await (await jsonHandle.getFile()).text());
  } catch {
    alert("This folder doesn't contain a BareTrack project.");
    return false;
  }
  projectFolderHandle = folderHandle;
  updateProjectNameDisplay();

  let dataHandle = null;
  try { dataHandle = await folderHandle.getDirectoryHandle("data"); } catch { /* no data folder */ }

  if (dataHandle) {
    for (const track of tracks) {
      for (const clip of track.clips) {
        try {
          const wavHandle   = await dataHandle.getFileHandle(`clip-${clip.id}.wav`);
          const wavFile     = await wavHandle.getFile();
          const arrayBuffer = await wavFile.arrayBuffer();
          if (arrayBuffer.byteLength <= 44) continue;
          const audioBuffer = await audioEngineDecodeWav(arrayBuffer);
          audioEngineStoreBuffer(clip.id, audioBuffer);
          updateClipWaveform(clip.id, audioBuffer);
        } catch {
          // file missing or undecodable — clip stays silent
        }
      }
    }
    await loadVideoFromFolder(dataHandle, projectData);
  }
  clearDirty();
  return true;
}

async function openProject() {
  try {
    const folderHandle = await window.showDirectoryPicker({ mode: "readwrite" });

    let jsonHandle;
    try {
      jsonHandle = await folderHandle.getFileHandle("project.json");
    } catch {
      alert("This folder doesn't contain a BareTrack project.");
      return;
    }

    const file = await jsonHandle.getFile();
    const data = JSON.parse(await file.text());

    projectId            = data.id ?? folderHandle.name;
    projectFolderHandle  = folderHandle;
    updateProjectNameDisplay();

    localStorage.setItem("previousProjectData", JSON.stringify(data));
    deserializeProject(data);

    let dataHandle = null;
    try { dataHandle = await folderHandle.getDirectoryHandle("data"); } catch { /* no data folder */ }

    // Decode each clip's WAV from data/ into the audio engine
    if (dataHandle) {
      for (const savedTrack of (data.tracks ?? [])) {
        for (const savedClip of (savedTrack.clips ?? [])) {
          if (!savedClip.file) continue;
          try {
            const wavHandle   = await dataHandle.getFileHandle(savedClip.file);
            const wavFile     = await wavHandle.getFile();
            const arrayBuffer = await wavFile.arrayBuffer();
            if (arrayBuffer.byteLength <= 44) continue; // placeholder — no samples
            const audioBuffer = await audioEngineDecodeWav(arrayBuffer);
            audioEngineStoreBuffer(savedClip.id, audioBuffer);
            updateClipWaveform(savedClip.id, audioBuffer);
          } catch {
            // file missing or undecodable — clip is silent
          }
        }
      }
      await loadVideoFromFolder(dataHandle, data);
    }

    clearDirty();
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Open failed:", err);
      alert("Failed to open project. See console for details.");
    }
  }
}

window.addEventListener("beforeunload", () => {
  if (localStorage.getItem("autoOpenPreviousProject") === "1") {
    localStorage.setItem("previousProjectData", JSON.stringify(serializeProject()));
  }
});
