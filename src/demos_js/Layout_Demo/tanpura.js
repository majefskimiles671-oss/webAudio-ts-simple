// tanpura.js
// Continuous Karplus-Strong drone — 4-string tanpura pattern (Pa · Sa · Sa · Sa̎).
// Owns a GainNode that connects to getMasterGainNode() so it travels through
// the full master chain: reverb, compressor, meters, and master gain slider.

let _tanpuraCtx          = null;
let _tanpuraGain         = null;
let _tanpuraActive       = false;
let _tanpuraStrings      = [67, 60, 60, 48]; // default Pa·Sa·Sa·Sa̎ around C4
let _tanpuraRate         = 50;    // 0–100
let _tanpuraMode         = "pluck"; // "pluck" | "synth"
let _tanpuraSynthMult    = 1;       // envelope length multiplier for synth mode
let _tanpuraTimerId      = null;
let _tanpuraStrIdx       = 0;
let _tanpuraStringGains  = [1, 1, 1, 1];
let _tanpuraBpm          = 120;   // kept in sync with project BPM
let _tanpuraSyncBeats    = null;  // null = free slider; 8/4/2/1 = note division in quarter-note beats

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
    output[i]  = delay[idx] * 0.45;
    delay[idx] = 0.996 * 0.5 * (delay[idx] + delay[next]);
  }

  const attackSamples = Math.round(sampleRate * 0.04);
  for (let i = 0; i < Math.min(attackSamples, totalSamples); i++) {
    output[i] *= i / attackSamples;
  }

  return output;
}

// rate 0–100 → inter-pluck interval 1.0s – 0.25s
function _tanpuraRateToInterval(rate) {
  return 1.0 - (rate / 100) * 0.75;
}

function _tanpuraSynthNote(freq, gain, mult = 1) {
  const ctx    = _tanpuraCtx;
  const env    = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type            = "lowpass";
  filter.frequency.value = 600;
  filter.Q.value         = 0.8;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const osc3 = ctx.createOscillator();
  osc1.type = "sawtooth"; osc1.frequency.value = freq; osc1.detune.value = +4;
  osc2.type = "sawtooth"; osc2.frequency.value = freq; osc2.detune.value = -4;
  osc3.type = "sine";     osc3.frequency.value = freq / 2;

  const g1 = ctx.createGain(); g1.gain.value = 0.4;
  const g2 = ctx.createGain(); g2.gain.value = 0.4;
  const g3 = ctx.createGain(); g3.gain.value = 0.2;

  osc1.connect(g1).connect(filter);
  osc2.connect(g2).connect(filter);
  osc3.connect(g3).connect(filter);
  filter.connect(env);
  env.connect(_tanpuraGain);

  const now = ctx.currentTime;
  const dur = 3.5 * mult, A = 0.3 * mult, R = 1.0 * mult;
  const peak = 0.8 * gain;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + A);
  env.gain.setValueAtTime(peak, now + dur);
  env.gain.linearRampToValueAtTime(0, now + dur + R);

  const stopTime = now + dur + R + 0.05;
  [osc1, osc2, osc3].forEach(o => { o.start(now); o.stop(stopTime); });
  osc1.addEventListener("ended", () => {
    [osc1, osc2, osc3, g1, g2, g3, filter, env].forEach(n => { try { n.disconnect(); } catch {} });
  });
}

function _tanpuraPluckNext() {
  if (!_tanpuraActive) return;

  const midi      = _tanpuraStrings[_tanpuraStrIdx];
  const freq      = _tanpuraMidiToFreq(midi);
  const strGain   = _tanpuraStringGains[_tanpuraStrIdx];

  if (_tanpuraMode === "synth") {
    _tanpuraSynthNote(freq, strGain, _tanpuraSynthMult);
  } else {
    const samples = _tanpuraKsGenerate(freq, _tanpuraCtx.sampleRate, _tanpuraSynthMult * 10);
    for (let i = 0; i < samples.length; i++) samples[i] *= strGain;
    const buf     = _tanpuraCtx.createBuffer(1, samples.length, _tanpuraCtx.sampleRate);
    buf.copyToChannel(samples, 0);
    const src = _tanpuraCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_tanpuraGain);
    src.start();
    src.addEventListener("ended", () => src.disconnect());
  }

  _tanpuraStrIdx = (_tanpuraStrIdx + 1) % 4;
  const intervalMs = _tanpuraSyncBeats !== null
    ? (60 / _tanpuraBpm) * _tanpuraSyncBeats * 1000
    : _tanpuraRateToInterval(_tanpuraRate) * 1000;
  _tanpuraTimerId = setTimeout(_tanpuraPluckNext, intervalMs);
}

function tanpuraInit(ctx) {
  _tanpuraCtx  = ctx;
  _tanpuraGain = ctx.createGain();
  _tanpuraGain.gain.value = 0.6;
  _tanpuraGain.connect(getMasterGainNode());
}

function tanpuraStart() {
  if (_tanpuraActive) return;
  _tanpuraActive = true;
  _tanpuraStrIdx = 0;
  _tanpuraPluckNext();
}

function tanpuraStop() {
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
    _tanpuraPluckNext();
  }
}

// midiArray: sorted ascending, 1–4 elements; pads to 4 by repeating lowest note down an octave.
function tanpuraSetStrings(midiArray) {
  const arr = midiArray.slice(0, 4);
  console.log("arr:" + arr);
  while (arr.length < 4) {
    console.log("doing unshift");
    arr.unshift(arr[0] - 12);
  }
  _tanpuraStrings = arr;
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
    _tanpuraPluckNext();
  }
}
