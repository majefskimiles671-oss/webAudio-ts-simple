// soundfontEngine.js
// Schedules GM notes from a loaded .sf2 file entirely in Web Audio.

const SF_PERCUSSION = -1; // sentinel for GM channel 9 (drums / bank 128)

// Cache: program → Map<rootMidiPitch, {buffer, loops, loopStart, loopEnd}>
const _sfCache = new Map();

// --- Per-project SF2 state ---
let _sf2DefaultData = null; // Map<program,noteMap> from auto-loaded default.sf2
let _sf2ProjectFile = null; // File object chosen by user (written into project on save)
let _sf2ProjectName = null; // display name for the project-specific font

function sfGetLoadedName() {
  return _sf2ProjectName ?? (_sf2DefaultData ? 'default.sf2' : null);
}
function sfGetProjectFile() { return _sf2ProjectFile; }

async function _sfPopulateCache(data) {
  _sfCache.clear();
  for (const [program, noteMap] of data) _sfCache.set(program, noteMap);
}

async function sfLoadDefault(arrayBuffer) {
  const data = await sf2Parse(arrayBuffer, getAudioContext());
  _sf2DefaultData = data;
  await _sfPopulateCache(data);
  log(`[soundfont] default.sf2 loaded: ${data.size} programs`);
}

async function sfLoadFromFile(file) {
  const ab   = await file.arrayBuffer();
  const data = await sf2Parse(ab, getAudioContext());
  _sf2ProjectFile = file;
  _sf2ProjectName = file.name;
  await _sfPopulateCache(data);
  log(`[soundfont] project SF2 loaded: ${file.name}, ${data.size} programs`);
}

function sfClearProjectFont() {
  _sf2ProjectFile = null;
  _sf2ProjectName = null;
  if (_sf2DefaultData) {
    _sfPopulateCache(_sf2DefaultData);
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
