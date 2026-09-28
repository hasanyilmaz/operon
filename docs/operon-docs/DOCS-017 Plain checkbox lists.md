---
Notes: Lightweight checklists inside a task or file, how they are parsed, and how they move on conversion
Icon: list-checks
Color: "#7c3aed"
Updated: 2026-09-28T16:40:18+02:00
---

# Plain checkbox lists

Every Operon task can carry its own list of plain Markdown checkboxes. This is a lightweight hierarchy layer that sits below the task: a quick checklist of steps that do not each need to be a full task. Both inline tasks and file tasks can have one, and the checkboxes always live in Markdown, in the same file.

> **MEDIA-DOCS-017-1:** A task showing a small checkbox-progress indicator, with the checkbox popover open beside it.

<iframe
  title="MEDIA-DOCS-017-1 - Checkbox hierarchy video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/AOE4Z_qBspw"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## Two scopes

Where the checkboxes live depends on the task shape:

- **Inline task**: the uninterrupted block of plain checkbox lines immediately after that inline task. Each inline task keeps its own list even when several sit in the same note.
- **File task**: the plain checkbox lines in the file body. The whole note is the task, so its body is where the checklist lives.

In both cases these are ordinary `- [ ]` Markdown checkboxes. They have no `operonId`, no fields, and no presence in filters or Calendar of their own. That is the point: they are simple sub-steps, not tasks.

## How checkboxes are parsed

Operon decides which checkboxes belong to which task by reading the note from top to bottom. The rules are few and, once you know them, the layout is predictable. This is exactly what the popover gathers when you open it on a task.

- **An inline task owns the checkbox block immediately after it.** The first blank or whitespace-only line, heading, ordinary text, fenced code block, or another Operon task ends that block. Later checkboxes do not return to the earlier task. A line with Operon fields but no `operonId` also ends the block without becoming an owner.
- **Indentation does not break the block.** Checkbox lines at the same, deeper, or shallower indentation still belong to the task while they remain consecutive. You can keep a nested checklist without changing its owner.
- **A file task's checkboxes are the ones in its note body.** Because the whole note is the task, the plain checkboxes anywhere in its body are its list. The frontmatter is skipped.
- **Several list styles count as a checkbox.** A line is read as one whether it starts with `-`, `*`, `+`, or a number such as `1.` or `1)`, as long as it carries the `[ ]` box.
- **Any mark means done.** An empty box `[ ]` is open; a box with anything inside it, such as `[x]`, `[/]`, or `[-]`, is treated as complete.
- **Code blocks are ignored.** Checkbox-looking lines inside a fenced code block are skipped, so an example in your writing is never mistaken for a real checklist item.
- **Checkboxes have no identity.** They carry no `operonId` and no fields, and they never surface in filters or the Calendar. They exist only as sub-steps of the task that owns them.

> **MEDIA-DOCS-017-2:** A note where two inline tasks each own the checkbox block beneath them, with the boundary at the second task line.

![MEDIA-DOCS-017-2 - A note where two inline tasks each own the checkbox block beneath them, with the boundary at the second task line](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-017-2.png)

Checkbox lists and progress counts use this scope for existing notes too. Operon recalculates them without rearranging the note or rewriting its contents.

## When you convert an inline task to a file task

When you convert an inline task into a [[DOCS-013 File tasks|file task]], Operon can **move its uninterrupted checkbox block into the new note**, placing it at the top of the file task body and removing those checkbox lines from the source. Checkboxes outside that block, subtasks, and their checklists stay in place.

This is controlled by **Move checkboxes when converting inline tasks** (Settings → Operon → Tasks → File Tasks), which is on by default. Turn it off if you would rather leave the checkboxes where they were. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## The checkbox popover

You edit the list through a small popover editor rather than scrolling to the lines by hand. Open it with the **Checkboxes** action in the [[DOCS-042 Contextual menu actions|contextual menu]] of a task. Inside the popover you can:

- **Add checkbox** a new line.
- Edit the **checkbox text**.
- Toggle items complete.
- **Move** the editor, or **close** it when done.

Changes are written straight back to the Markdown. If the file changes underneath an open editor, Operon asks you to reopen it before saving so edits never collide.

## Where you can open it

The checkbox popover is reachable from several surfaces, so you rarely have to leave what you are doing:

- The **Checkboxes** action in the contextual menu.
- The **Open checkboxes** chip in [[DOCS-025 Filter View|filter]] rows, which also shows checklist progress.
- [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlays]], via the **Open checkboxes** action.
- The **Show checkboxes** view in the [[DOCS-021 Task Editor|Task Editor]].

## Progress rollup

A task with checkboxes shows how far along the list is: not started, a percent complete, or complete. This gives you a sense of a task's internal progress without opening it, and without turning every sub-step into its own task.

> **MEDIA-DOCS-017-3:** A task's checkbox progress.

![MEDIA-DOCS-017-3 - A task's checkbox progress](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-017-3.png)

## Checkboxes or subtasks?

Operon gives you two ways to break a task down, and they are not the same layer:

- **Plain checkboxes**: quick, in-file steps with no identity. Best for a short checklist inside one task.
- **Subtasks**: full Operon tasks with their own `operonId`, fields, scheduling, and views. Best when a step deserves to be tracked, scheduled, or found on its own. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

Reach for checkboxes when you just need to tick things off. Reach for subtasks when a step is real work in its own right.

When you convert an owned checkbox into an inline task, its owner becomes the parent. The converted line stays in place and starts its own checkbox block. Creating a new subtask beneath a parent is different: Operon inserts it after the parent’s checkbox block so the checklist keeps its owner. See [[DOCS-023 Create tasks from selected text|Create tasks from selected text]] for converting several lines together.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-013 File tasks|File tasks]]
- [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]
