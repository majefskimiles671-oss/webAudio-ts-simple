// pianoRoll.js
// Piano roll editor panel — canvas rendering + note CRUD via pointer events.

// Piano Roll - State - Truth Layer -----
let _prClip      = null;
let _prTrack     = null;
let _prScrollY   = 0;
let _prScrollX   = 0;
let _prZoom      = 1;   // horizontal zoom multiplier

function _prZoomToSlider(z) { return Math.round(Math.log(z / 0.1) / Math.log(200) * 100); }
function _prSliderToZoom(v) { return 0.1 * Math.pow(200, v / 100); }
function _prSyncZoomSlider() {
  const el = document.getElementById("piano-roll-zoom-slider");
  if (el) el.value = _prZoomToSlider(_prZoom);
}
let _prSelected  = new Set(); // indices of selected notes
let _prActiveKeyPitch = null; // pitch currently pressed on keyboard sidebar
let _prLiveKeyPitches = new Set(); // pitches held via laptop keyboard MIDI input
let _prAnimFrame = null;

// Piano Roll - State - Velocity Lane -----
let _prVelDragIndex = -1;
let _prVelDragging  = false;

function _prPlayheadX() {
  if (!_prClip || typeof getPlayheadTime !== "function") return null;
  return _prSamplesToX(getPlayheadTime() * _prGetSR() - _prClip.startSample);
}

const PR_ROW_H    = 20;   // pixels per semitone
const PR_KEY_W    = 44;   // piano keyboard width
const PR_MIN_PITCH = 21;  // A0
const PR_MAX_PITCH = 108; // C8
const PR_PITCH_RANGE = PR_MAX_PITCH - PR_MIN_PITCH + 1;
const PR_RESIZE_ZONE = 8; // px from right edge that triggers resize
const PR_PERC_LABEL_W = 120; // extra width for percussion instrument name labels


function _prIsPercussion() {
  return typeof SF_PERCUSSION !== "undefined" && _prTrack?.gmProgram === SF_PERCUSSION;
}

// Piano Roll - Helpers -----
function _prMidiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function _prPreviewNote(pitch, durationSec, velocity = 100) {
  const ctx = getAudioContext();
  ctx.resume();
  audioEngineEnsureLiveOutput();
  if (_prTrack) {
    audioEngineEnsureTrackMixer(
      _prTrack.id,
      (_prTrack.gain ?? 100) / 100,
      (_prTrack.pan  ?? 0)   / 100,
      _prTrack.outputDeviceId ?? null
    );
  }
  const dest = _prTrack ? audioEngineGetTrackMixerInput(_prTrack.id) : null;
  startMeterAnimation();
  if (_prTrack?.instrument === 'gm') {
    sfScheduleNote(dest, _prTrack.gmProgram ?? 0, pitch, velocity, ctx.currentTime, durationSec);
  } else if (_prTrack?.instrument === 'sfz') {
    sfzScheduleNote(dest, _prTrack.sfzName, pitch, velocity, ctx.currentTime, durationSec);
  } else {
    cpScheduleNoteAt(_prMidiToFreq(pitch), ctx, ctx.currentTime, durationSec, velocity, _prTrack?.instrument ?? 'pluck', dest);
  }
}

const _PR_NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function _prNoteName(pitch) {
  return _PR_NOTE_NAMES[pitch % 12] + Math.floor(pitch / 12 - 1);
}
function _prIsBlack(pitch) {
  return [1,3,6,8,10].includes(pitch % 12);
}

function _prGetBPM() {
  return (typeof tempoBPM !== "undefined") ? tempoBPM : 120;
}
function _prGetSR() {
  return (typeof SAMPLE_RATE !== "undefined") ? SAMPLE_RATE : 48000;
}

// Default note duration: 1 beat
function _prDefaultNoteDur() {
  const sr = _prGetSR();
  const bpm = _prGetBPM();
  return Math.round((60 / bpm) * sr);
}

// Snap a sample offset to the nearest 16th note (grid).
function _prSnapSamples(s) {
  const sr = _prGetSR(), bpm = _prGetBPM();
  const sixteenth = (60 / bpm / 4) * sr;
  return Math.round(s / sixteenth) * sixteenth;
}

// Piano Roll - Coordinate Helpers -----
function _prCanvas() { return document.getElementById("piano-roll-canvas"); }
function _prKeysCanvas() { return document.getElementById("piano-roll-keys"); }
function _prRulerCanvas() { return document.getElementById("piano-roll-ruler"); }
function _prVelCanvas() { return document.getElementById("piano-roll-velocity"); }

