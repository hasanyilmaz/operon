---
Notes: Convert Obsidian Tasks emoji lines into Operon inline tasks, with a before and after example
Icon: move-right
Color: "#2563eb"
Updated: 2026-10-13T16:53:09+02:00
---

# Obsidian Tasks migration

If you have used the Obsidian Tasks plugin, your task lines carry metadata as emoji, like a due date marked with a calendar emoji. Operon can convert those lines into its own inline tasks, individually, in a selection, or across selected files and folders, so you can move across without rewriting your notes by hand. You do not need a migration weekend; convert lines as you meet them.

> **MEDIA-DOCS-049-1:** A Tasks emoji line and the Operon inline task it becomes after conversion.

![MEDIA-DOCS-049-1 - A Tasks emoji line and the Operon inline task it becomes after conversion](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-049-1.png)

## Convert a line

Put your cursor on an Obsidian Tasks emoji line and run **Convert Tasks emoji line to inline task** from the command palette. Operon reads the emoji metadata, maps it to the matching Operon fields, and rewrites the line as an Operon inline task with an `operonId`. See [[DOCS-012 Inline task syntax|Inline task syntax]] for what the result looks like.

A Tasks emoji line, with a scheduled date and a due date:

```md
- [ ] Draft release notes ⏳ 2026-05-20 📅 2026-05-31
```

becomes an Operon inline task. This shortened example shows the mapped dates; configured defaults, template properties, and bookkeeping may add other fields:

```md
- [ ] Draft release notes {{operonId:: {{operonId}}}} {{dateScheduled:: 2026-05-20}} {{dateDue:: 2026-05-31}}
```

The `operonId` is a real id Operon generates during the conversion; it is shown here as the `{{operonId}}` template variable. The same mapping applies to the other Tasks markers: 🛫 becomes `dateStarted`, ✅ `dateCompleted`, ❌ `dateCancelled`, the priority emoji (🔺 ⏫ 🔼 🔽 ⏬) becomes a `priority` on your scale, and supported recurrence after the 🔁 marker becomes a `repeat` rule. See [[DOCS-038 Task priorities|Task priorities]] and [[DOCS-033 Recurring tasks|Recurring tasks]].

## Convert checkboxes in a mixed selection

Select a continuous range and run **Convert Checkboxes in Selection to Operon Tasks** to convert supported Tasks emoji lines and normal checkboxes together. Plain bullets, numbered items, and other note content stay unchanged. The same emoji mapping applies, and existing Operon tasks are not converted again. See [[DOCS-023 Create tasks from selected text|Create tasks from selected text]] for selection and parent rules.

## Convert from the hover icon

So you do not have to remember the command, Operon can show a small convert icon on hover over a Tasks emoji line. With the icon enabled, hovering a convertible line offers conversion in Live Preview. By default it converts directly. Enable **Open Task Creator before conversion** under **Tasks → Inline Tasks → Checkbox Conversion** to review the description, source fields, and template before replacing the line. This option starts off and applies to both the Tasks emoji and plain-checkbox conversion icons, not commands or bulk conversion. This makes migrating a note as simple as reading through it and clicking the lines you want to bring over.

> **MEDIA-DOCS-049-2:** The convert icon appearing on hover over a Tasks emoji line in Live Preview.

![MEDIA-DOCS-049-2 - The convert icon appearing on hover over a Tasks emoji line in Live Preview](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-049-2.png)

## Choose the right conversion path

| Path | Scope | Review and parent behavior |
| --- | --- | --- |
| **Convert Tasks emoji line to inline task** | One eligible Tasks emoji line | Direct conversion; existing checkbox-owner and File Task parent rules apply |
| **Convert Checkboxes in Selection to Operon Tasks** | Supported plain and Tasks emoji checkboxes in a selection | Direct conversion; applicable ownership and indentation rules can link parents |
| **Convert Selection to Operon Tasks** | Supported checkboxes, bullets, and numbered items | Direct conversion; applicable list hierarchy can link parents |
| Live Preview conversion icons | One eligible Tasks emoji line or plain checkbox | Optional Creator review; cancellation leaves the source unchanged |
| **Tasks bulk conversion** in Settings | Eligible Tasks emoji lines in selected files/folders | Scan and confirm; no per-task Creator; tasks remain independent |

