---
Notes: Add your own task fields when the built-in set is not enough, with inline and frontmatter examples
Icon: key-square
Color: "#ca8a04"
Updated: 2026-10-13T16:29:41+02:00
---

# Custom keys

A custom key is a task field you define yourself. Operon's built-in fields cover the common task model, but your work may need something they do not have: a client, an effort estimate, a review flag, a department. A custom key adds that field as a real canonical key, not just a loose YAML property, so Operon can expose it through the controls supported for its type and your chosen surfaces. For renaming the built-in fields instead, see [[DOCS-039 Key mappings|Key mappings]].

> **MEDIA-DOCS-040-1:** The Custom Keys settings listing user-defined fields with their types and surfaces.

![MEDIA-DOCS-040-1 - The Custom Keys settings listing user-defined fields with their types and surfaces](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-040-1.png)

## What you define

When you add a custom field, you give it:

- A **visible property name**, which must be unique across all fields.
- A **type**: Text, Number, Date, Date & time, List, or Checkbox. The type decides how the value is stored and validated. See [[DOCS-018 Task properties|Task properties]].
- An optional **icon** from Lucide, used in the field's controls and its compact chip. Supported surfaces use it as the field icon; value-dependent indicators can differ, such as checked and unchecked Checkbox values.

The field now has a defined identity and type. It is written as `{{your-key:: value}}` on an inline task and as frontmatter on a file task, and Operon reads it consistently across both.

For example, with two custom keys `client` (Text) and `effort` (Number), an inline task carries them alongside the built-in fields:

```md
- [ ] Send the proposal {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{client:: Acme}} {{effort:: 3}}
```

The same task as a file task writes those keys in frontmatter:

```yaml
---
operonId: {{operonId}}
Status: Project.InProgress
client: Acme
effort: 3
---
```

Operon uses the definitions of `client` and `effort` to validate and display their values on supported surfaces.

> **MEDIA-DOCS-040-2:** The Add custom field dialog with a name, type, and surface choices.

![MEDIA-DOCS-040-2 - The Add custom field dialog with a name, type, and surface choices](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-040-2.png)

## Where a custom field shows up

A custom key is not forced into every surface. You choose where it appears with per-field toggles:

- **Show in editor**: as a control in the [[DOCS-021 Task Editor|Task Editor]] and the Live Preview field menus.
- **Show in creator**: as a field in the [[DOCS-020 Task Creator|Task Creator]].
- **Show in chips**: as a compact chip on the task. See [[DOCS-041 Task chips display and behavior|Task chips]].
- **Show in Kanban swimlanes**: as a grouping option for [[DOCS-030 Kanban overview|Kanban]] swimlanes.

The general Custom Key surface selector does not offer Checkbox fields as ordinary custom picker controls. This is separate from native Checkbox editing in Additional, prepared template fields, and Tables. Existing Checkbox value chips in Task Editor use checked/unchecked icons where that rendering path is already available; this does not add new chip surfaces. See [[DOCS-070 Custom field pickers|Custom field pickers]] and [[DOCS-115 File task property columns|Vault Properties]].

## Description for shared context

A custom field can carry an optional **description**: a short note on what the field is used for, edited in its own card on **Core → Custom Keys**. Like a pipeline or priority description, it is never required, but it earns its place. It reminds you what you meant when you created the field, and it gives an agent working in your vault the context to use the field correctly instead of guessing from its name. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]] and [[DOCS-038 Task priorities|Task priorities]] for the same idea on those fields.

## Usage and order

The settings show where each custom field is actually used: how many tasks carry a value, which filters and Kanban presets reference it, and which surfaces it is on. This makes it safe to see a field's reach before you change or remove it. You can also reorder your custom fields, which sets the order they appear in.

## Renaming a custom field later

You can rename a custom field's visible property name at any time, with the same caveat as any [[DOCS-039 Key mappings|key mapping]]: the rename changes how Operon writes and reads the field from that point on, but it does not rewrite the property name in tasks you already created. Those tasks keep the old name until you update them yourself. The field's canonical key is fixed when you create it, so name the field well up front and prefer renaming early over renaming after many tasks exist.

## Deleting a custom key

Deleting a custom field removes only its mapping from Operon settings. The values already written in your files stay exactly where they are. Removing the definition does not erase source values; recreating a compatible definition is a separate settings action.

Values left in the source may be exposed through [[DOCS-115 File task property columns|Vault Properties]], subject to their names, type declarations, and compatibility. Deleting a Custom Key does not guarantee that every former value becomes editable: Operon preserves stored inline interpretation and refuses incompatible types.

## Choosing between a Custom Key and a Vault Property

Both participate in the persistent task index. Choose a Custom Key for its explicit field definition and supported surface preferences, such as showing a Text field in selected chip surfaces. Choose a Vault Property when its native Task Editor, template, and Table controls are sufficient. A Vault Property no longer needs to become a Custom Key just to appear in Task Editor.

A shared index is not a promise of identical picker, chip, filter, or swimlane support. The comparison in [[DOCS-018 Task properties|Task properties]] explains the model; [[DOCS-115 File task property columns|Vault Properties]] lists the native surfaces and limits.

## FAQ

**Is a Custom Key different from adding a source property?** Yes. It creates a configured field with a stable identifier, type, and supported surface preferences. A Vault Property can be managed directly in Additional, supported Creator template fields, and Tables without that Custom Key setup.

**Can I use a custom key on inline tasks too?** Yes. It works as `{{key:: value}}` inline and as frontmatter in file tasks, the same as any field.

**What happens to my data if I delete the field?** Nothing is deleted from your files. The values remain in Markdown. Recreating a compatible definition can restore managed access; incompatible types still require review.

## Settings

Operon settings for this live in **Settings → Operon → Core → Custom Keys**, which creates and manages custom fields, their surfaces, usage, order, and delete behavior.

Each custom field has one Settings search result, including its name and description. The result targets that field's card rather than creating a separate result for every control inside it. See [[DOCS-043 Settings search|Settings search]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-115 File task property columns|Vault Properties]]
