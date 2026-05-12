// demo-bus-latency.js
// Demo - Setting Bus Latency by Ear -----
//
// Story: Turn on the metronome, hit play, then nudge Bus Latency until the
// click sounds in sync with what you hear coming out of your interface.

function ensureBottomPanelOpen() {
  if (document.body.classList.contains("hide-bottom-panel")) {
    document.getElementById("toggle-bottom-panel").click();
  }
}

function ensureAdvancedExpanded() {
  for (const lbl of document.querySelectorAll(".master-group-label")) {
    if (lbl.textContent.trim() === "Advanced") {
      const group = lbl.closest(".master-group");
      if (group.classList.contains("collapsed")) lbl.click();
      for (const heading of group.querySelectorAll(".master-heading")) {
        if (heading.textContent.trim() === "Latency Correction") {
          const section = heading.closest(".master-section");
          if (section && section.classList.contains("collapsed")) {
            heading.closest(".master-section-header").click();
          }
          break;
        }
      }
      break;
    }
  }
}

async function runBusLatencyDemo() {
  _demoAborted = false;

  const playBtn   = document.getElementById("playBtn");
  const returnBtn = document.getElementById("returnToBeginningBtn");

  // ----------------------------------------------------------------
  // PART 1 — Open bottom panel, expand Metronome, turn click ON
  // ----------------------------------------------------------------

  ensureBottomPanelOpen();
  await wait(400);

  // Expand the Metronome group
  for (const lbl of document.querySelectorAll(".master-group-label")) {
    if (lbl.textContent.trim() === "Metronome") {
      const group = lbl.closest(".master-group");
      if (group.classList.contains("collapsed")) lbl.click();
      break;
    }
  }
  await wait(400);

  const metronomeToggle = document.getElementById("metronome-toggle");
  const metClickPlay    = document.getElementById("metronome-click-play");

  // Ensure "Click while playing" is checked
  if (metClickPlay && !metClickPlay.checked) {
    metClickPlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  const start = getCenter(metronomeToggle);
  createDemoCursor(start.x + 140, start.y + 80);
  await wait(500);

  // Turn metronome on if not already
  if (!metronomeIsEnabled()) {
    await demoClick(metronomeToggle);
  } else {
    await moveTo(metronomeToggle);
  }
  await wait(400);

  // ----------------------------------------------------------------
  // PART 2 — Hit play so the click starts
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(300);
  await demoClick(playBtn);
  await wait(1200);

  // ----------------------------------------------------------------
  // PART 3 — Navigate to Advanced → Latency Correction
  // ----------------------------------------------------------------

  ensureAdvancedExpanded();

  const busSlider = document.getElementById("bus-latency");
  busSlider.scrollIntoView({ behavior: "smooth", block: "nearest" });
  await wait(700);

  // ----------------------------------------------------------------
  // PART 4 — Slowly nudge Bus slider up, as if listening and adjusting
  // ----------------------------------------------------------------

  await moveTo(busSlider);
  await wait(500);

  // Nudge up in small steps with pauses — simulates someone listening and tweaking
  const steps = [8, 16, 24, 32, 40];
  for (const val of steps) {
    if (_demoAborted) break;
    busSlider.value = val;
    busSlider.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(600);
  }

  await wait(1000);

  // ----------------------------------------------------------------
  // PART 5 — Stop playback, reset slider to 0, turn metronome back off
  // ----------------------------------------------------------------

  await demoClick(playBtn);
  await wait(500);

  // Reset slider
  busSlider.value = 0;
  busSlider.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(300);

  // Turn metronome back off
  if (metronomeIsEnabled()) {
    await demoClick(metronomeToggle);
  }

  await wait(400);
  removeDemoCursor();
}
