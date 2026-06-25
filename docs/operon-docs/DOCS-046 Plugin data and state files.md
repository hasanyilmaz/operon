---
Up:
  - "[[DOCS-044 Where Operon stores data|Where Operon stores data]]"
  - "[[DOCS-039 Key mappings|Key mappings]]"
  - "[[DOCS-047 Sync conflict safety|Sync conflict safety]]"
Notes: Where Operon keeps its settings, working state, and rebuildable index
Icon: folder-cog
Color: "#0891b2"
tags:
  - operon
  - data
  - storage
  - index
  - settings
Updated: 2026-06-25T16:47:21
---

# Plugin data and state files

Apart from your tasks, which live in your Markdown, Operon keeps its own configuration and working state in the plugin folder, `.obsidian/plugins/operon/`. This is settings and bookkeeping, not your tasks. This page is what is there and what it means if it changes.

## What Operon keeps here

The plugin's main data file holds your Operon configuration: [[DOCS-039 Key mappings|key mappings]], [[DOCS-037 Pipelines and statuses|pipelines]], [[DOCS-038 Task priorities|priorities]], saved [[DOCS-025 Filter View|filters]], Calendar and Kanban presets, contextual menu setup, and the rest of your settings.

Alongside it, Operon keeps working state and caches in subfolders:

- **State**: things Operon tracks that are not settings, such as recurring-series records, running timers, pinned tasks, and project serials.
- **Runtime**: the task index, a cache built from your notes for speed.
- **Cache**: derived data such as fetched external-calendar events.

The split is deliberate: settings are your choices, state is what Operon is currently tracking, and the runtime index is rebuildable from your notes at any time.

## Tasks are not here

None of your tasks live in these files. They are in your Markdown notes. If these plugin files were deleted, you would lose settings and have to reconfigure, and Operon would rebuild its index from your notes, but your tasks would be intact. See [[DOCS-044 Where Operon stores data|Where Operon stores data]].

## FAQ

**Will I lose tasks if I delete the plugin data?** No. Tasks are in your notes. You would lose settings and the index, which Operon rebuilds.

**Do I need to back these up separately?** No. Backing up your vault captures the plugin folder along with your notes.

**Where are my settings stored?** In the plugin folder, `.obsidian/plugins/operon/`, not mixed into your notes.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-045 Markdown task storage|Markdown task storage]]
