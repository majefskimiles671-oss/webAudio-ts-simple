// midiEngine.js
// Schedules MIDI chord-clip events against the WebAudio clock.
// Pattern mirrors audioEnginePlay / audioEngineStop in audio-engine.js.

const LOOKAHEAD_SECS = 0.5; // schedule this far ahead of ctx.currentTime

let _scheduledMidiNodes = [];
let _pendingNoteQueue   = []; // { audioTime, pitch, durationSec, velocity, instrument, program, dest }
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
    const { audioTime, pitch, durationSec, velocity, instrument, program, dest } = _pendingNoteQueue.shift();
    const nodes = instrument === 'gm'
      ? sfScheduleNote(dest, program, pitch, velocity, audioTime, durationSec)
      : cpScheduleNoteAt(_midiToFreq(pitch), ctx, audioTime, durationSec, velocity, instrument, dest);
    _scheduledMidiNodes.push(...nodes);
  }

  if (_pendingNoteQueue.length === 0) _timerWorker.postMessage('stop');
}

// Shared DOM References - MIDI Engine -----
// Fills _pendingNoteQueue with all upcoming notes and kicks off the scheduler loop.
// Called from onTransportStart and jumpPlayheadToTime.
async function midiEnginePlay(tracks, playheadSeconds) {
  midiEngineStop();

  // Preload every soundfont needed before the scheduler fires
  const gmPrograms = new Set(
    tracks.filter(t => t.instrument === 'gm' && t.midiClips?.length)
          .map(t => t.gmProgram ?? 0)
  );
  if (gmPrograms.size > 0) await Promise.allSettled([...gmPrograms].map(sfEnsureProgram));

  // Re-arm output after the async soundfont gap — browser may have paused
  // the <audio> element during the network load.
  audioEngineEnsureOutput();

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

    const isGm      = track.instrument === 'gm';
    const program   = track.gmProgram ?? 0;
    const dest      = audioEngineGetTrackMixerInput(track.id);

    for (const clip of track.midiClips) {
      const clipStart = clip.startSample / SAMPLE_RATE;
      const clipEnd   = (clip.startSample + clip.durationSamples) / SAMPLE_RATE;
      if (playheadSeconds >= clipEnd) continue;

      // Chord events — schedule upfront (sparse; a handful per bar at most)
      for (const ev of clip.events) {
        const evAbsTime = clipStart + ev.offsetSamples / SAMPLE_RATE;
        if (evAbsTime < playheadSeconds) continue;
        const audioTime = now + (evAbsTime - playheadSeconds);
        const chord = (typeof chords !== "undefined") && chords.find(c => c.id === ev.chordId);
        if (!chord) continue;

        if (isGm) {
          _chordToMidiNotes(chord).forEach((pitch, i) => {
            const nodes = sfScheduleNote(dest, program, pitch, 100, audioTime + i * 0.022, 2.0);
            _scheduledMidiNodes.push(...nodes);
          });
        } else {
          const nodes = cpScheduleChordAt(chord, ctx, audioTime, track.instrument ?? "pluck", dest);
          _scheduledMidiNodes.push(...nodes);
        }
      }

      // Note events — all go into the lookahead queue
      for (const n of (clip.notes ?? [])) {
        const evAbsTime = clipStart + n.startSamples / SAMPLE_RATE;
        if (evAbsTime < playheadSeconds || evAbsTime >= clipEnd) continue;
        _pendingNoteQueue.push({
          audioTime:   now + (evAbsTime - playheadSeconds),
          pitch:       n.pitch,
          durationSec: n.durationSamples / SAMPLE_RATE,
          velocity:    n.velocity ?? 100,
          instrument:  isGm ? 'gm' : (track.instrument ?? 'pluck'),
          program,
          dest,
        });
      }
    }
  }

  _pendingNoteQueue.sort((a, b) => a.audioTime - b.audioTime);
  if (_pendingNoteQueue.length > 0) _timerWorker.postMessage('start');
}

function midiEngineStop() {
  _timerWorker.postMessage('stop');
  _pendingNoteQueue   = [];
  _scheduledMidiNodes.forEach(n => { try { n.stop(0); } catch (_) {} });
  _scheduledMidiNodes = [];
  gmMidiAllNotesOff();
}
