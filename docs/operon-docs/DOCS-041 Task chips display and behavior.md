---
Up:
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
  - "[[DOCS-025 Filter View|Filter View]]"
  - "[[DOCS-040 Custom keys|Custom keys]]"
Notes: The compact field badges on tasks, their per-surface order and visibility, and how each behaves on click and hover
Icon: tags
Color: "#ca8a04"
tags:
  - operon
  - settings
  - chips
  - configure
Updated: 2026-07-22T19:06:07
---

# Task chips: display and behavior

A task chip is a small badge that shows one of a task's fields at a glance: its priority, its due date, its assignees. Chips are how a task wears its metadata where you see it, without opening the task. This page covers both halves of that: what chips show and where, and how each one behaves when you click or hover it, because a chip is not just a label, it is a control.

> **MEDIA-DOCS-041-1:** A task displaying several chips: status, priority, due date, and assignees.

![MEDIA-DOCS-041-1 - Task row with metadata chips](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-041-1.png)

## What chips can show

Chips cover the fields you most often want at a glance:

- **Status** and **Priority**.
- Dates: **Due**, **Scheduled**, **Start**, and the completion and cancellation dates.
- **Assignees** and **Contexts**.
- Task links: **Parent**, **Blocking**, and **Blocked by**.
- **Estimate** and **Duration**, and their rolled-up totals.
- **Recurrence**, showing a recurring task's pattern (the `repeat` field).
- **Reminders**, one chip per reminder, from either reminder field. See [[DOCS-116 Reminders|Reminders]].
- **Location**, shown as a small map chip.
- **Tags** and external **Links**.

Your own [[DOCS-040 Custom keys|custom keys]] can appear as chips too, when you turn on "Show in chips" for them, so the row can carry exactly the fields your workflow cares about.

## Each surface is configured separately

Chips follow a task across several surfaces, and each surface has its **own** chip configuration: which chips show, in what **order**, and whether any is **Icon Only**. So a busy Filter View can carry a shorter set than an inline row, arranged differently. The five surfaces, each its own settings page under **Settings → Operon → Interface → Task Chips**, are:

- **Inline Task Chips**: the compact chip row on inline tasks in Live Preview and reading view.
- **Filter Task Chips**: the chips on rows in the [[DOCS-025 Filter View|Filter View]].
- **Task Finder Chips**: the chips in Task Finder results.
- **Kanban Task Chips**: the chips on main cards in the [[DOCS-030 Kanban overview|Kanban]].
- **Task Wikilink Overlay Chips**: the chips on a task wikilink overlay, which now decorates both file-task links and inline links written as `[[File#-operonId]]`. See [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]].

Because each is independent, you tune the chip row per place rather than once for everything.

> **MEDIA-DOCS-041-2:** The Task Chips settings for one surface, toggling visibility, reordering chips, and setting Icon Only.

![MEDIA-DOCS-041-2 - Task Chips settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-041-2.png)

## Showing, hiding, and Icon Only

For each chip on each surface you can turn its visibility on or off, and set it to **Icon Only**, which drops the text and shows just the icon, a tidy way to keep a busy row compact while still signalling the field. On interactive surfaces, an Icon Only chip can show a small preview of its full content when you click it, so nothing is lost by hiding the text.

## Kanban card chips

Kanban cards use the **Kanban Task Chips** surface. On desktop, Kanban chips behave like the same chips elsewhere: editable chips open their pickers, link-like chips open or preview their target, and location chips open the map popover. A card only shows the chips you chose to display, with nothing standing in for the ones you hid.

The end of the Kanban Task Chips page also has **Kanban Task Actions**. These control the trailing action chips on Kanban cards, such as Play, Pin, Note, Add subtask, and Open checkboxes. When the Play action is enabled, it turns into Stop while that task's timer is running.

On mobile Kanban, the same chip area stays visible but read-only. Tapping chips or action chips does not open pickers, links, previews, map popovers, or actions, so card tap, scroll, and long-press drag remain the main touch gestures. If a task has a Project Serial, that serial appears first on the main Kanban card as a display-only identity chip, even though Project Serial is not controlled by the Kanban Task Chips settings list. Descendant preview cards do not show chip rows.

## How a chip behaves when you click it

On interactive surfaces, clicking a chip does something specific to its field. Some chips are quick editors, and some are navigators:

| Chip | Clicking it |
|---|---|
| Status | Cycles the task's status |
| Priority | Opens the priority picker |
| Due, Scheduled, Start, and the other dates | Opens the date picker |
| Estimate | Opens the estimate picker |
| Recurrence | Opens the recurrence picker |
| Reminder | Reopens that reminder's picker, to change or remove it |
| Assignees, Contexts, Parent, Blocking, Blocked by | Opens the linked task or note, creating it if it does not exist yet |
| Tags | Opens Obsidian's tag search for that tag |
| Links | Opens the external link |
| Location | Opens the map popover (see below) |

So status, priority, dates, estimate, and repeat let you change the value on the spot, while the link, tag, and location chips take you somewhere.

## Wikilink chips: open and preview

The task-link chips (Assignees, Contexts, Parent, Blocking, Blocked by) and any custom list or text chip whose value is a wikilink point at a note. Two behaviors follow:

