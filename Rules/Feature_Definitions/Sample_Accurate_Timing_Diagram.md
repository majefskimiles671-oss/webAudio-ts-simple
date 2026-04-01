Perfect — we’ll **annotate the existing transport + recording diagram with sample‑accurate timing**, without changing behavior. This will turn it into **DAW‑grade documentation**.

Below is a **clean, copy‑paste‑ready doc section** you can keep with the project.

***

# Transport + Recording State Diagram

## Sample‑Accurate Timing Annotations

This system uses a **sample‑accurate transport clock** as the single source of truth for all time‑based behavior.

***

## Canonical Time Variable

All transport time is measured in **samples**, not seconds.

```js
transportSamplePosition  // integer, monotonically increasing
```

*   Unit: **samples**
*   Origin: **0 = timeline start**
*   Increments only while transport is moving
*   Never stored as floating‑point time

***

## Sample Rate

```js
sampleRate  // e.g. 44100 or 48000
```

All conversions derive from this.

***

## Derived (Never Stored)

```text
seconds = transportSamplePosition / sampleRate
pixels  = transportSamplePosition * pixelsPerSample
```

***

## Transport States (Sample‑Accurate)

                              ┌──────────────┐
                              │              │
                              │     IDLE     │
                              │              │
                              │  samples do │
                              │  not change │
                              └──────┬───────┘
                                     │
                                     │ Play ON or Record ON
                                     │
                                     ▼
            ┌────────────────────────────────────────────┐
            │                                            │
            │                 MOVING                     │
            │                                            │
            │ transportSamplePosition += renderedSamples │
            │                                            │
            └──────────┬───────────────┬────────────────┘
                       │               │
                 Play OFF         Record OFF
                       │               │
                       └─────────┬─────┘
                                 ▼
                            ┌──────────┐
                            │  IDLE    │
                            │ samples  │
                            │ frozen   │
                            └──────────┘

### Timing Rules

*   **IDLE**
    *   `transportSamplePosition` is frozen
*   **MOVING**
    *   Each render quantum:
            transportSamplePosition += framesRendered

***

## Expanded Transport States (With Sample Semantics)

| State        | Time Advancement | Meaning                         |
| ------------ | ---------------- | ------------------------------- |
| IDLE         | ❌ no             | Transport stopped               |
| PLAY         | ✅ yes            | Playback only                   |
| RECORD       | ✅ yes            | Recording from current position |
| PLAY\_RECORD | ✅ yes            | Overdub recording               |

**Invariant**

> Time advances if and only if `transportState ≠ IDLE`.

***

## Transition Timing Semantics

### IDLE → MOVING

```text
transportSamplePosition remains unchanged
```

*   No jump in time
*   No implicit reset
*   Motion starts **from current sample position**

Playhead begins rendering at:

```js
playheadX = transportSamplePosition * pixelsPerSample
```

***

### MOVING → IDLE

```text
transportSamplePosition stops advancing
```

Optional demo behavior:

*   playhead visual resets
*   scroll resets

(The **sample clock itself does not rewind unless you explicitly do so**.)

***

## Recording Lifecycle (Sample‑Accurate Overlay)

Recording is **orthogonal** to transport motion.

    Recording OFF
        │
        │ recording = true
        ▼
    ┌────────────────────────────────────┐
    │ Recording ACTIVE                   │
    │                                    │
    │ recordStartSample =                │
    │   transportSamplePosition          │
    │                                    │
    │ recordingLengthSamples =           │
    │   transportSamplePosition          │
    │   - recordStartSample              │
    └──────────┬─────────────────────────┘
               │
               │ recording = false
               ▼
    Recording OFF

***

## Recording Range Geometry (Timeline)

```text
recordStartSample = transportSamplePosition   // at record start
recordEndSample   = transportSamplePosition   // updated each frame

recordRange.width_pixels =
  (recordEndSample - recordStartSample) * pixelsPerSample
```

*   The range **trails the playhead**
*   The range grows **sample‑accurately**
*   Autoscroll does not affect correctness

***

## State + Timing Combined Table

| Transport State | Recording | Sample Clock | Record Range |
| --------------- | --------- | ------------ | ------------ |
| IDLE            | OFF       | frozen       | none         |
| PLAY            | OFF       | advancing    | none         |
| RECORD          | ON        | advancing    | growing      |
| PLAY\_RECORD    | ON        | advancing    | growing      |
| PLAY (from PR)  | OFF       | advancing    | cleared      |

***

## Render Quantum Note (Web Audio Context)

In practice, time advances in **render quanta**:

```text
quantumSize ≈ 128 samples (typical)
```

So per render callback:

```js
transportSamplePosition += quantumSize;
```

This ensures:

*   deterministic timing
*   perfect clip alignment
*   no drift between visuals and audio

***

## Visualization Mapping (Summary)

| Concept             | Unit              |
| ------------------- | ----------------- |
| Transport clock     | samples           |
| Recording start/end | samples           |
| Clip placement      | samples           |
| Playhead render     | pixels ← samples  |
| UI readout          | seconds ← samples |

***

## Core Invariant (Documentation‑Grade)

> **All timing is expressed in samples.  
> Seconds, pixels, and visuals are derived projections.**

If this invariant holds, the system is:

*   sample‑accurate
*   drift‑free
*   deterministic
*   DAW‑correct

***

## Status

✅ Transport timing fully specified  
✅ Recording timing fully specified  
✅ No hidden time sources  
✅ Ready for audio buffer integration

If you want next, I can:

*   annotate this with actual Web Audio API callbacks
*   show how recorded buffers align to `recordStartSample`
*   add punch‑in / punch‑out timing correctly
*   or help you freeze this as final documentation
