// sfzEngine.js
// Parses SFZ instrument folders (via File System Access API) and provides the
// same scheduling interface as soundfontEngine.js — sfz2ScheduleNote, sfzNoteOn, sfzNoteOff.

const _sfzLibrary = new Map(); // name → Array<region>
// region = { lokey, hikey, lovel, hivel, pitchCenter,
//            loopMode, loopStart, loopEnd, tune, transpose, volume, buffer }

function sfzGetNames() { return [..._sfzLibrary.keys()]; }
function sfzHasInstrument(name) { return _sfzLibrary.has(name); }
function sfzGetKeyRange(name) {
  const regions = _sfzLibrary.get(name);
  if (!regions?.length) return null;
  return {
    lo: Math.min(...regions.map(r => r.lokey)),
    hi: Math.max(...regions.map(r => r.hikey)),
  };
}

// ---- SFZ text parser ----

function _sfzNoteToMidi(s) {
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  const names = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
  const m = s.toLowerCase().match(/^([a-g])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const base = names[m[1]];
  const acc  = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + base + acc; // C4 = 60
}

function _sfzParseOpcodes(text) {
  const ops = {};
  // sample= values may contain spaces — extract before the generic scan
  const sampleMatch = text.match(/\bsample=(.+?)(?=\s+[a-zA-Z_]\w*=|\s*$)/m);
  if (sampleMatch) ops.sample = sampleMatch[1].trim();
  for (const m of text.matchAll(/([a-zA-Z_]\w*)=(\S+)/g)) {
    if (m[1].toLowerCase() !== 'sample') ops[m[1].toLowerCase()] = m[2];
  }
  return ops;
}

function _sfzRegionFromOps(ops) {
  if (!ops.sample) return null;

  let lokey = 0, hikey = 127;
  if (ops.key !== undefined) {
    const k = _sfzNoteToMidi(ops.key);
    if (k !== null) lokey = hikey = k;
  }
  if (ops.lokey !== undefined) { const k = _sfzNoteToMidi(ops.lokey); if (k !== null) lokey = k; }
  if (ops.hikey !== undefined) { const k = _sfzNoteToMidi(ops.hikey); if (k !== null) hikey = k; }

  let pitchCenter = Math.round((lokey + hikey) / 2);
  if (ops.pitch_keycenter !== undefined) {
    const k = _sfzNoteToMidi(ops.pitch_keycenter);
    if (k !== null) pitchCenter = k;
  }

  return {
    sample:     ops.sample.replace(/\\/g, '/'),
    lokey, hikey,
    lovel:      ops.lovel      !== undefined ? parseInt(ops.lovel,      10) : 0,
    hivel:      ops.hivel      !== undefined ? parseInt(ops.hivel,      10) : 127,
    pitchCenter,
    loopMode:   ops.loop_mode  ?? 'no_loop',
    loopStart:  ops.loop_start !== undefined ? parseInt(ops.loop_start, 10) : null,
    loopEnd:    ops.loop_end   !== undefined ? parseInt(ops.loop_end,   10) : null,
    tune:       ops.tune       !== undefined ? parseFloat(ops.tune)         : 0,
    transpose:  ops.transpose  !== undefined ? parseInt(ops.transpose,  10) : 0,
    volume:     ops.volume     !== undefined ? parseFloat(ops.volume)       : 0,
    buffer:     null,
  };
}

function _sfzParseText(text) {
  text = text.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

  const regions = [];
  let globalOps = {}, groupOps = {}, regionOps = null, section = null;

  function commitRegion() {
    if (!regionOps) return;
    const r = _sfzRegionFromOps({ ...globalOps, ...groupOps, ...regionOps });
    if (r) regions.push(r);
    regionOps = null;
  }

  for (const chunk of text.split(/(<[^>]+>)/)) {
    const t = chunk.trim();
    if (!t) continue;
    if (t.startsWith('<') && t.endsWith('>')) {
      const tag = t.slice(1, -1).toLowerCase().trim();
      commitRegion();
      if      (tag === 'region')  { regionOps = {}; section = 'region'; }
      else if (tag === 'group')   { groupOps  = {}; section = 'group';  }
      else if (tag === 'global')  { globalOps = {}; section = 'global'; }
      else                        {                 section = 'other';  }
    } else {
      const ops = _sfzParseOpcodes(t);
      if      (section === 'region' && regionOps) Object.assign(regionOps, ops);
      else if (section === 'group')  Object.assign(groupOps,  ops);
      else if (section === 'global') Object.assign(globalOps, ops);
    }
  }
  commitRegion();
  return regions;
}

// ---- File loading ----

async function _sfzGetFileHandle(dirHandle, relativePath) {
  const parts = relativePath.split('/').filter(p => p && p !== '.');
  let handle = dirHandle;
  for (const part of parts.slice(0, -1)) {
    try { handle = await handle.getDirectoryHandle(part); }
    catch { return null; }
  }
  try { return await handle.getFileHandle(parts[parts.length - 1]); }
  catch { return null; }
}

// Load all samples from a directory that contains a .sfz file.
// Returns { name, loadedRegions, totalRegions }.
async function sfzLoadFromDirectory(dirHandle) {
  const audioCtx = getAudioContext();

  let sfzText = null;
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.sfz')) {
      sfzText = await (await handle.getFile()).text();
      break;
    }
  }
  if (!sfzText) throw new Error('No .sfz file found in the selected folder');

  const regions = _sfzParseText(sfzText);
  if (!regions.length) throw new Error('SFZ file parsed but contains no regions');

  const uniqueSamples = [...new Set(regions.map(r => r.sample).filter(Boolean))];
  console.log(`[SFZ] ${regions.length} regions, ${uniqueSamples.length} unique samples:`, uniqueSamples);

  const bufferCache = new Map();
  for (const region of regions) {
    if (!region.sample || bufferCache.has(region.sample)) continue;
    const fh = await _sfzGetFileHandle(dirHandle, region.sample);
    if (!fh) {
      console.warn(`[SFZ] file not found: "${region.sample}"`);
      bufferCache.set(region.sample, null);
      continue;
    }
    try {
      const ab  = await (await fh.getFile()).arrayBuffer();
      const buf = await audioCtx.decodeAudioData(ab);
      bufferCache.set(region.sample, buf);
    } catch (err) {
      console.warn(`[SFZ] decode failed: "${region.sample}"`, err);
      bufferCache.set(region.sample, null);
    }
  }

  const readyRegions = regions
    .map(r => ({ ...r, buffer: bufferCache.get(r.sample) ?? null }))
    .filter(r => r.buffer !== null);

  console.log(`[SFZ] ${readyRegions.length}/${regions.length} regions ready`);
  if (!readyRegions.length) throw new Error('SFZ loaded but no audio samples could be decoded');

  const name = dirHandle.name;
  _sfzLibrary.set(name, readyRegions);
  document.dispatchEvent(new CustomEvent('sfz-library-updated', { detail: { name } }));
  return { name, loadedRegions: readyRegions.length, totalRegions: regions.length };
}

