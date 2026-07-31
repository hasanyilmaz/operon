# Operon In-Process Developer API V1

## Authority

This document is the normative channel contract for the Operon Runtime API V1
in-process Developer API. The Public V1 scope remains authoritative for product,
platform, capability, and launch commitments. Runtime API V1 schemas remain
authoritative for shared JSON DTO semantics.

The Developer API is an Obsidian Desktop integration surface for another
Obsidian plugin running in the same application process. It is not a remote API,
an SDK, an HTTP or MCP server, a mobile API, or a security sandbox between
hostile JavaScript plugins.

## Public TypeScript entrypoints

The type-only public surface is rooted at
`src/agent-runtime/public/v1/index.ts` and is divided into explicitly curated
modules:

- `shared.ts`: common Runtime versions, lifecycle, capability, identity, warning,
  freshness, compatibility, and structured-error types
- `runtime.ts`: read DTOs, Catalog DTOs, timer DTOs, and safe mutation-intent
  types
- `developer-api.ts`: the in-process accessor, channel status, immutable session
  groups, opaque mutation plan handle, and Developer API results
- `cli.ts`: CLI-specific invocation and envelope types

These modules are type-only. They do not promise JavaScript constants, helpers,
validators, stores, transports, or executable SDK code. The Developer API
module does not export CLI profiles, CLI configuration, `planRef`, the CLI plan
store, terminal helpers, raw Runtime mutation requests, caller-controlled
identity, authorization claims, consent tokens, acknowledgement proofs, or
idempotency material.

No public declaration may import an Operon UI, indexer, writer, queue, store,
source object, Node-only module, or CLI implementation module.

## Accessor and compatibility

An enabled Operon plugin instance exposes one synchronous method:

```ts
getDeveloperApiV1(
  consumerPlugin: OperonDeveloperApiConsumerPluginV1,
  request: OperonDeveloperApiAccessRequestV1,
): OperonDeveloperApiAccessResultV1
```

`consumerPlugin` is a structural type containing only `manifest.id`,
`manifest.name`, and `manifest.version`; it introduces no runtime or type
dependency on the `obsidian` package. Operon accepts it only when the object is
the exact currently enabled instance in Obsidian's plugin registry. A copied
object or matching manifest fields are not identity proof.

The request is strict and contains exactly:

- `contractVersion: 1`
- `runtimeApi: { min, max }`
- `requestedCapabilities`

Unknown request fields, duplicate capability identifiers, an invalid range, or
an unknown requested capability are rejected. A disjoint Runtime API range
returns `unsupported-version`. Mobile and other non-desktop hosts, together
with desktop platforms outside the supported matrix, return
`unsupported-platform`; V1 does not define a separate mobile error code.

Consumer identity is host-derived. The persistent consumer identifier is the
registry-verified plugin ID. Operon creates a new instance epoch for every
loaded plugin object and a new session ID for every successful connection. The
access request never accepts a plugin identifier, display label, instance
identifier, authority statement, grant, consent token, acknowledgement proof,
correlation identifier, or idempotency material from the caller.

Operon absent or disabled is detected by the consumer before this method can be
called. Operon present without this accessor is a distinct
`handler-unavailable` integration state. Expected access failures are returned
as the failed discriminant of `OperonDeveloperApiAccessResultV1`; the accessor
does not throw for contract, compatibility, platform, lifecycle, capability, or
authority refusal.

## Session capability boundary

A successful access result returns one immutable `OperonDeveloperApiV1`
session. The root object, every method group, every returned DTO, and every
array or nested object in a returned DTO are immutable snapshots.

`channel.status()`, `system.health()`, and `system.capabilities()` are baseline
discovery methods for a registry-verified consumer. They do not require a
persisted grant and do not grant domain access or mutation authority.

Every other method is gated by both:

1. the capability was explicitly included in `requestedCapabilities`; and
2. an active persisted grant contains that exact capability; and
3. the capability is truthfully live for this Developer API session.

The effective session scope is the exact intersection of requested, granted,
and live capabilities. A request is not silently opened with partial authority:
missing scope produces `authority-insufficient` and records or updates a
pending request in Operon Settings.

Method presence is not capability support. `hasCapability(name)` returns true
only for a known capability that is requested, available to the session, and
admitted by the session authority. An unrequested method call fails with
`authority-insufficient`. An unavailable requested capability fails with
`capability-unavailable`. Unknown capability identifiers never grant authority.

