---
Notes: Set board-wide fallback sorting and per-column Kanban order
Icon: list-ordered
Color: "#0284c7"
Updated: 2026-10-29T18:22:34+01:00
---

# Kanban manual order

Inside a [[DOCS-030 Kanban overview|Kanban]] cell, cards can follow automatic rules or an order you set by hand. Every preset has a permanent **Board sorting** fallback, and selected status columns can have their own **Pipeline column sorting** override. This lets one board mix automatic columns with hand-arranged columns.

## Board sorting and column overrides

**Board sorting** supplies the mode and rules for every column that has no override. When the column property is **Status**, use **Pipeline column sorting** to choose a pipeline status and add an override for that column. These overrides do not apply to other column properties or to Status used only in rows; changing the axis does not delete the saved overrides. A new override starts as an independent copy of the current Board sorting; changing it does not change the fallback or another column. A status can be added only once, and removing its override immediately returns that column to Board sorting.

At either level, the order mode is:

- **Automatic**: Operon sorts the cards by rules you define, such as priority then due date. The order updates itself as tasks change.
- **Manual**: cards follow the saved order for that cell. A cell you have not arranged yet uses its effective sorting rules. Tasks not in a saved order appear after the saved cards, ordered by those rules.

Automatic rules can use task fields such as priority, dates, text, or **Project Serial**. Each column resolves its own effective mode and rules, so an Automatic source column and a Manual target column behave independently during a drag.

## Setting a manual order

With Manual mode effective for a column, drag a card up or down within a cell. Operon saves that cell's order. Switching to Manual alone does not create saved orders for every cell; cells you have not arranged continue to follow the sorting rules.

Moving to another cell applies its column and row property values. A Manual target keeps the insertion position you chose; an Automatic target re-sorts by its rules. With list properties, the source card can remain because the move adds membership. Its source order is retained while it still belongs there. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

Order belongs to the preset and the particular column-and-row intersection. It is not shared by every visible copy of a task. Changing axes does not apply one property's saved cell order to an unrelated property.

## When to use which

- **Automatic** suits boards where a rule already captures what matters, like priority or deadline. See [[DOCS-038 Task priorities|Task priorities]].
- **Manual** suits boards where the order is a judgment call: a plan of attack, a publishing sequence, a triage line.

You can mix both across different boards and across columns of the same board: automatic where a field decides and manual where you do.

## FAQ

**Does manual order survive reloads?** Yes. The order you set by dragging is kept with the board.

**Does reordering change task properties?** Reordering within the same cell does not. Moving between cells changes their axis properties; Status changes only when a target Status differs.

**Can one column be Manual while another is Automatic?** Yes, when columns use Status. Add a Pipeline column sorting override for the column that should differ. Columns without an override continue to use Board sorting.

## Settings

Operon settings for this live in **Settings → Operon → Views → Kanban** and in the Kanban preset's quick settings. **Board sorting** defines the fallback. **Pipeline column sorting** adds, edits, or removes overrides for individual pipeline statuses.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-025 Filter View|Filter View]]
- [[DOCS-153 Kanban presets|Kanban presets]]
