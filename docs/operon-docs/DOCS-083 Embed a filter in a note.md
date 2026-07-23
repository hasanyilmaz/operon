---
Notes: Render a saved filter's live task list inside any note
Icon: panel-top
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Embed a filter in a note

The [[DOCS-025 Filter View|Filter View]] is a surface you open. Sometimes you want the list inside a note instead, so a project note shows its own tasks. Operon does this with a small code block that points to a saved filter by its id, and replaces the block with a live task list, the same one the Filter View would show.

## The code block

Embed a filter with an `operon` code block that references a saved filter by its id:

````md
```operon
filterId: "fs_2pv2ls9"
```
````

Operon replaces the block with the filter's results, rendered with the same task bars and the same evaluator as the Filter View, so the embedded list stays live as your tasks change. The filter is always referenced by its id, so the easiest way to get the block right is Copy embed code, below.

## The easy way: Copy embed code

You do not have to find the id yourself. Open the filter you want, use **Copy embed code**, and Operon puts the right block, with the correct `filterId`, on your clipboard. Paste it into any note and the list appears. This is the reliable path, and the one to use.

## What you can embed

Any saved filter works, so the embedded list is as precise as the filter behind it. Build the filter once with the conditions you want (see [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]), then embed it wherever the list belongs. Saved filters are managed in **Settings → Operon → Views → Filters**.

A common use is a **project note that owns its tasks**: give the project a filter that matches its task tree, embed it at the bottom of the note, and the note becomes both the context and a live view of the work it holds.

You can embed a **table** the same way, with its own Copy embed code, when you want the tasks as rows and columns rather than a list. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

## FAQ

**How do I get the right `filterId`?** Use Copy embed code on the filter; it writes the correct id into the block for you. The embed references a filter only by its id.

**Does the embedded list update?** Yes. It uses the same live evaluation as the Filter View, so it reflects your tasks as they change.

**Where do I manage the filters I embed?** In Settings, under Views then Filters, the same saved filters the Filter View uses.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-010 Build your first filtered view|Build your first filtered view]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
