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

function renderTrackGroupToStereo(trackList) {
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
    const gainFactor = track.gain / 100;
    const panAngle   = ((track.pan + 100) / 200) * (Math.PI / 2);
    const panL       = Math.cos(panAngle) * gainFactor;
    const panR       = Math.sin(panAngle) * gainFactor;

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

  for (const letter of scenes) {
    const sceneTracks = sceneMap[letter];

    if (modes.includes('stereo')) {
      const filename = `Scene-${letter}.wav`;
      const rendered = renderTrackGroupToStereo(sceneTracks);
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
    }

    if (modes.includes('stems')) {
      // Individual stems — one WAV per track in a scene subfolder
      const subDir = await folderHandle.getDirectoryHandle(`Scene-${letter}`, { create: true });
      const usedNames = new Set();
      for (const track of sceneTracks) {
        const filename = uniqueFilename(sanitizeFilename(track.name), usedNames);
        const rendered = renderTrackGroupToStereo([track]);
        const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
        const fh = await subDir.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(wav);
        await w.close();
        writtenFiles.push(`Scene-${letter}/${filename}`);
      }
    }
  }

  return writtenFiles;
}

async function exportAllTracks({ modes, folderHandle }) {
  const writtenFiles = [];

  if (modes.includes('stereo')) {
    const filename = 'All Tracks.wav';
    const rendered = renderTrackGroupToStereo(tracks);
    const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
    const fh = await folderHandle.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(wav);
    await w.close();
    writtenFiles.push(filename);
  }

  if (modes.includes('stems')) {
    // Stems written flat into the chosen folder (no subfolder — no scene context)
    const usedNames = new Set();
    for (const track of tracks) {
      const filename = uniqueFilename(sanitizeFilename(track.name), usedNames);
      const rendered = renderTrackGroupToStereo([track]);
      const wav = rendered ? audioEngineEncodeWav(rendered) : buildPlaceholderWav();
      const fh = await folderHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(wav);
      await w.close();
      writtenFiles.push(filename);
    }
  }

  return writtenFiles;
}

// ============================================================
// Projection / Rendering (View Layer) -----
// ============================================================

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
          <button class="mixdown-primary">Export All Tracks…</button>
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
        const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        overlay.remove();
        const files = await exportAllTracks({ modes, folderHandle });
        showMixdownDone(files, folderHandle.name);
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
        <button class="mixdown-primary">Choose Folder…</button>
      </div>
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
      const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      overlay.remove();
      const files = await exportMixdown({ scenes, modes, folderHandle });
      showMixdownDone(files, folderHandle.name);
    } catch (err) {
      if (err.name !== 'AbortError') { console.error('Export failed:', err); alert('Export failed. See console for details.'); }
    }
  });
}

// ============================================================
// Initialization -----
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('menu-export-mixdown').addEventListener('click', () => {
    showMixdownDialog();
  });
});