Capability snapshots exposed by the session contain the baseline discovery
capabilities plus the requested capability set. They must not make an
unrequested capability appear granted.

## Lifecycle

`DeveloperApiChannelStatusV1` preserves the Runtime lifecycle distinctions:

- `booting`
- `cache-ready`
- `settling`
- `ready`
- `unloading`
- terminal startup failure

The status also reports channel availability, read/write admission, authority
state, the session capability snapshot, registry-derived consumer summary,
grant state and revision, requested/granted/effective capability lists, an
optional bounded retry delay, and an optional structured error.

Reads honor the consistency requested by their shared Runtime DTO. Best-effort
data is returned only when the caller explicitly requests it, and the result
retains truthful freshness and warnings. Writes require `ready` in addition to
capability and authority admission.

Unload closes new admission synchronously. A stale session retained across
Operon unload or reload cannot silently bind to the replacement Runtime
instance. It returns an unavailable channel status and refuses domain work.

## Immutable DTO boundary

Developer API requests are strict snapshots. Operon validates and clones a
request before asynchronous work begins. Mutating the caller's original object
after invocation cannot change the admitted request.

Results are detached from mutable Operon internals and recursively frozen before
they cross the public boundary. A consumer cannot mutate a result to alter the
index, Catalog, settings, stores, sealed mutation state, receipts, or future
results.

The boundary exposes data DTOs only. It never exposes mutable collections,
class instances, internal callbacks, vault source objects, or live store
references.

## Mutation surface

The Developer API session contains:

```ts
mutations.preview(input)
mutations.apply({ plan })
mutations.recover({ plan })
mutations.recover({ recoveryRef })
mutations.pendingRecoveries()
```

`DeveloperMutationPreviewInputV1` is a discriminated union that binds each
mutation kind to its exact preview capability, target policy, and typed
specification. Operon generates request correlation, consumer binding,
authorization, consent, acknowledgement, sealing, and idempotency state.

A successful preview returns an immutable, opaque
`DeveloperMutationPlanHandleV1`. Its public fields are a review summary, not
authority. Reproducing or modifying those fields cannot construct an admitted
plan. Operon also adds an opaque `recoveryRef`; it is a lookup reference, not
authority and not a CLI `planRef`. Apply accepts only an accessor-minted plan
handle. Same-session recovery accepts that handle, while restart recovery
accepts the exact `recoveryRef` only for the same registry-verified plugin ID.
Neither form accepts a raw sealed Runtime request, raw idempotency key,
caller-provided authorization, consent token, or acknowledgement proof.

Apply uses the exact unchanged preview. Recovery uses the same plan handle and
is an explicit operation, not a generic automatic retry. A non-final result
whose `mutationMayHaveApplied` is true carries
`DeveloperMutationRecoveryV1`; the only permitted action is
`recover-same-plan`. The consumer must not create a replacement preview, switch
target or consumer context, or call ordinary apply again.

The host-owned dispatch claim is the mutation dispatch boundary. After that
claim, Operon must durably promote the private sealed recovery binding from
`prepared` to `dispatched` before invoking Runtime. If this promotion fails,
the claim is released and the same unchanged opaque plan may retry apply;
no recovery metadata is returned. A denied claim remains `prepared` or
`refused`, neither of which can be listed or recovered after restart.

`pendingRecoveries()` returns only dispatched, unresolved, redacted summaries
for the current consumer. Terminal tombstones remain addressable by their
exact reference for receipt replay but do not appear pending. This private
recovery evidence is retained for 24 hours, up to 256 protected records, and
does not depend on the redacted audit log's 2,048-record retention or clear
operation. Capacity pressure refuses a new dispatch rather than evicting
protected evidence.

## Grant, consent, and revocation

Grants are versioned under `data.json > integrations.developerApi`. The first
ungranted request fails closed and appears as pending in **Developer API
Integrations** in Operon Settings; Operon never opens a surprise modal.
Users approve exact capabilities, deny pending requests, inspect active scope,
or revoke a grant there.

Patch and minor consumer upgrades retain the approved scope. A major, invalid,
or lower version suspends the grant. Every newly requested capability requires
separate approval. Revocation increments the grant revision and immediately
invalidates current sessions and undispatched plan handles.

Routine apply requires the active exact grant. Elevated apply requires
Operon-owned review and fresh consent for each sealed plan. Destructive apply
also requires confirmation and acknowledgements bound to that exact plan,
target, and effect summary. Cancellation returns `consent-denied`, starts no
source mutation, and cannot be replayed into another prompt for the same plan.

