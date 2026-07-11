---
Up:
  - "[[DOCS-105 Table overview|Table overview]]"
  - "[[DOCS-018 Task properties|Task properties]]"
  - "[[DOCS-040 Custom keys|Custom keys]]"
Notes: Choose, arrange, size, color, and format the columns on a table
Icon: table-properties
Color: "#0284c7"
tags:
  - operon
  - table
  - columns
  - configure
Updated: 2026-07-11T14:16:12
---

# Table columns

Columns are how a table decides which fields each row shows and how each one looks. A column can be any [[DOCS-018 Task properties|task field]], from status and due date to your own custom keys, and each column carries its own width, alignment, color, and format. Columns belong to the [[DOCS-109 Table presets|preset]], so every table can show a different set of fields arranged its own way. This page covers what a column can hold and every way to shape one.

> **MEDIA-DOCS-106-1:** A table with several columns: task, status, priority, due date, estimate, and source.

![MEDIA-DOCS-106-1 - A table with task, status, priority, due date, estimate, and source columns](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-106-1.png)

## Which fields can be a column

Almost any field a task carries can become a column:

- **Task fields**: the description (shown as **Task**), status, priority, the dates (due, scheduled, start, and the completion and cancellation dates), estimate, duration and its rolled-up totals, assignees, contexts, parent, blocking and blocked-by links, location, recurrence, tags, and note.
- **Your custom keys**: any [[DOCS-040 Custom keys|custom key]] appears as a field you can add as a column, so a table can carry exactly the properties your workflow uses.
- **Source and file fields**: read-only columns that describe where the task lives, such as **Source**, source path, source line, and the file name, basename, path, and folder.
- **Identity**: the task's [[DOCS-015 Task identity and operonId|operonId]], as a read-only column, and its [[DOCS-097 Project serials|Project Serial]] where a scope is set up, also read-only.

You add a column from a header's menu with **Add column to left...** or **Add column to right...**, or from the preset's **Columns** section. See [[DOCS-109 Table presets|Table presets]].

**Pipeline is the one exception.** It never appears in the column picker, because it is not a column at all, only a field you can group, subgroup, or sort by. See [[DOCS-107 Table grouping and sorting|Table grouping and sorting]].

## Shape a column from its header

Right-click, or open the menu on, a column header to reach everything you can do to that column:

| Action | What it does |
|---|---|
| Align left / Align center / Align right | Sets the column's text alignment |
| Pin column / Unpin column | Freezes the column so it stays in view as you scroll sideways |
| Show total / Show sessions | For the duration column only, switches what it counts (see below) |
| Show compact cell / Show detailed cell | For icon-bearing task fields, collapses the cell to its compact icon view, or restores the full value |
| Add column to left... / Add column to right... | Inserts another field beside this one |
| No color / Task color / Priority color / Status color / Random colors | Chooses how the cells are tinted (see below) |
| Summarize column... / Edit summary... | Adds or edits a summary at the foot of the column. See [[DOCS-108 Table summaries\|Table summaries]] |
| Edit preset | Opens the full preset settings. See [[DOCS-109 Table presets\|Table presets]] |
| Hide column | Removes the column from the table |

You cannot hide the last remaining task column, so a table always shows at least one field.

## Resize and reorder by dragging

Two things you do directly on the header rather than through the menu:

- **Resize**: drag the edge of a header to set the column's width. Widths are remembered per preset.
- **Reorder**: drag a header onto another to move the column there. For more deliberate layout changes, open **Edit preset** and use the preset's **Columns** section.
- **Sort**: click a header, or focus it and press **Enter** or **Space**, to cycle the primary sort for that column.

> [!tip] Switch compact and detailed cells quickly
> On desktop, double-click the same column header edge you drag for resizing. This switches a supported task-field column between compact and detailed cell mode. It is the quick shortcut for **Show compact cell** and **Show detailed cell**, so you do not need to open the header menu.

> **MEDIA-DOCS-106-2:** A column header menu open, showing alignment, pin, color, summary, and column options.

![MEDIA-DOCS-106-2 - A table column header menu](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-106-2.png)

## Column color

A column can tint its cells so a value reads at a glance. For columns that support color, the header menu offers these color modes directly:

