// chordPlayer.js
// Karplus-Strong plucked-string synthesis for chord diagram playback.
// Algorithm runs in JS (pre-computed buffer), avoiding WebAudio feedback graph instability.

let _synthMode         = "pluck"; // "pluck" | "synth"
let _synthNoteMult     = 1;       // global length multiplier for all synth note playback
let _activeVoices      = [];      // { oscs, env } — released on re-trigger
let _pluckDurationMult = 0.9;
let _pluckVolume       = 1.2;
let _pluckGainNode     = null;
let _pluckAttack       = 0.008;
let _pluckDecay        = 0.15;
let _pluckSustain      = 0.8;
let _pluckRelease      = 0.24;

function _getPluckGainNode(ctx) {
  if (!_pluckGainNode || _pluckGainNode.context !== ctx) {
    _pluckGainNode = ctx.createGain();
    _pluckGainNode.gain.value = _pluckVolume;
    _pluckGainNode.connect(getMasterGainNode());
  }
  return _pluckGainNode;
}

function _midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Returns one freq per string (first dot, or open string). Used for normal chords.
function _chordToFreqs(chord) {
  const freqs = [];
  for (let s = 0; s < 6; s++) {
    if (chord.tops[s] === "x") continue;
    const r = chord.dots[s].indexOf(true);
    if (r === -1 && chord.tops[s] !== "o") continue;
    const midi = r === -1
      ? currentTuning.openMidi(s + 1)
      : currentTuning.openMidi(s + 1) + chord.baseFret + r;
    freqs.push(_midiToFreq(midi));
  }
  return freqs.reverse();
}

// Returns every note in the diagram sorted ascending by pitch.
// Open strings (no dots, not muted) count as fret 0 on that string.
function _scaleToFreqs(chord) {
  const freqs = [];
  for (let s = 0; s < 6; s++) {
    if (chord.tops[s] === "x") continue;
    if (chord.tops[s] == null && !chord.dots[s].some(Boolean)) continue;
    let stringHasDot = false;
    for (let r = 0; r < chord.dots[s].length; r++) {
      if (chord.dots[s][r]) {
        freqs.push(_midiToFreq(currentTuning.openMidi(s + 1) + (chord.baseFret - 1) + (r + 1)));
        stringHasDot = true;
      }
    }
    if (!stringHasDot || chord.tops[s] === "o") {
      freqs.push(_midiToFreq(currentTuning.openMidi(s + 1)));
    }
  }
  return freqs.sort((a, b) => a - b);
}

// A scale has at least one string with more than one note indicator (tops "o" + dots both count).
function _isScale(chord) {
  return chord.dots.some((stringDots, s) => {
    const topCount = chord.tops[s] === "o" ? 1 : 0;
    const dotCount = stringDots.filter(Boolean).length;
    return topCount + dotCount > 1;
  });
}

// Karplus-Strong computed in JS: fill a delay line with noise then iteratively
// average adjacent samples with a decay factor. High freqs die out first — just
// like a real string.
function _ksGenerate(freq, sampleRate, durationSec) {
  const N = Math.max(2, Math.round(sampleRate / freq));
  const totalSamples = Math.round(sampleRate * durationSec);
  const output = new Float32Array(totalSamples);
  const delay  = new Float32Array(N);

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
  return output;
}

function _ksPluck(ctx, freq, startTime, durationSec = 3.5, gainMult = 1) {
  const samples = _ksGenerate(freq, ctx.sampleRate, durationSec);
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.copyToChannel(samples, 0);

  const A = _pluckAttack, D = _pluckDecay, S = _pluckSustain * gainMult, R = _pluckRelease;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startTime);
  env.gain.linearRampToValueAtTime(gainMult, startTime + A);
  env.gain.linearRampToValueAtTime(S, startTime + A + D);
  const releaseStart = Math.max(startTime + A + D, startTime + durationSec - R);
  env.gain.setValueAtTime(S, releaseStart);
  env.gain.linearRampToValueAtTime(0, releaseStart + R);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(env);
  env.connect(_getPluckGainNode(ctx));
  src.start(startTime);
  src.addEventListener("ended", () => { src.disconnect(); env.disconnect(); });
  return src;
}

function _synthPlayNote(ctx, freq, startTime, durationSec, gainMult = 1) {
  const env    = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type            = "lowpass";
  filter.frequency.value = 900;
  filter.Q.value         = 1.2;

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
  env.connect(getMasterGainNode());

  const A = 0.35 * _synthNoteMult, D = 0.15 * _synthNoteMult, S = 0.65 * gainMult, R = 1.2 * _synthNoteMult;
  env.gain.setValueAtTime(0,   startTime);
  env.gain.linearRampToValueAtTime(gainMult, startTime + A);
  env.gain.linearRampToValueAtTime(S,   startTime + A + D);
  env.gain.setValueAtTime(S,            startTime + durationSec);
  env.gain.linearRampToValueAtTime(0,   startTime + durationSec + R);

  const stopTime = startTime + durationSec + R + 0.05;
  [osc1, osc2, osc3].forEach(o => { o.start(startTime); o.stop(stopTime); });
  osc1.addEventListener("ended", () => {
    [osc1, osc2, osc3, g1, g2, g3, filter, env].forEach(n => { try { n.disconnect(); } catch {} });
  });
  return { oscs: [osc1, osc2, osc3], env };
}

