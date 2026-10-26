---
Notes: Date-based planning with sidebar countdowns and desktop Status Dock tasks
Icon: calendar-clock
Color: "#0284c7"
Updated: 2026-10-26T12:20:43+01:00
---

# Upcoming Tasks

Upcoming Tasks brings dated inline and file tasks into a daily sidebar list, with current and upcoming timed tasks also available in the desktop [[DOCS-152 Status Dock|Status Dock]]. The list updates from your task dates automatically. Use it to see what is approaching; use [[DOCS-032 Pinned Task Dock|Pinned Tasks]] for a list you choose by hand.

## Open the sidebar

Run **Operon: Open upcoming tasks** from the command palette. If the panel is already open, Operon brings it forward. Otherwise, it opens on the side chosen in Settings. Changing that preference does not move an existing panel.

## Which tasks appear

The date range includes today in your local calendar. The default **3 days** means today, tomorrow, and the following day. Earlier days are excluded, but timed tasks whose start time has already passed today remain in the list.

- **Scheduled:** a valid scheduled start date and time is used first. Without one, a valid Scheduled date appears as an all-day entry.
- **Due:** a valid Due date appears as an all-day entry. An end time is not treated as a due time.
- A task with both dates can appear twice. When both entries are all-day on the same date, they become one card. A timed Scheduled entry and an all-day Due entry on the same date remain separate.

Finished and cancelled tasks are excluded according to their task state and pipeline rules. Invalid or missing dates are skipped without changing the task. Upcoming Tasks reads existing tasks; it does not create future recurrence occurrences.

Days appear in date order, with **Timed** and **All-day** groups. Timed tasks are ordered by start time; matching times and all-day entries use priority, then a stable task order. Empty groups are hidden.

## Work with a card

Click the task name to open the [[DOCS-021 Task Editor|Task Editor]]. **Cmd-click** on macOS or **Ctrl-click** on other platforms opens the task's source: its file, or the inline task's location.

Hover over the task icon to access its contextual menu; on mobile, use a long press with **Mobile touch menu** enabled in Context Menu settings. Available actions follow the **Upcoming Tasks** row in **Action Visibility by Surface** (the Contextual Menu Matrix). Clicking or tapping the icon follows your global [[DOCS-099 State Icons|task icon click preference]]. See [[DOCS-042 Contextual menu actions|Contextual menu actions]] for menu configuration.

Use **Play** to start time tracking and **Stop** to stop it. These controls use the normal Tracker flow and do not change the task's scheduled date. While tracking is active, the stop control and any available countdown stay visible beside a shortened task name, without covering its text. For all-day tasks, the tracking control sits at the right edge without a countdown.

## Read the countdowns

The sidebar uses **HH:MM** or **HH:MM:SS** according to the saved countdown preference; the default includes seconds. The **Countdown display** selector remains available on mobile, but is no longer offered in desktop Settings. This sidebar format is separate from the dock’s compact duration format. Positive remaining time is rounded up to the displayed unit, so zero is not shown before the scheduled start.

On desktop, zero countdowns and the nearest future task's countdown stay visible. Other countdowns and inactive Play controls appear on hover or keyboard focus. On mobile, available countdowns and tracking controls remain visible. Active tracking controls remain visible on both.

When a task reaches zero, its sidebar countdown stays at zero and the next future task gains a continuously visible countdown. All-day tasks have no countdown. Values above **99:59** in HH:MM or **99:59:59** in HH:MM:SS are hidden; the task itself stays visible.

## Use the desktop Status Dock

The [[DOCS-152 Status Dock|Status Dock]] shows ongoing timed tasks first, ordered by their start time, followed by the next future timed Scheduled task within the configured day range. It works even when the sidebar is closed. Several ongoing tasks can appear together; their area scrolls horizontally when space is limited.

An ongoing task has started and has not reached its end time. The end can be explicit or derived from its estimate. Eligible blocks spanning midnight are included even though the sidebar starts with today. Finished and cancelled tasks remain excluded. All-day entries do not become dock countdowns.

