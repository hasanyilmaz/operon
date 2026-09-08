---
Notes: Date-based planning with sidebar and status bar countdowns
Icon: calendar-clock
Color: "#0284c7"
Updated: 2026-09-08T11:22:36+02:00
---

# Upcoming Tasks

Upcoming Tasks brings dated inline and file tasks into a daily sidebar list, with a status bar countdown for the next timed task. The list updates from your task dates automatically. Use it to see what is approaching; use [[DOCS-032 Pinned Task Dock|Pinned Tasks]] for a list you choose by hand.

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

Hover over the task icon to access its contextual menu; on mobile, use a long press with **Mobile touch menu** enabled in Context Menu settings. Available actions follow the **Upcoming Tasks** row in the Contextual Menu Matrix. Clicking or tapping the icon follows your global [[DOCS-099 State Icons|task icon click preference]]. See [[DOCS-042 Contextual menu actions|Contextual menu actions]] for menu configuration.

Use **Play** to start time tracking and **Stop** to stop it. These controls use the normal Tracker flow and do not change the task's scheduled date. While tracking is active, the stop control and any available countdown stay visible beside a shortened task name, without covering its text. For all-day tasks, the tracking control sits at the right edge without a countdown.

## Read the countdowns

Choose **HH:MM** or **HH:MM:SS**; the default includes seconds. Positive remaining time is rounded up to the displayed unit, so zero is not shown before the scheduled start.

On desktop, zero countdowns and the nearest future task's countdown stay visible. Other countdowns and inactive Play controls appear on hover or keyboard focus. On mobile, available countdowns and tracking controls remain visible. Active tracking controls remain visible on both.

When a task reaches zero, its sidebar countdown stays at zero and the next future task gains a continuously visible countdown. All-day tasks have no countdown. Values above **99:59** in HH:MM or **99:59:59** in HH:MM:SS are hidden; the task itself stays visible.

## Use the status bar

The status bar follows the nearest future timed Scheduled task within the same day range, even when the sidebar is closed. Its countdown stays visible independently of sidebar hover behavior, subject to the format limit above. Beyond that limit, the task name and icon remain visible. All-day tasks are not candidates. If there is no candidate or retained task, the indicator is hidden.

Clicking the indicator uses your **Status bar click action**:

- **Start timer** starts tracking the displayed task. This is the default.
- **Open task editor** opens its Task Editor.
- **Open task** opens its file and goes to the inline task when applicable.

**When countdown ends** determines what happens at zero:

- **Keep current task** keeps the task and its zero countdown visible, including across midnight or a change to the day range.
- **Continue with next task** switches to the nearest future candidate. If none exists, zero remains until a candidate becomes available.

Completing, cancelling, deleting, or changing the scheduled start of the selected task causes a new selection. Renaming it or changing its Due date does not release a retained zero countdown. Selection lasts only for the current session; after reloading Operon, it is recalculated from future tasks. Hiding and showing the indicator preserves and rechecks the session selection.

Tracking and countdown selection are independent: starting or stopping a timer does not choose another upcoming task. The indicator uses Obsidian's status bar where available; it does not add a separate mobile bar.

## Settings

Open **Settings → Operon → Tasks → Upcoming Tasks**.

### Sidebar

| Setting | Options or purpose | Default |
| --- | --- | --- |
| Countdown display | HH:MM or HH:MM:SS; changes the format in both the sidebar and status bar | HH:MM:SS |
| Upcoming days | 1–7 calendar days, including today; also controls the status bar's candidate range | 3 |
| Show all-day tasks | Include Scheduled dates without a start time and Due dates | On |
| Daily group order | Timed first or All-day first | Timed first |
| Sidebar side | Left or Right; used when opening a closed panel | Left |
| Upcoming task color source | Choose card colors independently of Pinned Tasks | No color |

### Status bar

| Setting | Options or purpose | Default |
| --- | --- | --- |
| Show next upcoming task in status bar | Show or hide the indicator | On |
| When countdown ends | Keep current task or Continue with next task | Keep current task |
| Status bar click action | Start timer, Open task editor, or Open task | Start timer |

## FAQ

**Why is a task missing?** Check that it has a valid Scheduled or Due date within the chosen day range and is not finished or cancelled. For a date without a time, enable **Show all-day tasks**. The status bar only selects future timed Scheduled entries when starting a new selection.

**Where are tasks from previous days?** The sidebar starts with today. It is not an overdue-task list. A status bar task retained at zero can remain from an earlier day.

**Why does a task without a time have no countdown?** It belongs to the All-day group. Add a scheduled start time if you want a countdown to a specific moment.

**Is the countdown my tracked working time?** No. It measures time until the scheduled start. Tracker measures time spent working, and can keep running after a countdown reaches zero.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-032 Pinned Task Dock|Pinned Task Dock]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-034 Time tracking|Time tracking]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
- [[DOCS-022 Command palette reference|Command palette reference]]
