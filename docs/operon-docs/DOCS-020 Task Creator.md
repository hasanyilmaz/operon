---
Up:
  - "[[DOCS-011 Inline tasks|Inline tasks]]"
  - "[[DOCS-013 File tasks|File tasks]]"
  - "[[DOCS-021 Task Editor|Task Editor]]"
Notes: The dialog for creating new tasks
Icon: square-pen
Color: "#ea580c"
tags:
  - operon
  - taskcreator
  - capture
  - pickers
Updated: 2026-06-25T16:47:21
---

# Task Creator

The Task Creator is a guided dialog that builds a task for you, so you never have to write the `{{key:: value}}` syntax by hand. It is the safest starting point when you want Operon to walk you through creating a task. This page is the reference; for a step-by-step walkthrough of writing a task and adding fields through pickers, see [[DOCS-094 How to create a task with Task Creator|How to create a task with Task Creator]].

Open it with **Create New Operon Task** from the command palette.

> **MEDIA-DOCS-020-1:** The Task Creator dialog with the title field, inline/file toggle, status, priority, and date fields.

![MEDIA-DOCS-020-1 - Task Creator dialog](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-020-1.png)

## When to reach for it

Use the Task Creator when:

- You do not want to write task syntax by hand.
- You want to create a task from anywhere, not only at the cursor.
- You want to set fields up front, such as status, priority, dates, parent task, estimate, recurrence, or links.

If the task is already written as a line in a note, the faster path is **Create or edit inline task** instead. See [[DOCS-011 Inline tasks|Inline tasks]].

## What you choose

Give the task a clear title, then choose its shape:

- **Inline task** if it belongs inside a note or capture target. See [[DOCS-011 Inline tasks|Inline tasks]].
- **File task** if the work needs its own Markdown file and a body. See [[DOCS-013 File tasks|File tasks]].

From there you can set the fields that matter. For a first task, a title, status, priority, and maybe a date are plenty. Contexts, assignees, recurrence, parent links, icons, and colors can wait. The field names follow the canonical set described in [[DOCS-012 Inline task syntax|Inline task syntax]].

## Default to file tasks

Task Creator starts in Inline mode by default, but you can make it open in File mode instead. This is useful if most of your work lives as notes with frontmatter and a body, and you do not want to switch from Inline to File every time.

Turn on **Default to File Task in Task Creator** in **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**. In the same section, **Default file task template** can preselect the template Task Creator uses when it enters File mode. Leave the template setting empty if you still want Task Creator to ask you to pick a template each time.

## Where the task lands

When you save, an inline task goes to the current note when possible, or to your configured capture target. A file task is created in your configured file-task location. These targets are set once in [[DOCS-008 Essential settings to configure first|Essential settings to configure first]], so capture lands somewhere predictable.

> **MEDIA-DOCS-020-2:** The Task Creator in inline-task mode (with Parent task selection), showing where the new note will be created.

![MEDIA-DOCS-020-2 - Task Creator inline task mode](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-020-2.png)

## After creating

Open the new task in the [[DOCS-021 Task Editor|Task Editor]] to see its structured fields, or recover it later with [[DOCS-027 Task Finder|Task Finder]]. If you picked the wrong shape, you can convert between inline and file forms at any time. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

## FAQ

**Do I have to fill every field?** No. A title is enough to start. Add structure when it helps you find, plan, or act on the work.

**Can I create a task while reading another note?** Yes. The Task Creator works from anywhere, which is its main advantage over editing a line in place.

**Can Task Creator open in File mode by default?** Yes. Enable **Default to File Task in Task Creator** under **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-009 Create your first task|Create your first task]]
- [[DOCS-022 Command palette reference|Command palette reference]]
