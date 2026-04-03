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
let beatsPerBar = 4; // time signature numerator

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

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const t = Math.floor((s * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${t}`;
}

function computeWaveformWidth(seconds) {
  return Math.floor(seconds * BASE_PPS * zoom);
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
  const wasRecording = recording;

  playing = play;
  recording = record;

  const nextState = getTransportState();

  if (prevState === "IDLE" && nextState !== "IDLE") {
    onTransportStart();
  }

  if (prevState !== "IDLE" && nextState === "IDLE") {
    // if (!isScrubbing) {
    //     resetPlayhead();
    // }
  }

  if (!wasRecording && recording) startRecordingRange();
  if (wasRecording && !recording) clearRecordingRange();

  syncTransportUI();
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

    while (barTime <= endSeconds) {
      // Major bar tick
      ticks.push({
        time: barTime,
        major: true,
        label: `Bar ${firstBar + 1 + (barTime - firstBar * barLen) / barLen}`,
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

function renderMetronomeScan() {
  if (getTransportState() === "IDLE") return;

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

function rerenderWaveforms() {
  /**
   * Make sure that every time you draw a waveform you do this first:
   * canvas.height = TRACK_HEIGHT;          // e.g. 80
   * canvas.style.height = `${TRACK_HEIGHT}px`;
   **/
  document.querySelectorAll(".timeline-row").forEach((row, i) => {
    const canvas = row.querySelector(".waveform-canvas");
    if (!canvas) return;

    const durationSeconds = 10 + i * 5;
    const waveformWidth = computeWaveformWidth(durationSeconds);

    const TRACK_HEIGHT = 80;
    canvas.width = waveformWidth;
    canvas.height = TRACK_HEIGHT;

    // Optional: redraw a fake waveform

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // ctx.fillStyle = "#666";
    // ctx.fillRect(0, canvas.height / 2, canvas.width, 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
}

// ============================================================
// DOM Sync (Synchronization Layer) -----
// ============================================================

// transport
const playBtn = document.getElementById("playBtn");
const playRecordBtn = document.getElementById("playRecordBtn");
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
  playRecordBtn.classList.toggle("active", state === "PLAY_RECORD");
  meter.classList.toggle(
    "active",
    state === "RECORD" || state === "PLAY_RECORD",
  );

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

// ============================================================
// Event Handlers (Intent Layer)  -----
// ============================================================

// solo buttons
function setupSoloBtns() {
  const soloButtons = Array.from(document.querySelectorAll(".solo-btn"));
  soloButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const isActive = btn.classList.contains("active");

      // Reset all
      soloButtons.forEach((b) => {
        b.classList.remove("active");
        b.disabled = false;
      });

      // If clicked button was not active, activate it and disable others
      if (!isActive) {
        btn.classList.add("active");
        soloButtons.forEach((b) => {
          if (b !== btn) b.disabled = true;
        });
      }
    });
  });
}

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
  const raw = tempoEl.textContent.replace(/\D/g, "");
  const next = parseInt(raw, 10);

  if (!Number.isNaN(next)) {
    tempoBPM = Math.min(300, Math.max(30, next));
  }

  bpm = tempoBPM;
  renderTempo();
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

  timeSignature = { beats, noteValue };

  // timeSigBtn.textContent = `${beats}/${noteValue}`;
  renderTimeSignature();
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

// linked toggle behavior
transportToggles.forEach((btn) => {
  btn.addEventListener("click", () => {
    transportToggles.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

const globalClearBtn = document.querySelector(".transport-scene-clear");

globalClearBtn.addEventListener("click", () => {
  // 1. Clear UI state
  document
    .querySelectorAll(".transport-scene.active")
    .forEach((btn) => btn.classList.remove("active"));

  // 2. Clear core state
  //   activeGlobalScene = null;

  // 3. Update track audibility
  //   updateSceneMask();
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
  // ----- Preserve Center Time
  const centerTime = timelineArea.scrollLeft / (BASE_PPS * zoom);

  // ----- Update Zoom
  zoomIndex = parseInt(zoomSlider.value, 10);
  zoom = zoomLevels[zoomIndex];

  // ----- Re-render Timeline
  rerenderWaveforms();
  syncTimelineOverlay();
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

playBtn.onclick = () =>
  applyTransportChange({ play: !playing, record: recording });

recordBtn.onclick = () =>
  applyTransportChange({ play: playing, record: !recording });

playRecordBtn.onclick = () =>
  applyTransportChange({
    play: getTransportState() !== "PLAY_RECORD",
    record: getTransportState() !== "PLAY_RECORD",
  });

// ----- Scrub Handlers
timelineArea.addEventListener("mousedown", (e) => {
  if (recording) return;

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

// ============================================================
// Initialization -----
// ============================================================

const timelineCol = document.getElementById("timeline-column");
for (let i = 0; i < 8; i++) {
  /* ----- Controls Row ----- */
  const controlTpl = document.getElementById("control-row-template");
  const controlFrag = controlTpl.content.cloneNode(true);
  const controlRow = controlFrag.querySelector(".control-row");
  const title = controlFrag.querySelector(".track-title");
  const soloBtn = controlFrag.querySelector(".solo-btn");

  title.textContent = `Track ${i + 1}`;
  title.spellcheck = false;

  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    }
  });

  title.addEventListener("blur", () => {
    const t = title.textContent.trim();
    title.textContent = t === "" ? `Track ${i + 1}` : t;
  });

  controlFrag.querySelectorAll(".track-scene").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
    });
  });

  //scenes

  controlFrag
    .querySelector(".track-scene-clear")
    .addEventListener("click", (e) => {
      const row = e.currentTarget.closest(".control-row");

      row
        .querySelectorAll(".track-scene.active")
        .forEach((btn) => btn.classList.remove("active"));
    });

  controlsScrollCol.appendChild(controlFrag);

  /* ----- Timeline Row ----- */

  const timelineTpl = document.getElementById("timeline-row-template");
  const timelineFrag = timelineTpl.content.cloneNode(true);
  const timelineRow = timelineFrag.querySelector(".timeline-row");
  const canvas = timelineFrag.querySelector(".waveform-canvas");

  const trackDurationSeconds = 10 + i * 5;
  canvas.width = computeWaveformWidth(trackDurationSeconds);

  timelineCol.appendChild(timelineFrag);

  /* ----- Height Sync ----- */

  const ro = new ResizeObserver(([e]) => {
    controlRow.style.height = `${e.contentRect.height}px`;
  });

  ro.observe(timelineRow);
}

document.body.setAttribute("data-theme", "light");
setupSoloBtns();
updateMeter();
syncTimelineOverlayWidth();
syncTimelineOverlay();
renderTimelineLayer();
renderTempo();
renderTimeSignature();
