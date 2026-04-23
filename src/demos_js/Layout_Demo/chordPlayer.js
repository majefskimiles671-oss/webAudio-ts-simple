// chordPlayer.js
// Karplus-Strong plucked-string synthesis for chord diagram playback.
// Algorithm runs in JS (pre-computed buffer), avoiding WebAudio feedback graph instability.

const _STRUM_DELAYS_S = [0.022, 0.5];
let _strumDelayIdx      = 0;

function _midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Returns one freq per string (first dot, or open string). Used for normal chords.
function _chordToFreqs(chord) {
  const freqs = [];
  cdStringFrets(chord).forEach((frets, s) => {
    if (frets[0] === "x") return;
    const fretIndex = frets.indexOf(true);
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
  // console.log("midi:", Math.round(69 + 12 * Math.log2(freq / 440)));
  const samples = _ksGenerate(freq, ctx.sampleRate, durationSec);
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.copyToChannel(samples, 0);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(startTime);
  src.addEventListener("ended", () => src.disconnect());
}

function playChord(chord) {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const now = ctx.currentTime + 0.01;

  if (_isScale(chord)) {
    const asc  = _scaleToFreqs(chord);
    const desc = [...asc].reverse();
    const sequence = [...asc, ...desc.slice(1)];
    sequence.forEach((freq, i) => _ksPluck(ctx, freq, now + i * 0.5, 0.375));
  } else {
    const freqs      = _chordToFreqs(chord);
    const strumDelay = _STRUM_DELAYS_S[_strumDelayIdx];
    _strumDelayIdx   = (_strumDelayIdx + 1) % _STRUM_DELAYS_S.length;
    freqs.forEach((freq, i) => _ksPluck(ctx, freq, now + i * strumDelay));
  }
}
