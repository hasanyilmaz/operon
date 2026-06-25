---
Up:
  - "[[DOCS-024 Task templates|Task templates]]"
  - "[[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]]"
  - "[[DOCS-015 Task identity and operonId|Task identity and operonId]]"
Notes: Mint ids and fill task/date values inside templates
Icon: braces
Color: "#059669"
tags:
  - operon
  - operonid
  - templates
  - automation
Updated: 2026-06-25T16:47:21
---

# Template variables

When a template builds a task, every task in it needs a real `operonId`, and the template often needs the task's dates, note, or title in more than one place. Operon solves this with `{{...}}` template variables: special tokens you write in a [[DOCS-024 Task templates|template]] that Operon turns into real values when it creates the task.

## Identity variables

There are two `operonId` forms, and the difference is everything:

- **`{{operonId}}`** (no suffix): a **fresh, unique id every time it appears**. Use it wherever a task just needs its own identity.
- **`{{operonId1}}`** (a one-character suffix): a **shared id**. The first time a given suffix appears, Operon mints a new id and remembers it; every later use of that **same** suffix returns the **same** id. Use it when one id must show up in more than one place.

The suffix is exactly one character, a letter or a digit, so `{{operonId1}}`, `{{operonId2}}`, and `{{operonIda}}` are three different shared ids. Reusing a suffix is how you make two lines talk about the same task.

## Task value variables

These variables fill values from the task being created:

| Variable | Value |
| --- | --- |
| `{{date}}` | the local creation date, as `YYYY-MM-DD` |
| `{{datetime}}` | the local creation datetime, as `YYYY-MM-DDTHH:mm:ss` |
| `{{taskDescription}}` | the task's description/title |
| `{{note}}` | the task's `note` field |
| `{{dateStarted}}` | the task's start date, or blank |
| `{{dateScheduled}}` | the task's scheduled date, or blank |
| `{{dateDue}}` | the task's due date, or blank |

There are no aliases for these names. If a value is not available, Operon writes an empty value rather than leaving the variable behind.

## Where variables resolve

Operon replaces variables when it generates a task from a template:

- In a file task's **frontmatter**.
- In a file task template's **body text**, outside fenced code blocks.
- In **task lines** in the body.

The seven task value variables can appear in normal template prose, such as a heading or a short context block. `operonId` is stricter: it resolves in frontmatter and task lines, but not in ordinary prose. `{{date}}` and `{{datetime}}` also resolve in raw pasted task lines, so quick inline snippets can stamp today's local date/time without a full file template. Fenced code blocks keep the literal token text so examples stay copyable.

The ids are shared across the whole file as it is generated, so a suffix used in the frontmatter and the same suffix on a body task line resolve to the **same** id. That shared scope is exactly what lets a child line reference the parent task's id. The date/time variables use one creation timestamp, so `{{date}}` and `{{datetime}}` stay consistent inside the same generated task.

## Filling task context in a file template

Use task value variables when the file body should repeat the task's title, note, or dates:

```md
---
operonId: {{operonId}}
dateStarted: {{dateStarted}}
dateScheduled: {{dateScheduled}}
dateDue: {{dateDue}}
datetimeCreated: {{datetime}}
datetimeModified: {{datetime}}
note: {{note}}
---

# {{taskDescription}}

Started: {{dateStarted}}
Scheduled: {{dateScheduled}}
Due: {{dateDue}}
Created: {{datetime}}

{{note}}
```

If the task has no start date, scheduled date, due date, or note, those variables become blank. This keeps template output clean and avoids treating a literal variable as a real date.

## Wiring a parent and its subtasks

Give the parent a suffixed id, then reference that same suffix in each child's `parentTask`. Here a file task is the parent, and its body holds two inline subtasks:

```md
---
operonId: {{operonId1}}
Status: Project.Planned
---

- [ ] First subtask {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
- [ ] Second subtask {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
```

When Operon generates this:

- The parent's `operonId` becomes a real id, call it `aaa1111`, because of `{{operonId1}}`.
- Each subtask's own `{{operonId}}` becomes its **own** fresh id.
- Each subtask's `{{parentTask:: {{operonId1}}}}` resolves to `aaa1111`, the parent, so both children are linked to it. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

For deeper trees, use another suffix per level. A middle task takes `{{operonId2}}` as its own id, and its grandchildren point their `parentTask` at `{{operonId2}}`:

```md
- [ ] Middle task {{operonId:: {{operonId2}}}} {{parentTask:: {{operonId1}}}}
- [ ] Leaf task {{operonId:: {{operonId}}}} {{parentTask:: {{operonId2}}}}
```

## With Templater and QuickAdd

Variables combine with [Templater](https://github.com/SilentVoid13/Templater) syntax in the same template, so one template can fill dates and prompts and also mint and wire ids. The division of labour is clean: QuickAdd decides where and when a note is created, while the template ensures the Operon fields and ids are right. See [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]].

## Before you build: check your key mappings

A template writes property names directly, so they must match what Operon reads. Before authoring templates, open **Settings → Operon → Core → Keymapping** and confirm your field names, so a template's frontmatter and inline fields line up with your mappings. See [[DOCS-039 Key mappings|Key mappings]].

## FAQ

**Why didn't a `{{operonId}}` in my note resolve?** `operonId` variables resolve only in frontmatter and on task lines, never in prose or inside fenced code blocks.

**Can I use `{{taskDescription}}` in a heading?** Yes. Task value variables resolve in file task template body text, so headings, context sections, and task lines can reuse the same task values.

**Can I paste `{{date}}` into an inline task?** Yes. `{{date}}` and `{{datetime}}` resolve in pasted task lines using the current local time. The other task value variables need file template context, so `{{note}}`, `{{taskDescription}}`, `{{dateStarted}}`, `{{dateScheduled}}`, and `{{dateDue}}` are not filled during raw paste.

**How do I link a child to its parent in a template?** Give the parent a suffixed id like `{{operonId1}}`, then write the same `{{operonId1}}` in each child's `parentTask`.

**How many shared ids can I use?** As many as you have single-character suffixes, so plenty for any hierarchy you would build by hand.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
