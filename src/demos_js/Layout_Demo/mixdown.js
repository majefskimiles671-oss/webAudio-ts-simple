// mixdown.js
// Mixdown / Export - File System Access API -----

// ============================================================
// Helpers (Pure Computation Layer) -----
// ============================================================

const SCENE_LETTERS = ['A', 'B', 'C', 'D', 'E'];

function getSceneTrackMap() {
  const map = Object.fromEntries(SCENE_LETTERS.map(l => [l, []]));
  for (const track of tracks) {
    for (const letter of track.scenes) {
      if (map[letter]) map[letter].push(track);
    }
  }
  return map;
}

function _trackHasContent(track) {
  if (track.clips?.length) return true;
  for (const clip of (track.midiClips ?? [])) {
    if (clip.notes?.length) return true;
  }
  return false;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'track';
}

function uniqueFilename(base, usedNames) {
  let name = `${base}.wav`;
  if (!usedNames.has(name)) { usedNames.add(name); return name; }
  let n = 2;
  while (usedNames.has(`${base}_${n}.wav`)) n++;
  name = `${base}_${n}.wav`;
  usedNames.add(name);
  return name;
}

// ============================================================
// Authority (Meaning Layer) -----
// ============================================================

async function getExportFolder() {
  let mixdownDir;
  if (projectFolderHandle) {
    mixdownDir = await projectFolderHandle.getDirectoryHandle("mixdown", { create: true });
  } else {
    const baseDir = await window.showDirectoryPicker({ mode: "readwrite" });
    mixdownDir = await baseDir.getDirectoryHandle("mixdown", { create: true });
  }
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const handle = await mixdownDir.getDirectoryHandle(timestamp, { create: true });
  return { handle, displayPath: `mixdown/${timestamp}` };
}

async function _renderMidiTrackToBuffer(track, totalSamples) {
  if (!track.midiClips?.length) return null;
  const sr      = SAMPLE_RATE;
  const offCtx  = new OfflineAudioContext(2, totalSamples, sr);
  const isGm    = track.instrument === 'gm';
  const isSfz   = track.instrument === 'sfz';
  const program = track.gmProgram ?? 0;
  const sfzName = track.sfzName   ?? null;
  const midiToFreq = p => 440 * Math.pow(2, (p - 69) / 12);

  for (const clip of track.midiClips) {
    const clipStartSec = clip.startSample / sr;
    const clipEndSec   = (clip.startSample + clip.durationSamples) / sr;
    for (const n of (clip.notes ?? [])) {
      const t = clipStartSec + n.startSamples / sr;
      if (t >= clipEndSec || t >= totalSamples / sr) continue;
      const dur = n.durationSamples / sr;
      const vel = n.velocity ?? 100;
      if (isGm) {
        sfScheduleNoteInContext(offCtx, offCtx.destination, program, n.pitch, vel, t, dur);
      } else if (isSfz) {
        sfzScheduleNoteInContext(offCtx, offCtx.destination, sfzName, n.pitch, vel, t, dur);
      } else {
        cpScheduleNoteAt(midiToFreq(n.pitch), offCtx, t, dur, vel, track.instrument ?? 'pluck', offCtx.destination);
      }
    }
  }
  return offCtx.startRendering();
}

async function _renderChordsToBuffer(totalSamples) {
  const sr = SAMPLE_RATE;
  const offCtx = new OfflineAudioContext(2, totalSamples, sr);
  for (const track of tracks) {
    const mode = track.instrument ?? 'pluck';
    const gainNode = offCtx.createGain();
    gainNode.gain.value = track.gain / 100;
    gainNode.connect(offCtx.destination);
    for (const clip of (track.midiClips ?? [])) {
      const clipStartSec = clip.startSample / sr;
      for (const ev of (clip.events ?? [])) {
        const t = clipStartSec + ev.offsetSamples / sr;
        if (t >= totalSamples / sr) continue;
        const chord = chords.find(c => c.id === ev.chordId);
        if (!chord) continue;
        cpScheduleChordAt(chord, offCtx, t, mode, gainNode);
      }
    }
  }
  return offCtx.startRendering();
}