function _prPixelsPerSample() {
  const canvas = _prCanvas();
  if (!canvas || !_prClip) return 1;
  return (canvas.width * _prZoom) / _prClip.durationSamples;
}

// sample offset → canvas x (accounting for scrollX)
function _prSamplesToX(s) { return s * _prPixelsPerSample() - _prScrollX; }
function _prXToSamples(x) { return (x + _prScrollX) / _prPixelsPerSample(); }

// pitch → canvas y (0 = top = highest pitch PR_MAX_PITCH)
function _prPitchToY(pitch) { return (PR_MAX_PITCH - pitch) * PR_ROW_H - _prScrollY; }
function _prYToPitch(y) { return PR_MAX_PITCH - Math.floor((y + _prScrollY) / PR_ROW_H); }

// Piano Roll - Authority - Live Key Highlight -----
function prSetLiveKeyPitch(pitch, active) {
  if (active) _prLiveKeyPitches.add(pitch);
  else _prLiveKeyPitches.delete(pitch);
  if (_prClip) _prDrawKeys(_prKeysCanvas());
}

// Piano Roll - Rendering -----
function _prDrawKeys(canvas) {
  const ctx = canvas.getContext("2d");
  const isPerc = _prIsPercussion();
  const labelW = isPerc ? PR_PERC_LABEL_W : 0;
  const keyX = labelW;
  const w = PR_KEY_W;
  canvas.height = canvas.clientHeight || 400;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let pitch = PR_MAX_PITCH; pitch >= PR_MIN_PITCH; pitch--) {
    const y = _prPitchToY(pitch);
    if (y + PR_ROW_H < 0 || y > canvas.height) continue;
    const black = _prIsBlack(pitch);
    const isActive = pitch === _prActiveKeyPitch || _prLiveKeyPitches.has(pitch);

    if (isPerc) {
      const percName = typeof sfGetPercussionName === "function" ? sfGetPercussionName(pitch) : null;
      ctx.fillStyle = isActive ? "#3a6fa0" : (percName ? "#2a2a2a" : "#1a1a1a");
      ctx.fillRect(0, y, labelW, PR_ROW_H - 1);
      if (percName) {
        ctx.fillStyle = isActive ? "#fff" : "#bbb";
        ctx.font = "12px sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(percName, 4, y + (PR_ROW_H - 1) / 2);
      }
    }

    ctx.fillStyle = isActive ? "#5a9fd4" : (black ? "#1a1a1a" : "#e0e0e0");
    ctx.fillRect(keyX, y, w, PR_ROW_H - 1);

    if (!isPerc && pitch % 12 === 0) {
      ctx.fillStyle = "#555";
      ctx.font = "12px sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(_prNoteName(pitch), keyX + 3, y + PR_ROW_H - 3);
    }
    if (!black) {
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(keyX, y, w - 1, PR_ROW_H - 1);
    }
  }
}

function _prDraw() {
  const canvas = _prCanvas();
  if (!canvas || !_prClip) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const bpm = _prGetBPM(), sr = _prGetSR();
  const samplesPerBeat = (60 / bpm) * sr;
  const samplesPerBar  = samplesPerBeat * 4;

  // Background rows
  for (let pitch = PR_MAX_PITCH; pitch >= PR_MIN_PITCH; pitch--) {
    const y = _prPitchToY(pitch);
    if (y + PR_ROW_H < 0 || y > H) continue;
    ctx.fillStyle = _prIsBlack(pitch) ? "#1e1e1e" : "#252525";
    ctx.fillRect(0, y, W, PR_ROW_H);
  }

  // Horizontal pitch separator lines
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 0.5;
  for (let pitch = PR_MIN_PITCH; pitch <= PR_MAX_PITCH + 1; pitch++) {
    const y = _prPitchToY(pitch);
    if (y < 0 || y > H) continue;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Vertical beat/bar grid lines
  const pps = _prPixelsPerSample();
  let beat = 0;
  while (true) {
    const x = _prSamplesToX(beat * samplesPerBeat);
    if (x > W) break;
    if (x < -10) { beat++; continue; }
    const isBar = beat % 4 === 0;
    ctx.strokeStyle = isBar ? "#888" : "#4a4a4a";
    ctx.lineWidth = isBar ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    beat++;
  }

  // Clip end line
  const clipEndX = _prSamplesToX(_prClip.durationSamples);
  if (clipEndX >= 0 && clipEndX <= W) {
    ctx.strokeStyle = "#ff6600";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(clipEndX, 0); ctx.lineTo(clipEndX, H); ctx.stroke();
  }

  // Notes
  if (!_prClip.notes) return;
  for (let i = 0; i < _prClip.notes.length; i++) {
    const n = _prClip.notes[i];
    const x  = _prSamplesToX(n.startSamples);
    const y  = _prPitchToY(n.pitch);
    const nw = Math.max(4, n.durationSamples * pps);
    const selected = _prSelected.has(i);
    ctx.fillStyle = selected ? "#f0a040" : "#4ab0d0";
    ctx.fillRect(x, y + 1, nw - 1, PR_ROW_H - 2);
    ctx.fillStyle = selected ? "#ffc060" : "#6cd0f0";
    ctx.fillRect(x, y + 1, 2, PR_ROW_H - 2);
  }

  // Area selection box
  if (_prSelBox) {
    const bw = _prSelBox.x1 - _prSelBox.x0, bh = _prSelBox.y1 - _prSelBox.y0;
    ctx.fillStyle = "rgba(100,180,255,0.12)";
    ctx.fillRect(_prSelBox.x0, _prSelBox.y0, bw, bh);
    ctx.strokeStyle = "rgba(100,180,255,0.8)";
    ctx.lineWidth = 1;
    ctx.strokeRect(_prSelBox.x0, _prSelBox.y0, bw, bh);
  }

  const phX = _prPlayheadX();
  if (phX !== null && phX >= 0 && phX <= W) {
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, H); ctx.stroke();
  }
}

