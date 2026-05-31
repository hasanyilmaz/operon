# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Validation

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
