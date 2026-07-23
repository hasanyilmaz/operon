---
Notes: Save a table as a preset and switch between several tables
Icon: table-2
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Table presets

A preset saves a table layout and scope. It bundles which tasks appear, which task-field columns show and in what order, how the rows are grouped and sorted, which summaries roll up, how dense the rows are, and which search scopes are saved with the preset, all under a name. Presets are what let you keep several tables for different questions and switch between them from the toolbar, and the **default preset** is the one a new table opens with or the **Insert Operon Table embed** command uses.

Each preset is also a real file in your vault, with a `.table` extension. Editing a preset here writes straight to that file. See [[DOCS-114 Table files|Table files]] for the file itself: where it lives, what happens when you rename or move it, and what a broken or duplicate file looks like.

> **MEDIA-DOCS-109-1:** The table preset settings, with the Filtering, Grouping, Sort, Summaries, Display, and Columns sections.

![MEDIA-DOCS-109-1 - The table preset selector](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-109-1.png)

## What a preset holds

A preset stores the parts of a table that define the reusable view:

- The **filter** that decides which tasks appear.
- The **columns**, their order, width, alignment, color, and format. See [[DOCS-106 Table columns|Table columns]].
- The **grouping** and **sorting** of the rows. See [[DOCS-107 Table grouping and sorting|Table grouping and sorting]].
- The **summaries** at the foot of each column. See [[DOCS-108 Table summaries|Table summaries]].
- The **display** density.
- The **search scope** choices, such as project scope, Overdue, Happens Today, and whether finished or cancelled tasks are included.

The line number, task icon, and task type helper columns are global Table settings, not normal preset columns. Because the reusable layout lives in the preset, two presets never step on each other: change the columns on one and the others keep their own layout.

## Editing a preset

Open a preset's full settings with **Edit preset**, from the settings button on the toolbar or from any column header's menu. The settings are organized into sections:

| Section | What it sets |
|---|---|
| Preset | The preset's name |
| Filtering | Which tasks appear, a FilterSet or All Tasks |
| Grouping | The group and subgroup fields and their order |
| Sort | The sort rules, their direction, and where empty values go |
| Summaries | The per-column summaries |
| Display | The row density, compact or comfortable. This is separate from a column's detailed or compact cell mode; see [[DOCS-112 Table cells display and behavior\|Table cells: display and behavior]] |
| Columns | Which fields are columns and their order |

Most of these also have quicker paths: columns from a header menu, grouping and sorting from **Group & Sort**, and a summary from a header. The preset settings gather them in one place, plus the options that live only here, such as a sort rule's empty placement.

## Choosing which tasks appear

The **Filtering** section sets the table's scope: choose a saved FilterSet to show only the tasks it matches, or **All Tasks** to show everything. This is the same FilterSet mechanism the [[DOCS-025 Filter View|Filter View]], Calendar, and Kanban use, which is why a table can share its filter with a related Calendar or Kanban through the related views control. See [[DOCS-025 Filter View|Filter View]].

## Favorite presets

Any preset can be marked a **favorite** with the star toggle, from its **Edit preset** settings or its row in the **Table Presets** list under **Settings → Operon → Views → Tables**. Favorites are about quick access, not defaults: the toolbar's centered preset shortcuts show only your favorites, so that row stays short even with many saved tables, while the toolbar's preset picker still lists every preset, favorite or not. A preset's favorite status is independent of the default preset described above; a preset can be one, both, or neither.

## Managing presets

The footer of the preset settings carries the management actions:

| Action | What it does |
|---|---|
| Save | Saves your changes to the preset |
| New | Creates a fresh preset from the current one, as a new `.table` file |
| Duplicate | Makes a copy of the preset, as a new `.table` file with its own id |
| Favorite / Unfavorite | Toggles the preset's favorite star |
| Copy embed code | Copies the code block that embeds this table in a note. See [[DOCS-110 Embed a table in a note\|Embed a table in a note]] |
| Delete | Sends the preset's file to Obsidian's Trash, disabled when only one preset remains |

The footer has no "set as default" action: the **default preset** is chosen from the dropdown in **Settings → Operon → Views → Tables**, where the **Table Presets** list also has an **Add Table Preset** button, each row opens the same settings, and the current default carries a **Default** label.

## The default preset and saved state

The **default preset** is chosen in **Settings → Operon → Views → Tables**. A newly opened Operon Table starts with the default preset, unless that table already has its own saved state. The same default preset is used when the **Insert Operon Table embed** command creates a new embed block; if that default is missing, Operon falls back to the first available Table preset. The preset stores the reusable table shape and saved search scopes. Each open table tab then remembers its own current preset, typed search text, scroll position, and which groups you collapsed, so reopening it or switching back finds that tab as you left it.

## Tips

> [!tip] One preset per recurring question
> If you keep re-sorting or re-filtering the same table, save it as a preset. Give each one a plain name, such as "Overdue", "This sprint by assignee", or "Unestimated backlog". Next time you need that view, pick it from the selector and the table is ready, with no rebuilding.

## FAQ

**How do I make a new table?** Open the preset settings and choose **New** or **Duplicate**, or add one from **Settings → Operon → Views → Tables**.

**How do I switch tables?** Use the preset selector on the toolbar.

**What does the default preset do?** It is the preset a freshly opened Operon Table starts with, unless that table already has its own saved state.

**Do my columns and grouping affect other presets?** No. Each preset stores its own filter, columns, grouping, sorting, summaries, and density.

**Where is a preset actually stored?** As a `.table` file in your vault, by default under `Operon/Tables`. See [[DOCS-114 Table files|Table files]].

**What is the difference between a favorite and the default preset?** The default is the one preset a new table or embed starts with. A favorite is a preset pinned to the toolbar's short list for quick switching. A preset can be either, both, or neither.

**Can I put a preset's table inside a note?** Yes. Use **Copy embed code**, the Table export menu, or **Insert Operon Table embed**. Existing embeds can also switch preset from their own toolbar. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

## Settings

Table presets and the default preset live in **Settings → Operon → Views → Tables**, alongside the maximum visible rows setting for embedded tables and the toggles for the line number, task icon, and task type columns. Each preset's own filter, columns, grouping, sorting, summaries, and density are edited from the preset settings, reached with **Edit preset**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-114 Table files|Table files]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
- [[DOCS-111 Export a table|Export a table]]
- [[DOCS-025 Filter View|Filter View]]