| Mode | Cells are colored by |
|---|---|
| No color | Nothing; plain text |
| Task color | The task's own color |
| Priority color | The task's priority color |
| Status color | The task's status color |
| Random colors | A stable color per distinct value in the column |

Sensible defaults apply without any setup: a **status** column uses status color, a **priority** column uses priority color, and a task-color column uses the task color. **Random colors** is useful on a grouping field such as assignee or context, where each distinct value gets its own consistent tint. The description, source, and duration columns do not take a color.

## Duration: sessions or total

The **duration** column can show two different things, switched from its header:

- **Show sessions**: the time tracked directly on that task.
- **Show total**: the task's duration rolled up with its sub-tasks.

The estimate and duration columns also have their own rolled-up total fields you can add as separate columns. See [[DOCS-034 Time tracking|Time tracking]].

## Compact cell columns

Icon-bearing task-field columns can be collapsed with **Show compact cell**, which drops the full text and keeps the compact icon view, a tidy way to keep a status, priority, or type column narrow. **Show detailed cell** restores the full value. Description and note can also use compact cell mode when available; those compact text cells open the text editor popover instead of a normal field picker. This is the column-level counterpart of the Icon Only setting on [[DOCS-041 Task chips display and behavior|task chips]]. For exactly what a cell shows and does in each mode, including the hover tooltip that keeps a compact cell readable, see [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].

## Editable and read-only columns

Most columns are editable: click a cell to change that field on the spot, as covered in [[DOCS-105 Table overview|Table overview]]. Some columns are read-only by nature and only display their value:

- **Editable task fields** include status, priority, description, note, due, scheduled, start, completion and cancellation dates, repeat end, estimate, recurrence, parent and dependency links, tags, contexts, assignees, location, the task icon field, task color, and supported custom date, datetime, number, text, and list fields.
- **Source and file columns**, which describe where the task is stored rather than a property you set.
- **Identity, checkbox, progress, and helper columns**, such as operonId, Project Serial, checkbox, subtask progress, line number, task icon helper, and task type helper columns, are read-only or have their own dedicated action instead of opening a normal field picker.

The source column is still active: clicking it opens the task's source in a new tab.

## The three helper columns

Beyond your field columns, a table can show three fixed helper columns, turned on for every table in **Settings → Operon → Views → Tables**:

| Column | Shows |
|---|---|
| Line numbers | A row-number column at the start of the table |
| Task icon helper | A status icon you can click to cycle status, with the task's context menu |
| Task type helper | An inline-or-file icon that opens the [[DOCS-021 Task Editor\|Task Editor]]; Cmd/Ctrl-click opens the task's source |

> [!tip] Jump from task type to source
> On desktop, click the task type icon to open the Task Editor. Cmd-click on macOS, or Ctrl-click on Windows and Linux, opens the task's source instead: the note for a file task, or the exact line for an inline task. The same shortcut also works when the Task Type field is shown as a compact cell.

These are global toggles rather than per-preset columns, so they appear the same way on every table. They cannot be reordered or hidden from a header menu.

## Tips

> [!tip] Let a narrow, ordered set of columns do the reading
> A table is easiest to scan when each column earns its place. Put the field you sort or group by near the description, collapse status and priority to icons, and pin the columns you always want in view. A focused six-column table tells you more at a glance than a wide one you have to scroll.

## FAQ

**How do I add a column?** Use **Add column to left...** or **Add column to right...** from a header menu, or the **Columns** section of the preset settings.

**How do I remove a column?** Choose **Hide column** from its header. A table always keeps at least one task column.

**Why can I not color a column?** The description, source, and duration columns do not take a color. Every other task field column can.

**Do column changes affect other tables?** No. Columns, widths, order, and color are stored in the preset, so each table keeps its own layout.

**What is the difference between the task icon and task type columns?** The task icon helper cycles status and opens the context menu; the task type helper shows whether the task is inline or file, opens the Task Editor, and Cmd/Ctrl-clicks through to the source. The task icon field can also be added as a normal preset column when you want that value in the table layout.

## Settings

The three helper columns are toggled in **Settings → Operon → Views → Tables**: show line numbers, show task icon helper, and show task type helper. Every other column choice, its field, width, order, alignment, color, and format, lives in the preset and is edited from the table. See [[DOCS-109 Table presets|Table presets]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-040 Custom keys|Custom keys]]
- [[DOCS-097 Project serials|Project serials]]
