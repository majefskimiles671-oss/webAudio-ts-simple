// demo-countermelody.js
// Demo - Does This Riff Work as a Countermelody? - Script -----
//
// Story: The musician hums a melody and records it. Then they play it back
// and record a guitar riff on top to hear if the two ideas fit together.

async function runCountermelodyDemo() {
  _demoAborted = false;

  const recordBtn = document.getElementById("recordBtn");
  const playBtn   = document.getElementById("playBtn");
  const returnBtn = document.getElementById("returnToBeginningBtn");

  const start = getCenter(returnBtn);
  createDemoCursor(start.x + 120, start.y + 80);
  await wait(600);

  // ----------------------------------------------------------------
  // PART 1 — Record the melody (humming)
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);

  await demoClick(recordBtn);   // arm
  await wait(500);
  await demoClick(playBtn);     // start recording
  await wait(3500);             // humming the melody
  await demoClick(playBtn);     // stop — promotes lane to track
  await wait(700);

  // Name it
  const rows1 = getTrackRows();
  if (rows1.length && !_demoAborted) {
    await demoType(rows1[0].querySelector(".track-title"), "Melody");
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 2 — Play it back, just listening
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(3000);
  await demoClick(playBtn);
  await wait(600);

  // ----------------------------------------------------------------
  // PART 3 — Record the guitar riff while the melody plays
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);

  await demoClick(recordBtn);   // arm
  await wait(500);
  await demoClick(playBtn);     // start — melody plays back, guitar is recorded on top
  await wait(3500);             // playing guitar riff alongside the melody
  await demoClick(playBtn);     // stop — promotes lane to track
  await wait(700);

  const rows2 = getTrackRows();
  if (rows2.length && !_demoAborted) {
    await demoType(rows2[0].querySelector(".track-title"), "Guitar Riff");
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 4 — Hear them together
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(4000);
  await demoClick(playBtn);
  await wait(600);

  // ----------------------------------------------------------------
  // PART 5 — Solo each to compare
  // ----------------------------------------------------------------

  const trackRows = getTrackRows();

  // Solo the melody alone
  const melodyRow  = trackRows.length >= 2 ? trackRows[1] : trackRows[0];
  const melodySolo = melodyRow?.querySelector(".solo-btn");
  if (melodySolo && !_demoAborted) {
    await demoClick(melodySolo);
    await wait(300);
    await demoClick(returnBtn);
    await wait(200);
    await demoClick(playBtn);
    await wait(2500);
    await demoClick(playBtn);
    await wait(400);
    await demoClick(melodySolo);  // unsolo
    await wait(500);
  }

  // Solo the guitar riff alone
  const riffRow  = trackRows[0];
  const riffSolo = riffRow?.querySelector(".solo-btn");
  if (riffSolo && !_demoAborted) {
    await demoClick(riffSolo);
    await wait(300);
    await demoClick(returnBtn);
    await wait(200);
    await demoClick(playBtn);
    await wait(2500);
    await demoClick(playBtn);
    await wait(400);
    await demoClick(riffSolo);    // unsolo
    await wait(500);
  }

  // ----------------------------------------------------------------
  // PART 6 — One more listen together
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(4000);
  await demoClick(playBtn);
  await wait(600);

  removeDemoCursor();
}
