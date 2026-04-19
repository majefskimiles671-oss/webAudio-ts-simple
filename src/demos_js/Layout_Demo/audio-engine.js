// audio-engine.js
// Audio Engine — AudioContext, WAV decoding, clip scheduling -----

const _audioCtx = new AudioContext();
const _buffers = new Map(); // clipId (string) → AudioBuffer
let _activeSources = [];
const _trackMixers = new Map(); // trackId → { mixerGain, analyserL, analyserR }

// Master chain — persists for the lifetime of the context.
// All track mixers connect here; master gain controls output level.
const _masterGainNode  = _audioCtx.createGain();
const _masterSplitter  = _audioCtx.createChannelSplitter(2);
const _masterAnalyserL = _audioCtx.createAnalyser();
const _masterAnalyserR = _audioCtx.createAnalyser();
_masterGainNode.connect(_masterSplitter);
_masterSplitter.connect(_masterAnalyserL, 0);
_masterSplitter.connect(_masterAnalyserR, 1);
_masterGainNode.connect(_audioCtx.destination);

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

function audioEngineCreateBuffer(numChannels, numSamples) {
  return _audioCtx.createBuffer(numChannels, numSamples, SAMPLE_RATE);
}

// trackGroups: array of { id, clips: [{ id, startSample, durationSamples, gain?, pan? }] }
// gain: 0..1, pan: -1..1 (optional, defaults to 1 and 0)
// SAMPLE_RATE is a global from index.js, available by call time
function audioEnginePlay(trackGroups, playheadSeconds) {
  audioEngineStop();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  const now = _audioCtx.currentTime;

  for (const { id: trackId, clips } of trackGroups) {
    const mixerGain = _audioCtx.createGain();
    const splitter  = _audioCtx.createChannelSplitter(2);
    const analyserL = _audioCtx.createAnalyser();
    const analyserR = _audioCtx.createAnalyser();

    mixerGain.connect(splitter);
    splitter.connect(analyserL, 0); // L channel → analyserL (metering only)
    splitter.connect(analyserR, 1); // R channel → analyserR (metering only)
    mixerGain.connect(_masterGainNode);

    _trackMixers.set(trackId, { mixerGain, analyserL, analyserR });

    for (const clip of clips) {
      const buffer = _buffers.get(clip.id);
      if (!buffer) continue;
      const clipStart = clip.startSample / SAMPLE_RATE;
      const clipEnd   = (clip.startSample + clip.durationSamples) / SAMPLE_RATE;
      if (playheadSeconds >= clipEnd) continue;
      const src = _audioCtx.createBufferSource();
      src.buffer = buffer;
      const gainNode = _audioCtx.createGain();
      gainNode.gain.value = clip.gain ?? 1;
      const panner = _audioCtx.createStereoPanner();
      panner.pan.value = clip.pan ?? 0;
      src.connect(gainNode).connect(panner).connect(mixerGain);
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
}

function audioEngineStop() {
  for (const src of _activeSources) {
    try { src.stop(); } catch {}
  }
  _activeSources = [];
  for (const { mixerGain } of _trackMixers.values()) {
    try { mixerGain.disconnect(); } catch {}
  }
  _trackMixers.clear();
}

function audioEngineSetTrackGain(trackId, gain) {
  const mixer = _trackMixers.get(trackId);
  if (mixer) mixer.mixerGain.gain.value = gain;
}

function _getRMS(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function audioEngineGetTrackLevel(trackId) {
  const m = _trackMixers.get(trackId);
  if (!m) return { L: 0, R: 0 };
  return { L: _getRMS(m.analyserL), R: _getRMS(m.analyserR) };
}

function audioEngineGetMasterLevel() {
  return { L: _getRMS(_masterAnalyserL), R: _getRMS(_masterAnalyserR) };
}

function audioEngineSetMasterGain(value) {
  _masterGainNode.gain.value = value;
}

// ---- Microphone recording

let _micStream      = null;
let _micAnalyser    = null;
let _mediaRecorder  = null;
let _recordedChunks = [];

async function audioEngineEnsureMicStream() {
  if (!_micStream) {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const src = _audioCtx.createMediaStreamSource(_micStream);
    _micAnalyser = _audioCtx.createAnalyser();
    src.connect(_micAnalyser);
  }
  return _micStream;
}

function audioEngineGetInputLevel() {
  if (!_micAnalyser) return 0;
  return _getRMS(_micAnalyser);
}

function audioEngineStartRecording() {
  if (!_micStream || _mediaRecorder) return; // idempotent
  const chunks = [];
  _recordedChunks = chunks;
  _mediaRecorder = new MediaRecorder(_micStream);
  _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  _mediaRecorder.start();
}

function audioEngineStopRecording() {
  return new Promise(resolve => {
    if (!_mediaRecorder) { resolve(null); return; }
    const recorder = _mediaRecorder;
    const chunks   = _recordedChunks;
    _mediaRecorder  = null;
    _recordedChunks = [];
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      try {
        const ab = await blob.arrayBuffer();
        resolve(await _audioCtx.decodeAudioData(ab));
      } catch {
        resolve(null);
      }
    };
    recorder.stop();
  });
}

let _previewSource = null;

function audioEnginePreviewLoop(buffer, loopStartSeconds, loopEndSeconds) {
  audioEngineStopPreview();
  if (_audioCtx.state === "suspended") _audioCtx.resume();

  // If loop end exceeds actual audio, build a zero-padded buffer so the
  // silence tail is included in the loop rather than being silently clipped.
  let playBuffer = buffer;
  if (loopEndSeconds > buffer.duration) {
    const paddedLen = Math.ceil(loopEndSeconds * buffer.sampleRate);
    playBuffer = _audioCtx.createBuffer(buffer.numberOfChannels, paddedLen, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      playBuffer.getChannelData(ch).set(buffer.getChannelData(ch));
    }
  }

  const src = _audioCtx.createBufferSource();
  src.buffer    = playBuffer;
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

function audioEngineRenderLoop(srcBuffer, loopStartSamples, loopEndSamples, outputSamples) {
  const numChannels = srcBuffer.numberOfChannels;
  const out = _audioCtx.createBuffer(numChannels, outputSamples, srcBuffer.sampleRate);
  const loopLen = loopEndSamples - loopStartSamples;
  for (let ch = 0; ch < numChannels; ch++) {
    const src  = srcBuffer.getChannelData(ch);
    const dest = out.getChannelData(ch);
    for (let i = 0; i < outputSamples; i++) {
      const srcIdx = loopStartSamples + (i % loopLen);
      dest[i] = srcIdx < src.length ? src[srcIdx] : 0;
    }
  }
  return out;
}
