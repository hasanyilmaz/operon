---
Notes: Command that removes a task from Operon while keeping its plain Markdown content
Icon: unlink
Color: "#475569"
Updated: 2026-08-15T10:34:43
---

# Convert task to plain

**Convert task to plain** removes an existing Operon task from Operon while keeping its useful Markdown content. It is for the moment a task no longer needs Operon's identity, fields, views, scheduling, or tracking, but you want to keep it as an ordinary checkbox or note.

This is different from [[DOCS-019 Converting inline and file tasks|converting inline and file tasks]], which changes a task's container while preserving its `operonId` and task identity. Convert task to plain deliberately removes that identity.

## How it works

Run **Convert task to plain** from the command palette. [[DOCS-027 Task Finder|Task Finder]] opens so you can choose the task. It includes inline and file tasks, including completed and cancelled tasks.

The command then follows the selected task's shape:

- **Inline task:** shows a confirmation, then turns the line into a plain Markdown checkbox.
- **File task:** opens a property picker so you choose which managed Operon properties to remove. The file itself stays in your vault as a normal note.

## Before you start

Close the [[DOCS-021 Task Editor|Task Editor]] before running the command. If the source note is open, save it first. Operon stops rather than overwriting an unsaved source buffer or a task source that changed while the command was open.

Some task states must be removed before a task can leave Operon:

- a parent task link
- direct subtasks
- blocking or blocked-by dependencies
- an active timer
- active recurrence or a recurrence series
- reminder dates or reminder rules

The command names every blocker it finds. It does not remove relationships, stop timers, or clear recurrence and reminders for you. Resolve those states first, then run the command again.

## Convert an inline task to a plain checkbox

After you choose an inline task, Operon explains that the change is permanent and asks you to confirm. The resulting line keeps its indentation, checkbox state, description, and tags:

```md
Before:
  - [x] Send the draft #release {{operonId:: abc1234}} {{status:: Project.Done}} {{priority:: A}}

After:
  - [x] Send the draft #release
```

Open tasks stay `- [ ]`, completed tasks stay `- [x]`, and cancelled tasks stay `- [-]`. The time prefix, `operonId`, canonical and custom task fields, and other Operon metadata containers are removed. The line remains ordinary Markdown, but it is no longer an Operon task.

## Convert a File Task to a plain file

After you choose a file task, **Convert to plain file** opens a searchable list of managed properties that are physically present in that file. `operonId` is selected and locked because removing it is what detaches the file from Operon. Other managed properties begin unselected, so you choose exactly what to remove.

The picker lists only current Operon-managed built-in, key-mapped, custom, and internal properties. It does not list ordinary vault properties. When you select properties and choose **Remove selected**, Operon removes the selected property names and their recognized aliases together in one operation.

The note is not deleted, moved, or renamed. Its body, tags, unmanaged properties, and managed properties you leave unselected stay as they are. After `operonId` is removed, the note is an ordinary Markdown note rather than a File Task.

## What happens after conversion

After a successful conversion, the task no longer appears in Operon task surfaces because it no longer has an Operon identity. Operon also removes its pin if it was pinned.

The command fails closed when the task is missing, has a duplicate `operonId`, its source changes, or a required write cannot be confirmed. Review the notice, save or resolve the reported condition, and try again. There is no Undo promise for removing Operon metadata; keep a copy first if you may need the original task record.

## When to use the other conversion command

Use [[DOCS-088 Convert file task to inline task|Convert file task to inline task]] when you want to keep the same Operon task but collapse its File Task note into an inline task. That command preserves the `operonId` and fields, then moves the old note to trash. Use **Convert task to plain** when you want to keep an ordinary checkbox or note and stop managing it in Operon.

## FAQ

**Does this delete my note?** No. Converting a File Task to a plain file keeps the note, its body, tags, unmanaged properties, and any managed properties you leave unselected. Only [[DOCS-088 Convert file task to inline task|Convert file task to inline task]] moves the old note to trash.

**Will the task still appear in Operon?** No. Removing `operonId` removes the task's Operon identity, so it no longer appears in Operon views, Task Finder, Calendar, Kanban, filters, or pinned tasks.

**Can I keep some File Task properties?** Yes. In the File Task picker, only `operonId` is required. Other managed properties begin unselected and remain as ordinary frontmatter when you leave them unselected.

**Why can't I convert a task with subtasks, dependencies, recurrence, reminders, or a running timer?** Those states rely on the task's Operon identity. Resolve them first so the command does not leave broken task relationships or active automation behind.

**Can I undo the conversion?** Operon does not provide an Undo action for this command. Keep a copy first if you may need the original Operon metadata later.

**Why must I close Task Editor and save the source note first?** The command only changes a current, saved source. This avoids overwriting an open edit or converting a task whose source changed while you were choosing it.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]
- [[DOCS-015 Task identity and operonId|Task identity and operonId]]
- [[DOCS-022 Command palette reference|Command palette reference]]
