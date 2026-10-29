---
Notes: Track time, review recent sessions, and access overdue, today, and upcoming tasks from one desktop dock
Icon: panel-bottom
Color: "#0F766E"
Updated: 2026-10-29T18:28:32+01:00
---

# Status Dock

The **Status Dock** brings your timer, break controls, overdue and today task lists, ongoing calendar tasks, next upcoming task, and duplicate-ID warnings into one compact desktop surface. A temporary card also lets you review the latest saved time session. It stays available while you work in ordinary Obsidian tabs, including Markdown notes. It is separate from the [[DOCS-032 Pinned Task Dock|Pinned Task Dock]], which holds tasks you choose to pin.

> **MEDIA-DOCS-152-1:** The desktop Status Dock with an assigned running timer, Coffee, two ongoing calendar tasks, and the next upcoming task with its countdown. Show the six-dot drag handle and hover over one calendar task so its icon becomes Play. Keep task names readable; ongoing tasks should have no visible Now label or zero countdown.

![MEDIA-DOCS-152-1 - Status Dock with tracking, ongoing tasks, and the next upcoming task](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-152-1.png)

## Show, hide, and position the dock

The dock starts visible near the bottom center of each desktop window with a main workspace tab. It is positioned within the window viewport, so scrolling a note does not move it. It is not inserted into sidebars or lightbox content; opening a lightbox does not remove the dock behind it.

Drag the **six-dot handle** to move it. With the handle focused, arrow keys move it and **Home** resets its position. The dock stays within the available window bounds. Position is temporary: restarting Obsidian restores the centered default.

Run **Operon: Toggle status dock** from the command palette to hide or show it across windows. This changes visibility only; it does not stop a timer or end a break. There is no separate Settings visibility switch. Restarting Obsidian makes the dock visible again.

The dock has one compact, single-line layout. When several calendar tasks do not fit, their area scrolls horizontally. It does not switch to a second display mode. The Status Dock is desktop-only; mobile keeps its existing surfaces.

## Track time and take a break

The tracking section contains **Play or Stop**, the timer, the task name, and controls appropriate to the current state. These controls do not automatically open the FlowTime panel.

| State | Available actions |
|---|---|
| No timer and no waiting task | Play starts an unassigned timer. Task Finder and Task Creator let you choose or create a task to track. |
| An unassigned timer is running | Stop ends the timer. Task Finder and Task Creator let you attach a task through the tracking flow. |
| A task is being tracked | Stop finishes and saves the work session. Coffee records the current work session and starts a break without opening FlowTime. |
| A break is active | Play starts a new work session for the waiting task. Coffee ends the break without restarting work. Finder and Creator let you start a different task instead. |
| A break has ended and a task is waiting | Play resumes that task in a new session. Finder and Creator let you choose a different task. |

The Task Finder tooltip is **Track a different task**. Task Creator uses **Create a new task and start tracking**. During a break, successfully choosing or creating a task ends the break and starts tracking that task; cancelling the picker or Creator leaves the current state in place.

The dock and [[DOCS-035 FlowTime focus sessions|FlowTime]] share the same break. Closing the FlowTime panel does not end it. Restarting Obsidian or reloading Operon clears the temporary break and waiting task, while saved work sessions remain recorded. Existing FlowTime break duration and notification preferences apply.

Controls respond immediately while session saving completes. A failed save does not count as a successfully recorded session or completed break transition. See [[DOCS-034 Time tracking|Time tracking]] for recorded sessions and history.

## Read the timer

Durations below one minute show seconds, such as **29s**. Longer durations use minutes, such as **41m** or **2h 34m**. The next-task countdown uses the same compact format. The dock does not change duration formatting in other views.

An idle or waiting timer has no **0s** label. Without an assigned task, **Track time** or **Select or create a new task** is plain text. Use the Finder or Creator icon beside it. The timer and countdown values in the bar do not open a task or show its opening tooltip. The separate recent-session card has a clickable duration, described below.

## Overdue and Happens Today lists

Two icons beside the drag handle open task lists using the same scopes as [[DOCS-027 Task Finder|Task Finder]]:

| List | Open tasks included |
|---|---|
| **Overdue** — calendar-search icon | Scheduled or due before today. |
| **Happens Today** — lightning icon | Due, scheduled, or started today. |

These lists use indexed tasks across the vault, independently of the filter in your current view. Dates follow your local day. A task appears once within each list; it can qualify for both lists. Each icon appears only when its scope contains tasks. When both scopes are empty, their separator also disappears.

Click an icon to open its list. Click it again to close it, or click the other icon to switch lists. Cards are ordered with the nearest qualifying date or time closest to the dock. They normally stack above the dock and can appear below it when there is more room there. The visible area fits up to **ten complete cards**, or fewer in a shorter window; scroll to reach the remaining tasks.

List cards show the task icon and description, without a duration or a timed dismissal. They share the recent-session card's height and fixed width, constrained by the available window space. Short names do not shrink the card; longer names use the available space before ending in an ellipsis.

- **Task icon:** clicking follows the global **Task icon click action** preference. Hovering opens the task's contextual menu.
- **Task description:** clicking follows the Status Dock's source/editor opening preference below.
- **Play/Stop:** hovering over a card reveals this action at its right edge. Its border appears when the control itself is hovered or focused. It starts or stops that task's timer without closing the list. There is no inline Unpin button.

Click outside the list or elsewhere on the dock bar to close it. A dock action still runs normally after closing the list. Menus and editors opened from a card remain usable without being treated as an outside click. With focus in the dock or list, **Escape** closes the list once its own popup has been dismissed. The list also closes when its scope becomes empty or the dock is hidden.

Configure the cards' hover-menu actions in **Interface → Context Menu → Action Visibility by Surface → Task Lists → Status Dock**. This controls menu actions, not whether the two scope icons or the inline Play/Stop control appear. See [[DOCS-042 Contextual menu actions|Contextual menu actions]].

## Review the latest saved session

While the dock is visible, a newly saved task session shows a temporary card beside it. This includes stopping a task timer from another surface, starting a break with Coffee, or adding a session manually. Editing or deleting an existing session does not create a new card, and stopping an unassigned timer does not produce a task-session card.

The card contains the task icon, its recorded duration with seconds, such as **34m 22s**, and the task description:

- Click the **duration** to open **Edit session** for that saved record.
- Click the **description** to use the Status Dock's source/editor opening preference.
- Click or hover over the **task icon** to use the same icon action and contextual menu as the dock's task-list cards.

The card disappears after **ten seconds** of active display time. The countdown pauses while the pointer is over it, it has keyboard focus, or its task menu or an action is in use. It also pauses while the window's document is hidden.

Only the latest saved session is shown. If an Overdue or Happens Today list is open, the session card waits until the list closes instead of overlapping it. Clicking the dock's Stop or Coffee control closes the list and lets the newly saved session appear. Hiding the dock dismisses these temporary cards without changing saved sessions.

The card aligns with the dock's left edge and adapts to available space. Its Operon tooltips prefer the side away from the dock when there is room. For other ways to correct a session, see [[DOCS-053 Time session history|Time session history]].

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

This preference applies to assigned tracking-task names, calendar-task names, and descriptions in the Overdue, Happens Today, and recent-session cards. Source opening uses the supported source lightbox flow; it does not add support for otherwise unsupported source previews. See [[DOCS-151 Lightbox|Lightbox]] and [[DOCS-021 Task Editor|Task Editor]].

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
- [[DOCS-053 Time session history|Time session history]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
