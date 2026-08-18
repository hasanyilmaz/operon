---
Notes: Run a countdown focus session on a task, with breaks and overtime
Icon: hourglass
Color: "#9333ea"
Updated: 2026-08-18T18:18:29
---

# FlowTime focus sessions

FlowTime is the focus side of Operon's [[DOCS-034 Time tracking|time tracking]]. Where TrackTime is a stopwatch that counts up while you work, FlowTime is a countdown: you pick a task and a length, and it runs down while you focus, with breaks when you need them and a gentle nudge when time is up. Same recorded effort underneath, a different way to work.

> **MEDIA-DOCS-035-1:** The FlowTime panel counting down on a focused task.

![MEDIA-DOCS-035-1 - FlowTime countdown panel](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-035-1.png)

## Start a session

Open the panel with **Open FlowTime panel** from the command palette. The panel has two modes, **TrackTime** and **FlowTime**; choose FlowTime. Pick the task to focus on, set the session length in minutes, and the countdown begins. The time you spend is recorded against the task, just as it is with TrackTime, so a focus session still feeds the task's duration.

## Breaks

A session is not all-or-nothing. You can **Start break** to pause the focus clock, take a breather, and **End break** to resume. While a break is running the panel shows it as active, so a pause is deliberate and visible rather than a silent gap. The break length has a configurable default.

## Reaching zero, and overtime

When the countdown hits zero, FlowTime marks the **target reached** and can show a small notice, so you know the planned time is up without staring at the timer. It does not cut you off: it rolls into **Overtime** and keeps counting, so if you are in flow you can keep going and still see how far past your target you have gone. The notice is independent of the optional completion sound described below.

> **MEDIA-DOCS-035-2:** FlowTime in overtime after the countdown reached zero, with a break control available.

![MEDIA-DOCS-035-2 - FlowTime overtime state](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-035-2.png)

## Why a focus mode, not Pomodoro

Operon does not ship a Pomodoro timer, the kind that forces fixed 25-minute work blocks and 5-minute breaks on a rigid cycle. FlowTime takes a softer approach: you set a length that fits the task, take breaks when you actually need them, and the timer never cuts you off at zero. The point is to protect a stretch of focus, not to chop it into fixed intervals.

The name nods to the idea of **flowtime**, a flexible alternative to Pomodoro. Instead of letting a clock interrupt you mid-thought, you commit to one task and let its natural rhythm decide when to pause. That idea explains two of FlowTime's choices:

- **Reaching the target rolls into overtime instead of stopping.** Being in flow is never punished with a hard stop; you decide when to end.
- **Breaks are something you start, not a pause forced on you.** A break is deliberate and visible, taken when you need it.

So the length you set is a soft target, not a deadline. If you want no target at all, TrackTime is the count-up companion for plain effort logging.

## FlowTime or TrackTime?

- **FlowTime**: a timeboxed focus session. Use it when you want to commit to a stretch of focused work with a clear target and breaks.
- **TrackTime**: a plain count-up stopwatch. Use it when you just want to log effort without a target. See [[DOCS-034 Time tracking|Time tracking]].

Both record to the same task, so the choice is about how you want to work, not where the time lands. To review what you recorded, open the [[DOCS-053 Time session history|Time session history]].

## Completion sound

**Play reminder sound when FlowTime reaches zero** is off by default. When you turn it on, FlowTime plays the vault audio file selected under **Settings → Operon → Tasks → Reminders → Reminder sound** once when either a focus session or an active break reaches zero. It does not replay in overtime, when you open an already-elapsed timer, or when you enable the setting after the boundary has passed.

This sound setting is separate from **Notify when FlowTime reaches zero**: you can use the notice, the sound, both, or neither. It applies only to FlowTime focus and break completions; it does not change TrackTime's count-up behavior.

## FAQ

**Does FlowTime stop me when the timer ends?** No. It marks the target reached and continues into overtime, so you decide when to stop.

**Do FlowTime sessions count toward the task's time?** Yes. Like TrackTime, FlowTime records real effort onto the task's duration.

**Can I take breaks?** Yes. Start and end breaks from the panel; the focus clock pauses while a break is active.

**Can FlowTime play a sound when time is up?** Yes. Turn on **Play reminder sound when FlowTime reaches zero**. It uses the audio file selected under **Reminders → Reminder sound** and plays once for a FlowTime focus or break completion.

**Is there a Pomodoro timer?** No. Operon has no fixed Pomodoro cycle. FlowTime is a flexible focus session instead: set your own length, take breaks on demand, and continue into overtime past the target. Use TrackTime when you just want to count up.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Tracker**, in the TrackTime & FlowTime section: the default session length, the break (pause) duration, whether to reuse your last chosen length, the numeric timer, the notice when the countdown reaches zero, and the optional FlowTime completion sound. The sound uses **Settings → Operon → Tasks → Reminders → Reminder sound** as its file source.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]