Creator review opens in Inline mode and replaces the original line in place after successful submission. It lets you choose another template and edit supported fields, including empty template properties. A changed source prevents stale replacement; reopen from the current source. See [[DOCS-020 Task Creator|Task Creator]].

## Templates and source metadata

**Default inline task template**, under **Tasks → Inline Tasks**, supplies supported properties to these Inline creation/conversion paths. The template body is not copied and Templater does not run. Explicitly mapped source emoji fields take precedence over conflicting template defaults; review any notices about skipped properties. Select **None** when you do not want a template; normal task defaults still apply.

The separate **Use last used template as default** option learns after successful Creator creation, including the reviewed icon path. Direct commands and bulk conversion consume the saved default but do not open a picker or learn a new choice themselves. Check the current default before a migration batch. See [[DOCS-150 Using inline task templates|Using inline task templates]].

Supported metadata becomes active Operon fields. Unsupported metadata may be retained as information in Note rather than active behavior. Check conversion notices and the resulting task, especially for recurrence and dependency expressions.

## Convert files or folders

Open **Settings → Operon → Tasks → Inline Tasks → Tasks bulk conversion**. Choose files/folders, **Scan**, review counts and messages, then confirm conversion. Plain checkboxes without eligible Tasks emoji metadata and existing Operon tasks are left unchanged. Bulk conversion does not infer parent links or inherited fields from indentation or the containing File Task.

For different templates, use separate batches: set the Inline default to Project, select the work folder, Scan and convert; then set it to Personal, remove the work scope, select personal files, and Scan again. One batch does not assign templates per folder. Dependency references are resolved within the conversion set, so splitting related tasks can affect linking across batches.

A fresh **Scan** is required after changing the template, its contents, relevant settings, or selected scope. Changed source files must also be rescanned rather than overwritten from a stale result. See [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]] for the full procedure.

## Bulk recovery is not permanent Undo

Back up before a large migration. If bulk conversion is interrupted, resolve its recovery state before starting another batch. **Check again** rechecks evidence; **Restore original sources** restores only when current files and identities pass safety checks. **Complete conversion** keeps an already fully converted batch—it does not resume a partly written one. Later source edits can prevent safe restoration.

Use **Retry cleanup** for pending recovery cleanup and **Retry view refresh** for a processed batch whose views have not refreshed. Do not repeat conversion to repair a refresh problem. These controls belong to the bulk Settings workflow, not every conversion command, and they are not a permanent Undo history. Follow [[DOCS-149 Tasks bulk conversion|Tasks bulk conversion]] before acting on an uncertain result.

## What the single-line command converts

- **A clean Tasks emoji line converts.** Its emoji fields become Operon fields, and the line becomes an inline task.
- **A mixed line does not.** A line that already combines Operon inline fields with Tasks emoji metadata is not converted, because the two formats should not be merged on one line. Untangle it first.
- **A non-Tasks line is left alone.** Only supported Tasks emoji lines convert.

## After converting

The line is now a full Operon inline task. From here it behaves like any other: it appears in filters, the Calendar, and the Kanban, and you can open it in the [[DOCS-021 Task Editor|Task Editor]]. To bring several plain list lines across at once instead, see [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

## FAQ

**Do I have to convert everything at once?** No. Convert one line, a selection, or selected files/folders. Choose the path whose scope and parent behavior fit your migration.

**What if a line mixes both formats?** Operon will not convert a hybrid line. Separate the Operon fields from the Tasks emoji first.

**Where is the hover icon?** It appears in Live Preview when the setting is on. It is a quick alternative to the command.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Inline Tasks**, where **Checkbox Conversion** controls both conversion icons and their optional Creator review. The same page contains the Inline template default and the separate **Tasks bulk conversion** section.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
