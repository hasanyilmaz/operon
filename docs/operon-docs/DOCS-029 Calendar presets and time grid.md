---
Notes: Save Calendar layouts, pick a grid type, and tune the timed grid
Icon: calendar-cog
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Calendar presets and time grid

A Calendar preset is a saved configuration of the [[DOCS-028 Calendar overview|Calendar]]: its grid type, range, filtering, and appearance, bundled so you can switch between ways of looking at your time with one choice. The same Calendar can be a focused hour-by-hour day, a several-week plan, or a review of where your time actually went. Presets are what make that switch instant, and the time grid is the dial for how the timed views feel.

> **MEDIA-DOCS-029-1:** Switching between Calendar presets, with the grid changing type and range.

![MEDIA-DOCS-029-1 - Switching between Calendar presets, with the grid changing type and range](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-029-1.png)

## What a preset saves

A preset is a complete look at the Calendar, grouped into a few areas:

- **Type and range**: which grid layout it uses (below) and how much time it spans, such as the visible day count or week count.
- **Filtering**: which tasks the preset shows, through a [[DOCS-025 Filter View|filter]]. Different presets can show different slices of work.
- **Appearance**: the task color source and the light and dark color schemes (covered below).
- **Visibility**: weekends, projected future occurrences of recurring tasks, and external calendars.

Because all of this is saved together, switching presets reshapes the whole Calendar in one step. New Calendar leaves open with your chosen default preset.

## Preset type: Time Grid

The **Time Grid** is the classic timed calendar: days run across as columns, hours run down the side, and each task with a start and end time sits as a block you can drag and resize. Reach for it when you plan by the hour and want to see a day or a week laid out in time.

It has the finest time controls of the three types:

- **Slot minutes** set the base granularity of the grid.
- **Hidden Time** collapses one interval you never use (for example the small hours), so the grid spends its space on the part of the day you actually plan.
- The **time grid scale** stretches or compresses hour height (covered below).

> **MEDIA-DOCS-029-2:** The Time Grid preset, a week of timed blocks with hours down the side.

![MEDIA-DOCS-029-2 - The Time Grid preset, a week of timed blocks with hours down the side](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-029-2.png)

## Preset type: Time Tracker Grid

The **Time Tracker Grid** is built for looking back, not just ahead. It arranges the day into three lanes so you can compare intent against reality:

- **Planned**: the time blocks you scheduled.
- **External**: events from your external calendars.
- **Tracked**: the time you actually recorded.

Set side by side, these lanes turn the Calendar into a review surface: did the work take the slot you gave it? This is the preset to pair with [[DOCS-034 Time tracking|Time tracking]] and the [[DOCS-053 Time session history|time session history]].

> **MEDIA-DOCS-029-3:** The Time Tracker Grid with its Planned, External, and Tracked lanes side by side.

<iframe
  title="MEDIA-DOCS-029-3 - Time Tracker Grid video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/hDduQEnnnHU"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## Preset type: Multi-Week

The **Multi-Week** preset trades hour-level detail for reach. It shows several consecutive weeks as a block layout, so you can plan and scan further than a single week. Two controls shape it: the **week count** sets how many weeks appear, and the **focused week number** decides where a chosen day lands in that span. Use it for backlog grooming, deadlines weeks out, and any planning that lives above the level of a single day.

> **MEDIA-DOCS-029-4:** The Multi-Week preset showing several weeks of tasks as blocks.

![MEDIA-DOCS-029-4 - The Multi-Week preset showing several weeks of tasks as blocks](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-029-4.png)

## Appearance and color

A preset also decides how its blocks look. The **task color source** chooses what drives a block's color: the task's own color, an accent color, its workflow status color, its priority color, or no color at all. Picking status color makes the grid read like a pipeline at a glance, while priority color makes urgency pop. You set separate color schemes for Obsidian's **light** and **dark** modes, so the Calendar stays readable in both.

## Visibility

Each preset controls what is shown alongside your tasks:

- **Show weekends**: keep Saturdays and Sundays in the grid, or drop them for a workweek view.
- **Show future occurrences**: project upcoming instances of [[DOCS-033 Recurring tasks|recurring tasks]], so a routine appears on the days it will recur.
- **Show external calendars**: include the [[DOCS-048 External calendars|external calendar]] sources chosen for this preset.

## The time grid scale

In the timed views, the **time grid scale** sets how much vertical space an hour takes. A larger scale spreads the hours out, which makes short blocks easier to see and grab. A smaller scale fits more of the day on screen at once. It is a quick comfort dial: stretch the grid when you are fitting detailed blocks, compress it when you want the whole day in view.

## Presets on mobile

On a phone, each mobile Calendar view, Agenda, Day, 2 Days, and 3 Days, opens with its **own chosen preset**. That is how a phone can keep a detail-heavy preset like the Time Tracker Grid on Day while using a lighter planning preset on 2 Days or 3 Days. See [[DOCS-096 Mobile Calendar|Mobile Calendar]].

## Tips

> [!tip] Turn a one-day grid into a daily command center
> Time Grid and Time Tracker Grid work nicely as a focused single-day view. Set the grid to one day, then keep Calendar in a sidebar or a narrow pane, so today's plan and any running time session stay in sight while you work elsewhere in the vault.

## FAQ

**What is the difference between a preset and the time grid scale?** A preset is a whole saved Calendar configuration, including its type. The time grid scale is one setting inside the timed views that controls hour height.

**Which preset type should I start with?** Time Grid for day and week planning, Multi-Week for longer-range planning, and Time Tracker Grid when you want to compare planned against tracked time.

**Can two presets show different tasks?** Yes. Filtering is part of a preset, so each can show its own slice.

## Settings

Operon settings for this live in **Settings → Operon → Views → Calendar**, where you manage Calendar presets, choose each preset's type, range, filtering, appearance, and visibility, set the default preset, and set the time grid scale. The preset assigned to each mobile view is set under **Settings → Operon → Mobile → Calendar**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
