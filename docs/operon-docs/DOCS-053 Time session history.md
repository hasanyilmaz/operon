---
Up:
  - "[[DOCS-034 Time tracking|Time tracking]]"
  - "[[DOCS-035 FlowTime focus sessions|FlowTime focus sessions]]"
  - "[[DOCS-042 Contextual menu actions|Contextual menu actions]]"
Notes: Review and correct the time sessions you have tracked
Icon: history
Color: "#4f46e5"
tags:
  - operon
  - timetracking
  - review
  - track
Updated: 2026-06-25T16:47:21
---

# Time session history

Tracked time is only useful if it is accurate, and timers are easy to forget. The Time Session History panel is where you look back at the sessions you recorded and fix the ones that went wrong: a timer left running overnight, a session on the wrong task, a block you meant to log but did not. It turns tracked time from a rough guess into a record you can trust.

> **MEDIA-DOCS-053-1:** The Time Session History panel listing recent tracked sessions by day.

![MEDIA-DOCS-053-1 - Time Session History panel](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-053-1.png)

## Open the history

Run **Open Time Session History panel** from the command palette. It lists your recent tracked sessions, grouped so you can see where your time went day by day. How far back it reaches is a setting, the history window, measured in days.

## Edit a session

Each session is a time range you can correct. Open a session to adjust its start and end, so a forgotten stop or an off-by-an-hour block becomes right. Because tracked time rolls up into a task's duration and its totals, fixing a session here keeps every view that shows time honest. See [[DOCS-034 Time tracking|Time tracking]].

> **MEDIA-DOCS-053-2:** Editing a tracked session's start and end time to correct a forgotten stop.

![MEDIA-DOCS-053-2 - Edit tracked session time range](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-053-2.png)

## Log time you did not track

Sometimes the work happened but the timer did not. You can record a planned block as tracked time after the fact with the **Log as tracked** action in a task's [[DOCS-042 Contextual menu actions|contextual menu]], so the history reflects what really happened even when you forgot to start a timer.

## Where sessions come from

Every session in the history was recorded by a timer: a [[DOCS-035 FlowTime focus sessions|FlowTime]] focus session, a TrackTime stopwatch, or a block you logged as tracked. They live on the task itself as tracked time ranges, which is why the history is a view of your tasks, not a separate log. See [[DOCS-034 Time tracking|Time tracking]].

## FAQ

**I left a timer running. Can I fix it?** Yes. Open the session in the history and correct its end time.

**How far back does the history show?** As far as the history window setting allows, which you set in days.

**Can I add time I forgot to track?** Yes. Use **Log as tracked** on the task to record a block after the fact.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Tracker**, which sets the history window in days and how sessions are split, alongside the rest of the time-tracking behavior.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-052 Completed task review|Completed task review]]