function _prDrawRuler() {
  const canvas = _prRulerCanvas();
  if (!canvas || !_prClip) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, W, H);

  const bpm = _prGetBPM(), sr = _prGetSR();
  const samplesPerBeat = (60 / bpm) * sr;

  ctx.font = "12px sans-serif";
  let beat = 0;
  while (true) {
    const x = _prSamplesToX(beat * samplesPerBeat);
    if (x > W) break;
    if (x >= -1) {
      const isBar = beat % 4 === 0;
      ctx.strokeStyle = isBar ? "#999" : "#555";
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(x, isBar ? 0 : H * 0.6); ctx.lineTo(x, H); ctx.stroke();
      if (isBar) {
        ctx.fillStyle = "#ccc";
        ctx.fillText(beat / 4 + 1, x + 3, H - 4);
      }
    }
    beat++;
  }

  // Clip end line in ruler
  const clipEndX = _prSamplesToX(_prClip.durationSamples);
  if (clipEndX >= 0 && clipEndX <= W) {
    ctx.strokeStyle = "#ff6600";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(clipEndX, 0); ctx.lineTo(clipEndX, H); ctx.stroke();
  }

  const phX = _prPlayheadX();
  if (phX !== null && phX >= 0 && phX <= W) {
    ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.moveTo(phX - 5, 0);
    ctx.lineTo(phX + 5, 0);
    ctx.lineTo(phX, H);
    ctx.closePath();
    ctx.fill();
  }
}

function _prRulerOnPointerDown(e) {
  const canvas = _prRulerCanvas();
  const x = e.clientX - canvas.getBoundingClientRect().left;
  const projectSeconds = (_prClip.startSample + _prXToSamples(x)) / _prGetSR();
  if (typeof jumpPlayheadToTime === "function") jumpPlayheadToTime(Math.max(0, projectSeconds));
}

function _prFullDraw() {
  _prDrawKeys(_prKeysCanvas());
  _prDrawRuler();
  _prDraw();
  _prDrawVelocity();
}

// Piano Roll - Hit Testing -----
function _prHitTest(x, y) {
  if (!_prClip?.notes) return null;
  for (let i = _prClip.notes.length - 1; i >= 0; i--) {
    const n  = _prClip.notes[i];
    const nx = _prSamplesToX(n.startSamples);
    const ny = _prPitchToY(n.pitch);
    const nw = Math.max(4, n.durationSamples * _prPixelsPerSample());
    if (x >= nx && x <= nx + nw && y >= ny && y <= ny + PR_ROW_H) {
      const isResize = x >= nx + nw - PR_RESIZE_ZONE;
      return { index: i, isResize };
    }
  }
  return null;
}

// Piano Roll - Helpers - Velocity Lane -----
function _prVelHitTest(x) {
  if (!_prClip?.notes) return -1;
  const pps = _prPixelsPerSample();
  for (let i = _prClip.notes.length - 1; i >= 0; i--) {
    const n = _prClip.notes[i];
    const nx = _prSamplesToX(n.startSamples);
    const nw = Math.max(4, n.durationSamples * pps);
    if (x >= nx && x < nx + nw) return i;
  }
  return -1;
}

function _prVelYToVelocity(y, h) {
  return Math.max(1, Math.min(127, Math.round(((h - y) / h) * 127)));
}

