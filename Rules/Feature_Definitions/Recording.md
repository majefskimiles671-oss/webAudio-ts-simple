## [Recording](/Rules/Feature_Definitions/Recording.md)


## Inline Rule — Global Record Button

[*] There must be a **global Record button**

### Behavior

- The button toggles between:
  - `Record`
  - `Stop`

### Constraints

- [*] The button is located in the **transport bar**
- [*] The state change is visually obvious
- [x] Per‑track record controls are not required here
- [x] No recording logic is required in the demo

---

## Scope Reminder

These rules apply to:
- Layout visibility
- Interaction affordance
- UI state indication

They do **not** introduce audio, persistence, or routing requirements.

---



## Inline Rule — Disable Play While Recording

[*] If recording is in progress, the **Play button must be disabled**

### Behavior

- When recording state is `active`:
  - Play button is visually disabled
  - Play button does not respond to clicks
- When recording state ends:
  - Play button is re‑enabled

### Constraints

- [x] Play and Record must never be active at the same time
- [x] Disabling Play must not cause layout shift
- [x] Disabled state must be visually obvious

### Scope (Layout Demo)

- Disabling may be simulated via:
  - `disabled` attribute, or
  - CSS class + click suppression
- No audio interaction is required

### Invariant

Recording is an exclusive transport mode.
While recording, playback initiation is not allowed.
