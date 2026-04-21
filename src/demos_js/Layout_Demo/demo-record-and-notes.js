// demo-record-and-notes.js
// Demo - Record and Add Notes - Script -----

const NOTE_TEXT =
  "I love you\nand you love me\nbut we don't speak the same language\nexcept the language of love";

async function runRecordAndNotesDemo() {
  _demoAborted = false;

  const recordBtn    = document.getElementById("recordBtn");
  const playBtn      = document.getElementById("playBtn");
  const returnBtn    = document.getElementById("returnToBeginningBtn");
  const markerAddBtn = document.getElementById("marker-add");

  const start = getCenter(recordBtn);
  createDemoCursor(start.x - 100, start.y + 80);
  await wait(500);

  // ---- Step 1: Rename the recording lane track
  const laneTitle = document.querySelector(".recording-lane.control-row .track-title");
  if (laneTitle && !_demoAborted) {
    await demoType(laneTitle, "Chorus Vox - take 1");
  }
  await wait(400);

  // ---- Step 2: Record for 5 seconds
  await demoClick(recordBtn);  // arm
  await wait(500);
  await demoClick(playBtn);    // start
  await wait(5000);
  await demoClick(playBtn);    // stop
  await wait(700);

  // ---- Step 3: Return to beginning
  await demoClick(returnBtn);
  await wait(400);

  // ---- Step 4: Start playback, wait 2 seconds
  await demoClick(playBtn);
  await wait(2000);

  // ---- Step 5: Add a marker at the current playhead
  await demoClick(markerAddBtn);
  await wait(400);

  // Type the note into the selected marker's textarea
  const selectedRow = document.querySelector(".panel-marker-row.selected");
  if (selectedRow && !_demoAborted) {
    const ta = selectedRow.querySelector(".panel-marker-note");
    await demoTypeTextarea(ta, NOTE_TEXT, 55);
  }

  await wait(600);

  // Stop playback
  if (document.getElementById("playBtn").classList.contains("active")) {
    await demoClick(playBtn);
    await wait(400);
  }

  // ---- Step 6: Delete the track
  const promotedRows = getTrackRows();
  if (promotedRows.length && !_demoAborted) {
    const deleteBtn = promotedRows[0].querySelector(".delete-btn");
    if (deleteBtn) {
      await demoClick(deleteBtn);
      await wait(500);
    }
  }

  // ---- Step 7: Delete the selected marker
  const markerDeleteBtn = document.getElementById("marker-delete");
  if (markerDeleteBtn && !markerDeleteBtn.disabled && !_demoAborted) {
    await demoClick(markerDeleteBtn);
    await wait(400);
  }

  // ---- Step 8: Clear the notes on the origin marker
  const originPanelRow = document.querySelector(".panel-marker-row.selected");
  if (originPanelRow && !_demoAborted) {
    const ta = originPanelRow.querySelector(".panel-marker-note");
    if (ta && ta.value) {
      await moveTo(ta);
      await wait(300);
      ta.focus();
      ta.value = "";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(400);
    }
  }

  removeDemoCursor();
}
