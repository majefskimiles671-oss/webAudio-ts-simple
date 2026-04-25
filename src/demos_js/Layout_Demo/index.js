// index.js

// ============================================================
// Code Organization Guide -----
// ============================================================
//
// Use this guide when you’re not sure where new code belongs.
// Start at the top and stop as soon as one rule clearly applies.
//
// ───────────────────────────────────────────────────────────
// AUTHORITY (Meaning Layer)
// ───────────────────────────────────────────────────────────
// Put code here if it answers ANY of these questions:
//
// - “What does this user action *mean*?”
// - “Should state change, and how?”
// - “What are the consequences of this choice?”
//
// Typical signs:
// - Mutates canonical state (playing, recording, selectedMarkerId, etc.)
// - Coordinates multiple subsystems (playhead + scroll + render)
// - Called by event handlers, never directly attached to DOM events
//
// Smell test:
// - If you removed this function, would the app still behave correctly?
//   If NO → Authority.
//
// ───────────────────────────────────────────────────────────
// PROJECTION / RENDERING (View Layer)
// ───────────────────────────────────────────────────────────
// Put code here if it answers:
//
// - “Given the current state, what should the UI look like?”
//
// Typical signs:
// - Reads state
// - Writes to DOM (classes, styles, text, canvas)
// - Idempotent: safe to call repeatedly
// - No state mutation
//
// Smell test:
// - Could I call this every frame without breaking logic?
//   If YES → Projection / Rendering.
//
// ───────────────────────────────────────────────────────────
// DOM SYNC (Synchronization Layer)
// ───────────────────────────────────────────────────────────
// Put code here if it answers:
//
// - “How do browser realities map to app logic?”
//
// Typical signs:
// - Reads layout, geometry, scroll, bounding boxes
// - Converts pixels ⇄ seconds, viewport ⇄ content
// - Keeps multiple DOM regions in sync
// - Does NOT decide behavior, only translates reality
//
// Smell test:
// - Does this exist because the browser has pixels, scroll, or size?
//   If YES → DOM Sync.
//
// ───────────────────────────────────────────────────────────
// COMMON CONFUSIONS
// ───────────────────────────────────────────────────────────
// - If it BOTH changes state and touches the DOM → Authority wins.
// - Do NOT put decision logic in Event Handlers.
// - Do NOT let Projection mutate state.
// - Do NOT query the DOM to decide behavior.
//
// When in doubt:
// 1. Temporarily put the code here.
// 2. Ask “Is this deciding meaning, appearance, or geometry?”
// 3. Move it to Authority / Projection / DOM Sync accordingly.
//
// ============================================================
// Code Awaiting Organization -----
// ============================================================

// ============================================================
// Shared DOM Referneces -----
// ============================================================

// ----- Accessibility - Helpers -----
const _ariaAnnouncer = document.getElementById("aria-announcer");
function announce(msg) {
  _ariaAnnouncer.textContent = "";
  requestAnimationFrame(() => { _ariaAnnouncer.textContent = msg; });
}

// ----- Accessibility - Menu keyboard navigation -----
document.querySelectorAll(".menu").forEach((menu) => {
  const btn = menu.querySelector("button.menu-label");
  const items = Array.from(menu.querySelectorAll("[role='menuitem']"));

  function openMenu() { menu.classList.add("keyboard-open"); items[0]?.focus(); }
  function closeMenu() { menu.classList.remove("keyboard-open"); btn.focus(); }

  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openMenu(); }
  });

  items.forEach((item, i) => {
    item.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); closeMenu(); }
    });
  });

  menu.addEventListener("focusout", (e) => {
    if (!menu.contains(e.relatedTarget)) menu.classList.remove("keyboard-open");
  });
});

// Close menu on item click — add class that hides popup, clear it once mouse leaves
document.querySelector(".menu-bar").addEventListener("click", (e) => {
  const item = e.target.closest(".menu-pop div");
  if (!item) return;
  const menu = item.closest(".menu");
  menu.classList.remove("keyboard-open");
  menu.classList.add("item-clicked");
  menu.addEventListener("mouseleave", () => menu.classList.remove("item-clicked"), { once: true });
});

const controlsScrollCol = document.getElementById("controls-scroll-column");
const dropIndicator = document.getElementById("drop-indicator");
controlsScrollCol.addEventListener("input", (e) => {
  const gs = e.target.closest("gain-slider");
  if (gs) {
    markDirty();
    const track = findTrackByControlRow(gs.closest(".control-row"));
    if (track) { track.gain = gs.value; syncTrackMutes(); }
    return;
  }
  const ps = e.target.closest("pan-slider");
  if (ps) {
    markDirty();
    const track = findTrackByControlRow(ps.closest(".control-row"));
    if (track) { track.pan = ps.value; audioEngineSetTrackPan(track.id, track.pan / 100); }
    return;
  }
  const os = e.target.closest(".row-opacity-slider");
  if (os) {
    markDirty();
    const track = findTrackByControlRow(os.closest(".control-row"));
    if (track) {
      track.opacity = parseInt(os.value);
      track.timelineRow.style.setProperty('--row-opacity', track.opacity / 100);
    }
  }
});
const timelineArea = document.getElementById("timeline-area");
const timelineInner = document.getElementById("timeline-inner");

// ============================================================
// State (Truth Layer) -----
// ============================================================

//  Constants
const BASE_PPS = 100;
const SCROLL_THRESHOLD = 120;
const MAX_CANVAS_PX = 16383; // Chrome hardware canvas width limit

//  Zoom State
// 7 log-spaced levels (~×3.3 per step ≈ √10); center index 3 = 1×
const zoomLevels = [0.03, 0.1, 0.3, 1, 3, 10, 30];
let zoomIndex = 3; // default = 1x = zoomLevels[3]

// Are state and view drivers at the same time
let zoom = zoomLevels[zoomIndex];
let currentTimeSeconds = 0;
let rulerMode = "bars"; // "seconds" | "bars"

let recordStartTime = null;
let recordingTrackRow = null;
let recordingLaneTrack = null;  // the current (unpromoted) recording lane track object
let armedRecordTarget = null;   // armed audio track already in tracks[] (used instead of recording lane)

// Keyboard → MIDI note map (two-row piano layout, C4=60)
const KEY_NOTE_MAP = {
  'a': 60, 'w': 61, 's': 62, 'e': 63, 'd': 64, 'f': 65, 't': 66,
  'g': 67, 'y': 68, 'h': 69, 'u': 70, 'j': 71, 'k': 72, 'o': 73, 'l': 74, 'p': 75,
};
const _liveKeyNotes = new Map(); // key → { nodes, pitch, startSample }
const _activeKeys   = new Set();
let _pendingMidiNotes = []; // accumulated during MIDI recording, flushed at onRecordStop

//  Track State
const tracks = [];        // promoted tracks only, front = newest (matches DOM order)
const dragState = { track: null, insertBefore: null };
const SAMPLE_RATE = 48000; // used for sample-accurate time serialization

//  Global Musical State
let tempoBPM = 120;
let timeSignature = {
  beats: 4,
  noteValue: 4,
};

const ORIGIN_MARKER_ID = "origin";
let markers = [];
let selectedMarkerId = null;
let _markerDragState = null; // { markerId }  — set while dragging a marker

//  Clip Selection
const selectedClipIds = new Set();
let _audioDragJustCompleted = false;

//  Musical Grid
let bpm = 120; // beats per minute
let beatsPerBar = timeSignature.beats; // kept in sync with timeSignature.beats

let trackCount = 0;

//  Dirty Flag
let _dirty = false;
const _unsavedIndicator = document.getElementById("unsaved-indicator");
function markDirty() {
  _dirty = true;
  _unsavedIndicator.hidden = false;
}
function clearDirty() {
  _dirty = false;
  _unsavedIndicator.hidden = true;
}

// State - View State - Truth Layer -----
const viewState = {
  bottomPanel:          false,
  master:               false,
  effects:              false,
  notes:                false,
  scenes:               false,
  markerTransport:      true,
  tempo:                true,
  metronome:            true,
  zoom:                 true,
  solo:                 false,
  chordDiagrams:        false,
  markerLookaheadBeats: 1,
  hue:                  0,
  saturation:           100,
};

// Authority - View State - Apply -----
function applyViewState() {
  const toggles = [
    ["scenes",          "hide-scenes",          "toggle-scenes",          "Hide Scenes",           "Show Scenes"],
    ["markerTransport", "hide-marker-transport", "toggle-marker-transport","Hide Marker Transport", "Show Marker Transport"],
    ["tempo",           "hide-tempo",            "toggle-tempo",           "Hide Tempo & Time Sig", "Show Tempo & Time Sig"],
    ["metronome",       "hide-metronome",        "toggle-metronome",       "Hide Metronome",        "Show Metronome"],
    ["zoom",            "hide-zoom",             "toggle-zoom",            "Hide Zoom Slider",      "Show Zoom Slider"],
    ["solo",            "hide-solo",             "toggle-solo",            "Hide Solo Buttons",     "Show Solo Buttons"],
    ["master",          "hide-master",           "toggle-master",          "Hide Master Controls",  "Show Master Controls"],
    ["effects",         "hide-effects",          "toggle-effects",         "Hide Effects",          "Show Effects"],
    ["notes",           "hide-notes",            "toggle-notes",           "Hide Marker Notes",     "Show Marker Notes"],
  ];
  toggles.forEach(([key, cls, menuId, hideLabel, showLabel]) => {
    document.body.classList.toggle(cls, !viewState[key]);
    const el = document.getElementById(menuId);
    if (el) el.textContent = viewState[key] ? hideLabel : showLabel;
  });

  const bp = document.getElementById("bottom-panel");
  bp.classList.toggle("hidden", !viewState.bottomPanel);
  const bpBtn = document.getElementById("toggle-bottom-panel");
  if (bpBtn) bpBtn.textContent = viewState.bottomPanel ? "Hide Bottom Panel" : "Show Bottom Panel";
  if (viewState.bottomPanel) renderBottomPanel();

  const cdDialog = document.getElementById("chord-diagrams-dialog");
  if (cdDialog) cdDialog.classList.toggle("cd-visible", viewState.chordDiagrams);

  const filters = [];
  if (viewState.hue !== 0) {
    const theme = document.body.getAttribute("data-theme") ?? "";
    if (theme.toLowerCase().includes("base")) filters.push(`sepia(1)`);
    filters.push(`hue-rotate(${viewState.hue}deg)`);
  }
  if (viewState.saturation !== 100) filters.push(`saturate(${viewState.saturation}%)`);
  document.body.style.filter = filters.join(' ');
}

//  Transport State
let selectedTrack = null;
let playing = false;
let recording = false;
let inRecordingSession = false;
let masterGain = 100;
let startTime = 0;
let recordStartX = null;
let playbackStartX = 0; // px offset where playback begins

// State - Video Backdrop - Truth Layer -----
let videoEl = null;
let videoFile = null; // original File object, used by project-io to write the video on save
let _videoDriftFrame = 0;

// ============================================================
// Helpers (Pure Computation Layer) -----
// ============================================================

// If a helper ever branches or checks app state → promote it to Authority.
function jumpPlayheadToTime(seconds) {
  const px = secondsToPixels(seconds);
  setPlayheadPositionPx(px);
  if (playing) {
    playbackStartX = px;
    startTime = performance.now();
    if (videoEl) videoEl.currentTime = seconds;
    audioEnginePlay(
      tracks.map(t => ({
        id: t.id,
        pan: t.pan / 100,
        clips: t.clips.map(clip => ({ ...clip, gain: t.gain / 100 })),
      })),
      seconds
    );
    syncTrackMutes();
  }
}

function secondsToPixels(seconds) {
  return seconds * BASE_PPS * zoom;
}

function pixelsToSeconds(px) {
  return px / (BASE_PPS * zoom);
}

// ----- Marker Helpers
function getSelectedMarkerIndex() {
  return markers.findIndex((m) => m.id === selectedMarkerId);
}

function findNearbyMarker(time, thresholdPx = 8) {
  const thresholdSec = thresholdPx / (BASE_PPS * zoom);
  return markers.find((m) => Math.abs(m.time - time) <= thresholdSec) ?? null;
}

function secondsPerBeat() {
  return 60 / bpm;
}

function secondsPerBar() {
  return secondsPerBeat() * beatsPerBar;
}

function snapToBeat(time) {
  const spb = secondsPerBeat();
  return Math.round(time / spb) * spb;
}

function snapToHalfBeat(time) {
  const half = secondsPerBeat() / 2;
  return Math.round(time / half) * half;
}

function getRulerTicks(startSeconds, endSeconds) {
  if (rulerMode === "seconds") {
    return getSecondTicks(startSeconds, endSeconds);
  }
  if (rulerMode === "bars") {
    return getBarTicks(startSeconds, endSeconds);
  }
}

function getSecondTicks(startSeconds, endSeconds) {
  const majorStep = zoom <= 0.5 ? 4 : zoom <= 1 ? 2 : zoom <= 2 ? 1 : 0.5;

  const minorStep = majorStep / 4;
  const ticks = [];

  for (
    let t = Math.floor(startSeconds / minorStep) * minorStep;
    t <= endSeconds;
    t += minorStep
  ) {
    ticks.push({
      time: t,
      major: Math.abs(t % majorStep) < 0.0001,
      label: Math.abs(t % majorStep) < 0.0001 ? formatTime(t) : null,
    });
  }

  return ticks;
}

function getBarTicks(startSeconds, endSeconds) {
  const barLength = secondsPerBar();
  const beatLength = secondsPerBeat();
  const ticks = [];

  const startBar = Math.floor(startSeconds / barLength);

  let t = startBar * barLength;

  while (t <= endSeconds) {
    // Major bar tick
    ticks.push({
      time: t,
      major: true,
      label: `Bar ${startBar + 1}`,
    });

    // Beat ticks
    for (let b = 1; b < beatsPerBar; b++) {
      const bt = t + b * beatLength;
      if (bt >= startSeconds && bt <= endSeconds) {
        ticks.push({
          time: bt,
          major: false,
          label: null,
        });
      }
    }

    t += barLength;
  }

  return ticks;
}

function isTransportMoving() {
  return getTransportState() !== "IDLE";
}

// tiny state machine
// Use getTransportState() to explain behavior, not to control everything.
/**
 * State mutations change flags.
 * Transition detection decides behavior.
 **/
function getTransportState() {
  if (playing && recording) return "PLAY_RECORD";
  if (playing) return "PLAY";
  if (recording) return "RECORD";
  return "IDLE";
}

function getPlayheadX() {
  const transform = playhead.style.transform;
  if (!transform) {
    return 0;
  }

  const match = transform.match(/translateX\(([-\d.]+)px\)/);
  return match ? parseFloat(match[1]) : 0;
}

// ----- Track Name Generator
// Lists live in trackNames.js (loaded before this script)

let _trackNamePool = [];

