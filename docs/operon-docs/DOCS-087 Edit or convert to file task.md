---
Notes: Command that edits the open file task or turns the current note into one
Icon: refresh-cw
Color: "#475569"
Updated: 2026-07-23T16:45:34
---

# Edit or convert to file task

**Edit or convert to file task** works on the note you currently have open. Depending on what that note is, it either edits an existing file task or turns a normal note into one.

## What it does, by context

| The open note is | What it does |
|---|---|
| An existing Operon file task | Opens it in the [[DOCS-021 Task Editor\|Task Editor]] |
| A note with Operon task fields at the top | Edits those fields |
| A normal note | Converts the note into an Operon file task |

## When to use it

Use it to edit a file task you are reading without hunting for the command, or to promote a note you have been writing into a real task once it has become one. Converting keeps the note's body; it adds the task fields and an `operonId`. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

This command only ever acts on the note you already have open, and it confirms before converting a normal note. To convert a note you have not opened, right-click it and choose **Convert to Operon File Task…** instead, which skips the confirmation and goes straight to the template picker. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-088 Convert file task to inline task|Convert file task to inline task]]
- [[DOCS-013 File tasks|File tasks]]
- [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]
