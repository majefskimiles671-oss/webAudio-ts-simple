Below is a **complete, explicit transport + recording state diagram** suitable for **documentation**.  
It matches your current behavior **exactly** — no implied transitions, no future guesses.

I’ll present it in three layers so it’s easy to reason about and copy into docs.

***

## 1. High‑Level State Diagram (Transport Motion)

This diagram answers only one question:

> **Is time advancing or not?**

                    ┌──────────────┐
                    │              │
                    │     IDLE     │
                    │              │
                    │  no motion   │
                    └──────┬───────┘
                           │
            Play ON         │       Record ON
          ─────────────────┼─────────────────
                           │
                           ▼
                ┌──────────────────────┐
                │                      │
                │        MOVING        │
                │                      │
                │ time advancing       │
                │                      │
                └──────┬────────┬─────┘
                       │        │
              Play OFF  │        │ Record OFF
                       │        │
                       ▼        ▼
                    ┌──────────────┐
                    │              │
                    │     IDLE     │
                    │              │
                    └──────────────┘

### Notes

*   `MOVING` is a **semantic category**, not a literal state
*   Internally, `MOVING` expands into:
    *   `PLAY`
    *   `RECORD`
    *   `PLAY_RECORD`
*   **Playhead starts only on `IDLE → MOVING`**
*   **Playhead resets only on `MOVING → IDLE`**

***

## 2. Expanded State Diagram (Exact Transport States)

This diagram shows **all concrete transport states**.

                              ┌──────────────┐
                              │              │
                              │     IDLE     │
                              │              │
                              └──────┬───────┘
                                     │
                                     │ Play ON
                                     ▼
                        ┌────────────────────────┐
                        │                        │
                        │         PLAY           │
                        │                        │
                        └────────┬───────────────┘
                                 │
                                 │ Record ON
                                 ▼
              ┌────────────────────────────────────────┐
              │                                        │
              │           PLAY_RECORD                  │
              │                                        │
              └──────────────┬───────────────┬────────┘
                             │               │
                  Record OFF │               │ Play OFF
                             │               │
                             ▼               ▼
                        ┌──────────────┐  ┌──────────────┐
                        │              │  │              │
                        │   PLAY       │  │   RECORD     │
                        │              │  │              │
                        └──────┬───────┘  └──────┬───────┘
                               │                 │
                         Play OFF           Record OFF
                               │                 │
                               └─────────┬───────┘
                                         ▼
                                    ┌──────────┐
                                    │  IDLE    │
                                    └──────────┘

***

## 3. Recording Lifecycle Overlay (Orthogonal Axis)

Recording is **not the same as motion**.  
This overlay shows the **recording range lifecycle**, independent of motion.

    Recording OFF
        │
        │  recording = true
        ▼
    ┌───────────────────┐
    │ Recording ACTIVE  │
    │                   │
    │ - recordStartX set│
    │ - recordRange shown
    │ - width grows     │
    └──────────┬────────┘
               │
               │ recording = false
               ▼
    Recording OFF

### Critical Rules

*   Recording range **starts only on**:
        wasRecording === false
        recording === true
*   Recording range **ends only on**:
        wasRecording === true
        recording === false
*   Recording range **does NOT depend on IDLE**
*   Recording range **does NOT restart on overdub**

***

## 4. Combined View (What Actually Happens)

Putting both axes together:

| Transport State | Recording | Playhead | Recording Range |
| --------------- | --------- | -------- | --------------- |
| IDLE            | OFF       | stopped  | hidden          |
| PLAY            | OFF       | moving   | hidden          |
| RECORD          | ON        | moving   | growing         |
| PLAY\_RECORD    | ON        | moving   | growing         |
| PLAY            | (from PR) | moving   | **cleared**     |

✅ Every row is reachable  
✅ No ambiguous behavior  
✅ No hidden transitions

***

## 5. Transition Rules (Formalized)

These are the **only transitions that cause side effects**:

### Transport Motion

    IDLE → any moving state
      → startTime set
      → playhead starts

    any moving state → IDLE
      → playhead reset
      → scroll reset

### Recording Lifecycle

    recording false → true
      → recordStartX set
      → recordRange shown

    recording true → false
      → recordRange hidden
      → recordStartX cleared

***

## 6. One‑Paragraph Summary (Doc‑Ready)

> The transport consists of four concrete states: IDLE, PLAY, RECORD, and PLAY\_RECORD.  
> Time advances in any non‑IDLE state.  
> Recording is an independent axis that controls the lifecycle of a recording range.  
> Playhead motion depends on transport state transitions, while recording visuals depend solely on recording transitions.  
> No state transition causes implicit side effects outside its defined responsibility.

***

## 7. Why This Matters

Because this diagram exists:

*   ✅ There are no hidden transitions
*   ✅ New features can be added safely
*   ✅ Bugs can be traced to **one axis**
*   ✅ You can stop revisiting transport logic

***

### You are now at **“transport‑complete”** status.

If you want next, I can:

*   turn this into a diagram image or SVG
*   add sample‑accurate timing annotations
*   document the recording‑range geometry model
*   help you move on to audio buffer capture with confidence
