---
Notes: Optional cosmetic workspace helpers for scrollbars, side dock tab icons, and collapsing Properties
Icon: sliders-horizontal
Color: "#ca8a04"
Updated: 2026-07-23T16:45:34
---

# Workspace Tweaks

**Workspace Tweaks** are a small set of optional, purely cosmetic helpers that tidy up how the Obsidian workspace looks while you work in Operon. They change appearance only: nothing here is written into your notes, no task data is touched, and every option is a simple toggle you can turn on or off at will. Turn one on and the effect applies right away; turn it off and the workspace returns to normal.

They are deliberately conservative. None of them is required to use Operon, and leaving them all off changes nothing. Think of them as finishing touches for people who like a quieter, more focused workspace.

## Where it lives

Open **Settings → Operon → Interface → Workspace Tweaks**. The tab has two groups: **Workspace helpers** and **Properties**.

## Workspace helpers

### Hide Scrollbars

Hides the scrollbars across the whole Obsidian workspace while keeping scrolling itself completely normal. The wheel, trackpad, and keyboard all still scroll exactly as before; only the visible scrollbar track and thumb go away. It is a tidiness preference, useful if you find scrollbars distracting and prefer a cleaner edge to every panel.

### Compact Sidebar Tab Icons

Slims the tab header strips in the left and right side docks down to a narrow band, so the side panels give more room to their content. Move the pointer over a slimmed strip and the full tab header area expands back into view, so nothing is lost, it is just out of the way until you reach for it.

This one applies on the desktop app. On mobile, where the side docks behave differently, it has no effect.

## Properties

This group helps with Obsidian's native **Properties** panel, the frontmatter editor that sits at the top of a note. File tasks keep their fields in frontmatter, so that panel can take up a lot of room at the top of every task note. These options let Operon tuck it away for you.

### Collapse Properties by Default

When a matching note opens, Operon collapses its Properties panel for you, the same as if you had clicked the panel's collapse arrow yourself. It is only the default starting state: you can expand Properties again by hand whenever you want to see or edit the frontmatter, and Operon will not fight you to re-collapse it.

The two settings below decide which notes count as "matching."

### Properties collapse scope

Chooses how widely the collapse applies:

| Scope | Properties collapse for |
|---|---|
| Only Operon file tasks (default) | notes that are indexed Operon [[DOCS-013 File tasks\|file tasks]] |
| All notes | every Markdown note you open |

Pick **Only Operon file tasks** to keep the tidy-up focused on your task notes and leave ordinary notes untouched. Pick **All notes** if you would rather every note open with Properties collapsed.

### Excluded folders

A list of folders whose notes **always keep Properties open**, even when the collapse tweak is on. This is the override for places where you actively edit frontmatter and want the panel in view, such as a templates folder or an area you are actively curating. Add a folder with the folder search, and remove it again from the list. An excluded folder wins regardless of the scope above.

## What these tweaks do not do

- They never edit your notes. Collapsing Properties only changes the panel's open or closed state in the view; the frontmatter itself is unchanged.
- They do not affect your tasks, fields, or filters in any way.
- They are not synced styling rules baked into files. They are live workspace adjustments, applied while the plugin is running and gone the moment you turn them off.

## Defaults

Out of the box, all of these are off: scrollbars and side dock tabs look normal, and Properties are not collapsed. The collapse scope starts at **Only Operon file tasks** and the excluded folders list starts empty, so the first time you enable the Properties tweak it acts only on your file tasks until you widen the scope.

## FAQ

**Does Hide Scrollbars stop me from scrolling?** No. Only the visible scrollbar is hidden; scrolling works exactly as before.

**I collapsed Properties by accident, can I get them back?** Yes. Expand the Properties panel by hand any time; the tweak only sets the default opening state.

**Why didn't a note collapse its Properties?** Check the scope and the excluded folders. With **Only Operon file tasks**, plain notes are left open; and any note inside an excluded folder always stays open.

**Does Compact Sidebar Tab Icons work on mobile?** No. It applies on the desktop app.

## Settings

All of these live in **Settings → Operon → Interface → Workspace Tweaks**: Hide Scrollbars, Compact Sidebar Tab Icons, Collapse Properties by Default, the Properties collapse scope, and the Excluded folders list. You can find any of them quickly through [[DOCS-043 Settings search|Settings search]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-013 File tasks|File tasks]]
