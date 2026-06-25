---
Up:
  - "[[DOCS-022 Command palette reference|Command palette reference]]"
  - "[[DOCS-045 Markdown task storage|Markdown task storage]]"
  - "[[DOCS-055 Duplicate IDs|Duplicate IDs]]"
Notes: When a task is not showing in Operon's views, and how to fix it
Icon: search-x
Color: "#dc2626"
tags:
  - operon
  - troubleshoot
  - search
  - index
Updated: 2026-06-25T16:47:21
---

# Missing tasks

A task you expected is not in your filter, Calendar, or Kanban. The good news is that your task is almost certainly safe: tasks live in your Markdown, and the views are built from an index of them. "Missing" usually means the index or the view, not the task. Work through these in order.

## Is it indexed?

Operon shows tasks from an index built from your notes. If the index is out of date, a real task can be absent from views. Run **Show index stats** to see the totals Operon currently knows about, and if they look wrong, run **Rebuild full index** to re-scan the vault. This is the first thing to try, and it fixes most cases, especially after editing files outside Obsidian. See [[DOCS-045 Markdown task storage|Markdown task storage]].

## Is the note in an excluded folder?

Operon can be told to ignore folders. Tasks in an **excluded folder** stay outside the index and every view on purpose, so a task there will not appear. If a task is missing, check whether its note sits in an excluded folder, and remove that folder from the exclusions if it should be indexed.

## Is it actually a task?

Operon only shows lines it recognizes as tasks. A line that lost its `operonId`, or a checkbox that was never converted, is not an Operon task and will not appear. Open the line and convert or recreate it as a proper task. See [[DOCS-011 Inline tasks|Inline tasks]].

## Is it just filtered out?

A task can be indexed and present but hidden by the view you are looking at. A filter that excludes its status or date, or a Kanban board on a different pipeline, will not show it. This is not a missing task; it is a view choice. Widen the filter or check a different view. See [[DOCS-025 Filter View|Filter View]].

## Could it be a duplicate conflict?

If a task shares its `operonId` with another, Operon may block or confuse it until the conflict is resolved. Check for a duplicate alert and open the conflict manager. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].

## FAQ

**Did I lose the task?** Almost never. Tasks are in your notes. Check the note directly; if the text is there, the fix is reindexing or a view change.

**Rebuild did not bring it back. Now what?** Confirm the note is not in an excluded folder, and that the line is a real Operon task with an `operonId`.

**Why would a whole folder of tasks be missing?** That folder is probably excluded from the index.

## Settings

Excluded folders are set in **Settings → Operon → Tasks → File Tasks**. Tasks in those folders are intentionally kept out of Operon's index and views.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
