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
