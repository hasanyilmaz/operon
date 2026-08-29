---
Notes: Plan and reschedule Table tasks on a Gantt timeline
Icon: chart-gantt
Color: "#0284c7"
Updated: 2026-08-29T17:24:45
---

# Gantt view

Gantt adds a timeline beside the [[DOCS-105 Table overview|Operon Table]], so you can compare task fields and plan their dates in the same place. The Table remains on the left and the Gantt timeline opens on the right, with each task row aligned to its bar, date markers, and dependency lines. It is not a separate Operon view or command: it is another way to work with the rows of the current Table preset.

> **MEDIA-DOCS-139-1:** A typical Gantt opened beside an Operon Table, with task rows on the left and aligned dated bars, dependency lines, and the timeline scale on the right.

![MEDIA-DOCS-139-1 - A Gantt timeline beside an Operon Table](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-139-1.png)

Use Gantt when the question is not only *when is this task?*, but also *how long does it run, what comes before it, and what moves with it?* The [[DOCS-028 Calendar overview|Calendar]] is still the better surface for shaping a day or week around timed blocks. Gantt is for seeing a sequence of work across a longer timeline while keeping the Table's columns, grouping, sorting, and task hierarchy in view.

## Open and arrange Gantt

Open an Operon Table, then select **Gantt View** in the Table toolbar. The same button closes the timeline and returns the Table to its full width. The current Table preset decides which tasks and rows appear; opening Gantt does not create another filter or duplicate the tasks.

Drag the divider between the Table and timeline to change how much width each side receives. Vertical scrolling stays shared, so a Table row and its Gantt lane remain aligned. Hovering a row on either side also highlights its matching row on the other side.

The toolbar setting and divider position belong to the current Table preset. A preset can therefore open as a normal full-width Table or open with its Gantt timeline already visible. See [[DOCS-109 Table presets|Table presets]].

## How task dates become bars and markers

Gantt reads the same task fields used by the rest of Operon:

- A task with `dateStarted` and `dateDue` becomes an all-day range bar from the start date through the due date.
- A task with `datetimeStart` and `datetimeEnd` becomes a timed range bar when it does not already have an all-day start-to-due range. If `datetimeEnd` is empty but the task has an estimate, Operon can use that estimate to determine the effective end.
- A task with only `dateScheduled` becomes a one-day scheduled bar.
- Start, scheduled, and due dates can also appear as separate icons when their global marker settings are enabled.

A task without any usable Gantt date still keeps its row. Its empty timeline lane is where you can give it a date directly.

## Add dates from an empty lane

Click an empty point in an undated task's timeline lane to place the task on that day. The global **One-day click behavior** decides what one click writes:

- **Set scheduled date** writes `dateScheduled`.
- **Set start and due dates** writes a one-day `dateStarted` to `dateDue` range.

Drag across more than one day in the empty lane to create a start-to-due range. The preview shows the proposed bar before the dates are written.

## Move and resize bars

Drag the middle of a bar to move it without changing its duration. Drag the start or end handle to change that edge of the range.

- Moving a scheduled bar changes its scheduled date.
- Moving an all-day range shifts its start and due dates by the same number of days.
- Moving a timed bar shifts its calendar dates while preserving its time of day and duration.
- Resizing a scheduled or timed bar can promote it to an explicit start-to-due range, because the resized result now describes more than one date boundary.

When an all-day range moves, a scheduled date or timed block already contained inside that range moves with it. Dates outside the range are not pulled along accidentally.

A click that does not become a drag follows the configured **Bar left-click action**. The available actions are no action, open Task Editor, go to source, or open the contextual menu. The right-click action is configured separately. See [[DOCS-021 Task Editor|Task Editor]] and [[DOCS-042 Contextual menu actions|Contextual menu actions]].

## Move open descendants with a parent

When **Move open descendants with parent tasks** is enabled, moving a parent bar also shifts the existing dates of its open descendants by the same number of days. Operon follows the task hierarchy, so direct children and deeper open descendants stay in the same relative schedule.

Only dates that already exist are shifted. Completed and cancelled descendants are left unchanged. Resizing a parent does not move descendants; the option applies when the complete parent bar moves.

Operon validates the hierarchy and all affected task sources before keeping the move. If a task changed, a duplicate identity makes the hierarchy ambiguous, or one of the writes cannot be completed safely, the combined move is rejected or recovered instead of deliberately leaving only part of the family shifted. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

## Read and create dependencies

