# Direct Pinned State V1 — internal development contract

Status: implemented CLI contract in `operon-cli@0.1.0-beta.20`.

## Human commands

Human selector commands resolve exactly one live task:

```text
operon task pin   (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
operon task unpin (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  [--preview-only] [--vault "PATH" | --profile "ALIAS"] [--json]
```

`--id` accepts one canonical seven-character Operon ID. `--description` uses
NFC-normalized, case-sensitive exact matching and fails closed for zero,
ambiguous, truncated, or warning-bearing query results. The selected task is
read again by ID with live verification before preview.

An already pinned or unpinned task returns a local no-change result. It does not
create or apply a mutation plan.

## Typed preview

The typed agent route remains preview-only:

```text
operon task pin --input -
operon task unpin --input -
```

Its input uses mutation kind `task.pinned-state`, capability
`tasks.pinned.preview`, an exact target, and the public spec:

```json
{
  "operation": "set-pinned",
  "pinned": true
}
```

The Runtime seals `expectedPinned`, `expectedEntryRevision`, and `effectiveAt`
into the stored plan. Those compare-aware fields are Runtime-owned and are not
accepted as human assignments.

## Apply and recovery

Direct human selector argv performs preview and automatically applies only when
all of the following remain true:

- The stored mutation kind is exactly `task.pinned-state`.
- The sealed target and public requested state match the compiled intent.
- Runtime-owned compare fields are present and valid.
- Preview and plan warnings are empty.
- No acknowledgement or confirmation is required.
- Risk is not destructive.

`--preview-only` stores the plan without applying it. Typed `--input` also stops
after preview and returns its `planRef`; the caller applies that exact plan
separately.

Timeout or transport uncertainty never creates a replacement preview. Recovery
uses only:

```text
operon plan recover PLAN_REF
```

Missing or partially advertised `tasks.pinned.preview/apply` capability pairs
fail closed before task resolution.
