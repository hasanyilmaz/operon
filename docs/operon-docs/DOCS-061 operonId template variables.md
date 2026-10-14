---
Notes: Use Operon task variables and Obsidian Templates-compatible creation variables
Icon: braces
Color: "#059669"
Updated: 2026-10-13T17:06:30+02:00
---

# Template variables

Templates can carry `{{...}}` tokens that Operon turns into real values while it creates a task or a Calendar Daily Note. This page deliberately separates **Operon variables**, which describe a task, from **Obsidian Templates-compatible creation variables**, which use familiar title/date/time syntax. They share braces, but they do different jobs.

## Operon variables

### Identity variables

Every task in a template needs a real `operonId`. There are two forms:

- **`{{operonId}}`** (no suffix): a **fresh, unique id every time it appears**. Use it wherever a task needs its own identity.
- **`{{operonId1}}`** (a one-character suffix): a **shared id**. The first use creates an id; every later use of the same suffix returns that id.

The suffix is exactly one letter or digit. Reusing it is how a parent file task and body subtasks refer to the same parent id.

### Task-context variables

These are Operon-native values from the task being created:

| Variable | Writes | Use it for |
| --- | --- | --- |
| `{{datetime}}` | local creation datetime, `YYYY-MM-DDTHH:mm:ss` | canonical datetime fields and audit text |
| `{{taskDescription}}` | the entered task description | repeat the drafted task text |
| `{{note}}` | the task's `note` field | context blocks and notes |
| `{{dateStarted}}` | start date, or blank | task date fields |
| `{{dateScheduled}}` | scheduled date, or blank | task date fields |
| `{{dateDue}}` | due date, or blank | task date fields |
| `{{status}}` | workflow status from the creation context described below | task frontmatter and task lines |
| `{{priority}}` | priority from the creation context described below | task frontmatter and task lines |

If a task-context value is unavailable, Operon writes an empty value rather than leaving the token behind.

## Obsidian Templates-compatible creation variables

