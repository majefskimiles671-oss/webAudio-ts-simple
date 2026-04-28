// project-io.js
// Project Save / Load - File System Access API -----

function log(...args) {
  const ts = new Date().toISOString().slice(11, 23);
  const hue = Math.floor(Math.random() * 360);
  const color = `hsl(${hue},70%,45%)`;
  if (typeof args[0] === 'string') {
    console.log(`%c[${ts}]%c ${args[0]}`, `color:${color}`, '', ...args.slice(1));
  } else {
    console.log(`%c[${ts}]%c`, `color:${color}`, '', ...args);
  }
}

// ============================================================
// State (Truth Layer) -----
// ============================================================

let projectId = null;
let projectFolderHandle = null;
let workspaceFolderHandle = null;

function updateProjectNameDisplay() {
  const el = document.getElementById("project-name-display");
  if (el) el.textContent = projectFolderHandle?.name ?? "";
}

function updateWorkspaceDisplay() {
  const nameEl = document.getElementById("workspace-name-display");
  if (nameEl) nameEl.textContent = workspaceFolderHandle?.name ?? "";
  const menuEl = document.getElementById("menu-set-workspace");
  if (menuEl) {
    menuEl.textContent = workspaceFolderHandle
      ? `Workspace: ${workspaceFolderHandle.name}…`
      : "Set Workspace…";
  }
}

