---
Notes: Configure and use Daily and Weekly Notes as safe task destinations and optional Operon containers
Icon: calendar-range
Color: "#059669"
Updated: 2026-09-04T17:41:51+0200
---

# Daily and Weekly Notes

Daily and Weekly Notes give dated work a natural home. Operon calls them **periodic notes** as a group: a Daily Note represents one date, while a Weekly Note represents one week. You can use either as the default inline destination, create missing notes from templates, and optionally make each note an Operon File Task that parents the inline tasks inside it.

## When to use each

Use **Daily Notes** for today's actions, meeting follow-ups, and work that belongs to one calendar date. Use **Weekly Notes** for reviews, plans, and work that should stay visible across a week.

Task Router decides whether new inline tasks go to Daily or Weekly Notes. The settings on this page decide how those notes are named, found, and created. See [[DOCS-136 Task Router|Task Router]].

## Daily Notes management

Turn on **Manage Daily Notes with Operon** to use Operon's Daily format, template, and folder. When it is off, Operon continues to use the Core Daily Notes plugin's configuration when that plugin is available.

The default Operon Daily format is `YYYY-MM-DD`. The format controls the note path only; task date fields are still stored as ISO dates such as `2026-08-21`.

Daily Notes therefore have two supported configuration sources:

- **Operon-managed**: Operon's format, template, and folder.
- **Core fallback**: Obsidian Daily Notes configuration when Operon management is off.

## Weekly Notes management

Turn on **Manage Weekly Notes with Operon** to make Weekly Notes available as a routed destination. Weekly Notes use their own format, template, and folder and do not depend on Core Daily Notes.

The weekly path and optional container identity are anchored to the week's ISO Monday. The actual routed date is still kept for placement inside the note, so a task for Thursday goes under Thursday's linked-date heading rather than Monday's.

## Create a periodic note from the command palette

Use **Create daily note** to open today's Daily Note or **Create weekly note** to open the current Weekly Note. If the note is missing, the command creates it through the same format, folder, template, and **Create as Operon Task** rules described below; if it already exists, Operon opens it. The command creates or opens the note directly and does not require or add an inline task.

Each command deliberately requires its matching Operon management setting. **Create daily note** requires **Manage daily notes with Operon**, even when Core Daily Notes is available, and **Create weekly note** requires **Manage weekly notes with Operon**. When the relevant setting is off, no note is created and a short notice points back to File Tasks settings.

## Formats, folders, and templates

Daily and Weekly settings are independent. Each has:

- a Moment-style filename format;
- an optional Markdown template;
- a vault-relative destination folder;
- a **Create as Operon Task** toggle.

For example, a Daily format of `YYYY/MM/YYYY-MM-DD` creates a dated folder path, while a Weekly format such as `GGGG-[W]WW` produces an ISO week name such as `2026-W34`. The preview beneath each format setting shows the path that the current pattern produces. An invalid or unsafe path is rejected.

When a missing note is created, Operon uses the configured template. Existing notes are never rerendered from the template. Periodic templates are separate from the File Task template picker described in [[DOCS-024 Task templates|Task templates]].

## Existing and missing notes

The result depends on what already exists and whether **Create as Operon Task** is enabled:

| Target state | Create as Operon Task | Result |
|---|---:|---|
| Existing valid periodic container | Either | Append the inline task and link it to that verified parent. |
| Existing plain Markdown note | Either | Append the inline task without adopting the note and without a periodic parent. |
| Missing note | On | Create the note from the template as a minimal Operon File Task, register its exact identity, append the child, and set its parent. |
| Missing note | Off | Create a normal Markdown note from the template and append a parentless inline task. |

An existing plain note is deliberately not converted into a File Task. Ambiguous, duplicate, unhealthy, stale, occupied, or otherwise unsafe targets fail closed instead of being adopted or overwritten.

## Where the inline task is placed

Daily Notes use the configured inline heading keyword. Operon inserts beneath the first heading containing that phrase and creates a level-two heading when none exists.

Weekly Notes use a linked daily-date heading for the actual routed date, for example `## [[2026-08-20]]`. ISO Monday determines the Weekly Note path and container identity only; it does not replace the task's real date or force every task under Monday.

## Parent and container behavior

With **Create as Operon Task** enabled, a newly created periodic note receives the minimal File Task fields and becomes the parent of the inline task created inside it. Operon tracks that exact container identity in Plugin-owned state so a later update never guesses from a filename alone.

With the toggle off, the periodic note is ordinary Markdown and its inline tasks remain parentless unless you set another relationship yourself.

## Changing the scheduled date

Changing `dateScheduled` may update a verified periodic parent, but it never moves the task's Markdown:

- **Same day or week anchor**: keep the periodic parent.
- **Different day or week anchor**: bind to the exact valid destination container.
- **Clear the scheduled date**: detach a verified periodic parent and leave the task where it is.
- **Manual parent**: keep it; Operon never silently replaces a manual relationship.

The task's path, inline representation, source line, and physical locator stay unchanged. Parent realignment is a relationship update, not a copy or relocation.

## Runtime and CLI routing

The Runtime and CLI expose this as one typed Daily-or-Weekly intent. The CLI sends the requested task data; the Plugin remains responsible for settings, templates, placement, Markdown writes, container identity, registry state, receipts, and recovery.

Compact creation uses:

```sh
operon task create "Daily review" --periodic-note daily dateScheduled::"2026-08-21"
operon task create "Weekly review" --periodic-note weekly datetimeStart::"2026-08-21T09:00:00"
```

There is no `--route-date` command-line flag. Creation routes by explicit typed `routeDate` when a typed Runtime intent supplies one, otherwise by `dateScheduled`, the local date of `datetimeStart`, and finally the local day captured during preview. Periodic update routing is triggered only by an explicit `dateScheduled` set or clear.

The CLI and live Runtime must advertise the matching periodic capability. An older or incompatible side fails closed before any note, task, setting, or registry write. See [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]], [[DOCS-126 Compact task syntax|Compact task syntax]], and [[DOCS-127 Everyday task commands|Everyday task commands]].

Runtime preview must be deterministic and write-free. A configured periodic template containing Templater `<% ... %>` expressions is therefore refused during Runtime preview rather than executed or written raw. Use deterministic Markdown and supported Operon/Core-style template tokens for this route.

## FAQ

**Do I need the Core Daily Notes plugin?** Not when **Manage Daily Notes with Operon** is enabled. When it is disabled, the Core plugin supplies the fallback Daily configuration.

**Do Weekly Notes use the Daily Notes plugin?** No. Operon manages Weekly formats, folders, and templates directly.

**Will Operon adopt an existing plain Daily or Weekly Note?** No. It appends without converting the note or assigning it as a periodic parent.

**Does rescheduling move the task to another note?** No. Only a verified periodic parent may detach or realign; the task remains at its exact source.

**Can the CLI write these notes itself?** No. It sends typed intent to the Plugin, which owns every physical and persistent write.

**Can I create the note without creating a task first?** Yes. Run **Create daily note** or **Create weekly note** while the corresponding Operon management setting is enabled.

## Settings

Daily and Weekly formats, templates, folders, and **Create as Operon Task** toggles live in **Settings → Operon → Tasks → File Tasks**. Choose Daily or Weekly as the normal inline destination under **Settings → Operon → Tasks → Task Router**. Daily-note field defaults remain under **Tasks → Inline Tasks**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-024 Task templates|Task templates]]
- [[DOCS-050 Daily Notes workflows|Daily Notes workflows]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-136 Task Router|Task Router]]
