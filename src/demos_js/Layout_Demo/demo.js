// demo.js
// Demo - Scripted UI Demonstration - Component -----

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
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  _demoCursor = el;
}

function removeDemoCursor() {
  _demoCursor?.remove();
  _demoCursor = null;
}

// ---- Primitives

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

// ---- Demo Sequences

async function runDemo() {
  _demoAborted = false;

  const recordBtn = document.getElementById("recordBtn");
  const playBtn   = document.getElementById("playBtn");

  // Start cursor near record button, slightly offset so movement is visible
  const start = getCenter(recordBtn);
  createDemoCursor(start.x - 120, start.y + 60);

  await wait(400);

  // Step 1: click record
  await demoClick(recordBtn);
  await wait(600);

  // Step 2: click play
  await demoClick(playBtn);
  await wait(5000);

  // Step 3: click play again to stop
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

// ---- Menu Wiring (runs after DOM is ready since this script loads before index.js)

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("run-demo").addEventListener("click", runDemo);
});
