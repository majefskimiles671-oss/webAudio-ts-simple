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

