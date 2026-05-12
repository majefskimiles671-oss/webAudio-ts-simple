// demo-rec-offset.js
// Demo - Recording with the Metronome and Adjusting Bus Latency -----
//
// Story: Turn on the metronome, record a short take, stop, then open
// Advanced controls and nudge the Bus Latency slider to show how to
// align the click with existing recorded audio.

async function runRecOffsetDemo() {
  _demoAborted = false;

  const returnBtn = document.getElementById("returnToBeginningBtn");
  const playBtn   = document.getElementById("playBtn");
  const recordBtn = document.getElementById("captureBtn");

  // ----------------------------------------------------------------
  // PART 1 — Open bottom panel, expand Metronome, turn click ON
  // ----------------------------------------------------------------

  ensureBottomPanelOpen();
  await wait(400);

  for (const lbl of document.querySelectorAll(".master-group-label")) {
    if (lbl.textContent.trim() === "Metronome") {
      const group = lbl.closest(".master-group");
      if (group.classList.contains("collapsed")) lbl.click();
      break;
    }
  }
  await wait(400);

  const metClickRec = document.getElementById("metronome-click-rec");

  if (metClickRec && !metClickRec.checked) {
    metClickRec.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  const start = getCenter(returnBtn);
  createDemoCursor(start.x, start.y);
  await wait(500);

  // ----------------------------------------------------------------
  // PART 2 — Return to beginning, hit Record
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(300);
  await demoClick(recordBtn);
  await wait(7500);

  // ----------------------------------------------------------------
  // PART 3 — Stop recording
  // ----------------------------------------------------------------

  await demoClick(recordBtn);
  await wait(600);

  // ----------------------------------------------------------------
  // PART 4 — Return to beginning and play back
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(300);
  await demoClick(playBtn);
  await wait(2500);

  // ----------------------------------------------------------------
  // PART 5 — Navigate to Advanced → Latency Correction → Bus slider
  // ----------------------------------------------------------------

  ensureAdvancedExpanded();

  const busSlider = document.getElementById("bus-latency");
  busSlider.scrollIntoView({ behavior: "smooth", block: "nearest" });
  await wait(700);

  await moveTo(busSlider);
  await wait(500);

  // ----------------------------------------------------------------
  // PART 6 — Nudge Bus slider up in steps, as if listening and adjusting
  // ----------------------------------------------------------------

  const steps = [8, 16, 24, 32, 40];
  for (const val of steps) {
    if (_demoAborted) break;
    busSlider.value = val;
    busSlider.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(600);
  }

  await wait(1000);

  // ----------------------------------------------------------------
  // PART 7 — Stop playback and reset slider to 0
  // ----------------------------------------------------------------

  await demoClick(playBtn);
  await wait(400);

  // ----------------------------------------------------------------
  // PART 8 — Reset slider to 0
  // ----------------------------------------------------------------

  busSlider.value = 0;
  busSlider.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(400);
  removeDemoCursor();
}
