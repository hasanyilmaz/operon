---
Up:
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
  - "[[DOCS-013 File tasks|File tasks]]"
  - "[[DOCS-015 Task identity and operonId|Task identity and operonId]]"
Notes: Tasks written on a single Markdown line
Icon: list-checks
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - inlinetask
Updated: 2026-06-25T16:47:21
---

# Inline tasks

Inline tasks are ordinary Markdown checkboxes with a little memory attached. They are the lightest way to use Operon: the task stays inside the note where it belongs, but it gains enough structure to be found, filtered, edited, scheduled, and tracked across the vault.

Reach for this shape when the task needs context but not a whole file.

## What an inline task is

An inline Operon task is still a Markdown checkbox. The difference is that Operon adds metadata after the task text using `{{key:: value}}` fields. The line stays readable as Markdown, while Operon treats it as a durable task record:

```md
- [ ] Draft release notes {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{priority:: A}} {{dateScheduled:: 2026-05-20}}
```

The readable text comes first. The most important field is `operonId`, which gives the task its identity. Here it is written as the `{{operonId}}` **template variable**: paste this line into a note and Operon fills in a real, unique id for you, so you never type one. Everything else adds structure around that identity. The full field reference, with more copy-paste ready examples, is in [[DOCS-012 Inline task syntax|Inline task syntax]].

Inline tasks can appear in filters, the Calendar, the Kanban, the Task Editor, Task Finder, pinned workflows, recurrence, and time tracking. They never have to leave their source note to become manageable.

## When inline tasks fit

Use inline tasks when the surrounding note already explains the work. A meeting action belongs near the meeting. A daily task can stay in the daily note. A checklist item in a project note should not become a separate file unless it needs more room.

They are also ideal for fast capture. Write the sentence first, then turn it into a task when it becomes actionable. Not every task deserves a new note.

## Create or edit one

Run **Create or edit inline task** from the command palette:

- On an empty line, it creates a new inline task.
- On plain text or a list item, it converts that line into a task.
- On a normal Markdown checkbox, it upgrades the checkbox into an Operon task.
- On an existing inline task, it opens the [[DOCS-021 Task Editor|Task Editor]].

That symmetry matters: the same command is both the way in and the doorway back to structured editing. To turn several lines into tasks at once, use **Convert Selection to Operon Tasks**.

## Limits and tradeoffs

Inline tasks are compact, which is both the advantage and the constraint. If the work needs sections, references, decisions, or many subtasks, a [[DOCS-013 File tasks|file task]] is the better shape. You can always start inline and promote it later; see [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

And do not treat the metadata as decorative. It is visible because the task lives in Markdown, but fields like `operonId` should not be casually edited. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

## FAQ

**Can inline tasks have status and priority?** Yes. They carry the same structured fields as any Operon task: status, priority, dates, contexts, assignees, parent links, recurrence, and more.

**Are they still readable without Operon?** Yes. They stay Markdown checkbox lines. The metadata shows as text, but the line still reads as a task.

**When should I convert one to a file task?** When the task needs its own body. If you find yourself writing notes about the task in other notes, it is asking for a file.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Inline Tasks**, which configures how inline tasks are created, displayed, and auto-parented.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-005 Operon core concepts|Operon core concepts]]
- [[DOCS-014 Inline vs file tasks|Inline vs file tasks]]
