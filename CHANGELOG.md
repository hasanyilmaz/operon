# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Validation

## [1.7.0] - 2026-06-25

This update focuses on making Operon easier to understand and reuse inside a real vault. The official docs wiki can now be downloaded into `Operon/Docs` and kept aligned with your local settings, giving both humans and agents a clearer reference point for working with tasks, templates, and configured properties.

### New
- Added **Operon Docs download settings** in Core > General, so the official docs wiki can be downloaded or kept updated inside `Operon/Docs` with local property-name mapping.
- Added a **Calendar Task Pool filter toggle** so the sidebar Task Pool can follow the active Calendar preset filter; new installs enable it by default while existing users keep their current global-pool behavior unless they turn it on.
- Added **New File Task Creation Defaults** so Task Creator can optionally open in File Task mode and preselect a chosen file-task template without changing the inline-first default.
- Added **Template Placeholders** for Operon file task templates: `{{date}}`, `{{datetime}}`, `{{taskDescription}}`, `{{note}}`, `{{dateStarted}}`, `{{dateScheduled}}`, and `{{dateDue}}`, plus direct `{{date}}` and `{{datetime}}` resolution in pasted inline task snippets.

### Improved
- Improved **Priority** and **Pipeline** color controls in Settings so status and priority colors use Operon's searchable color picker instead of the native browser picker.

### Fixed
- Fixed **Convert to file** in Live Preview for inline tasks with carried-over checkboxes, so the source line updates atomically and no longer leaves a blank file-task label until the next click or refresh.
- Fixed Obsidian 1.6.5 CSS compatibility warning for file task overlay nested wikilinks while keeping their subtle dotted link affordance.
- Fixed **Convert to file** in Live Preview for task titles containing wikilinks, so the new file-task overlay label appears immediately without requiring a page refresh.

### Validation
- Local validation passed `npm run docs:sync-runtime:test`, `npm run check:local`, `npm run release:guard`, and `git diff --check`, including docs sync runtime tests, strict linting, production build, release guard, and 1042/1042 Phase 5 regression checks.

## [1.6.2] - 2026-06-23

This is a small workflow polish release for recurring tasks and file-task conversion. Recurring work is easier to scan directly from task rows, inline-to-file conversion preserves more checklist context, and file-task wikilinks render more cleanly across Live Preview and Reading View.

### New
- Added a **Recurrence compact chip** for recurring tasks, showing the recurrence summary in inline and filter task rows with a cleaner next-occurrence tooltip when available.
- Added **plain checkbox carryover for Convert to file**, so inline tasks can bring their scoped checkboxes into the new file task by default, with a File Task Conversion setting to keep the previous behavior when needed.

### Improved
- Improved **file task overlay** labels so nested wikilinks keep a lighter, consistent visual affordance without the heavy underline treatment.

### Fixed
- Fixed **Convert to file** in Live Preview so the new file-task link label refreshes immediately after conversion instead of appearing only after the next editor interaction.
- Fixed **Calendar Task Pool** scrolling on Windows desktop so long task pools no longer get trapped at the top of the sidebar.
- Fixed **file task overlays** so task titles that contain wikilinks render those inner links cleanly instead of letting nested wikilinks break the overlay label.
- Fixed **Reading View file task overlays** so recovering a nested wikilink artifact replaces only the broken link text and preserves surrounding paragraph text.

### Validation
- Local validation passed `npm run check:local` and `git diff --check`, including strict linting, production build, release guard, and 1025/1025 Phase 5 regression checks.

## [1.6.1] - 2026-06-21

Phone calendars have less room for theory.

The previous release brought external calendar and tracked-time columns into Time Tracker Grid. That made the **Day** view much more useful, especially when you want to compare planned work with what actually happened. But on a phone, the same extra context can become too tight too quickly.

This update adds a **2 Days** mobile Calendar mode and per-mode Calendar presets, so each view can have a different job. Day can stay focused on planned, external, and tracked time, while 2 Days or 3 Days can use a cleaner planning preset when you need more range and less detail.

### New
- Added a **2 Days** option to the mobile Calendar view cycle, giving Time Tracker Grid and dense mobile calendars a middle ground between Day and 3 Days.
- Added per-mode mobile Calendar preset settings, so Agenda, Day, 2 Days, and 3 Days can each open with their own chosen Calendar preset.
- Added mobile Calendar cycle toggles, so Agenda, Day, 2 Days, and 3 Days can be included or skipped while keeping at least one mobile mode available.
- Added **Convert to file** and **Convert to inline** contextual menu actions, making inline/file task conversion available directly from task surfaces, including existing Kanban and Time Session History menus after migration.
- Added **Pipeline descriptions** in settings, so each workflow can carry human-readable and agent-friendly guidance for task creation.
- Added **Priority descriptions** in settings, so each priority level can explain when humans and agents should use it during task creation and planning.

### Fixed
- Fixed **Calendar** background refreshes so Time Tracker Grid and sidebar state updates no longer steal focus while typing in notes, Task Creator, Task Finder, or Calendar search fields.
- Fixed **Log as tracked** so Calendar timed blocks keep their exact planned start and end times instead of snapping tracked sessions to the visible grid interval.
- Fixed **Mobile Calendar** timed task moves so dropped tasks persist, and kept the time grid from jumping after timed moves or slot-created tasks refresh.
- Fixed **Reading View inline task** styling so rendered task rows keep Live Preview-aligned spacing without using CSS flagged by Obsidian's compatibility checks.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 1003/1003 Phase 5 regression checks.

## [1.6.0] - 2026-06-19

Planning time and tracking time now sit closer together.

