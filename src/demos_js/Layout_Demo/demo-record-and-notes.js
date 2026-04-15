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
    await demoType(laneTitle, "Chorus Vox");
  }
  await wait(400);

  // ---- Step 2: Record for 10 seconds
  await demoClick(recordBtn);  // arm
  await wait(500);
  await demoClick(playBtn);    // start
  await wait(10000);
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

  // Stop playback before showing the outro
  if (document.getElementById("playBtn").classList.contains("active")) {
    await demoClick(playBtn);
    await wait(400);
  }

  removeDemoCursor();
  showDemoOutro("Now that you know how to record a track and take notes - it's your turn to create!");
}

function showDemoOutro(message) {
  const overlay = document.createElement("div");
  overlay.id = "demo-intro-overlay";
  overlay.innerHTML = `
    <div id="demo-intro-card">
      <p id="demo-intro-text">${message}</p>
      <div id="demo-intro-actions">
        <button id="demo-intro-run">Let's go!</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#demo-intro-run").addEventListener("click", () => overlay.remove());
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("run-demo-record-and-notes").addEventListener("click", () =>
    showDemoIntro(
      "Watch how to name a track, record a clip, play it back, drop a marker, and add notes.",
      runRecordAndNotesDemo
    )
  );
});
