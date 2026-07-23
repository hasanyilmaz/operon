---
Notes: Use Templater and QuickAdd to capture Operon tasks from a template
Icon: wand-sparkles
Color: "#059669"
Updated: 2026-07-23T16:45:34
---

# Templater and QuickAdd workflows

Templater and QuickAdd are separate community plugins, not part of Operon. They are worth a page because they pair well with it: together they let you capture a fully formed Operon task, or a whole task tree, from a keystroke. Operon's part is making the template correct; theirs is creating the note and triggering it.

## How the pieces fit

Each tool does one job:

- **Templater** fills dynamic content in a template (dates, prompts, computed values) when the note is made. Operon processes Templater syntax when it builds a [[DOCS-024 Task templates|file task template]], so a template can be both a Templater template and an Operon task.
- **QuickAdd** decides where and when a note is created. You point a QuickAdd choice at a template and run it from a command or hotkey, so capture is one step from anywhere.
- **Operon** ensures the result is a real task: the template carries the Operon fields, `operonId` template variables become real ids, and task value variables such as `{{status}}`, `{{priority}}`, `{{dateScheduled}}`, and `{{datetime}}` become the values for the created task.

The division is clean: QuickAdd launches, Templater fills its own syntax, Operon makes it a task and resolves Operon's `{{...}}` variables.

## A capture flow

A common setup:

1. Write a [[DOCS-024 Task templates|file task template]] with the Operon fields you always want, plus any Templater syntax for dates or prompts.
2. Add Operon template variables if the template should generate linked subtasks or repeat task values such as status, priority, scheduled date, and creation time. See [[DOCS-061 operonId template variables|operonId template variables]].
3. Create a QuickAdd choice that makes a note from that template.
4. Run it from a hotkey whenever you want that kind of task. Operon builds it with correct fields and fresh ids.

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

Templater fills its `<% ... %>` commands. Operon fills `{{operonId}}`, `{{status}}`, `{{priority}}`, and `{{datetime}}`. If your default workflow status is `Project.Brainstorming` and default priority is `High`, the created task will contain those values instead of the template variables.

## FAQ

**Do I need both plugins?** No. Templater alone is enough for dynamic templates. QuickAdd adds the launch-from-anywhere step. Use either, both, or neither.

**Does Operon depend on these?** No. They are optional. Operon's own [[DOCS-020 Task Creator|Task Creator]] and templates work without them.

**How do subtasks get linked in a template?** Through `operonId` template variables, which reuse one id to wire `parentTask`. The same page also covers task value variables such as `{{status}}`, `{{priority}}`, and `{{datetime}}`. See [[DOCS-061 operonId template variables|operonId template variables]].

## Settings

Operon's only related setting is the template folder, in **Settings → Operon → Tasks → File Tasks**. Templater and QuickAdd are configured in their own plugin settings.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
