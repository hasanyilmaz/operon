---
Up:
  - "[[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]"
Notes: Which task form to use and when, with the same task shown in both shapes
Icon: split
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - inlinetask
  - filetask
Updated: 2026-06-25T16:47:21
---

# Inline vs file tasks

Operon gives you two shapes for a task, and the most common beginner question is which one to use. The short answer: start inline, and promote to a file task only when the work needs its own room. You are not locked in either way.

## The quick rule

- If the task fits in one line and a few fields, use an **inline task**.
- If the task needs sections, references, decisions, or many subtasks, use a **file task**.

Most tasks are small, so most tasks should start inline.

## Side by side

| | Inline task | File task |
|---|---|---|
| Lives in | a line inside a note | its own Markdown note |
| Fields stored in | `{{key:: value}}` on the line | frontmatter |
| Best for | quick actions, capture, checklist items | drafts, projects, research, routines |
| Room for a body | no | yes, the whole note |
| Friction | very low | a little more |

Both are real Operon tasks. Both have an `operonId`, both appear in every view, and both support status, priority, dates, recurrence, and time tracking. The difference is how much space the work gets, not how "important" it is.

## The same task, both shapes

Here is one task, "Write the quarterly report," written each way. The fields carry the same meaning; only the container changes. Both use the `{{operonId}}` template variable, so pasting either one mints a real id. See [[DOCS-061 operonId template variables|operonId template variables]].

As an **inline task**, one line in a note:

```md
- [ ] Write the quarterly report {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{priority:: A}} {{dateDue:: 2026-06-30}}
```

As a **file task**, a note whose frontmatter holds the same fields and whose body is free for the work:

```yaml
---
operonId: {{operonId}}
Status: Project.InProgress
Priority: A
dateDue: 2026-06-30
---
```

The inline line is the whole task; the file task adds an entire note body below the frontmatter for sections, references, and subtasks. That body space is the only thing the inline form gives up.

## When to promote

Move a task from inline to a file when you notice the signs:

- You keep writing notes about the task in other notes.
- It needs an outline, references, or decisions recorded.
- It is growing real subtasks, not just a quick checklist.
- It repeats with the same structure every time.

When that happens, run **Create file task** on the line, or **Edit or convert to file task**. Operon carries the task's identity and fields forward. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## When to shrink back

The reverse is just as valid. If a file task has done its job and the extra context is no longer useful, run **Convert file task to inline task** to collapse it back to a single line. Let work expand and contract with its needs.

## Do not overthink the first choice

The first shape is a starting point, not a verdict. Pick inline when in doubt. Operon is built so the wrong first guess costs you one command to fix.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-072 One workflow, two task shapes|One workflow, two task shapes]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-013 File tasks|File tasks]]
