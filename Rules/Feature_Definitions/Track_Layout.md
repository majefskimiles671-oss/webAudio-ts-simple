## [Track Layout](/Rules/Feature_Definitions/Track_Layout.md)

## Rule — Authoritative Height Owner

- Each track row must have **exactly one authoritative height owner**
- The authoritative height owner is the **timeline content** (waveform + padding)
- Control column height must be **derived**, never computed independently

### Constraints

- [x] Controls column must not determine its own height
- [x] CSS variables must not be used as the source of truth for row height
- [x] Parallel DOM trees must not auto-size independently

### Approved Mechanism

- Measure height from the timeline row
- Apply that height explicitly to the corresponding controls row

Example pattern (conceptual):
```ts
const h = timelineRow.getBoundingClientRect().height;
controlsRow.style.height = `${h}px`;
```

## Rule — Minimal ResizeObserver for Height Sync

- `ResizeObserver` may be used **only** to synchronize row heights
- The observer must watch the **authoritative height owner** (timeline row)
- Observed height is applied directly to the paired controls row

### Scope

- Observer responsibility is limited to:
  - detecting height changes
  - applying pixel height
- Observer must not:
  - trigger re-renders
  - mutate layout structure
  - infer height from anything else

### Approved Pattern (Conceptual)

```ts
const ro = new ResizeObserver(([entry]) => {
  const h = entry.contentRect.height;
  controlsRow.style.height = `${h}px`;
});

ro.observe(timelineRow);
```


## Rule — Parallel Columns + JS Row Sync (Ableton / Reaper Style)

[*] This is the **authoritative layout model** for track rendering.

### Definition

- Track **controls column** and **timeline column** are rendered separately
- Row heights are synchronized explicitly in **JavaScript**
  - via `ResizeObserver`, or
  - via explicit measurement after render
- The timeline column is the **authoritative height owner**

This model preserves correct behavior under horizontal scrolling.

---

### Pros

- [*] Perfect UX
- [*] True sticky control column (never scrolls horizontally)
- [*] Matches professional DAWs (Ableton, Reaper, Logic)

---

### Cons

- [!] Slightly more code
- [!] Requires explicit layout coordination

---

### Decision

[*] This is the most correct long‑term solution for DAW timeline layout  
[x] Do not replace this with CSS‑only or single‑grid alternatives

---

### Invariant

If controls and timeline heights diverge, the layout is considered broken.



### Rule Restated (Authoritative)

[*] **True sticky controls require the control column to live outside the horizontal scroll container**

This is a hard architectural constraint.

---

### Minimal Structural Fix (Required)

The DOM must be split similar to this:

```html
<div class="layout-root">

  <!-- LEFT: never scrolls horizontally -->
  <div id="controls-column"></div>

  <!-- RIGHT: timeline scroll only -->
  <div id="timeline-area">
    <div id="timeline-overlay">
      <div id="playhead"></div>
    </div>
    <div id="timeline-column"></div>
  </div>

</div>
```

This means:

Rendering must use parallel columns
Heights must be synchronized in JavaScript
This aligns exactly with the rule:
“Parallel Columns + JS Row Sync (Ableton / Reaper Style)”

--- 

## Inline Rule — Per‑Track Solo Toggle

[*] Each track must have a **Solo toggle button**

### Constraints

- [*] The Solo control is visible at all times
- [*] Solo is a per‑track control
- [x] Solo must not be hidden behind menus
- [x] Solo must not affect layout geometry when toggled

### Scope (Layout Demo)

- Solo toggle is **visual and interactive only**
- No audio interaction is required in the demo

---

## Inline Rule — Per‑Track Gain Slider

[*] Each track must expose a **gain slider**

### Constraints

- [*] Gain control is visible at all times
- [*] Gain is adjusted via a continuous slider
- [x] Gain slider must not affect track height
- [x] Gain slider must not introduce layout shift

### Scope (Layout Demo)

- Slider behavior is **non‑functional**
- Value changes do not need to affect audio

---
### Controls column and timeline column
Vertical scroll position must be shared.
Horizontal scroll position must be exclusive.
If controls and timeline ever diverge vertically, the layout is broken.




