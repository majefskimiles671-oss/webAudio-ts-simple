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

// Close menu on item click — drop pointer-events briefly (kills :hover) and clear keyboard-open
document.querySelector(".menu-bar").addEventListener("click", (e) => {
  const item = e.target.closest(".menu-pop div");
  if (!item) return;
  const menu = item.closest(".menu");
  menu.classList.remove("keyboard-open");
  menu.style.pointerEvents = "none";
  setTimeout(() => { menu.style.pointerEvents = ""; }, 200);
});

const controlsScrollCol = document.getElementById("controls-scroll-column");
controlsScrollCol.addEventListener("input", (e) => {
  const gs = e.target.closest("gain-slider");
  if (gs) {
    markDirty();
    const track = findTrackByControlRow(gs.closest(".control-row"));
    if (track) track.gain = gs.value;
    return;
  }
  const ps = e.target.closest("pan-slider");
  if (ps) {
    markDirty();
    const track = findTrackByControlRow(ps.closest(".control-row"));
    if (track) track.pan = ps.value;
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

//  Zoom State
const zoomLevels = [0.25, 0.5, 1, 2, 4];
let zoomIndex = 2; // default = 1x = zoomLevels[2]

// Are state and view drivers at the same time
let zoom = zoomLevels[zoomIndex];
let currentTimeSeconds = 0;
let rulerMode = "bars"; // "seconds" | "bars"

let recordStartTime = null;
let recordingTrackRow = null;
let recordingLaneTrack = null;  // the current (unpromoted) recording lane track object

//  Track State
const tracks = [];        // promoted tracks only, front = newest (matches DOM order)
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

//  Clip Selection
let selectedClipId = null;

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

//  Transport State
let playing = false;
let recording = false;
let masterGain = 100;
let startTime = 0;
let recordStartX = null;
let playbackStartX = 0; // px offset where playback begins

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
  selectedClipId = clipId;
  document.querySelectorAll(".waveform").forEach(el => {
    el.classList.toggle("selected", el.dataset.clipId === clipId);
  });
}

function deselectClip() {
  selectedClipId = null;
  document.querySelectorAll(".waveform.selected").forEach(el => el.classList.remove("selected"));
}

function deleteSelectedClip() {
  if (!selectedClipId) return;
  const track = tracks.find(t => t.clips.some(c => c.id === selectedClipId));
  if (track) track.clips = track.clips.filter(c => c.id !== selectedClipId);
  document.querySelector(`.waveform[data-clip-id="${selectedClipId}"]`)?.remove();
  deselectClip();
  markDirty();
}

function attachClipDeleteButton(waveform) {
  const btn = document.createElement("button");
  btn.className = "waveform-delete-btn";
  btn.innerHTML = "&#x2715;";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    selectClip(waveform.dataset.clipId);
    deleteSelectedClip();
  });
  waveform.appendChild(btn);
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
}

// ----- Track Lookup Helpers
function findTrackByControlRow(el) {
  return tracks.find(t => t.controlRow === el) ?? null;
}
function findTrackByTimelineRow(el) {
  return tracks.find(t => t.timelineRow === el) ?? null;
}

