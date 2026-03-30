

---

## Inline Rule — Global Timer Display

[*] A **timer display** must be visible in the transport area

### Constraints

- [*] The timer is located **next to transport controls**
- [*] The timer is visible at all times
- [x] The timer must not cause layout shift
- [x] The timer must not depend on audio playback state

### Scope (Layout Demo)

- Timer behavior may be simulated
- Exact time format is not yet fixed
- No synchronization with audio is required

---

## Inline Rule — Mic Input Volume Meter

[*] A **mic input volume meter** must exist in the transport area

### Behavior

- The meter is:
  - hidden by default
  - visible **only while recording is active**

### Constraints

- [*] Meter must be visually distinct and colorful
- [*] Meter conveys relative input loudness (decibel‑style)
- [x] Meter must not consume layout space when hidden
- [x] Meter visibility must not affect other controls

### Scope (Layout Demo)

- Meter may be a visual simulation
- No real microphone input required
- No audio processing required

---

## Scope Reminder

These rules introduce **UI affordances only**.
They do not introduce audio, timing accuracy, or signal processing requirements.

---


