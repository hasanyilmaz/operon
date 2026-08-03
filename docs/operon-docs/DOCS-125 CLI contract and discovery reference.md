---
Notes: Discover and verify the public CLI contract, compatibility ranges, exit codes, and platform support
Icon: file-json
Color: "#059669"
Updated: 2026-08-03T10:31:15
---

# CLI contract and discovery reference

> **Maturity:** Public CLI discovery and compatibility · Obsidian Desktop · CLI contract V1

The exact, authoritative CLI contract lives in the package itself: `cli-manifest-v1.json` and the schemas under `schemas/v1/`. This page does not copy those in full. It shows how to read the authoritative data straight from the CLI and carries only small summaries that are verified against those sources.

For source history and release artifacts, see the [standalone Operon CLI repository](https://github.com/hasanyilmaz/operon-cli); the installed manifest and schemas remain authoritative for the version you are running.

## The source of truth

Two things define the contract, and both ship with the package:

- **`cli-manifest-v1.json`** lists every command, capability, mutation kind, projection, exit code, platform, and schema digest.
- **`schemas/v1/*.json`** are the request and result schemas; the manifest records the SHA-256 of each shipped schema.

When this page and the manifest ever disagree, the manifest is correct. Treat the summaries here as a map, not as the territory.

## Discover the contract yourself

Read the live, authoritative values from the CLI:

```bash
operon version --json
operon manifest --json
operon schema list --json
operon schema get mutation-preview-request --json
```

`version` reports the CLI and Node versions, `manifest` returns the full contract, `schema list` enumerates the schemas, and `schema get <id>` returns one schema. Anything a script needs to adapt to should come from these, not from a value pasted into a document.

## Compatibility

- **Runtime API:** V1 (accepts min 1, max 1)
- **CLI contract:** V1 (accepts min 1, max 1)

Compatibility is a range, not a package version comparison. The CLI declares the Runtime API and CLI contract ranges it can use. If the live Runtime does not overlap the required range, the CLI refuses before dispatch rather than guessing. Confirm the current ranges and installed versions with `operon version --json` and `operon manifest --json`.

## Command surface at a glance

Names only, grouped. Full descriptions and schemas are in `operon manifest --json`.

- **CLI-owned local and guided surface:** `version`, `manifest`, `schema list`, `schema get`, `setup`, `doctor`, `completion`, `profile list`, `profile default`, `profile remove`, `plan show`, `plan apply`, `plan recover`, `plan discard`, `task find`. `task find` belongs to this CLI-owned group but reads the live Runtime index.
- **Runtime reads:** `health`, `capabilities`, `diagnostics`, `catalog`, `entity resolve`, `task get`, `query`, `finder`, `relationships`, `context`, `timer state`, `mutation preview`, `mutation apply`
- **Convenience mutations:** `task create`, `task update`, `task complete`, `task reopen`, `task cancel`, `task pin`, `task unpin`, `task transition`, `task delete`, `task convert`, `task relocate`, `reminder add`, `reminder replace`, `reminder remove`, `timer session add`, `timer session update`, `timer session remove`, `timer start`, `timer stop`
- **Persistent machine protocol:** `operon session --jsonl`

The JSONL session is a bounded protocol rather than an ordinary one-shot command. Its allowed operations, ordered groups, and failure behavior are documented in [[DOCS-133 JSONL sessions for scripts and agents|JSONL sessions for scripts and agents]] and published under `sessionJsonl` in the manifest.

## Exit codes

This is the authoritative home for the exit codes referenced elsewhere:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Usage error |
| 3 | Read or preview transport, readiness, or dependency unavailable |
| 4 | Capability, compatibility, vault, authority, or policy refusal |
| 5 | Runtime operation failure, partial or unknown outcome, or recovery required |
| 70 | Internal error |
| 130 | Interrupted before dispatch, with no uncertain outcome |

Scripts should branch on the exit code rather than parsing text. After apply may have been dispatched, interruption, timeout, or transport loss is exit `5`, never `3` or `130`. See [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]] for what to do with each.

## Mutation kinds and projections

