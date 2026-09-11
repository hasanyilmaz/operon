---
Notes: The durable identity that keeps a task the same across every surface
Icon: fingerprint-pattern
Color: "#7c3aed"
Updated: 2026-09-11T23:08:45+02:00
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

For deliberately leaving Operon, [[DOCS-135 Convert task to plain|Convert task to plain]] removes an `operonId` through a confirmed command when you want to keep the Markdown content but stop treating it as an Operon task. Do not imitate that operation by deleting the field by hand.

Copying is the interesting case. If you copy a task line, you copy its id too, and now two lines claim one identity. You are allowed to do this; it is not a trap. The moment it happens, Operon detects the clash and the **Operon ID Conflict** manager steps in so the duplication never quietly corrupts your data. From the manager you give one copy a fresh id (or delete it), and the conflict is resolved. So if you simply want a second task, let Operon create it and it starts with its own id; if you deliberately copy one, expect the manager and use it to split the two apart. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].

## Repair an incompatible ID

An incompatible ID does not follow the seven-character lowercase letter-and-digit format. This is different from a duplicate ID, where more than one task claims the same identity. A manually changed value can still be visible on a task without being valid for task actions.

When an affected Inline Task or File Task prompts **Incompatible task ID**, normal task actions are held until the identity is repaired. The task can remain visible; changing view modes does not make the ID valid.

1. Choose **Regenerate ID** to let Operon replace the incompatible identity with a valid, unique ID and update supported references to the old ID. These include task relationship fields and linked Task Cards.
2. Wait for **ID regenerated. Try the action again.**
3. Repeat the action you originally wanted, such as changing status or opening the editor. Regeneration does not automatically replay it.

Choose **Cancel** to leave the ID unchanged and return without performing the attempted action. Repair is explicit; simply displaying a task does not regenerate its ID.

Operon updates recognized identity references rather than replacing every occurrence of the same text in your notes. If the task or its references cannot be matched safely, resolve the reported problem before retrying. For multiple tasks sharing one ID, use the separate [[DOCS-055 Duplicate IDs|Operon ID Conflict manager]].

### If regeneration cannot finish

A notice naming **invalid YAML properties** identifies a file whose frontmatter must be corrected before repair can proceed safely. This refers to that file's properties, not to the task's Note field. Inspect the named file, fix its YAML, and try again. The notice identifies the file without displaying its raw contents.

For **Task ID repair was not applied**, review the latest task before retrying. For **Task ID repair could not be verified**, inspect the affected files first; do not assume either success or failure and repeatedly regenerate the ID. A general failure notice also directs you back to the task source.

## FAQ

**Is the operonId private or telemetry?** No. It is local identity inside your vault. It implies no account and no remote tracking.

**Why not hide it completely?** Because the task lives in Markdown. Showing the id keeps the file self-contained and inspectable.

**Can a visible task still have an invalid ID?** Yes. Visibility is not validation. Use the incompatible-ID prompt to repair it before trying the task action again.

**Can I reuse an id on purpose?** Only in template workflows that intentionally repeat one id to wire relationships. See [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-013 File tasks|File tasks]]