async function _renderDroneToBuffer(totalSamples) {
  const sr = SAMPLE_RATE;
  const offCtx = new OfflineAudioContext(2, totalSamples, sr);
  const state = droneGetState();
  const totalSec = totalSamples / sr;

  // Build segments: each marker that sets strings starts a new segment
  const segments = [];
  let currentStrings = state.strings;
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const nextTime = (i + 1 < markers.length) ? markers[i + 1].time : totalSec;
    if (m.chordId === '__stop__') {
      // gap — no drone
      continue;
    }
    if (m.chordId) {
      const chord = chords.find(c => c.id === m.chordId);
      if (chord) {
        const ct = getTuningForChord(chord);
        const notes = chord.dots.flatMap((dotRow, s) => {
          if (chord.tops[s] === 'x') return [];
          const hits = [];
          if (chord.tops[s] === 'o') hits.push(ct.midiAt(s + 1, 0));
          dotRow.forEach((dot, r) => { if (dot) hits.push(ct.midiAt(s + 1, chord.baseFret + r)); });
          return hits;
        }).sort((a, b) => a - b);
        const arr = notes.slice(0, DRONE_STRING_COUNT);
        while (arr.length < DRONE_STRING_COUNT) arr.unshift(arr[0] - DRONE_OCTAVE_SEMITONES);
        currentStrings = arr;
      }
    }
    segments.push({ startTime: m.time, endTime: nextTime, strings: currentStrings });
  }

  const intervalSec = state.syncBeats !== null
    ? (60 / state.bpm) * state.syncBeats
    : DRONE_RATE_INTERVAL_MAX - (state.rate / 100) * DRONE_RATE_INTERVAL_RANGE;

  const gainNode = offCtx.createGain();
  gainNode.gain.value = DRONE_MASTER_GAIN;
  gainNode.connect(offCtx.destination);

  for (const seg of segments) {
    let t = seg.startTime;
    let idx = 0;
    while (t < seg.endTime && t < totalSec) {
      const midi = seg.strings[idx % DRONE_STRING_COUNT];
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const strGain = state.stringGains[idx % DRONE_STRING_COUNT] * DRONE_MASTER_GAIN;

      if (state.mode === 'synth') {
        const env = offCtx.createGain();
        const filter = offCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = DRONE_SYNTH_FILTER_FREQ;
        filter.Q.value = DRONE_SYNTH_FILTER_Q;
        const osc1 = offCtx.createOscillator();
        const osc2 = offCtx.createOscillator();
        const osc3 = offCtx.createOscillator();
        osc1.type = 'sawtooth'; osc1.frequency.value = freq; osc1.detune.value = +DRONE_SYNTH_DETUNE_CENTS;
        osc2.type = 'sawtooth'; osc2.frequency.value = freq; osc2.detune.value = -DRONE_SYNTH_DETUNE_CENTS;
        osc3.type = 'sine';     osc3.frequency.value = freq / 2;
        const g1 = offCtx.createGain(); g1.gain.value = DRONE_SYNTH_OSC1_GAIN * strGain;
        const g2 = offCtx.createGain(); g2.gain.value = DRONE_SYNTH_OSC2_GAIN * strGain;
        const g3 = offCtx.createGain(); g3.gain.value = DRONE_SYNTH_OSC3_GAIN * strGain;
        osc1.connect(g1).connect(filter);
        osc2.connect(g2).connect(filter);
        osc3.connect(g3).connect(filter);
        filter.connect(env);
        env.connect(offCtx.destination);
        const dur = DRONE_NOTE_DURATION * state.synthMult, A = DRONE_NOTE_ATTACK * state.synthMult, R = DRONE_NOTE_RELEASE * state.synthMult;
        const peak = DRONE_NOTE_PEAK_GAIN;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(peak, t + A);
        env.gain.setValueAtTime(peak, t + dur);
        env.gain.linearRampToValueAtTime(0, t + dur + R);
        const stopT = t + dur + R + DRONE_NOTE_STOP_BUFFER;
        [osc1, osc2, osc3].forEach(o => { o.start(t); o.stop(stopT); });

      } else if (state.mode === 'sine') {
        const env = offCtx.createGain();
        const osc = offCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(env);
        env.connect(offCtx.destination);
        const dur = DRONE_NOTE_DURATION * state.synthMult, A = DRONE_NOTE_ATTACK * state.synthMult, R = DRONE_NOTE_RELEASE * state.synthMult;
        const peak = DRONE_NOTE_PEAK_GAIN * strGain;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(peak, t + A);
        env.gain.setValueAtTime(peak, t + dur);
        env.gain.linearRampToValueAtTime(0, t + dur + R);
        const stopT = t + dur + R + DRONE_NOTE_STOP_BUFFER;
        osc.start(t);
        osc.stop(stopT);

      } else {
        // pluck (default)
        const samples = _droneKsGenerate(freq, sr, state.synthMult * 10);
        const buf = offCtx.createBuffer(1, samples.length, sr);
        buf.copyToChannel(samples.map(s => s * strGain), 0);
        const src = offCtx.createBufferSource();
        src.buffer = buf;
        src.connect(gainNode);
        src.start(t);
      }

      idx++;
      t += intervalSec;
    }
  }

  return offCtx.startRendering();
}

