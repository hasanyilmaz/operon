---
Notes: Insert a task link at the cursor using Task Finder, with overlay controls
Icon: link
Color: "#16a34a"
Updated: 2026-07-23T16:45:34
---

# Add Task Wikilink Overlay

**Add Task Wikilink Overlay** inserts a link to a task at your cursor, so the task appears in the note you are writing with its full [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]]. It is the fastest way to reference a task from any note without typing the link by hand.

## What it does

Run the command and Operon opens [[DOCS-027 Task Finder|Task Finder]]. Search for the task you want and pick it. Operon writes the matching wikilink at the cursor, and the link renders as an overlay in Reading View and Live Preview.

## File and inline links

The link Operon inserts depends on the task you choose:

- A **file task** becomes a normal link to its note, like `[[Draft migration guide]]`.
- An **inline task** becomes a link to the task inside its source file, written as `[[File#-operonId]]`, which points at that one task by its [[DOCS-015 Task identity and operonId|operonId]] instead of a line number.

Either way the result carries the same overlay controls, so a linked inline task is as usable as a linked file task.

## How to run it

1. Open a Markdown editor and place the cursor where the link should go.
2. Open the command palette and run **Add Task Wikilink Overlay**.
3. Find and select the task in Task Finder.

The link appears at the cursor. If you selected text before running the command, Operon replaces that selection with the inserted link. To learn what the inserted link displays and how to configure its chips and actions, see [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]]
- [[DOCS-022 Command palette reference|Command palette reference]]
