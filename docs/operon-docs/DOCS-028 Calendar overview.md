---
Up:
  - "[[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]"
  - "[[DOCS-048 External calendars|External calendars]]"
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
Notes: Plan tasks by date on the Operon Calendar
Icon: calendar-days
Color: "#0284c7"
tags:
  - operon
  - calendar
  - plan
Updated: 2026-07-08T23:32:00
---

# Calendar overview

The Calendar shows your tasks in time. It is the best surface for scheduled work, deadlines, and time blocks, and for planning by day or week. [[DOCS-011 Inline tasks|Inline tasks]] and [[DOCS-013 File tasks|file tasks]] land on the same Calendar as soon as they carry a date, so a quick line in a note and a full task note are planned side by side. Many tasks only become real once they are placed on a date, and the Calendar is where that happens.

Open it with **Operon Calendar** from the command palette.

> **MEDIA-DOCS-028-1:** The Operon Calendar with all-day items and timed blocks across a week.

![MEDIA-DOCS-028-1 - The Operon Calendar with all-day items and timed blocks across a week](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-028-1.png)

## What the Calendar reads

A task appears on the Calendar based on its date fields:

- `dateScheduled`: when you plan to work on it.
- `dateDue`: its deadline.
- `datetimeStart` and `datetimeEnd`: a specific timed block.
- `dateCompleted`: when it was finished.

A task with only a date shows as an all-day item. A task with a start and end time shows as a timed block. See [[DOCS-012 Inline task syntax|Inline task syntax]] for the field formats.

## Plan by dragging

You can schedule and reschedule by dragging tasks on the Calendar instead of editing fields by hand. Drop a task on a day to schedule it, or drag a block to move or resize its time. This is the fastest way to shape a week and to spot overload before it happens.

## Open a task

Click a task on the Calendar to open it in the [[DOCS-021 Task Editor|Task Editor]]. Hold **Cmd** (macOS) or **Ctrl** (Windows and Linux) and click to open the task's source in a new Obsidian tab instead: the note for a file task, or the exact line for an inline task, the same convention as opening a link in a new browser tab. This works on materialized tasks; a recurring occurrence that has not been created yet has no source line to open.

## Move by keyboard

The fastest way to move through dates is the arrow keys, and they work in every Calendar grid, whatever view you are in:

- **Left** and **Right** step back and forward one day.
- **Up** and **Down** jump back and forward one week.

The arrows shift the date the grid is anchored to, so the view follows along. They are ignored while you are typing in a field, so they never get in the way of editing.

## Presets

The Calendar can be tuned with presets that control its time grid and how it displays, so you can switch between, say, a focused day grid and a broad week view. Presets are saved with Operon's data and detailed in [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]].

You can also switch the Calendar's own layout between a top toolbar and a side panel with a working [[DOCS-095 Calendar Task Pool|Task Pool]] you drag tasks from to schedule them. See [[DOCS-060 Calendar layout toolbar and sidebar|Calendar layout: toolbar and sidebar]].

## On mobile

On a phone the Calendar runs as a compact, phone-first surface with its own view modes, Agenda, Day, 2 Days, and 3 Days, that you cycle through, and each mode can open with its own preset. See [[DOCS-096 Mobile Calendar|Mobile Calendar]].

## External calendars

Operon can also show events from external calendar sources alongside your tasks, so your planning view reflects meetings and commitments too. Refresh them with **Update External Calendars**. See [[DOCS-048 External calendars|External calendars]].

## Tips

> [!tip] Treat Calendar as your planning surface
> Operon clears Obsidian's duplicate native header from the main Calendar workspace on desktop, giving you back the height that matters when you are scanning a week or a month. The calendar's own toolbar and sidebar controls stay right where they are.
>
> To plan with room to think, open Calendar in its own window and let it fill the screen. On a multi-monitor setup, park it on a second display so your week or month stays in front of you while the rest of Obsidian stays on the main one.

## FAQ

**Why is a task not on the Calendar?** It probably has no date. Give it a `dateScheduled`, `dateDue`, or timed block and it will appear.

**What is the difference between all-day and timed?** A date alone makes an all-day item; a `datetimeStart` and `datetimeEnd` make a timed block you can size on the grid.

**Does dragging change my Markdown?** Yes. Rescheduling on the Calendar writes the new dates back to the task, so your notes stay the source of truth.

## Settings

Operon settings for this live in **Settings → Operon → Views → Calendar**, which configures how the Calendar displays tasks and time blocks. This is also where you can turn off the hover add button that appears over an empty all-day date cell, a quick way to start a task on that date without it.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-030 Kanban overview|Kanban overview]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-025 Filter View|Filter View]]
