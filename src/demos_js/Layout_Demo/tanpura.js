// tanpura.js
// Continuous Karplus-Strong drone — 4-string tanpura pattern (Pa · Sa · Sa · Sa̎).
// Owns a GainNode that connects to getMasterGainNode() so it travels through
// the full master chain: reverb, compressor, meters, and master gain slider.

const TANPURA_STRING_COUNT       = 4;
const TANPURA_DEFAULT_STRINGS    = [67, 60, 60, 48]; // Pa·Sa·Sa·Sa̎ around C4
const TANPURA_DEFAULT_RATE       = 50;               // 0–100
const TANPURA_DEFAULT_BPM        = 120;
const TANPURA_MASTER_GAIN        = 0.6;
const TANPURA_SCHEDULER_LOOKAHEAD = 0.025;           // seconds; wake up this early to schedule next note
const TANPURA_OCTAVE_SEMITONES   = 12;

const TANPURA_RATE_INTERVAL_MAX  = 1.0;              // seconds at rate=0
const TANPURA_RATE_INTERVAL_MIN  = 0.25;             // seconds at rate=100
const TANPURA_RATE_INTERVAL_RANGE = TANPURA_RATE_INTERVAL_MAX - TANPURA_RATE_INTERVAL_MIN;

const TANPURA_KS_OUTPUT_SCALE    = 0.45;
const TANPURA_KS_DECAY_COEFF     = 0.996;
const TANPURA_KS_ATTACK_SEC      = 0.04;

const TANPURA_NOTE_DURATION      = 3.5;              // seconds
const TANPURA_NOTE_ATTACK        = 0.3;              // seconds
const TANPURA_NOTE_RELEASE       = 1.0;              // seconds
const TANPURA_NOTE_STOP_BUFFER   = 0.05;             // seconds after release before node stops
const TANPURA_NOTE_PEAK_GAIN     = 0.8;

const TANPURA_SYNTH_FILTER_FREQ  = 600;              // Hz
const TANPURA_SYNTH_FILTER_Q     = 0.8;
const TANPURA_SYNTH_DETUNE_CENTS = 4;                // ± cents for the two sawtooth oscillators
const TANPURA_SYNTH_OSC1_GAIN    = 0.4;
const TANPURA_SYNTH_OSC2_GAIN    = 0.4;
const TANPURA_SYNTH_OSC3_GAIN    = 0.2;

let _tanpuraCtx            = null;
let _tanpuraGain           = null;
let _tanpuraActive         = false;
let _tanpuraStrings        = TANPURA_DEFAULT_STRINGS.slice();
let _tanpuraRate           = TANPURA_DEFAULT_RATE;
let _tanpuraMode           = "pluck"; // "pluck" | "synth" | "sine"
let _tanpuraSynthMult      = 1;       // envelope length multiplier for synth mode
let _tanpuraTimerId        = null;
let _tanpuraStrIdx         = 0;
let _nextPluckTime         = 0;       // AudioContext time of next scheduled pluck
let _tanpuraPendingStrings = null;    // strings queued to apply on next pluck
let _tanpuraStringGains    = new Array(TANPURA_STRING_COUNT).fill(1);
let _tanpuraBpm            = TANPURA_DEFAULT_BPM;
let _tanpuraSyncBeats      = null;    // null = free slider; 8/4/2/1 = note division in quarter-note beats

function _tanpuraMidiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Karplus-Strong: pre-compute a plucked-string buffer.
// Same algorithm as chordPlayer.js — harmonic-phase init for a richer tone.
function _tanpuraKsGenerate(freq, sampleRate, durationSec) {
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
    output[i]  = delay[idx] * TANPURA_KS_OUTPUT_SCALE;
    delay[idx] = TANPURA_KS_DECAY_COEFF * 0.5 * (delay[idx] + delay[next]);
  }

  const attackSamples = Math.round(sampleRate * TANPURA_KS_ATTACK_SEC);
  for (let i = 0; i < Math.min(attackSamples, totalSamples); i++) {
    output[i] *= i / attackSamples;
  }

  return output;
}

// rate 0–100 → inter-pluck interval TANPURA_RATE_INTERVAL_MAX – TANPURA_RATE_INTERVAL_MIN
function _tanpuraRateToInterval(rate) {
  return TANPURA_RATE_INTERVAL_MAX - (rate / 100) * TANPURA_RATE_INTERVAL_RANGE;
}

