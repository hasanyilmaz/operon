# Operon

Operon is a **task management plugin for humans and agents in Obsidian**. It keeps tasks in **Markdown** while giving them structured metadata, durable identity, reusable views, planning surfaces, recurrence, and time tracking.

## What problem does Operon solve?

Obsidian keeps work close to notes, but tasks can spread across daily notes, project notes, checklists, files, calendars, and boards as a vault grows. Operon brings those fragments into **one task system** without pulling them out of Markdown.

A key part of that is unifying Obsidian's two natural task shapes: **lightweight inline tasks** inside notes and **larger file-based tasks** that deserve their own note. Operon indexes and manages both under the same workflows, filters, Calendar, Kanban, and Task Editor.

It helps you capture tasks where they naturally belong, then later find, edit, filter, schedule, pin, track, or move them through a workflow from one set of tools.

## Who is Operon for?

Operon is for Obsidian users who want task management to live inside their vault instead of a separate app. It is especially useful if your work already spans daily notes, project notes, meeting notes, long-running areas, recurring responsibilities, or agent-assisted workflows.

It is designed for people who need **more than plain checkboxes**, but still want their tasks to remain readable, editable, linkable Markdown.

![Real Operon Calendar workflow showing day planning, multi-week context, task pools, and scheduled work](assets/readme/IMG02-real-operon-calendar-workflow.png)

## Core features

### Durable task identity and index

Every Operon task gets an `operonId` and is indexed from its source location in the vault. That lets **the same task stay recognizable** as it appears in notes, filters, Calendar, Kanban, the Pinned Task Dock, recurrence, and time tracking.

The result is one task record that can move through many views without becoming duplicated work.

### Unified inline and file tasks

Operon brings lightweight inline checkbox tasks and larger file-based tasks into the same system. Inline tasks can behave like micro-files with identity, metadata, history, and context; larger work can become a file task with its own note.

Both task shapes stay part of the same index, Task Editor, filters, schedules, Kanban boards, and Calendar views.

At any point, an inline task can be converted into a file task, or a file task can be converted back into an inline task. Operon preserves **canonical task information** during these format changes, so the task can change shape without losing its core identity or structured fields.

![Inline task and file task appearing together in the same filtered Operon view](assets/readme/IMG04-file-task-overlay-with-inline-child-tasks.png)

The point is not choosing one task format forever; it is letting the task grow into the shape it needs.

### Task creation methodology

Turn notes into executable work from the place where the work appears: the command palette, the current cursor line, the Task Creator, inline task chips, an inline task command, a file task, a selected note fragment, an existing note, a Calendar event, or a Kanban/Calendar context.

Across these entry points, Operon supports **more than twenty inline and file task creation or conversion variations**.

Quick capture stays fast, while richer creation flows can add metadata, parent tasks, subtasks, templates, dates, recurrence, or a dedicated file when the work needs more structure.

#### Create New Operon Task

- Open the main Task Creator from the Command Palette with `Create New Operon Task`.
- Open it from the Operon ribbon icon.
- Choose whether the new task should become an inline task or a file task.
- Use it when the task needs structured fields before it is written.
- Add fields such as description, notes, icon, color, priority, status, parent task, schedule, deadline, recurrence, pinned state, assignees, or contexts.
- Write inline tasks into the configured default target, a daily note target, below an inline parent, or inside a file-task parent context.
- Create file tasks in the configured file-task location, or follow parent/source folder behavior when that is enabled.
- Attach existing subtasks, dependency links, and pinned state during creation.
- Reopen the creator with the same draft if inline or file creation cannot be completed.

![Task Creator showing inline/file mode, metadata fields, recurrence, parent task, and pinned state](assets/readme/IMG05-task-creator-inline-file-metadata.png)

#### Create or edit inline task

