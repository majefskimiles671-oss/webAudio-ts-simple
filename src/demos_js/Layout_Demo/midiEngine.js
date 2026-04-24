// midiEngine.js
// Schedules MIDI chord-clip events against the WebAudio clock.
// Pattern mirrors audioEnginePlay / audioEngineStop in audio-engine.js.

let _scheduledMidiNodes = [];

// Shared DOM References - MIDI Engine -----
// Called from onTransportStart and jumpPlayheadToTime.
// tracks: the global tracks array (each track has midiClips[] and instrument)
// playheadSeconds: current playhead position on the timeline
function midiEnginePlay(tracks, playheadSeconds) {
  midiEngineStop();
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const now = ctx.currentTime;

  const activeScene = document.querySelector("#transport-scenes .transport-scene.active")?.textContent.trim();
  const soloedControlRow = document.querySelector(".solo-btn.active")?.closest(".control-row");
  const soloedTrack = soloedControlRow ? tracks.find(t => t.controlRow === soloedControlRow) : null;

  for (const track of tracks) {
    if (!track.midiClips?.length) continue;
    const audible = soloedTrack ? track === soloedTrack
                                : (!activeScene || track.scenes.includes(activeScene));
    if (!audible) continue;
    for (const clip of track.midiClips) {
      const clipStart = clip.startSample / SAMPLE_RATE;
      const clipEnd   = (clip.startSample + clip.durationSamples) / SAMPLE_RATE;
      if (playheadSeconds >= clipEnd) continue;

      for (const ev of clip.events) {
        const evAbsTime = clipStart + ev.offsetSamples / SAMPLE_RATE;
        if (evAbsTime < playheadSeconds) continue;

        const chord = (typeof chords !== "undefined") && chords.find(c => c.id === ev.chordId);
        if (!chord) continue;

        const audioTime = now + (evAbsTime - playheadSeconds);
        const nodes = cpScheduleChordAt(chord, ctx, audioTime, track.instrument ?? "pluck");
        _scheduledMidiNodes.push(...nodes);
      }
    }
  }
}

function midiEngineStop() {
  _scheduledMidiNodes.forEach(n => { try { n.stop(0); } catch (_) {} });
  _scheduledMidiNodes = [];
}
