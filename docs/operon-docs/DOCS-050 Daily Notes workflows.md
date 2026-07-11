---
Up:
  - "[[DOCS-008 Essential settings to configure first|Essential settings to configure first]]"
  - "[[DOCS-011 Inline tasks|Inline tasks]]"
  - "[[DOCS-009 Create your first task|Create your first task]]"
Notes: Capture inline tasks into your daily note, dated automatically
Icon: calendar-check
Color: "#059669"
tags:
  - operon
  - dailynotes
  - capture
  - inlinetask
  - howto
Updated: 2026-07-10T20:31:43
---

# Daily Notes workflows

If you work out of a daily note, that is often where a task first occurs to you. Operon can send new inline tasks straight to today's daily note, so capture lands where you are already writing. This uses Obsidian's **Daily Notes** core plugin, so it needs that plugin enabled.

## Capture into today's note

Turn on **Save new inline tasks to today's daily note** in settings, and the new-task flow writes inline tasks into the current daily note instead of a fixed file. Quick capture then follows your daily rhythm: open today's note, make a task, and it stays in context. This is one of the two capture targets for inline tasks; the other is a fixed file. See [[DOCS-008 Essential settings to configure first|Essential settings to configure first]].

## Dates from the note's date

A daily note already stands for a date, and Operon can use it. For inline tasks created in a daily note, it can fill in dates from the note's own date when the task does not already have them:

- **Start date** from the daily note's date.
- **Scheduled date** from the daily note's date.

Each is optional. With them on, a task captured in a given day's note is dated to that day without you typing the date, which is handy for "do this today" capture that should land on the Calendar.

## Which date formats work

Operon does not define its own daily-note naming scheme. It reads the file-name date format straight from the core Daily Notes plugin's own **Date format** setting, so whatever you pick there is what Operon recognizes. That means every option the core plugin offers works, including its ready-made choices such as `YYYY-MM-DD`, `YYYY.MM.DD`, and `YYYY/MM/DD`, as well as **Custom**, where you write your own moment.js pattern. If no format is set, Operon falls back to `YYYY-MM-DD`, the same default the core plugin uses.

One thing stays fixed no matter which naming format you choose: the dates Operon writes into a task, such as `dateScheduled`, are always stored as `YYYY-MM-DD`. The file-name format only controls how the note is named and found; it does not change how dates are stored on the task itself. See [[DOCS-012 Inline task syntax|Inline task syntax]] for the stored field formats.

## Calendar-created Daily Note templates

When Operon Calendar creates a missing Daily Note, it can resolve the familiar `{{title}}`, `{{date}}`, and `{{time}}` template variables in that new note. `{{title}}` becomes the created note's filename, while `{{date}}` and `{{time}}` use the local creation moment and follow the Core Templates plugin's **Date format** and **Time format** settings. Explicit forms such as `{{date:YYYY-MM-DD}}` and `{{time:HH:mm}}` use the format written in the template.

These are different settings from **Daily Notes → Date format**, which only determines the Daily Note filename. A Calendar-created note for a future or past day still gives `{{date}}` the creation date, not the selected Calendar day. Existing Daily Notes are opened as they are; their template is never run again.

This is template creation behavior, not the Daily Note Defaults that fill task start or scheduled dates. For the complete variable reference and File Task differences, see [[DOCS-061 operonId template variables|Template variables]].

## A simple daily flow

- Open today's daily note.
- Capture tasks as they come up; they save into the note.
- Let the note's date fill scheduled or start dates, so today's tasks show on today.
- Review them in a [[DOCS-025 Filter View|Filter View]] or the [[DOCS-028 Calendar overview|Calendar]] when you plan.

## FAQ

**Do I need the Daily Notes plugin?** Yes. This workflow uses Obsidian's Daily Notes core plugin, so enable it first.

**Does every new task go to the daily note?** Only inline tasks, and only when you turn on daily-note saving. Otherwise inline tasks go to your fixed target file.

**Will it set the date for me?** If you enable the Daily Note Defaults, new inline tasks in a daily note take their start or scheduled date from the note's date.

**Which file-name date formats are supported?** Whatever the core Daily Notes plugin is set to, since Operon reads that same **Date format** setting. The built-in choices and a Custom moment.js pattern all work; the default is `YYYY-MM-DD`.

**Why does `{{date}}` differ from the note filename date?** The filename follows the Daily Notes setting and the selected Calendar day. The compatible template variable records when Operon created the note. See [[DOCS-061 operonId template variables|Template variables]].

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Inline Tasks**, where you turn on saving new inline tasks to the daily note and set the Daily Note Defaults for start and scheduled dates.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