- Run `Create or edit inline task` from the Command Palette.
- Run the command on an empty line to create a new inline Operon task.
- Run it on plain text or a list item to convert that line into an inline task.
- Run it on a **normal Markdown checkbox** to upgrade an existing checklist item into an Operon inline task without rewriting the line.
- Run it on an existing Operon inline task to open the Task Editor.
- Select a text fragment and run the command to create an inline task from the selection.
- Inherit useful parent fields when creating inside a file task or another parent context.
- Place the new inline task at the current cursor position when the editor context allows it.
- Fall back to the configured inline task target or daily-note target when the current note cannot receive the task.
- Use this path when the task belongs inside the note you are already writing.

```md
Empty line:
- [ ] Review release checklist {{operonId:: ...}}

Plain text line:
Review release checklist
↓
- [ ] Review release checklist {{operonId:: ...}}

Normal Markdown checkbox:
- [ ] Review release checklist
↓
- [ ] Review release checklist {{operonId:: ...}}

Selected text:
release checklist
↓
- [ ] release checklist {{operonId:: ...}}
```

#### Create file task

- Run `Create file task` from the Command Palette.
- Create a new task as its own Markdown file.
- Choose a file task template when the work needs a prepared structure.
- Use the configured file task folder or target rules.
- If the cursor is on a convertible inline task, promote that inline task into a file task.
- If a single non-task line or fragment is selected, seed the file task from that text and replace the source with **a wikilink to the new file**.
- If the source is inside a parent file task, apply linked auto-parent behavior when enabled.
- Use this path for projects, research, content pieces, deliverables, or any task that needs its own body.

```md
Before:
Draft migration guide

Created file task:
Draft migration guide.md

Source note after conversion:
[[Draft migration guide]]
```

#### Edit or convert to file task

- Run `Edit or convert to file task` from the Command Palette.
- Open the current file task for editing when the active note is already an Operon file task.
- Open the Task Editor when the current note already has Operon task frontmatter.
- Convert a normal Markdown note into an Operon file task when the note becomes actionable.
- Preserve existing managed frontmatter, tags, and the note body while applying the selected file task template.
- Promote work into a file task when it needs sections, references, decisions, or inline subtasks.

#### Convert file task to inline task

- Run `Convert file task to inline task` from the Command Palette.
- Convert an Operon file task into a single inline task representation.
- Preserve **canonical task information** such as description, checkbox state, tags, and canonical fields.
- Insert the inline task at the current empty cursor line when that target is available.
- Otherwise, insert it into the configured inline task target file or daily-note target.
- Move the source file to Obsidian trash after conversion.
- Use this path when a task no longer needs its own note.

```md
File task:
---
operonId: task-123
status: Project.InProgress
priority: A
dateDue: 2026-05-31
datetimeCreated: 2026-05-18T10:15:00
datetimeModified: 2026-05-19T14:30:00
---

# Draft migration guide

After conversion:
- [ ] Draft migration guide {{operonId:: task-123}} {{status:: Project.InProgress}} {{priority:: A}} {{dateDue:: 2026-05-31}} {{datetimeCreated:: 2026-05-18T10:15:00}} {{datetimeModified:: 2026-05-19T14:30:00}}
```

#### Convert Tasks emoji line to inline task

- Run `Convert Tasks emoji line to inline task` from the Command Palette.
- Convert a compatible Obsidian Tasks-style emoji line into an Operon inline task.
- Map supported Tasks dates such as due, scheduled, start, completed, cancelled, and created dates into Operon fields.
- Convert leading time ranges into timed scheduling fields when possible.
- Preserve unsupported Tasks syntax as a note instead of silently dropping it.
- Use this when adopting Operon inside a vault that already contains Tasks-style task lines.
- Keep the conversion focused on task metadata that Operon can understand and manage.

```md
Before:
- [ ] 09:00-10:30 Review release plan #release ⏳ 2026-05-20 📅 2026-05-22 🛫 2026-05-19 ➕ 2026-05-18

After:
- [ ] Review release plan #release {{operonId:: ...}} {{dateScheduled:: 2026-05-20}} {{datetimeStart:: 2026-05-20T09:00:00}} {{datetimeEnd:: 2026-05-20T10:30:00}} {{estimate:: 5400}} {{dateDue:: 2026-05-22}} {{dateStarted:: 2026-05-19}} {{datetimeCreated:: 2026-05-18T00:00:01}}
```

