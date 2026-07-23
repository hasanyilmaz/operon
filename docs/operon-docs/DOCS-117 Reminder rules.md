---
Notes: The anatomy of a reminder rule, its reference dates and offset syntax, with examples
Icon: bell-ring
Color: "#ca8a04"
Updated: 2026-07-23T16:45:34
---

# Reminder rules

A reminder rule does not store a moment. It stores a **relationship**: how long before one of the task's own dates you want to be reminded. That is what lets a reminder follow a task when its dates move. This page is the reference for how a rule is written and how Operon resolves it. For what reminders are and how you use them day to day, see [[DOCS-116 Reminders|Reminders]].

You normally never type a rule by hand. The rule picker asks for the offset and builds the rest. This page matters when you want to know exactly what it built, or you are reading the value in your Markdown.

## The anatomy of a rule

A rule is two parts joined by a single dot:

```
dateDue.1d
```

- **The reference date** (`dateDue`), the task field the reminder hangs off.
- **The offset** (`1d`), how long **before** that date to fire.

An offset always means *before*. There is no syntax for "after"; a reminder that fires after its date would be a different kind of thing. To fire exactly at the date, use an offset of `0m`.

## The five reference dates

A rule can attach to any of these five task fields, and no others:

| Reference date | Type | What it is |
|---|---|---|
| `dateDue` | Date | The deadline |
| `dateScheduled` | Date | When you plan to work on it |
| `dateStarted` | Date | The earliest date it can begin |
| `datetimeStart` | Date & time | The start of a timed block |
| `datetimeEnd` | Date & time | The end of that timed block |

The rule picker only offers the ones the task actually has a value for. A task with only a due date gives you one candidate per offset; a task with a due date and a timed block gives you three.

**The first three carry a date but no time.** Operon resolves them at **midnight** at the start of that day. So `dateDue.0m` on a task due the 14th fires at 00:00 on the 14th, and `dateDue.2h` fires at 22:00 on the 13th.

This has a consequence worth knowing: because offsets only count backwards from midnight, no rule on a date-only field can fire *during* the due day itself. To be reminded at nine in the morning on the due date, either give the task a timed start and hang the rule off that, or use a fixed reminder instead. See [[DOCS-116 Reminders|Reminders]].

**The last two carry a real time**, so the offset counts back from that exact moment.

## Offset syntax

An offset is built from up to four units:

| Unit | Means |
|---|---|
| `w` | Weeks |
| `d` | Days |
| `h` | Hours |
| `m` | Minutes |

Rules for writing one:

- **At least one unit is required.** An empty offset is not a rule.
- **Units must appear in descending order**: weeks, then days, then hours, then minutes. `1d12h` is valid; `12h1d` is not.
- **Each unit appears at most once.** Use `1h30m`, not `1h1h30m`.
- **Lowercase only.** `1D` is not accepted.
- **No spaces in the stored form.** The picker lets you type `1d 12h` for comfort, but what gets written is `1d12h`.
- **Whole numbers only, and never negative.** There are no fractional units; write `90m` or `1h30m`, not `1.5h`.

Examples of valid offsets: `10m`, `45m`, `2h`, `1h30m`, `1d`, `3d`, `1d12h`, `1w`, `1w2d`, `2w3d4h30m`, `0m`.

## Operon rewrites your offset into a canonical form

Two offsets that mean the same length of time are stored the same way, so a rule never exists twice in two spellings. Operon rolls minutes up into hours and days up into weeks:

| You enter | Stored as | Why |
|---|---|---|
| `90m` | `1h30m` | 60 minutes becomes an hour |
| `7d` | `1w` | 7 days becomes a week |
| `10d` | `1w3d` | The whole weeks are pulled out |
| `0h0m` | `0m` | A zero offset always writes as `0m` |
| `1d12h` | `1d12h` | Already canonical |

This is also how duplicate rules are caught: two rules on the same reference date whose offsets canonicalize to the same string are the same rule, and the second one is refused.

## Days are not hours: `1d` and `24h` differ

This is the one thing about the syntax worth reading twice, because it decides what happens across a daylight-saving change.

- **Weeks and days move the calendar.** `1d` means "the previous day, at the same wall-clock time." Across a spring-forward or fall-back boundary, the clock time stays put and the actual elapsed time is 23 or 25 hours.
- **Hours and minutes count elapsed time.** `24h` means "exactly twenty-four hours earlier." Across the same boundary, the elapsed time stays put and the wall-clock time shifts by an hour.

