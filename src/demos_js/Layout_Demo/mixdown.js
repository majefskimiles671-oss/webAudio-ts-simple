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

function renderTrackGroupToStereo(trackList, raw = false) {
  let totalSamples = 0;
  for (const track of trackList) {
    for (const clip of track.clips) {
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
  }

  return out;
}

async function exportMixdown({ scenes, modes, folderHandle }) {
  const sceneMap = getSceneTrackMap();
  const writtenFiles = [];
  const manifest = {};

  // Assign each unique track a filename once, across all selected scenes
  const trackFilenames = new Map(); // track.id → filename
  if (modes.includes('stems')) {
    const usedNames = new Set();
    for (const letter of scenes) {
      for (const track of sceneMap[letter]) {
        if (!trackFilenames.has(track.id)) {
          trackFilenames.set(track.id, uniqueFilename(sanitizeFilename(track.name), usedNames));
        }
      }
    }
    for (const [trackId, filename] of trackFilenames) {
      const track = tracks.find(t => t.id === trackId);
      const rendered = renderTrackGroupToStereo([track], true);
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
    }
  }

  for (const letter of scenes) {
    const sceneTracks = sceneMap[letter];
    const entry = {};

    if (modes.includes('stereo')) {
      const filename = `Scene-${letter}.wav`;
      const rendered = renderTrackGroupToStereo(sceneTracks);
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
      entry.stereo = filename;
    }

    if (modes.includes('stems')) {
      entry.stems = sceneTracks.map(t => trackFilenames.get(t.id));
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

async function exportAllTracks({ modes, folderHandle }) {
  const writtenFiles = [];
  const entry = {};

  if (modes.includes('stereo')) {
    const filename = 'All Tracks.wav';
    const rendered = renderTrackGroupToStereo(tracks);
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
      const filename = uniqueFilename(sanitizeFilename(track.name), usedNames);
      const rendered = renderTrackGroupToStereo([track]);
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
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

async function exportVideo({ sceneLetter, folderHandle, onProgress, setCancelFn, phosphor = false }) {
  const sceneMap = getSceneTrackMap();
  const audioBuffer = renderTrackGroupToStereo(sceneMap[sceneLetter]);
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
  const videoArgs = phosphor
    ? ['-vf', 'scale=320:-2,edgedetect=low=0.1:high=0.3,split[e][g];[g]gblur=sigma=2[gb];[e][gb]blend=all_mode=screen,colorchannelmixer=rr=1:gg=0.6:bb=0',
       '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'copy'];

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
        <p class="mixdown-title">Export Mixdown</p>
        <p class="mixdown-notice">No tracks are assigned to any scene. You can still export all tracks.</p>
        <p class="mixdown-section-label">Output format</p>
        <div class="mixdown-mode-group">
          <label><input type="checkbox" name="mx-mode" value="stereo" checked> Stereo mix</label>
          <label><input type="checkbox" name="mx-mode" value="stems"> Individual stems</label>
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
    exportBtnFallback.addEventListener('click', async () => {
      const modes = Array.from(overlay.querySelectorAll('input[name="mx-mode"]:checked'))
        .map(cb => cb.value);
      try {
        const { handle: folderHandle, displayPath } = await getExportFolder();
        overlay.remove();
        const files = await exportAllTracks({ modes, folderHandle });
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
      <p class="mixdown-title">Export Mixdown</p>
      <p class="mixdown-section-label">Scenes</p>
      <div class="mixdown-scene-list">${sceneRowsHTML}</div>
      <p class="mixdown-section-label">Output format</p>
      <div class="mixdown-mode-group">
        <label><input type="checkbox" name="mx-mode" value="stereo" checked> Stereo mix</label>
        <label><input type="checkbox" name="mx-mode" value="stems"> Individual stems</label>
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
      <label class="mixdown-video-option">
        <input type="checkbox" class="mx-phosphor"${videoEnabled ? '' : ' disabled'}> Phosphor filter
      </label>
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
  exportBtn.addEventListener('click', async () => {
    const scenes = Array.from(overlay.querySelectorAll('input[name="mx-scene"]:checked'))
      .map(cb => cb.value);
    const modes = Array.from(overlay.querySelectorAll('input[name="mx-mode"]:checked'))
      .map(cb => cb.value);
    try {
      const { handle: folderHandle, displayPath } = await getExportFolder();
      overlay.remove();
      const files = await exportMixdown({ scenes, modes, folderHandle });
      showMixdownDone(files, displayPath);
    } catch (err) {
      if (err.name !== 'AbortError') { console.error('Export failed:', err); alert('Export failed. See console for details.'); }
    }
  });

  const exportVideoBtn = overlay.querySelector('.mixdown-export-video-btn');
  if (videoEnabled) {
    exportVideoBtn.addEventListener('click', async () => {
      const sceneLetter = overlay.querySelector('.mixdown-scene-select').value;
      const phosphor = overlay.querySelector('.mx-phosphor')?.checked ?? false;
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
          phosphor,
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
