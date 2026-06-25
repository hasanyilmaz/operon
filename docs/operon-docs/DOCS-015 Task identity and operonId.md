---
Up:
  - "[[DOCS-005 Operon core concepts|Operon core concepts]]"
  - "[[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]"
  - "[[DOCS-055 Duplicate IDs|Duplicate IDs]]"
Notes: The durable identity that keeps a task the same across every surface
Icon: fingerprint-pattern
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - operonid
Updated: 2026-06-25T16:47:21
---

# Task identity and operonId

A task needs to stay itself while its shape changes. That is the entire job of the `operonId`. It is the durable identity Operon gives every task, so the same work stays recognizable when it moves, gets renamed, changes status, or switches between inline and file form.

## Why identity exists

Without a stable id, a task system has to guess. Is this checkbox the same work as that card? Did you move a task or make a new one? Title, file path, and line position all change constantly, so none of them can be the anchor. The `operonId` is the one thing that does not change, which is what lets Operon connect a task across the index, Task Editor, filters, Calendar, Kanban, recurrence, pinning, parent links, and time tracking without ever treating it as a new task.

## What an operonId looks like

It is a 7-character lowercase code made of letters and digits (`a` to `z`, `0` to `9`):

```md
- [ ] Draft release notes {{operonId:: abc1234}}
```

In a file task it sits in frontmatter instead:

```yaml
---
operonId: abc1234
---
```

The id is visible because Operon keeps tasks in Markdown, not in a hidden database. Seeing it is normal. Operon generates it for you and checks it against existing ids so two tasks do not collide. The `abc1234` above just shows the **shape** of an id; do not type or copy a literal id when making a task.

## How many ids are possible

The id space is large enough that you can mint a fresh random id whenever you need one. Each of the 7 positions holds one of 36 characters (`a` to `z` and `0` to `9`), so the number of possible ids is:

```text
36^7 = 78,364,164,096
```

That is about **78.3 billion** ids. A random id is therefore extremely unlikely to repeat, which is why Operon can simply generate one on demand and only needs to check against existing ids for the rare collision. To create one, let Operon mint it: use the [[DOCS-020 Task Creator|Task Creator]], or in a copyable example write the `{{operonId}}` template variable, which becomes a real id on paste. See [[DOCS-061 operonId template variables|operonId template variables]].

## Identity survives change

A task keeps its `operonId`, and therefore its identity, through almost everything you do: editing the title, changing fields, moving through statuses, scheduling, pinning, tracking time, and opening it in any view. It also survives conversion between inline and file form **when Operon performs the conversion**, because Operon carries the id forward. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].

The practical rule: use Operon actions for structural changes. The plain text is yours to edit freely; the identity is system memory.

## What not to do by hand

Treat `operonId` as read-only in normal use:

- **Do not edit it.** Changing it makes Operon see a different task.
- **Do not delete it.** Removing it strips the task of its durable identity.

Copying is the interesting case. If you copy a task line, you copy its id too, and now two lines claim one identity. You are allowed to do this; it is not a trap. The moment it happens, Operon detects the clash and the **Operon ID Conflict** manager steps in so the duplication never quietly corrupts your data. From the manager you give one copy a fresh id (or delete it), and the conflict is resolved. So if you simply want a second task, let Operon create it and it starts with its own id; if you deliberately copy one, expect the manager and use it to split the two apart. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].

## FAQ

**Is the operonId private or telemetry?** No. It is local identity inside your vault. It implies no account and no remote tracking.

**Why not hide it completely?** Because the task lives in Markdown. Showing the id keeps the file self-contained and inspectable.

**Can I reuse an id on purpose?** Only in template workflows that intentionally repeat one id to wire relationships. See [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-013 File tasks|File tasks]]
