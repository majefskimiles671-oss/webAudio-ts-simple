// demo-auto-calibrate.js
// Demo - Auto-Calibrate Latency -----
//
// Story: Open the Debug menu, click "Calibrate Latency…", then hover over
// "Auto-Calibrate" so the user sees where the feature lives and what to click.

async function runAutoCalibrateDemo() {
  _demoAborted = false;

  // ----------------------------------------------------------------
  // PART 1 — Move cursor to Debug menu label
  // ----------------------------------------------------------------

  const debugMenuBtn = Array.from(document.querySelectorAll(".menu-label"))
    .find(el => el.textContent.trim() === "Tools");

  if (!debugMenuBtn || _demoAborted) return;

  const debugMenu = debugMenuBtn.closest(".menu");

  const start = getCenter(debugMenuBtn);
  createDemoCursor(start.x, start.y);
  await wait(400);

  await moveTo(debugMenuBtn);
  await wait(300);

  // ----------------------------------------------------------------
  // PART 2 — Force menu open, move to "Calibrate Latency…" and click
  // ----------------------------------------------------------------

  debugMenu.classList.add("keyboard-open");
  await wait(300);

  const calibrateMenuItem = document.getElementById("menu-calibrate-latency");
  if (!calibrateMenuItem || _demoAborted) { debugMenu.classList.remove("keyboard-open"); removeDemoCursor(); return; }

  await moveTo(calibrateMenuItem);
  await wait(300);

  if (_demoAborted) { debugMenu.classList.remove("keyboard-open"); removeDemoCursor(); return; }

  debugMenu.classList.remove("keyboard-open");
  calibrateMenuItem.click();
  debugMenu.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  await wait(600);

  // ----------------------------------------------------------------
  // PART 3 — Move to "Auto-Calibrate" button and pause on it
  // ----------------------------------------------------------------

  const runBtn = document.getElementById("calibrate-run-btn");
  if (!runBtn || _demoAborted) { removeDemoCursor(); return; }

  await moveTo(runBtn);
  await wait(2400);

  // ----------------------------------------------------------------
  // PART 4 — Hover over the Set button
  // ----------------------------------------------------------------

  if (_demoAborted) { removeDemoCursor(); return; }

  const setBtn = document.getElementById("calibrate-manual-set-btn");
  if (setBtn) {
    await moveTo(setBtn);
    await wait(1500);
  }

  // ----------------------------------------------------------------
  // PART 5 — Close the dialog
  // ----------------------------------------------------------------

  if (_demoAborted) { removeDemoCursor(); return; }

  const closeBtn = document.getElementById("calibrate-close-btn");
  if (closeBtn) await demoClick(closeBtn);

  await wait(400);
  removeDemoCursor();
}
