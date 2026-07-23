---
Notes: The dialog for editing every task field
Icon: square-pen
Color: "#ea580c"
Updated: 2026-07-23T16:45:34
---

# Task Editor

The Task Editor is where you view and change a task's structured fields without editing Markdown by hand. It works the same for inline and file tasks, because both are the same kind of task record underneath.

> **MEDIA-DOCS-021-1:** The Task Editor open on a task, showing its fields and, for a file task, the Markdown body.

![MEDIA-DOCS-021-1 - Task Editor fields and Markdown body](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-021-1.png)

## How to open it

- On an existing inline task, run **Create or edit inline task**.
- On a file task or a note with task fields, run **Edit or convert to file task**.
- From any Operon surface, open a task's contextual menu and choose **Open editor**. See [[DOCS-042 Contextual menu actions|Contextual menu actions]].

The same command that creates an inline task also edits one, so the editor is never more than a keystroke away from the task.

> **MEDIA-DOCS-021-2:** Opening the Task Editor from a task's contextual menu with Open editor.

![MEDIA-DOCS-021-2 - Open Task Editor from contextual menu](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-021-2.png)

## What you can change

The Task Editor exposes the canonical fields as proper controls:

- Status and priority.
- Dates: due, scheduled, started, and timed start/end blocks.
- Parent task and dependencies.
- Recurrence. See [[DOCS-033 Recurring tasks|Recurring tasks]].
- Reminders, both kinds. See [[DOCS-116 Reminders|Reminders]].
- Pinning. See [[DOCS-032 Pinned Task Dock|Pinned Task Dock]].
- Time tracking, including session history. See [[DOCS-034 Time tracking|Time tracking]].
- Icon, color, and a short note.

For a file task, the editor can also show the Markdown body alongside the fields, so you edit the work and its metadata together. For an inline task, it can reveal the source note when you need the surrounding context. It can also **Show checkboxes** for the task's [[DOCS-017 Plain checkbox lists|plain checklist]].

> **MEDIA-DOCS-021-3:** The Task Editor on a file task, the fields beside the Markdown body.

![MEDIA-DOCS-021-3 - Task Editor file task layout](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-021-3.png)

## Parent and subtask cards

When a task has a parent, its own direct subtasks, or both, the editor shows them as small cards near the top, above the fields, so you can see the immediate family without leaving the task you opened. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

- A **parent card** is navigation only. Click it to open the parent's own editor; there is nothing to complete from here.
- A **subtask card** for an open subtask offers a **complete** action on hover or keyboard focus, so you can check off a direct subtask without leaving the parent task's editor. A finished or cancelled subtask's card has no such action.

This shows only **direct** parent and children. For a task's whole subtree, run **Subtasks** from its contextual menu to open the [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]] instead.

## Reminder rows

Reminders get their own rows, one for **ReminderDatetimes** and one for **ReminderRules**, and they behave a little differently from a single-value field. Each reminder on the task appears as its own chip in the row, so a task with three reminders shows three chips rather than one crowded value.

- **Add** one from the row's own control, which opens the picker for that kind of reminder.
- **Edit or remove** one by clicking its chip, which reopens the same picker loaded with that reminder.
- The **ReminderRules** control is **disabled when the task has no date a rule could attach to**, since there would be nothing for an offset to count back from. Give the task a due, scheduled, or start date, or a timed block, and it becomes available.

Both rows are **hidden by default.** Turn them on in **Settings → Operon → Interface → Task Editor**, under **Workflow Pickers**, which is also where you set the order of the editor's picker rows. Hiding a row never changes the reminders stored on a task. See [[DOCS-116 Reminders|Reminders]].

## Saving is automatic

The Task Editor autosaves your changes two seconds after your last edit, so you do not press a save button while working through a task's fields. Closing the editor, with its close control, a keyboard shortcut, or the backdrop, saves any pending change immediately rather than waiting out that two seconds. This timing is fixed and not a setting.

## Why edit here instead of in Markdown

You can always edit the raw `{{key:: value}}` text, and Operon will read it. But the Task Editor is safer: it writes fields in the right format, keeps `operonId` intact, and updates rollups and links for you. Hand-editing is best for quick text tweaks; the editor is best for anything structural. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

## FAQ

**Is the editor different for inline and file tasks?** The fields are the same. File tasks additionally show the note body; inline tasks can jump to their source line.

**Will editing here change my Markdown?** Yes. The Task Editor writes back to the task's Markdown, inline line or file frontmatter, so your notes stay the source of truth.

**Do I need to save before closing the Task Editor?** No. It autosaves two seconds after your last edit, and closing it saves any pending change right away.

**Why can I not add a reminder rule to this task?** A rule counts back from one of the task's dates, and this task has none yet. Add a due, scheduled, or start date, or a timed block, first.

**I do not see reminder rows in the editor.** They are hidden by default. Turn them on under **Settings → Operon → Interface → Task Editor**, in **Workflow Pickers**.

## Settings

Operon settings for this live in **Settings → Operon → Interface → Task Editor**, which configures the Task Editor layout and which fields it shows.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]]
