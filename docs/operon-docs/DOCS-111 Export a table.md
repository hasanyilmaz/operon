---
Notes: Copy or download a table as Markdown or CSV, or grab its embed code
Icon: download
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Export a table

The export control turns the table in front of you into text you can take elsewhere: a Markdown table to paste into a note, a CSV to open in a spreadsheet, or the code that embeds the table 1back into a note. Open it from the **export** control on the table toolbar.

## The export menu

| Option | What it does |
|---|---|
| Copy Markdown table | Copies the table as a Markdown table to the clipboard |
| Copy CSV | Copies the table as CSV to the clipboard |
| Export CSV file | Downloads the table as a `.csv` file |
| Copy table embed code | Copies the `operon-table` code block that embeds this table in a note. See [[DOCS-110 Embed a table in a note\|Embed a table in a note]] |

If the table has no rows, there is nothing to export and Operon tells you so.

## What gets exported

Export uses the table's current rows and columns:

- **The visible columns**, in their current order. Hidden columns are left out, and the line number, task icon, and task type helper columns are included when they are shown.
- **The current row set**, in the current sort order and narrowed by whatever filter, search text, and scopes are active. Export a filtered or searched table and you export just that slice, not every task and not only the rows currently visible in the viewport.
- **Textual cell values**, using the same display text the table resolves for its cells. Helper columns and compact-rendered cells export their underlying text or icon value, not the visual-only button or compact rendering.

The export is a flat table: it carries the header row and the data rows, but not the [[DOCS-107 Table grouping and sorting|group headings]] or the [[DOCS-108 Table summaries|summary]] footers. If you want a grouped or summarized breakdown, read it in the table itself.

## Markdown and CSV

The two text formats suit different destinations:

- **Markdown table** pastes straight into a note as a normal Markdown table. Line breaks inside a cell become `<br>` and any pipe characters are escaped, so the table stays valid.
- **CSV** opens in any spreadsheet. Values are quoted and escaped as CSV needs, and a cell that begins with a spreadsheet formula character is written safely so a spreadsheet does not treat it as a formula.

**Export CSV file** downloads the same CSV as a file named after the preset and the date and time, so repeated exports stay easy to tell apart.

## Copy embed code

The last option, **Copy table embed code**, does not export the data. It copies the small code block that renders this preset's table inside a note, the same block described in [[DOCS-110 Embed a table in a note|Embed a table in a note]]. Reach for it when you want a live table in a note rather than a static copy.

## Tips

> [!tip] Filter first, then export
> Export takes the table as it stands. Narrow it with the search box and scopes, or switch to a tighter preset, before you export. You get exactly the slice you want and nothing else.

## FAQ

**Does export include hidden columns?** No. Only the visible columns are exported, in their current order.

**Does it respect my filter and search?** Yes. Export takes the current filtered, searched, and sorted row set, so any active filter, search text, or scope is reflected.

**Are group headings and summaries exported?** No. The export is a flat header-and-rows table. Read groups and summaries in the table itself. See [[DOCS-107 Table grouping and sorting|Table grouping and sorting]] and [[DOCS-108 Table summaries|Table summaries]].

**What is the difference between the CSV options?** Copy CSV puts it on the clipboard; Export CSV file downloads it as a `.csv` file.

**Is Copy table embed code an export of my data?** No. It copies the code block that embeds the live table in a note, not the rows. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
- [[DOCS-109 Table presets|Table presets]]
