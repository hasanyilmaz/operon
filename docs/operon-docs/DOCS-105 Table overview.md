---
Up:
  - "[[DOCS-025 Filter View|Filter View]]"
  - "[[DOCS-005 Operon core concepts|Operon core concepts]]"
  - "[[DOCS-109 Table presets|Table presets]]"
Notes: See tasks as rows and columns on the Operon Table
Icon: table
Color: "#0284c7"
tags:
  - operon
  - table
  - plan
Updated: 2026-07-08T23:32:00
---

# Table overview

The Table shows your tasks as rows and columns, like a spreadsheet of your work. It is the best surface for comparing many fields at once, sorting and grouping by any property, rolling up totals, and scanning or auditing a large set of tasks in one place. An [[DOCS-011 Inline tasks|inline task]] and a [[DOCS-013 File tasks|file task]] sit in the same rows; both carry the same fields, so the Table is one grid over all your work regardless of how each task is written. Where the [[DOCS-028 Calendar overview|Calendar]] plans by *when* and the [[DOCS-030 Kanban overview|Kanban]] plans by *how far along*, the Table plans by *comparison*: line the fields up side by side and let sorting, grouping, and summaries surface what a card or a calendar cell would hide.

Open it with **Operon Table** from the command palette.

> **MEDIA-DOCS-105-1:** The Operon Table showing tasks as rows with columns for task, status, priority and dates.

![MEDIA-DOCS-105-1 - The Operon Table showing tasks as rows and columns](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-105-1.png)

## How the table is built

A table is shaped by a **Table preset**, which controls the task scope and most of the table's layout:

- The **filter** chooses which tasks appear, from a saved FilterSet or all tasks. See [[DOCS-025 Filter View|Filter View]].
- The **columns** choose which fields each row shows, and in what order. See [[DOCS-106 Table columns|Table columns]].
- **Grouping** and **sorting** arrange the rows. See [[DOCS-107 Table grouping and sorting|Table grouping and sorting]].
- **Summaries** roll each column up into a total at the foot of the table and of each group. See [[DOCS-108 Table summaries|Table summaries]].
- The **display density** sets how compact or comfortable the rows feel.

So the table is a live picture of a preset: change a task and its row updates, add a task that matches the filter and a new row appears. Saving presets lets you keep several tables for different questions and switch between them. The line number, task icon helper, and task type helper columns are global Table settings, so they appear the same way across presets. See [[DOCS-109 Table presets|Table presets]].

> **MEDIA-DOCS-105-2:** The table toolbar, with the preset selector, search box, Group & Sort, filter, export, and related views controls.

![MEDIA-DOCS-105-2 - The Operon Table toolbar](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-105-2.png)

## Editing a cell changes the task

The Table is not a read-only report. Editing a cell is a real change, written back to the task's Markdown and reflected everywhere else the task appears, because the Table is one surface over the same task records. See [[DOCS-005 Operon core concepts|Operon core concepts]].

- **Click a cell** in an editable column to change that field on the spot. The matching picker opens: the date picker for a date column, the status or priority picker, the estimate picker, and so on. From the keyboard, most picker cells open with **Enter** or **Space**; text-edit cells can also use **F2**. See [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].
- **Double-click a row** to open the full [[DOCS-021 Task Editor|Task Editor]] for that task.
- The **Source column** opens the task's source in a new Obsidian tab: the note for a file task, or the exact line for an inline task.

Read-only columns, such as the source and file columns, display their value without opening a picker. Which fields are editable and how each column behaves is covered in [[DOCS-106 Table columns|Table columns]], and exactly what each cell shows and does on click and hover is in [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].

## Searching the table

The Table has a search box that narrows it to the rows you care about. Type at least two letters and it searches the values in the table's **visible columns**, using both the raw field value and the text displayed in the cell. Hidden columns are left out. Every typed word has to match, and words match from the start, so `sch` can match `scheduled`.