async function renderTrackGroupToStereo(trackList, raw = false) {
  let totalSamples = 0;
  for (const track of trackList) {
    for (const clip of track.clips) {
      const end = clip.startSample + clip.durationSamples;
      if (end > totalSamples) totalSamples = end;
    }
    for (const clip of (track.midiClips ?? [])) {
      const end = clip.startSample + clip.durationSamples;
      if (end > totalSamples) totalSamples = end;
    }
  }
  if (totalSamples === 0) return null;

  const out  = audioEngineCreateBuffer(2, totalSamples);
  const outL = out.getChannelData(0);
  const outR = out.getChannelData(1);

  for (const track of trackList) {
    const gainFactor = raw ? 1 : track.gain / 100;
    const panAngle   = raw ? Math.PI / 4 : ((track.pan + 100) / 200) * (Math.PI / 2);
    const panL       = raw ? 1 : Math.cos(panAngle) * gainFactor;
    const panR       = raw ? 1 : Math.sin(panAngle) * gainFactor;

    for (const clip of track.clips) {
      const src = audioEngineGetBuffer(clip.id);
      if (!src) continue;

      let chL, chR;
      if (clip.durationSamples > src.length) {
        const loopStart = clip.loopStartSamples ?? 0;
        const loopEnd   = clip.loopEndSamples   ?? src.length;
        const rendered  = audioEngineRenderLoop(src, loopStart, loopEnd, clip.durationSamples);
        chL = rendered.getChannelData(0);
        chR = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : chL;
      } else {
        chL = src.getChannelData(0);
        chR = src.numberOfChannels > 1 ? src.getChannelData(1) : chL;
      }

      const start = clip.startSample;
      const len   = Math.min(clip.durationSamples, totalSamples - start);
      for (let i = 0; i < len; i++) {
        outL[start + i] += chL[i] * panL;
        outR[start + i] += chR[i] * panR;
      }
    }

    if (track.midiClips?.length) {
      const midiBuffer = await _renderMidiTrackToBuffer(track, totalSamples);
      if (midiBuffer) {
        const mL = midiBuffer.getChannelData(0);
        const mR = midiBuffer.numberOfChannels > 1 ? midiBuffer.getChannelData(1) : mL;
        for (let i = 0; i < totalSamples; i++) {
          outL[i] += mL[i] * panL;
          outR[i] += mR[i] * panR;
        }
      }
    }
  }

  return out;
}

function _mixBufferInto(out, src) {
  const outL = out.getChannelData(0), outR = out.getChannelData(1);
  const srcL = src.getChannelData(0), srcR = src.numberOfChannels > 1 ? src.getChannelData(1) : srcL;
  const len = Math.min(out.length, src.length);
  for (let i = 0; i < len; i++) { outL[i] += srcL[i]; outR[i] += srcR[i]; }
}

async function _renderExtras(extras, totalSamples) {
  const results = {};
  if (extras.includes('chords')) results.chords = await _renderChordsToBuffer(totalSamples);
  if (extras.includes('drone'))  results.drone  = await _renderDroneToBuffer(totalSamples);
  return results;
}

