# Compact Create V1 — internal development contract

Status: implemented CLI contract in `operon-cli@0.1.0-beta.18`.

## Goal and boundary

Compact create is an optional human-argv presentation for one task creation intent. It compiles to the existing typed `mutation-intent` and uses the existing sealed preview, stored `planRef`, and plan-apply/recovery protocol. It is not a second mutation transport, Markdown writer, catalog snapshot, or raw mutation-apply endpoint.

The optional representation token is exactly `inline` or `file`; it selects representation only. Placement remains Runtime-owned: the compiler requests the configured default target for that explicit representation. Exact paths, file templates, parent routing, and settings-derived placement continue to be resolved and sealed by Runtime.

## Public forms

```text
operon task create [inline|file] "Description" [canonicalKey::"VALUE" ...] [options]
operon task create --input-format compact --input <file|-> [options]
operon task create --input <file|-> [--input-format json] [options]
```

`Description` is one shell token, so descriptions containing spaces use straight ASCII double quotes in canonical examples and generated templates. Each compact assignment is one later shell token. Shell argv does not retain quote provenance, so the argv parser accepts the decoded token; raw compact stdin requires the canonical double quotes.

Compact keys are canonical keys only. Visible property names, localized labels, aliases, and inferred names are unsupported. The compiler obtains the current writable field catalog and type information from the live Runtime before mapping a key to the typed creation spec.

`parentTask` accepts one exact existing task `operonId` and compiles it as an
existing-parent reference in the same create intent. It does not resolve task
names, create a parent task, or construct a related-task graph.

Values are shell data, not inline Markdown. A field token splits at its first `::`; the remainder is its value. Lists use semicolon-separated items, canonicalized with `; `; a literal semicolon is escaped as `\;` and a literal backslash as `\\`. List order is preserved, whitespace adjacent to a delimiter is trimmed, and empty elements are rejected. Semicolons in scalar text fields remain literal. Generated `{{key:: value}}` containers are not accepted as input.

Every canonical key may occur at most once, including list keys. `status` accepts one exact canonical `Pipeline.Status` value and `priority` accepts one exact configured Operon priority value; the compiler resolves both through the live Catalog to stable IDs. Zero or multiple matches fail closed. Stable IDs remain available through typed JSON, not compact user syntax. File Task property mappings affect serialization only, so a configured visible property such as `Deadline` never replaces compact key `dateDue`.

Examples:

```text
operon task create inline "Review planning" dateDue::"2026-08-01" tags::"planning; review"
operon task create file "Publish notes" note::"Source reviewed"
operon task create --input-format compact --input - --json
```

## Route matrix

| Invocation shape | Intended route | Outcome |
| --- | --- | --- |
| `task create` or one-description form without compact fields | Existing guided TTY flow | Unchanged legacy behavior. |
| `task create inline` | Existing guided TTY flow | The legacy one-token description `inline` remains unchanged. |
| `task create "inline" status::"Daily.Planned"` | Compact compiler with omitted representation | Description is `inline`; target is `{mode:"configured-default"}`. |
| `task create inline "Description"` | Compact compiler with explicit representation and no assignments | Target is `{representation:"inline",mode:"configured-default"}`. |
| `task create [inline|file] "Description" [key::"VALUE"...]` | Compact compiler → typed intent → sealed preview → apply unchanged plan | Applies without an extra review prompt and returns the receipt/postflight result. |
| Compact form with `--preview-only` | Compact compiler → preview | Preview only; never opens TTY or applies. |
| Compact form with `--preview-only --json` | Compact compiler → preview | `--preview-only` controls mutation behavior; `--json` only selects the single JSON preview envelope. |
| Compact argv form with `--json` | Same compact argv route | Applies and emits exactly one final JSON result envelope containing the `planRef`. |
| `task create --input <file|->` | Existing typed-input route | Default `--input-format` is `json`; current typed JSON intent remains the format. |
| `task create --input-format compact --input <file|->` | Strict raw compact parser → typed intent → preview | Preview-only; returns a stored `planRef`. Skills apply that unchanged plan separately when authorized. |
| `plan apply <planRef>` | Existing stored-plan route | Applies a stored preview and preserves identity, confirmation, idempotency, and recovery rules. |

