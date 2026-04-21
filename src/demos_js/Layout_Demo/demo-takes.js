// demo-takes.js
// Demo - Multiple Takes - Script -----
//
// Story: Record three takes of the same vocal part, solo each one to compare,
// then delete the weaker takes and keep the best.

async function runTakesDemo() {
  _demoAborted = false;

  const recordBtn = document.getElementById("recordBtn");
  const playBtn   = document.getElementById("playBtn");
  const returnBtn = document.getElementById("returnToBeginningBtn");

  const start = getCenter(recordBtn);
  createDemoCursor(start.x - 120, start.y + 80);
  await wait(500);

  // ----------------------------------------------------------------
  // PART 1 — Record three takes
  // ----------------------------------------------------------------

  // Take 1
  await demoClick(returnBtn);
  await wait(400);
  await demoClick(recordBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(3500);
  await demoClick(playBtn);
  await wait(600);

  const rows1 = getTrackRows();
  if (rows1.length && !_demoAborted) {
    await demoType(rows1[0].querySelector(".track-title"), "Vox - take one");
  }
  await wait(400);

  // Take 2
  await demoClick(returnBtn);
  await wait(400);
  await demoClick(recordBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(3500);
  await demoClick(playBtn);
  await wait(600);

  const rows2 = getTrackRows();
  if (rows2.length && !_demoAborted) {
    await demoType(rows2[0].querySelector(".track-title"), "Vox - take two");
  }
  await wait(400);

  // Take 3
  await demoClick(returnBtn);
  await wait(400);
  await demoClick(recordBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(3500);
  await demoClick(playBtn);
  await wait(600);

  const rows3 = getTrackRows();
  if (rows3.length && !_demoAborted) {
    await demoType(rows3[0].querySelector(".track-title"), "Vox - take three");
  }
  await wait(500);

  // ----------------------------------------------------------------
  // PART 2 — Solo each take to compare
  // ----------------------------------------------------------------

  function currentTakeRows() { return getTrackRows(); }

  // Solo take one (oldest = last in list, since tracks prepend)
  await demoClick(returnBtn);
  await wait(300);

  const takeRows = currentTakeRows();
  const soloOne   = takeRows[takeRows.length - 1]?.querySelector(".solo-btn");
  const soloTwo   = takeRows[takeRows.length - 2]?.querySelector(".solo-btn");
  const soloThree = takeRows[0]?.querySelector(".solo-btn");

  if (soloOne && !_demoAborted) {
    await demoClick(soloOne);
    await wait(300);
    await demoClick(playBtn);
    await wait(2500);
    await demoClick(playBtn);
    await wait(400);
    await demoClick(soloOne);   // unsolo
    await wait(400);
  }

  // Solo take two
  await demoClick(returnBtn);
  await wait(300);

  if (soloTwo && !_demoAborted) {
    await demoClick(soloTwo);
    await wait(300);
    await demoClick(playBtn);
    await wait(2500);
    await demoClick(playBtn);
    await wait(400);
    await demoClick(soloTwo);   // unsolo
    await wait(400);
  }

  // Solo take three
  await demoClick(returnBtn);
  await wait(300);

  if (soloThree && !_demoAborted) {
    await demoClick(soloThree);
    await wait(300);
    await demoClick(playBtn);
    await wait(2500);
    await demoClick(playBtn);
    await wait(400);
    await demoClick(soloThree); // unsolo
    await wait(400);
  }

  // ----------------------------------------------------------------
  // PART 3 — Delete the weaker takes, keep take two
  // ----------------------------------------------------------------

  // Delete take one (last row)
  let deleteRows = currentTakeRows();
  const deleteOne = deleteRows[deleteRows.length - 1]?.querySelector(".delete-btn");
  if (deleteOne && !_demoAborted) {
    await demoClick(deleteOne);
    await wait(500);
  }

  // Delete take three (now at index 0 after take two is index 0 and take one is gone)
  deleteRows = currentTakeRows();
  const deleteThree = deleteRows[deleteRows.length - 1]?.querySelector(".delete-btn");
  if (deleteThree && !_demoAborted) {
    await demoClick(deleteThree);
    await wait(500);
  }

  // The winner — rename take two to reflect it's the keeper
  const finalRows = currentTakeRows();
  if (finalRows.length && !_demoAborted) {
    await demoType(finalRows[0].querySelector(".track-title"), "Vox - best take");
  }
  await wait(400);

  await demoClick(returnBtn);
  await wait(400);

  removeDemoCursor();
}