async function exportMixdown({ scenes, modes, folderHandle, extras = [] }) {
  const sceneMap = getSceneTrackMap();
  const writtenFiles = [];
  const manifest = {};

  // Calculate total samples across all selected scenes for extras rendering
  let extraTotalSamples = 0;
  for (const letter of scenes) {
    for (const track of sceneMap[letter]) {
      for (const clip of [...track.clips, ...(track.midiClips ?? [])]) {
        const end = clip.startSample + clip.durationSamples;
        if (end > extraTotalSamples) extraTotalSamples = end;
      }
    }
  }

  // Render extras once (shared across scenes)
  const extraBuffers = extras.length && extraTotalSamples > 0
    ? await _renderExtras(extras, extraTotalSamples)
    : {};

  // Assign each unique track a filename once, across all selected scenes
  const trackFilenames = new Map();
  if (modes.includes('stems')) {
    const usedNames = new Set();
    for (const letter of scenes) {
      for (const track of sceneMap[letter]) {
        if (!trackFilenames.has(track.id) && _trackHasContent(track)) {
          trackFilenames.set(track.id, uniqueFilename(sanitizeFilename(track.name), usedNames));
        }
      }
    }
    for (const [trackId, filename] of trackFilenames) {
      const track = tracks.find(t => t.id === trackId);
      const rendered = await renderTrackGroupToStereo([track], true);
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
    }
    // Extra stems
    for (const [key, buf] of Object.entries(extraBuffers)) {
      const filename = key === 'chords' ? 'Chords.wav' : 'Drone.wav';
      const wav = audioEngineEncodeWav(buf);
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      if (!writtenFiles.includes(filename)) writtenFiles.push(filename);
    }
  }

  for (const letter of scenes) {
    const sceneTracks = sceneMap[letter];
    const entry = {};

    if (modes.includes('stereo')) {
      const filename = `Scene-${letter}.wav`;
      const rendered = await renderTrackGroupToStereo(sceneTracks);
      if (rendered) {
        for (const buf of Object.values(extraBuffers)) _mixBufferInto(rendered, buf);
      }
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
      entry.stereo = filename;
    }

    if (modes.includes('stems')) {
      entry.stems = [
        ...sceneTracks.map(t => trackFilenames.get(t.id)),
        ...Object.keys(extraBuffers).map(k => k === 'chords' ? 'Chords.wav' : 'Drone.wav'),
      ];
    }

    manifest[`Scene ${letter}`] = entry;
  }

  const manifestFh = await folderHandle.getFileHandle("scenes.json", { create: true });
  const manifestW = await manifestFh.createWritable();
  await manifestW.write(JSON.stringify(manifest, null, 2));
  await manifestW.close();
  writtenFiles.push("scenes.json");

  return writtenFiles;
}

async function exportAllTracks({ modes, folderHandle, extras = [] }) {
  const writtenFiles = [];
  const entry = {};

  let extraTotalSamples = 0;
  for (const track of tracks) {
    for (const clip of [...track.clips, ...(track.midiClips ?? [])]) {
      const end = clip.startSample + clip.durationSamples;
      if (end > extraTotalSamples) extraTotalSamples = end;
    }
  }

  const extraBuffers = extras.length && extraTotalSamples > 0
    ? await _renderExtras(extras, extraTotalSamples)
    : {};

  if (modes.includes('stereo')) {
    const filename = 'All Tracks.wav';
    const rendered = await renderTrackGroupToStereo(tracks);
    if (rendered) {
      for (const buf of Object.values(extraBuffers)) _mixBufferInto(rendered, buf);
    }
    const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
    const fh = await folderHandle.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(wav);
    await w.close();
    writtenFiles.push(filename);
    entry.stereo = filename;
  }

  if (modes.includes('stems')) {
    const usedNames = new Set();
    const stemFiles = [];
    for (const track of tracks) {
      if (!_trackHasContent(track)) continue;
      const filename = uniqueFilename(sanitizeFilename(track.name), usedNames);
      const rendered = await renderTrackGroupToStereo([track]);
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
      stemFiles.push(filename);
    }
    for (const [key, buf] of Object.entries(extraBuffers)) {
      const filename = key === 'chords' ? 'Chords.wav' : 'Drone.wav';
      const wav = audioEngineEncodeWav(buf);
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
      stemFiles.push(filename);
    }
    entry.stems = stemFiles;
  }

  const manifest = { "All Tracks": entry };
  const manifestFh = await folderHandle.getFileHandle("scenes.json", { create: true });
  const manifestW = await manifestFh.createWritable();
  await manifestW.write(JSON.stringify(manifest, null, 2));
  await manifestW.close();
  writtenFiles.push("scenes.json");

  return writtenFiles;
}

