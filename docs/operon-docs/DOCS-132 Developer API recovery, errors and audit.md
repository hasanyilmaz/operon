---
Notes: Recover only the same dispatched mutation and interpret Developer API errors, receipts, and redacted audit records
Icon: shield-alert
Color: "#059669"
Updated: 2026-08-21T16:12:57
---

# Developer API recovery, errors and audit

> **Maturity:** Public Developer API recovery and audit · Obsidian Desktop · Runtime API V1

Developer API recovery continues one possibly dispatched mutation. It is not a retry mechanism and it never grants authority for a replacement operation.

## Two recovery forms

Within the current session, recover with the opaque plan handle:

```ts
const recovered = await api.mutations.recover({ plan: preview.plan });
```

After Operon or the consumer plugin reloads, reacquire Operon, open a new session, and use the plan's opaque `recoveryRef`:

```ts
const pending = await api.mutations.pendingRecoveries();

if (pending.ok) {
  for (const item of pending.recoveries) {
    const recovered = await api.mutations.recover({
      recoveryRef: item.recoveryRef,
    });
    console.log(recovered.status);
  }
}
```

`pendingRecoveries()` returns only dispatched, unresolved, redacted summaries owned by the current registry-verified consumer. A different plugin cannot list or recover them. A terminal receipt replay remains addressable by its exact reference but is not listed as pending.

The `recoveryRef` is not authority, not a sealed plan, and not the CLI's `planRef`. It is bound to the private plan digest, consumer identity, and host-owned idempotency state.

## Task-workflow adoption recovery

Inline-task adoption uses the same rule through its separate task-workflow accessor: recover the **same** opaque adoption plan, never a replacement preview. In the session that made the preview, keep and pass the original handle:

```ts
const recovered = await workflow.tasks.adopt.recover({
  plan: preview.plan,
});
```

After Operon or the consumer plugin reloads, the session-bound handle cannot be reused. Reacquire Operon, open a new `getTaskWorkflowDeveloperApiV1()` session with the required adoption grants, then recover with the original plan's `recoveryRef`:

```ts
const reopened = operon.getTaskWorkflowDeveloperApiV1(this, {
  contractVersion: 1,
  runtimeApi: { min: 1, max: 1 },
  requestedCapabilities: ["tasks.adopt.apply"],
});

if (reopened.ok) {
  const recovered = await reopened.api.tasks.adopt.recover({
    recoveryRef: preview.plan.recoveryRef,
  });
  console.log(recovered.status);
}
```

`recoveryRef` is only a reference to the original plan's recovery evidence. It is bound to the same registry-verified consumer and cannot authorize a different target, a modified `expectedLine`, or a new adoption. Use `workflow.tasks.adopt.pendingRecoveries()` to list the current consumer's dispatched unresolved adoption operations.

## Periodic-note recovery

Daily/Weekly creation and update follow the same same-plan rule through their own projected method groups:

```ts
const createRecovered = await workflow.tasks.createPeriodicNote.recover({
  recoveryRef: createPreview.plan.recoveryRef,
});

const updateRecovered = await workflow.tasks.updatePeriodicNote.recover({
  recoveryRef: updatePreview.plan.recoveryRef,
});
```

Use `createPeriodicNote.pendingRecoveries()` or `updatePeriodicNote.pendingRecoveries()` to list only the current consumer's dispatched unresolved operations in that family. Recovery requires the corresponding `.apply` grant and continues the same sealed plan. It cannot select another date, task, note, template, parent, or registry entry.

Periodic authority, state, receipt, and uncertain-outcome reasons use the `periodic-note` family. Adoption keeps its established `task-adoption` reasons. Consumers should still branch on structured `code` and `action`, not either human-readable reason.

## When recovery is required

A result with status `partial` or `outcome-unknown` reports:

- `mutationMayHaveApplied: true`;
- `retryAllowed: false`;
- error code `outcome-unknown`;
- action `recover-same-plan`;
- recovery metadata for the same plan.

