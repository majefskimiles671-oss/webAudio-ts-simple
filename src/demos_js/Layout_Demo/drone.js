// drone.js
// Continuous Karplus-Strong drone — 4-string drone pattern (Pa · Sa · Sa · Sa̎).
// Owns a GainNode that connects to getMasterGainNode() so it travels through
// the full master chain: reverb, compressor, meters, and master gain slider.

const DRONE_STRING_COUNT       = 4;
const DRONE_DEFAULT_STRINGS    = [67, 60, 60, 48]; // Pa·Sa·Sa·Sa̎ around C4
const DRONE_DEFAULT_RATE       = 50;               // 0–100
const DRONE_DEFAULT_BPM        = 120;
const DRONE_MASTER_GAIN        = 0.6;
const DRONE_SCHEDULER_LOOKAHEAD = 0.025;           // seconds; wake up this early to schedule next note
const DRONE_OCTAVE_SEMITONES   = 12;

const DRONE_RATE_INTERVAL_MAX  = 1.0;              // seconds at rate=0
const DRONE_RATE_INTERVAL_MIN  = 0.25;             // seconds at rate=100
const DRONE_RATE_INTERVAL_RANGE = DRONE_RATE_INTERVAL_MAX - DRONE_RATE_INTERVAL_MIN;

const DRONE_KS_OUTPUT_SCALE    = 0.45;
const DRONE_KS_DECAY_COEFF     = 0.996;
const DRONE_KS_ATTACK_SEC      = 0.04;

const DRONE_NOTE_DURATION      = 3.5;              // seconds
const DRONE_NOTE_ATTACK        = 0.3;              // seconds
const DRONE_NOTE_RELEASE       = 1.0;              // seconds
const DRONE_NOTE_STOP_BUFFER   = 0.05;             // seconds after release before node stops
const DRONE_NOTE_PEAK_GAIN     = 0.8;

const DRONE_SYNTH_FILTER_FREQ  = 600;              // Hz
const DRONE_SYNTH_FILTER_Q     = 0.8;
const DRONE_SYNTH_DETUNE_CENTS = 4;                // ± cents for the two sawtooth oscillators
const DRONE_SYNTH_OSC1_GAIN    = 0.4;
const DRONE_SYNTH_OSC2_GAIN    = 0.4;
const DRONE_SYNTH_OSC3_GAIN    = 0.2;

let _droneCtx            = null;
let _droneGain           = null;
let _droneActive         = false;
let _droneStrings        = DRONE_DEFAULT_STRINGS.slice();
let _droneRate           = DRONE_DEFAULT_RATE;
let _droneMode           = "pluck"; // "pluck" | "synth" | "sine"
let _droneSynthMult      = 1;       // envelope length multiplier for synth mode
let _droneTimerId        = null;
let _droneStrIdx         = 0;
let _nextPluckTime         = 0;       // AudioContext time of next scheduled pluck
let _dronePendingStrings = null;    // strings queued to apply on next pluck
let _droneStringGains    = new Array(DRONE_STRING_COUNT).fill(1);
let _droneBpm            = DRONE_DEFAULT_BPM;
let _droneSyncBeats      = null;    // null = free slider; 8/4/2/1 = note division in quarter-note beats

function _droneMidiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Karplus-Strong: pre-compute a plucked-string buffer.
// Same algorithm as chordPlayer.js — harmonic-phase init for a richer tone.
function _droneKsGenerate(freq, sampleRate, durationSec) {
  const N            = Math.max(2, Math.round(sampleRate / freq));
  const totalSamples = Math.round(sampleRate * durationSec);
  const output       = new Float32Array(totalSamples);
  const delay        = new Float32Array(N);

  const phases = new Float32Array(Math.floor(N / 2) + 1);
  for (let k = 1; k < phases.length; k++) phases[k] = Math.random() * 2 * Math.PI;
  const norm = 1 / Math.sqrt(phases.length - 1);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = 1; k < phases.length; k++) s += Math.cos(2 * Math.PI * k * i / N + phases[k]);
    delay[i] = s * norm;
  }

  for (let i = 0; i < totalSamples; i++) {
    const idx  = i % N;
    const next = (i + 1) % N;
    output[i]  = delay[idx] * DRONE_KS_OUTPUT_SCALE;
    delay[idx] = DRONE_KS_DECAY_COEFF * 0.5 * (delay[idx] + delay[next]);
  }

  const attackSamples = Math.round(sampleRate * DRONE_KS_ATTACK_SEC);
  for (let i = 0; i < Math.min(attackSamples, totalSamples); i++) {
    output[i] *= i / attackSamples;
  }

  return output;
}