function _updateProjectMenuItems(enabled) {
  for (const id of ["menu-open-project", "menu-save-project"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute("aria-disabled", enabled ? "false" : "true");
    el.classList.toggle("menu-item-disabled", !enabled);
  }
}

// ============================================================
// IndexedDB helpers (workspace handle persistence) -----
// ============================================================

function _openWorkspaceDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("baretrack-workspace", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _saveWorkspaceHandle(handle) {
  try {
    const db = await _openWorkspaceDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put(handle, "workspace");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* IndexedDB unavailable — workspace won't persist across sessions */ }
}

async function _loadWorkspaceHandle() {
  try {
    const db = await _openWorkspaceDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readonly");
      const req = tx.objectStore("handles").get("workspace");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ============================================================
// Workspace functions -----
// ============================================================

async function initWorkspace() {
  const handle = await _loadWorkspaceHandle();
  if (!handle) { _updateProjectMenuItems(false); return; }
  try {
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission === 'granted') {
      workspaceFolderHandle = handle;
      updateWorkspaceDisplay();
      _updateProjectMenuItems(true);
    } else {
      _updateProjectMenuItems(false);
    }
  } catch { _updateProjectMenuItems(false); /* permission unavailable — user must re-set workspace manually */ }
}

async function setWorkspace() {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    workspaceFolderHandle = dirHandle;
    await _saveWorkspaceHandle(dirHandle);
    updateWorkspaceDisplay();
    _updateProjectMenuItems(true);
    await showProjectPicker();
  } catch (err) {
    if (err.name !== 'AbortError') console.error('setWorkspace failed:', err);
  }
}

async function scanWorkspaceProjects() {
  const results = [];
  for await (const entry of workspaceFolderHandle.values()) {
    if (entry.kind !== 'directory') continue;
    try {
      const jsonHandle = await entry.getFileHandle('project.json');
      const data = JSON.parse(await (await jsonHandle.getFile()).text());
      results.push({
        dirHandle: entry,
        name: entry.name,
        bpm: data.bpm,
        timeSignature: data.timeSignature,
        trackCount: data.tracks?.length ?? 0,
        theme: data.theme,
      });
    } catch { /* skip — no project.json or malformed JSON */ }
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

async function showProjectPicker() {
  const dialog   = document.getElementById("project-picker-dialog");
  const list     = document.getElementById("project-picker-list");
  const emptyMsg = document.getElementById("project-picker-empty");

  list.innerHTML = "";
  emptyMsg.hidden = true;
  dialog.hidden = false;

  let projects;
  try { projects = await scanWorkspaceProjects(); }
  catch { projects = []; }

  if (projects.length === 0) {
    emptyMsg.hidden = false;
  } else {
    for (const proj of projects) {
      const sig  = proj.timeSignature
        ? `${proj.timeSignature.beats}/${proj.timeSignature.noteValue}`
        : "";
      const meta = [
        proj.bpm ? `${proj.bpm} BPM` : "",
        sig,
        proj.trackCount ? `${proj.trackCount} track${proj.trackCount !== 1 ? 's' : ''}` : "",
        proj.theme || "",
      ].filter(Boolean).join(" · ");

      const row = document.createElement("div");
      row.className = "pp-row";
      row.innerHTML = `
        <span class="pp-name">${escapeHtml(proj.name)}</span>
        <span class="pp-meta">${escapeHtml(meta)}</span>
        <button class="pp-open-btn">Open</button>
      `;
      row.querySelector(".pp-open-btn").addEventListener("click", async () => {
        dialog.hidden = true;
        _removePickerListeners();
        await _loadProjectFromHandle(proj.dirHandle);
      });
      list.appendChild(row);
    }
  }

  document.getElementById("project-picker-new-btn").onclick = async () => {
    if (typeof _dirty !== "undefined" && _dirty &&
        !confirm("Create a new project? All unsaved work will be lost.")) return;
    dialog.hidden = true;
    _removePickerListeners();
    const name = await _promptProjectName();
    if (!name) return;
    projectFolderHandle = await workspaceFolderHandle.getDirectoryHandle(name, { create: true });
    updateProjectNameDisplay();
    await saveProject();
  };

  document.getElementById("project-picker-change-btn").onclick = () => {
    dialog.hidden = true;
    _removePickerListeners();
    setWorkspace();
  };

  document.getElementById("project-picker-cancel-btn").onclick = () => {
    dialog.hidden = true;
    _removePickerListeners();
  };

  function _onBackdropClick(e) {
    if (e.target === dialog) { dialog.hidden = true; _removePickerListeners(); }
  }
  function _onEscape(e) {
    if (e.key === "Escape" && !dialog.hidden) { dialog.hidden = true; _removePickerListeners(); }
  }
  function _removePickerListeners() {
    dialog.removeEventListener("click", _onBackdropClick);
    document.removeEventListener("keydown", _onEscape);
  }
  dialog.addEventListener("click", _onBackdropClick);
  document.addEventListener("keydown", _onEscape);
}

async function _loadProjectFromHandle(folderHandle) {
  try {
    const jsonHandle = await folderHandle.getFileHandle("project.json");
    const data = JSON.parse(await (await jsonHandle.getFile()).text());

    projectId           = data.id ?? folderHandle.name;
    projectFolderHandle = folderHandle;
    log("openProject folder:", folderHandle.name);
    updateProjectNameDisplay();
    localStorage.setItem("previousProjectData", JSON.stringify(data));
    deserializeProject(data);

    let dataHandle = null;
    try { dataHandle = await folderHandle.getDirectoryHandle("data"); } catch { /* no data folder */ }

    if (dataHandle) {
      for (const savedTrack of (data.tracks ?? [])) {
        for (const savedClip of (savedTrack.clips ?? [])) {
          if (!savedClip.file) continue;
          try {
            const wavHandle   = await dataHandle.getFileHandle(savedClip.file);
            const wavFile     = await wavHandle.getFile();
            const arrayBuffer = await wavFile.arrayBuffer();
            if (arrayBuffer.byteLength <= 44) continue;
            const audioBuffer = await audioEngineDecodeWav(arrayBuffer);
            audioEngineStoreBuffer(savedClip.id, audioBuffer);
            updateClipWaveform(savedClip.id, audioBuffer);
          } catch { /* file missing or undecodable — clip is silent */ }
        }
      }
      await loadVideoFromFolder(dataHandle, data);
    }

    clearDirty();
  } catch (err) {
    console.error("_loadProjectFromHandle failed:", err);
    alert("Failed to load project. See console for details.");
  }
}

function _promptProjectName() {
  return new Promise(resolve => {
    const dialog    = document.getElementById("project-name-prompt-dialog");
    const input     = document.getElementById("project-name-prompt-input");
    const okBtn     = document.getElementById("project-name-prompt-ok");
    const cancelBtn = document.getElementById("project-name-prompt-cancel");

    input.value = "";
    okBtn.disabled = true;
    dialog.hidden = false;
    input.focus();

    function _finish(value) {
      dialog.hidden = true;
      input.removeEventListener("input", _onInput);
      okBtn.removeEventListener("click", _onOk);
      cancelBtn.removeEventListener("click", _onCancel);
      input.removeEventListener("keydown", _onKeydown);
      resolve(value);
    }
    function _onInput()    { okBtn.disabled = input.value.trim() === ""; }
    function _onOk()       { const v = input.value.trim(); if (v) _finish(v); }
    function _onCancel()   { _finish(null); }
    function _onKeydown(e) {
      if (e.key === "Enter"  && !okBtn.disabled) { e.preventDefault(); _onOk(); }
      if (e.key === "Escape")                    { e.preventDefault(); _onCancel(); }
    }

    input.addEventListener("input",   _onInput);
    okBtn.addEventListener("click",   _onOk);
    cancelBtn.addEventListener("click", _onCancel);
    input.addEventListener("keydown", _onKeydown);
  });
}

// ============================================================
// Helpers (Pure Computation Layer) -----
// ============================================================

function serializeProject() {
  return {
    version: 1,
    id:         projectId,
    theme:        document.body.getAttribute("data-theme") ?? "Ice9",
    notesMono:    document.body.getAttribute("data-notes-font") === "mono",
    viewState:    { ...viewState },
    themeRatings: { ...themeRatings },
    activeScene: document.querySelector("#transport-scenes .transport-scene.active")?.textContent.trim() ?? null,
    sampleRate: SAMPLE_RATE,
    bpm:        tempoBPM,
    timeSignature: {
      beats:     timeSignature.beats,
      noteValue: timeSignature.noteValue,
    },
    tracks: tracks.map(track => ({
      id:         track.id,
      name:       track.name,
      type:       track.type ?? 'audio',
      gain:       track.gain,
      pan:        track.pan,
      opacity:    track.opacity,
      instrument:     track.instrument,
      gmProgram:      track.gmProgram ?? 0,
      sfzName:        track.sfzName   ?? null,
      outputDeviceId: track.outputDeviceId ?? null,
      scenes:         [...track.scenes],
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
      midiClips: track.midiClips.map(clip => ({
        id:              clip.id,
        startSample:     clip.startSample,
        durationSamples: clip.durationSamples,
        events:          clip.events.map(e => ({ offsetSamples: e.offsetSamples, chordId: e.chordId })),
        notes:           clip.notes?.map(n => ({ pitch: n.pitch, startSamples: n.startSamples, durationSamples: n.durationSamples, velocity: n.velocity })),
      })),
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
      tab:      c.tab ?? null,
    })),
    markers: markers.map(m => ({
      id:         m.id,
      timeSample: Math.round(m.time * SAMPLE_RATE),
      note:       m.note ?? "",
      chordId:    m.chordId ?? null,
    })),
    mixer: {
      masterGain:          parseInt(document.getElementById("master-gain-slider").value),
      masterVolPreset:     document.getElementById("master-vol-preset").value,
      masterOutputDeviceId: audioEngineGetMasterOutputDeviceId(),
      reverbOn:            document.getElementById("reverb-toggle").classList.contains("active"),
      reverbPreset:        document.getElementById("reverb-preset").value,
      reverbWet:           parseInt(document.getElementById("master-reverb-wet").value),
      reverbSize:          parseInt(document.getElementById("master-reverb-size").value),
      compOn:              document.getElementById("comp-toggle").classList.contains("active"),
      compPreset:          document.getElementById("comp-preset").value,
      compThreshold:       parseFloat(document.getElementById("master-comp-threshold").value),
      compRatio:           parseFloat(document.getElementById("master-comp-ratio").value),
      synthLen:            parseInt(document.getElementById("synth-note-length").value),
      synthLenPreset:      document.getElementById("synth-len-preset").value,
      tanpuraOn:           document.getElementById("tanpura-toggle").classList.contains("active"),
      tanpuraMode:         document.getElementById("tanpura-mode").value,
      tanpuraVol:          parseInt(document.getElementById("tanpura-volume").value),
      tanpuraRate:         parseInt(document.getElementById("tanpura-rate").value),
      tanpuraRateSync:     document.getElementById("tanpura-rate-sync").value,
      tanpuraSynthLen:     parseInt(document.getElementById("tanpura-synth-length").value),
      tanpuraSynthLenPreset: document.getElementById("tanpura-synth-len-preset").value,
      tanpuraS1:           parseInt(document.getElementById("tanpura-s1-vol").value),
      tanpuraS2:           parseInt(document.getElementById("tanpura-s2-vol").value),
      tanpuraS3:           parseInt(document.getElementById("tanpura-s3-vol").value),
      tanpuraS4:           parseInt(document.getElementById("tanpura-s4-vol").value),
      sectionCollapsed:    Object.fromEntries(
        [...document.querySelectorAll('.master-section')].map(s => [
          s.querySelector('.master-heading').textContent.trim().toLowerCase(),
          s.classList.contains('collapsed'),
        ])
      ),
      groupCollapsed:      Object.fromEntries(
        [...document.querySelectorAll('.master-group')].map(g => [
          g.querySelector('.master-group-label').textContent.trim().toLowerCase(),
          g.classList.contains('collapsed'),
        ])
      ),
      soundfontFileName: (typeof sfGetProjectFile === 'function') ? (sfGetProjectFile()?.name ?? null) : null,
    },
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

  // ----- Restore mixer -----

  const mx = data.mixer;
  if (mx) {
    const mgain = mx.masterGain ?? 100;
    document.getElementById("master-gain-slider").value = mgain;
    masterGain = mgain;
    audioEngineSetMasterGain(mgain / 100);
    document.getElementById("master-vol-preset").value = mx.masterVolPreset ?? "";

    const masterOutId = mx.masterOutputDeviceId ?? null;
    if (masterOutId) {
      audioEngineSetMasterOutput(masterOutId).then(() => {
        const sel = document.getElementById("master-output-select");
        if (sel) sel.value = masterOutId;
      });
    }

    const reverbOn = mx.reverbOn ?? true;
    document.getElementById("reverb-toggle").classList.toggle("active", reverbOn);
    document.getElementById("reverb-toggle").textContent = reverbOn ? "ON" : "OFF";
    document.getElementById("reverb-preset").value  = mx.reverbPreset ?? "";
    const rWet  = mx.reverbWet  ?? 20;
    const rSize = mx.reverbSize ?? 18;
    document.getElementById("master-reverb-wet").value  = rWet;
    document.getElementById("master-reverb-size").value = rSize;
    audioEngineSetReverbWet(reverbOn ? rWet / 100 : 0);
    audioEngineSetReverbDecay(0.3 + (rSize / 100) * 5.7);

    const compOn = mx.compOn ?? true;
    document.getElementById("comp-toggle").classList.toggle("active", compOn);
    document.getElementById("comp-toggle").textContent = compOn ? "ON" : "OFF";
    document.getElementById("comp-preset").value = mx.compPreset ?? "";
    const cThr   = mx.compThreshold ?? -6;
    const cRatio = mx.compRatio     ?? 18;
    document.getElementById("master-comp-threshold").value = cThr;
    document.getElementById("master-comp-ratio").value     = cRatio;
    audioEngineSetCompressorThreshold(compOn ? cThr   : 0);
    audioEngineSetCompressorRatio    (compOn ? cRatio : 1);

    const sLen = mx.synthLen ?? 50;
    cpSetSynthMult(sLen / 100);
    document.getElementById("synth-note-length").value = sLen;
    document.getElementById("synth-len-preset").value  = mx.synthLenPreset ?? "";

    _tanpuraEnabled = mx.tanpuraOn ?? true;
    document.getElementById("tanpura-toggle").classList.toggle("active", _tanpuraEnabled);
    document.getElementById("tanpura-toggle").textContent = _tanpuraEnabled ? "ON" : "OFF";
    const tMode = mx.tanpuraMode ?? "pluck";
    tanpuraSetMode(tMode);
    document.getElementById("tanpura-mode").value = tMode;
    const tVol = mx.tanpuraVol ?? 50;
    tanpuraSetVolume(tVol / 100);
    document.getElementById("tanpura-volume").value = tVol;
    const tRate = mx.tanpuraRate ?? 50;
    tanpuraSetRate(tRate);
    document.getElementById("tanpura-rate").value = tRate;
    const tRateSync = mx.tanpuraRateSync ?? "free";
    tanpuraSetRateSync(tRateSync === "free" ? null : parseInt(tRateSync));
    document.getElementById("tanpura-rate-sync").value = tRateSync;
    const tsLen = mx.tanpuraSynthLen ?? 100;
    tanpuraSetSynthMult(tsLen / 100);
    document.getElementById("tanpura-synth-length").value     = tsLen;
    document.getElementById("tanpura-synth-len-preset").value = mx.tanpuraSynthLenPreset ?? "";
    [1, 2, 3, 4].forEach(n => {
      const val = mx[`tanpuraS${n}`] ?? 50;
      tanpuraSetStringGain(n - 1, val / 100);
      document.getElementById(`tanpura-s${n}-vol`).value = val;
    });

    const sc = mx.sectionCollapsed ?? {};
    document.querySelectorAll('.master-section').forEach(s => {
      const name = s.querySelector('.master-heading').textContent.trim().toLowerCase();
      const defaultCollapsed = name !== 'master';
      s.classList.toggle('collapsed', sc[name] ?? defaultCollapsed);
    });

    const gc = mx.groupCollapsed ?? {};
    document.querySelectorAll('.master-group').forEach(g => {
      const name = g.querySelector('.master-group-label').textContent.trim().toLowerCase();
      g.classList.toggle('collapsed', gc[name] ?? true);
    });
  }

  if (data.theme) setTheme(data.theme, { silent: true });
  document.body.setAttribute("data-notes-font", data.notesMono ? "mono" : "");
  if (data.viewState) {
    Object.assign(viewState, data.viewState);
    applyViewState();
    syncViewSettingsCheckboxes();
  }
  if (data.themeRatings) {
    Object.keys(themeRatings).forEach(k => delete themeRatings[k]);
    Object.assign(themeRatings, data.themeRatings);
  }

  const sr  = data.sampleRate ?? SAMPLE_RATE;
  tempoBPM  = data.bpm ?? 120;
  bpm       = tempoBPM;
  setTimeSignature(data.timeSignature.beats, data.timeSignature.noteValue);

  // ----- Restore chords (must precede tracks so MIDI clip event labels resolve) -----

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
        tab:      c.tab ?? null,
      });
    }
    if (typeof cdSetPanelState === "function") cdSetPanelState(data.chordPanel);
    if (typeof cdRenderDialog === "function") cdRenderDialog();
  }

  // ----- Restore tracks -----
  // Saved order is newest-first. Iterating in reverse (oldest first) and
  // prepending each track preserves the original DOM order after the loop.

  const savedTracks = data.tracks ?? [];
  for (let i = savedTracks.length - 1; i >= 0; i--) {
    const saved = savedTracks[i];
    const track = createTrack(saved.name, { prepend: true, type: saved.type ?? 'audio' });

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
    track.timelineRow.style.setProperty('--row-opacity', track.opacity / 100);

    // Instrument (Pluck / Synth / GM)
    track.instrument = saved.instrument ?? "pluck";
    track.gmProgram  = saved.gmProgram  ?? 0;
    track.sfzName    = saved.sfzName    ?? null;
    const instrBtn = track.controlRow.querySelector(".instrument-toggle");
    if (instrBtn) instrBtn.textContent = { pluck: "Pluck", synth: "Synth", gm: "GM", sfz: "SFZ" }[track.instrument] ?? "Pluck";
    const gmSel = track.controlRow.querySelector(".gm-program-select");
    if (gmSel) {
      gmSel.value = track.gmProgram ?? 0;
      gmSel.style.display = track.instrument === "gm" ? "" : "none";
    }
    const sfzSel = track.controlRow.querySelector(".sfz-instrument-select");
    if (sfzSel) {
      sfzSel._refresh?.();
      sfzSel.style.display = track.instrument === "sfz" ? "" : "none";
    }

    // Output device
    track.outputDeviceId = saved.outputDeviceId ?? null;

    // Scene assignments
    track.scenes = saved.scenes ?? [];
    track.scenes.forEach(letter => {
      const btn = Array.from(track.controlRow.querySelectorAll(".track-scene"))
        .find(b => b.textContent.trim() === letter);
      if (btn) btn.classList.add("active");
    });

    // MIDI clips
    for (const savedClip of (saved.midiClips ?? [])) {
      const clip = {
        id:              savedClip.id,
        startSample:     savedClip.startSample,
        durationSamples: savedClip.durationSamples,
        events:          (savedClip.events ?? []).map(e => ({ offsetSamples: e.offsetSamples, chordId: e.chordId })),
        notes:           savedClip.notes ? savedClip.notes.map(n => ({ pitch: n.pitch, startSamples: n.startSamples, durationSamples: n.durationSamples, velocity: n.velocity ?? 100 })) : undefined,
      };
      track.midiClips.push(clip);
      renderMidiClip(track, clip);
    }

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

  // Wire up saved output device routing (async bus creation, fire-and-forget)
  const tracksWithDevice = tracks.filter(t => t.outputDeviceId);
  if (tracksWithDevice.length) {
    Promise.all(tracksWithDevice.map(t => audioEngineEnsureOutputBus(t.outputDeviceId)))
      .then(() => tracksWithDevice.forEach(t => audioEngineSetTrackOutput(t.id, t.outputDeviceId)))
      .catch(err => log("output device restore failed:", err));
  }

  // ----- Restore markers -----

  for (const saved of (data.markers ?? [])) {
    markers.push({ id: saved.id, time: saved.timeSample / sr, note: saved.note ?? "", chordId: saved.chordId ?? null });
  }
  markers.sort((a, b) => a.time - b.time);
  selectedMarkerId = markers[0]?.id ?? null;

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

async function loadSoundfontFromFolder(dataHandle, originalName) {
  if (typeof sfLoadFromFile !== 'function') return;
  try {
    const sfHandle = await dataHandle.getFileHandle('soundfont.sf2');
    const sfFile   = await sfHandle.getFile();
    await sfLoadFromFile(sfFile, originalName ?? undefined);
  } catch {
    // no project-specific soundfont — revert to default.sf2 if loaded
    if (typeof sfClearProjectFont === 'function') sfClearProjectFont();
  }
  if (typeof _updateSf2Display === 'function') _updateSf2Display();
}

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
      if (workspaceFolderHandle) {
        const name = await _promptProjectName();
        if (!name) return;
        projectFolderHandle = await workspaceFolderHandle.getDirectoryHandle(name, { create: true });
        updateProjectNameDisplay();
      } else {
        const parent = await window.showDirectoryPicker({ mode: "readwrite" });
        projectFolderHandle = await parent.getDirectoryHandle(projectId, { create: true });
        updateProjectNameDisplay();
      }
    }

    const dataHandle = await projectFolderHandle.getDirectoryHandle("data", { create: true });

    // Write project.json (project root only)
    const data = serializeProject();
    log("saveProject folder:", projectFolderHandle.name);
    log("saveProject:", data);
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

    // Write project soundfont into data/ if a custom one is loaded
    if (typeof sfGetProjectFile === 'function') {
      const sfFile = sfGetProjectFile();
      if (sfFile) {
        const sfHandle = await dataHandle.getFileHandle('soundfont.sf2', { create: true });
        const sfWriter = await sfHandle.createWritable();
        await sfWriter.write(sfFile);
        await sfWriter.close();
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
  log("reconnectProjectFolder folder:", folderHandle.name);
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
    await loadSoundfontFromFolder(dataHandle, projectData.soundfontFileName ?? undefined);
  } else {
    if (typeof sfClearProjectFont === 'function') sfClearProjectFont();
    if (typeof _updateSf2Display === 'function') _updateSf2Display();
  }
  clearDirty();
  return true;
}

async function openProject() {
  if (workspaceFolderHandle) { await showProjectPicker(); return; }
  try {
    const folderHandle = await window.showDirectoryPicker({ mode: "read" });

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
    projectFolderHandle  = null;
    log("openProject folder:", folderHandle.name);
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
      await loadSoundfontFromFolder(dataHandle, data.soundfontFileName ?? undefined);
    } else {
      if (typeof sfClearProjectFont === 'function') sfClearProjectFont();
      if (typeof _updateSf2Display === 'function') _updateSf2Display();
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
