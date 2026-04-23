function tuning(openMidiNotes) {
  return {
    openMidiNotes: [...openMidiNotes],
    stringCount: openMidiNotes.length,
    openMidi(stringNum) {
      return openMidiNotes[stringNum - 1];
    },
    midiAt(stringNum, fret) {
      return openMidiNotes[stringNum - 1] + fret;
    },
  };
}
