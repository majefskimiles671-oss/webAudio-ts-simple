// midiExport.js
// Serializes note-mode MIDI clips to a standard MIDI file and triggers a download.

// MIDI Export - Helpers - Pure Computation Layer -----

function _writeVarLen(value) {
  const bytes = [];
  bytes.unshift(value & 0x7F);
  value >>>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  return bytes;
}

function _buildMidiHeader(numTracks, ticksPerQN) {
  const buf = new Uint8Array(14);
  // MThd
  buf[0]=0x4D; buf[1]=0x54; buf[2]=0x68; buf[3]=0x64;
  // chunk length = 6
  buf[4]=0; buf[5]=0; buf[6]=0; buf[7]=6;
  // format 1
  buf[8]=0; buf[9]=1;
  // num tracks
  buf[10] = (numTracks >> 8) & 0xFF;
  buf[11] =  numTracks       & 0xFF;
  // ticks per quarter note
  buf[12] = (ticksPerQN >> 8) & 0xFF;
  buf[13] =  ticksPerQN       & 0xFF;
  return buf;
}

function _buildTempoTrack(bpm) {
  const usPerQN = Math.round(60_000_000 / bpm);
  const bytes = [];
  // delta 0
  bytes.push(0);
  // tempo meta: FF 51 03 tt tt tt
  bytes.push(0xFF, 0x51, 0x03);
  bytes.push((usPerQN >> 16) & 0xFF, (usPerQN >> 8) & 0xFF, usPerQN & 0xFF);
  // delta 0, end of track: FF 2F 00
  bytes.push(0, 0xFF, 0x2F, 0x00);
  return _wrapMTrk(bytes);
}

function _wrapMTrk(bytes) {
  const len = bytes.length;
  const buf = new Uint8Array(8 + len);
  // MTrk
  buf[0]=0x4D; buf[1]=0x54; buf[2]=0x72; buf[3]=0x6B;
  buf[4]=(len>>24)&0xFF; buf[5]=(len>>16)&0xFF; buf[6]=(len>>8)&0xFF; buf[7]=len&0xFF;
  buf.set(bytes, 8);
  return buf;
}

function _buildNoteTrack(notes, ticksPerQN, sampleRate) {
  if (!notes.length) return _wrapMTrk([0, 0xFF, 0x2F, 0x00]);

  const secsPerTick = 0.5 / ticksPerQN; // at 120 BPM (500000 us/QN)

  // Build event list: { tick, type: "on"|"off", pitch, velocity }
  const evts = [];
  for (const n of notes) {
    const startSec = n.startSamples / sampleRate;
    const endSec   = (n.startSamples + n.durationSamples) / sampleRate;
    const startTick = Math.round(startSec / secsPerTick);
    const endTick   = Math.max(startTick + 1, Math.round(endSec / secsPerTick));
    evts.push({ tick: startTick, type: "on",  pitch: n.pitch, velocity: n.velocity ?? 100 });
    evts.push({ tick: endTick,   type: "off", pitch: n.pitch, velocity: 0 });
  }
  evts.sort((a, b) => a.tick - b.tick || (a.type === "off" ? -1 : 1));

  const bytes = [];
  let lastTick = 0;
  for (const ev of evts) {
    const delta = ev.tick - lastTick;
    lastTick = ev.tick;
    bytes.push(..._writeVarLen(delta));
    if (ev.type === "on") {
      bytes.push(0x90, ev.pitch & 0x7F, ev.velocity & 0x7F);
    } else {
      bytes.push(0x80, ev.pitch & 0x7F, 0);
    }
  }
  // End of track
  bytes.push(0, 0xFF, 0x2F, 0x00);
  return _wrapMTrk(bytes);
}

// MIDI Export - Authority - Download Trigger -----

function exportProjectAsMidi(tracks, bpm, sampleRate) {
  const sr  = sampleRate ?? 48000;
  const bpmVal = bpm ?? 120;
  const ticksPerQN = 480;

  const noteTracks = [];
  for (const track of tracks) {
    for (const clip of (track.midiClips ?? [])) {
      if (!Array.isArray(clip.notes) || clip.notes.length === 0) continue;
      // Offset all note times by clip start
      const shifted = clip.notes.map(n => ({
        ...n,
        startSamples: n.startSamples + clip.startSample,
      }));
      noteTracks.push(shifted);
    }
  }

  if (noteTracks.length === 0) {
    alert("No note-mode MIDI clips to export.");
    return;
  }

  const parts = [_buildMidiHeader(1 + noteTracks.length, ticksPerQN), _buildTempoTrack(bpmVal)];
  for (const notes of noteTracks) {
    parts.push(_buildNoteTrack(notes, ticksPerQN, sr));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }

  const blob = new Blob([out], { type: "audio/midi" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "project.mid";
  a.click();
  URL.revokeObjectURL(url);
}