- **Click** the chip to open that note. This is **create or open**: if the linked note already exists, it opens; if it does not exist yet, Obsidian creates it and opens the new note, the same as clicking any wikilink.
- **Cmd or Ctrl and hover** the chip to get **Page Preview**, the same hover preview you get on any internal link. This requires Obsidian's **core Page Preview plugin** to be enabled (Settings, Core plugins, Page preview). A plain hover does not trigger it; the modifier key does.

## Date chips change color

The **Due** and **Scheduled** chips signal urgency by color, so a glance tells you what is pressing:

- **Overdue** (the date is before today): the chip turns **red**.
- **Today** (the date is today): the chip turns **blue**.
- Otherwise it stays neutral.

Once a task is finished or cancelled, its date chips drop the color, because the deadline no longer presses. Only Due and Scheduled take these colors; the other date chips stay neutral.

## The recurrence chip

A recurring task shows a **recurrence chip** (from its `repeat` field) that summarizes the pattern: the recurrence rule, or the next occurrence date, or that the next run comes after completion, along with an end if the series has one. You read the rhythm at a glance, and clicking the chip opens the recurrence picker to change it. See [[DOCS-033 Recurring tasks|Recurring tasks]].

## Reminder chips

Reminders differ from every other field here in two ways.

**One chip per reminder, not per field.** A task with two fixed reminders and a rule shows three chips, each carrying its own value, rather than one chip holding a list. Clicking a chip reopens that reminder's own picker so you can change or remove it. A fixed reminder shows just the time when it falls today and the date with the time otherwise; a rule shows itself in words, as **1d before Due date**.

**They are hidden by default on every surface.** Most tasks carry no reminders, so the chips stay off until you ask for them, on each surface separately like any other chip. Turning them off is purely visual: the reminders stay on the task and keep firing regardless.

A chip also carries the reminder's state, which is how you spot one that will not fire:

| State | What it means |
|---|---|
| Normal | Scheduled, still ahead |
| Past reminder | Its moment has gone by |
| Unresolved reminder | A rule whose reference date is missing, so nothing is scheduled |
| Invalid reminder | The stored value could not be read |

See [[DOCS-116 Reminders|Reminders]] for what the two reminder fields are, and [[DOCS-117 Reminder rules|Reminder rules]] for how a rule resolves.

## The location chip

Location is a special chip. The `location` field stores coordinates as latitude, longitude, and Operon shows it as a **map chip** rather than plain text. Clicking it opens a small **map popover** you can pan around. **Drag the map** and the popover **pins open**, staying in view for continuous reference instead of closing when you move away; a pin control toggles that state.

The chip works on its own from your coordinates or a place note. If the community **Maps** plugin is enabled, the popover gains a rendered map; without it you still get a working location chip and popover, just without the drawn map. A place note can also supply the marker's icon and color. See [[DOCS-068 Location picker|Location picker]].

> **MEDIA-DOCS-041-3:** The location chip's map popover pinned open after dragging the map.

![MEDIA-DOCS-041-3 - Location chip map popover](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-041-3.png)

## Custom-key chips behave like their type

A custom key shown as a chip inherits the behavior of its type. A custom **list** or **text** field whose value is a wikilink behaves like the built-in link chips: click to open the note (creating it if it does not exist yet), Cmd or Ctrl and hover for a preview. So once you turn on "Show in chips" for a custom key, its chip is not just a label, it carries the same click and preview behavior as the built-in fields of the same shape. See [[DOCS-040 Custom keys|Custom keys]].

## Settings

Chip configuration lives in **Settings → Operon → Interface → Task Chips**, with a separate page for each surface: **Inline Task Chips**, **Filter Task Chips**, **Task Finder Chips**, **Kanban Task Chips**, and **Task Wikilink Overlay Chips**. On each you set which chips show, their order, and which are Icon Only. The location chip's rendered map preview is configured in **Settings → Operon → Interface → Location Map**.

## FAQ

**Can I show only icons to save space?** Yes. Set a chip to Icon Only, and it shows its icon without the text; click it to preview the full content.

**Can the same chips differ between Filter View and inline tasks?** Yes. Each surface has its own visibility, order, and Icon Only settings.

**Do Kanban chips work on mobile?** They are visible on mobile Kanban cards, but read-only. Use the card itself for opening, scrolling, and long-press dragging.

**Why is my due date chip red or blue?** Red means overdue, blue means due today. A finished or cancelled task drops the color.

**Can a custom field be a chip?** Yes. Enable "Show in chips" for the custom key, and a wikilink value behaves like a link chip. See [[DOCS-040 Custom keys|Custom keys]].

**Do I need the Maps plugin for locations?** No. The location chip and its popover work from coordinates or a place note on their own. The Maps plugin only adds the rendered map.

**Why do I not see reminder chips?** They are hidden by default on every surface. Turn them on for the surfaces you want under **Settings → Operon → Interface → Task Chips**.

**A reminder chip says "Unresolved". What is wrong?** It is a rule whose reference date is missing, so there is nothing to count back from. Set that date and it resolves again. See [[DOCS-117 Reminder rules|Reminder rules]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-068 Location picker|Location picker]]
- [[DOCS-040 Custom keys|Custom keys]]
- [[DOCS-116 Reminders|Reminders]]
