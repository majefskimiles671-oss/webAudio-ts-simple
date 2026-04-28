// soundfontEngine.js
// Schedules GM notes from a loaded .sf2 file entirely in Web Audio.

const SF_PERCUSSION = -1; // sentinel for GM channel 9 (drums / bank 128)

// Cache: program → Map<rootMidiPitch, {buffer, loops, loopStart, loopEnd, name?}>
const _sfCache = new Map();

// --- SF2 state (priority: project > global > default) ---
let _sf2DefaultData = null; // Map<program,noteMap> from auto-loaded default.sf2
let _sf2GlobalData  = null; // session-wide font chosen by user (not saved with projects)
let _sf2DefaultName = null;
let _sf2GlobalName  = null;
let _sf2ProjectData = null; // parsed data for the current project's font
let _sf2ProjectFile = null; // File object (written into project on save)
let _sf2ProjectName = null;

function sfGetLoadedName() {
  return _sf2ProjectName ?? _sf2GlobalName ?? _sf2DefaultName ?? null;
}
function sfGetGlobalName()  { return _sf2GlobalName; }
function sfGetProjectFile() { return _sf2ProjectFile; }

async function _sfPopulateCache(data) {
  _sfCache.clear();
  for (const [program, noteMap] of data) _sfCache.set(program, noteMap);
}

function sfGetPercussionName(pitch) {
  const noteMap = _sfCache.get(SF_PERCUSSION);
  if (!noteMap) return null;
  const srcPitch = _sfClosestPitch(noteMap, pitch);
  return srcPitch !== null ? (noteMap.get(srcPitch)?.name ?? null) : null;
}

async function sfLoadDefault(arrayBuffer, name) {
  const data = await sf2Parse(arrayBuffer, getAudioContext());
  _sf2DefaultData = data;
  _sf2DefaultName = name ?? null;
  if (!_sf2GlobalData && !_sf2ProjectData) await _sfPopulateCache(data);
  log(`[soundfont] ${name ?? 'default'} loaded: ${data.size} programs`);
}

async function sfLoadGlobal(file) {
  const ab   = await file.arrayBuffer();
  const data = await sf2Parse(ab, getAudioContext());
  _sf2GlobalData = data;
  _sf2GlobalName = file.name;
  if (!_sf2ProjectData) await _sfPopulateCache(data);
  log(`[soundfont] global SF2 loaded: ${file.name}, ${data.size} programs`);
}

async function sfLoadFromFile(file, nameOverride) {
  const ab   = await file.arrayBuffer();
  const data = await sf2Parse(ab, getAudioContext());
  _sf2ProjectFile = file;
  _sf2ProjectName = nameOverride ?? file.name;
  _sf2ProjectData = data;
  await _sfPopulateCache(data);
  log(`[soundfont] project SF2 loaded: ${_sf2ProjectName}, ${data.size} programs`);
}

function sfClearProjectFont() {
  _sf2ProjectFile = null;
  _sf2ProjectName = null;
  _sf2ProjectData = null;
  const fallback = _sf2GlobalData ?? _sf2DefaultData;
  if (fallback) {
    _sfPopulateCache(fallback);
  } else {
    _sfCache.clear();
  }
}

// No-op — kept so midiEngine call sites don't need changing.
// Programs are pre-loaded when the SF2 is parsed; nothing to fetch at play time.
async function sfEnsureProgram(_program) {}

function _sfClosestPitch(noteMap, target) {
  if (noteMap.has(target)) return target;
  let best = null, bestDist = Infinity;
  for (const p of noteMap.keys()) {
    const d = Math.abs(p - target);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

function sfNoteOn(dest, program, pitch, velocity) {
  const noteMap = _sfCache.get(program);
  if (!noteMap) return null;

  const srcPitch = _sfClosestPitch(noteMap, pitch);
  if (srcPitch === null) return null;

  const ctx   = getAudioContext();
  const entry = noteMap.get(srcPitch);

  const src = ctx.createBufferSource();
  src.buffer       = entry.buffer;
  src.detune.value = (pitch - srcPitch) * 100;
  if (entry.loops && entry.loopEnd > entry.loopStart) {
    src.loop      = true;
    src.loopStart = entry.loopStart;
    src.loopEnd   = entry.loopEnd;
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime((velocity / 127) * 0.9, ctx.currentTime);
  src.connect(gain);
  gain.connect(dest ?? ctx.destination);
  src.start();
  return { src, gain };
}

function sfNoteOff(handle) {
  if (!handle) return;
  const { src, gain } = handle;
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.1);
  try { src.stop(now + 0.15); } catch (_) {}
}

function sfScheduleNote(dest, program, pitch, velocity, audioTime, durationSec) {
  const noteMap = _sfCache.get(program);
  if (!noteMap) return [];

  const srcPitch = _sfClosestPitch(noteMap, pitch);
  if (srcPitch === null) return [];

  const ctx   = getAudioContext();
  const entry = noteMap.get(srcPitch);

  const src = ctx.createBufferSource();
  src.buffer       = entry.buffer;
  src.detune.value = (pitch - srcPitch) * 100;
  if (entry.loops && entry.loopEnd > entry.loopStart) {
    src.loop      = true;
    src.loopStart = entry.loopStart;
    src.loopEnd   = entry.loopEnd;
  }

  const gain = ctx.createGain();
  const vol  = (velocity / 127) * 0.9;
  gain.gain.setValueAtTime(vol, audioTime);
  gain.gain.setTargetAtTime(0, audioTime + durationSec, 0.08);

  src.connect(gain);
  gain.connect(dest ?? ctx.destination);

  src.start(audioTime);
  src.stop(audioTime + durationSec + 0.5);

  return [src];
}
