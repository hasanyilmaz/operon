---
Up:
  - "[[DOCS-028 Calendar overview|Calendar overview]]"
  - "[[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]"
  - "[[DOCS-060 Calendar layout toolbar and sidebar|Calendar layout: toolbar and sidebar]]"
Notes: How the Calendar works on a phone, its view modes, cycle, and per-mode presets
Icon: smartphone
Color: "#0284c7"
tags:
  - operon
  - calendar
  - mobile
  - plan
Updated: 2026-06-25T16:47:21
---

# Mobile Calendar

On a phone there is less room for a full grid, so the [[DOCS-028 Calendar overview|Calendar]] runs as a compact, phone-first surface. Instead of the desktop [[DOCS-060 Calendar layout toolbar and sidebar|toolbar and sidebar]], it gives you a small set of **view modes** you cycle through, and each mode can open with its own [[DOCS-029 Calendar presets and time grid|preset]]. The result is a Calendar that fits a narrow screen without losing the planning it does on desktop.

> **MEDIA-DOCS-096-1:** The mobile Calendar Day view.

![MEDIA-DOCS-096-1 - The mobile Calendar Day view](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-096-1.png)

## The four views

The mobile Calendar offers four view modes, from lightest to densest:

| View | What it shows | Good for |
|---|---|---|
| **Agenda** | A scrolling list of upcoming items across a window of days | Reading what is coming up without a grid |
| **Day** | A single day on a compact time grid | A focused, detailed look at one day |
| **2 Days** | Two days on the compact grid | A middle ground: more range than Day, less crowding than 3 Days |
| **3 Days** | Three days on the compact grid | A short horizon when you want to see across days |

**2 Days** is the newest of these. The denser the view, the more a phone screen has to fit, so Day stays roomy for detail while 3 Days can feel tight; 2 Days sits between them, giving extra range without the crowding. It pairs well with the [[DOCS-029 Calendar presets and time grid|Time Tracker Grid]], where Day can stay rich with planned, external, and tracked time while 2 Days carries a lighter planning preset.

## Cycling between views

You move between the views by cycling from the toolbar, rather than picking from a wide bar of buttons. Each tap advances to the next view you have kept in the cycle.

You decide which views are in that cycle. Each of Agenda, Day, 2 Days, and 3 Days can be **included or skipped**, so you can trim the cycle down to just the ones you use. At least one view always stays on, so the cycle can never be emptied.

> **MEDIA-DOCS-096-2:** The mobile Calendar view-cycle settings, with some views included and others skipped.

![MEDIA-DOCS-096-2 - The mobile Calendar view-cycle settings, with some views included and others skipped](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-096-2.png)

## A preset per view

Each mobile view opens with its **own chosen Calendar preset**, set separately for Agenda, Day, 2 Days, and 3 Days. This is what lets the views do different jobs:

- **Day** can use a detail-heavy preset, such as the [[DOCS-029 Calendar presets and time grid|Time Tracker Grid]], to compare planned, external, and tracked time on one day.
- **2 Days** or **3 Days** can use a cleaner planning preset, trading that detail for range when you need to see across days.

So the same board can be dense when you are looking closely and light when you are looking ahead, just by switching the view.

## The default view

A mobile Calendar leaf opens on your **default mobile view** until it remembers one of its own. Set it to whichever mode you reach for first, so the Calendar opens the way you usually want it.

## Settings

Operon settings for this live in **Settings → Operon → Mobile → Calendar**. There you can turn the mobile Calendar layout on, choose the **default view**, set the **view cycle** (which of Agenda, Day, 2 Days, and 3 Days appear when cycling), and choose the **preset for each view**. The same page also holds the compact-grid time grouping, the all-day row limit, whether completed items show, the agenda window, and the maximum width at which the mobile layout takes over.

## FAQ

**Where is the toolbar and sidebar?** Those are the desktop layout. On a phone the Calendar uses the view cycle instead. See [[DOCS-060 Calendar layout toolbar and sidebar|Calendar layout: toolbar and sidebar]].

**Can I hide a view I never use?** Yes. Turn it off in the view cycle, and it is skipped when you cycle. One view always remains.

**Why does Day look different from 2 Days?** Because each view can carry its own preset. Give them the same preset to make them match, or different presets to let each do its own job.

**Can I see planned and tracked time on my phone?** Yes. Point a mobile view, usually Day, at the Time Tracker Grid preset. See [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]].

**Can I move through dates with arrow keys?** Yes, if you have a hardware keyboard attached. Left and Right move one day, Up and Down move one week, exactly as on the desktop [[DOCS-028 Calendar overview|Calendar]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-095 Calendar Task Pool|Calendar Task Pool]]