// Piano Roll - Rendering - Velocity Lane -----
function _prDrawVelocity() {
  const canvas = _prVelCanvas();
  if (!canvas || !_prClip) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 1;
  for (const frac of [0.25, 0.5, 0.75]) {
    const y = H - Math.round(frac * H);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  if (!_prClip.notes) return;
  const pps = _prPixelsPerSample();
  for (let i = 0; i < _prClip.notes.length; i++) {
    const n  = _prClip.notes[i];
    const x  = _prSamplesToX(n.startSamples);
    const nw = Math.max(4, n.durationSamples * pps);
    if (x + nw < 0 || x > W) continue;
    const vel  = n.velocity ?? 100;
    const barH = Math.round((vel / 127) * (H - 2));
    const barY = H - barH;
    const sel  = _prSelected.has(i);
    ctx.fillStyle = sel ? "#d08030" : "#2e6e82";
    ctx.fillRect(x, barY, nw - 1, barH);
    ctx.fillStyle = sel ? "#f0a040" : "#4ab0d0";
    ctx.fillRect(x, barY, nw - 1, 2);
  }
}

// Piano Roll - Authority - Note Mutations -----
function _prAddNote(pitch, startSamples, durationSamples) {
  pitch = Math.max(PR_MIN_PITCH, Math.min(PR_MAX_PITCH, pitch));
  startSamples = Math.max(0, Math.min(_prClip.durationSamples - 1, Math.round(startSamples)));
  durationSamples = Math.max(Math.round(_prGetSR() / 32), Math.round(durationSamples));
  _prClip.notes.push({ pitch, startSamples, durationSamples, velocity: 100 });
  _prClip.notes.sort((a, b) => a.startSamples - b.startSamples);
  _prPreviewNote(pitch, durationSamples / _prGetSR());
}

function _prDeleteSelected() {
  if (!_prSelected.size || !_prClip?.notes) return;
  _prClip.notes = _prClip.notes.filter((_, i) => !_prSelected.has(i));
  _prSelected.clear();
  _prFullDraw();
  _prRefreshClipDOM();
  if (typeof markDirty === "function") markDirty();
}

function _prRefreshClipDOM() {
  if (!_prClip) return;
  const el = document.querySelector(`.midi-clip[data-clip-id="${_prClip.id}"]`);
  if (el) rerenderMidiClipEvents(_prClip, el);
}

// Piano Roll - Pointer Interaction -----
let _prDragMode   = null; // "move" | "resize" | "select" | null
let _prDragIndex  = -1;
let _prDragOriginX = 0, _prDragOriginY = 0;
let _prDragOrigStart = 0, _prDragOrigDur = 0, _prDragOrigPitch = 0;
let _prSnapEnabled = true;
let _prDragMultiOrig = new Map();     // note obj → {startSamples, pitch}
let _prDragSelectedNotes = new Set(); // note objs being moved (for post-sort index rebuild)
let _prSelBox = null;                 // {x0,y0,x1,y1} during area select, null otherwise

function _prOnPointerDown(e) {
  if (e.button !== 0) return;
  const canvas = _prCanvas();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const hit = _prHitTest(x, y);

  if (hit) {
    canvas.setPointerCapture(e.pointerId);
    _prDragOriginX = x; _prDragOriginY = y;
    const n = _prClip.notes[hit.index];
    _prDragOrigStart = n.startSamples;
    _prDragOrigDur   = n.durationSamples;
    _prDragOrigPitch = n.pitch;
    _prDragIndex = hit.index;

    if (e.shiftKey) {
      if (_prSelected.has(hit.index)) _prSelected.delete(hit.index);
      else _prSelected.add(hit.index);
    } else if (!_prSelected.has(hit.index)) {
      _prSelected.clear();
      _prSelected.add(hit.index);
    }
    // Clicking an already-selected note with no shift keeps the full selection

    _prDragMode = hit.isResize ? "resize" : "move";

    // Save originals for all selected notes so multi-note drag works
    _prDragMultiOrig.clear();
    _prDragSelectedNotes.clear();
    _prSelected.forEach(i => {
      const note = _prClip.notes[i];
      if (note) {
        _prDragMultiOrig.set(note, { startSamples: note.startSamples, pitch: note.pitch });
        _prDragSelectedNotes.add(note);
      }
    });

    _prPreviewNote(n.pitch, n.durationSamples / _prGetSR(), n.velocity ?? 100);
  } else {
    // Start area select on empty space; a click (no drag) will create a note on pointer up
    canvas.setPointerCapture(e.pointerId);
    if (!e.shiftKey) _prSelected.clear();
    _prDragMode = "select";
    _prDragOriginX = x; _prDragOriginY = y;
    _prSelBox = null;
  }
  _prFullDraw();
}

function _prOnPointerMove(e) {
  const canvas = _prCanvas();
  if (!canvas.hasPointerCapture(e.pointerId)) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const pps = _prPixelsPerSample();
  const deltaX = x - _prDragOriginX;
  const deltaSamples = deltaX / pps;

  if (_prDragMode === "resize") {
    let newDur = _prDragOrigDur + deltaSamples;
    if (_prSnapEnabled) {
      const endSamples = _prDragOrigStart + newDur;
      newDur = _prSnapSamples(endSamples) - _prDragOrigStart;
    }
    const minDur = Math.round(_prGetSR() / 32);
    _prClip.notes[_prDragIndex].durationSamples = Math.max(minDur, Math.round(newDur));
  } else if (_prDragMode === "move") {
    const deltaY = y - _prDragOriginY;
    const deltaPitch = -Math.round(deltaY / PR_ROW_H);

    // Compute snapped sample delta using the anchor note
    let newAnchorStart = _prDragOrigStart + deltaSamples;
    if (_prSnapEnabled) newAnchorStart = _prSnapSamples(newAnchorStart);
    const snappedDelta = newAnchorStart - _prDragOrigStart;

    // Apply the same delta to every note in the multi-selection
    _prDragMultiOrig.forEach((orig, note) => {
      let ns = Math.max(0, Math.min(_prClip.durationSamples - 1, Math.round(orig.startSamples + snappedDelta)));
      note.startSamples = ns;
      note.pitch = Math.max(PR_MIN_PITCH, Math.min(PR_MAX_PITCH, orig.pitch + deltaPitch));
    });
  } else if (_prDragMode === "select") {
    if (Math.abs(deltaX) > 3 || Math.abs(y - _prDragOriginY) > 3) {
      _prSelBox = {
        x0: Math.min(_prDragOriginX, x), y0: Math.min(_prDragOriginY, y),
        x1: Math.max(_prDragOriginX, x), y1: Math.max(_prDragOriginY, y)
      };
    }
  }
  _prDraw();
}

function _prOnPointerUp(e) {
  const canvas = _prCanvas();
  if (!canvas.hasPointerCapture(e.pointerId)) return;
  canvas.releasePointerCapture(e.pointerId);

  if (_prDragMode === "select") {
    if (_prSelBox) {
      // Apply area selection: add notes overlapping the box; shift toggles
      const pps = _prPixelsPerSample();
      _prClip.notes?.forEach((n, i) => {
        const nx = _prSamplesToX(n.startSamples);
        const nw = Math.max(4, n.durationSamples * pps);
        const ny = _prPitchToY(n.pitch);
        const inBox = nx < _prSelBox.x1 && nx + nw > _prSelBox.x0 &&
                      ny < _prSelBox.y1 && ny + PR_ROW_H > _prSelBox.y0;
        if (inBox) {
          if (e.shiftKey && _prSelected.has(i)) _prSelected.delete(i);
          else _prSelected.add(i);
        }
      });
      _prSelBox = null;
    } else {
      // Click on empty space with no drag — create a note
      const pitch = _prYToPitch(_prDragOriginY);
      let startSamples = _prXToSamples(_prDragOriginX);
      if (_prSnapEnabled) startSamples = _prSnapSamples(startSamples);
      const beforeSet = new Set(_prClip.notes);
      _prAddNote(pitch, startSamples, _prDefaultNoteDur());
      _prSelected.clear();
      _prClip.notes.forEach((n, i) => { if (!beforeSet.has(n)) _prSelected.add(i); });
      _prRefreshClipDOM();
      if (typeof markDirty === "function") markDirty();
    }
  } else if (_prDragMode === "move" || _prDragMode === "resize") {
    _prClip.notes.sort((a, b) => a.startSamples - b.startSamples);
    // Rebuild _prSelected by note-object identity after sort reorders indices
    if (_prDragSelectedNotes.size > 0) {
      _prSelected.clear();
      _prClip.notes.forEach((n, i) => { if (_prDragSelectedNotes.has(n)) _prSelected.add(i); });
    }
    _prDragMultiOrig.clear();
    _prDragSelectedNotes.clear();
    _prRefreshClipDOM();
    if (typeof markDirty === "function") markDirty();
  }

  _prDragMode = null;
  _prDragIndex = -1;
  _prFullDraw();
}

function _prOnWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Zoom
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    _prZoom = Math.max(0.1, Math.min(20, _prZoom * factor));
    _prSyncZoomSlider();
  } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    _prScrollX = Math.max(0, _prScrollX + e.deltaX);
  } else if (e.shiftKey) {
    _prScrollX = Math.max(0, _prScrollX + e.deltaY);
  } else {
    const totalH = PR_PITCH_RANGE * PR_ROW_H;
    const maxScrollY = Math.max(0, totalH - (_prCanvas()?.height ?? 0));
    _prScrollY = Math.max(0, Math.min(maxScrollY, _prScrollY + e.deltaY));
  }
  _prFullDraw();
}

