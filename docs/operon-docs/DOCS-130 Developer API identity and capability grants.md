---
Notes: Understand registry-derived plugin identity, exact capability requests, user approval, suspension, and revocation
Icon: key-round
Color: "#059669"
Updated: 2026-08-21T16:12:57
---

# Developer API identity and capability grants

> **Maturity:** Public Developer API identity and grants · Obsidian Desktop · Runtime API V1

Operon derives a Developer API consumer's identity from Obsidian and grants only the exact capabilities the user approves.

## Identity comes from the host

Call `getDeveloperApiV1` with your actual enabled plugin instance:

```ts
const access = operon.getDeveloperApiV1(this, {
  contractVersion: 1,
  runtimeApi: { min: 1, max: 1 },
  requestedCapabilities: [
    "tasks.read",
    "tasks.update.preview",
    "tasks.update.apply",
  ],
});
```

The public consumer type contains only `manifest.id`, `manifest.name`, and `manifest.version`, but those strings are metadata. Operon verifies that the object itself is the current instance in Obsidian's enabled plugin registry. A fabricated object, a disabled instance, or an instance left over from a reload is refused.

The persistent consumer identity is the plugin ID. Operon also creates a new instance epoch for each plugin load and a new session ID for each successful connection. Callers cannot supply or override any of these values.

## Task workflow extension grants

Saved-filter reads, inline-task adoption, and periodic-note creation/update are on the additive `getTaskWorkflowDeveloperApiV1()` accessor, not the frozen base `getDeveloperApiV1()` accessor. Ask that accessor for exactly the task-workflow capabilities your feature needs:

```ts
const workflowAccess = operon.getTaskWorkflowDeveloperApiV1(this, {
  contractVersion: 1,
  runtimeApi: { min: 1, max: 1 },
  requestedCapabilities: [
    "tasks.filter-query",
    "tasks.adopt.preview",
    "tasks.adopt.apply",
    "tasks.create.periodic-note.preview",
    "tasks.create.periodic-note.apply",
    "tasks.update.periodic-note.preview",
    "tasks.update.periodic-note.apply",
  ],
});
```

| Capability | Allows |
| --- | --- |
| `tasks.filter-query` | Evaluate one saved FilterSet against the live task index. |
| `tasks.adopt.preview` | Preview adoption of one exact inline source line. |
| `tasks.adopt.apply` | Apply or recover the sealed adoption plan from that preview. |
| `tasks.create.periodic-note.preview` | Preview one typed Daily or Weekly inline-task creation. |
| `tasks.create.periodic-note.apply` | Apply or recover that sealed periodic creation. |
| `tasks.update.periodic-note.preview` | Preview one scheduled-date periodic parent update. |
| `tasks.update.periodic-note.apply` | Apply or recover that sealed periodic update. |

The capability names, order, and uniqueness are exact. A request for any unsupported name, duplicate, or out-of-order subset is refused. The user reviews the same exact requested set in **Settings → Operon → Core → General → Developer API Integrations**. Base Developer API grants do not imply these extension grants, and extension grants do not widen the base API.

## Exact capability grants

Every non-discovery read and every mutation requires an exact grant. Effective session scope is the intersection of:

1. capabilities requested by the consumer;
2. capabilities approved by the user;
3. capabilities currently live in Operon.

Operon does not silently open a partially authorized session. If any requested capability lacks authority, access fails with `authority-insufficient` and the request is recorded as pending.

Unknown capability names are rejected. Method presence is not proof of support or authority. After access succeeds, use `api.hasCapability(name)` and the capability advertisements to confirm the live session scope.

## Read-projection extension grants

`getReadProjectionDeveloperApiV1()` is an additive read-only extension. It accepts only the following canonical, ordered, unique capability list: `read-projection.system.diagnostics`, `read-projection.tasks.finder`, `read-projection.entities.resolve`, `read-projection.relationships.read`, `read-projection.context.build`, and `read-projection.timers.read`. These are dedicated Developer API grant identities; they map to the corresponding Runtime read capability but are not interchangeable with the frozen base API capability names. The extension has no discovery-only bypass: even diagnostics needs its exact extension grant.

