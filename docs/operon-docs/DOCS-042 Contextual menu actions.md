---
Notes: The right-click and hover action menu on tasks
Icon: menu
Color: "#ca8a04"
Updated: 2026-10-06T10:40:55+02:00
---

# Contextual menu actions

Wherever a task appears, Operon offers a contextual menu of actions on it: from a filter row, a Calendar item, a Kanban card, a pinned task, an [[DOCS-140 Upcoming Tasks|Upcoming Tasks]] card, a [[DOCS-141 Canvas Task Cards|Canvas Task Card]], an [[DOCS-147 Excalidraw Task Cards|Excalidraw Task Card]], an [[DOCS-142 Embedded Task Cards|Embedded Task Card]], or an inline task. Task icons also expose contextual hover menus across supported surfaces, including Calendar and the task icon column in the [[DOCS-105 Table overview|Table]]. It is the mouse-friendly counterpart to the [[DOCS-022 Command palette reference|command palette]].

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

## Interacting with an open menu

Clicking a task icon follows the global **Task icon click action** preference; choosing an explicit menu action such as **Cancel task** keeps that action’s own meaning. See [[DOCS-099 State Icons|State Icons]] for the two icon modes.

When a task’s status or state changes and the task remains on the same surface, the hover menu stays open and updates its available actions in place rather than closing and reopening during the save. If the task disappears from that surface (for example, a completed task is removed from a filtered list), the menu can close. This keeps the menu attached to the task you were using.

On mobile, enable **Mobile touch menu** to open the menu with a long press. Releasing that press does not also activate the task icon. A short tap keeps the icon’s normal click behavior.

## Task Card menus

Hover over a Task Card's task icon to open its contextual menu. With the icon focused, the Context Menu key or **Shift+F10** also opens it. Use **Open editor**, **Jump to source**, or another available action without leaving the card's task context.

Menu actions operate on the source task. On Canvas and Excalidraw, they respect the surface’s write permissions and applicable element locks; enabling an action in the matrix does not bypass that lock or make an unavailable task editable. The separate **Task Card Actions** settings control the card's inline buttons, not this menu.

The shortcuts below a selected Canvas or Excalidraw task card are separate from the task-icon menu. Relationship controls on a selected connection or arrow are another set of controls: they set parent/child and blocking relationships between the connected tasks. See [[DOCS-141 Canvas Task Cards|Canvas Task Cards]] and [[DOCS-147 Excalidraw Task Cards|Excalidraw Task Cards]] for those controls.

## FAQ

**Why do I see different actions on different tasks?** The menu is context-aware. It hides actions that do not apply to the current task or the surface you are on.

**Can I reorder the actions?** Yes, in the Context Menu settings. Order and visibility are both yours to set.

## Settings

You control the menu in **Settings → Operon → Interface → Context Menu**:

- **Hover Menu** sets the hover-open delay.
- **Mobile Touch Menu** enables long-press menus and sets the long-press delay, transition grace period, and auto-hide time. The three timing controls are hidden when the menu is disabled; their saved values remain.
- **Menu Actions & Order** enables actions and sets their order. Enabled actions still appear only when the task and surface support them.
- **Action Visibility by Surface**, also called the **Contextual Menu Matrix**, selects where each enabled action may appear.

### Keep an action's position

Turning an action off leaves its row in place and hides its matrix column. The up/down arrows can move both enabled and disabled actions. Re-enabling an action restores it at its saved position, with its previous surface selections. The live menu and matrix follow the enabled actions in that order; disabling an action does not move it into a separate group.

### Read the matrix

Rows represent surfaces and columns represent globally enabled actions. A selected cell allows the action on that surface; an unselected cell hides it there. Locked cells mean that the surface does not support that action. No selection bypasses task-specific availability or read-only restrictions.

**Upcoming Tasks** is under **Task Lists**; **Task wikilink overlay** is under **Note Surfaces**. **Task Cards** covers the task-icon menus shared by Canvas and embedded cards, separately from Kanban. **Excalidraw** has its own surface selection, so its task-icon actions can be configured independently. Calendar timed items and Calendar task pool tasks appear in the **Calendar** group. **Time Session History** appears under **Time Tracking**.

A disabled action's column disappears without deleting its surface selections. Surface rows remain present. If every action is off, the section asks you to enable an action instead of showing an empty table.

Settings search treats the matrix as one result, reachable by either **Action Visibility by Surface** or **Contextual Menu Matrix**. Each menu action has its own result targeting that action's row; there are no separate results for individual matrix cells.

Tune this once to keep the menu short and relevant to how you work.

> **MEDIA-DOCS-042-2:** The Context Menu settings, enabling actions and setting their order.

![MEDIA-DOCS-042-2 - Context Menu settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-042-2.png)

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-004 Operon system map|Operon system map]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-140 Upcoming Tasks|Upcoming Tasks]]
- [[DOCS-099 State Icons|State Icons]]
