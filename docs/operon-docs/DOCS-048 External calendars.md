---
Notes: Show read-only ICS calendars alongside your tasks
Icon: calendar-sync
Color: "#059669"
Updated: 2026-10-19T13:40:31+02:00
---

# External calendars

Your tasks are not the only things that take up your time. Meetings, classes, and shared calendars do too, and planning around them is easier when they sit next to your tasks. Operon can show external calendars inside the [[DOCS-028 Calendar overview|Calendar]], so your plan reflects your real day. These calendars are read-only: Operon displays their events, it does not change them.

## Add a calendar

Add an **ICS** source as either a subscribed **URL** or a **vault-local `.ics` file**. URL sources continue to accept calendar feed addresses such as `https` and `webcal`. For a local source, choose the ICS file with the vault file picker. Each source has:

- A **name**, shown in settings.
- A **source type** and its **ICS URL** or **vault file path**.
- A **color**, so its events are distinct from your tasks.
- A **refresh interval** for refreshing the source; local file changes also trigger updates.

Its events then render in the Calendar as timed or all-day blocks, the same shapes your tasks use.

> **MEDIA-DOCS-048-1:** Adding an external calendar source with its ICS URL, color, and refresh interval.

![MEDIA-DOCS-048-1 - External calendar source settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-048-1.png)

## Vault-local ICS files

A local source is read from the selected vault path. Operon updates it when the file changes, while keeping the calendar read-only: it does not rewrite the ICS, turn events into task records automatically, or synchronize edits back to another service.

If the file is renamed, moved, or deleted, Operon rechecks the configured path. Reselect a moved or renamed file in the source settings; the source does not silently follow an unrelated file or create a replacement. If the path is missing or unreadable, the source reports the problem instead of modifying the file.

## Per-preset visibility

External calendars are shown per [[DOCS-029 Calendar presets and time grid|Calendar preset]]. Adding a source does not force it into every view; you enable it in the presets where you want it. So a focused work preset can stay task-only while a planning preset shows your meetings too. Toggle a source for the current preset from **Edit preset**'s **External Calendars** section; the [[DOCS-060 Calendar layout toolbar and sidebar|sidebar]]'s **Calendars** section is a preset switcher, not a place to toggle sources.

## Keeping it tidy

A source can **hide created events**: when an external event already has a matching task scheduled on the same day, Operon can hide the duplicate so you see one item, not two. Turn it off and both stay visible.

## Refreshing

Operon refreshes enabled sources automatically. URL refreshes can use conditional HTTP caching; local sources read the current file and also react to vault changes. You can use **Update External Calendars** from the command palette.

The source's **Sync now** action requests fresh URL contents rather than reusing an unchanged-response shortcut; for a local source it rereads the file. It uses the **saved** source address, so save a new source or a changed URL/path before using it. A previously empty cached URL result can recover through a fresh request. This does not turn a read-only calendar into two-way synchronization.

## FAQ

**Can I edit external events in Operon?** No. External calendars are read-only. Operon shows their events; it does not change the source.

**Why don't my external events show up?** Check that the source is enabled in the current preset, since visibility is per preset, and that the ICS URL or selected vault file is valid and readable. A moved local file may need to be selected again.

**What calendars can I add?** ICS feeds supplied by URL, and supported `.ics` calendar files stored in your vault. Both remain read-only.

## Settings

Operon settings for this live in **Settings → Operon → Views → Calendar**, in the External Calendars section, where you choose each source's type, URL or vault file, color, refresh interval, and behavior. Per-preset visibility is set from that preset's **Edit preset**, in its own **External Calendars** section.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-022 Command palette reference|Command palette reference]]
