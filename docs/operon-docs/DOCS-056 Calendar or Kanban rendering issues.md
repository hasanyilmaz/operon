---
Notes: When a task looks wrong on the Calendar or Kanban, and why
Icon: bug
Color: "#dc2626"
Updated: 2026-10-29T18:22:34+01:00
---

# Calendar or Kanban rendering issues

A task is in your vault but looks wrong in a view: missing from the Calendar, in the wrong Kanban column, or not updating. These views are built from your tasks and settings. Check the data and view configuration first; if they are correct, the problem may be a rendering bug. Here is what to check for each.

## A task is missing from the Calendar

The Calendar places a task by its dates. A task with no date has nowhere to go, so it does not appear. Give it a `dateScheduled`, a `dateDue`, or a timed block (`datetimeStart` and `datetimeEnd`) and it shows up. If you expected a recurring task's future runs, check that the preset has **Show future occurrences** on. See [[DOCS-028 Calendar overview|Calendar overview]] and [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]].

## A card is in the wrong Kanban cell, or missing

Check the preset's **Kanban filter**, **Column selection**, and **Swimlane selection**, then check any toolbar search or temporary scopes. A task must pass the filter and match at least one selected value on each active axis. **Scoped tasks** counts the filtered tasks; **Board tasks** counts those matching the axis selections as well. A smaller Board tasks count can therefore be expected.

For a Status axis, the task must match the chosen pipeline's statuses. Other property axes use their own values; they do not inherit a hidden pipeline restriction. An explicitly selected subset can hide tasks that would be visible with all values. See [[DOCS-153 Kanban presets|Kanban presets]].

**No value** means the property is genuinely empty. A number of `0` or a checkbox value of `false` is not empty. A field still being indexed or failing to read is also not No value.

### Incomplete totals or unavailable configuration

An **Incomplete totals** notice means some potentially matching tasks could not be grouped. Read its details and allow pending property data to finish loading; unreadable tasks are excluded from the displayed totals until they can be resolved. This is different from tasks deliberately excluded by the filter or axis selections.

An unavailable configuration can mean a missing pipeline, deleted property, changed property type, or unsupported saved configuration. Open the preset and inspect the indicated field. Saved settings are preserved rather than silently replaced. Do not recreate the preset merely to hide the warning.

If an All-value axis has no values in scope, it cannot generate headings. Review the filter or select an existing known value through Add value to keep a planning heading available.

## A Kanban drop is rejected

Kanban may reject a move when the source task changed during the drag, a dependency blocks the attempted status, or the task cannot be written safely. The optimistic card placement is temporary: when the operation is cancelled or fails, Operon settles the card back into the current source cell immediately instead of leaving it in the target until a later refresh. Closing a blocker message should not cause a second delayed return several seconds later.

If you see **Kanban action failed**, the card has not been confirmed at the target. Check the task’s current column and swimlane properties, resolve duplicate task identities or active blockers, and try the move again. For a custom-list swimlane, also confirm that the selected custom key is still configured as a writable List field. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

Some target cells cannot represent a valid task. The same single-valued property cannot be A and B at once; the same list cannot be empty and contain a member at once. Those intersections can be displayed, but task moves, placement, and creation are blocked. Moving a populated list to No value is also blocked: clear it through its field editor instead.

If a task still appears in its source cell after a successful list move, that is expected. The target member was added and existing members were preserved.

## A card moved, but its parent or ancestor was unavailable

This is an informational success, not a failed drop. The card reached the target cell, but Operon could not update a missing parent task or a higher missing ancestor while reconciling the task tree. The task's existing `parentTask` value is preserved so Operon does not guess at or silently rewrite the relationship.

The notice distinguishes a missing direct parent from a missing higher ancestor. Open the moved task and inspect its parent relationship when you want to repair the broken chain; the card itself does not need to be moved again.

## A view is not updating

If a change is not reflected, the display is likely stale rather than wrong:

- **Reindex.** Run **Rebuild full index** so the views are built from the current notes, especially after editing files outside Obsidian. See [[DOCS-054 Missing tasks|Missing tasks]].
- **Reload settings.** If a settings change is not showing, run **Reload Operon settings from storage**.
- **Reopen the view.** Closing and reopening the Calendar or Kanban leaf, or reloading Obsidian, clears a stale render.

## A note renders differently in Reading view and Live Preview

Inline tasks and embedded filters are intended to render and stay current in both **Reading view** and **Live Preview**. An inline task unexpectedly turning into raw `{{key:: value}}` text, or an embedded filter stopping updates after a refresh, should not be dismissed as a normal difference between those modes.

Check the source and the displayed state separately:

- **Confirm the mode and placement.** Source mode shows Markdown and metadata. Task examples inside ordinary fenced code blocks are also literal text; they are not live inline tasks. A filter embed, by contrast, needs its supported `operon` block syntax.
- **Check identity.** If an action shows **Incompatible task ID**, follow [[DOCS-015 Task identity and operonId|the ID repair flow]]. If multiple tasks share an ID, use [[DOCS-055 Duplicate IDs|the conflict manager]]. Do not change IDs by hand to work around a display problem.
- **Allow the index to become ready.** Then check whether the same task can be found in Task Finder. If the index is stale, use the recovery steps above. For filters, check that the referenced saved filter still exists and matches the task. See [[DOCS-083 Embed a filter in a note|Embed a filter in a note]].
- **If the mismatch persists, capture a small reproduction.** Record the Operon and Obsidian versions, platform, affected mode, and surrounding Markdown, including nearby code fences. Remove private content before sharing it. A screenshot plus the relevant source is more useful than changing the task data until the symptom disappears.

Layout and editing affordances can differ between modes, but disappearing task rendering or stale filter results require investigation. Reopening the note can help identify a stale display; it does not establish that raw task markup was the intended Reading view behavior.

## FAQ

**My task will not show on the Calendar.** It has no date. Add a scheduled date, due date, or timed block.

**My card disappeared after a property or status change.** Check the current task values against both preset axes and their selected values. If the board reports an unavailable field, inspect the preset before changing task data.

**The view looks stale.** Rebuild the index, reload settings, or reopen the view.

**Why did a rejected card move back immediately?** The target placement was optimistic. Operon restored the current persisted position as soon as the drop was cancelled or failed, rather than waiting for a later board refresh.

**Does “parent task could not be updated” mean the card move failed?** No. The card moved successfully. The notice means only that the missing parent or higher ancestor could not receive its normal relationship aggregate update.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
- [[DOCS-074 Kanban swimlanes|Kanban swimlanes]]
