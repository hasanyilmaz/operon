---
Notes: Record real effort with TrackTime and FlowTime, with estimate and duration examples
Icon: timer
Color: "#9333ea"
Updated: 2026-07-23T16:45:34
---

# Time tracking

Time tracking records the actual effort you spend on a task, so you can compare what you planned with what it really took. In Operon, tracked time belongs to the task record itself, not to a separate timer log floating beside the work, which means effort becomes part of the task's history.

> **MEDIA-DOCS-034-1:** A task with a running timer.

![MEDIA-DOCS-034-1 - Task with running timer](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-034-1.png)

## Start and stop

Run **Start/stop time tracker** on a task to begin timing, and run it again to stop. Run it on a different task to switch what you are tracking. You can also start or stop from a task's [[DOCS-042 Contextual menu actions|contextual menu]].

## The fields involved

Time tracking touches a few canonical fields:

- `estimate`: how long you expect the task to take.
- `duration`: how long it has actually taken, accumulated from sessions.
- `totalEstimate` and `totalDuration`: the same, rolled up across a task and its subtasks, so a project reflects the effort beneath it.
- The individual sessions are stored on the task as tracked time ranges.

These are stored in seconds, but you set and read them through the editor and views rather than counting seconds yourself. See [[DOCS-012 Inline task syntax|Inline task syntax]].

You normally only set `estimate`; Operon fills `duration` as you track. A task with a one-hour estimate, ready to paste (`3600` seconds is one hour):

```md
- [ ] Edit the chapter {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{estimate:: 3600}}
```

After you track ninety minutes against it, the same line carries a `duration` Operon wrote for you, here `5400` seconds:

```md
- [ ] Edit the chapter {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{estimate:: 3600}} {{duration:: 5400}}
```

The gap between the two, an hour planned against ninety minutes spent, is exactly the comparison time tracking exists to show.

## Two modes: TrackTime and FlowTime

Operon offers two ways to time work:

- **TrackTime**: a count-up stopwatch. It simply records how long you spend, which is ideal for logging real effort.
- **FlowTime**: a countdown focus session with a target length, breaks, and an overtime notice. It is ideal for timeboxed, focused work. See [[DOCS-035 FlowTime focus sessions|FlowTime focus sessions]].

Both feed the same task duration, so whichever you use, the effort lands on the task. Neither is a fixed Pomodoro cycle; FlowTime is a flexible focus session with a soft target, explained in [[DOCS-035 FlowTime focus sessions|FlowTime focus sessions]].

## Review your sessions

Open the **Time Session History** panel to see and edit the sessions you have tracked. This is where you fix a forgotten stop, correct a session, or review where your time actually went. You can also log a planned time block as tracked time with the **Log as tracked** contextual action.

> **MEDIA-DOCS-034-2:** The Time Session History panel listing tracked sessions for editing.

![MEDIA-DOCS-034-2 - Time Session History tracked sessions](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-034-2.png)

## FAQ

**What is the difference between estimate and duration?** `estimate` is your plan; `duration` is the recorded reality. Comparing them is what makes planning more honest.

**Do subtasks roll up?** Yes. `totalEstimate` and `totalDuration` add a task's own time to its subtasks' time.

**TrackTime or FlowTime?** Use TrackTime to simply log effort, and FlowTime when you want a focused, timeboxed session.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Tracker**, which configures time tracking, including TrackTime and FlowTime.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-053 Time session history|Time session history]]
- [[DOCS-033 Recurring tasks|Recurring tasks]]
- [[DOCS-021 Task Editor|Task Editor]]
