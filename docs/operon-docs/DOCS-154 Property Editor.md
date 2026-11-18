---
Notes: Edit properties of regular Markdown notes in the shared editor
Icon: list-checks
Color: "#ea580c"
Updated: 2026-11-18T16:26:34+03:00
---

# Property Editor

Use **Property Editor** to edit an eligible regular Markdown note's frontmatter with Operon's pickers. It uses the same section layout as [[DOCS-021 Task Editor|Task Editor]]. Task Editor handles File Tasks and individual Inline Tasks.

## Open the editor

- With the note active, run **Operon: Open current file’s Task / Property Editor** from the command palette. It opens Property Editor by itself, including for a regular note containing Inline Tasks. With a verified File Task active, it opens Task Editor.
- On desktop, open the note in a [[DOCS-151 Lightbox|Lightbox]] and choose **Show property editor** on the control rail. Use **Show source** or **Hide source** to control whether the Markdown body appears alongside the editor.
- On desktop, **Core Quick Switcher click behavior** can also open Property Editor directly. See [[DOCS-098 Workspace Tweaks#Core Quick Switcher click behavior|Core Quick Switcher click behavior]].

On desktop, the panel follows **Task Editor position** under **Settings → Operon → Interface → Task Editor → Layout and opening**. The active-file command starts with the source hidden. On phones and tablets, the command opens an editor-only panel. Phones follow **Use mobile Task Editor on phones**, and tablets use the desktop-style layout with touch controls. See [[DOCS-101 Mobile General|Mobile General]].

## Property Editor and Task Editor

Use **Sections and Order** under **Settings → Operon → Interface → Task Editor** to arrange the sections and assign properties for both desktop-style editors. Properties on a regular note appear in their assigned sections, with unassigned fields in **Additional**. A property added through a section control appears once you enter a value. Section and property ordering in the panel leaves the note's YAML key order intact.

A regular note's fields save back to that note's YAML. Task-only sections such as **Stats** and **Sessions** require a task. The shared [[DOCS-021 Task Editor#Sections and property rows|section settings]] also control property icons and ordering.

## Edit or add a property

- Select a property to edit it. Supported controls include Text, Number, Checkbox, List, Date, and Date & time. Compatible mapped fields use their Operon picker. A legacy single link in a field mapped to **Contexts**, such as `Up: "[[2026-W46]]"`, appears as one selected item.
- Use **Add Property** in **Additional** to find supported properties. Enter a value to add the field. The first saved property can create frontmatter in a note that has none. Closing a new picker without a value leaves the note intact.
- Clearing a value keeps an existing property visible as an empty row. Use the separate **Remove property** control on an eligible empty field to remove its key from the note.
- Values and mappings that cannot be edited safely remain read-only. If the editor is unavailable for the note, open its source in an Obsidian tab to inspect the YAML.

Use **Shift+Enter** for a line break in **Notes**. See [[DOCS-063 Date and time picker|Date and time picker]] for date controls.

## Convert a note to a File Task

For an eligible note, choose **Convert to Operon File Task** in **Description**. Confirm the conversion and choose a File Task template option. Operon checks the current note and settles pending property edits before applying the conversion. If the conversion succeeds and the task is verified, the same Lightbox switches to Task Editor and keeps the source panel choice.

## Saving and conflicts

Edits save automatically after a short pause. Operon checks the current source before writing and keeps the note body and unrelated changes. Closing, navigating, or transferring the Lightbox settles pending edits first.

If the same property changes in the source during editing, Operon reports the conflict and keeps your draft. Review the source before deciding whether to discard the draft. A failed save also keeps the draft available.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs]]
- [[DOCS-151 Lightbox|Lightbox]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-022 Command palette reference|Command palette reference]]
- [[DOCS-098 Workspace Tweaks|Workspace Tweaks]]