This release introduces **Time Tracker Grid**, a Calendar preset built for comparing planned work, external calendar blocks, and completed tracked time in the same day view. It also expands Operon's multilingual surface with Chinese localization and tightens several task creation, reading, and calendar interactions around the new planning workflow.

### New
- Added **Chinese localization** for Simplified and Traditional Chinese, including Settings language selection, translated UI strings, Chinese date parsing, repeat summaries, calendar wording, task editing labels, and filter surfaces.
- Added **Time Tracker Grid** as a Calendar preset for desktop and mobile Day/3 Days views, showing planned tasks, external calendar events, and tracked sessions in separate per-day lanes.
- Added **Time Tracker Grid** daily totals for planned, external, and completed tracked time, making it easier to compare what was planned with what was actually tracked.
- Added tracked-session editing directly from **Time Tracker Grid**, including session selection, move/resize editing, edit and delete modal access, stale-session feedback, and read-only handling for active or unassigned timers.
- Added **Log as tracked** actions for past planned blocks, so planned Calendar time can be recorded as tracked time without rewriting existing tracker history.
- Added mobile and future-day behavior for **Time Tracker Grid**, including contained narrow columns, lane headers, read-only external events, active timer visibility, and automatic hiding of tracked-time lanes on future dates.

### Improved
- Improved **Parent-Child task inheritance** so native task tags can be added as an optional inherited field, while seed tags from Calendar, Kanban, and Task Creator remain preserved.
- Improved **Calendar** and **Kanban** preset controls so Task color source selectors, buttons, and dropdowns use a more consistent compact style.
- Improved **Date Picker** result rows so ISO dates have a little more room and no longer truncate before the weekday column.
- Improved **Calendar** day highlighting with calmer today and weekend treatment while keeping today's day text and lane labels easy to spot.
- Improved **Task Creator** and **Task Editor** focus styling so description, note, and editor fields follow the task color when available.
- Improved the **Task Editor** Core controls so date/time, Estimate, and Subtract Delta controls follow the more compact Add Recurrence Rule height.
- Improved tracker session editing reliability across Calendar, Time Session History, and Task Editor with safer edits, clearer context, and cleaner recovery when persistence fails.

### Fixed
- Fixed **Reading View inline tasks** so Project Serial chips stay with metadata chips, stale indexes no longer expose raw `{{...}}` task fields, wikilink overlays stay stable, and rendered task rows keep normal Obsidian list spacing.
- Fixed first generated **when-done recurring inline tasks** keeping the previous start date when the source task only had a start date.
- Fixed **Calendar inline task creation** so choosing a parent task in Task Creator places the new task through the parent-aware flow before using the Calendar save target.
- Fixed **Calendar task status icons** so normal scheduled, timed, due, finished, and mobile task items can be clicked again while projected future occurrences and active tracker blocks remain read-only.

### Validation
- Local validation passed `npm run check:local`, `npm run release:guard`, and `git diff --check`, including strict linting, production build, release guard, and 997/997 Phase 5 regression checks.

## [1.5.0] - 2026-06-17

Some tasks stay small. Some become projects.

This release improves the second case. Operon now has better tools for seeing project structure, creating subtasks with the right context, and opening nested work without rebuilding your view by hand.

**Project Serials** add readable parent IDs to task trees. They make project relationships visible in the interface while keeping Operon's stable task IDs untouched.

**Selectable inheritance rules** make child tasks more predictable. You decide which parent fields should flow into new subtasks, and Status can either follow the parent pipeline or start from the default pipeline.

The contextual menu now understands more of the work around a task. **Subtasks**, **Create subtask**, **Checkboxes**, and especially **Dynamic Subtasks Filter** make it easier to open the right project layer from the task you are already looking at.

### New
- Added **Spanish localization**, including Settings language selection, translated UI strings, Spanish date parsing, calendar wording, task editing labels, and filter surfaces.
- Added **Project Serials** for parent task trees, showing read-only visual serial chips without changing real Operon task IDs; serial display refreshes when settings change, prefixes can be renamed inline, and numbers removed from the end of a series can be reused while middle gaps remain reserved.
- Added **Parent-Child task inheritance** as a separate Relationships section with compact single-line field rows and Workflow Picker-style field tokens, so child tasks can inherit only the parent fields you choose while Status can start from either the parent pipeline or the default pipeline.
- Added **Subtasks**, **Create subtask**, and **Checkboxes** contextual menu actions, with migration for existing custom menus so the new actions appear in the intended order where supported.
- Added **Dynamic Subtasks Filter** as a centered contextual window for tasks that already have subtasks, with its own auto-expand limit, open-only toggle, locked filter template, higher desktop placement, page-preview layering, and a single close button.

### Fixed
- Fixed **Calendar toolbar** controls picking up preset dropdown styling, so navigation icons stay centered and the preset selector keeps its compact chevron on hover.
- Fixed **Kanban contextual Checkboxes** opening with leftover hover-menu text or tooltip fragments visible behind the checkbox popover.

### Validation
- Local validation passed `npm run check:local`, `npm run release:guard`, `git diff --check`, and `npm audit`, including strict linting, production build, release guard, and 952/952 Phase 5 regression checks.

## [1.4.1] - 2026-06-15

This release is a compact visual consistency pass for Operon's busiest surfaces. It reduces theme-related button noise across editors, pickers, calendars, sidebars, and tracking controls while adding a couple of practical improvements to file-task creation and saved preset filters.

### Improved
- Improved **Create file task** so running it without selected text, a source line, or an inline task opens Task Creator in File mode instead of immediately creating a placeholder file task.
- Improved **Calendar** and **Kanban** preset filter controls with compact Create, Edit, Choose, and Clear actions, making saved filters easier to build and adjust from preset settings while keeping the preset panel easier to scan.

