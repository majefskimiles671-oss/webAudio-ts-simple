// midiParser.js
// Pure-JS Standard MIDI File (SMF) parser — Type 0 and Type 1.
// Exposes parseMidiFile() and midiToNotes() as globals.

// MIDI Parser - Helpers - Pure Computation Layer -----

function _readVarLen(view, offset) {
  let value = 0, bytesRead = 0;
  let byte;
  do {
    byte = view.getUint8(offset + bytesRead++);
    value = (value << 7) | (byte & 0x7F);
  } while (byte & 0x80);
  return { value, bytesRead };
}

function _readStr(view, offset, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

// Returns { format, ticksPerQN, tracks: [ [{tick, type, ch, data}] ] }
function parseMidiFile(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let pos = 0;

  if (_readStr(view, 0, 4) !== "MThd") throw new Error("Not a MIDI file");
  const headerLen = view.getUint32(4);
  const format    = view.getUint16(8);
  const numTracks = view.getUint16(10);
  const timingWord = view.getUint16(12);
  if (timingWord & 0x8000) throw new Error("SMPTE timing not supported");
  const ticksPerQN = timingWord;
  pos = 8 + headerLen;

  const tracks = [];

  for (let t = 0; t < numTracks; t++) {
    if (pos + 8 > view.byteLength) break;
    const chunkType = _readStr(view, pos, 4);
    const chunkLen  = view.getUint32(pos + 4);
    pos += 8;
    const chunkEnd = pos + chunkLen;

    if (chunkType !== "MTrk") { pos = chunkEnd; continue; }

    const events = [];
    let tick = 0;
    let runningStatus = 0;

    while (pos < chunkEnd) {
      const { value: delta, bytesRead: db } = _readVarLen(view, pos);
      pos += db;
      tick += delta;

      let statusByte = view.getUint8(pos);

      if (statusByte & 0x80) {
        runningStatus = statusByte;
        pos++;
      } else {
        statusByte = runningStatus;
      }

      const type = statusByte & 0xF0;
      const ch   = statusByte & 0x0F;

      if (statusByte === 0xFF) {
        // Meta event
        const metaType = view.getUint8(pos++);
        const { value: metaLen, bytesRead: mb } = _readVarLen(view, pos);
        pos += mb;
        if (metaType === 0x51 && metaLen === 3) {
          const usPerQN = (view.getUint8(pos) << 16) | (view.getUint8(pos + 1) << 8) | view.getUint8(pos + 2);
          events.push({ tick, type: "tempo", usPerQN });
        } else if (metaType === 0x2F) {
          pos += metaLen;
          break; // end of track
        }
        pos += metaLen;
        runningStatus = 0;
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        // SysEx
        const { value: sysLen, bytesRead: sb } = _readVarLen(view, pos);
        pos += sb + sysLen;
        runningStatus = 0;
      } else if (type === 0x90) {
        const pitch = view.getUint8(pos++);
        const vel   = view.getUint8(pos++);
        events.push({ tick, type: vel > 0 ? "noteOn" : "noteOff", ch, pitch, velocity: vel });
      } else if (type === 0x80) {
        const pitch = view.getUint8(pos++);
        const vel   = view.getUint8(pos++);
        events.push({ tick, type: "noteOff", ch, pitch, velocity: vel });
      } else if (type === 0xA0 || type === 0xB0 || type === 0xE0) {
        pos += 2; // two data bytes, skip
      } else if (type === 0xC0) {
        const program = view.getUint8(pos++);
        events.push({ tick, type: "programChange", ch, program });
      } else if (type === 0xD0) {
        pos += 1; // channel pressure, skip
      } else {
        pos++; // unknown, skip one byte
      }
    }

    pos = chunkEnd;
    tracks.push(events);
  }

  return { format, ticksPerQN, tracks };
}

// MIDI Parser - Authority - Conversion Layer -----
// Converts parsed MIDI tracks to our note objects using a tempo map.
// Returns an array per MIDI track: [{ pitch, startSamples, durationSamples, velocity }]
function midiToNotes(parsed, sampleRate) {
  const sr = sampleRate ?? 48000;
  const { ticksPerQN, tracks } = parsed;

  // Build tempo map from tempo events across all tracks (usually track 0 in Type 1)
  const tempoMap = [{ tick: 0, usPerQN: 500000 }]; // default 120 BPM
  for (const track of tracks) {
    for (const ev of track) {
      if (ev.type === "tempo") {
        const last = tempoMap[tempoMap.length - 1];
        if (ev.tick > last.tick) tempoMap.push({ tick: ev.tick, usPerQN: ev.usPerQN });
        else last.usPerQN = ev.usPerQN;
      }
    }
  }
  tempoMap.sort((a, b) => a.tick - b.tick);

  function ticksToSeconds(tick) {
    let seconds = 0;
    for (let i = 0; i < tempoMap.length; i++) {
      const segStart = tempoMap[i].tick;
      const segEnd   = (i + 1 < tempoMap.length) ? tempoMap[i + 1].tick : Infinity;
      const usPerQN  = tempoMap[i].usPerQN;
      const secsPerTick = usPerQN / 1e6 / ticksPerQN;
      if (tick <= segStart) break;
      const ticks = Math.min(tick, segEnd) - segStart;
      seconds += ticks * secsPerTick;
      if (tick <= segEnd) break;
    }
    return seconds;
  }

  const result = [];

  for (const track of tracks) {
    const notes = [];
    const pending = new Map(); // key: "ch:pitch" → { tick, velocity }

    for (const ev of track) {
      const key = `${ev.ch}:${ev.pitch}`;
      if (ev.type === "noteOn") {
        pending.set(key, { tick: ev.tick, velocity: ev.velocity });
      } else if (ev.type === "noteOff") {
        const start = pending.get(key);
        if (start) {
          pending.delete(key);
          const startSec = ticksToSeconds(start.tick);
          const endSec   = ticksToSeconds(ev.tick);
          notes.push({
            pitch:           ev.pitch,
            startSamples:    Math.round(startSec * sr),
            durationSamples: Math.max(1, Math.round((endSec - startSec) * sr)),
            velocity:        start.velocity,
          });
        }
      }
    }

    // Close any still-open notes at last tick
    if (track.length > 0) {
      const lastTick = track[track.length - 1].tick;
      for (const [key, start] of pending) {
        const pitch = parseInt(key.split(":")[1]);
        const startSec = ticksToSeconds(start.tick);
        const endSec   = ticksToSeconds(lastTick);
        notes.push({
          pitch,
          startSamples:    Math.round(startSec * sr),
          durationSamples: Math.max(1, Math.round((endSec - startSec) * sr)),
          velocity:        start.velocity,
        });
      }
    }

    notes.sort((a, b) => a.startSamples - b.startSamples);
    if (notes.length > 0) {
      const isDrum = track.some(ev => (ev.type === "noteOn" || ev.type === "noteOff") && ev.ch === 9);
      const programEv = track.find(ev => ev.type === "programChange");
      const program = isDrum ? SF_PERCUSSION : (programEv?.program ?? 0);
      result.push({ notes, program, isDrum });
    }
  }

  return result;
}
