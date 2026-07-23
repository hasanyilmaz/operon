---
Notes: Read-only sequential serial IDs assigned to the tasks in a project tree
Icon: hash
Color: "#7c3aed"
Updated: 2026-07-23T16:45:34
---

# Project serials

A **project serial** is a short, stable label like `PROD-0007` that Operon puts on every task inside a project. It is the same idea as the issue IDs many project tools give each item: a human-friendly handle you can say out loud, write in a commit message, or point to in a discussion. Operon assigns these numbers for you, automatically and in order, across a whole parent task tree.

They are **read-only and visual**. You never type a serial, you cannot edit the number, and turning serials on does not rewrite a single line of your notes. The serial sits on top of the task, a friendly name over the machine identity underneath.

> **MEDIA-DOCS-097-1:** Dynamic file task filter showing its Project Serial identity chip, before the normal task chips.

![MEDIA-DOCS-097-1 - Dynamic file task filter showing its Project Serial identity chip before the normal task chips](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-097-1.png)

## Serials are not the operonId

Every Operon task already has an [[DOCS-015 Task identity and operonId|operonId]]: a permanent, random, globally unique id that never changes and that nothing else in your vault shares. That is the machine's handle on the task. It is reliable, but it is not something you would want to read aloud.

A project serial is the opposite kind of identifier, built for people:

| | operonId | Project serial |
|---|---|---|
| Purpose | Machine identity | Human-friendly label |
| Shape | Random, unique string | Prefix plus a counted number, like `PROD-12` |
| Scope | Every task, always | Only tasks inside a project you set up |
| Numbering | None | Sequential, per project, starting at 1 |
| Editable | No (permanent) | No (assigned automatically) |
| Stored in your note | Yes, on the line or in frontmatter | No, in Operon's own state |

So a task can be `PROD-12` to you and keep its untouched operonId underneath. Two tasks in different projects can both be number 12 (`PROD-12` and `MKTG-12`) because each serial is counted within its own project.

## Setting one up: define a scope

A serial is driven by a **scope**, which you create in **Settings → Operon → Tasks → Relationships**, under **Project Serials**. A scope is two things:

- A **starting parent task**, given by its operonId. This is the root of the project tree the serial covers.
- A **prefix** of one to five ASCII letters, such as `PROD`. Your casing is kept; the dash is added automatically.

Add the scope and Operon immediately numbers the whole tree under that parent. Each parent task can have only one scope.

> **MEDIA-DOCS-097-2:** The Project Serials settings section, with a scope defined by a starting parent task and a prefix.

<iframe
  title="MEDIA-DOCS-097-2 - Serial Project IDs video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/LdxtmszDNm8"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## How the numbers are assigned

Once a scope exists, **every task in that parent's tree**, at any depth of sub-task, receives a number:

- Numbering follows **creation order**: the oldest task in the project is 1, the next created is 2, and so on. (Ties break on the operonId.)
- It is **automatic and persistent**. A task keeps its number for life; new tasks take the next free number. You cannot set or change a number by hand.
- Numbering is **per project**. Each scope counts from 1, independent of every other scope.

Because numbers are tied to the task, not to its position, reordering or moving tasks around in your notes does not reshuffle them. The number you saw yesterday is the number you see today.

## The label format

A serial reads as `PREFIX-NNNN`. Two rules shape it:

- The visible prefix keeps the casing you typed.
- The letters and digits always total **seven characters** (the dash does not count). The number is zero-padded to fill the width, so a small project shows `PROD-007` and a larger one shows `PROD-128`.

One subtlety follows from the fixed width: as a project grows into longer numbers, the visible prefix is **trimmed to keep the total at seven**. A four-letter prefix with four-digit numbers shows as three letters, for example `PRO-1234`. The stored prefix is unchanged; only the displayed length adapts.

## Nesting: the nearest scope wins

