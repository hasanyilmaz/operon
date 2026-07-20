---
Up:
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
  - "[[DOCS-039 Key mappings|Key mappings]]"
  - "[[DOCS-040 Custom keys|Custom keys]]"
Notes: What a task property is, the four traits every property has, and the same fields shown both ways
Icon: table-properties
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - taskproperties
Updated: 2026-07-20T15:10:53
---

# Task properties

A task property is one structured field on a task: its status, its due date, its priority, its parent. This page explains what a property *is* as a unit, so the syntax in [[DOCS-012 Inline task syntax|Inline task syntax]] and the renaming in [[DOCS-039 Key mappings|Key mappings]] make sense together. The same properties power an inline task and a file task; only where they are written differs.

## Four traits of every property

Each property is defined by four things:

- **Canonical key**: the stable internal name Operon uses everywhere, such as `status` or `dateDue`. This never changes, so the meaning is constant across every surface.
- **Visible name**: the property name written in a file task's frontmatter, and the field's label in Operon's UI. It can be renamed without changing the canonical key, which is what [[DOCS-039 Key mappings|Key mappings]] does. For example, a vault can show `priority` as `Tier`. Inline tasks still write the canonical key in `{{key:: value}}`.
- **Type**: how the value is stored and edited. There are six: **Text**, **Number**, **Date**, **Date & time**, **List**, and **Checkbox**. The type decides which picker the [[DOCS-021 Task Editor|Task Editor]] shows and how the value is validated.
- **Sync policy**: whether the value carries across forms and occurrences. `yes` fields are shared task data; `no` fields belong to one instance and are not copied (for example `datetimeCreated`); `auto` fields are recomputed by Operon.

## System and custom properties

Properties come from two places:

- **System properties** are built in. They cover the whole task model: identity, status, priority, dates, scheduling, parent and dependency links, recurrence, time tracking, and the automatic rollup counts. You use and rename them, but you do not create or delete them.
- **Custom properties** are ones you define when the built-in set is not enough. A custom property is a real canonical key with its own type and behavior, not just a loose YAML field. See [[DOCS-040 Custom keys|Custom keys]].

A third case sits outside this model entirely: a frontmatter property on a file task that is neither of the above, no canonical key, no sync policy. Operon still discovers it and offers it as a typed Table column or filter condition, but only there; it has none of the four traits above, and none of the Task Editor, Task Creator, chip, or swimlane reach a real property gets. See [[DOCS-115 File task property columns|File task property columns]].

## Set fields versus managed fields

Not every property is yours to fill. Two groups behave very differently:

- **Fields you set**: status, priority, dates, contexts, assignees, parent, recurrence, reminders, icon, color, note, and your custom keys. You edit these directly or through the [[DOCS-021 Task Editor|Task Editor]].
- **Fields Operon manages**: identity, timestamps, progress, subtask counts, totals, dependency links, and tracker bookkeeping. You can read them, but you should not hand-edit them. The full split is listed in [[DOCS-012 Inline task syntax|Inline task syntax]].

One idea can be carried by more than one property. **Reminders** are the clearest example: there is no single reminder field, but two, `reminderDatetimes` for reminders at a fixed moment and `reminderRules` for reminders at an offset from one of the task's own dates. They are separate canonical keys with separate values, and a task can use either or both. See [[DOCS-116 Reminders|Reminders]].

## One model, two surfaces

The point of the property model is that an inline task and a file task are the same record underneath. An inline task writes its properties as `{{key:: value}}` on the line; a file task writes them as frontmatter. Because both resolve to the same canonical keys, a task keeps its full meaning when it converts from one form to the other. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

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

Operon settings for this live in two places under **Settings → Operon → Core**: **Keymapping** sets each property's visible name and type, and **Custom Keys** creates and manages your own canonical fields.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-115 File task property columns|File task property columns]]
- [[DOCS-116 Reminders|Reminders]]