function _prOnKeyDown(e) {
  if (!_prClip) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    _prDeleteSelected();
    e.preventDefault();
  } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    _prSelected.clear();
    _prClip.notes?.forEach((_, i) => _prSelected.add(i));
    _prFullDraw();
  } else if (e.key === "Escape") {
    _prSelected.clear();
    _prFullDraw();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (_prSelected.size === 0) return;
    e.preventDefault();
    const delta = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 5);
    let lastNote = null;
    _prSelected.forEach(i => {
      const n = _prClip.notes[i];
      if (n) { n.velocity = Math.max(1, Math.min(127, (n.velocity ?? 100) + delta)); lastNote = n; }
    });
    if (lastNote) _prPreviewNote(lastNote.pitch, lastNote.durationSamples / _prGetSR(), lastNote.velocity);
    _prFullDraw();
    if (typeof markDirty === "function") markDirty();
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const notes = _prClip.notes;
    if (!notes?.length) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    let next;
    if (_prSelected.size === 0) {
      next = dir === 1 ? 0 : notes.length - 1;
    } else {
      const indices = [..._prSelected];
      const pivot = dir === 1 ? Math.max(...indices) : Math.min(...indices);
      next = Math.max(0, Math.min(notes.length - 1, pivot + dir));
    }
    _prSelected.clear();
    _prSelected.add(next);
    _prPreviewNote(notes[next].pitch, notes[next].durationSamples / _prGetSR(), notes[next].velocity ?? 100);
    // Scroll so the selected note is visible
    const n = notes[next];
    const x = _prSamplesToX(n.startSamples);
    const canvas = _prCanvas();
    const margin = 40;
    if (x < margin) {
      _prScrollX = Math.max(0, _prScrollX + x - margin);
    } else if (canvas && x > canvas.width - margin) {
      _prScrollX += x - (canvas.width - margin);
    }
    _prFullDraw();
  }
}

