# Operon Runtime API V1 Contract Evolution

## Authority

This document is the normative evolution policy for Runtime API V1 and CLI
contract V1. The Public V1 scope remains authoritative for product and platform
commitments.

Operon `3.x` maintains Runtime API V1. `@stratejya/operon-cli` `1.x` maintains CLI
contract V1. Runtime and CLI compatibility are negotiated by advertised
contract ranges and capabilities, never by assuming that Operon and CLI
package versions are equal.

## Directional compatibility

Public V1 is directionally additive:

- Requests, authorization, configuration, mutation intent, apply requests,
  sealed plans, confirmation bindings, and recovery inputs are strict.
  Unknown fields are rejected.
- Responses, manifests, capability advertisements, structured error codes, and
  schema entrypoint inventories may add optional fields or new entries.
  Consumers ignore unknown optional data after enforcing size and prototype
  safety limits.
- An unknown capability is never evidence of support or authority.
- An unknown error code means stop and inspect. It never authorizes automatic
  retry, apply, preview replacement, or recovery.
- Existing control-flow enums, mutation states, exit meanings, field semantics,
  authorization requirements, sealed-plan bindings, and recovery rules do not
  change within V1.

Operon-specific `x-operon-*` keywords are annotations for generic Draft
2020-12 validators. Runtime admission and the official Operon validator remain
authoritative for those semantic constraints.

## Breaking changes

Any of the following requires Runtime API V2 or CLI contract 2:

- Removing or renaming an existing public field, command, capability, error, or
  schema entrypoint.
- Making an optional field required.
- Narrowing an accepted input type or range.
- Changing an existing field, capability, error, exit code, control-flow enum,
  mutation status, or default meaning.
- Weakening or expanding authorization, confirmation, sealed-plan,
  idempotency, receipt, or recovery semantics.
- Reclassifying a known failure in a way that changes safe caller behavior.

The contract compatibility classifier and fixtures enforce this list.

## Deprecation

A stable V1 item may be marked deprecated in a minor release. Deprecation is
additive metadata and does not remove or disable the item. A replacement is
named when one exists.

Removal is allowed only in Runtime API V2 or CLI contract 2. A security
response may make a capability unavailable while preserving its identifier and
returning an actionable structured error.

## Errors, exits, and recovery

The machine-readable error registry binds every known error code to its action,
retry policy, recovery policy, and exit class. Human-readable `reason` text and
unrecognized `details` fields are diagnostic only.

Unknown additive error codes use the safe fallback:

- action `do-not-retry`
- retry disabled
- no mutation authorization
- caller stops and inspects

After apply dispatch, timeout, interruption, transport loss, malformed output,
or another missing definitive result is `outcome-unknown`, exits `5`, and
requires recovery of the same `planRef`. Read and preview transport failures
exit `3` and never carry recovery metadata.

## Manifest stability

Every item in a stable V1 manifest has `stability: "stable"`. Preview items are
excluded rather than advertised in the stable manifest. Schema and entrypoint
digests are generated from canonical bytes; the aggregate Runtime contract
digest excludes the manifest itself.

Platform status is independent of schema stability. macOS is `supported`;
native Linux and Windows 11 are executable `acceptance-required` public-beta
targets; WSL is `unsupported`. The public-beta status does not weaken Runtime
API V1 or CLI contract V1 semantics.

## Pre-public cross-platform transport correction

Before native platform acceptance, the CLI transport was split into explicit
platform adapters while preserving Runtime API V1 and CLI contract V1 request,
result, exit, and recovery semantics. macOS continues to use an owner-only
request file and Unix domain socket. Native Linux uses the same POSIX security
model with a verified per-user runtime root. Windows uses an authenticated
named-pipe broker with owner-only descriptor storage, connection-bound HMAC
frames, one-shot staging, and fail-closed SID/DACL and reparse-point checks;
mutation payloads are not placed in process arguments or Windows request files.

Transport diagnostics gained only optional endpoint, security-backend,
persistent-availability, and failure-reason fields. The legacy diagnostic
fields remain available. The platform manifest change from Windows
`unsupported` to `acceptance-required` is a pre-public compatibility
correction. In the stable V1 launch contract, `acceptance-required` means the
platform is admitted as public beta and best-effort after hosted portability,
package, and platform-security tests pass. It is not a claim of native
certification for a particular OS build, distribution, architecture, desktop
environment, or machine. Linux and Windows may later become `supported` after
maintainer-approved native evidence and public-beta feedback; such promotion
is a support-policy change, not a Runtime capability grant. WSL remains
`unsupported`.

## Pre-public Stage 7 acceptance correction

The original Stage 7 plan required six self-hosted desktop references and 36
digest-bound native cells before public publication. Those environments are
not available for the first public release, so that plan is retained only as
optional future certification infrastructure and is no longer a V1 release
gate.

The replacement Stage 7 gate is the nine-cell hosted portability matrix:
macOS, Ubuntu, and Windows across Node 22, 24, and 26. It is combined with the
existing contract, package, transport-security, interruption, recovery, and
disposable-vault macOS acceptance suites. No hosted runner result is described
as native Obsidian certification. Linux and Windows remain
`acceptance-required`, and launch documentation must request feedback while
disclosing the absence of native-environment certification.

