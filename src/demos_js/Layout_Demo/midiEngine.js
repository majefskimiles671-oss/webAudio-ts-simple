// midiEngine.js
// Schedules MIDI chord-clip events against the WebAudio clock.
// Pattern mirrors audioEnginePlay / audioEngineStop in audio-engine.js.

const LOOKAHEAD_SECS  = 0.5; // schedule this far ahead of ctx.currentTime

let _scheduledMidiNodes = [];
let _pendingNoteQueue   = []; // { audioTime, freq, durationSec, velocity, instrument, dest }
const GM_LIVE_CHANNEL   = 15; // reserved for live keyboard input; never assigned to playback tracks

// Helpers - MIDI Engine -----
// Worker-based timer: runs in a separate thread so background-tab throttling
// (which collapses main-thread setTimeout to ~1 s) never causes note dropouts.
const _timerWorker = new Worker(URL.createObjectURL(new Blob([`
  let _interval = null;
  self.onmessage = (e) => {
    if (e.data === 'start') { clearInterval(_interval); _interval = setInterval(() => self.postMessage('tick'), 25); }
    if (e.data === 'stop')  { clearInterval(_interval); _interval = null; }
  };
`], { type: 'application/javascript' })));

_timerWorker.onmessage = () => _schedulerTick();

function _schedulerTick() {
  const ctx     = getAudioContext();
  const horizon = ctx.currentTime + LOOKAHEAD_SECS;

  while (_pendingNoteQueue.length > 0 && _pendingNoteQueue[0].audioTime <= horizon) {
    const { audioTime, freq, durationSec, velocity, instrument, dest } = _pendingNoteQueue.shift();
    const nodes = cpScheduleNoteAt(freq, ctx, audioTime, durationSec, velocity, instrument, dest);
    _scheduledMidiNodes.push(...nodes);
  }

  if (_pendingNoteQueue.length === 0) _timerWorker.postMessage('stop');
}

// Shared DOM References - MIDI Engine -----
// Fills _pendingNoteQueue with all upcoming notes and kicks off the scheduler loop.
// Called from onTransportStart and jumpPlayheadToTime.
async function midiEnginePlay(tracks, playheadSeconds) {
  midiEngineStop();
  // Ensure Web MIDI access is established before checking for outputs
  if (tracks.some(t => t.instrument === "gm" && t.midiClips?.length)) {
    await gmMidiEnsureAccess();
  }
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const now     = ctx.currentTime;
  const nowPerf = performance.now();

  const activeScene = document.querySelector("#transport-scenes .transport-scene.active")?.textContent.trim();
  const soloedControlRow = document.querySelector(".solo-btn.active")?.closest(".control-row");
  const soloedTrack = soloedControlRow ? tracks.find(t => t.controlRow === soloedControlRow) : null;

  // Assign MIDI channels to GM tracks (skip channel 9=drums, 15=live input)
  const gmOutput = gmMidiGetOutput();
  let gmCh = 0;
  const gmTrackChannel = new Map();
  for (const track of tracks) {
    if (track.instrument !== "gm") continue;
    if (gmCh === GM_LIVE_CHANNEL) gmCh++;
    if (gmCh >= 16) break;
    gmTrackChannel.set(track.id, gmCh);
    gmMidiProgramChange(gmOutput, gmCh, 0); // Acoustic Grand Piano
    gmCh++;
  }

  for (const track of tracks) {
    if (!track.midiClips?.length) continue;
    const audible = soloedTrack ? track === soloedTrack
                                : (!activeScene || track.scenes.includes(activeScene));
    if (!audible) continue;

    const isGm = track.instrument === "gm" && gmOutput && gmTrackChannel.has(track.id);
    const gmChannel = isGm ? gmTrackChannel.get(track.id) : null;

    for (const clip of track.midiClips) {
      const clipStart = clip.startSample / SAMPLE_RATE;
      const clipEnd   = (clip.startSample + clip.durationSamples) / SAMPLE_RATE;
      if (playheadSeconds >= clipEnd) continue;

      // Chord events — schedule upfront for both GM and synth; these are sparse
      for (const ev of clip.events) {
        const evAbsTime = clipStart + ev.offsetSamples / SAMPLE_RATE;
        if (evAbsTime < playheadSeconds) continue;
        const audioTime = now + (evAbsTime - playheadSeconds);

        if (isGm) {
          const chord = (typeof chords !== "undefined") && chords.find(c => c.id === ev.chordId);
          if (!chord) continue;
          const pitches = _chordToMidiNotes(chord);
          const tBase = nowPerf + (audioTime - now) * 1000;
          pitches.forEach((pitch, i) => {
            const t = tBase + i * 22;
            gmMidiNoteOn(gmOutput, gmChannel, pitch, 100, t);
            gmMidiNoteOff(gmOutput, gmChannel, pitch, t + 2000);
          });
        } else {
          const chord = (typeof chords !== "undefined") && chords.find(c => c.id === ev.chordId);
          if (!chord) continue;
          const dest = audioEngineGetTrackMixerInput(track.id);
          const nodes = cpScheduleChordAt(chord, ctx, audioTime, track.instrument ?? "pluck", dest);
          _scheduledMidiNodes.push(...nodes);
        }
      }

      // Note events — GM fires upfront (just MIDI messages, not AudioNodes),
      // synth goes into the lookahead queue to avoid creating thousands of nodes at once.
      for (const n of (clip.notes ?? [])) {
        const evAbsTime = clipStart + n.startSamples / SAMPLE_RATE;
        if (evAbsTime < playheadSeconds || evAbsTime >= clipEnd) continue;
        const audioTime = now + (evAbsTime - playheadSeconds);
        const durationSec = n.durationSamples / SAMPLE_RATE;

        if (isGm) {
          const tOn = nowPerf + (audioTime - now) * 1000;
          gmMidiNoteOn(gmOutput, gmChannel, n.pitch, n.velocity ?? 100, tOn);
          gmMidiNoteOff(gmOutput, gmChannel, n.pitch, tOn + durationSec * 1000);
        } else {
          _pendingNoteQueue.push({
            audioTime,
            freq:        _midiToFreq(n.pitch),
            durationSec,
            velocity:    n.velocity ?? 100,
            instrument:  track.instrument ?? "pluck",
            dest:        audioEngineGetTrackMixerInput(track.id),
          });
        }
      }
    }
  }

  _pendingNoteQueue.sort((a, b) => a.audioTime - b.audioTime);
  if (_pendingNoteQueue.length > 0) _timerWorker.postMessage('start');
}

function midiEngineStop() {
  _timerWorker.postMessage('stop');
  _pendingNoteQueue  = [];
  _scheduledMidiNodes.forEach(n => { try { n.stop(0); } catch (_) {} });
  _scheduledMidiNodes = [];
  gmMidiAllNotesOff();
}
