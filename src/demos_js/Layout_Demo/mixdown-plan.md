# BareTrack — Mixdown / Export Plan

## Purpose

Define the UI and implementation strategy for exporting scenes as audio files.
Mixdown is separate from project save/load — it produces standalone WAV files
meant for downstream use (sharing, mixing in another DAW, etc.).

---

## Entry Point

**File** menu → **"Export Mixdown…"**

---

## Data Model

Each track in the `tracks` array has a `scenes` array of active scene letters
(e.g. `["A", "C"]`). A scene's "content" is every track whose `scenes` array
contains that letter.

```js
// getSceneTrackMap() returns:
{
  A: [track, track, track],
  B: [track],
  C: [],          // no tracks assigned → empty
  D: [],
  E: [],
}
```

---

## Dialog — Three States

### 1. Normal (at least one scene has tracks)

```
┌──────────────────────────────────────────┐
│  Export Mixdown                          │
│                                          │
│  Scenes                                  │
│  ┌──────────────────────────────────┐   │
│  │ ☑ A  · Acoustic Gtr, Lead Vox   │   │
│  │ ☑ B  · Acoustic Gtr             │   │
│  │   C  · No tracks assigned       │   │  ← grayed out, checkbox disabled
│  │   D  · No tracks assigned       │   │
│  │   E  · No tracks assigned       │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Output format                           │
│  ● Stereo mix   ○ Individual stems      │
│                                          │
│               [Cancel]  [Choose Folder] │  ← disabled if all unchecked
└──────────────────────────────────────────┘
```

- All scenes with tracks are **pre-checked**.
- Scenes with no tracks are **shown grayed out** with checkboxes disabled.
- "Choose Folder…" button is disabled if all checkboxes are unchecked.

### 2. No-scenes fallback (zero tracks assigned to any scene)

```
┌──────────────────────────────────────────┐
│  Export Mixdown                          │
│                                          │
│  No tracks are assigned to any scene.   │
│  You can still export all tracks.        │
│                                          │
│  Output format                           │
│  ● Stereo mix   ○ Individual stems      │
│                                          │
│               [Cancel]  [Export All Tracks…] │
└──────────────────────────────────────────┘
```

### 3. Done confirmation

```
┌──────────────────────────────────┐
│  Export complete                 │
│                                  │
│  3 files created:                │
│  · Scene-A.wav                   │
│  · Scene-B/Acoustic Gtr 1.wav   │
│  · Scene-B/Lead Vox.wav         │
│                                  │
│                         [Got it] │
└──────────────────────────────────┘
```

---

## File Output

### Stereo mix

One WAV per selected scene, written directly into the chosen folder:

```
{chosen-folder}/
  Scene-A.wav
  Scene-B.wav
```

### Individual stems

One WAV per track per scene, in a scene-named subfolder:

```
{chosen-folder}/
  Scene-A/
    Acoustic Gtr 1.wav
    Lead Vox.wav
  Scene-B/
    Acoustic Gtr 1.wav
```

### All-tracks fallback (stereo)

```
{chosen-folder}/
  All Tracks.wav
```

### All-tracks fallback (stems)

```
{chosen-folder}/
  Acoustic Gtr 1.wav
  Lead Vox.wav
```
(No subfolder — all files written flat into the chosen folder.)

Track names are sanitized: `/ \ : * ? " < > |` → `_`.

---

## Export Logic — Phase 1 (Placeholder)

Since audio recording is currently simulated, export writes correctly-structured
but silent WAV files — the same 44-byte placeholder used by project save/load
(`buildPlaceholderWav()` from `project-io.js`).

The plumbing is real: folder picker, file naming, subfolder creation, file
writing, done confirmation.

```js
async function exportMixdown({ scenes, mode, folderHandle }) { ... }
async function exportAllTracks({ mode, folderHandle }) { ... }
```

Both return `string[]` — the list of relative file paths written — passed to
`showMixdownDone()`.

---

## Export Logic — Phase 2 (Real Audio, future)

When real `AudioContext` recording is wired in, replace placeholder WAV writing
with `OfflineAudioContext` rendering:

1. Determine the scene's time span: `max(clip.startSample + clip.durationSamples)` 
   across all tracks in the scene.
2. `const offlineCtx = new OfflineAudioContext(2, length, SAMPLE_RATE)`
3. For each track in the scene:
   - Decode clip audio: `offlineCtx.decodeAudioData(clipArrayBuffer)`
   - `const src = offlineCtx.createBufferSource(); src.buffer = decoded`
   - `const gain = offlineCtx.createGain(); gain.gain.value = track.gain / 100`
   - `src.connect(gain).connect(offlineCtx.destination)`
   - `src.start(clip.startSample / SAMPLE_RATE)`
4. `const rendered = await offlineCtx.startRendering()`
5. Encode `rendered` (AudioBuffer) → WAV bytes → write to file.

For individual stems, each track gets its own `OfflineAudioContext`.

The Phase 1 API surface (`exportMixdown` / `exportAllTracks`) does not change
in Phase 2 — only the WAV bytes produced differ.

---

## Implementation Files

| File | Change |
|------|--------|
| `mixdown.js` | New — all export logic and dialog UI |
| `Layout_Demo.html` | Add menu item; add `<script src="./mixdown.js">` |
| `styles.css` | Add mixdown dialog styles |
| `project-io.js` | No change — `buildPlaceholderWav()` is reused as-is |

`mixdown.js` loads between `gainSlider.js` and `index.js`.

---

## What Is Out of Scope

- Lossy formats (MP3/AAC)
- Normalize, fade in/out, bus effects
- Cloud / remote export
- "Export all scenes at once" shortcut (YAGNI until there's a real need)
