---
Up:
  - "[[DOCS-078 Welcome - coming from TaskNotes|Coming from TaskNotes]]"
  - "[[DOCS-039 Key mappings|Key mappings]]"
  - "[[DOCS-082 Bulk convert a folder into file tasks|Bulk convert a folder into file tasks]]"
Notes: Step-by-step procedure to bring TaskNotes tasks into Operon, with a before and after example
Icon: move-right
Color: "#2563eb"
tags:
  - operon
  - migration
  - migrate
  - tasknotes
  - howto
Updated: 2026-06-25T16:47:21
---

# How to migrate from TaskNotes

There is no one-click TaskNotes importer, but there is a reliable path made from Operon's own features. The idea is to teach Operon your existing property names, adopt your existing notes as file tasks in bulk, and make sure new notes are Operon-ready. Work through these steps in order. For orientation first, see [[DOCS-078 Welcome - coming from TaskNotes|Coming from TaskNotes]].

> **MEDIA-DOCS-093-1:** The four steps: map fields, add custom keys, scan a folder, add operonId to templates.

![MEDIA-DOCS-093-1 - The four steps: map fields, add custom keys, scan a folder, add operonId to templates](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-093-1.png)

## Step 1: Map your fields with Key Mappings

This is the heart of the move. In **Settings → Operon → Core → Keymapping**, each Operon canonical key has a **Property** area. Write your TaskNotes property name there, and Operon will read and write that property instead of its default name.

For example, if TaskNotes stores a deadline in a `due` property, set the Property area of Operon's `dateDue` key to `due`. From then on:

- **File tasks** use your property name (`due`) in frontmatter, matching your existing notes.
- **Inline tasks** use the canonical key (`dateDue`) on the line.

Both resolve to the same field, so the two stay in sync. One rule matters: the **value type must match**. A date property should map to a date key, a list property to a list key. See [[DOCS-039 Key mappings|Key mappings]] for how mappings behave.

Concretely, suppose an existing note carries a `due` property:

```yaml
---
title: Draft release notes
due: 2026-05-31
---
```

After you map `due` to `dateDue` (Step 1) and adopt the note in the scan (Step 3), Operon keeps every value and only adds what it needs:

```yaml
---
title: Draft release notes
due: 2026-05-31
operonId: {{operonId}}
---
```

Your `due` value is untouched, and Operon now reads it as the task's due date. The new `operonId` is a real id Operon generates during the scan, shown here as the template variable. Operon also adds a mapped modified-time property. Nothing in your note is rewritten or removed.

Two mappings need extra care, for reasons covered under conflicts below: do not map **status** onto a property another plugin also writes, and remember that Operon stores **time** in seconds. Map only **flat** properties; a nested property has no Operon field type.

## Step 2: Add Custom Keys for the rest

Some TaskNotes properties will not have a built-in Operon equivalent. For those, add a **Custom Key** with the same property name and the matching type, so Operon carries that data too instead of ignoring it. See [[DOCS-040 Custom keys|Custom keys]].

Do this before the scan, so that when your notes are adopted, every property you care about already has a home.

## Step 3: Adopt your notes with a folder scan

Now bring your existing TaskNotes notes in as Operon file tasks, in bulk, without rewriting them. In **Settings → Operon → Tasks → File Tasks**, open **Convert notes**.

1. Choose a **match rule**: a folder, a tag, or a frontmatter property with an exact value. For TaskNotes, the rule that targets your task notes precisely is usually the **folder** they live in or a **property** they all carry.
2. Click **Scan vault**. Operon reports how many files match, how many can be converted, how many already are file tasks, and how many sit in excluded folders.
3. Review the eligible files, then click **Convert Files**.

The confirmation tells you what happens: Operon **adds an `operonId` and the mapped modified-time property while preserving your existing frontmatter values**. Your notes keep their content and properties; they simply become Operon file tasks. The detailed reference for this tool is [[DOCS-082 Bulk convert a folder into file tasks|Bulk convert a folder into file tasks]].

> **MEDIA-DOCS-093-2:** The Convert notes panel after a scan, showing matched files ready to convert.

![MEDIA-DOCS-093-2 - The Convert notes panel after a scan, showing matched files ready to convert](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-093-2.png)

## Step 4: Make new notes Operon-ready

If you create TaskNotes-style notes from a template, add an **`operonId` to that template** so each new note is a valid Operon task from the moment it is created, with no extra step. The template-variable approach is covered in [[DOCS-061 operonId template variables|operonId template variables]].

This closes the loop: old notes are adopted by the scan, and new notes are born Operon-ready.

## After you migrate

Your former TaskNotes tasks now behave like any Operon file task. They appear in the [[DOCS-025 Filter View|Filter View]], on the [[DOCS-028 Calendar overview|Calendar]], and on the [[DOCS-030 Kanban overview|Kanban]], next to any inline tasks you create. If something does not show up, the usual cause is the index, not a lost note; see [[DOCS-054 Missing tasks|Missing tasks]].

## Running both at once: conflicts to know

You can keep TaskNotes installed while you move, but the two systems overlap in places, so a few things can clash. These are why running both is best treated as a temporary bridge rather than a permanent setup. The safe pattern is to let one system own status and time, map only flat properties, and convert each note once.

- **Two file-task overlays.** Operon draws its own File Task Overlay on a note it treats as a file task. If another plugin also decorates the same note, both overlays can appear on it. Let one system manage a given note.
- **Different status systems.** Operon moves tasks through a pipeline of statuses, like `Project.InProgress`, which is not the same set another plugin uses. Do not map Operon's `status` onto a status property another plugin also writes, or the two will overwrite each other. Keep status owned by one system. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].
- **Time is in seconds.** Operon stores `estimate` and `duration` in seconds, not minutes. A tool that uses a different unit would misread the same raw value, so do not share a single duration or estimate property between systems. See [[DOCS-034 Time tracking|Time tracking]].
- **Flat properties only.** Operon's fields use Obsidian's own property types: text, number, date, date and time, list, and checkbox. A nested or structured property has no Operon field type, so map only flat properties and move nested data into separate flat keys. See [[DOCS-040 Custom keys|Custom keys]].
- **Similar tools, not shared.** Operon has its own [[DOCS-026 Dynamic file task filter|Dynamic file task filter]]; a comparable feature in another plugin is separate, not a shared view. This is a difference to expect, not a conflict.

The one constant is that an Operon task always has an `operonId`, so this remains interoperability rather than a frictionless import. Plan the mapping once, respect the points above, and the rest is repeatable.

## FAQ

**Will the scan change my note content?** It adds an `operonId` and the mapped modified-time property, and preserves your existing frontmatter and body.

**What if a property has no Operon field?** Add a Custom Key for it before scanning, so the data is kept.

**Do I have to convert every note at once?** No. Scan by folder, tag, or property, and convert in batches whenever you are ready.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-080 FAQ for TaskNotes users|FAQ for TaskNotes users]]
