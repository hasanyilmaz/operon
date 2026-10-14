---
Notes: The dialog for editing every task field
Icon: square-pen
Color: "#ea580c"
Updated: 2026-10-14T11:54:38+02:00
---

# Task Editor

The Task Editor is where you view and change a task's structured fields without editing Markdown by hand. Inline and File tasks share the structured editing workflow. The available source-body controls and layout depend on the device and selected editor layout.

> **MEDIA-DOCS-021-1:** The Task Editor open on a task, showing its fields and, for a file task, the Markdown body.

![MEDIA-DOCS-021-1 - Task Editor fields and Markdown body](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-021-1.png)

## How to open it

- On an existing inline task, run **Create or edit inline task**.
- On a file task or a note with task fields, run **Edit or convert to file task**.
- From any Operon surface, open a task's contextual menu and choose **Open editor**. See [[DOCS-042 Contextual menu actions|Contextual menu actions]].

From a [[DOCS-141 Canvas Task Cards|Canvas Task Card]], select the card and use **Open editor**, or choose it from the task icon's contextual menu. From an [[DOCS-142 Embedded Task Cards|Embedded Task Card]] in a note, click the task title.

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
- Icon, color, and a Note that can contain multiple lines.
- Task Type as a user-managed Text classification.
- Task Image as one media reference and Task Gallery as an ordered list. See [[DOCS-138 Task images and galleries|Task images and galleries]].

On desktop and tablet, the editor can show a File Task’s Markdown body or an Inline Task’s source note. With enough room the body can sit beside the fields; a narrow layout uses a panel. On phones, the body button and embedded body panel are unavailable in both editor layouts; task properties remain editable. It can also **Show checkboxes** for the task's [[DOCS-017 Plain checkbox lists|plain checklist]].

The editor's Date and Date & time controls follow **Settings → Operon → Core → General → Language & Formats → Date format** for their visible date part, while timed values also follow the separate **Time format** setting. This does not change the value passed to the picker or written back to Markdown; task dates remain canonical ISO values. See [[DOCS-063 Date and time picker|Date and time picker]].

> **MEDIA-DOCS-021-3:** The Task Editor on a file task, the fields beside the Markdown body.

![MEDIA-DOCS-021-3 - Task Editor file task layout](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-021-3.png)

## Sections and property rows

The desktop-style editor organizes work into sections, with property names and values presented as rows. Under **Interface → Task Editor → Sections and Order**, configure section names, visibility, and order. **Property Visibility & Order** controls the configured property rows. These desktop preferences also apply to tablets and to phones using the desktop-style layout.

Open an editable property's name or value to use its control. On a mouse, the row's interactive styling helps show the target; on touch, action and clear controls remain accessible without hovering. Visibility settings change the presentation, not the stored task values.

### Additional properties

**Additional** exposes supported Vault Properties on the current task alongside the mapped fields. It also works in the desktop-style phone layout even though the embedded body is unavailable. Use the section's add control for supported properties and each value's control to edit it. Unassigned Automatic types, unsupported values, and conflicts can remain read-only or unavailable; not every frontmatter value is a writable field. See [[DOCS-018 Task properties|Task properties]], [[DOCS-070 Custom field pickers|Custom field pickers]], and [[DOCS-115 File task property columns|Vault Properties]].

Checkbox property icons reflect their value: **true** uses a checked box, **false** an empty box. An unset checkbox uses its configured property icon, whose default is a dashed square. Existing custom icon choices are retained for that unset state; true/false indicators are automatic.

## Finish the current task

In the desktop-style layout, the action immediately before the Description copy controls completes the current task. Its icon follows the current pipeline status icon when one is configured, otherwise the task-state fallback; it uses the editor's action styling. The tooltip says **Click to finish** until completion. Clicking a completed task again does nothing—it does not reopen it or cycle statuses.

