# Direct Source Transition V1 — internal development contract

Status: implemented in the beta.23 candidate.

## Human commands

```text
operon task relocate
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  --target-file "VAULT_RELATIVE.md" --line "ONE_BASED_LINE"

operon task convert
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  --to "file" --template "EXACT_LIVE_NAME"
  --target-file "ABSENT_VAULT_RELATIVE.md"

operon task convert
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
  --to "inline" --target-file "VAULT_RELATIVE.md"
  --line "ONE_BASED_LINE"

operon task delete
  (--id "OPERON_ID" | --description "EXACT_DESCRIPTION")
```

All direct commands also accept `--preview-only`, `--vault`, `--profile`, and
`--json`. Selectors are exact and fail closed on zero, multiple, truncated, or
unsettled matches. File paths must be canonical vault-relative Markdown paths.
Lines must resolve to an exact current live placement candidate. Template names
must resolve to exactly one current Catalog candidate and compile to its stable
ID.

## Admission and confirmation

The CLI and live Catalog must publish `sourceTransitionRecoveryVersion: 1` with
this exact ordered feature list:

```text
terminal-after-state-verification
same-plan-forward-continuation
compare-aware-compensation
cross-file-transition-journal
```

Missing, partial, or reordered advertisements fail closed. Direct flags cannot
be mixed with typed `--input`; the existing guided and typed routes remain
unchanged.

Warning-free relocation and Inline-to-File conversion may apply their unchanged
sealed plan automatically. File-to-Inline conversion requires a fresh
`CONVERT` confirmation. Exact deletion requires `DELETE`. JSON, non-TTY, and
preview-only calls retain the stored plan and do not perform destructive work.

## Transaction and recovery

Source and destination bytes, coalesced ancestor effects, repeat-series state,
and exact pinned state are persisted in the shared graph journal before the
first durable write. Reindex is a settlement and postflight concern rather than
a journal resource.

An exact committed prefix with an untouched suffix may continue forward with
the same `planRef`. A reversible prefix may compensate in reverse order using
compare-and-set checks. Once a trash terminal step is observed, recovery never
recreates the file; it may only verify the exact terminal after-state and finish
forward. Divergent or insufficient evidence stays `outcome-unknown`.

Recovery never creates a replacement preview, target, apply request, or
idempotency key:

```text
operon plan recover PLAN_REF
```
