# Settings preservation fixtures

These files contain synthetic data only. They were built from the source commits
recorded in `manifest.json`, using each version's settings/package builders and
its filter store's built-in dynamic-filter normalization. They are fixed inputs:
tests must not regenerate them from the current `DEFAULT_SETTINGS`.

- `data-3.8.0.json`: personalized settings before the two 3.9 additions.
- `data-3.9.0.json`: the same choices with `assigneeImageProperty = avatar` and
  `inheritPropertiesOnParentLink = true`.
- `Personal.table`: a valid file matching the stored Table binding and favorite.
- `manifest.json`: source identities and exact byte-length/SHA-256 seals.

The examples include a custom filter, Calendar and Kanban presets using that
filter, Table references, favorites for all four views, custom pipeline/priority
colors, a custom key mapping, Turkish language, and a custom docs folder.

## Execution

From the repository root:

```sh
node scripts/run-settings-preservation-tests.mjs
```

The runner uses tracked test support only and returns a nonzero exit code when
any safety assertion fails. Stage 1 recorded 8 passing and 17 failing safety
assertions before the fix. Stage 2 extends that baseline with reload, creation,
notification, malformed-envelope and verification regressions. Assertions must
not be inverted, skipped, or converted into success for unsafe behavior.

The private Phase 5 harness registers the same cases locally. No tracked file
imports the private harness and this runner is not wired to a production build.

## Source, allowed writes, and expected state

Every case owns a fresh temporary vault. A sealed preimage stays outside that
vault. The fixture files in this folder are only read. Independent note,
other-plugin settings, manual backup (when a package exists), and Table-file
sentinels must remain byte-identical. A custom-config-directory case verifies
that paths follow `configDir` rather than assuming `.obsidian`.

| Case group | Input / fault | Allowed canonical result |
| --- | --- | --- |
| Healthy upgrade (both fixtures) | Readable personalized package | All domains preserved; only the two missing 3.9 fields may receive defaults and the explicitly saved release-note marker may change; second startup is byte-idempotent |
| Inconsistent API read | `null`, `undefined`, array, scalar while a valid file exists | Preserve all saved choices; safely reread the source or block; never persist fallback defaults |
| Rejected/unreadable read | Rejection or API `undefined` plus adapter read/stat failure | Exact source retained; zero canonical write attempts, including automatic saves |
| Invalid source | Malformed JSON, JSON null, array, empty object, future schema | Exact raw bytes retained over two starts; canonical writes blocked |
| Genuine first install | No canonical package, Table file, or prior Operon state | Create valid defaults once; restart without semantic changes |
| Missing previous package | No `data.json`, prior index evidence present | Do not create first-install defaults |
| Disk conflict | External update or a newer loaded instance writes first | Reject the stale save before writing; preserve the new disk bytes |
| Late file arrival | File appears between initial package read and first mutation | Reject creation from stale defaults; preserve the arriving file |
| Write rejected before apply | Adapter rejection without file changes | Reject the save; retain previous committed memory and disk |
| Silently failed write | Host reports success without applying | Reject unverified success; retain previous committed memory and disk |
| Partial write | Corrupt target, with success or failure acknowledgement | Reject; retain last committed memory; block subsequent writes without blindly restoring over uncertain target state |
| Failed reload | Preparation, runtime commit, or required backup fails | Keep cached settings paired with no writable external preimage; resume or backup alone must not allow stale saves |
| Invalid typed envelope | Null/array/empty settings, invalid schema type, unsupported settings version | Reject before migrations; exact raw bytes retained across starts |
| Verification read failure | Write finishes, canonical observation fails | No committed-memory promotion; suspend further writes |
| First publication conflict | External source arrives during native rename, even with equal bytes | Preserve external source; equality alone is not proof of own publication |
| Protection notification | Startup read blocked and repeated later saves | One notification, no canonical attempts |
| Applied write, lost acknowledgement | Exact candidate written, then rejection | Recognize the verified commit; update committed memory; do not replay |

Mutation auditing allows only canonical `data.json`, its existing transaction
siblings (`.tmp-*`, `.replace-backup.tmp-*`), and established `.invalid-*.bak`
recovery files. Directory creation is restricted to the plugin directory and
its `state`, `runtime`, and `cache` subdirectories. This is the Stage 1/2 write
set; Stage 3 must explicitly extend it for the approved bounded-backup system.

Fault injection is at the canonical adapter write boundary (also reached by
Plugin.saveData, adapter.process, and the modeled native rename publication). Tests assert that each injected save
actually reaches that boundary once; switching write primitives must extend the
injector to the new commit boundary, never silently stop exercising the fault.
Full temporary-write/rename/backup-metadata crash testing belongs to Stage 5.

This is a storage-level reproduction, not an end-to-end simulation of Obsidian's
updater or evidence of the exact historical incident trigger.
