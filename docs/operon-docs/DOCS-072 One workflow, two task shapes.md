---
Notes: Why inline and file tasks are one system, not two
Icon: workflow
Color: "#7c3aed"
Updated: 2026-07-23T16:45:34
---

# One workflow, two task shapes

Operon's defining idea is small to state and large in effect: a task can be written two ways, but it lives in one system. An [[DOCS-011 Inline tasks|inline task]] on a line and a [[DOCS-013 File tasks|file task]] in its own note are not two separate worlds you have to bridge. They are two shapes of the same kind of thing, and every Operon workflow treats them alike. That is what the short definition means when it says Operon **unifies inline tasks and file-based tasks in the same workflows**.

## Two shapes, for two moments

The two shapes exist because work shows up in two ways.

- An **inline task** is a quick line inside a note you are already writing: a daily note, a meeting note, a project brief. It is the low-friction shape, perfect for "capture it before it is gone."
- A **file task** is a note that is itself a task, with its fields in frontmatter and its body as a working document. It is the high-context shape, for work that deserves room: a draft, a release plan, a research thread.

You choose the shape for the moment, not for life. See [[DOCS-014 Inline vs file tasks|Inline vs file tasks]] for when to reach for each.

## What makes them one system

Three things hold the two shapes together, so picking a shape never splits your system in two.

- **The same fields.** Both shapes carry the same canonical fields. An inline task writes them as `{{key:: value}}` on the line; a file task writes them as frontmatter. Underneath, they resolve to the same keys, so a task means the same thing in either form. See [[DOCS-018 Task properties|Task properties]].
- **The same identity.** Every task carries an `operonId`, so the same work stays recognizable wherever it appears and through every change, including conversion from one shape to the other. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].
- **The same workflows.** Filters, the Calendar, the Kanban, recurrence, pinning, and time tracking all act on tasks by their fields and identity, not by their shape. So an inline line and a full note sit in the same filtered list, on the same Calendar day, in the same Kanban column.

## One board, both shapes

This is easiest to feel in the views, because that is where the two shapes meet:

| Workflow | How both shapes appear together |
|---|---|
| [[DOCS-025 Filter View\|Filter View]] | A filter matches on fields, so inline and file tasks fill one list. |
| [[DOCS-028 Calendar overview\|Calendar]] | Either shape lands on a date and is planned side by side. |
| [[DOCS-030 Kanban overview\|Kanban]] | Cards flow through the same status columns regardless of shape. |
| [[DOCS-032 Pinned Task Dock\|Pinned dock]] | Both can be pinned to the same focus list. |
| [[DOCS-033 Recurring tasks\|Recurrence]] | Both can repeat from the same rule. |
| [[DOCS-034 Time tracking\|Time tracking]] | Both record real effort the same way. |

## Start one way, change later

Because the shapes are unified, the first choice is a starting point, never a commitment. You can begin inline and promote to a file task when the work grows, or collapse a file task back to a line when it shrinks, and Operon carries the task's identity and fields forward. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## FAQ

**Do I have to decide inline or file up front?** No. Pick whatever fits the moment and convert later. The identity and fields survive the change.

**Will a filter or the Calendar show only one shape?** No. They show tasks by their fields, so both shapes appear together.

**Is one shape more capable than the other?** They differ in form, not standing. A file task adds a note body for context; the task fields and workflows are the same.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