// rate 0–100 → inter-pluck interval DRONE_RATE_INTERVAL_MAX – DRONE_RATE_INTERVAL_MIN
function _droneRateToInterval(rate) {
  return DRONE_RATE_INTERVAL_MAX - (rate / 100) * DRONE_RATE_INTERVAL_RANGE;
}

function _droneSynthNote(freq, gain, mult = 1, startTime = null) {
  const ctx    = _droneCtx;
  const env    = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type            = "lowpass";
  filter.frequency.value = DRONE_SYNTH_FILTER_FREQ;
  filter.Q.value         = DRONE_SYNTH_FILTER_Q;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const osc3 = ctx.createOscillator();
  osc1.type = "sawtooth"; osc1.frequency.value = freq; osc1.detune.value = +DRONE_SYNTH_DETUNE_CENTS;
  osc2.type = "sawtooth"; osc2.frequency.value = freq; osc2.detune.value = -DRONE_SYNTH_DETUNE_CENTS;
  osc3.type = "sine";     osc3.frequency.value = freq / 2;

  const g1 = ctx.createGain(); g1.gain.value = DRONE_SYNTH_OSC1_GAIN;
  const g2 = ctx.createGain(); g2.gain.value = DRONE_SYNTH_OSC2_GAIN;
  const g3 = ctx.createGain(); g3.gain.value = DRONE_SYNTH_OSC3_GAIN;

  osc1.connect(g1).connect(filter);
  osc2.connect(g2).connect(filter);
  osc3.connect(g3).connect(filter);
  filter.connect(env);
  env.connect(_droneGain);

  const now = startTime !== null ? startTime : ctx.currentTime;
  const dur = DRONE_NOTE_DURATION * mult, A = DRONE_NOTE_ATTACK * mult, R = DRONE_NOTE_RELEASE * mult;
  const peak = DRONE_NOTE_PEAK_GAIN * gain;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + A);
  env.gain.setValueAtTime(peak, now + dur);
  env.gain.linearRampToValueAtTime(0, now + dur + R);

  const stopTime = now + dur + R + DRONE_NOTE_STOP_BUFFER;
  [osc1, osc2, osc3].forEach(o => { o.start(now); o.stop(stopTime); });
  osc1.addEventListener("ended", () => {
    [osc1, osc2, osc3, g1, g2, g3, filter, env].forEach(n => { try { n.disconnect(); } catch {} });
  });
}

function _droneSineNote(freq, gain, mult = 1, startTime = null) {
  const ctx = _droneCtx;
  const env = ctx.createGain();
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;

  osc.connect(env);
  env.connect(_droneGain);

  const now = startTime !== null ? startTime : ctx.currentTime;
  const dur = DRONE_NOTE_DURATION * mult, A = DRONE_NOTE_ATTACK * mult, R = DRONE_NOTE_RELEASE * mult;
  const peak = DRONE_NOTE_PEAK_GAIN * gain;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + A);
  env.gain.setValueAtTime(peak, now + dur);
  env.gain.linearRampToValueAtTime(0, now + dur + R);

  const stopTime = now + dur + R + DRONE_NOTE_STOP_BUFFER;
  osc.start(now);
  osc.stop(stopTime);
  osc.addEventListener("ended", () => { try { osc.disconnect(); env.disconnect(); } catch {} });
}