Most of the time these land identically and the distinction never surfaces. When it does, `1d` is almost always what a person means by "a day before", because they are thinking in calendar days, not in hours. Operon keeps `24h` as `24h` rather than folding it into `1d` precisely because they are not interchangeable.

The same logic applies to `1w` versus `7d`: those two *are* interchangeable, both being calendar movements, which is why `7d` canonicalizes to `1w`.

## When a rule cannot resolve

A rule is kept on the task whether or not it currently resolves. What changes is how it is reported:

| Situation | What Operon shows | What it means |
|---|---|---|
| The reference date is empty | **Unresolved reminder** | The rule is fine; the task has no value in that field yet |
| The reference date holds an unreadable value | **Unresolved reminder** | The field's value is not a date Operon can parse |
| The rule itself is malformed | **Invalid reminder** | Bad offset, unknown reference date, wrong shape |
| The resolved time falls outside supported dates | **Invalid reminder** | The arithmetic ran past year 1 or year 9999 |

Unresolved is a normal, temporary state, not an error. Clear a due date and its rules go unresolved; set a due date again and they resolve on their own with nothing to rebuild. Nothing is scheduled while a rule is unresolved.

## Two rules landing on the same moment

Rules resolve independently, so nothing stops two of them from arriving at the same instant. A task where `datetimeStart` and `dateDue` happen to coincide, carrying both `datetimeStart.1h` and `dateDue.1h`, resolves both to one moment.

When that happens you get **one reminder, not two**. Operon groups reminders by the moment they resolve to, so a single instant produces a single notification no matter how many rules or fixed reminders point at it. The rules all stay on the task; they simply share one delivery.

This is also why the picker refuses a new reminder that lands on a moment the task already covers: it would add a rule that could never produce a notification of its own.

## Reminder rules in real tasks

Inline tasks store several rules in one `{{reminderRules:: ...}}` field, separated by `; `, and fixed reminders the same way in `{{reminderDatetimes:: ...}}`. File tasks store both as YAML lists, under the visible `ReminderRules` and `ReminderDatetimes` properties. The examples below mix both kinds on the same task, since a task is free to carry either or both. They are complete enough to paste into a real workflow; their `operonId` placeholders generate fresh task identities instead of encouraging duplicate static ids. See [[DOCS-061 operonId template variables|operonId template variables]].

### Inline task examples

This workshop has a real start and end time. Two reminders are rules: the first fires at 09:00, thirty minutes before the workshop begins, the second at 11:20, ten minutes before its planned end. One more is fixed: the evening before, at 18:00, to finish prepping slides, a moment that has nothing to do with any of the task's own dates:

```md
- [ ] Lead the quarterly planning workshop #work {{operonId:: {{operonId}}}} {{status:: Project.Planned}} {{priority:: A}} {{dateScheduled:: 2026-07-23}} {{datetimeStart:: 2026-07-23T09:30:00}} {{datetimeEnd:: 2026-07-23T11:30:00}} {{reminderDatetimes:: 2026-07-22T18:00:00}} {{reminderRules:: datetimeStart.30m; datetimeEnd.10m}} {{contexts:: [[Office]]}}
```

This deadline uses a date-only field. Two reminders are rules: because `dateDue` resolves at midnight, they fire at 00:00 on July 24 and July 30, one week and one day before the July 31 deadline. Two more are fixed: a call with the accountant on the 24th at 10:00, and a final receipts review on the 29th at 09:00, neither of which needs to move if the due date ever does:

```md
- [ ] Submit the monthly VAT return #finance {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{priority:: A}} {{dateStarted:: 2026-07-20}} {{dateDue:: 2026-07-31}} {{reminderDatetimes:: 2026-07-24T10:00:00; 2026-07-29T09:00:00}} {{reminderRules:: dateDue.1w; dateDue.1d}} {{contexts:: [[Finance]]}}
```

### File task YAML examples

This File Task represents a client presentation with two reminders around its timed block, plus one fixed reminder to send the calendar invite three days ahead. `ReminderDatetimes` and `ReminderRules` are each a YAML sequence, not a semicolon-separated scalar:

```yaml
---
Type: Task
Status: Project.Planned
Priority: A
dateScheduled: 2026-07-28
datetimeStart: 2026-07-28T14:00:00
datetimeEnd: 2026-07-28T15:30:00
ReminderDatetimes:
  - 2026-07-25T09:00:00
ReminderRules:
  - datetimeStart.1h
  - datetimeEnd.15m
contexts:
  - "[[Office]]"
  - "[[Client Work]]"
operonId: {{operonId}}
datetimeCreated: {{datetime}}
datetimeModified: {{datetime}}
---
```