// Piano Roll - Panel Drag/Resize -----
function _prAttachPanelDrag() {
  const panel  = document.getElementById("piano-roll-panel");
  const header = panel.querySelector(".piano-roll-header");
  let ox = 0, oy = 0, sx = 0, sy = 0;
  header.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    ox = parseInt(panel.style.left) || 0;
    oy = parseInt(panel.style.top)  || 0;
    sx = e.clientX; sy = e.clientY;
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener("pointermove", (e) => {
    if (!header.hasPointerCapture(e.pointerId)) return;
    panel.style.left = (ox + e.clientX - sx) + "px";
    panel.style.top  = (oy + e.clientY - sy) + "px";
  });
  header.addEventListener("pointerup", (e) => {
    if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);
  });

  const resizeHandle = panel.querySelector(".piano-roll-resize-handle");
  let rw = 0, rh = 0, rx = 0, ry = 0;
  resizeHandle.addEventListener("pointerdown", (e) => {
    rw = panel.offsetWidth; rh = panel.offsetHeight;
    rx = e.clientX; ry = e.clientY;
    resizeHandle.setPointerCapture(e.pointerId);
  });
  resizeHandle.addEventListener("pointermove", (e) => {
    if (!resizeHandle.hasPointerCapture(e.pointerId)) return;
    const newW = Math.max(400, rw + e.clientX - rx);
    const newH = Math.max(260, rh + e.clientY - ry);
    panel.style.width  = newW + "px";
    panel.style.height = newH + "px";
    _prResizeCanvases();
    _prFullDraw();
  });
  resizeHandle.addEventListener("pointerup", (e) => {
    if (resizeHandle.hasPointerCapture(e.pointerId)) resizeHandle.releasePointerCapture(e.pointerId);
  });
}

function _prResizeCanvases() {
  const body    = document.querySelector(".piano-roll-body");
  const keyCvs  = _prKeysCanvas();
  const rollCvs = _prCanvas();
  const rulerCvs = _prRulerCanvas();
  if (!body || !keyCvs || !rollCvs) return;
  const keyW = PR_KEY_W + (_prIsPercussion() ? PR_PERC_LABEL_W : 0);
  const rollW = rollCvs.clientWidth  || (body.clientWidth - keyW - 1);
  const rollH = rollCvs.clientHeight || (body.clientHeight - (rulerCvs?.clientHeight ?? 20));
  keyCvs.width        = keyW;
  keyCvs.style.width  = keyW + "px";
  keyCvs.height  = rollH;
  rollCvs.width  = rollW;
  rollCvs.height = rollH;
  if (rulerCvs) rulerCvs.width = rollW;
  const velCvs = _prVelCanvas();
  if (velCvs) {
    velCvs.width  = rollW;
    velCvs.height = 80;
  }
}

