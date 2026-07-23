---
Notes: Notes whose frontmatter makes the file itself a task
Icon: file-text
Color: "#7c3aed"
Updated: 2026-07-23T16:45:34
---

# File tasks

Some work deserves its own note. An inline task is enough for simple things, but a file task is for work that needs a body: context, references, decisions, subtasks, drafts, or a small operating space of its own. In Operon, a file task is still a Markdown file. It just also behaves like a task.

## How a file task is built

A file task keeps its task fields in frontmatter and uses the note body for the work itself. This whole note is one file task; paste it and start writing under the frontmatter:

```yaml
---
Type: Task
Status: Project.InProgress
Priority: A
dateDue: 2026-05-31
operonId: {{operonId}}
---

## Notes

- [ ] Outline the sections
- [ ] Draft
- [ ] Review
```

Here `operonId: {{operonId}}` is a **template variable**; Operon replaces it with a real, unique id once the note exists, so you never type an id. The split is simple: frontmatter tells Operon what the task is, and the body gives the work room. The plain checkboxes in the body are the task's own checklist. See [[DOCS-061 operonId template variables|operonId template variables]] and [[DOCS-017 Plain checkbox lists|Plain checkbox lists]]. The same file task appears in filters, the Calendar, the Kanban, Task Finder, pinned workflows, recurrence, and time tracking. Open the file to get the Markdown body; open it in the [[DOCS-021 Task Editor|Task Editor]] to get structured controls.

## When work deserves a file

Use a file task when the task is becoming a small document. A release plan may need checklists, links, and validation notes. A writing task may need an outline and a draft. A research task may need sources. At that point the task is not just something to do, it is a place to think.

## Create one

Run **Create file task** from the command palette. Give it a title and the fields that matter, and Operon creates a Markdown note in your configured file-task location.

If file tasks are your normal way to capture work, you can also make [[DOCS-020 Task Creator|Task Creator]] start there. Turn on **Default to File Task in Task Creator** in **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**. Pair it with **Default file task template** if you want your usual template preselected whenever Task Creator opens in File mode.

If the work began as a line of text, Operon can seed the file task from that line and replace the original with a wikilink to the new note:

```md
Before:
Draft migration guide

After:
[[Draft migration guide]]
```

The note becomes easier to scan, and the task gets room to grow. A wikilink to a file task is not just a plain link: Operon decorates it with the task's chips and actions as a [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]], and the same overlay can decorate a link to an inline task written as `[[File#-operonId]]`.

## A lifecycle, not a commitment

File tasks have their own small set of commands that give work a lifecycle:

- **Create file task** when the work starts as a task.
- **Edit or convert to file task** when the work starts as an ordinary note and becomes actionable.
- **Convert file task to inline task** when the file has done its job and the task can shrink back to one line.

So a task can begin small, expand into a note, then collapse again. The first shape is never a lifetime commitment. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## Subtasks inside a file task

A file task body can hold its own work breakdown. It can contain inline subtasks that link back to the parent through `parentTask`, and it can hold a quick checklist of [[DOCS-017 Plain checkbox lists|plain checkboxes]] for simple steps. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

For example, this file task carries two inline subtasks that link back to it, plus a short plain checklist. The parent's `operonId` uses `{{operonId1}}`, and each subtask points its `parentTask` at that same shared id:

```md
---
Type: Task
Status: Project.InProgress
Priority: A
operonId: {{operonId1}}
---

## Subtasks

- [ ] Draft the announcement {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
- [ ] Schedule the email {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}

## Checklist

- [ ] Confirm the date
- [ ] Get sign-off
```

The two inline subtasks are real Operon tasks linked to this file task; the checklist items are plain checkboxes that stay ordinary Markdown. See [[DOCS-061 operonId template variables|operonId template variables]].

## Recurring file tasks

File tasks shine for recurring work with a stable structure: a weekly review, a publishing checklist, a release routine. Operon can create a fresh occurrence that carries the structure forward while resetting per-occurrence parts like completion state and tracked time, so the next run is not just a copy of the last. See [[DOCS-033 Recurring tasks|Recurring tasks]].

## FAQ

**Is a file task just a project note?** Not exactly. It can be project-like, but it is still a task record with status, priority, identity, and dates.

**Can file tasks contain inline subtasks?** Yes, and those subtasks can link back to the parent task.

**Should every large task become a file task?** Only when the extra note helps. If the work fits in one line and a few fields, keep it inline.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → File Tasks**, which configures how file tasks behave. Use **New File Task Creation Defaults** there when you want Task Creator to default to File mode and preselect a file-task template.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-005 Operon core concepts|Operon core concepts]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-014 Inline vs file tasks|Inline vs file tasks]]
