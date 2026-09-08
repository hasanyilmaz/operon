---
Notes: The right-click and hover action menu on tasks
Icon: menu
Color: "#ca8a04"
Updated: 2026-09-08T11:15:28+02:00
---

# Contextual menu actions

Wherever a task appears, Operon offers a contextual menu of actions on it: from a filter row, a Calendar item, a Kanban card, a pinned task, an [[DOCS-140 Upcoming Tasks|Upcoming Tasks]] card, or an inline task. Task icons also expose contextual hover menus across supported surfaces, including Calendar and the task icon column in the [[DOCS-105 Table overview|Table]]. It is the mouse-friendly counterpart to the [[DOCS-022 Command palette reference|command palette]].

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
- **Reminders**: **Fixed Reminder** opens the **ReminderDatetimes** picker, **Relative Reminder** opens the **ReminderRules** picker, each icon following its own canonical property. See [[DOCS-116 Reminders|Reminders]].
- **Remove**: **Delete task**.

## Settings

You control the menu in **Settings → Operon → Interface → Context Menu**:

- **Contextual Menu Actions**: choose which actions are globally enabled and set their order. Disabled actions never appear; enabled ones still show only when the task and surface support them.
- **Contextual Menu Matrix**: choose which surfaces can show each globally enabled action. The **Upcoming Tasks** row is under **Task Lists**, so its menu can be configured independently of other task surfaces. **Task wikilink overlay** has its own row under **Note Surfaces**. Locked cells mean the action is globally disabled or unsupported on that surface; enabling a cell never overrides task-specific availability.
- **Context Menu Delay**: set the **Hover menu open delay**.
- **Mobile touch menu**: enable long-press menus and adjust the long-press delay and transition grace period.

Tune this once to keep the menu short and relevant to how you work.

> **MEDIA-DOCS-042-2:** The Context Menu settings, enabling actions and setting their order.

![MEDIA-DOCS-042-2 - Context Menu settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-042-2.png)

## Interacting with an open menu

Clicking a task icon follows the global **Task icon click action** preference; choosing an explicit menu action such as **Cancel task** keeps that action’s own meaning. See [[DOCS-099 State Icons|State Icons]] for the two icon modes.

When a task’s status or state changes and the task remains on the same surface, the hover menu stays open and updates its available actions in place rather than closing and reopening during the save. If the task disappears from that surface—for example, a completed task is removed from a filtered list—the menu can close. This keeps the menu attached to the task you were using.

On mobile, enable **Mobile touch menu** to open the menu with a long press. Releasing that press does not also activate the task icon. A short tap keeps the icon’s normal click behavior.

## FAQ

**Why do I see different actions on different tasks?** The menu is context-aware. It hides actions that do not apply to the current task or the surface you are on.

**Can I reorder the actions?** Yes, in the Context Menu settings. Order and visibility are both yours to set.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-004 Operon system map|Operon system map]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-140 Upcoming Tasks|Upcoming Tasks]]
- [[DOCS-099 State Icons|State Icons]]
