---
Notes: Use Templater and QuickAdd to capture Operon tasks from a template
Icon: wand-sparkles
Color: "#059669"
Updated: 2026-10-13T16:48:42+02:00
---

# Templater and QuickAdd workflows

Templater and QuickAdd are separate community plugins, not part of Operon. They are worth a page because they pair well with it: together they let you capture a fully formed Operon task, or a whole task tree, from a keystroke. Operon's part is making the template correct; theirs is creating the note and triggering it.

## How the pieces fit

Each tool does one job:

- **Templater** fills dynamic content in a template (dates, prompts, computed values) when the note is made. Operon processes Templater syntax when it builds a [[DOCS-024 Task templates|file task template]], so a template can be both a Templater template and an Operon task.
- **QuickAdd** decides where and when a note is created. You point a QuickAdd choice at a template and run it from a command or hotkey, so capture is one step from anywhere.
- **Operon** prepares and creates tasks through its own creation flow, resolving the variables supported by that entry point. A note created directly by another plugin must already carry suitable task fields; do not assume it receives the full Creator preparation flow.

The creation entry point matters. Invoking Task Creator uses Operon's preparation and creation flow; directly creating a note with QuickAdd does not imply that every Operon template variable is processed. Use the scope matrix in [[DOCS-061 operonId template variables|Template variables]] when choosing the workflow.

## A capture flow

A common setup:

1. Write a [[DOCS-024 Task templates|file task template]] with the Operon fields you always want, plus any Templater syntax for dates or prompts.
2. Add Operon template variables if the template should generate linked subtasks or repeat task values such as status, priority, scheduled date, and creation time. See [[DOCS-061 operonId template variables|operonId template variables]].
3. Create a QuickAdd choice that makes a note from that template.
4. Run the choice from a hotkey. If it creates a note directly, it follows QuickAdd’s creation path, not automatically Task Creator’s preview or variable-resolution path. For the full Operon File creation flow, have your workflow invoke Task Creator and finish creation there.

## What is Operon's part and what is not

To set expectations: Operon does not configure Templater or QuickAdd for you, and it has no settings for them. They are configured in their own plugins. What Operon contributes is processing Templater syntax in its file task templates and resolving Operon template variables.

Obsidian's **Templates** core plugin is a separate system from Templater. Operon does not run its **Insert template** command, but its own File Task and Calendar Daily Note creation flows recognize compatible `{{title}}`, `{{date}}`, and `{{time}}` syntax. Templater still owns `<% ... %>` commands. See [[DOCS-061 operonId template variables|Template variables]] for the scope and format rules.

That means one template can use both systems:

```md
---
operonId: {{operonId}}
Status: {{status}}
Priority: {{priority}}
datetimeCreated: {{datetime}}
---

# <% tp.file.title %>

Operon status: {{status}}
Operon priority: {{priority}}
```

When this template is used through Operon File Task creation, Templater fills its `<% ... %>` commands. Operon fills `{{operonId}}`, `{{status}}`, `{{priority}}`, and `{{datetime}}`. If your default workflow status is `Project.Brainstorming` and default priority is `High`, the created task will contain those values instead of the template variables.

## Inline templates and Creator preview

Inline templates need neither Templater nor QuickAdd. Choose one in Task Creator to review its supported frontmatter properties, including empty fields, and edit them before saving. Template changes preserve deliberate user edits and removals. The body is not copied and Templater expressions are not executed in this mode. See [[DOCS-150 Using inline task templates|Using inline task templates]].

File mode also previews supported properties, but preview does not execute Templater. Dynamic prompts and code belong to actual File creation, so the preview is not a promise to display their final results. Creator's independent dynamic-default toggles apply only after successful creation through that shared flow, not merely after a QuickAdd choice runs.

## FAQ

**Do I need both plugins?** No. Templater alone is enough for dynamic templates. QuickAdd adds the launch-from-anywhere step. Use either, both, or neither.

**Does Operon depend on these?** No. They are optional. Operon's own [[DOCS-020 Task Creator|Task Creator]] and templates work without them.

**How do subtasks get linked in a template?** Through `operonId` template variables, which reuse one id to wire `parentTask`. The same page also covers task value variables such as `{{status}}`, `{{priority}}`, and `{{datetime}}`. See [[DOCS-061 operonId template variables|operonId template variables]].

## Settings

Operon's shared template folder is under **Settings → Operon → Tasks → File Tasks**. File and Inline defaults and their dynamic-default toggles are configured in their respective task settings. Templater and QuickAdd are configured in their own plugin settings.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
