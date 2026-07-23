---
Notes: Start file tasks from a reusable body and frontmatter
Icon: file-code
Color: "#ea580c"
Updated: 2026-07-23T16:45:34
---

# Task templates

A file task often follows a shape: a weekly review has the same sections, a release has the same checklist, a client note has the same fields. Task templates let a new [[DOCS-013 File tasks|file task]] start from that shape instead of a blank page. You point Operon at a folder of templates, and the file-task creator offers them when you make a task.

> **MEDIA-DOCS-024-1:** The template picker shown while creating a file task, listing available templates.

![MEDIA-DOCS-024-1 - The template picker shown while creating a file task, listing available templates](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-024-1.png)

## How templates work

Templates apply to **file tasks**, the ones that have a note body. When you create or convert a file task, Operon can build it from a template: the template's body and frontmatter become the starting point, and Operon fills in the task fields it manages, like the `operonId`.

There is always at least one built-in option, so the picker is never empty. Operon offers one **minimal template per configured pipeline**, named for that pipeline, so the picker shows one per [[DOCS-037 Pipelines and statuses|pipeline]] you have set up, for example one for `Project` and a separate one for `Personal`. Each minimal option seeds the new file task at that pipeline's own first status, adds the `operonId`, and the created and modified timestamps, so choosing the right pipeline's minimal template also puts the task in that pipeline from the start. Your own templates from the template folder sit alongside these.

## Set up a template folder

In settings, choose a **template folder**. The top-level Markdown files in that folder become the choices in the template picker. A few rules worth knowing:

- Only **top-level** files in the folder are listed, not files in subfolders.
- If you leave the folder empty or unset, the picker shows only the built-in per-pipeline minimal templates.
- When a conversion needs a template without asking, Operon uses the **first file alphabetically** in your template folder as the default, if you have any. Name your everyday template so it sorts first if you want it chosen automatically. If your template folder has no files at all, Operon falls back to your **first configured pipeline's** minimal template instead, in the order your pipelines are arranged in settings, not alphabetically.

## Pick a Task Creator default template

If you create file tasks through [[DOCS-020 Task Creator|Task Creator]] often, you can make your usual template the default. In **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**, set **Default file task template** to one of the templates from your file-task template folder. When Task Creator enters File mode, that template is preselected.

This is separate from the alphabetic fallback above. The fallback is for conversion flows that need a template without asking. **Default file task template** is for Task Creator, where you can still change the selected template for the current task before saving.

## Templater support

Templates can contain Templater syntax. If the [Templater](https://github.com/SilentVoid13/Templater) plugin is installed, Operon processes that syntax when it builds the task, so a template can insert dates, prompts, and other dynamic content. If Templater is not available but a template uses its syntax, Operon tells you rather than writing raw syntax into your note. For the wider pattern of dynamic templates, see [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]].

## Three variable systems

A File Task template can use three different kinds of dynamic syntax:

- **Templater** uses `<% ... %>` for prompts, code, and its own dynamic content.
- **Operon variables** use `{{...}}` for task identity and task data, such as `{{operonId}}`, `{{status}}`, and `{{datetime}}`.
- **Obsidian Templates-compatible variables** use familiar `{{title}}`, `{{date}}`, and `{{time}}` syntax, plus explicit `{{date:FORMAT}}` and `{{time:FORMAT}}` forms.

Operon does not call the Core Templates **Insert template** command. When it creates a File Task, it resolves the compatible tokens itself after Templater has run. The **File Task Templates** folder in Operon chooses these templates; it is separate from the Core Templates plugin's own template folder. See [[DOCS-061 operonId template variables|Template variables]] for the full scope matrix and syntax rules.

A template can combine Operon variables with compatible creation variables. For example, use `title: "{{title}}"` when frontmatter should reflect the final file basename, and use plain `{{date}}` in canonical Operon date fields.

For example, this template frontmatter:

```md
---
operonId: {{operonId}}
Status: {{status}}
Priority: {{priority}}
dateScheduled: {{dateScheduled}}
datetimeCreated: {{datetime}}
---
```

can become output like this when Operon creates the file task:

```md
---
operonId: a1b2c3d
Status: Project.Brainstorming
Priority: High
dateScheduled: 2026-06-27
datetimeCreated: 2026-06-27T13:46:10
---
```

Your actual status, priority, and dates come from the task being created and your Operon defaults. See [[DOCS-061 operonId template variables|Template variables]] for the full list, compatible Core-style variables, and parent-child examples.

## FAQ

**Do templates work for inline tasks?** No. Templates are for file tasks, which have a body to fill. Inline tasks are a single line.

**What if I do not set a template folder?** You still get a built-in minimal template for each configured pipeline, seeded at that pipeline's own first status. Folder templates are optional.

**Which template is used when Operon does not ask?** For conversion flows, the first file alphabetically in your template folder if you have one, otherwise your first configured pipeline's minimal template. For Task Creator, set **Default file task template** if you want a specific template preselected.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → File Tasks**. **File Task Templates** sets the template folder that fills the picker, and **New File Task Creation Defaults** sets whether Task Creator opens in File mode and which file-task template is preselected.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
