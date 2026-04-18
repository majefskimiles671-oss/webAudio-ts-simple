// audio-engine.js
// Audio Engine — AudioContext, WAV decoding, clip scheduling -----

const _audioCtx = new AudioContext();
const _buffers = new Map(); // clipId (string) → AudioBuffer
let _activeSources = [];

function audioEngineDecodeWav(arrayBuffer) {
  return _audioCtx.decodeAudioData(arrayBuffer);
}

function audioEngineStoreBuffer(clipId, audioBuffer) {
  _buffers.set(clipId, audioBuffer);
}

function audioEngineRemoveBuffer(clipId) {
  _buffers.delete(clipId);
}

function audioEngineHasBuffer(clipId) {
  return _buffers.has(clipId);
}

// clips: array of { id, startSample, durationSamples }
// playheadSeconds: current playhead position in seconds
// SAMPLE_RATE is a global from index.js, available by call time
function audioEnginePlay(clips, playheadSeconds) {
  audioEngineStop();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  const now = _audioCtx.currentTime;
  for (const clip of clips) {
    const buffer = _buffers.get(clip.id);
    if (!buffer) continue;
    const clipStart = clip.startSample / SAMPLE_RATE;
    const clipEnd   = (clip.startSample + clip.durationSamples) / SAMPLE_RATE;
    if (playheadSeconds >= clipEnd) continue;
    const src = _audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(_audioCtx.destination);
    let when, offset;
    if (playheadSeconds <= clipStart) {
      when   = now + (clipStart - playheadSeconds);
      offset = 0;
    } else {
      when   = now;
      offset = playheadSeconds - clipStart;
    }
    src.start(when, offset);
    _activeSources.push(src);
  }
}

function audioEngineStop() {
  for (const src of _activeSources) {
    try { src.stop(); } catch {}
  }
  _activeSources = [];
}
