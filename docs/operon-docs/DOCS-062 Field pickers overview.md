---
Up:
  - "[[DOCS-021 Task Editor|Task Editor]]"
  - "[[DOCS-020 Task Creator|Task Creator]]"
  - "[[DOCS-018 Task properties|Task properties]]"
Notes: How the Task Creator and Editor open the right picker for each field
Icon: mouse-pointer-click
Color: "#db2777"
tags:
  - operon
  - pickers
  - taskcreator
  - taskeditor
Updated: 2026-06-25T16:47:21
---

# Field pickers overview

When you set a field in the [[DOCS-020 Task Creator|Task Creator]] or [[DOCS-021 Task Editor|Task Editor]], you do not type a raw value. Operon opens a **picker**: a small control sized to that field. A date opens a calendar, a status opens your pipeline's stages, a color opens a palette. This page is how Operon chooses which picker to open, and where each picker is documented in full.

## How Operon picks the picker

Two things decide which picker opens:

- **The field.** Built-in fields each have a purpose-built picker. `status` opens the status picker, `dateDue` opens the date picker, `repeat` opens the recurrence picker, and so on. These are the **specialized** pickers.
- **The type.** A field you defined yourself, a [[DOCS-040 Custom keys|custom key]], has no purpose-built picker, so Operon opens the **general** picker that matches its **property type**: a `date` custom key opens the date picker, a `list` custom key opens the list picker. See [[DOCS-070 Custom field pickers|Custom field pickers]].

So a built-in field is matched by name, and a custom field by its type. Every picker still reads and writes the same Markdown field underneath. See [[DOCS-018 Task properties|Task properties]] for what a property type is.

## Specialized pickers and where they live

Each built-in field opens a picker built for it. The property type is noted so you know what kind of value it writes.

| Field | Property type | Picker | Page |
|---|---|---|---|
| `dateDue`, `dateScheduled`, `dateStarted`, `dateCompleted`, `dateCancelled` | Date | Date picker | [[DOCS-063 Date and time picker\|Date and time picker]] |
| `datetimeStart`, `datetimeEnd`, `datetimeRepeatEnd` | Date & time | Date and time picker | [[DOCS-063 Date and time picker\|Date and time picker]] |
| `repeat` | Text | Recurrence picker | [[DOCS-064 Recurrence picker\|Recurrence picker]] |
| `status` | Text | Status picker | [[DOCS-065 Status and priority picker\|Status and priority picker]] |
| `priority` | Text | Priority picker | [[DOCS-065 Status and priority picker\|Status and priority picker]] |
| `taskIcon` | Text | Icon picker | [[DOCS-066 Icon picker\|Icon picker]] |
| `taskColor` | Text | Color picker | [[DOCS-067 Color picker\|Color picker]] |
| `location` | Text | Location picker | [[DOCS-068 Location picker\|Location picker]] |
| `parentTask`, `blocking`, `blockedBy`, `related` | Text and List | Task link pickers | [[DOCS-069 Task link and list pickers\|Task link and list pickers]] |
| `assignees`, `contexts`, `tags`, `links` | List | List pickers | [[DOCS-069 Task link and list pickers\|Task link and list pickers]] |
| `estimate` | Number | Estimate picker | [[DOCS-069 Task link and list pickers\|Task link and list pickers]] |


## General pickers for custom keys

A custom key opens a picker by its type, not its name. Five types are surfaced:

| Property type | Picker behavior |
|---|---|
| Text | Free text, with suggestions from values already used. |
| Number | A numeric entry. |
| Date | The same date picker the built-in dates use. |
| Date & time | The same date and time picker. |
| List | A list picker for multiple values. |

A `checkbox` custom key is stored but does not get a picker surface yet. The full detail is in [[DOCS-070 Custom field pickers|Custom field pickers]].

## Why this matters

Knowing the field-to-picker rule explains the whole editing experience: why a custom `date` key behaves exactly like a built-in due date, why a `list` key lets you add several values, and why setting a type on a custom key decides how you will fill it. Choose a custom key's type with the picker you want in mind. See [[DOCS-040 Custom keys|Custom keys]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-094 How to create a task with Task Creator|How to create a task with Task Creator]]
