---
Up:
  - "[[DOCS-033 Recurring tasks|Recurring tasks]]"
  - "[[DOCS-064 Recurrence picker|Recurrence picker]]"
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
Notes: The anatomy of a recurrence rule and what each mode is for, with examples
Icon: repeat-2
Color: "#9333ea"
tags:
  - operon
  - recurrence
  - automation
Updated: 2026-06-25T16:47:21
---

# Recurrence rules and modes

A recurrence rule decides when a task's next occurrence appears. The [[DOCS-064 Recurrence picker|recurrence picker]] writes the rule and [[DOCS-033 Recurring tasks|Recurring tasks]] covers the idea; this page is the reference behind both. It explains the parts of a rule and, most importantly, the three **modes**, which differ in a way that changes how your routine behaves. Choosing the right mode is the difference between a task that holds its date and one that drifts with you.

## Anatomy of a rule

The `repeat` field holds a rule as `key=value` pairs joined by `|`. Three parts are always present, the rest are optional detail:

| Part | Meaning |
|---|---|
| `mode` | What the next run is measured from: `schedule`, `done`, or `count` (below). |
| `freq` | The unit: `day`, `week`, `month`, or `year`. |
| `interval` | How many units between runs. `interval=2` with `freq=week` is every other week. |
| `days` | Weekdays it lands on, like `mo,we,fr` (weekly patterns). |
| `monthdays` | Days of the month, like `15` (monthly by date). |
| `setpos` | A weekday position, like the first or last (monthly by position). |
| `month` | The month, for yearly rules. |
| `count` | How many times the series runs (count mode only). |

You rarely write this by hand; the picker does. But reading it helps when you check or tweak a task. See [[DOCS-012 Inline task syntax|Inline task syntax]].

## The three modes

The mode is the part that most changes behavior, because it decides what the next occurrence is **anchored** to.

### Schedule mode

The next run is measured from the **scheduled date**. The task keeps its rhythm no matter when you actually finish: a `Monday` task stays on Mondays even if you complete it on Wednesday. This is the mode for fixed calendar routines, and it is the one that supports weekday and month-day detail.

- **Anchored to:** the scheduled date.
- **Good for:** standing commitments. A weekly review every Monday, an invoice on the 1st, a report on the last Friday.
- **Watch:** finishing late does not shift the next date. The rhythm is the calendar, not you.

### Done mode

The next run is measured from **when you complete the task**. Finish late and the whole series shifts with you. This is the mode for "do it again a while after the last time," and it is deliberately simple: it takes only a frequency and interval, with no specific weekdays or month-days.

- **Anchored to:** the completion date.
- **Good for:** maintenance and habits paced from the last completion. Water the plants every 5 days, replace the filter every 3 months, deep-clean every 30 days.
- **Watch:** there is no "specific weekday" here. Done mode is a plain interval from completion, so if you need "every Monday," use schedule mode instead.

### Count mode

The series behaves like schedule mode, with the calendar detail it allows, but stops after a **set number** of runs. It is the mode for a series with a known length.

- **Anchored to:** the scheduled date, like schedule mode.
- **Good for:** a fixed-length series. A six-week course, an eight-session program, a four-part rollout.
- **Watch:** it requires a count, and the series ends when the count is reached.

## Choosing a mode

| If you want... | Use |
|---|---|
| A fixed calendar rhythm that ignores when you finish | Schedule |
| To repeat a set time after you last finished | Done |
| A series that runs a known number of times | Count |

When in doubt, schedule mode is the common choice; done mode is the special tool for "paced from completion."

> **MEDIA-DOCS-071-1:** The three modes side by side: schedule and count anchored to the scheduled date, done anchored to completion.

![MEDIA-DOCS-071-1 - Recurrence mode comparison](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-071-1.png)

## Examples

The rule is what the picker produces. A few read together with their meaning:

| Rule | Means |
|---|---|
| `mode=schedule\|freq=week\|interval=1` | Every week, on the scheduled day. |
| `mode=schedule\|freq=week\|interval=1\|days=mo,we,fr` | Every week on Monday, Wednesday, and Friday. |
| `mode=schedule\|freq=month\|interval=1\|monthdays=1` | The 1st of every month. |
| `mode=done\|freq=day\|interval=5` | Five days after each time you finish it. |
| `mode=count\|freq=week\|interval=1\|count=6` | Every week, six times, then stop. |

## Ending a recurrence

A recurrence can stop in two ways: set an **end date** (the `datetimeRepeatEnd` field), after which no more occurrences are generated, or use **count mode** to stop after a set number of runs. Leave both unset for an open-ended routine. See [[DOCS-033 Recurring tasks|Recurring tasks]].

## FAQ

**I finished a weekly task two days late. Did the next one move?** In schedule mode, no, it stays on its day. In done mode, yes, it shifts to count from your completion.

**Why can't I pick weekdays for my "done" rule?** Done mode is a plain interval from completion and does not take weekday or month-day detail. Use schedule mode for specific days.

**How do I make a recurrence stop?** Give it an end date, or use count mode with a number of runs.

## Settings

Operon settings for recurrence live in **Settings → Operon → Tasks → Recurrence**, which configures how recurring occurrences are generated.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-058 Operon inheritance rules|Operon inheritance rules]]
