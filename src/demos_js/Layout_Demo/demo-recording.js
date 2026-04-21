// demo-recording.js
// Demo - Recording & Arming - Script -----
//
// Story: Record a long first take, stop, then show arming and disarming the
// record button before committing to a second recording.

async function runRecordingDemo() {
  _demoAborted = false;

  const recordBtn = document.getElementById("recordBtn");
  const playBtn   = document.getElementById("playBtn");
  const returnBtn = document.getElementById("returnToBeginningBtn");

  const start = getCenter(recordBtn);
  createDemoCursor(start.x - 120, start.y + 80);
  await wait(500);

  // ----------------------------------------------------------------
  // PART 1 — Record for 10 seconds
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);

  await demoClick(recordBtn);   // arm
  await wait(400);
  await demoClick(playBtn);     // start recording
  await wait(10000);
  await demoClick(playBtn);     // stop
  await wait(700);

  // Rename the promoted track
  const rows1 = getTrackRows();
  if (rows1.length && !_demoAborted) {
    await demoType(rows1[0].querySelector(".track-title"), "Guitar - long take");
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 2 — Arm, reconsider, disarm, arm again, then record
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(500);

  // Arm
  await demoClick(recordBtn);
  await wait(900);

  // Change our mind — disarm
  await demoClick(recordBtn);
  await wait(700);

  // Arm again
  await demoClick(recordBtn);
  await wait(600);

  // Disarm once more
  await demoClick(recordBtn);
  await wait(800);

  // Commit — arm and go
  await demoClick(recordBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(4000);
  await demoClick(playBtn);
  await wait(600);

  // Rename the second track
  const rows2 = getTrackRows();
  if (rows2.length && !_demoAborted) {
    await demoType(rows2[0].querySelector(".track-title"), "Guitar - short take");
  }
  await wait(400);

  await demoClick(returnBtn);
  await wait(400);

  removeDemoCursor();
}
