---
Notes: Prepare inline task templates, review empty and filled fields before creation, and choose fixed or last-used defaults
Icon: layout-template
Color: "#0F766E"
Updated: 2026-10-13T16:40:45+02:00
---

# Using inline task templates

An Inline Task template supplies properties for a new task. Task Creator shows the supported fields before creation, including fields the template leaves empty, so you can review and change the task while it is still a draft.

This preview is available for both **Inline and File templates**. Inline creation uses supported template properties and does not copy the template's Markdown body. See [[DOCS-024 Task templates|Task templates]] for the shared template system and [[DOCS-020 Task Creator|Task Creator]] for the dialog.

## 1. Choose a template source

Inline and File Tasks share a template picker. It offers built-in minimal pipeline templates and Markdown files directly inside the configured **Template folder**, under **Settings → Operon → Tasks → File Tasks**. Templates in nested subfolders are not listed. You do not need to create a second folder for Inline templates.

The built-in options are labelled **Minimal File Task — [pipeline]** in the shared picker, but can also be used for Inline creation. They provide a starting point based on that pipeline's initial status and normal creation fields. Choose **None** in the Inline default setting when you want no template; normal task defaults still apply.

## 2. Prepare a small property template

For example, save a Markdown template called `Project Capture.md` directly in that folder:

```yaml
---
Client: Acme
Budget: 0
Reviewed: false
ReviewDate:
Topics: []
---
```

These are example Vault Properties, not required Operon field names. Before using them, assign their types in Obsidian's Properties controls:

| Property | Type | Starting value |
|---|---|---|
| Client | Text | Acme |
| Budget | Number | 0 |
| Reviewed | Checkbox | false |
| ReviewDate | Date | Empty |
| Topics | List | Empty list |

Use names that do not conflict with existing canonical or Custom Key mappings. You do not need a Custom Key just to use supported Vault Properties in the template. Built-in and configured custom fields can also be included, subject to their own types and supported controls. See [[DOCS-018 Task properties|Task properties]] and [[DOCS-115 File task property columns|Vault Properties]].

An unassigned Automatic type is not a writable type inferred from the example value. Declare it deliberately. Fix type conflicts before creating the task rather than expecting Operon to guess.

## 3. Review empty and filled fields in Creator

Open Task Creator, select Inline, and choose the template using the bottom template control. The control shows the selected template's name. Typing the start of Template in the description also offers **Pick a Template** as a shortcut.

For the example above, Creator prepares Client, Budget, Reviewed, ReviewDate, and Topics. The empty date and list remain available to fill; `0` and `false` are real values, not missing values. Relevant supported fields appear even when you did not keep them permanently visible in Task Creator Chips.

Before creating the task, you can:

- Change Client from Acme to another client.
- Set Budget to 250 or leave it at 0.
- Toggle Reviewed, fill ReviewDate, or add Topics.
- Clear or remove a supported field using its control.

The preview combines template values with defaults and any values supplied by the entry point or parent rules. An explicit source value or a deliberate user choice can take precedence over a template value. Lists follow their field's merge rules, so inspect the combined result rather than assuming a template always replaces everything.

This is a draft for one task. Editing a value here does not edit the template file or change previously created tasks. The same review-and-edit workflow is available in File mode, although File creation can also use the template body.

## 4. Change templates without losing your own choices

If you select another template, Creator refreshes the template-supplied fields for that choice. Fields supplied only by the previous template can disappear; fields from the new template can appear, including empty ones.

Your deliberate edits and removals are retained. For example, if you changed Budget to 250, selecting a template that supplies Budget as 100 does not replace your choice. If you left Client untouched and no stronger source supplies it, changing to a template with Client set to Personal updates the preview to Personal.

Switching between **File and Inline** loads the destination mode's default template. A manual template selection or clearing applies to the current mode until you switch modes. User field edits are still protected; the mode switch is not a request to reset the draft.

Automatically loaded defaults and a mode switch alone do not require a discard warning. Editing the description, Note, properties, or manually changing the template can require confirmation when closing an unsaved draft.

## 5. Create and check the saved task

Complete the description and create the Inline Task through your normal destination flow. Empty property values and empty lists are omitted from Inline template output if you leave them empty. `0`, `false`, and a list containing an empty string are preserved. An empty field being visible in the draft therefore does not mean an empty container must be saved on the task line.

Operon writes the inline syntax and identity. Supported template dates shown in the prepared preview remain fixed when that draft is saved; they are not silently recalculated at the last moment. See [[DOCS-012 Inline task syntax|Inline task syntax]] and [[DOCS-061 operonId template variables|Template variables]].

## Fixed default or last-used default

Under **Settings → Operon → Tasks → Inline Tasks**, set **Default inline task template** to your usual template. The independent **Use last used template as default** option sits below it and starts off.

| Choice or action | Result |
|---|---|
| Toggle off | The saved default stays fixed, even if you create a task with a different template |
| Toggle on, then successfully create an Inline Task through Creator with another template | That used template becomes the real Inline default |
| Select a template, then cancel or close Creator | The saved default does not change |
| Only switch File/Inline, preview, or have an unsuccessful or uncertain creation | No new default is learned |
| Create an Inline Task without a template | The last saved Inline default is retained |
| Turn the toggle on | No previous usage is applied immediately; it waits for the next successful creation |
| Turn it off | The last saved default stays selected and becomes fixed |

For example, start with Project Capture as the default. With the toggle on, successfully create a task using Daily Capture: the next Inline creation starts with Daily Capture. Create another with Personal Finance and that becomes the next default. With the toggle off, these one-task choices leave Project Capture unchanged.

File Tasks have their own toggle and default. Successful Inline creation changes only the Inline default; File creation changes only the File default. You can still choose either default manually while its toggle is on.

This updates the actual setting, not just Creator's recent-template ordering. Supported quick-creation and conversion paths that read the Inline default use its new value too. For [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]], change the default before scanning and scan again after a change.

If you change the relevant default or turn off the toggle while creation is in progress, that newer preference is protected. If saving the new default fails after the task was created, the task remains created and Operon reports the preference-save problem; do not create a duplicate task to retry it.

## Keep the permanent chip row small

If templates supply most of your fields, keep only frequently used controls permanently visible under **Settings → Operon → Interface → Task Chips → Task Creator Chips**. Template-supplied supported fields appear as needed, including empty fields you can fill.

This is a workflow suggestion, not a change to your settings. Hiding a permanent control is not a request to remove that property from a template or discard its value. Inspect the prepared fields before creating the task.

## What an Inline template does not copy

- **Markdown body:** no body text is appended to the task or copied into its Note automatically.
- **Templater expressions:** Inline template creation does not execute Templater. Fields requiring it are skipped.
- **File-only properties:** fields such as aliases and cssclasses are not ordinary Inline template fields.
- **Automatic and unsupported values:** these are not silently converted into writable native fields. Skipped fields are reported together after successful Inline creation.
- **Task identity and bookkeeping:** Operon handles these through its creation rules; a template is not a way to reuse another task's identity.

Invalid template YAML stops creation rather than applying a partial interpretation. Type conflicts or an unverifiable source can also block submission. These differ from fields intentionally skipped for Inline creation. See [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]] for File template integrations.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-024 Task templates|Task templates]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-094 How to create a task with Task Creator|How to create a task with Task Creator]]
- [[DOCS-018 Task properties|Task properties]]
- [[DOCS-115 File task property columns|Vault Properties]]
- [[DOCS-041 Task chips display and behavior|Task chips]]
- [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]]