Do not re-preview, call ordinary apply again, change the target, or mint a new idempotency value. Use `recover({ plan })` or `recover({ recoveryRef })` for that exact operation. If recovery still cannot verify the outcome, keep the operation uncertain.

For inline adoption, those calls are `workflow.tasks.adopt.recover({ plan })` or `workflow.tasks.adopt.recover({ recoveryRef })`. Periodic workflows use the matching `createPeriodicNote` or `updatePeriodicNote` recovery method. Do not switch to a base-API mutation method or create a replacement preview.

Recovery evidence is retained for 24 hours, up to 256 protected records. Capacity pressure refuses a new dispatch rather than deleting unresolved evidence. An expired reference returns `plan-expired`.

## Structured errors

Developer API read and mutation operations that can return structured failures use typed result discriminants. They do not expose CLI process exit codes. Branch on the error `code` and `action`, not on the human-readable `reason` or unspecified details.

Common actions include:

| Error | What to do |
| --- | --- |
| `unsupported-version` | Select a compatible Runtime API range or upgrade |
| `capability-unavailable` | Rediscover live capabilities |
| `authority-insufficient` | Request the exact grant and wait for user approval |
| `consent-denied` | Stop and do not prompt the same plan again |
| `audit-unavailable` | Fix the environment before attempting a new write |
| `receipt-store-unavailable` | Retry only the unchanged pre-dispatch apply |
| `outcome-unknown` | Recover only the same plan |

Unknown additive error codes mean stop and inspect. They never authorize an automatic retry.

## Security audit

Operon durably records a redacted audit event before mutation dispatch. Terminal receipt and audit outcome finalize together. If finalization cannot be proven, the result remains `outcome-unknown`.

Audit records include digests and security metadata, not task content, notes, file paths, consent tokens, acknowledgements, idempotency keys, sealed plans, or graph journals. They are retained for the earlier of 30 days or 2,048 records. Users can inspect and clear the redacted view in **Settings → Operon → Core → General → Developer API Integrations**. Clearing retains an `audit-cleared` marker and does not delete protected recovery evidence.

The Developer API intentionally provides no audit-reading method. Audit inspection and clearing remain user-controlled Settings actions.

## FAQ

**Which recovery form should I use?** Whichever matches your situation. If the session that previewed the plan is still alive, recover with the opaque plan handle. If Operon or your plugin reloaded, that handle is gone: reacquire Operon, open a new session, and recover with the plan's `recoveryRef`.

**Why is `pendingRecoveries()` empty when I know something happened?** It lists only dispatched, unresolved operations belonging to your own registry-verified consumer. Anything already resolved, including a terminal receipt you can still replay by its exact reference, is not pending, and another plugin's operations are never visible to you.

**How long is recovery evidence kept, and what happens when the store is full?** It is retained for 24 hours, within a bounded number of protected records. Capacity pressure never deletes unresolved evidence; instead a new dispatch is refused, so the safe outcome is that you cannot start more work rather than losing the record of work already in flight. A reference past its window reports as expired.

**Should I branch on the error code or the message?** On the code and its action. The human-readable reason exists for logs and can change, and Developer API results do not carry CLI exit codes at all. An unrecognized code means stop and inspect; it is never permission for an automatic retry.

**Can I read the audit from the API?** No, and that is deliberate. There is no audit-reading method; inspecting and clearing the redacted view are user actions in Operon's settings. Clearing leaves a marker that it happened and never removes protected recovery evidence.

**What happens to my writes if the audit cannot be recorded?** They stop. A write needs its durable redacted record before dispatch, so an unavailable audit store is an environment problem to fix rather than something to retry around. If the audit and receipt cannot be finalized together, the result stays uncertain rather than being reported as success.

**Can I recover an adoption after reload?** Yes, only for the same registry-verified consumer and only with that preview's `recoveryRef`, through a newly opened task-workflow Developer API session. It resumes the same plan; it is not permission to preview or apply a new one.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-129 In-process Developer API overview|In-process Developer API overview]]
- [[DOCS-130 Developer API identity and capability grants|Developer API identity and capability grants]]
- [[DOCS-131 Developer API reads and typed mutations|Developer API reads and typed mutations]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
