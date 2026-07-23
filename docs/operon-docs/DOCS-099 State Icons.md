---
Notes: The fallback icon a task shows when it has no taskIcon, plus the color source for the main task icon
Icon: square-check-big
Color: "#ca8a04"
Updated: 2026-07-23T16:45:34
---

# State Icons

Every Operon task shows a small icon at its start, the glyph on its checkbox. When a task carries its own icon, that icon is used. But most tasks do not set one, and **State Icons** decide what they show instead. This page is about that fallback, the color source for the same main task icon, and the exact order Operon follows to choose the icon.

These fallbacks and colors apply wherever the main task icon renders as an Operon status control: in Live Preview, Filter View rows, Kanban cards, Table task icon cells, the Pinned Task Dock, FlowTime, Time Session History, and the other Operon task views.

> **MEDIA-DOCS-099-1:** Three task rows in the open, finished, and cancelled states, each showing its fallback state icon.

![MEDIA-DOCS-099-1 - Task rows with fallback state icons](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-099-1.png)

## Where it lives

Open **Settings → Operon → Interface → State Icons**. The tab has one group, **Task Icon Fallbacks and Colors**, with two dropdowns, **Fallback icon source** and **Task icon color source**, plus three icon fields: **Open**, **Finished**, and **Cancelled**.

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

## Task icon color source

The **Task icon color source** dropdown chooses how Operon colors the main task icon used to cycle status. It does not change which icon is selected; that still follows the fallback order above. It only decides the tint applied to the icon.

| Source | Icon color comes from | Falls back when |
|---|---|---|
| Status color (default) | the task's current status color | the status has no usable color |
| Task color | the task's own `taskColor` field | the task has no usable task color |
| Priority color | the task's priority color | the task has no priority color |
| No color | no color source; the icon stays neutral | always |

Use **Status color** when the icon should read like workflow state, **Task color** when you use task colors as a project or category signal, and **Priority color** when urgency should be visible on the icon itself. Choose **No color** when you want the glyph without any task-specific tint.

## A worked example

Say the fallback source is **Pipeline status icons** and a task has no taskIcon of its own:

- If the task's status has an icon, that status icon shows. (step 2)
- If the status has no icon, Operon looks at the checkbox state and shows the matching state icon: the Finished icon if the task is done, the Cancelled icon if cancelled, otherwise the Open icon. (step 3)

Switch the fallback source to **State icons** and the middle step is skipped: the same task always shows the state icon for its checkbox state, regardless of its status or priority. The task icon color source is separate, so that state icon can still be tinted by status, task, or priority color, or left neutral.

## Defaults

Out of the box, the fallback icon source is **Pipeline status icons**, and the task icon color source is **Status color**. The state icons are `obsidian` for open, `circle-check-big` for finished, and `square-x` for cancelled. So with a fresh setup, iconless tasks pick up status icons where statuses define them, fall back to those three state glyphs where they do not, and tint the main task icon from the task's status color.

## FAQ

**My task has a taskIcon but shows something else.** It should show the taskIcon; that always wins. Check that the icon value is actually set on the task and is a valid icon name.

**I set the source to Priority icons but tasks show state icons.** That happens when the task's priority has no icon configured, or the task has no priority. Operon then falls straight to the state icon. Give the priority an icon, or expect the state icon.

**Does the source cascade through status then priority then state?** No. It checks the one source you selected, then the state icon. It does not try the other source in between.

**Where do these icons appear?** In Live Preview and the compact task rows across Operon's views. They are the icon on the task's checkbox.

**Does Task icon color source change which icon is used?** No. It only changes the icon's color. The task's own taskIcon, the fallback icon source, and the state icons still decide the glyph.

**Why is a task icon uncolored?** The color source may be **No color**, or the chosen source may not have a usable color for that task. For example, **Task color** needs a taskColor value, and **Priority color** needs a priority with a color.

## Settings

Everything here lives in **Settings → Operon → Interface → State Icons**: the **Fallback icon source** dropdown (Pipeline status icons, Priority icons, or State icons), the **Task icon color source** dropdown (Status color, Task color, Priority color, or No color), and the **Open**, **Finished**, and **Cancelled** icon fields, each set with the icon picker.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-066 Icon picker|Icon picker]]
