---
Up:
  - "[[DOCS-066 Icon picker|Icon picker]]"
  - "[[DOCS-037 Pipelines and statuses|Pipelines and statuses]]"
  - "[[DOCS-038 Task priorities|Task priorities]]"
Notes: The fallback icon a task shows when it has no taskIcon, and the order Operon checks
Icon: square-check-big
Color: "#ca8a04"
tags:
  - operon
  - settings
  - icons
  - interface
  - configure
Updated: 2026-06-25T16:47:21
---

# State Icons

Every Operon task shows a small icon at its start, the glyph on its checkbox. When a task carries its own icon, that icon is used. But most tasks do not set one, and **State Icons** decide what they show instead. This page is about that fallback: the icon a task displays when it has no icon of its own, and the exact order Operon follows to choose it.

These fallbacks apply wherever tasks render as Operon rows: in Live Preview and in the compact task rows across the Filter View, Kanban, the Pinned Task Dock, and the other Operon views.

> **MEDIA-DOCS-099-1:** Three task rows in the open, finished, and cancelled states, each showing its fallback state icon.

![MEDIA-DOCS-099-1 - Task rows with fallback state icons](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-099-1.png)

## Where it lives

Open **Settings → Operon → Interface → State Icons**. The tab has one group, **Fallback task state icons**, with a **Fallback icon source** dropdown and three icon fields: **Open**, **Finished**, and **Cancelled**.

## The fallback order

When Operon needs to draw a task's icon, it checks sources in a fixed order and uses the first one that produces an icon:

| Order | Operon checks | This wins when |
|---|---|---|
| 1 | The task's own **taskIcon** | the task has a taskIcon set |
| 2 | The **Fallback icon source** you selected | step 1 is empty and that source has a matching icon |
| 3 | The **state icon** for the task's checkbox state | nothing above produced an icon |

So a task icon you set yourself always wins. Only when a task has none does the fallback source come into play, and only when that source is also empty does the state icon at the bottom take over. The state icon is the guaranteed last resort: there is always one for every state, so a task is never left without an icon.

## Step 2: the fallback icon source

The **Fallback icon source** dropdown picks the single source Operon consults between the task's own icon and the state icons. It has three choices:

| Source | Operon uses | Falls through when |
|---|---|---|
| Pipeline status icons (default) | the icon set on the task's current [[DOCS-037 Pipelines and statuses\|status]] in its pipeline | that status has no icon |
| Priority icons | the icon set on the task's [[DOCS-038 Task priorities\|priority]] | that priority has no icon |
| State icons | nothing here, it goes straight to step 3 | always (no intermediate lookup) |

The dropdown chooses **one** intermediate source, not a cascade through all of them. With **Pipeline status icons** selected, Operon checks the status icon and, if the status has none, drops directly to the state icon; it does not also try the priority icon. **Priority icons** behaves the same way with priorities. Choosing **State icons** skips the middle step entirely, so every iconless task shows a state icon based purely on its checkbox state.

This is why the result depends on how you set up [[DOCS-037 Pipelines and statuses|statuses]] and [[DOCS-038 Task priorities|priorities]]: if your statuses carry icons and the source is Pipeline status icons, most tasks pick up a status-shaped glyph; if those statuses have no icons, you see the state icons instead.

## Step 3: the state icons

These are the three glyphs at the end of the chain, one per checkbox state. Whatever a task's pipeline or priority, if the steps above are empty, the icon comes from here:

| Checkbox state | State icon field | Default icon |
|---|---|---|
| Open (and any state that is not finished or cancelled) | Open state icon | `obsidian` |
| Finished (done) | Finished state icon | `circle-check-big` |
| Cancelled | Cancelled state icon | `square-x` |

Each field is set through the [[DOCS-066 Icon picker|icon picker]], so you choose from Operon's icon source the same way you do everywhere else. Change any of the three to give open, finished, and cancelled tasks the look you want at a glance.

## A worked example

Say the fallback source is **Pipeline status icons** and a task has no taskIcon of its own:

- If the task's status has an icon, that status icon shows. (step 2)
- If the status has no icon, Operon looks at the checkbox state and shows the matching state icon: the Finished icon if the task is done, the Cancelled icon if cancelled, otherwise the Open icon. (step 3)

Switch the source to **State icons** and the middle step is skipped: the same task always shows the state icon for its checkbox state, regardless of its status or priority.

## Defaults

Out of the box, the fallback icon source is **Pipeline status icons**, and the state icons are `obsidian` for open, `circle-check-big` for finished, and `square-x` for cancelled. So with a fresh setup, iconless tasks pick up status icons where statuses define them and fall back to those three state glyphs where they do not.

## FAQ

**My task has a taskIcon but shows something else.** It should show the taskIcon; that always wins. Check that the icon value is actually set on the task and is a valid icon name.

**I set the source to Priority icons but tasks show state icons.** That happens when the task's priority has no icon configured, or the task has no priority. Operon then falls straight to the state icon. Give the priority an icon, or expect the state icon.

**Does the source cascade through status then priority then state?** No. It checks the one source you selected, then the state icon. It does not try the other source in between.

**Where do these icons appear?** In Live Preview and the compact task rows across Operon's views. They are the icon on the task's checkbox.

## Settings

Everything here lives in **Settings → Operon → Interface → State Icons**: the **Fallback icon source** dropdown (Pipeline status icons, Priority icons, or State icons) and the **Open**, **Finished**, and **Cancelled** icon fields, each set with the icon picker.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-066 Icon picker|Icon picker]]
