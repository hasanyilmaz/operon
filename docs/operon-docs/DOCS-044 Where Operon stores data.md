---
Notes: The two places Operon keeps data, all inside your vault
Icon: database
Color: "#0891b2"
Updated: 2026-07-23T16:45:34
---

# Where Operon stores data

Everything Operon keeps lives inside your vault. There is no server and no account. Knowing where each kind of data sits helps you back it up, sync it, and understand what is yours versus what Operon can rebuild.

There are two stores, with a clear split between them.

## Your tasks: in your Markdown

Your tasks are not in a database. They are the Markdown you can already see: an inline task is a checkbox line in a note, and a file task is a note with task frontmatter. The note is the source of truth. Operon reads and writes these files, and everything it shows you in filters, the Calendar, and the Kanban is built from them. See [[DOCS-045 Markdown task storage|Markdown task storage]].

This is the data you most care about, and it stays plain text you own.

## Operon's settings and state: in the plugin's data

Operon's own configuration and working state (key mappings, pipelines, priorities, saved filters, Calendar and Kanban presets, and similar) live in the plugin's data files under `.obsidian/plugins/operon/`, not mixed into your notes. This is settings and bookkeeping, not your tasks. If it were lost, you would lose preferences and have to reconfigure, but your tasks would be untouched in your notes. See [[DOCS-046 Plugin data and state files|Plugin data and state files]].

**Table presets are the one exception.** Each saved table is also its own `.table` file inside your vault, not only an entry in the plugin's data, so it moves, renames, and backs up as a vault file in its own right. Calendar, Kanban, and saved Filter presets are unaffected; they still live in the plugin's data as described above. See [[DOCS-114 Table files|Table files]].

## Why the split matters

- **Backups.** Backing up your vault backs up both stores.
- **Sync.** Tasks sync as ordinary Markdown; settings sync with the rest of your `.obsidian` folder if you sync it. See [[DOCS-047 Sync conflict safety|Sync conflict safety]].
- **Portability.** Your tasks travel as plain files, readable with or without Operon.

## FAQ

**Is any of my data on a server?** No. Everything is local in your vault.

**Are Table presets stored the same way as Calendar and Kanban presets?** No. A Table preset is its own `.table` file in the vault; Calendar and Kanban presets stay in the plugin's data. See [[DOCS-114 Table files|Table files]].

**If I uninstall Operon, do I lose my tasks?** No. Tasks are Markdown in your notes. You would lose Operon's views and settings, not the tasks.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-005 Operon core concepts|Operon core concepts]]
- [[DOCS-114 Table files|Table files]]
