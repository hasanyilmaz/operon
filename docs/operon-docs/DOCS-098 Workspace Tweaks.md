---
Notes: Background dimming and optional cosmetic helpers for scrollbars, side dock tabs, and Properties
Icon: sliders-horizontal
Color: "#ca8a04"
Updated: 2026-10-22T21:43:14+02:00
---

# Workspace Tweaks

**Workspace Tweaks** are a small set of optional, purely cosmetic helpers that tidy up how the Obsidian workspace looks while you work in Operon. They change appearance only: nothing here is written into your notes, no task data is touched. Background dimming uses a level selector; other tweaks use toggles, a Properties scope selector, and folder exceptions.

These preferences help keep the workspace focused. Dimming has a starting level; the other cosmetic toggles remain optional and off by default.

## Where it lives

Open **Settings → Operon → Interface → Workspace Tweaks**. The page has **Workspace Appearance**, **Properties Panel**, and **Properties Excluded Folders**. The folder section and collapse-scope control appear when **Collapse Properties by Default** is enabled; disabling it preserves their values.

## Workspace Appearance

### Hide Scrollbars

Hides the scrollbars across the whole Obsidian workspace while keeping scrolling itself completely normal. The wheel, trackpad, and keyboard all still scroll exactly as before; only the visible scrollbar track and thumb go away. It is a tidiness preference, useful if you find scrollbars distracting and prefer a cleaner edge to every panel.

### Compact Sidebar Tab Icons

Slims the tab header strips in the left and right side docks down to a narrow band, so the side panels give more room to their content. Move the pointer over a slimmed strip and the full tab header area expands back into view, so nothing is lost, it is just out of the way until you reach for it.

This one applies on the desktop app. On mobile, where the side docks behave differently, it has no effect.

### Lightbox background dimming

Choose the starting darkness behind desktop Operon lightboxes and Task Creator, Task Finder, Task Editor, and the standalone Dynamic Subtasks Filter modal. The dropdown offers:

**10% · 20% · 30% · 35% · 40% · 45% · 50% — Default · 55% · 60% · 65% · 70% · 80% · 90%**

New users, or settings with no valid saved value, start at **50%**. Existing valid preferences are preserved. Changes apply to open surfaces without a reload. The **Moon/Sun** controls at the bottom of a lightbox's side rail step through these same dimming levels and save the preference here: Moon darkens, Sun lightens. The rail follows **Task Editor position** for newly opened desktop lightboxes, including other content types. The dimming buttons appear while the source or preview is visible, not when only the Task Editor is shown. There is no numeric indicator beside the preview; this dropdown shows the saved starting level.

Each additional included surface adds **5 percentage points**, capped at **90%**. Starting at 50%, three nested surfaces use 50%, 55%, then 60%. Starting at 80%, they use 80%, 85%, then 90%; further layers stay at 90%. Only the top included backdrop paints the calculated darkness, so overlapping backgrounds do not multiply it. Closing a layer restores the previous level, and each window keeps its own stack.

Markdown and Task Editor side by side count as **one level**, not two. Opening another task editor or preview above them adds one level; hiding or showing a panel within the current workspace adds none. The lower level stays visible but does not receive input until the upper level closes.

This includes web, Markdown, Base, Table, and media lightboxes. It does not count mobile surfaces, small media hover previews, Page Preview, pickers, the Editor's Subtasks popover, embedded filters, or other native modals. Blur is not added.

Preview width and height are adjusted separately on the lightbox itself and remembered by content type; they do not add another Settings menu or change the dimming steps. See [[DOCS-151 Lightbox|Lightbox]] for size profiles, controls, pointer/keyboard visibility, and nested-view behavior.

## Properties Panel

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

## Properties Excluded Folders

A list of folders whose notes are **excluded from automatic Properties collapsing**, even when the collapse tweak is on. Operon leaves their current panel state alone; it does not force a closed panel open. This is the override for places where you actively edit frontmatter and want the panel in view, such as a templates folder or an area you are actively curating. Add a folder with the folder search, and remove it again from the list. An excluded folder wins regardless of the scope above. These exceptions only control Properties-panel collapsing; they do not exclude tasks from the index. Task-index exclusions are configured separately under **Tasks → File Tasks → Excluded folders**.

These collapse preferences are separate from the body-only Markdown view in a [[DOCS-151 Lightbox|lightbox]]. That view hides Properties and the opening YAML block within the preview; open a normal Obsidian tab to edit them directly. The lightbox's presentation does not change these collapse preferences or the same file's normal tab.

## What these tweaks do not do

- They never edit your notes. Collapsing Properties only changes the panel's open or closed state in the view; the frontmatter itself is unchanged.
- They do not affect your tasks, fields, or filters in any way.
- They are not synced styling rules baked into files. They are live workspace adjustments controlled by saved Operon preferences, not changes to note content.

## Defaults

Background dimming starts at **50%** for a new or missing preference. The other cosmetic toggles are off: scrollbars and side dock tabs look normal, and Properties are not collapsed. The collapse scope starts at **Only Operon file tasks** and the excluded folders list starts empty, so the first time you enable the Properties tweak it acts only on your file tasks until you widen the scope.

## FAQ

**Does Hide Scrollbars stop me from scrolling?** No. Only the visible scrollbar is hidden; scrolling works exactly as before.

**I collapsed Properties by accident, can I get them back?** Yes. Expand the Properties panel by hand any time; the tweak only sets the default opening state.

**Why didn't a note collapse its Properties?** Check the scope and the excluded folders. With **Only Operon file tasks**, plain notes are not automatically collapsed. Notes inside excluded folders are also skipped; their current open or closed panel state is preserved.

**Does Compact Sidebar Tab Icons work on mobile?** No. It applies on the desktop app.

## Settings

All of these live in **Settings → Operon → Interface → Workspace Tweaks**: Lightbox background dimming, Hide Scrollbars, Compact Sidebar Tab Icons, Collapse Properties by Default, the Properties collapse scope, and the Excluded folders list. You can find any of them quickly through [[DOCS-043 Settings search|Settings search]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-013 File tasks|File tasks]]
