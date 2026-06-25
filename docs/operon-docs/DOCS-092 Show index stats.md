---
Up:
  - "[[DOCS-022 Command palette reference|Command palette reference]]"
  - "[[DOCS-091 Rebuild full index|Rebuild full index]]"
  - "[[DOCS-046 Plugin data and state files|Plugin data and state files]]"
Notes: Command that shows a quick notice of Operon task index counts
Icon: database
Color: "#475569"
tags:
  - operon
  - commands
  - index
  - stats
Updated: 2026-06-25T16:47:21
---

# Show index stats

**Show index stats** pops a quick notice with a few counts from the Operon task index. It is a fast way to see what the index currently holds, with no view to open. Run it from anywhere.

## What it shows

The notice reports four numbers:

| Count | Meaning |
|---|---|
| Total | Every task Operon has indexed across the vault |
| Open | Tasks that are still open, not done or cancelled |
| Due today | Tasks with a due date of today |
| Overdue | Tasks whose due date has already passed |

The numbers come straight from the current index, so they reflect your notes as they were last indexed.

## When to use it

Use it as a quick health check. After a [[DOCS-091 Rebuild full index|rebuild]], the total tells you the index picked up the tasks you expected. The open, due-today, and overdue counts give a one-glance sense of your workload without opening a [[DOCS-025 Filter View|Filter View]] or [[DOCS-028 Calendar overview|Calendar]]. If the total looks far off from what you have, [[DOCS-091 Rebuild full index|Rebuild full index]] and check again.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-054 Missing tasks|Missing tasks]]