Dependency lines show the order between tasks that already use Operon's **Blocking** and **Blocked By** relationships. A line runs from the preceding task to its follow-up task. These are real task relationships, not drawing-only arrows.

Each eligible bar has two dependency ports:

- The **Preceding task** port represents work that must come before this task.
- The **Follow-up task** port represents work that follows this task.

Drag from one port to the opposite port of another task to create a dependency between two existing tasks. Gantt rejects an invalid target, including a task linked to itself or a relationship that would make the dependency graph unsafe. An existing relationship is not duplicated.

Click a dependency port instead of dragging it to open Task Creator for a new linked task. Clicking **Preceding task** creates work before the current task; clicking **Follow-up task** creates work after it. The new task uses the normal Task Creator workflow and is connected only after creation succeeds. See [[DOCS-020 Task Creator|Task Creator]].

## Navigate the timeline

The controls above the timeline change how the current preset is displayed:

- **Previous task date** and **Next task date** jump toward task dates outside the current visible range.
- **Change timeline scale** switches between **Day – Week** and **Week – Month** headers.
- **Zoom out** and **Zoom in** change the width of timeline units without changing task dates.
- The color control cycles the bar color source: no color, task, status, priority, or random colors.
- **Today** centers the current date.

The timeline can show weekend shading and a Today indicator. Gantt keeps the date around your current viewport stable while its scale, width, or surrounding Table layout changes, so changing the presentation does not intentionally send you to another part of the schedule.

## Preset settings and global settings

The current [[DOCS-109 Table presets|Table preset]] stores the parts that define this particular Table and Gantt layout:

- Whether Gantt opens by default.
- The Table pane width in the split.
- The Day–Week or Week–Month timeline scale.
- The timeline unit width.
- The bar color source.
- Whether weekend shading is shown.

Global settings under **Settings → Operon → Views → Gantt** provide defaults for new Table presets and behavior shared across Gantt timelines. They include the initial split, scale, and unit width; start, scheduled, and due marker visibility; whether the first opening focuses Today; bar click actions; one-day click behavior; and whether open descendants move with a parent.

Changing a global default does not rewrite an existing preset's saved layout. Preset-specific values continue to belong to its `.table` file. See [[DOCS-114 Table files|Table files]].

## Gantt in an embedded Table

An `operon-table` code block uses the same Table preset and can open the same Gantt split inside a note. Its rows, task dates, interactions, dependencies, and preset controls follow the same rules as the workspace Table. The note controls the embed's available area, but it does not create a separate Gantt configuration. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

## When a change cannot be kept

Gantt previews a move or dependency while you drag, but the task's Markdown remains the source of truth. If validation blocks the change or the source changed before the write completed, Operon removes the preview and restores the current indexed result. A failed parent-and-descendant move does not silently count as a successful partial schedule.

If a bar returns to its previous position, reopen the task and check its current dates, parent relationship, dependency state, and whether another edit changed the same source. For general index checks, see [[DOCS-054 Missing tasks|Missing tasks]].

## Tips

> [!tip] Start with the Table question, then open its timeline
> Build the Table preset around one set of work, such as a project, release, or campaign. Add the columns and hierarchy you need, then open Gantt to schedule that same result. The Table explains *what* each row is; Gantt explains *when* it happens and *what it depends on*.

> [!tip] Use dependencies for order, not for every relationship
> Link tasks when one genuinely must precede another. Use parent and subtask relationships for hierarchy. Keeping those meanings separate makes both the Task Tree and Gantt easier to read.

## FAQ

**Is Gantt a separate Operon view?** No. It opens inside the current Table and uses that Table preset's rows, filter, grouping, sorting, and saved Gantt layout.

**Why does a task have a marker but no long bar?** A single scheduled date can produce a one-day bar or marker, while a longer bar needs a start-to-due range or a timed range.

**Does dragging a bar change my Markdown?** Yes. A successful move or resize writes the resulting dates back to the task, so the same schedule appears in Calendar, Task Editor, and other Operon surfaces.

**Why did moving a parent also move other tasks?** The global **Move open descendants with parent tasks** setting shifts dated, open descendants with a moved parent. Disable it if parent dates should move alone.

**Can I use Gantt in a note?** Yes. Embed the Table preset with an `operon-table` code block; the embedded Table supports the same Gantt mode.

## Settings

Global Gantt behavior lives in **Settings → Operon → Views → Gantt**. The current Table preset's saved Gantt layout is edited through **Edit preset** from the Table toolbar or from **Settings → Operon → Views → Tables**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-028 Calendar overview|Calendar overview]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
- [[DOCS-114 Table files|Table files]]
