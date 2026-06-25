---
Up:
  - "[[DOCS-021 Task Editor|Task Editor]]"
  - "[[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]]"
  - "[[DOCS-054 Missing tasks|Missing tasks]]"
Notes: Operon's context-aware commands
Icon: terminal
Color: "#475569"
tags:
  - operon
  - commands
Updated: 2026-06-25T16:47:21
---

# Command palette reference

Almost everything Operon does has a command in Obsidian's command palette. Open the palette and type `Operon` to see them. This page lists the commands by purpose.

Many commands are **context-aware**: the same command behaves differently depending on where you run it, such as on selected text, an empty line, an inline task, a normal note, a file task, or a task view. The descriptions below note when that matters.

This page is the index. The action commands link to a dedicated page with their full behavior; the view and feature commands link to the feature they open.

> **MEDIA-DOCS-022-1:** The command palette filtered to Operon, showing the available commands.

![MEDIA-DOCS-022-1 - Command palette filtered to Operon](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-022-1.png)

## Create tasks

- **[[DOCS-084 Create New Operon Task|Create New Operon Task]]**: opens the full [[DOCS-020 Task Creator|Task Creator]]. The safest starting point when you want Operon to guide you through the fields.
- **[[DOCS-085 Create or edit inline task|Create or edit inline task]]**: context-aware. On an empty line it creates a task; on plain text or a checkbox it converts or upgrades the line; on an existing task it opens the [[DOCS-021 Task Editor|Task Editor]].
- **[[DOCS-086 Create file task|Create file task]]**: creates a task that lives as its own note, optionally seeded from selected text or an inline task. See [[DOCS-013 File tasks|File tasks]].

## Edit and convert

- **[[DOCS-087 Edit or convert to file task|Edit or convert to file task]]**: edits the current file task, or converts a normal note into one.
- **[[DOCS-088 Convert file task to inline task|Convert file task to inline task]]**: collapses a file task back into a single inline task, then moves the old note to the Obsidian trash. See [[DOCS-019 Converting inline and file tasks|Converting inline and file tasks]].
- **Convert Tasks emoji line to inline task**: migrates a line written in the Obsidian Tasks emoji format into an Operon inline task. See [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]].
- **Convert Selection to Operon Tasks**: turns several selected lines into tasks at once. See [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

## Find and move

- **Task Finder**: search and jump to any task across the vault. See [[DOCS-027 Task Finder|Task Finder]].
- **[[DOCS-089 Move an inline task here|Move an inline task here]]**: picks a task with Task Finder and moves it to the current cursor line.

## State and time

- **[[DOCS-090 Toggle task completion|Toggle task completion]]**: completes or reopens the task at the cursor.
- **Start/stop time tracker**: starts or stops the timer on the task at the cursor. See [[DOCS-034 Time tracking|Time tracking]].

## Open views

- **Operon Filter View**: filtered, saved task lists. See [[DOCS-025 Filter View|Filter View]].
- **Operon Calendar**: scheduled and timed tasks on a calendar. See [[DOCS-028 Calendar overview|Calendar overview]].
- **Operon Kanban**: tasks as cards in workflow columns. See [[DOCS-030 Kanban overview|Kanban overview]].
- **Toggle Pinned Tasks dock** / **Open Pinned Tasks**: the floating dock or the side panel of pinned tasks. See [[DOCS-032 Pinned Task Dock|Pinned Task Dock]].
- **Open Time Session History panel**: review and edit tracked sessions. See [[DOCS-053 Time session history|Time session history]].
- **Open FlowTime panel**: start a focused work session. See [[DOCS-035 FlowTime focus sessions|FlowTime focus sessions]].

## Maintenance

- **[[DOCS-091 Rebuild full index|Rebuild full index]]**: re-scans the vault for tasks. Use it when tasks are missing or a file was edited outside Obsidian. See [[DOCS-054 Missing tasks|Missing tasks]].
- **Reload Operon settings from storage**: reloads Operon settings from disk.
- **[[DOCS-092 Show index stats|Show index stats]]**: a quick count of total, open, due-today, and overdue tasks.
- **Open duplicate operonId manager**: resolves tasks that share the same `operonId`. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].
- **Update External Calendars**: refreshes configured external calendar sources. See [[DOCS-048 External calendars|External calendars]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
- [[DOCS-004 Operon system map|Operon system map]]
