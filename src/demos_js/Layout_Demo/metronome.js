// metronome.js
// Metronome - Click Engine - Audio Engine -----

// State - Metronome - Truth Layer -----
let _metEnabled                = false;
let _metVolume                 = 0.7;
let _metCountIn                = 4;
let _metCountInBeforeRecording = true;
let _metCountInBeforePlaying   = true;
let _metWhileRecording         = true;
let _metWhilePlaying           = true;
let _metInterval   = null;
let _nextBeatTime  = 0;
let _beatIndex     = 0;
let _accentBuf     = null;
let _normalBuf     = null;
let _metGain       = null;

const LOOKAHEAD_SEC = 0.1;
const TICK_MS       = 25;

// Helpers - Metronome - Pure Computation Layer -----
function _buildClickBuffer(freq, durationSec) {
  const ctx = getAudioContext();
  const sr  = ctx.sampleRate;
  const len = Math.ceil(sr * durationSec);
  const buf = ctx.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++)
    d[i] = Math.sin(2 * Math.PI * freq * i / sr) * Math.exp(-30 * i / sr);
  return buf;
}

// Authority - Metronome - Meaning Layer -----
function metronomeInit() {
  const ctx = getAudioContext();
  _accentBuf = _buildClickBuffer(1000, 0.05);
  _normalBuf = _buildClickBuffer(660,  0.05);
  _metGain   = ctx.createGain();
  _metGain.gain.value = _metVolume;
  // Connect directly to destination — click stays out of master effects chain
  _metGain.connect(ctx.destination);
}

function metronomeSetEnabled(bool) {
  _metEnabled = bool;
  if (!bool) metronomeStop();
}

function metronomeSetVolume(v) {
  _metVolume = v;
  if (_metGain) _metGain.gain.value = v;
}

function metronomeSetCountIn(beats) {
  _metCountIn = beats;
}

function metronomeSetStartTime(startT, playheadSeconds) {
  const secPerBeat     = 60 / tempoBPM;
  const beatsFromStart = playheadSeconds / secPerBeat;
  const nextBeatIndex  = Math.ceil(beatsFromStart);
  _nextBeatTime = startT + (nextBeatIndex - beatsFromStart) * secPerBeat;
  _beatIndex    = nextBeatIndex % timeSignature.beats;
}

function metronomeStart(playheadSeconds = 0) {
  if (_metInterval !== null) return;
  const ctx = getAudioContext();
  // If _nextBeatTime is in the future (e.g. handed off from count-in), keep it;
  // otherwise reset to now so there's no burst of catch-up beats.
  if (_nextBeatTime < ctx.currentTime + 0.01) {
    const secPerBeat     = 60 / tempoBPM;
    const beatsFromStart = playheadSeconds / secPerBeat;
    const nextBeatIndex  = Math.ceil(beatsFromStart);
    _nextBeatTime = ctx.currentTime + 0.1 + (nextBeatIndex - beatsFromStart) * secPerBeat;
    _beatIndex    = nextBeatIndex % timeSignature.beats;
  }
  _metInterval = setInterval(_schedule, TICK_MS);
}

function metronomeStop() {
  if (_metInterval !== null) {
    clearInterval(_metInterval);
    _metInterval = null;
  }
}

function metronomeRunCountIn(onDone) {
  let cancelled = false;
  const cancel = () => { cancelled = true; };

  let beatsLeft = _metCountIn;
  const ctx     = getAudioContext();
  _nextBeatTime = ctx.currentTime + 0.05;
  _beatIndex    = 0;

  const iv = setInterval(() => {
    if (cancelled) { clearInterval(iv); return; }
    while (_nextBeatTime < ctx.currentTime + LOOKAHEAD_SEC && beatsLeft > 0) {
      _scheduleBeat(_nextBeatTime);
      _nextBeatTime += 60 / tempoBPM;
      _beatIndex = (_beatIndex + 1) % timeSignature.beats;
      beatsLeft--;
      if (beatsLeft === 0) {
        clearInterval(iv);
        const delay = (_nextBeatTime - ctx.currentTime) * 1000;
        setTimeout(() => { if (!cancelled) onDone(); }, Math.max(0, delay - 100));
      }
    }
  }, TICK_MS);

  return cancel;
}

function metronomeGetNextBeatTime() { return _nextBeatTime; }
function metronomeIsEnabled() { return _metEnabled; }
function metronomeGetCountIn() { return _metCountIn; }
function metronomeSetCountInBeforeRecording(bool) { _metCountInBeforeRecording = bool; }
function metronomeCountInBeforeRecording()        { return _metCountInBeforeRecording; }
function metronomeSetCountInBeforePlaying(bool)   { _metCountInBeforePlaying   = bool; }
function metronomeCountInBeforePlaying()          { return _metCountInBeforePlaying;   }
function metronomeSetWhileRecording(bool) { _metWhileRecording = bool; }
function metronomeSetWhilePlaying(bool)   { _metWhilePlaying   = bool; }
function metronomeWhileRecording() { return _metWhileRecording; }
function metronomeWhilePlaying()   { return _metWhilePlaying;   }

// Helpers - Metronome - Pure Computation Layer -----
function _scheduleBeat(when) {
  const buf = (_beatIndex === 0) ? _accentBuf : _normalBuf;
  const ctx = getAudioContext();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(_metGain);
  src.start(when);
  const aheadMs = ((when - ctx.currentTime) * 1000).toFixed(1);
  log(`[metronome] beat scheduled: when=${when.toFixed(3)} currentTime=${ctx.currentTime.toFixed(3)} ahead=${aheadMs}ms beat=${_beatIndex}`);
}

function _schedule() {
  const ctx = getAudioContext();
  // Tab-suspension guard: if we fell far behind, reset to now
  if (_nextBeatTime < ctx.currentTime - 0.5)
    _nextBeatTime = ctx.currentTime;

  while (_nextBeatTime < ctx.currentTime + LOOKAHEAD_SEC) {
    _scheduleBeat(_nextBeatTime);
    _nextBeatTime += 60 / tempoBPM;
    _beatIndex = (_beatIndex + 1) % timeSignature.beats;
  }
}
