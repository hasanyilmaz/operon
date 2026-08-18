---
Notes: Use capability-gated reads and the typed preview, apply, receipt, and replay mutation flow
Icon: code-xml
Color: "#059669"
Updated: 2026-08-18T18:18:29
---

# Developer API reads and typed mutations

> **Maturity:** Public Developer API reads and typed mutations · Obsidian Desktop · Runtime API V1

The Developer API exposes immutable read DTOs and a typed mutation flow that preserves Operon's preview, apply, receipt, and postflight checks.

## Read method groups

After opening a session with the required exact grants, choose the narrowest method:

- `system.health()` and `system.capabilities()` provide grant-free baseline status.
- `system.diagnostics()` reads Runtime diagnostics and requires the exact `system.diagnostics` grant.
- `catalog.snapshot()` reads the current taxonomy and policies.
- `entities.resolve()` resolves a loose task reference.
- `tasks.get()` reads one exact task.
- `tasks.query()` and `tasks.find()` return bounded task sets.
- `relationships.get()` reads task relationships.
- `context.build()` creates a purpose-specific Context Pack.
- `timers.read()` reads active timer state and history.

Runtime read requests carry contract fields including a request ID and consistency policy. Read results preserve typed freshness and warnings. Task and context result types also carry provenance and truncation information where their contracts define those fields. Do not discard available safety metadata when making decisions.

```ts
const result = await api.tasks.get({
  contractVersion: 1,
  requestId: crypto.randomUUID(),
  consistency: "live-verified",
  kind: "task-get",
  selector: { kind: "operon-id", operonId },
  include: ["writable-fields"],
});

if (!result.ok) {
  console.error(result.error.code, result.error.action);
  return;
}

console.log(result.task.description, result.task.locator);
```

## Saved-filter reads and inline-task adoption

The task-workflow extension is a separate capability-projected API. Open it with `getTaskWorkflowDeveloperApiV1()` and request only the grants required by the operation:

```ts
const workflowAccess = operon.getTaskWorkflowDeveloperApiV1(this, {
  contractVersion: 1,
  runtimeApi: { min: 1, max: 1 },
  requestedCapabilities: [
    "tasks.filter-query",
    "tasks.adopt.preview",
    "tasks.adopt.apply",
  ],
});

if (!workflowAccess.ok) {
  console.error(workflowAccess.error.code);
  return;
}

const workflow = workflowAccess.api;
const matches = await workflow.tasks.filterQuery({
  contractVersion: 1,
  requestId: crypto.randomUUID(),
  kind: "task-filter-query",
  consistency: "live-verified",
  filterSetId: "active-projects",
});
```

To adopt a plain inline checkbox, preview the exact source first. `lineNumber` is **zero-based**, and `expectedLine` is the complete line currently at that path and line. It is a source precondition, not text to search for elsewhere in the file:

```ts
const preview = await workflow.tasks.adopt.preview({
  operation: "adopt-inline",
  source: {
    filePath: "Projects/Launch.md",
    lineNumber: 0,
    expectedLine: "- [ ] Review the launch checklist",
  },
});

if (!preview.ok) {
  console.error(preview.error.code);
  return;
}

const execution = await workflow.tasks.adopt.apply({ plan: preview.plan });
```

Preview produces a session-bound, opaque plan handle. Apply only that unchanged handle: do not clone it, reconstruct it from fields, pass it to another session or consumer, or make a fresh preview as a retry. If the file, line number, or expected line changes before apply, Operon fails closed before writing. A successful replay returns `already-applied` without another source write.

## Preview a typed mutation

`DeveloperMutationPreviewInputV1` is a discriminated union. Each branch binds a mutation kind to its preview capability, target policy, and specification. TypeScript rejects mismatched capability and mutation combinations before runtime admission.

```ts
const preview = await api.mutations.preview({
  capability: "tasks.update.preview",
  mutationKind: "task.update",
  target: {
    operonId: result.task.identity.operonId,
    locator: result.task.locator,
  },
  spec: {
    operation: "update",
    changes: [
      { field: "note", valueType: "text", value: "Reviewed by the planning plugin." },
    ],
  },
});

if (!preview.ok) {
  console.error(preview.error.code, preview.error.action);
  return;
}
```

The returned plan is opaque and session-bound. Its targets, predicted effects, warnings, risk level, and consent requirement are for review. Copying those fields does not create an admitted plan.

## Apply the unchanged plan

Apply only the exact handle returned by preview:

```ts
const execution = await api.mutations.apply({ plan: preview.plan });

if (execution.status === "applied") {
  console.log(execution.receipt, execution.postflight);
}
```

A result with status `applied` includes a terminal receipt and a postflight status of `verified`. Applying or recovering the same completed plan returns `already-applied` with a receipt replay, a postflight status of `receipt-replay`, and no source write.

Routine mutations use the active exact grant. Elevated mutations require fresh Operon-owned review and consent for each sealed plan. Destructive mutations also require confirmation and acknowledgements bound to that plan, its targets, and effects. The consumer cannot create or substitute these proofs.

## Do not treat failures as retries

A normal pre-dispatch failure has `mutationMayHaveApplied: false` and no recovery metadata. Inspect its structured error action before deciding whether to make a new request.

If the result is `partial` or `outcome-unknown`, ordinary apply and replacement preview are forbidden. Continue only through the same-plan recovery flow in [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors and audit]].

## FAQ

**A method exists on the API object. Does that mean I can call it?** No. The object's shape is a type, not an authorization. Check `api.hasCapability(name)` and the capability advertisements for your session, and always branch on the typed result rather than assuming a call will be admitted.

**Which read should I reach for?** The narrowest one that answers your question. Use `tasks.get()` when you already hold an id, `entities.resolve()` to turn a loose reference into one, `tasks.query()` or `tasks.find()` for a bounded set, and `context.build()` when one decision needs the surroundings rather than a single record.

**Can I ignore the freshness, provenance, and truncation fields?** You can read past them, but you should not act past them. They tell you how current a result was, how a relationship was known, and whether a set was cut short. Discarding that metadata is how an integration ends up confidently acting on a partial or stale picture.

**Is the handle I get from a preview the sealed plan itself?** No, it is an opaque handle belonging to your session. Apply refuses anything that is not a handle this session produced, so you cannot construct one, reconstruct one from stored fields, or pass one between consumers.

**When does `recoveryRef` become useful?** Only after the apply has been durably dispatched. Before that point there is nothing uncertain to recover, so treat the reference as a way back to an operation already in flight rather than as a token you hold from the start.

**An apply failed. Can I preview the same change again?** Not as a retry. A failure is a result, not an invitation to reissue: if dispatch may have occurred, continue with the same plan through recovery. Creating a fresh preview would risk applying the same change twice.

**How do I adopt an inline task at line 1?** Use `lineNumber: 0`; task-workflow source line numbers are zero-based. Supply the complete current line in `expectedLine`, preview it, and apply that preview's unchanged opaque handle.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-121 Reading tasks and building context|Reading tasks and building context]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-129 In-process Developer API overview|In-process Developer API overview]]
- [[DOCS-130 Developer API identity and capability grants|Developer API identity and capability grants]]
- [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors and audit]]
