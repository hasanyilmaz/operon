---
Notes: A floating editor for a single free-text field, opened in place across surfaces
Icon: square-pen
Color: "#db2777"
Updated: 2026-10-19T13:36:12+02:00
---

# Text field editor popover

The text field editor popover is a small floating panel for editing a task's **description**, **note**, or a supported multiline **Text** value in place. Description and Note are the main free-text fields; a Text picker's current-value control can also use the shared editor for a multiline value. When a Table or embedded Table description or note column is in compact cell mode, clicking its compact cell opens this popover without opening the whole [[DOCS-021 Task Editor|Task Editor]] or widening the column. It saves what you write when you close it.

> **MEDIA-DOCS-113-1:** The text field editor popover open over a cell, showing its heading and editor.

![MEDIA-DOCS-113-1 - The text field editor popover](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-113-1.png)

## What it looks like

The popover is a compact panel with three parts:

- A **heading** with the field's name and, beneath it, the task's description so you know which task you are editing.
- An editor for the text, focused and ready to type, with the cursor at the end of the current value. Notes and supported multiline Text values can use several lines; descriptions remain one-line task titles.
- A **close** control in the corner.

It picks up the task's color as an accent, and it floats above the surface you opened it from, so the table or board stays in place behind it.

## Where it opens

The same popover control is shared across surfaces, with the save behavior following the surface that opened it:

- On the **Table**, click a compact **description** or **note** cell. See [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].
- In an **embedded table**, the same compact text cells open it. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].
- On the **Kanban**, it opens as a card's note editor. See [[DOCS-030 Kanban overview|Kanban overview]].

Supported multiline Type, Custom Text, and Vault Property Text values can also reach it from the current-value control in their [[DOCS-070 Custom field pickers|Text picker]].

Because it is one control, learning the panel once covers the places it appears. The exact text normalization can still differ by surface.

## How editing works

The popover is built for a quick edit and out:

- The **Note** editor accepts multiple lines. Use **Shift+Enter** for a line break, and paste multiline text when that is faster; intentional blank lines are preserved. The **Description** remains a single-line task title.
- It **saves when you dismiss it**, by clicking away, pressing **Escape**, or using the close control. There is no separate save step; dismissal uses the existing source and conflict checks rather than bypassing a failed save.
- Normal **Enter** keeps the existing submit or save behavior of the surface; it is not a second line-break command. In the mobile Task Editor, normal Enter retains its one-line behavior by inserting a space, while Shift+Enter inserts a Note line break.
- The change is written straight back to the task's Markdown, the same as any other edit, so it shows everywhere the task appears. For inline tasks, a Note's line breaks are stored as `\n` escapes inside the field, which keeps the whole task on one physical Markdown line. To store the visible characters `\n`, write `\\n`.

## Links while editing

On desktop, supported HTTP/HTTPS and existing local links in a Description/Note popover use the [[DOCS-151 Lightbox|shared lightbox]] from the **current draft**. Click to preview, Cmd/Ctrl-click for an Obsidian tab, or middle-click an HTTP/HTTPS link for the system browser. Local modifier-hover follows Page Preview preferences. Enter and Space remain editing keys inside the editor.

Opening a preview does not dismiss or save the popover. The draft, cursor, selection, and scroll position remain available when you return. A missing wikilink does not create a file; editing remains open. An unfinished popover draft prevents transferring its preview chain to a new tab or split until the edit is completed. The plain textarea fallback does not gain a new link interface, and Creator/Task Editor's own editors keep their behavior.

## Highlight formatting

Use `==text==` for the default highlight. Its appearance follows the theme. For a colored highlight, place one of these six markers immediately after the opening `==`:

| Color | Source text |
|---|---|
| Red | `==🔴text==` |
| Orange | `==🟠text==` |
| Yellow | `==🟡text==` |
| Green | `==🟢text==` |
| Blue | `==🔵text==` |
| Purple | `==🟣text==` |

Rendered task text in Table descriptions, Calendar, Kanban, and the **Edit session** description uses the chosen highlight color without displaying the leading marker. Rendering preserves the original Markdown; it does not remove the marker from the saved task. An emoji elsewhere in the text is not hidden just because it is a color symbol.

Editing is different from reading. In the Live Preview-style editors used by this popover, [[DOCS-020 Task Creator|Task Creator]], and [[DOCS-021 Task Editor|Task Editor]], Obsidian's highlight color control remains visible when editing the highlight, where that control is supported by the installed Obsidian version. You can use it to change the color. A plain-text input, such as the phone textarea, lets you edit the source syntax directly. The read-only description in **Edit session** has no Live Preview color control.

## When to use it

Reach for the popover when you want to change **one text field** without the ceremony of the full editor:

- Fix a typo in a description from a narrow, compact column.
- Jot a quick note on a Kanban card without leaving the board.
- Add text to a task's note while scanning a table.

When you need to change several fields at once, or work with the note as a full document, open the [[DOCS-021 Task Editor|Task Editor]] instead.

## FAQ

**Which fields does it edit?** Description and Note, plus supported multiline Text values opened from their picker's current-value control.

**How do I save?** Just close the popover, by clicking away, pressing Escape, or using the close control. Closing saves what you typed.

**Is it the same on the Table and the Kanban?** It is the same shared control. Notes preserve their line breaks across those surfaces; Descriptions remain one-line task titles.

**Can I write more than one line?** Yes, in Notes and supported multiline Text values. Use the editor’s line-break controls or paste multiline text, including blank lines. Descriptions remain single-line.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-062 Field pickers overview|Field pickers overview]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
- [[DOCS-021 Task Editor|Task Editor]]