#### Convert Selection to Operon Tasks

- Run `Convert Selection to Operon Tasks` from the Command Palette after selecting Markdown list items.
- Convert selected checkbox lines, Tasks emoji lines, bullet items, and numbered items into Operon inline tasks.
- Preserve indentation and infer parent-child links from selected list hierarchy only.
- Apply normal inline task inheritance to top-level converted items, including file-task auto-parent behavior when enabled.
- Use Tasks priority emojis when present; when they are absent, keep Operon's default priority instead of inheriting a parent priority.
- Skip paragraphs, empty markers, code blocks, and unsupported task lines instead of converting them.
- Use this when migrating a checklist or outline into Operon without converting surrounding prose.

```md
Before:
- [ ] Prepare launch
  - [ ] Review notes 📅 2026-05-22
  - Draft announcement

After:
- [ ] Prepare launch {{operonId:: ...}}
  - [ ] Review notes {{operonId:: ...}} {{parentTask:: ...}} {{dateDue:: 2026-05-22}}
  - [ ] Draft announcement {{operonId:: ...}} {{parentTask:: ...}}
```

#### Move inline task here

- Run `Move an inline task here` from the Command Palette.
- Choose an existing inline task and move it to the current editor position.
- Use this when the task's surrounding context changes.
- Keep the task identity while relocating the task line inside the vault.

#### Create from Calendar or Kanban

- Pick an existing task and place it into the selected Calendar slot or Kanban cell.
- Create inline or file tasks from Calendar slot actions.
- Create inline or file tasks from Kanban cell actions.
- Seed the new task with the target date, time range, status, lane, pipeline, or context implied by the surface.
- Create tracked time sessions directly from timed Calendar selections.
- Use Calendar daily-note parent seeding when daily notes are configured as Operon tasks.
- Show the Task Editor when a newly placed or created task does not match the active Calendar or Kanban filter.
- Use this when planning creates the task, not just schedules an existing one.

![Calendar slot or Kanban cell action menu offering pick task, create inline task, and create file task](assets/readme/IMG10-kanban-cell-create-task-action.png)

#### Create from external Calendar events

- Create an Operon task from a read-only external Calendar event.
- Choose whether the new task should be an inline task or a file task.
- Seed the new task with the event title and selected event time.
- Keep the external event as read-only Calendar context while creating a local task record you can manage.
- Use this when an outside commitment needs to become actionable inside the vault.

![Read-only external Calendar sources shown beside local Operon tasks in Calendar](assets/readme/IMG11-external-calendars-in-calendar-view.png)

#### Create from TrackTime and FlowTime

- Create a quick inline task from the TrackTime and FlowTime surface when a timed or focused session reveals a new piece of work.
- Keep the capture lightweight so the task can be named, saved, and returned to without breaking the timing or focus flow.

![TrackTime and FlowTime panel showing an active timed or focused task session](assets/readme/IMG12-tracktime-flowtime-active-session.png)

![Task creation options from the command palette and Task Creator](assets/readme/IMG13-command-palette-operon-commands.png)

**Creation is part of the workflow**, not a separate intake ritual.

### Subtasks, parent tasks, and relationships

Break larger work into subtasks, connect related tasks, define dependencies, and keep parent-child structure visible without leaving Markdown.

When a subtask is created from a parent, Operon can seed it with inherited canonical context: `parentTask`, `status`, `priority`, `taskIcon`, and `taskColor`. These values are starting context, not a lock; they can be changed after the subtask is created.

The `parentTask` field links the child back to the parent. Priority, icon, and color can follow the parent, while status starts from the relevant workflow's initial status.

Parent tasks can reflect descendant progress, estimates, and tracked duration, so larger work stays readable as it changes.

![Parent task with subtasks visible in the Task Editor or task detail surface](assets/readme/IMG14-parent-task-subtasks-embedded-view.png)

Hierarchy gives big work a shape without forcing it out of the note system.

### Task Editor

