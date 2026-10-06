---
Notes: The dialog for creating new tasks
Icon: square-pen
Color: "#ea580c"
Updated: 2026-10-06T10:36:57+02:00
---

# Task Creator

The Task Creator is a guided dialog that builds a task for you, so you never have to write the `{{key:: value}}` syntax by hand. It is the safest starting point when you want Operon to walk you through creating a task. This page is the reference; for a step-by-step walkthrough of writing a task and adding fields through pickers, see [[DOCS-094 How to create a task with Task Creator|How to create a task with Task Creator]].

Open it with **Create New Operon Task** from the command palette.

> **MEDIA-DOCS-020-1:** The Task Creator dialog with the title field, inline/file toggle, status, priority, and date fields.

![MEDIA-DOCS-020-1 - Task Creator dialog](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-020-1.png)

## When to reach for it

Use the Task Creator when:

- You do not want to write task syntax by hand.
- You want to create a task from anywhere, not only at the cursor.
- You want to set fields up front, such as status, priority, dates, parent task, estimate, recurrence, or links.

If the task is already written as a line in a note, the faster path is **Create or edit inline task** instead. See [[DOCS-011 Inline tasks|Inline tasks]].

## Create from Canvas or Excalidraw

Select a normal Canvas text card or standalone Excalidraw text, then use the conversion button below it. Task Creator opens with the first source line as the description and the remaining lines as the Note. Review the prepared fields before creating the task and replacing the text with a linked card.

Both surfaces also support **Add Operon task** from a connection ending in empty space. In Excalidraw, this applies to a newly drawn arrow from an Operon task card. The starting task is prepared as parent, with configured inheritance shown before creation. You can change or clear that parent in Task Creator.

Excalidraw additionally provides a Task Creator toolbar shortcut and **Create task in Excalidraw** command. The normal Inline/File choice, templates, destination, and parent rules still apply. When the drawing is a File Task and the creation rules supply it as parent, review that parent and its inheritance indicators in the draft.

Use [[DOCS-148 Canvas and Excalidraw Task Pool|Canvas and Excalidraw Task Pool]] to add existing tasks instead of creating new ones. For the surface-specific steps and Undo behavior, see [[DOCS-141 Canvas Task Cards|Canvas Task Cards]] and [[DOCS-147 Excalidraw Task Cards|Excalidraw Task Cards]].

## What you choose

Give the task a clear title, then choose its shape:

- **Inline task** if it belongs inside a note or capture target. See [[DOCS-011 Inline tasks|Inline tasks]].
- **File task** if the work needs its own Markdown file and a body. See [[DOCS-013 File tasks|File tasks]].

From there you can set the fields that matter. For a first task, a title, status, priority, and maybe a date are plenty. Contexts, assignees, recurrence, parent links, icons, and colors can wait. The field names follow the canonical set described in [[DOCS-012 Inline task syntax|Inline task syntax]].

Date and Date & time controls show their selected task date using **Settings → Operon → Core → General → Language & Formats → Date format**. This changes only what you see in the creator; the task is still saved with canonical ISO date values. The picker, its fixed display options, and natural-language input are covered in [[DOCS-063 Date and time picker|Date and time picker]].

Task Type, Task Image, and Task Gallery use the shared task-data picker. Task Type stores one classification, Task Image stores one media reference, and Task Gallery keeps several references in order. See [[DOCS-018 Task properties|Task properties]] and [[DOCS-138 Task images and galleries|Task images and galleries]].

## Setting reminders while you create

The toolbar carries a button for each kind of reminder, **ReminderDatetimes** for a fixed moment and **ReminderRules** for an offset from one of the task's dates. Reminders you add before saving appear as chips in the creator, and you can click one to change or remove it before the task exists. See [[DOCS-116 Reminders|Reminders]].

Two things worth knowing:

- **Both buttons are hidden by default.** Turn them on in **Settings → Operon → Interface → Task Chips**, on the **Task Creator Toolbar** subpage, which is also where you order the toolbar.
- **The rule button stays disabled until the task has a date**, because a rule counts back from one of the task's own dates. Set a due, scheduled, or start date, or a timed block, first, and it becomes available.

If you would rather not set reminders during capture at all, leave the buttons off and add reminders later from the [[DOCS-021 Task Editor|Task Editor]] or directly from a task's chips.

## Default to file tasks

Task Creator starts in Inline mode by default, but you can make it open in File mode instead. This is useful if most of your work lives as notes with frontmatter and a body, and you do not want to switch from Inline to File every time.

Turn on **Default to File Task in Task Creator** in **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**. In the same section, **Default file task template** can preselect the template Task Creator uses when it enters File mode. Leave the template setting empty if you still want Task Creator to ask you to pick a template each time.

## Where the task lands

When you save, an inline task follows your [[DOCS-136 Task Router|Task Router]] destination and parent-placement rules. **Ask Every Time** opens a compact searchable picker with the active file, parent location, recent targets, and frequently used files first. Cancelling the picker keeps your draft. A file task is created in your configured file-task location. See [[DOCS-008 Essential settings to configure first|Essential settings to configure first]] for the initial setup.

> **MEDIA-DOCS-020-2:** The Task Creator in inline-task mode (with Parent task selection), showing where the new note will be created.

![MEDIA-DOCS-020-2 - Task Creator inline task mode](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-020-2.png)

## After creating

Open the new task in the [[DOCS-021 Task Editor|Task Editor]] to see its structured fields, or recover it later with [[DOCS-027 Task Finder|Task Finder]]. If you picked the wrong shape, you can convert between inline and file forms at any time. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## FAQ

**Do I have to fill every field?** No. A title is enough to start. Add structure when it helps you find, plan, or act on the work.

**Can I create a task while reading another note?** Yes. The Task Creator works from anywhere, which is its main advantage over editing a line in place.

**Can Task Creator open in File mode by default?** Yes. Enable **Default to File Task in Task Creator** under **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**.

**Where are the reminder buttons?** Hidden by default. Turn them on in **Settings → Operon → Interface → Task Chips**, on the **Task Creator Toolbar** subpage.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-009 Create your first task|Create your first task]]
- [[DOCS-022 Command palette reference|Command palette reference]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
