---
Up:
  - "[[DOCS-014 Inline vs file tasks|Inline vs file tasks]]"
  - "[[DOCS-013 File tasks|File tasks]]"
  - "[[DOCS-015 Task identity and operonId|Task identity and operonId]]"
Notes: Promote an inline task to a file, or collapse a file task back to a line
Icon: refresh-cw
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - inlinetask
  - filetask
  - convert
Updated: 2026-06-25T16:47:21
---

# Converting inline and file tasks

A task's first shape is a starting point, not a verdict. When an inline task grows into real work, promote it to a file task. When a file task has done its job, collapse it back to a single line. Operon carries the same task across the change, so its identity and fields come with it. For help choosing a shape in the first place, see [[DOCS-014 Inline vs file tasks|Inline vs file tasks]].

## Promote an inline task to a file task

When a task needs a body for sections, references, or subtasks, run **Edit or convert to file task** on the inline task. Operon creates a Markdown note in your file-task location, writes the task's fields into frontmatter, and keeps the original `operonId` so nothing downstream breaks. The note's body becomes the working space the inline line never had. See [[DOCS-013 File tasks|File tasks]].

You can also start a file task straight from a plain line with **Create file task**, which seeds the note from that text and leaves a wikilink behind in its place.

## Collapse a file task back to inline

When the extra note is no longer pulling its weight, run **Convert file task to inline task**. Operon rebuilds the task as a single inline line, preserving its `operonId` and fields, and inserts it at your cursor or a target file you pick. It then asks you to confirm, because the original note is moved to trash as part of the conversion. The button is labelled **Convert and Move to Trash** so the outcome is never a surprise.

## Identity is preserved

The reason conversion is safe is the `operonId`. Both directions keep it, so the task stays the same record before and after: its place in filters, the Calendar, the Kanban, recurrence series, and parent links all survive. This is why you should convert through these commands rather than by hand. Manually retyping a task as the other form would give it a different identity and break those links. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

## What changes, what does not

- **Stays the same**: the `operonId`, and the task's fields (status, priority, dates, parent, recurrence, and the rest).
- **Changes**: where the fields are written (inline `{{key:: value}}` versus frontmatter), and whether the task has a note body. Promoting adds a body; collapsing removes it and trashes the note.

So the conversion is about the task's *container*, not its meaning.

## FAQ

**Will I lose my fields when converting?** No. Operon carries the canonical fields across both directions. Only the container changes.

**What happens to the old file when I collapse to inline?** It is moved to trash after you confirm, so the task is not duplicated.

**Can I convert a plain note into a task?** Yes. **Edit or convert to file task** turns the current note into an Operon file task.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-022 Command palette reference|Command palette reference]]