Create and edit tasks with structured controls for canonical fields such as status, priority, dates, tags, contexts, assignees, parent task, dependencies, recurrence, pinning, and time tracking.

The right side of the editor gives form-like control over task data. The file body panel keeps the Markdown source close, so file tasks and inline tasks can still be edited in the context of the note where they live.

File tasks open with the file body visible by default. Inline tasks can also reveal their source file body when needed, making it possible to inspect the surrounding note, edit Markdown, and use familiar Obsidian editing behavior from inside the Task Editor.

Body changes are **automatically saved when the Task Editor closes**. You can also save explicitly with the save button, and longer editing sessions are protected by a configurable autosave debounce of up to 60 seconds.

![Task Editor split view with Markdown file body on the left and canonical task fields on the right](assets/readme/IMG15-task-editor-split-view-file-body-fields.png)

The editor is a structured doorway into Markdown, not a replacement for it.

### Task Finder

Find what you remember, not where you filed it. Task Finder searches across inline tasks and file tasks from one focused command surface.

Use remembered words, task format toggles, and quick modes for overdue, today, or recently modified work. When you know the project but not the file, Project Tasks and Project Tree scopes narrow the search before the search begins.

Task Finder uses a purpose-built ranking model instead of plain text filtering. It can match task names, ids, parent and descendant task names, notes, status, priority, tags, contexts, assignees, dates, and related task links, then rank results so exact and prefix matches stay close to the top.

Task Finder can include or exclude inline tasks, file tasks, finished tasks, and cancelled tasks. It can also remember the last selected scope, use dot-shortcuts for scope switching, and show customizable compact chips in result rows.

![Task Finder showing remembered-word search, task modes, inline/file toggles, and project scope controls](assets/readme/IMG16-task-finder-search-results-scope-controls.png)

Selecting a task from Task Finder opens that task in the Task Editor.

It is a fast recovery surface for the moment when you remember the work, but not the note that contains it.

### Filters

Turn task rules into **reusable work scopes**. A filter can combine fields, operators, values, match logic, groups, sorting, grouping, and subgrouping into one saved view.

Filters can work with task text, checkbox state, tags, pinned state, project trees, folder trees, dates, numbers, lists, and canonical task fields. That makes them useful for both small personal slices and large operational views.

Saved filters can be reused in the Filter View, embedded inside notes with an `operon` code block, opened in side panels, or attached to Calendar and Kanban presets. You can also search inside an already filtered scope to narrow a large task set further.

![Filter builder showing conditions, logic groups, sort/group controls, and reusable Filter View results](assets/readme/IMG17-filter-builder-conditions-groups-sort.png)

A filter is not just a one-time query; it is a named slice of the vault that can travel across Operon surfaces.

### Custom pipelines, statuses, priorities, and colors

Model different workflows with your own pipelines, statuses, priorities, icons, color rules, and display preferences.

A task field means the same thing in YAML, filters, Calendar, Kanban, and the Task Editor because the system maps it once and reuses it everywhere. Separate pipelines let different work types follow different status paths while still sharing one task model.

![Pipeline or status configuration next to a status-based task view](assets/readme/IMG18-pipelines-status-configuration.png)

Customization works best when the same rules travel across every surface.

### Key mappings

Key mappings keep Operon's internal task model aligned with the property names you see in YAML and the UI. Each task field has a stable canonical key, while the visible property name can be adjusted for your vault.

This matters because the same field may appear in file-task frontmatter, inline task metadata, filters, the Task Editor, Calendar, Kanban, compact chips, and task cards. A mapped field keeps its meaning across those surfaces instead of becoming a collection of similar-looking but disconnected properties.

Key mappings can also define field types, custom keys, icons, and whether a property is hidden from the rendered file-task metadata view while still remaining in YAML.

#### Inline task syntax

Operon inline tasks stay readable as normal Markdown checkboxes. Structured fields are stored after the task text in `{{key:: value}}` containers, while Obsidian tags remain regular `#tags` outside those containers.

```md
- [ ] Draft release notes #release {{operonId:: abc1234}} {{status:: Project.InProgress}} {{priority:: A}} {{dateDue:: 2026-05-31}}
```