This uses the normal completion rules, including applicable workflow and recurrence behavior. It is separate from opening the status picker to choose an arbitrary status.

## Sessions in the editor

The **Sessions** section shows recorded time ranges. In the desktop-style layout, click or tap either a session's duration or its pencil to open the same **Edit session** window. With a mouse, the duration has an underline on hover; touch does not require that hover first. See [[DOCS-053 Time session history|Time session history]] for corrections and other entry points.

## Phone and tablet layouts

Phones use the desktop-style editor by default. To use the existing compact mobile editor instead, enable **Mobile → Task Editor → Use mobile Task Editor on phones**. The choice applies when the next editor opens; an already open editor keeps its layout. The compact layout retains its own mobile toolbar and workflow preferences.

Tablets always use the desktop-style layout. Its touch controls stay the same size when a mouse or trackpad is attached. On phone and tablet, property names move above values when the main editing panel is 420 px wide or narrower; a wider panel uses two columns. This follows the panel width, including a tablet's split view or a body panel beside the fields. See [[DOCS-101 Mobile General|Mobile General]] for the device comparison.

## Copy a task wikilink

Use **Copy task wikilink**, the **file-box** button at the left of the header's copy controls, to copy a link to the current task. Paste it wherever you want to refer to that task. It copies a link, not a new task or a Task Card embed.

A File Task uses a normal note link. An Inline Task adds its Operon ID to the source note's name, using the Task Wikilink Overlay link format:

```md
[[Project plan]]
[[Daily notes#-abc1234]]
```

The first example links to a File Task named `Project plan`. The second links to the inline task with ID `abc1234` in `Daily notes`. Operon copies the current task's actual note name and ID for you.

## Copy a task card into a note

Use **Copy task card embed**, beside Copy operonId, to copy a ready-to-paste block for the current task. Paste it into a note to display an interactive card in Live Preview and Reading view. The block includes the existing task ID and current card layout options; it does not create another task.

The task must be indexed with a valid, unique ID. The original Copy operonId control still copies only the ID. For local width, alignment, text wrapping, and visibility options, see [[DOCS-142 Embedded Task Cards|Embedded Task Cards]].

## Parent and subtask cards

When a task has a parent, its own direct subtasks, or both, the editor shows them as small cards near the top, above the fields, so you can see the immediate family without leaving the task you opened. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

- A **parent card** is navigation only. Click it to open the parent's own editor; there is nothing to complete from here.
- A **subtask card** for an open subtask offers a **complete** action on hover or keyboard focus, so you can check off a direct subtask without leaving the parent task's editor. A finished or cancelled subtask's card has no such action.

Date chips shown on these parent and subtask cards use the same General **Date format** as the editor fields. Their urgency color and the task data behind them still use the original canonical date, so changing the display format does not change scheduling or date comparisons.

This shows only **direct** parent and children. For a task's whole subtree, run **Subtasks** from its contextual menu to open the [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]] instead.

## Remove a task without broken relationships

The Task Editor's **Remove** action deletes the selected task and cleans references to it as one guarded operation. The confirmation names how many surviving direct subtasks will become root tasks before you continue.

- Each surviving direct child's `parentTask` field is cleared; the child's other fields and identity stay unchanged.
- A grandchild remains attached to its own direct parent, so only the deleted level of the tree is detached.
- Surviving tasks remove the deleted id from their **Blocking** and **Blocked By** fields.
- Removing an inline task leaves its source line empty. Removing a file task uses Obsidian's trash behavior; tasks that disappear with that file do not need a separate relationship rewrite.

Operon stops before deleting anything when it cannot safely match the current task and affected sources, including duplicate identities or changes made after the confirmation was prepared. Review the task and try again after resolving the conflict rather than expecting a partial cleanup.

## Reminder rows

Reminders get their own rows, one for **ReminderDatetimes** and one for **ReminderRules**, and they behave a little differently from a single-value field. Each reminder on the task appears as its own chip in the row, so a task with three reminders shows three chips rather than one crowded value.

