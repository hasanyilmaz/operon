---
Notes: The readable key::"VALUE" syntax for single-task and bounded batch creation and update
Icon: braces
Color: "#059669"
Updated: 2026-07-30T19:48:31
---

# Compact task syntax

> **Maturity:** Public CLI compact syntax · Obsidian Desktop · Compiles to a sealed plan · CLI contract V1

Compact syntax is the readable way to state a task's fields on the command line. Instead of composing a JSON intent, you write the description and a few `key::"VALUE"` assignments, and the CLI compiles them into the same sealed plan a JSON request would produce. It is shared by two commands, `task create` and `task update`, and it is a convenience over the write model, not a second way to write: everything still previews, seals, and applies as described in [[DOCS-122 Changing tasks safely|Changing tasks safely]]. This page is the syntax and the field rules; the commands that use it, with their targeting, are in [[DOCS-127 Everyday task commands|Everyday task commands]].

## The shape of an assignment

Every field is set with one assignment token:

```text
canonicalKey::"VALUE"
```

The rules are consistent across create and update:

- **Canonical keys only.** You use Operon's fixed canonical key names, such as `dateDue` or `priority`, never a vault's visible property name, a localized label, or an alias. A file task that shows `dateDue` as `Deadline` still takes `dateDue` here; the visible name affects only how the field is written to the note.
- **One occurrence per key.** A key may appear at most once in a command, including list keys.
- **Quote values with spaces.** A value that contains spaces uses straight ASCII double quotes. Each assignment is one shell token, so the description and each field are separate arguments.

## Values, lists, and escaping

Scalar values are plain data, not Markdown. A field token splits at its first `::`, and everything after is the value; later `::` sequences and semicolons inside scalar text stay literal.

List fields use the semicolon:

- Separate items with `;`; the canonical form is `; ` (semicolon and space).
- Order is preserved, and whitespace next to a delimiter is trimmed.
- Empty items are rejected.
- A literal semicolon inside one list item is escaped as `\;`.

For example, `tags::"planning; review"` sets two tags. Scalar text does not use the list delimiter, so `note::"call them; then email"` keeps one note with a literal semicolon and no escape.

## Compact create

Create one task by stating its representation, description, and fields:

```bash
operon task create inline "Review planning" dateDue::"2026-08-01" tags::"planning; review"
operon task create file "Publish notes" note::"Source reviewed"
```

The optional `inline` or `file` token selects the representation only. Placement stays Runtime-owned: the compiler asks for the configured default target for that representation, so exact paths, file templates, and parent routing are resolved and sealed by the Runtime, not stated here. `parentTask::"<operonId>"` attaches the new task under one existing task by its exact id; it does not resolve a name or create a parent.

## Status and priority at creation

At creation, two fields resolve through your live Catalog:

- `status::"Pipeline.Status"` takes one exact canonical status value, such as `status::"Daily.Planned"`.
- `priority::"VALUE"` takes one configured priority value.

The compiler resolves each to its stable id through the live Catalog, and zero or multiple matches fail closed rather than guessing. On an existing task, priority still works this way through `task update`, but status does not: changing a task's status goes through its lifecycle commands (`complete`, `reopen`, `cancel`, or an explicit `transition`) in [[DOCS-127 Everyday task commands|Everyday task commands]], because a transition carries semantics a plain field write does not.

## Reminders and recurrence at creation

Compact create can also set temporal fields, all inside the one sealed create plan:

- `reminderDatetimes::"VALUE"` for absolute reminders.
- `reminderRules::"VALUE"` for relative reminders, in the lowercase-unit `anchor.offset` form such as `dateDue.30m`, whose anchor field must be present in the same create.
- `repeat::"VALUE"` in the canonical persisted form such as `mode=schedule|freq=day|interval=1`.
- `datetimeRepeatEnd::"VALUE"`, which requires `repeat` in the same create.

These are gated behind an advertised capability version that the CLI and Runtime must agree on; if they do not, the create fails closed rather than splitting the temporal parts into follow-up mutations. On an existing task, reminders are maintained with their own commands. Recurrence and scoped temporal edits use the recurrence route of `task update`, described below.

## Compact update

Update one exact task by setting, replacing, or clearing fields:

```bash
operon task update --id "abc1234" priority::"High" dateDue::"2026-08-15"
operon task update --description "Review planning" --clear "dateDue"
```

Select the task with exactly one of `--id`, a seven-character Operon id, or `--description`, which matches one task by NFC-normalized, case-sensitive exact text. Set or replace a field with `key::"VALUE"`, and clear one with `--clear "key"`; an empty assigned value is invalid and never means clear, and a key may appear only once across all assignments and clears. Only fields that are mapped, readable, and classified as general updates are admitted, plus `priority`; description can be replaced but not cleared. When every requested change already matches the live task, the CLI returns a no-change result before it ever creates a preview.

## Recurrence and scoped temporal updates

Existing recurrence is updated through `task update`, but it routes to a dedicated recurrence mutation rather than a general field write:

```bash
operon task update --id "abc1234" --scope this-and-following dateScheduled::"2026-08-04"
operon task update --id "abc1234" --scope this-task estimate::"3600"
operon task update --id "abc1234" repeat::"mode=schedule|freq=week|interval=1|days=mo"
```

