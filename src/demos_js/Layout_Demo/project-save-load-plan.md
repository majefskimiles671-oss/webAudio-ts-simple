# BareTrack — Project Save / Load Plan

## Purpose

Define the project file format and the save/load implementation strategy for BareTrack. The goals are correctness (sample-accurate timing), simplicity (no over-engineering), and a clean handoff path to the downstream mixing app.

---

## Project File Format

### Folder structure

```
<parent directory>/
  <project-uuid>/
    project.json
    clip-a1b2c3.wav
    clip-d4e5f6.wav
    ...
```

The user picks a parent directory once. BareTrack creates the UUID-named subfolder inside it. All subsequent saves reuse a stored `FileSystemDirectoryHandle` — the user is not re-prompted unless they choose Save As (future).

### `project.json`

```json
{
  "version": 1,
  "id": "project-uuid",
  "sampleRate": 48000,
  "bpm": 120,
  "timeSignature": { "beats": 4, "noteValue": 4 },

  "tracks": [
    {
      "id": "track-uuid",
      "name": "Acoustic Gtr 1",
      "gain": 80,
      "scenes": ["A"],
      "clips": [
        {
          "id": "clip-uuid",
          "file": "clip-a1b2c3.wav",
          "startSample": 144000,
          "durationSamples": 230400
        }
      ]
    }
  ],

  "markers": [
    {
      "id": "origin",
      "timeSample": 0,
      "note": "Chorus starts here"
    },
    {
      "id": "marker-uuid",
      "timeSample": 192000,
      "note": "Verse 2"
    }
  ]
}
```

### Why `startSample` not `startSeconds`

JavaScript floats have ~15 significant digits, but `JSON.stringify` can silently round them and `parseFloat` roundtrips can accumulate drift. Integer sample offsets roundtrip through JSON with perfect fidelity.

Conversion:
- **Save:** `startSample = Math.round(startSeconds * sampleRate)`
- **Load:** `startSeconds = startSample / sampleRate`

At 48 kHz, resolution is ~0.02 ms — finer than any audible artifact.

### `sampleRate` at project level

All clips in a BareTrack session share one sample rate (same `AudioContext`). Storing it once at the project level allows exact reconstruction of seconds on load without implicit assumptions.

### What is NOT in the project file

- **Solo state** — transient session state, not saved
- **Clip file offsets / trim points** — BareTrack clips always play from the beginning of their audio file; trimming is out of scope
- **Zoom level, scroll position** — view preferences, not project data
- **Scene definitions** — scenes are just letters; active assignments are stored per-track

---

## Current State of the Codebase

The `tracks` array refactor is complete. The state model is:

```js
const tracks = [];
// Each entry:
{
  id:          "uuid",
  name:        "Acoustic Gtr 1",
  gain:        80,
  scenes:      ["A"],              // active scene letters
  clips: [
    { id: "uuid", startSample: 144000, durationSamples: 230400 }
  ],
  controlRow:  <element>,          // DOM ref — view artifact
  timelineRow: <element>,          // DOM ref — view artifact
}
```

Recording is currently **simulated** (fake waveform data, no real `AudioContext`). `SAMPLE_RATE = 48000` is a constant until real audio is wired in.

---

## Implementation Plan

### Phase 1 — Serialize

`serializeProject()` reads from the `tracks` array and `markers` array and returns a plain object matching the format above.

- Project `id` is generated once on first save and stored in a `let projectId` state variable.
- Track order in the array matches DOM order (newest at front).
- Clip `file` field is `clip-${clip.id}.wav`.
- Marker `timeSample` is `Math.round(marker.time * SAMPLE_RATE)`.

### Phase 2 — File I/O (File System Access API)

**Save Project** (`menu-save-project`):
1. If no folder handle → `showDirectoryPicker()` → `handle.getDirectoryHandle(projectId, { create: true })`
2. `serializeProject()` → write `project.json`
3. For each clip in every track → write a placeholder `.wav` (minimal valid WAV header, silent, correct structure)
4. Store the subfolder handle in `let projectFolderHandle`
5. `clearDirty()`

**Open Project** (`menu-open-project`):
1. `showDirectoryPicker()` — user picks the UUID folder directly
2. Read and parse `project.json`
3. `deserializeProject(data)`
4. Store folder handle in `projectFolderHandle`, `clearDirty()`

### Phase 3 — Placeholder WAV

A valid WAV file is a 44-byte header specifying a PCM file with 0 or minimal samples. It must be well-formed so that future audio loading code can parse it without crashing. The placeholder signals that the slot exists; actual audio encoding comes later.

### Phase 4 — Deserialize

`deserializeProject(data)`:
1. Reset: clear `tracks`, `markers`, remove all DOM rows
2. Restore `bpm`, `timeSignature`, `sampleRate` → re-render
3. For each saved track: `createTrack(name)`, set `gain-slider` value, activate scene buttons, re-create waveform DOM elements at `startSample / sampleRate` positions
4. Restore `markers` (converting `timeSample / sampleRate` back to seconds), restore `selectedMarkerId`
5. `clearDirty()`

### Implementation Order

1. Add `let projectId`, `let projectFolderHandle` to state
2. `serializeProject()`
3. Placeholder WAV writer helper
4. Save flow (wire `menu-save-project`)
5. `deserializeProject()`
6. Open flow (wire `menu-open-project`)

---

## Explicitly Deferred

- Real audio encoding (writing PCM samples into the WAV)
- Loading audio back into playable `AudioBuffer`s
- Save As
- Mixdown / export (see below)

---

## Mixdown / Export Design Notes

Each **scene** represents one export opportunity. The user will be able to choose:
- Which scenes to export
- Whether to export each scene as a single stereo mixdown or as per-track stems
- Audio is **lossless by default** (WAV/AIFF); lossy (MP3/AAC) is a future option if there is a need

Exports do not include markers or scene metadata — only audio. The scene letter can appear in the exported filename (e.g., `project-name_scene-A.wav`).

This export feature is separate from project save/load and will be designed in its own plan when the time comes.
