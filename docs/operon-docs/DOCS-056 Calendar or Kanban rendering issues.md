---
Notes: When a task looks wrong on the Calendar or Kanban, and why
Icon: bug
Color: "#dc2626"
Updated: 2026-07-23T16:45:34
---

# Calendar or Kanban rendering issues

A task is in your vault but looks wrong in a view: missing from the Calendar, in the wrong Kanban column, or not updating. These views are built from your tasks and your settings, so a rendering problem is usually a data or setting mismatch, not a bug to wait out. Here is what to check for each.

## A task is missing from the Calendar

The Calendar places a task by its dates. A task with no date has nowhere to go, so it does not appear. Give it a `dateScheduled`, a `dateDue`, or a timed block (`datetimeStart` and `datetimeEnd`) and it shows up. If you expected a recurring task's future runs, check that the preset has **Show future occurrences** on. See [[DOCS-028 Calendar overview|Calendar overview]] and [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]].

## A card is in the wrong Kanban column, or missing

A Kanban column is a status in the board's pipeline, and a card sits in the column matching its `status`. Two mismatches cause trouble:

- **The status does not match any column.** If a task's `status` is not one of the pipeline's statuses (for example after renaming a status), its card has no column to sit in. Align the task's status with the pipeline. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].
- **The board filters it out.** A Kanban preset can filter which tasks it shows, and can use a different pipeline. A card you expect may be on a different board. See [[DOCS-030 Kanban overview|Kanban overview]].

## A view is not updating

If a change is not reflected, the display is likely stale rather than wrong:

- **Reindex.** Run **Rebuild full index** so the views are built from the current notes, especially after editing files outside Obsidian. See [[DOCS-054 Missing tasks|Missing tasks]].
- **Reload settings.** If a settings change is not showing, run **Reload Operon settings from storage**.
- **Reopen the view.** Closing and reopening the Calendar or Kanban leaf, or reloading Obsidian, clears a stale render.

## A note renders differently in Reading view and Live Preview

Some Operon elements are drawn in editing surfaces and look different in Reading view. If something appears only in one mode, that is expected; switch modes to confirm the task data is fine even when the display differs.

## FAQ

**My task will not show on the Calendar.** It has no date. Add a scheduled date, due date, or timed block.

**My card disappeared after I renamed a status.** Its `status` no longer matches a column. Update the task to the new status, or keep status names stable.

**The view looks stale.** Rebuild the index, reload settings, or reopen the view.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
