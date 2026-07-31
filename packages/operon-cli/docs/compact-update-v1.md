# Compact Update V1 — internal development contract

Status: general updates implemented in `operon-cli@0.1.0-beta.18`;
relationship replacement added in `operon-cli@0.1.0-beta.21`.

## Goal and boundary

Compact update is a human-readable argv presentation for the existing
`tasks.update.preview/apply` contract. It resolves one exact live task, compiles
canonical assignments and clears into the existing typed mutation intent, then
uses the normal sealed preview, stored `planRef`, apply, postflight, and recovery
chain. It is not a direct Markdown writer or a second Runtime mutation contract.

## Public forms

```text
operon task update
operon task update (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  (canonicalKey::"VALUE" | --clear "CANONICAL_KEY")+
  [--preview-only] [--vault "PATH" | --profile "ALIAS"] [--json]
operon task update --input-format compact-lines --input <file|-> [--json]
operon task update --input <file|-> [--json]
```

The argument-free form preserves the guided interactive flow. `--input` keeps
the typed JSON interface and cannot be combined with compact selectors,
assignments, clears, or `--preview-only`.

`--id` accepts only a canonical seven-character Operon ID. `--description`
normalizes surrounding whitespace and Unicode NFC, then performs a
case-sensitive exact comparison across the complete live query result. It does
not use fuzzy matching. Zero matches, ambiguous matches, incomplete pagination,
or truncated hydration fail closed before preview.

Compact-lines accepts two to 64 raw records. Every line begins with a quoted
exact `--id`, followed by the same canonical assignment and clear grammar:

```text
--id "abc1234" note::"Review first" --clear "location"
--id "def5678" priority::"EXACT LIVE PRIORITY"
```

LF and CRLF are accepted, a final newline is optional, and structural blank
lines are rejected. IDs must be unique. Every line is parsed before Runtime
discovery, so malformed syntax, description selectors, recurrence fields, and
relationship fields fail before readiness or preview.

## Syntax and field admission

Set or replace a field with exact `canonicalKey::"VALUE"` syntax. Clear a field
with repeatable `--clear "canonicalKey"`. An empty assigned value is invalid and
never means clear. A key may occur only once across all assignments and clears.

List values replace the complete list. They use `;` as the delimiter, canonical
display uses `; `, surrounding delimiter whitespace is trimmed, order is
preserved, duplicates and empty items are rejected, and `\;` is a literal
semicolon. Semicolons and later `::` sequences in scalar text remain literal.

Only live Catalog fields that are mapped, readable, classified
`general-update`, and owned by `tasks.update` are admitted. Built-in and writable
custom text, number, date, datetime, list, and checkbox fields use the same
value compiler as compact create. Priority accepts one exact visible live value
and is compiled to its stable ID. Description can be replaced but not cleared.

Status, reminders, recurrence, trackers, pinned state, and Runtime-owned values
stay with their dedicated mutation commands. Temporal
changes on a recurring task fail closed until recurrence scope is chosen by its
own command.

## Relationship replacement

The same direct `task update` surface routes the three canonical relationship
keys through the dedicated `task.relationship` Runtime mutation:

```text
operon task update (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  (parentTask::"TARGET_ID"
    | blocking::"TARGET_ID; TARGET_ID"
    | blockedBy::"TARGET_ID; TARGET_ID"
    | --clear "parentTask|blocking|blockedBy")+
  [--preview-only] [--json]
```

Relationship targets are canonical seven-character Operon IDs only.
Descriptions select only the source task. `parentTask` accepts exactly one ID
when set; `blocking` and `blockedBy` preserve target order and reject duplicate,
empty, invalid, or self-referential IDs. The same target cannot appear in both
the resulting `blocking` and `blockedBy` values. Clear compiles to an empty
target list.
One request may change several relationship fields, but any mixture of
relationship and general-update keys fails before Runtime discovery or preview.
When every requested relationship list already exactly matches the live ordered
Task Context value, the CLI returns `no-change` without creating a Runtime
preview.

The compiled preview spec is:

```json
{
  "operation": "replace-relationships",
  "changes": [
    {
      "field": "blocking",
      "targetOperonIds": ["def5678", "ghi9012"]
    }
  ]
}
```

Runtime seals `expectedTargetOperonIds` on every change plus sorted
`affectedOperonIds` covering reciprocal, former-parent, new-parent, and ancestor
effects. The CLI accepts automatic apply only when the sealed plan retains the
exact source target and requested replacement, contains the compare-aware sealed
state, and remains warning-free with no acknowledgement or confirmation gate.
Cross-source plans use this same rule; they are not downgraded to raw Markdown
writes or split into separate mutations.

## Apply and recovery

The CLI re-reads the selected task by ID with `live-verified` writable-field
hydration before compiling the typed intent. Routine direct argv updates may
automatically apply only when the stored sealed plan has the exact target and
spec produced by the compiler and carries no warning, acknowledgement,
confirmation, or destructive risk.

`--preview-only` stores the plan without applying it. When every requested
change already matches live writable-field hydration, the CLI returns no-change
before preview, so it cannot create an invalid zero-effect plan. If apply
becomes uncertain, the plan is recovery-only:
no replacement preview, update, or idempotency key may be created. Continue
with `operon plan recover <planRef>`.

## Capability advertisement

The CLI manifest advertises `compactUpdateVersion: 1` with this exact ordered
feature list on `task.update`:

```text
exact-id-target
exact-description-target
multi-field-update
explicit-field-clear
safe-auto-apply
```

It also advertises `directRelationshipVersion: 1`, the ordered
`directRelationshipKeys` `parentTask`, `blocking`, `blockedBy`, and the
following ordered `directRelationshipFeatures`:

```text
exact-source-selector
exact-id-targets
whole-list-replace
explicit-field-clear
reciprocal-dependency
compare-aware-graph-transaction
safe-auto-apply
```

Compact general update remains a CLI convenience gate over `tasks.update`.
Relationship replacement additionally requires the live
`tasks.relationship.preview/apply` capability pair and the `task.relationship`
mutation schema.

Compact multi-update additionally advertises:

```text
compactUpdateBatchVersion: 1
compactUpdateBatchInputFormat: compact-lines
compactUpdateBatchMaxItems: 64
```

Its exact ordered feature list is:

```text
exact-id-targets
heterogeneous-general-updates
explicit-field-clear
single-source-atomic-plan
per-target-postflight
same-plan-recovery
```

The same fields must match in the live `taskUpdate` Catalog policy. One
multi-ID mutation-readiness Context verifies every target and writable field
coherently. Only one inline source is admitted. The CLI compiles ordered
`update-batch` items, preserves per-target no-change effects, requests one
preview, and always returns preview-only with one stored `planRef`. There is no
sequential fallback. File, mixed-source, cross-source, or non-atomic plans are
refused before apply.
