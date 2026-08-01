# Operon Public V1 Scope and Success Criteria

## 1. Authority and status

This document is the normative product boundary and support matrix for the
first public stable Operon Runtime and CLI release. When another architecture,
evaluation, roadmap, package, or documentation source describes a conflicting
future Public V1 boundary, this document takes precedence.

This document distinguishes current implementation truth from the Public V1
launch target. A target in this document is not evidence that the capability or
platform is supported today. Current manifests, schemas, package metadata, and
Runtime discovery remain authoritative until the corresponding acceptance gate
has passed.

Public V1 launch versions:

- Operon `3.0.1`
- `operon-cli@1.0.3`
- Runtime API and contract version `1`

The current CLI is a private release candidate and is not publicly installable
from npm. Public npm publication is the final release action after Stages 1–9
and the Stage 10 pre-publication checks have passed. Registry verification and
the post-publication audit complete Stage 10 after that single publish action.

## 2. Public product model

Operon Public V1 has one versioned Runtime domain contract and two supported
access channels.

| Public channel | Supported consumers | Public responsibility |
| --- | --- | --- |
| `operon` CLI | Humans, local agents, skills, scripts, and command-line integrations | Portable discovery, terminal and JSON commands, vault profiles, owner-controlled local plans, apply and recovery commands, and shell-facing diagnostics |
| In-process Developer API | Obsidian plugin developers running inside the same Obsidian Desktop process | Typed access to Runtime health, capabilities, diagnostics, Catalog, entity resolution, tasks, relationships, Context, timers, and controlled mutation preview and apply |

The two channels share domain DTOs, capability identifiers, lifecycle
semantics, error meanings, consistency requirements, mutation specifications,
sealed-plan guarantees, receipts, and recovery rules. They do not share the
same transport or trust boundary.

The Developer API does not expose CLI profiles, CLI configuration, the CLI
plan store, shell completion, terminal interaction, or CLI convenience
commands. It also does not expose mutable Operon internals such as indexers,
writers, stores, queues, or source objects.

Direct Markdown editing remains a human-supervised Operon workflow, not a
versioned Public V1 integration contract.

## 3. Current state and Public V1 target

| Area | Current implementation truth | Public V1 launch target |
| --- | --- | --- |
| Operon release | Operon `3.0.0` is publicly released with Runtime API V1; Operon `3.0.1` is the local Public V1 patch candidate | Operon `3.0.1` |
| CLI package | Local `operon-cli@1.0.3` stable release candidate; not published to public npm | Public stable `operon-cli@1.0.3` |
| Runtime contract | Runtime API V1 exists and is exposed on the Operon plugin instance | Runtime API V1 is a supported, typed Developer API contract |
| Public access channels | The in-process Developer API ships with Operon `3.0.0`; the CLI and the Windows mutation reliability patch remain unpublished local release candidates | CLI and in-process Developer API are both supported public channels |
| macOS CLI | Supported by the current beta boundary | Supported |
| Linux CLI | `acceptance-required` | Public beta and best-effort on native Linux |
| Windows CLI | `acceptance-required` | Public beta and best-effort on Windows 11 |
| WSL | `unsupported` | Outside Public V1 |
| Mobile | Operon itself is not desktop-only, but Runtime mutation admission and the CLI are desktop-bound | Public CLI and Developer API are desktop-only |
| npm | No approved public package | Published only after Stages 1–9 and the Stage 10 pre-publication checks accept the immutable release candidate |

For Linux and Windows, `acceptance-required` is an executable public-beta
status, not a refusal. It means that the cross-platform implementation and
hosted portability gates have passed, but Operon does not claim native
certification for a particular distribution, OS build, hardware architecture,
or desktop environment. Those platforms remain `acceptance-required` at
launch; user feedback may support later promotion to `supported`.

## 4. Support matrix

### 4.1 Public V1 environment

| Requirement | `operon` CLI | In-process Developer API |
| --- | --- | --- |
| Operon | `3.0.0` or a compatible later release advertising Runtime API V1 | `3.0.0` or a compatible later release advertising Runtime API V1 |
| Obsidian | Desktop `1.12.2` or newer | Desktop `1.12.2` or newer |
| Running Obsidian | Required | Required by definition because the consumer runs in the same process |
| Enabled Operon plugin | Required | Required |
| Official Obsidian CLI | Required and enabled | Not required |
| Node.js | Major `22`, `24`, or `26` | Not applicable to the public contract |
| Runtime contract | Version `1` plus the required advertised capabilities | Version `1` plus the required advertised capabilities |

New Node major versions are unsupported until they pass hosted CI portability
and package acceptance. Optional native certification remains separate. A broad
`>=22` engine declaration alone is not a Public V1 support promise.

Operon `3.0.0` remains the compatible Runtime API V1 floor. Operon `3.0.1` is
the required release artifact for hosted Windows mutation acceptance and the
initial public CLI candidate because it fixes platform-safe vault path
admission for file and inline task writes.