You can put a scope on a large project and another scope on a sub-project inside it. A task then belongs to the **nearest** scope above it, so the sub-project's tasks carry the sub-project's serial rather than the outer one. This lets a big initiative number its own tasks while a contained workstream keeps a separate, cleaner sequence.

When you add or rename a scope that **overlaps** another tree or **reuses a prefix**, Operon warns you first and previews the effect: how many tasks will show a different serial, how many scopes overlap, and how many share the prefix. Renaming a prefix changes only the visible letters; the stored task numbers stay exactly as they were.

## Where serials show up

A serial appears as a display-only **chip** on supported task surfaces: in [[DOCS-041 Task chips display and behavior|reading view and Live Preview]], on rows in the [[DOCS-025 Filter View|Filter View]], on main cards in the [[DOCS-030 Kanban overview|Kanban]], in the [[DOCS-021 Task Editor|Task Editor]], and in the calendar task picker. There is nothing to click to edit, and nothing is written into the task text.

It can also be its own read-only column on the [[DOCS-105 Table overview|Table]], where it searches, groups, sorts, and exports like any other column. See [[DOCS-106 Table columns|Table columns]].

## Grouping and filtering by serial group

Because every serial carries a prefix, that prefix is itself a group you can organize by. A [[DOCS-105 Table overview|Table]] grouped by the **Project Serial** column gathers tasks under their shared prefix, all `DOCS-` together and all `GIT-` together, and keeps them in numeric order within each group, rather than treating every serial as its own section. See [[DOCS-107 Table grouping and sorting|Table grouping and sorting]].

A filter can scope to the same groups with the **Project Serial Group** condition: show only tasks that carry a serial, only those in specific groups you pick, or every group whose prefix starts with the letters you type. See [[DOCS-073 Filter conditions and operators|Filter conditions and operators]].

## Stored apart from your notes

The numbers live in Operon's own state, not in the task's Markdown. See [[DOCS-046 Plugin data and state files|Plugin data and state files]]. This is what keeps serials safe to turn on: enabling, renaming, or removing a scope never touches the operonId in your line or the body of your note. The serials are a layer Operon paints on top, and that layer persists across sessions so the numbers stay stable.

## What happens as tasks change

- **Add a task** to the project and it takes the next free number in the scope.
- **Complete or keep** a task and its number does not move.
- **Remove the most recently numbered tasks** and those trailing numbers free up, so the next task you add can reuse them. Tasks that are still there never get renumbered, so a serial you have already cited stays valid.

Each scope can number up to 999,999 tasks. If a project ever reaches that, Operon shows a capacity notice rather than rolling the count over.

## When to use it

Reach for project serials when a project's tasks need a **shared, sayable reference**: a number you can drop into a commit, a meeting note, or a message and have everyone know exactly which task you mean. They are also a quieter, friendlier label than the operonId for day-to-day reading, and the per-project counting keeps each initiative's numbers small and meaningful.

## FAQ

**Can I edit or set a serial number myself?** No. They are assigned automatically in creation order and are read-only.

**Does turning serials on change my notes or my operonId?** No. The numbers are stored in Operon's state, separate from the task text, and the operonId is untouched.

**Two tasks show the same number. Is that a bug?** No, if they are in different projects. Each scope counts from 1, so `PROD-12` and `MKTG-12` can both exist. Within one project, numbers are unique.

**I renamed the prefix. Did the numbers change?** No. Renaming changes only the visible letters; every stored number stays the same.

**Why did my prefix get shorter?** The letters and digits total seven characters. As the numbers grow longer, the visible prefix is trimmed to keep that total, so `PROD` can show as `PRO`.

**A sub-project has its own serial. Which one applies?** The nearest scope wins, so the sub-project's tasks use the sub-project's serial.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Relationships**, in the **Project Serials** section. There you add a scope (a starting parent task ID plus a one-to-five-letter prefix), rename a prefix, or delete a scope. Add, rename, and delete each confirm first and preview how many tasks are affected.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-058 Operon inheritance rules|Operon inheritance rules]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]