### Fixed
- Fixed Obsidian theme button backgrounds showing gray fills over Operon's newer transparent bordered styling across Task Editor, Calendar toolbar, sidebars, lane controls, pickers, tracking session controls, and the tracked session editor modal.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 927/927 Phase 5 regression checks.

## [1.4.0] - 2026-06-13

This update centers on the new **Color Picker** and **Color Palette** settings. Colors are now easier to find, compare, and adjust: searchable named colors, tone and hue controls, custom previews, copyable hex values, localized names, and a curated default palette make Operon's colors work for both quick search and manual tuning.

It also tightens the everyday interface surfaces where repeated task work happens: Calendar sidebars, Filter Builder, shared pickers, and the Task Editor.

### New
- Added a new **Color Picker** and **Color Palette** settings experience, with searchable named colors, tone and hue controls, custom color preview, copyable hex values, localized color names, and a curated default palette for Operon's 28 named colors.
- Added **Workspace Tweaks** settings for optional scrollbar hiding, Properties collapsing, and compact sidebar tab icons, so small Obsidian workspace refinements can be managed from Operon.
- Added a **Task Editor autosave delay** setting, so users can choose how quickly typing edits autosave after they pause while closing the editor still saves immediately.

### Improved
- Improved Calendar **Calendars** and **Task Pool** controls with a denser preset layout, a new **Finished Tasks** mode, clearer search feedback, remembered pool mode, and better keyboard behavior.
- Improved **Filter Builder** condition field selection with a searchable picker, making long canonical and custom key lists easier to scan.
- Improved Operon's **pickers** with bordered controls, clearer selected and hover states, and more consistent action styling across date, status, priority, repeat, list, relationship, estimate, icon, and custom field pickers.
- Improved the **Task Editor** with updated header controls, workflow fields, tracking sessions, duration summaries, description and notes sections, parent/subtask context, checkbox progress, localized progress labels, and a clearer dirty-state save indicator.

### Fixed
- Fixed **Task Editor file body** layout issues so file-body panels no longer start clipped or shifted when opened from file tasks or inline tasks.

### Validation
- Local validation passed `npm ci`, `npm run check:local`, and `npm audit`, including strict linting, production build, release guard, 926/926 Phase 5 regression checks, and 0 reported vulnerabilities.

## [1.3.0] - 2026-06-11

This release makes **Custom Keys** a much more powerful part of Operon. You can now define your own task keys in Settings and use them across the places where real task work happens: Task Editor, Task Creator, compact chips, filters, search, embedded filters, Kanban sorting, and Kanban swimlanes.

It also continues the calmer Operon interface direction from the previous release. Task editing, creation, picker controls, Pinned Tasks, FlowTime, Task Finder, and contextual menus now share more of the same compact, bordered, tool-like visual language.

### New
- Added **Custom Keys** management in Settings, giving user-defined task keys their own Core page with field types, icons, descriptions, usage indicators, ordering, and safer delete confirmation.
- Added support for **Custom Keys** across Task Editor, Task Creator, Live Preview field menus, compact task chips, Filter Builder, task search, embedded filter search, Kanban sorting, and Kanban swimlanes.
- Added dedicated **Custom Key pickers** for text, list, number, date, and datetime fields, so user-defined keys can be edited with controls that match their field type.
- Added **Custom Key suggestions** from existing vault frontmatter values, so text and list pickers can reuse values already present in matching properties, not only values indexed from Operon tasks.
- Added wikilink-aware **Custom Key** display, including plain labels, Page Preview support, and linked-note opening for wikilink-backed custom values where the chip is interactive.
- Added a **Kanban swimlane visibility** toggle for Custom Keys, so user-defined keys only appear as swimlane grouping options when explicitly enabled.
- Added a **mobile context menu auto-hide** setting so touch menus can close automatically after a user-defined delay.

### Improved
- Improved **Task Editor file body** spacing so heading collapse chevrons stay easier to see and click inside the embedded editor.
- Improved **Task Editor workflow pickers** with a compact icon rail, letting workflow fields open from field icons while existing values stay visible below.
- Improved **Task Editor workflow picker spacing** so the new icon rail is grouped more clearly with the Core section and has better separation from surrounding fields.
- Improved **New Operon Task** toolbar icons with hover tooltips that follow the selected task color or fall back to the accent color, making icon-only task fields easier to identify without changing the compact creator layout.
- Improved **New Operon Task**, **Task Finder**, **Kanban search scope**, **FlowTime**, **contextual task menus**, **Pinned Tasks**, and **plain checkbox list editor** controls with calmer bordered styling and clearer selected states.
- Improved **Time Session History** rows with hover-revealed secondary actions, finished-task replay buttons, softer finished-task borders, aligned task icons, centered task titles, calmer session counters, and clearer edit targets.
- Improved **Inline Tasks settings** spacing and active-row highlighting so conditional save-location fields feel cleaner and less crowded.
- Improved **Priority settings** with a bordered editor frame that matches Pipeline settings and keeps the Add Priority action visually grouped with the priority list.
- Improved **Settings Search** coverage for Location Map, Mobile Calendar, Mobile Kanban, Relationships, Recurrence, Tracker, and Pinned Dock settings in Obsidian 1.13.
- Improved table-like settings pages so State Icons, Task Finder, Context Menu, Task Editor, and Mobile Task Editor keep their stable native page rendering for custom rows, matrices, and picker lists.
- Improved **Recurrence settings** layout so YAML cleanup rules have clearer spacing, a cleaner section title, and a less crowded Add Property Cleanup Rule action.
- Improved task **note action** icons so Live Preview, Reading View, Filter rows, and file task overlays use the task color when available and fall back to the accent color.

