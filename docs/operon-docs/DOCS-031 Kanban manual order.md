---
Notes: Arrange cards by hand within a Kanban column
Icon: list-ordered
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Kanban manual order

Inside a [[DOCS-030 Kanban overview|Kanban]] column, cards can sit in an order you set by hand rather than one Operon computes. Manual order lets you express priority or sequence that no single field captures: the next three things to do, in the order you will do them. It is a per-board choice, so some boards can sort automatically while others stay hand-arranged.

## Two order modes

A board orders the cards in each column one of two ways:

- **Automatic**: Operon sorts the cards by rules you define, such as priority then due date. The order updates itself as tasks change.
- **Manual**: cards keep the exact order you set by dragging them inside a column. Operon does not re-sort them.

You pick the mode per board, as part of its Kanban preset. See [[DOCS-030 Kanban overview|Kanban overview]].

## Setting a manual order

With manual order on, drag a card up or down within its column to place it. The position you give it sticks, so the column reads top to bottom as the sequence you intend. Moving a card to another column still changes its `status`, as always; manual order is about position within a column, not which column it is in. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

## When to use which

- **Automatic** suits boards where a rule already captures what matters, like priority or deadline. See [[DOCS-038 Task priorities|Task priorities]].
- **Manual** suits boards where the order is a judgment call: a plan of attack, a publishing sequence, a triage line.

Many people mix both across different boards, automatic where a field decides and manual where they do.

## FAQ

**Does manual order survive reloads?** Yes. The order you set by dragging is kept with the board.

**Does dragging a card change its status?** Only when you move it to another column. Reordering within the same column keeps the status and just changes position.

**Can one board be manual and another automatic?** Yes. Order mode is set per board through its Kanban preset.

## Settings

Operon settings for this live in **Settings → Operon → Views → Kanban**, where each board's preset sets the order mode (Automatic or Manual) and, for automatic boards, the sort rules.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-025 Filter View|Filter View]]
