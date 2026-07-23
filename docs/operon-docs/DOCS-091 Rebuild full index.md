---
Notes: Command that re-scans the vault and rebuilds the Operon task index
Icon: refresh-cw
Color: "#475569"
Updated: 2026-07-23T16:45:34
---

# Rebuild full index

**Rebuild full index** re-scans your whole vault and rebuilds the Operon task index from scratch. Run it from anywhere; it does not depend on which note is open.

## How it works

- Running it shows a short "rebuilding" notice while Operon reads every note again.
- When it finishes, a second notice reports how many tasks the fresh index holds.

The rebuild only reads your Markdown. It does not change, move, or delete any task; your notes stay the source of truth, and the command simply makes the index match them again. See [[DOCS-045 Markdown task storage|Markdown task storage]].

## When to use it

The index normally keeps itself current as you edit, so you rarely need this. Reach for it when the index may have drifted from your notes:

- Tasks are not appearing where you expect.
- A file was edited outside Obsidian, by a sync client, a script, or another editor.
- You suspect the index is stale after an unusual change.

If tasks are missing, this is one of the first things to try; the full picture is in [[DOCS-054 Missing tasks|Missing tasks]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-092 Show index stats|Show index stats]]
