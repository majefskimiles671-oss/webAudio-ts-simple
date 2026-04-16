// demo.js
// Demo - Scripted UI Demonstration - Shared Primitives + Sequence Controller -----

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

function getTrackRows() {
  return Array.from(
    document.querySelectorAll("#controls-scroll-column .control-row:not(.recording-lane)")
  );
}

// ---- Abort on Escape

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _demoCursor) {
    _demoAborted = true;
    removeDemoCursor();
  }
});

// ---- Demo Sequence

const DEMO_SEQUENCE = [
  {
    title: "Record & Mix the Chorus",
    description: "Record a chorus section with two acoustic guitar parts and a lead vocal, navigate markers, then refine the mix with gain, solo, scrubbing, and scenes.",
    run: () => runChorusDemo(),
  },
  {
    title: "Recording & Arming",
    description: "Record a long first take, then see how to arm and disarm the record button before committing to a second recording.",
    run: () => runRecordingDemo(),
  },
  {
    title: "Multiple Takes",
    description: "Record three takes of the same part, solo each one to compare, then delete the weaker takes and keep the best.",
    run: () => runTakesDemo(),
  },
  {
    title: "Record & Add Notes",
    description: "Name a track, record a clip, play it back, drop a marker, and write notes.",
    run: () => runRecordAndNotesDemo(),
  },
];

function showDemoSequencePopup(index) {
  if (index >= DEMO_SEQUENCE.length) {
    showCompletionPopup();
    return;
  }

  const demo    = DEMO_SEQUENCE[index];
  const isFirst = index === 0;

  const overlay = document.createElement("div");
  overlay.className = "demo-seq-overlay";
  overlay.innerHTML = `
    <div class="demo-seq-card">
      <p class="demo-seq-eyebrow">${isFirst ? "Welcome to BareTrack" : "Up Next"}</p>
      <p class="demo-seq-title">${demo.title}</p>
      <p class="demo-seq-description">${demo.description}</p>
      <div class="demo-seq-actions">
        <button class="demo-seq-cancel">Cancel</button>
        <button class="demo-seq-skip">Skip</button>
        <button class="demo-seq-run">Show Demo</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector(".demo-seq-cancel").addEventListener("click", () => {
    overlay.remove();
  });

  overlay.querySelector(".demo-seq-skip").addEventListener("click", () => {
    overlay.remove();
    showDemoSequencePopup(index + 1);
  });

  overlay.querySelector(".demo-seq-run").addEventListener("click", async () => {
    overlay.remove();
    await demo.run();
    showDemoSequencePopup(index + 1);
  });
}

function showDemoComplete() {
  const overlay = document.createElement("div");
  overlay.className = "demo-seq-overlay";
  overlay.innerHTML = `
    <div class="demo-seq-card">
      <p class="demo-seq-eyebrow">Finished</p>
      <p class="demo-seq-title">Demo complete.</p>
      <p class="demo-seq-description">Now it's your turn — the controls are all yours.</p>
      <div class="demo-seq-actions">
        <button class="demo-seq-run">Got it</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".demo-seq-run").addEventListener("click", () => overlay.remove());
}

function showCompletionPopup() {
  const overlay = document.createElement("div");
  overlay.className = "demo-seq-overlay";
  overlay.innerHTML = `
    <div class="demo-seq-card">
      <p class="demo-seq-eyebrow">All done!</p>
      <p class="demo-seq-title">You've seen everything.</p>
      <p class="demo-seq-description">You can replay any demo from the View menu whenever you like.</p>
      <div class="demo-seq-actions">
        <button class="demo-seq-run">Got it</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".demo-seq-run").addEventListener("click", () => overlay.remove());
}

// Legacy single-demo intro (used by individual menu items)
function showDemoIntro(description, onConfirm) {
  clearTimeout(_sequenceAutoStartId);
  _sequenceAutoStartId = null;
  document.querySelectorAll(".demo-seq-overlay").forEach(el => el.remove());
  const overlay = document.createElement("div");
  overlay.className = "demo-seq-overlay";
  overlay.innerHTML = `
    <div class="demo-seq-card">
      <p class="demo-seq-description">${description}</p>
      <div class="demo-seq-actions">
        <button class="demo-seq-cancel">Cancel</button>
        <button class="demo-seq-run">Run Demo</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".demo-seq-run").addEventListener("click", () => { overlay.remove(); onConfirm(); });
  overlay.querySelector(".demo-seq-cancel").addEventListener("click", () => overlay.remove());
}

// ---- Startup + Menu Wiring

let _sequenceAutoStartId = null;

document.addEventListener("DOMContentLoaded", () => {
  // Auto-start the sequence after a short pause
  _sequenceAutoStartId = setTimeout(() => showDemoSequencePopup(0), 3000);

  // Individual menu items
  async function runAndComplete(fn) {
    try { await fn(); } catch(e) { console.error("Demo error:", e); }
    showDemoComplete();
  }

  document.getElementById("run-demo-chorus").addEventListener("click", () =>
    showDemoIntro(DEMO_SEQUENCE[0].description, () => runAndComplete(runChorusDemo))
  );
  document.getElementById("run-demo-recording").addEventListener("click", () =>
    showDemoIntro(DEMO_SEQUENCE[1].description, () => runAndComplete(runRecordingDemo))
  );
  document.getElementById("run-demo-takes").addEventListener("click", () =>
    showDemoIntro(DEMO_SEQUENCE[2].description, () => runAndComplete(runTakesDemo))
  );
  document.getElementById("run-demo-record-and-notes").addEventListener("click", () =>
    showDemoIntro(DEMO_SEQUENCE[3].description, () => runAndComplete(runRecordAndNotesDemo))
  );
});