function _tanpuraSynthNote(freq, gain, mult = 1, startTime = null) {
  const ctx    = _tanpuraCtx;
  const env    = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type            = "lowpass";
  filter.frequency.value = TANPURA_SYNTH_FILTER_FREQ;
  filter.Q.value         = TANPURA_SYNTH_FILTER_Q;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const osc3 = ctx.createOscillator();
  osc1.type = "sawtooth"; osc1.frequency.value = freq; osc1.detune.value = +TANPURA_SYNTH_DETUNE_CENTS;
  osc2.type = "sawtooth"; osc2.frequency.value = freq; osc2.detune.value = -TANPURA_SYNTH_DETUNE_CENTS;
  osc3.type = "sine";     osc3.frequency.value = freq / 2;

  const g1 = ctx.createGain(); g1.gain.value = TANPURA_SYNTH_OSC1_GAIN;
  const g2 = ctx.createGain(); g2.gain.value = TANPURA_SYNTH_OSC2_GAIN;
  const g3 = ctx.createGain(); g3.gain.value = TANPURA_SYNTH_OSC3_GAIN;

  osc1.connect(g1).connect(filter);
  osc2.connect(g2).connect(filter);
  osc3.connect(g3).connect(filter);
  filter.connect(env);
  env.connect(_tanpuraGain);

  const now = startTime !== null ? startTime : ctx.currentTime;
  const dur = TANPURA_NOTE_DURATION * mult, A = TANPURA_NOTE_ATTACK * mult, R = TANPURA_NOTE_RELEASE * mult;
  const peak = TANPURA_NOTE_PEAK_GAIN * gain;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + A);
  env.gain.setValueAtTime(peak, now + dur);
  env.gain.linearRampToValueAtTime(0, now + dur + R);

  const stopTime = now + dur + R + TANPURA_NOTE_STOP_BUFFER;
  [osc1, osc2, osc3].forEach(o => { o.start(now); o.stop(stopTime); });
  osc1.addEventListener("ended", () => {
    [osc1, osc2, osc3, g1, g2, g3, filter, env].forEach(n => { try { n.disconnect(); } catch {} });
  });
}

function _tanpuraSineNote(freq, gain, mult = 1, startTime = null) {
  const ctx = _tanpuraCtx;
  const env = ctx.createGain();
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;

  osc.connect(env);
  env.connect(_tanpuraGain);

  const now = startTime !== null ? startTime : ctx.currentTime;
  const dur = TANPURA_NOTE_DURATION * mult, A = TANPURA_NOTE_ATTACK * mult, R = TANPURA_NOTE_RELEASE * mult;
  const peak = TANPURA_NOTE_PEAK_GAIN * gain;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + A);
  env.gain.setValueAtTime(peak, now + dur);
  env.gain.linearRampToValueAtTime(0, now + dur + R);

  const stopTime = now + dur + R + TANPURA_NOTE_STOP_BUFFER;
  osc.start(now);
  osc.stop(stopTime);
  osc.addEventListener("ended", () => { try { osc.disconnect(); env.disconnect(); } catch {} });
}

function _tanpuraPluckNext() {
  if (!_tanpuraActive) return;

  const intervalSec = _tanpuraSyncBeats !== null
    ? (60 / _tanpuraBpm) * _tanpuraSyncBeats
    : _tanpuraRateToInterval(_tanpuraRate);

  // If we're behind (e.g. tab was hidden), catch up to now so we don't
  // fire a burst of back-dated notes.
  if (_nextPluckTime < _tanpuraCtx.currentTime) {
    _nextPluckTime = _tanpuraCtx.currentTime;
  }

  if (_tanpuraPendingStrings !== null) {
    _tanpuraStrings = _tanpuraPendingStrings;
    _tanpuraPendingStrings = null;
    console.log(`[tanpura] applied pending strings=[${_tanpuraStrings}] at idx=${_tanpuraStrIdx}`);
  }

  const midi    = _tanpuraStrings[_tanpuraStrIdx];
  const freq    = _tanpuraMidiToFreq(midi);
  const strGain = _tanpuraStringGains[_tanpuraStrIdx];

  console.log(`[tanpura] pluck idx=${_tanpuraStrIdx} midi=${midi} strings=[${_tanpuraStrings}] scheduledAt=${_nextPluckTime.toFixed(3)} ctxNow=${_tanpuraCtx.currentTime.toFixed(3)}`);

  if (_tanpuraMode === "synth") {
    _tanpuraSynthNote(freq, strGain, _tanpuraSynthMult, _nextPluckTime);
  } else if (_tanpuraMode === "sine") {
    _tanpuraSineNote(freq, strGain, _tanpuraSynthMult, _nextPluckTime);
  } else {
    const samples = _tanpuraKsGenerate(freq, _tanpuraCtx.sampleRate, _tanpuraSynthMult * 10);
    for (let i = 0; i < samples.length; i++) samples[i] *= strGain;
    const buf = _tanpuraCtx.createBuffer(1, samples.length, _tanpuraCtx.sampleRate);
    buf.copyToChannel(samples, 0);
    const src = _tanpuraCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_tanpuraGain);
    src.start(_nextPluckTime);
    src.addEventListener("ended", () => src.disconnect());
  }

  _tanpuraStrIdx  = (_tanpuraStrIdx + 1) % TANPURA_STRING_COUNT;
  _nextPluckTime += intervalSec;

  // Wake up ~25 ms before the next pluck is due so we can schedule it on time.
  const msUntilNext = (_nextPluckTime - _tanpuraCtx.currentTime - TANPURA_SCHEDULER_LOOKAHEAD) * 1000;
  _tanpuraTimerId = setTimeout(_tanpuraPluckNext, Math.max(0, msUntilNext));
}

