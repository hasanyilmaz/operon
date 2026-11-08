# Task creation V1 extension

This opt-in extension exposes the Plugin's Inline Tasks, File Tasks and Task Router policy and creates one task using those rules. `contractVersion` and `runtimeApi` remain `1`. Frozen base V1 schemas, existing capabilities, batch creation and existing sealed plans keep their meanings.

| Capability | Availability | Channels |
| --- | --- | --- |
| `tasks.creation-policy.read` | Runtime ready | Native transport, Developer API |
| `tasks.create.routed.preview` | Runtime ready with creation provider | Native transport, Developer API |
| `tasks.create.routed.apply` | Runtime ready with creation provider | Native transport, Developer API |

Discover capabilities before requesting access. A schema-valid reserved plan without `creation` execution evidence is never executable. CLI client support is deferred until after Plugin publication; the Plugin provider does not wait for a CLI release.

## Policy and routing

Read `tasks.creation-policy.read` with `kind: "task-creation-policy"` and `consistency: "live-verified"`. It performs no note, template or settings writes and returns a detached, bounded policy projection. Two fresh projections must agree.

- `defaultRepresentation` supplies the configured Inline/File default.
- `inline.configuredSaveMode` is the selected setting; `saveMode` reports the Plugin's effective UI mode, including its historical unavailable-Daily fallback. Routed creation deliberately refuses an unavailable selected periodic destination instead of silently writing elsewhere.
- `active-file` and `ask-every-time` require an exact target unless an explicit parent resolves placement through existing parent rules. The Runtime never guesses the active editor.
- Daily and Weekly availability, source, folder, format, note template and File Task container preference are reported separately. Core Daily Notes is a Daily-only provider.
- File folder, pipeline and parent placement, display title and filename formatting use the existing Plugin resolvers. Explicit paths remain exact. Existing title editing/rename capabilities are separate.
- Template candidates/default IDs use the Plugin catalog. Missing selections are not silently replaced. `exclusions` includes configured exclusions and the template folder.

`policyRevision` describes configuration, not an approval token. Clients must let preview resolve the destination and must not reproduce Plugin routing rules.

## Single-task preview

Send `tasks.create.routed.preview`, `mutationKind: "task.create"`, and one `spec.item` containing `title`, typed `fields`, `target` and `template`. Existing status/priority IDs, tags and relationship inputs retain their meanings.

Targets: `configured-default`, `exact-path` (Inline or File), or `periodic-note` (Daily/Weekly Inline). Exact File paths do not accept line numbers. Periodic targets do not accept explicit parents or note bodies; the Plugin prepares and binds the periodic container. Date precedence is explicit route date, effective scheduled date, local start-datetime date, then captured local today. Inline template dates participate in this resolution.

Template modes: `configured`, `selected` with a catalog ID, or `none`. Inline templates contribute properties, never their note body. Shared Creator source precedence, list merging, type checks and key mappings apply; explicit request values are user edits. Optional `nativeProperties: [{sourceName, value}]` supplies typed native values without creating a custom key mapping. Managed fields must use their existing typed inputs. Type/mapping conflicts block preparation; unsupported skipped properties are listed with reasons. Templater does not run, and Runtime creation does not change last-used-template preferences.

Preview performs zero writes. `createEffects` identifies the final task/path/line and parent relationships. `creation` adds:

- `resolvedFields`, `resolvedTags`, typed `nativeProperties` and selected `templateId`;
- skipped fields and reasons;
- `periodicRoute`, including existing/new note evidence, prepared content and container registration;
- policy, template, material and graph bindings, generated identity allocations and any native definitions to register.

The Developer API exposes the same visible result as `creation` alongside an opaque plan handle. It never accepts a caller-supplied wire plan.

## Apply, retry and recovery

Native transport uses `mutation.apply` with the exact returned plan, original idempotency key, required authorization and acknowledgements. Developer consumers request exact preview/apply grants through `getTaskCreationDeveloperApiV1` and call `mutations.preview`, `apply`, `recover` and `pendingRecoveries` with session-owned handles or durable recovery references.

Before a fresh write, the Plugin rebuilds the plan against current policy, templates, types, sources and identity reservations. Drift requires a new preview; apply never redirects an old plan. The existing graph journal/receipt engine owns execution. A repeated successful apply replays its receipt. Uncertain results require recovery of the same plan, not a new create request. Expired plans can only recover existing matching durable evidence.

Native definition registration is the first guarded journal step. It selectively updates the existing property registry through settings CAS, preserving unrelated settings and pending edits. When needed, it uses the already-existing typed-property package version and backup-before-write mechanism; this extension adds no new settings schema. Task source compensation keeps added definitions because other notes may already depend on their interpretation. Failed/uncertain results disclose this retention. Verified compensation returns `recoveryOutcome: "compensated"`; opaque sessions then close their durable recovery entry. If finalization is uncertain, recovery remains required.

## Validation

`npm run agent-runtime:task-creation-extension:test` checks schema drift/decoders, policy projection, shared template preparation, actual Plugin preparation/apply methods against synthetic IO, journal binding, periodic routing, grant/session boundaries and recovery. Native transport, receipt store and storage persistence suites cover their real provider boundaries separately. The extension manifest pins schema bytes and unchanged base-contract identities.

`examples.json` contains policy and preview requests. Apply uses the exact live preview output; example placeholders must never be substituted for a real sealed plan. Publication and the later CLI update are separate stages.
