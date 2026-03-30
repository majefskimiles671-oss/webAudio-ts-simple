## [Workflow Rules](/Rules/Workflow_Rules.md)

---

## Rule — Raw Markdown, Rule-First Responses

- All assistant responses are written in **raw Markdown**
- Responses are structured so they can be:
  - copied directly into a rules file, or
  - discarded without loss
- No emojis, no emoticons, no conversational filler

### Response Intent

Each response should aim to be **rule‑shaped**, not chat‑shaped.

That means:
- Clear statements
- Explicit constraints
- Minimal explanation
- No dependency on surrounding conversation

### User Control

After each response, the user decides:
- ✅ Save this as a rule
- ❌ Discard it
- 🔁 Prompt again for a better rule

The assistant does **not** assume persistence unless the user explicitly saves it.

### Assistant Defaults

- Prefer rules over explanations
- Prefer bullets over paragraphs
- Prefer constraints over suggestions
- One screen of content for initial responses

### Expansion

More detail is provided **only if explicitly requested**, e.g.:

## Rule — No Emoji or Symbolic Icons in Rules

- Do not use emojis or symbolic icons (e.g., ✅ ❌ ⚠️) in responses intended for rules files
- Replace all such markers with **plain-text tags**

### Approved Tags

- `[*]` — positive / accepted / chosen
- `[!]` — warning / caution
- `[x]` — rejected / invalid / do not use

### Example

Instead of:
- ✅ Correct long-term solution
- ❌ Do not do this

Write:
- `[*]` Correct long-term solution
- `[x]` Do not do this

### Rationale

- Plain-text tags copy cleanly into Markdown
- No rendering differences across editors
- Easier to search, diff, and refactor
- Avoids visual noise

This rule applies to all rule-first responses.




## What I *Can* Do (Closest Practical Alternatives)

- Generate **ready‑to‑paste files** (Markdown, CSS, TS, etc.)
- Present content in **raw Markdown**, structured for saving
- Help you **design file layouts and naming**
- Act as a **stateless rules generator**
- Treat your pasted content as the source of truth

This aligns well with your rule‑first workflow.

---

## Recommended Working Pattern (Given the Constraint)

1. You prompt me
2. I respond in **raw Markdown**
3. You decide:
   - save it to `RULES.md`
   - discard it
   - ask for revision
4. Your local files remain authoritative

This avoids hidden state and regressions.

---

## Optional Enhancement (If You Want)

You can paste:
- a file header
- a section of `RULES.md`
- a snippet from your project

And I will:
- operate only within that pasted context
- produce deltas that fit it
- not assume anything else exists

---

## Guiding Constraint

The rules file is the memory.
The conversation is transient.

---

## Unicode Symbols to use in markdown

- `→` right arrow
- `←` left arrow
- `↔` bidirectional
- `⤷` continuation / sub‑step
- `▸` focus
- `─` horizontal line
- `━` heavy line
- `│` vertical divider
- `┆` light divider
- `┄` dotted divider
- `∴` conclusion

---

## HTML entities to use in markdown
Checkmark	\&check;	✓
Crossmark	\&cross;	✗

## [Project Definition](/Rules/Project_Definition.md)

- in-browser DAW that has UI similar to Ableton Live  or Reaper
- can record from the laptop microphone
- playback multiple tracks simultaneously
- possibly allow playback through headphones while recording through the laptop microphone
- save multitrack projects to local computer (maybe cloud storage later)
- possibly add functionality for editing a single project by two or more people remotely.

## Purpose

- learning technologies that will help me stay current
- possibly making a tool I can use personaly or share with others

## Technologies

- NodeJS, Typescript
- Web Audio API
- Chrome, Safari, Edge
- HTML, CSS
- keep number of packages low
- AI, Copilot chat

## Philosophy

- simple is better than complex
- good architecture, but not so fancy that I can't understand it
- features should be few, but they should be well-built
- Functions and files should be short enough to read in a minute or two

# Notes

## Rules files scheme

- I'll make multiple rules files that are short (about one page long) 
- they should easy for me maintain (I have a short attention span)
- I intend to copy and paste these files into the AI chat periodically
- I may ask the AI to provide edits for a specific rules file, or to create a whole new one

### Rules Files List

- Project_Definition.md [This file.  Represents description of the overall project]
- Workflow_Rules.md [Defines how I would like to communicate with the AI]
- There's a folder [Feature_Definitions] that contains a rule file for each feature
    - Playback.md
    - Recording.md
    - Track_Layout.md
    - others will be added later
- There's another folder [Subprojects] that will contain demos and proofs of concept that can be used to work on parts of the main project in isolation.
- Finally, there's a NO_REGRESSIONS.md file that AI created for me to help prevent slow decay of the codebase


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

- ∴ Helpful thing to remember



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

## [Track Naming](/Rules/Feature_Definitions/Track_Naming.md)

## General

### Rule
 - Each track has a name that is editable and displayed at all times

---
## Layout

### Rule
 - The track name should be visible at all times


---
### Scripting/Behavior

### Rules
 - The name should be populated with a default name upon track creation
 - When the name is edited, it should be saved to the database
 - An empty name is not allowed 