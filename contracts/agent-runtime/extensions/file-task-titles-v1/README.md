# File Task titles V1

This additive extension separates a File Task's human title from its physical filename. Discover the four capabilities before use. The base V1 capability registry and existing sealed plans retain their meaning.

| Capability pair | Intent | Physical filename |
| --- | --- | --- |
| `tasks.file.create.preview` / `tasks.file.create.apply` | Create one File Task with `displayTitle` | Exact path is preserved; configured target uses the current `same`, `kebab`, or `snake` policy |
| `tasks.file.title.preview` / `tasks.file.title.apply` | Set or clear one existing File Task title | Always preserved, including when Plugin automatic rename is enabled |

Creation uses `mutationKind: "task.create"` and this spec:

```json
{
  "operation": "create-file",
  "item": {
    "itemRef": "one",
    "displayTitle": "Review Q3 Plan",
    "target": { "representation": "file", "mode": "configured-default" },
    "fields": []
  }
}
```

Title editing uses `mutationKind: "task.update"`, an exact File Task `target`, and `{"operation":"set-title","displayTitle":"Review Q3 Plan"}`. Use `null` to remove the mapped title. Title edits allow multiline text; creation retains the base creation description restrictions. Both accept at most 8,192 UTF-8 bytes. A valid system title mapping is required; preexisting custom mappings are not reinterpreted.

Use the usual V1 preview envelope with the selected capability, request/client identity, idempotency key, and authorization. Apply the complete returned sealed plan with the same idempotency key and plan-bound acknowledgements. The extension binds the outer intent to an unchanged core execution plan and a namespaced execution key. Do not extract or dispatch the inner plan. The preview seals the final target path. Existing-file rename is outside this extension.

The Plugin request-file transport accepts these requests through `mutation.preview` and `mutation.apply`. This is provider support; the standalone CLI implementation is deferred until after the Plugin release. JSON schemas and the extension manifest define input/output entrypoints; semantic decoders additionally check UTF-8 bounds, hashes, identities, and plan bindings.

Developer API consumers request the required capability pair through `getFileTaskTitlesDeveloperApiV1`. The returned session exposes `mutations.preview`, `mutations.apply`, `mutations.recover`, and `mutations.pendingRecoveries`. Apply accepts the original opaque plan handle; after restart, recovery uses its durable `recoveryRef`. Active consumer identity, exact grants, consent, and durable dispatch records are required.

Reads retain `description` as the filename identity. `displayTitle` carries a valid mapped human title independently of the Plugin display toggle. The catalog exposes `fileTaskFilenameRule`. UI display remains opt-in; API title writes do not enable the setting or rename existing files.

## Failure and recovery

Creation and title editing reuse guarded source writes, parent timestamp updates, transaction journals, compare-aware compensation, and same-plan receipt recovery. Recovery never silently issues a new mutation. Revoked grants or an unavailable provider prevent dispatch while preserving an earlier uncertain outcome.

A verified compensation returns `failed`, `mutationMayHaveApplied: false`, and `recoveryOutcome: "compensated"`. If terminal audit delivery or recovery-record finalization fails after compensation, the client may retain `outcome-unknown` even though the source was restored. When neither the original journal nor a receipt remains, automatic recovery refuses to write; inspect the affected source rather than replaying or inventing a new key. Full source journals are not retained indefinitely to resolve this delivery-only uncertainty.

Regenerate schemas with `node scripts/agent-runtime/file-task-titles/generate-schemas.mjs --write`; omit `--write` to check drift. `npm run file-task:display-title:test` covers the Plugin title behavior and this extension.
