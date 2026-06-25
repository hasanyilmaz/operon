---
Up:
  - "[[DOCS-025 Filter View|Filter View]]"
  - "[[DOCS-013 File tasks|File tasks]]"
  - "[[DOCS-028 Calendar overview|Calendar overview]]"
Notes: Look back at finished work and keep completed tasks tidy
Icon: list-checks
Color: "#4f46e5"
tags:
  - operon
  - review
  - completion
Updated: 2026-06-25T16:47:21
---

# Completed task review

Finishing a task is not quite the end of it. Completed work is worth reviewing (what got done this week, what a project actually delivered) and worth tidying, so done tasks do not clutter the views you use for active work. Operon records when each task finished and gives you a few ways to look back and clean up.

## What gets recorded

When a task reaches a finished status, Operon sets its `dateCompleted`; a cancelled task gets `dateCancelled` instead. These dates are what make review possible: they let you ask "what did I complete, and when," rather than just "what is left." See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

## Ways to look back

Completed work shows up across the surfaces you already use:

- **Filter View**: build a filter for finished tasks, or for tasks completed in a date range, to get a clean list of what got done. This is the everyday review surface. See [[DOCS-025 Filter View|Filter View]].
- **Calendar**: completed tasks appear on their `dateCompleted`, and the Calendar sidebar has a **Finished Tasks** section, so you can see done work in time. See [[DOCS-028 Calendar overview|Calendar overview]] and [[DOCS-060 Calendar layout toolbar and sidebar|Calendar layout: toolbar and sidebar]].
- **Task Finder**: turn on **Include finished tasks** to search work you have already closed. See [[DOCS-027 Task Finder|Task Finder]].

For reviewing the time you spent, rather than the tasks you closed, see [[DOCS-053 Time session history|Time session history]].

## Keeping completed work tidy

Finished tasks do not have to pile up in your active space:

- **Archive file tasks.** Operon can automatically move finished or cancelled [[DOCS-013 File tasks|file tasks]] to an archive folder after a delay, so completed notes leave your working folders without being deleted. The archive folder and delay are yours to set.
- **Auto-unpin finished tasks.** The [[DOCS-032 Pinned Task Dock|Pinned Task Dock]] can drop a task automatically when it reaches a finished or cancelled state, so your pinned set stays current.

Nothing is destroyed by these. Completed tasks keep their record and their tracked time; they just move out of the way.

## FAQ

**How do I list everything I finished this week?** Filter for finished tasks completed in the last seven days. The Filter View is the place for this.

**Do completed tasks get deleted?** No. They are kept, and file tasks can be archived to a folder rather than removed.

**Where do archived file tasks go?** To your configured archive folder, by default an Operon archive folder, after the delay you set.

## Settings

Operon settings for archiving live in **Settings → Operon → Tasks → File Tasks**, under Archive Finished/Cancelled File Tasks: the archive folder, the delay, and whether to limit archiving to the file-tasks folder. Auto-unpin is in the Pinned Dock settings.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