- **Add** one from the row's own control, which opens the picker for that kind of reminder.
- **Edit or remove** one by clicking its chip, which reopens the same picker loaded with that reminder.
- The **ReminderRules** control is **disabled when the task has no date a rule could attach to**, since there would be nothing for an offset to count back from. Give the task a due, scheduled, or start date, or a timed block, and it becomes available.

Both rows are **hidden by default.** Turn them on in **Settings → Operon → Interface → Task Editor**, under **Property Visibility & Order**, which is also where you set the order of the editor's picker rows. Hiding a row never changes the reminders stored on a task. See [[DOCS-116 Reminders|Reminders]].

## Saving is automatic

The Task Editor autosaves your changes two seconds after your last edit, so you do not press a save button while working through a task's fields. Closing the editor, with its close control, a keyboard shortcut, or the backdrop, saves any pending change immediately rather than waiting out that two seconds. This timing is fixed and not a setting.

## Description and Notes

The **Description** is the task's one-line title. **Notes** are a separate multiline field for the detail that belongs with the task but does not belong in its title. In the Notes control, use **Shift+Enter** to insert a line break; pasted multiline text and intentional blank lines are kept. Normal **Enter** keeps the existing action for the surface instead of becoming a second line-break command. On phones, normal Enter keeps its one-line behavior by inserting a space, while Shift+Enter inserts a note line break.

For an inline task, those visual line breaks are stored as `\n` escapes inside the `note` field, keeping the entire task on one physical Markdown line. A literal `\n` is written as `\\n`. See [[DOCS-012 Inline task syntax|Inline task syntax]] for the on-disk form and [[DOCS-113 Text field editor popover|Text field editor popover]] for the shared compact editor.

Default and six-color highlights retain their source Markdown. In the Live Preview-style editor, editing a colored highlight exposes Obsidian's color control where supported, rather than hiding it as a read-only display would. Phone textareas can edit the source syntax directly. See [[DOCS-113 Text field editor popover|Text field editor popover]] for the color markers and examples.

## Why edit here instead of in Markdown

You can always edit the raw `{{key:: value}}` text, and Operon will read it. But the Task Editor is safer: it writes fields in the right format, keeps `operonId` intact, and updates rollups and links for you. Hand-editing is best for quick text tweaks; the editor is best for anything structural. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

## FAQ

**Is the editor different for inline and file tasks?** Both use structured fields. Desktop and tablet also support embedded source/body editing; phones do not show the body button or panel in either layout.

**Will editing here change my Markdown?** Yes. The Task Editor writes back to the task's Markdown, inline line or file frontmatter, so your notes stay the source of truth.

**Do I need to save before closing the Task Editor?** No. It autosaves two seconds after your last edit, and closing it saves any pending change right away.

**Why can I not add a reminder rule to this task?** A rule counts back from one of the task's dates, and this task has none yet. Add a due, scheduled, or start date, or a timed block, first.

**I do not see reminder rows in the editor.** They are hidden by default. Turn them on under **Settings → Operon → Interface → Task Editor**, in **Property Visibility & Order**.

**Can I write a multiline description?** No. The Description remains the task's one-line title. Use Notes for line breaks, paragraphs, and pasted multiline detail.

**What happens to children and dependencies when I remove a task?** Surviving direct children become root tasks, deeper descendants stay linked to their own direct parent, and surviving Blocking and Blocked By fields drop the deleted id.

## Settings

Operon settings for this live in **Settings → Operon → Interface → Task Editor**, under **File Body** for file-body behavior and **Property Visibility & Order** for property visibility and ordering. The latter was previously called Workflow Pickers. **Sections and Order** configures the desktop-style sections. The phone layout selector and the existing compact layout’s preferences are under **Mobile → Task Editor**; selecting one layout does not overwrite the other’s preferences.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