This recurring File Task schedules a weekly review every Monday. Its rules carry forward with each new occurrence: one reminder at Sunday midnight and another at Sunday 22:00, both resolved from the next Monday's date-only `dateScheduled` value. Its two fixed reminders do not carry forward the same way: they are pinned to this specific Sunday, the 26th, at 17:00 and 21:00, and belong only to this occurrence. See [[DOCS-058 Operon inheritance rules|Operon inheritance rules]].

```yaml
---
Type: Task
Status: Project.Planned
Priority: B
dateScheduled: 2026-07-27
repeat: mode=schedule|freq=week|interval=1|days=mo
ReminderDatetimes:
  - 2026-07-26T17:00:00
  - 2026-07-26T21:00:00
ReminderRules:
  - dateScheduled.1d
  - dateScheduled.2h
contexts:
  - "[[Operations]]"
operonId: {{operonId}}
datetimeCreated: {{datetime}}
datetimeModified: {{datetime}}
---
```

Editing rules by hand works, but the picker is the reliable path, because it validates as you type and shows you the resolved moment before you commit. If you do edit by hand, the syntax rules above are strict: one dot, a known reference date, lowercase units in descending order, no spaces. A value that does not parse is kept exactly as you wrote it and flagged as an **Invalid reminder** rather than being silently corrected or dropped, so a typo is always visible rather than quietly costing you a reminder.

See [[DOCS-012 Inline task syntax|Inline task syntax]] for the complete inline and File Task storage conventions.

## Common rules

| Rule | Fires |
|---|---|
| `dateDue.0m` | At midnight starting the due date |
| `dateDue.1d` | A day before it is due, at midnight |
| `dateDue.1w` | A week before it is due |
| `dateScheduled.1d` | The day before you planned to work on it |
| `dateStarted.1d` | A day before the earliest date it can begin, at midnight |
| `datetimeStart.10m` | Ten minutes before a timed block starts |
| `datetimeStart.1h` | An hour before it starts |
| `datetimeStart.0m` | Exactly when it starts |
| `datetimeEnd.15m` | A quarter of an hour before it should be finished |
| `datetimeStart.1d12h` | A day and a half before it starts |

## Tips

> [!tip] A rule works in a template before any date exists
> A rule does not need its reference date to be filled in yet. Put `dateDue.1d` in a task template and it sits there unresolved, doing nothing, until whoever builds a task from that template gives it a due date. The moment that date lands, the rule resolves and starts counting down, with nothing else to set up. This is the same unresolved state described above, just reached from the other direction: instead of a date being cleared, it has not been added yet.

> [!tip] Set a rule once on a recurring task, and every future occurrence keeps it
> Because rules carry forward to each new occurrence and re-resolve against its own dates, you only add `datetimeStart.15m` once. Every occurrence after that, for as long as the task keeps recurring, gets reminded the same way on its own dates, with nothing to re-add and nothing to remember. See [[DOCS-033 Recurring tasks|Recurring tasks]] and [[DOCS-058 Operon inheritance rules|Operon inheritance rules]].

## FAQ

**Can a rule fire after its date instead of before?** No. Offsets only count backwards. Use a fixed reminder from [[DOCS-116 Reminders|ReminderDatetimes]] for a moment after the fact.

**Why does my rule fire at midnight?** Its reference date is a date without a time, so Operon resolves it to the start of that day. Add an offset, or attach the rule to a timed start or end instead.

**Why did `90m` become `1h30m`?** Offsets are stored in canonical form, so the same duration is always written one way. The behavior is unchanged.

**Is `1d` the same as `24h`?** Usually, but not across a daylight-saving change. `1d` keeps the clock time and moves the calendar; `24h` counts exactly twenty-four hours.

**Can I use seconds?** No. The smallest unit is the minute.

**What happens if two rules resolve to the same time?** They share one notification. Both rules stay on the task.

**I cleared a date and the rule is still listed.** That is deliberate. It is marked unresolved and does nothing until the date comes back, at which point it works again without being rebuilt.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-018 Task properties|Task properties]]
- [[DOCS-063 Date and time picker|Date and time picker]]
- [[DOCS-071 Recurrence rules and modes|Recurrence rules and modes]]
