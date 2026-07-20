---
Up:
  - "[[DOCS-039 Key mappings|Key mappings]]"
  - "[[DOCS-015 Task identity and operonId|Task identity and operonId]]"
  - "[[DOCS-040 Custom keys|Custom keys]]"
Notes: Complete reference for inline task field syntax and property types, with copy-paste ready examples
Icon: braces
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - inlinetask
  - taskproperties
Updated: 2026-07-20T15:36:13
---

# Inline task syntax

This page is the complete reference for how an inline Operon task is written in Markdown, what every field means, and what type each field has. You rarely need to type this by hand, since the [[DOCS-020 Task Creator|Task Creator]] and [[DOCS-021 Task Editor|Task Editor]] build it for you, but this page lets you read any task line, understand a field you did not set, and edit safely.

## The shape

An inline task is a Markdown checkbox, then the readable text, then any number of `{{key:: value}}` fields:

```md
- [ ] Draft release notes {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{priority:: A}} {{dateScheduled:: 2026-05-20}} {{dateDue:: 2026-05-31}}
```

- The checkbox shows completion state: `- [ ]` open and `- [x]` done. Operon also tracks a cancelled state.
- The text is plain Markdown. Normal `#tags` and `[[wikilinks]]` stay as themselves.
- Each field is one `{{key:: value}}` container. Order is flexible, but Operon writes them in a consistent canonical order.

The **minimum** valid inline task is just the first two parts plus identity: a checkbox, some readable text, and an `operonId`. Every other field is optional, so the shortest real task is simply:

```md
- [ ] Buy milk {{operonId:: {{operonId}}}}
```

Operon reads its own fields only inside the `{{key:: value}}` container. That container is specific to Operon: it is not Dataview's `[key:: value]` inline field, and it is not an emoji-based task syntax. When Operon imports or converts a task written in another format, it translates the data into this `{{key:: value}}` form so the rest of Operon can read it.

Here `{{operonId}}` is a **template variable**, not part of the field syntax itself. What replaces it with a fresh, unique id is Operon, acting through one of its flows: the [[DOCS-020 Task Creator|Task Creator]], templates, conversions, the insertion commands, and the normalization that runs while you live-edit a note. So pasting the line into a note as a real line does resolve it; you never type an id by hand. Text shown inside a code block is never resolved, which is exactly why every copyable example on this page can display the variable safely. See [[DOCS-061 operonId template variables|operonId template variables]].

The field names below are the **canonical** names, and they are exactly what Operon writes in an inline task's `{{key:: value}}`. Operon normalizes only the fields it manages to these canonical names; any custom key of your own is preserved exactly as you wrote it. In a **file task**, the same managed fields can appear under renamed frontmatter property names through [[DOCS-039 Key mappings|Key mappings]], and you can add fields of your own with [[DOCS-040 Custom keys|Custom keys]]. The meaning stays the same everywhere the field appears.

## Property types

Every field has a **property type** that tells Operon how to store, validate, and display its value, and which editor or picker to show. There are six types, plus Obsidian's automatic detection:

| Type | Holds | Example |
|---|---|---|
| **Text** | free text | `Project.InProgress`, `flag` |
| **Number** | a numeric value | `3600` |
| **Date** | a calendar day, `YYYY-MM-DD` | `2026-05-20` |
| **Date & time** | a day and time, `YYYY-MM-DDTHH:MM:SS` | `2026-05-20T09:00:00` |
| **List** | one or more values | `[[Me]]`, `[[Home]]` |
| **Checkbox** | a true/false value (mainly for custom fields) | `true` |
| **Automatic** | Obsidian guesses the type | (auto) |

The type matters in two places:

- **In a file task**, fields live in frontmatter, where Obsidian shows a property type for each property. You can see and change it by right-clicking a property and choosing **Property type**. Operon's [[DOCS-039 Key mappings|Key mappings]] already assign the correct type to every canonical field, so you normally never set it to **Automatic** by hand.
- **In an inline task**, the same type governs how the `{{key:: value}}` is parsed and validated, and which picker the [[DOCS-021 Task Editor|Task Editor]] shows for it.

When you create a [[DOCS-040 Custom keys|custom key]], you pick its type from this same list.

## Fields you set

These are the fields you choose and edit, directly or through the Task Creator and Task Editor.