Click into the box and the [[DOCS-027 Task Finder|Task Finder-style]] scope buttons appear beneath it: project scopes, Overdue, Happens Today, recent modified work, and the toggles for including inline tasks, file tasks, and cancelled or finished work. These scopes are separate filters for the table, and they work with or without typed text. Scope choices are saved with the preset, while the typed search text belongs to the current table tab. Turn on Overdue and the table shows only overdue rows; pick a project scope and it narrows to that project, even with the box empty. Text and scopes combine.

However you filter, the Table stays a table: matching rows keep their columns, grouping, and sort order, and the non-matching rows drop away. You narrow the grid, you do not flatten it.

## Open related views

The same tasks can be planned in more than one view. From the toolbar you can jump to a [[DOCS-028 Calendar overview|Calendar]] or [[DOCS-030 Kanban overview|Kanban]] that shares this table's filter, or create a new one seeded with the same filter and carrying its name, so a set of tasks you assembled here can be seen by date or by stage without rebuilding the filter or renaming the result. See [[DOCS-025 Filter View|Filter View]].

## Embed and export

A table does not have to stay in its own tab:

- **Embed a table in a note** with an `operon-table` code block, so a live, editable table renders inside a daily note, a project page, or a dashboard. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].
- An embedded table can switch presets from its toolbar, and its visible row count can come from the global Table setting or a local `rows` value in the code block.
- **Export the table** as a Markdown table or CSV, or copy the embed code, from the export control in the toolbar. See [[DOCS-111 Export a table|Export a table]].

## When the table fits

Reach for the Table when the question is about comparison rather than time or stage:

- Reviewing every open task in a project with its priority, due date, and estimate in one row.
- Sorting a large backlog to find what has slipped or what is unestimated.
- Grouping by assignee or context to see the load at a glance.
- Rolling up total estimate or tracked time across a group.
- Auditing or exporting a slice of tasks.

If your work is mostly date-driven, the [[DOCS-028 Calendar overview|Calendar]] may suit it better; if it moves through clear stages, reach for the [[DOCS-030 Kanban overview|Kanban]]. Many people use all three over the same tasks.

> **MEDIA-DOCS-105-3:** A grouped table with a summary row at the foot of each group and of the whole table, colorless mode.

![MEDIA-DOCS-105-3 - A grouped Operon Table with summary rows](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-105-3.png)

## Tips

> [!tip] Build a table per question, not one table for everything
> A table answers best when it is pointed at a single question: what is overdue this week, what is unestimated, what is each person carrying. Rather than one wide table you scroll and re-sort, save a preset for each question and switch between them. The filter, columns, grouping, and summaries then arrive already set for the answer you came for.

## FAQ

**Does editing a cell change my note?** Yes. A cell edit updates that field in the task's Markdown, so the change is permanent and visible in every view.

**How do I open the full task?** Double-click its row to open the [[DOCS-021 Task Editor|Task Editor]]. To jump to where the task is written, click its cell in the Source column.

**Can I have more than one table?** Yes. Table presets let you save tables for different filters, columns, groupings, and summaries, and switch between them. See [[DOCS-109 Table presets|Table presets]].

**Can I filter the table without typing?** Yes. Click the search box and use the scope buttons; scopes like Overdue or a project scope narrow the table on their own, with the box empty. Those scope choices are part of the preset's saved table scope.

**Is the Table a different set of tasks from the Calendar or Kanban?** No. All three read the same task records. A table shares its filter with related Calendar and Kanban views through the related views control.

## Settings

Operon settings for the Table live in **Settings → Operon → Views → Tables**, where you set the default preset, the maximum visible rows for embedded tables, and whether rows show the global line number, task icon helper, and task type helper columns. Each preset's own filter, columns, grouping, sorting, and summaries are edited from the table itself. See [[DOCS-109 Table presets|Table presets]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
- [[DOCS-111 Export a table|Export a table]]
- [[DOCS-025 Filter View|Filter View]]
