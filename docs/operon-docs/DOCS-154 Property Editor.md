---
Notes: Edit supported properties of regular Markdown notes from the desktop Lightbox
Icon: list-checks
Color: "#ea580c"
Updated: 2026-11-12T12:42:01+01:00
---

# Property Editor

**Property Editor** lets you edit the frontmatter of an eligible regular Markdown note in the desktop [[DOCS-151 Lightbox|Lightbox]]. It shows the note’s properties in file order and uses Operon’s field pickers.

## Open the editor

1. Open the note in a desktop Lightbox.
2. Choose **Show property editor** on the control rail. Use **Show source** or **Hide source** to choose whether the Markdown body is alongside it.

The panel follows **Task Editor position** under **Settings → Operon → Interface → Task Editor → Layout and opening**. On Obsidian Desktop, an eligible Core Quick Switcher result can open Property Editor directly when the selected opening option includes the editor. See [[DOCS-098 Workspace Tweaks#Core Quick Switcher click behavior|Core Quick Switcher click behavior]].

## Property Editor and Task Editor

Use **Property Editor** for properties of a regular Markdown note, such as an Author or Review Date. Changes are saved to that note’s YAML, and it remains a regular note. Use [[DOCS-021 Task Editor|Task Editor]] for an existing Inline Task or File Task. It presents structured task fields in configurable sections.

## Edit or add a property

- Open a property to edit its value. Available controls include Text, Number, Checkbox, List, Date, and Date & time. Compatible mapped fields can use the corresponding Operon picker.
- Choose **Add Property** to search supported properties known to the vault. Select a field and confirm a value to add it at the end of the note’s property list. The first saved property can create frontmatter in a note that has none.
- Some values are read-only when the source cannot be edited safely, a type conflicts, or a field belongs to task-only data. If the editor is unavailable for the whole note, open its source in an Obsidian tab to inspect the YAML.

See [[DOCS-063 Date and time picker|Date and time picker]] for date controls.

## Saving and conflicts

Edits save automatically after a short pause. Operon checks the current source before writing and keeps the note body and unrelated changes. Closing, navigating, or transferring the Lightbox settles pending edits first.

If the same property changes in the source during editing, Operon reports the conflict and keeps your draft. Review the source before deciding whether to discard the draft. A failed save also keeps the draft available.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs]]
- [[DOCS-151 Lightbox|Lightbox]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-098 Workspace Tweaks|Workspace Tweaks]]
