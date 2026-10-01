---
Notes: How Operon's data behaves under sync, and how to resolve conflicts
Icon: shield-check
Color: "#0891b2"
Updated: 2026-10-01T13:41:33+02:00
---

# Sync conflict safety

Operon's data lives in your vault, so it syncs however your vault syncs: Obsidian Sync, iCloud, Dropbox, or git. This page is what that means for your tasks, what Operon does to keep sync safe, and where you still have to step in. It does not promise conflict-free sync; it explains the behavior so conflicts are rare and fixable.

## Tasks sync as Markdown

Because tasks are plain Markdown, they sync as ordinary text files. Any sync tool that handles your notes handles your tasks; there is no separate task channel to set up. See [[DOCS-045 Markdown task storage|Markdown task storage]].

## Identity keeps a task one task

The `operonId` is what stops sync from quietly multiplying your work. Across devices, the same id means the same task, so editing it in two places is two edits to one task, not two tasks. This durable identity is the backbone of safe sync. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

## When a duplicate does happen

Sync can still produce a copy: two devices create from the same template, or an offline edit lands as a duplicate. When two tasks end up sharing an `operonId`, Operon detects it and the **Operon ID Conflict** manager lets you resolve it, by giving one copy a fresh id or removing it. Nothing is merged or deleted silently. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].

## Operon writes its own files safely

Operon uses guarded writes for its [[DOCS-046 Plugin data and state files|plugin data and state files]]. Before saving settings, it checks that the stored version still matches the version it read. If another device or sync process has changed it, Operon can suspend settings writes rather than overwrite that newer state. An interruption or uncertain write result may require recovery; these safeguards are not a guarantee against every storage failure.

## When settings saves are suspended

A message such as `Canonical settings changed before an unchanged save` means Operon could not confirm that the stored settings still matched its last read, even though the attempted save matched its committed settings. The file may have changed or could not be read safely. It does not by itself mean your settings were deleted.

For this recoverable mismatch, a successful settings reload can read and validate the current stored settings, check that they stayed unchanged during the reload, and adopt that same snapshot in memory before reopening writes. This is not a merge of competing edits. Invalid or unsupported data, an uncertain write, or a failed recovery can keep writes blocked.

Let synchronization finish, then check the values now shown in Settings. A change whose save failed is not automatically replayed: after writes become available again, reapply it if it is still wanted. If saving remains blocked, preserve the error message and your backups for troubleshooting instead of resetting settings or repeatedly retrying the same change.

## The limits, stated plainly

- **Operon does not merge conflicting edits.** If two devices change the same task offline, your sync tool decides the text outcome, the same as any note. Operon then helps with identity, not with merging prose.
- **Settings travel only if your sync configuration includes Operon plugin data.** Tasks sync as notes regardless. Settings live under the vault configuration folder (normally `.obsidian/plugins/operon/data.json`), so syncing notes alone does not transfer them.

## Good habits

- Let a sync finish before heavy editing on another device.
- If you see a duplicate alert, open the conflict manager and resolve it rather than leaving it.
- Keep backups of your vault; it holds both your tasks and Operon's settings.

## FAQ

**Does Operon prevent all sync conflicts?** No. Identity helps distinguish tasks, the conflict manager handles duplicate IDs, and settings guards help avoid overwriting an unexpected stored version. Text merges are still your sync tool's job.

**Will syncing duplicate my tasks?** Not on its own. If a duplicate id does appear, Operon flags it for you to resolve.

**Which sync services work?** Any that sync your vault's files, since Operon's data is files.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
