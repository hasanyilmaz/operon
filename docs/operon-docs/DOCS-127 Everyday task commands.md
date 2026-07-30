---
Notes: Direct single-task commands, bounded compact batches, exact targeting, and apply behavior
Icon: list-checks
Color: "#059669"
Updated: 2026-07-30T20:01:33
---

# Everyday task commands

> **Maturity:** Public CLI write path · Direct human commands · Obsidian Desktop · CLI contract V1

These are the commands you reach for to change a task: complete it, update a field, add a reminder, move it, delete it. Most direct forms act on one exact task, while compact line creation and update can build one bounded batch plan. They share the same write model, so this page is a catalog you can scan, not a sequence to read in order. The field and batch syntax are in [[DOCS-126 Compact task syntax|Compact task syntax]], and the preview-and-apply model they all obey is in [[DOCS-122 Changing tasks safely|Changing tasks safely]].

## Selecting the task

Direct selector forms act on exactly one task, chosen one of two ways:

- **`--id "abc1234"`** names the task by its seven-character Operon id. This is the exact, unambiguous choice.
- **`--description "Review planning"`** matches one task by its description, compared after NFC normalization and case-sensitively, with no fuzzy matching.

If a selector matches zero tasks, or more than one, the command fails closed before previewing rather than guessing. These direct selector forms accept `--preview-only` to stop at the preview, `--profile "main"` or `--vault "/path"` to choose the vault, and `--json` for machine-readable output. Creation takes no selector, compact line update carries an exact id on each record, and guided transition and timer flows select through the terminal. Explicit plan execution and recovery commands have their own arguments and are not selector forms.

## Create and update

Creating and updating are where the compact field syntax lives:

```bash
operon task create inline "Review planning" dateDue::"2026-08-01"
operon task update --id "abc1234" priority::"High" --clear "dateDue"
```

`task create` makes a new task and so takes no selector; `task update` changes fields on an exact task, setting or replacing with `key::"VALUE"` and clearing with `--clear "key"`. Both share the field rules in [[DOCS-126 Compact task syntax|Compact task syntax]].

For a bounded file or stdin batch, use:

```bash
operon task create --input-format compact-lines --input - --json
operon task update --input-format compact-lines --input - --json
```

Create accepts one to 64 records; update accepts two to 64 unique exact-id records. Both produce one preview-only plan. File input is also supported; use an owner-only temporary file outside the synchronized vault and delete it immediately after the command finishes. The record grammar, update restrictions, atomicity, and same-plan apply rules are in [[DOCS-126 Compact task syntax|Compact task syntax]].

## Move through the lifecycle

Three commands move a task through its status without your needing to name the exact target status:

```bash
operon task complete --id "abc1234"
operon task reopen --description "Review planning"
operon task cancel --id "abc1234"
```

Each compiles to a semantic transition in the task's own pipeline, carrying the timer, recurrence, and hierarchy effects a transition implies. A task that is already complete, already cancelled, or already open returns a no-change result rather than writing anything.

## Pin and unpin

```bash
operon task pin --id "abc1234"
operon task unpin --id "abc1234"
```

These set or clear the pinned state on one exact task. A task that is already in the requested state returns no-change.

## Reminders

Reminders are maintained one item at a time, either absolute (`reminderDatetimes`) or relative (`reminderRules`):

```bash
operon reminder add --id "abc1234" reminderRules::"dateDue.30m"
operon reminder replace --id "abc1234" --current "dateDue.30m" reminderRules::"dateDue.1h"
operon reminder remove --id "abc1234" reminderDatetimes::"2026-08-01T09:00"
```

Each command changes exactly one reminder, so a multi-item value is rejected. `replace` and `remove` match the current item you name against the live reminder list; you never have to supply Operon's internal item ids.

## Relationships

A task's parent and dependencies are set through `task update`, using exact ids:

```bash
operon task update --id "abc1234" blocking::"def5678; ghi9012"
operon task update --id "abc1234" --clear "parentTask"
```

`parentTask` takes one id; `blocking` and `blockedBy` take an ordered list that replaces the whole list. The rules, including that relationship keys cannot be mixed with general fields in one command, are in [[DOCS-126 Compact task syntax|Compact task syntax]].

## Recurrence and scoped temporal edits

Recurrence changes use `task update` but route through recurrence-aware behavior:

```bash
operon task update --id "abc1234" --scope this-and-following dateScheduled::"2026-08-04"
operon task update --id "abc1234" --scope this-task estimate::"3600"
operon task update --id "abc1234" repeat::"mode=schedule|freq=week|interval=1|days=mo"
```