| Field | Type | What it is | Example |
|---|---|---|---|
| `status` | Text | Workflow stage, in `Pipeline.Status` form. | `Project.InProgress` |
| `priority` | Text | Importance, one letter from S (highest) to F (lowest). | `A` |
| `dateDue` | Date | Deadline. | `2026-05-31` |
| `dateScheduled` | Date | When you plan to work on it. | `2026-05-20` |
| `dateStarted` | Date | Earliest date it can begin. | `2026-05-18` |
| `dateCompleted` | Date | When it was completed (set when you finish it). | `2026-05-30` |
| `dateCancelled` | Date | When it was cancelled (set when you cancel it). | `2026-05-29` |
| `datetimeStart` | Date & time | Start of a timed block on the Calendar. | `2026-05-20T09:00:00` |
| `datetimeEnd` | Date & time | End of that timed block. | `2026-05-20T10:30:00` |
| `estimate` | Number | Expected time to do it, in seconds. | `3600` |
| `duration` | Number | Time actually spent, in seconds (usually filled by the timer). | `5400` |
| `repeat` | Text | Recurrence rule, written as `key=value` pairs. See [[DOCS-033 Recurring tasks\|Recurring tasks]]. | `mode=schedule\|freq=week\|interval=1` |
| `datetimeRepeatEnd` | Date & time | When recurrence stops. | `2026-12-31T00:00:00` |
| `reminderDatetimes` | List | Reminders at fixed moments. See [[DOCS-116 Reminders\|Reminders]]. | `2026-05-30T09:00:00` |
| `reminderRules` | List | Reminders at an offset from one of the task's dates. See [[DOCS-117 Reminder rules\|Reminder rules]]. | `dateDue.1d` |
| `parentTask` | Text | The `operonId` of the parent task. See [[DOCS-016 Parent and sub-tasks\|Parent and sub-tasks]]. | `xyz9876` |
| `assignees` | List | Who does the work. | `[[Me]]` |
| `contexts` | List | Environment or condition. | `[[Home]]` |
| `taskIcon` | Text | Icon name (Lucide). | `flag` |
| `taskColor` | Text | Hex color, without the `#`. | `4987a7` |
| `note` | Text | A short annotation. | `waiting on review` |
| `location` | Text | Coordinates as latitude, longitude. See [[DOCS-041 Task chips display and behavior\|Task chips]]. | `52.52, 13.40` |
| `links` | List | External web links. | `https://example.com` |

## Fields Operon manages for you

You will sometimes see fields on a task that you never set. That is normal. Operon maintains these in the background to keep tasks connected, counted, and accurate. **You can read them, but you should not hand-edit them.** If you see one of these, this is what it is:

| Field | Type | What it is |
|---|---|---|
| `operonId` | Text | The task's durable identity (7-char). Operon generates it; do not edit or copy it. See [[DOCS-015 Task identity and operonId\|Task identity and operonId]]. |
| `datetimeCreated` | Date & time | When this task instance was created. |
| `datetimeModified` | Date & time | When the task was last changed (updated automatically). |
| `progress` | Number | Completion percentage from 0 to 100. For a parent, it reflects how far its subtasks are done. |
| `directSubtaskCount` | Number | Number of direct subtasks. |
| `directDoneSubtaskCount` | Number | Direct subtasks that are done. |
| `directOpenSubtaskCount` | Number | Direct subtasks that are still open. |
| `treeDescendantCount` | Number | All subtasks beneath this one, at every level. |
| `treeDoneDescendantCount` | Number | Of those, how many are done. |
| `treeOpenDescendantCount` | Number | Of those, how many are open. |
| `totalEstimate` | Number | This task's estimate plus all of its subtasks', in seconds. |
| `totalDuration` | Number | This task's tracked time plus all of its subtasks', in seconds. |
| `blocking` | List | The `operonId`s of tasks this one is blocking (a dependency link). |
| `blockedBy` | List | The `operonId`s of tasks blocking this one. |
| `trackers` | List | Your completed time-tracking sessions, as time ranges. See [[DOCS-034 Time tracking\|Time tracking]]. |
| `activeTracker` | Date & time | The start time of a timer that is currently running. |
| `repeatSeriesId` | Text | Links a single occurrence to its recurring series. |
| `repeatOccurrenceDate` | Date | The recurrence slot date for a generated occurrence. |
| `timezone` | Text | The task's timezone, when one applies. |
| `related` | List | Related notes and references, managed through the editor. |

The last several (`repeatSeriesId`, `repeatOccurrenceDate`, `timezone`, `activeTracker`, `related`) are internal bookkeeping. They are stored in your Markdown so the file stays self-contained, but they are not meant to be edited by hand and are normally hidden from the field-management UI.

## Values at a glance

