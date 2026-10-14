---
Notes: Common questions across Operon, with links to the full answers
Icon: circle-question-mark
Color: "#dc2626"
Updated: 2026-10-13T17:01:21+02:00
---

# Operon FAQ

The questions that come up most, grouped, with a link to the page that answers each in full. If you are stuck, start here, then follow the link.

## Getting started

**What is Operon, in one line?** A task and project management system that unifies inline tasks and file-based tasks in the same workflows, with filters, Calendar planning, Kanban boards, recurrence, pinned tasks, and time tracking, all inside your vault's Markdown. See [[DOCS-003 Getting started with Operon|Getting started with Operon]].

**What is the least I need to learn?** One task and one view. See [[DOCS-009 Create your first task|Create your first task]] and [[DOCS-010 Build your first filtered view|Build your first filtered view]].

**Do I have to use every view and feature?** No. Operon scales down to a plain, minimal setup, and unused features write nothing into your notes. See [[DOCS-102 Do you need to use all of Operon|Do you need to use all of Operon?]].

**Does it work on mobile?** Yes. Some views are roomier on desktop, but mobile is supported. See [[DOCS-007 Install and enable Operon|Install and enable Operon]].

## Tasks

**Inline task or file task?** Start inline; promote to a file task when the work needs its own note. See [[DOCS-014 Inline vs file tasks|Inline vs file tasks]].

**What is the `operonId`?** A task's durable identity, so the same task stays recognizable everywhere. Do not edit or copy it. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

**How do I make a task repeat?** Add a recurrence rule, easiest through the Task Editor. See [[DOCS-033 Recurring tasks|Recurring tasks]].

**How do I break a task down?** Plain checkboxes for quick steps, subtasks for real work. See [[DOCS-017 Plain checkbox lists|Plain checkbox lists]] and [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

## Views and planning

**Calendar or Kanban?** Plan by date on the Calendar, by stage on the Kanban. See [[DOCS-028 Calendar overview|Calendar overview]] and [[DOCS-030 Kanban overview|Kanban overview]].

**How do I find one task fast?** Use Task Finder. See [[DOCS-027 Task Finder|Task Finder]].

**How do I see only what matters now?** Build and save a filter. See [[DOCS-025 Filter View|Filter View]].

## Data and sync

**Where are my tasks stored?** In your Markdown notes; nothing on a server. See [[DOCS-044 Where Operon stores data|Where Operon stores data]].

**If I uninstall Operon, do I lose my tasks?** No. They are Markdown in your notes; you lose only the views and settings. See [[DOCS-045 Markdown task storage|Markdown task storage]].

**Is it safe to sync across devices?** Yes, with care. Identity keeps tasks distinct, and the conflict manager resolves duplicates. See [[DOCS-047 Sync conflict safety|Sync conflict safety]].

**Do I need to reindex after updating?** Normally no. The first startup without the new layout automatically builds its cache from current notes. Later startups reuse a valid cache and reconcile changes. A one-time slower opening is different from repeated rebuilding. See [[DOCS-046 Plugin data and state files|Plugin data and state files]].

**Are Vault Properties indexed too?** Yes. They share the persistent task index with canonical and mapped custom fields, for File and Inline tasks. Markdown remains authoritative; editability still depends on a supported, verified type. See [[DOCS-115 File task property columns|Vault Properties]].

**What if the cache is corrupt or from an unsupported version?** Inspect **Index diagnostics** and use its guarded repair path when appropriate. A normal rebuild does not force an unsafe overwrite. Do not delete operational state or recovery evidence to bypass the check. See [[DOCS-091 Rebuild full index|Rebuild full index]].

## Customization

**Can I rename Operon's property names?** Yes, for file-task frontmatter, through key mappings. See [[DOCS-039 Key mappings|Key mappings]].

**Can I add my own field?** Yes. Use a configured Custom key or supported Vault Property, depending on the behavior you need. See [[DOCS-018 Task properties|Task properties]] and [[DOCS-115 File task property columns|Vault Properties]].

**Can I change the statuses and priorities?** Yes, both are yours to define. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]] and [[DOCS-038 Task priorities|Task priorities]].

**I cannot find a setting.** Search Obsidian's settings; Operon's are registered there. See [[DOCS-043 Settings search|Settings search]].

## When something looks wrong

**A task is not showing up.** Check the source, view filters, exclusions, duplicate identities, and index readiness. Rebuild only when the index remains stale. See [[DOCS-054 Missing tasks|Missing tasks]].

**A task looks wrong on the Calendar or Kanban.** Often a missing date or a status that does not match the pipeline. See [[DOCS-056 Calendar or Kanban rendering issues|Calendar or Kanban rendering issues]].

**Two tasks share an id.** The Operon ID Conflict manager resolves it. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].

## Working with an assistant

**Can an AI agent work with my tasks?** Yes, because the data is plain, identified, and consistent. The key rule is to read your key mappings first. See [[DOCS-036 Agent-friendly workflows|Agent-friendly workflows]].

**Can I hand these docs to an assistant?** Yes. Every page is plain text that stands on its own. See [[DOCS-002 How to use these docs|How to use these docs]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-006 Glossary of Operon terms|Glossary of Operon terms]]
