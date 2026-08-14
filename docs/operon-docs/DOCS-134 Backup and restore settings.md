---
Notes: Export, preview, restore, and reset portable Operon settings
Icon: archive-restore
Color: "#0891b2"
Updated: 2026-08-12T17:21:45
---

# Back up and restore settings

Operon can export its portable settings as one JSON file and restore that file in another vault. Use it to move a configuration, test the same setup elsewhere, or keep a settings snapshot. This is a settings backup. It is not a backup of your tasks or vault files.

## Create a settings backup

Open **Settings → Operon → Core → Backup & Restore**, then select **Download**. Operon creates a file named like this:

```text
operon-settings-backup-20260811T093045Z.json
```

The timestamp uses UTC and includes seconds, so repeated backups are easy to distinguish. Downloading a backup reads the committed settings without changing the vault.

External Calendar sources and their URLs are included automatically. A private calendar URL can grant access to that calendar feed, so store the JSON file with the same care as the plugin data it represents.

## What the backup contains

The file contains portable Operon configuration. This includes general preferences, pipelines, priorities, user-facing key mapping overrides, custom keys, saved filters, Calendar and Kanban presets, applicable preset favorites, global Table preferences, and External Calendar sources.

Vault-specific paths and references can also appear in the backup. Operon does not assume that a folder, file, or other vault item from the source exists in the target. You review those references before restoring them.

The backup does not contain:

- Markdown notes or tasks
- `.table` files
- Table file bindings, order, default Table, initialized state, or Table favorites
- Working state such as pinned tasks, running timers, or Kanban manual order
- Device-local interface positions or Developer API grants
- Rebuildable runtime indexes and caches

The target vault keeps those excluded values when settings are restored. For the wider storage model, see [[DOCS-044 Where Operon stores data|Where Operon stores data]] and [[DOCS-114 Table files|Table files]].

## Preview and restore a backup

1. Open **Settings → Operon → Core → Backup & Restore**.
2. Select **Choose backup file** and open an Operon JSON backup.
3. Review the compatibility result and the Settings groups that would change.
4. For each required Vault reference decision, choose **Use backup value** or **Keep current value**.
5. Clear any Settings group you do not want to restore.
6. Read and select **I understand the recovery limits**.
7. Select **Restore selected settings**.

Operon validates the file and previews the result before writing settings. A malformed, unsupported, or oversized file is rejected without changing the target. A partially compatible backup identifies unsupported groups and preserves the current values for those groups.

## Keep or undo the restored settings

After a successful restore, the restored settings are already active. Select **Keep restored settings** to finalize them, or **Undo restore** to return to the settings that were active immediately before the restore.

Undo is conditional and available only during the current Obsidian session. It is not a crash-safe disk rollback. If you close the result with `×` before deciding, the pending recovery remains available through **Resume recovery** on the Backup & Restore page.

If settings were committed but some Operon features could not refresh, the recovery screen identifies the affected areas. Use **Retry runtime refresh**, keep the restored settings, or undo the restore according to the actions shown for that recovery.

## Reset Operon settings

The **Reset settings** section returns portable Operon settings to the current defaults. Operon shows a confirmation first. Confirming does not delete notes, tasks, or `.table` files, and it preserves the same target-owned state that restore excludes.

Reset does not provide session Undo. Download a backup first if you may want the current configuration again.

## Tips

> [!tip] Keep settings and vault backups together
> The JSON file protects portable Operon configuration. Your normal vault backup protects notes, tasks, `.table` files, and the rest of the vault. Keep both when you want a more complete recovery path. See [[DOCS-047 Sync conflict safety|Sync conflict safety]].

## FAQ

**Can I restore a backup created by an older Operon release?** Operon checks the backup before applying it. A supported older backup can be restored. If only part of it is compatible, the preview identifies that state and preserves unsupported groups. An unsupported file is rejected without changing settings.

**Does restoring settings overwrite my tasks?** No. Tasks remain in their Markdown files.

**Does the backup include Table presets?** No. Table presets are `.table` vault files. The settings backup includes only file-independent Table preferences. The target keeps its existing Table bindings, order, default, initialized state, and Table favorites.

**Why can I undo a restore but not a reset?** Restore creates a conditional undo tied to that restore during the current session. Reset is a separately confirmed return to current defaults and does not create session Undo.

**What happens if I close the restore result before choosing?** The recovery remains pending. Return to Backup & Restore and select **Resume recovery**.

## Settings

Backup, restore, recovery, and reset controls live in **Settings → Operon → Core → Backup & Restore**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