// ----- Track Management
function createTrack(label, { prepend = false } = {}) {
  // State object is created first so all event listeners can close over it.
  // controlRow and timelineRow are assigned after DOM construction.
  const track = {
    id:          crypto.randomUUID(),
    name:        label,
    gain:        80,
    pan:         0,
    scenes:      [],
    clips:       [],
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

  title.addEventListener("focus", () => {
    const range = document.createRange();
    range.selectNodeContents(title);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); title.blur(); }
  });

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
  });

  title.addEventListener("blur", () => {
    const t = title.textContent.trim();
    const finalName = t === "" ? label : t;
    title.textContent = finalName;
    track.name = finalName;
    markDirty();
  });

  controlFrag.querySelectorAll(".track-scene").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      track.scenes = Array.from(controlRow.querySelectorAll(".track-scene.active"))
        .map(b => b.textContent.trim());
      markDirty();
      updateSceneMask();
    });
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
  });

  const deleteBtn = controlFrag.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", () => {
    const trackIdx = tracks.indexOf(track);
    if (trackIdx === -1) return;  // recording lane — not in tracks, protected
    markDirty();
    const trackName = track.controlRow.querySelector(".track-title")?.textContent || "Track";
    tracks.splice(trackIdx, 1);
    track.controlRow.remove();
    track.timelineRow.remove();
    announce(`${trackName} deleted`);
  });

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

  track.controlRow  = controlRow;
  track.timelineRow = timelineRow;
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
  if (track) track.clips.push(clip);

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
  canvas.width = computeWaveformWidth(durationSeconds);

  waveform.style.left = `${secondsToPixels(startSeconds)}px`;
  waveform.style.width = `${computeWaveformWidth(durationSeconds)}px`;

  canvas.dataset.amplitudes = JSON.stringify(generateWaveformData(256));
  drawDummyWaveform(canvas);

  waveform.appendChild(canvas);
  attachClipDeleteButton(waveform);
  rowInner.appendChild(waveform);
}

function createRecordingLane() {
  trackCount += 1;
  const { name, definition } = pickTrackName();
  const track = createTrack(name, { prepend: true });
  track.controlRow.classList.add("recording-lane");
  track.timelineRow.classList.add("recording-lane");
  recordingLaneTrack = track;
  showTrackNameTooltip(name, definition);
  announce(`Recording to new track: ${name}`);
}

function promoteRecordingLane() {
  if (!recordingLaneTrack) return;
  if (!recordingLaneTrack.timelineRow.querySelector(".waveform")) return;

  markDirty();
  recordingLaneTrack.controlRow.classList.remove("recording-lane");
  recordingLaneTrack.timelineRow.classList.remove("recording-lane");
  tracks.unshift(recordingLaneTrack);  // newest promoted track at front, matches DOM order
  recordingLaneTrack = null;

  createRecordingLane();
  timelineArea.scrollTop = 0;
  controlsScrollCol.scrollTop = 0;
  syncTimelineOverlay();
  updateSceneMask();
  updateSoloMask();
}

function onRecordStart() {
  recordingTrackRow = recordingLaneTrack.timelineRow;
  timelineArea.scrollTop = 0;
  controlsScrollCol.scrollTop = 0;
}

function onRecordStop() {
  if (!recordingTrackRow) return;

  const endTime = getPlayheadTime();
  const duration = Math.max(0, endTime - recordStartTime);

  addClipToTrack(recordingTrackRow, recordStartTime, duration);
  recordingTrackRow = null;
}

// ============================================================
// Projection / Rendering (View Layer -----
// ============================================================

// Recording range
const recordRange = document.getElementById("record-range");

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

function clearRecordingRange() {
  recordRange.style.display = "none";
  recordStartX = null;
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

  const contentWidth = timelineInner.scrollWidth;
  const viewWidth = timelineArea.clientWidth;

  const rulerHeight = 32;

  // Canvas sizing (authoritative)
  rulerCanvas.style.height = `${rulerHeight}px`;
  rulerCanvas.width = contentWidth;
  rulerCanvas.height = rulerHeight;

  const height = rulerCanvas.height;

  rulerCtx.clearRect(0, 0, contentWidth, height);

  const scrollLeft = timelineArea.scrollLeft;
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

    const firstBar = Math.floor(startSeconds / barLen);

    let barTime = firstBar * barLen;
    let barNum = firstBar;

    while (barTime <= endSeconds) {
      // Major bar tick
      ticks.push({
        time: barTime,
        major: true,
        label: `Bar ${barNum + 1}`,
      });

      // Beat ticks
      for (let b = 1; b < beatsPerBar; b++) {
        const bt = barTime + b * beatLen;
        if (bt >= startSeconds && bt <= endSeconds) {
          ticks.push({
            time: bt,
            major: false,
            label: null,
          });
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
    const x = secondsToPixels(tick.time);

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

    // ✅ CLICK → LOAD MARKER
    markerWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedMarkerId = marker.id;
      renderMarkers();
      renderMarkerTransport();
      renderBottomPanel();
    });

    // (drag comes later; keep click-only for now)
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

    canvas.width = width;
    waveform.style.left = `${secondsToPixels(startSeconds)}px`;
    waveform.style.width = `${width}px`;

    drawDummyWaveform(canvas);
  });
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

  setPlayheadPositionPx(clampedX);
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
  returnToBeginningBtn.disabled = isTransportMoving();
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
  const minSeconds = 16 * secondsPerBar();
  timelineInner.style.minWidth = `${secondsToPixels(minSeconds)}px`;
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
  document.querySelectorAll(".menu-pop [data-theme]").forEach(el => {
    el.classList.toggle("active", el.dataset.theme === name);
  });
  renderTimelineLayer();
  rerenderWaveforms();
  if (!silent) markDirty();
}