### 4.2 Desktop operating systems

| Platform | Public V1 support commitment | Required release evidence |
| --- | --- | --- |
| macOS | Supported on the three most recent Apple-supported macOS releases at release-candidate freeze | Hosted macOS portability on Node 22, 24, and 26, plus the existing disposable-vault live acceptance and package gates |
| Linux | Public beta and best-effort on native Linux; Ubuntu 24.04 LTS and Ubuntu 26.04 LTS are reference targets, not certified environments | Hosted Ubuntu portability on Node 22, 24, and 26, contract/package tests, and Linux transport-security tests |
| Windows | Public beta and best-effort on Windows 11 | Hosted Windows portability on Node 22, 24, and 26, contract/package tests, and Windows transport-security tests |
| WSL | Outside Public V1 | None |
| iOS and Android | Outside Public V1 for both public channels | None |

For Linux and Windows, best-effort means that compatibility with a particular
OS build, distribution, desktop environment, or machine is not a
release-blocking guarantee. No environment-specific live acceptance,
certification, or response-time commitment is provided. Reproducible reports
are accepted as public-beta feedback and may be addressed in a later patch or
support-matrix change.

The reference targets describe where the implementation is intended to work;
they do not assert that Operon tested every target on native hardware. Public
documentation and launch communication must disclose this distinction.

Headless hosts, containers without Obsidian Desktop, remote-only sessions, and
automatic Obsidian launch are not implied by desktop operating-system support.

## 5. Capability commitment

The stable V1 manifest contains only capabilities that have passed their
contract, security, compatibility, and cross-platform portability gates. Every
capability included in the stable V1 set is a stable compatibility commitment.
The Runtime families listed below are the minimum Public V1 launch set. If any
listed family is incomplete, Public V1 launch is delayed; it is not silently
removed. An additional capability outside this minimum set is excluded from
the stable V1 manifest rather than published there as a preview commitment.

Stage 5 produces the candidate stable capability set. Stage 9 freezes the
stable V1 manifest only after the trust and portability gates have also passed.
Optional post-release native certification can strengthen a platform support
claim, but it does not change Runtime capability stability.

Both public channels support the same production-gated Runtime families:

- Runtime health, lifecycle, compatibility, diagnostics, and capabilities
- Property Catalog and writable-policy discovery
- Entity resolution
- Exact task reads, bounded task queries, and Task Finder results
- Relationships and Context Packs
- Timer state
- Controlled task creation and updates
- Typed reminder changes
- Semantic lifecycle transitions
- Timer control and completed timer-session changes
- Pinned-state changes
- Recurrence changes
- Relationship changes
- Inline relocation
- Inline and File Task conversion
- Exact task deletion

Channel-specific presentation or convenience commands do not create additional
Runtime capabilities. Capability discovery is mandatory; a consumer must not
infer support from a package version, method presence, help text, or copied
command list.

## 6. Lifecycle and availability contract

Public consumers must be able to distinguish these conditions:

- Operon absent or disabled
- Operon present but the public accessor unavailable
- `booting`
- `cache-ready`
- `settling`
- `ready`
- `unloading`
- terminal startup failure

Reads are admitted only when their requested minimum consistency is available.
A lower-consistency result is returned only when the caller explicitly permits
it and the response carries truthful freshness information. Writes require
`ready`.

Unload closes admission synchronously. In-flight work receives only the
documented bounded drain and recovery guarantees; consumers must not assume
that Obsidian waits indefinitely for asynchronous teardown.

The Developer API accessor, TypeScript types, and exact unavailable-result
shape are specified in the Developer API implementation stage. They must
preserve the lifecycle distinctions above without exposing mutable plugin
internals.

## 7. Mutation and destructive-operation contract

Every public write follows the same safety sequence:

```text
typed intent
→ capability and authorization admission
→ sealed preview
→ exact-plan apply
→ receipt and postflight
→ same-plan recovery when outcome is uncertain
```

Apply accepts only the exact unchanged sealed plan. A timeout, interruption,
transport failure, partial result, or unknown outcome after apply begins must
not trigger automatic apply retry or a replacement preview.

The CLI may retain an owner-controlled local plan reference. The Developer API
does not gain access to that CLI store; it uses the Runtime-level sealed-plan
contract and its own supported consumer context.

No public write channel can launch until all of the following exist:

- Stable, channel-appropriate consumer identity
- Explicit requested capability scope
- Least-privilege authorization
- User-visible consent for elevated or destructive effects
- Fresh target-bound confirmation for destructive operations
- Audit records that identify the consumer, scope, target, plan, and outcome
- Tests proving that a consumer cannot escape its granted scope

The Stage 3 Developer API accessor must fail closed for writes until Stage 4
passes. Mutation method presence in TypeScript is not authorization:
write-capability advertisements remain unavailable and apply admission is
refused until the consumer identity and permission boundary is active.

