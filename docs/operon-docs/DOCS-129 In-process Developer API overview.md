---
Notes: Connect an Obsidian plugin to Operon's typed in-process API and choose it instead of the CLI when appropriate
Icon: plug-zap
Color: "#059669"
Updated: 2026-08-21T16:12:57
---

# In-process Developer API overview

> **Maturity:** Public in-process Developer API · Obsidian Desktop · Runtime API V1

The In-process Developer API is Operon's public integration surface for another Obsidian plugin running in the same desktop application.

Use it when your plugin needs typed task reads or controlled mutations without launching the command-line client. Use `operon-cli` instead for terminal work, scripts, agents, and processes outside Obsidian. Both surfaces use Runtime API V1 and the same capability, mutation, receipt, and recovery rules, but their trust boundaries and public handles differ.

## What ships publicly

The package exposes type-only TypeScript entrypoints:

```ts
import type {
  OperonDeveloperApiAccessorV1,
  OperonDeveloperApiV1,
} from "@stratejya/operon-cli/contracts/v1/developer-api";
```

These type declarations ship in [@stratejya/operon-cli on npm](https://www.npmjs.com/package/@stratejya/operon-cli); their source is maintained in the [standalone Operon CLI repository](https://github.com/hasanyilmaz/operon-cli).

These imports provide declarations only. They do not include a JavaScript SDK, validators, storage helpers, transports, or Runtime code. Your plugin already runs inside Obsidian, so it obtains the active Operon plugin instance from the host and calls the accessor on that instance.

```ts
interface ObsidianAppWithPluginRegistry {
  readonly plugins: {
    readonly getPlugin: (id: string) => unknown;
  };
}

const hostApp = this.app as unknown as ObsidianAppWithPluginRegistry;
const operon = hostApp.plugins.getPlugin("operon") as
  | OperonDeveloperApiAccessorV1
  | undefined;

if (!operon || typeof operon.getDeveloperApiV1 !== "function") {
  throw new Error("Operon is not enabled.");
}
```

The consumer passed to the accessor must be your actual plugin instance. A copied object with the same manifest fields is not accepted as identity proof.

## Task workflow extension

The base `getDeveloperApiV1()` accessor remains frozen. It does not accept task-workflow extension capabilities, and its existing read and mutation examples stay on that base surface. For saved-filter reads, inline-task adoption, and Daily/Weekly periodic creation or update, use the separate, additive `getTaskWorkflowDeveloperApiV1()` accessor on the same verified Operon plugin instance:

```ts
interface OperonTaskWorkflowDeveloperApiAccessorV1 {
  getTaskWorkflowDeveloperApiV1(
    consumerPlugin: object,
    request: {
      contractVersion: 1;
      runtimeApi: { min: 1; max: 1 };
      requestedCapabilities: readonly string[];
    },
  ): unknown;
}

const workflowOperon = hostApp.plugins.getPlugin("operon") as
  | OperonTaskWorkflowDeveloperApiAccessorV1
  | undefined;

if (!workflowOperon || typeof workflowOperon.getTaskWorkflowDeveloperApiV1 !== "function") {
  throw new Error("Operon's task-workflow extension is unavailable.");
}
```

This extension has its own narrow, capability-projected API. Its exact grants cover `tasks.filter-query`, adoption preview/apply, and periodic create/update preview/apply; requesting one capability does not expose the others. The periodic methods are `tasks.createPeriodicNote.preview/apply/recover/pendingRecoveries` and `tasks.updatePeriodicNote.preview/apply/recover/pendingRecoveries`. See [[DOCS-130 Developer API identity and capability grants|Developer API identity and capability grants]] and [[DOCS-131 Developer API reads and typed mutations|Developer API reads and typed mutations]].

## Open a discovery-only session

Start without domain capabilities when you only need baseline health and capability status:

```ts
const access = operon.getDeveloperApiV1(this, {
  contractVersion: 1,
  runtimeApi: { min: 1, max: 1 },
  requestedCapabilities: [
    "system.health",
    "system.capabilities",
  ],
});

if (!access.ok) {
  console.error(access.error.code, access.error.action);
  return;
}

const api: OperonDeveloperApiV1 = access.api;
const health = await api.system.health();
const capabilities = api.system.capabilities();
```

`channel.status()`, `system.health()`, and `system.capabilities()` are available to a registry-verified consumer without a persisted grant. They do not grant task access. Capability advertisements are projected to the baseline capabilities and the domain capabilities your consumer explicitly requested; this is not an unrestricted list of every Runtime capability. Choose capability IDs from the shipped public V1 types, then use the access result, `api.hasCapability(name)`, and the advertisements to verify the current session scope. Requesting a domain capability starts the grant flow described in [[DOCS-130 Developer API identity and capability grants|Developer API identity and capability grants]].

## Session and lifecycle rules

Every successful connection has a new `sessionId`. The API object and its results are immutable snapshots. A session retained across Operon unload or reload becomes stale and refuses new work. Reacquire the active Operon instance and open a new session after either plugin reloads.

Read admission follows Runtime lifecycle and freshness rules. Writes additionally require the Runtime to be ready. Check the typed result and channel status instead of assuming that method presence means the capability is live.

## Public boundary

The Developer API is desktop-only and local to the current Obsidian process. It is not a remote API, HTTP server, MCP server, mobile API, or hostile-plugin sandbox. It does not expose CLI profiles, terminal helpers, the CLI plan store, raw authorization values, or raw sealed Runtime requests.

## FAQ

**Do I need to install a JavaScript SDK?** No. What ships publicly is type-only: declarations, with no runtime code, validators, or transport. Your plugin already runs inside Obsidian, so it takes the live Operon instance from the host and calls the accessor on it.

**Can I pass an object that carries my plugin's manifest fields?** No. Identity is derived by the host, not asserted by the caller, and a session is tied to a consumer id, the current instance epoch, and its own session id. An object that merely looks like your plugin is refused as a consumer mismatch.

**What can I call with no grant at all?** Channel status, health, and capability discovery, and nothing more. Those exist so a verified consumer can see whether Operon is ready and what it could ask for. They never provide task access, which always requires an approved grant.

**Why does capability discovery show fewer entries than the CLI reports?** Because advertisements are projected to your session: the baseline discovery capabilities plus the domain capabilities your consumer explicitly requested. It is deliberately not a catalogue of everything the Runtime can do, so treat it as your current scope rather than the whole surface.

**What invalidates a session?** Reloading either plugin, because the instance epoch changes and the retained session becomes stale. Grant changes do too: a grant that is not active, one whose revision moved, or a capability that is no longer granted all close further work. Reacquire the instance and open a new session rather than holding one across a reload.

**Can I use this from mobile, or from outside Obsidian?** No. It is desktop-only and local to the current Obsidian process. It is not a remote API, an HTTP or MCP server, a mobile API, or a sandbox for untrusted plugins. For anything outside the app, use `operon-cli`.

**Why is there a second accessor for task workflows?** It keeps the established Developer API V1 surface unchanged while adding separately granted saved-filter, adoption, and periodic-note workflows. Do not send extension capability names to `getDeveloperApiV1()`; call `getTaskWorkflowDeveloperApiV1()` instead.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-130 Developer API identity and capability grants|Developer API identity and capability grants]]
- [[DOCS-131 Developer API reads and typed mutations|Developer API reads and typed mutations]]
- [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors and audit]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