`--input` is mutually exclusive with compact positional content. `--input-format` requires `--input`; its supported values are `json` and `compact`, defaulting to `json`. `--preview-only` retains its preview-only meaning. Compact input must not silently fall back to guided mode.

## Sealed-plan safety rules

Every compact request creates a normal `task.create` preview with a fresh request and idempotency key. Runtime resolves live catalog, target, template, and source revisions; the CLI stores the sealed plan under a `planRef`. Human compact argv may automatically apply only that unchanged stored plan. Compact stdin remains preview-only, and raw mutation-apply input remains forbidden.

After an apply attempt, including timeout or transport uncertainty, that same `planRef` is recovery-only. Retrying compact create or building a new request is not a substitute for `operon plan recover <planRef>`.

## Temporal capability gate

Compact creation accepts `reminderDatetimes`, `reminderRules`, `repeat`, and
`datetimeRepeatEnd` atomically. The CLI manifest advertises
`temporalCreateVersion: 1` and that exact ordered key list. Compilation also
requires the live Runtime creation Catalog to advertise the same version and
keys; an older, missing, partial, or mismatched advertisement fails closed with
`CREATE_CAPABILITY_UNAVAILABLE`.

Absolute reminder datetimes and relative reminder rules use the shared Operon
parsers. Their canonical values preserve source order and reject canonical
duplicates. Reminder rules use the lowercase-unit `anchor.offset` form, such as
`dateDue.30m`, and must have their anchor field in the same creation intent or
otherwise available to Runtime. Recurrence uses the canonical persisted form,
such as `mode=schedule|freq=day|interval=1`; `datetimeRepeatEnd` requires
`repeat` in the same intent. Temporal values remain part of the single sealed
create plan and must never be split into follow-up reminder or recurrence
mutations.

## Required error behavior

Provide distinct actionable usage errors for missing description; malformed token or empty canonical key; duplicate semantic field; unknown, non-writable, or type-incompatible canonical key; invalid list escaping or typed value; missing straight double quotes in raw compact input; temporal capability unavailable; compact positional content with `--input`; `--input-format` without `--input`; and unsupported option, target, or placement request.

Live catalog/Runtime resolution failures remain Runtime errors and must not become guessed local mappings.

## Non-goals

- No direct Markdown or frontmatter writes.
- No static command/property registry or cached catalog.
- No created-parent graph, relation, dependency, exact path, or template syntax;
  status and priority accept only their exact canonical compact values.
- No apply that bypasses the sealed-plan, confirmation, idempotency, or recovery protocol.
- No fixture, parser, or data import added to the production `main.ts` graph.

## Typed Create V1 boundary

Compact V1 remains limited to one task with configured-default placement.
Exact path or line placement, deterministic File Task templates, explicit File
Task body replacement, and task graphs use the existing typed JSON route. An
agent may use those advanced features only when the CLI manifest and the live
creation Catalog both advertise `typedCreateVersion: 1` with this exact ordered
feature list:

```text
exact-inline-placement
exact-file-target
deterministic-file-template
file-body-replacement
same-source-task-graph
cross-source-parent-related
```

Template candidates are discovered from the live Catalog and contain metadata
only. Inline line numbers come from live placement candidates, are zero-based,
and insert before the selected line. Cross-source parent or created-related
graphs require fresh confirmation and carry the
`cross-source-graph-partial-risk` acknowledgement. Cross-source parent,
created-related, and reciprocal dependency graphs additionally require this
exact graph transaction gate in both the CLI manifest and live Catalog:

```text
graphTransactionVersion: 1
vault-wide-graph-transaction
compare-aware-compensation
same-plan-safe-continuation
cross-source-reciprocal-dependency
```

An interrupted graph transaction is resumed only from the same stored plan.
If forward continuation is unsafe, Runtime compare-aware compensates exact
Operon-written states; divergence remains recovery-only and never creates a
replacement preview or idempotency key.

## Acceptance gate

Direct CLI tests exercise compact argv and strict stdin parsing, legacy/compact routing, live Catalog resolution to stable status/priority IDs, canonical-key rejection, typed-intent compilation, preview-only behavior, automatic human argv apply of the unchanged stored plan, and same-`planRef` recovery after an uncertain apply.
