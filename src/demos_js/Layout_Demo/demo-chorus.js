// demo-chorus.js
// Demo - Record & Mix the Chorus - Script -----
//
// Story: We record a chorus section — two acoustic guitar parts and a lead vocal —
// using markers and the notes panel, then refine the mix with gain, solo, scrubbing,
// and scenes.

async function runChorusDemo() {
  _demoAborted = false;

  const recordBtn    = document.getElementById("recordBtn");
  const playBtn      = document.getElementById("playBtn");
  const returnBtn    = document.getElementById("returnToBeginningBtn");
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
  await wait(400);

  // Add a second marker here for the vocal end point
  await demoClick(markerAddBtn);
  await wait(400);

  const voxMarkerRow = document.querySelector(".panel-marker-row.selected");
  if (voxMarkerRow && !_demoAborted) {
    const ta = voxMarkerRow.querySelector(".panel-marker-note");
    await demoTypeTextarea(ta, "Vox phrase ends — might need punch-in at bridge");
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 4 — Navigate the marker panel
  // ----------------------------------------------------------------

  function getPanelTimes() {
    return Array.from(document.querySelectorAll(".panel-marker-time"));
  }

  // Navigate to origin (first marker in panel)
  let pts = getPanelTimes();
  if (pts.length >= 1 && !_demoAborted) {
    await demoClick(pts[0]);
    await wait(600);
  }

  // Navigate to the 4-bar default marker
  pts = getPanelTimes();
  if (pts.length >= 2 && !_demoAborted) {
    await demoClick(pts[1]);
    await wait(600);
  }

  // Navigate to the 8-bar default marker
  pts = getPanelTimes();
  if (pts.length >= 3 && !_demoAborted) {
    await demoClick(pts[2]);
    await wait(600);
  }

  // Navigate to the Gtr 1 marker we added after recording
  pts = getPanelTimes();
  if (pts.length >= 4 && !_demoAborted) {
    await demoClick(pts[3]);
    await wait(600);
  }

  // Navigate to the Vox 1 marker we just added
  pts = getPanelTimes();
  if (pts.length >= 5 && !_demoAborted) {
    await demoClick(pts[4]);
    await wait(600);
  }

  // Delete the selected (Vox 1) marker to show notes merging into the Gtr 1 marker
  const markerDeleteBtn = document.getElementById("marker-delete");
  if (markerDeleteBtn && !markerDeleteBtn.disabled && !_demoAborted) {
    await demoClick(markerDeleteBtn);
    await wait(700);
  }

  await wait(500);

  // ----------------------------------------------------------------
  // PART 5 — Full playback: hear everything together
  // ----------------------------------------------------------------

  const trackRows = getTrackRows();
  if (!trackRows.length) {
    removeDemoCursor();
    return;
  }

  await demoClick(returnBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(3000);
  await demoClick(playBtn);
  await wait(500);

  // ----------------------------------------------------------------
  // PART 6 — Solo the first track, listen, unsolo
  // ----------------------------------------------------------------

  const soloBtn0 = trackRows[0]?.querySelector(".solo-btn");
  if (soloBtn0 && !_demoAborted) {
    await demoClick(soloBtn0);   // solo on
    await wait(300);
    await demoClick(returnBtn);
    await wait(200);
    await demoClick(playBtn);
    await wait(2000);
    await demoClick(playBtn);
    await wait(400);
    await demoClick(soloBtn0);   // solo off
    await wait(400);
  }

  // ----------------------------------------------------------------
  // PART 7 — Gain tweaking
  // ----------------------------------------------------------------

  const gainSlider1 = trackRows[1]?.querySelector("gain-slider");
  if (gainSlider1 && !_demoAborted) {
    await demoAnimateGain(gainSlider1, 58);
    await wait(400);
  }

  const gainSlider0 = trackRows[0]?.querySelector("gain-slider");
  if (gainSlider0 && !_demoAborted) {
    await demoAnimateGain(gainSlider0, 90);
    await wait(400);
  }

  // ----------------------------------------------------------------
  // PART 8 — Navigate to a marker via the transport dropdown
  // ----------------------------------------------------------------

  const markerTimeDisplay = document.getElementById("marker-time");
  if (markerTimeDisplay && !_demoAborted) {
    await demoClick(markerTimeDisplay);  // open dropdown
    await wait(800);

    const dropdownItem = document.querySelector(
      "#marker-dropdown .marker-dropdown-item:not(.marker-dropdown-playhead):not(.marker-dropdown-selected)"
    );
    if (dropdownItem && !_demoAborted) {
      await demoClick(dropdownItem);
      await wait(500);
    }
  }

  // ----------------------------------------------------------------
  // PART 9 — Scrub around the timeline
  // ----------------------------------------------------------------

  await demoScrubTo(secondsPerBar() * 2);
  await wait(300);
  await demoScrubTo(secondsPerBar() * 6);
  await wait(300);
  await demoClick(returnBtn);
  await wait(400);

  // ----------------------------------------------------------------
  // PART 10 — Scenes: assign guitar tracks to Scene A, leave Vox out
  // ----------------------------------------------------------------

  const gtr1Row   = trackRows.length >= 3 ? trackRows[2] : trackRows[trackRows.length - 1];
  const gtr1SceneA = gtr1Row?.querySelector(".track-scene");
  if (gtr1SceneA && !_demoAborted) {
    await demoClick(gtr1SceneA);
    await wait(300);
  }

  const gtr2Row   = trackRows.length >= 2 ? trackRows[1] : null;
  const gtr2SceneA = gtr2Row?.querySelector(".track-scene");
  if (gtr2SceneA && !_demoAborted) {
    await demoClick(gtr2SceneA);
    await wait(300);
  }

  const globalSceneA = document.querySelector("#transport-scenes .transport-scene");
  if (globalSceneA && !_demoAborted) {
    await demoClick(globalSceneA);  // guitar-only visible
    await wait(500);

    await demoClick(returnBtn);
    await wait(300);
    await demoClick(playBtn);
    await wait(2000);
    await demoClick(playBtn);
    await wait(500);

    await demoClick(globalSceneA);  // deactivate
    await wait(400);
  }

  await demoClick(returnBtn);
  await wait(500);
  removeDemoCursor();
}