Temporal edits on an already repeating task require `--scope this-task` or `--scope this-and-following`. Starting recurrence on a non-repeating task defaults to `this-and-following`. Recurrence updates cannot mix with general fields or relationship keys in one command.

## Relocate, convert, and delete

These change where a task lives, or remove it:

```bash
operon task relocate --id "abc1234" --target-file "Notes/Planning.md" --line "12"
operon task convert --id "abc1234" --to "file" --template "Project task" --target-file "Projects/Review planning.md"
operon task convert --id "abc1234" --to "inline" --target-file "Notes/Planning.md" --line "12"
operon task delete --id "abc1234"
```

Target files are vault-relative Markdown paths, and lines are one-based live placement candidates. Converting to a file task names the new note's path, which must not already exist, together with an exact live template. Warning-free relocation and inline-to-file conversion apply their sealed plan automatically. File-to-inline conversion requires a fresh `CONVERT` confirmation because it can lose content, deletion requires a fresh `DELETE`, and a relocation that is destructive or otherwise gated asks for `MOVE`. Each of these confirmations is bound to the exact target, and JSON or non-interactive calls return the stored plan instead of prompting.

## Timer sessions

Completed timer sessions are edited directly, addressed by a one-based, oldest-first session number:

```bash
operon timer session add --id "abc1234" --start "2026-08-01T09:00" --end "2026-08-01T09:45"
operon timer session update --id "abc1234" --session "2" --start "2026-08-01T09:00" --end "2026-08-01T10:00"
operon timer session remove --id "abc1234" --session "2"
```

Datetimes are local and naive to the minute or second; a UTC offset or a trailing `Z` is rejected. `add` and `update` apply automatically when the plan is warning-free, while `remove` is destructive and asks for a fresh `REMOVE` confirmation. Starting and stopping the running timer, by contrast, are guided commands that let you pick the task interactively; those live with the other guided flows in [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]].

## How much applies automatically

The pattern across all of these is the one from [[DOCS-122 Changing tasks safely|Changing tasks safely]]:

- A **routine, warning-free** command previews and then applies on its own.
- A **destructive** command asks for its fresh confirmation first.
- **`--preview-only`**, typed `--input`, and compact or `compact-lines` stdin stop at the preview and store the plan.
- **`--json` changes output only**; an otherwise eligible warning-free direct argv command can still apply automatically while returning JSON. Destructive JSON or non-interactive calls retain the plan instead of simulating confirmation.
- An **uncertain** apply is recovered with `operon plan recover <plan-ref>`, never re-issued from scratch.

When you are unsure what a command did, `operon plan show <plan-ref> --json` reports the stored plan's state.

Explicit `plan apply`, `plan recover`, and `mutation apply` can dispatch an already reviewed plan while returning JSON; for those commands, `--json` controls output rather than preview behavior. If the process is interrupted before dispatch, it exits `130` and there is no uncertain mutation to recover. If interruption, timeout, or transport loss happens after dispatch may have begun, it exits `5` with `outcome-unknown`. Recover only the same `planRef`; retention details and the Developer API distinction are in [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]].

## FAQ

**What if two tasks share the exact description I passed?** The command stops rather than choosing. It reports that more than one task has that description and lists their ids so you can rerun with `--id`. If nothing matches you get a not-found refusal, and if the search could not be completed exhaustively it refuses as well, because a partial scan could hide a second match.

**What happens if I complete a task that is already complete?** Nothing is written. The command returns a no-change result without creating or applying a plan, and the same is true for reopening an open task, cancelling a cancelled one, or pinning something already pinned.

**How do I know which session number to pass?** Sessions are numbered from 1, oldest first, and the underlying list is never reordered, so a number stays stable as long as you do not add or remove sessions. Two sessions covering the same range remain distinguishable because the plan seals the exact stored position rather than the times alone.

**Can I give a timer session a time zone?** No. Start and end are local and naive, to the minute or the second, and a UTC offset or a trailing `Z` is refused. This keeps a recorded session meaning the same wall-clock time as the rest of your vault.

**Can one command change a field and a relationship together?** No. A command is either a general-field update or a relationship update, and mixing the two is refused before anything is previewed. A key may also appear only once per command, so set the relationship in its own call.

**What happens if I run a destructive command from a script?** It does not apply. Without an interactive terminal there is nothing that can give the fresh confirmation the action requires, so the command stores its plan and exits. Review it with `plan show`, then apply it deliberately if that is what you intended.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-126 Compact task syntax|Compact task syntax]]
- [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]]
