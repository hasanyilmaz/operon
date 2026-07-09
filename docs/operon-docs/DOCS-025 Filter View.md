---
Up:
  - "[[DOCS-010 Build your first filtered view|Build your first filtered view]]"
  - "[[DOCS-042 Contextual menu actions|Contextual menu actions]]"
  - "[[DOCS-017 Plain checkbox lists|Plain checkbox lists]]"
Notes: Query tasks with saved, condition-based views
Icon: list-filter
Color: "#0284c7"
tags:
  - operon
  - filterview
  - plan
  - search
Updated: 2026-07-08T23:32:00
---

# Filter View

The Filter View is your everyday surface for answering "what should I work on?" A filter is a saved query over your task fields, and the Filter View shows the tasks that match it, drawn from across the whole vault. [[DOCS-011 Inline tasks|Inline tasks]] and [[DOCS-013 File tasks|file tasks]] appear together in the same list, because a filter matches on fields, not on a task's shape. It never creates a second copy of a task; it reveals the ones that fit.

Open it with **Operon Filter View** from the command palette.

> **MEDIA-DOCS-025-1:** The Filter View showing a filtered list of tasks.

![MEDIA-DOCS-025-1 - The Filter View showing a filtered list of tasks](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-025-1.png)

## Filters and views

Two ideas work together:

- A **filter** is a set of conditions over task fields such as status, priority, scheduled date, due date, parent task, contexts, and tags.
- The **Filter View** is the surface that displays a filter's results, with options for how the list is grouped, sorted, and shown.

A filter prevents one large task index from turning into noise. It is the difference between "every task in the vault" and "the few that matter right now."

## Build and save

Add conditions one at a time and watch the list narrow as each applies. When the result is useful, save it so you can return without rebuilding. Saved filters live with Operon's data in the plugin folder and become reusable views. Name each one for its purpose, such as "This week" or "High priority open." For a step-by-step first filter, see [[DOCS-010 Build your first filtered view|Build your first filtered view]].

## Useful filters to keep

- Open tasks scheduled this week.
- High-priority open tasks.
- Everything under one project or parent task.
- Tasks in a specific folder.

Each is a different slice of the same records. Keep a handful of well-named filters rather than one giant query.

## One filter, many views

A saved filter is not tied to the Filter View. The same filter can scope a [[DOCS-028 Calendar overview|Calendar]], a [[DOCS-030 Kanban overview|Kanban]], or a [[DOCS-105 Table overview|Table]], so one slice of tasks can be read as a list, placed on dates, arranged as cards, or laid out as rows and columns. Each view's preset picks a filter, and the related views control lets you jump between the views that share one, or spin up a new Calendar, Kanban, or Table preset that inherits both the filter and its name. See [[DOCS-105 Table overview|Table overview]].

## Acting from the view

A filter row is not read-only. You can open a task's [[DOCS-042 Contextual menu actions|contextual menu]] to edit it, change status, start a timer, pin it, or open the [[DOCS-021 Task Editor|Task Editor]]. Filter rows can also show the **Open checkboxes** chip and checklist progress for a task's [[DOCS-017 Plain checkbox lists|plain checkboxes]].

> **MEDIA-DOCS-025-2:** A filter row with its date picker open and the checkbox-progress chip visible.

![MEDIA-DOCS-025-2 - A filter row with its date picker open and the checkbox-progress chip visible](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-025-2.png)

## FAQ

**Do filters change my tasks?** No. A filter only chooses which tasks are shown. It never edits or moves them.

**How many filters should I keep?** As many as map to real moments in your work. Several focused filters beat one complicated one.

## Settings

Operon settings for this live in **Settings → Operon → Views → Filters**, which configures Filter View behavior, including whether subtasks are shown.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]
- [[DOCS-027 Task Finder|Task Finder]]
- [[DOCS-028 Calendar overview|Calendar overview]]
- [[DOCS-105 Table overview|Table overview]]
