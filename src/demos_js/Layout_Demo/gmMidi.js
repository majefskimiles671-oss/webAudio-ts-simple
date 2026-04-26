// gmMidi.js
// Web MIDI API wrapper for General MIDI playback via the OS synthesizer.
// On macOS: "Apple DLS Music Device"  On Windows: "Microsoft GS Wavetable Synth"

let _midiAccess  = null;
let _accessError = null;

async function gmMidiEnsureAccess() {
  if (_midiAccess) return _midiAccess;
  if (_accessError) return null;
  if (!navigator.requestMIDIAccess) {
    _accessError = new Error('Web MIDI API not supported');
    console.warn('[gmMidi] Web MIDI not supported in this browser');
    return null;
  }
  try {
    _midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    return _midiAccess;
  } catch (err) {
    _accessError = err;
    console.warn('[gmMidi] MIDI access denied:', err);
    return null;
  }
}

function gmMidiGetOutput() {
  if (!_midiAccess) return null;
  return [..._midiAccess.outputs.values()][0] ?? null;
}

function gmMidiOutputName() {
  return gmMidiGetOutput()?.name ?? null;
}

function gmMidiNoteOn(output, channel, pitch, velocity, timestamp) {
  if (!output) return;
  output.send([0x90 | (channel & 0xf), pitch & 0x7f, velocity & 0x7f], timestamp ?? 0);
}

function gmMidiNoteOff(output, channel, pitch, timestamp) {
  if (!output) return;
  output.send([0x80 | (channel & 0xf), pitch & 0x7f, 0], timestamp ?? 0);
}

function gmMidiProgramChange(output, channel, program) {
  if (!output) return;
  output.send([0xc0 | (channel & 0xf), program & 0x7f]);
}

function gmMidiAllNotesOff() {
  const output = gmMidiGetOutput();
  if (!output) return;
  for (let ch = 0; ch < 16; ch++) {
    output.send([0xb0 | ch, 123, 0]); // All Notes Off
    output.send([0xb0 | ch, 120, 0]); // All Sound Off
  }
}
