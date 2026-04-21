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

  // Collect all panel marker time labels (sorted top-to-bottom = sorted by time)
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

  await wait(400);
  removeDemoCursor();
}
