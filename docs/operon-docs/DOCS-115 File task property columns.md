---
Notes: Frontmatter properties Operon does not manage, surfaced automatically as searchable, typed columns and filter conditions
Icon: scan-search
Color: "#ca8a04"
Updated: 2026-07-23T16:45:34
---

# File task property columns

A [[DOCS-013 File tasks|file task]] is a note, and a note can carry frontmatter properties that have nothing to do with Operon: a book's `author`, a meeting's `attendees`, a project's `budget`. Operon does not manage these, but it does not ignore them either. It finds them, works out their type, and turns each one into a real, typed column you can add to a [[DOCS-105 Table overview|Table]] or use as a condition in a [[DOCS-025 Filter View|filter]], with no setup step at all. This page explains what makes that possible, how it differs from [[DOCS-040 Custom keys|Custom keys]] and [[DOCS-039 Key mappings|Key mappings]], and where it does and does not reach.

> **MEDIA-DOCS-115-1:** The Table column picker, with a "File task properties" group listing frontmatter properties discovered from the current scope.

![MEDIA-DOCS-115-1 - The column picker's File task properties group](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-115-1.png)

## Why this is not a Custom Key, and not a Key mapping

Operon already has two ways to make a frontmatter property a real field, and this is neither of them:

- A **[[DOCS-039 Key mappings|Key mapping]]** renames a field Operon already has. It cannot introduce a field of its own.
- A **[[DOCS-040 Custom keys|Custom key]]** introduces a genuinely new field, but only after you set it up: a visible name, a type, an optional icon, and a choice of which surfaces show it. From then on it is a real canonical key, written the same way on every task.

A file task property column skips that setup entirely. You never declare it, name it, or type it anywhere in Operon. You just write a property in a note's frontmatter, and if a Table's current scope includes that note, the property shows up in the column picker on its own, already typed. This is the point of the feature: not every property in your vault is worth promoting to a full Custom Key, but you still want to search, sort, and group by it right now, on the tasks in front of you, without a settings trip first.

The tradeoff is reach. A Custom Key behaves like a built-in field everywhere: the [[DOCS-021 Task Editor|Task Editor]], [[DOCS-020 Task Creator|Task Creator]], chips, and Kanban swimlanes. A file task property column does not appear in any of those; its reach is Table columns and filter conditions. See "Where it reaches" below.

## What counts as unmanaged

A property is offered as a file task property column only when Operon is not already responsible for it. Excluded automatically:

- Any property that is already a canonical key or a key mapping's visible name, built-in or custom. Delete the Custom Key or key mapping and the same property becomes unmanaged again, and reappears here.
- Obsidian's own reserved properties: `aliases`, `cssclasses`, `position`, `tags`, `title`, and Operon's `pinned`.
- Any property whose name starts with `_`, Operon's convention for internal-only data.

Everything else your notes' frontmatter actually contains is fair game.

## Where it comes from: File Tasks in view, not the whole vault

Discovery only looks at **file tasks**, since only they have frontmatter; inline tasks have nothing to scan. Within that, a Table's column picker discovers properties from the tasks the **current preset's filter scope** actually contains, not every file task in the vault. Switch to a preset with a narrower or different filter and the list of available property columns changes with it, because a different set of notes is now in view.

Building a filter condition works a little differently, on purpose: since the filter you are building is what decides the scope, Operon cannot wait for that scope to exist first. The filter editor discovers properties from every file task in the vault instead, so you can reach for `budget` or `attendees` while writing the very condition that will later narrow the scope.

## Type: read from Obsidian, not decided by you

A Custom Key's type is a choice you make once, up front. A file task property column's type is not chosen at all: Operon reads it. If you set the property's type in Obsidian's own **Properties** view, Operon uses that. If you never set one there, Operon infers a type from the values it finds across the notes in scope, falling back to plain text when the values do not clearly suggest anything else.

Either way, the result is one of the same types [[DOCS-070 Custom field pickers|Custom field pickers]] already use: Text, Number, Date, Date & time, List, or Checkbox. A property Obsidian calls `Tags` or `Multitext` maps to Operon's List type; anything else maps directly.

## Editing: the same pickers as Custom Keys, one better

Click an editable file task property cell and you get exactly the picker its type calls for: the same text field with reuse suggestions, number entry, date picker, date and time picker, or list picker that a Custom Key of that type would use. See [[DOCS-070 Custom field pickers|Custom field pickers]] for what each one looks like. Nothing here is a lesser version of those controls.

The one place a file task property column goes further than a Custom Key is **Checkbox**. A Checkbox Custom Key is stored but has no picker surface at all today. A Checkbox file task property column gets a small toggle chip right in the cell, click to flip it between true and false. If the underlying value is not really a boolean, the cell shows it as read-only and clicking it explains that the property needs fixing in Obsidian's own Properties view first.

**Removing a value** is its own action, separate from clearing a picker. Right-click a filled, editable cell for a **Remove property** option, which deletes that property from the note's frontmatter entirely rather than leaving it behind as an empty value.

## When a cell can't be edited

A file task property cell drops to read-only whenever its value does not actually match the column's type: a `List` column whose YAML value is not a plain list, a `Number` column holding text, and so on. This is not Operon guessing wrong; it is Operon refusing to write a value it cannot confidently round-trip. Fix the property's shape in Obsidian's Properties view (or the frontmatter directly) and the cell becomes editable again on its own.

## Conflict and drift safety

Because these are raw properties rather than fields Operon fully owns, a few safety states exist that Custom Keys do not need:

- **Changed outside the table**: if the property's value changed elsewhere between when Operon read it and when you tried to save an edit, the write is refused and a notice tells you the latest value was restored, rather than silently overwriting someone else's change.
- **Unavailable in current scope**: a filter, sort, or group rule that references a file task property keeps working even when that property temporarily has no matching tasks in scope; it reactivates on its own once matching data returns, instead of being silently dropped.
- **Type changed, review required**: if a property's Obsidian-declared type changes after you have already built a rule around it, the rule stays saved but is flagged for review, since the old comparison may no longer make sense against the new type.

None of these needs your attention until they actually happen; they exist so a saved filter, sort, or group never breaks quietly.

## Where it reaches: Table, and every filter surface

- **Table** gets the full set: add it as a column, edit it, search it, and use it in **Group by**, **Subgroup by**, **Sort by**, and column summaries, the same as any built-in field. See [[DOCS-106 Table columns|Table columns]], [[DOCS-107 Table grouping and sorting|Table grouping and sorting]], and [[DOCS-108 Table summaries|Table summaries]].
- **Filters** can test a file task property as a typed condition. Text, Number, Date, Date & time, and List conditions mostly reuse the same operators their built-in counterparts already have, with `property is present` and `property is missing` added to Date, Date & time, and List so a condition can tell a genuinely missing property apart from one that is merely empty; a Checkbox property gets its own `is true` / `is false` set instead of the built-in Checkbox field's open, done, and cancelled states, since it is a real boolean rather than a task's own workflow state. See [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]. Because a saved filter can scope a [[DOCS-025 Filter View|Filter View]], [[DOCS-028 Calendar overview|Calendar]], or [[DOCS-030 Kanban overview|Kanban]], a condition built on a file task property works on all of them, plus the Settings filter preview and embedded filters and tables.
- **Calendar and Kanban** use these properties only through a filter's condition, to decide which tasks are in scope. They do not show a file task property as a Calendar field or a Kanban swimlane.
- **Task Editor, Task Creator, chips, and Kanban swimlanes** do not show file task property columns at all. Those surfaces remain Custom Key territory; promote the property to a Custom Key if you want it there too.

## Tips

> [!tip] Try it before you commit to a Custom Key
> When you are not sure a property is worth a permanent Custom Key, a Table already answers that question for you. Add the property as a column, sort and group by it a while, and if it earns a permanent place across the Task Editor and chips too, promote it to a Custom Key then. Nothing about using it as a file task property column first gets in the way of that later step.

## FAQ

**Do I have to turn this on somewhere?** No. There is no setting to enable. Any unmanaged frontmatter property on a file task in scope is offered automatically.

**Why did a property I expected disappear from the column picker?** Its scope changed. The column picker only offers properties found on file tasks in the current preset's filter scope, so switching presets or filters changes what is available.

**Can I edit a file task property on an inline task?** No. Inline tasks have no frontmatter, so there is nothing to discover or edit; this feature applies to file tasks only.

**What is the difference between this and a Custom Key sharing the same property name?** Once a property becomes a Custom Key's visible name, it is excluded from file task property discovery and behaves as the Custom Key instead: same value, but now reachable from the Task Editor, Task Creator, chips, and swimlanes too.

**Why is my Checkbox column read-only?** Its value is not a real boolean. Fix it from Obsidian's Properties view, and the cell becomes editable again.

**I built a filter condition on a property and then changed its type in Properties. Did my filter break?** No. The condition stays saved but is flagged for review, since the comparison may need a second look against the new type.

## Settings

There is nothing to configure. Discovery, typing, and exclusion are all automatic. The properties this feature stays out of are governed by **Settings → Operon → Core → Keymapping** and **Settings → Operon → Core → Custom Keys**: anything already mapped there is excluded from file task property discovery.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-040 Custom keys|Custom keys]]
- [[DOCS-039 Key mappings|Key mappings]]
- [[DOCS-070 Custom field pickers|Custom field pickers]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]
- [[DOCS-013 File tasks|File tasks]]
