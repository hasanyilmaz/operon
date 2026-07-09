---
Up:
  - "[[DOCS-037 Pipelines and statuses|Pipelines and statuses]]"
  - "[[DOCS-031 Kanban manual order|Kanban manual order]]"
  - "[[DOCS-005 Operon core concepts|Operon core concepts]]"
Notes: Move tasks through status columns on the Kanban
Icon: columns-3
Color: "#0284c7"
tags:
  - operon
  - kanban
  - plan
Updated: 2026-07-08T23:32:00
---

# Kanban overview

The Kanban shows your tasks as cards in columns by status. It is the best surface for seeing what is planned, active, blocked, finished, or dropped, and for moving work through stages. A card can be an [[DOCS-011 Inline tasks|inline task]] or a [[DOCS-013 File tasks|file task]]; both flow through the same columns, so the board is one view of all your work regardless of how each task is written. Where the Calendar plans by *when*, the Kanban plans by *how far along*.

Open it with **Operon Kanban** from the command palette.

> **MEDIA-DOCS-030-1:** The Operon Kanban with task chips visible on cards across status columns.

![MEDIA-DOCS-030-1 - The Operon Kanban with task chips visible on cards across status columns](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-030-1.png)

## How the board is built

The columns come from your pipeline: each status in the pipeline is a column, and a task's `status` decides which column its card sits in. So the board is a live picture of your pipeline, with every task standing in the stage it has reached.

You can also split the board into **swimlanes**, horizontal rows that group cards by another field such as priority, assignee, context, or a date. With swimlanes on, each card sits where its status column meets its lane, which is how you see, say, what is in progress *per person* or *per priority* at a glance. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

A board is shaped by a **Kanban preset**, which chooses the pipeline, the swimlane field, the sort order, the card color source, and an optional filter that limits which tasks appear. Saving presets lets you keep several boards for different pipelines or slices of work, and switch between them. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

## Card chips and actions

Kanban cards can show [[DOCS-041 Task chips display and behavior|Task Chips]] under the title, so priority, dates, assignees, location, links, recurrence, and custom fields can be scanned without opening the card. The **Kanban Task Chips** settings page controls which normal chips appear, their order, and which are Icon Only.

> **MEDIA-DOCS-030-2:** The Kanban Task Chips settings page, showing the card chip list and the Kanban Task Actions section.

![MEDIA-DOCS-030-2 - Kanban Task Chips settings with card chips and action controls](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-030-2.png)

If a task has a Project Serial, the serial appears first as a display-only identity chip on the main card, independent of the normal chip visibility settings. Kanban does not show hidden-chip overflow counts, so the row only shows the card chips you chose to display.

Kanban also has a **Kanban Task Actions** section at the end of the same settings page. Those controls can add compact action chips at the trailing edge of the card chip row, such as Play, Pin, Note, Add subtask, and Open checkboxes. On desktop, enabled action chips are usable from the card. The Play action changes to Stop when that task's timer is already running. On mobile, the same card chip area stays visible but read-only, so card tap, scroll, and drag gestures stay predictable.

Main cards can grow a little when chips wrap onto multiple lines; descendant preview cards stay compact and do not show chip rows.

> **MEDIA-DOCS-030-3:** Kanban cards in action, with task chips, trailing action chips, an active timer shown as Stop, and the active column and swimlane highlighted.

<iframe
  title="MEDIA-DOCS-030-3 - Kanban cards in action video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/9YjQEgOSoWQ"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## Moving a card changes the task

Dragging a card to another column is a real change, not a visual one. The card's `status` updates, and that change is written back to the task's Markdown and reflected everywhere else the task appears. The Kanban is one surface over the same task records, so a move here is a move everywhere. See [[DOCS-005 Operon core concepts|Operon core concepts]].

When the board has **swimlanes**, dragging a card into a different lane edits the field that lane is grouped by, the same way a column move edits status. Drop a card in another priority lane and its priority changes; drop it in another assignee's lane and its assignee changes. A single drag can change both at once, the column for status and the lane for that field. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

