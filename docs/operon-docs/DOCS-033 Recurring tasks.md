---
Up:
  - "[[DOCS-058 Operon inheritance rules|Operon inheritance rules]]"
  - "[[DOCS-021 Task Editor|Task Editor]]"
  - "[[DOCS-013 File tasks|File tasks]]"
Notes: Generate future work from a repeating pattern
Icon: repeat
Color: "#9333ea"
tags:
  - operon
  - recurrence
  - automation
Updated: 2026-06-25T16:47:21
---

# Recurring tasks

Recurring tasks create future work from a repeating pattern, so routines, reviews, and maintenance do not need manual duplication. In Operon, recurrence is more than a reminder: it generates fresh occurrences that carry useful structure forward while resetting the parts that belong to each run.

> **MEDIA-DOCS-033-1:** A recurring task and its upcoming occurrences projected on the Calendar.

![MEDIA-DOCS-033-1 - Recurring task occurrences on Calendar](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-033-1.png)

## How it works

A recurring task carries a `repeat` field describing the pattern:

```md
- [ ] Weekly release review {{operonId:: {{operonId}}}} {{status:: Project.Planned}} {{dateScheduled:: 2026-06-12}} {{repeat:: mode=schedule|freq=week|interval=1}}
```

The rule is a set of `key=value` pairs joined by `|`. Three are always present: `mode` (`schedule`, `done`, or `count`), `freq` (`day`, `week`, `month`, or `year`), and `interval` (a positive number, so `interval=1` is every week and `interval=2` is every other week). Optional parts add detail, such as `days=mo,we,fr` for specific weekdays or `monthdays=15` for a day of the month. You rarely type this yourself, since the recurrence control writes it for you.

A few more patterns, ready to paste. Each pastes as its own recurring task:

```md
- [ ] Stand-up notes {{operonId:: {{operonId}}}} {{dateScheduled:: 2026-06-15}} {{repeat:: mode=schedule|freq=week|interval=1|days=mo,we,fr}}
- [ ] Pay the rent {{operonId:: {{operonId}}}} {{dateScheduled:: 2026-07-01}} {{repeat:: mode=schedule|freq=month|interval=1|monthdays=1}}
- [ ] Water the plants {{operonId:: {{operonId}}}} {{repeat:: mode=done|freq=day|interval=5}}
- [ ] Six-week course check-in {{operonId:: {{operonId}}}} {{repeat:: mode=count|freq=week|interval=1|count=6}}
```

In order: every Monday, Wednesday, and Friday; the first of every month; five days after each time you finish it; and weekly for six runs, then stop. See [[DOCS-071 Recurrence rules and modes|Recurrence rules and modes]] for the full grammar.

The modes matter most, because they change how the routine behaves: `schedule` keeps a fixed calendar rhythm, `done` paces the next run from when you finish, and `count` stops after a set number. For each mode with examples and guidance on which to use, see [[DOCS-071 Recurrence rules and modes|Recurrence rules and modes]].

Behind the scenes, Operon tracks a recurrence series so that future occurrences inherit the right state and timing. The most recent occurrence is usually the best source for carrying state forward, which lets your edits survive into the next run. Because of this, a single task line does not hold the whole recurrence model; the series does.

## Set it in the editor

The simplest way to add or change recurrence is the [[DOCS-021 Task Editor|Task Editor]], which gives you a recurrence control rather than asking you to write the `repeat` rule by hand. You can also type a rule directly in the field if you prefer.

> **MEDIA-DOCS-033-2:** The recurrence control in the Task Editor building a weekly rule.

![MEDIA-DOCS-033-2 - Recurrence control building weekly rule](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-033-2.png)

## What carries forward, what resets

When a new occurrence is created, structure that should persist (the task's shape, its body for a file task) carries forward, while per-occurrence parts reset: completion state, tracked time, and progress start fresh. This is what stops a recurring task from being a stale copy of the last run. For the exact field-by-field list of what carries forward and what resets, see [[DOCS-058 Operon inheritance rules|Operon inheritance rules]].

## Recurring file tasks

Recurrence works especially well for [[DOCS-013 File tasks|file tasks]] with a stable structure, like a weekly review or a publishing checklist that needs the same sections every time. A recurring file task can create a new note for each occurrence, giving each run its own working space. See [[DOCS-013 File tasks|File tasks]].

## Skipping an occurrence

If a single run does not apply, open the task's [[DOCS-042 Contextual menu actions|contextual menu]] and choose **Skip this occurrence**. The series continues; only that one instance is skipped.

## FAQ

**Where do I set the recurrence rule?** In the Task Editor's recurrence control, or directly in the `repeat` field.

**Will my edits be lost on the next occurrence?** No. Operon carries state forward from the latest occurrence, so meaningful changes persist while per-run fields reset.

**Can a recurring task make a new file each time?** Yes. A recurring file task can create a fresh note per occurrence.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Recurrence**, which configures how recurring occurrences are generated.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-064 Recurrence picker|Recurrence picker]]
- [[DOCS-034 Time tracking|Time tracking]]
- [[DOCS-028 Calendar overview|Calendar overview]]