**Mutation kinds (12):** `task.create`, `task.update`, `task.recurrence`, `task.relationship`, `task.reminder-item`, `task.transition`, `task.pinned-state`, `timer.control`, `timer.session`, `task.convert`, `task.inline-relocate`, `task.delete`. Their behavior is described in [[DOCS-122 Changing tasks safely|Changing tasks safely]].

**Context projections (7):** `exact-task`, `task-neighborhood`, `project-analysis`, `planning-workload`, `creation-context`, `mutation-preview`, and `placement-candidates` (the live insertion points used for exact inline placement). When to use each is in [[DOCS-121 Reading tasks and building context|Reading tasks and building context]].

## Capability versions

The newer write features are each gated behind an advertised capability version that both the CLI and the live Runtime must agree on before the feature runs. The manifest advertises these per command under `convenienceContracts`, and every one is currently at version 1: compact and typed creation (`compactGrammarVersion`, `compactBatchVersion`, `typedCreateVersion`, `temporalCreateVersion`, `graphTransactionVersion`), direct updates (`compactUpdateVersion`, `compactUpdateBatchVersion`, `directRelationshipVersion`, `directRecurrenceVersion`), lifecycle and pin state (`directTransitionVersion`, `directPinnedVersion`), source transitions (`sourceTransitionRecoveryVersion`), reminders (`directReminderVersion`), and timer sessions (`directTimerSessionVersion`).

The compact batch contracts also publish their input format and upper bound. Create accepts `compact-lines` with one to 64 records; update accepts `compact-lines` with two to 64 records. The corresponding manifest fields are `compactBatchInputFormat`, `compactBatchMaxItems`, `compactUpdateBatchInputFormat`, and `compactUpdateBatchMaxItems`. If the CLI and Runtime advertise different versions or limits, the affected command fails closed rather than acting on a half-supported feature. Read the current values with `operon manifest --json`; do not rely on the list here staying exhaustive.

## Platform matrix

| Platform | Status |
|----------|--------|
| macOS (darwin) | Supported |
| Native Linux | Public beta / best-effort |
| Windows 11 (win32) | Public beta / best-effort |
| WSL | Unsupported |

The wire manifest reports native Linux and Windows as `acceptance-required`. In public documentation this means the transport is implemented and usable as public beta and best-effort, but the environment is not native-certified. `operon doctor` reports that status and requests actionable feedback.

## Schemas and digests

For every schema under `schemas/v1/`, the manifest records a SHA-256 alongside each schema entry point; the digest is manifest metadata, not a field stored inside the schema file. That is what makes the contract verifiable: you can fetch a schema with `operon schema get <id> --json` and check it against the digest the manifest records. Use `operon schema list --json` to see the available schema ids.

## FAQ

**If this page and the manifest disagree, which one is right?** The manifest, without exception. It ships with the package and describes the contract that is actually installed, while this page is a map written at one point in time. When something matters, confirm it with `operon manifest --json`.

**How do I tell whether the contract changed at all?** Compare the manifest's contract digest between runs. It is a single SHA-256 over the contract, so one value tells you whether anything moved without your having to diff the whole document. If it is unchanged, the surface you built against is unchanged.

**Are the schema digests stored inside the schema files?** No. Each digest is manifest metadata recorded alongside the schema entry point it covers. That is what makes verification meaningful: you fetch a schema with `operon schema get <id> --json` and check it against the digest the manifest published, rather than trusting a value the file carries about itself.

**How should a script decide what to do with an error?** Read the manifest's error registry rather than interpreting messages. For each error code it states the action to take, whether the error is retryable, whether recovery applies, and the exit class and code it maps to, so your handling stays correct even as wording changes.

**Are there size limits I should design around?** Yes, and they are published rather than implied. The manifest carries a limits block covering transport input and result sizes, identifier and cursor lengths, collection sizes, and batch bounds such as the maximum number of records one creation request accepts. Building against those numbers is safer than discovering them through a refusal.

**How will I know when something is being removed?** Through the manifest's deprecations list, which is empty today. A future removal is announced there first, which is why a client that reads the manifest at startup notices a deprecation before it becomes a breaking change.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]]
- [[DOCS-121 Reading tasks and building context|Reading tasks and building context]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-133 JSONL sessions for scripts and agents|JSONL sessions for scripts and agents]]