### Changed
- Changed first-run **Pinned Tasks** defaults so pinned cards start without task-color tinting and active timer tasks are pinned automatically.
- Changed the new-user default for **Task Editor line numbers** to off, giving the file body panel a cleaner first-run editing view while keeping the setting available.

### Fixed
- Fixed **Pinned Tasks** sidebar mode so the floating dock hides immediately, stays hidden after restart, and the pinned tasks command opens the configured surface instead of reviving the dock.
- Fixed **Settings Search** subpages in Obsidian 1.13 so Keymapping, Interface, and Mobile settings open through stable native page shells instead of occasionally rendering blank or missing sections.
- Fixed **Kanban** optimistic card previews for multi-value swimlanes, so moving one tag, context, assignee, or Custom Key list value follows the same lane behavior as the saved write.

### Validation
- Local validation passed `npm run check:local` and `git diff --check`, including strict linting, production build, release guard, and 919/919 Phase 5 regression checks.

## [1.2.1] - 2026-06-09

I used this release to start tightening Operon's visual language. **Linear** has been one of the references in my head: calm, compact, structured, and very much a tool rather than a decorative app.

The first visible result is the new **task chip** direction, plus smaller polish passes across **Kanban**, **Calendar**, **filters**, **pickers**, and **menus**. Obsidian themes can make this tricky, so I am taking it gradually: a few elements per bump, tested against real workflows instead of chasing a huge redesign.

### Improved
- Refined Operon's **interface polish** across Task Chips settings, chips, pickers, Kanban, Calendar, Filter views, Task Creator, Task Finder, FlowTime, Time Session History, tooltips, and action menus with calmer colors, more structured corners, cleaner guide lines, better-aligned controls, consistent chip hover behavior, and focused subpages for dense chip settings.
- Improved **task contextual menus** on mobile with steadier long-press timing and shared behavior across task surfaces, so touch actions like **Unschedule** stay easier to reach.
- Improved **Dynamic File Task Filter** grouping and sorting so the current file task stays visible at the top, direct subtasks can be grouped below it, descendants stay nested under their parent, **Happens on** works as a sortable date field, and custom sort rules apply inside expanded subtask trees.

### Fixed
- Fixed remaining **Dynamic File Task Filter** and compact chip polish issues, including Live Preview width alignment after pane geometry changes, mobile Location Map chip previews, and duplicate compact chip CSS declarations.

### Validation
- Local validation passed `npm run check:local` and `git diff --check`, including strict linting, production build, release guard, and 887/887 Phase 5 regression checks.

## [1.2.0] - 2026-06-08

This release gives **normal markdown checkboxes** a clearer role inside Operon workflows. Lightweight checklists now show progress beside file tasks and inline tasks. The **mini editor** keeps small checklist work close without converting checkboxes into Operon tasks.

It also brings the **Operon Day Picker** into more date surfaces. Date picking should feel familiar wherever you are working in Operon.

### New
- Added the **Operon Day Picker** across date and datetime fields, so choosing dates feels the same whether you are editing a task, creating one, filtering, setting recurrence, or working directly in Live Preview, Reading View, and the Inline Task Bar.
- Added a lightweight **normal checkbox workflow** for file tasks and inline Operon tasks. Plain markdown checklists now show progress in task rows and overlays, and a small editor lets you add, review, complete, extend, pin, and save checkbox items while keeping them as ordinary markdown.

### Improved
- Improved **Date Picker** suggestions so upcoming dates are easier to reach first, typed dates do not repeat above the calendar, short entries like `22 d` and `22 m` still find useful matches, and past dates stay available when you ask for them.
- Improved **Filter rows** and **file task overlays** so Operon subtasks and plain checklist progress are easier to tell apart, with clearer chips, shorter tooltips, and per-surface **Open checkboxes** controls.

### Fixed
- Fixed **Task Finder** rows looking squeezed under themes with broad modal button styling, including Velocity.
- Fixed **Task Editor** file body chips looking uneven under themes with broad modal button styling, including Velocity.
- Fixed completed recurring task history continuing to show future projected entries in **Calendar** when there is no open task left in the series.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 879/879 Phase 5 regression checks.

## [1.1.7] - 2026-06-06

This release introduces **Location Map** support as a first-class part of Operon tasks, with map picking and chip previews powered by the **Obsidian Maps** plugin when it is enabled. Tasks can store `lat, lng` coordinates, use Places/Map/Manual picking, show map-backed previews, and connect more naturally to real-world places; smaller Calendar, Date Picker, Filter editing, and Repeat picker updates smooth the surrounding planning workflow.

### New
- Added **Location Map** support for the canonical `location` task field, with `lat, lng` coordinate storage, Places/Map/Manual picking in Task Creator and Task Editor, **Obsidian Maps**-powered chip previews, saved place markers, light-map settings, place-note visuals, and desktop preview controls for resizing, moving, and pinning maps.
- Added a **Calendar day title action** setting, so clicking or tapping day headers can either create/open the daily note or do nothing.

### Improved
- Improved **Calendar Time Grid** overlap and refresh handling so Operon tasks stay readable while external calendar events sit behind them as availability context, with stable scrolling, sidebar layout, and separated external-event stripes.
- Improved **Date Picker** suggestions so populated date and datetime fields keep the current value at the top while still showing quick choices like tomorrow, next week, and next weekend.
- Improved **Filter editing** with sidebar header access for adding filters and edit modal quick actions for copying embed code, duplicating filters, and removing the current filter without returning to the Settings list.

### Changed
- Changed the **Repeat picker** to use a Reference date for recurrence anchoring instead of treating that picker value as Scheduled Date, keeping user-facing Start Date, Scheduled Date, and Due Date fields separate from the recurrence engine.

