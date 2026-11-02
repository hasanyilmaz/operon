---
Notes: Plan tasks in property-based columns and swimlanes
Icon: columns-3
Color: "#0284c7"
Updated: 2026-10-29T18:48:06+01:00
---

# Kanban overview

The Kanban shows inline and file tasks as cards in columns, with optional horizontal rows called **swimlanes**. Each direction can use its own property: Status × Priority for workflow planning, Scheduled × Assignees for assigning dated work, or two other supported fields. Cards are views of the same task records, so edits are reflected wherever those tasks appear.

Open it with **Operon Kanban** from the command palette.

> **MEDIA-DOCS-030-1:** The Operon Kanban with task chips visible on cards across status columns.

![MEDIA-DOCS-030-1 - The Operon Kanban with task chips visible on cards across status columns](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-030-1.png)

## How the board is built

A **Kanban preset** chooses the board filter, column property, optional swimlane property, value selections, sorting, and appearance. Open the preset settings from the toolbar or **Settings → Operon → Views → Kanban**. See [[DOCS-153 Kanban presets|Kanban presets]] for the full setup.

Each card appears at the intersection of its column and row values. When an axis uses **Status**, choose a pipeline and its statuses become that axis's headings in pipeline order. Other properties can show all values used within the board's filter scope or only values you select. Priority is an exception: All uses its configured choices. Status can be used in rows as well as columns; a board does not need a Status axis.

List properties can place one task in several cells. Each cell shows that task only once, and row, column, and board totals count unique tasks in their own scope. The board total is not the sum of cell totals. Empty cells do not display a task-count **0**; header totals can still show zero. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

The toolbar's center holds one button per **favorite** preset. Favorite a preset from its editor or its row in Kanban settings. The picker beside the favorites searches all presets and picks up a calm accent when the active preset is not a favorite. On a narrow pane, favorite buttons wrap; on mobile a preset dropdown takes over.

## Card chips and actions

Kanban cards can show [[DOCS-041 Task chips display and behavior|Task Chips]] under the title, so priority, dates, assignees, location, links, recurrence, and custom fields can be scanned without opening the card. The **Kanban Task Chips** settings page controls which normal chips appear, their order, and which are Icon Only.

> **MEDIA-DOCS-030-2:** The Kanban Task Chips settings page, showing the card chip list and the Kanban Task Actions section.

![MEDIA-DOCS-030-2 - Kanban Task Chips settings with card chips and action controls](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-030-2.png)

If a task has a Project Serial, the serial appears first as a display-only identity chip on the main card, independent of the normal chip visibility settings. Kanban does not show hidden-chip overflow counts, so the row only shows the card chips you chose to display.

Kanban also has a **Kanban Task Actions** section at the end of the same settings page. Those controls can add compact action chips at the trailing edge of the card chip row, such as Play, Pin, Note, Add subtask, and Open checkboxes. On desktop, enabled action chips are usable from the card. The Play action changes to Stop when that task's timer is already running. On mobile, the same card chip area stays visible but read-only, so card tap, scroll, and drag gestures stay predictable.

Main cards can grow a little when chips wrap onto multiple lines; descendant preview cards stay compact and do not show chip rows.

Card descriptions and rendered notes support default and six-color highlights. The leading color marker is hidden in the rendered text, while the original Markdown remains intact. When editing a note, the text popover keeps the supported Live Preview color control. See [[DOCS-113 Text field editor popover|Text field editor popover]].

## Card images

Each Kanban preset can show no card image, the task's single **Task Image**, the first **Task Gallery** item, or the last gallery item. Choosing a source changes only the card presentation; it does not rewrite or reorder the task's media fields. Empty or unresolved references leave the card without an image from that source. See [[DOCS-138 Task images and galleries|Task images and galleries]].

> **MEDIA-DOCS-030-3:** Kanban cards in action, with task chips, trailing action chips, an active timer shown as Stop, and the active column and swimlane highlighted.

<iframe
  title="MEDIA-DOCS-030-3 - Kanban cards in action video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/9YjQEgOSoWQ"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## Choose or edit the board filter

Click or tap the toolbar's **filter** button to choose a saved filter by name. The picker highlights the current selection and lets you search the names or choose no filter. This changes the saved-filter restriction without changing the preset's grouping, sorting, or layout; other search and scope rules still apply.

On desktop, **right-click** the filter button to edit the filter's conditions. If no filter is selected, this opens the new-filter editor. Choosing a filter and editing its conditions are separate actions.

## Moving a card changes the task

Dragging a card to a different cell applies the destination's column and row values together. A single-valued field, such as priority, takes the target value. A list field, such as tags or assignees, **adds** the target value and keeps its existing members. The source card therefore remains when the task still matches that cell. Moving within the same cell in Manual mode changes order only.

These are real edits to the task's Markdown, shared by every view. Existing completion, recurrence, and dependency rules still apply when a move changes Status. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]] for list behavior and conflicting targets.

Placing an existing task into a cell uses the same value rules. Creating a task from a cell prefills both axis values in [[DOCS-020 Task Creator|Task Creator]]; you can change the draft before saving. Cancelling does not create a task.

