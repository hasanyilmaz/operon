---
Notes: Convert Obsidian Tasks emoji lines into Operon inline tasks, with a before and after example
Icon: move-right
Color: "#2563eb"
Updated: 2026-07-23T16:45:34
---

# Obsidian Tasks migration

If you have used the Obsidian Tasks plugin, your task lines carry metadata as emoji, like a due date marked with a calendar emoji. Operon can convert those lines into its own inline tasks, one at a time, so you can move across without rewriting your notes by hand. You do not need a migration weekend; convert lines as you meet them.

> **MEDIA-DOCS-049-1:** A Tasks emoji line and the Operon inline task it becomes after conversion.

![MEDIA-DOCS-049-1 - A Tasks emoji line and the Operon inline task it becomes after conversion](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-049-1.png)

## Convert a line

Put your cursor on an Obsidian Tasks emoji line and run **Convert Tasks emoji line to inline task** from the command palette. Operon reads the emoji metadata, maps it to the matching Operon fields, and rewrites the line as an Operon inline task with an `operonId`. See [[DOCS-012 Inline task syntax|Inline task syntax]] for what the result looks like.

A Tasks emoji line, with a scheduled date and a due date:

```md
- [ ] Draft release notes ⏳ 2026-05-20 📅 2026-05-31
```

becomes an Operon inline task, the same metadata moved into `{{key:: value}}` fields:

```md
- [ ] Draft release notes {{operonId:: {{operonId}}}} {{dateScheduled:: 2026-05-20}} {{dateDue:: 2026-05-31}}
```

The `operonId` is a real id Operon generates during the conversion; it is shown here as the `{{operonId}}` template variable. The same mapping applies to the other Tasks markers: 🛫 becomes `dateStarted`, ✅ `dateCompleted`, ❌ `dateCancelled`, the priority emoji (🔺 ⏫ 🔼 🔽 ⏬) becomes a `priority` on your scale, and the recurrence emoji (🔁) becomes a `repeat` rule. See [[DOCS-038 Task priorities|Task priorities]] and [[DOCS-033 Recurring tasks|Recurring tasks]].

## Convert from the hover icon

So you do not have to remember the command, Operon can show a small convert icon on hover over a Tasks emoji line. With it on, hovering a convertible line offers a one-click conversion in Live Preview. This makes migrating a note as simple as reading through it and clicking the lines you want to bring over.

> **MEDIA-DOCS-049-2:** The convert icon appearing on hover over a Tasks emoji line in Live Preview.

![MEDIA-DOCS-049-2 - The convert icon appearing on hover over a Tasks emoji line in Live Preview](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-049-2.png)

## What converts, and what does not

- **A clean Tasks emoji line converts.** Its emoji fields become Operon fields, and the line becomes an inline task.
- **A mixed line does not.** A line that already combines Operon inline fields with Tasks emoji metadata is not converted, because the two formats should not be merged on one line. Untangle it first.
- **A non-Tasks line is left alone.** Only supported Tasks emoji lines convert.

## After converting

The line is now a full Operon inline task. From here it behaves like any other: it appears in filters, the Calendar, and the Kanban, and you can open it in the [[DOCS-021 Task Editor|Task Editor]]. To bring several plain list lines across at once instead, see [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

## FAQ

**Do I have to convert everything at once?** No. Conversion is line by line, on demand. Move tasks over as you touch them.

**What if a line mixes both formats?** Operon will not convert a hybrid line. Separate the Operon fields from the Tasks emoji first.

**Where is the hover icon?** It appears in Live Preview when the setting is on. It is a quick alternative to the command.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Inline Tasks**, where you can turn on the icon that appears on convertible Tasks emoji lines in Live Preview.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
