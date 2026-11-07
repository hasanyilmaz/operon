# Task creation V1 extension

This opt-in extension describes the Plugin's Inline Tasks, File Tasks and Task Router configuration. `contractVersion` and `runtimeApi` remain `1`. The frozen base V1 schemas, existing capabilities, batch creation and sealed plans are unchanged.

| Capability | Stage 1 availability | Channel |
| --- | --- | --- |
| `tasks.creation-policy.read` | Available while Runtime is ready | Native transport and Developer API |
| `tasks.create.routed.preview` | Contract only | Reserved; not dispatched |
| `tasks.create.routed.apply` | Contract only | Reserved; not dispatched |

Always discover capabilities first. Schema validity does not imply execution support. A request for the reserved mutation grant is rejected; no mutation methods are exposed by the Stage 1 Developer API.

## Read policy

Use the existing native `catalog` command with the new request kind:

```json
{"contractVersion":1,"requestId":"creation-policy-example","kind":"task-creation-policy","consistency":"live-verified"}
```

The standard CLI invocation envelope, vault binding, compatibility, readiness and transport size limits still apply. The result has `kind: "task-creation-policy-result"`, `ok`, and either `policy` plus `policyRevision`, or the existing structured `error`. No raw settings package is exposed. Existing catalog requests retain their original response shape.

For another Plugin, call `getTaskCreationDeveloperApiV1(consumerPlugin, { contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.creation-policy.read'] })`, obtain the exact user grant through the existing Developer API workflow, and then call `access.api.creation.readPolicy(request)`. Access is checked before and after asynchronous reads; a revoked grant or replaced consumer cannot use a retained API object. Requesting access may use the existing pending-grant workflow. Reading a granted policy never creates a note, changes settings, processes a template or remembers a selection.

## Policy meanings

- `defaultRepresentation` is the Task Creator's configured inline/file default.
- `inline.configuredSaveMode` records the selected setting. `inline.saveMode` comes from the same effective-mode resolver as Plugin creation. In particular, disabled Daily Notes can yield the existing `specific-file` fallback, while disabled Weekly Notes remain selected and unavailable. This read does not introduce a new fallback. Explicit Daily/Weekly creation in the future routed executor must still validate its requested target.
- `requiresExplicitTarget` describes active-file and ask-every-time destinations. Agents must not guess the active Obsidian file. `targetFile`, `heading` and parent-placement modes describe the configured destination, not a resolved promise to write there.
- `periodic.daily` and `periodic.weekly` report effective provider configuration, availability and reasons. Core Daily Notes is only a Daily fallback. `available` describes configuration availability, not proof that a future target/template file can be created or read.
- `file` reports the default folder, pipeline folder rules, parent placement and the existing display-title/filename policy. The Plugin resolves precedence against the actual task; clients must not calculate a target path from this metadata. Existing catalog key mappings, defaults, pipelines and field definitions remain authoritative for those domains.
- `templates` lists the same built-in/folder options and default IDs as Plugin creation. A missing default ID is preserved for diagnosis, not silently replaced. Candidates are choices, not certification that template contents are supported. Inline templates provide properties only. Templater is not executed and Runtime does not remember the last selected template.
- `exclusions` includes explicit excluded folders and the implicit template-folder exclusion. Existing task/path validation still applies.

`policyRevision` hashes the canonical policy projection, not template contents or note revisions. A read compares two fresh projections and fails with `live-settling` when they differ. It is not an executable approval token. Future previews must additionally bind all relevant source, template, definition and generated-identity revisions.

## Reserved single-task creation contract

The `previewRequest`, `sealedPlan`, `applyRequest`, `previewResult` and `mutationResult` schema entrypoints define the separate routed creation family. Exactly one `spec.item` is accepted. It contains a human `title`, typed `fields`, a `target`, and an explicit template mode (`configured`, `none` or `selected`). Targets are configured default, exact path, or explicit Daily/Weekly inline placement. An exact file target does not accept a line number. Periodic targets do not accept an explicit parent or note body; the Plugin owns the periodic parent relationship. A selected template uses its catalog ID.

See `examples.json` for read and reserved preview inputs. The existing typed create fields and authorization rules apply. A reserved plan binds the new spec and `policyRevision` in its own hash; base V1 apply does not accept it. Decoding a plan checks shape and bindings only and never makes it executable. No Stage 1 code issues a routed plan, admits it to mutation execution, or changes old plan meanings.

Developer mutation signatures use opaque plan handles and trusted intents, following the existing Developer API boundary; caller-supplied wire plans are not exposed there. These signatures are reserved and absent from the current accessor. Execution, preparation, preview/apply recovery and the complete result evidence are Stage 2 work.

## Validation and publication

`npm run agent-runtime:task-creation-extension:test` checks generated schema drift, strict decoding, policy projection, lifecycle/grant guards and the reserved contract. Native transport tests exercise the real dispatcher with synthetic data. The extension manifest pins schema bytes and the unchanged base-contract identities.

CLI implementation is deferred until the Plugin release. Its later update must consume this policy and delegate preview/apply resolution to the Plugin. Stage 1 is not a release and does not make the reserved mutations available.
