---
Notes: Context-aware command that creates, converts, upgrades, or edits at the cursor
Icon: square-pen
Color: "#475569"
Updated: 2026-10-13T16:53:09+02:00
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

If a checkbox belongs to an inline task’s [[DOCS-017 Plain checkbox lists|uninterrupted checkbox block]], upgrading it uses that task as its parent. The line and its indentation stay in place. Outside an owned block, the existing File Task auto-parent setting applies.

## Template defaults and Creator review

When this command creates or upgrades an Inline task, it uses the configured **Default inline task template** under **Tasks → Inline Tasks**. Supported properties supply starting values; source values and parent rules still participate. It does not copy the template body or run Templater. Opening an existing task for editing does not reapply the creation template. See [[DOCS-150 Using inline task templates|Using inline task templates]].

This command remains a direct, context-aware action. **Open Task Creator before conversion** only changes the two Live Preview conversion icons. With that option enabled, clicking an icon prepares the source in Creator for review and template selection before replacement; it does not change this command's behavior.

For a Tasks emoji line, use **Convert Tasks emoji line to inline task** when you want explicit emoji conversion. For selected files/folders, use [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]], whose Scan and recovery workflow is separate from this cursor command.

## When to use it

Reach for this command as your default for quick, in-place work: jotting a task on an empty line, adopting a checkbox or a line you already wrote, or opening a task you are sitting on to change its fields. Because it follows the cursor, it keeps the task where you are writing.

For a guided dialog that does not depend on the cursor, use [[DOCS-084 Create New Operon Task|Create New Operon Task]]. For turning several lines into tasks at once, see [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
