---
Notes: The dialog for creating new tasks
Icon: square-pen
Color: "#ea580c"
Updated: 2026-10-26T12:23:25+01:00
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

Description and Note support default and colored highlights. In the Live Preview-style editor, the active highlight keeps Obsidian's color control where supported; the saved Markdown retains its color marker. See [[DOCS-113 Text field editor popover|Text field editor popover]] for the six colors and plain-text syntax.

### Custom keys and normal properties

Eligible active [[DOCS-040 Custom keys|Custom Keys]] can be offered before they have been used in a note. Supported normal Obsidian properties used in the vault remain available, and fields supplied by the selected template or already in your draft are retained. A deleted, unused custom key does not return solely because its old type declaration still exists. Surface visibility and supported-type rules still apply.

Custom fields use their configured icon, including when a template exposes them through a native property control. Without a configured icon, the type icon is used. Checkbox value indicators and genuine read-only warnings keep their own meaning. See [[DOCS-115 File task property columns|Vault Properties]] for native property controls.

## Review a template before creating

Both **Inline** and **File** mode can prepare a template's properties in Task Creator. Choose the template with the bottom selector, which displays its selected name. The template suggestion in the description's field menu says **Pick a Template**.

The prepared fields include empty properties as well as filled ones: an empty date is a place to add a date, while `false` and `0` are real values. Open supported fields to edit or remove them before creating the task. Canonical fields, mapped Custom keys, and supported Vault Properties can participate; see [[DOCS-018 Task properties|Task properties]] for their differences. Unavailable or unsupported fields have limits described in [[DOCS-150 Using inline task templates|Using inline task templates]]; the preview is not an unrestricted frontmatter editor.

Changing templates refreshes values supplied only by the template. Values you deliberately edited, and fields you deliberately removed, remain your choices. For example, changing a template's Budget from 100 to 200 does not replace a Budget you already set to 250. Untouched fields supplied only by the previous template disappear when it no longer supplies them; deliberate edits and removals remain protected. Switching Inline/File applies that mode's default template while retaining deliberate field edits.

For template-heavy capture, keep only frequently used controls permanently enabled in **Interface → Task Chips → Task Creator Chips**. Template properties appear for the current draft, including empty ones, without changing your saved chip preferences. See [[DOCS-150 Using inline task templates|Using inline task templates]] for a complete example.

Simply opening Creator or switching Inline/File does not count as an unsaved edit. Editing Description/Note, changing a field, or deliberately choosing a different template can require confirmation when closing.

## Setting reminders while you create

The toolbar carries a button for each kind of reminder, **ReminderDatetimes** for a fixed moment and **ReminderRules** for an offset from one of the task's dates. Reminders you add before saving appear as chips in the creator, and you can click one to change or remove it before the task exists. See [[DOCS-116 Reminders|Reminders]].

Two things worth knowing:

- **Both permanent controls are hidden by default.** A prepared template can still expose its reminder fields for the current draft. Turn them on in **Settings → Operon → Interface → Task Chips**, on the **Task Creator Chips** subpage, which is also where you order the toolbar.
- **The rule button stays disabled until the task has a date**, because a rule counts back from one of the task's own dates. Set a due, scheduled, or start date, or a timed block, first, and it becomes available.

If you would rather not set reminders during capture at all, leave the buttons off and add reminders later from the [[DOCS-021 Task Editor|Task Editor]] or directly from a task's chips.

## Default to file tasks

Task Creator starts in Inline mode by default, but you can make it open in File mode instead. This is useful if most of your work lives as notes with frontmatter and a body, and you do not want to switch from Inline to File every time.

Turn on **Default to File Task in Task Creator** in **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**. In the same section, **Default file task template** can preselect the template Task Creator uses when it enters File mode. Leave the template setting empty if you still want Task Creator to ask you to pick a template each time.

## Inline and dynamic defaults

Set **Default inline task template** under **Tasks → Inline Tasks** independently of **Default file task template** under **Tasks → File Tasks**. Each has its own **Use last used template as default** toggle, initially off. When enabled, a successfully created task in Creator updates only that mode's saved default. Merely choosing a template, cancelling, or switching modes does not update it. Other flows that consume that default then use its new value; they do not all open Creator. See [[DOCS-150 Using inline task templates|Using inline task templates]] for cancellation, template-free creation, and save-failure details.

## Where the task lands

