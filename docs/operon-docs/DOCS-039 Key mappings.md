---
Notes: Rename property names without changing what a field means
Icon: key-round
Color: "#ca8a04"
Updated: 2026-10-01T14:06:16+02:00
---

# Key mappings

A key mapping is the link between what Operon calls a field internally and what the property is named in your file-task frontmatter. The internal name (the **canonical key**) never changes, so the meaning stays stable everywhere. The **visible name** is yours to set, so your file tasks read the way your vault already does. This is what lets `priority` show up as `Tier`, or `note` as `Notes`, without Operon ever losing track of the field.

> **MEDIA-DOCS-039-1:** The Keymapping settings listing canonical fields beside their visible property names.

![MEDIA-DOCS-039-1 - The Keymapping settings listing canonical fields beside their visible property names](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-039-1.png)

## The two names of every field

Each field has two names that do different jobs:

- **Canonical key**: the fixed internal name, such as `status`, `dateDue`, or `contexts`. Operon uses it across the index, filters, Calendar, Kanban, recurrence, and the editor, and it is also the key Operon writes inside an inline task's `{{key:: value}}`. You never see it change.
- **Visible name**: the property name written in a file task's frontmatter, and the label Operon shows for the field in its UI, such as the editor and chips.

Renaming the visible name does not touch the canonical key, so nothing downstream breaks. See [[DOCS-018 Task properties|Task properties]].

## Where each name applies

A key mapping renames the **file-task frontmatter** property and the field's **label** in Operon's UI. It does not rename the token inside an inline task: Operon writes inline fields with the stable canonical key.

```md
- [ ] Draft notes {{operonId:: {{operonId}}}} {{priority:: A}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
```

The `{{datetime}}` variable stamps the creation moment on paste, and Operon maintains `datetimeModified` for you afterward. See [[DOCS-061 operonId template variables|operonId template variables]].

The same task as a file task, where the visible name `Tier` stands in for the canonical `priority`:

```yaml
---
Tier: A
---
```

Both lines store the same canonical `priority` field. The file task shows it under the visible name `Tier`, while the inline task keeps the canonical key `priority`. So a visible-name change touches file tasks and UI labels and leaves inline tasks alone. See [[DOCS-012 Inline task syntax|Inline task syntax]].

## What a mapping holds

For each field, the mapping records:

- The **canonical key** (fixed).
- The **visible property name** (editable).
- The **property type**, displayed beside the canonical key: Text, Number, Date, Date & time, List, or Checkbox. It determines how the field is handled; it is not editable in this row.
- An optional **icon** for the field.
- A **Hide** toggle that hides the property from the rendered file-task metadata view. The value remains saved in YAML; this is not an inline-field visibility setting.

Operon has a built-in set of canonical fields covering the whole task model. You can edit their visible names and icons, but you do not change their types, create them, or delete them here. The `operonId` property name is protected and cannot be renamed. To add a field of your own, see [[DOCS-040 Custom keys|Custom keys]].

## The reminder fields and name collisions

Most canonical fields default to a visible name that matches their canonical key. The two reminder fields are the exception worth knowing about, because they arrived after many vaults were already set up:

- `reminderDatetimes` defaults to the visible name **ReminderDatetimes**.
- `reminderRules` defaults to the visible name **ReminderRules**.

Since visible names must be unique, Operon has to handle the case where one of those names is already taken. Two different collisions are possible, and they resolve differently.

**Another field already uses the name.** Operon gives the reminder field a prefixed name instead, **OperonReminderDatetimes** or **OperonReminderRules**, adding a number if that is taken too. Your existing field keeps its name untouched. This is the only reason you would see an `Operon`-prefixed property in your frontmatter, and you can rename it afterwards like any other visible name.

**A custom key already owns the canonical key itself**, because you had created your own `reminderDatetimes` or `reminderRules` field before Operon reserved those names. Here Operon does not take the name over. Your custom field stays authoritative and keeps behaving exactly as it did, and the built-in reminder feature simply does not activate for it: no reminder picker, and nothing you stored in it is ever read as a reminder or scheduled as a notification. Reading arbitrary existing values as reminder data would be the unsafe move, so Operon declines to guess. To use built-in reminders, rename or remove that custom key first, and Operon adds the system field on the next load. See [[DOCS-040 Custom keys|Custom keys]] and [[DOCS-116 Reminders|Reminders]].

## Field icon

Each field can carry an optional **icon**, chosen from Lucide. Surfaces that use the field’s key mapping share this icon, so you can configure it centrally rather than surface by surface. Leaving it blank does not guarantee an iconless field: some surfaces, including Task Creator and Task Editor controls, use a fallback icon when no mapping icon is set.

## Renaming a field later

You can rename a visible property name at any time, but when you do it matters. A rename changes how Operon writes and reads the field **from that point on**. It does **not** rewrite the property name in tasks you already created.

- The **canonical key never changes**, so views, filters, Calendar, Kanban, automation, and recurrence keep working without interruption. They track the field by its canonical key, not its visible name.
- **Inline tasks are unaffected**, because they store the canonical key directly in `{{key:: value}}`, and that key never changes.
- **File tasks** written with the old frontmatter name keep it until you update them. Operon no longer matches that old property to the field, since the mapping now points at the new name.

The safe path is to set your names **early**, before you create many tasks, which is why this is part of the [[DOCS-008 Essential settings to configure first|essential settings]]. If you must rename after file tasks already exist, plan to update their frontmatter to the new property name, since Operon does not rewrite them for a visible-name change.

**Tip: let Obsidian rename the property for file tasks.** Obsidian can rename a frontmatter property across your whole vault. In the Properties view, right-click the old property name and choose **Rename property**, then enter the new name. Every file task's frontmatter updates to the new name in one step, lining them up with the new mapping. This is exactly what a key-mapping rename affects, so it brings your file tasks back in line. Inline tasks need nothing, since they already store the canonical key.

## Why this matters

If you already have a property naming style in your vault, key mappings let Operon adopt it instead of forcing its own. Set them early, ideally before you create many file tasks, so every file task is written with the names you want from the start. They are part of the [[DOCS-008 Essential settings to configure first|essential settings]] for this reason.

## FAQ

**Will renaming a property rewrite my existing tasks?** No. A visible-name change applies to how Operon reads and writes the field going forward; tasks already written keep the old name until you update them. Align your naming early. See "Renaming a field later" above.

**Does the visible name affect inline tasks?** No. Operon writes inline fields with the canonical key, so a visible-name change affects file-task frontmatter and UI labels, not the `{{key:: value}}` tokens in your notes.

**Can two fields share a visible name?** No. Each visible property name must be unique, so a value never points at two fields.

**Why is a property called `OperonReminderDatetimes`?** The plain name was already taken by another field, so the reminder field took a prefixed one. Rename it if you prefer something else. See "The reminder fields and name collisions" above.

**I already had my own `reminderRules` field. Did Operon take it over?** No. Your custom key stays as it is, and built-in reminders stay inactive for it until you rename or remove it.

## Settings

Operon settings for this live in **Settings → Operon → Core → Key Mappings → Task Property Mapping**, which maps Operon fields to visible property names while keeping the canonical keys stable.

Each property has one Settings search result that opens and highlights its own row. See [[DOCS-043 Settings search|Settings search]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-040 Custom keys|Custom keys]]
- [[DOCS-116 Reminders|Reminders]]
