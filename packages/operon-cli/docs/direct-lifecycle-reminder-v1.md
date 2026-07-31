# Direct Lifecycle and Reminder V1 — internal development contract

Status: implemented CLI contract in `operon-cli@0.1.0-beta.19`.

## Lifecycle

Human lifecycle commands select exactly one live task:

```text
operon task complete (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
operon task reopen   (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
operon task cancel   (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  [--preview-only] [--vault "PATH" | --profile "ALIAS"] [--json]
```

They compile to the existing `task.transition` mutation. Complete and cancel
require exactly one resolved semantic status in the task's current pipeline.
Reopen selects the first resolved non-terminal status by pipeline order. The
current status stable ID is sealed as `expectedStatusId`.

Already-complete, already-cancelled, and already-open tasks return a local
no-change result without preview or apply. Runtime-owned timer, recurrence,
dependency, pin, hierarchy, and Project Serial effects remain part of the
existing semantic transition preview and postflight.

## Reminder items

Direct reminder commands change exactly one canonical item:

```text
operon reminder add
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  (reminderDatetimes::"VALUE" | reminderRules::"VALUE")

operon reminder replace
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  --current "CURRENT_VALUE"
  (reminderDatetimes::"NEW_VALUE" | reminderRules::"NEW_VALUE")

operon reminder remove
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  (reminderDatetimes::"CURRENT_VALUE" | reminderRules::"CURRENT_VALUE")
```

Values use Operon's existing absolute-reminder and reminder-rule parsers.
Semicolon-separated multi-item values are rejected. Replace and remove hydrate
the live reminder list, require one canonical match, and seal its opaque
`itemId` plus raw `expectedValue`; those internals are never required from the
human.

## Apply and recovery

Direct commands resolve an exact ID or one NFC-normalized, case-sensitive exact
description. Zero, ambiguous, truncated, or warning-bearing reads fail closed.

Routine or elevated plans automatically apply only when the stored plan target
and spec exactly match the compiled intent and the preview has no warning,
acknowledgement, confirmation, or destructive risk. `--preview-only` stores the
plan without applying it. An uncertain apply remains fenced to
`operon plan recover <planRef>`; no replacement preview is created.