When you submit, an inline task follows your [[DOCS-136 Task Router|Task Router]] destination and parent-placement rules. With **Ask Every Time**, Creator closes while a compact searchable picker asks for the target, with the active file, parent location, recent targets, and frequently used files first. Cancelling the picker returns you to the preserved draft. A file task is created in your configured file-task location. See [[DOCS-008 Essential settings to configure first|Essential settings to configure first]] for the initial setup.

> **MEDIA-DOCS-020-2:** The Task Creator in inline-task mode (with Parent task selection), showing where the new note will be created.

![MEDIA-DOCS-020-2 - Task Creator inline task mode](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-020-2.png)

## Mobile controls and desktop focus

On mobile, property icons wrap onto additional rows instead of requiring horizontal scrolling. Their sizes and existing Inline/File template previews stay the same; controls and pickers remain within the available keyboard viewport. The bottom template selector keeps its normal behavior in both modes.

On desktop, Creator uses the shared [[DOCS-098 Workspace Tweaks|Background dimming]] preference while preserving its size, scrolling, pickers, and discard confirmation. It does not gain Lightbox side controls, and its own editing fields do not become preview links.

## After creating

Once a valid **Inline** or **File** submission is accepted, Task Creator closes immediately. Creation continues in the background, and the normal completion notice still appears. Closing the window at this point means the request has started, not that the task has already been saved. Required fields and template checks still apply before submission.

If creation fails, the entered draft remains available to correct or retry; an uncertain write is not automatically retried. If you have already opened a newer Creator, the earlier result does not close or overwrite it. A draft awaiting restoration is shown after the newer Creator has left.

### Choose what opens after creation

File and Inline Tasks have independent opening preferences, both initially **Do Not Open**:

- **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults → After Creating a File Task**
- **Settings → Operon → Tasks → Inline Tasks → New Inline Task Creation Defaults → After Creating an Inline Task**

The dropdowns offer these six choices in order:

| File Task option | Inline Task option | Result after successful creation |
| --- | --- | --- |
| Do Not Open | Do Not Open | Create the task without opening its source or editor |
| Source File (Lightbox) | Source File (Lightbox) | Preview the task’s source in a lightbox |
| Source File + Task Editor (Lightbox) | Source File + Task Editor (Lightbox) | Open the source alongside the task’s structured fields |
| Task Editor (Lightbox) | Task Editor (Lightbox) | Open the task’s structured fields without the source panel |
| New Tab (Focused) | Source in New Tab (Focused) | Open a new source tab and switch to it |
| New Tab (Background) | Source in New Tab (Background) | Open a new source tab without switching focus to it |

For an Inline Task, the source is the note containing the task, not a separate task file. Supported source openings locate the newly created task’s line. Lightbox options use the desktop [[DOCS-151 Lightbox|Lightbox]] and [[DOCS-021 Task Editor|Task Editor]] surfaces; mobile retains its supported source-navigation and editor behavior.

These preferences apply to tasks submitted through Task Creator, wherever you opened it. They do not change automatic creation, API/CLI creation, or commands that create tasks without going through Creator. They also do not change where the task is saved or the opening preferences used when clicking an existing task elsewhere.

Opening is attempted only after successful creation. If opening fails, the created task remains saved and Operon reports the opening problem; do not create it again just to open it. With **Do Not Open**, find it later using [[DOCS-027 Task Finder|Task Finder]] or open its [[DOCS-021 Task Editor|Task Editor]].

If you picked the wrong shape, you can convert between inline and file forms at any time. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## FAQ

**Do I have to fill every field?** No. A title is enough to start. Add structure when it helps you find, plan, or act on the work.

**Can I create a task while reading another note?** Yes. The Task Creator works from anywhere, which is its main advantage over editing a line in place.

**Can Task Creator open in File mode by default?** Yes. Enable **Default to File Task in Task Creator** under **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**.

**The window closed before the creation notice. Is that expected?** Yes. Creator closes as soon as a valid submission starts, while the task is created in the background. If a destination picker appears, finish that choice to continue.

**Where are the reminder buttons?** Their permanent controls are hidden by default; templates may expose them in the draft. Turn them on in **Settings → Operon → Interface → Task Chips**, on the **Task Creator Chips** subpage.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-009 Create your first task|Create your first task]]
- [[DOCS-022 Command palette reference|Command palette reference]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
