---
Up:
  - "[[DOCS-022 Command palette reference|Command palette reference]]"
  - "[[DOCS-011 Inline tasks|Inline tasks]]"
  - "[[DOCS-027 Task Finder|Task Finder]]"
Notes: Command that relocates an existing inline task to the current cursor line
Icon: move-right
Color: "#475569"
tags:
  - operon
  - commands
  - inlinetask
  - move
Updated: 2026-06-25T16:47:21
---

# Move an inline task here

**Move an inline task here** relocates an existing [[DOCS-011 Inline tasks|inline task]] to where your cursor is. You pick the task to move with [[DOCS-027 Task Finder|Task Finder]], and the current cursor line becomes its new home.

## How it works

- Put your cursor on a **blank line** where you want the task to land. If the line already has text, the command stops and asks for an empty line.
- Run the command. [[DOCS-027 Task Finder|Task Finder]] opens, scoped to inline tasks, so you choose the one to move.
- The task's line is written at your cursor, and its original line is cleared. This works whether the source is in the same note or another note.

The task moves as a whole line, so its `operonId`, fields, tags, and description all travel with it untouched. It stays the same task; only its location changes.

## What it works on

The source must be an inline task. A file task lives in its own note and cannot be moved this way; to bring a file task into inline form, use [[DOCS-088 Convert file task to inline task|Convert file task to inline task]] instead.

## When to use it

Reach for it to reorganize inline tasks without cutting and pasting their metadata by hand. It is handy for gathering scattered tasks under a heading, pulling a task into today's [[DOCS-050 Daily Notes workflows|daily note]], or moving an item next to related notes, all without risking the task's identity or fields.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
