---
Up:
  - "[[DOCS-015 Task identity and operonId|Task identity and operonId]]"
  - "[[DOCS-039 Key mappings|Key mappings]]"
  - "[[DOCS-013 File tasks|File tasks]]"
Notes: The object model behind Operon tasks
Icon: network
Color: "#16a34a"
tags:
  - operon
  - taskmodel
Updated: 2026-06-25T16:47:21
---

# Operon core concepts

Operon treats tasks as part of the vault, not as data imported from somewhere else.

That sounds small. It is not. Most task systems make you choose between structure and context. Markdown gives you context but not enough durable structure. Dedicated task apps give you structure but pull the work away from the notes that explain it. Operon takes the middle path: keep tasks in Markdown, then add just enough identity, metadata, and views to make them manageable.

A few ideas carry the whole system. Once they click, the rest of Operon is easy to follow.

## Markdown-first tasks

If you use Obsidian, your tasks should be allowed to live in your notes. A task might begin in a daily note, appear in a project brief, or sit inside a meeting note because that is where the decision happened. Operon indexes tasks from the vault and keeps them connected to their source. When you schedule, complete, move, or convert a task through Operon, the Markdown stays the place where the task actually lives.

## Two shapes: inline and file tasks

A task can take one of two shapes:

- **Inline task**: a lightweight Markdown checkbox with Operon metadata, useful when the task belongs inside an existing note. It stays readable but carries enough information for Operon to find it and show it everywhere. This is the low-friction shape. See [[DOCS-011 Inline tasks|Inline tasks]].
- **File task**: a Markdown note that is itself a task, keeping its fields in frontmatter and using the body as a working document. Use it when the work deserves room: a draft, a release plan, a research thread. This is the high-context shape. See [[DOCS-013 File tasks|File tasks]].

The shapes differ in form, not in standing. Both carry the same canonical fields and the same identity, and both flow through the same workflows: a filter, the Calendar, the Kanban, recurrence, pinning, and time tracking treat them alike. Unifying the two is one of Operon's central ideas, so you pick a shape for the moment without splitting your system in two. See [[DOCS-072 One workflow, two task shapes|One workflow, two task shapes]].

Not sure which to reach for? See [[DOCS-014 Inline vs file tasks|Inline vs file tasks]].

Either shape can also be broken down, on two levels. A task can hold a quick checklist of plain checkboxes for simple steps, or full subtasks when a step is real work of its own. See [[DOCS-017 Plain checkbox lists|Plain checkbox lists]] and [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

## Task identity

Every Operon task gets an `operonId`. That id is what lets the same task stay recognizable when it appears in different places. A task can show up in a filtered view, open in the Task Editor, sit on the Calendar, move across the Kanban, get pinned, get tracked, or convert between inline and file forms without ever becoming a new task. Without identity, the system has to guess that two similar lines are the same work. With identity, Operon can say: this is still the same task. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

## Canonical fields

Task fields keep a stable meaning. Status, priority, scheduled date, due date, parent task, recurrence, and duration should not turn into different concepts depending on where you see them. Operon maps each field once and reuses that meaning across Markdown, filters, Calendar, Kanban, the Task Editor, and chips. The visible property name can differ through key mappings, but the underlying field is the same. See [[DOCS-039 Key mappings|Key mappings]].

## Views are surfaces, not separate databases

A view is a way to look at the same task records, never a second copy. A filter is a saved slice of work. The Calendar gives scheduled work a place in time. The Kanban gives status a visual workflow. Task Finder helps you recover a task when you remember the words but not the file. Each surface reveals the same task from a different angle.

## Recurrence and time tracking belong to the task

Recurrence creates fresh occurrences that carry useful context forward while resetting what belongs to each run. Time tracking belongs to the task record, not to a separate timer log, so effort becomes part of the task's history. See [[DOCS-033 Recurring tasks|Recurring tasks]] and [[DOCS-034 Time tracking|Time tracking]].

## FAQ

**Is Operon replacing Markdown tasks?** No. It builds on them, adding identity, metadata, and views where plain checkboxes are not enough.

**Should every task become a file task?** No. Most tasks start inline. File tasks are for work that needs room.

**Is `operonId` meant to be edited?** Usually no. It is visible because the task is stored in Markdown, but treat it as identity, not content.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-004 Operon system map|Operon system map]]
- [[DOCS-006 Glossary of Operon terms|Glossary of Operon terms]]
