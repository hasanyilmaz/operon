---
Notes: Render a preset's live, editable table inside any note
Icon: panel-top
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Embed a table in a note

The [[DOCS-105 Table overview|Table]] is a surface you open in its own tab. Sometimes you want it inside a note instead, so a project page or a dashboard shows its own table in place. Operon does this with a small code block that points to a [[DOCS-109 Table presets|preset]] by its id, and replaces the block with a live, editable table, the same one that preset shows in the full view.

## The code block

Embed a table with an `operon-table` code block that references a preset by its id. The `presetId` line is required:

````md
```operon-table
presetId: "tp_2pv2ls9"
```
````

You can also set the visible row count for one embed:

````md
```operon-table
presetId: "tp_2pv2ls9"
rows: 35
```
````

Operon replaces the block with the preset's table: its filter, columns, grouping, sorting, summaries, and visible row count, all live. The table is always referenced by `presetId`; `rows` only controls the local embed height.

`rows` is optional. When it is a positive whole number, it controls how many rows this embedded table shows before the table body scrolls. This local value is not limited to the settings dropdown options. If `rows` is missing or invalid, the embed uses the global setting in **Settings → Operon → Views → Tables → Maximum visible rows in embedded tables**. The global default is `20`, with settings options for `10`, `20`, `30`, `40`, `50`, `75`, and `100` rows.

## Fast insert command

Use **Insert Operon Table embed** from the command palette when you want a fresh block at the cursor. In the active Markdown editor, Operon inserts the default Table preset's embed block at the cursor, or replaces the current selection with it. The command does not create a preset. If the configured default preset is missing, it uses the first available Table preset.

## The easy way: Copy embed code

You do not have to find the id yourself. Open the preset settings and use **Copy embed code**, and Operon puts the right block, with the correct `presetId`, on your clipboard. Paste it into any note and the table appears. The full Table export menu has the same destination under **Copy table embed code**. The embedded table toolbar does not export rows or copy embed code; use preset settings or the full Table export menu for that. This is the reliable path, and the one to use.

## A live, editable table

An embedded table is not a snapshot. It behaves like the full view:

- It stays **live**: as tasks change, the embedded table updates.
- It is **editable**: click a cell to change that field, and the edit writes back to the task's Markdown, just as it does in the full view. See [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].
- It has its own **typed search box**, so text you type narrows only that embedded table.
- Its **scope buttons** and parent scope are saved back to the shared preset, so changing those choices can affect other tables that use the same preset.
- It can **switch to another preset** from its toolbar without changing the default preset or other embeds.
- It respects the global embedded-table row limit, or a local `rows` value in the code block.
- It renders in both **Reading View** and **Live Preview**.

Because the embed follows the preset, editing the preset later, adding a column or changing the grouping, updates every note that embeds it.

> **MEDIA-DOCS-110-1:** A project note with an embedded Operon table showing that project's tasks below the writing.

![MEDIA-DOCS-110-1 - A note with an embedded Operon table](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-110-1.png)

## Change the preset from the embed

The embedded table toolbar has a table icon to the left of **Group & Sort**. Click it to open the same searchable Table preset picker used by the full Table view. Choosing a preset rewrites only this code block's `presetId` line, then rerenders the embedded table with the new preset.

This does not change the global default preset, edit the preset's settings, create a new preset, or touch other `operon-table` blocks in the same note.

## What you can embed

Any preset works, so the embedded table is as focused as the preset behind it. Build the preset once with the filter, columns, grouping, and summaries you want (see [[DOCS-109 Table presets|Table presets]]), then embed it wherever the table belongs.

A common use is a **dashboard note**: embed a few tables, one per question, so a single note becomes a live control panel over your work. Another is a **project note that owns its tasks**: give the project a preset filtered to its task tree and embed it at the foot of the note, so the note is both the context and a working table of the tasks it holds.

## If the embed shows an error

Two messages can appear in place of the table:

- **Invalid table embed syntax**: the block is missing a valid `presetId` line. Use **Copy embed code** from preset settings, or **Copy table embed code** from the export menu, to get a correct block.
- **Table preset not found**: the `presetId` does not match any saved preset, usually because the preset was deleted or the id was mistyped. Copy a fresh embed code from the preset you want.

An invalid `rows` value does not break the embed. Operon ignores it and uses the global visible-row setting instead.

## Tips

> [!tip] Build one dashboard note
> Make a single note your home base. Embed a handful of tables in it, such as overdue tasks, this week's work, and an unestimated backlog. Open that one note each morning and act on everything from there.

## FAQ

**How do I get the right `presetId`?** Use **Copy embed code** from the preset settings, or **Copy table embed code** from the export menu. It writes the correct id into the block for you.

**How do I insert a new embed quickly?** Use **Insert Operon Table embed** from the command palette. It inserts the default Table preset's embed block at the cursor, or replaces the current selection.

**Can I change which preset an existing embed uses?** Yes. Use the table icon in the embedded table toolbar. It opens the searchable preset picker and updates only that embed's `presetId`.

**Does the embedded table update?** Yes. It is live, so it reflects your tasks as they change.

**Can I edit tasks from the embed?** Yes. Click a cell to edit its field, the same as in the full view. The change is written back to Markdown. Compact description and note cells use the [[DOCS-113 Text field editor popover|text field editor popover]].

**What if I change the preset later?** Every note that embeds that preset shows the change, because the embed follows the preset rather than a copy of it.

**How many rows does an embedded table show?** By default it uses **Settings → Operon → Views → Tables → Maximum visible rows in embedded tables**, which starts at `20`. Add `rows: 35` or another positive whole number to one code block when that embed needs a different visible height.

**Does changing the embed preset affect my default preset?** No. The toolbar switcher changes only the `presetId` in that one embedded code block.

**Does embedded search affect the preset?** Typed search text stays local to the embed. Scope buttons and parent scope are preset state, so changing them updates the shared preset.

**Why does my embed show an error?** Either the block has no valid `presetId`, or the preset it names no longer exists. Paste a fresh block from **Copy embed code** or **Copy table embed code**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-113 Text field editor popover|Text field editor popover]]
- [[DOCS-111 Export a table|Export a table]]
- [[DOCS-083 Embed a filter in a note|Embed a filter in a note]]
