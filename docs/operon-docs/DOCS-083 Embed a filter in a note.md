---
Notes: Render a saved filter's live task list inside any note
Icon: panel-top
Color: "#0284c7"
Updated: 2026-11-18T16:38:41+03:00
---

# Embed a filter in a note

The [[DOCS-025 Filter View|Filter View]] is a surface you open. Sometimes you want the list inside a note instead, so a project note shows its own tasks. Operon does this with a small code block that points to a saved filter by its id, and replaces the block with a live task list.

## The code block

Embed a filter with an `operon` code block that references a saved filter by its id:

````md
```operon
filterId: "fs_2pv2ls9"
```
````

Operon replaces the block with the filter's results, rendered with the same task bars and the same evaluator as the Filter View, so the embedded list stays live as your tasks change. Use **Copy embed code** to get the saved filter's ID.

## The easy way: Copy embed code

You do not have to find the id yourself. Open the filter you want, use **Copy embed code**, and Operon puts the right block, with the correct `filterId`, on your clipboard. Paste it into any note and the list appears. This is the reliable path, and the one to use.

## What you can embed

Build a saved filter once with the conditions you want (see [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]), then embed it wherever the list belongs. Saved filters are managed in **Settings → Operon → Views → Filters**.

A common use is a **project note that owns its tasks**: give the project a filter that matches its task tree, embed it at the bottom of the note, and the note becomes both the context and a live view of the work it holds.

You can embed a **table** the same way, with its own Copy embed code, when you want the tasks as rows and columns rather than a list. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

Task descriptions in an embedded filter follow the same [[DOCS-025 Filter View#Acting from the view|desktop opening rules as Filter View]]. You can open the editor over the note or use Cmd/Ctrl-click for a source tab.

## Filter by the note's date

Reuse one saved filter across daily notes to show the tasks completed on each note's date. Copy the ID from your own filter to replace the sample `filterId` below. Set `dateCompleted` to the date of the note.

````md
```operon
filterId: "fs_2pv2ls9"
dateCompleted: 2026-11-11
```
````

Use the canonical `YYYY-MM-DD` format for an exact day match. You can write the date by itself or enclose it in matching quotes. Use a date key once per block. An invalid date or repeated key shows an error in that block.

| Key | Task date |
| --- | --- |
| `dateStarted` | Start date |
| `dateScheduled` | Scheduled date |
| `dateDue` | Due date |
| `dateCompleted` | Completion date |
| `dateCancelled` | Cancellation date |
| `repeatOccurrenceDate` | Recorded recurrence date used by **Repeat reference date** and **Task Occurrence Date** |

For each date line, Operon removes the saved conditions for that field from the block's copy of the filter, including conditions inside nested groups, then adds one required exact-date match. Groups emptied by that removal are dropped. The remaining conditions keep their **All**, **Any**, or **None** rules. Multiple date lines must all match.

For example, if the saved filter matches **Scheduled is today OR Priority A**, adding `dateScheduled: 2026-11-11` shows **tasks scheduled for November 11 with Priority A**. Relative date conditions on other fields still use the current day.

The saved filter stays intact. You can use the same `filterId` with a different date in another block. Remove the date line to use the saved filter's original conditions for that field again.

## FAQ

**How do I get the right `filterId`?** Use **Copy embed code** on the filter to insert its ID into the block.

**Does the embedded list update?** Yes. It uses the same live evaluation as the Filter View, so it reflects your tasks as they change.

**Where do I manage the filters I embed?** In Settings, under Views then Filters, the same saved filters the Filter View uses.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-010 Build your first filtered view|Build your first filtered view]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
