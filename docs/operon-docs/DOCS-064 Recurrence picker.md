---
Notes: Build a recurrence rule with controls instead of writing it by hand
Icon: repeat
Color: "#db2777"
Updated: 2026-07-23T16:45:34
---

# Recurrence picker

The recurrence picker builds a recurrence rule for you, so you set how a task repeats with controls rather than by typing the `repeat` syntax. It is the friendly face of [[DOCS-033 Recurring tasks|recurring tasks]]: choose a frequency, an interval, and the details, and Operon writes the rule.

This picker sets the `repeat` field, whose property type is **Text** (a compact rule string). You rarely read that string, because this control writes it. See [[DOCS-033 Recurring tasks|Recurring tasks]] for the rule itself.

> **MEDIA-DOCS-064-1:** The recurrence picker with a frequency, interval, and weekday selection.

![MEDIA-DOCS-064-1 - Recurrence picker frequency and weekdays](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-064-1.png)

## Frequency and interval

Two controls form the base of every rule:

- **Frequency**: day, week, month, or year.
- **Interval**: how many of those between runs. Interval 1 is every time, 2 is every other, and so on. "Every 2 weeks" is frequency week, interval 2.

That alone covers most routines. The rest is detail for when you need it.

## Weekly and monthly detail

The picker shows extra controls that fit the frequency:

- **Weekly**: choose which **weekdays** it lands on (Mo through Su), so a rule can repeat on, say, Monday, Wednesday, and Friday.
- **Monthly**: choose between two ways to land. By **day of the month** (the 15th), or by a **weekday position** (the first Tuesday, the last Friday). The position options are first, second, third, fourth, and last.

> **MEDIA-DOCS-064-2:** The monthly options, switching between a day of the month and a weekday position like "last Friday."

![MEDIA-DOCS-064-2 - Recurrence picker monthly options](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-064-2.png)

## When the next run is measured from

The picker also sets the rule's **mode**, which decides what the next occurrence is counted from:

- **Schedule**: the next run is based on the scheduled date, so a weekly task stays on its day whether or not you finished on time.
- **Done**: the next run is based on when you complete it, so the clock restarts from completion. Good for "every 30 days after I last did it."
- **Count**: the series repeats a fixed number of times, then stops.

The modes behave differently in ways worth understanding before you choose one. For each mode with examples, guidance on which to use, and what to watch, see [[DOCS-071 Recurrence rules and modes|Recurrence rules and modes]].

## Ending the series

A recurrence does not have to run forever. You can set an **end date**, after which no further occurrences are generated, or use the count mode to stop after a set number. Leave both open for an open-ended routine.

## FAQ

**Do I ever type the rule?** Rarely. The picker writes it. You can still edit the `repeat` field by hand if you prefer. See [[DOCS-033 Recurring tasks|Recurring tasks]].

**What is the difference between schedule and done mode?** Schedule counts the next run from the scheduled date; done counts it from when you complete the task.

**Can it repeat on specific weekdays?** Yes. With weekly frequency, pick the weekdays it should land on.

## Settings

Operon settings for recurrence live in **Settings → Operon → Tasks → Recurrence**, which configures how recurring occurrences are generated.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-063 Date and time picker|Date and time picker]]