### Fixed
- Fixed indented inline tasks losing their markdown indentation after updates from the **Task Editor**.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 845/845 Phase 5 regression checks.

## [1.1.6] - 2026-06-04

This release brings Operon into German and French, while also tightening language switching and Tasks emoji recurrence conversion so multilingual task workflows feel more native.

### New
- Added **German localization**, including explicit Settings language selection, translated UI strings, German repeat summaries, pinned task surfaces, Task Finder scopes, time tracking session terminology, filter materialization messages, and the pinned sidebar task editor label.
- Added **French localization**, including explicit Settings language selection, translated UI strings, French natural-language date parsing, Task Finder wording, time tracking session terminology, Kanban labels, and filter materialization messages.
- Added **Tasks emoji conversion** support for `🔁 every ...` recurrence rules, so supported recurrence syntax becomes Operon repeat fields in both single-line and selection conversion while unsupported syntax is still preserved in the leftovers note.

### Fixed
- Fixed the **Settings language selector** so changing languages saves safely without rebuilding the current Settings page into a blank screen.
- Fixed **Turkish Settings translations** so Core, Keymapping, Recurrence, Status Icons, and Task Chips use consistent Turkish wording.
- Fixed the update **release notes popup** showing only the newest unseen release; it now shows the latest five releases, matching the Settings release notes view.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 821/821 Phase 5 regression checks.

## [1.1.5] - 2026-06-03

This release makes Daily Note task capture smoother, gives Operon a built-in place to revisit recent updates, and makes pinned task state more reliable across old and new storage paths.

### New
- Added a release notes entry at the top of Operon Settings with a “See what's new” button and a recent-updates window, so users can review the latest Operon improvements, fixes, banners, and videos at any time.
- Added Daily Note defaults for new Operon inline tasks, letting users automatically fill Start Date and/or Scheduled Date from the note date while preserving explicit task dates.

### Improved
- Improved pinned task syncing by storing pin state in Operon's canonical plugin data package with legacy fallback, conflict-aware merges, and automatic tombstone cleanup.

### Fixed
- Fixed pinned tasks not auto-unpinning immediately after completion in some Task Editor and status update flows.
- Fixed pinned task migration so a malformed old state file no longer blocks importing valid legacy pinned cache data.
- Fixed Reading View inline task rendering so task metadata resolves from source lines more reliably, preventing raw `{{...}}` fields from leaking on desktop preview in edge cases.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 814/814 Phase 5 regression checks.

## [1.1.4] - 2026-06-02

### New
- Added Dynamic File Task Filter for YAML file tasks, showing an automatic filter surface with a customizable visible name, descendant-aware search, and subtask auto-expand limit at the top or bottom of the file body in Reading View and Live Preview without writing filter blocks into notes.
- Added a Task Editor setting to hide source line numbers in the file body panel, so users can keep the editor cleaner when line references are not needed.

### Improved
- Improved the Dynamic File Task Filter settings section by removing redundant intro copy and making the first setting description carry the essential context.
- Improved Calendar and Kanban task titles so normal wiki-links are clickable with Page Preview support while file-task links stay visually lightweight.
- Improved the Dynamic File Task Filter default icon to better distinguish the automatic file-task filter from ordinary saved filters.
- Improved the filter editor icon picker so saved filters and Dynamic File Task Filter use the same stable icon picker modal as pipeline and priority settings.
- Improved filter editor button feedback with accent hover states for add actions and a red hover state for Cancel.
- Improved the filter editor layout with aligned name, grouping, and sort controls, and gave Dynamic File Task Filter a sensible default sort preset users can change.
- Improved filter search results so flat search mode respects each filter's configured sort order, including embedded and Dynamic File Task Filter surfaces.

### Fixed
- Fixed file task overlay progress counts lingering after the last subtask was deleted.
- Fixed file task overlay double-check markers so they only appear when the linked task itself is complete and all descendants are complete.
- Fixed Kanban preset deletion in Settings leaving an empty native settings page instead of returning to the populated Kanban settings.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 785/785 Phase 5 regression checks.

## [1.1.3] - 2026-06-01

### Fixed
- Fixed remaining Self-hosted LiveSync status overlay interference in Operon custom views, including Kanban collapse controls and Calendar drag and drop.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 761/761 Phase 5 regression checks.

## [1.1.2] - 2026-06-01

### New
- Added a mobile Calendar Day and 3 Days all-day collapse button, so phone users can temporarily give the time grid more room without changing Calendar settings.

### Fixed
- Fixed mobile Calendar Day and 3 Days views stopping short of the bottom of the panel by sharing the Agenda layout's bottom clearance behavior.
- Fixed Operon custom views being disrupted by Self-hosted LiveSync's in-editor status overlay while keeping LiveSync sync behavior unchanged.
- Fixed the Task Editor status picker becoming unavailable after changing the status once.
- Fixed wiki-links in Filter view task titles rendering as plain text instead of Obsidian links with Page Preview support.
- Fixed file-task wiki-link overlays in Filter views and task rows so overlay chips, quick actions, status-colored icons, and escaped/code/embed-style wiki-links behave consistently.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 759/759 Phase 5 regression checks.

## [1.1.1] - 2026-05-31

### New
- Added a blocked-task dialog for dependency-blocked tasks, showing why a status change was prevented and offering quick actions for blocker tasks.
- Added Obsidian 1.13 Settings Search support for Operon settings while preserving the existing settings UI on older Obsidian versions.