For the CLI, identity includes the durable CLI client instance operating
through the owner-controlled transport. For the Developer API, identity must
bind the calling Obsidian plugin consumer independently of caller-provided
labels. The exact mechanisms are specified and tested in the trust-boundary
stage.

Deletion, File-to-Inline conversion, destructive timer-session removal, and any
other capability classified as destructive require fresh consent bound to the
exact target and sealed impact. Caller-supplied identity or authorization text
is not sufficient proof of permission on either channel.

## 8. Public V1 non-goals

The following are explicitly outside Public V1:

- Headless operation
- Offline Runtime or offline writes
- Automatic Obsidian launch
- Mobile Developer API
- WSL
- A separate SDK
- Generated Python, Go, or other language clients
- Subscriptions or event streams
- HTTP or MCP servers
- Remote or cloud API access
- A public website
- Arbitrary raw-field mutation
- Preset creation
- Exposing CLI profiles, local plan storage, or terminal helpers through the
  Developer API

Deferral does not prohibit later work. It means Public V1 compatibility,
support, documentation, and release acceptance do not depend on that work.

## 9. Launch-gate traceability

| Public commitment | Owning stage | Required evidence and completion checks |
| --- | --- | --- |
| Versioned schemas, manifest, errors, exit behavior, compatibility and deprecation rules | Stage 2 — Public contracts | [`contract-evolution-v1.md`](contract-evolution-v1.md), contract tests, schema/manifest parity, compatibility rules, and no unresolved breaking-change decision |
| Typed in-process accessor and distributable TypeScript types | Stage 3 — Developer API | Consumer compile tests, lifecycle/accessor tests, frozen DTO boundary tests, CLI/API contract parity, and proof that Developer API writes remain unadvertised and fail closed until Stage 4 |
| Consumer identity, authorization, consent, and audit | Stage 4 — Trust boundary | Scope-isolation, consent, destructive-operation, identity, and audit tests for both channels |
| Complete minimum candidate capability set | Stage 5 — Functional closure | Every read and mutation family listed in Section 5 passes contract, postflight, recovery, and capability-admission tests |
| Portable transport and platform security | Stage 6 — Cross-platform implementation | Platform-specific path, ownership, ACL/mode, symlink/reparse, IPC, shell, signal, Unicode, and interruption tests |
| Cross-platform launch boundary, Node support, and beta disclosure | Stage 7 — Cross-platform readiness | Hosted portability and package tests pass on Node 22, 24, and 26 across macOS, Linux, and Windows; platform-specific transport-security, path, lifecycle, interruption, and recovery tests pass; macOS remains `supported`, Linux and Windows remain executable `acceptance-required` public-beta targets, and WSL remains `unsupported` |
| Public integration guides and examples | Stage 8 — Packaging and documentation | Clean-room CLI and Developer API integration tests using only distributable artifacts and documentation |
| Stable contract and release candidate | Stage 9 — Hardening and freeze | No launch-blocking contract break, unauthorized access, consent bypass, data loss or corruption, or irrecoverable uncertain outcome remains; all required local contract, security, mutation, Developer API, package, documentation, and release-hardening gates pass; contract, stable manifest, package inputs, types, examples, documentation, source-rebuilt plugin artifact, and development-audit policy are bound by one exact local freeze index; the compatibility baseline has real input/response direction and deprecation coverage; documented maintainer acceptance seals the final local index |
| Public `operon-cli@1.0.3` | Stage 10 — External release | Before publish, the accepted Stage 9 freeze, final tarball digest, provenance, compatible public Operon artifact, and nine-cell hosted portability evidence pass on the release bytes; after publish, the registry artifact digest equals that tarball and the post-publication audit passes |

Failure of a required gate returns the work to its owning stage. Publication is
not a substitute for contract, safety, package, or hosted portability evidence.
Linux and Windows native-environment coverage is explicitly a disclosed
public-beta feedback program rather than a hidden missing release gate.

An external developer pilot is not a pre-publication acceptance gate. After
the external release, launch communication requests structured feedback from
CLI integrators and Obsidian plugin developers, especially for native Linux
and Windows environments. Reproducible reports are triaged under the normal
security, compatibility, and patch-release policies; the feedback program does
not weaken the Stage 9 local freeze or replace Stage 10 artifact verification.

## 10. Stage 1 completion criteria

Stage 1 is complete when:

- This document is accepted as the single Public V1 scope authority.
- CLI and Developer API consumers, shared contracts, channel-specific
  responsibilities, and separate trust boundaries are explicit.
- Current and target support states are not conflated.
- Every platform, version, lifecycle, mutation, and destructive-operation cell
  has a definitive policy.
- Every launch commitment maps to a later implementation stage and acceptance
  gate.
- There is no unresolved product-scope decision in this document.
- The architecture authority link resolves, targeted contradiction and
  open-decision scans pass, and the Stage 1 diff has no whitespace errors.
- Current manifests, schemas, package metadata, Runtime behavior, and public
  documentation remain unchanged.
- No npm publication, GitHub commit, push, tag, release, or upload has occurred
  as part of Stage 1.
