---
Notes: What each table cell shows and does on click, hover, and keyboard, in detailed and compact cell modes
Icon: square-mouse-pointer
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Table cells: display and behavior

A table cell is not just a value in a box. It shows a field a particular way, and it acts when you click, hover, or focus it. Two things decide how a cell looks and behaves: the **field** it holds and the column's **display mode**. Knowing this pays off when you build a table, because it tells you which columns to leave in full detail and which supported columns to collapse to an icon. This page is the counterpart to [[DOCS-041 Task chips display and behavior|Task chips: display and behavior]], for cells rather than chips.

For choosing a column's field, order, width, color, and display mode, see [[DOCS-106 Table columns|Table columns]]. This page is about the cell itself.

> **MEDIA-DOCS-112-1:** A table row with mixed cells: a chip list, a colored due date, a status tinted by its color, and a source button.

![MEDIA-DOCS-112-1 - A table row with mixed cell types](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-112-1.png)

## Detailed and compact cells

Icon-bearing task-field columns can use one of two display modes, set from the header menu (**Show detailed cell** or **Show compact cell**). On desktop, you can also double-click the column header edge you would drag for resizing to switch a supported column between the two modes. Columns without compact mode stay in detailed mode:

- **Detailed cell**: the cell shows the full value, as text, a chip, a colored date, or a small control.
- **Compact cell**: the cell collapses to a single icon. When there is a value, hovering the icon shows a **tooltip** with the field's name and its full value.

So compact cell mode is how you keep a status, priority, or type column narrow while still reading it on hover. For supported editable columns, compact cells still open their normal editor on click; the icon is a smaller target, not a different action.

Do not confuse this with **display density** (compact or comfortable), a preset setting that only changes row height. Density is purely visual; detailed and compact cell modes change what a cell shows.

> **MEDIA-DOCS-112-2:** The same column in detailed mode and in compact mode, with the compact cell's hover tooltip revealing the full value.

![MEDIA-DOCS-112-2 - Detailed versus compact cell with tooltip](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-112-2.png)

## What a cell shows, by field

In detailed cell mode, each field type renders its own way:

| Field | The cell shows |
|---|---|
| Text, number | The value as plain text |
| Status, priority | The value, tinted by the column's [[DOCS-106 Table columns\|color mode]] |
| Due, Scheduled | The date, turning **red** when overdue and **blue** when due today |
| Other dates | The date, in neutral text |
| List, tags | One chip per item in the field |
| Task links (parent, blocking, blocked by) | A wikilink chip per linked task |
| Links (web links) | A chip per link: a named Markdown link shows its label, a bare URL a tidied address |
| Assignees, contexts | A chip per linked person, place, or context value |
| Location | A small map chip |
| Duration | Tracked sessions as chips, or a rolled-up total, depending on the column's mode |
| Parent task progress | A progress indicator over the task's subtasks or checkboxes |
| Description | The task's text, with any wikilinks live |
| Source | A button that opens the task's source |
| Project Serial | A chip with the task's serial, where a scope covers it |
| Line number, task icon helper, task type helper | The row number, a status icon, or an inline-or-file icon |

In detailed cells, an empty field usually shows a plain `--`, so a blank detailed cell is never ambiguous. **Project Serial is the exception**: a task outside any [[DOCS-097 Project serials|Project serial]] scope renders a fully empty cell instead of `--`. Empty compact cells can render blank when there is no value to turn into an icon. Once a task is finished or cancelled, its Due and Scheduled cells drop the red and blue, because the deadline no longer presses, the same rule as [[DOCS-041 Task chips display and behavior|task chips]].

**Date Time Start and Date Time End format their own way.** In detailed cell mode, the date and time show together with a space between them (`2026-07-13 14:30`) rather than a raw `T` separator. In compact cell mode, the cell shows just the time (`14:30`), with no icon, at the same text size as the detailed value rather than the smaller scale other compact cells use.

**The Links column turns web links into readable chips.** The **Links** field holds external web links, and in detailed cell mode each entry becomes a chip. A named Markdown link, `[Design doc](https://example.com/design)`, shows its **label** (`Design doc`) rather than the raw address, and a bare URL shows a tidied version of the address. Hover a link chip to see its **full URL** along with a reminder that a modifier click opens it. Hold **Cmd** or **Ctrl** and click to open the link in a new **Obsidian Web Viewer** tab, which needs Obsidian's core Web Viewer plugin enabled on desktop; without it, Operon shows a short notice telling you to turn it on. A plain click or double-click leaves the cell alone, so normal editing is untouched.

## What a cell does on click

Cells fall into a few roles. Some edit a value in place, some take you somewhere, and some open a control:

