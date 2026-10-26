---
Notes: Track time, take breaks, and access current and upcoming tasks from one desktop dock
Icon: panel-bottom
Color: "#0F766E"
Updated: 2026-10-26T12:14:54+01:00
---

# Status Dock

The **Status Dock** brings your timer, break controls, ongoing calendar tasks, next upcoming task, and duplicate-ID warnings into one compact desktop surface. It stays available while you work in ordinary Obsidian tabs, including Markdown notes. It is separate from the [[DOCS-032 Pinned Task Dock|Pinned Task Dock]], which holds tasks you choose to pin.

> **MEDIA-DOCS-152-1:** The desktop Status Dock with an assigned running timer, Coffee, two ongoing calendar tasks, and the next upcoming task with its countdown. Show the six-dot drag handle and hover over one calendar task so its icon becomes Play. Keep task names readable; ongoing tasks should have no visible Now label or zero countdown.

![MEDIA-DOCS-152-1 - Status Dock with tracking, ongoing tasks, and the next upcoming task](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-152-1.png)

## Show, hide, and position the dock

The dock starts visible near the bottom center of each desktop window with a main workspace tab. It is positioned within the window viewport, so scrolling a note does not move it. It is not inserted into sidebars or lightbox content; opening a lightbox does not remove the dock behind it.

Drag the **six-dot handle** to move it. With the handle focused, arrow keys move it and **Home** resets its position. The dock stays within the available window bounds. Position is temporary: restarting Obsidian restores the centered default.

Run **Operon: Toggle status dock** from the command palette to hide or show it across windows. This changes visibility only; it does not stop a timer or end a break. There is no separate Settings visibility switch. Restarting Obsidian makes the dock visible again.

The dock has one compact, single-line layout. When several calendar tasks do not fit, their area scrolls horizontally. It does not switch to a second display mode. The Status Dock is desktop-only; mobile keeps its existing surfaces.

## Track time and take a break

The left section contains **Play or Stop**, the timer, the task name, and controls appropriate to the current state.

| State | Available actions |
|---|---|
| No timer and no waiting task | Play starts an unassigned timer and opens FlowTime. Task Finder and Task Creator let you choose or create a task to track. |
| An unassigned timer is running | Stop ends the timer. Task Finder and Task Creator let you attach a task through the tracking flow. |
| A task is being tracked | Stop finishes the work session and opens FlowTime. Coffee records the current work session and starts a break without opening FlowTime. |
| A break is active | Play starts a new work session for the waiting task. Coffee ends the break without restarting work. Finder and Creator let you start a different task instead. |
| A break has ended and a task is waiting | Play resumes that task in a new session. Finder and Creator let you choose a different task. |

The Task Finder tooltip is **Track a different task**. Task Creator uses **Create a new task and start tracking**. During a break, successfully choosing or creating a task ends the break and starts tracking that task; cancelling the picker or Creator leaves the current state in place.

The dock and [[DOCS-035 FlowTime focus sessions|FlowTime]] share the same break. Closing the FlowTime panel does not end it. Restarting Obsidian or reloading Operon clears the temporary break and waiting task, while saved work sessions remain recorded. Existing FlowTime break duration and notification preferences apply.

Controls respond immediately while session saving completes. A failed save does not count as a successfully recorded session or completed break transition. See [[DOCS-034 Time tracking|Time tracking]] for recorded sessions and history.

## Read the timer

Durations below one minute show seconds, such as **29s**. Longer durations use minutes, such as **41m** or **2h 34m**. The next-task countdown uses the same compact format. The dock does not change duration formatting in other views.

An idle or waiting timer has no **0s** label. Without an assigned task, **Track time** or **Select or create a new task** is plain text. Use the Finder or Creator icon beside it. Time values themselves do not open a task or show its opening tooltip.

## Current and upcoming tasks

The calendar section follows the eligible tasks and planning rules described in [[DOCS-140 Upcoming Tasks|Upcoming Tasks]]. It is separate from the task you are actively tracking: being scheduled now does not start a timer automatically.

- Multiple ongoing timed tasks appear together, with the earliest start on the left. Finished tasks are excluded.
- Ongoing tasks show their names without a zero countdown or a visible **Now:** prefix. Their task-name tooltip includes **Now:** before the description.
- The next future timed task follows the current-task area with a countdown. All-day entries do not become timed countdowns.
- When a countdown reaches zero, the current task can remain alongside the next future task. There is no desktop **When countdown ends** selector.

Each task uses its own icon when configured. Otherwise the current-task icon falls back to the **Scheduled** key-mapping icon, and the upcoming-task icon to the **Due** key-mapping icon. This icon fallback does not turn the upcoming selection into a due-date query. Icon color uses the task color, with the theme accent as fallback.

Hover over a calendar task to reveal **Play** in place of its icon. Click that icon to start tracking the task, including an upcoming task you want to begin early. Click the task name to use the opening preference below. These are separate actions; the name does not become a timer-start button.

Long task names are shortened with an ellipsis. Hover over the task-name area to read the full name. The neutral hover border belongs to that name or its icon control, not to the countdown.

## Choose what task-name clicks open

Go to **Settings → Operon → Interface → Workspace Tweaks → Operon status dock → Click behavior**. Choose:

- **Source File Only**
- **Source File + Task Editor** — the default
- **Task Editor Only**

This preference applies to assigned tracking-task names and the calendar-task names in the dock. Source opening uses the supported source lightbox flow; it does not add support for otherwise unsupported source previews. See [[DOCS-151 Lightbox|Lightbox]] and [[DOCS-021 Task Editor|Task Editor]].

Calendar visibility remains controlled by the upcoming-task visibility toggle in Upcoming Tasks settings. Hiding that section does not hide the tracking controls.

## Duplicate-ID warnings

When Operon detects duplicate task IDs, a warning icon and count appear at the right. Click the warning to open the conflict manager. The count represents extra copies, not every task in a conflicting group. The existing alert delay and temporary resolved indicator still apply. See [[DOCS-055 Duplicate IDs|Duplicate IDs]] for diagnosis and resolution.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs]]
- [[DOCS-027 Task Finder|Task Finder]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-034 Time tracking|Time tracking]]
- [[DOCS-035 FlowTime focus sessions|FlowTime focus sessions]]
- [[DOCS-140 Upcoming Tasks|Upcoming Tasks]]
