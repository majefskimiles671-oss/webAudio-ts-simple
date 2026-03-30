## [Layout Demo Subproject](/Rules/Subprojects/Layout_Demo.md)

## What is the purpose of this subproject?
- Work on the layout and animation of the tracks, playhead, buttons

## How will this be used?
- This subproject will be used as an isolated sandbox in which we can work on anything layout related without seeing or thinking about the underlying code that will be triggered.

## Technologies and Format
- html, css, javascript, (No typescript in this subproject)
- this demo will be one file containing style in the <head> and javascript in a script tag at the end of <body>

## Specification of Subproject

### Rules Files that apply to this subproject

#### [Rules](/Rules/)
- Workflow_Rules.md
- Project_Definition.md

#### [Rules/Feature_Definitions](/Rules/Feature_Definitions/)
- Track_Layout.md
- Track_Naming.md

### Inline Rules that I might move to other files later

- Each track is split into two columns whose height will be synchronized with javascript
- I need the waveform background to have some sort of pattern so I can see it scroll

Acknowledged. Both rules are compatible with the Layout Demo Subproject and can be acted on immediately.

Below is a **rule‑shaped update** you can choose to keep.

---

## Inline Rule — Split Columns with JS Height Sync

- Each track is represented by **two columns**:
  - controls column
  - timeline (waveform) column
- The timeline column is the **authoritative height owner**
- Controls column height is **explicitly synchronized in JavaScript**
- No CSS-only height coupling is allowed

This rule is consistent with:
- Authoritative Height Owner
- Minimal ResizeObserver usage

---

## Inline Rule — Waveform Background Must Be Visually Trackable

- Waveform background must include a **repeating visual pattern**
- The pattern must make horizontal motion **obvious at a glance**
- Plain solid colors are insufficient for scroll verification

### Approved Patterns

- Repeating linear gradients
- Grid / hatch patterns
- Subtle tick lines at fixed pixel intervals

### Example (Conceptual CSS)

```css
.waveform {
  background-image: repeating-linear-gradient(
    90deg,
    #333,
    #333 20px,
    #2a2a2a 20px,
    #2a2a2a 40px
  );
}
```
---

## Inline Rule - Control column Must stay visible when the other column scrolls

 - [*] True sticky control column (never scrolls horizontally)

---

## Inline Rule — Autoscroll Near Right Edge

- The **timeline column must autoscroll** when the playhead approaches the right edge of the visible area
- Autoscroll behavior exists solely to **keep the playhead visible during playback**

### Trigger Condition

- Autoscroll is triggered when:
  - the playhead X position enters a defined **threshold zone** near the right edge of the viewport
  - the playhead has not yet exited the visible area

### Constraints

- [x] Autoscroll must not wait until the playhead is off‑screen
- [x] Autoscroll must not jump abruptly
- [x] Autoscroll must not affect the controls column
- [x] Autoscroll logic must operate in **timeline coordinate space**

### Approved Behavior

- Timeline scroll position advances just enough to:
  - keep the playhead within view, and
  - preserve user orientation

### Invariant

During playback, the playhead must never fully leave the visible timeline area due to lack of autoscroll.
``
---

## Inline Rule - timer display
 - put a timer at the top of the page next to the transport buttons

## Inline Rule - volume meter for mic input volume
 - a colorful decibel meter that is hidden unless recording is in progress


