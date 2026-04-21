// demo-mixing-chorus.js
// Demo - Mixing the Chorus - Script -----
//
// Story: With tracks recorded, we refine the mix — adjusting gain, soloing parts
// to check the blend, scrubbing around the arrangement, and using scenes to group
// the guitar layers separately from the vocal.

async function runMixingChorusDemo() {
  _demoAborted = false;

  const returnBtn = document.getElementById("returnToBeginningBtn");
  const playBtn   = document.getElementById("playBtn");

  const start = getCenter(playBtn);
  createDemoCursor(start.x - 150, start.y + 80);
  await wait(500);

  const trackRows = getTrackRows();
  if (!trackRows.length) {
    removeDemoCursor();
    return; // nothing to mix
  }

  // ----------------------------------------------------------------
  // PART 1 — Full playback: hear everything together
  // ----------------------------------------------------------------

  await demoClick(returnBtn);
  await wait(400);
  await demoClick(playBtn);
  await wait(3000);
  await demoClick(playBtn);
  await wait(500);

  // ----------------------------------------------------------------
  // PART 2 — Solo the first track, listen, unsolo
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
  // PART 3 — Gain tweaking
  // ----------------------------------------------------------------

  // Bring second track gain down a bit (if it exists)
  const gainSlider1 = trackRows[1]?.querySelector("gain-slider");
  if (gainSlider1 && !_demoAborted) {
    await demoAnimateGain(gainSlider1, 58);
    await wait(400);
  }

  // Bring top track (most recently recorded — Vox 1) up slightly
  const gainSlider0 = trackRows[0]?.querySelector("gain-slider");
  if (gainSlider0 && !_demoAborted) {
    await demoAnimateGain(gainSlider0, 90);
    await wait(400);
  }

  // ----------------------------------------------------------------
  // PART 4 — Navigate to a marker via the transport dropdown
  // ----------------------------------------------------------------

  const markerTimeDisplay = document.getElementById("marker-time");
  if (markerTimeDisplay && !_demoAborted) {
    await demoClick(markerTimeDisplay);  // open dropdown
    await wait(800);                     // pause — let the list settle

    // Pick a marker item that isn't currently selected and isn't the playhead row
    const dropdownItem = document.querySelector(
      "#marker-dropdown .marker-dropdown-item:not(.marker-dropdown-playhead):not(.marker-dropdown-selected)"
    );
    if (dropdownItem && !_demoAborted) {
      await demoClick(dropdownItem);
      await wait(500);
    }
  }

  // ----------------------------------------------------------------
  // PART 5 — Scrub around the timeline
  // ----------------------------------------------------------------

  await demoScrubTo(secondsPerBar() * 2);
  await wait(300);
  await demoScrubTo(secondsPerBar() * 6);
  await wait(300);
  await demoClick(returnBtn);
  await wait(400);

  // ----------------------------------------------------------------
  // PART 6 — Scenes: assign guitar tracks to Scene A, leave Vox out
  // ----------------------------------------------------------------

  // Assign track 1 (Gtr 1, index 2 if 3 tracks) to Scene A
  const gtr1Row = trackRows.length >= 3 ? trackRows[2] : trackRows[trackRows.length - 1];
  const gtr1SceneA = gtr1Row?.querySelector(".track-scene");
  if (gtr1SceneA && !_demoAborted) {
    await demoClick(gtr1SceneA);
    await wait(300);
  }

  // Assign track 2 (Gtr 2, index 1) to Scene A
  const gtr2Row = trackRows.length >= 2 ? trackRows[1] : null;
  const gtr2SceneA = gtr2Row?.querySelector(".track-scene");
  if (gtr2SceneA && !_demoAborted) {
    await demoClick(gtr2SceneA);
    await wait(300);
  }

  // Activate global Scene A button
  const globalSceneA = document.querySelector("#transport-scenes .transport-scene");
  if (globalSceneA && !_demoAborted) {
    await demoClick(globalSceneA);  // guitar-only visible
    await wait(500);

    // Play briefly to show only guitar tracks active
    await demoClick(returnBtn);
    await wait(300);
    await demoClick(playBtn);
    await wait(2000);
    await demoClick(playBtn);
    await wait(500);

    // Deactivate scene (click again to toggle off)
    await demoClick(globalSceneA);
    await wait(400);
  }

  // Return to beginning and done
  await demoClick(returnBtn);
  await wait(500);
  removeDemoCursor();
}
