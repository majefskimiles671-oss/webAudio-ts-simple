## Layout Demo Subproject

This subproject is a **proof of concept** for DAW layout and interaction.
Its only goal is to validate look and feel before any further development.

---

## Purpose

- Prove track layout, scrolling, and playhead animation
- Establish correct geometry and interaction invariants
- Serve as a visual and behavioral reference for the main project

---

## Hard Scope Limits

- [*] Layout only
- [*] Scrolling behavior
- [*] Playhead animation
- [*] Track naming visibility

- [x] No audio
- [x] No recording
- [x] No persistence
- [x] No frameworks
- [x] No TypeScript
- [x] No feature expansion

---

## Technologies and Format

- Single HTML file
- Inline `<style>` in `<head>`
- Inline `<script>` at end of `<body>`
- HTML, CSS, JavaScript only

---

## Authoritative Layout Rules

- [*] Each track row is split into **two columns**
  - controls column
  - timeline (waveform) column
- [*] Timeline column is the **authoritative height owner**
- [*] Controls column height is **derived in JavaScript**
- [*] Horizontal scrolling exists **only** in the timeline container
- [*] Controls never scroll horizontally

---

## Height Synchronization Rule

- [*] Track row height must come from timeline content
- [*] Height synchronization is performed in JavaScript
- [*] `ResizeObserver` may be used only for height sync
- [x] No CSS variables as height source of truth
- [x] No independent auto-sizing of parallel DOM trees

---

## Waveform Visualization Rule

- [*] Waveform background must include a repeating pattern
- [*] Pattern must make horizontal motion visually obvious
- [x] Solid color backgrounds are insufficient

Purpose:
- manual scroll verification
- playhead alignment verification
- autoscroll tuning

---

## Playhead Rules

- [*] Single global playhead
- [*] Playhead lives in a dedicated overlay layer
- [*] Playhead X = timeline coordinate space
- [*] Playhead spans full visible track height

---

## Success Criteria

The demo is considered correct if:

- [*] Controls never scroll horizontally
- [*] All waveforms scroll together
- [*] Track rows remain vertically aligned
- [*] Playhead aligns with waveform start
- [*] Autoscroll triggers before playhead exits view
- [*] Track name edits do not affect layout

---

## Outcome

This subproject defines **layout truth**.
If a future feature violates these rules, the feature is wrong.