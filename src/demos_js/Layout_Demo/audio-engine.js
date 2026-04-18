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

function audioEngineGetBuffer(clipId) {
  return _buffers.get(clipId);
}

function audioEngineRemoveBuffer(clipId) {
  _buffers.delete(clipId);
}

function audioEngineClearBuffers() {
  _buffers.clear();
}

function audioEngineHasBuffer(clipId) {
  return _buffers.has(clipId);
}

function audioEngineEncodeWav(audioBuffer) {
  const numChannels  = audioBuffer.numberOfChannels;
  const sampleRate   = audioBuffer.sampleRate;
  const numSamples   = audioBuffer.length;
  const blockAlign   = numChannels * 2;
  const dataSize     = numSamples * blockAlign;
  const buf          = new ArrayBuffer(44 + dataSize);
  const view         = new DataView(buf);
  const write        = (off, str) =>
    [...str].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));

  write(0,  "RIFF");
  view.setUint32( 4, 36 + dataSize,          true);
  write(8,  "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16,                     true);
  view.setUint16(20,  1,                     true); // PCM
  view.setUint16(22, numChannels,            true);
  view.setUint32(24, sampleRate,             true);
  view.setUint32(28, sampleRate * blockAlign,true);
  view.setUint16(32, blockAlign,             true);
  view.setUint16(34, 16,                     true); // bits per sample
  write(36, "data");
  view.setUint32(40, dataSize,               true);

  const channels = Array.from({ length: numChannels }, (_, c) => audioBuffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 32768 : s * 32767, true);
      off += 2;
    }
  }

  return new Uint8Array(buf);
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

let _previewSource = null;

function audioEnginePreviewLoop(buffer, loopStartSeconds, loopEndSeconds) {
  audioEngineStopPreview();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  const src = _audioCtx.createBufferSource();
  src.buffer    = buffer;
  src.loop      = true;
  src.loopStart = loopStartSeconds;
  src.loopEnd   = loopEndSeconds;
  src.connect(_audioCtx.destination);
  src.start(0, loopStartSeconds);
  _previewSource = src;
}

function audioEngineStopPreview() {
  if (_previewSource) {
    try { _previewSource.stop(); } catch {}
    _previewSource = null;
  }
}
