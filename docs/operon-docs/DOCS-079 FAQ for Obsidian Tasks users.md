---
Notes: Common questions from users moving off the Obsidian Tasks plugin
Icon: circle-question-mark
Color: "#2563eb"
Updated: 2026-10-13T16:53:09+02:00
---

# FAQ for Obsidian Tasks users

The questions Obsidian Tasks users ask most when they try Operon, with the short answer and a link to the full page. For the step-by-step move, start with [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]].

## Migrating

**Do I have to convert everything at once?** No. Convert a line, a selection, or a note whenever you meet it. Unconverted lines keep working as Obsidian Tasks. See [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]].

**Will my recurrence survive?** Supported 🔁 rules convert into Operon's `repeat` field. Unsupported expressions may be preserved as information in Note rather than active recurrence; inspect notices and the converted task. See [[DOCS-033 Recurring tasks|Recurring tasks]].

**What happens to my emoji?** On a converted line, emoji metadata becomes Operon fields (`📅`→`dateDue`, `⏳`→`dateScheduled`, priority emoji→your `priority`, and so on) and the line is rewritten as an inline task. Lines you have not converted are left untouched.

**Can I convert a whole outline?** Yes. Select it and run **Convert Selection to Operon Tasks**; indentation becomes parent and child tasks. See [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

**Can I convert several folders?** Yes. Use [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]] in Inline Tasks settings, select the scope, Scan, review, and confirm. It converts eligible Tasks emoji lines; plain checkboxes remain unchanged. Unlike list selection commands, bulk conversion does not create parents from indentation or inherit fields from a containing File Task.

**Can each folder use a different template?** Use separate batches: choose the Inline default, select one group, Scan and convert, then change the default and scope and Scan again. One batch uses one default template. Supported source emoji fields override conflicting template defaults. See [[DOCS-150 Using inline task templates|Using inline task templates]].

**Why must I scan again?** The prepared bulk result belongs to the source, template, settings, and scope it read. Changes require a fresh Scan; a stale result must not overwrite current sources.

**Can I review a task before conversion?** Enable **Open Task Creator before conversion**, off by default, under **Tasks → Inline Tasks → Checkbox Conversion**. It affects both Live Preview conversion icons only. Commands and bulk conversion do not open Creator per task. Cancelling Creator leaves the source unchanged.

## Running both plugins

**Can I keep Obsidian Tasks installed while I move?** Yes, and it stays low-friction because the two use different inline formats. Operon treats a line as its own only when the line carries Operon fields (`{{key:: value}}`) or an `operonId`, so it leaves your Tasks emoji lines alone, and your ` ```tasks ` query blocks keep rendering through the Tasks plugin. Move at your own pace.

**Should one line use both formats?** No. Keep each line in a single format. A line that mixes Operon fields with Tasks emoji is treated as a hybrid and is not converted, so convert a line fully rather than half. See [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]].

**Why does a line show rendering from both plugins?** Both add their own rendering to ` - [ ] ` checkbox lines, so a line that carries both formats can show both. First separate the mixed metadata; a hybrid line is not eligible for automatic conversion. Then use one format consistently.

**Does Operon read my ` ```tasks ` blocks?** No. Operon does not render Tasks query blocks. Use the [[DOCS-025 Filter View|Filter View]] for lists, and embed a saved filter in a note with an ` ```operon ` block when you want a list inside a note. See [[DOCS-083 Embed a filter in a note|Embed a filter in a note]].

## Differences that surprise people

**Why does each task have an `operonId`?** It is the durable identity that lets the same task appear in filters, the Calendar, and the Kanban without becoming a new task. Do not edit or copy it. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

**How do statuses work?** Operon tasks move through a pipeline of statuses, which is what powers the Kanban. You can still complete a task in one action. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

**My priorities look different.** Tasks priority emoji map to your configured Operon priority levels by rank, so they follow your own scheme rather than a fixed set. See [[DOCS-038 Task priorities|Task priorities]].

## Safety

**If I uninstall Operon, do I lose my tasks?** No. Converted tasks are plain Markdown lines with an `operonId`; they remain as text. You lose the views and automation, not the tasks. See [[DOCS-045 Markdown task storage|Markdown task storage]].

**What if bulk conversion is interrupted?** Resolve the recovery state before another batch. **Check again** rechecks evidence; **Restore original sources** requires current files and identities to pass safety checks. **Complete conversion** keeps a result only when all recorded sources are already converted; it does not resume partial conversion. Preserve evidence if later edits prevent recovery. See [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]].

**Can I undo a completed migration from that page?** Recovery is for unresolved bulk operations, not permanent Undo. Keep backups before large migrations. A settings backup is not a backup of task notes.

**Tasks converted, but views are stale—should I convert again?** No. Use **Retry view refresh** when offered. **Retry cleanup** addresses pending recovery cleanup without converting sources again.

**My Filter View is empty after install.** That is normal. Views show Operon tasks, so convert a few lines and they will appear.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