document.querySelectorAll("[data-theme]").forEach((el) => {
  el.onclick = () => setTheme(el.dataset.theme);
});

document.querySelectorAll("[data-ruler]").forEach((el) => {
  el.onclick = () => {
    const mode = el.getAttribute("data-ruler");
    setRulerMode(mode);
  };
});

document.getElementById("debug-log-project").onclick = () => console.log(serializeProject());
document.getElementById("debug-toggle-display").onclick = () => document.body.classList.toggle("debug");

document.getElementById("toggle-chord-panel").addEventListener("click", cdTogglePanel);

document.getElementById("toggle-notes-font").onclick = () => {
  const isActive = document.body.getAttribute("data-notes-font") === "mono";
  document.body.setAttribute("data-notes-font", isActive ? "" : "mono");
  markDirty();
};

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
  const x = e.offsetX;
  const time = pixelsToSeconds(x);

  const nearby = findNearbyMarker(time);
  if (nearby) {
    selectedMarkerId = nearby.id;
    renderMarkers();
    renderMarkerTransport();
    renderBottomPanel();
    return;
  }

  const marker = { id: crypto.randomUUID(), time, note: "" };
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

  const marker = { id: crypto.randomUUID(), time, note: "" };
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

const transportToggles = document.querySelectorAll(
  "#transport-scenes .transport-scene",
);

