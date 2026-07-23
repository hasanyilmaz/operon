---
Notes: Context-aware command that creates, converts, upgrades, or edits at the cursor
Icon: square-pen
Color: "#475569"
Updated: 2026-07-23T16:45:34
---

# Create or edit inline task

**Create or edit inline task** is the workhorse command for working at the cursor. It is context-aware: it reads where you are and does the fitting thing, so you do not need a separate command for create, convert, upgrade, and edit. Use it when you want Operon to understand the note context for you.

## What it does, by context

| Where the cursor is | What the command does |
|---|---|
| An empty line | Creates a new blank inline task |
| A normal text line | Converts that line into an inline task |
| A plain Markdown checkbox | Upgrades it into an Operon inline task |
| Selected text | Turns the selection into a new inline task |
| An existing Operon task | Opens it in the [[DOCS-021 Task Editor\|Task Editor]] |

## When to use it

Reach for this command as your default for quick, in-place work: jotting a task on an empty line, adopting a checkbox or a line you already wrote, or opening a task you are sitting on to change its fields. Because it follows the cursor, it keeps the task where you are writing.

For a guided dialog that does not depend on the cursor, use [[DOCS-084 Create New Operon Task|Create New Operon Task]]. For turning several lines into tasks at once, see [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
