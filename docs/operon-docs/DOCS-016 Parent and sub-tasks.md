---
Up:
  - "[[DOCS-017 Plain checkbox lists|Plain checkbox lists]]"
  - "[[DOCS-058 Operon inheritance rules|Operon inheritance rules]]"
  - "[[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]]"
Notes: Build task trees with parent and child tasks, with copyable parent and subtask examples
Icon: git-branch
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - subtasks
Updated: 2026-07-22T19:14:33
---

# Parent and sub-tasks

Real work has structure. A project contains tasks, and a task can contain smaller tasks. Operon models this with parent and sub-tasks: a tree of full tasks, each with its own identity, that roll up into the parent. This is the heavier of Operon's two breakdown layers; the lighter one is [[DOCS-017 Plain checkbox lists|Plain checkbox lists]].

> **MEDIA-DOCS-016-1:** A parent task with several subtasks shown nested, with a progress rollup on the parent.

![MEDIA-DOCS-016-1 - Parent task with nested subtasks](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-016-1.png)

## How the link works

A subtask is an ordinary Operon task that points at its parent through the `parentTask` field, which holds the parent's `operonId`. Using the template variable forms, the parent takes a shared id like `{{operonId1}}` and the child points its `parentTask` at that same suffix:

```md
- [ ] Write the report {{operonId:: {{operonId1}}}}
- [ ] Write the introduction {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
```

Paste those two lines and Operon mints a real id for the parent, a fresh id for the child, and links the child to the parent automatically. See [[DOCS-061 operonId template variables|operonId template variables]]. Because the link is by identity, the relationship survives edits, moves, and conversions. A subtask can be inline or a file task, and it can live in the parent's note body or anywhere else in the vault.

## Copyable trees

A parent with three subtasks, ready to paste:

```md
- [ ] Launch the newsletter {{operonId:: {{operonId1}}}} {{status:: Project.InProgress}} {{priority:: A}}
    - [ ] Pick the topics {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}} {{dateDue:: 2026-06-10}}
    - [ ] Draft the issue {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}} {{dateDue:: 2026-06-14}}
    - [ ] Send and review {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}} {{dateScheduled:: 2026-06-15}}
```

A deeper, three-level tree. A second suffix `{{operonId2}}` names the middle task, and the leaf points its `parentTask` at that middle id:

```md
- [ ] Ship version 2 {{operonId:: {{operonId1}}}} {{status:: Project.Planned}}
    - [ ] Build the importer {{operonId:: {{operonId2}}}} {{parentTask:: {{operonId1}}}}
        - [ ] Write the parser {{operonId:: {{operonId}}}} {{parentTask:: {{operonId2}}}}
```

The indentation is for your reading only; what links the tasks is the `parentTask` id, not how far a line is indented.

## Create a subtask

The simplest path is the **Create subtask** action in the [[DOCS-042 Contextual menu actions|contextual menu]] of a task. You can also set `parentTask` in the [[DOCS-021 Task Editor|Task Editor]], or write it directly in a file task body as an inline task that references the parent. When you create a subtask, it inherits some fields from the parent (status, priority, icon, color, and more, all configurable). See [[DOCS-058 Operon inheritance rules|Operon inheritance rules]].

To open a task's subtree on demand, run the **Subtasks** action in the contextual menu. It opens the **Dynamic Subtasks Filter**, a live filtered window showing just this task's subtasks, locked to its `operonId`. The action appears only on an open task that has subtasks. See [[DOCS-059 Dynamic Subtasks Filter|Dynamic Subtasks Filter]].

> **MEDIA-DOCS-016-2:** The Dynamic Subtasks Filter opened from the Subtasks action, showing one task's subtree.

![MEDIA-DOCS-016-2 - Dynamic Subtasks Filter subtree](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-016-2.png)

For a quicker look at just the immediate family, without opening a separate window, the [[DOCS-021 Task Editor|Task Editor]] itself shows a task's direct parent and direct subtasks as small cards, and lets you complete an open subtask right from its card.

## Rollups: the parent reflects its children

Operon keeps automatic counts and totals on the parent so you can see progress without opening every child. These are maintained for you, not set by hand:

- Direct child counts: how many subtasks exist, and how many are open or done.
- Whole-tree counts: the same, counting all descendants.
- `progress`: completion percentage.
- `totalEstimate` and `totalDuration`: the parent's own time plus its children's, so estimated and tracked effort add up across the tree.

This is what makes a file task usable as a small project: the parent becomes a live summary of the work beneath it.

> **MEDIA-DOCS-016-3:** A parent task showing rollup counts, progress, and total time gathered from its subtasks.

![MEDIA-DOCS-016-3 - Parent task rollup counts and time](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-016-3.png)

## Subtasks or plain checkboxes?

Use the layer that matches the weight of the step:

- **Subtasks** are full tasks with identity, fields, scheduling, and a place in every view. Use them when a step is real work you may want to schedule, track, or find on its own.
- **Plain checkboxes** are simple in-file ticks with no identity. Use them for a short checklist inside one task. See [[DOCS-017 Plain checkbox lists|Plain checkbox lists]].

A good habit: checkboxes for "steps to finish this task," subtasks for "smaller tasks that belong to this project."

## FAQ

**Where do subtasks live?** Anywhere. A subtask can sit in the parent's note body or in a separate note. The `parentTask` link is what connects them, not their location.

**Do I have to update the counts myself?** No. Counts, progress, and time rollups are maintained automatically as subtasks change.

**Can a subtask have its own subtasks?** Yes. The tree can go as deep as the work needs, and whole-tree rollups account for every level.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Relationships**, which configures subtask creation, auto-parenting, and which fields a child inherits.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-013 File tasks|File tasks]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-005 Operon core concepts|Operon core concepts]]
- [[DOCS-021 Task Editor|Task Editor]]
