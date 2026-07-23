---
Notes: Tasks are plain Markdown, and what that means in practice
Icon: file-text
Color: "#0891b2"
Updated: 2026-07-23T16:45:34
---

# Markdown task storage

Operon stores tasks as Markdown, in your notes. There is no separate task database that the files mirror; the file is the task. This page is what that means in practice, and why it is worth knowing.

## The file is the source of truth

An inline task is a checkbox line carrying `{{key:: value}}` fields. A file task is a note whose frontmatter holds the same fields. In both cases the Markdown is where the task actually lives. Operon reads it, and when you change a task through a view, the editor, or a drag on the Calendar, Operon writes the change back to that Markdown. See [[DOCS-011 Inline tasks|Inline tasks]] and [[DOCS-013 File tasks|File tasks]].

## The index is derived, not the source

Operon keeps an index so it can show your tasks quickly across filters, the Calendar, and the Kanban. The index is built from your Markdown; it is a cache, not the truth. If it is ever out of date, you can rebuild it from the notes with **Rebuild full index**, and nothing is lost because the notes hold everything. See [[DOCS-054 Missing tasks|Missing tasks]].

## What plain-text storage gives you

Because tasks are Markdown files, ordinary tools work on them:

- **Version control and diffs.** A task change is a text change you can see in git or any diff.
- **Backups and sync.** Tasks back up and sync as the text files they are. See [[DOCS-047 Sync conflict safety|Sync conflict safety]].
- **Readable without Operon.** An inline task still reads as a Markdown checkbox if Operon is off; the metadata shows as text. A file task is still a note.
- **Editable by hand or by an agent.** The same text is open to a careful manual edit or an [[DOCS-036 Agent-friendly workflows|agent]].

## The one field to respect

The metadata is visible because the task is stored in Markdown, but `operonId` is the task's identity and should not be hand-edited or copied. Change the text freely; leave the identity to Operon. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

## FAQ

**Where exactly is a task stored?** In the note where you see it: the inline line, or the file task's frontmatter. Nowhere else.

**Does Operon keep a separate copy of my tasks?** Only a derived index for speed, which it can rebuild from the notes at any time.

**Can I edit a task's Markdown directly?** Yes. Just be careful with `operonId`. The editor is safer for structural changes.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