function updateSceneMask() {
  const activeBtn = document.querySelector("#transport-scenes .transport-scene.active");
  const controlRows = Array.from(controlsScrollCol.children);
  const timelineRows = Array.from(timelineCol.children);

  controlRows.forEach((controlRow, i) => {
    const timelineRow = timelineRows[i];

    // Recording lane is operational infrastructure — always visible
    if (controlRow.classList.contains("recording-lane")) {
      controlRow.classList.remove("not-in-scene");
      timelineRow?.classList.remove("not-in-scene");
      return;
    }

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

    if (controlRow.classList.contains("recording-lane")) {
      controlRow.classList.remove("not-in-solo");
      timelineRow?.classList.remove("not-in-solo");
      return;
    }

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
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll("#transport-scenes .transport-scene.active")
      .forEach((btn) => btn.classList.remove("active"));
    updateSceneMask();
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

recordBtn.onclick = () => {
  recordInteraction("transport");
  applyTransportChange({ play: playing, record: !recording });
};


// ----- Clip Selection Handlers
timelineArea.addEventListener("click", (e) => {
  const waveform = e.target.closest(".waveform");
  if (waveform) {
    selectClip(waveform.dataset.clipId);
  } else {
    deselectClip();
  }
});

document.addEventListener("keydown", (e) => {
  const editable = document.activeElement?.tagName === "INPUT"
    || document.activeElement?.tagName === "TEXTAREA"
    || document.activeElement?.isContentEditable;

  if (e.key === "Escape") deselectClip();

  if ((e.key === "Delete" || e.key === "Backspace") && !editable) deleteSelectedClip();

  if (e.key === " " && !editable) {
    e.preventDefault();
    applyTransportChange({ play: !playing, record: playing ? false : recording });
  }
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

function _meterTick() {
  let anyActive = false;

  for (const track of tracks) {
    if (!track.meterEl) continue;

    if (_meterPlaying) {
      // Periodically pick a new target level
      if (track.meterTicksToNext <= 0) {
        track.meterTicksToNext = 8 + Math.floor(Math.random() * 18);
        const vL = (Math.random() - 0.5) * 0.55;
        const vR = (Math.random() - 0.5) * 0.45;
        track.meterTargetL = Math.max(0.05, Math.min(1, track.meterBase + vL));
        track.meterTargetR = Math.max(0.05, Math.min(1, track.meterBase + vR));
        // Occasional transient hit
        if (Math.random() < 0.12) {
          track.meterTargetL = Math.min(1, track.meterBase + 0.25 + Math.random() * 0.25);
        }
      }
      track.meterTicksToNext--;

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

    if (track.meterL > 0.002 || track.meterR > 0.002) anyActive = true;
  }

  _updateMasterMeter();

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
let _masterL = 0, _masterR = 0;
let _masterPeakL = 0, _masterPeakR = 0;
let _masterPeakFramesL = 0, _masterPeakFramesR = 0;

function _updateMasterMeter() {
  const gainFactor = masterGain / 100;

  // Drive from the highest active track level
  const rawL = tracks.length > 0 ? Math.max(...tracks.map(t => t.meterL)) * gainFactor : 0;
  const rawR = tracks.length > 0 ? Math.max(...tracks.map(t => t.meterR)) * gainFactor : 0;

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

  _renderMasterMeter();
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

//  Transport Transitions
function onTransportStart() {
  playbackStartX = getPlayheadX(); // ← THIS is the fix
  startTime = performance.now();
  requestAnimationFrame(updatePlayhead);
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
  requestAnimationFrame(updatePlayhead);
}

function updateMeter() {
  if (recording) {
    meterBar.style.width = `${20 + Math.random() * 80}%`;
  }
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

const bottomPanel = document.getElementById("bottom-panel");
const bottomPanelHandle = document.getElementById("bottom-panel-handle");
const toggleBottomPanelBtn = document.getElementById("toggle-bottom-panel");

toggleBottomPanelBtn.addEventListener("click", () => {
  const nowHidden = bottomPanel.classList.toggle("hidden");
  toggleBottomPanelBtn.textContent = nowHidden ? "Show Bottom Panel" : "Hide Bottom Panel";
  if (!nowHidden) renderBottomPanel();
});

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

    row.addEventListener("click", (e) => {
      if (e.target === textarea) return;
      selectMarkerByIndex(markers.indexOf(marker));
    });

    textarea.addEventListener("input", () => {
      marker.note = textarea.value;
      markDirty();
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });

    row.append(timeEl, textarea);
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

markers.push({ id: ORIGIN_MARKER_ID, time: secondsPerBar() * 0, note: "" });
// markers.push({ id: crypto.randomUUID(), time: secondsPerBar() * 4, note: "" });
// markers.push({ id: crypto.randomUUID(), time: secondsPerBar() * 8, note: "Chorus begins\nBig energy here\nDon't forget the drop\nRide it out to bar 12" });
selectedMarkerId = ORIGIN_MARKER_ID;

setTheme("earth", { silent: true });

// Populate master meter segments
document.querySelectorAll(".master-meter-bar").forEach(bar => {
  for (let i = 0; i < MASTER_METER_SEGS; i++) {
    const seg = document.createElement("div");
    seg.className = "mm-seg";
    bar.appendChild(seg);
  }
});

// Master gain slider
document.getElementById("master-gain-slider").addEventListener("input", (e) => {
  masterGain = e.target.value;
});

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

const _skipAutoOpen = sessionStorage.getItem("skipAutoOpen");
sessionStorage.removeItem("skipAutoOpen");
if (localStorage.getItem("autoOpenPreviousProject") === "1" && !_skipAutoOpen) {
  const raw = localStorage.getItem("previousProjectData");
  if (raw) {
    try {
      deserializeProject(JSON.parse(raw));
      markDirty(); // file handle is lost on reload — prompt user to re-save
    } catch (e) {
      console.warn("Failed to restore previous project:", e);
    }
  }
}

