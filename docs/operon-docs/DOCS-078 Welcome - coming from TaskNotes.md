---
Up:
  - "[[DOCS-093 How to migrate from TaskNotes|How to migrate from TaskNotes]]"
  - "[[DOCS-013 File tasks|File tasks]]"
  - "[[DOCS-039 Key mappings|Key mappings]]"
Notes: Orientation for users moving from the TaskNotes plugin, with a before and after at a glance
Icon: move-right
Color: "#2563eb"
tags:
  - operon
  - start
  - tasknotes
  - migrate
Updated: 2026-06-25T16:47:21
---

# Welcome: coming from TaskNotes

If you used TaskNotes, you already think the way Operon's deepest shape works: a task is a note, with its fields in frontmatter and its body as a place to work. Operon calls that a [[DOCS-013 File tasks|file task]], so the core of your habit carries straight over. Two things are new. Operon also has a lighter shape, the [[DOCS-011 Inline tasks|inline task]] (a single line inside any note), and every Operon task must have a durable identity, the `operonId`. This page orients you; the step-by-step move is in [[DOCS-093 How to migrate from TaskNotes|How to migrate from TaskNotes]].

## The honest summary

Operon does not have a TaskNotes importer. There is no button labeled "import from TaskNotes." What it has instead is a **bridge** built from features you would use anyway, and it works well:

- **Key Mappings** let Operon read and write your existing property names, so it speaks your frontmatter rather than forcing a rename. See [[DOCS-039 Key mappings|Key mappings]].
- A **folder scan** adopts your existing notes as Operon file tasks in bulk, preserving their frontmatter and adding only what Operon needs. See [[DOCS-082 Bulk convert a folder into file tasks|Bulk convert a folder into file tasks]].
- **Custom Keys** cover any property that has no built-in Operon equivalent. See [[DOCS-040 Custom keys|Custom keys]].

The one real friction is that an Operon task **must** carry an `operonId`. There is no option to turn that off. So the move is interoperability, not a frictionless one-click import, but it is a clear, repeatable path.

At a glance, a note you already have:

```yaml
---
title: Draft release notes
due: 2026-05-31
---
```

is the same note after the bridge, with your `due` mapped to Operon's `dateDue` and only an `operonId` added:

```yaml
---
title: Draft release notes
due: 2026-05-31
operonId: {{operonId}}
---
```

Your frontmatter is preserved as-is; Operon writes a real `operonId` (shown here as the template variable) and reads `due` as the task's due date.

## What you gain

Alongside the file-task workflow you already know, Operon adds:

- **Inline tasks** for quick capture, so not every task has to become a note. See [[DOCS-072 One workflow, two task shapes|One workflow, two task shapes]].
- **Unified views.** Your file tasks and any inline tasks appear together in the same [[DOCS-025 Filter View|Filter View]], [[DOCS-028 Calendar overview|Calendar]], and [[DOCS-030 Kanban overview|Kanban]].
- **Focused time work** with [[DOCS-035 FlowTime focus sessions|FlowTime]], a focus session with breaks and overtime, and TrackTime for plain logging.

## How Operon differs from TaskNotes

- **Identity is required.** Every task has an `operonId`. It is what keeps a task recognizable across views and edits. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].
- **Mapping is the bridge.** Instead of a fixed schema, you map Operon's fields to your property names, and the value types must match. See [[DOCS-039 Key mappings|Key mappings]].
- **Two shapes, not one.** TaskNotes makes every task a note; Operon lets a task be a quick line or a full note, and convert between them.
- **Statuses drive a board.** Operon tasks move through a pipeline of statuses, which powers the Kanban. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

If you keep TaskNotes installed while you move, a few things can clash, since both add a file-task overlay, use different status systems, and measure time differently (Operon in seconds). Treat running both as a temporary bridge and see the conflicts section in [[DOCS-093 How to migrate from TaskNotes|How to migrate from TaskNotes]].

## Next step

When you are ready to actually move, follow [[DOCS-093 How to migrate from TaskNotes|How to migrate from TaskNotes]] in order. For the questions that come up first, see [[DOCS-080 FAQ for TaskNotes users|FAQ for TaskNotes users]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
