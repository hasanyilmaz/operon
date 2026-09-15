---
Notes: Find any Operon setting from Obsidian's settings search
Icon: search
Color: "#ca8a04"
Updated: 2026-09-15T11:09:13+02:00
---

# Settings search

Operon has a lot of settings, spread across tabs for Core, Tasks, Views, Interface, and Mobile. You do not have to remember where each one lives. On Obsidian 1.13 and later, Operon exposes supported settings and sections through Obsidian's built-in settings search, so you can search by name or purpose and open the matching controls.

> **MEDIA-DOCS-043-1:** Obsidian's settings search showing matching Operon settings for a typed term.

![MEDIA-DOCS-043-1 - Settings search results](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-043-1.png)

## How to use it

Open Obsidian **Settings** and type in the search box at the top. Matching Operon settings appear in the results, grouped under their tab, and selecting one takes you straight to it. It is the fastest way to change a setting when you know what you want but not which tab it is on.

## Search by meaning, not just labels

Operon's settings carry search keywords, so you can find a setting by the words you would naturally use, not only its exact label. Searching `exclude folder` finds the indexing exclusions, and `calendar day title` finds the right Calendar control, even when the setting's name is worded differently. This matters because the obvious search term and the official label are often not the same.

## File Tasks, Inline Tasks, and Task Router

Search also reaches the sections under **File Tasks**, **Inline Tasks**, and **Task Router**. Try `daily notes` or `weekly notes` to find their separate settings results, including note formats, templates, and folders. Inline daily-note defaults are searchable too.

Opening a section result takes you to its existing controls. Searching does not change a setting or its save behavior. This coverage does not mean every nested control has its own individual result; if a specific option does not appear, open the matching section or browse to it normally.

## Why it helps

- **You stop hunting through tabs.** Type the idea, land on the setting.
- **Discovery.** A search can surface a setting you did not know existed.
- **Direct access.** Registered settings and sections can be found without remembering their position in the tab layout.

If you would rather browse, the tabs are still there. Settings search is the shortcut, not a replacement: see [[DOCS-008 Essential settings to configure first|Essential settings to configure first]] for the handful worth setting up first.

## FAQ

**Where is the search box?** In Obsidian's Settings window on Obsidian 1.13 and later. It searches the settings exposed by Obsidian and participating plugins, including Operon. On older versions, browse Operon's settings pages directly.

**Do I search inside the Operon tab?** You search from Obsidian's main settings search. Operon's settings are registered there, so they show up alongside everything else.

**Why did a setting show up under a word that is not its name?** Each setting carries keywords for the terms people actually search, so it can match more than its literal label.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
