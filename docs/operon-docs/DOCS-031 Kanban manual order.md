---
Notes: Set board-wide fallback sorting and per-column Kanban order
Icon: list-ordered
Color: "#0284c7"
Updated: 2026-08-23T10:58:57
---

# Kanban manual order

Inside a [[DOCS-030 Kanban overview|Kanban]] column, cards can follow automatic rules or an order you set by hand. Every preset has a permanent **Board sorting** fallback, and selected status columns can have their own **Pipeline column sorting** override. This lets one board mix automatic columns with hand-arranged columns.

## Board sorting and column overrides

**Board sorting** supplies the mode and rules for every column that has no override. Under **Pipeline column sorting**, choose a pipeline status and add an override for that column. A new override starts as an independent copy of the current Board sorting; changing it does not change the fallback or another column. A status can be added only once, and removing its override immediately returns that column to Board sorting.

At either level, the order mode is:

- **Automatic**: Operon sorts the cards by rules you define, such as priority then due date. The order updates itself as tasks change.
- **Manual**: cards keep the exact order you set by dragging them inside a column. Operon does not re-sort them.

Automatic rules can use task fields such as priority, dates, text, or **Project Serial**. Each column resolves its own effective mode and rules, so an Automatic source column and a Manual target column behave independently during a drag.

## Setting a manual order

With Manual mode effective for a column, drag a card up or down to place it. The position you give it sticks, so the column reads top to bottom as the sequence you intend. When a column first becomes Manual, Operon uses its current visible order as the starting order.

Moving a card to another column still changes its `status`, as always. A Manual target keeps the insertion position you chose; an Automatic target re-sorts the card by that column's rules. When swimlanes are active, manual order is kept separately for each preset, status column, and swimlane cell. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]] and [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

## When to use which

- **Automatic** suits boards where a rule already captures what matters, like priority or deadline. See [[DOCS-038 Task priorities|Task priorities]].
- **Manual** suits boards where the order is a judgment call: a plan of attack, a publishing sequence, a triage line.

You can mix both across different boards and across columns of the same board: automatic where a field decides and manual where you do.

## FAQ

**Does manual order survive reloads?** Yes. The order you set by dragging is kept with the board.

**Does dragging a card change its status?** Only when you move it to another column. Reordering within the same column keeps the status and just changes position.

**Can one column be Manual while another is Automatic?** Yes. Add a Pipeline column sorting override for the column that should differ. Columns without an override continue to use Board sorting.

## Settings

Operon settings for this live in **Settings → Operon → Views → Kanban** and in the Kanban preset's quick settings. **Board sorting** defines the fallback. **Pipeline column sorting** adds, edits, or removes overrides for individual pipeline statuses.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-025 Filter View|Filter View]]
