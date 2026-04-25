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
const _dryGain         = _audioCtx.createGain();
const _reverbConvolver = _audioCtx.createConvolver();
const _wetGain         = _audioCtx.createGain();
const _compressor      = _audioCtx.createDynamicsCompressor();
_wetGain.gain.value        = 0;
_compressor.knee.value     = 6;
_compressor.attack.value   = 0.003;
_compressor.release.value  = 0.25;

// Chain: masterGain → dry/wet reverb mix → compressor → splitter (metering) + destination
_masterGainNode.connect(_dryGain);
_masterGainNode.connect(_reverbConvolver);
_reverbConvolver.connect(_wetGain);
_dryGain.connect(_compressor);
_wetGain.connect(_compressor);
_compressor.connect(_masterSplitter);
_compressor.connect(_audioCtx.destination);
_masterSplitter.connect(_masterAnalyserL, 0);
_masterSplitter.connect(_masterAnalyserR, 1);

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

  for (const { id: trackId, pan: trackPan = 0, clips } of trackGroups) {
    const mixerGain   = _audioCtx.createGain();
    const trackPanner = _audioCtx.createStereoPanner();
    const splitter    = _audioCtx.createChannelSplitter(2);
    const analyserL   = _audioCtx.createAnalyser();
    const analyserR   = _audioCtx.createAnalyser();

    trackPanner.pan.value = trackPan;
    mixerGain.connect(trackPanner);
    trackPanner.connect(splitter);
    splitter.connect(analyserL, 0); // L channel → analyserL (metering only)
    splitter.connect(analyserR, 1); // R channel → analyserR (metering only)
    trackPanner.connect(_masterGainNode);

    _trackMixers.set(trackId, { mixerGain, trackPanner, splitter, analyserL, analyserR });

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
      src.connect(gainNode).connect(mixerGain);
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
  // Memory Leak Prevention: disconnect all nodes per mixer so the AudioContext can release them.
  for (const { mixerGain, trackPanner, splitter, analyserL, analyserR } of _trackMixers.values()) {
    try { mixerGain.disconnect(); } catch {}
    try { trackPanner.disconnect(); } catch {}
    try { splitter.disconnect(); } catch {}
    try { analyserL.disconnect(); } catch {}
    try { analyserR.disconnect(); } catch {}
  }
  _trackMixers.clear();
}

function audioEngineSetTrackGain(trackId, gain) {
  const mixer = _trackMixers.get(trackId);
  if (mixer) mixer.mixerGain.gain.value = gain;
}

function audioEngineSetTrackPan(trackId, pan) {
  const mixer = _trackMixers.get(trackId);
  if (mixer) mixer.trackPanner.pan.value = pan;
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
let _rawMicMode     = false;

function audioEngineIsRawMicMode() { return _rawMicMode; }

async function audioEngineEnsureMicStream() {
  if (!_micStream) {
    const constraints = _rawMicMode
      ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }
      : { audio: true, video: false };
    _micStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const src = _audioCtx.createMediaStreamSource(_micStream);
    _micAnalyser = _audioCtx.createAnalyser();
    src.connect(_micAnalyser);
  }
  return _micStream;
}

async function audioEngineToggleRawMicMode() {
  _rawMicMode = !_rawMicMode;
  audioEngineCloseMicStream(); // force re-acquire with new constraints on next use
  return _rawMicMode;
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
        const decoded = await _audioCtx.decodeAudioData(ab);
        if (_autoNormalize) _normalizeBuffer(decoded);
        resolve(decoded);
      } catch {
        resolve(null);
      }
    };
    recorder.stop();
  });
}

let _previewSource = null;
let _previewStartContextTime = 0;
let _previewLoopStartSec     = 0;
let _previewLoopEndSec       = 0;

function audioEngineGetPreviewPosition() {
  if (!_previewSource) return -1;
  const loopLen = _previewLoopEndSec - _previewLoopStartSec;
  if (loopLen <= 0) return -1;
  const elapsed = _audioCtx.currentTime - _previewStartContextTime;
  return _previewLoopStartSec + (elapsed % loopLen);
}

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
  _previewSource           = src;
  _previewStartContextTime = _audioCtx.currentTime;
  _previewLoopStartSec     = loopStartSeconds;
  _previewLoopEndSec       = loopEndSeconds;
}

function audioEngineStopPreview() {
  if (_previewSource) {
    try { _previewSource.stop(); } catch {}
    _previewSource = null;
  }
}

// Memory Leak Prevention: stops mic tracks to release the device and disconnects the analyser node.
// Call this when closing a project or when the mic is no longer needed.
function audioEngineCloseMicStream() {
  if (_micStream) {
    _micStream.getTracks().forEach(t => t.stop());
    _micStream = null;
  }
  if (_micAnalyser) {
    try { _micAnalyser.disconnect(); } catch {}
    _micAnalyser = null;
  }
}

// ---- Latency Calibration

let _calibratedLatencyMs = 0;

function audioEngineGetCalibratedLatency() { return _calibratedLatencyMs; }
function audioEngineSetCalibratedLatency(ms) { _calibratedLatencyMs = ms; }

