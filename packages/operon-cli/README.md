# Operon CLI

`operon-cli` is the official command-line client for Operon's live Agent
Runtime inside Obsidian Desktop. It reads Operon's live index and sends reviewed
mutations back through Operon. It does not maintain a second task database.

The package also distributes the type-only Runtime API V1 contracts used by
Obsidian plugin developers. It is not a JavaScript SDK.

## Requirements

- Obsidian Desktop 1.12.2 or later, already running
- Operon 3.0.0 or later with Agent Runtime API V1; Operon 3.0.1 or later is required for Windows mutation use
- The official Obsidian CLI enabled
- Node.js 22, 24, or 26

| Platform | Public V1 status |
| --- | --- |
| macOS | Supported |
| Native Linux | Public beta, best-effort |
| Windows 11 | Public beta, best-effort |
| WSL | Unsupported |

Linux and Windows transport paths are implemented and covered by hosted
portability tests, but they have not completed the optional native desktop
certification matrix. Please report real-environment results using the feedback
checklist below.

All read-only Runtime commands use the authenticated persistent transport when
the desktop server is available, including capability, diagnostics, catalog,
entity, task, finder, relationship, context, and timer reads. Mutation preview
and apply remain on the one-shot path so their consent, dispatch, and recovery
semantics stay separate from read batching.

## Install

```bash
npm install --global operon-cli
```

Public npm installation becomes available only after the package is published.
Before then, release-candidate testing must use the exact tarball supplied by
the Operon release process.

Operon never starts Obsidian automatically. Start Obsidian, open the intended
vault, and keep it running before using live commands.

## Set up and verify

```bash
operon setup
operon doctor --live
operon health
operon capabilities
```

`setup` stores an owner-only local profile for the selected vault. `doctor`
checks the executable, profile, storage, transport, Runtime compatibility, and
platform security boundary. Use `operon doctor --json` when attaching
diagnostics to a bug report.

The official Obsidian CLI addresses vaults by folder name. If two registered
vaults have the same folder name, rename one before setup so Operon can fail
closed instead of routing ambiguously.

## First safe read

Human-readable output is the default:

```bash
operon task get --id <operon-id>
```

Scripts should request the complete machine-readable envelope:

```bash
operon task get --id <operon-id> --json
operon query --input query.json --json
operon session --jsonl
```

Run `operon --help`, `operon task --help`, or
`operon help session` for the installed command reference.

## First safe mutation

Preview an exact update without applying it:

```bash
operon task update --id <operon-id> note::"Reviewed" --preview-only --json
```

The result includes a local `planRef`. Review and apply that same unchanged
plan:

```bash
operon plan show <planRef>
operon plan apply <planRef> --json
```

Do not reconstruct a plan, retry apply with a new plan, or treat a preview as
authority. Consent, authorization, acknowledgements, correlation, and
idempotency are owned by Operon and the CLI channel.

## Recovery

If apply may have reached Runtime, the CLI exits with code `5`, reports
`outcome-unknown`, and returns the same `planRef`. Continue only through:

```bash
operon plan recover <planRef> --json
```

Recovery evidence is retained for 24 hours. A pre-dispatch interruption exits
with `130` and has no recovery plan. Read and preview transport failures do not
carry mutation recovery metadata.

## Type-only Developer API contracts

Install the CLI package as a development dependency in an Obsidian consumer
plugin:

```bash
npm install --save-dev operon-cli
```

Import only public types:

```ts
import type {
	OperonDeveloperApiAccessorV1,
	OperonDeveloperApiV1,
} from 'operon-cli/contracts/v1/developer-api';
```

These entrypoints export declarations only. Runtime imports, `require()`, raw
mutation requests, validators, transports, stores, and helper SDK functions are
intentionally unavailable.

The packaged
[`examples/developer-api-consumer`](./examples/developer-api-consumer/README.md)
plugin demonstrates registry-derived identity, capability grants, exact reads,
typed preview/apply, receipt replay, and restart-safe `recoveryRef` recovery.

## Full documentation

- [Agent Runtime overview](https://github.com/hasanyilmaz/operon/blob/main/docs/operon-docs/DOCS-118%20Operon%20Agent%20Runtime%20overview.md)
- [Install and verify the CLI](https://github.com/hasanyilmaz/operon/blob/main/docs/operon-docs/DOCS-119%20Install%20and%20verify%20Operon%20CLI.md)
- [Changing tasks safely](https://github.com/hasanyilmaz/operon/blob/main/docs/operon-docs/DOCS-122%20Changing%20tasks%20safely.md)
- [Troubleshooting and recovery](https://github.com/hasanyilmaz/operon/blob/main/docs/operon-docs/DOCS-124%20Troubleshooting%20and%20recovery.md)
- [In-process Developer API overview](https://github.com/hasanyilmaz/operon/blob/main/docs/operon-docs/DOCS-129%20In-process%20Developer%20API%20overview.md)
- [JSONL sessions for scripts and agents](https://github.com/hasanyilmaz/operon/blob/main/docs/operon-docs/DOCS-133%20JSONL%20sessions%20for%20scripts%20and%20agents.md)

The installed CLI manifest and Runtime capability discovery remain authoritative
when documentation and a live environment disagree.

## Linux and Windows feedback

Open a [GitHub issue](https://github.com/hasanyilmaz/operon/issues) with this
redacted checklist:

```text
Operating system and build:
Architecture:
Obsidian Desktop version:
Node and npm versions:
Operon and operon-cli versions:
Command category:
Structured error code or exit code:
Could mutation dispatch have started:
Was a planRef returned:
Minimal reproduction:
Redacted operon doctor --json:
```

Never publish task content, vault paths, request payloads, consent material,
authentication secrets, plan files, or recovery-store contents.

## License

GPL-3.0-or-later