- **Status** uses `Pipeline.Status`, so both the pipeline and the stage are visible. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].
- **Priority** is a single letter from S (highest) to F (lowest). See [[DOCS-038 Task priorities|Task priorities]].
- **Dates** use `YYYY-MM-DD`. **Datetimes** use `YYYY-MM-DDTHH:MM:SS` in local time.
- **Reminders** come in two forms: `reminderDatetimes` holds local datetimes, and `reminderRules` holds a reference date and an offset joined by a dot, such as `dateDue.1d`. See [[DOCS-117 Reminder rules|Reminder rules]].
- **Time fields** (`estimate`, `duration`, and the totals) are stored in seconds, but you normally set them through the Task Editor rather than typing seconds.
- **List fields** (`assignees`, `contexts`, `links`, `blocking`, `blockedBy`) hold one or more values separated by a semicolon and a space (`; `). To keep a literal semicolon inside a single value, escape it as `\;`.
- **Task links** (`parentTask`, `blocking`, `blockedBy`) reference other tasks by their `operonId`, not by title or path.

## Copy-paste ready examples

Each block below is ready to paste into a note. The `{{operonId}}` template variables become real, unique ids the moment Operon sees the pasted lines, and a shared suffix such as `{{operonId1}}` links a child to its parent. None of these ids needs to be typed or invented. See [[DOCS-061 operonId template variables|operonId template variables]].

A minimal task, just words and an id:

```md
- [ ] Buy milk {{operonId:: {{operonId}}}}
```

A typical task with a status, priority, and due date:

```md
- [ ] Review launch checklist {{operonId:: {{operonId}}}} {{status:: Project.InProgress}} {{priority:: A}} {{dateDue:: 2026-05-31}}
```

A pasted snippet that lets Operon fill the default status, default priority, current date, and current datetime:

```md
- [ ] Follow up with reviewer {{operonId:: {{operonId}}}} {{status:: {{status}}}} {{priority:: {{priority}}}} {{dateScheduled:: {{date}}}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
```

If your default status is `Project.Brainstorming`, your default priority is `High`, and the snippet is resolved at `2026-06-27T13:46:10`, the task becomes:

```md
- [ ] Follow up with reviewer {{operonId:: a1b2c3d}} {{status:: Project.Brainstorming}} {{priority:: High}} {{dateScheduled:: 2026-06-27}} {{datetimeCreated:: 2026-06-27T13:46:10}} {{datetimeModified:: 2026-06-27T13:46:10}}
```

Your real output uses your current Operon defaults and local time. See [[DOCS-061 operonId template variables|operonId template variables]] for the full variable list and the difference between raw pasted inline snippets and file task templates.

A task with tags and a context, which stay as ordinary Markdown:

```md
- [ ] Email the supplier #work #procurement {{operonId:: {{operonId}}}} {{contexts:: [[Office]]}} {{dateScheduled:: 2026-05-20}}
```

A task with several values in its list fields, separated by `; `:

```md
- [ ] Run the planning workshop {{operonId:: {{operonId}}}} {{assignees:: [[Me]]; [[Sam]]}} {{contexts:: [[Office]]; [[Errands]]}} {{dateDue:: 2026-05-31}}
```

A parent task with two subtasks, wired by a shared id. The parent takes `{{operonId1}}`, and each child points its `parentTask` at that same suffix:

```md
- [ ] Plan the launch {{operonId:: {{operonId1}}}} {{status:: Project.InProgress}} {{priority:: B}}
    - [ ] Draft the announcement {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}} {{dateDue:: 2026-05-28}}
    - [ ] Schedule the email {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}} {{dateScheduled:: 2026-05-29}}
```

A small recurring task that repeats every week:

```md
- [ ] Weekly review {{operonId:: {{operonId}}}} {{status:: Project.Planned}} {{repeat:: mode=schedule|freq=week|interval=1}}
```

## Let Operon write it

The safest way to produce correct syntax is to let Operon do it: create with the [[DOCS-020 Task Creator|Task Creator]], edit with the [[DOCS-021 Task Editor|Task Editor]], and convert with Operon commands. Hand-editing the text is fine; just be careful with `operonId`, which is the field that tells Operon which task it is looking at. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

A quick rule of thumb for what is safe to touch by hand:

- **Safe to edit directly:** the readable text, `#tags`, and simple values such as `status`, `priority`, `dateDue`, `dateScheduled`, and `note`.
- **Let the Task Editor handle:** `operonId`, `parentTask`, `blocking` and `blockedBy`, `repeat`, and every field in the *Fields Operon manages for you* table above. These carry identity, task links, recurrence, and bookkeeping that has to stay consistent across the whole vault.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-013 File tasks|File tasks]]
- [[DOCS-018 Task properties|Task properties]]
- [[DOCS-117 Reminder rules|Reminder rules]]
