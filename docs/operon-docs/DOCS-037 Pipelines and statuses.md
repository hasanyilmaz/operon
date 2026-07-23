---
Notes: Define the workflow stages a task moves through, and the status grid that configures each
Icon: workflow
Color: "#ca8a04"
Updated: 2026-07-23T16:45:34
---

# Pipelines and statuses

A pipeline is the workflow a task moves through, and a status is one stage in that workflow. Together they answer "how far along is this?" The same statuses become your Kanban columns, drive the checkbox state, and let Operon move tasks for you at the right moments. Set them up once to match how you actually work.

> **MEDIA-DOCS-037-1:** The Pipelines settings showing a pipeline and its ordered statuses with colors.

![MEDIA-DOCS-037-1 - The Pipelines settings showing a pipeline and its ordered statuses with colors](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-037-1.png)

## How status is written

A task's status is stored in `Pipeline.Status` form, so both the workflow and the stage are visible at once:

```md
- [ ] Draft release notes {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
```

Every real task also carries an `operonId`, its durable identity, which Operon fills in for you. The `{{datetime}}` variable stamps the creation moment on paste, and Operon maintains `datetimeModified` for you afterward. See [[DOCS-015 Task identity and operonId|Task identity and operonId]] and [[DOCS-061 operonId template variables|operonId template variables]].

The part before the dot is the pipeline name; the part after is the status label. See [[DOCS-012 Inline task syntax|Inline task syntax]].

## The default pipeline

Operon ships with one pipeline, **Project**, so you have something that works on day one. Its statuses, in order, are:

- **Brainstorming**: shaping rough ideas.
- **Planned**: committed work, not started yet.
- **InProgress**: active execution.
- **Finished**: a completed deliverable. This is a terminal *done* state.
- **Paused**: blocked or intentionally deferred, without being finished.
- **Dropped**: intentionally abandoned. This is a terminal *cancelled* state.

You are not locked into this. Rename statuses, add or remove them, reorder them, and create more pipelines for different kinds of work.

## What each status carries

Every status holds more than a name:

- **Color and icon**: how the status looks on chips, the Kanban, and task icons.
- **Finished / cancelled flags**: a status marked finished completes the task and sets `dateCompleted`; one marked cancelled cancels it and sets `dateCancelled`. These also set the Markdown checkbox to done or cancelled.
- **Automation targets**: a status can be the place a task lands when you schedule it or when you start a timer (see below).
- **Property mapping**: an optional export name for syncing the status to another property.

## The status grid

In the Pipelines settings, a pipeline's statuses are laid out as a grid: one row per status, with a column for each thing a status carries. Reading across a row tells you everything about that status at a glance.

| Column | What it is |
|---|---|
| Color | The status's color, used on chips, the Kanban, and task icons |
| Icon | The status's icon |
| Status Label | The status name, the part after the dot in `Pipeline.Status` |
| Stats | How many tasks are currently in this status, shown for reference (you do not edit it) |
| Scheduled | Marks this status as the **scheduled** automation target. One status per pipeline holds it |
| Tracking | Marks this status as the **tracking** automation target. One status per pipeline holds it |
| Finished | Flags this as a terminal **done** state: reaching it completes the task and sets `dateCompleted` |
| Cancelled | Flags this as a terminal **cancelled** state: reaching it cancels the task and sets `dateCancelled` |

The **Scheduled** and **Tracking** columns are single-choice down the grid, since only one status can be each automation target; how they fire is covered in "Automatic status moves" below. **Finished** and **Cancelled** also set the Markdown checkbox to done or cancelled. Beyond the grid, each status has an optional **property mapping** (an export name for syncing the status to another property), edited in the status's own detail row.

## Statuses become Kanban columns

The Kanban builds its columns straight from a pipeline's statuses, in order. Moving a card to another column rewrites the task's `status`. So the pipeline you design here is the board you work on later. See [[DOCS-030 Kanban overview|Kanban overview]].

A task's pipeline can also group, subgroup, or sort rows on the [[DOCS-105 Table overview|Table]], as a derived **Pipeline** field, without adding it as a column. See [[DOCS-107 Table grouping and sorting|Table grouping and sorting]].

## Automatic status moves

Two statuses can be automation targets, so Operon advances a task at the natural moment instead of making you do it:

- **On schedule**: when you first give a task a scheduled date, it moves to the status flagged as the scheduled target (by default, `Planned`).
- **On tracking**: when you first start a timer on a task, it moves to the status flagged as the tracking target (by default, `InProgress`).

Both fire only once, on the first transition from empty to set, so they nudge a task forward without fighting your later manual changes.

## Describe a pipeline

A pipeline can carry an optional **description**: a short note on when this workflow should be used. It is never required, and you already know what your own pipeline is for. Writing it down still pays off twice. It makes the intent explicit for anyone reading the vault later, and it gives an agent working in your vault the shared context to pick the right pipeline and act the way you would, rather than guessing from the name alone. The default Project pipeline ships with such a description, and you can edit it or add one to any pipeline you create.

## FAQ

**Where do Kanban columns come from?** From the statuses of the pipeline the board shows, in their defined order.

**Can I have more than one pipeline?** Yes. Make a pipeline per kind of work, each with its own statuses.

**What makes a task count as done?** Reaching a status marked finished. A status marked cancelled instead records the task as cancelled.

## Settings

Operon settings for this live in **Settings → Operon → Core → Pipelines**, which configures workflow statuses, their colors and icons, and the automatic status behavior.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-008 Essential settings to configure first|Essential settings to configure first]]
- [[DOCS-034 Time tracking|Time tracking]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