// Piano Roll - Keys Sidebar - Pointer Handlers -----
function _prKeysOnPointerDown(e) {
  const canvas = _prKeysCanvas();
  const y = e.clientY - canvas.getBoundingClientRect().top;
  const pitch = _prYToPitch(y);
  if (pitch < PR_MIN_PITCH || pitch > PR_MAX_PITCH) return;
  canvas.setPointerCapture(e.pointerId);
  _prActiveKeyPitch = pitch;
  _prDrawKeys(canvas);
  _prPreviewNote(pitch, 0.5);
}

function _prKeysOnPointerMove(e) {
  if (e.buttons === 0) return;
  const canvas = _prKeysCanvas();
  const y = e.clientY - canvas.getBoundingClientRect().top;
  const pitch = _prYToPitch(y);
  if (pitch === _prActiveKeyPitch || pitch < PR_MIN_PITCH || pitch > PR_MAX_PITCH) return;
  _prActiveKeyPitch = pitch;
  _prDrawKeys(canvas);
  _prPreviewNote(pitch, 0.5);
}

function _prKeysOnPointerUp() {
  _prActiveKeyPitch = null;
  _prDrawKeys(_prKeysCanvas());
}

// Piano Roll - Event Handlers - Velocity Lane -----
function _prOnVelPointerDown(e) {
  if (e.button !== 0) return;
  const canvas = _prVelCanvas();
  const rect = canvas.getBoundingClientRect();
  const idx = _prVelHitTest(e.clientX - rect.left);
  if (idx === -1) return;
  canvas.setPointerCapture(e.pointerId);
  _prVelDragging  = true;
  _prVelDragIndex = idx;
  _prClip.notes[idx].velocity = _prVelYToVelocity(e.clientY - rect.top, canvas.height);
  _prDrawVelocity();
}

function _prOnVelPointerMove(e) {
  const canvas = _prVelCanvas();
  if (!_prVelDragging || !canvas.hasPointerCapture(e.pointerId)) return;
  _prClip.notes[_prVelDragIndex].velocity =
    _prVelYToVelocity(e.clientY - canvas.getBoundingClientRect().top, canvas.height);
  _prDrawVelocity();
}

function _prOnVelPointerUp(e) {
  const canvas = _prVelCanvas();
  if (!canvas.hasPointerCapture(e.pointerId)) return;
  canvas.releasePointerCapture(e.pointerId);
  _prVelDragging  = false;
  _prVelDragIndex = -1;
  _prRefreshClipDOM();
  if (typeof markDirty === "function") markDirty();
}