### Improved
- Improved dependency handling so `blocking` and `blockedBy` stay synchronized, reject invalid self-links or cycles, repair missing inverse links after indexing, and appear consistently in chips, filters, Task Finder, file task overlays, and the mobile Task Editor.
- Improved Operon's settings experience with searchable native Settings pages, modal icon pickers, grouped sections, clearer wording, and consistent input styling across complex settings pages.
- Improved plugin storage handling by moving canonical settings, state, runtime, and cache data into Obsidian's plugin configuration area, with safer `data.json` reloads, legacy fallback, and manual `.operon` cleanup.
- Improved Calendar and Kanban preset editors with Save and Cancel actions, so draft changes can be reviewed or discarded consistently before updating views.
- Improved mobile Calendar Day and 3 Days empty-slot taps so they open the slot action dialog instead of jumping straight into Task Creator, matching desktop behavior and allowing task assignment or tracked-session creation first.
- Improved status and state icon controls with a more compact State Icons fallback dropdown and easier-to-scan status picker spacing.

### Changed
- Moved Operon's canonical plugin data from the legacy vault-root `.operon` folder into Obsidian's plugin configuration storage, leaving `.operon` as a read-only migration fallback.

### Fixed
- Fixed dependency blocking so active `blockedBy` predecessors prevent completion and workflow status changes from status cycling, checkbox completion, Task Editor saves, Live Preview updates, Kanban moves, and timer-start automation.
- Fixed dependency validation so multi-field edits, passive repairs, and Task Creator drafts reject invalid dependency graphs before writing files or inverse links.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 754/754 Phase 5 regression checks.

## [1.1.0] - 2026-05-30

### New
- Added a mobile-first Calendar surface with Agenda, Day, and 3 Days views, including touch creation, swipe navigation, drag/drop scheduling, external calendars, projected occurrences, and phone-focused controls.
- Added a mobile global quick-create button that opens Task Creator from phone screens, can be dragged to a remembered position, can optionally hide in Calendar or Kanban, and still stays out of modal and keyboard flows.
- Added a Pinned Tasks sidebar mode with a desktop display setting, keyboard-accessible task rows, desktop contextual quick actions, and mobile-first sidebar behavior, so pinned tasks remain easy to reach on touch screens without changing the existing floating dock state.
- Added delayed duplicate `operonId` alerts with a status bar indicator and Core settings for popup auto-open and alert delay, so automation-heavy workflows are not interrupted by immediate conflict popups.
- Added Kanban mobile layout controls for mobile mode, max width, swimlane rail visibility, rail width, and horizontal status snap defaults.

### Improved
- Improved Kanban mobile layout by keeping headers fixed and using compact swimlane rails to give narrow touch screens more usable board space.
- Improved Kanban mobile snap mode so dragging a card near the left or right edge advances to the adjacent status column.
- Improved Kanban mobile dragging so holding a card near the top or bottom edge scrolls through tall swimlane boards.
- Improved Kanban mobile card gestures so short swipes on a card scroll the cell or board on the intended axis, while long-press still starts card dragging with a visible drag preview.
- Improved Kanban mobile cell quick-add so tapping an empty cell reveals a smaller centered add button without changing desktop hover behavior.
- Improved Kanban mobile search controls so task finder icons wrap onto additional rows and the scope picker stays within the phone viewport instead of being clipped on narrow screens.
- Improved the Kanban search field by replacing the long placeholder with a compact scan-search icon.
- Improved the Kanban toolbar on phones by replacing crowded board buttons with a compact board selector.
- Improved Task Finder on phones with a compact full-width layout and horizontally scrollable scope buttons, making search easier to use when the mobile keyboard reduces screen space.
- Improved Task Creator on phones with a compact keyboard-aware layout, horizontally scrollable field toolbar, and shorter template action label.
- Improved Task Creator on phones so field pickers open in one consistent surface, creator actions stay directly below the toolbar, and the creator fills the available mobile panel area.
- Improved mobile Calendar Agenda with configurable past and future day windows, optional completed-item visibility, and Today refocus, making longer phone agendas predictable while keeping empty days stable and scannable.
- Improved mobile Calendar Day and 3 Days scroll behavior so task edits and refreshes keep the current time position, while Today still jumps to a useful current-time focus.
- Improved mobile Calendar Day and 3 Days swipe transitions with a small sliding day buffer, making adjacent day changes feel smoother on phones.
- Improved Mobile settings with a dedicated top-level tab and General, Task Editor, Calendar, and Kanban subtabs.
- Improved Mobile Task Editor settings so canonical toolbar fields show inline task tokens while non-canonical actions keep their plain keys.
- Improved Task Editor on phones with a compact description-first layout, fixed description/note/core controls, configurable core icon rail, full-width workflow selection rows, auto-closing mobile workflow pickers, and a modal-contained, layout-isolated picker surface that opens without disturbing the editor behind it.

### Changed
- Mobile Calendar now activates only on phones, preserving desktop Calendar behavior in narrow desktop sidebars.
- Duplicate `operonId` conflicts now default to a delayed notice and status bar alert instead of opening the duplicate manager immediately; the manager can still be opened manually or re-enabled for automatic opening.
- Kanban collapse rules now treat empty swimlanes according to visible tasks after auto-collapsed finished columns are ignored, matching what users see on the board.
- New Kanban presets now start with finished-column auto-collapse disabled, matching the first-board default while preserving existing preset choices.

### Fixed
- Fixed Operon Settings jumping back to the top after changing or reordering settings lower in the page.
- Fixed tapping Calendar time-grid tasks on touch devices so a short tap opens the task editor after the new long-press drag gesture.
- Fixed Calendar time-grid hour labels and the current-time marker so they follow the 12-hour or 24-hour time format setting.
- Fixed Kanban auto-collapse toggles sometimes not expanding auto-collapsed columns or swimlanes until another render happened.
- Fixed saved Kanban collapse state leaking across pipeline or swimlane grouping changes in the same preset.
- Fixed Kanban mobile layout controls not activating in the Obsidian mobile app when the coarse pointer media query is unavailable.
- Fixed Settings task and pipeline status icon pickers opening invisibly in themes that transform Obsidian settings modals.
- Fixed Task Creator floating pickers opening invisibly in themes that transform or clip Obsidian modals.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and 682/682 Phase 5 regression checks.

