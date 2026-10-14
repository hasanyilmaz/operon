---
Notes: Reuse template properties for inline tasks and body plus frontmatter for file tasks
Icon: file-code
Color: "#ea580c"
Updated: 2026-10-13T16:48:42+02:00
---

# Task templates

Task templates give repeated work a reusable starting point. Both Inline and File tasks can use template properties; File tasks also use the Markdown body. Both modes share Operon's template picker and folder. For a practical Inline walkthrough, see [[DOCS-150 Using inline task templates|Using inline task templates]].

> **MEDIA-DOCS-024-1:** The template picker shown while creating a file task, listing available templates.

![MEDIA-DOCS-024-1 - The template picker shown while creating a file task, listing available templates](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-024-1.png)

## How templates work

| Task shape | What the template supplies |
| --- | --- |
| Inline | Supported frontmatter properties become task fields; the Markdown body is not inserted. |
| File | Frontmatter and Markdown body form the new note; Operon fills managed fields such as task identity. |

In Task Creator, both modes preview supported properties before creation, including empty fields. You can edit or remove them there. Choosing a different template refreshes template-supplied fields while keeping deliberate user edits and removals. Preview does not create a task or execute Templater.

For each configured pipeline with a usable initial status, Operon offers a **minimal template**, named for that pipeline, so the picker shows one per [[DOCS-037 Pipelines and statuses|pipeline]] you have set up, for example one for `Project` and a separate one for `Personal`. These options retain the name **Minimal File Task** in the shared picker but can also be selected for Inline creation. Each minimal option seeds the new task at that pipeline's own first status, adds the `operonId`, and the created and modified timestamps, so choosing the right pipeline's minimal template also puts the task in that pipeline from the start. Your own templates from the template folder sit alongside these.

## Set up a template folder

In settings, choose a **template folder**. The top-level Markdown files in that folder become the choices in the template picker. A few rules worth knowing:

- Only **top-level** files in the folder are listed, not files in subfolders.
- If you leave the folder empty or unset, the picker shows only the built-in per-pipeline minimal templates.
- When an inline-to-file conversion needs a file template without asking, Operon uses the **first file alphabetically** in your template folder as the default, if you have any. Name your everyday template so it sorts first if you want it chosen automatically. If your template folder has no files at all, Operon falls back to your **first configured pipeline's** minimal template instead, in the order your pipelines are arranged in settings, not alphabetically.

## Pick independent defaults

- **Tasks → File Tasks → New File Task Creation Defaults → Default file task template** selects the initial File template in Creator.
- **Tasks → Inline Tasks → Default inline task template** selects the Inline default used by Creator and applicable Inline creation/conversion paths.

Each setting has an independent **Use last used template as default** toggle, off initially. Enable it to save the template from the next successful Creator creation as that mode's real default. Cancelled, failed, or uncertain creation does not teach a new default; template-free Inline creation keeps the previous one. Turning the toggle off leaves the last saved default fixed. You can still set either default manually.

The alphabetical file-conversion fallback above is separate. Tasks emoji bulk conversion uses the Inline default: to convert different folders with different templates, run separate batches with a fresh Scan after changing the default. See [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]] and [[DOCS-150 Using inline task templates|Using inline task templates]].

## Templater support

File Task templates can contain Templater syntax. If the [Templater](https://github.com/SilentVoid13/Templater) plugin is installed, Operon processes that syntax when it builds the task, so a template can insert dates, prompts, and other dynamic content. If Templater is not available but a template uses its syntax, Operon tells you rather than writing raw syntax into your note. For the wider pattern of dynamic templates, see [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]].

Inline template preparation does not run Templater or copy the template body. Properties requiring Templater execution are skipped in Inline mode with a notice; use supported property values or Operon variables instead.

Daily and Weekly Note templates are configured separately from this File Task template folder. Their Runtime/CLI route must stay deterministic and write-free during preview, so a periodic template containing Templater `<% ... %>` expressions is refused on that route rather than executed. See [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]].

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

**Do templates work for inline tasks?** Yes. Supported frontmatter properties become inline fields; the body and Templater execution remain File-only. See [[DOCS-150 Using inline task templates|Using inline task templates]].

**What if I do not set a template folder?** You still get a built-in minimal template for each configured pipeline with a usable initial status. Folder templates are optional.

**Which template is used when Operon does not ask?** For inline-to-file conversion, the first file alphabetically in your template folder if you have one, otherwise your first configured pipeline's minimal template. For Creator, use the separate File and Inline defaults. Tasks emoji conversion uses the Inline default.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → File Tasks**. **File Task Templates** sets the template folder that fills the picker, and **New File Task Creation Defaults** sets whether Task Creator opens in File mode and which file-task template is preselected. The Inline default is under **Tasks → Inline Tasks**; both default selectors have their own dynamic-default toggle.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
