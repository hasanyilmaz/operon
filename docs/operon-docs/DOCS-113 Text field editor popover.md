---
Notes: A floating editor for a single free-text field, opened in place across surfaces
Icon: square-pen
Color: "#db2777"
Updated: 2026-08-18T18:18:29
---

# Text field editor popover

The text field editor popover is a small floating panel for editing a task's **description** or **note** in place. These are Operon's free-text fields, the ones you write sentences into rather than choose a value for. When a Table or embedded Table description or note column is in compact cell mode, clicking its compact cell opens this popover without opening the whole [[DOCS-021 Task Editor|Task Editor]] or widening the column. It saves what you write when you close it.

> **MEDIA-DOCS-113-1:** The text field editor popover open over a cell, showing its heading and editor.

![MEDIA-DOCS-113-1 - The text field editor popover](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-113-1.png)

## What it looks like

The popover is a compact panel with three parts:

- A **heading** with the field's name and, beneath it, the task's description so you know which task you are editing.
- An editor for the text, focused and ready to type, with the cursor at the end of the current value. Notes can use several lines; descriptions remain one-line task titles.
- A **close** control in the corner.

It picks up the task's color as an accent, and it floats above the surface you opened it from, so the table or board stays in place behind it.

## Where it opens

The same popover control is shared across surfaces, with the save behavior following the surface that opened it:

- On the **Table**, click a compact **description** or **note** cell. See [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].
- In an **embedded table**, the same compact text cells open it. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].
- On the **Kanban**, it opens as a card's note editor. See [[DOCS-030 Kanban overview|Kanban overview]].

Because it is one control, learning the panel once covers the places it appears. The exact text normalization can still differ by surface.

## How editing works

The popover is built for a quick edit and out:

- The **Note** editor accepts multiple lines. Use **Shift+Enter** for a line break, and paste multiline text when that is faster; intentional blank lines are preserved. The **Description** remains a single-line task title.
- It **saves when you dismiss it**, by clicking away, pressing **Escape**, or using the close control. There is no separate save step; closing commits your text.
- Normal **Enter** keeps the existing submit or save behavior of the surface; it is not a second line-break command. In the mobile Task Editor, normal Enter retains its one-line behavior by inserting a space, while Shift+Enter inserts a Note line break.
- The change is written straight back to the task's Markdown, the same as any other edit, so it shows everywhere the task appears. For inline tasks, a Note's line breaks are stored as `\n` escapes inside the field, which keeps the whole task on one physical Markdown line. To store the visible characters `\n`, write `\\n`.

## When to use it

Reach for the popover when you want to change **one text field** without the ceremony of the full editor:

- Fix a typo in a description from a narrow, compact column.
- Jot a quick note on a Kanban card without leaving the board.
- Add text to a task's note while scanning a table.

When you need to change several fields at once, or work with the note as a full document, open the [[DOCS-021 Task Editor|Task Editor]] instead.

## FAQ

**Which fields does it edit?** Only a task's description and note, Operon's free-text fields. It does not open for other fields.

**How do I save?** Just close the popover, by clicking away, pressing Escape, or using the close control. Closing saves what you typed.

**Is it the same on the Table and the Kanban?** It is the same shared control. Notes preserve their line breaks across those surfaces; Descriptions remain one-line task titles.

**Can I write more than one line?** Yes, in Notes. Press Shift+Enter or paste multiline text, including blank lines. Descriptions remain single-line.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-062 Field pickers overview|Field pickers overview]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
- [[DOCS-021 Task Editor|Task Editor]]
