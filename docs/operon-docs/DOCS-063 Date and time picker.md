---
Up:
  - "[[DOCS-062 Field pickers overview|Field pickers overview]]"
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
  - "[[DOCS-028 Calendar overview|Calendar overview]]"
Notes: Set dates and times by typing them in words or picking from a calendar
Icon: calendar-days
Color: "#db2777"
tags:
  - operon
  - pickers
  - date
  - time
Updated: 2026-06-25T16:47:21
---

# Date and time picker

The date picker is how you set a date field, and its best feature is that you can **type the date in plain words**. "next tuesday", "3 days from now", "tomorrow": Operon reads the phrase and offers the matching date, so you rarely reach for a calendar. The same picker, with a time added, sets the timed fields.

This picker serves two property types: **Date** fields (`dateDue`, `dateScheduled`, `dateStarted`, `dateCompleted`, `dateCancelled`) and **Date & time** fields (`datetimeStart`, `datetimeEnd`, `datetimeRepeatEnd`). See [[DOCS-012 Inline task syntax|Inline task syntax]] for the stored formats.

> **MEDIA-DOCS-063-1:** The date picker open, with a typed phrase and the matching date suggested below.

![MEDIA-DOCS-063-1 - Date picker typed phrase suggestion](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-063-1.png)

## Type the date in words

Open the picker and start typing. As you type, it suggests dates that match. It understands, in your interface language:

- **Named days**: `today`, `tomorrow`, `yesterday`.
- **Weekdays**: `next tuesday`, and the coming weekday by name.
- **Relative offsets**: a number and a unit, like `3 days from now` or `2 weeks ago`. You can shorten the unit to its first letters, so `3 d`, `3 w`, and `3 m` stand for days, weeks, and months. Both directions are offered, future and past, so you pick the one you mean.
- **Just a number**: type only `3` and Operon offers 3 days, 3 weeks, and 3 months, in both directions, so you can choose the unit from the list.
- **Day and month**: type the **day first**, then a month name, like `3 march`. A partial month name matches too, so `3 m` also suggests calendar dates whose month starts with m, such as March 3 and May 3. Operon picks the next upcoming occurrence within the coming year. The number always leads: `3 aug` works, but `aug 3` does not.
- **Explicit dates**: an ISO date such as `2026-05-31`.

In every typed form except a full ISO date, **the number comes first**. You write the count or the day, then the unit or month name, so it is always `3 days`, `3 m`, or `3 aug`, never `aug 3`. The displayed suggestion may read month-first, like "March 3, 2027", but what you type stays number-first.

The suggestions are intentionally broad while you are still typing, so a short query can surface several readings at once. Typing `3 m`, for example, offers **3 months from now** and **3 months ago** as offsets, plus **March 3** and **May 3** as calendar dates, since both months begin with m. Keep typing to narrow it: `3 march` settles on the single date.

The placeholder itself reminds you of the idea: "Type a date like next tuesday." Pick a suggestion to set the field.

## Or pick from the calendar

If you would rather see the month, the picker also shows a calendar grid. Move by month or year, click a day, and use **Today** to jump to the current day or **Clear** to empty the field. Typing and clicking are two ways into the same control; use whichever is faster for the date you want.

> **MEDIA-DOCS-063-2:** The calendar grid in the date picker, with Today and Clear actions.

![MEDIA-DOCS-063-2 - Date picker calendar grid](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-063-2.png)

## Adding a time

For a **Date & time** field, the picker also takes a time, so you set both the day and the moment. This is what turns a task into a timed block on the [[DOCS-028 Calendar overview|Calendar]]. One pairing rule applies: an end time (`datetimeEnd`) only makes sense once a start (`datetimeStart`) is set, so Operon asks for the start first.

## Removing a date

A date field can be emptied. When a field already has a value, the picker offers to remove it, which clears the field rather than setting a new date. This is how you unschedule or drop a deadline from the editor.

## FAQ

**Do I have to use a calendar?** No. Typing a phrase like "next friday" is usually faster, and the calendar is there when you want it.

**What date phrases work?** Named days (today, tomorrow), weekdays (next tuesday), offsets (3 days from now, 2 weeks ago), a bare number for a quick offset (3), and a day with a month name written number-first (3 march), in your interface language.

**Why doesn't `aug 3` work?** The day always comes before the month, so write `3 aug`, not `aug 3`. Operon reads a typed date number-first, even though the suggestion it shows may read month-first.

**Why does `3 m` show months and calendar dates together?** While you type, Operon reads a short query both ways: `3 m` as an offset (3 months) and as a day with a month starting with m (March 3, May 3). Type more, such as `3 march`, to narrow it to one.

**Why can't I set an end time?** A timed end needs a start first. Set `datetimeStart`, then the end.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-064 Recurrence picker|Recurrence picker]]
- [[DOCS-070 Custom field pickers|Custom field pickers]]