Caller-supplied Runtime request objects or fabricated authorization,
acknowledgement, consent, identity, idempotency, plan, or CLI storage values do
not bypass this boundary. Operon creates all security material.

Revocation before dispatch refuses apply. Once dispatch has actually begun,
revocation closes new preview and apply admission but preserves recovery only
for the same consumer and the same opaque plan or recovery reference. A new
plugin instance epoch may continue that recorded operation when the persistent
registry-verified plugin ID is unchanged.

## Security audit

Mutation dispatch is blocked until a redacted durable security-audit event has
been written. Terminal receipt and terminal audit outcome complete atomically.
If terminal finalization cannot be proven, the result is `outcome-unknown` and
only same-plan recovery is admitted.

Audit records contain channel, a host-derived consumer hash, grant revision,
capability, mutation kind and risk, plan/target/vault digests, admission,
consent, result, error code, timestamp, and correlation hash. They never store
task content, descriptions, notes, file paths, authorization reasons, consent
tokens, acknowledgements, idempotency keys, sealed plans, or graph journals.

Retention is the earlier of 30 days or 2,048 records. Settings provides a
redacted view and confirmation-gated clearing while retaining an
`audit-cleared` marker. A corrupt, blocked, or unavailable audit store closes
all new write admission with `audit-unavailable`.

Grant changes use audit intent, persisted grant revision, and audit activation.
Incomplete changes do not grant authority and are reconciled on startup.

## In-process error semantics

The Developer API does not expose CLI exit codes. Expected failures resolve to
typed result discriminants or mutation result states. Implementations convert
unexpected internal exceptions into `internal-error` when a valid bounded
result can still be produced.

Known structured errors retain the shared Runtime API V1 action and retry
policy. Important channel meanings are:

| Condition | Error | Caller behavior |
| --- | --- | --- |
| Runtime API range does not overlap | `unsupported-version` | Upgrade or select a compatible API |
| Host is mobile/non-desktop, or desktop platform is outside the channel contract | `unsupported-platform` | Fix the environment; do not retry |
| Operon is present but the accessor is unavailable | `handler-unavailable` | Fix the integration environment |
| Runtime has not settled | `live-settling` | Wait for the bounded retry delay, then repeat the read |
| Requested capability is not available | `capability-unavailable` | Rediscover; method presence is not support |
| Capability was not requested or authority is absent | `authority-insufficient` | Request authority; do not retry automatically |
| User denied or cancelled plan consent | `consent-denied` | Stop; do not retry the same plan |
| Durable security audit is unavailable | `audit-unavailable` | Fix the environment before any new write |
| Durable recovery cannot be guaranteed before dispatch | `receipt-store-unavailable` | Wait and retry the unchanged apply; no mutation started and no recovery metadata is returned |
| Fresh user confirmation is required | `confirmation-required` | Use the Operon-owned consent flow |
| Exact acknowledgement is required | `acknowledgement-required` | Use the Operon-owned consent flow |
| Apply may have started without a final outcome | `outcome-unknown` | Recover the same Developer API plan only |

Unknown additive error codes mean stop and inspect. They never authorize retry,
mutation, consent substitution, preview replacement, or recovery.

## Stage ownership and acceptance

Stage 4 owns and tests:

- exact registry-instance consumer identity;
- persisted grants and exact capability scopes;
- version suspension, consent, and immediate revocation;
- destructive-operation admission;
- privacy-bounded audit records, retention, reconciliation, atomic terminal
  finalization, and audit-failure behavior;
- enabling only Developer API mutation capabilities admitted through this
  boundary;
- caller-controlled security-value rejection and stale/forged-handle refusal;
- dispatch-before-revoke refusal and dispatch-after-revoke same-plan recovery.

Stage 5 completed:

- complete mutation-family behavior through this channel;
- receipt, postflight, uncertain outcome, restart, and recovery acceptance;
- discriminated mutation input types and consumer-bound durable recovery
  references.

Stage 8 owns distributable integration guidance and clean-room examples.
Stage 9 owns release hardening and the final local contract freeze. External
developer feedback is a post-release program and is not a pre-publication gate.

The same-renderer JavaScript realm is not a cryptographic sandbox against a
malicious Obsidian plugin. The supported boundary is registry verification,
least privilege, unforgeable-in-practice object handles, stale-session
rejection, durable audit, and explicit user control.
