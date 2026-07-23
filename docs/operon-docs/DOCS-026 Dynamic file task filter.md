---
Notes: A file task's subtask tree, embedded automatically in its own note
Icon: file-search
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Dynamic file task filter

The Dynamic File Task Filter gives a file task a live view of its own subtasks, right inside its note. Open a YAML file task and Operon embeds a filtered list of that task's children in the body, locked to the file's `operonId`. You never build or configure the filter: it follows whichever file task you are reading. It is the always-on way to keep a file task's work breakdown visible where the work lives.

> **MEDIA-DOCS-026-1:** A file task note with its subtask list embedded automatically at the bottom of the body.

<iframe
  title="MEDIA-DOCS-026-1 - Dynamic file task filter video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/Jf8bItQUaUM"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## Where it appears

The filter renders inside the file task's note in both Reading View and Live Preview. It does not show up in plain notes or inline tasks, only in YAML file tasks, because it keys off the note's own `operonId`. You can place it at the **top** or the **bottom** of the file body, whichever suits how you read your tasks.

## The locked condition

The filter has a single condition that you cannot edit: its `operonId` is the current file task's `operonId`. That is what makes it dynamic. The same embedded filter shows different subtasks in every file task, because each note resolves the condition to itself. There is nothing to maintain as your tasks change; the list always reflects the current children.

> **MEDIA-DOCS-026-2:** The locked condition chip showing the current file's operonId, which cannot be edited.

![MEDIA-DOCS-026-2 - The locked condition chip showing the current file's operonId, which cannot be edited](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-026-2.png)

## How it compares to the Dynamic Subtasks Filter

This filter and the [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]] are siblings. Both are operonId-locked subtask filters that Operon builds for you, but they live on different surfaces.

| | Dynamic File Task Filter | [[DOCS-059 Dynamic Subtasks Filter\|Dynamic Subtasks Filter]] |
|---|---|---|
| Where it appears | Embedded in a file task's note body | A pop-up window |
| How it opens | Automatically, in Reading View and Live Preview | On demand, from the Subtasks action |
| Works on | File tasks only | Any open task with subtasks, inline or file |
| Settings | Enabled, placement, auto-expand, show only open | Auto-expand, show only open |

Use this filter when a file task should always carry its subtask tree inside its own note. Use the Dynamic Subtasks Filter for a quick look at any branch from anywhere.

## FAQ

**Why don't I see it on an inline task?** It is for YAML file tasks only. It anchors to the note's `operonId`, which an inline task does not have at the file level. For an inline task's subtree, use the [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]].

**Can I edit its condition?** No. The condition is the current file's `operonId` and is locked, which is what keeps it dynamic.

**Can I move it to the top of the note?** Yes. Placement is a setting, top or bottom of the file body.

## Settings

Operon settings for this live in **Settings → Operon → Views → Filters**, under the Dynamic File Task Filter: turn it on or off, choose top or bottom placement, set the auto-expand limit for the subtask tree, and show only open subtasks.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