The access request is all-or-nothing. A pending `read-projection.context.build` request does not expose `read-projection.entities.resolve`, and an approved finder grant does not imply relationships or timers. Operon re-checks the live consumer instance, lifecycle, grant and capability before dispatch and after the awaited Runtime call, immediately before returning the projected DTO. A reload, revocation or Runtime transition during an in-flight read therefore returns `authority-insufficient` instead of forwarding a result under stale authority.

Read-projection request IDs are correlation values only. The extension sends a sealed snapshot of the caller request to the Runtime and accepts a result only when its `requestId` matches. It does not turn a request ID into an identity, consent or idempotency claim.

## User approval

The first ungranted request does not open a modal. The user reviews it in **Settings → Operon → Core → General → Developer API Integrations**.

That section shows the registry-derived plugin name and ID, its version, the pending exact capabilities, and the current grant state. The user may approve selected capabilities, deny a pending request, inspect an active grant, or revoke it. Ask for the smallest set your current feature needs, and request a new capability only when that feature is introduced.

After approval, open a new Developer API session. A failed access result does not later become active by itself.

## Version changes

Patch and minor consumer updates keep the approved scope. A major version change, invalid version, or version regression suspends the grant. The user must review the pending scope before access resumes. New capabilities always require separate approval, regardless of version.

The channel status reports `pending`, `active`, `suspended`, or `revoked`, along with the grant revision and the requested, granted, and effective capability lists.

## Revocation and stale sessions

Revocation increments the grant revision. Existing sessions and plan handles that have not reached dispatch become invalid immediately. New reads, previews, and applies are refused.

If a mutation had already reached dispatch, revocation does not erase its recovery evidence. Only the same registry-verified consumer may recover that same operation. This exception continues an existing uncertain mutation. It does not grant authority for a new one.

Developer API access and mutation preview, apply, and recovery inputs must not add an identity claim, grant token, authorization reason, consent token, acknowledgement, correlation ID, or idempotency key. Operon owns those values and rejects attempts to use caller-controlled values as authority. Runtime read DTOs still require a caller-generated `requestId`; that identifier is not an authority or idempotency claim.

## FAQ

**If one requested capability is not approved, do I get a partial session?** No. Effective scope is the intersection of what you requested, what the user approved, and what is live, and Operon will not quietly open a half-authorized session. Access fails as insufficient authority and the request is recorded as pending, so the user can review exactly what was asked for.

**Does the user see a prompt at the moment I request access?** No, there is no modal. The request waits in Operon's settings, under Developer API Integrations, where the user can see your plugin's registry name, id, and version alongside the exact pending capabilities. After approval, open a new session; a failed access result never turns active on its own.

**What happens to my grant when I ship an update?** Patch and minor releases keep the approved scope. A major version change suspends the grant, and so does a version that regresses or that cannot be parsed at all. In each case the user reviews the pending scope before access resumes, and any newly requested capability needs its own approval regardless of version.

**Can a grant be suspended for a reason unrelated to my version?** Yes. If the security audit could not complete a grant activation, the grant is suspended on that basis until it is resolved. The channel status names the current state, so read it rather than assuming a suspension is about your release.

**What happens to work in flight when a grant is revoked?** The grant revision changes, and sessions and plan handles that have not reached dispatch become invalid at once. A mutation that had already been dispatched keeps its recovery evidence, and only the same registry-verified consumer may continue that one operation. That is a way to finish something uncertain, not a way to start something new.

**Can I supply my own identity, consent, or idempotency values?** No. Those fields belong to Operon, and mutation input containing host-owned fields is rejected as an invalid request rather than being ignored. The one identifier you generate is the `requestId` on Runtime read DTOs, which is a correlation value and not a claim of authority.

**Can I ask `getDeveloperApiV1()` for a task-workflow capability?** No. The base accessor remains unchanged and rejects adoption and periodic-note extension capabilities. Request them through `getTaskWorkflowDeveloperApiV1()` instead.

**Do base read grants cover the read-projection extension?** No. The extension requests its own exact six-capability vocabulary through `getReadProjectionDeveloperApiV1()`. It is deliberately separate so that frozen base API consumers do not gain a new surface by accident.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-129 In-process Developer API overview|In-process Developer API overview]]
- [[DOCS-131 Developer API reads and typed mutations|Developer API reads and typed mutations]]
- [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors and audit]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
