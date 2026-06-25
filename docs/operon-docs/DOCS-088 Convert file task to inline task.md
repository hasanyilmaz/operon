---
Up:
  - "[[DOCS-022 Command palette reference|Command palette reference]]"
  - "[[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]"
  - "[[DOCS-013 File tasks|File tasks]]"
Notes: Command that collapses a file task back into a single inline task
Icon: refresh-cw
Color: "#475569"
tags:
  - operon
  - commands
  - filetask
  - inlinetask
  - convert
Updated: 2026-06-25T16:47:21
---

# Convert file task to inline task

**Convert file task to inline task** moves a [[DOCS-013 File tasks|file task]] back into inline form, collapsing the note into a single inline task line. It is the reverse of promoting a task to its own note.

## How it works

- You pick the file task to convert with [[DOCS-027 Task Finder|Task Finder]].
- Where the new inline task is placed depends on your cursor: with a clear cursor target, it lands at that location; without one, it goes to your default inline task location.
- After you confirm, the old file task note is sent to the Obsidian trash, following your **Settings → Files and links → Deleted files** choice (system trash, the vault's `.trash` folder, or permanent deletion).

## What is kept, and what is not

A file task is a whole note; an inline task is a single line. The conversion folds the note down to that one line, so it carries the task's data but not the note's body.

**Kept**

- The `operonId`, so it stays the same task across the change. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].
- All built-in task fields, such as status, priority, and dates.
- Your managed **custom keys**, written with their canonical key name.
- The task's tags.
- The note's title, which becomes the inline task's description text.

**Not kept**

- The note's **body**: any prose, headings, or other lines you wrote below the task fields. This content is not moved onto the inline line, and it goes away when the note is trashed. If the body matters, copy it somewhere first.
- Frontmatter properties that are not Operon-managed fields.

Because the `operonId` and fields survive, the task stays the same task in a lighter shape; it is only the surrounding note content that does not come along. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## When to use it

Use it when a note no longer needs its own body, and the task would be easier to handle as a line again. If you only want to keep the note but stop treating it as a task, that is a different action; this command is specifically for collapsing back to inline.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-087 Edit or convert to file task|Edit or convert to file task]]
