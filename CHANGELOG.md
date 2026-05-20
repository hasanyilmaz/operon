# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
