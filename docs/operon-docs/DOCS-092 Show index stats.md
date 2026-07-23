---
Notes: Command that shows a quick notice of Operon task index counts
Icon: database
Color: "#475569"
Updated: 2026-07-23T16:45:34
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
