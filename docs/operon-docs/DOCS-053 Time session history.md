---
Notes: Review and correct the time sessions you have tracked
Icon: history
Color: "#4f46e5"
Updated: 2026-10-19T22:28:59+02:00
---

# Time session history

Tracked time is only useful if it is accurate, and timers are easy to forget. The Time Session History panel is where you look back at the sessions you recorded and fix the ones that went wrong: a timer left running overnight, a session on the wrong task, a block you meant to log but did not. It turns tracked time from a rough guess into a record you can trust.

> **MEDIA-DOCS-053-1:** The Time Session History panel listing recent tracked sessions by day.

![MEDIA-DOCS-053-1 - Time Session History panel](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-053-1.png)

## Open the history

Run **Open Time Session History panel** from the command palette. It lists your recent tracked sessions, grouped so you can see where your time went day by day. How far back it reaches is a setting, the history window, measured in days. A **Tracked time** filter in another view does not limit this panel; it keeps its own history window.

## Open a task source

**Task description click action**, under **Settings → Operon → Tasks → Tracker**, chooses whether a task description opens Task Editor or its source. The companion button offers the other action: **Open Source** when the description opens the editor, or **Open task editor** when the description opens the source.

On desktop, both Source entry points open the [[DOCS-151 Lightbox|shared lightbox]] for the current task. Inline source navigation uses the current task line and places the caret after the description in the editable Markdown view, with no text selected. To continue in a tab, use the preview's **Open in new tab** control. Opening Source does not edit the recorded session; mobile navigation is unchanged.

## Edit a session

Each session is a time range you can correct. Open a session to adjust its start and end, so a forgotten stop or an off-by-an-hour block becomes right. Because tracked time rolls up into a task's duration and its totals, fixing a session here keeps every view that shows time honest. See [[DOCS-034 Time tracking|Time tracking]].

You can also edit a session directly from a table: click its chip in detailed **Duration** or **Trackers**. Click empty space in either cell to add time. This works in normal and embedded tables when editing is available. See [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].

> **MEDIA-DOCS-053-2:** Editing a tracked session's start and end time to correct a forgotten stop.

![MEDIA-DOCS-053-2 - Edit tracked session time range](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-053-2.png)

The task description at the top of **Edit session** is a formatted, read-only context label. Default and six-color highlights appear in their display form, with the color marker hidden, just as on a Kanban card. This does not alter the source description or the session's times and save behavior. To change the description or its highlight color, use [[DOCS-021 Task Editor|Task Editor]]; see [[DOCS-113 Text field editor popover|Text field editor popover]] for highlight syntax.

## Edit from Task Editor

In the desktop-style [[DOCS-021 Task Editor|Task Editor]], open **Sessions** and click or tap a session's duration, such as **35m 4s**, or its pencil. Both open the same **Edit session** window for that recorded range. With a mouse, the duration is underlined on hover; it is also keyboard-accessible. On the desktop-style phone layout and on tablets, the controls are available without hovering.

The existing compact mobile editor keeps its own session presentation and pencil action. Choosing that phone layout does not change the stored sessions. Correcting a session updates the task's tracked time, regardless of which entry point opened it.

Use the desktop-style Sessions header's **clock-plus** button to **Add session**. Its dialog includes the task title and Start/End controls, so you can confirm the task before adding the range. Edit session uses the same compact Start/End arrangement. These controls keep the existing validation and save path; they do not edit the task description.

## Log time you did not track

Sometimes the work happened but the timer did not. You can record a planned block as tracked time after the fact with the **Log as tracked** action in a task's [[DOCS-042 Contextual menu actions|contextual menu]], so the history reflects what really happened even when you forgot to start a timer.

## Where sessions come from

Sessions can come from a [[DOCS-035 FlowTime focus sessions|FlowTime]] focus session, a TrackTime stopwatch, a block logged as tracked, or a range added through **Add session**. They live on the task itself as tracked time ranges, which is why the history is a view of your tasks, not a separate log. See [[DOCS-034 Time tracking|Time tracking]].

## FAQ

**I left a timer running. Can I fix it?** Yes. Open the session in the history and correct its end time.

**How far back does the history show?** As far as the history window setting allows, which you set in days.

**Can I add time I forgot to track?** Yes. Use **Log as tracked** on the task to record a block after the fact.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Tracker**, which sets the history window in days and how sessions are split, alongside the rest of the time-tracking behavior.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-052 Completed task review|Completed task review]]