## Open a card

Click a card to open it in the [[DOCS-021 Task Editor|Task Editor]]. Hold **Cmd** (macOS) or **Ctrl** (Windows and Linux) and click to open the task's source in a new Obsidian tab instead: the note for a file task, or the exact line for an inline task, the same convention as opening a link in a new browser tab. This works on materialized tasks; a recurring occurrence that has not been created yet has no source line to open.

## When the Kanban fits

Reach for it when work moves through clear stages:

- Content production.
- Editorial work.
- Feature development.
- Bug triage.
- Release planning.

If your work is mostly date-driven rather than stage-driven, the [[DOCS-028 Calendar overview|Calendar]] may suit it better; to compare many fields at once and sort or summarize them, reach for the [[DOCS-105 Table overview|Table]]. Many people use all three.

## Card order

Within a column you can arrange cards in a deliberate order rather than an automatic one, which is useful for expressing priority or sequence by hand. See [[DOCS-031 Kanban manual order|Kanban manual order]].

## Searching the board

The Kanban has a search box that narrows the board to the cards you care about. Type at least two letters and it keeps only the cards whose tasks match, using the **same matching as** [[DOCS-027 Task Finder|Task Finder]]: it looks across each task's words, fields, and the names of its parent, sub-tasks, and related tasks, every typed word has to match, and words match from the start.

### Scopes, the same as Task Finder

The search box is not only a text box. Click into it and the **Task Finder scope buttons appear** beneath it, the same scopes described in [[DOCS-027 Task Finder|Task Finder]]: project scopes, Overdue, Happens Today, and the toggles for including inline tasks, file tasks, and cancelled or finished work. Their dot shortcuts work here too.

The important part: **these scopes filter the board on their own, with or without any text typed.** Turn on Overdue and the board immediately shows only overdue cards; pick a project scope and it narrows to that project, even with the search box empty. Text and scopes also combine, so you can, for example, scope to Happens Today and then type a word to narrow within it.

### It narrows the board, it does not flatten it

However you filter, by text, by scope, or both, the Kanban stays a board. Matching cards remain in their status columns and swimlanes, in their normal order; the non-matching ones simply drop away. You never get a flat list of results: you get the same board showing fewer cards. That keeps the structure you are planning against intact while you focus on a slice of it.

For exactly which fields are matched and how Task Finder ranks its own results, see [[DOCS-027 Task Finder|Task Finder]].

## Tips

> [!tip] Make Kanban your dedicated board
> On the desktop app, Operon hides Obsidian's duplicate native header in the main Kanban workspace, so the columns have more vertical room to breathe. Nothing goes missing. Kanban's own toolbar still carries your presets, search, and settings.
>
> For serious planning, open the board in its own window and give it the full screen. If you work across two monitors, move that window to the second screen and keep the whole board in view while you work in your notes on the first.

## FAQ

**Where do the columns come from?** From your pipeline's statuses. Configure them in [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

**Does moving a card edit my note?** Yes. A move updates the task's `status` in Markdown, so the change is permanent and visible in every view.

**Can I have more than one board?** Yes. Kanban presets let you save boards for different pipelines or slices of work.

**Can I group cards into rows as well as columns?** Yes. Turn on swimlanes to group cards by a field such as priority or assignee, and dragging a card between lanes changes that field. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

**Can I filter the board without typing?** Yes. Click the search box and use the scope buttons; scopes like Overdue or a project scope narrow the board on their own, with the search box empty.

## Settings

Operon settings for the board live in **Settings → Operon → Views → Kanban**, which configures how the Kanban board displays cards, including the hover add button that appears over an empty cell as a quick way to start a card there. Card chip visibility and order live in **Settings → Operon → Interface → Task Chips → Kanban Task Chips**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-025 Filter View|Filter View]]