| Role | Where | Clicking it |
|---|---|---|
| Edit in place | status, priority, dates, estimate, recurrence, list, tags, parent/dependency links, and other editable picker fields | Opens that field's picker |
| Edit text | description and note cells | Opens the text editor path; wikilinks inside a description remain live |
| Navigate from text | wikilinks inside description text | Opens the linked note, creating it if it does not exist yet |
| Open a web link | a chip in the Links column | Cmd/Ctrl-click opens the link in a new Obsidian Web Viewer tab |
| Open a place | location cell or chip | Opens the map popover, which pins open when you drag it. See [[DOCS-068 Location picker\|Location picker]] |
| Act on structure | parent task progress | Opens the task's subtasks or checkboxes |
| Go to source | source column | Opens the task's source in a new Obsidian tab: the note for a file task, the exact line for an inline task |
| Cycle and menu | task icon column | Cycles the task's status; its hover menu is the [[DOCS-042 Contextual menu actions\|contextual menu]] |
| Open the editor | task type column | Opens the [[DOCS-021 Task Editor\|Task Editor]]; Cmd/Ctrl-click opens the source instead |

Two behaviors apply to every row, whatever the column:

- **Double-click a row** to open the full [[DOCS-021 Task Editor|Task Editor]].
- **Read-only cells**, such as the source and file columns and automatic fields like operonId, display their value and do not open a picker. The source cell is the exception: it is read-only as a value but still opens the source.

From the keyboard, focus an editable picker cell and press **Enter** or **Space** to start editing, the same as clicking it. Description and note text cells also support **F2** for their text-editing path.

> **MEDIA-DOCS-112-3:** An editable date cell clicked open, showing the date picker anchored to the cell.

![MEDIA-DOCS-112-3 - A date cell opening its picker](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-112-3.png)

## Editing text in compact cells

A text field behaves a little differently when it is collapsed to a compact icon. When the **description** or a **note** column is in compact cell mode, clicking its cell does not open a field picker; it opens a **text editor popover**, a small floating panel for editing that field's text in place. The panel carries the field's name and the task's description as a heading, and it saves what you type when you dismiss it, by clicking away, pressing **Escape**, or using its close button. In Table and embedded Table cells, saved line breaks are normalized to spaces.

This is how you keep a wordy column, such as description or note, collapsed to a narrow icon yet still edit its full text without widening the column or opening the Task Editor. The same popover opens for text cells in an [[DOCS-110 Embed a table in a note|embedded table]] and on the [[DOCS-030 Kanban overview|Kanban]]. See [[DOCS-113 Text field editor popover|Text field editor popover]] for the control itself.

> **MEDIA-DOCS-112-4:** The text editor popover open over a compact description cell, with its multi-line editor.

![MEDIA-DOCS-112-4 - The text editor popover on a compact cell](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-112-4.png)

## Hover: tooltips and previews

Hovering a cell can reveal more without a click:

- **Compact cells** show a tooltip with the field's name and its full value, so a collapsed column stays readable.
- **Wikilinks** inside text cells and wikilink-style task link chips support **Page Preview**: hold **Cmd** or **Ctrl** and hover to get Obsidian's hover preview of the linked note. This needs Obsidian's core **Page Preview** plugin enabled, and the modifier key; a plain hover does not trigger it.
- **Web link chips** in the Links column show their **full URL** on hover, along with a hint that a Cmd or Ctrl-click opens the link in a new Web Viewer tab.

## How this guides configuration

Because a cell both shows and acts, the display mode you pick per column has consequences:

- Collapse **status**, **priority**, and **type** to compact cell mode. They read at a glance, and the hover tooltip and click behavior stay intact.
- Keep **description**, **dates**, and any **link or list** fields in detailed cell mode, where the full text and chips are worth the width.
- Remember that compact cell mode keeps the supported column's normal action. A compact editable cell still opens its editor; a compact date still carries its overdue or due-today color on the icon when it has a value.

## Tips

> [!tip] Collapse what you recognize, expand what you read
> If you know a field by its icon, such as status or priority, set it to compact cell mode and reclaim the width. Keep the columns you actually read as words, like the description and dates, in detailed cell mode. The row gets shorter while supported compact cells keep their tooltip and click behavior.

## FAQ

**Does a compact cell lose information?** No, when the field has a value. Hover it for a tooltip with the field name and full value, and click it to edit just as in detailed cell mode. If the value is empty, the compact cell can be blank.

**Why is a due date red or blue?** Red means overdue, blue means due today. A finished or cancelled task drops the color.

**What is the difference between detailed cells, compact cells, and density?** Detailed and compact cell modes decide what a cell shows. Density (compact or comfortable) only changes row height. See [[DOCS-109 Table presets|Table presets]].

**Why does clicking a cell not do the same thing everywhere?** Cells have roles. An editable field opens a picker, description wikilinks open notes, the source column opens the source, location opens the map popover, and read-only cells only display.

**How do I get a hover preview of a linked task?** Hold Cmd or Ctrl and hover the wikilink chip, with Obsidian's core Page Preview plugin enabled.

**Why won't a web link in my Links column open?** Web link chips open in Obsidian's Web Viewer, so its core plugin has to be enabled, and you open the link with a Cmd or Ctrl-click rather than a plain click. This works on the desktop app.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-113 Text field editor popover|Text field editor popover]]
- [[DOCS-041 Task chips display and behavior|Task chips: display and behavior]]
- [[DOCS-068 Location picker|Location picker]]
- [[DOCS-097 Project serials|Project serials]]