// Authority - Video Export - Meaning Layer -----

async function _toBlobURL(url, mimeType) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mimeType }));
}

async function _loadFFmpegScript() {
  if (window.FFmpegWASM) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './vendor/ffmpeg.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load FFmpeg script'));
    document.head.appendChild(s);
  });
}

async function exportVideo({ sceneLetter, folderHandle, onProgress, setCancelFn }) {
  const sceneMap = getSceneTrackMap();
  const audioBuffer = await renderTrackGroupToStereo(sceneMap[sceneLetter]);
  const wavBytes = audioBuffer ? audioEngineEncodeWav(audioBuffer) : buildPlaceholderWav();

  onProgress('Loading FFmpeg…');
  await _loadFFmpegScript();
  const { FFmpeg } = window.FFmpegWASM;
  const ffmpeg = new FFmpeg();
  setCancelFn?.(() => ffmpeg.terminate());
  const videoDurationSec = document.querySelector('#timeline-video')?.duration || 0;
  const audioDurationSec = audioBuffer?.duration || 0;
  const effectiveDuration = audioDurationSec > 0
    ? Math.min(videoDurationSec, audioDurationSec)
    : videoDurationSec;
  ffmpeg.on('progress', ({ time }) => {
    const pct = effectiveDuration > 0
      ? Math.min(99, Math.round((time / 1_000_000) / effectiveDuration * 100))
      : '…';
    onProgress(`Exporting… ${pct}%`);
  });
  const coreBase = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({
    coreURL: await _toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await _toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  onProgress('Exporting… 0%');
  const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
  await ffmpeg.writeFile(`input.${ext}`, new Uint8Array(await videoFile.arrayBuffer()));
  await ffmpeg.writeFile('audio.wav', new Uint8Array(wavBytes));
  const videoArgs = ['-c:v', 'copy'];

  await ffmpeg.exec([
    '-i', `input.${ext}`,
    '-i', 'audio.wav',
    ...videoArgs,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-shortest',
    'output.mp4',
  ]);

  const outputFilename = `Scene-${sceneLetter}-video.mp4`;
  const data = await ffmpeg.readFile('output.mp4');
  const fh = await folderHandle.getFileHandle(outputFilename, { create: true });
  const w = await fh.createWritable();
  await w.write(new Uint8Array(data));
  await w.close();
  return [outputFilename];
}

// ============================================================
// Projection / Rendering (View Layer) -----
// ============================================================

function showVideoExportToast(msg, onCancel) {
  document.querySelector('.video-export-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'video-export-toast';
  toast.innerHTML = `<span class="video-export-toast-spinner"></span><span class="video-export-toast-msg">${msg}</span><button class="video-export-toast-cancel">Cancel</button>`;
  toast.querySelector('.video-export-toast-cancel').addEventListener('click', onCancel);
  document.body.appendChild(toast);
}

function updateVideoExportToast(msg) {
  const el = document.querySelector('.video-export-toast-msg');
  if (el) el.textContent = msg;
}

function hideVideoExportToast() {
  document.querySelector('.video-export-toast')?.remove();
}

function showMixdownDone(files, folderName) {
  document.querySelector('.mixdown-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'mixdown-overlay';
  // The File System Access API does not expose full filesystem paths — only the folder name.
  const fileList = files.map(f => `<li>${folderName}/${f}</li>`).join('');
  overlay.innerHTML = `
    <div class="mixdown-card">
      <p class="mixdown-title">Export complete</p>
      <p class="mixdown-notice">${files.length} file${files.length !== 1 ? 's' : ''} created:</p>
      <ul class="mixdown-file-list">${fileList}</ul>
      <div class="mixdown-actions">
        <button class="mixdown-primary">Got it</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('.mixdown-primary').addEventListener('click', () => overlay.remove());
}

function showMixdownDialog() {
  document.querySelector('.mixdown-overlay')?.remove();

  const sceneMap = getSceneTrackMap();
  const hasAnySceneAssignment = Object.values(sceneMap).some(arr => arr.length > 0);
  const overlay = document.createElement('div');
  overlay.className = 'mixdown-overlay';

  // ---- No-scenes fallback ----
  if (!hasAnySceneAssignment) {
    overlay.innerHTML = `
      <div class="mixdown-card">
        <button class="mixdown-close" aria-label="Close">✕</button>
        <p class="mixdown-title">Export Mixdown</p>
        <p class="mixdown-notice">No tracks are assigned to any scene. You can still export all tracks.</p>
        <p class="mixdown-section-label">Output format</p>
        <div class="mixdown-mode-group">
          <label><input type="checkbox" name="mx-mode" value="stereo" checked> Stereo mix</label>
          <label><input type="checkbox" name="mx-mode" value="stems"> Individual stems</label>
        </div>
        <p class="mixdown-section-label">Extra tracks</p>
        <div class="mixdown-mode-group">
          <label><input type="checkbox" name="mx-extra" value="chords"> MIDI chords</label>
          <label><input type="checkbox" name="mx-extra" value="drone"> Drone drone</label>
        </div>
        <div class="mixdown-actions">
          <button class="mixdown-cancel">Cancel</button>
          <button class="mixdown-primary">${projectFolderHandle ? "Export" : "Choose Folder…"}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const exportBtnFallback = overlay.querySelector('.mixdown-primary');
    function updateFallbackBtn() {
      exportBtnFallback.disabled = overlay.querySelectorAll('input[name="mx-mode"]:checked').length === 0;
    }
    overlay.querySelectorAll('input[name="mx-mode"]').forEach(cb => cb.addEventListener('change', updateFallbackBtn));

    overlay.querySelector('.mixdown-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.mixdown-close').addEventListener('click', () => overlay.remove());
    exportBtnFallback.addEventListener('click', async () => {
      const modes = Array.from(overlay.querySelectorAll('input[name="mx-mode"]:checked'))
        .map(cb => cb.value);
      const extras = Array.from(overlay.querySelectorAll('input[name="mx-extra"]:checked'))
        .map(cb => cb.value);
      try {
        const { handle: folderHandle, displayPath } = await getExportFolder();
        overlay.remove();
        const files = await exportAllTracks({ modes, folderHandle, extras });
        showMixdownDone(files, displayPath);
      } catch (err) {
        if (err.name !== 'AbortError') { console.error('Export failed:', err); alert('Export failed. See console for details.'); }
      }
    });
    return;
  }

  // ---- Normal scene dialog ----
  const sceneRowsHTML = SCENE_LETTERS.map(letter => {
    const sceneTracks = sceneMap[letter];
    const isEmpty = sceneTracks.length === 0;
    const trackNames = sceneTracks.map(t => t.name).join(', ');
    return `
      <label class="mixdown-scene-row${isEmpty ? ' empty' : ''}">
        <input type="checkbox" name="mx-scene" value="${letter}"${isEmpty ? ' disabled' : ' checked'}>
        <span class="mixdown-scene-info">
          <span class="mixdown-scene-letter">${letter}</span>
          <span class="mixdown-scene-tracks">${isEmpty ? 'No tracks assigned' : trackNames}</span>
        </span>
      </label>`;
  }).join('');

  const scenesWithTracks = SCENE_LETTERS.filter(l => sceneMap[l].length > 0);
  const hasVideo = typeof videoEl !== 'undefined' && videoEl !== null;
  const videoEnabled = hasVideo && scenesWithTracks.length > 0;
  const videoSceneOptions = scenesWithTracks.map(l =>
    `<option value="${l}">Scene ${l}</option>`
  ).join('');

  overlay.innerHTML = `
    <div class="mixdown-card">
      <button class="mixdown-close" aria-label="Close">✕</button>
      <p class="mixdown-title">Export Mixdown</p>
      <p class="mixdown-section-label">Scenes</p>
      <div class="mixdown-scene-list">${sceneRowsHTML}</div>
      <p class="mixdown-section-label">Output format</p>
      <div class="mixdown-mode-group">
        <label><input type="checkbox" name="mx-mode" value="stereo" checked> Stereo mix</label>
        <label><input type="checkbox" name="mx-mode" value="stems"> Individual stems</label>
      </div>
      <p class="mixdown-section-label">Extra tracks</p>
      <div class="mixdown-mode-group">
        <label><input type="checkbox" name="mx-extra" value="chords"> MIDI chords</label>
        <label><input type="checkbox" name="mx-extra" value="drone"> Drone drone</label>
      </div>
      <div class="mixdown-actions">
        <button class="mixdown-cancel">Cancel</button>
        <button class="mixdown-primary">${projectFolderHandle ? "Export" : "Choose Folder…"}</button>
      </div>
      <hr class="mixdown-divider">
      <p class="mixdown-section-label">Video export</p>
      <div class="mixdown-video-row">
        <select class="mixdown-scene-select"${videoEnabled ? '' : ' disabled'}>
          ${videoEnabled ? videoSceneOptions : '<option>—</option>'}
        </select>
        <button class="mixdown-export-video-btn"${videoEnabled ? '' : ' disabled'}>Export Video</button>
      </div>
      ${!hasVideo ? '<p class="mixdown-video-notice">Load a video first (File → Load Video…)</p>' : ''}
    </div>`;

  document.body.appendChild(overlay);

  const exportBtn = overlay.querySelector('.mixdown-primary');

  function updateExportBtn() {
    const anyScene = overlay.querySelectorAll('input[name="mx-scene"]:checked').length > 0;
    const anyMode  = overlay.querySelectorAll('input[name="mx-mode"]:checked').length > 0;
    exportBtn.disabled = !anyScene || !anyMode;
  }
  overlay.querySelectorAll('input[name="mx-scene"]').forEach(cb => cb.addEventListener('change', updateExportBtn));
  overlay.querySelectorAll('input[name="mx-mode"]').forEach(cb => cb.addEventListener('change', updateExportBtn));
  updateExportBtn();

  overlay.querySelector('.mixdown-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.mixdown-close').addEventListener('click', () => overlay.remove());
  exportBtn.addEventListener('click', async () => {
    const scenes = Array.from(overlay.querySelectorAll('input[name="mx-scene"]:checked'))
      .map(cb => cb.value);
    const modes = Array.from(overlay.querySelectorAll('input[name="mx-mode"]:checked'))
      .map(cb => cb.value);
    const extras = Array.from(overlay.querySelectorAll('input[name="mx-extra"]:checked'))
      .map(cb => cb.value);
    try {
      const { handle: folderHandle, displayPath } = await getExportFolder();
      overlay.remove();
      const files = await exportMixdown({ scenes, modes, folderHandle, extras });
      showMixdownDone(files, displayPath);
    } catch (err) {
      if (err.name !== 'AbortError') { console.error('Export failed:', err); alert('Export failed. See console for details.'); }
    }
  });

  const exportVideoBtn = overlay.querySelector('.mixdown-export-video-btn');
  if (videoEnabled) {
    exportVideoBtn.addEventListener('click', async () => {
      const sceneLetter = overlay.querySelector('.mixdown-scene-select').value;
      exportVideoBtn.disabled = true;
      let wasCancelled = false;
      try {
        const { handle: folderHandle, displayPath } = await getExportFolder();
        overlay.remove();
        let cancelExport = null;
        showVideoExportToast('Loading FFmpeg…', () => {
          wasCancelled = true;
          cancelExport?.();
        });
        const files = await exportVideo({
          sceneLetter,
          folderHandle,
          onProgress: (msg) => updateVideoExportToast(msg),
          setCancelFn: (fn) => { cancelExport = fn; },
        });
        hideVideoExportToast();
        showMixdownDone(files, displayPath);
      } catch (err) {
        hideVideoExportToast();
        if (!wasCancelled && err.name !== 'AbortError') { console.error('Video export failed:', err); alert('Video export failed. See console for details.'); }
      }
    });
  }
}

// ============================================================
// Initialization -----
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('menu-export-mixdown').addEventListener('click', () => {
    showMixdownDialog();
  });
});
