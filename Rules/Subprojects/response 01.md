Acknowledged. This is a solid basis for a **Layout Demo Subproject**.

Below is a **one‑screen, rule‑shaped response** that:
- confirms alignment with your pasted rules
- locks scope
- proposes the minimal next step without adding features

---

## Layout Demo Subproject — Scope Lock

### Purpose
- Prove **layout, scrolling, and playhead animation**
- No audio logic
- No persistence
- No TypeScript

This subproject exists only to answer:
“Does this UI feel correct?”

---

## Hard Constraints (Inherited)

- [*] Parallel columns (controls + timeline)
- [*] Timeline is the only horizontal scroller
- [*] One authoritative height owner (timeline)
- [*] Height sync via JS (`ResizeObserver` if needed)
- [*] One global playhead overlay
- [*] No CSS variables as height source of truth
- [*] No re-renders for text edits
- [*] Raw HTML/CSS/JS in a single file

---

## Explicit Non‑Goals

- [x] No recording
- [x] No real audio playback
- [x] No storage
- [x] No framework
- [x] No TypeScript
- [x] No feature creep

---

## Minimal Demo Structure (Proposed)

**Single file: `layout-demo.html`**

- `<head>`
  - inline `<style>`
- `<body>`
  - fixed transport bar
  - left controls column
  - right timeline column
  - playhead overlay
- `<script>`
  - fake track data
  - playhead animation loop
  - scroll + autoscroll
  - optional height sync

---

## Immediate Next Step (Recommended)

Build the demo with:
- 3–5 fake tracks
- variable waveform heights
- long timeline width (to force scroll)
- play / stop toggle that only moves the playhead

No other behavior.

---

## Success Criteria

The demo is considered “correct” if:

- Controls never scroll horizontally
- Timeline scrolls smoothly
- All waveforms scroll together
- Playhead:
  - aligns with waveform start
  - spans full track height
  - autoscrolls before leaving view
- Track name edits do not affect layout

---

## Decision

[*] Proceed with a dedicated **Layout Demo Subproject**
[*] Do not add features until this demo feels correct

---

## Question (to proceed)

Do you want me to generate:
1. an initial `layout-demo.html` skeleton, or
2. a checklist to validate layout behavior manually
``