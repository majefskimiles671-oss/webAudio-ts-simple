// chordPlayer.js
// Karplus-Strong plucked-string synthesis for chord diagram playback.
// Algorithm runs in JS (pre-computed buffer), avoiding WebAudio feedback graph instability.

let _synthMode = "pluck"; // "pluck" | "synth"
let _activeVoices = [];   // { oscs, env } — released on re-trigger

function _midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Returns one freq per string (first dot, or open string). Used for normal chords.
function _chordToFreqs(chord) {
  const freqs = [];
  cdStringFrets(chord).forEach((frets, s) => {
    if (frets[0] === "x") return;
    const fretIndex = frets.indexOf(true);
    if (fretIndex === -1 && frets[0] !== "o") return;
    const midi = fretIndex === -1
      ? currentTuning.openMidi(s + 1)
      : currentTuning.openMidi(s + 1) + (chord.baseFret - 1) + fretIndex;
    freqs.push(_midiToFreq(midi));
  });
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

  for (let i = 0; i < N; i++) delay[i] = Math.random() * 2 - 1;

  for (let i = 0; i < totalSamples; i++) {
    const idx  = i % N;
    const next = (i + 1) % N;
    output[i]  = delay[idx] * 0.45;
    delay[idx] = 0.996 * 0.5 * (delay[idx] + delay[next]);
  }
  return output;
}

function _ksPluck(ctx, freq, startTime, durationSec = 3.5) {
  const samples = _ksGenerate(freq, ctx.sampleRate, durationSec);
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.copyToChannel(samples, 0);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(getMasterGainNode());
  src.start(startTime);
  src.addEventListener("ended", () => src.disconnect());
}

function _synthPlayNote(ctx, freq, startTime, durationSec) {
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

  const A = 0.35, D = 0.15, S = 0.65, R = 1.2;
  env.gain.setValueAtTime(0,   startTime);
  env.gain.linearRampToValueAtTime(1.0, startTime + A);
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
      _activeVoices.push(_synthPlayNote(ctx, freq, now + i * gap, 4.0));
    });
    return;
  }
  if (_isScale(chord)) {
    const freqs = _scaleToFreqs(chord);
    freqs.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.5, 0.375));
  } else {
    const freqs = _chordToFreqs(chord);
    freqs.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.022));
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
      _activeVoices.push(_synthPlayNote(ctx, freq, now + i * 0.5, 3.0));
    });
    return;
  }
  if (_isScale(chord)) {
    const asc  = _scaleToFreqs(chord);
    const desc = [...asc].reverse();
    const sequence = [...asc, ...desc.slice(1)];
    sequence.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.5, 0.375));
  } else {
    const freqs = _chordToFreqs(chord);
    freqs.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.5));
  }
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
