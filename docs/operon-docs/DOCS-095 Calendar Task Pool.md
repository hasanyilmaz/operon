---
Up:
  - "[[DOCS-060 Calendar layout toolbar and sidebar|Calendar layout: toolbar and sidebar]]"
  - "[[DOCS-028 Calendar overview|Calendar overview]]"
  - "[[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]"
Notes: The Calendar sidebar's Task Pool, its modes, search, and how it relates to the preset filter
Icon: calendar-plus
Color: "#0284c7"
tags:
  - operon
  - calendar
  - taskpool
  - plan
  - search
Updated: 2026-06-25T16:47:21
---

# Calendar Task Pool

The **Task Pool** is the planning surface in the Calendar's [[DOCS-060 Calendar layout toolbar and sidebar|sidebar]]. It is a working list of tasks you drag straight onto the grid to schedule them. Where the grid shows what is already placed in time, the pool is where unplaced and stalled work waits to be picked up and dropped onto a day or a time slot.

This makes it the heart of calendar planning: open the sidebar, choose what you want to see, and pull tasks onto your week.

> **MEDIA-DOCS-095-1:** The Task Pool in the Calendar sidebar, with its mode buttons, search box.

![MEDIA-DOCS-095-1 - The Task Pool in the Calendar sidebar, with its mode buttons, search box](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-095-1.png)

## Where it lives

The Task Pool is one of the three sections of [[DOCS-060 Calendar layout toolbar and sidebar|sidebar mode]], alongside Calendars and Finished Tasks. Switch the Calendar to sidebar mode to use it. Its width, whether it starts open or collapsed, and whether it follows the active Calendar preset filter are set in **Settings → Operon → Views → Calendar**.

## The four modes

A row of buttons at the top of the pool chooses which tasks it gathers. Only one mode is active at a time. Each mode answers a different planning question.

| Mode | What it gathers | Use it to |
|---|---|---|
| **Overdue** | Open tasks whose scheduled or due date is already in the past | Catch up: find what slipped and drag it onto a real day |
| **Unscheduled** | Open tasks with no scheduled date | Plan ahead: place work that has no home on the calendar yet |
| **All** | Every open task | Reach anything that is still open, regardless of its dates |
| **Finished** | Tasks completed on the anchored day | Review what got done, or pull a finished task back onto the grid |

How each one works, and why it helps:

- **Overdue** lists open tasks where the scheduled date or the due date is earlier than today. It is your recovery view. Instead of hunting through notes for things that fell behind, you see them in one place and re-home them by dropping them onto a day you can actually do them.
- **Unscheduled** lists open tasks that have no scheduled date at all. This is the core planning pool: it is exactly the backlog of work that has not been placed on the calendar, so dragging from here is how loose tasks become a plan.
- **All** lists every open task, scheduled or not. Use it when the task you want is not overdue or unscheduled, for example something already scheduled that you want to move, or when you would rather search the whole open set than narrow by date first.
- **Finished** lists tasks completed on the day the Calendar is anchored to, not all history. It keeps done work out of the way while staying reachable, so you can review the day or, if something was closed too early, drag it back onto the grid.

In every mode except Finished, only **open** tasks appear; done and cancelled work is left out so the pool stays focused on what still needs placing.

## Search

The search box narrows the current mode, and it looks at more than the task's title. Matching works in two layers:

- A **direct text match** on the task's words (its description), its tags, contexts, related links, and note. A match here ranks highest, with a task whose description *starts with* what you typed coming first.
- A broader **fuzzy match** across the rest of the task's text, which also takes in its status, dates, id, and file path. This catches looser matches and tasks that line up on a field rather than the title.

At a glance, which layer reaches which field:

| Field | Direct match | Fuzzy match |
|---|---|---|
| Description (the task's words) | Yes | Yes |
| Tags, contexts, related, note | Yes | Yes |
| Status and dates | No | Yes |
| Task id and file path | No | Yes |

Closer matches are ranked to the top, so the task you mean tends to rise as you type.

The important part is **scope**: search runs over the *entire* set for the current mode, not just the rows you can see. If **Task Pool follows Calendar filter** is enabled, that set is first narrowed by the active Calendar preset's filter. So a task buried deep in a long Overdue or All list still surfaces the moment you type enough of its name, as long as it is inside the current Task Pool scope.

## Why the list looks capped, and why search still finds everything

The pool shows a limited number of rows at once: up to **25** by default, and up to **50** while you are searching. Above the list, a summary tells you the real total, such as *showing 25 of 142*.

This cap is **only visual**. It keeps the sidebar light and quick to scroll; it does not limit what the pool considers:

- The mode still collects **all** matching tasks inside the current Task Pool scope; the count in the summary is the true total.
- Search ranks across that **whole** scoped set, then shows you the top matches. The limit never hides a task from search; it only caps how many rendered rows you scroll through at once.
- If what you want is not in view, **type more of its name** rather than scrolling. Because search sees the whole current scope, a sharper query brings the match up into the visible rows.

In short, the number you see is a rendering budget, not a search boundary.

## Does the Calendar filter narrow the pool?

It depends on the **Task Pool follows Calendar filter** setting in **Settings → Operon → Views → Calendar → Calendar Sidebar Settings**.

For new installs, this setting is on by default, so the Task Pool follows the active Calendar preset's filter. Existing Operon users keep the previous global Task Pool behavior unless they turn the setting on.

The two behaviors are:

- **On**: the Task Pool first applies the active [[DOCS-029 Calendar presets and time grid|preset]]'s filter, then applies its own **Overdue**, **Unscheduled**, **All**, or **Finished** mode, and then the search box. This keeps the pool aligned with whichever Calendar preset is currently visible.
- **Off**: the Task Pool draws from your whole task index and narrows it only by its own **mode** and **search box**. This keeps the pool as a global scheduling inbox, even when the grid is filtered.

**Finished** follows the same setting, but it keeps its day-specific behavior: it shows tasks completed on the day the Calendar is anchored to. With the setting on, those finished tasks must also match the active preset filter; with it off, they come from the whole task index for that anchored day.

The Task Pool uses the same filter rules the Calendar grid uses. If the Calendar surface ignores a special or dynamic filter in this context, the Task Pool ignores it too.

## Scheduling from the pool

Drag a task from the pool onto a day or a time slot to schedule it there. The drop sets the task's date (and time, on a time grid), and it moves from the pool onto the grid. This is the everyday loop of calendar planning: pick a mode, find the task, drop it where it belongs.

## FAQ

**Does the Calendar's filter also filter the Task Pool?** Yes, when **Task Pool follows Calendar filter** is enabled. If the setting is off, the pool pulls from your whole index and is narrowed only by its mode and search. See the section above.

**Why can I only see 25 tasks?** That is just the display limit (25 normally, 50 while searching). The summary line shows the real total, and search still looks across all matching tasks in the current scope. Type more of a task's name to bring it into view.

**Where did my done tasks go?** Every mode but Finished shows only open tasks. Switch to Finished to see work completed on the anchored day.

**The pool is empty in Unscheduled mode.** That means every open task already has a scheduled date. Try All or Overdue to see scheduled or past-due work.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-052 Completed task review|Completed task review]]
