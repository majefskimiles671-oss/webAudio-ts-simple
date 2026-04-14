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

const controlsScrollCol = document.getElementById("controls-scroll-column");
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
let recordingLaneControlRow = null;
let recordingLaneTimelineRow = null;

//  Global Musical State
let tempoBPM = 125;
let timeSignature = {
  beats: 3,
  noteValue: 4,
};

let markers = [{ id: 0, time: 0 }]; // [{ id, time }]
let selectedMarkerId = 0;

//  Musical Grid
let bpm = 120; // beats per minute
let beatsPerBar = timeSignature.beats; // kept in sync with timeSignature.beats

let trackCount = 0;

//  Transport State
let playing = false;
let recording = false;
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

function pickTrackName() {
  if (_trackNamePool.length === 0) {
    _trackNamePool = [...TRACK_NAMES].sort(() => Math.random() - 0.5);
  }
  const entry = _trackNamePool.pop();
  return typeof entry === "string" ? { name: entry, definition: null } : entry;
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
  }

  if (!wasRecording && recording) { onRecordStart(); startRecordingRange(); }
  if (wasRecording && !recording) { onRecordStop(); clearRecordingRange(); }

  if (prevState !== "IDLE" && nextState === "IDLE") {
    promoteRecordingLane();
  }

  syncTransportUI();
}

function returnToBeginning() {
  setPlayheadPositionPx(0);
  timelineArea.scrollLeft = 0;
}

// ----- Track Management
function createTrack(label, { prepend = false } = {}) {
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
    title.textContent = t === "" ? label : t;
  });

  controlFrag.querySelectorAll(".track-scene").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      updateSceneMask();
    });
  });

  controlFrag.querySelector(".track-scene-clear").addEventListener("click", (e) => {
    e.currentTarget.closest(".control-row")
      .querySelectorAll(".track-scene.active")
      .forEach((btn) => btn.classList.remove("active"));
    updateSceneMask();
  });

  const soloBtn = controlFrag.querySelector(".solo-btn");
  soloBtn.addEventListener("click", () => {
    const allSoloBtns = Array.from(document.querySelectorAll(".solo-btn"));
    const isActive = soloBtn.classList.contains("active");
    allSoloBtns.forEach((b) => { b.classList.remove("active"); b.disabled = false; });
    if (!isActive) {
      soloBtn.classList.add("active");
      allSoloBtns.forEach((b) => { if (b !== soloBtn) b.disabled = true; });
    }
    updateSoloMask();
  });

  const deleteBtn = controlFrag.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", () => {
    const idx = Array.from(controlsScrollCol.children).indexOf(controlRow);
    if (idx === -1) return;
    controlRow.remove();
    timelineCol.children[idx]?.remove();
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

  return { controlRow, timelineRow };
}

function addClipToTrack(timelineRow, startSeconds, durationSeconds) {
  const rowInner = timelineRow.querySelector(".row-inner");

  const waveform = document.createElement("div");
  waveform.className = "waveform";
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
  rowInner.appendChild(waveform);
}

function createRecordingLane() {
  trackCount += 1;
  const { name, definition } = pickTrackName();
  const { controlRow, timelineRow } = createTrack(name, { prepend: true });
  controlRow.classList.add("recording-lane");
  timelineRow.classList.add("recording-lane");
  recordingLaneControlRow = controlRow;
  recordingLaneTimelineRow = timelineRow;
  showTrackNameTooltip(name, definition);
}

function promoteRecordingLane() {
  if (!recordingLaneTimelineRow) return;
  if (!recordingLaneTimelineRow.querySelector(".waveform")) return;

  recordingLaneControlRow.classList.remove("recording-lane");
  recordingLaneTimelineRow.classList.remove("recording-lane");
  recordingLaneControlRow = null;
  recordingLaneTimelineRow = null;

  createRecordingLane();
  timelineArea.scrollTop = 0;
  controlsScrollCol.scrollTop = 0;
  syncTimelineOverlay();
  updateSceneMask();
  updateSoloMask();
}

function onRecordStart() {
  recordingTrackRow = recordingLaneTimelineRow;
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

  const accentPrimary = style.getPropertyValue("--accent-Primary").trim();

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

  // ==========================
  // PLAYHEAD LINE
  // ==========================

  if (getTransportState() !== "IDLE") {
    const playheadX = getPlayheadX();

    rulerCtx.strokeStyle = accentPrimary;
    rulerCtx.lineWidth = 1;

    rulerCtx.beginPath();
    rulerCtx.moveTo(playheadX + 0.5, 0);
    rulerCtx.lineTo(playheadX + 0.5, height);
    rulerCtx.stroke();
  }
}

function renderMetronomeGrid() {
  const scan = document.querySelector(".metronome-scan");
  const width = scan.clientWidth;
  const tickSpacing = width / beatsPerBar;
  scan.style.backgroundImage = `repeating-linear-gradient(90deg, var(--text-button), var(--text-button) 2px, transparent 2px, transparent ${tickSpacing}px)`;
}

