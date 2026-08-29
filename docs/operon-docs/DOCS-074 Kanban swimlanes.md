---
Notes: Split the Kanban into horizontal lanes by a second field
Icon: rows-3
Color: "#0284c7"
Updated: 2026-08-29T17:11:29
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

Sorting is resolved per status column and then applied independently inside each swimlane cell. A Pipeline column sorting override wins for that column; otherwise the cell uses Board sorting. Manual order is therefore kept separately for each status-and-lane intersection rather than as one list for the whole board. See [[DOCS-031 Kanban manual order|Kanban manual order]].

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

## List-valued swimlanes and card moves

Tags, Contexts, Assignees, and a custom key configured as a **List** can hold more than one value. A task therefore appears once in every lane named by its current list values. These are visible copies of one task, not separate tasks.

- **Move across status columns in the same lane:** only the task status changes. Every visible copy moves to the matching status column because all copies share that one status.
- **Move vertically from one list lane to another:** Operon removes the source lane value, adds the target lane value, and preserves all unrelated list values. For example, moving `1a → 1b` replaces `1a` with `1b`; it does not keep both merely because the task was dragged from a multi-value field.
- **Move from No value to a named lane:** the target value becomes the task's first value for that list field.
- **Move to No value:** the source value is removed. The task appears in No value only when no list values remain.

A text-style custom key remains single-valued, so a vertical move replaces its one current value with the target value. Horizontal and vertical moves use the same task write path for inline and file tasks.

## Empty lanes

A swimlane field can produce lanes that hold no cards right now. The preset has a **collapse empty swimlanes** option so those lanes fold away instead of taking up space, which keeps a board grouped by a wide field, like tags, readable. Turn it off when you want every possible lane shown even when empty.

## When swimlanes help

Swimlanes are most useful when you want to see two things at once:

- Status across the columns and **owner** down the lanes, to see each person's pipeline.
- Status across the columns and **priority** down the lanes, to see what is urgent at each stage.
- Status across the columns and a **custom field** down the lanes, to slice the board by whatever you track.

When you only care about status, leave the swimlane field empty and the board stays a simple set of columns.

## FAQ

**Do swimlanes change a task's data?** Merely showing or grouping lanes does not. Dragging a card into a different lane does change the grouped field, just as moving it to another column changes status. One drag can change both.

**Can two boards group differently?** Yes. The swimlane field is saved per preset, so each board can group by its own field.

**My board has lots of empty lanes.** Turn on collapse empty swimlanes in the preset so unused lanes fold away.

**Why does one task appear in several swimlanes?** Its selected swimlane field is list-valued and contains several values. A horizontal move changes the shared status for every copy; a vertical move replaces only the source lane value with the destination value and keeps the other list values.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-040 Custom keys|Custom keys]]