// Piano Roll - Authority - Open/Close -----
function pianoRollOpen(clip, track) {
  _prClip    = clip;
  _prTrack   = track;
  _prSelected.clear();
  _prScrollY = Math.max(0, (PR_MAX_PITCH - 72) * PR_ROW_H - 150); // scroll to C5 area
  _prScrollX = 0;
  _prZoom    = 1;

  const panel = document.getElementById("piano-roll-panel");
  const title = document.getElementById("piano-roll-title");
  title.textContent = "Piano Roll — " + (track.name || "MIDI");
  panel.removeAttribute("hidden");
  const panelW = panel.offsetWidth || 960;
  panel.style.left = Math.round((window.innerWidth - panelW) / 2) + "px";
  panel.style.top  = "80px";

  // Bind canvas events (replace any prior listeners by re-creating the element)
  const oldCanvas = document.getElementById("piano-roll-canvas");
  const newCanvas = document.createElement("canvas");
  newCanvas.id = "piano-roll-canvas";
  oldCanvas.replaceWith(newCanvas);

  newCanvas.addEventListener("pointerdown", _prOnPointerDown);
  newCanvas.addEventListener("pointermove", _prOnPointerMove);
  newCanvas.addEventListener("pointerup",   _prOnPointerUp);
  newCanvas.addEventListener("wheel", _prOnWheel, { passive: false });

  const oldKeys = document.getElementById("piano-roll-keys");
  const newKeys = document.createElement("canvas");
  newKeys.id = "piano-roll-keys";
  oldKeys.replaceWith(newKeys);

  newKeys.addEventListener("pointerdown",  _prKeysOnPointerDown);
  newKeys.addEventListener("pointermove",  _prKeysOnPointerMove);
  newKeys.addEventListener("pointerup",    _prKeysOnPointerUp);
  newKeys.addEventListener("pointerleave", _prKeysOnPointerUp);
  newKeys.addEventListener("wheel", _prOnWheel, { passive: false });

  const oldRuler = document.getElementById("piano-roll-ruler");
  const newRuler = document.createElement("canvas");
  newRuler.id = "piano-roll-ruler";
  oldRuler.replaceWith(newRuler);
  newRuler.addEventListener("pointerdown", _prRulerOnPointerDown);

  _prVelDragging  = false;
  _prVelDragIndex = -1;
  const oldVel = document.getElementById("piano-roll-velocity");
  const newVel = document.createElement("canvas");
  newVel.id = "piano-roll-velocity";
  oldVel.replaceWith(newVel);
  newVel.addEventListener("pointerdown",   _prOnVelPointerDown);
  newVel.addEventListener("pointermove",   _prOnVelPointerMove);
  newVel.addEventListener("pointerup",     _prOnVelPointerUp);
  newVel.addEventListener("pointercancel", _prOnVelPointerUp);
  newVel.addEventListener("wheel", _prOnWheel, { passive: false });

  requestAnimationFrame(() => {
    _prResizeCanvases();
    // Scroll to SFZ instrument range if no existing notes dictate position
    const notes = _prClip.notes;
    if (!notes?.length && _prTrack?.instrument === 'sfz' && _prTrack.sfzName) {
      const range = typeof sfzGetKeyRange === 'function' ? sfzGetKeyRange(_prTrack.sfzName) : null;
      if (range) {
        const midPitch = Math.round((range.lo + range.hi) / 2);
        const h = _prCanvas()?.height ?? 400;
        _prScrollY = Math.max(0, (PR_MAX_PITCH - midPitch) * PR_ROW_H - h / 2);
      }
    }
    // Zoom so the note content fills ~90% of the canvas width
    if (notes?.length) {
      const firstStart = notes[0].startSamples;
      const lastEnd = notes.reduce((m, n) => Math.max(m, n.startSamples + n.durationSamples), 0);
      const span = lastEnd - firstStart;
      if (span > 0) {
        _prZoom = Math.min(20, (_prClip.durationSamples * 0.9) / span);
        _prScrollX = Math.max(0, firstStart * _prPixelsPerSample() - 20);
      }
    }
    _prSyncZoomSlider();
    _prFullDraw();
    _prStartLoop();
  });
}

function _prStartLoop() {
  if (_prAnimFrame) return;
  function loop() {
    if (!_prClip) { _prAnimFrame = null; return; }
    _prDrawRuler();
    _prDraw();
    _prDrawVelocity();
    _prAnimFrame = requestAnimationFrame(loop);
  }
  _prAnimFrame = requestAnimationFrame(loop);
}

function _prStopLoop() {
  if (_prAnimFrame) { cancelAnimationFrame(_prAnimFrame); _prAnimFrame = null; }
}

function pianoRollClose() {
  _prStopLoop();
  _prClip  = null;
  _prTrack = null;
  _prLiveKeyPitches.clear();
  const panel = document.getElementById("piano-roll-panel");
  panel.setAttribute("hidden", "");
}

function pianoRollRefreshKeys() {
  if (!_prClip) return;
  _prResizeCanvases();
  _prDrawKeys(_prKeysCanvas());
}

// Piano Roll - Init -----
// Scripts load at bottom of <body> so DOM is already available — run immediately.
function pianoRollInit() {
  document.getElementById("piano-roll-close").addEventListener("click", pianoRollClose);
  document.addEventListener("keydown", _prOnKeyDown);
  _prAttachPanelDrag();

  const gotoStartBtn = document.getElementById("piano-roll-goto-start");
  if (gotoStartBtn) {
    gotoStartBtn.addEventListener("click", () => {
      if (_prClip && typeof jumpPlayheadToTime === "function")
        jumpPlayheadToTime(_prClip.startSample / _prGetSR());
    });
  }

  const snapBtn = document.getElementById("piano-roll-snap");
  if (snapBtn) {
    snapBtn.classList.toggle("active", _prSnapEnabled);
    snapBtn.addEventListener("click", () => {
      _prSnapEnabled = !_prSnapEnabled;
      snapBtn.classList.toggle("active", _prSnapEnabled);
    });
  }

  const zoomSlider = document.getElementById("piano-roll-zoom-slider");
  if (zoomSlider) {
    zoomSlider.addEventListener("input", () => {
      _prZoom = Math.max(0.1, Math.min(20, _prSliderToZoom(Number(zoomSlider.value))));
      _prFullDraw();
    });
  }
}
