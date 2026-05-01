// audio-engine.js
// Audio Engine — AudioContext, WAV decoding, clip scheduling -----

const _audioCtx = new AudioContext();
_audioCtx.addEventListener('statechange', () => console.log(`[audio-engine] AudioContext state → ${_audioCtx.state}`));
const _buffers = new Map(); // clipId (string) → AudioBuffer
let _activeSources = [];
const _trackMixers = new Map(); // trackId → { mixerGain, analyserL, analyserR }
// Default speakers bus — used when no explicit device is selected (deviceId = null)
const _speakersDestination = _audioCtx.createMediaStreamDestination();
const _speakersAudioEl = new Audio();
_speakersAudioEl.srcObject = _speakersDestination.stream;

// Per-device buses created on demand: deviceId → { gainNode, destination, audioEl }
const _outputBuses = new Map();

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
_compressor.connect(_speakersDestination);
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

function audioEngineGetAllBufferIds() {
  return [..._buffers.keys()];
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
async function audioEnginePlay(trackGroups, playheadSeconds, startT = null) {
  audioEngineStop();
  if (_audioCtx.state === "suspended") _audioCtx.resume();

  // Ensure all per-track buses exist before scheduling — fixes race condition
  // where deserialized bus creation hasn't resolved yet when play is pressed.
  const deviceIds = [...new Set(trackGroups.map(tg => tg.deviceId).filter(Boolean))];
  await Promise.all(deviceIds.map(id => audioEngineEnsureOutputBus(id)));

  _speakersAudioEl.play().catch(() => {});
  for (const bus of _outputBuses.values()) bus.audioEl.play().catch(() => {});
  _dumpMediaState();
  const now = startT ?? _audioCtx.currentTime;

  for (const { id: trackId, pan: trackPan = 0, deviceId = null, clips } of trackGroups) {
    // Disconnect any live mixer that was created while transport was stopped.
    const existing = _trackMixers.get(trackId);
    if (existing) _disconnectTrackMixer(existing);

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
    const _bus = deviceId ? _outputBuses.get(deviceId) : null;
    log(`audioEnginePlay: trackId=${trackId} deviceId=${deviceId ?? "(default)"} busFound=${!!_bus}`);
    trackPanner.connect(_bus ? _bus.gainNode : _masterGainNode);

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

function _disconnectTrackMixer({ mixerGain, trackPanner, splitter, analyserL, analyserR }) {
  try { mixerGain.disconnect(); } catch {}
  try { trackPanner.disconnect(); } catch {}
  try { splitter.disconnect(); } catch {}
  try { analyserL.disconnect(); } catch {}
  try { analyserR.disconnect(); } catch {}
}

function audioEngineStop() {
  _dumpMediaState();
  for (const src of _activeSources) {
    try { src.stop(); } catch {}
  }
  _activeSources = [];
  for (const mixer of _trackMixers.values()) _disconnectTrackMixer(mixer);
  _trackMixers.clear();
}

function audioEngineEnsureTrackMixer(trackId, gainValue = 1, panValue = 0, deviceId = null) {
  if (_trackMixers.has(trackId)) return;
  const mixerGain   = _audioCtx.createGain();
  const trackPanner = _audioCtx.createStereoPanner();
  const splitter    = _audioCtx.createChannelSplitter(2);
  const analyserL   = _audioCtx.createAnalyser();
  const analyserR   = _audioCtx.createAnalyser();

  mixerGain.gain.value  = gainValue;
  trackPanner.pan.value = panValue;
  mixerGain.connect(trackPanner);
  trackPanner.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
  const bus = deviceId ? _outputBuses.get(deviceId) : null;
  trackPanner.connect(bus ? bus.gainNode : _masterGainNode);

  _trackMixers.set(trackId, { mixerGain, trackPanner, splitter, analyserL, analyserR });
}

function audioEngineGetTrackMixerInput(trackId) {
  return _trackMixers.get(trackId)?.mixerGain ?? null;
}

function audioEngineSetTrackGain(trackId, gain) {
  const mixer = _trackMixers.get(trackId);
  if (mixer) mixer.mixerGain.gain.value = gain;
}

function audioEngineSetTrackPan(trackId, pan) {
  const mixer = _trackMixers.get(trackId);
  if (mixer) mixer.trackPanner.pan.value = pan;
}

async function audioEngineGetOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    log('[audio-engine] enumerateDevices not available (insecure context?)');
    return [];
  }
  let devices = await navigator.mediaDevices.enumerateDevices();
  // Chrome returns empty labels without mic permission (common on HTTP). If all
  // audiooutput labels are blank, request mic access once to unlock labels, then
  // re-enumerate and immediately release the stream.
  const rawOutputs = devices.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default');
  if (rawOutputs.length > 0 && rawOutputs.every(d => !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (err) {
      log('[audio-engine] getUserMedia for device labels failed:', err);
    }
  }
  // log('[audio-engine] all devices:', devices.map(d => ({ kind: d.kind, label: d.label, deviceId: d.deviceId })));
  const outputs = devices.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default');
  // log('[audio-engine] filtered outputs (non-default audiooutput):', outputs.map(d => ({ label: d.label, deviceId: d.deviceId })));
  return outputs;
}

function _dumpMediaState() {
  const snap = el => ({
    sinkId:        el.sinkId,
    paused:        el.paused,
    readyState:    el.readyState,
    muted:         el.muted,
    streamActive:  el.srcObject?.active,
    tracks:        el.srcObject?.getTracks().map(t => ({ kind: t.kind, readyState: t.readyState, enabled: t.enabled })),
  });
  const buses = {};
  for (const [id, bus] of _outputBuses) buses[id] = snap(bus.audioEl);
  log('media state — speakers:', snap(_speakersAudioEl), '| buses:', buses);
}

async function audioEngineEnsureOutputBus(deviceId) {
  if (!deviceId || _outputBuses.has(deviceId)) return;
  log(`audioEngineEnsureOutputBus: creating bus for deviceId=${deviceId}`);
  if (_audioCtx.state === 'suspended') await _audioCtx.resume();
  const gainNode = _audioCtx.createGain();
  const destination = _audioCtx.createMediaStreamDestination();
  gainNode.connect(destination);
  const audioEl = new Audio();
  audioEl.srcObject = destination.stream;
  try { await audioEl.setSinkId(deviceId); } catch (err) {
    log(`audioEngineEnsureOutputBus: setSinkId failed for deviceId=${deviceId}`, err);
  }
  audioEl.play().catch(err => log(`audioEngineEnsureOutputBus: play() failed for deviceId=${deviceId}`, err));
  _outputBuses.set(deviceId, { gainNode, destination, audioEl });
  log(`audioEngineEnsureOutputBus: bus ready for deviceId=${deviceId} sinkId=${audioEl.sinkId}`);
}

function audioEngineSetTrackOutput(trackId, deviceId) {
  const mixer = _trackMixers.get(trackId);
  const bus = deviceId ? _outputBuses.get(deviceId) : null;
  log(`audioEngineSetTrackOutput: trackId=${trackId} deviceId=${deviceId ?? "(default)"} mixerFound=${!!mixer} busFound=${!!bus}`);
  if (!mixer) return;
  const { trackPanner, splitter } = mixer;
  trackPanner.disconnect();
  trackPanner.connect(splitter);
  trackPanner.connect(bus ? bus.gainNode : _masterGainNode);
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

async function audioEngineSetMasterOutput(deviceId) {
  log(`audioEngineSetMasterOutput: deviceId=${deviceId ?? "(default)"}`);
  try {
    await _speakersAudioEl.setSinkId(deviceId || '');
    log(`audioEngineSetMasterOutput: sinkId now=${_speakersAudioEl.sinkId}`);
  } catch (err) {
    log('audioEngineSetMasterOutput: setSinkId failed', err);
  }
}

function audioEngineGetMasterOutputDeviceId() {
  return _speakersAudioEl.sinkId || null;
}

// Called after an async gap (e.g. soundfont loading) to ensure the audio output
// pipeline is still active.  Browsers may pause <audio> elements during long
// background tasks; this re-arms them without requiring a full audioEnginePlay.
function audioEngineEnsureOutput() {
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  if (_speakersAudioEl.paused) _speakersAudioEl.play().catch(() => {});
  for (const bus of _outputBuses.values()) {
    if (bus.audioEl.paused) bus.audioEl.play().catch(() => {});
  }
}

// ---- Microphone recording

let _micStream        = null;
let _micAnalyser      = null;
let _rawMicMode       = true;
let _workletNode      = null;
let _workletReady     = false;
let _recordedChunks   = []; // [{ channels: Float32Array[], t: number }]
let _isWorkletRecording = false;

function audioEngineIsRawMicMode() { return _rawMicMode; }

async function _ensureWorklet(micSource) {
  if (_workletReady) return;
  await _audioCtx.audioWorklet.addModule('./worklet-recorder.js');
  _workletNode = new AudioWorkletNode(_audioCtx, 'recorder', { channelCount: 2, channelCountMode: 'explicit' });
  _workletNode.port.onmessage = ({ data }) => {
    if (_isWorkletRecording) _recordedChunks.push(data);
  };
  micSource.connect(_workletNode);
  // worklet must be connected downstream to keep the graph active, but we don't want mic → speakers
  const _silentGain = _audioCtx.createGain();
  _silentGain.gain.value = 0;
  _workletNode.connect(_silentGain);
  _silentGain.connect(_audioCtx.destination);
  _workletReady = true;
}

async function audioEngineEnsureMicStream() {
  if (!_micStream) {
    const constraints = _rawMicMode
      ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }
      : { audio: true, video: false };
    _micStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (_audioCtx.state === "suspended") await _audioCtx.resume();
    const src = _audioCtx.createMediaStreamSource(_micStream);
    _micAnalyser = _audioCtx.createAnalyser();
    src.connect(_micAnalyser);
    await _ensureWorklet(src);
  }
  return _micStream;
}

async function audioEngineToggleRawMicMode() {
  _rawMicMode = !_rawMicMode;
  _workletReady = false; // force reconnect with new stream
  _workletNode?.disconnect();
  _workletNode = null;
  audioEngineCloseMicStream(); // force re-acquire with new constraints on next use
  return _rawMicMode;
}

function audioEngineGetInputLevel() {
  if (!_micAnalyser) return 0;
  return _getRMS(_micAnalyser);
}

let _recordingStartT = null; // ctx time of the intended downbeat — chunks before this are pre-roll

function audioEngineStartRecording(playbackStartT) {
  if (!_workletReady) return;
  if (_isWorkletRecording) {
    // Already running from an early call (e.g. count-in hand-off) — update trim point now that we have the real downbeat
    if (playbackStartT != null) _recordingStartT = playbackStartT;
    console.log('[rec] updated _recordingStartT:', _recordingStartT, 'ctx.currentTime:', _audioCtx.currentTime);
    return;
  }
  _recordedChunks = [];
  _recordingStartT = playbackStartT ?? null;
  _isWorkletRecording = true;
  _workletNode.port.postMessage('start');
  console.log('[rec] start — playbackStartT:', playbackStartT, '_recordingStartT:', _recordingStartT, 'ctx.currentTime:', _audioCtx.currentTime);
}

function audioEngineStopRecording() {
  return new Promise(resolve => {
    if (!_isWorkletRecording) { resolve(null); return; }
    _isWorkletRecording = false;
    _workletNode.port.postMessage('stop');

    let chunks = _recordedChunks;
    _recordedChunks = [];

    // Drop any chunks captured before the intended downbeat
    const beforeFilter = chunks.length;
    if (_recordingStartT != null) {
      chunks = chunks.filter(c => c.t >= _recordingStartT);
    }
    console.log('[rec] stop — _recordingStartT:', _recordingStartT, 'chunks before filter:', beforeFilter, 'after filter:', chunks.length, 'firstChunkT:', chunks[0]?.t);

    if (!chunks.length) { resolve(null); return; }

    const numChannels = chunks[0].channels.length;
    const totalSamples = chunks.reduce((sum, c) => sum + c.channels[0].length, 0);
    const buf = _audioCtx.createBuffer(numChannels, totalSamples, _audioCtx.sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const out = buf.getChannelData(ch);
      let offset = 0;
      for (const chunk of chunks) {
        const src = chunk.channels[ch] ?? chunk.channels[0]; // fall back to ch0 if mono
        out.set(src, offset);
        offset += src.length;
      }
    }

    if (_autoNormalize) _normalizeBuffer(buf);
    resolve({ buffer: buf, firstChunkT: chunks[0].t });
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

function audioEnginePreviewLoop(buffer, loopStartSeconds, loopEndSeconds, destination = null) {
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
  src.connect(destination ?? _audioCtx.destination);
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

function audioEngineEnsureLiveOutput() {
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  _speakersAudioEl.play().catch(() => {});
}
