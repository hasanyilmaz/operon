---
Notes: Command that re-scans the vault and rebuilds the Operon task index
Icon: refresh-cw
Color: "#475569"
Updated: 2026-10-13T17:01:21+02:00
---

# Rebuild full index

**Rebuild full index** re-scans eligible notes in your vault and rebuilds the Operon task index from scratch. Run it from anywhere; it does not depend on which note is open.

## How it works

- Running it shows a short "rebuilding" notice while Operon scans eligible sources again, respecting exclusions.
- When it finishes, a second notice reports how many tasks the fresh index holds.

The rebuild reads your Markdown and updates derived index/cache data. It does not change, move, or delete any task; your notes stay the source of truth, and the command simply makes the index match them again. See [[DOCS-045 Markdown task storage|Markdown task storage]].

## When to use it

The index normally keeps itself current as you edit, so you rarely need this. Reach for it when the index may have drifted from your notes:

- Tasks are not appearing where you expect.
- External edits from a sync client, script, or another editor have not been reflected after normal refresh.
- You suspect the index is stale after an unusual change.

First check the source task, view filters, exclusions, and duplicate-id alerts; the full picture is in [[DOCS-054 Missing tasks|Missing tasks]].

## Updating does not normally require this command

Vault Properties now share the main persistent index with canonical and mapped custom fields. On first startup without the new cache, Operon automatically builds it from current notes. A slower first opening can be normal; subsequent valid-cache openings reuse the snapshot and reconcile changes. Manually rebuilding after every update or restart adds work without helping a healthy index. See [[DOCS-046 Plugin data and state files|Plugin data and state files]].

## Rebuild is different from repair

If **Index diagnostics** reports invalid, unsupported, or recovery-required persistent data, a normal rebuild is not permission to overwrite it. Use diagnostics to inspect the state and its confirmed repair action when appropriate. Repair creates a verified cache from current Markdown through the guarded path; it does not restore old task content. Preserve recovery evidence when repair fails rather than deleting files or repeating operations blindly.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-092 Show index stats|Show index stats]]
