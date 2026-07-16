---
Up:
  - "[[DOCS-105 Table overview|Table overview]]"
  - "[[DOCS-108 Table summaries|Table summaries]]"
  - "[[DOCS-106 Table columns|Table columns]]"
Notes: Arrange table rows into sections and order them by any field
Icon: arrow-up-down
Color: "#0284c7"
tags:
  - operon
  - table
  - configure
Updated: 2026-07-16T20:08:49
---

# Table grouping and sorting

Grouping and sorting are the two ways a table arranges its rows. **Grouping** splits the rows into sections by a field, so all the tasks with the same assignee, status, or context sit together under a heading. **Sorting** sets the order of the rows, by due date, priority, or any other field. You can use either on its own or both together, and both are saved in the [[DOCS-109 Table presets|preset]], so each table keeps its own arrangement.

Open the **Group & Sort** control from the table toolbar to set both.

> **MEDIA-DOCS-107-1:** The Group & Sort popover, showing a group field, a subgroup field, and a list of sort rules.

![MEDIA-DOCS-107-1 - The Group and Sort popover](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-107-1.png)

## Grouping rows into sections

Pick one field under **Group by** and the table splits into sections, one per distinct value of that field, each with a heading and a task count. Tasks that have no value for the field collect under a **No value** section, so nothing is lost.

- **Group order** sets whether the value sections run in ascending or descending order. When you group by **status**, ascending follows your configured [[DOCS-037 Pipelines and statuses|workflow order]] rather than A to Z, and descending reverses that workflow order, so the sections read in the order your work actually flows through.
- The **No value** section stays at the end of its level, even when the group order is descending.
- Each section has a chevron you can click to **collapse** or **expand** it. Collapsed sections stay collapsed as you work. That collapsed state is saved in the [[DOCS-109 Table presets|preset]], so it travels with the preset across every Table tab, embed, and synced [[DOCS-114 Table files|`.table` file]], and flipping a sort between A to Z and Z to A leaves your collapsed sections untouched. Changing the grouping field itself starts fresh.
- List and tag fields group by each item in the field. A task with two contexts, for example, can appear under both context sections, because it belongs to both groups.

Grouping is a lens, not a filter: every matching task is still represented, just gathered under headings.

## Pipeline: a derived field, not a column

**Pipeline** is a field you can pick for **Group by**, **Subgroup by**, or **Sort by**, but it is not a column you can add to the table. Its value is derived from each task's `status`: Operon works out which of your configured [[DOCS-037 Pipelines and statuses|pipelines]] that status belongs to and groups or sorts by the pipeline's name, so a table can organize by pipeline without carrying a duplicate property or a redundant column. A task whose status does not clearly belong to one configured pipeline falls into **No value**, the same as any other ungrouped field.

## Project Serial: grouped by prefix, sorted by number

When you group by the **Project Serial** column, Operon does not give each individual serial its own section. It buckets tasks by their [[DOCS-097 Project serials|serial group]], the shared prefix, so every `DOCS-` task sits under one **DOCS** heading and every `GIT-` task under a **GIT** heading, while tasks with no serial collect under **No value**. Sorting by Project Serial, whether as the group order or a **Sort by** rule, follows the numeric serial within each group, so `DOCS-7` comes before `DOCS-10` rather than the plain text order that would put `10` before `7`. Group by Project Serial and add it as a sort rule and each project's tasks gather under their prefix, listed in true serial order. This works the same when Project Serial is a subgroup.

## Subgroups: a second level

Once a group is set, you can add a **Subgroup by** a second field to nest sections within sections, for example group by assignee and subgroup by status to see each person's work split into stages. The subgroup has its own order, and it must be a different field from the group. Without a group set, the subgroup option stays disabled.

## Sorting rows

Add one or more **Sort by** rules to order the rows:

- Each rule has a field and a direction, **A -> Z** or **Z -> A**, the same for every field including Status and Pipeline.
- Add more than one rule and they act as tie-breakers in order: the first rule decides the order, the second breaks ties within it, and so on. Reorder the rules with the up and down controls, or remove one.
- With no sort rules, rows follow **Source order**, the order the tasks are found in.

When the table is grouped, sorting applies **within** each section, so the sections are ordered by the group order and the rows inside each section by your sort rules.

## Where empty values go

By default, tasks with no value for a sort field sort to the end. To change that, open the preset's full settings with **Edit preset** and use the **Sort** section, where each rule also carries an **Empty first** or **Empty last** toggle. That decides whether tasks missing the sorted field land at the top or the bottom within their current section, which is useful when, say, unscheduled tasks should surface first rather than sink to the bottom.

The **No value** group is separate from this sort setting. It is the group bucket for tasks missing the grouped field and stays after the value groups, while **Empty first** and **Empty last** control row order for a sort rule. See [[DOCS-109 Table presets|Table presets]].

## Grouping and summaries together

Grouping pairs naturally with summaries. When a table is grouped, a summary can roll each column up **per section** as well as for the whole table, so a table grouped by assignee can show each person's total estimate or task count on their section's footer. See [[DOCS-108 Table summaries|Table summaries]].

## Tips

> [!tip] Group by the field you are deciding on, sort by the field you are triaging
> If the question is "who is carrying what", group by assignee; if it is "what is next", sort by due date. Combine them and you get both at once: a section per person, each person's tasks in deadline order. Add a per-section summary and each heading also tells you how much that section holds.

## FAQ

**How is grouping different from filtering?** Grouping keeps every row and gathers them under headings; filtering removes rows. Use grouping to organize, and the search box or the preset's filter to narrow. See [[DOCS-105 Table overview|Table overview]].

**Can I group by two fields?** Yes. Set a group, then a subgroup, to nest sections within sections.

**Why are some tasks under "No value"?** Those tasks have no value for the field you grouped by. They collect under a single No value section.

**How do I sort by more than one field?** Add several sort rules; they break ties in order. Reorder them to change which field wins.

**Can I group or sort by pipeline without adding a column for it?** Yes. Pick **Pipeline** in Group by, Subgroup by, or Sort by. It reads each task's status and resolves it to the pipeline that status belongs to, with no extra column or property needed.

**Why does grouping by Project Serial make prefix headings instead of one per number?** Grouping by Project Serial buckets tasks by their serial group, the shared prefix, so all `DOCS-` tasks land together and stay in numeric order within that group. See [[DOCS-097 Project serials|Project serials]].

**Where do tasks with a blank field sort to?** To the end by default. Open **Edit preset** and set a rule to **Empty first** to bring them to the top instead.

## Settings

Grouping and sorting are set from the toolbar's **Group & Sort** control and saved in the preset. The **Empty first** and **Empty last** choice for each sort rule lives in the preset's full settings under **Edit preset**, in the **Sort** section. See [[DOCS-109 Table presets|Table presets]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
- [[DOCS-097 Project serials|Project serials]]
- [[DOCS-114 Table files|Table files]]
