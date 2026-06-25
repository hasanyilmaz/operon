---
Up:
  - "[[DOCS-003 Getting started with Operon|Getting started with Operon]]"
  - "[[DOCS-009 Create your first task|Create your first task]]"
  - "[[DOCS-017 Plain checkbox lists|Plain checkbox lists]]"
Notes: Start Operon from scratch or from the plain checkboxes you already write
Icon: list-checks
Color: "#2563eb"
tags:
  - operon
  - start
  - newuser
  - checkboxes
Updated: 2026-06-25T16:47:21
---

# Welcome: new to tasks or plain checkboxes

This page is for two people who turn out to need almost the same start: someone brand new to task management in Obsidian, and someone who already scatters plain Markdown checkboxes (`- [ ]`) through their notes. Either way, you do not have a previous task plugin to migrate from, so your first move is simple: make one Operon task, or upgrade a checkbox you already wrote.

> **MEDIA-DOCS-076-1:** A plain checkbox line and the Operon inline task it becomes after one command.

![MEDIA-DOCS-076-1 - Plain checkbox converted to Operon inline task](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-076-1.png)

## The one idea to hold

Operon keeps your tasks as plain text in your notes and adds structure on top. A task can take one of two shapes: an [[DOCS-011 Inline tasks|inline task]] (a single line, the light option) or a [[DOCS-013 File tasks|file task]] (a whole note that is itself a task, for work that needs room). You start with inline and grow into file tasks only when a task earns it. That is the whole model, explained in [[DOCS-072 One workflow, two task shapes|One workflow, two task shapes]].

## If you are brand new

Make one task and see it in one view. That is enough to be using Operon.

1. **Make a task.** Run **Create New Operon Task** for a guided form, or **Create or edit inline task** on an empty line to write one in place. See [[DOCS-009 Create your first task|Create your first task]].
2. **Give it a date or a priority.** Just enough so a view can sort it. You can skip this and add it later.
3. **See your tasks together.** Open the [[DOCS-025 Filter View|Filter View]] and build one saved filter, like "open tasks this week." See [[DOCS-010 Build your first filtered view|Build your first filtered view]].

That is the loop: capture, then look at the set. Add the Calendar, Kanban, recurrence, and time tracking when the work asks for them, not before.

## If you already use plain checkboxes

You are closer than you think. A plain checkbox is already a task in spirit; Operon just needs to adopt it so it can be filtered, scheduled, and tracked. Adoption adds a small `operonId` and any fields you want, and the line stays readable.

- **Upgrade one line.** Put your cursor on a `- [ ]` line and run **Convert checkbox to Operon task**, or **Create or edit inline task**, and the checkbox becomes an Operon inline task. Operon can also show a small square-plus icon on hover over upgradable checkbox lines in Live Preview, so you can convert with a click.
- **Bring a whole list over.** Select several checkbox lines and run **Convert Selection to Operon Tasks**. Indented lines become parent and child tasks, so an outline keeps its shape. See [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].
- **Keep the rest as they are.** Plain checkboxes that you have not upgraded still work as normal Markdown. Operon leaves them alone until you adopt them. See [[DOCS-017 Plain checkbox lists|Plain checkbox lists]].

## No migration weekend

You do not have to convert everything at once. A freshly upgraded vault shows Operon tasks in views only after you adopt them, so the [[DOCS-025 Filter View|Filter View]] may look empty until you convert your first lines. That is expected. Convert the next useful checkbox when you meet it, and your filtered views fill up naturally over a few days.

## Where to go next

- Plan by date: [[DOCS-028 Calendar overview|Calendar overview]].
- Move work by stage: [[DOCS-030 Kanban overview|Kanban overview]].
- Make a task repeat: [[DOCS-033 Recurring tasks|Recurring tasks]].

## FAQ

**Do I have to upgrade every checkbox?** No. Upgrade the ones you want Operon to manage; leave the rest as plain Markdown.

**Will adopting a checkbox change my note?** It adds a small `operonId` and any fields you set, on the same line. The text stays readable.

**My Filter View is empty.** That is normal at the start. Views show Operon tasks, so convert a few lines first and they will appear.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
