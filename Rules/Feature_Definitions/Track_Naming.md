## [Track Naming](/Rules/Feature_Definitions/Track_Naming.md)


---

## Track Naming

### Rule — Track Name Visibility

[*] Each track has a name that is **always visible**
[*] The name is **editable by the user**

The track name must never be hidden by:
- scrolling
- zooming
- layout changes

---

### Rule — Default Naming

[*] A track name is populated automatically on creation
[*] Default names must be non‑empty and deterministic

Example (conceptual):
- Track 1
- Track 2
- Track 3

---


## Inline Rule — Track Name Editing Behavior

[*] The track name edit field is **exactly one line tall**
- Multi‑line input is not allowed
- Line breaks must never be inserted

[*] Editing may be завершено via any of the following:
- hitting `Enter`
- clicking anywhere outside the edit field
- losing focus (`blur` event)

### Constraints

- [x] `Enter` must commit the edit, not insert a newline
- [x] Editing must not require a separate “save” control
- [x] Editing must not affect layout, scrolling, or playhead behavior

### Invariant

At all times, the track name occupies a single visual line and behaves as lightweight, inline metadata.