Operon recognizes this familiar syntax in its own creation flows. It does **not** run the Obsidian Templates command or require the Core Templates plugin to be enabled. Explicit formats use [Moment format tokens](https://momentjs.com/docs/#/displaying/format/).

| Syntax | Resolves to | Best place to use it |
| --- | --- | --- |
| `{{title}}` | final File basename; drafted description in Inline template properties | a heading or `title:` frontmatter |
| `{{date}}` | local creation date | canonical task dates in File Task/raw-inline use, or prose |
| `{{time}}` | local creation time | headings, prose, or inline-task notes |
| `{{date:FORMAT}}` | creation date formatted with Moment | labels, prose, and custom text properties |
| `{{time:FORMAT}}` | creation time formatted with Moment | labels, prose, and custom text properties |

`{{title}}` has no format suffix: `{{title:...}}` stays literal. In File creation, `{{title}}` is the final filename after sanitizing and any duplicate-name suffix, while `{{taskDescription}}` is the task text entered in Task Creator. `{{time}}` is `HH:mm` in File Task and raw-inline use; `{{datetime}}` remains the full ISO datetime with seconds.

> [!warning] Keep task dates canonical
> In a File Task, prepared Inline template property, or raw inline snippet, use plain `{{date}}` in an Operon date field such as `dateScheduled`. In a Calendar Daily Note template, use `{{date:YYYY-MM-DD}}` for an Operon date field because plain `{{date}}` follows the Templates Date format setting. A custom format such as `{{date:DD.MM.YYYY}}` is display text, not canonical task-date storage.

## Where variables resolve

| Variable family | File Task template | Inline template properties in Creator | Raw pasted inline task line | Operon-created Daily Note |
| --- | --- | --- | --- | --- |
| `operonId` identity variables | Yes, in frontmatter and task lines | Deferred until creation; no ids allocated in preview | Yes | Only where an Operon task is later created |
| Operon task-context variables | Yes, from the File creation context | Yes, from the prepared draft inputs described below | `{{datetime}}`, `{{status}}`, and `{{priority}}` only | No general task context |
| Core-compatible `title/date/time` variables | Yes; final basename, ISO date, and `HH:mm` | Yes; drafted description, ISO date, and `HH:mm` | Plain `{{date}}` and `{{time}}` only | Yes; uses the Templates Date and Time format settings |
| `{{date:FORMAT}}` and `{{time:FORMAT}}` | Yes | Yes | No | Yes |

File Task fenced code blocks keep all template tokens literal so examples stay copyable. In an Operon Calendar Daily Note, `{{date}}` is the local **creation date**, not the Calendar day you clicked, the note filename date, or a task's stored scheduled date. See [[DOCS-050 Daily Notes workflows|Daily Notes workflows]].

For File Task templates, `{{status}}` and `{{priority}}` come from the final task draft: Operon considers the source task, selected template, inherited values, automation, and defaults before writing the final values. The creation date, time, and datetime use one timestamp, so they stay consistent inside the same generated task.

## Inline template properties in Creator

This is a separate path from a raw pasted inline snippet. Supported frontmatter values can use Operon task-context variables and compatible `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, and `{{time:FORMAT}}` tokens. In this path, `{{title}}` and `{{taskDescription}}` use the drafted description: no new file basename exists. Plain date/time use `YYYY-MM-DD` and `HH:mm`.

Preparation uses a fixed clock for the current template selection; typing more text does not keep advancing its date/time values. Task-context substitutions use the draft's non-template inputs, including deliberate edits, rather than feeding the template's own values back into itself. This differs from the final File creation context described below.

Identity variables are deferred until creation; preview does not allocate task ids. Inline preparation does not execute Templater or copy body text, headings, or subtasks. Empty properties can be shown for editing without being written as empty inline fields; `false` and `0` remain meaningful values. See [[DOCS-150 Using inline task templates|Using inline task templates]] for supported types and skipped or unavailable fields.

The matrix separates this prepared-property path from raw pasted snippets; their supported variables are not interchangeable.

## Filling task context in a File Task template

Use task-context variables for task data and compatible variables for the title or display text.

Template input:

```md
---
title: "{{title}}"
operonId: {{operonId}}
Status: {{status}}
Priority: {{priority}}
dateStarted: {{dateStarted}}
dateScheduled: {{dateScheduled}}
dateDue: {{dateDue}}
datetimeCreated: {{datetime}}
datetimeModified: {{datetime}}
note: {{note}}
---

# {{title}}

Task: {{taskDescription}}
Created: {{date}} at {{time}}
Display date: {{date:ddd, D MMM YYYY}}
Status: {{status}}

{{note}}
```

Example output for a task created at `2026-06-27T13:46:10`:

```md
---
title: "Prepare launch task"
operonId: a1b2c3d
Status: Project.Brainstorming
Priority: High
dateStarted:
dateScheduled: 2026-06-28
dateDue: 2026-07-04
datetimeCreated: 2026-06-27T13:46:10
datetimeModified: 2026-06-27T13:46:10
note: Confirm owner before kickoff
---

# Prepare launch task

Task: Prepare launch task
Created: 2026-06-27 at 13:46
Display date: Sat, 27 Jun 2026
Status: Project.Brainstorming

Confirm owner before kickoff
```

## Calendar-created Daily Note template

When Operon Calendar creates a Daily Note, it reads the Daily Notes template, lets Templater run if present, then resolves compatible title/date/time variables. The Daily Note's filename format comes from **Daily Notes → Date format**. The plain `{{date}}` and `{{time}}` output instead follows **Templates → Date format** and **Templates → Time format**.

```md
---
title: "{{title}}"
created: "{{date:YYYY-MM-DD}} {{time:HH:mm}}"
---

# {{title}}

Created {{date}} at {{time}}
```

This applies only when Operon creates a missing Daily Note from Calendar. Opening an existing note never reprocesses its template.

## Pasted inline snippets

Raw pasted inline snippets support the values that work without a File Task context:

- `{{operonId}}` and suffixed ids such as `{{operonId1}}`.
- `{{date}}`, `{{time}}`, and `{{datetime}}`, from the current local creation time.
- `{{status}}`, from the first status in your default pipeline.
- `{{priority}}`, from your default priority.

`{{title}}`, `{{date:FORMAT}}`, and `{{time:FORMAT}}` are not raw-inline snippet variables. Neither are task-context values such as `{{note}}`, `{{taskDescription}}`, `{{dateStarted}}`, `{{dateScheduled}}`, or `{{dateDue}}`.

Paste this:

```md
- [ ] Follow up with reviewer {{operonId:: {{operonId}}}} {{status:: {{status}}}} {{priority:: {{priority}}}} {{dateScheduled:: {{date}}}} {{note:: Captured at {{time}}}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
```

With default status `Project.Brainstorming`, default priority `High`, and local time `2026-06-27T13:46:10`, Operon writes:

```md
- [ ] Follow up with reviewer {{operonId:: a1b2c3d}} {{status:: Project.Brainstorming}} {{priority:: High}} {{dateScheduled:: 2026-06-27}} {{note:: Captured at 13:46}} {{datetimeCreated:: 2026-06-27T13:46:10}} {{datetimeModified:: 2026-06-27T13:46:10}}
```

## Wiring a parent and its subtasks

In a File Task template with body subtasks, give the parent a suffixed id, then reference that suffix in each child's `parentTask`:

```md
---
operonId: {{operonId1}}
Status: Project.Planned
---

- [ ] First subtask {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
- [ ] Second subtask {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
```

When Operon generates this, the parent's `{{operonId1}}` becomes one real id and both children point at it. For deeper trees, give each middle level its own suffix and point its children at that suffix. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

## With Templater and QuickAdd

In File Task creation, variables combine with [Templater](https://github.com/SilentVoid13/Templater) syntax in the same template. Templater fills `<% ... %>` first; Operon then resolves its task variables and compatible title/date/time variables. QuickAdd decides where and when a note is created, Templater fills dynamic content, and Operon ensures the task fields and ids are correct. See [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]].

## Before you build: check your key mappings

A template writes property names directly, so they must match what Operon reads. Before authoring templates, open **Settings → Operon → Core → Key Mappings** and confirm your field names. See [[DOCS-039 Key mappings|Key mappings]].

## FAQ

**When should I use `{{title}}` or `{{taskDescription}}`?** In File creation, use `{{title}}` when you need the final note title or filename. In Inline template properties, it instead uses the drafted description. Use `{{taskDescription}}` when you need the text entered for the task; it does not change if filename sanitizing or collision handling changes the file basename.

**Can I change a date or time format?** Yes. Use `{{date:FORMAT}}` or `{{time:FORMAT}}` with Moment tokens, for example `{{date:DD.MM.YYYY}}` or `{{time:h:mm A}}`. Use a formatted date in an Operon date field only when it produces canonical `YYYY-MM-DD`, such as `{{date:YYYY-MM-DD}}`.

**Does this require the Templates core plugin?** No. Operon resolves the compatible syntax in its own creation flows. The Core Templates plugin still owns its own **Insert template** command.

**How is this different from Templater?** Templater uses `<% ... %>` commands and can run code or prompts. Core-compatible title/date/time variables use `{{...}}` syntax. They are separate systems, and Operon can process both in the same File Task template.

**Can I paste `{{date}}`, `{{time}}`, `{{status}}`, or `{{priority}}` into an inline task?** Yes. Plain `{{date}}`, `{{time}}`, and `{{datetime}}` resolve from the current local creation time; `{{status}}` and `{{priority}}` use your defaults. `{{title}}` and formatted date/time forms do not resolve in raw pasted inline snippets.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-024 Task templates|Task templates]]
- [[DOCS-050 Daily Notes workflows|Daily Notes workflows]]
- [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]]
