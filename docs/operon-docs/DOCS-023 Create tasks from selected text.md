---
Up:
  - "[[DOCS-011 Inline tasks|Inline tasks]]"
  - "[[DOCS-013 File tasks|File tasks]]"
  - "[[DOCS-022 Command palette reference|Command palette reference]]"
Notes: Turn lines you already wrote into Operon tasks
Icon: text-cursor-input
Color: "#ea580c"
tags:
  - operon
  - capture
  - inlinetask
  - selectedtext
  - howto
Updated: 2026-06-25T16:47:21
---

# Create tasks from selected text

Plenty of tasks start life as plain lines in a note: a meeting's action items, a rough checklist, a brain dump. You do not have to retype them. Select the text and let Operon turn it into real tasks in place. This is the bridge from writing to tracking, and it keeps the work where you first wrote it.

> **MEDIA-DOCS-023-1:** A selected mixed list becoming Operon inline tasks after running the command.

![MEDIA-DOCS-023-1 - Selected list converted to Operon tasks](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-023-1.png)

## Convert a selection into tasks

Select a continuous range of list items, then run **Convert Selection to Operon Tasks** from the command palette. Operon converts each list item into an inline task, all at once.

Two things make this more than a bulk find-and-replace:

- **Nesting becomes structure.** Indented list items are linked as subtasks of the item above them, so a nested list turns into a parent task with children, not a flat pile. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].
- **Non-list lines are skipped.** Only list items convert. Anything else in the selection is left untouched, and Operon tells you how many items it converted, how many subtasks it linked, and how many lines it skipped.

Select one continuous list range at a time. Each converted item becomes a full [[DOCS-011 Inline tasks|inline task]] with its own `operonId`.

## Turn one line into a file task

When a single selected line is really a document waiting to happen, make it a [[DOCS-013 File tasks|file task]] instead. Run **Create file task** with the line selected, and Operon seeds a new note from that text and leaves a wikilink in its place. The line becomes a task with room for a body. See [[DOCS-013 File tasks|File tasks]].

## When to use which

- **Convert Selection to Operon Tasks**: several lines at once, especially a list with structure you want to keep as subtasks.
- **Create file task from a line**: one item that deserves its own page.
- A single quick line you just want to track inline is fastest with **Create or edit inline task** on that line. See [[DOCS-011 Inline tasks|Inline tasks]].

## FAQ

**Do my nested lists keep their structure?** Yes. Indented items become subtasks of the item they sit under, so the hierarchy survives the conversion.

**What happens to lines that are not list items?** They are skipped and left as they are. Operon reports how many lines it skipped.

**Can I convert a single line?** Yes. Use **Create or edit inline task** for an inline task, or **Create file task** to make it a note.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]
