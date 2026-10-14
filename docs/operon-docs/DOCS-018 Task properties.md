---
Notes: Compare built-in canonical keys, Custom Keys, and Vault Properties, and understand Key Mapping
Icon: table-properties
Color: "#7c3aed"
Updated: 2026-10-13T16:29:41+02:00
---

# Task properties

A task property is one structured field on a task: its status, its due date, its priority, its parent. This page explains what a property *is* as a unit, so the syntax in [[DOCS-012 Inline task syntax|Inline task syntax]] and the renaming in [[DOCS-039 Key mappings|Key mappings]] make sense together. The same properties power an inline task and a file task; only where they are written differs.

## Canonical keys, Custom Keys, and Vault Properties

A task can carry all three groups together. They share Operon's persistent task index, while keeping their own meaning, type rules, and supported controls.

| Question | Built-in canonical keys | Custom Keys | Vault Properties |
|---|---|---|---|
| Where do they come from? | Operon's built-in task model | Fields you define in Core → Custom Keys | Additional properties stored on a task, without requiring a Custom Key |
| What are they for? | Status, priority, dates, relationships, recurrence, time tracking, and bookkeeping | Your own reusable fields with configured names, types, and surface preferences | Working with existing or template-supplied properties directly |
| What defines the type? | Operon's field definition | The Custom Key definition | A supported property type declared in Obsidian, with compatible inline interpretation where needed |
| How are they named? | A stable canonical key, plus a configurable visible name | A stable custom key, plus its visible name | The source property name |
| Where are values stored? | Inline fields or File Task frontmatter | Inline fields or File Task frontmatter | Inline fields or File Task frontmatter |
| Where can I use them? | The controls appropriate to each built-in field | Supported surfaces enabled for that field; availability depends on its type | Task Editor Additional, supported template fields in Task Creator, and main and embedded Tables; see the Vault Properties guide for surface limits |
| Are they in the persistent index? | Yes | Yes | Yes |

Here, **canonical key** means a field's stable internal identifier. Custom Keys also have canonical identifiers; “built-in canonical keys” distinguishes Operon's supplied fields from the ones you define.

Sharing the index means task data and Vault Properties can be restored together on subsequent launches. It does not make every field editable in every view, add chips automatically, or give a custom property the behavior of a built-in field. A Checkbox property such as `Reviewed` is a boolean; it does not complete a task like its task checkbox or status does.

See [[DOCS-040 Custom keys|Custom Keys]] for configured custom surfaces and [[DOCS-115 File task property columns|Vault Properties]] for native editing, types, filters, and read-only states.

## Key Mapping connects names; it is not another property type

[[DOCS-039 Key mappings|Key Mapping]] connects a stable field identifier to its visible property name. For example, mapping `priority` to `Importance` keeps the same priority field and behavior. An inline task still writes `{{priority:: A}}`; a File Task can write `Importance: A` in frontmatter.

This does not create a new property or turn an arbitrary Vault Property into a priority field. Use a Custom Key when you want a configured custom field; use Vault Properties when their supported native controls meet your needs. Mapping changes do not rewrite existing note content automatically.

## Choosing a property

- Use the **built-in field** when Operon already provides the meaning you need. Use `dateDue` for a task deadline rather than expecting an unrelated `ReviewDate` property to behave as a deadline.
- Use a **Custom Key** when you want an explicitly configured field and its supported surface preferences, such as a client field shown in selected chip surfaces.
- Use a **Vault Property** for additional data such as `Budget`, `Reviewed`, or `ReviewDate` that you want to manage directly in the supported task surfaces. It does not need a Custom Key just to appear in Additional or a Table.

For native editing, assign a supported type and keep values compatible with it. Automatic, conflicting, and unsupported values remain protected rather than being silently converted.

## Built-in field rules

Built-in fields have a canonical key, a visible name, a fixed type, and rules for copying or recomputing their values. The sync policy describes this distinction: `yes` fields are shared task data, `no` fields belong to one instance, and `auto` fields are recalculated by Operon. These rules do not automatically apply to every Vault Property.

Three built-in user-managed fields describe the task rather than its lifecycle: **Task Type** is a Text classification, **Task Image** is one media reference, and **Task Gallery** is an ordered List of media references. See [[DOCS-138 Task images and galleries|Task images and galleries]]. **Task Data Type** is different: it is a read-only Table helper reporting Inline or File, not a property to write to Markdown.

## Set fields versus managed fields

Not every property is yours to fill. Two groups behave very differently:

- **Fields you set**: status, priority, dates, contexts, assignees, parent, recurrence, reminders, icon, color, note, and your custom keys. You edit these directly or through the [[DOCS-021 Task Editor|Task Editor]].
- **Fields Operon manages**: identity, timestamps, progress, subtask counts, totals, dependency links, and tracker bookkeeping. You can read them, but you should not hand-edit them. The full split is listed in [[DOCS-012 Inline task syntax|Inline task syntax]].

One idea can be carried by more than one property. **Reminders** are the clearest example: there is no single reminder field, but two, `reminderDatetimes` for reminders at a fixed moment and `reminderRules` for reminders at an offset from one of the task's own dates. They are separate canonical keys with separate values, and a task can use either or both. See [[DOCS-116 Reminders|Reminders]].

## One task model, two storage forms

The point of the property model is that an inline task and a file task are the same record underneath. An inline task writes its properties as `{{key:: value}}` on the line; a file task writes them as frontmatter. Managed fields resolve to their canonical keys. Additional Vault Properties retain their source names and type rules; conversion support must be checked for the particular conversion flow rather than assumed for every possible YAML value. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

The same four properties, `status`, `priority`, `dateDue`, and `contexts`, written each way:

```md
- [ ] Prepare the board meeting {{operonId:: {{operonId}}}} {{status:: Project.Planned}} {{priority:: A}} {{dateDue:: 2026-07-01}} {{contexts:: [[Office]]}}
```

```yaml
---
operonId: {{operonId}}
Status: Project.Planned
Priority: A
dateDue: 2026-07-01
contexts:
  - "[[Office]]"
---
```

The canonical keys are the same on both; only the container differs. In the file task the visible property names can be renamed through [[DOCS-039 Key mappings|Key mappings]], while the inline line keeps the canonical keys.

## Settings

Operon settings for this live in two places under **Settings → Operon → Core**: **Key Mappings → Task Property Mapping** lets you edit visible property names and icons while displaying each field's fixed type. **Custom Keys** creates and manages your own canonical fields; you choose a custom field's type when creating it.

Vault Properties use Obsidian’s property type declarations and the supported task controls; they do not require a Custom Key entry. See [[DOCS-115 File task property columns|Vault Properties]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-115 File task property columns|Vault Properties]]
- [[DOCS-116 Reminders|Reminders]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