const NUMBER_WORDS = [
  "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

function pickTrackName() {
  const word = NUMBER_WORDS[trackCount - 1] ?? trackCount;
  return { name: `track ${word}`, definition: null };
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const t = Math.floor((s * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${t}`;
}

function computeWaveformWidth(seconds) {
  return Math.floor(seconds * BASE_PPS * zoom);
}

function generateWaveformData(numSamples) {
  const data = [];
  let envelope = 0.4 + Math.random() * 0.4;
  for (let i = 0; i < numSamples; i++) {
    envelope += (Math.random() - 0.5) * 0.08;
    envelope = Math.max(0.05, Math.min(0.95, envelope));
    data.push(Math.random() * envelope);
  }
  return data;
}

// ----- Playhead View Helpers
function ensurePlayheadInViewCentered() {
  const playheadX = secondsToPixels(currentTimeSeconds);
  const viewLeft = timelineArea.scrollLeft;
  const viewRight = viewLeft + timelineArea.clientWidth;

  // // Offscreen to the left OR right → center it
  // if (playheadX < viewLeft || playheadX > viewRight) {
  //     timelineArea.scrollLeft =
  //         Math.max(0, playheadX - timelineArea.clientWidth / 2);
  // }

  const MARGIN = 40;
  if (playheadX < viewLeft + MARGIN || playheadX > viewRight - MARGIN) {
    timelineArea.scrollLeft = Math.max(
      0,
      playheadX - timelineArea.clientWidth / 2,
    );
  }
}

// ============================================================
// Authority (Meaning Layer) -----
// ============================================================

function setRulerMode(mode) {
  rulerMode = mode;
  renderTimelineLayer();
}

function setTimeSignature(beats, noteValue) {
  timeSignature = { beats, noteValue };
  beatsPerBar = beats;
  renderTimeSignature();
  renderTimelineLayer();
  renderMetronomeGrid();
  syncTimelineMinWidth();
}

// ----- Clip Selection
function selectClip(clipId) {
  selectedClipIds.clear();
  selectedClipIds.add(clipId);
  document.querySelectorAll(".waveform").forEach(el => {
    el.classList.toggle("selected", el.dataset.clipId === clipId);
  });
}

function toggleClipSelection(clipId) {
  if (selectedClipIds.has(clipId)) {
    selectedClipIds.delete(clipId);
    document.querySelector(`.waveform[data-clip-id="${clipId}"]`)?.classList.remove("selected");
  } else {
    selectedClipIds.add(clipId);
    document.querySelector(`.waveform[data-clip-id="${clipId}"]`)?.classList.add("selected");
  }
}

function selectAllClipsInTrack(track) {
  selectedClipIds.clear();
  document.querySelectorAll(".waveform.selected").forEach(el => el.classList.remove("selected"));
  track.clips.forEach(c => {
    selectedClipIds.add(c.id);
    document.querySelector(`.waveform[data-clip-id="${c.id}"]`)?.classList.add("selected");
  });
}

function deselectClip() {
  selectedClipIds.clear();
  document.querySelectorAll(".waveform.selected").forEach(el => el.classList.remove("selected"));
}

function deleteSelectedClip() {
  if (selectedClipIds.size === 0) return;
  selectedClipIds.forEach(clipId => {
    const track = tracks.find(t => t.clips.some(c => c.id === clipId));
    if (track) track.clips = track.clips.filter(c => c.id !== clipId);
    document.querySelector(`.waveform[data-clip-id="${clipId}"]`)?.remove();
    // Memory Leak Prevention: free the decoded AudioBuffer so the audio engine's _buffers map doesn't hold it indefinitely.
    audioEngineRemoveBuffer(clipId);
  });
  deselectClip();
  markDirty();
}


// ----- Marker Selection
function selectMarkerByIndex(index) {
  if (!markers.length) return;

  // Clamp index to valid range
  const clamped = Math.max(0, Math.min(index, markers.length - 1));
  const marker = markers[clamped];

  // Update selected marker ID
  selectedMarkerId = marker.id;

  // Move playhead to marker time
  jumpPlayheadToTime(marker.time);

  // ----- Auto‑Scroll to Marker
  const markerX = secondsToPixels(marker.time);
  const viewWidth = timelineArea.clientWidth;

  // Center the marker in the viewport
  const targetScrollLeft = markerX - viewWidth / 2;
  timelineArea.scrollLeft = Math.max(0, targetScrollLeft);

  // ----- Re-render the marker layer
  renderMarkers();

  // ----- Re-render marker transport controls
  renderMarkerTransport();
  renderBottomPanel();

  if (typeof cdHighlightChord === "function") {
    cdHighlightChord(marker.chordId);
  }
}

//  -----------Apply Transport Change
function applyTransportChange({ play, record }) {
  const prevState = getTransportState();
  const wasPlaying = playing;
  const wasRecording = recording;

  // ⛔ Guard: do not allow Play to stop playback while recording
  if (wasRecording && play === false && record === true) {
    return;
  }

  playing = play;
  recording = record;

  const nextState = getTransportState();

  if (!wasPlaying && playing) {
    onTransportStart();
    startMeterAnimation();
  }

  if (wasPlaying && !playing) {
    stopMeterAnimation();
    audioEngineStop();
    midiEngineStop();
    if (videoEl) { videoEl.pause(); videoEl.currentTime = currentTimeSeconds; }
    tanpuraStop();
  }

  if (!wasRecording && recording) { onRecordStart(); startRecordingRange(); }
  if (wasRecording && !recording) { if (wasPlaying) onRecordStop(); clearRecordingRange(); }

  if (prevState !== "IDLE" && nextState === "IDLE") {
    promoteRecordingLane();
  }

  syncTransportUI();
}

function returnToBeginning() {
  setPlayheadPositionPx(0);
  timelineArea.scrollLeft = 0;
  if (videoEl) videoEl.currentTime = 0;
  if (playing) { audioEngineStop(); onTransportStart(); }
}

// Authority - Video Backdrop - Meaning Layer -----
function loadVideoFile(file, { opacity = 45 } = {}) {
  const el = document.getElementById("timeline-video");
  if (el.src) URL.revokeObjectURL(el.src);
  el.src = URL.createObjectURL(file);
  el.muted = true;
  el.style.opacity = opacity / 100;
  el.currentTime = currentTimeSeconds;
  videoEl = el;
  videoFile = file;
  document.getElementById("video-opacity-slider").value = opacity;
  document.body.classList.add("has-video");
}

function removeVideo() {
  if (!videoEl) return;
  URL.revokeObjectURL(videoEl.src);
  videoEl.src = "";
  videoEl = null;
  videoFile = null;
  document.body.classList.remove("has-video", "video-phosphor");
  document.getElementById("video-phosphor-btn").classList.remove("active");
}

// ----- Track Selection
function selectTrack(track) {
  if (selectedTrack) selectedTrack.controlRow.classList.remove("selected");
  selectedTrack = selectedTrack === track ? null : track;
  if (selectedTrack) selectedTrack.controlRow.classList.add("selected");
}

// ----- Track Lookup Helpers
function findTrackByControlRow(el) {
  return tracks.find(t => t.controlRow === el) ?? null;
}
function findTrackByTimelineRow(el) {
  return tracks.find(t => t.timelineRow === el) ?? null;
}
function findTrackByClipId(clipId) {
  return tracks.find(t => t.clips.some(c => c.id === clipId)) ?? null;
}

// ----- Track Management

function isNameUnique(name, excludeTrack = null) {
  return !tracks.some(t => t !== excludeTrack && t.name === name);
}

function promptUniqueName(conflictingName, excludeTrack) {
  return new Promise(resolve => {
    const overlay = document.getElementById("unique-name-overlay");
    const msg     = document.getElementById("unique-name-message");
    const input   = document.getElementById("unique-name-input");
    const accept  = document.getElementById("unique-name-accept");
    const cancel  = document.getElementById("unique-name-cancel");

    msg.textContent = `"${conflictingName}" is already used by another track. Enter a unique name:`;
    input.value = conflictingName;
    accept.disabled = true;
    overlay.hidden = false;
    input.focus();
    input.select();

    function onInput() {
      const val = input.value.trim();
      accept.disabled = val === "" || !isNameUnique(val, excludeTrack);
    }

    function onAccept() {
      cleanup();
      resolve(input.value.trim());
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onKeydown(e) {
      if (e.key === "Enter" && !accept.disabled) onAccept();
      if (e.key === "Escape") onCancel();
    }

    function cleanup() {
      overlay.hidden = true;
      input.removeEventListener("input", onInput);
      accept.removeEventListener("click", onAccept);
      cancel.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKeydown);
    }

    input.addEventListener("input", onInput);
    accept.addEventListener("click", onAccept);
    cancel.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKeydown);
  });
}

function createTrack(label, { prepend = false, type = 'audio' } = {}) {
  label = label.slice(0, 30);
  // State object is created first so all event listeners can close over it.
  // controlRow and timelineRow are assigned after DOM construction.
  const track = {
    id:          crypto.randomUUID(),
    name:        label,
    type,
    armed:       false,
    gain:        80,
    pan:         0,
    opacity:     100,
    scenes:      [],
    clips:       [],
    midiClips:   [],
    instrument:  "pluck",
    controlRow:  null,  // assigned below
    timelineRow: null,  // assigned below
    meterEl:     null,  // assigned below
    // Meter animation state
    meterL: 0, meterR: 0,
    meterTargetL: 0, meterTargetR: 0,
    meterPeakL: 0, meterPeakR: 0,
    meterPeakFramesL: 0, meterPeakFramesR: 0,
    meterBase: 0.45 + Math.random() * 0.45,
    meterTicksToNext: 0,
  };

  /* ----- Controls Row ----- */
  const controlTpl = document.getElementById("control-row-template");
  const controlFrag = controlTpl.content.cloneNode(true);
  const controlRow = controlFrag.querySelector(".control-row");
  const title = controlFrag.querySelector(".track-title");

  title.textContent = label;
  title.spellcheck = false;

  // Memory Leak Prevention: AbortController lets us remove all track event listeners in one call when the track is deleted.
  const trackController = new AbortController();
  const { signal } = trackController;

  title.addEventListener("focus", () => {
    const range = document.createRange();
    range.selectNodeContents(title);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, { signal });

  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); title.blur(); }
  }, { signal });

  title.addEventListener("input", () => {
    const text = title.textContent;
    if (text.length <= 30) return;
    const sel = window.getSelection();
    const offset = sel.rangeCount ? sel.getRangeAt(0).startOffset : 30;
    title.textContent = text.slice(0, 30);
    const textNode = title.firstChild;
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, Math.min(offset, 30));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, { signal });

  title.addEventListener("blur", () => {
    const t = title.textContent.trim();
    const finalName = t === "" ? label : t;
    if (isNameUnique(finalName, track)) {
      title.textContent = finalName;
      track.name = finalName;
      markDirty();
    } else {
      title.textContent = track.name;
      promptUniqueName(finalName, track).then(newName => {
        if (newName !== null) {
          title.textContent = newName;
          track.name = newName;
          markDirty();
        }
      });
    }
  }, { signal });

  controlFrag.querySelectorAll(".track-scene").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      track.scenes = Array.from(controlRow.querySelectorAll(".track-scene.active"))
        .map(b => b.textContent.trim());
      markDirty();
      updateSceneMask();
      syncTrackMutes();
    }, { signal });
  });

  const soloBtn = controlFrag.querySelector(".solo-btn");
  soloBtn.addEventListener("click", () => {
    const allSoloBtns = Array.from(document.querySelectorAll(".solo-btn"));
    const isActive = soloBtn.classList.contains("active");
    allSoloBtns.forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); b.disabled = false; });
    if (!isActive) {
      soloBtn.classList.add("active");
      soloBtn.setAttribute("aria-pressed", "true");
      allSoloBtns.forEach((b) => { if (b !== soloBtn) b.disabled = true; });
    }
    updateSoloMask();
    syncTrackMutes();
  }, { signal });

  const armBtn = document.createElement("button");
  armBtn.className = "arm-btn";
  armBtn.textContent = "●";
  armBtn.title = "Arm track for recording";
  armBtn.setAttribute("aria-label", "Record arm");
  armBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!track.armed) {
      armTrackExclusive(track);
    } else {
      track.armed = false;
      armBtn.classList.remove("arm-active");
      syncRecordBtnEnabled();
    }
  }, { signal });
  soloBtn.after(armBtn);

  const trackEditBtn = controlFrag.querySelector(".track-edit-btn");
  trackEditBtn.addEventListener("click", () => {
    if (tracks.indexOf(track) === -1) return;  // recording lane — not in tracks, protected
    openTrackEditDialog(track, trackController, ro);
  }, { signal });

  // Click background of control row to select the track and all its clips
  controlRow.addEventListener("click", (e) => {
    if (e.target.closest("button, [contenteditable], gain-slider, pan-slider, .row-opacity-slider, .drag-handle")) return;
    selectTrack(track);
    selectAllClipsInTrack(track);
    hideClipPopup();
  }, { signal });

  // Drag to reorder
  const dragHandle = controlFrag.querySelector(".drag-handle");
  dragHandle.addEventListener("pointerdown", () => { controlRow.draggable = true; }, { signal });
  dragHandle.addEventListener("pointerup",   () => { controlRow.draggable = false; }, { signal });

  controlRow.addEventListener("dragstart", (e) => {
    dragState.track = track;
    dragState.insertBefore = null;
    controlRow.classList.add("dragging");
    track.timelineRow.classList.add("dragging");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    canvas.style.cssText = "position:fixed;top:-2px;left:-2px;opacity:0;pointer-events:none";
    document.body.appendChild(canvas);
    e.dataTransfer.setDragImage(canvas, 0, 0);
    requestAnimationFrame(() => canvas.remove());
    e.dataTransfer.effectAllowed = "move";
  }, { signal });

  controlRow.addEventListener("dragend", () => {
    controlRow.draggable = false;
    controlRow.classList.remove("dragging");
    track.timelineRow.classList.remove("dragging");
    dropIndicator.classList.remove("visible");
    dragState.track = null;
    dragState.insertBefore = null;
  }, { signal });

  if (prepend) {
    controlsScrollCol.prepend(controlFrag);
  } else {
    controlsScrollCol.appendChild(controlFrag);
  }

  /* ----- Timeline Row ----- */
  const timelineTpl = document.getElementById("timeline-row-template");
  const timelineFrag = timelineTpl.content.cloneNode(true);
  const timelineRow = timelineFrag.querySelector(".timeline-row");

  if (prepend) {
    timelineCol.prepend(timelineFrag);
  } else {
    timelineCol.appendChild(timelineFrag);
  }

  /* ----- Height Sync ----- */
  // Memory Leak Prevention: ro is disconnected in the delete handler above so it doesn't hold DOM refs after removal.
  const ro = new ResizeObserver(([e]) => {
    controlRow.style.height = `${e.contentRect.height}px`;
  });
  ro.observe(timelineRow);

  /* ----- Meter Segments ----- */
  const meterEl = controlRow.querySelector(".track-meter");
  meterEl.querySelectorAll(".tm-ch").forEach(ch => {
    for (let i = 0; i < METER_SEGS; i++) {
      const seg = document.createElement("div");
      seg.className = "tm-seg";
      ch.appendChild(seg);
    }
  });

  // Instrument toggle + add-MIDI button (MIDI tracks only)
  if (type === 'midi') {
    const instrBtn = document.createElement("button");
    instrBtn.className = "instrument-toggle";
    instrBtn.textContent = "Pluck";
    instrBtn.title = "Switch instrument (Pluck / Synth)";
    instrBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      track.instrument = track.instrument === "pluck" ? "synth" : "pluck";
      instrBtn.textContent = track.instrument === "synth" ? "Synth" : "Pluck";
    }, { signal });

    const addMidiBtn = document.createElement("button");
    addMidiBtn.className = "add-midi-clip-btn";
    addMidiBtn.textContent = "+ MIDI";
    addMidiBtn.title = "Add MIDI clip at playhead";
    addMidiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addMidiClipToTrack(track);
    }, { signal });

    controlRow.querySelector(".track-scenes").prepend(instrBtn, addMidiBtn);
  }

  track.controlRow  = controlRow;
  track.timelineRow = timelineRow;
  controlRow.classList.add(type === 'midi' ? 'is-midi-track' : 'is-audio-track');
  timelineRow.classList.add(type === 'midi' ? 'is-midi-track' : 'is-audio-track');
  track.meterEl     = meterEl;
  return track;
}

function addClipToTrack(timelineRow, startSeconds, durationSeconds) {
  // Push to state — the clip gets a stable ID for serialization
  const clip = {
    id:              crypto.randomUUID(),
    startSample:     Math.round(startSeconds * SAMPLE_RATE),
    durationSamples: Math.round(durationSeconds * SAMPLE_RATE),
  };
  // Also check the recording lane — it isn't in `tracks` yet when onRecordStop fires
  const track = findTrackByTimelineRow(timelineRow)
    ?? (recordingLaneTrack?.timelineRow === timelineRow ? recordingLaneTrack : null);
  if (track && track.type !== 'midi') track.clips.push(clip);

  // Render waveform DOM element
  const rowInner = timelineRow.querySelector(".row-inner");

  const waveform = document.createElement("div");
  waveform.className = "waveform";
  waveform.dataset.clipId = clip.id;
  waveform.dataset.startSeconds = startSeconds;

  const canvas = document.createElement("canvas");
  canvas.className = "waveform-canvas";
  canvas.height = 80;
  canvas.dataset.durationSeconds = durationSeconds;
  canvas.width = Math.min(computeWaveformWidth(durationSeconds), MAX_CANVAS_PX);

  waveform.style.left = `${secondsToPixels(startSeconds)}px`;
  waveform.style.width = `${computeWaveformWidth(durationSeconds)}px`;

  canvas.dataset.amplitudes = JSON.stringify(generateWaveformData(256));
  drawDummyWaveform(canvas);

  waveform.appendChild(canvas);

  // Drag to move audio clip
  const AUDIO_DRAG_THRESHOLD = 5;
  let wfDragStartX = 0, wfDragStartSample = 0, wfIsDragging = false;

  waveform.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    wfDragStartX = e.clientX;
    wfDragStartSample = clip.startSample;
    wfIsDragging = false;
    waveform.setPointerCapture(e.pointerId);
  });

  waveform.addEventListener("pointermove", (e) => {
    if (!waveform.hasPointerCapture(e.pointerId)) return;
    const deltaX = e.clientX - wfDragStartX;
    if (!wfIsDragging && Math.abs(deltaX) > AUDIO_DRAG_THRESHOLD) {
      wfIsDragging = true;
      waveform.classList.add("wf-dragging");
    }
    if (wfIsDragging) {
      let newSec = Math.max(0, wfDragStartSample / SAMPLE_RATE + pixelsToSeconds(deltaX));
      if (rulerMode === "bars") newSec = snapToHalfBeat(newSec);
      clip.startSample = Math.round(newSec * SAMPLE_RATE);
      waveform.dataset.startSeconds = newSec;
      waveform.style.left = secondsToPixels(newSec) + "px";
    }
  });

  waveform.addEventListener("pointerup", (e) => {
    if (!waveform.hasPointerCapture(e.pointerId)) return;
    waveform.releasePointerCapture(e.pointerId);
    waveform.classList.remove("wf-dragging");
    if (wfIsDragging) {
      _audioDragJustCompleted = true;
      markDirty();
    }
    wfIsDragging = false;
  });

  rowInner.appendChild(waveform);
}

function createRecordingLane() {
  trackCount += 1;
  const { name, definition } = pickTrackName();
  const track = createTrack(name, { prepend: true });
  // Staging only — keep rows in memory, insert into DOM on promotion
  track.controlRow.remove();
  track.timelineRow.remove();
  recordingLaneTrack = track;
  showTrackNameTooltip(name, definition);
  announce(`Recording to new track: ${name}`);
}

function promoteRecordingLane() {
  inRecordingSession = false;
  if (!recordingLaneTrack) return;
  if (!recordingLaneTrack.timelineRow.querySelector(".waveform")) return;

  markDirty();
  controlsScrollCol.prepend(recordingLaneTrack.controlRow);
  timelineCol.prepend(recordingLaneTrack.timelineRow);
  tracks.unshift(recordingLaneTrack);  // newest promoted track at front, matches DOM order
  recordingLaneTrack = null;

  _completedRecordRanges.length = 0;
  renderCompletedRecordRanges();

  createRecordingLane();
  timelineArea.scrollTop = 0;
  controlsScrollCol.scrollTop = 0;
  syncTimelineOverlay();
  updateSceneMask();
  updateSoloMask();
}

function reorderTrack(dragged, insertBefore) {
  // insertBefore = null → append at end
  if (dragged === insertBefore) return;
  const fromIdx = tracks.indexOf(dragged);
  const toIdx   = insertBefore ? tracks.indexOf(insertBefore) : tracks.length;
  if (fromIdx === toIdx || fromIdx === toIdx - 1) return;

  tracks.splice(fromIdx, 1);
  if (insertBefore) {
    const destIdx = tracks.indexOf(insertBefore);
    tracks.splice(destIdx, 0, dragged);
    controlsScrollCol.insertBefore(dragged.controlRow, insertBefore.controlRow);
    timelineCol.insertBefore(dragged.timelineRow, insertBefore.timelineRow);
  } else {
    tracks.push(dragged);
    controlsScrollCol.appendChild(dragged.controlRow);
    timelineCol.appendChild(dragged.timelineRow);
  }
  markDirty();
}

function onRecordStart() {
  inRecordingSession = true;
  const armedAudioTrack = tracks.find(t => t.type === 'audio' && t.armed);
  if (armedAudioTrack) {
    armedRecordTarget = armedAudioTrack;
    recordingTrackRow = armedAudioTrack.timelineRow;
  } else {
    armedRecordTarget = null;
    recordingTrackRow = null;
  }
  _pendingMidiNotes = [];
  if (playing && recordingTrackRow) audioEngineStartRecording(); // armed while playing — start immediately
  // if not playing, onTransportStart() will call audioEngineStartRecording() when play begins
  timelineArea.scrollTop = 0;
  controlsScrollCol.scrollTop = 0;
}

async function onRecordStop() {
  // Flush any keys still held during MIDI recording → collect to _pendingMidiNotes
  _activeKeys.forEach(key => {
    const live = _liveKeyNotes.get(key);
    if (live) {
      _liveKeyNotes.delete(key);
      live.nodes.forEach(n => { try { n.stop(); } catch (_) {} });
      if (live.startSample !== null) {
        const endSample = Math.round(getPlayheadTime() * SAMPLE_RATE);
        _pendingMidiNotes.push({
          pitch:           live.pitch,
          startSample:     live.startSample,
          durationSamples: Math.max(Math.round(0.05 * SAMPLE_RATE), endSample - live.startSample),
          velocity:        100,
        });
      }
    }
  });
  _activeKeys.clear();

  const startTime = recordStartTime;    // capture before clearRecordingRange() nulls it
  const endTime   = getPlayheadTime();

  // Handle audio recording
  if (recordingTrackRow) {
    const duration = Math.max(0, endTime - startTime);
    const row = recordingTrackRow;
    recordingTrackRow = null;
    armedRecordTarget = null;

    const audioBuffer = await audioEngineStopRecording();

    const _latencyOffset = audioEngineGetCalibratedLatency() / 1000;
    addClipToTrack(row, Math.max(0, startTime - _latencyOffset), duration);

    // Use row reference to find the track — it may have been promoted to `tracks`
    // by the synchronous applyTransportChange IDLE transition before this await resumed.
    const clipTrack = findTrackByTimelineRow(row)
      ?? (recordingLaneTrack?.timelineRow === row ? recordingLaneTrack : null);
    if (audioBuffer && clipTrack) {
      const clip = clipTrack.clips[clipTrack.clips.length - 1];
      if (clip) {
        audioEngineStoreBuffer(clip.id, audioBuffer);
        updateClipWaveform(clip.id, audioBuffer, clipTrack.timelineRow);
      }
    }
  } else {
    armedRecordTarget = null;
  }

  // Create MIDI clip from recorded notes
  const armedMidiTrack = tracks.find(t => t.type === 'midi' && t.armed);
  if (armedMidiTrack && _pendingMidiNotes.length > 0) {
    const clipStartSample = Math.round(startTime * SAMPLE_RATE);
    const clipDuration    = Math.max(Math.round((endTime - startTime) * SAMPLE_RATE), Math.round(0.1 * SAMPLE_RATE));
    const clip = {
      id:              crypto.randomUUID(),
      startSample:     clipStartSample,
      durationSamples: clipDuration,
      events:          [],
      notes:           _pendingMidiNotes.map(n => ({
        pitch:           n.pitch,
        startSamples:    Math.max(0, n.startSample - clipStartSample),
        durationSamples: n.durationSamples,
        velocity:        n.velocity,
      })),
    };
    armedMidiTrack.midiClips.push(clip);
    renderMidiClip(armedMidiTrack, clip);
    markDirty();
  }
  _pendingMidiNotes = [];
}

// ============================================================
// Projection / Rendering (View Layer -----
// ============================================================

// Recording range
const recordRange = document.getElementById("record-range");
const _completedRecordRanges = []; // { startSec, endSec }

function startRecordingRange() {
  recordStartTime = getPlayheadTime(); // seconds
  recordRange.style.display = "block";
  recordRange.style.width = "0px";
}

function getPlayheadTime() {
  const x = getPlayheadX();
  return pixelsToSeconds(x);
}

function updateRecordRange() {
  if (recordStartTime === null) return;

  const currentTime = getPlayheadTime();

  const startX = secondsToPixels(recordStartTime);
  const endX = secondsToPixels(currentTime);

  recordRange.style.left = `${startX}px`;
  recordRange.style.width = `${Math.max(0, endX - startX)}px`;
}

function renderCompletedRecordRanges() {
  const container = recordRange.parentElement;
  container.querySelectorAll(".record-range-done").forEach(el => el.remove());
  _completedRecordRanges.forEach(({ startSec, endSec }) => {
    const div = document.createElement("div");
    div.className = "record-range-done";
    div.style.left = `${secondsToPixels(startSec)}px`;
    div.style.width = `${Math.max(0, secondsToPixels(endSec) - secondsToPixels(startSec))}px`;
    container.appendChild(div);
  });
}

function clearRecordingRange() {
  _completedRecordRanges.length = 0;
  renderCompletedRecordRanges();
  recordRange.style.display = "none";
  recordStartTime = null;
}

// Timeline Ruler
const rulerCanvas = document.getElementById("timeline-ruler-canvas");
const rulerCtx = rulerCanvas.getContext("2d");

function renderTimelineLayer() {
  renderTimelineRuler();
  renderMarkers();
}

function renderTimelineRuler() {
  const style = getComputedStyle(document.body);

  const textMain = style.getPropertyValue("--text-main").trim();

  const textMuted = style.getPropertyValue("--text-muted").trim();

  const borderSubtle = style.getPropertyValue("--border-subtle").trim();

  const viewWidth = timelineArea.clientWidth;
  const scrollLeft = timelineArea.scrollLeft;

  const rulerHeight = 32;

  // Canvas is viewport-wide and repositioned each render — never exceeds hardware canvas limit
  rulerCanvas.style.height = `${rulerHeight}px`;
  rulerCanvas.style.width  = `${viewWidth}px`;
  rulerCanvas.style.left   = `${scrollLeft}px`;
  rulerCanvas.width  = viewWidth;
  rulerCanvas.height = rulerHeight;

  const height = rulerCanvas.height;

  rulerCtx.clearRect(0, 0, viewWidth, height);
  const startSeconds = pixelsToSeconds(scrollLeft);
  const endSeconds = pixelsToSeconds(scrollLeft + viewWidth);

  rulerCtx.font = "10px monospace";
  rulerCtx.fillStyle = textMuted;

  let ticks = [];

  // ==========================
  // TICK GENERATION
  // ==========================

  if (rulerMode === "seconds") {
    const majorStep = zoom <= 0.5 ? 4 : zoom <= 1 ? 2 : zoom <= 2 ? 1 : 0.5;

    const minorStep = majorStep / 4;

    for (
      let t = Math.floor(startSeconds / minorStep) * minorStep;
      t <= endSeconds;
      t += minorStep
    ) {
      ticks.push({
        time: t,
        major: Math.abs(t % majorStep) < 0.0001,
        label: Math.abs(t % majorStep) < 0.0001 ? formatTime(t) : null,
      });
    }
  } else if (rulerMode === "bars") {
    const barLen = secondsPerBar();
    const beatLen = secondsPerBeat();

    const barPxWidth = barLen * BASE_PPS * zoom;
    const MIN_LABEL_PX = 46; // approx pixel width of a "Bar NNN" label
    // Round up to nearest power-of-2 so skipped bars fall on musically clean boundaries
    const rawEvery = Math.ceil(MIN_LABEL_PX / barPxWidth);
    const labelEvery = rawEvery <= 1 ? 1 : Math.pow(2, Math.ceil(Math.log2(rawEvery)));
    const showBeats = barPxWidth >= 20; // suppress beat ticks when bars are nearly touching
    const showBeatLabels = zoom >= 10; // label beats as "1.2 1.3 1.4" at the two most extreme zoom-in levels

    const firstBar = Math.floor(startSeconds / barLen);

    let barTime = firstBar * barLen;
    let barNum = firstBar;

    while (barTime <= endSeconds) {
      // Only draw bar lines on the label interval — skip lines for bars that would be too crowded
      if (barNum % labelEvery === 0) {
        ticks.push({
          time: barTime,
          major: true,
          label: showBeatLabels ? `${barNum + 1}.1` : `Bar ${barNum + 1}`,
        });
      }

      // Beat ticks
      if (showBeats) {
        for (let b = 1; b < beatsPerBar; b++) {
          const bt = barTime + b * beatLen;
          if (bt >= startSeconds && bt <= endSeconds) {
            ticks.push({
              time: bt,
              major: false,
              label: showBeatLabels ? `${barNum + 1}.${b + 1}` : null,
            });
          }
        }
      }

      barTime += barLen;
      barNum++;
    }
  }

  // ==========================
  // TICK RENDERING
  // ==========================

  for (const tick of ticks) {
    const x = secondsToPixels(tick.time) - scrollLeft;

    if (tick.major) {
      rulerCtx.strokeStyle = textMain;
      rulerCtx.beginPath();
      rulerCtx.moveTo(x + 0.5, height);
      rulerCtx.lineTo(x + 0.5, 8);
      rulerCtx.stroke();

      if (tick.label) {
        rulerCtx.fillText(tick.label, x + 2, 10);
      }
    } else {
      rulerCtx.strokeStyle = borderSubtle;
      rulerCtx.beginPath();
      rulerCtx.moveTo(x + 0.5, height);
      rulerCtx.lineTo(x + 0.5, height - 6);
      rulerCtx.stroke();

      if (tick.label) {
        rulerCtx.fillText(tick.label, x + 2, height - 7);
      }
    }
  }

}

function renderMetronomeGrid() {
  const scan = document.querySelector(".metronome-scan");
  const width = scan.clientWidth;
  const tickSpacing = width / beatsPerBar;
  scan.style.backgroundImage = `repeating-linear-gradient(90deg, var(--border-subtle), var(--border-subtle) 1px, transparent 1px, transparent ${tickSpacing}px)`;
}

function renderMetronomeScan() {
  const t = getPlayheadTime(); // seconds
  const spbar = secondsPerBar();
  const phase = (t / spbar) % 1; // bar mode

  // const phase = (t / spb) % 1;   // beat mode     // 0 → 1 per beat

  const scan = document.querySelector(".metronome-scan");
  const line = scan.querySelector(".metronome-line");

  const width = scan.clientWidth;
  const x = phase * width;

  const beatPhase = (phase * beatsPerBar) % 1;
  if (phase < 0.03 || beatPhase < 0.1) {
    line.style.opacity = "1";
    line.style.width = "3px";
  } else {
    line.style.opacity = "0.7";
    line.style.width = "2px";
  }

  line.style.transform = `translateX(${x}px)`;
}

// ----- Debug Event Target Overlay
function debugOverlayEventTarget(e, duration = 400) {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;

  const rect = el.getBoundingClientRect();
  const overlay = document.createElement("div");

  overlay.style.position = "fixed";
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.border = "2px solid red";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "99999";

  document.body.appendChild(overlay);

  setTimeout(() => overlay.remove(), duration);
}

// ----- Playhead Helpers
function setPlayheadPositionPx(px) {
  playhead.style.transform = `translateX(${px}px)`;
  rulerPlayhead.style.transform = `translateX(${px}px)`;
  currentTimeSeconds = pixelsToSeconds(px);
  if (videoEl && !playing) videoEl.currentTime = currentTimeSeconds;
  timer.textContent = formatTime(currentTimeSeconds);
  updateTimeDisplay(currentTimeSeconds);
  renderMetronomeScan();
}

function updateTimeDisplay(s) {
  timer.textContent = formatTime(s);
}

function renderTempo() {
  const el = document.getElementById("tempoDisplay");
  el.innerHTML = `${tempoBPM}`;
  el.setAttribute("aria-valuenow", tempoBPM);
}

function renderTimeSignature() {
  timeSigBtn.textContent = `${timeSignature.beats}/${timeSignature.noteValue}`;
}

const markersLayer = document.getElementById("timeline-markers");

function renderMarkers() {
  // Clear old marker DOM
  markersLayer.innerHTML = "";

  for (const marker of markers) {
    const markerWrap = document.createElement("div");
    markerWrap.className = "timeline-marker-hit";

    const markerLine = document.createElement("div");
    markerLine.className = "timeline-marker-line";

    if (marker.id === selectedMarkerId) {
      markerLine.classList.add("selected");
      markerWrap.classList.add("selected");
    }

    markerWrap.appendChild(markerLine);

    // position marker
    const x = secondsToPixels(marker.time);
    markerWrap.style.left = `${x}px`;

    markerWrap.addEventListener("mousedown", (e) => {
      e.stopPropagation(); // prevent scrub
      selectedMarkerId = marker.id;
      if (marker.id !== ORIGIN_MARKER_ID) {
        _markerDragState = { markerId: marker.id };
      }
      renderMarkers();
      renderMarkerTransport();
      renderBottomPanel();
    });

    // Stop click from bubbling to the ruler (would create a new marker)
    markerWrap.addEventListener("click", (e) => e.stopPropagation());

    markersLayer.appendChild(markerWrap);
  }
}

// ----- Marker Transport Rendering
// ----- Marker Transport Controls
const markerAddBtn = document.getElementById("marker-add");
const markerDeleteBtn = document.getElementById("marker-delete");

function renderMarkerTransport() {
  const idx = getSelectedMarkerIndex();
  const isOrigin = idx !== -1 && markers[idx].id === ORIGIN_MARKER_ID;

  markerDeleteBtn.disabled = idx === -1 || isOrigin;

  const display = document.getElementById("marker-time");
  display.textContent = idx === -1 ? "—" : formatTime(markers[idx].time);
  display.classList.toggle("disabled", recording);
}

function updateClipWaveform(clipId, audioBuffer, root = document) {
  const waveform = root.querySelector(`.waveform[data-clip-id="${clipId}"]`);
  if (!waveform) return;
  const canvas = waveform.querySelector(".waveform-canvas");
  if (!canvas) return;
  const amplitudes = _analyzeAudioBuffer(audioBuffer, Math.max(64, canvas.width));
  canvas.dataset.amplitudes = JSON.stringify(amplitudes);
  drawDummyWaveform(canvas);
}

function drawDummyWaveform(canvas) {
  const amplitudes = JSON.parse(canvas.dataset.amplitudes || "[]");
  if (!amplitudes.length) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const midY = h / 2;
  const n = amplitudes.length;
  const color = getComputedStyle(document.body).getPropertyValue("--accent-primary").trim() || "#ff9500";

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;

  for (let i = 0; i < n; i++) {
    const x = (i / n) * w;
    const barW = Math.max(1, (w / n) - 1);
    const barH = Math.max(1, amplitudes[i] * (h * 0.45));
    ctx.fillRect(Math.round(x), Math.round(midY - barH), Math.ceil(barW), Math.round(barH * 2));
  }

  ctx.globalAlpha = 1;
}

// Projection/Rendering - MIDI Clips -----

function addMidiClipToTrack(track) {
  if (track.type !== 'midi') return;
  const startSec = getPlayheadTime();
  const durSec   = 4 * secondsPerBar();
  const clip = {
    id:              crypto.randomUUID(),
    startSample:     Math.round(startSec * SAMPLE_RATE),
    durationSamples: Math.round(durSec   * SAMPLE_RATE),
    events:          [],
    notes:           undefined,
  };
  track.midiClips.push(clip);
  renderMidiClip(track, clip);
  markDirty();
}

function armTrackExclusive(track) {
  tracks.forEach(t => {
    if (t !== track && t.type === track.type && t.armed) {
      t.armed = false;
      t.controlRow.querySelector('.arm-btn').classList.remove('arm-active');
    }
  });
  track.armed = true;
  track.controlRow.querySelector('.arm-btn').classList.add('arm-active');
  syncRecordBtnEnabled();
}

function addMidiTrack() {
  trackCount += 1;
  const { name } = pickTrackName();
  const track = createTrack(name, { type: 'midi', prepend: true });
  tracks.unshift(track);
  armTrackExclusive(track);
  syncTimelineMinWidth();
  syncTimelineOverlay();
  updateSceneMask();
  updateSoloMask();
  markDirty();
}

function addAudioTrack() {
  trackCount += 1;
  const { name } = pickTrackName();
  const track = createTrack(name, { type: 'audio', prepend: true });
  tracks.unshift(track);
  armTrackExclusive(track);
  syncTimelineMinWidth();
  syncTimelineOverlay();
  updateSceneMask();
  updateSoloMask();
  markDirty();
}

function renderMidiClip(track, clip) {
  const rowInner = track.timelineRow.querySelector(".row-inner");
  const el = document.createElement("div");
  el.className = "midi-clip";
  el.dataset.clipId = clip.id;
  el.style.left  = secondsToPixels(clip.startSample / SAMPLE_RATE) + "px";
  el.style.width = computeWaveformWidth(clip.durationSamples / SAMPLE_RATE) + "px";
  rerenderMidiClipEvents(clip, el);

  const DRAG_THRESHOLD = 5;
  const DBL_MS = 300;
  let lastDown = 0, singleClickTimer = null;
  let dragStartX = 0, dragStartSample = 0, isDragging = false, isDblClick = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const now = Date.now();
    isDblClick = (now - lastDown) < DBL_MS;
    lastDown = now;
    dragStartX = e.clientX;
    dragStartSample = clip.startSample;
    isDragging = false;
    if (isDblClick && singleClickTimer) { clearTimeout(singleClickTimer); singleClickTimer = null; }
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId) || !isDblClick) return;
    const deltaX = e.clientX - dragStartX;
    if (!isDragging && Math.abs(deltaX) > DRAG_THRESHOLD) isDragging = true;
    if (isDragging) {
      let newSec = Math.max(0, dragStartSample / SAMPLE_RATE + pixelsToSeconds(deltaX));
      if (rulerMode === "bars") newSec = snapToHalfBeat(newSec);
      clip.startSample = Math.round(newSec * SAMPLE_RATE);
      el.style.left = secondsToPixels(newSec) + "px";
    }
  });

  el.addEventListener("pointerup", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    el.releasePointerCapture(e.pointerId);
    if (isDblClick) {
      if (isDragging) markDirty();
    } else {
      const cx = e.clientX, cy = e.clientY;
      singleClickTimer = setTimeout(() => {
        singleClickTimer = null;
        const offsetX = cx - el.getBoundingClientRect().left;
        const offsetSamples = Math.round(pixelsToSeconds(offsetX) * SAMPLE_RATE);
        showContextMenu([
          {
            label: "Edit Notes",
            action: () => {
              if (!Array.isArray(clip.notes)) clip.notes = [];
              pianoRollOpen(clip, track);
            },
          },
          {
            label: "Add chord",
            action: () => {
              const picker = buildMidiChordPicker((chord) => {
                clip.events.push({ offsetSamples, chordId: chord.id });
                clip.events.sort((a, b) => a.offsetSamples - b.offsetSamples);
                rerenderMidiClipEvents(clip, el);
                markDirty();
              });
              picker.style.left = cx + "px";
              picker.style.top  = cy + "px";
              document.body.appendChild(picker);
              setTimeout(() => {
                const dismiss = (ev) => {
                  if (!picker.contains(ev.target)) {
                    picker.remove();
                    document.removeEventListener("pointerdown", dismiss, { capture: true });
                  }
                };
                document.addEventListener("pointerdown", dismiss, { capture: true });
              }, 0);
            },
          },
          {
            label: "Delete clip",
            action: () => {
              track.midiClips = track.midiClips.filter(c => c !== clip);
              el.remove();
              markDirty();
            },
          },
        ], cx, cy);
      }, DBL_MS);
    }
    isDragging = false;
    isDblClick = false;
  });

  // Right-edge resize handle
  const rightHandle = document.createElement("div");
  rightHandle.className = "midi-clip-handle midi-clip-handle-right";
  let rStartX = 0, rStartDur = 0;
  rightHandle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    rStartX   = e.clientX;
    rStartDur = clip.durationSamples;
    rightHandle.setPointerCapture(e.pointerId);
  });
  rightHandle.addEventListener("pointermove", (e) => {
    if (!rightHandle.hasPointerCapture(e.pointerId)) return;
    const deltaX = e.clientX - rStartX;
    let newDurSec = rStartDur / SAMPLE_RATE + pixelsToSeconds(deltaX);
    if (rulerMode === "bars") {
      const snapped = snapToHalfBeat(clip.startSample / SAMPLE_RATE + newDurSec);
      newDurSec = snapped - clip.startSample / SAMPLE_RATE;
    }
    clip.durationSamples = Math.max(Math.round(SAMPLE_RATE / 4), Math.round(newDurSec * SAMPLE_RATE));
    el.style.width = computeWaveformWidth(clip.durationSamples / SAMPLE_RATE) + "px";
  });
  rightHandle.addEventListener("pointerup", (e) => {
    if (!rightHandle.hasPointerCapture(e.pointerId)) return;
    rightHandle.releasePointerCapture(e.pointerId);
    markDirty();
  });
  el.appendChild(rightHandle);

  // Left-edge resize handle
  const leftHandle = document.createElement("div");
  leftHandle.className = "midi-clip-handle midi-clip-handle-left";
  let lStartX = 0, lStartSample = 0, lStartDur = 0, lOrigOffsets = [], lOrigNoteStarts = [];
  leftHandle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    lStartX          = e.clientX;
    lStartSample     = clip.startSample;
    lStartDur        = clip.durationSamples;
    lOrigOffsets     = clip.events.map(ev => ev.offsetSamples);
    lOrigNoteStarts  = (clip.notes ?? []).map(n => n.startSamples);
    leftHandle.setPointerCapture(e.pointerId);
  });
  leftHandle.addEventListener("pointermove", (e) => {
    if (!leftHandle.hasPointerCapture(e.pointerId)) return;
    const deltaX = e.clientX - lStartX;
    let newStartSec = Math.max(0, lStartSample / SAMPLE_RATE + pixelsToSeconds(deltaX));
    if (rulerMode === "bars") newStartSec = snapToHalfBeat(newStartSec);
    const newStartSample = Math.round(newStartSec * SAMPLE_RATE);
    const sampleDelta    = newStartSample - lStartSample;
    const newDur         = lStartDur - sampleDelta;
    if (newDur < Math.round(SAMPLE_RATE / 4)) return;
    clip.startSample     = newStartSample;
    clip.durationSamples = newDur;
    clip.events.forEach((ev, i) => {
      ev.offsetSamples = Math.max(0, lOrigOffsets[i] - sampleDelta);
    });
    (clip.notes ?? []).forEach((n, i) => {
      n.startSamples = Math.max(0, lOrigNoteStarts[i] - sampleDelta);
    });
    el.style.left  = secondsToPixels(clip.startSample / SAMPLE_RATE) + "px";
    el.style.width = computeWaveformWidth(clip.durationSamples / SAMPLE_RATE) + "px";
    el.querySelectorAll(".midi-event").forEach((evEl, i) => {
      evEl.style.left = secondsToPixels(clip.events[i].offsetSamples / SAMPLE_RATE) + "px";
    });
  });
  leftHandle.addEventListener("pointerup", (e) => {
    if (!leftHandle.hasPointerCapture(e.pointerId)) return;
    leftHandle.releasePointerCapture(e.pointerId);
    markDirty();
  });
  el.appendChild(leftHandle);

  rowInner.appendChild(el);
}

function _renderMidiNotesMiniature(clip, el) {
  let canvas = el.querySelector(".midi-notes-miniature");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "midi-notes-miniature";
    el.appendChild(canvas);
  }
  const w = el.offsetWidth || Math.round(computeWaveformWidth(clip.durationSamples / SAMPLE_RATE));
  const h = 36;
  canvas.width  = w;
  canvas.height = h;
  const ctx2 = canvas.getContext("2d");
  ctx2.clearRect(0, 0, w, h);
  if (!clip.notes?.length) return;
  const pitches = clip.notes.map(n => n.pitch);
  const minP = Math.min(...pitches), maxP = Math.max(...pitches);
  const range = Math.max(maxP - minP, 11);
  ctx2.fillStyle = getComputedStyle(document.body).getPropertyValue("--accent-primary").trim() || "#7ec8e3";
  for (const n of clip.notes) {
    const x = Math.round((n.startSamples / clip.durationSamples) * w);
    const nw = Math.max(2, Math.round((n.durationSamples / clip.durationSamples) * w));
    const y  = Math.round(((maxP - n.pitch) / range) * (h - 4)) + 2;
    ctx2.fillRect(x, y, nw, 3);
  }
}

function rerenderMidiClipEvents(clip, el) {
  el.querySelectorAll(".midi-event").forEach(n => n.remove());
  el.querySelectorAll(".midi-notes-miniature").forEach(n => n.remove());
  if (Array.isArray(clip.notes)) {
    _renderMidiNotesMiniature(clip, el);
    return;
  }
  for (const ev of clip.events) {
    const chord = (typeof chords !== "undefined") && chords.find(c => c.id === ev.chordId);
    const evEl = document.createElement("div");
    evEl.className = "midi-event";
    evEl.textContent = chord ? (chord.name || "?") : "?";
    evEl.style.left = secondsToPixels(ev.offsetSamples / SAMPLE_RATE) + "px";

    const DRAG_THRESHOLD = 3;
    let evDragStartX = 0, evDragStartSamples = 0, evIsDragging = false;

    evEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      evDragStartX = e.clientX;
      evDragStartSamples = ev.offsetSamples;
      evIsDragging = false;
      evEl.setPointerCapture(e.pointerId);
    });

    evEl.addEventListener("pointermove", (e) => {
      if (!evEl.hasPointerCapture(e.pointerId)) return;
      const deltaX = e.clientX - evDragStartX;
      if (!evIsDragging && Math.abs(deltaX) > DRAG_THRESHOLD) evIsDragging = true;
      if (evIsDragging) {
        let newSec = evDragStartSamples / SAMPLE_RATE + pixelsToSeconds(deltaX);
        if (rulerMode === "bars") newSec = snapToHalfBeat(newSec);
        ev.offsetSamples = Math.max(0, Math.min(clip.durationSamples, Math.round(newSec * SAMPLE_RATE)));
        evEl.style.left = secondsToPixels(ev.offsetSamples / SAMPLE_RATE) + "px";
      }
    });

    evEl.addEventListener("pointerup", (e) => {
      if (!evEl.hasPointerCapture(e.pointerId)) return;
      evEl.releasePointerCapture(e.pointerId);
      if (evIsDragging) {
        clip.events.sort((a, b) => a.offsetSamples - b.offsetSamples);
        rerenderMidiClipEvents(clip, el);
        markDirty();
      } else {
        showContextMenu([
          {
            label: "Delete",
            action: () => {
              clip.events = clip.events.filter(x => x !== ev);
              rerenderMidiClipEvents(clip, el);
              markDirty();
            },
          },
        ], e.clientX, e.clientY);
      }
      evIsDragging = false;
    });

    el.appendChild(evEl);
  }
}


function refreshMidiClipDOM(clip) {
  const el = document.querySelector(`.midi-clip[data-clip-id="${clip.id}"]`);
  if (el) rerenderMidiClipEvents(clip, el);
}

function showContextMenu(items, x, y) {
  const menu = document.createElement("div");
  menu.className = "midi-context-menu";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.remove();
      item.action();
    });
    menu.appendChild(btn);
  }
  menu.style.left = x + "px";
  menu.style.top  = y + "px";
  document.body.appendChild(menu);
  setTimeout(() => {
    const dismiss = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("pointerdown", dismiss, { capture: true });
      }
    };
    document.addEventListener("pointerdown", dismiss, { capture: true });
  }, 0);
}

function buildMidiChordPicker(onSelect) {
  const chordList = (typeof chords !== "undefined") ? chords : [];
  const wrap = document.createElement("div");
  wrap.className = "midi-chord-picker-popup";
  for (const c of chordList) {
    const btn = document.createElement("button");
    btn.className = "midi-chord-picker-option";
    btn.textContent = c.name || "(unnamed)";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(c);
      wrap.remove();
    });
    wrap.appendChild(btn);
  }
  wrap.addEventListener("click", e => e.stopPropagation());
  return wrap;
}

function rerenderWaveforms() {
  /**
   * Make sure that every time you draw a waveform you do this first:
   * canvas.height = TRACK_HEIGHT;          // e.g. 80
   * canvas.style.height = `${TRACK_HEIGHT}px`;
   **/
  document.querySelectorAll(".waveform").forEach((waveform) => {
    const canvas = waveform.querySelector(".waveform-canvas");
    if (!canvas) return;

    const startSeconds = parseFloat(waveform.dataset.startSeconds);
    const durationSeconds = parseFloat(canvas.dataset.durationSeconds);
    const width = computeWaveformWidth(durationSeconds);

    canvas.width = Math.min(width, MAX_CANVAS_PX); // cap canvas allocation; waveform div can be wider
    waveform.style.left = `${secondsToPixels(startSeconds)}px`;
    waveform.style.width = `${width}px`;

    drawDummyWaveform(canvas);
  });

  for (const track of tracks) {
    for (const clip of track.midiClips) {
      const el = document.querySelector(`.midi-clip[data-clip-id="${clip.id}"]`);
      if (!el) continue;
      el.style.left  = secondsToPixels(clip.startSample / SAMPLE_RATE) + "px";
      el.style.width = computeWaveformWidth(clip.durationSamples / SAMPLE_RATE) + "px";
      rerenderMidiClipEvents(clip, el);
    }
  }
}

// ============================================================
// DOM Sync (Synchronization Layer) -----
// ============================================================

// transport
const returnToBeginningBtn = document.getElementById("returnToBeginningBtn");
const playBtn = document.getElementById("playBtn");
const recordBtn = document.getElementById("recordBtn");
const playhead = document.getElementById("playhead");
const rulerPlayhead = document.getElementById("ruler-playhead");
const timer = document.getElementById("timer");
const meter = document.getElementById("meter");
const meterBar = document.getElementById("meterBar");

// debug
const debugTransportState = document.getElementById("debug-transport-state");

// ----- Scrub Helpers
function scrubToMouseEvent(e) {
  const innerRect = timelineInner.getBoundingClientRect();

  // Convert viewport X → content X
  const contentX = e.clientX - innerRect.left; // + timelineArea.scrollLeft;

  const clampedX = Math.max(0, contentX);

  if (rulerMode === "bars") {
    const snappedSeconds = snapToHalfBeat(pixelsToSeconds(clampedX));
    setPlayheadPositionPx(secondsToPixels(snappedSeconds));
  } else {
    setPlayheadPositionPx(clampedX);
  }
}

function syncRecordBtnEnabled() {
  const anyArmed = tracks.some(t => t.armed);
  recordBtn.disabled = !recording && !anyArmed;
}

let _lastAnnouncedTransportState = null;
function syncTransportUI() {
  const state = getTransportState();

  playBtn.classList.toggle(
    "active",
    state === "PLAY" || state === "PLAY_RECORD",
  );
  recordBtn.classList.toggle(
    "recording",
    state === "RECORD" || state === "PLAY_RECORD",
  );
  meter.classList.toggle(
    "active",
    state === "RECORD" || state === "PLAY_RECORD",
  );
  returnToBeginningBtn.disabled = inRecordingSession;
  syncRecordBtnEnabled();
  renderMarkerTransport();

  if (state !== _lastAnnouncedTransportState) {
    _lastAnnouncedTransportState = state;
    const labels = { STOPPED: "Stopped", PLAY: "Playing", RECORD: "Recording", PLAY_RECORD: "Playing and recording" };
    announce(labels[state] ?? state);
  }

  // DEBUG OVERLAY
  if (document.body.classList.contains("debug")) {
    debugTransportState.textContent = `Transport: ${state}`;
  }
}

//  Scroll / Geometry Sync
/**
 * This governs shared vertical scrolling, which is orthogonal to transport.
 * Why here
 * It’s not transport logic
 * It’s not UI rendering
 * It’s about input routing + geometry
 * Later, if bugs appear here, your brain knows exactly where to look.
 **/

function syncTimelineOverlay() {
  const timelineColumn = document.getElementById("timeline-column");
  const timelineOverlay = document.getElementById("timeline-overlay");

  if (!timelineColumn || !timelineOverlay) return;

  timelineOverlay.style.width = `${timelineColumn.scrollWidth}px`;

  timelineOverlay.style.height = `${timelineColumn.scrollHeight}px`;
}

const timelineColumn = document.getElementById("timeline-column");
const timelineOverlay = document.getElementById("timeline-overlay");

function syncTimelineOverlayWidth() {
  timelineOverlay.style.width = `${timelineColumn.scrollWidth}px`;
}

function syncTimelineMinWidth() {
  const floorPx = secondsToPixels(16 * secondsPerBar());
  let maxPx = floorPx;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const endPx = secondsToPixels((clip.startSample + clip.durationSamples) / SAMPLE_RATE);
      if (endPx > maxPx) maxPx = endPx;
    }
  }
  const buffer = timelineArea.clientWidth;
  timelineInner.style.minWidth = `${maxPx > floorPx ? maxPx + buffer * 2 : floorPx}px`;
}

function ensureTimelineWidth(px) {
  const buffer = timelineArea.clientWidth;
  if (px + buffer > timelineInner.scrollWidth) {
    timelineInner.style.minWidth = `${px + buffer * 2}px`;
  }
}

// ============================================================
// Event Handlers (Intent Layer)  -----
// ============================================================


function setTheme(name, { silent = false } = {}) {
  document.body.setAttribute("data-theme", name);
  const isX286 = name === "x286";
  document.body.classList.toggle("video-phosphor", isX286);
  document.getElementById("video-phosphor-btn").classList.toggle("active", isX286);
  renderTimelineLayer();
  rerenderWaveforms();
  if (!silent) markDirty();
}

document.getElementById("debug-log-project").onclick = () => logProject();

{
  const btn = document.getElementById("debug-toggle-raw-mic");
  btn.onclick = async () => {
    const isRaw = await audioEngineToggleRawMicMode();
    btn.textContent = isRaw ? "Mic: Raw (no processing)" : "Mic: Default (noise suppressed)";
  };
}

{
  const btn = document.getElementById("debug-toggle-auto-normalize");
  btn.onclick = () => {
    const on = audioEngineToggleAutoNormalize();
    btn.textContent = on ? "Auto-normalize: On" : "Auto-normalize: Off";
  };
}

function logProject() {
  console.clear();
  const spb   = secondsPerBeat();
  const spbar = secondsPerBar();

  function toBarBeat(sec) {
    const bar  = Math.floor(sec / spbar);
    const beat = Math.floor((sec % spbar) / spb);
    const tick = Math.round(((sec % spb) / spb) * 100);
    return `${bar + 1}:${beat + 1}.${String(tick).padStart(2, "0")}`;
  }

  function toDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const d = serializeProject();
  const theme = document.body.getAttribute("data-theme") ?? "—";

  console.group(
    `%c ♩ PROJECT  •  ${d.bpm} BPM  •  ${d.timeSignature.beats}/${d.timeSignature.noteValue}  •  ${tracks.length} tracks  •  theme: ${theme}  •  id: ${d.id ?? "—"}`,
    "font-weight:bold; font-size:13px; color:#7aa2f7"
  );

  // --- Tracks summary ---
  console.group("Tracks");
  console.table(tracks.map((t, i) => ({
    "#":      i + 1,
    name:     t.name,
    clips:    t.clips.length,
    midi:     t.midiClips.length,
    gain:     (t.gain ?? 1).toFixed(2),
    pan:      (t.pan  ?? 0).toFixed(2),
    scenes:   t.scenes.join(", ") || "—",
  })));

  for (const t of tracks) {
    const hasContent = t.clips.length || t.midiClips.length;
    if (!hasContent) continue;
    console.group(`"${t.name}"`);

    if (t.clips.length) {
      console.log("%cAudio clips", "font-weight:bold");
      console.table(t.clips.map(c => ({
        id:       c.id.slice(0, 8),
        start:    toBarBeat(c.startSample / SAMPLE_RATE),
        duration: toDuration(c.durationSamples / SAMPLE_RATE),
      })));
    }

    if (t.midiClips.length) {
      console.log("%cMIDI clips", "font-weight:bold");
      console.table(t.midiClips.map(c => {
        const evRows = c.events.map(ev => {
          const chord = (typeof chords !== "undefined") && chords.find(ch => ch.id === ev.chordId);
          return `${toBarBeat(ev.offsetSamples / SAMPLE_RATE)} ${chord?.name ?? "?"}`;
        });
        return {
          id:       c.id.slice(0, 8),
          start:    toBarBeat(c.startSample / SAMPLE_RATE),
          duration: toDuration(c.durationSamples / SAMPLE_RATE),
          events:   evRows.join("  |  ") || "—",
        };
      }));
    }

    console.groupEnd();
  }
  console.groupEnd();

  // --- Markers ---
  if (markers.length) {
    console.group(`Markers (${markers.length})`);
    console.table(markers.map(m => {
      const chord = (typeof chords !== "undefined") && chords.find(c => c.id === m.chordId);
      return {
        time:  toBarBeat(m.time),
        note:  m.note || "—",
        chord: chord?.name ?? "—",
      };
    }));
    console.groupEnd();
  }

  // --- Chords ---
  if (typeof chords !== "undefined" && chords.length) {
    console.group(`Chords (${chords.length})`);
    console.table(chords.map(c => ({
      name:     c.name,
      baseFret: c.baseFret,
    })));
    console.groupEnd();
  }

  console.groupEnd();
}
document.getElementById("debug-toggle-display").onclick = () => document.body.classList.toggle("debug");



timelineArea.addEventListener("scroll", () => {
  renderTimelineLayer();
});

// ------------ Scrub State

let isScrubbing = false;
let scrubPrevTransportState = null; // "PLAY" | "IDLE

timelineArea.addEventListener("mousedown", (e) => {
  if (recording) return; // scrubbing disabled while recording

  // Ignore clicks on markers (they already stopped propagation)
  recordInteraction("scrub");
  isScrubbing = true;

  scrubPrevTransportState = getTransportState();

  // Temporarily stop transport
  if (scrubPrevTransportState !== "IDLE") {
    applyTransportChange({ play: false, record: false });
  }

  scrubToMouseEvent(e);
});

document.addEventListener("mousemove", (e) => {
  if (_markerDragState) {
    const x = e.clientX - timelineInner.getBoundingClientRect().left;
    let newTime = Math.max(0, pixelsToSeconds(x));
    if (rulerMode === "bars") newTime = snapToBeat(newTime);
    const m = markers.find(m => m.id === _markerDragState.markerId);
    if (m) {
      m.time = newTime;
      markers.sort((a, b) => a.time - b.time);
      renderMarkers();
      renderBottomPanel();
    }
    return;
  }
  if (!isScrubbing) return;

  scrubToMouseEvent(e);
});

document.addEventListener("mouseup", () => {
  if (_markerDragState) {
    _markerDragState = null;
    markDirty();
    return;
  }
  if (!isScrubbing) return;

  isScrubbing = false;

  if (scrubPrevTransportState === "PLAY") {
    applyTransportChange({ play: true, record: false });
  }

  scrubPrevTransportState = null;
});

const tempoEl = document.getElementById("tempoDisplay");

tempoEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    tempoEl.blur();
  }
});

tempoEl.addEventListener("blur", () => {
  recordInteraction("tempo");
  const raw = tempoEl.textContent.replace(/\D/g, "");
  const next = parseInt(raw, 10);

  if (!Number.isNaN(next)) {
    tempoBPM = Math.min(300, Math.max(30, next));
    markDirty();
  }

  bpm = tempoBPM;
  tanpuraSetBPM(bpm);
  renderTempo();
  syncTimelineMinWidth();
  renderTimelineLayer();
});

// ----- Time Signature Dropdown
const timeSigBtn = document.getElementById("timeSigBtn");
const timeSigMenu = document.getElementById("timeSigMenu");
const timeSigWrapper = timeSigBtn.parentElement;

timeSigBtn.addEventListener("click", (e) => {
  e.stopPropagation();

  const open = timeSigWrapper.classList.toggle("open");
  timeSigBtn.setAttribute("aria-expanded", String(open));
});

timeSigMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const beats = Number(btn.dataset.beats);
  const noteValue = Number(btn.dataset.note);

  setTimeSignature(beats, noteValue);
  markDirty();
  timeSigWrapper.classList.remove("open");
  timeSigBtn.setAttribute("aria-expanded", "false");
});

document.addEventListener("click", () => {
  timeSigWrapper.classList.remove("open");
  timeSigBtn.setAttribute("aria-expanded", "false");
});

const timelineRuler = document.getElementById("timeline-ruler");

// ---- Marker Handlers
timelineRuler.addEventListener("click", (e) => {
  const x = e.clientX - timelineInner.getBoundingClientRect().left;
  const time = rulerMode === "bars" ? snapToBeat(pixelsToSeconds(x)) : pixelsToSeconds(x);

  const nearby = findNearbyMarker(time);
  if (nearby) {
    selectedMarkerId = nearby.id;
    renderMarkers();
    renderMarkerTransport();
    renderBottomPanel();
    return;
  }

  const marker = { id: crypto.randomUUID(), time, note: "", chordId: null };
  markers.push(marker);
  markers.sort((a, b) => a.time - b.time);
  selectedMarkerId = marker.id;
  renderMarkers();
  renderMarkerTransport();
  renderBottomPanel();
});

// ----- Marker Deletion
markerDeleteBtn.addEventListener("click", () => {
  const idx = getSelectedMarkerIndex();
  if (idx === -1) return;
  if (markers[idx].id === ORIGIN_MARKER_ID) return;

  const deletedTime = formatTime(markers[idx].time);
  const deletedNote = markers[idx].note ?? "";
  markers.splice(idx, 1);
  markDirty();
  announce(`Marker at ${deletedTime} deleted`);

  // Append deleted marker's notes to the previous marker
  if (idx > 0 && deletedNote) {
    const prev = markers[idx - 1];
    prev.note = prev.note ? `${prev.note}\n\n${deletedNote}` : deletedNote;
  }

  // Select the marker to the left, if any
  selectedMarkerId = idx > 0 ? markers[idx - 1].id : null;

  renderMarkers();
  renderMarkerTransport();
  renderBottomPanel();
});

markerAddBtn.addEventListener("click", () => {
  recordInteraction("marker");
  const time = currentTimeSeconds;

  const nearby = findNearbyMarker(time);
  if (nearby) {
    selectedMarkerId = nearby.id;
    renderMarkers();
    renderMarkerTransport();
    renderBottomPanel();
    return;
  }

  const marker = { id: crypto.randomUUID(), time, note: "", chordId: null };
  markers.push(marker);
  markers.sort((a, b) => a.time - b.time);
  selectedMarkerId = marker.id;
  markDirty();
  renderMarkers();
  renderMarkerTransport();
  renderBottomPanel();
  announce(`Marker added at ${formatTime(time)}`);
});

// ----- Marker Dropdown
let _markerDropdown = null;

function closeMarkerDropdown() {
  if (!_markerDropdown) return;
  _markerDropdown.remove();
  _markerDropdown = null;
}

function showMarkerDropdown(anchorEl) {
  closeMarkerDropdown();

  const selectedIdx = getSelectedMarkerIndex();

  // Build sorted list: all markers + playhead position
  const entries = [
    ...markers.map((m, i) => ({ type: "marker", time: m.time, index: i })),
    { type: "playhead", time: currentTimeSeconds },
  ].sort((a, b) => a.time - b.time);

  const menu = document.createElement("div");
  menu.id = "marker-dropdown";

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "marker-dropdown-item";

    if (entry.type === "playhead") {
      item.classList.add("marker-dropdown-playhead");
      const label = document.createElement("span");
      label.className = "mdd-label";
      label.textContent = "<playhead>";
      const time = document.createElement("span");
      time.className = "mdd-time";
      time.textContent = formatTime(entry.time);
      item.append(label, time);
    } else {
      const isSelected = entry.index === selectedIdx;
      if (isSelected) item.classList.add("marker-dropdown-selected");

      const dot = document.createElement("span");
      dot.className = "mdd-dot";
      dot.textContent = isSelected ? "●" : "";

      const time = document.createElement("span");
      time.className = "mdd-time";
      time.textContent = formatTime(entry.time);

      item.append(dot, time);
      item.addEventListener("click", () => {
        selectMarkerByIndex(entry.index);
        closeMarkerDropdown();
      });
    }

    menu.appendChild(item);
  }

  const rect = anchorEl.getBoundingClientRect();
  menu.style.top  = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  document.body.appendChild(menu);
  _markerDropdown = menu;

  // Close on next outside click
  setTimeout(() => {
    document.addEventListener("click", closeMarkerDropdown, { once: true });
  }, 0);
}

document.getElementById("marker-time").addEventListener("click", (e) => {
  if (recording) return;
  if (markers.length === 0) return;
  showMarkerDropdown(e.currentTarget);
  e.stopPropagation();
});

// Sync scrollTop from timeline → controls
// Add this once, after you define timelineArea and controlsCol:
timelineArea.addEventListener("scroll", () => {
  controlsScrollCol.scrollTop = timelineArea.scrollTop;

  // debug output
  if (document.body.classList.contains("debug")) {
    controlsScrollCol.dataset.scroll = controlsScrollCol.scrollTop;
    timelineArea.dataset.scroll = timelineArea.scrollTop;
  }
});

// add this js once
controlsScrollCol.addEventListener(
  "wheel",
  (e) => {
    timelineArea.scrollTop += e.deltaY;
    e.preventDefault();
  },
  { passive: false },
);

document.addEventListener("dragover", (e) => {
  if (!dragState.track) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  const rows = Array.from(controlsScrollCol.children);
  let insertBefore = null;
  let indicatorY = null;

  for (const row of rows) {
    if (row === dragState.track.controlRow) continue;
    const rect = row.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      insertBefore = findTrackByControlRow(row);
      indicatorY = rect.top;
      break;
    }
    indicatorY = rect.bottom;
  }

  if (indicatorY === null) { dropIndicator.classList.remove("visible"); return; }
  dragState.insertBefore = insertBefore;
  dropIndicator.style.top = `${indicatorY}px`;
  dropIndicator.classList.add("visible");
});

document.addEventListener("drop", (e) => {
  if (!dragState.track) return;
  e.preventDefault();
  dropIndicator.classList.remove("visible");
  reorderTrack(dragState.track, dragState.insertBefore);
  dragState.track = null;
  dragState.insertBefore = null;
});

const transportToggles = document.querySelectorAll(
  "#transport-scenes .transport-scene",
);

function updateSceneMask() {
  const activeBtn = document.querySelector("#transport-scenes .transport-scene.active");
  const controlRows = Array.from(controlsScrollCol.children);
  const timelineRows = Array.from(timelineCol.children);

  controlRows.forEach((controlRow, i) => {
    const timelineRow = timelineRows[i];

    if (!activeBtn) {
      controlRow.classList.remove("not-in-scene");
      timelineRow?.classList.remove("not-in-scene");
      return;
    }

    const sceneLetter = activeBtn.textContent.trim();
    const trackHasScene = Array.from(controlRow.querySelectorAll(".track-scene.active"))
      .some((btn) => btn.textContent.trim() === sceneLetter);

    controlRow.classList.toggle("not-in-scene", !trackHasScene);
    timelineRow?.classList.toggle("not-in-scene", !trackHasScene);
  });
}

function updateSoloMask() {
  const activeSolo = document.querySelector(".solo-btn.active");
  const controlRows = Array.from(controlsScrollCol.children);
  const timelineRows = Array.from(timelineCol.children);

  controlRows.forEach((controlRow, i) => {
    const timelineRow = timelineRows[i];

    if (!activeSolo) {
      controlRow.classList.remove("not-in-solo");
      timelineRow?.classList.remove("not-in-solo");
      return;
    }

    const isSoloed = controlRow.contains(activeSolo);
    controlRow.classList.toggle("not-in-solo", !isSoloed);
    timelineRow?.classList.toggle("not-in-solo", !isSoloed);
  });
}

// linked toggle behavior
transportToggles.forEach((btn) => {
  btn.addEventListener("click", () => {
    const wasActive = btn.classList.contains("active");
    transportToggles.forEach((b) => b.classList.remove("active"));
    if (!wasActive) btn.classList.add("active");
    updateSceneMask();
    syncTrackMutes();
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll("#transport-scenes .transport-scene.active")
      .forEach((btn) => btn.classList.remove("active"));
    updateSceneMask();
    syncTrackMutes();
  }
});


const zoomSlider = document.getElementById("zoom-slider");

zoomSlider.oninput = () => {
  recordInteraction("zoom");
  // ----- Preserve Center Time
  const centerTime = timelineArea.scrollLeft / (BASE_PPS * zoom);

  // ----- Update Zoom
  zoomIndex = parseInt(zoomSlider.value, 10);
  zoom = zoomLevels[zoomIndex];

  // ----- Re-render Timeline
  rerenderWaveforms();
  syncTimelineOverlay();
  syncTimelineMinWidth();
  renderTimelineLayer();
  renderCompletedRecordRanges();

  // ----- Restore Center Scroll
  timelineArea.scrollLeft = centerTime * BASE_PPS * zoom;

  // ----- Re-project Playhead if Transport is Idle
  if (getTransportState() === "IDLE") {
    const px = secondsToPixels(currentTimeSeconds);
    setPlayheadPositionPx(px);
  }
  ensurePlayheadInViewCentered();
};

returnToBeginningBtn.onclick = () => {
  returnToBeginning();
  returnToBeginningBtn.classList.add("pressed");
  setTimeout(() => returnToBeginningBtn.classList.remove("pressed"), 180);
};

playBtn.onclick = () => {
  recordInteraction("transport");
  applyTransportChange({ play: !playing, record: playing ? false : recording });
};

recordBtn.onclick = async () => {
  recordInteraction("transport");
  if (!recording && tracks.some(t => t.type === 'audio' && t.armed)) {
    try {
      await audioEngineEnsureMicStream();
    } catch {
      alert("Microphone access denied — cannot record.");
      return;
    }
  }
  applyTransportChange({ play: playing, record: !recording });
};


// ----- Clip Selection Handlers
const _clipPopup = document.getElementById("clip-popup");
let _clipPopupClipId = null;

function showClipPopup(clipId, x, y) {
  _clipPopupClipId = clipId;
  const multi = selectedClipIds.size > 1;
  document.getElementById("clip-popup-loop-btn").hidden = multi || !audioEngineHasBuffer(clipId);
  document.getElementById("clip-popup-info-btn").hidden = multi;
  document.getElementById("clip-popup-duplicate-btn").hidden = multi;
  document.getElementById("clip-popup-normalize-btn").hidden = multi || !audioEngineHasBuffer(clipId);
  _clipPopup.style.left = `${Math.min(x + 8, window.innerWidth  - 130)}px`;
  _clipPopup.style.top  = `${Math.min(y + 8, window.innerHeight -  60)}px`;
  _clipPopup.hidden = false;
}

function hideClipPopup() {
  _clipPopup.hidden = true;
  _clipPopupClipId  = null;
}

timelineArea.addEventListener("click", (e) => {
  const waveform = e.target.closest(".waveform");
  if (waveform) {
    if (_audioDragJustCompleted) { _audioDragJustCompleted = false; return; }
    const clipId = waveform.dataset.clipId;
    if (e.metaKey || e.ctrlKey) {
      toggleClipSelection(clipId);
      hideClipPopup();
    } else if (selectedClipIds.has(clipId)) {
      // Clip already in selection — open popup without replacing selection
      showClipPopup(clipId, e.clientX, e.clientY);
    } else {
      selectClip(clipId);
      showClipPopup(clipId, e.clientX, e.clientY);
    }
  } else {
    deselectClip();
    hideClipPopup();
  }
});

document.addEventListener("click", (e) => {
  if (!_clipPopup.hidden && !_clipPopup.contains(e.target) && !e.target.closest(".waveform")) {
    hideClipPopup();
  }
});

document.getElementById("clip-popup-loop-btn").addEventListener("click", () => {
  if (!_clipPopupClipId) return;
  const track = findTrackByClipId(_clipPopupClipId);
  const clip  = track?.clips.find(c => c.id === _clipPopupClipId);
  if (track && clip) showLoopEditor(track, clip);
  hideClipPopup();
});

document.getElementById("clip-popup-info-btn").addEventListener("click", () => {
  if (!_clipPopupClipId) return;
  const track = findTrackByClipId(_clipPopupClipId);
  if (track) {
    const clip = track.clips.find(c => c.id === _clipPopupClipId);
    if (clip) showClipInfo(clip, track);
  }
  hideClipPopup();
});

let _duplicateDialogClipId = null;

document.getElementById("clip-popup-normalize-btn").addEventListener("click", () => {
  if (!_clipPopupClipId) return;
  const clipId = _clipPopupClipId;
  audioEngineNormalizeClip(clipId);
  updateClipWaveform(clipId, audioEngineGetBuffer(clipId));
  hideClipPopup();
});

document.getElementById("clip-popup-duplicate-btn").addEventListener("click", () => {
  if (!_clipPopupClipId) return;
  _duplicateDialogClipId = _clipPopupClipId;
  hideClipPopup();
  const input = document.getElementById("duplicate-dialog-input");
  input.value = 1;
  document.getElementById("duplicate-dialog").hidden = false;
  input.focus();
  input.select();
});

function _executeDuplicate() {
  const dialog = document.getElementById("duplicate-dialog");
  const count  = Math.max(1, Math.min(99, parseInt(document.getElementById("duplicate-dialog-input").value) || 1));
  dialog.hidden = true;

  const clipId = _duplicateDialogClipId;
  if (!clipId) return;
  const track = findTrackByClipId(clipId);
  if (!track) return;
  const srcClip = track.clips.find(c => c.id === clipId);
  if (!srcClip) return;

  const audioBuffer = audioEngineHasBuffer(clipId) ? audioEngineGetBuffer(clipId) : null;

  let tailSample = srcClip.startSample + srcClip.durationSamples;
  for (let i = 0; i < count; i++) {
    const startSeconds    = tailSample / SAMPLE_RATE;
    const durationSeconds = srcClip.durationSamples / SAMPLE_RATE;
    addClipToTrack(track.timelineRow, startSeconds, durationSeconds);
    const newClip = track.clips[track.clips.length - 1];
    newClip.loopStartSamples = srcClip.loopStartSamples;
    newClip.loopEndSamples   = srcClip.loopEndSamples;
    if (audioBuffer) {
      audioEngineStoreBuffer(newClip.id, audioBuffer);
      updateClipWaveform(newClip.id, audioBuffer);
    }
    tailSample += srcClip.durationSamples;
  }
  markDirty();
}

document.getElementById("duplicate-dialog-ok").addEventListener("click", _executeDuplicate);

document.getElementById("duplicate-dialog-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter")  { e.preventDefault(); _executeDuplicate(); }
  if (e.key === "Escape") { e.preventDefault(); document.getElementById("duplicate-dialog").hidden = true; }
});

document.getElementById("duplicate-dialog-cancel").addEventListener("click", () => {
  document.getElementById("duplicate-dialog").hidden = true;
});

document.getElementById("clip-popup-delete-btn").addEventListener("click", () => {
  deleteSelectedClip();
  hideClipPopup();
});

// ----- Track Edit Dialog -----

let _trackEditTarget = null; // { track, trackController, ro }

function openTrackEditDialog(track, trackController, ro) {
  _trackEditTarget = { track, trackController, ro };
  document.getElementById("track-edit-dialog-title").textContent = track.name;
  document.getElementById("track-edit-dialog").hidden = false;
}

function closeTrackEditDialog() {
  document.getElementById("track-edit-dialog").hidden = true;
  _trackEditTarget = null;
}

function _executeDeleteTrack() {
  if (!_trackEditTarget) return;
  const { track, trackController, ro } = _trackEditTarget;
  const trackIdx = tracks.indexOf(track);
  if (trackIdx === -1) return;
  const trackName = track.name;
  if (selectedTrack === track) selectedTrack = null;
  tracks.splice(trackIdx, 1);
  trackController.abort();
  ro.disconnect();
  track.controlRow.remove();
  track.timelineRow.remove();
  syncTimelineMinWidth();
  syncTimelineOverlay();
  syncRecordBtnEnabled();
  markDirty();
  announce(`${trackName} deleted`);
  closeTrackEditDialog();
}

function _executeDuplicateTrack() {
  if (!_trackEditTarget) return;
  const { track } = _trackEditTarget;
  closeTrackEditDialog();

  let newName = `${track.name} copy`;
  let n = 2;
  while (!isNameUnique(newName)) newName = `${track.name} copy ${n++}`;

  const newTrack = createTrack(newName);

  // Insert into tracks array right after source
  const idx = tracks.indexOf(track);
  tracks.splice(idx + 1, 0, newTrack);

  // Reposition DOM rows (createTrack appended to end)
  track.controlRow.after(newTrack.controlRow);
  track.timelineRow.after(newTrack.timelineRow);

  // Apply source settings
  newTrack.gain    = track.gain;
  newTrack.pan     = track.pan;
  newTrack.opacity = track.opacity;
  newTrack.scenes  = [...track.scenes];

  newTrack.controlRow.querySelector("gain-slider").value = track.gain;
  newTrack.controlRow.querySelector("pan-slider").value  = track.pan;
  const opSlider = newTrack.controlRow.querySelector(".row-opacity-slider");
  opSlider.value = track.opacity;
  newTrack.timelineRow.style.setProperty('--row-opacity', track.opacity / 100);

  newTrack.controlRow.querySelectorAll(".track-scene").forEach(btn => {
    if (track.scenes.includes(btn.textContent.trim())) {
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
    }
  });

  // Copy clips
  for (const srcClip of track.clips) {
    const startSeconds    = srcClip.startSample / SAMPLE_RATE;
    const durationSeconds = srcClip.durationSamples / SAMPLE_RATE;
    addClipToTrack(newTrack.timelineRow, startSeconds, durationSeconds);
    const newClip = newTrack.clips[newTrack.clips.length - 1];
    newClip.loopStartSamples = srcClip.loopStartSamples;
    newClip.loopEndSamples   = srcClip.loopEndSamples;
    if (audioEngineHasBuffer(srcClip.id)) {
      const buf = audioEngineGetBuffer(srcClip.id);
      audioEngineStoreBuffer(newClip.id, buf);
      updateClipWaveform(newClip.id, buf);
    }
  }

  syncTimelineMinWidth();
  syncTimelineOverlay();
  updateSceneMask();
  updateSoloMask();
  markDirty();
  announce(`${track.name} duplicated`);
}

document.getElementById("track-edit-close-btn").addEventListener("click", closeTrackEditDialog);
document.getElementById("track-edit-delete-btn").addEventListener("click", _executeDeleteTrack);
document.getElementById("track-edit-duplicate-btn").addEventListener("click", _executeDuplicateTrack);
document.getElementById("add-midi-track-btn").addEventListener("click", addMidiTrack);
document.getElementById("add-audio-track-btn").addEventListener("click", addAudioTrack);
document.getElementById("track-edit-dialog").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeTrackEditDialog();
});

// ----- Clip Sync Dialog -----

// Map<clipId, originalStartSample> for all selected clips being synced
let _syncDialogOriginalStartSamples = null;

document.getElementById("clip-popup-sync-btn").addEventListener("click", () => {
  if (!_clipPopupClipId) return;
  const track = findTrackByClipId(_clipPopupClipId);
  const clip  = track?.clips.find(c => c.id === _clipPopupClipId);
  if (!clip) return;

  _syncDialogOriginalStartSamples = new Map();
  selectedClipIds.forEach(clipId => {
    const t = findTrackByClipId(clipId);
    const c = t?.clips.find(cl => cl.id === clipId);
    if (c) _syncDialogOriginalStartSamples.set(clipId, c.startSample);
  });
  if (!_syncDialogOriginalStartSamples.has(_clipPopupClipId)) {
    _syncDialogOriginalStartSamples.set(_clipPopupClipId, clip.startSample);
  }

  document.getElementById("sync-dialog-slider").value = 0;
  document.getElementById("sync-dialog-number").value = 0;
  const count = _syncDialogOriginalStartSamples.size;
  document.getElementById("sync-dialog-title").textContent = count > 1
    ? `Clip Sync — ${count} clips`
    : `Clip Sync — ${track.name}`;
  document.getElementById("sync-dialog").hidden = false;
  hideClipPopup();
});

document.getElementById("sync-dialog-slider").addEventListener("input", (e) => {
  document.getElementById("sync-dialog-number").value = e.target.value;
  if (!_syncDialogOriginalStartSamples) return;
  const deltaMs = parseInt(e.target.value) || 0;
  _syncDialogOriginalStartSamples.forEach((origStart, clipId) => {
    const waveform = document.querySelector(`.waveform[data-clip-id="${clipId}"]`);
    if (waveform) waveform.style.left = `${secondsToPixels(origStart / SAMPLE_RATE + deltaMs / 1000)}px`;
  });
});

document.getElementById("sync-dialog-number").addEventListener("input", (e) => {
  const clamped = Math.max(-500, Math.min(500, parseInt(e.target.value) || 0));
  document.getElementById("sync-dialog-slider").value = clamped;
});

document.getElementById("sync-dialog-reset").addEventListener("click", () => {
  document.getElementById("sync-dialog-slider").value = 0;
  document.getElementById("sync-dialog-number").value = 0;
  if (!_syncDialogOriginalStartSamples) return;
  _syncDialogOriginalStartSamples.forEach((origStart, clipId) => {
    const waveform = document.querySelector(`.waveform[data-clip-id="${clipId}"]`);
    if (waveform) waveform.style.left = `${secondsToPixels(origStart / SAMPLE_RATE)}px`;
  });
});

function _applySyncDialog() {
  document.getElementById("sync-dialog").hidden = true;
  if (!_syncDialogOriginalStartSamples) return;
  const deltaMs = Math.max(-500, Math.min(500,
    parseInt(document.getElementById("sync-dialog-number").value) || 0));
  _syncDialogOriginalStartSamples.forEach((origStart, clipId) => {
    const t = findTrackByClipId(clipId);
    const c = t?.clips.find(cl => cl.id === clipId);
    if (!c) return;
    c.startSample = origStart + Math.round(deltaMs * SAMPLE_RATE / 1000);
    const newStartSec = c.startSample / SAMPLE_RATE;
    const waveform = document.querySelector(`.waveform[data-clip-id="${clipId}"]`);
    if (waveform) {
      waveform.dataset.startSeconds = newStartSec;
      waveform.style.left = `${secondsToPixels(newStartSec)}px`;
    }
  });
  _syncDialogOriginalStartSamples = null;
  markDirty();
  if (playing) { audioEngineStop(); onTransportStart(); }
}

document.getElementById("sync-dialog-ok").addEventListener("click", _applySyncDialog);

document.getElementById("sync-dialog-cancel").addEventListener("click", () => {
  document.getElementById("sync-dialog").hidden = true;
  if (_syncDialogOriginalStartSamples) {
    _syncDialogOriginalStartSamples.forEach((origStart, clipId) => {
      const waveform = document.querySelector(`.waveform[data-clip-id="${clipId}"]`);
      if (waveform) waveform.style.left = `${secondsToPixels(origStart / SAMPLE_RATE)}px`;
    });
  }
  _syncDialogOriginalStartSamples = null;
});

document.getElementById("sync-dialog-number").addEventListener("keydown", (e) => {
  if (e.key === "Enter")  { e.preventDefault(); _applySyncDialog(); }
  if (e.key === "Escape") { e.preventDefault(); document.getElementById("sync-dialog").hidden = true; }
});

document.addEventListener("keydown", (e) => {
  const editable = document.activeElement?.tagName === "INPUT"
    || document.activeElement?.tagName === "TEXTAREA"
    || document.activeElement?.isContentEditable;

  // Laptop keyboard → MIDI note input (plays whenever a MIDI track is armed; records only when recording)
  if (!editable) {
    const pitch = KEY_NOTE_MAP[e.key];
    const armedMidiTrack = tracks.find(t => t.type === 'midi' && t.armed);
    if (pitch !== undefined && armedMidiTrack && !_activeKeys.has(e.key)) {
      e.preventDefault();
      _activeKeys.add(e.key);
      const ctx = getAudioContext();
      const freq = _midiToFreq(pitch);
      const now = ctx.currentTime;
      const nodes = cpScheduleNoteAt(freq, ctx, now, 10, 100, armedMidiTrack.instrument ?? "pluck");
      const startSample = recording ? Math.round(getPlayheadTime() * SAMPLE_RATE) : null;
      _liveKeyNotes.set(e.key, { nodes, pitch, startSample });
      return;
    }
  }

  if (e.key === "Escape") {
    deselectClip(); hideClipPopup();
    document.getElementById("shortcut-help-overlay").hidden = true;
    if (!document.getElementById("sync-dialog").hidden) {
      if (_syncDialogOriginalStartSamples) {
        _syncDialogOriginalStartSamples.forEach((origStart, clipId) => {
          const waveform = document.querySelector(`.waveform[data-clip-id="${clipId}"]`);
          if (waveform) waveform.style.left = `${secondsToPixels(origStart / SAMPLE_RATE)}px`;
        });
      }
      _syncDialogOriginalStartSamples = null;
      document.getElementById("sync-dialog").hidden = true;
    }
  }

  if ((e.key === "Delete" || e.key === "Backspace") && !editable) deleteSelectedClip();

  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !editable && selectedClipIds.size > 0) {
    e.preventDefault();
    const deltaSamples = e.shiftKey
      ? Math.round(0.1 * SAMPLE_RATE)
      : Math.round(0.01 * SAMPLE_RATE);
    const sign = e.key === "ArrowLeft" ? -1 : 1;
    selectedClipIds.forEach(clipId => {
      const track = findTrackByClipId(clipId);
      const clip  = track?.clips.find(c => c.id === clipId);
      if (!clip) return;
      clip.startSample = clip.startSample + sign * deltaSamples;
      const newStartSec = clip.startSample / SAMPLE_RATE;
      const waveform = document.querySelector(`.waveform[data-clip-id="${clipId}"]`);
      if (waveform) {
        waveform.dataset.startSeconds = newStartSec;
        waveform.style.left = `${secondsToPixels(newStartSec)}px`;
      }
    });
    markDirty();
  }

  if (e.key === " " && !editable) {
    e.preventDefault();
    applyTransportChange({ play: !playing, record: playing ? false : recording });
  }

  if (e.key === "r" && !editable) recordBtn.click();

  if ((e.key === "." || e.key === "Home") && !editable) returnToBeginning();

  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    saveProject();
  }

  if (e.key === "?" && !editable) {
    const overlay = document.getElementById("shortcut-help-overlay");
    overlay.hidden = !overlay.hidden;
    if (!overlay.hidden) document.getElementById("shortcut-help-close").focus();
  }

  if (e.key === "c" && !editable) {
    viewState.chordDiagrams = !viewState.chordDiagrams;
    applyViewState();
  }
});

document.addEventListener("keyup", (e) => {
  if (!_activeKeys.has(e.key)) return;
  _activeKeys.delete(e.key);
  const live = _liveKeyNotes.get(e.key);
  if (!live) return;
  _liveKeyNotes.delete(e.key);
  live.nodes.forEach(n => { try { n.stop(); } catch (_) {} });
  if (live.startSample !== null) {
    const endSample = Math.round(getPlayheadTime() * SAMPLE_RATE);
    _pendingMidiNotes.push({
      pitch:           live.pitch,
      startSample:     live.startSample,
      durationSamples: Math.max(Math.round(0.05 * SAMPLE_RATE), endSample - live.startSample),
      velocity:        100,
    });
  }
});

document.getElementById("shortcut-help-close").addEventListener("click", () => {
  document.getElementById("shortcut-help-overlay").hidden = true;
});

// ----- Scrub Handlers
timelineArea.addEventListener("mousedown", (e) => {
  if (recording) return;

  recordInteraction("scrub");
  isScrubbing = true;
  scrubPrevTransportState = getTransportState();

  if (scrubPrevTransportState !== "IDLE") {
    applyTransportChange({ play: false, record: false });
  }

  scrubToMouseEvent(e);
});

document.addEventListener("mousemove", (e) => {
  if (!isScrubbing) return;
  scrubToMouseEvent(e);
});

document.addEventListener("mouseup", () => {
  if (!isScrubbing) return;

  isScrubbing = false;

  if (scrubPrevTransportState === "PLAY") {
    applyTransportChange({ play: true, record: false });
  }

  scrubPrevTransportState = null;
});

// ============================================================
// Loops -----
// ============================================================

// ---- Track Meter Animation

const METER_SEGS   = 12;
const METER_GREEN  = 7;   // segments 1-7 (nth-child) are green
const METER_YELLOW = 9;   // segments 8-9 are yellow; 10-12 are red

let _meterRafId   = null;
let _meterPlaying = false;

function startMeterAnimation() {
  _meterPlaying = true;
  if (_meterRafId) return;
  _meterRafId = requestAnimationFrame(_meterTick);
}

function stopMeterAnimation() {
  _meterPlaying = false;
  // Leave RAF running so meters decay to 0 naturally
}

function _rmsToLevel(rms) {
  if (rms < 1e-6) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

function _meterTick() {
  let anyActive = false;

  for (const track of tracks) {
    if (!track.meterEl) continue;

    if (_meterPlaying) {
      const { L, R } = audioEngineGetTrackLevel(track.id);
      track.meterTargetL = _rmsToLevel(L);
      track.meterTargetR = _rmsToLevel(R);

      // Fast attack, slower release
      const aL = track.meterTargetL > track.meterL ? 0.45 : 0.07;
      const aR = track.meterTargetR > track.meterR ? 0.45 : 0.07;
      track.meterL += (track.meterTargetL - track.meterL) * aL;
      track.meterR += (track.meterTargetR - track.meterR) * aR;
    } else {
      track.meterL      *= 0.88;
      track.meterR      *= 0.88;
      track.meterTargetL = 0;
      track.meterTargetR = 0;
    }

    // Peak hold — L
    if (track.meterL > track.meterPeakL) {
      track.meterPeakL       = track.meterL;
      track.meterPeakFramesL = 50;
    } else if (track.meterPeakFramesL > 0) {
      track.meterPeakFramesL--;
    } else {
      track.meterPeakL = Math.max(track.meterL, track.meterPeakL * 0.93);
    }

    // Peak hold — R
    if (track.meterR > track.meterPeakR) {
      track.meterPeakR       = track.meterR;
      track.meterPeakFramesR = 50;
    } else if (track.meterPeakFramesR > 0) {
      track.meterPeakFramesR--;
    } else {
      track.meterPeakR = Math.max(track.meterR, track.meterPeakR * 0.93);
    }

    _renderTrackMeter(track);

    if (track.meterL > 0.002 || track.meterR > 0.002 ||
        track.meterPeakL > 0.002 || track.meterPeakR > 0.002) anyActive = true;
  }

  _updateMasterMeter();

  if (_masterL > 0.002 || _masterR > 0.002 || _masterPeakL > 0.002 || _masterPeakR > 0.002 || _grLevel > 0.002) anyActive = true;

  if (_meterPlaying || anyActive) {
    _meterRafId = requestAnimationFrame(_meterTick);
  } else {
    _meterRafId = null;
  }
}

function _renderTrackMeter(track) {
  const channels = track.meterEl.querySelectorAll(".tm-ch");
  const levels = [track.meterL, track.meterR];
  const peaks  = [track.meterPeakL, track.meterPeakR];

  channels.forEach((ch, ci) => {
    const activeSegs = Math.round(levels[ci] * METER_SEGS);
    const peakIdx    = Math.round(peaks[ci] * (METER_SEGS - 1));
    ch.querySelectorAll(".tm-seg").forEach((seg, i) => {
      const lit    = i < activeSegs;
      const isPeak = !lit && i === peakIdx && peaks[ci] > 0.05;
      seg.classList.toggle("lit",  lit);
      seg.classList.toggle("peak", isPeak);
    });
  });
}

// ---- Master Meter

const MASTER_METER_SEGS = 20;
const GR_METER_SEGS = 12;
let _masterL = 0, _masterR = 0;
let _masterPeakL = 0, _masterPeakR = 0;
let _masterPeakFramesL = 0, _masterPeakFramesR = 0;
let _grLevel = 0;

function _updateMasterMeter() {
  const { L, R } = audioEngineGetMasterLevel();
  const rawL = _rmsToLevel(L);
  const rawR = _rmsToLevel(R);

  _masterL += (rawL - _masterL) * (rawL > _masterL ? 0.6 : 0.1);
  _masterR += (rawR - _masterR) * (rawR > _masterR ? 0.6 : 0.1);

  // Peak hold — L
  if (_masterL > _masterPeakL) { _masterPeakL = _masterL; _masterPeakFramesL = 50; }
  else if (_masterPeakFramesL > 0) { _masterPeakFramesL--; }
  else { _masterPeakL = Math.max(_masterL, _masterPeakL * 0.93); }

  // Peak hold — R
  if (_masterR > _masterPeakR) { _masterPeakR = _masterR; _masterPeakFramesR = 50; }
  else if (_masterPeakFramesR > 0) { _masterPeakFramesR--; }
  else { _masterPeakR = Math.max(_masterR, _masterPeakR * 0.93); }

  const rawGR = Math.min(1, Math.abs(audioEngineGetCompressorReduction()) / 20);
  _grLevel += (rawGR - _grLevel) * (rawGR > _grLevel ? 0.8 : 0.12);

  _renderMasterMeter();
  _renderGRMeter();
}

function _renderMasterMeter() {
  const bars   = [
    document.getElementById("master-meter-L"),
    document.getElementById("master-meter-R"),
  ];
  const levels = [_masterL, _masterR];
  const peaks  = [_masterPeakL, _masterPeakR];

  bars.forEach((bar, bi) => {
    if (!bar) return;
    const activeSegs = Math.round(levels[bi] * MASTER_METER_SEGS);
    const peakIdx    = Math.round(peaks[bi] * (MASTER_METER_SEGS - 1));
    bar.querySelectorAll(".mm-seg").forEach((seg, i) => {
      const lit    = i < activeSegs;
      const isPeak = !lit && i === peakIdx && peaks[bi] > 0.05;
      seg.classList.toggle("lit",  lit);
      seg.classList.toggle("peak", isPeak);
    });
  });
}

function _renderGRMeter() {
  const bar = document.getElementById("master-gr-meter");
  if (!bar) return;
  const activeSegs = Math.round(_grLevel * GR_METER_SEGS);
  bar.querySelectorAll(".gr-seg").forEach((seg, i) => {
    seg.classList.toggle("lit", i >= GR_METER_SEGS - activeSegs);
  });
}

//  Transport Transitions
function syncTrackMutes() {
  const activeScene    = document.querySelector("#transport-scenes .transport-scene.active")?.textContent.trim();
  const soloedControlRow = document.querySelector(".solo-btn.active")?.closest(".control-row");
  const soloedTrack    = soloedControlRow ? tracks.find(t => t.controlRow === soloedControlRow) : null;
  for (const track of tracks) {
    const audible  = soloedTrack ? track === soloedTrack
                                 : (!activeScene || track.scenes.includes(activeScene));
    audioEngineSetTrackGain(track.id, audible ? track.gain / 100 : 0);
  }
  if (playing) {
    midiEngineStop();
    midiEnginePlay(tracks, getPlayheadTime());
  }
}

function onTransportStart() {
  playbackStartX = getPlayheadX(); // ← THIS is the fix
  startTime = performance.now();
  if (videoEl) { videoEl.currentTime = getPlayheadTime(); videoEl.play().catch(() => {}); }
  requestAnimationFrame(updatePlayhead);
  audioEnginePlay(
    tracks.map(t => ({
      id: t.id,
      clips: t.clips.map(clip => ({ ...clip, gain: t.gain / 100, pan: t.pan / 100 })),
    })),
    getPlayheadTime()
  );
  syncTrackMutes();
  if (recording && recordingTrackRow) audioEngineStartRecording(); // record was armed before play — start now
  if (_tanpuraEnabled) {
    const cur = markers.find(m => m.id === selectedMarkerId);
    if (cur) _applyTanpuraMarker(cur);
  }
}

// -------- Update Playhead
function updatePlayhead() {
  if (!playing) return;
  const elapsed = (performance.now() - startTime) / 1000;
  const deltaX = elapsed * BASE_PPS * zoom;

  const x = playbackStartX + deltaX;

  playhead.style.transform = `translateX(${x}px)`;
  rulerPlayhead.style.transform = `translateX(${x}px)`;
  currentTimeSeconds = pixelsToSeconds(x);

  if (recording) {
    updateRecordRange();
  }

  // extend timeline if playhead is approaching the right edge
  ensureTimelineWidth(x);

  // scroll
  const right = timelineArea.scrollLeft + timelineArea.clientWidth;
  if (x > right - SCROLL_THRESHOLD) {
    timelineArea.scrollLeft = x - (timelineArea.clientWidth - SCROLL_THRESHOLD);
  }

  timer.textContent = formatTime(elapsed);
  renderTimelineLayer();
  renderMetronomeScan();

  // Select the last marker whose time falls within one beat of the playhead
  const _lookahead = currentTimeSeconds + secondsPerBeat() * viewState.markerLookaheadBeats;
  let _nextMarker = null;
  for (const m of markers) {
    if (m.time <= _lookahead) _nextMarker = m;
    else break;
  }
  if (_nextMarker && _nextMarker.id !== selectedMarkerId) {
    selectedMarkerId = _nextMarker.id;
    renderMarkers();
    renderMarkerTransport();
    renderBottomPanel();
    if (typeof cdHighlightChord === "function") {
      cdHighlightChord(_nextMarker.chordId);
    }
    if (_tanpuraEnabled) _applyTanpuraMarker(_nextMarker);
  }

  if (videoEl && ++_videoDriftFrame >= 90) {
    _videoDriftFrame = 0;
    if (Math.abs(videoEl.currentTime - currentTimeSeconds) > 0.15) {
      videoEl.currentTime = currentTimeSeconds;
    }
  }

  requestAnimationFrame(updatePlayhead);
}

let _inputMeterLevel = 0;

function updateMeter() {
  if (recording) {
    const target = _rmsToLevel(audioEngineGetInputLevel());
    const alpha = target > _inputMeterLevel ? 0.45 : 0.07;
    _inputMeterLevel += (target - _inputMeterLevel) * alpha;
  } else {
    _inputMeterLevel *= 0.88;
  }
  meterBar.style.width = `${_inputMeterLevel * 100}%`;
  requestAnimationFrame(updateMeter);
}

// ----- Track Name Tooltip
function showTrackNameTooltip(name, definition) {
  if (!definition) return;

  const existing = document.getElementById("track-name-tooltip");
  if (existing) {
    clearTimeout(existing._dismissTimer);
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = "track-name-tooltip";
  toast.innerHTML = `
    <div class="tnt-header">
      <span class="tnt-name">${name}</span>
      <button class="tnt-close" aria-label="Dismiss">&#x2715;</button>
    </div>
    <p class="tnt-definition">${definition}</p>
    <div class="tnt-progress"></div>
  `;
  document.body.appendChild(toast);

  function dismiss() {
    clearTimeout(toast._dismissTimer);
    toast.classList.add("tnt-exit");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }

  toast._dismissTimer = setTimeout(dismiss, 20_000);
  toast.querySelector(".tnt-close").addEventListener("click", dismiss);
}

// ============================================================
// Session Score -----
// ============================================================
//
// Passively accumulates signals during normal use to estimate
// whether the session was driven by a human. Score is 0–1.
// Never shown to the user. Queried at share time.
//
// Signals:
//   curvature     — mouse path non-linearity (bots move in straight lines)
//   timingVariance — irregularity between meaningful actions (bots are metronomic)
//   actionCount   — breadth of meaningful interactions
//   duration      — time elapsed since first interaction
//

const session = {
  firstInteractionAt: null,
  lastInteractionAt: null,
  interactionTimings: [],   // ms between consecutive meaningful actions
  actionCounts: {},         // { transport, scrub, zoom, tempo, marker, ... }
  mousePath: [],            // { x, y } samples during moves
  curvatureAccum: 0,        // accumulated deviation from straight-line motion
  curvatureSamples: 0,
};

function recordInteraction(type) {
  const now = performance.now();

  if (!session.firstInteractionAt) session.firstInteractionAt = now;

  if (session.lastInteractionAt !== null) {
    const gap = now - session.lastInteractionAt;
    // Ignore gaps over 30s (user walked away) — they don't help either side
    if (gap < 30_000) session.interactionTimings.push(gap);
  }

  session.lastInteractionAt = now;
  session.actionCounts[type] = (session.actionCounts[type] ?? 0) + 1;
}

function recordMouseSample(x, y) {
  const path = session.mousePath;
  path.push({ x, y });

  // Measure curvature: angle change between last three points
  if (path.length >= 3) {
    const a = path[path.length - 3];
    const b = path[path.length - 2];
    const c = path[path.length - 1];

    const ab = Math.atan2(b.y - a.y, b.x - a.x);
    const bc = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = Math.abs(bc - ab);
    if (delta > Math.PI) delta = 2 * Math.PI - delta; // wrap

    session.curvatureAccum += delta;
    session.curvatureSamples += 1;
  }

  // Keep path buffer small — only need recent samples for curvature
  if (path.length > 20) path.shift();
}

function scoreCurvature() {
  if (session.curvatureSamples < 5) return 0;
  // Average angle change per sample. Humans: ~0.2–0.8 rad. Bots: ~0.
  const avg = session.curvatureAccum / session.curvatureSamples;
  return Math.min(1, avg / 0.4);
}

function scoreTimingVariance() {
  const t = session.interactionTimings;
  if (t.length < 3) return 0;
  const mean = t.reduce((s, v) => s + v, 0) / t.length;
  const variance = t.reduce((s, v) => s + (v - mean) ** 2, 0) / t.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  // Humans: CV typically 0.5–2+. Bots: CV near 0.
  return Math.min(1, cv / 1.0);
}

function scoreActionCount() {
  const total = Object.values(session.actionCounts).reduce((s, v) => s + v, 0);
  const uniqueTypes = Object.keys(session.actionCounts).length;
  // Reward breadth (different action types) as well as volume
  return Math.min(1, (total / 10) * 0.5 + (uniqueTypes / 5) * 0.5);
}

function scoreDuration() {
  if (!session.firstInteractionAt) return 0;
  const elapsed = performance.now() - session.firstInteractionAt;
  // Full score at 2 minutes of interaction
  return Math.min(1, elapsed / (2 * 60 * 1000));
}

function getSessionScore() {
  const curvature     = scoreCurvature()      * 0.30;
  const timing        = scoreTimingVariance() * 0.25;
  const actions       = scoreActionCount()    * 0.25;
  const duration      = scoreDuration()       * 0.20;
  return curvature + timing + actions + duration;
}

// Passive mouse path collector (runs independently of scrub state)
document.addEventListener("mousemove", (e) => {
  recordMouseSample(e.clientX, e.clientY);
});

// ============================================================
// Bottom Panel -----
// ============================================================

document.getElementById("menu-new-project").addEventListener("click", () => {
  if (_dirty && !confirm("Start a new project? All unsaved work will be lost.")) return;
  sessionStorage.setItem("skipAutoOpen", "1");
  location.reload();
});

document.getElementById("menu-save-project").addEventListener("click", () => saveProject());
document.getElementById("menu-open-project").addEventListener("click", () => openProject());

document.getElementById("menu-import-wav").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".wav,audio/wav";
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files);
    if (!files.length) return;

    const firstName = files[0].name.replace(/\.wav$/i, "");
    let trackLabel = (files.length > 1 ? `${firstName} +${files.length - 1}` : firstName).slice(0, 30);

    if (!isNameUnique(trackLabel)) {
      const newName = await promptUniqueName(trackLabel, null);
      if (newName === null) return;
      trackLabel = newName;
    }

    const track = createTrack(trackLabel, { prepend: true });
    tracks.unshift(track);

    let startSeconds = 0;
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioEngineDecodeWav(arrayBuffer);
      addClipToTrack(track.timelineRow, startSeconds, audioBuffer.duration);
      const importedClip = track.clips[track.clips.length - 1];
      audioEngineStoreBuffer(importedClip.id, audioBuffer);
      updateClipWaveform(importedClip.id, audioBuffer);
      startSeconds += audioBuffer.duration;
    }

    syncTimelineOverlay();
    syncTimelineMinWidth();
    markDirty();
  };
  input.click();
});

// Event Handlers - MIDI Import/Export - Intent Layer -----
document.getElementById("menu-import-midi").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mid,.midi,audio/midi";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    let parsed;
    try { parsed = parseMidiFile(buf); } catch (err) { alert("Could not parse MIDI file: " + err.message); return; }
    const noteTracks = midiToNotes(parsed, SAMPLE_RATE);
    if (!noteTracks.length) { alert("No notes found in MIDI file."); return; }

    for (let i = 0; i < noteTracks.length; i++) {
      const notes = noteTracks[i];
      if (!notes.length) continue;
      const label = (file.name.replace(/\.midi?$/i, "") + (noteTracks.length > 1 ? ` (${i + 1})` : "")).slice(0, 30);
      const track = createTrack(label, { prepend: false });
      tracks.push(track);
      const maxEnd = Math.max(...notes.map(n => n.startSamples + n.durationSamples));
      const clip = {
        id:              crypto.randomUUID(),
        startSample:     0,
        durationSamples: maxEnd,
        events:          [],
        notes,
      };
      track.midiClips.push(clip);
      renderMidiClip(track, clip);
    }
    syncTimelineMinWidth();
    syncTimelineOverlay();
    updateSceneMask();
    updateSoloMask();
    markDirty();
  };
  input.click();
});

document.getElementById("menu-export-midi").addEventListener("click", () => {
  exportProjectAsMidi(tracks, tempoBPM, SAMPLE_RATE);
});

// Event Handlers - Video Backdrop - Intent Layer -----
document.getElementById("menu-load-video").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*";
  input.onchange = () => { if (input.files[0]) loadVideoFile(input.files[0]); };
  input.click();
});

document.getElementById("video-overlay-btn").addEventListener("click", () => {
  document.body.classList.toggle("video-overlay");
});

document.getElementById("video-phosphor-btn").addEventListener("click", () => {
  const on = document.body.classList.toggle("video-phosphor");
  document.getElementById("video-phosphor-btn").classList.toggle("active", on);
});


document.getElementById("video-remove-btn").addEventListener("click", removeVideo);

document.getElementById("video-opacity-slider").addEventListener("input", (e) => {
  document.getElementById("timeline-video").style.opacity = e.target.value / 100;
  markDirty();
});

const bottomPanel = document.getElementById("bottom-panel");
const bottomPanelHandle = document.getElementById("bottom-panel-handle");
const toggleBottomPanelBtn = document.getElementById("toggle-bottom-panel");

if (toggleBottomPanelBtn) {
  toggleBottomPanelBtn.addEventListener("click", () => {
    viewState.bottomPanel = !viewState.bottomPanel;
    applyViewState();
  });
}

// ----- View Toggles - Event Handlers -----
function makeViewToggle(menuId, stateKey) {
  const el = document.getElementById(menuId);
  if (!el) return;
  el.addEventListener("click", () => {
    viewState[stateKey] = !viewState[stateKey];
    applyViewState();
  });
}

makeViewToggle("toggle-scenes",          "scenes");
makeViewToggle("toggle-marker-transport","markerTransport");
makeViewToggle("toggle-tempo",           "tempo");
makeViewToggle("toggle-metronome",       "metronome");
makeViewToggle("toggle-zoom",            "zoom");
makeViewToggle("toggle-solo",            "solo");
makeViewToggle("toggle-master",          "master");
makeViewToggle("toggle-notes",           "notes");

// ----- View Settings Dialog - Event Handlers -----
const _viewSettingsOverlay = document.getElementById("view-settings-overlay");

const VS_PRESETS = {
  minimal:  { scenes: false, markerTransport: false, tempo: true,  metronome: false, zoom: false, solo: false, bottomPanel: true, master: true, effects: false, notes: false, chordDiagrams: false },
  simple:   { scenes: false, markerTransport: true,  tempo: true,  metronome: true,  zoom: true,  solo: false, bottomPanel: true, master: true, effects: false, notes: false, chordDiagrams: false },
  standard: { scenes: true,  markerTransport: true,  tempo: true,  metronome: true,  zoom: true,  solo: true,  bottomPanel: true,  master: true,  effects: false, notes: true,  chordDiagrams: false },
  compose:  { scenes: true,  markerTransport: true,  tempo: true,  metronome: true,  zoom: true,  solo: true,  bottomPanel: true,  master: true,  effects: true,  notes: true,  chordDiagrams: true  },
};

_viewSettingsOverlay.querySelectorAll(".vs-preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const preset = VS_PRESETS[btn.dataset.preset];
    if (!preset) return;
    Object.assign(viewState, preset);
    applyViewState();
    _viewSettingsOverlay.querySelectorAll("[data-view-key]").forEach(cb => {
      cb.checked = viewState[cb.dataset.viewKey];
    });
  });
});
let _viewStateSnapshot = null;
let _themeSnapshot = null;
let _rulerSnapshot = null;
let _notesFontSnapshot = null;

const _vsThemePanel   = document.getElementById("vs-theme-panel");
const _vsThemeTrigger = document.getElementById("vs-theme-trigger");

const themeRatings = JSON.parse(localStorage.getItem("themeRatings") || "{}");

function _syncThemeStars() {
  const theme   = document.body.getAttribute("data-theme") ?? "";
  const rating  = themeRatings[theme] ?? 0;
  document.querySelectorAll("#vs-theme-stars .vs-star").forEach(btn => {
    btn.classList.toggle("filled", Number(btn.dataset.star) <= rating);
  });
  _syncPanelStars();
}

function _syncPanelStars() {
  const labels = [..._vsThemePanel.querySelectorAll("label")];
  labels.forEach(lbl => {
    const radio  = lbl.querySelector("input[type='radio']");
    if (!radio) return;
    const rating = themeRatings[radio.value] ?? 0;
    let starsEl  = lbl.querySelector(".vs-panel-stars");
    if (!starsEl) {
      starsEl = document.createElement("span");
      starsEl.className = "vs-panel-stars";
      lbl.appendChild(starsEl);
    }
    starsEl.textContent = "★".repeat(rating);
  });
  labels.sort((a, b) => {
    const ra = themeRatings[a.querySelector("input")?.value] ?? 0;
    const rb = themeRatings[b.querySelector("input")?.value] ?? 0;
    return rb - ra;
  });
  labels.forEach(lbl => _vsThemePanel.appendChild(lbl));
}

function _syncThemeTrigger() {
  const checked = _viewSettingsOverlay.querySelector("[name='vs-theme']:checked");
  if (!checked) return;
  const lbl    = checked.closest("label");
  const swatch = lbl?.querySelector(".theme-swatch");
  const name   = lbl?.textContent.trim();
  if (swatch) document.getElementById("vs-theme-trigger-swatch").setAttribute("style", swatch.getAttribute("style"));
  if (name)   document.getElementById("vs-theme-trigger-name").textContent = name;
  _syncThemeStars();
}

document.getElementById("vs-theme-stars").addEventListener("click", (e) => {
  const btn = e.target.closest(".vs-star");
  if (!btn) return;
  const theme  = document.body.getAttribute("data-theme") ?? "";
  const val    = Number(btn.dataset.star);
  themeRatings[theme] = themeRatings[theme] === val ? 0 : val;
  localStorage.setItem("themeRatings", JSON.stringify(themeRatings));
  _syncThemeStars();
  markDirty();
});

_vsThemeTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!_vsThemePanel.hidden) { _vsThemePanel.hidden = true; return; }
  _vsThemePanel.style.top       = "50%";
  _vsThemePanel.style.left      = "50%";
  _vsThemePanel.style.transform = "translate(-50%, -50%)";
  _syncPanelStars();
  _vsThemePanel.hidden = false;
});

document.addEventListener("click", (e) => {
  if (!_vsThemePanel.hidden && !_vsThemeTrigger.contains(e.target)) {
    _vsThemePanel.hidden = true;
  }
});

document.getElementById("view-settings-open").addEventListener("click", () => {
  _viewStateSnapshot = { ...viewState };
  _themeSnapshot = document.body.getAttribute("data-theme");
  _rulerSnapshot = rulerMode;
  _notesFontSnapshot = document.body.getAttribute("data-notes-font");
  _viewSettingsOverlay.querySelectorAll("[data-view-key]").forEach(cb => {
    cb.checked = viewState[cb.dataset.viewKey];
  });
  _viewSettingsOverlay.querySelectorAll("[name='vs-theme']").forEach(r => {
    r.checked = r.value === _themeSnapshot;
  });
  _viewSettingsOverlay.querySelectorAll("[name='vs-ruler']").forEach(r => {
    r.checked = r.value === rulerMode;
  });
  document.getElementById("vs-notes-font-mono").checked = _notesFontSnapshot === "mono";
  document.getElementById("vs-marker-lookahead").value = viewState.markerLookaheadBeats;
  document.getElementById("vs-hue").value = viewState.hue;
  document.getElementById("vs-hue-val").textContent = viewState.hue + "°";
  document.getElementById("vs-saturation").value = viewState.saturation;
  document.getElementById("vs-saturation-val").textContent = viewState.saturation + "%";
  _vsThemePanel.hidden = true;
  _syncThemeTrigger();
  _viewSettingsOverlay.hidden = false;
});

_viewSettingsOverlay.addEventListener("change", e => {
  const cb = e.target.closest("[data-view-key]");
  if (cb) {
    viewState[cb.dataset.viewKey] = cb.checked;
    applyViewState();
    return;
  }
  if (e.target.name === "vs-theme") {
    setTheme(e.target.value);
    _syncThemeTrigger();
    _vsThemePanel.hidden = true;
    return;
  }
  if (e.target.name === "vs-ruler") { setRulerMode(e.target.value); return; }
  if (e.target.id === "vs-notes-font-mono") {
    document.body.setAttribute("data-notes-font", e.target.checked ? "mono" : "");
  }
  if (e.target.id === "vs-marker-lookahead") {
    viewState.markerLookaheadBeats = Math.max(0, parseFloat(e.target.value) || 0);
  }
  if (e.target.id === "vs-hue") {
    viewState.hue = parseInt(e.target.value);
    document.getElementById("vs-hue-val").textContent = viewState.hue + "°";
    applyViewState();
  }
  if (e.target.id === "vs-saturation") {
    viewState.saturation = parseInt(e.target.value);
    document.getElementById("vs-saturation-val").textContent = viewState.saturation + "%";
    applyViewState();
  }
});

document.getElementById("vs-hue").addEventListener("input", e => {
  viewState.hue = parseInt(e.target.value);
  document.getElementById("vs-hue-val").textContent = viewState.hue + "°";
  applyViewState();
});

document.getElementById("vs-hue").addEventListener("dblclick", () => {
  viewState.hue = 0;
  document.getElementById("vs-hue").value = 0;
  document.getElementById("vs-hue-val").textContent = "0°";
  applyViewState();
});

document.getElementById("vs-saturation").addEventListener("input", e => {
  viewState.saturation = parseInt(e.target.value);
  document.getElementById("vs-saturation-val").textContent = viewState.saturation + "%";
  applyViewState();
});

document.getElementById("vs-saturation").addEventListener("dblclick", () => {
  viewState.saturation = 100;
  document.getElementById("vs-saturation").value = 100;
  document.getElementById("vs-saturation-val").textContent = "100%";
  applyViewState();
});

document.getElementById("view-settings-cancel").addEventListener("click", () => {
  Object.assign(viewState, _viewStateSnapshot);
  applyViewState();
  setTheme(_themeSnapshot, { silent: true });
  setRulerMode(_rulerSnapshot);
  document.body.setAttribute("data-notes-font", _notesFontSnapshot || "");
  document.getElementById("vs-marker-lookahead").value = viewState.markerLookaheadBeats;
  document.getElementById("vs-hue").value = viewState.hue;
  document.getElementById("vs-hue-val").textContent = viewState.hue + "°";
  document.getElementById("vs-saturation").value = viewState.saturation;
  document.getElementById("vs-saturation-val").textContent = viewState.saturation + "%";
  _viewSettingsOverlay.querySelectorAll("[name='vs-theme']").forEach(r => {
    r.checked = r.value === _themeSnapshot;
  });
  _syncThemeTrigger();
  _viewSettingsOverlay.hidden = true;
});

document.getElementById("view-settings-accept").addEventListener("click", () => {
  _viewSettingsOverlay.hidden = true;
  markDirty();
});

// ----- Clip Info Modal -----
function showClipInfo(clip, track) {
  const startSecs    = clip.startSample / SAMPLE_RATE;
  const durationSecs = clip.durationSamples / SAMPLE_RATE;
  const hasAudio     = audioEngineHasBuffer(clip.id);
  const hasLoop      = clip.loopStartSamples != null && clip.loopEndSamples != null;
  const loopStart    = hasLoop ? (clip.loopStartSamples / SAMPLE_RATE).toFixed(3) : null;
  const loopEnd      = hasLoop ? (clip.loopEndSamples   / SAMPLE_RATE).toFixed(3) : null;
  document.getElementById("clip-info-body").innerHTML = `
    <dt>Track</dt>     <dd>${track.name}</dd>
    <dt>Start</dt>     <dd>${startSecs.toFixed(3)} s</dd>
    <dt>Duration</dt>  <dd>${durationSecs.toFixed(3)} s</dd>
    <dt>Audio</dt>     <dd>${hasAudio ? "Loaded" : "None"}</dd>
    ${hasLoop ? `<dt>Loop in</dt>  <dd>${loopStart} s</dd>
    <dt>Loop out</dt> <dd>${loopEnd} s</dd>` : ""}
  `;
  document.getElementById("clip-info-overlay").hidden = false;
}

document.getElementById("clip-info-close").addEventListener("click", () => {
  document.getElementById("clip-info-overlay").hidden = true;
});

// ----- Loop Editor Panel -----
let _loopEditorTrack      = null;
let _loopEditorClip       = null;
let _loopPreviewing       = false;
let _loopEditorAmplitudes = null;
let _loopEditorAnimFrame  = null;

function _analyzeAudioBuffer(audioBuffer, numPoints) {
  const ch   = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / numPoints));
  return Array.from({ length: numPoints }, (_, i) => {
    let peak = 0;
    const end = Math.min((i + 1) * step, ch.length);
    for (let j = i * step; j < end; j++) peak = Math.max(peak, Math.abs(ch[j]));
    return peak;
  });
}

function _drawLoopEditorWaveform(canvas, amplitudes, startFrac, endFrac, playheadFrac) {
  const ctx  = canvas.getContext("2d");
  const w    = canvas.width;
  const h    = canvas.height;
  const midY = h / 2;
  const n    = amplitudes.length;
  const color = getComputedStyle(document.body).getPropertyValue("--accent-primary").trim() || "#ff9500";

  ctx.clearRect(0, 0, w, h);

  // filled waveform as a continuous outline path
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w;
    ctx.lineTo(x, midY - amplitudes[i] * h * 0.45);
  }
  for (let i = n - 1; i >= 0; i--) {
    const x = (i / n) * w;
    ctx.lineTo(x, midY + amplitudes[i] * h * 0.45);
  }
  ctx.closePath();
  ctx.fill();

  // dim regions outside the loop
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, startFrac * w, h);
  ctx.fillRect(endFrac * w, 0, w - endFrac * w, h);

  // loop boundary lines
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startFrac * w, 0); ctx.lineTo(startFrac * w, h);
  ctx.moveTo(endFrac * w, 0);   ctx.lineTo(endFrac * w, h);
  ctx.stroke();

  if (playheadFrac != null && playheadFrac >= 0 && playheadFrac <= 1) {
    const px = playheadFrac * w;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function _stopLoopPreview() {
  _loopPreviewing = false;
  audioEngineStopPreview();
  if (_loopEditorAnimFrame) {
    cancelAnimationFrame(_loopEditorAnimFrame);
    _loopEditorAnimFrame = null;
  }
  if (_loopEditorClip && _loopEditorAmplitudes) {
    const canvas = document.getElementById("loop-editor-canvas");
    const buf    = audioEngineGetBuffer(_loopEditorClip.id);
    _drawLoopEditorWaveform(canvas, _loopEditorAmplitudes,
      _loopEditorClip.loopStartSamples / buf.length,
      Math.min(1, _loopEditorClip.loopEndSamples / buf.length));
  }
}

function _loopEditorTick() {
  if (!_loopPreviewing || !_loopEditorClip) { _loopEditorAnimFrame = null; return; }
  const canvas = document.getElementById("loop-editor-canvas");
  const buf    = audioEngineGetBuffer(_loopEditorClip.id);
  const posSec = audioEngineGetPreviewPosition();
  _drawLoopEditorWaveform(canvas, _loopEditorAmplitudes,
    _loopEditorClip.loopStartSamples / buf.length,
    Math.min(1, _loopEditorClip.loopEndSamples / buf.length),
    posSec >= 0 ? posSec / buf.duration : null);
  _loopEditorAnimFrame = requestAnimationFrame(_loopEditorTick);
}

function _startLoopPreview() {
  if (!_loopEditorClip) return;
  const buf = audioEngineGetBuffer(_loopEditorClip.id);
  _loopPreviewing = true;
  audioEnginePreviewLoop(
    buf,
    _loopEditorClip.loopStartSamples / SAMPLE_RATE,
    _loopEditorClip.loopEndSamples   / SAMPLE_RATE
  );
  if (!_loopEditorAnimFrame) _loopEditorAnimFrame = requestAnimationFrame(_loopEditorTick);
}

function _loopStartInputsToSamples(clip) {
  const bars   = Math.max(0, +document.getElementById("loop-start-bars").value  || 0);
  const beats  = Math.max(0, +document.getElementById("loop-start-beats").value || 0);
  const offset = +document.getElementById("loop-start-slider").value / 100; // ±1 beat
  const totalBeats = bars * beatsPerBar + beats + offset;
  return Math.max(0, Math.min(
    Math.round(totalBeats * secondsPerBeat() * SAMPLE_RATE),
    clip.durationSamples - 1
  ));
}

function _loopStartToInputs(clip) {
  const totalBeats = clip.loopStartSamples / SAMPLE_RATE / secondsPerBeat();
  const gridBeats  = Math.round(totalBeats);
  const bars  = Math.floor(Math.max(0, gridBeats) / beatsPerBar);
  const beats = Math.max(0, gridBeats) % beatsPerBar;
  const offsetFrac = totalBeats - gridBeats; // ±0.5 of a beat
  document.getElementById("loop-start-bars").value  = bars;
  document.getElementById("loop-start-beats").value = beats;
  document.getElementById("loop-start-slider").value = Math.round(offsetFrac * 100);
}

function _loopDurToEndSamples(clip) {
  const bars  = Math.max(0, +document.getElementById("loop-dur-bars").value  || 0);
  const beats = Math.max(0, +document.getElementById("loop-dur-beats").value || 0);
  const totalBeats = Math.max(1, bars * beatsPerBar + beats);
  return clip.loopStartSamples + Math.round(totalBeats * secondsPerBeat() * SAMPLE_RATE);
}

function _loopEndToDurInputs(clip) {
  const durSecs    = (clip.loopEndSamples - clip.loopStartSamples) / SAMPLE_RATE;
  const totalBeats = Math.max(0, durSecs / secondsPerBeat());
  const bars  = Math.floor(totalBeats / beatsPerBar);
  const beats = Math.round(totalBeats % beatsPerBar);
  document.getElementById("loop-dur-bars").value  = bars;
  document.getElementById("loop-dur-beats").value = beats;
}

function showLoopEditor(track, clip) {
  if (!clip || !audioEngineHasBuffer(clip.id)) return;

  _loopEditorTrack = track;
  _loopEditorClip  = clip;

  clip.loopStartSamples ??= 0;
  const _loopUnset = clip.loopEndSamples == null
    || (clip.loopStartSamples === 0 && clip.loopEndSamples >= clip.durationSamples);
  if (_loopUnset) {
    clip.loopStartSamples = 0;
    clip.loopEndSamples = Math.round(secondsPerBeat() * SAMPLE_RATE);
  }

  document.getElementById("loop-start-beats").max = beatsPerBar - 1;
  document.getElementById("loop-dur-beats").max   = beatsPerBar - 1;
  _loopStartToInputs(clip);
  _loopEndToDurInputs(clip);
  document.getElementById("loop-editor-track-name").textContent = `Loop Editor — ${track.name}`;
  document.getElementById("loop-editor-panel").hidden = false;

  const buf = audioEngineGetBuffer(clip.id);
  const startFrac = clip.loopStartSamples / buf.length;
  const endFrac   = Math.min(1, clip.loopEndSamples / buf.length);
  const canvas = document.getElementById("loop-editor-canvas");
  canvas.width  = canvas.parentElement.clientWidth  || 600;
  canvas.height = canvas.parentElement.clientHeight || 80;
  _loopEditorAmplitudes = _analyzeAudioBuffer(buf, canvas.width);
  _drawLoopEditorWaveform(canvas, _loopEditorAmplitudes, startFrac, endFrac);
}

function _updateLoopRegion() {
  if (!_loopEditorClip) return;
  const clip = _loopEditorClip;
  clip.loopStartSamples = _loopStartInputsToSamples(clip);
  clip.loopEndSamples   = _loopDurToEndSamples(clip);

  const buf2 = audioEngineGetBuffer(clip.id);
  const startFrac = clip.loopStartSamples / buf2.length;
  const endFrac   = Math.min(1, clip.loopEndSamples / buf2.length);
  const canvas    = document.getElementById("loop-editor-canvas");
  if (!_loopEditorAmplitudes || _loopEditorAmplitudes.length !== canvas.width) {
    _loopEditorAmplitudes = _analyzeAudioBuffer(buf2, canvas.width);
  }
  if (!_loopPreviewing) _drawLoopEditorWaveform(canvas, _loopEditorAmplitudes, startFrac, endFrac);
  markDirty();
  if (_loopPreviewing) _startLoopPreview();
}

["loop-start-bars", "loop-start-beats", "loop-start-slider",
 "loop-dur-bars",   "loop-dur-beats"].forEach(id =>
  document.getElementById(id).addEventListener("input", _updateLoopRegion)
);

document.getElementById("loop-offset-reset").addEventListener("click", () => {
  document.getElementById("loop-start-slider").value = 0;
  _updateLoopRegion();
});

document.getElementById("loop-export-btn").addEventListener("click", async () => {
  if (!_loopEditorClip || !_loopEditorTrack) return;
  const clip    = _loopEditorClip;
  const loopLen = clip.loopEndSamples - clip.loopStartSamples;
  if (loopLen <= 0) return;

  const srcBuffer = audioEngineGetBuffer(clip.id);
  if (!srcBuffer) return;

  const exportBars    = Math.max(1, +document.getElementById("loop-export-bars").value || 4);
  const outputSamples = Math.round(exportBars * beatsPerBar * secondsPerBeat() * SAMPLE_RATE);

  const WARN_BYTES = 200 * 1024 * 1024;
  const estimatedBytes = srcBuffer.numberOfChannels * outputSamples * 4;
  if (estimatedBytes > WARN_BYTES) {
    const mb = Math.round(estimatedBytes / 1024 / 1024);
    if (!confirm(`This export will allocate ~${mb} MB. Your browser may crash on large values. Continue?`)) return;
  }

  let newTrackLabel = `Loop ${_loopEditorTrack.name}`.slice(0, 30);
  if (!isNameUnique(newTrackLabel)) {
    const newName = await promptUniqueName(newTrackLabel, null);
    if (newName === null) return;
    newTrackLabel = newName;
  }

  try {
    const outBuffer = audioEngineRenderLoop(srcBuffer, clip.loopStartSamples, clip.loopEndSamples, outputSamples);
    const newTrack = createTrack(newTrackLabel, { prepend: true });
    tracks.unshift(newTrack);
    addClipToTrack(newTrack.timelineRow, 0, outBuffer.duration);
    const newClip = newTrack.clips[0];
    audioEngineStoreBuffer(newClip.id, outBuffer);
    updateClipWaveform(newClip.id, outBuffer);
    syncTimelineMinWidth();
    syncTimelineOverlay();
    markDirty();
    _stopLoopPreview();
    document.getElementById("loop-editor-panel").hidden = true;
  } catch (err) {
    console.error("Loop export failed:", err);
    alert(`Loop export failed: ${err.message || err}`);
  }
});

document.getElementById("loop-preview-btn").addEventListener("click", () => {
  _startLoopPreview();
});

document.getElementById("loop-stop-btn").addEventListener("click", _stopLoopPreview);

document.getElementById("loop-rewind-btn").addEventListener("click", () => {
  _stopLoopPreview();
  _startLoopPreview();
});

document.getElementById("loop-editor-close").addEventListener("click", () => {
  _stopLoopPreview();
  document.getElementById("loop-editor-panel").hidden = true;
});

{
  const _lePanel = document.getElementById("loop-editor-panel");
  const _leHandle = _lePanel.querySelector(".loop-editor-resize-handle");
  let _leResizing = false, _leStartX, _leStartY, _leStartW, _leStartH;

  _leHandle.addEventListener("mousedown", e => {
    _leResizing = true;
    _leStartX = e.clientX;
    _leStartY = e.clientY;
    _leStartW = _lePanel.offsetWidth;
    _leStartH = _lePanel.offsetHeight;
    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!_leResizing) return;
    _lePanel.style.width  = Math.max(260, _leStartW + (e.clientX - _leStartX)) + "px";
    _lePanel.style.height = Math.max(220, _leStartH + (e.clientY - _leStartY)) + "px";
    const canvas = document.getElementById("loop-editor-canvas");
    const newH = canvas.parentElement.clientHeight;
    if (newH > 0 && canvas.height !== newH) canvas.height = newH;
  });

  document.addEventListener("mouseup", () => {
    if (!_leResizing) return;
    _leResizing = false;
    if (_loopEditorClip) {
      const canvas = document.getElementById("loop-editor-canvas");
      const wf = canvas.parentElement;
      canvas.width  = wf.clientWidth  || 600;
      canvas.height = wf.clientHeight || 80;
      const buf = audioEngineGetBuffer(_loopEditorClip.id);
      _loopEditorAmplitudes = _analyzeAudioBuffer(buf, canvas.width);
      const startFrac = _loopEditorClip.loopStartSamples / buf.length;
      const endFrac   = Math.min(1, _loopEditorClip.loopEndSamples / buf.length);
      if (!_loopPreviewing) _drawLoopEditorWaveform(canvas, _loopEditorAmplitudes, startFrac, endFrac);
    }
  });
}

let _panelDragging = false;
let _panelDragStartY = 0;
let _panelDragStartHeight = 0;

bottomPanelHandle.addEventListener("mousedown", (e) => {
  _panelDragging = true;
  _panelDragStartY = e.clientY;
  _panelDragStartHeight = bottomPanel.offsetHeight;
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!_panelDragging) return;
  const delta = _panelDragStartY - e.clientY;
  const newHeight = Math.max(40, _panelDragStartHeight + delta);
  bottomPanel.style.height = `${newHeight}px`;
});

document.addEventListener("mouseup", () => {
  _panelDragging = false;
});

document.addEventListener("click", () => {
  document.querySelectorAll(".chord-picker-dropdown.open").forEach(d => d.classList.remove("open"));
});

function buildChordPicker(marker) {
  const chordList = typeof chords !== "undefined" ? chords : [];
  const wrap = document.createElement("div");
  wrap.className = "chord-picker";

  const trigger = document.createElement("button");
  trigger.className = "chord-picker-trigger";
  const current = chordList.find(c => c.id === marker.chordId);
  trigger.textContent = current ? (current.name || "(unnamed)") : "— no chord —";

  const dropdown = document.createElement("div");
  dropdown.className = "chord-picker-dropdown";

  const allOptions = [{ id: "", name: "— no chord —" }, ...chordList];
  for (const c of allOptions) {
    const opt = document.createElement("div");
    opt.className = "chord-picker-option";
    opt.textContent = c.name || "(unnamed)";
    opt.dataset.value = c.id;
    if (c.id === (marker.chordId ?? "")) opt.classList.add("active");
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      marker.chordId = c.id || null;
      markDirty();
      trigger.textContent = c.id ? (c.name || "(unnamed)") : "— no chord —";
      dropdown.querySelectorAll(".chord-picker-option").forEach(el =>
        el.classList.toggle("active", el.dataset.value === (c.id || ""))
      );
      dropdown.classList.remove("open");
    });
    dropdown.appendChild(opt);
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".chord-picker-dropdown.open").forEach(d => {
      if (d !== dropdown) d.classList.remove("open");
    });
    const isOpening = !dropdown.classList.contains("open");
    dropdown.classList.toggle("open");
    if (isOpening) {
      const rect = trigger.getBoundingClientRect();
      dropdown.style.left  = rect.left + "px";
      dropdown.style.width = rect.width + "px";
      dropdown.style.top   = (rect.top - dropdown.offsetHeight - 4) + "px";
    }
  });

  wrap.append(trigger, dropdown);
  return wrap;
}

function renderBottomPanel() {
  const content = document.getElementById("bottom-panel-content");
  content.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "panel-marker-grid";

  for (const marker of markers) {
    const row = document.createElement("div");
    row.className = "panel-marker-row";
    if (marker.id === selectedMarkerId) row.classList.add("selected");

    const timeEl = document.createElement("div");
    timeEl.className = "panel-marker-time";
    timeEl.textContent = formatTime(marker.time);

    const textarea = document.createElement("textarea");
    textarea.className = "panel-marker-note";
    textarea.placeholder = "Add notes…";
    textarea.value = marker.note ?? "";
    textarea.rows = 1;
    textarea.spellcheck = false;

    row.addEventListener("click", (e) => {
      if (e.target === textarea || e.target.closest(".chord-picker")) return;
      selectMarkerByIndex(markers.indexOf(marker));
    });

    textarea.addEventListener("input", () => {
      marker.note = textarea.value;
      markDirty();
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });

    const chordPicker = buildChordPicker(marker);

    row.append(timeEl, textarea, chordPicker);
    grid.appendChild(row);
  }

  content.appendChild(grid);

  grid.querySelectorAll(".panel-marker-note").forEach((ta) => {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  });

  // Scroll selected row to vertical center of the panel
  const selectedRow = content.querySelector(".panel-marker-row.selected");
  if (selectedRow) {
    content.scrollTop = selectedRow.offsetTop - (content.clientHeight / 2) + (selectedRow.offsetHeight / 2);
  }
}

// ============================================================
// Initialization -----
// ============================================================

const timelineCol = document.getElementById("timeline-column");
for (let i = 0; i < trackCount; i++) {
  createTrack(pickTrackName().name);
}
createRecordingLane();

markers.push({ id: ORIGIN_MARKER_ID, time: secondsPerBar() * 0, note: "", chordId: null });
// markers.push({ id: crypto.randomUUID(), time: secondsPerBar() * 4, note: "" });
// markers.push({ id: crypto.randomUUID(), time: secondsPerBar() * 8, note: "Chorus begins\nBig energy here\nDon't forget the drop\nRide it out to bar 12" });
selectedMarkerId = ORIGIN_MARKER_ID;

setTheme("Dark", { silent: true });

// Populate master meter segments
document.querySelectorAll(".master-meter-bar").forEach(bar => {
  for (let i = 0; i < MASTER_METER_SEGS; i++) {
    const seg = document.createElement("div");
    seg.className = "mm-seg";
    bar.appendChild(seg);
  }
});

// Populate GR meter segments
const _grMeterBar = document.getElementById("master-gr-meter");
if (_grMeterBar) {
  for (let i = 0; i < GR_METER_SEGS; i++) {
    const seg = document.createElement("div");
    seg.className = "gr-seg";
    _grMeterBar.appendChild(seg);
  }
}

tanpuraInit(getAudioContext());
tanpuraSetBPM(bpm);

// Apply defaults — mirrors the HTML default values so the audio engine matches on load.
audioEngineSetMasterGain(0.25);   // -12 dB
cpSetSynthMult(0.5);              // Med
tanpuraSetMode("pluck");
tanpuraSetVolume(0.5);
tanpuraSetSynthMult(1.0);         // Long
[0, 1, 2, 3].forEach(i => tanpuraSetStringGain(i, 0.5));

// Reverb default: Room
audioEngineSetReverbWet(0.20);
audioEngineSetReverbDecay(0.3 + (18 / 100) * 5.7);
document.getElementById("reverb-preset").value = "room";

// Comp default: Limit
audioEngineSetCompressorThreshold(-6);
audioEngineSetCompressorRatio(18);
document.getElementById("comp-preset").value = "limit";

// Master gain slider
document.getElementById("master-gain-slider").addEventListener("input", (e) => {
  masterGain = e.target.value;
  audioEngineSetMasterGain(e.target.value / 100);
  document.getElementById("master-vol-preset").value = "";
});

document.getElementById("master-reverb-wet").addEventListener("input", (e) => {
  audioEngineSetReverbWet(e.target.value / 100);
  document.getElementById("reverb-preset").value = "";
});

document.getElementById("master-reverb-size").addEventListener("input", (e) => {
  audioEngineSetReverbDecay(0.3 + (e.target.value / 100) * 5.7);
  document.getElementById("reverb-preset").value = "";
});

document.getElementById("master-comp-threshold").addEventListener("input", (e) => {
  audioEngineSetCompressorThreshold(parseFloat(e.target.value));
  document.getElementById("comp-preset").value = "";
});

document.getElementById("master-comp-ratio").addEventListener("input", (e) => {
  audioEngineSetCompressorRatio(parseFloat(e.target.value));
  document.getElementById("comp-preset").value = "";
});

document.getElementById("reverb-toggle").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const on = !btn.classList.contains("active");
  btn.classList.toggle("active", on);
  btn.textContent = on ? "ON" : "OFF";
  if (on) {
    audioEngineSetReverbWet(document.getElementById("master-reverb-wet").value / 100);
  } else {
    audioEngineSetReverbWet(0);
  }
});

document.getElementById("comp-toggle").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const on = !btn.classList.contains("active");
  btn.classList.toggle("active", on);
  btn.textContent = on ? "ON" : "OFF";
  if (on) {
    audioEngineSetCompressorThreshold(parseFloat(document.getElementById("master-comp-threshold").value));
    audioEngineSetCompressorRatio(parseFloat(document.getElementById("master-comp-ratio").value));
  } else {
    audioEngineSetCompressorThreshold(0);
    audioEngineSetCompressorRatio(1);
  }
});

// Master presets
const _masterPresets = {
  unity: { vol: 100 },
  low:   { vol: 50  },
  quiet: { vol: 25  },
};
document.getElementById("master-vol-preset").addEventListener("change", (e) => {
  const p = _masterPresets[e.target.value];
  if (!p) return;
  document.getElementById("master-gain-slider").value = p.vol;
  masterGain = p.vol;
  audioEngineSetMasterGain(p.vol / 100);
});

// Reverb presets
const _reverbPresets = {
  room:      { wet: 20, size: 18 },
  hall:      { wet: 40, size: 50 },
  cathedral: { wet: 65, size: 85 },
};
document.getElementById("reverb-preset").addEventListener("change", (e) => {
  const p = _reverbPresets[e.target.value];
  if (!p) return;
  document.getElementById("master-reverb-wet").value  = p.wet;
  document.getElementById("master-reverb-size").value = p.size;
  audioEngineSetReverbWet(p.wet / 100);
  audioEngineSetReverbDecay(0.3 + (p.size / 100) * 5.7);
});

// Compressor presets
const _compPresets = {
  light: { thr: -18, ratio: 3  },
  punch: { thr: -24, ratio: 6  },
  limit: { thr: -6,  ratio: 18 },
};
document.getElementById("comp-preset").addEventListener("change", (e) => {
  const p = _compPresets[e.target.value];
  if (!p) return;
  document.getElementById("master-comp-threshold").value = p.thr;
  document.getElementById("master-comp-ratio").value     = p.ratio;
  audioEngineSetCompressorThreshold(p.thr);
  audioEngineSetCompressorRatio(p.ratio);
});

// Tanpura controls
let _tanpuraEnabled = true;

document.getElementById("tanpura-toggle").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const on  = !btn.classList.contains("active");
  _tanpuraEnabled = on;
  btn.classList.toggle("active", on);
  btn.textContent = on ? "ON" : "OFF";
  if (!on) tanpuraStop();
});

// Converts a chord object into a sorted, deduplicated list of MIDI note numbers.
// Muted strings ("x") are skipped; fretted strings use baseFret + row offset; open strings ("o") with no dots use fret 0.
// e.g. C chord (baseFret 1):
//   tops: ["o",null,"o",null,null,"x"]  dots: [[F,F,F,F],[T,F,F,F],[F,F,F,F],[F,T,F,F],[F,F,T,F],[F,F,F,F]]
//   → [48, 52, 55, 60, 64]  (C E G C E, low-E string skipped)
function _chordToMidiNotes(chord) {
  const midi = [];
  for (let s = 0; s < 6; s++) {
    if (chord.tops[s] === "x") continue;
    const hasDots = chord.dots[s].some(Boolean);
    if (hasDots) {
      chord.dots[s].forEach((dot, r) => {
        if (dot) midi.push(currentTuning.midiAt(s + 1, chord.baseFret + r));
      });
    } else if (chord.tops[s] === "o") {
      midi.push(currentTuning.midiAt(s + 1, 0));
    }
  }
  const output = midi.sort((a, b) => a - b);
  console.log("_chordToMidiNotes output:");
  console.log(output);
  return output;
}

function _applyTanpuraMarker(marker) {
  if (marker.note && /tanpura\s*off/i.test(marker.note)) {
    tanpuraStop();
    return;
  }
  if (marker.chordId) {
    const chord = chords.find(c => c.id === marker.chordId);
    if (!chord) return;
    const notes = _chordToMidiNotes(chord);
    console.log("notes:" + notes);
    if (!notes.length) return;
    tanpuraSetStrings(notes);
    if (!tanpuraIsActive()) tanpuraStart();
  }
}

document.getElementById("tanpura-volume").addEventListener("input", (e) => {
  tanpuraSetVolume(e.target.value / 100);
});

document.getElementById("tanpura-rate").addEventListener("input", (e) => {
  tanpuraSetRate(parseInt(e.target.value));
});

document.getElementById("tanpura-rate-sync").addEventListener("change", (e) => {
  const v = e.target.value;
  tanpuraSetRateSync(v === "free" ? null : parseInt(v));
});

document.getElementById("synth-note-length").addEventListener("input", (e) => {
  cpSetSynthMult(e.target.value / 100);
  if (playing) midiEnginePlay(tracks, getPlayheadTime());
});

document.getElementById("synth-len-preset").addEventListener("change", (e) => {
  const val = parseInt(e.target.value);
  cpSetSynthMult(val / 100);
  document.getElementById("synth-note-length").value = val;
  if (playing) midiEnginePlay(tracks, getPlayheadTime());
});

document.getElementById("pluck-length").addEventListener("input", (e) => {
  cpSetPluckMult(e.target.value / 100);
  document.getElementById("pluck-preset").value = "";
  if (playing) midiEnginePlay(tracks, getPlayheadTime());
});

document.getElementById("pluck-prominence").addEventListener("input", (e) => {
  cpSetPluckVolume(e.target.value / 50);
  document.getElementById("pluck-preset").value = "";
});

document.getElementById("pluck-attack").addEventListener("input", (e) => {
  cpSetPluckAttack(e.target.value * 0.002);
  document.getElementById("pluck-preset").value = "";
});

document.getElementById("pluck-decay").addEventListener("input", (e) => {
  cpSetPluckDecay(e.target.value * 0.01);
  document.getElementById("pluck-preset").value = "";
});

document.getElementById("pluck-sustain").addEventListener("input", (e) => {
  cpSetPluckSustain(e.target.value / 100);
  document.getElementById("pluck-preset").value = "";
});

document.getElementById("pluck-release").addEventListener("input", (e) => {
  cpSetPluckRelease(e.target.value * 0.02);
  document.getElementById("pluck-preset").value = "";
});

const _pluckPresets = {
  soft:   { len:  50, prm: 30, atk: 40, dec: 30, sus: 60, rel: 30 },
  warm:   { len: 130, prm: 45, atk: 20, dec: 40, sus: 75, rel: 25 },
  med:    { len: 100, prm: 50, atk: 10, dec: 20, sus: 70, rel: 15 },
  bright: { len:  90, prm: 60, atk:  4, dec: 15, sus: 80, rel: 12 },
  crisp:  { len:  65, prm: 70, atk:  2, dec:  8, sus: 90, rel:  8 },
  punchy: { len:  80, prm: 90, atk:  0, dec: 10, sus: 85, rel: 10 },
  long:   { len: 180, prm: 40, atk: 20, dec: 50, sus: 65, rel: 40 },
};

document.getElementById("pluck-preset").addEventListener("change", (e) => {
  const p = _pluckPresets[e.target.value];
  if (!p) return;
  document.getElementById("pluck-length").value     = p.len;
  document.getElementById("pluck-prominence").value = p.prm;
  document.getElementById("pluck-attack").value     = p.atk;
  document.getElementById("pluck-decay").value      = p.dec;
  document.getElementById("pluck-sustain").value    = p.sus;
  document.getElementById("pluck-release").value    = p.rel;
  cpSetPluckMult(p.len / 100);
  cpSetPluckVolume(p.prm / 50);
  cpSetPluckAttack(p.atk * 0.002);
  cpSetPluckDecay(p.dec * 0.01);
  cpSetPluckSustain(p.sus / 100);
  cpSetPluckRelease(p.rel * 0.02);
  if (playing) midiEnginePlay(tracks, getPlayheadTime());
});

document.getElementById("tanpura-mode").addEventListener("change", (e) => {
  tanpuraSetMode(e.target.value);
});

document.getElementById("tanpura-synth-length").addEventListener("input", (e) => {
  tanpuraSetSynthMult(e.target.value / 100);
});

document.getElementById("tanpura-synth-len-preset").addEventListener("change", (e) => {
  const val = parseInt(e.target.value);
  tanpuraSetSynthMult(val / 100);
  document.getElementById("tanpura-synth-length").value = val;
});

[1, 2, 3, 4].forEach((n) => {
  document.getElementById(`tanpura-s${n}-vol`).addEventListener("input", (e) => {
    tanpuraSetStringGain(n - 1, e.target.value / 100);
  });
});

// DOM Sync - Video Backdrop - Synchronization Layer -----
// Keep video sized to the visible area of #timeline-area so it doesn't scroll.
(function () {
  const vid = document.getElementById("timeline-video");
  function syncVideoSize() {
    vid.style.width  = timelineArea.clientWidth  + "px";
    vid.style.height = timelineArea.clientHeight + "px";
  }
  syncVideoSize();
  new ResizeObserver(syncVideoSize).observe(timelineArea);
})();

updateMeter();
syncTimelineOverlayWidth();
syncTimelineOverlay();
syncTimelineMinWidth();
renderTimelineLayer();
renderTempo();
renderTimeSignature();
renderMetronomeGrid();
renderMarkerTransport();
renderBottomPanel();

// ----- Auto-Open Last Project
const _autoOpenEl = document.getElementById("toggle-auto-open");

function updateAutoOpenLabel() {
  const on = localStorage.getItem("autoOpenPreviousProject") === "1";
  _autoOpenEl.textContent = `Auto-Open Last Project: ${on ? "On" : "Off"}`;
}

_autoOpenEl.onclick = () => {
  const on = localStorage.getItem("autoOpenPreviousProject") === "1";
  localStorage.setItem("autoOpenPreviousProject", on ? "0" : "1");
  updateAutoOpenLabel();
};

updateAutoOpenLabel();

const _showDemoEl = document.getElementById("toggle-show-demo");

function updateShowDemoLabel() {
  _showDemoEl.textContent = `Demo on New Project: ${demoCookieIsSet() ? "Off" : "On"}`;
}

_showDemoEl.onclick = () => {
  if (demoCookieIsSet()) localStorage.removeItem("demo_sequence_seen");
  else setDemoCookie();
  updateShowDemoLabel();
};

updateShowDemoLabel();

// ----- Latency Calibration - Settings Menu - Event Handlers -----

const _calibrateMenuEl   = document.getElementById("menu-calibrate-latency");
const _calibrateOverlay  = document.getElementById("calibrate-overlay");
const _calibrateStatus   = document.getElementById("calibrate-status");
const _calibrateResult   = document.getElementById("calibrate-result");
const _calibrateRunBtn   = document.getElementById("calibrate-run-btn");
const _calibrateCloseBtn = document.getElementById("calibrate-close-btn");
const _calibrateManualInput  = document.getElementById("calibrate-manual-input");
const _calibrateManualSetBtn = document.getElementById("calibrate-manual-set-btn");

function updateCalibrateMenuItem(ms) {
  const val = ms ?? audioEngineGetCalibratedLatency();
  _calibrateMenuEl.textContent = val > 0
    ? `Calibrate Latency… (${val} ms)`
    : "Calibrate Latency…";
}

_calibrateMenuEl.onclick = () => {
  _calibrateManualInput.value = audioEngineGetCalibratedLatency();
  _calibrateOverlay.hidden = false;
};

_calibrateRunBtn.onclick = async () => {
  _calibrateRunBtn.disabled = true;
  _calibrateResult.hidden = true;
  _calibrateResult.className = "calibrate-result";
  try {
    const ms = await audioEngineCalibrate(msg => { _calibrateStatus.textContent = msg; });
    _calibrateResult.textContent = `Measured latency: ${ms} ms`;
    _calibrateResult.classList.add("success");
    _calibrateResult.hidden = false;
    _calibrateManualInput.value = ms;
    updateCalibrateMenuItem(ms);
  } catch (err) {
    _calibrateResult.textContent = `Calibration failed: ${err.message}`;
    _calibrateResult.classList.add("error");
    _calibrateResult.hidden = false;
  } finally {
    _calibrateStatus.textContent = "";
    _calibrateRunBtn.disabled = false;
  }
};

_calibrateCloseBtn.onclick = () => {
  _calibrateOverlay.hidden = true;
};

_calibrateManualSetBtn.onclick = () => {
  const ms = Math.max(0, Math.min(500, parseInt(_calibrateManualInput.value, 10) || 0));
  _calibrateManualInput.value = ms;
  audioEngineSetCalibratedLatency(ms);
  updateCalibrateMenuItem(ms);
  _calibrateResult.textContent = `Latency set to ${ms} ms`;
  _calibrateResult.className = "calibrate-result success";
  _calibrateResult.hidden = false;
};

updateCalibrateMenuItem();


const _skipAutoOpen = sessionStorage.getItem("skipAutoOpen");
sessionStorage.removeItem("skipAutoOpen");
if (localStorage.getItem("autoOpenPreviousProject") === "1" && !_skipAutoOpen) {
  const raw = localStorage.getItem("previousProjectData");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      deserializeProject(parsed);
      markDirty(); // file handle is lost on reload — prompt user to re-save
      if (parsed.id && tracks.some(t => t.clips.length > 0)) showAudioReconnectBanner(parsed.id);
    } catch (e) {
      console.warn("Failed to restore previous project:", e);
    }
  }
}

function showAudioReconnectBanner(projectId) {
  document.getElementById('audio-reconnect-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'audio-reconnect-banner';
  banner.innerHTML = `
    <span class="arb-text">Audio files not loaded — folder: <code>${projectId ?? 'unknown'}</code></span>
    <button class="arb-btn">Reconnect folder</button>
    <button class="arb-close" aria-label="Dismiss">&#x2715;</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('.arb-btn').addEventListener('click', async () => {
    try {
      const ok = await reconnectProjectFolder();
      if (ok) banner.remove();
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Reconnect failed:', err);
    }
  });
  banner.querySelector('.arb-close').addEventListener('click', () => banner.remove());
}

document.querySelectorAll('.master-section-header').forEach(header => {
    header.addEventListener('click', e => {
        if (e.target.closest('.master-fx-controls, select, button')) return;
        header.closest('.master-section').classList.toggle('collapsed');
    });
});

pianoRollInit();
syncRecordBtnEnabled();

// Custom themed preset dropdowns — replaces native <select> visually while
// keeping the original element (and its ID/listeners) intact.
// Menu is portalled to <body> to escape any ancestor stacking contexts.
(function() {
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  let openMenu = null;

  function closeAll() {
    if (openMenu) {
      openMenu.menu.classList.remove('open');
      openMenu.wrapper.classList.remove('open');
      openMenu = null;
    }
  }

  document.addEventListener('click', closeAll);
  window.addEventListener('scroll', closeAll, { capture: true, passive: true });

  function initCustomSelect(sel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'csel';
    sel.parentNode.insertBefore(wrapper, sel);
    wrapper.appendChild(sel);
    sel.hidden = true;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'csel-trigger';

    // Menu lives on <body> to escape stacking contexts.
    const menu = document.createElement('div');
    menu.className = 'csel-menu';
    document.body.appendChild(menu);

    wrapper.appendChild(trigger);

    function syncUI() {
      const idx = sel.selectedIndex;
      trigger.firstChild?.remove();
      trigger.prepend(document.createTextNode(idx >= 0 ? sel.options[idx].text : ''));
      menu.querySelectorAll('.csel-opt').forEach(opt =>
        opt.classList.toggle('active', opt.dataset.value === valueDescriptor.get.call(sel))
      );
    }

    Array.from(sel.options).forEach(opt => {
      const item = document.createElement('div');
      item.className = 'csel-opt';
      item.dataset.value = opt.value;
      item.textContent = opt.text;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        closeAll();
      });
      menu.appendChild(item);
    });

    syncUI();

    function positionMenu() {
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      menu.style.minWidth = rect.width + 'px';
      if (spaceAbove > spaceBelow) {
        menu.style.top = '';
        menu.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
      } else {
        menu.style.bottom = '';
        menu.style.top = (rect.bottom + 2) + 'px';
      }
      menu.style.left = rect.left + 'px';
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = openMenu?.wrapper === wrapper;
      closeAll();
      if (!isOpen) {
        positionMenu();
        menu.classList.add('open');
        wrapper.classList.add('open');
        openMenu = { menu, wrapper };
      }
    });

    // Intercept programmatic .value= so the trigger label stays current.
    Object.defineProperty(sel, 'value', {
      get() { return valueDescriptor.get.call(this); },
      set(v) { valueDescriptor.set.call(this, v); syncUI(); },
      configurable: true,
    });
  }

  document.querySelectorAll('.master-preset-select').forEach(initCustomSelect);
})();

