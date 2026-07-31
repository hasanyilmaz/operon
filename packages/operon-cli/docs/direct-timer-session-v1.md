# Direct Timer Session V1 — internal development contract

Status: implemented and included in the beta.23 candidate.

## Human commands

Human selector commands resolve exactly one live task:

```text
operon timer session add
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  --start "LOCAL_DATETIME" --end "LOCAL_DATETIME"

operon timer session update
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  --session "POSITIVE_NUMBER"
  --start "LOCAL_DATETIME" --end "LOCAL_DATETIME"

operon timer session remove
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  --session "POSITIVE_NUMBER"
```

All commands also accept `--preview-only`, `--vault`, `--profile`, and `--json`.
Session numbers are 1-based and oldest-first. Start, end, and raw storage index
provide the deterministic order; the raw list itself is never reordered.

Datetimes accept local-naive minute or second precision. UTC offsets and `Z`
are rejected. Update requires both new endpoints. Add appends, update replaces
the selected raw item in place, and remove deletes only the selected item.
Duplicate ranges remain distinguishable by their sealed raw index.

## Typed preview

The agent route uses real stdin and is always preview-only:

```text
operon timer session add --input - --json
operon timer session update --input - --json
operon timer session remove --input - --json
```

It compiles to mutation kind `timer.session` and capability
`timers.session.preview`. The Runtime seals the exact previous and final tracker
lists, selected raw index and range, duration, task locator and revision,
ancestor effects, source digests, and effective time.

## Apply and recovery

Add and update auto-apply only when the stored target and spec match the
compiled request and the plan has no warning, acknowledgement, confirmation,
or destructive risk. `--preview-only` never applies.

Remove is destructive. Interactive human use requires a fresh `REMOVE`
confirmation bound to the stored plan. JSON, non-TTY, and agent calls return the
stored plan without prompting.

Tracker fields, duration, parent aggregates, and modification timestamps commit
through the shared graph journal. Same-source patches coalesce to one write.
Forward continuation and compare-aware compensation reuse the same sealed
`planRef`; uncertainty never creates a replacement preview or idempotency key:

```text
operon plan recover PLAN_REF
```

Missing or partially advertised `timers.session.preview/apply` capability pairs
fail closed before task resolution. Active timer state is read-only to this
mutation and remains under the existing timer-control contract.
