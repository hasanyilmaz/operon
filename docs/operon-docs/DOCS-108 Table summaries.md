---
Notes: Roll a column up into a total at the foot of the table and each group
Icon: sigma
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Table summaries

A summary rolls a column up into a single value shown at the foot of the table. It turns a column of estimates into a total, a column of due dates into the earliest one, or a column of statuses into a completion rate, so the table answers a question about the whole set, not just each row. Each column can carry one summary, and summaries are saved in the [[DOCS-109 Table presets|preset]].

> **MEDIA-DOCS-108-1:** A table with a summary row at the foot: a task count, a summed estimate, and an earliest due date.

![MEDIA-DOCS-108-1 - A table with a summary footer row](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-108-1.png)

## Add a summary

Two ways to set one, both writing to the same preset:

- From a **column header**, choose **Summarize column...** (or **Edit summary...** if one is already set). A small picker opens with the summaries that fit that column; pick one, or **Hide summary** to remove it.
- From the preset's **Summaries** section under **Edit preset**, add a summary by choosing a field and a function, or clear them all at once. See [[DOCS-109 Table presets|Table presets]].

A column shows only the summaries that make sense for its field type, so you never pick an invalid combination.

## Per group and per table

When the table is [[DOCS-107 Table grouping and sorting|grouped]], each summary is calculated twice: once for the **whole table**, on the footer at the very bottom, and once **per section**, on each group's own footer. So a table grouped by assignee and summing the estimate column shows each person's total on their section and the grand total at the foot. This is what makes grouping and summaries such a natural pair.

## Which summaries a column offers

The available functions depend on the column's field type, and this applies just as much to a [[DOCS-115 File task property columns|file task property column]] as to a built-in field: a discovered property typed as Number gets Sum and Average, one typed as Date gets Earliest and Latest, and so on, exactly like the table below.

| Column type | Summaries it offers |
|---|---|
| Any column | Count, Filled, Empty, Unique, Top values |
| Number (estimate, duration, totals, numeric custom keys) | The above, plus Sum, Average, Median, Min, Max, Range, Stddev |
| Date (due, scheduled, start, and other dates) | The above, plus Earliest, Latest |
| Status or checkbox | The above, plus Open count, Finished count, Cancelled count, Terminal count, Completion rate |
| List or tags | The above, plus List item count |

## What each summary means

| Summary | Applies to | Value it shows |
|---|---|---|
| Count | Any column | How many tasks are in the table or group |
| Filled | Any column | How many have a value in this column |
| Empty | Any column | How many leave this column blank |
| Unique | Any column | How many distinct values appear |
| Top values | Any column | The most common values in the column |
| Sum | Number | The total of the numbers |
| Average | Number | The mean of the numbers |
| Median | Number | The middle number |
| Min / Max | Number | The smallest and largest numbers |
| Range | Number | The spread from smallest to largest |
| Stddev | Number | How spread out the numbers are |
| Earliest / Latest | Date | The earliest and latest date |
| Open count | Status or checkbox | How many tasks are still open |
| Finished count | Status or checkbox | How many are finished |
| Cancelled count | Status or checkbox | How many are cancelled |
| Terminal count | Status or checkbox | How many are finished or cancelled |
| Completion rate | Status or checkbox | Finished tasks divided by open plus finished tasks |
| List item count | List or tags | The total number of items across a list or tags column |

**Completion rate** leaves cancelled tasks out of its denominator, so a cancelled task does not make the rate look worse. **Top values** shows the most common visible values rather than every distinct value in a crowded column.

## Tips

> [!tip] Summarize the column you group by, and one you measure by
> A grouped table earns its keep when the section headings carry a number. Group by assignee and put a **Count** on the description column to see how many tasks each person holds, then a **Sum** on the estimate column to see how many hours. Each section footer becomes a small report, and the table footer gives you the whole picture.

## FAQ

**Can a column have more than one summary?** No. Each column carries a single summary. Change it with **Edit summary...**, or remove it with **Hide summary**.

**Why does a column not offer the summary I want?** Summaries are limited to what fits the field type. Sum needs a number column, Earliest needs a date column, and Completion rate needs the status or checkbox column.

**Do summaries update as I edit?** Yes. A summary recalculates when the tasks under it change, so it reflects the current rows. During an active search, Operon can briefly show **Calculating** while the summary catches up to the narrowed row set.

**Do summaries appear per group?** Yes, when the table is grouped: each section gets its own summary footer, plus a total for the whole table.

**Are summaries included when I export?** No. Exports are flat header-and-rows tables, without group headings or summary footers. See [[DOCS-111 Export a table|Export a table]].

**Where are summaries saved?** In the preset, so each table keeps its own set. See [[DOCS-109 Table presets|Table presets]].

## Settings

Summaries are set from a column header or from the **Summaries** section of the preset's full settings under **Edit preset**. They are stored in the preset alongside its columns, grouping, and sorting. See [[DOCS-109 Table presets|Table presets]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-111 Export a table|Export a table]]
- [[DOCS-115 File task property columns|File task property columns]]
