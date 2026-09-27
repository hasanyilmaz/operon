# Checkbox ownership V1 extension

This opt-in extension adds contiguous inline-checkbox semantics without changing
Runtime V1 or the published Task Workflows extension. Contract version remains 1.
The independent `extension-manifest.json` lists the nine capability IDs, schema
entrypoints and document digests. Canonical native types and strict decoders live
in `src/agent-runtime/extensions/checkbox-ownership-v1`. CLI support is deferred.

## Semantics

Only uninterrupted checkbox lines immediately following an identified Operon
inline task belong to it. Indentation does not break the block. Blank lines,
headings, ordinary text, fences, another task, and an unidentified Operon task
candidate end it. File Task checkbox scope is unchanged.

| Capability | Behavior |
| --- | --- |
| `tasks.filter-query.contiguous` | Uses indexed contiguous counts for the saved filter. The request kind is `task-filter-query-contiguous`; cursor identity is distinct from the legacy query. |
| `tasks.create.contiguous.preview/apply` | Configured inline-parent placement inserts after the checkbox block, with indentation from the parent task. Explicit locations and creation graph limits remain unchanged. |
| `tasks.adopt.contiguous.preview/apply` | Converts a checkbox in place. Its inline owner supplies parent and inherited fields; otherwise the existing File Task auto-parent setting applies. Explicit status wins. |
| `tasks.inline.relocate.contiguous.preview/apply` | Moves only the task line. The warning and acknowledgement describe its contiguous checkbox scope; the checkboxes stay in place. |
| `tasks.convert.contiguous.preview/apply` | Supports Inline to File conversion only. When carrying checkboxes is enabled, only the contiguous block is carried. |

`preview/apply` abbreviates two capability IDs. Preview requests retain the
corresponding creation, adoption, relocation or conversion spec and use the new
capability. File to Inline conversion uses the existing capability. There is no
bulk checkbox-adoption API or ownership-policy field in legacy requests.

## Plans, idempotency and recovery

The new sealed plan has `extension: "checkbox-ownership-v1"`. Its outer seal binds
the new capability, caller key digest and exact `executionPlan`. The latter is an
unchanged core or adoption plan, prepared under the private contiguous policy.
Adoption also seals the complete after-source digest, including its parent update.
Source revisions and expected-content checks remain mandatory.

The execution key is the SHA-256 of the extension ID, new preview capability and
caller key, separated by NUL characters. Old and new requests therefore cannot
replay each other's receipts with the same caller key. Acknowledgements bind the
outer plan and exact target. Only their plan hash is translated when invoking the
existing executor; sealed plans are never edited after preview.

Writes, locks, leases, compensation, journal storage and terminal replay use the
existing executors. Public receipt and continuation identities are projected back
to the outer plan. Recovery requires evidence for that same inner execution; an
adoption may repair its receipt only from the exact sealed after-state. Recovery
cannot dispatch a new adoption when that state is absent or changed. Uncertain
results must be recovered with the same plan, never retried as a fresh mutation.

The existing Developer API recovery store can validate this envelope alongside
old records. No records are migrated. An older host cannot execute an unknown
extension envelope as a legacy plan.

## Native Developer API

Use the separate Plugin accessor `getCheckboxOwnershipDeveloperApiV1(consumer,
request)`, typed by `CheckboxOwnershipDeveloperApiAccessorV1`. Request only the
needed new capability IDs. Existing grants do not grant their new counterparts.

The returned API exposes `tasks.filterQuery` and capability-selected
`mutations.preview`, `apply`, `recover`, and `pendingRecoveries`. Preview accepts
`capability`, `mutationKind`, `spec`, and the exact `target` where required; the
host supplies authorization and execution identity. Success returns an opaque,
frozen session-bound handle, not a serialized plan. Apply accepts that handle.
Recover accepts either the same handle or its durable `recoveryRef` from a new
session of the same consumer with the required current grant. A copied handle
cannot authorize execution. Revocation and consumer-instance checks follow the
existing Task Workflows policy. Consent and audit remain host-controlled.

JSON schemas describe transport envelopes and handle metadata; they do not make
serialized metadata executable or encode JavaScript methods/opaque brands.
Runtime decoders additionally enforce seals, acknowledgement bindings, request
limits and result invariants. Developer access range ordering is checked at the
native accessor.

## Compatibility checks

The Plugin contract gate includes this extension's schema and runtime tests.
Frozen core and Task Workflows schemas, baseline files and CLI binding files are
unchanged. Legacy callers keep legacy counters, placement, adoption, warning and
conversion behavior. Tests compare both policies on the same source and cover
real receipt-store recovery, opaque handles, explicit grants and schema output
parity. This extension does not require a CLI package or CLI release.
