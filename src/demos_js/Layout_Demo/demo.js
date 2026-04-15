// demo.js
// Demo - Scripted UI Demonstration - Shared Primitives -----

// Cursor SVG — classic arrow, hotspot at top-left tip
const CURSOR_SVG = `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 2 L3 17 L6.5 13.5 L9 19.5 L11.5 18.5 L9 12.5 L14 12.5 Z"
        fill="white" stroke="#222" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

let _demoCursor = null;
let _demoAborted = false;

// ---- Cursor Lifecycle

function createDemoCursor(x, y) {
  removeDemoCursor();
  const el = document.createElement("div");
  el.id = "demo-cursor";
  el.innerHTML = CURSOR_SVG;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  document.body.appendChild(el);
  _demoCursor = el;
}

function removeDemoCursor() {
  _demoCursor?.remove();
  _demoCursor = null;
}

// ---- Core Primitives

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function moveTo(el, duration = 650) {
  if (_demoAborted || !_demoCursor) return;
  const { x, y } = getCenter(el);
  _demoCursor.style.transition =
    `left ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94),` +
    `top  ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
  _demoCursor.style.left = `${x}px`;
  _demoCursor.style.top  = `${y}px`;
  await wait(duration);
}

async function demoClick(el) {
  if (_demoAborted) return;
  await moveTo(el);
  await wait(180);
  if (_demoAborted) return;
  _demoCursor.classList.add("demo-cursor-clicking");
  await wait(140);
  el.click();
  await wait(140);
  _demoCursor?.classList.remove("demo-cursor-clicking");
}

// ---- Higher-level Interaction Utilities

// Type text character-by-character into a contenteditable element
async function demoType(el, text, msPerChar = 75) {
  if (_demoAborted) return;
  await moveTo(el);
  await wait(200);
  el.focus();
  el.textContent = "";
  for (const char of text) {
    if (_demoAborted) return;
    el.textContent += char;
    await wait(msPerChar + Math.random() * 30);
  }
  await wait(350);
  el.blur();
  await wait(250);
}

// Type text into a <textarea>, firing input events so auto-expand works
async function demoTypeTextarea(el, text, msPerChar = 65) {
  if (_demoAborted) return;
  await moveTo(el);
  await wait(200);
  el.focus();
  for (const char of text) {
    if (_demoAborted) return;
    el.value += char;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(msPerChar + Math.random() * 25);
  }
  await wait(300);
}

// Smoothly animate a gain-slider custom element to a target value
async function demoAnimateGain(gainEl, targetValue, duration = 900) {
  if (_demoAborted) return;
  await moveTo(gainEl);
  await wait(200);
  const startValue = gainEl.value;
  const startTime  = performance.now();
  await new Promise((resolve) => {
    function step() {
      const t = Math.min(1, (performance.now() - startTime) / duration);
      gainEl.value = startValue + (targetValue - startValue) * t;
      if (t < 1 && !_demoAborted) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

// Scrub the playhead to a time position by simulating a timeline click
async function demoScrubTo(seconds) {
  if (_demoAborted) return;
  const timelineArea  = document.getElementById("timeline-area");
  const timelineInner = document.getElementById("timeline-inner");

  const targetPx  = seconds * BASE_PPS * zoom;
  const innerRect = timelineInner.getBoundingClientRect();
  const areaRect  = timelineArea.getBoundingClientRect();

  const clientX = Math.max(areaRect.left + 10, Math.min(areaRect.right - 10, innerRect.left + targetPx));
  const clientY = areaRect.top + areaRect.height * 0.4;

  if (_demoCursor) {
    _demoCursor.style.transition = "left 700ms cubic-bezier(0.25,0.46,0.45,0.94), top 700ms cubic-bezier(0.25,0.46,0.45,0.94)";
    _demoCursor.style.left = `${clientX}px`;
    _demoCursor.style.top  = `${clientY}px`;
    await wait(750);
  }

  timelineArea.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX, clientY }));
  await wait(80);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await wait(200);
}

// Returns promoted (non-recording-lane) control rows, top-first
function getTrackRows() {
  return Array.from(
    document.querySelectorAll("#controls-scroll-column .control-row:not(.recording-lane)")
  );
}

// ---- Intro Popup

function showDemoIntro(description, onConfirm) {
  const overlay = document.createElement("div");
  overlay.id = "demo-intro-overlay";
  overlay.innerHTML = `
    <div id="demo-intro-card">
      <p id="demo-intro-text">${description}</p>
      <div id="demo-intro-actions">
        <button id="demo-intro-cancel">Cancel</button>
        <button id="demo-intro-run">Run Demo</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#demo-intro-run").addEventListener("click", () => { overlay.remove(); onConfirm(); });
  overlay.querySelector("#demo-intro-cancel").addEventListener("click", () => overlay.remove());
}

// ---- Basic Record/Play Demo

async function runDemo() {
  _demoAborted = false;
  const recordBtn = document.getElementById("recordBtn");
  const playBtn   = document.getElementById("playBtn");
  const start = getCenter(recordBtn);
  createDemoCursor(start.x - 120, start.y + 60);
  await wait(400);
  await demoClick(recordBtn);
  await wait(600);
  await demoClick(playBtn);
  await wait(5000);
  await demoClick(playBtn);
  await wait(600);
  removeDemoCursor();
}

// ---- Abort on Escape

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _demoCursor) {
    _demoAborted = true;
    removeDemoCursor();
  }
});

// ---- Menu Wiring

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("run-demo").addEventListener("click", () =>
    showDemoIntro(
      "A scripted cursor will arm the track for recording, start playback, then stop after a few seconds.",
      runDemo
    )
  );
});
