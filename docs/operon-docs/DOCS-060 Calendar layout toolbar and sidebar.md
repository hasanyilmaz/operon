---
Notes: Switch the Calendar between a top toolbar and a side panel
Icon: panel-left
Color: "#0284c7"
Updated: 2026-07-23T16:45:34
---

# Calendar layout: toolbar and sidebar

The [[DOCS-028 Calendar overview|Calendar]] can wear two layouts, and you switch between them with one button. **Toolbar** mode puts the controls in a strip across the top and gives the grid the whole width. **Sidebar** mode moves the controls and a set of working panels into a column beside the grid. Same Calendar, same tasks, two different ways to sit on screen. The right one depends on how wide the leaf is and what you are doing.

## Switching modes

In toolbar mode, the toggle is the panel button at the start of the toolbar: **Toggle to sidebar**. In sidebar mode, the matching **Toggle to toolbar** button takes you back. The choice is per Calendar leaf, so one Calendar can run as a wide toolbar board while another lives as a narrow sidebar panel.

## Toolbar mode

Toolbar mode is the default and the roomiest. A single strip across the top holds the title, the date navigation, and the view controls, and everything below it is grid. Reach for it when the Calendar is your main, full-width surface and you want as much of the day or week visible as possible. A compact preset-picker button sits among those controls; see "Switching presets" below.

## Sidebar mode

Sidebar mode places a resizable column next to the grid that holds three collapsible sections:

- **Calendars**: switches between your saved [[DOCS-029 Calendar presets and time grid|Calendar presets]]. See "Switching presets" below for what this section shows.
- **Task Pool**: a working list of tasks you can drag straight onto the grid to schedule them. It has modes (overdue, unscheduled, all, and finished) and a search box. For its modes, search, and how it relates to the preset filter, see [[DOCS-095 Calendar Task Pool|Calendar Task Pool]].
- **Finished Tasks**: completed work, kept out of the way but reachable.

## Switching presets

Both layouts give you a way to jump to another Calendar preset without opening settings:

- On the **toolbar**, a compact preset-picker button opens a searchable, keyboard-accessible list of every preset. Type to filter by name, or arrow through the list.
- In the **sidebar**, the **Calendars** section doubles as a preset switcher. On desktop, it lists only your favorite presets as one-click rows, so the list stays short even with many saved presets; a picker button beside the section's toggle opens the same searchable list of every preset as the toolbar's. On mobile, the section lists every preset directly, since there is no separate picker button there.
- Any preset can be marked a **favorite** with the star toggle, wherever presets are listed. Favorites only decide what shows in the sidebar's short list; the searchable picker always shows everything, favorite or not. When the active preset is not a favorite, the sidebar's picker button gets a calm accent so you can still tell which preset is live even though it is not in the short list above it.

Toggling an individual [[DOCS-048 External calendars|external calendar]] source on or off for the current preset is done from **Edit preset**, in its **External Calendars** section, not from the sidebar.

You can drag the sidebar's edge to resize it, or set its width in settings. Each section can start expanded or collapsed, your choice. Reach for sidebar mode when the Calendar lives in a side dock, when the screen is narrow, or when you want the Task Pool at hand to drag unscheduled work onto your week.

## When to use which

- **Toolbar**: a wide, primary Calendar where grid space matters most. Planning a packed week, dragging timed blocks around, reviewing a full day.
- **Sidebar**: a narrow or docked Calendar, or any time you want the Task Pool and the external-calendar list one glance away. Good for steadily pulling unscheduled tasks into a plan.

Many people keep a main Calendar in toolbar mode and a second, docked Calendar in sidebar mode for quick capture and scheduling.

## FAQ

**Is the layout the same as the preset?** No. The preset is what the grid shows (type, range, filtering); the layout is whether the controls and panels sit on top or to the side. See [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]].

**Does switching layout change my tasks or preset?** No. It only moves the controls and panels. The grid, the preset, and your tasks are untouched.

**What is the Task Pool for?** It is a list of tasks, with modes and search, that you drag onto the grid to schedule. It lives in the sidebar. See [[DOCS-095 Calendar Task Pool|Calendar Task Pool]] for the full reference.

**Where did the external calendar toggle in the sidebar go?** Toggling a source for the current preset is now done from **Edit preset**'s **External Calendars** section. The sidebar's **Calendars** section is the preset switcher instead.

## Settings

Operon settings for this live in **Settings → Operon → Views → Calendar**, under the Calendar sidebar settings: the sidebar width, whether the Calendars, Task Pool, and Finished Tasks sections start expanded or collapsed, and whether the Task Pool follows the active Calendar preset filter.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-034 Time tracking|Time tracking]]
- [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]
- [[DOCS-048 External calendars|External calendars]]
