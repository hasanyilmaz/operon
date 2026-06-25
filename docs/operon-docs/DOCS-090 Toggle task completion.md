---
Up:
  - "[[DOCS-022 Command palette reference|Command palette reference]]"
  - "[[DOCS-011 Inline tasks|Inline tasks]]"
  - "[[DOCS-037 Pipelines and statuses|Pipelines and statuses]]"
Notes: Command that flips the task at the cursor between open and done
Icon: circle-check
Color: "#475569"
tags:
  - operon
  - commands
  - completion
Updated: 2026-06-25T16:47:21
---

# Toggle task completion

**Toggle task completion** flips the task at your cursor between open and done. It is the keyboard-driven way to complete a task, or to reopen one you closed by mistake, without leaving the line you are on.

## How it works

Put your cursor on a task line and run the command. What happens next depends on how fully Operon recognizes the task:

- **A task Operon knows from the index** (it has an `operonId` that is indexed) is toggled through your **status workflow**. Completing it advances the status along its [[DOCS-037 Pipelines and statuses|pipeline]] where one is configured, and a running timer is stopped when the task reaches a terminal state.
- **A task readable only from the current line** is toggled directly on that line: the checkbox flips and the completion date is set or cleared.

Either way the visible result is the same task, switched between open and done.

## What it changes

- **Completing** marks the checkbox done and sets **dateCompleted** to today. If the task carried a cancelled date, that is removed.
- **Reopening** returns the checkbox to open and clears both the completion and cancelled dates.

The task's other fields and its `operonId` are left as they are.

## When to use it

Use it as your quick complete-and-reopen action while you read or write. It works on a normal Operon task to move it through your workflow, and on a plain readable inline task line to update the checkbox and date in place. To toggle from a list view instead of the editor, the same result is available from the task's row and menu in your [[DOCS-025 Filter View|Filter View]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-052 Completed task review|Completed task review]]
