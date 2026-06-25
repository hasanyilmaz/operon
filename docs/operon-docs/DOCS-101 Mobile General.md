---
Up:
  - "[[DOCS-096 Mobile Calendar|Mobile Calendar]]"
  - "[[DOCS-100 Mobile Kanban|Mobile Kanban]]"
  - "[[DOCS-021 Task Editor|Task Editor]]"
Notes: General phone-first behavior, the quick-create button, the mobile Task Editor toolbar, and touch menus
Icon: smartphone
Color: "#ca8a04"
tags:
  - operon
  - mobile
  - interface
  - configure
Updated: 2026-06-25T16:47:21
---

# Mobile General

Operon runs the same way on a phone as on the desktop, with a few **phone-first adjustments** layered on top for touch. This page is the home for the general ones: the floating quick-create button, the mobile Task Editor toolbar, and how touch menus behave. The two surfaces with the most mobile-specific behavior, the [[DOCS-096 Mobile Calendar|Calendar]] and the [[DOCS-100 Mobile Kanban|Kanban]] board, have their own pages.

These settings tune the touch interface **without changing your desktop layouts**. Turning them on or off affects phones only.

> **MEDIA-DOCS-101-1:** A phone showing the floating quick-create button at the bottom-right corner.

![MEDIA-DOCS-101-1 - Mobile floating quick-create button](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-101-1.png)

## The quick-create button

On a phone, Operon shows a **floating plus button** that opens the [[DOCS-020 Task Creator|Task Creator]] from anywhere across the mobile surfaces, so capturing a task is always one tap away. It is on by default. Three controls shape it:

- **Show mobile quick-create button** turns it on or off everywhere.
- **Hide in Calendar** and **Hide in Kanban** each suppress the button while that view is active, so you can keep it for general use but clear it off the surfaces where it would be in the way. Both are off by default, meaning the button shows everywhere.
- **Reset position.** You can drag the button to a spot that suits your grip; this puts it back at the default bottom-right corner.

## The mobile Task Editor toolbar

The [[DOCS-021 Task Editor|Task Editor]] on a phone shows a compact **core toolbar** of field and action buttons, the touch equivalent of the desktop editor's tools. Because a phone has little room, you decide which tools earn a place: each core tool can be **shown or hidden**, and you set the **order** they appear in, so the fields and actions you reach for most sit where your thumb lands first.

This is purely about the mobile toolbar's makeup. It does not change what the fields do or how the editor works, only which buttons are present and in what order on a phone.

> **MEDIA-DOCS-101-2:** The mobile Task Editor toolbar settings, with core tools reordered.

![MEDIA-DOCS-101-2 - Mobile Task Editor toolbar settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-101-2.png)

## Touch menus

Operon's [[DOCS-042 Contextual menu actions|contextual menu]] opens differently on touch, and on a phone it **closes itself after a short while** so it does not linger over your content. The **mobile context menu auto-hide** setting controls how long it stays after opening before closing on its own, from 1 to 30 seconds, defaulting to 7. Raise it if menus close before you reach them, or lower it if you would rather they clear away quickly.

## Mobile-specific surfaces

Two views change enough on a phone to have their own pages:

- [[DOCS-096 Mobile Calendar|Mobile Calendar]]: a compact, phone-first Calendar with view modes you cycle through and a preset per mode.
- [[DOCS-100 Mobile Kanban|Mobile Kanban]]: a touch-first board with status snapping and a compact swimlane rail.

Several dialogs also adapt to a phone without needing a page of their own. The [[DOCS-020 Task Creator|Task Creator]], [[DOCS-027 Task Finder|Task Finder]], and [[DOCS-021 Task Editor|Task Editor]] each open as a **full, touch-sized dialog** instead of the centered desktop window, and each **tracks the on-screen keyboard**: as the keyboard or a field picker opens and closes, the dialog resizes to the space that is left so the part you are working on stays in view rather than being pushed off-screen.

- The **Task Finder** sizes its results list to the visible area, so the list stays scrollable above the keyboard while you type a search.
- The **Task Editor** additionally carries the configurable mobile toolbar described above, so its phone layout is the touch dialog plus whichever core tools you chose to show.

The quick-create button settings above are what let you hide the floating button on the Calendar and Kanban surfaces.

## Settings

These live under **Settings → Operon → Mobile**. The **General** subtab holds the quick-create button (show, hide in Calendar, hide in Kanban, reset position) and the mobile context menu auto-hide. The **Task Editor** subtab holds the mobile Task Editor toolbar (which tools show and their order). The **Calendar** and **Kanban** subtabs are covered on [[DOCS-096 Mobile Calendar|Mobile Calendar]] and [[DOCS-100 Mobile Kanban|Mobile Kanban]].

## FAQ

**The plus button is gone on one screen.** It is likely hidden for that surface. Check Hide in Calendar and Hide in Kanban, or that the button is enabled at all.

**I moved the button and want it back.** Use Reset position to return it to the bottom-right corner.

**My touch menu closes too fast.** Raise the mobile context menu auto-hide time. The reverse lowers it.

**Do these settings change my desktop?** No. They tune the phone and touch interface only.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-096 Mobile Calendar|Mobile Calendar]]