The syntax lets a compact line carry identity, workflow, dates, priority, and other task metadata without turning the note into a separate database file.

![Key mappings settings showing canonical keys, visible YAML property names, field types, icons, and hidden metadata toggles](assets/readme/IMG19-key-mappings-settings-canonical-fields.png)

A task field means the same thing everywhere because it is mapped once.

### Calendar planning

Plan scheduled, due, recurring, and time-blocked work with Calendar presets. A preset can use **Time Grid** for day-style timed planning or **Multi-Week** for broader planning across several weeks, and multiple calendar leaves can stay open side by side when you want different views at the same time.

Tasks can appear as all-day items, due items, timed blocks, finished work, or projected recurring occurrences depending on the view. Read-only external ICS calendars can sit beside Operon tasks in Calendar for context.

The **Task Pool** turns the Calendar sidebar into a planning inbox. It can show **Overdue**, **Unscheduled**, or **All/Open** tasks, and tasks can be dragged from the pool onto Calendar to schedule them as all-day or timed work.

When screen space is tight, Calendar navigation can switch between **Sidebar** and **Toolbar** modes. That keeps the planning controls reachable without forcing the same layout on every workspace.

![Calendar Time Grid view with Task Pool drag-and-drop scheduling and sidebar/toolbar navigation](assets/readme/IMG20-calendar-time-grid-task-pool.png)

![Calendar Multi-Week view showing broader planning across multiple weeks with a focused day view](assets/readme/IMG21-calendar-multi-week-day-planning.png)

Calendar gives intention a place in time without stripping away task metadata.

### Kanban boards

Turn task metadata into a visual workflow board. Columns come from pipeline statuses, while swimlanes can organize cards by priority, tags, contexts, assignees, due date, or scheduled date.

Cards are still **the same Operon task records**. Dragging a card across columns or swimlanes updates the underlying task metadata, so Kanban, Filters, Calendar, and the Task Editor stay aligned.

Saved board presets let different workflows keep their own pipeline, filter, swimlane, color source, appearance, collapsed sections, and sort rules.

Kanban search uses the same task-search engine behind Task Finder. As you type or switch search scopes, the board narrows in place so matching cards stay visible on the same surface.

![Kanban board showing custom status columns, swimlanes, and metadata-aware cards](assets/readme/IMG22-kanban-board-status-columns-swimlanes.png)

![Kanban search narrowing cards in place with Task Finder style scope controls](assets/readme/IMG23-kanban-search-narrowing-cards.png)

Kanban gives workflow shape to the same local task records without turning them into a separate board database.

### Pinned Task Dock

Pin next actions from task rows and keep a focused working set visible. Use the pinned dock when you want active tasks nearby without keeping another full view open.

The vault can hold everything; the dock holds only what matters right now.

![Pinned Task Dock showing a small focused set of active tasks](assets/readme/IMG24-pinned-task-dock-focused-set.png)

Pinned tasks make focus portable across the vault.

### Contextual menus and task actions

Operon keeps common task actions close to the task surface you are already using. A contextual menu can appear on pinned tasks, filter rows, Kanban cards, Calendar items, task pool entries, FlowTime tasks, and time history rows.

The visible actions change by context. A task can offer actions such as **open editor**, **jump to source**, **mark done**, **start timer**, **pin or unpin**, **change status**, **cancel task**, **unschedule**, or **skip this occurrence** only when that action makes sense for the current surface.

Contextual menu settings let you choose which globally enabled actions can appear on each supported surface.

![Contextual menu on a pinned task showing task actions such as mark done, start timer, open editor, jump to source, status, and cancel](assets/readme/IMG25-contextual-menu-task-actions.png)

Contextual menus reduce navigation by bringing the next useful action to the place where the task is already visible.

### Recurrence

Create repeating tasks without turning them into a separate calendar system. Operon recurrence rules can be schedule-based, completion-based, or count-based, with daily, weekly, monthly, and yearly patterns.