async function audioEngineCalibrate(onProgress) {
  // Separate raw stream — echoCancellation would actively suppress the reference tone.
  let calibStream;
  try {
    calibStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    throw new Error("Microphone access denied");
  }

  if (_audioCtx.state === "suspended") await _audioCtx.resume();

  const sampleRate   = _audioCtx.sampleRate;
  const FREQ         = 1000;
  const PULSE_ON     = 0.15;
  const PULSE_OFF    = 0.35;
  const NUM_PULSES   = 3;
  const CAPTURE_DUR  = NUM_PULSES * (PULSE_ON + PULSE_OFF) + 0.5;
  const SCHED_HEAD   = 0.15;

  // Capture PCM via ScriptProcessorNode; connect through zero-gain to avoid mic→speaker feedback.
  const BUFFER_SIZE = 4096;
  const micSource   = _audioCtx.createMediaStreamSource(calibStream);
  const processor   = _audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
  const silentGain  = _audioCtx.createGain();
  silentGain.gain.value = 0;
  silentGain.connect(_audioCtx.destination);

  const chunks       = [];
  let firstChunkTime = null;

  processor.onaudioprocess = (e) => {
    if (firstChunkTime === null) firstChunkTime = e.playbackTime;
    chunks.push(e.inputBuffer.getChannelData(0).slice());
  };

  micSource.connect(processor);
  processor.connect(silentGain);

  // Schedule pulsed tone through master chain so it reaches the speakers.
  const toneStart = _audioCtx.currentTime + SCHED_HEAD;
  const osc       = _audioCtx.createOscillator();
  const oscGain   = _audioCtx.createGain();
  osc.frequency.value = FREQ;
  oscGain.gain.value  = 0;
  osc.connect(oscGain);
  oscGain.connect(_masterGainNode);

  for (let i = 0; i < NUM_PULSES; i++) {
    const onAt  = toneStart + i * (PULSE_ON + PULSE_OFF);
    const offAt = onAt + PULSE_ON;
    oscGain.gain.setValueAtTime(0, onAt - 0.005);
    oscGain.gain.linearRampToValueAtTime(0.7, onAt);
    oscGain.gain.setValueAtTime(0.7, offAt - 0.005);
    oscGain.gain.linearRampToValueAtTime(0, offAt);
  }

  osc.start(toneStart);
  osc.stop(toneStart + CAPTURE_DUR);

  onProgress?.("Playing calibration tone…");

  await new Promise(r => setTimeout(r, (CAPTURE_DUR + SCHED_HEAD + 0.3) * 1000));

  try { processor.disconnect(); } catch {}
  try { micSource.disconnect(); } catch {}
  try { silentGain.disconnect(); } catch {}
  calibStream.getTracks().forEach(t => t.stop());

  onProgress?.("Analyzing…");

  if (!firstChunkTime) throw new Error("No audio captured — check microphone permissions");

  const totalSamples = chunks.reduce((s, c) => s + c.length, 0);
  const recorded     = new Float32Array(totalSamples);
  let off = 0;
  for (const c of chunks) { recorded.set(c, off); off += c.length; }

  // Slide a 20ms Goertzel window over the recording to find the 1kHz onset.
  const WIN      = Math.round(sampleRate * 0.02);
  const energies = [];
  for (let s = 0; s + WIN <= recorded.length; s += WIN) {
    energies.push({ start: s, e: _goertzelEnergy(recorded.subarray(s, s + WIN), FREQ, sampleRate) });
  }
  if (energies.length === 0) throw new Error("Recording was empty");

  const expectedOnset = Math.round((toneStart - firstChunkTime) * sampleRate);

  const noiseWindows = energies.filter(w => w.start + WIN < expectedOnset - WIN * 4);
  const noiseFloor   = noiseWindows.length > 0
    ? noiseWindows.reduce((s, w) => s + w.e, 0) / noiseWindows.length
    : 0;

  const peakEnergy = Math.max(...energies.map(w => w.e));
  const threshold  = noiseFloor + (peakEnergy - noiseFloor) * 0.3;

  const searchFrom = Math.max(0, expectedOnset - Math.round(sampleRate * 0.2));
  const onset      = energies.find(w => w.start >= searchFrom && w.e > threshold);

  if (!onset) throw new Error("Could not detect tone — try increasing speaker volume");

  const latencyMs = Math.round((onset.start - expectedOnset) / sampleRate * 1000);

  if (latencyMs < 0 || latencyMs > 500) throw new Error(`Implausible result: ${latencyMs} ms`);

  _calibratedLatencyMs = latencyMs;
  return latencyMs;
}

function _goertzelEnergy(samples, targetFreq, sampleRate) {
  const k     = Math.round(samples.length * targetFreq / sampleRate);
  const omega = 2 * Math.PI * k / samples.length;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
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

function _generateReverbIR(decaySeconds) {
  const sr  = _audioCtx.sampleRate;
  const len = Math.round(sr * decaySeconds);
  const buf = _audioCtx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.exp(-3 * i / len);
  }
  return buf;
}
_reverbConvolver.buffer = _generateReverbIR(1.5);

function _normalizeBuffer(buf) {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak < 0.0001) return;
  const scale = 1 / peak;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

function audioEngineNormalizeClip(clipId) {
  const buf = _buffers.get(clipId);
  if (buf) _normalizeBuffer(buf);
}

let _autoNormalize = false;
function audioEngineIsAutoNormalize() { return _autoNormalize; }
function audioEngineToggleAutoNormalize() { _autoNormalize = !_autoNormalize; return _autoNormalize; }

function audioEngineSetReverbWet(mix) {
  _dryGain.gain.value = 1 - mix;
  _wetGain.gain.value = mix;
}

function audioEngineSetReverbDecay(decaySeconds) {
  _reverbConvolver.buffer = _generateReverbIR(decaySeconds);
}

function audioEngineSetCompressorThreshold(db) {
  _compressor.threshold.value = db;
}

function audioEngineSetCompressorRatio(ratio) {
  _compressor.ratio.value = ratio;
}

function audioEngineGetCompressorReduction() {
  return _compressor.reduction;
}

function getAudioContext() { return _audioCtx; }
function getMasterGainNode() { return _masterGainNode; }
