---
Notes: How Operon's data behaves under sync, and how to resolve conflicts
Icon: shield-check
Color: "#0891b2"
Updated: 2026-07-23T16:45:34
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

When Operon updates its [[DOCS-046 Plugin data and state files|plugin data and state files]], it writes them so an interrupted save does not leave a half-written file. A write that fails partway does not corrupt the existing data. This protects your settings and Operon's state, not your notes, which your sync tool and Obsidian handle.

## The limits, stated plainly

- **Operon does not merge conflicting edits.** If two devices change the same task offline, your sync tool decides the text outcome, the same as any note. Operon then helps with identity, not with merging prose.
- **Settings travel only if you sync `.obsidian`.** Your tasks sync as notes regardless, but Operon's settings live in the plugin folder, so they sync only when you sync the config folder.

## Good habits

- Let a sync finish before heavy editing on another device.
- If you see a duplicate alert, open the conflict manager and resolve it rather than leaving it.
- Keep backups of your vault; it holds both your tasks and Operon's settings.

## FAQ

**Does Operon prevent all sync conflicts?** No. It makes them rare and fixable: identity keeps tasks distinct, and the conflict manager resolves duplicates. Text merges are still your sync tool's job.

**Will syncing duplicate my tasks?** Not on its own. If a duplicate id does appear, Operon flags it for you to resolve.

**Which sync services work?** Any that sync your vault's files, since Operon's data is files.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
