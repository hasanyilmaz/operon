---
Up:
  - "[[DOCS-022 Command palette reference|Command palette reference]]"
  - "[[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]]"
  - "[[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]"
Notes: The right-click and hover action menu on tasks
Icon: menu
Color: "#ca8a04"
tags:
  - operon
  - settings
  - contextmenu
  - configure
Updated: 2026-06-25T16:47:21
---

# Contextual menu actions

Wherever a task appears, Operon offers a contextual menu of actions on it: from a filter row, a Calendar item, a Kanban card, a pinned task, or an inline task. The same menu surfaces as a hover menu on task icons in the Calendar. It is the mouse-friendly counterpart to the [[DOCS-022 Command palette reference|command palette]].

The menu is **context-aware**: an action only appears when the current task and surface actually support it. A scheduled task offers **Unschedule**; a recurring occurrence offers **Skip this occurrence**; a task with no due date will not show **Clear due date**; the **Subtasks** action shows only on an open task that actually has subtasks.

> **MEDIA-DOCS-042-1:** A task's contextual menu open, showing the available actions.

![MEDIA-DOCS-042-1 - Task contextual menu actions](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-042-1.png)

## The actions

Grouped by what they do:

- **Open and inspect**: **Open editor**, **Jump to source** (go to the task's note), **Copy operonId**.
- **Status and completion**: **Task status**, **Mark done**, **Cancel task**.
- **Structure**: **Subtasks** (open the task's **Dynamic Subtasks Filter**, a live filtered window of just this task's subtree, locked to its `operonId`; appears only on an open task that has subtasks), **Create subtask**, **Checkboxes** (open or create [[DOCS-017 Plain checkbox lists|plain checkboxes]]). See [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]].
- **Convert**: **Convert to file**, **Convert to inline**. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].
- **Scheduling**: **Unschedule**, **Clear due date**, **Skip this occurrence**.
- **Pin and time**: **Pin task** / **Unpin task**, **Start timer** / **Stop timer**, **Log as tracked** (record a planned block as tracked time).
- **Remove**: **Delete task**.

## Settings

You control the menu in **Settings → Operon → Interface → Context Menu**:

- **Contextual Menu Actions**: choose which actions are globally enabled and set their order. Disabled actions never appear; enabled ones still show only when the task and surface support them.
- **Contextual Hover Menu Actions**: the same idea for the Calendar's task-icon hover menu.
- **Context Menu Delay**: how long before the menu opens on hover.

Tune this once to keep the menu short and relevant to how you work.

> **MEDIA-DOCS-042-2:** The Context Menu settings, enabling actions and setting their order.

![MEDIA-DOCS-042-2 - Context Menu settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-042-2.png)

## FAQ

**Why do I see different actions on different tasks?** The menu is context-aware. It hides actions that do not apply to the current task or the surface you are on.

**Can I reorder the actions?** Yes, in the Context Menu settings. Order and visibility are both yours to set.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-004 Operon system map|Operon system map]]