function _dronePluckNext() {
  if (!_droneActive) return;

  const intervalSec = _droneSyncBeats !== null
    ? (60 / _droneBpm) * _droneSyncBeats
    : _droneRateToInterval(_droneRate);

  // If we're behind (e.g. tab was hidden), catch up to now so we don't
  // fire a burst of back-dated notes.
  if (_nextPluckTime < _droneCtx.currentTime) {
    _nextPluckTime = _droneCtx.currentTime;
  }

  if (_dronePendingStrings !== null) {
    _droneStrings = _dronePendingStrings;
    _dronePendingStrings = null;
    console.log(`[drone] applied pending strings=[${_droneStrings}] at idx=${_droneStrIdx}`);
  }

  const midi    = _droneStrings[_droneStrIdx];
  const freq    = _droneMidiToFreq(midi);
  const strGain = _droneStringGains[_droneStrIdx];

  console.log(`[drone] pluck idx=${_droneStrIdx} midi=${midi} strings=[${_droneStrings}] scheduledAt=${_nextPluckTime.toFixed(3)} ctxNow=${_droneCtx.currentTime.toFixed(3)}`);

  if (_droneMode === "synth") {
    _droneSynthNote(freq, strGain, _droneSynthMult, _nextPluckTime);
  } else if (_droneMode === "sine") {
    _droneSineNote(freq, strGain, _droneSynthMult, _nextPluckTime);
  } else {
    const samples = _droneKsGenerate(freq, _droneCtx.sampleRate, _droneSynthMult * 10);
    for (let i = 0; i < samples.length; i++) samples[i] *= strGain;
    const buf = _droneCtx.createBuffer(1, samples.length, _droneCtx.sampleRate);
    buf.copyToChannel(samples, 0);
    const src = _droneCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_droneGain);
    src.start(_nextPluckTime);
    src.addEventListener("ended", () => src.disconnect());
  }

  _droneStrIdx  = (_droneStrIdx + 1) % DRONE_STRING_COUNT;
  _nextPluckTime += intervalSec;

  // Wake up ~25 ms before the next pluck is due so we can schedule it on time.
  const msUntilNext = (_nextPluckTime - _droneCtx.currentTime - DRONE_SCHEDULER_LOOKAHEAD) * 1000;
  _droneTimerId = setTimeout(_dronePluckNext, Math.max(0, msUntilNext));
}

function droneInit(ctx) {
  _droneCtx  = ctx;
  _droneGain = ctx.createGain();
  _droneGain.gain.value = DRONE_MASTER_GAIN;
  _droneGain.connect(getMasterGainNode());
}

function droneStart(playheadSeconds = 0) {
  if (_droneActive) return;
  _droneActive = true;
  const intervalSec = _droneSyncBeats !== null
    ? (60 / _droneBpm) * _droneSyncBeats
    : _droneRateToInterval(_droneRate);
  _droneStrIdx  = Math.floor(playheadSeconds / intervalSec) % DRONE_STRING_COUNT;
  _nextPluckTime  = _droneCtx.currentTime + DRONE_SCHEDULER_LOOKAHEAD;
  console.log(`[drone] START playhead=${playheadSeconds.toFixed(3)} intervalSec=${intervalSec.toFixed(3)} initialIdx=${_droneStrIdx} strings=[${_droneStrings}]`);
  _dronePluckNext();
}

function droneStop() {
  console.log(`[drone] STOP idx=${_droneStrIdx} strings=[${_droneStrings}]`);
  _droneActive  = false;
  clearTimeout(_droneTimerId);
  _droneTimerId = null;
}

function droneSetVolume(v) {
  if (_droneGain) _droneGain.gain.value = v;
}

function droneSetRate(r) {
  _droneRate = r;
  if (_droneActive) {
    clearTimeout(_droneTimerId);
    _nextPluckTime = _droneCtx.currentTime + DRONE_SCHEDULER_LOOKAHEAD;
    _dronePluckNext();
  }
}

// midiArray: sorted ascending, 1–4 elements; pads to 4 by repeating lowest note down an octave.
function droneSetStrings(midiArray) {
  const arr = midiArray.slice(0, DRONE_STRING_COUNT);
  while (arr.length < DRONE_STRING_COUNT) arr.unshift(arr[0] - DRONE_OCTAVE_SEMITONES);
  console.log(`[drone] SET_STRINGS old=[${_droneStrings}] new=[${arr}] idx=${_droneStrIdx} active=${_droneActive}`);
  if (_droneActive) {
    _dronePendingStrings = arr;
  } else {
    _droneStrings = arr;
    _dronePendingStrings = null;
  }
}

function droneSetMode(mode) {
  _droneMode = mode;
}

function droneSetSynthMult(mult) {
  _droneSynthMult = mult;
}

function droneSetStringGain(idx, v) {
  _droneStringGains[idx] = v;
}

function droneIsActive() {
  return _droneActive;
}

function droneGetState() {
  return {
    strings:     _droneStrings.slice(),
    rate:        _droneRate,
    mode:        _droneMode,
    synthMult:   _droneSynthMult,
    stringGains: _droneStringGains.slice(),
    bpm:         _droneBpm,
    syncBeats:   _droneSyncBeats,
  };
}

function droneSetBPM(bpm) {
  _droneBpm = bpm;
}

// beats: null = free slider mode; 8 = double whole, 4 = whole, 2 = half, 1 = quarter
function droneSetRateSync(beats) {
  _droneSyncBeats = beats;
  if (_droneActive) {
    clearTimeout(_droneTimerId);
    _nextPluckTime = _droneCtx.currentTime + DRONE_SCHEDULER_LOOKAHEAD;
    _dronePluckNext();
  }
}
