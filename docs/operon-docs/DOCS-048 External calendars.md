---
Up:
  - "[[DOCS-028 Calendar overview|Calendar overview]]"
  - "[[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]"
  - "[[DOCS-060 Calendar layout toolbar and sidebar|Calendar layout: toolbar and sidebar]]"
Notes: Show read-only ICS calendars alongside your tasks
Icon: calendar-sync
Color: "#059669"
tags:
  - operon
  - externalcalendars
  - calendar
  - integration
Updated: 2026-06-25T16:47:21
---

# External calendars

Your tasks are not the only things that take up your time. Meetings, classes, and shared calendars do too, and planning around them is easier when they sit next to your tasks. Operon can show external calendars inside the [[DOCS-028 Calendar overview|Calendar]], so your plan reflects your real day. These calendars are read-only: Operon displays their events, it does not change them.

## Add a calendar

You add an external calendar as an **ICS** source: a calendar feed published as an `.ics` link. Operon accepts `https`, `webcal`, or direct `.ics` URLs, which most calendar services (and shared calendars) can give you. Each source has:

- A **name**, shown in settings.
- The **ICS URL** of the feed.
- A **color**, so its events are distinct from your tasks.
- A **refresh interval**, how often Operon re-fetches the feed.

Its events then render in the Calendar as timed or all-day blocks, the same shapes your tasks use.

> **MEDIA-DOCS-048-1:** Adding an external calendar source with its ICS URL, color, and refresh interval.

![MEDIA-DOCS-048-1 - External calendar source settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-048-1.png)

## Per-preset visibility

External calendars are shown per [[DOCS-029 Calendar presets and time grid|Calendar preset]]. Adding a source does not force it into every view; you enable it in the presets where you want it. So a focused work preset can stay task-only while a planning preset shows your meetings too. In [[DOCS-060 Calendar layout toolbar and sidebar|sidebar mode]], the Calendars section lets you toggle sources without opening settings.

## Keeping it tidy

A source can **hide created events**: when an external event already has a matching task scheduled on the same day, Operon can hide the duplicate so you see one item, not two. Turn it off and both stay visible.

## Refreshing

Operon re-fetches feeds on their refresh interval, and you can pull the latest at any time with **Update External Calendars** from the command palette.

## FAQ

**Can I edit external events in Operon?** No. External calendars are read-only. Operon shows their events; it does not change the source.

**Why don't my external events show up?** Check that the source is enabled in the current preset, since visibility is per preset, and that the ICS URL is valid.

**What calendars can I add?** Any that publish an ICS feed, via an `https`, `webcal`, or `.ics` URL.

## Settings

Operon settings for this live in **Settings → Operon → Views → Calendar**, in the External Calendars section, where you add sources and set each one's URL, color, refresh interval, and behavior. Per-preset visibility is set in the calendar presets.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-022 Command palette reference|Command palette reference]]
