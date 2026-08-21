---
Notes: Capture inline tasks into Daily Notes and inherit dates from their note
Icon: calendar-check
Color: "#059669"
Updated: 2026-08-21T16:12:57
---

# Daily Notes workflows

If you work out of a Daily Note, that is often where a task first occurs to you. Operon can route new inline tasks into that note and use its date as a default for task fields. Daily Notes may be managed directly by Operon or resolved through Obsidian's Core Daily Notes configuration.

This page focuses on the daily capture habit and date defaults. For Daily and Weekly formats, templates, folders, container behavior, and Runtime/CLI routing, see [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]].

## Capture into today's note

Choose **Daily Notes** as the inline destination under **Settings → Operon → Tasks → Task Router**. A normal new inline task then routes to today's Daily Note instead of a fixed file. If Operon manages Daily Notes, it uses Operon's configured format and folder. Otherwise it falls back to the Core Daily Notes configuration when that plugin is available.

The Daily destination is one of five Task Router choices, alongside Weekly Notes, a specific file, the active file, and Ask Every Time. See [[DOCS-136 Task Router|Task Router]].

## Dates from the note's date

A Daily Note already represents a date, and Operon can use it. For inline tasks created there, Daily Note Defaults can fill fields that the task does not already have:

- **Start date** from the Daily Note's date.
- **Scheduled date** from the Daily Note's date.

Each toggle is independent. Existing values win, so the defaults never replace a date you selected deliberately.

## Which filename formats work

With **Manage Daily Notes with Operon** enabled, Operon's Moment-style Daily format controls the note path and shows a live path preview in settings. The default is `YYYY-MM-DD`; folder-producing formats such as `YYYY/MM/YYYY-MM-DD` are supported when they resolve to a safe vault-relative path.

With Operon management disabled, the Core Daily Notes **Date format** supplies the filename format. If that format is unavailable, Operon uses `YYYY-MM-DD` as the fallback.

Task date fields stay in `YYYY-MM-DD` form regardless of the note filename. A filename format changes where the note lives, not how `dateScheduled` or `dateStarted` is stored. See [[DOCS-012 Inline task syntax|Inline task syntax]].

## Templates and missing notes

An Operon-managed missing Daily Note can start from its configured Daily template. Compatible `{{title}}`, `{{date}}`, and `{{time}}` variables are resolved when the note is created; an existing note is left as it is and its template is not run again.

The optional **Create Daily Notes as Operon Tasks** setting makes a newly created Daily Note a minimal File Task container and parents the inline task placed inside it. An existing plain Markdown Daily Note is never adopted automatically: Operon appends the task without assigning the note as its periodic parent. See [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]] for the complete matrix.

## A simple daily flow

- Choose Daily Notes in Task Router.
- Decide whether Operon or Core Daily Notes owns the path configuration.
- Capture tasks as they come up.
- Let the Daily Note Defaults fill start or scheduled dates when useful.
- Review the tasks in a [[DOCS-025 Filter View|Filter View]] or the [[DOCS-028 Calendar overview|Calendar]].

## FAQ

**Do I need the Core Daily Notes plugin?** No when Operon manages Daily Notes. When Operon management is off, Core Daily Notes provides the fallback configuration.

**Does every new task go to the Daily Note?** Only inline tasks whose normal Task Router destination is Daily Notes, or tasks explicitly routed there.

**Will Operon set the date for me?** The optional Daily Note Defaults fill a missing start or scheduled date from the note's date.

**Will an existing Daily Note become a File Task?** No. Plain Markdown is appended to without automatic adoption.

**Where are Weekly Notes explained?** In [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]].

## Settings

- Select Daily Notes under **Settings → Operon → Tasks → Task Router**.
- Configure Operon-managed Daily format, template, folder, and container behavior under **Tasks → File Tasks → Daily Notes**.
- Configure start and scheduled date defaults under **Tasks → Inline Tasks → Daily Note Defaults**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-028 Calendar overview|Calendar overview]]
- [[DOCS-061 operonId template variables|Template variables]]
- [[DOCS-136 Task Router|Task Router]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
