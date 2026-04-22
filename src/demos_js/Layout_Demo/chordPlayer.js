// chordPlayer.js
// Karplus-Strong plucked-string synthesis for chord diagram playback.
// Algorithm runs in JS (pre-computed buffer), avoiding WebAudio feedback graph instability.

const _STRING_ROOT_MIDI = [40, 45, 50, 55, 59, 64]; // low E2 → high E4
const _STRUM_DELAYS_S   = [0.022, 0.5];
let _strumDelayIdx      = 0;

function _midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function _chordToFreqs(chord) {
  const freqs = [];
  for (let s = 0; s < 6; s++) {
    if (chord.tops[s] === "x") continue;

    const dotIndex = chord.dots[s].indexOf(true);
    let midi;
    if (dotIndex === -1) {
      midi = _STRING_ROOT_MIDI[s];
    } else {
      midi = _STRING_ROOT_MIDI[s] + (chord.baseFret - 1) + (dotIndex + 1);
    }
    freqs.push({ string: s, freq: _midiToFreq(midi) });
  }
  return freqs;
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

function _ksPluck(ctx, freq, startTime) {
  const samples = _ksGenerate(freq, ctx.sampleRate, 3.5);
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

  const notes      = _chordToFreqs(chord);
  const now        = ctx.currentTime + 0.01;
  const strumDelay = _STRUM_DELAYS_S[_strumDelayIdx];
  _strumDelayIdx   = (_strumDelayIdx + 1) % _STRUM_DELAYS_S.length;

  notes.forEach(({ freq }, i) => {
    _ksPluck(ctx, freq, now + i * strumDelay);
  });
}
