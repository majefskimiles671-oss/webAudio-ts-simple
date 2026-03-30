## [No Regressions](/Rules/NO_REGRESSIONS.md)

## 🚫 No‑Regressions Rules — DAW Timeline & Layout

This file defines **non‑negotiable invariants** for the DAW UI and architecture.

If any rule in this document is violated, the change **must be reverted or fixed**
before adding new features.

These rules exist to prevent slow UI decay, layout drift, and timeline bugs.

---

## 📐 Core Layout Architecture

### ✅ Rule 1 — Parallel Columns with Explicit Sync (Ableton / Reaper Model)

- Track **controls column** and **timeline column** are rendered separately
- The **timeline column** is the only horizontal scroll container
- The **controls column never scrolls horizontally**
- Row heights are synchronized explicitly in JavaScript

✅ True stickiness  
✅ Predictable geometry  
✅ Matches professional DAWs  
❌ Slightly more code (acceptable)

---

### ✅ Rule 2 — One Authoritative Row Height

- Each track row has **exactly one source of truth for height**
- Height is determined by the **timeline content** (waveform + padding)
- Control rows must match this height exactly

❌ Never allow independent height calculation per column  
✅ Use `ResizeObserver` or explicit height assignment

---

### ✅ Rule 3 — One Horizontal Scroll Container

- **Exactly one element** may scroll horizontally
- That element is the **timeline container**
- No track, waveform, or control element may have `overflow-x: auto`

Violations cause:
- desynced scrolling
- broken sticky behavior
- incorrect playhead math

---

## 🎯 Playhead Rules

### ✅ Rule 4 — Global Playhead Overlay

- There is **one global playhead**
- The playhead:
  - lives in a dedicated overlay layer
  - is aligned to timeline coordinates
  - spans the full vertical height of all tracks
- The playhead never lives inside individual track rows

---

### ✅ Rule 5 — Timeline Coordinate Space

- `playheadX = seconds × pixelsPerSecond × zoom`
- `playheadX = 0` always means **start of waveform**
- Playhead math must never depend on:
  - control column width
  - DOM offsets
  - magic numbers

---

## 🔁 Autoscroll Rules

### ✅ Rule 6 — Autoscroll Uses Timeline Space, Not DOM Space

- Autoscroll decisions are made using:
  - timeline X position
  - scroll container bounds
- Never compare raw `offsetLeft` values
- Convert to screen space only at the final step if needed

Autoscroll must:
- trigger **before** the playhead exits the viewport
- feel smooth and predictable

---

## ✏️ Track Editing Rules

### ✅ Rule 7 — Metadata Changes Do NOT Re‑Render Tracks

- Renaming a track:
  - updates text only
  - updates storage only
- Renaming must NOT:
  - destroy waveforms
  - destroy audio buffers
  - recreate DOM rows

UI churn here causes:
- invalid Blob references
- Safari/WebKit playback errors
- broken playback after edits

---

## 🎧 Audio Lifecycle Rules

### ✅ Rule 8 — Never Reuse Audio Nodes or Blob URLs

- Audio playback always:
  - fetches the blob fresh
  - decodes fresh
  - creates new AudioBufferSourceNodes
- Never reuse:
  - `<audio>` elements
  - Blob URLs
  - AudioBufferSourceNodes

This prevents:
- `WebKitBlobResource` errors
- stale references after re-render
- race conditions

---

## 🧪 Debugging Invariants

These must **always** be true:

- ✅ Controls column never scrolls horizontally
- ✅ All waveforms scroll together
- ✅ Playhead aligns exactly with waveform start
- ✅ Track row heights match visually
- ✅ Autoscroll triggers before playhead exits view
- ✅ Rename → Play never breaks playback

If any invariant fails:
1. Stop feature work
2. Identify which rule was violated
3. Fix the violation first

---

## ❌ Rejected Approaches (Do Not Re‑Try)

- Sticky controls inside horizontal scroll containers
- Single grid with overflow tricks
- Per‑track scroll containers
- DOM‑driven geometry for timeline math
- Re‑rendering tracks on metadata change

These approaches **will regress** under complexity.

---

## 🧠 Design Philosophy

- Geometry beats clever CSS
- Explicit sync beats implicit layout
- One coordinate space beats many
- Stability beats brevity

This file is a guardrail — not a suggestion.
