---
Up:
  - "[[DOCS-030 Kanban overview|Kanban overview]]"
  - "[[DOCS-031 Kanban manual order|Kanban manual order]]"
  - "[[DOCS-037 Pipelines and statuses|Pipelines and statuses]]"
Notes: Split the Kanban into horizontal lanes by a second field
Icon: rows-3
Color: "#0284c7"
tags:
  - operon
  - kanban
  - plan
  - swimlanes
Updated: 2026-06-25T16:47:21
---

# Kanban swimlanes

The [[DOCS-030 Kanban overview|Kanban]] groups tasks into columns by status. **Swimlanes** add a second dimension: horizontal lanes that split the same board by another field. So columns still answer *how far along*, while lanes answer *which group*, and every card sits at the intersection of the two. It turns one board into a small grid without leaving the Kanban.

> **MEDIA-DOCS-074-1:** A Kanban with status columns across the top and priority swimlanes down the side.

![MEDIA-DOCS-074-1 - A Kanban with status columns across the top and priority swimlanes down the side](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-074-1.png)

## Columns and lanes

Keep the two axes separate in your head:

- **Columns** come from the board's pipeline, one column per status. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].
- **Swimlanes** come from a field you choose, one lane per value of that field.

A card lands in the column for its status and the lane for its swimlane value, so "high priority, in progress" is one cell of the grid. Moving a card between columns changes its status as usual; the lane reflects the swimlane field.

## Choosing the swimlane field

Swimlanes are set per Kanban preset, in the preset's quick settings, through a **Swimlane field** dropdown. Pick one of the built-in fields, or any custom field, or leave it empty for no swimlanes.

| Swimlane field | Lanes become |
|---|---|
| Priority | One lane per priority (the default) |
| Tags | One lane per tag |
| Contexts | One lane per context |
| Assignees | One lane per assignee |
| Due date | Lanes by due date |
| Scheduled date | Lanes by scheduled date |
| A custom field | One lane per value of that key |

Because the setting lives on the preset, you can keep one saved board grouped by priority and another grouped by assignee, and switch between them. See [[DOCS-031 Kanban manual order|Kanban manual order]] for how presets hold board settings.

> **MEDIA-DOCS-074-2:** The Swimlane field dropdown in a Kanban preset's quick settings.

![MEDIA-DOCS-074-2 - The Swimlane field dropdown in a Kanban preset's quick settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-074-2.png)

## Empty lanes

A swimlane field can produce lanes that hold no cards right now. The preset has a **collapse empty swimlanes** option so those lanes fold away instead of taking up space, which keeps a board grouped by a wide field, like tags, readable. Turn it off when you want every possible lane shown even when empty.

## When swimlanes help

Swimlanes are most useful when you want to see two things at once:

- Status across the columns and **owner** down the lanes, to see each person's pipeline.
- Status across the columns and **priority** down the lanes, to see what is urgent at each stage.
- Status across the columns and a **custom field** down the lanes, to slice the board by whatever you track.

When you only care about status, leave the swimlane field empty and the board stays a simple set of columns.

## FAQ

**Do swimlanes change a task's data?** No. Lanes are a grouping of the same cards by a field. Moving a card between columns still changes status; the lane just reflects the swimlane field's value.

**Can two boards group differently?** Yes. The swimlane field is saved per preset, so each board can group by its own field.

**My board has lots of empty lanes.** Turn on collapse empty swimlanes in the preset so unused lanes fold away.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-040 Custom keys|Custom keys]]
