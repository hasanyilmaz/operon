---
Up:
  - "[[DOCS-062 Field pickers overview|Field pickers overview]]"
  - "[[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]"
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
Notes: Pickers that select tasks, notes, and lists of values, plus the estimate picker
Icon: link
Color: "#db2777"
tags:
  - operon
  - pickers
  - links
  - lists
Updated: 2026-06-25T16:47:21
---

# Task link and list pickers

Several fields are filled by picking from things that already exist: a task to be the parent, people to assign, contexts to tag. These pickers work alike, you search and choose, so they share a page. What separates them is the field's **property type**, and that type changes how the picker behaves: a **Text** field takes one value, a **List** field takes many, and a **Number** field takes a quantity. This page is organized by that type, because it is what you need to know.

> **MEDIA-DOCS-069-1:** A single-value link picker beside a multi-value list picker, showing the difference.

![MEDIA-DOCS-069-1 - Link picker and list picker comparison](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-069-1.png)

## Text type: a single link

A **Text** field holds one value, so its picker selects exactly one thing.

- **`parentTask`** picks the task's single parent. You search your tasks and choose one; the field stores that one task's `operonId`. Selecting another parent replaces the first, because there is only one parent. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

That is the shape of a single link: search, pick one, done. Clearing it leaves the task with no parent.

## List type: many links or values

A **List** field holds several values, so its picker lets you **add more than one** and build up a list. You search, add an entry, and keep adding; each becomes its own item. These fields are List type:

- **`assignees`**: who does the work.
- **`contexts`**: environment or condition the task belongs to.
- **`tags`**: labels on the task.
- **`links`**: external web links.
- **`related`**: related notes and references.

The picker suggests matching values as you type, often from notes and from values used elsewhere, so a vocabulary you already use is one keystroke away. You remove items individually, and the field keeps the order you built.

> **MEDIA-DOCS-069-2:** A list picker with several values added and a suggestion appearing for the next one.

![MEDIA-DOCS-069-2 - List picker with multiple values](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-069-2.png)

## Dependencies: a special list

**`blocking`** and **`blockedBy`** are also **List** fields, and their pickers select tasks, like the parent picker but plural: the tasks this one blocks, or the tasks blocking it. They build a dependency link between tasks. Operon also maintains the other side of a dependency for you, so adding "A blocks B" is reflected on B. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

## Number type: the estimate

**`estimate`** is a **Number** field, so its picker is a quantity, not a search: you enter how long you expect the task to take. It is stored as a duration. The same numeric picker is what a custom key of type Number uses. See [[DOCS-034 Time tracking|Time tracking]] for how estimate compares with tracked duration, and [[DOCS-070 Custom field pickers|Custom field pickers]].

## FAQ

**Why can I add many assignees but only one parent?** `parentTask` is a Text field, which holds one value; `assignees` is a List field, which holds several. The picker follows the type.

**Where do the suggestions come from?** From values already in use and from notes, so you reuse a consistent vocabulary instead of retyping.

**Do I set both sides of a dependency?** No. Set one side, such as "blocks," and Operon reflects it on the other task.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
