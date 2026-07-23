---
Notes: Add your own task fields when the built-in set is not enough, with inline and frontmatter examples
Icon: key-square
Color: "#ca8a04"
Updated: 2026-07-23T16:45:34
---

# Custom keys

A custom key is a task field you define yourself. Operon's built-in fields cover the common task model, but your work may need something they do not have: a client, an effort estimate, a review flag, a department. A custom key adds that field as a real canonical key, not just a loose YAML property, so Operon treats it like any other field. For renaming the built-in fields instead, see [[DOCS-039 Key mappings|Key mappings]].

> **MEDIA-DOCS-040-1:** The Custom Keys settings listing user-defined fields with their types and surfaces.

![MEDIA-DOCS-040-1 - The Custom Keys settings listing user-defined fields with their types and surfaces](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-040-1.png)

## What you define

When you add a custom field, you give it:

- A **visible property name**, which must be unique across all fields.
- A **type**: Text, Number, Date, Date & time, List, or Checkbox. The type decides how the value is stored and validated. See [[DOCS-018 Task properties|Task properties]].
- An optional **icon** from Lucide, used in the field's controls and its compact chip. Like every field icon, it is set once and applies wherever Operon shows that field.

From then on the field behaves like a built-in one. It is written as `{{your-key:: value}}` on an inline task and as frontmatter on a file task, and Operon reads it consistently across both.

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

Operon validates and displays `client` and `effort` like any built-in field, because they are real canonical keys, not loose YAML.

> **MEDIA-DOCS-040-2:** The Add custom field dialog with a name, type, and surface choices.

![MEDIA-DOCS-040-2 - The Add custom field dialog with a name, type, and surface choices](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-040-2.png)

## Where a custom field shows up

A custom key is not forced into every surface. You choose where it appears with per-field toggles:

- **Show in editor**: as a control in the [[DOCS-021 Task Editor|Task Editor]] and the Live Preview field menus.
- **Show in creator**: as a field in the [[DOCS-020 Task Creator|Task Creator]].
- **Show in chips**: as a compact chip on the task. See [[DOCS-041 Task chips display and behavior|Task chips]].
- **Show in Kanban swimlanes**: as a grouping option for [[DOCS-030 Kanban overview|Kanban]] swimlanes.

A Checkbox-type custom field is stored, but it does not yet appear in the editor, creator, chip, or swimlane surfaces.

## Description for shared context

A custom field can carry an optional **description**: a short note on what the field is used for, shown in the Keymapping list. Like a pipeline or priority description, it is never required, but it earns its place. It reminds you what you meant when you created the field, and it gives an agent working in your vault the context to use the field correctly instead of guessing from its name. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]] and [[DOCS-038 Task priorities|Task priorities]] for the same idea on those fields.

## Usage and order

The settings show where each custom field is actually used: how many tasks carry a value, which filters and Kanban presets reference it, and which surfaces it is on. This makes it safe to see a field's reach before you change or remove it. You can also reorder your custom fields, which sets the order they appear in.

## Renaming a custom field later

You can rename a custom field's visible property name at any time, with the same caveat as any [[DOCS-039 Key mappings|key mapping]]: the rename changes how Operon writes and reads the field from that point on, but it does not rewrite the property name in tasks you already created. Those tasks keep the old name until you update them yourself. The field's canonical key is fixed when you create it, so name the field well up front and prefer renaming early over renaming after many tasks exist.

## Deleting a custom key

Deleting a custom field removes only its mapping from Operon settings. The values already written in your files stay exactly where they are. Those properties simply become unmanaged until you recreate the same canonical key, so deleting is reversible in the sense that no data is destroyed.

An unmanaged property is not necessarily invisible to Operon, though. On a file task, it can still surface on its own as a [[DOCS-115 File task property columns|file task property column]] in Table and filters, just without the Task Editor, Task Creator, chip, and swimlane surfaces a Custom Key gets. See "Not a Custom Key" below.

## Not a Custom Key: file task property columns

A Custom Key is not the only way an unmanaged frontmatter property becomes usable. On file tasks, Operon also discovers unmanaged properties automatically and offers them as typed Table columns and filter conditions, with none of the setup a Custom Key needs, a name, a type, an icon, or a surface choice. The tradeoff is reach: a Custom Key behaves like a built-in field everywhere, while a discovered property only reaches Table and filters. Reach for a Custom Key when a field deserves the Task Editor, Task Creator, chips, and swimlanes too; leave it as a discovered property when Table and filters are all you need right now. See [[DOCS-115 File task property columns|File task property columns]] for the full comparison.

## FAQ

**Is a custom key different from just adding a YAML property?** Yes, in reach. A custom key is a real canonical field with a type and surfaces, so it works in the Task Editor, Task Creator, chips, and swimlanes, the same as a built-in field. An unmanaged property on a file task is not ignored, though: it can still surface on its own in Table and filters as a [[DOCS-115 File task property columns|file task property column]], just without those other surfaces.

**Can I use a custom key on inline tasks too?** Yes. It works as `{{key:: value}}` inline and as frontmatter in file tasks, the same as any field.

**What happens to my data if I delete the field?** Nothing is deleted from your files. The values remain as plain properties and become managed again if you recreate the key.

## Settings

Operon settings for this live in **Settings → Operon → Core → Custom Keys**, which creates and manages custom fields, their surfaces, usage, order, and delete behavior.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-115 File task property columns|File task property columns]]