On desktop-layout tablets and other hybrid devices, touch and pen use press-and-hold before a card begins to drag. Moving before activation scrolls the board or cell, and a normal tap still opens the card. Links, chips, menus, and inline editors keep their own actions. Mouse and trackpad support direct drag-and-drop.

## Open a card

Click a card to open it in the [[DOCS-021 Task Editor|Task Editor]]. Hold **Cmd** (macOS) or **Ctrl** (Windows and Linux) and click to open the task's source in a new Obsidian tab instead: the note for a file task, or the exact line for an inline task, the same convention as opening a link in a new browser tab. This works on materialized tasks; a recurring occurrence that has not been created yet has no source line to open.

## When the Kanban fits

Use it for workflows such as:

- Content production.
- Editorial work.
- Feature development.
- Bug triage.
- Release planning.

If your work is mostly date-driven rather than stage-driven, the [[DOCS-028 Calendar overview|Calendar]] may suit it better; to compare many fields at once and sort or summarize them, reach for the [[DOCS-105 Table overview|Table]]. Many people use all three.

## Card order

Each cell uses **Board sorting**, unless its Status column has a **Pipeline column sorting** override. Overrides apply only when columns use Status. Automatic rules can sort by fields such as priority, dates, or **Project Serial**; Manual mode stores the order you set within each cell. See [[DOCS-031 Kanban manual order|Kanban manual order]].

## Searching the board

The Kanban has a search box that narrows the board to the cards you care about. Type at least two letters and it keeps only the cards whose tasks match, using the **same matching as** [[DOCS-027 Task Finder|Task Finder]]: it looks across each task's words, fields, and the names of its parent, sub-tasks, and related tasks, every typed word has to match, and words match from the start.

### Scopes, the same as Task Finder

The search box is not only a text box. Click into it and the **Task Finder scope buttons appear** beneath it, the same scopes described in [[DOCS-027 Task Finder|Task Finder]]: project scopes, Overdue, Happens Today, and the toggles for including inline tasks, file tasks, and cancelled or finished work. Their dot shortcuts work here too.

The important part: **these scopes filter the board on their own, with or without any text typed.** Turn on Overdue and the board immediately shows only overdue cards; pick a project scope and it narrows to that project, even with the search box empty. Text and scopes also combine, so you can, for example, scope to Happens Today and then type a word to narrow within it.

### It narrows the board, it does not flatten it

However you filter, by text, by scope, or both, the Kanban stays a board. Matching cards remain in their property columns and swimlanes, in their normal Kanban order; the non-matching ones simply drop away. A saved filter decides which cards qualify, but any presentation sorting attached to that filter does not replace Board sorting or Pipeline column sorting. You never get a flat list of results: you get the same board showing fewer cards. That keeps the structure you are planning against intact while you focus on a slice of it.

Search and temporary scope buttons narrow cards and totals without changing the preset’s All-value heading pool. A heading can still collapse under the preset’s visibility rules.

For exactly which fields are matched and how Task Finder ranks its own results, see [[DOCS-027 Task Finder|Task Finder]].

## Cell size and scrolling

Each preset has its own **Column width** and **Cell height** in **Board layout**. Expanded swimlane cells keep a fixed height even when cards contain long notes or images; extra content scrolls inside the cell. Without swimlanes, columns fill the available pane height. Floating **+/−** controls save size changes to the active preset only.

Scroll inside a cell to reach its cards. At the cell's scroll limit, scrolling continues through the board; an empty cell also lets you scroll the board. Large boards draw cells near the visible area as needed and retain a visited cell's inner scroll position while the view remains open.

## Tips

> [!tip] Make Kanban your dedicated board
> On the desktop app, Operon hides Obsidian's duplicate native header in the main Kanban workspace, so the columns have more vertical room to breathe. Nothing goes missing. Kanban's own toolbar still carries your presets, search, and settings.
>
> For serious planning, open the board in its own window and give it the full screen. If you work across two monitors, move that window to the second screen and keep the whole board in view while you work in your notes on the first.

## FAQ

**Where do the columns come from?** From the preset’s Column selection property and values. Status columns use the selected pipeline’s statuses.

**Does moving a card edit my note?** Yes. Moving between cells updates their axis properties; reordering within a cell only saves its manual order.

**Can I have more than one board?** Yes. Kanban presets let you save boards for different pipelines or slices of work.

**How do I switch boards quickly?** Favorite the presets you use most; their buttons sit in the toolbar's center. The picker button beside them searches every preset, favorite or not.

**Can I group cards into rows as well as columns?** Yes. Choose a property under Swimlane selection to group cards by priority, assignee, or another supported field. Dragging between lanes sets a single value or adds a list membership. Choose No swimlanes for columns only. See [[DOCS-074 Kanban swimlanes|Kanban swimlanes]].

**Can I filter the board without typing?** Yes. Click the search box and use the scope buttons; scopes like Overdue or a project scope narrow the board on their own, with the search box empty.

## Settings

General board settings live in **Settings → Operon → Views → Kanban**: **Board Layout** contains the hover add button setting, **Card Content** controls notes and progress previews, and **Kanban Presets** manages saved boards and the default preset. Column width and cell height belong to each preset’s **Board layout**, not the general settings. Card chip visibility and order live in **Settings → Operon → Interface → Task Chips → Kanban Task Chips**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-025 Filter View|Filter View]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