// ---- Playback ----

function _sfzFindRegion(regions, pitch, velocity) {
  const candidates = regions.filter(r =>
    pitch    >= r.lokey && pitch    <= r.hikey &&
    velocity >= r.lovel && velocity <= r.hivel &&
    r.buffer
  );
  const pool = candidates.length
    ? candidates
    : regions.filter(r => pitch >= r.lokey && pitch <= r.hikey && r.buffer);
  const src = pool.length ? pool : regions.filter(r => r.buffer);
  if (!src.length) return null;
  return src.reduce((a, b) =>
    Math.abs(pitch - a.pitchCenter) <= Math.abs(pitch - b.pitchCenter) ? a : b
  );
}

function _sfzBuildSource(region, pitch, velocity, audioCtx) {
  const src = audioCtx.createBufferSource();
  src.buffer = region.buffer;
  src.detune.value = (pitch - region.pitchCenter + region.transpose) * 100 + region.tune;

  if ((region.loopMode === 'loop_continuous' || region.loopMode === 'loop_sustain') &&
      region.loopStart !== null && region.loopEnd !== null) {
    src.loop      = true;
    src.loopStart = region.loopStart / region.buffer.sampleRate;
    src.loopEnd   = region.loopEnd   / region.buffer.sampleRate;
  }

  const gain = audioCtx.createGain();
  gain.gain.value = (velocity / 127) * Math.pow(10, region.volume / 20);
  src.connect(gain);
  return { src, gain };
}

function sfzScheduleNote(dest, sfzName, pitch, velocity, audioTime, durationSec) {
  const regions = _sfzLibrary.get(sfzName);
  if (!regions) return [];
  const region = _sfzFindRegion(regions, pitch, velocity);
  if (!region) return [];

  const audioCtx = getAudioContext();
  const { src, gain } = _sfzBuildSource(region, pitch, velocity, audioCtx);
  gain.gain.setTargetAtTime(0, audioTime + Math.max(0.05, durationSec - 0.05), 0.08);
  gain.connect(dest ?? audioCtx.destination);
  src.start(audioTime);
  src.stop(audioTime + durationSec + 0.5);
  return [src];
}

function sfzScheduleNoteInContext(ctx, dest, sfzName, pitch, velocity, audioTime, durationSec) {
  const regions = _sfzLibrary.get(sfzName);
  if (!regions) return [];
  const region = _sfzFindRegion(regions, pitch, velocity);
  if (!region) return [];

  const { src, gain } = _sfzBuildSource(region, pitch, velocity, ctx);
  gain.gain.setTargetAtTime(0, audioTime + Math.max(0.05, durationSec - 0.05), 0.08);
  gain.connect(dest ?? ctx.destination);
  src.start(audioTime);
  src.stop(Math.min(audioTime + durationSec + 0.5, ctx.length / ctx.sampleRate));
  return [src];
}

function sfzNoteOn(dest, sfzName, pitch, velocity) {
  const regions = _sfzLibrary.get(sfzName);
  if (!regions) return null;
  const region = _sfzFindRegion(regions, pitch, velocity);
  if (!region) return null;

  const audioCtx = getAudioContext();
  audioCtx.resume();
  const { src, gain } = _sfzBuildSource(region, pitch, velocity, audioCtx);
  gain.connect(dest ?? audioCtx.destination);
  src.start();
  return { src, gain };
}

function sfzNoteOff(handle) {
  if (!handle) return;
  const audioCtx = getAudioContext();
  handle.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
  handle.src.stop(audioCtx.currentTime + 0.15);
}