function tanpuraInit(ctx) {
  _tanpuraCtx  = ctx;
  _tanpuraGain = ctx.createGain();
  _tanpuraGain.gain.value = TANPURA_MASTER_GAIN;
  _tanpuraGain.connect(getMasterGainNode());
}

function tanpuraStart(playheadSeconds = 0) {
  if (_tanpuraActive) return;
  _tanpuraActive = true;
  const intervalSec = _tanpuraSyncBeats !== null
    ? (60 / _tanpuraBpm) * _tanpuraSyncBeats
    : _tanpuraRateToInterval(_tanpuraRate);
  _tanpuraStrIdx  = Math.floor(playheadSeconds / intervalSec) % TANPURA_STRING_COUNT;
  _nextPluckTime  = _tanpuraCtx.currentTime + TANPURA_SCHEDULER_LOOKAHEAD;
  console.log(`[tanpura] START playhead=${playheadSeconds.toFixed(3)} intervalSec=${intervalSec.toFixed(3)} initialIdx=${_tanpuraStrIdx} strings=[${_tanpuraStrings}]`);
  _tanpuraPluckNext();
}

function tanpuraStop() {
  console.log(`[tanpura] STOP idx=${_tanpuraStrIdx} strings=[${_tanpuraStrings}]`);
  _tanpuraActive  = false;
  clearTimeout(_tanpuraTimerId);
  _tanpuraTimerId = null;
}

function tanpuraSetVolume(v) {
  if (_tanpuraGain) _tanpuraGain.gain.value = v;
}

function tanpuraSetRate(r) {
  _tanpuraRate = r;
  if (_tanpuraActive) {
    clearTimeout(_tanpuraTimerId);
    _nextPluckTime = _tanpuraCtx.currentTime + TANPURA_SCHEDULER_LOOKAHEAD;
    _tanpuraPluckNext();
  }
}

// midiArray: sorted ascending, 1–4 elements; pads to 4 by repeating lowest note down an octave.
function tanpuraSetStrings(midiArray) {
  const arr = midiArray.slice(0, TANPURA_STRING_COUNT);
  while (arr.length < TANPURA_STRING_COUNT) arr.unshift(arr[0] - TANPURA_OCTAVE_SEMITONES);
  console.log(`[tanpura] SET_STRINGS old=[${_tanpuraStrings}] new=[${arr}] idx=${_tanpuraStrIdx} active=${_tanpuraActive}`);
  if (_tanpuraActive) {
    _tanpuraPendingStrings = arr;
  } else {
    _tanpuraStrings = arr;
    _tanpuraPendingStrings = null;
  }
}

function tanpuraSetMode(mode) {
  _tanpuraMode = mode;
}

function tanpuraSetSynthMult(mult) {
  _tanpuraSynthMult = mult;
}

function tanpuraSetStringGain(idx, v) {
  _tanpuraStringGains[idx] = v;
}

function tanpuraIsActive() {
  return _tanpuraActive;
}

function tanpuraSetBPM(bpm) {
  _tanpuraBpm = bpm;
}

// beats: null = free slider mode; 8 = double whole, 4 = whole, 2 = half, 1 = quarter
function tanpuraSetRateSync(beats) {
  _tanpuraSyncBeats = beats;
  if (_tanpuraActive) {
    clearTimeout(_tanpuraTimerId);
    _nextPluckTime = _tanpuraCtx.currentTime + TANPURA_SCHEDULER_LOOKAHEAD;
    _tanpuraPluckNext();
  }
}