Recurring tasks can create fresh occurrences with new task identity while carrying the useful task context forward. Per-occurrence fields such as completion state, tracked time, progress, and dependencies are reset so each occurrence remains a real task of its own.

#### File task recurrence

For recurring **file tasks**, each new occurrence is created as a new Markdown file. If the file title does not contain a date or week token, the completed file is renamed with its occurrence date first, which frees the original title for the next task and avoids filename conflicts.

```md
Completed file: Weekly Review.md
Renamed to:      2026-05-19 - Weekly Review.md
Next file:       Weekly Review.md
```

The body of a recurring file task is also prepared for the next run. Plain Markdown checkboxes are reset to unchecked, and owned Operon inline subtasks are recreated with fresh task ids under the new file task.

```md
Previous file body:
- [x] Check inbox
- [x] Update weekly metrics {{operonId:: old-child}} {{parentTask:: old-file-task}}

Next file body:
- [ ] Check inbox
- [ ] Update weekly metrics {{operonId:: new-child}} {{parentTask:: new-file-task}}
```

Recurring file task series can also define **property cleanup rules** in settings. For example, a recurring bike tour file can keep the same structure while clearing measurement fields such as `Distance`, `TimeInMotion`, `SpeedAvg`, `SpeedMax`, `HeartRateAvg`, `Banner`, or `Image` in the next generated file.

```yaml
Distance:
TimeInMotion:
SpeedAvg:
SpeedMax:
HeartRateAvg:
Banner:
Image:
```

#### Inline task recurrence

Recurring **inline tasks** stay in the Markdown file where they already live. When a new occurrence is created, Operon inserts a fresh checkbox line with a new task identity and keeps the recurring task close to its original note context.

#### Date and week tokens

If an inline task name or file task title contains a single date token or week token, Operon updates that token for the next occurrence.

```md
Review 2026-05-19.md -> Review 2026-05-26.md
Weekly Planning W21.md -> Weekly Planning W22.md
```

Projected occurrences can appear in Calendar, skipped dates can be managed from the repeat controls, and temporal edits can apply to one occurrence or to this and following tasks.

![Recurrence picker showing schedule, when-done, count, frequency, weekdays, and end conditions](assets/readme/IMG26-recurrence-picker-count-weekdays.png)

Recurrence keeps repeated work connected to its original context without making every occurrence feel like a copy-paste chore.

### Time tracking

Track work from the task itself. Operon can start and stop timers, store completed tracking sessions, and keep duration fields attached to the task record that explains the work.

TrackTime records actual sessions. FlowTime adds a focused countdown rhythm, while manual session editing makes it possible to add, correct, or remove tracked ranges after the fact.

Task duration is stored in seconds, which keeps calculations stable even when the UI shows human-friendly labels. `duration` stores the task's own tracked time.

`totalDuration` is updated automatically as a cumulative value across parent and child tasks. Parent tasks can show the combined tracked effort of their descendants without manually recalculating the rollup.

Recorded effort stays visible in the Task Editor, compact task chips, Calendar, Kanban, and time history views.

#### Time Session History

The **Time Session History** panel gathers tracked sessions into one review surface. Sessions can be opened for quick editing, removed when needed, or replayed by starting the timer again for the same task.

![FlowTime and Time Session History showing an active timer, recorded sessions, and tracked duration](assets/readme/IMG27-flowtime-time-session-history.png)

Time tracking turns effort into task history instead of leaving it as a separate timer log.

## Status

Operon is maintained by Hasan Yılmaz and is prepared for public distribution as of version 1.0.0.

Operon has been developed in the maintainer's live Obsidian vault from the beginning and is still actively used there; the current working vault contains **about 3,000 indexed Operon tasks**. This is real-world usage evidence, not a formal benchmark.

## Compatibility and Requirements

Operon requires Obsidian `1.7.2` or newer and is not marked as desktop-only, so it can be installed on both desktop and mobile Obsidian. Some workflows are naturally more comfortable on larger screens, and the pinned dock can be disabled on phones.

