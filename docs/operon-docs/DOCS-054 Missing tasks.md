---
Notes: When a task is not showing in Operon's views, and how to fix it
Icon: search-x
Color: "#dc2626"
Updated: 2026-10-29T18:48:06+01:00
---

# Missing tasks

A task you expected is not in your filter, Calendar, or Kanban. The good news is that your task is almost certainly safe: tasks live in your Markdown, and the views are built from an index of them. "Missing" usually means the index or the view, not the task. Work through these in order.

## Is it indexed?

Operon shows tasks from an index built from your notes. Run **Show index stats** to inspect the current totals, and check the source note, exclusions, filters, and identity conflicts below. If the index remains stale after normal refresh, use [[DOCS-091 Rebuild full index|Rebuild full index]]. External edits normally enter the same update flow; they do not always require a manual rebuild.

## Did you just update Operon?

The new persistent layout includes Vault Properties with the other task fields. Its first startup builds a cache automatically when none exists, so rows may take longer to appear once. A normal update does not require manual reindexing. Later startups reuse a valid cache; repeated long waits are worth investigating rather than assuming every restart must rebuild.

Headers appearing before rows, or a loading state in a native-property table, do not by themselves identify the cause. Check index readiness and **Index diagnostics**. Invalid or unsupported persistent data can need guarded repair instead of an ordinary rebuild. See [[DOCS-046 Plugin data and state files|Plugin data and state files]].

## Is the note in an excluded folder?

Operon can be told to ignore folders. Tasks in an **excluded folder** stay outside the index and every view on purpose, so a task there will not appear. If a task is missing, check whether its note sits in an excluded folder, and remove that folder from the exclusions if it should be indexed.

## Is it actually a task?

Operon only shows lines it recognizes as tasks. A line that lost its `operonId`, or a checkbox that was never converted, is not an Operon task and will not appear. Open the line and convert or recreate it as a proper task. See [[DOCS-011 Inline tasks|Inline tasks]].

## Is it just filtered out?

A task can be indexed and present but hidden by the view you are looking at. A filter that excludes its status or date, or a Kanban axis whose selected values do not match it, will not show it. A Status axis also limits matches to its chosen pipeline. This is not a missing task; it is a view choice. Widen the filter or review the axis selections. See [[DOCS-025 Filter View|Filter View]] and [[DOCS-153 Kanban presets|Kanban presets]].

## Could it be a duplicate conflict?

If a task shares its `operonId` with another, Operon may block or confuse it until the conflict is resolved. Check for a duplicate alert and open the conflict manager. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].

## FAQ

**Did I lose the task?** Almost never. Tasks are in your notes. Check the note directly; if the text is there, investigate recognition, filters, exclusions, identity, and index readiness before changing it.

**Rebuild did not bring it back. Now what?** Confirm the note is not in an excluded folder, and that the line is a real Operon task with an `operonId`.

**Why would a whole folder of tasks be missing?** That folder is probably excluded from the index.

## Settings

Excluded folders are set in **Settings → Operon → Tasks → File Tasks**. Tasks in those folders are intentionally kept out of Operon's index and views.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