This correction changes a pre-public support promise and release process. It
does not change request or response DTOs, capability identifiers, error or exit
semantics, sealed-plan safety, authorization, receipt, or same-plan recovery.

## Pre-public npm namespace correction

The first public npm publication uses the user-scoped package identity
`@stratejya/operon-cli`. The earlier unscoped `operon-cli` candidate was never
published, and npm refused that global-registry name before accepting package
bytes. The executable remains `operon`; CLI commands, Runtime API V1, CLI
contract V1, exit meanings, recovery behavior, and type shapes are unchanged.

The manifest schema continues to recognize the unpublished legacy package name
for compatibility inspection, while canonical generators, installation
instructions, type-only imports, release evidence, and update discovery emit
the scoped identity. This correction replaces the unpublished compatibility
baseline and exact local freeze before a new immutable release tag is created.
After public publication, the scoped package identity follows the normal V1
breaking-change rules without this exception.

## Pre-public trust-boundary correction

Before the Public V1 freeze or any public npm release, the Developer API
accessor was corrected from a request-only shape to:

```ts
getDeveloperApiV1(consumerPlugin, request)
```

The structural consumer parameter is accepted only when it is the exact live
object in Obsidian's enabled plugin registry. Matching manifest fields are not
identity proof. The same pre-public correction added optional channel-status
consumer and grant summaries plus the `consent-denied` and
`audit-unavailable` error registrations.

These changes replace the unpublished Stage 3 baseline together across the
canonical schema, manifest, generated declarations, and compatibility fixture.
They are not a post-public V1 weakening or migration precedent. After the
Stage 9 freeze is accepted, the normal V1 compatibility and deprecation rules
above apply without this exception.

## Pre-public durable-recovery correction

Before the Public V1 freeze, mutation preview inputs were narrowed into
discriminated capability, kind, target, and spec variants. Developer mutation
plans also gained a host-minted opaque `recoveryRef`, plus redacted pending
recovery discovery and same-consumer recovery by that reference. Sealed plans,
authorization, acknowledgements, and idempotency state remain private.

This correction makes the already-required same-plan rule durable across an
Operon or consumer-plugin restart. It does not turn recovery into new mutation
authority: only a dispatch recorded for the same verified plugin ID can be
continued, and new preview or apply operations still require a current exact
grant. Pre-dispatch recovery-storage failures use
`receipt-store-unavailable`, carry no recovery metadata, and never imply that
a mutation may have started. The V1 registry classifies that error as a
wait-and-retry failure without same-plan recovery authority.

The correction updates the unpublished compatibility baseline, canonical
schema, generated declarations, and package copies together. After the Stage 9
freeze is accepted, these strict input shapes follow the normal V1
breaking-change rules.

## External-reference freeze and directional baseline

The compatibility baseline and the accepted external-reference freeze serve different
purposes.

- The compatibility baseline classifies evolution across the lifetime of V1.
  Schema definitions reachable from request or input entrypoints remain
  strict. Definitions reachable only from response entrypoints may gain
  optional fields. Shared input/response definitions use the stricter input
  rule. An unclassified schema path stops for manual contract review.
- A first deprecation announcement is additive metadata. Removing, rewriting,
  or using deprecation metadata to change an existing capability or error
  meaning is breaking. The manifest deprecation inventory is part of the
  baseline.
- Accepted external-reference freezes are append-only, versioned evidence for
  plugin releases. Every record binds the Runtime V1 digest, immutable
  published CLI binding and tarball, exact `main.js`, `manifest.json`, and
  `styles.css` identities, a clean dependency-audit result, and an explicit
  acceptance mode. The registry preserves the byte identity and evidence scope
  of every earlier accepted record.
- A release may use exact-pair hosted validation plus scoped plugin manual
  acceptance when the Runtime V1 digest is unchanged and the published CLI
  package is byte-identical to the validated candidate. Such evidence must
  state that the published-CLI live mutation suite was not rerun and that the
  CLI was not installed in the live vault. It must not inherit or relabel
  historical mutation-family results as current live acceptance.
- A release-only packaging composition may instead use automated validation
  when its diff introduces no new product behavior. This lane requires exact
  canonical local validation, clean audits, exact-commit hosted CI and CodeQL,
  and a zero-skip Windows Plugin-CLI pair bound to the same candidate and
  artifact aggregate. It must omit deployment and maintainer-acceptance claims,
  state that live deployment was not run, and make no new live-behavior claim.
- The standalone CLI release independently binds its registry and immutable
  GitHub artifacts, provenance, and hosted portability evidence. The plugin
  freeze consumes that published identity without rebuilding or republishing
  the CLI. Any change to a freeze-bound plugin asset or external CLI identity
  requires a new evidence record with its actual scope and a newly accepted
  external-reference freeze.

External integrator and plugin-developer feedback begins after release. It is
not a substitute for the accepted freeze or published-artifact checks.