A temporal change on a repeating task requires `--scope this-task` or `--scope this-and-following`. Starting recurrence on a non-repeating task defaults to `this-and-following`; `datetimeRepeatEnd` may accompany the normalized `repeat` rule. Recurrence fields cannot be mixed with general fields or relationship keys in one update.

## Relationships in an update

The same `task update` surface sets a task's relationships, using exact ids:

```bash
operon task update --id "abc1234" blocking::"def5678; ghi9012"
operon task update --id "abc1234" --clear "parentTask"
```

`parentTask` takes exactly one id; `blocking` and `blockedBy` take an ordered list that replaces the whole list, rejecting duplicate, empty, invalid, or self-referential ids, and the same id cannot appear in both. `--clear` empties a relationship. Relationship keys and general-field keys cannot be mixed in one request; a command is either a general-field update or a relationship update.

## Compact line batches

`compact-lines` accepts one complete compact record per line and turns the whole input into one reviewed plan.

For creation, a file can contain one to 64 records:

```text
inline "Review planning" dateDue::"2026-08-01"
file "Publish notes" note::"Source reviewed"
```

```bash
operon task create --input-format compact-lines --input - --json
```

Every record is parsed and compiled before one preview is requested. The command stores one `planRef`, stays preview-only, and never automatically applies a multi-source plan. Apply that same unchanged plan separately when you are ready.

For updates, a file contains two to 64 records, each beginning with a unique exact id:

```text
--id "abc1234" note::"Review first" --clear "location"
--id "def5678" priority::"High"
```

```bash
operon task update --input-format compact-lines --input - --json
```

Batch update admits general fields only. It rejects description selectors, recurrence fields, and relationship keys, and all targets must resolve to one inline source and one atomic plan. There is no sequential fallback: every line is validated before the one preview, which is stored for separate same-plan apply and recovery.

## What stays on dedicated commands

On an existing task, some changes are deliberately not compact fields, because each carries behavior a field write would miss:

- **Status transitions**, through `complete`, `reopen`, `cancel`, or `transition`.
- **Reminders**, through `reminder add`, `reminder replace`, and `reminder remove`.
- **Pinned state**, through `pin` and `unpin`.

These commands, together with recurrence updates and their scopes, are in [[DOCS-127 Everyday task commands|Everyday task commands]].

## Preview only, files, and stdin

Compact commands follow the same apply rules as any write. Add `--preview-only` to a direct command to stop at the preview and store the plan without applying it. You can also feed one raw compact record or a compact line batch from a file or standard input:

```bash
operon task create --input-format compact --input - --json
operon task create --input-format compact-lines --input - --json
operon task update --input-format compact-lines --input - --json
```

Raw compact input is parsed strictly, requires straight double quotes, and is always preview-only; you apply the stored plan separately, following [[DOCS-122 Changing tasks safely|Changing tasks safely]]. The same preview-only rule applies whether `--input` reads stdin or a file. If a file is necessary, use an owner-only temporary file outside the synchronized vault and delete it immediately after the command finishes. `--input` cannot be combined with positional compact content, and `--input-format` defaults to `json`.

## What compact syntax will not do

Positional compact arguments and `--input-format compact` each describe one task with configured-default placement. `compact-lines` adds the bounded create and update batches described above, but it does not express exact path or line placement, deterministic file templates, file-body replacement, or richer task graphs, and it does not accept generated Markdown `{{key:: value}}` containers as input. Those belong to the typed JSON route. Discover its current intent schema with `operon schema get mutation-intent --json`, then pass typed input with `operon task create --input <file|-> --json`; see [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]].

## FAQ

**My vault shows that field as `Deadline`. Do I write that name?** No, write the canonical key. Compact syntax accepts canonical keys only, so an unrecognized name is refused as an unknown canonical key and a key that exists but cannot be written is refused as not writable. The visible property name affects only how the field is stored in a file task.

**What if a value itself contains a semicolon?** In a list, escape it as `\;` inside the item; the compiler joins items with `; ` and preserves your escape. Lists also refuse empty items and duplicate items rather than silently dropping them. In a scalar field there is nothing to escape, because the delimiter has no special meaning there.

**Why did my create ask for assignees?** Because this vault requires them. When the creation policy marks assignees as required, a compact create without an `assignees` value is refused before anything is previewed. Add the field, or change the policy in Operon's settings if the requirement no longer fits how you work.

**How many records can one batch carry, and can it half-apply?** Up to 64 records for both create and update batches, and no, it cannot half-apply. Every line is parsed and compiled before a single preview is requested, and the result is one atomic plan with no sequential fallback: either the whole batch previews or the input is refused.

**Is compact syntax less safe than sending JSON?** No. Both compile to the same sealed plan and obey the same apply and recovery rules. The difference is in routing: raw compact input, from a file or stdin, is always preview-only, so it stores a plan for you to apply deliberately.

**Can I express an exact path, a file template, or a task graph in compact form?** No. Those belong to the typed JSON route, which compact syntax deliberately does not reach into. Discover the current shape with `operon schema get mutation-intent --json` and pass it through `--input`.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-127 Everyday task commands|Everyday task commands]]