function _synthReleaseAll(ctx) {
  const now = ctx.currentTime;
  for (const v of _activeVoices) {
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setValueAtTime(v.env.gain.value, now);
    v.env.gain.linearRampToValueAtTime(0, now + 1.2);
    v.oscs.forEach(o => { try { o.stop(now + 1.25); } catch {} });
  }
  _activeVoices = [];
}

function cpGetSynthMode()  { return _synthMode; }
function cpGetSynthMult()  { return _synthNoteMult; }
function cpSetSynthMult(m) { _synthNoteMult = m; }
function cpSetPluckMult(m)    { _pluckDurationMult = m; }
function cpSetPluckVolume(v) {
  _pluckVolume = v;
  if (_pluckGainNode) _pluckGainNode.gain.value = v;
}
function cpSetPluckAttack(a)  { _pluckAttack  = a; }
function cpSetPluckDecay(d)   { _pluckDecay   = d; }
function cpSetPluckSustain(s) { _pluckSustain = s; }
function cpSetPluckRelease(r) { _pluckRelease = r; }

function cpSetSynthMode(mode) {
  _synthMode = mode;
  document.querySelectorAll(".cd-sound-seg .cd-sound-btn").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.toLowerCase() === mode);
  });
}

function cdBuildSoundToggle() {
  const seg = document.createElement("div");
  seg.className = "cd-sound-seg";

  ["pluck", "synth"].forEach(mode => {
    const btn = document.createElement("button");
    btn.className = "cd-sound-btn" + (_synthMode === mode ? " active" : "");
    btn.textContent = mode === "pluck" ? "Pluck" : "Synth";
    btn.addEventListener("click", () => {
      _synthMode = mode;
      seg.querySelectorAll(".cd-sound-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    seg.appendChild(btn);
  });
  return seg;
}

// Single click: strum for chords; ascending run for scales.
function playChordStrum(chord) {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  startMeterAnimation();
  const now = ctx.currentTime + 0.01;
  if (_synthMode === "synth") {
    _synthReleaseAll(ctx);
    const freqs = _isScale(chord) ? _scaleToFreqs(chord) : _chordToFreqs(chord);
    const gap   = _isScale(chord) ? 0.08 : 0.022;
    freqs.forEach((freq, i) => {
      _activeVoices.push(_synthPlayNote(ctx, freq, now + i * gap, 4.0 * _synthNoteMult));
    });
    return;
  }
  if (_isScale(chord)) {
    const freqs = _scaleToFreqs(chord);
    freqs.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.5, 0.375 * _pluckDurationMult));
  } else {
    const freqs = _chordToFreqs(chord);
    freqs.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.022, 3.5 * _pluckDurationMult));
  }
}

// Double click: play notes spaced out over time.
function playChordSpaced(chord) {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  startMeterAnimation();
  const now = ctx.currentTime + 0.01;
  if (_synthMode === "synth") {
    _synthReleaseAll(ctx);
    let seq;
    if (_isScale(chord)) {
      const asc = _scaleToFreqs(chord);
      seq = [...asc, ...[...asc].reverse().slice(1)];
    } else {
      seq = _chordToFreqs(chord);
    }
    seq.forEach((freq, i) => {
      _activeVoices.push(_synthPlayNote(ctx, freq, now + i * 0.5, 3.0 * _synthNoteMult));
    });
    return;
  }
  if (_isScale(chord)) {
    const asc  = _scaleToFreqs(chord);
    const desc = [...asc].reverse();
    const sequence = [...asc, ...desc.slice(1)];
    sequence.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.5, 0.375 * _pluckDurationMult));
  } else {
    const freqs = _chordToFreqs(chord);
    freqs.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.5, 3.5 * _pluckDurationMult));
  }
}

// Chord Player - Scheduling - Playback -----
// Schedules a single MIDI note at an exact WebAudio time. Returns stoppable nodes.
function cpScheduleNoteAt(freq, ctx, audioTime, durationSec, velocity = 100, mode = "pluck") {
  const gainMult = velocity / 127;
  if (mode === "pluck") {
    const src = _ksPluck(ctx, freq, audioTime, Math.max(durationSec, 0.1) * _pluckDurationMult, gainMult);
    return src ? [src] : [];
  }
  const voice = _synthPlayNote(ctx, freq, audioTime, durationSec * _synthNoteMult, gainMult);
  return voice?.oscs ?? [];
}

// Schedules a strum at an exact WebAudio time. Returns stoppable nodes for cancellation.
function cpScheduleChordAt(chord, ctx, audioTime, mode = "pluck") {
  const freqs = _chordToFreqs(chord);
  const nodes = [];
  freqs.forEach((freq, i) => {
    const t = audioTime + i * 0.022;
    if (mode === "pluck") {
      const src = _ksPluck(ctx, freq, t, 3.5 * _pluckDurationMult);
      if (src) nodes.push(src);
    } else {
      const voice = _synthPlayNote(ctx, freq, t, 2.0 * _synthNoteMult);
      if (voice?.oscs) nodes.push(...voice.oscs);
    }
  });
  return nodes;
}

// Attach single/double-click play handlers to a button element.
// Single click → strum, double click → spaced notes.
function cdAttachPlayHandlers(btn, getChord) {
  let clickTimer = null;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      return;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      playChordStrum(getChord());
    }, 220);
  });
  btn.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    playChordSpaced(getChord());
  });
}
