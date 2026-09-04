---
Notes: Route new and existing inline and file tasks to the right working and archive locations
Icon: route
Color: "#2563eb"
Updated: 2026-09-04T17:45:21+0200
---

# Task Router

Task Router is the place where Operon decides where tasks belong. It brings inline capture, File Task folders, parent-aware placement, and File Task archiving into one settings page, so the same routing rules govern creation and later lifecycle changes.

Routing changes location, not identity. An Operon task keeps its `operonId`, fields, relationships, and history when an eligible File Task moves between configured folders.

## What Task Router controls

Task Router has three parts:

- **Inline Tasks** chooses the normal destination for a new inline task and how a parent may override that destination.
- **File Tasks** chooses the default File Task folder, optional pipeline-specific folders, and parent-aware placement.
- **File Task Archive** chooses where finished and cancelled File Tasks move.

Daily and Weekly note creation has its own configuration under **Tasks → File Tasks**. Task Router selects those notes as destinations; [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]] explains how Operon resolves and creates them.

## Inline Task destinations

The default inline destination can be:

- **Daily Notes**: the note for the routed day.
- **Weekly Notes**: the note for the routed week.
- **Specific File**: one configured Markdown file.
- **Active File**: the note you are working in.
- **Ask Every Time**: choose the destination during creation.

Daily Notes is available when Operon manages Daily Notes or Obsidian's Core Daily Notes plugin is available. Weekly Notes requires Operon's Weekly Notes management to be enabled.

For Daily Notes, Active File, and Ask Every Time, **Inline task heading** is a heading keyword rather than a whole Markdown heading. Operon inserts under the first heading containing that phrase; if none exists, it creates a level-two heading. Weekly Notes uses the routed daily-date heading described in [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]. Specific File mode uses a linked date heading based on the active Core Daily Notes format, with `YYYY-MM-DD` as fallback.

## Parent-aware inline placement

A parent can override the normal inline destination:

- With an **inline parent**, Operon can place the new task directly below that parent.
- With a **File Task parent**, Operon can place the new task inside the parent note under the configured heading.
- With either rule left at **Default**, the task goes to the normal inline destination and still keeps its `parentTask` relationship.

This is placement at creation time. It does not make later date or relationship edits physically move an existing inline task. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

## File Task destinations

**File Task Default Save Location** is the fallback folder for new File Tasks. Leave it empty to use the vault root.

**Pipeline locations** can map each pipeline to its own folder. A matching pipeline folder takes priority over parent-aware placement and the default File Task folder. This keeps, for example, Project and Personal File Tasks in different working areas without changing how they are created.

When an eligible open File Task changes to a pipeline with a valid location rule, Operon moves it to that matching folder after about five seconds. The delay lets the task update and index settle before the file move. If its pipeline is missing, unknown, ambiguous, unconfigured, or mapped to an unsafe destination, Operon leaves the file in place rather than guessing or falling back to the default folder. An explicitly saved empty folder remains a valid rule for the vault root.

## What happens when routing settings change

Pipeline-location reconciliation is scoped to the rule you actually changed:

- Adding a valid pipeline rule, or changing its target folder, moves only eligible open File Tasks that resolve to that pipeline.
- Reordering rules does not move files.
- Removing a rule leaves existing files where they are.
- Changing **File Task Default Save Location** affects newly created File Tasks and notes converted afterward when **Move converted notes to their pipeline location** is enabled; it does not reorganize existing File Tasks.
- An incomplete, unresolved, or unsafe rule produces no move and does not redirect the task to a fallback.

If Operon cannot safely resolve the requested move, it postpones that scoped reconciliation instead of moving files. Once the safety checks recover, the same affected pipeline scope can continue without turning into a vault-wide relocation.

## Converted notes

Converting a plain note into an Operon File Task normally keeps the note where it is. Turn on **Move converted notes to their pipeline location** when converted notes should move after about five seconds to their matching pipeline folder, or to the default File Task folder when no pipeline rule matches.

This option is separate from conversion itself. Conversion preserves the note's content and establishes task identity; routing decides whether its file location should then change. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

File Task recurrence destinations are also separate from existing-file reconciliation. Changing **File occurrence destination** affects newly created occurrences only; it does not relocate current open occurrences. See [[DOCS-033 Recurring tasks|Recurring tasks]].

## Parent-aware File Task placement

When no pipeline folder overrides it, a parent can influence where a new File Task is created:

- An inline parent can place the File Task in the parent's folder.
- A File Task parent can place it in the parent's folder.
- **Default** uses the configured File Task folder instead.

The relationship is independent of the chosen folder. A task may keep its parent even when routing uses a pipeline or default destination.

## File Task Archive

Finished and cancelled File Tasks can move out of working folders without being deleted.

- A **pipeline archive location** is the first choice for a terminal task in that pipeline.
- The **fallback archive folder** is used when no pipeline archive rule matches.
- Leaving the fallback empty keeps unmatched terminal tasks in place.

Terminal moves happen after about five seconds. Operon moves only eligible File Tasks, creates safe missing folders when possible, and refuses an occupied or unsafe destination. A matching pipeline archive always takes priority over the fallback.

## Example setup

Suppose `Project` tasks work in `20 Projects/Tasks`, `Personal` tasks work in `40 Areas/Tasks`, and all unmatched tasks use `File Tasks`:

- Map `Project` to `20 Projects/Tasks`.
- Map `Personal` to `40 Areas/Tasks`.
- Set `File Tasks` as the default File Task folder.
- Map their terminal tasks to matching archive folders.
- Set one fallback archive for every other pipeline, or leave it empty to keep unmatched tasks where they are.

The rule set remains readable: the matching pipeline wins, then the relevant fallback applies.

## FAQ

**Does changing a pipeline location move every task immediately?** No. Only eligible open File Tasks that resolve to the newly added or changed pipeline rule move, after about five seconds. Inline tasks and tasks belonging to other pipelines stay where they are.

**Does changing the default File Task folder reorganize existing tasks?** No. It changes later File Task creation and the fallback for notes converted afterward when movement is enabled.

**Does a pipeline folder remove the parent relationship?** No. It overrides physical placement, not the relationship.

**Are converted notes always moved?** No. They move only when **Move converted notes to their pipeline location** is enabled.

**Are archived tasks deleted?** No. Their Markdown files move; their task identity and data stay intact.

**What happens when a destination is unsafe or occupied?** Operon leaves the task in place and reports the problem instead of selecting another path silently.

## Settings

These settings live in **Settings → Operon → Tasks → Task Router**, under **Inline Tasks**, **File Tasks**, and **File Task Archive**. Daily and Weekly formats, templates, folders, and container behavior live separately under **Settings → Operon → Tasks → File Tasks**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-013 File tasks|File tasks]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
- [[DOCS-052 Completed task review|Completed task review]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
