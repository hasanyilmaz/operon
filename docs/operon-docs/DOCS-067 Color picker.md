---
Up:
  - "[[DOCS-062 Field pickers overview|Field pickers overview]]"
  - "[[DOCS-041 Task chips display and behavior|Task chips]]"
  - "[[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]"
Notes: Give a task a color from a named palette or a full custom picker
Icon: palette
Color: "#db2777"
tags:
  - operon
  - pickers
  - color
Updated: 2026-06-25T16:47:21
---

# Color picker

The color picker gives a task a color, two ways: a quick pick from a named palette, or a full custom color when you want an exact shade. A task's color makes it stand out on its chips and across views, so a glance tells you what it is.

The `taskColor` field is property type **Text**: it stores a hex color, written without the leading `#`, like `4987a7`. The picker handles that format for you. See [[DOCS-012 Inline task syntax|Inline task syntax]].

> **MEDIA-DOCS-067-1:** The color picker showing the 28 named palette swatches above the full custom color area.

<iframe
  title="MEDIA-DOCS-067-1 - Color Picker video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/rfjE2iPARiM"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## Pick from the palette

The fastest path is the **palette**: a fixed grid of **28 named color slots** that you curate once and reuse everywhere. Each slot has both a **name** and a **hex**, and both are yours to change. Rename `Teal` to `Client A`, swap a slot's hex for your brand color, and your names and colors appear in the picker from then on. You can even find a color by typing its name, so a well-named palette doubles as a search. Because the palette is shared, the same swatches are one click away wherever a color is set, which keeps your whole system visually consistent. The 28 slots can be reset to Operon's defaults at any time.

## Or choose any color

When the palette is not enough, the picker opens a **full custom color**: a hue and shade area that lets you dial in any color, with its hex value. Use it for a one-off color or to add a new shade. Whatever you choose is stored as the same hex text, so a palette color and a custom color are the same kind of value underneath.

> **MEDIA-DOCS-067-2:** The custom color area, choosing a hue and shade with the hex value shown.

![MEDIA-DOCS-067-2 - The custom color area, choosing a hue and shade with the hex value shown](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-067-2.png)

## Removing a color

A **Clear** action removes the color, returning the task to its default appearance. A task with no color of its own can also borrow one from its parent for display. See [[DOCS-058 Operon inheritance rules|Operon inheritance rules]].

## Where the color shows

A task's color appears on its [[DOCS-041 Task chips display and behavior|chips]] and markers, and the [[DOCS-029 Calendar presets and time grid|Calendar]] can color blocks by task color. Pair color with an [[DOCS-066 Icon picker|icon]] to make a task or a category unmistakable.

## FAQ

**Palette or custom color, which should I use?** The palette for consistency and speed, the custom color when you need an exact or one-off shade. Both store the same hex value.

**What does the field store?** A hex color without the `#`, like `4987a7`.

**How do I remove a color?** Use Clear. The task returns to its default look, or borrows a color from its parent if it has one.

**Can I rename the palette colors?** Yes. Each of the 28 slots has an editable name and hex, and your changes show in the picker. Naming them for your system (for example `Client A`) also lets you find them by typing.

## Settings

The 28-slot named palette is configured in **Settings → Operon → Interface → Color Palette**, where you edit each slot's **name** and **hex**, and can reset all 28 to the Operon defaults. Your changes appear in every color picker.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
