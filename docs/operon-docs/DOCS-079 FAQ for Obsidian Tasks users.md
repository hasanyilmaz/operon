---
Up:
  - "[[DOCS-077 Welcome - coming from Obsidian Tasks|Coming from Obsidian Tasks]]"
  - "[[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]]"
  - "[[DOCS-025 Filter View|Filter View]]"
Notes: Common questions from users moving off the Obsidian Tasks plugin
Icon: circle-question-mark
Color: "#2563eb"
tags:
  - operon
  - faq
  - tasks
  - migrate
Updated: 2026-06-25T16:47:21
---

# FAQ for Obsidian Tasks users

The questions Obsidian Tasks users ask most when they try Operon, with the short answer and a link to the full page. For the step-by-step move, start with [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]].

## Migrating

**Do I have to convert everything at once?** No. Convert a line, a selection, or a note whenever you meet it. Unconverted lines keep working as Obsidian Tasks. See [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]].

**Will my recurrence survive?** Yes. A 🔁 rule converts into Operon's `repeat` field, so repeating tasks keep repeating. See [[DOCS-033 Recurring tasks|Recurring tasks]].

**What happens to my emoji?** On a converted line, emoji metadata becomes Operon fields (`📅`→`dateDue`, `⏳`→`dateScheduled`, priority emoji→your `priority`, and so on) and the line is rewritten as an inline task. Lines you have not converted are left untouched.

**Can I convert a whole outline?** Yes. Select it and run **Convert Selection to Operon Tasks**; indentation becomes parent and child tasks. See [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

## Running both plugins

**Can I keep Obsidian Tasks installed while I move?** Yes, and it stays low-friction because the two use different inline formats. Operon treats a line as its own only when the line carries Operon fields (`{{key:: value}}`) or an `operonId`, so it leaves your Tasks emoji lines alone, and your ` ```tasks ` query blocks keep rendering through the Tasks plugin. Move at your own pace.

**Should one line use both formats?** No. Keep each line in a single format. A line that mixes Operon fields with Tasks emoji is treated as a hybrid and is not converted, so convert a line fully rather than half. See [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]].

**Why does a line show rendering from both plugins?** Both add their own rendering to ` - [ ] ` checkbox lines, so a line that carries both formats can show both. Convert it into a single Operon inline task to settle it.

**Does Operon read my ` ```tasks ` blocks?** No. Operon does not render Tasks query blocks. Use the [[DOCS-025 Filter View|Filter View]] for lists, and embed a saved filter in a note with an ` ```operon ` block when you want a list inside a note. See [[DOCS-083 Embed a filter in a note|Embed a filter in a note]].

## Differences that surprise people

**Why does each task have an `operonId`?** It is the durable identity that lets the same task appear in filters, the Calendar, and the Kanban without becoming a new task. Do not edit or copy it. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

**How do statuses work?** Operon tasks move through a pipeline of statuses, which is what powers the Kanban. You can still complete a task in one action. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

**My priorities look different.** Tasks priority emoji map to your configured Operon priority levels by rank, so they follow your own scheme rather than a fixed set. See [[DOCS-038 Task priorities|Task priorities]].

## Safety

**If I uninstall Operon, do I lose my tasks?** No. Converted tasks are plain Markdown lines with an `operonId`; they remain as text. You lose the views and automation, not the tasks. See [[DOCS-045 Markdown task storage|Markdown task storage]].

**My Filter View is empty after install.** That is normal. Views show Operon tasks, so convert a few lines and they will appear.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