## [1.0.7] - 2026-05-27

### New
- Added a Completed copy option for When done recurring inline tasks, so users can replace the completed row with the next occurrence when past completed copies are not useful.
- Added Calendar touch controls for timed time-grid dragging, letting touch users enable task moves and tune long-press delay and cancel distance.

### Improved
- Improved Calendar touch dragging for timed tasks, so phone, tablet, and pen users can long-press a time-grid task and move it without changing desktop drag behavior.
- Improved Kanban on narrow touch screens by compacting swimlanes and hiding board chrome while scrolling, leaving desktop Kanban unchanged.
- Improved Calendar recurring previews so When done tasks can show future projected occurrences without backfilling overdue missed days, while matching the visual treatment of other projected timed tasks.
- Improved the Repeat picker completed-copy tooltips so they use Operon's standard hover tooltip structure and avoid covering the picker action buttons.

### Fixed
- Fixed the Calendar sidebar on phones so Calendars, Task Pool, and Finished Tasks remain reachable below the quick actions.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and the full Phase 5 regression suite at 660/660 checks.

## [1.0.6] - 2026-05-26

### New
- Added a command to convert selected list items into Operon inline tasks, including checkbox lines, Tasks emoji lines, bullets, numbered items, selected indentation-based subtask links, normal inline inheritance for top-level converted items, Tasks priority emoji handling that falls back to Operon's default priority when no priority emoji is present, and scheduled-date emoji handling that uses the configured scheduled status target.

### Improved
- Improved the Demo Workspace command reference for selection-to-task conversion, clarifying how indented selected lists become parent-child task trees.
- Improved Tasks emoji conversion so scheduled-date emoji metadata uses the configured scheduled status target in both single-line and selection conversion.

### Changed
- Demo Workspace files are now created in `Operon/Demo Workspace`, keeping bundled demo tasks separate from regular Operon task notes.

### Fixed
- Fixed Tasks emoji conversion leaving completed or cancelled emoji dates with a default workflow status; converted tasks now use the configured finished or cancelled status.
- Fixed file tasks created from selected text or a normal note line leaving Templater commands unprocessed; Operon now creates an empty target file first, runs Templater with that file as the creation context, and then writes the final file-task content before replacing the source text with the new file-task link.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and the full Phase 5 regression suite at 649/649 checks.

## [1.0.5] - 2026-05-25

### New
- Added Active File as an inline task default save location, so New Operon Task can write inline tasks into the currently active Markdown file using the configured heading keyword.
- Added Ask Every Time as an inline task default save location, so task creation surfaces can choose the target Markdown file at creation time without changing the default settings.
- Added optional auto-archiving for finished or cancelled file tasks, so completed file-task notes can move into a configured archive folder after a short safety delay.
- Added Task Editor workflow picker settings, including a Links picker row, so users can choose which workflow rows appear in the editor and reorder them without changing task metadata.
- Added a Calendar preset option and quick actions to hide future recurring occurrences, keeping planning views less crowded without hiding materialized tasks.
- Added a Calendar preset option and quick action to hide selected external calendars per preset, making crowded planning views easier to control without changing source selections.
- Added a Calendar quick action to cycle a preset's task color source from the toolbar or sidebar, with source-specific icons in the button and preset settings menus for faster visual tuning while planning.
- Added a Calendar quick action to update all external calendars from the toolbar or sidebar, so cached calendar events can be refreshed without opening settings.

### Improved
- Clarified Operon's vault, clipboard, and external calendar data behavior in the README, so users can understand Community Plugin scorecard disclosures more easily.

### Changed
- Moved external calendar visibility from source-level enablement to Calendar preset controls, while preserving previously disabled sources as hidden until they are selected in a preset.

### Fixed
- Fixed Kanban search clearing from the toolbar clear button leaving the board narrowed to the previous search results.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and the full Phase 5 regression suite at 642/642 checks.

## [1.0.4] - 2026-05-24

### New
- Added optional icons to pipeline statuses, so each workflow state can be prepared with its own visual marker in the pipeline settings.
- Added a fallback icon source setting for task state icons, allowing tasks without a taskIcon to use pipeline status icons before falling back to Open, Finished, or Cancelled icons.
- Added optional icons to priorities and a Priority icons fallback source, so tasks without a taskIcon can use priority-specific visuals before falling back to state icons.
- Added a File Task Migration tool, so existing notes can be converted into Operon file tasks by folder, tag, or property match with a review preview, live conversion progress, stale-scan protection, and a confirmation step.

### Improved
- Improved File Task settings organization by separating Daily notes from Excluded folders, making the daily-note task toggle read as its own section.

### Fixed
- Fixed Calendar inline task creation requiring the Daily Notes core plugin, so users who save inline tasks to a Specific File can create calendar tasks even when Daily Notes is disabled.
- Fixed user-owned `Related` frontmatter being hidden or treated as an Operon key mapping by retiring the unused related task-field mapping.

### Validation
- Local validation passed `npm run check:local`, including strict linting, production build, release guard, and the full Phase 5 regression suite at 619/619 checks.

## [1.0.3] - 2026-05-23

