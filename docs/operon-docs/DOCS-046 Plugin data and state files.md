---
Notes: Where Operon keeps its settings, working state, and rebuildable index
Icon: folder-cog
Color: "#0891b2"
Updated: 2026-10-14T11:59:33+02:00
---

# Plugin data and state files

Apart from your tasks, which live in your Markdown, Operon keeps its own configuration and working state in the plugin folder, `<configDir>/plugins/operon/` (normally `.obsidian/plugins/operon/`). This is settings and bookkeeping, not your tasks. This page is what is there and what it means if it changes.

## What Operon keeps here

The plugin's main data file holds your Operon configuration: [[DOCS-039 Key mappings|key mappings]], [[DOCS-037 Pipelines and statuses|pipelines]], [[DOCS-038 Task priorities|priorities]], saved [[DOCS-025 Filter View|filters]], Calendar and Kanban presets, contextual menu setup, and the rest of your settings.

**Table presets are the exception.** Each preset is a `.table` file in your vault rather than a preset stored in the plugin's settings. **Settings → Operon → Views → Tables → Table default folder** chooses where *new* Table files are created. The historical default is `Operon/Tables`; choose another vault-relative folder to organize new files elsewhere, or leave the setting blank to create them at the vault root. Changing it never moves existing `.table` files. The plugin's data records file bindings and your preset order, favorites, and default preference. Only valid, uniquely identified `.table` files become editable presets. Startup scans preserve known bindings and preferences when files are temporarily unavailable; they do not erase stars or manufacture a replacement preset. A fresh default Table file is created only for an uninitialized profile with no existing Table file or binding to adopt. Explicit deletion through Operon removes the selected preset's references. See [[DOCS-114 Table files|Table files]].

Alongside it, Operon keeps working state and caches in subfolders:

- **State**: things Operon tracks that are not settings, such as recurring-series records, running timers, pinned tasks, inline-task target history, project serials, and verified Daily/Weekly File Task container identities.
- **Runtime**: the task index, a cache built from your notes for speed.
- **Cache**: derived data such as fetched external-calendar events.

The split is deliberate: settings are your choices, state is what Operon is currently tracking, and the runtime index is rebuildable from your notes at any time.

**Inline-task target history** lives in `state/inline-task-target-history.json`. It records the file path, successful creation count, and last use for the [[DOCS-136 Task Router|Ask Every Time]] picker. It starts empty, without scanning existing notes, and is separate from settings backups. Opening or cancelling the picker does not write history. Missing history starts empty; malformed or unsupported data is preserved while the picker works without it. If a history save fails, the created task remains saved and Operon reports the problem.

**Excalidraw card cleanup** uses `state/excalidraw-task-card-cleanup.json` inside the plugin folder. It is created when a confirmed task deletion needs tracking and records pending cleanup and card snapshots for later restoration. It is working state, not a rebuildable index cache or a separate copy of task properties. If this record is malformed or unsupported, automatic cleanup is deferred while task-source operations remain available. See [[DOCS-147 Excalidraw Task Cards|Excalidraw Task Cards]] for deletion and restoration behavior.

The periodic-container registry is Plugin-owned bookkeeping. It lets Operon prove which Daily or Weekly Note is an exact File Task parent before creating or realigning a relationship. Do not edit it manually or reproduce it in CLI scripts; the Plugin updates it together with the related Markdown transaction. See [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]].

## One persistent index for task properties

Canonical fields, mapped Custom keys, and Vault Properties are saved in the same verified task snapshot and shared persistence flow. This includes the native source information needed to interpret File and Inline properties. Vault Properties do not require a separate scan merely because a table displays them. Property declarations and mapping rules still determine interpretation and editability; indexing a value does not make every type writable.

The current format uses **schema version 8, layout version 2** under `runtime/index-v8-layout-2/`, relative to the plugin folder. It keeps 32 shards with a maximum of **5,000,000 bytes per shard**. A larger shard is rejected without truncating properties; the last valid snapshot is preserved and a persistence problem is reported. Notes remain the source of truth.

Changed sources update their canonical and native data together, including changes only to a Vault Property. An unchanged supported source can be restored from cache without rereading its Markdown body. Values that cannot be represented safely in the cache require a source reread instead of being silently treated as empty.

## What happens after an update

**You do not normally need to run Rebuild full index after updating.** On the first startup with this layout, if the new cache is absent, Operon automatically scans the current notes and creates it. That first opening may take longer. Subsequent openings load the verified cache and reconcile source changes; they do not rebuild everything merely because the new layout is in use.

The previous `runtime/index-v8/` cache and its recovery marker are kept separate and are not automatically rewritten or deleted by this layout. The first scan reads current notes rather than assuming the old cache already contains native properties. This does not migrate or rewrite task-note content.

A valid cache must also match the current indexing rules. Relevant mapping or settings changes can require automatic rebuilding. Missing cache and ordinary source changes are different from a corrupt or unsupported cache: Operon may build a working index from notes while refusing to overwrite unsafe persistent data. **Index diagnostics** exposes validation, rebuild, and confirmed repair actions for those cases. Do not delete recovery evidence to bypass the checks.

## Rebuild, repair, and downgrade

**Rebuild full index** rescans eligible notes. It is a troubleshooting action, not a required update step and not a way to force replacement of an unsupported persistent format. A confirmed repair rebuilds from current Markdown through the guarded cache-repair path. Neither is an Undo for task edits or settings changes. See [[DOCS-091 Rebuild full index|Rebuild full index]].

Older Operon versions do not read the new layout directory. Keeping the old directory does not guarantee that its contents are current after working in the new version. A controlled downgrade must preserve cache/recovery evidence and rebuild with the older reader from the current notes; do not restore old notes or settings merely to match an old index. There is no need to perform this procedure during a normal forward update.

## Tasks are not here

Your authoritative task records live in Markdown notes. The runtime snapshot contains derived copies for reading and queries; it is not a replacement for those notes. Deleting these plugin files can lose settings and operational state, even though task text remains in Markdown. A rebuild recreates the index, not all working state; do not delete the plugin folder as a troubleshooting shortcut. See [[DOCS-044 Where Operon stores data|Where Operon stores data]].

## FAQ

**Should I delete plugin data to rebuild the index?** No. Task text lives in notes, but plugin data also contains settings and operational state. Use the rebuild or confirmed repair controls instead.

**Does my vault backup include these files?** Check that your backup includes the vault’s configuration/plugin folder; tools can exclude hidden folders. Back up notes and operational state as well as settings. Operon can export a portable settings backup for moving configuration, but that export is not a backup of task notes or all working state. See [[DOCS-134 Backup and restore settings|Back up and restore settings]].

**Where are my settings stored?** In the plugin folder, `.obsidian/plugins/operon/`, not mixed into your notes.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-045 Markdown task storage|Markdown task storage]]
- [[DOCS-114 Table files|Table files]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
