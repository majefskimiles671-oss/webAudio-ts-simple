// demo-building-chorus.js
// Demo - Building the Chorus - Script -----
//
// Story: We record a chorus section — two acoustic guitar parts and a lead vocal —
// using the recording lane, marker add button, ruler clicks, and the notes panel.

async function runBuildingChorusDemo() {
  _demoAborted = false;

  const recordBtn   = document.getElementById("recordBtn");
  const playBtn     = document.getElementById("playBtn");
  const returnBtn   = document.getElementById("returnToBeginningBtn");
  const markerAddBtn = document.getElementById("marker-add");

  const start = getCenter(returnBtn);
  createDemoCursor(start.x + 100, start.y + 80);
  await wait(500);

  // ----------------------------------------------------------------
  // PART 1 — Record Acoustic Gtr 1
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);

  await demoClick(recordBtn);   // arm
  await wait(500);
  await demoClick(playBtn);     // start
  await wait(3200);             // playing / recording
  await demoClick(playBtn);     // stop — promotes lane
  await wait(600);

  // Rename promoted track
  const rows1 = getTrackRows();
  if (rows1.length && !_demoAborted) {
    await demoType(rows1[0].querySelector(".track-title"), "Acoustic Gtr 1");
  }
  await wait(400);

  // Add a marker at the current playhead position via the transport button
  await demoClick(markerAddBtn);
  await wait(400);

  // Add a note to it in the panel
  const selectedRow1 = document.querySelector(".panel-marker-row.selected");
  if (selectedRow1 && !_demoAborted) {
    const ta = selectedRow1.querySelector(".panel-marker-note");
    await demoTypeTextarea(ta, "End of Gtr 1 — sounds good, keep energy up");
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 2 — Record Acoustic Gtr 2
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);

  await demoClick(recordBtn);
  await wait(500);
  await demoClick(playBtn);
  await wait(2800);
  await demoClick(playBtn);
  await wait(600);

  const rows2 = getTrackRows();
  if (rows2.length && !_demoAborted) {
    await demoType(rows2[0].querySelector(".track-title"), "Acoustic Gtr 2");
  }
  await wait(400);

  // Navigate to origin marker via the notes panel to add context
  const originPanelTime = document.querySelector(".panel-marker-time");
  if (originPanelTime && !_demoAborted) {
    await demoClick(originPanelTime);
    await wait(400);
  }

  const originRow = document.querySelector(".panel-marker-row.selected");
  if (originRow && !_demoAborted) {
    const ta = originRow.querySelector(".panel-marker-note");
    if (!ta.value) {
      await demoTypeTextarea(ta, "Chorus starts here — full band arrangement");
    }
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 3 — Record Vox 1
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);

  await demoClick(recordBtn);
  await wait(500);
  await demoClick(playBtn);
  await wait(2500);
  await demoClick(playBtn);
  await wait(600);

  const rows3 = getTrackRows();
  if (rows3.length && !_demoAborted) {
    await demoType(rows3[0].querySelector(".track-title"), "Vox 1");
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 4 — Marker work: navigate, view notes, delete to merge
  // ----------------------------------------------------------------

  // Click the 4-bar marker time in the panel to navigate to it
  const panelTimes = document.querySelectorAll(".panel-marker-time");
  if (panelTimes.length > 1 && !_demoAborted) {
    await demoClick(panelTimes[1]);
    await wait(500);
  }

  // Show the marker time display in the transport (open dropdown)
  const markerTimeDisplay = document.getElementById("marker-time");
  if (markerTimeDisplay && !_demoAborted) {
    await demoClick(markerTimeDisplay);
    await wait(300);
    // Close it by pressing Escape or waiting for outside click — just wait
    await wait(600);
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(400);
  }

  // Delete the 4-bar marker (if it's not the origin) to show notes merging
  const markerDeleteBtn = document.getElementById("marker-delete");
  if (markerDeleteBtn && !markerDeleteBtn.disabled && !_demoAborted) {
    await demoClick(markerDeleteBtn);
    await wait(600);
  }

  await wait(500);
  removeDemoCursor();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("run-demo-building-chorus").addEventListener("click", () =>
    showDemoIntro(
      "We'll record a chorus with two acoustic guitar parts and a lead vocal, using markers and the notes panel to stay organized as we go.",
      runBuildingChorusDemo
    )
  );
});
