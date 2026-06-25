---
Up:
  - "[[DOCS-041 Task chips display and behavior|Task chips]]"
  - "[[DOCS-062 Field pickers overview|Field pickers overview]]"
  - "[[DOCS-007 Install and enable Operon|Install and enable Operon]]"
Notes: Set a task's location from a place note, a map, or coordinates
Icon: map-pin
Color: "#db2777"
tags:
  - operon
  - pickers
  - location
Updated: 2026-06-25T16:47:21
---

# Location picker

The location picker sets where a task happens. It gives you three ways to do that, from quickest to most precise: pick a **place** you have saved, click a point on a **map**, or type **coordinates** by hand. The result shows on the task as a map chip.

The `location` field is property type **Text**: it stores coordinates as `latitude, longitude`. The picker produces that value however you choose the spot. See [[DOCS-041 Task chips display and behavior|Task chips]] for the chip.

> **MEDIA-DOCS-068-1:** The location picker with its Places, Map, and Manual tabs.

<iframe
  title="MEDIA-DOCS-068-1 - Location Maps Integration video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/Gq1SEPHrBmQ"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## The three tabs

The picker opens on **Places** and offers up to three tabs:

- **Places**: search the place notes in your vault and pick one. This is the fastest path once you have places saved, and it is the default tab.
- **Map**: click a point on a visual map to set the location. This tab appears only when the community **Maps** plugin is enabled. See [[DOCS-007 Install and enable Operon|Install and enable Operon]].
- **Manual**: type the coordinates directly, as `latitude, longitude`. Always available, and exact when you already know the numbers.

> **MEDIA-DOCS-068-2:** Picking a point on the Map tab, available when the Maps plugin is enabled.

![MEDIA-DOCS-068-2 - Picking a point on the Map tab, available when the Maps plugin is enabled](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-068-2.png)

## Place notes

A **place note** is a note in your vault that stands for a location. The Places tab searches them, so a location you use often becomes a name you pick rather than coordinates you remember. A place note can also carry its own look: through configured property names, it can supply the **icon** and **color** that the location marker and chip use, so each place shows up consistently. When those properties are left to match your task icon and color mappings, no extra setup is needed.

## Without the Maps plugin

The Map tab needs the community Maps plugin. Without it, you still have the **Places** and **Manual** tabs, so locations work fully, just without the visual map for picking or previewing. The Maps plugin adds the map on top; it is not required to set a location. See [[DOCS-041 Task chips display and behavior|Task chips]].

## FAQ

**What does the field store?** Coordinates as `latitude, longitude` text, regardless of which tab you used.

**Do I need the Maps plugin?** No. Places and Manual work without it. The Map tab and visual map preview need it.

**What is a place note?** A note that represents a location. The Places tab searches them, and a place note can define its own marker icon and color.

## Settings

Operon settings for this live in **Settings → Operon → Interface → Location Map**, which sets the map defaults, the place-note property names for marker icon and color, and the map preview size.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-066 Icon picker|Icon picker]]