Operon's inline task metadata syntax is specific to Operon. Compatibility risk is more likely to come from overlapping surfaces: another task plugin may also render checkbox rows, rewrite Markdown tasks, manage recurrence, or add its own task planning views. If you use another task-management plugin, test the combination on a small set of notes first and avoid letting multiple plugins manage the same task surfaces.

Installation uses Obsidian's normal Community Plugins flow. No separate beta installer or manual installation path is required for regular users.

## Core integrations

Operon does not require another community plugin to be installed.

Some workflows use Obsidian core plugin behavior:

- **Daily Notes**: used by daily-note based inline task creation, daily-note navigation, and related date-based workflows. If you do not use Daily Notes, inline tasks can be directed to a fixed target file instead.
- **Page Preview**: used by Obsidian's `hover-link` preview behavior for task title and wikilink previews. If Page Preview is disabled, those hover previews may not appear, but the task data and task actions still work.

Operon bundles **CodeMirror** modules for editor integrations and **ical.js** for parsing read-only external Calendar sources.

## Data and Network Behavior

Operon stores its canonical plugin data in Obsidian's plugin configuration area under `.obsidian/plugins/operon/`. User-facing settings and configuration live in `data.json`, organized into stable domains for core settings, taxonomy, views, interface preferences, automation, and integrations. Non-settings data is kept separate: `state/` stores user state such as pinned tasks, active trackers, and repeat series; `runtime/` stores the task index; and `cache/` stores parsed external calendar cache data.

Older Operon versions used a vault-root `.operon/` folder. Current versions may read `.operon/` as a legacy fallback for users who are migrating, but new canonical writes go to the plugin configuration area. Once canonical storage is healthy, Settings includes a manual action to move the legacy `.operon/` folder to Obsidian trash. After that retirement marker is recorded, Operon no longer uses `.operon/` as startup fallback.

For Obsidian Sync users, Operon's canonical settings package follows Obsidian's plugin data location. If you sync plugin settings, Operon settings in `data.json` can sync with the rest of your Obsidian configuration. Runtime index and cache files remain local plugin data and can be rebuilt from vault content when needed.

### Vault and clipboard access

Operon is a local-first task manager for Markdown tasks. To build its task index and keep task views accurate, it uses Obsidian's Vault API to work with files inside the active vault.

- **Vault enumeration**: Operon lists Markdown files in the vault to find inline tasks, file tasks, task templates, daily-note targets, filters, and picker suggestions. This gives Operon access to vault file paths, but it is used for local indexing and navigation inside Obsidian.
- **Vault read/write**: Operon reads task files to parse task metadata and writes only when you create, edit, move, convert, schedule, complete, or otherwise update tasks through Operon.
- **Clipboard access**: Operon writes to the system clipboard only for user-initiated copy actions, such as copying an `operonId`, copying an external task link, or copying an embeddable filter block. Operon may also read the system clipboard only after an explicit user action, such as using the Location picker clipboard button to import coordinates copied from the Maps plugin. Clipboard text is parsed locally and used only when it contains valid `lat, lng` coordinates.
- **External calendar sources**: If you configure external ICS calendar URLs, Operon fetches those read-only calendar sources and stores the parsed cache locally under the plugin cache folder.

Operon does not monitor clipboard changes, include telemetry, analytics, tracking pixels, or background usage reporting. Task data stays in your vault, and Operon plugin data stays inside Obsidian's plugin configuration storage.

## License

Operon is licensed under the GNU General Public License, version 3 or later (`GPL-3.0-or-later`). See [LICENSE](LICENSE) for the full license text.

This license allows use, study, modification, redistribution, and commercial distribution, but distributed modified versions and derivative works must preserve the same GPL freedoms and provide the corresponding source code under GPL-compatible terms.

## Branding

The Operon name, logo, icon, plugin ID, and official release identity are reserved by the maintainer. Modified versions and forks must use clearly different branding and must not imply that they are official Operon releases or endorsed by the Operon maintainer. See [TRADEMARK.md](TRADEMARK.md).

## Contributions

Contributions are accepted under the same `GPL-3.0-or-later` license. See [CONTRIBUTING.md](CONTRIBUTING.md).