### New
- Added a Links task field, picker, and optional chips for storing and reusing multiple external web links on inline and file tasks, supporting raw URLs and named Markdown links.
- Added manual Kanban ordering per preset, so cards can keep a drag-defined order inside each board cell while new cards append naturally and duplicated presets preserve their saved order.
- Added Daily ToDo and Last Seven Days Open as default saved filters for new Operon setups, giving first-time users useful task views immediately.
- Added an Operon demo workspace for new users, with a first-run prompt and Settings button that create the Basics project with benefit notes on each task, a command reference note, a realistic setup project, reusable filters, and initialized parent totals without overwriting user edits.

### Improved
- Improved Tasks emoji line conversion so priority emojis now map into the user's ordered Operon priorities instead of being preserved only as leftover notes.
- Improved Calendar time grid scale settings with smaller 0.25x and 0.50x options for denser timed planning views.
- Improved Date Picker and DateTime Picker suggestions with compact aligned rows, making quick dates easier to scan without clipped bottom entries.
- Improved task chip customization with optional start and end time chips that show only the clock icon and time.
- Improved Kanban boards with No swimlane selected by hiding the unused swimlane column, giving status columns more room.
- Improved Kanban preset sorting controls with clearer spacing before the appearance settings, making the preset editor easier to scan.

### Changed
- Daily Notes targets now follow the date format configured in Obsidian's Daily Notes core plugin, including custom Moment-style formats such as dotted dates, nested year/month folders, and weekday names.
- Task Editor date fields now use canonical date labels and compact time-only datetime labels while keeping field icons visible after selection.

### Fixed
- Fixed Calendar navigation date buttons showing today's date while another date is focused, so they now display the focused date while still jumping back to today when clicked.
- Fixed Task Chips settings jumping back to the top after toggling chip visibility or display controls.
- Fixed No swimlane Kanban boards hiding cards when an old hidden swimlane collapse state was still saved.
- Fixed Kanban inline task creation ignoring the configured inline task save location, so Kanban-created inline tasks now respect Specific File and Daily Notes modes.
- Fixed numeric settings inputs snapping back while editing, so values such as Kanban expanded column width can be deleted and retyped normally before saving.

### Validation
- Local maintainer validation passed `npm run check:local`, including strict linting, production build, release guard, and the full Phase 5 regression suite at 595/595 checks.

## [1.0.2] - 2026-05-20

### Fixed
- Restored compact inline chip sizing after the Obsidian CSS lint-safe reset changes and added release guard coverage for the lint-sensitive CSS patterns that caused the regression.

## [1.0.1] - 2026-05-20

### Fixed
- Cleaned Obsidian CSS lint warnings by replacing broad resets, text-decoration subproperties, multicolumn-triggering gap declarations, `display: contents`, duplicate declarations, and duplicate selectors with release-safe CSS.
- Normalized the `LICENSE` file to the standard GPLv3 text so GitHub can recognize the repository license while keeping project metadata on `GPL-3.0-or-later`.

## [1.0.0] - 2026-05-20

### Added
- Initial public release of Operon, a task management system for humans and agents in Obsidian.
- Added inline task and file task workflows with configurable fields, priorities, pipelines, filters, and task creation defaults.
- Added Task Creator and Task Editor flows for creating, editing, scheduling, linking, and organizing tasks.
- Added Calendar and Kanban views for planning tasks across time-based and workflow-based surfaces.
- Added pinned tasks, contextual task actions, Live Preview controls, Reading View controls, and compact task metadata displays.
- Added recurrence support for materialized recurring tasks, repeat-series state, and recurring file-task behavior.
- Added time tracking, FlowTime, status bar controls, and session history.
- Added optional external calendar source support with cached calendar rendering.

### Reliability
- Strengthened task write safety around dependency updates, parent-child task links, YAML/file-task preservation, indentation-preserving inline writes, and duplicate `operonId` conflicts.
- Improved `.operon` persistence durability with malformed store recovery, safer queued writes, unload flushing, repeat-series serialization, and external calendar cache guards.
- Hardened Calendar, Kanban, Live Preview, and Reading View surfaces against stale callbacks, orphan floating panels, preview cleanup leaks, empty preset recovery, and compact layout clipping.
- Reworked settings organization into a primary tab and subtab structure with Obsidian-native controls, accessible card shells, and release-ready settings navigation.
- Added a final settings accessibility cleanup for tab keyboard semantics, Workflow editor control names, and Kanban sort-rule controls.
- Expanded i18n and release hygiene checks for command labels, Kanban labels, time history labels, locale parity, package metadata, release assets, and acceptance docs.

### Compatibility and optional integrations
- Requires Obsidian 1.7.2 or newer.
- Uses Obsidian Daily Notes configuration for Calendar inline task insertion and Daily Note parent workflows when enabled.
- Uses Obsidian's hover-link/Page Preview event flow for modifier-hover task and chip previews.
- Optionally integrates with Templater when file task or Daily Notes templates contain Templater syntax.
- Optionally uses Natural Language Dates (`nldates-obsidian`) for date picker parsing, with built-in fallback parsing when unavailable.
- Supports external calendar sources through ICS parsing via `ical.js`.

### Release validation
- Public validation passes with ESLint at 0 warnings and 0 errors.
- `npm run check:local` passes locally, including strict linting, production build, release guard, and Phase 5 regression validation.
- Local maintainer regression validation passes Phase 5 at 567/567.
- Release guard validates package, manifest, lockfile, release assets, acceptance docs, and audited raw-string surfaces.
- `npm audit` reports 0 vulnerabilities.
- `node --check main.js` passes for the generated runtime.
- Added `versions.json`, CI, CodeQL, and semver-tag release automation for community plugin submission.

### Notes
- This is Operon's first public release history entry.
- Earlier internal development history is intentionally not included in the public changelog.
- Community plugin release assets are limited to `main.js`, `manifest.json`, and `styles.css`.