Ongoing names have no zero countdown or visible **Now:** label; **Now:** appears in the task-name tooltip. When a countdown ends, the selected task can remain alongside the next future task. If no ongoing block is available, this retained task remains until its selection becomes invalid, for example through completion, deletion, or a changed scheduled start. Selection is recalculated when Operon reloads.

Hover over a task to reveal Play in place of its icon, then click the icon to start tracking. Clicking its name follows the dock’s shared **Click behavior** setting, whose default is **Source File + Task Editor**. Countdown text is not a click target. The task’s own icon takes priority; fallback icons use Scheduled for current tasks and Due for the next task. The Due icon does not change selection to use Due dates.

The dock shows seconds below one minute and minutes for longer durations. The existing countdown range limit still applies; a hidden countdown does not remove the task name. Starting or stopping tracking does not change which task is scheduled next. Full controls, positioning, and visibility are covered in [[DOCS-152 Status Dock|Status Dock]].

## Mobile status bar behavior

Mobile retains the native status-bar path where Obsidian makes it available; Operon does not add a separate mobile Status Dock. This indicator selects the nearest future timed Scheduled task in the day range, or retains a previously selected task at zero.

**Status bar click action** offers **Start timer** (the default), **Open task editor**, or **Open task**. **When countdown ends** offers **Keep current task** (the default) or **Continue with next task**; if no future task exists, the zero countdown remains until one becomes available. Retention can span midnight. Completion, cancellation, deletion, or a changed scheduled start releases the retained selection; reloading recalculates it from future tasks.

## Settings

Open **Settings → Operon → Tasks → Upcoming Tasks**.

### General

| Setting | Options or purpose | Default |
| --- | --- | --- |
| Upcoming days | 1–7 calendar days, including today; also controls the next future timed-task candidate range | 3 |
| Countdown display (mobile Settings only) | HH:MM or HH:MM:SS for the sidebar and native status-bar path; does not change desktop dock formatting | HH:MM:SS |

### Sidebar

| Setting | Options or purpose | Default |
| --- | --- | --- |
| Show all-day tasks | Include Scheduled dates without a start time and Due dates | On |
| Daily group order | Timed first or All-day first | Timed first |
| Sidebar side | Left or Right; used when opening a closed panel | Left |
| Upcoming task color source | Choose card colors independently of Pinned Tasks | No color |

### Status Dock and mobile status bar

On desktop, the **Operon status dock** section contains the upcoming-task visibility toggle, enabled by default. It controls the calendar-task area, not the timer or the whole dock. Use **Toggle status dock** to hide or show the whole dock.

The desktop **When countdown ends** and **Status bar click action** selectors have been removed. Task-name opening is configured under **Interface → Workspace Tweaks → Operon status dock → Click behavior** instead.

On mobile, **Show next upcoming task in status bar**, **When countdown ends**, and **Status bar click action** retain the behavior described above. The latter two controls appear when the indicator is enabled. **Daily group order** appears when **Show all-day tasks** is enabled. Hidden controls retain their saved values.

## FAQ

**Why is a task missing?** Check that it has a valid Scheduled or Due date within the chosen day range and is not finished or cancelled. For a date without a time, enable **Show all-day tasks**. The dock’s next-task countdown requires a timed Scheduled entry. Its current-task group also requires an ongoing time block; a task being tracked is not automatically a current calendar task.

**Where are tasks from previous days?** The sidebar starts with today. It is not an overdue-task list. The dock can still show an ongoing block spanning midnight or a retained current task from an earlier day.

**Why does a task without a time have no countdown?** It belongs to the All-day group. Add a scheduled start time if you want a countdown to a specific moment.

**Is the countdown my tracked working time?** No. It measures time until the scheduled start. Tracker measures time spent working, and can keep running after a countdown reaches zero.

## Related

- [[DOCS-152 Status Dock|Status Dock]]
- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-032 Pinned Task Dock|Pinned Task Dock]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-034 Time tracking|Time tracking]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
- [[DOCS-022 Command palette reference|Command palette reference]]