function renderMetronomeScan() {
  const t = getPlayheadTime(); // seconds
  const spb = secondsPerBeat(); // already defined

  const spbar = secondsPerBar();
  const phase = (t / spbar) % 1; // bar mode

  // const phase = (t / spb) % 1;   // beat mode     // 0 → 1 per beat

  const scan = document.querySelector(".metronome-scan");
  const line = scan.querySelector(".metronome-line");

  const width = scan.clientWidth;
  const x = phase * width;

  // blink at beginning of phase
  if (phase < 0.03) {
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
    });

    // (drag comes later; keep click-only for now)
    markersLayer.appendChild(markerWrap);
  }
}

// ----- Marker Transport Rendering
// ----- Marker Transport Controls
const markerAddBtn = document.getElementById("marker-add");
const markerFirstBtn = document.getElementById("marker-first");
const markerPrevBtn = document.getElementById("marker-prev");
const markerNextBtn = document.getElementById("marker-next");
const markerLastBtn = document.getElementById("marker-last");
const markerDeleteBtn = document.getElementById("marker-delete");

function renderMarkerTransport() {
  const idx = getSelectedMarkerIndex();
  const hasMarkers = markers.length > 0;

  markerFirstBtn.disabled = !hasMarkers;// || idx === 0;
  markerPrevBtn.disabled = !hasMarkers || idx <= 0;
  markerNextBtn.disabled =
    !hasMarkers || idx === -1 || idx === markers.length - 1;
  markerLastBtn.disabled = !hasMarkers || idx === markers.length - 1;
  markerDeleteBtn.disabled = idx === -1;

  const display = document.getElementById("marker-time");
  if (idx === -1) {
    display.textContent = "—";
  } else {
    display.textContent = formatTime(markers[idx].time);
  }
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

// ============================================================
// Event Handlers (Intent Layer)  -----
// ============================================================


document.querySelectorAll("[data-theme]").forEach((el) => {
  el.onclick = () => {
    document.body.setAttribute("data-theme", el.dataset.theme);
    renderTimelineLayer();
  };
});

document.querySelectorAll("[data-ruler]").forEach((el) => {
  el.onclick = () => {
    const mode = el.getAttribute("data-ruler");
    setRulerMode(mode);
  };
});

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

  const marker = {
    id: crypto.randomUUID(),
    time,
  };

  markers.push(marker);
  markers.sort((a, b) => a.time - b.time);

  selectedMarkerId = marker.id;

  renderMarkers();
  renderMarkerTransport();
});

// ----- Marker Deletion
markerDeleteBtn.addEventListener("click", () => {
  const idx = getSelectedMarkerIndex();
  if (idx === -1) return;

  // Remove the marker
  markers.splice(idx, 1);

  // Clear selection explicitly
  selectedMarkerId = null;

  // Re-render without selecting another marker
  renderMarkers();
  renderMarkerTransport();
});

markerAddBtn.addEventListener("click", () => {
  recordInteraction("marker");
  const time = currentTimeSeconds;
  const marker = { id: crypto.randomUUID(), time };
  markers.push(marker);
  markers.sort((a, b) => a.time - b.time);
  selectedMarkerId = marker.id;
  renderMarkers();
  renderMarkerTransport();
});

document.getElementById("marker-time").addEventListener("click", () => {
  const idx = getSelectedMarkerIndex();
  if (idx === -1) return;
  selectMarkerByIndex(idx);
});

markerFirstBtn.addEventListener("click", () => {
  if (!markers.length) return;
  selectMarkerByIndex(0);
});

markerPrevBtn.addEventListener("click", () => {
  const idx = getSelectedMarkerIndex();
  if (idx <= 0) return;
  selectMarkerByIndex(idx - 1);
});

markerNextBtn.addEventListener("click", () => {
  const idx = getSelectedMarkerIndex();
  if (idx === -1) return;
  selectMarkerByIndex(idx + 1);
});

markerLastBtn.addEventListener("click", () => {
  if (!markers.length) return;
  selectMarkerByIndex(markers.length - 1);
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

const globalClearBtn = document.querySelector(".transport-scene-clear");

globalClearBtn.addEventListener("click", () => {
  document.querySelectorAll("#transport-scenes .transport-scene.active")
    .forEach((btn) => btn.classList.remove("active"));
  updateSceneMask();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    globalClearBtn.click();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "d") {
    document.body.classList.toggle("debug");
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

returnToBeginningBtn.onclick = () => returnToBeginning();

playBtn.onclick = () => {
  recordInteraction("transport");
  applyTransportChange({ play: !playing, record: playing ? false : recording });
};

recordBtn.onclick = () => {
  recordInteraction("transport");
  applyTransportChange({ play: playing, record: !recording });
};


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
  currentTimeSeconds = pixelsToSeconds(x);

  if (recording) {
    updateRecordRange();
  }

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
// Initialization -----
// ============================================================

const timelineCol = document.getElementById("timeline-column");
for (let i = 0; i < trackCount; i++) {
  createTrack(pickTrackName().name);
}
createRecordingLane();

document.body.setAttribute("data-theme", "light");

updateMeter();
syncTimelineOverlayWidth();
syncTimelineOverlay();
syncTimelineMinWidth();
renderTimelineLayer();
renderTempo();
renderTimeSignature();
renderMetronomeGrid();
startOnboarding();
