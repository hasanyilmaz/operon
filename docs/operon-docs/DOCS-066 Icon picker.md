---
Notes: Search the Lucide icon library to set a task or field icon
Icon: shapes
Color: "#db2777"
Updated: 2026-07-23T16:45:34
---

# Icon picker

The icon picker lets you give a task an icon by searching the [Lucide](https://lucide.dev) icon library. Type what you are looking for, see matching icons in a grid, and click one. It is how a task earns a visual marker that shows up wherever the task does.

The `taskIcon` field is property type **Text**: it stores the icon's name, like `flag` or `rocket`. The picker just helps you find that name. See [[DOCS-012 Inline task syntax|Inline task syntax]].

> **MEDIA-DOCS-066-1:** The icon picker with a search term and a grid of matching Lucide icons.

![MEDIA-DOCS-066-1 - Icon picker Lucide search grid](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-066-1.png)

## Search and pick

Open the picker and type a word, such as `flag`, `calendar`, or `star`. The grid fills with Lucide icons that match, and a count tells you how many were found. Click an icon to set it. The grid loads more as you scroll, so a broad search still performs.

A **Clear** action removes the icon, leaving the task without one.

## The same picker, several places

The icon picker is not only for the task icon. The same control sets:

- A **task's icon** (`taskIcon`).
- A **field's icon** in [[DOCS-039 Key mappings|Key mappings]], the centralized icon for a canonical field.
- A **custom key's icon**. See [[DOCS-040 Custom keys|Custom keys]].

Because it is one picker, choosing an icon works the same way everywhere, and every icon comes from the same Lucide set.

## Where the icon shows

A task's icon appears on its [[DOCS-041 Task chips display and behavior|chips]] and task markers across views, so it is a fast visual cue. Pair it with a [[DOCS-067 Color picker|color]] to make a task or a whole category stand out at a glance.

## FAQ

**Where do the icons come from?** The Lucide icon library, the same set Obsidian uses.

**What does the field actually store?** The icon's name as text, like `flag`. The picker finds the name for you.

**Can I remove an icon?** Yes. Use Clear and the task has no icon.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
