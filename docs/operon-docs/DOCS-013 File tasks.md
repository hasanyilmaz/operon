---
Notes: Notes whose frontmatter makes the file itself a task
Icon: file-text
Color: "#7c3aed"
Updated: 2026-10-14T11:47:37+02:00
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

Run **Create file task** from the command palette. Give it a title and the fields that matter, and Operon creates a Markdown note in the matching pipeline folder, parent-aware folder, or default File Task location according to [[DOCS-136 Task Router|Task Router]].

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

Open **Settings → Operon → Tasks → File Tasks**:

- **New File Task Creation Defaults** sets Task Creator's default File mode and preselected file-task template.
- **File Task Templates** manages file-task templates.
- **Daily and Weekly Notes as File Tasks** contains the two toggles for creating new Daily or Weekly Notes as Operon File Tasks. Their management, format, template, and folder settings live under **Tasks → Task Router → Daily and Weekly Notes**; see [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]].
- **File Task display title** is an opt-in setting under **Settings → Operon → Tasks → File Tasks → Display**. When enabled, a non-empty `fileTaskDisplayTitle` frontmatter value (mapped to `title` by default) supplies the visible label; otherwise Operon falls back to the filename-derived description. The Task Editor name field (desktop and mobile) and Table Description cell edit this property; clearing it restores the filename fallback. With the setting off, those edits rename the file as before. The filename still controls board ordering and Table sorting/grouping. See [[DOCS-039 Key mappings|Key mappings]].
- The Task Editor shows a **File** row only while **File Task display title** is enabled. It shows the file's current filename. With **When the display title changes** set to **Ask**, Operon saves the title first, then replaces that value line with the current and suggested filenames, plus **Rename** or **Keep**. The suggestion can be edited in place. Editing the title again restores the normal row; only the latest saved title can offer a replacement.
- **When the display title changes** offers **Keep the filename** (default), **Ask**, or **Rename automatically**. **Keep the filename** never prompts or renames; use Obsidian's own rename command for a manual rename in that mode. **Ask** is limited to Operon UI saves and reports rename errors while leaving the title saved. **Rename automatically** follows canonical display-title changes through the index pipeline regardless of source, including Obsidian Properties, source mode, or frontmatter edits by agents. Automatic renames are debounced; initial indexing and full rebuilds do not rename pre-existing filename/title drift. A failed automatic rename keeps the saved title unchanged and shows one Notice.
- **Suggested filename rule** proposes a filename from the display title. Choose **Same as title**, **kebab-case** (default), **snake_case**, or **Custom**. The kebab-case and snake_case presets preserve Unicode letters and digits. In **Custom**, the optional **Lowercase** step runs first, then ordered global replacements run in their listed order. Rules use linear-time, RE2-compatible regular-expression syntax; unsupported constructs such as backreferences and lookarounds are rejected on save. Forbidden filename characters are always removed.
- Filename-rule safety bounds are 16 rules; 256 code units for each pattern and replacement; 1024 code units for input and every intermediate result; and an RE2 program-size limit of 2048. A failed or empty suggestion keeps the current filename and explains that fallback in the **Ask** row or a single **Rename automatically** Notice.
- **File Task Conversion** contains conversion preferences.
- **Excluded folders** keeps selected folders outside Operon's task indexing.
- **Convert notes** provides the note-conversion tools.

Working folders, parent-aware placement, and archive destinations live separately under **Tasks → Task Router**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-136 Task Router|Task Router]]
- [[DOCS-005 Operon core concepts|Operon core concepts]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-014 Inline vs file tasks|Inline vs file tasks]]
