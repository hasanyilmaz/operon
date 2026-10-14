---
Notes: Convert Tasks emoji tasks in files or folders with templates, fresh scans, and guarded recovery
Icon: list-checks
Color: "#2563eb"
Updated: 2026-10-13T17:06:30+02:00
---

# Tasks bulk conversion

Use **Tasks bulk conversion** to turn eligible Obsidian Tasks emoji lines across selected Markdown files or folders into Operon Inline Tasks. Open **Settings → Operon → Tasks → Inline Tasks → Tasks bulk conversion**. Selection, scanning, confirmation, results, and interrupted-conversion recovery stay on this Settings page.

This converts task lines in their existing notes. To turn whole notes into File Tasks, use [[DOCS-082 Bulk convert a folder into file tasks|Bulk convert a folder into file tasks]] instead. For individual lines or a selection inside one note, see [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]] and [[DOCS-023 Create tasks from selected text|Create tasks from selected text]].

## Before you begin

Start with a small folder or a copy of a note and keep a current backup before a large migration. Recovery protects an interrupted conversion; it is not a permanent Undo history for completed conversions.

Choose **Default inline task template** in Inline Tasks settings before scanning. The chosen template supplies supported properties without copying its body. Source emoji fields take precedence over conflicting template defaults where they are explicitly mapped. Choosing **None** avoids applying a template; normal conversion and task defaults still apply.

The **Use last used template as default** option can change the actual default after successful Task Creator creation. If you use it, check the current default before each batch. Bulk conversion itself does not learn a new default from a template picker.

## 1. Select files or folders

Use **Add file** or **Add folder**, and use **Remove** to exclude a selected path. **Include subfolders** starts enabled; turn it off if a folder selection should cover only its direct Markdown files. Overlapping selections do not convert a file twice.

Keep the selected paths specific to the batch you intend to convert. Operon's template folder and configured excluded folders are skipped before their contents are read. Selecting the vault root does not override those exclusions.

## 2. Scan and review the result

Click **Scan**. Scanning reads the selected sources and prepares the conversion without rewriting task lines. Review the number of convertible tasks and files, plus any expandable messages:

| Message | Meaning |
|---|---|
| Warnings | Sources or lines need attention, such as unavailable files or unsupported mixed metadata |
| Information to be added to the task’s note field | Metadata that will be retained as information instead of becoming an active Operon field |
| Errors | A conversion problem must be resolved before this prepared batch can be applied |

The Settings page prepares all eligible Tasks emoji tasks in the selected scope. It does not open a Task Creator for every row or offer a per-task editing session. For individual review, use the conversion icons with their optional Creator review setting; that setting does not alter bulk conversion or commands.

These are left unchanged:

- Existing Operon tasks.
- Plain checkboxes without eligible Tasks emoji metadata and other ordinary note text.
- Protected content such as frontmatter, code, and comments.
- Unsupported lines that mix Operon fields with Tasks emoji metadata.

If no tasks qualify, the page shows **No eligible Tasks emoji tasks found.** Use the checkbox selection command when you want to convert plain checkboxes as well.

## 3. Confirm and convert

Click **Convert N tasks**, check the task and file counts in the inline confirmation, then click **Convert**. **Go back** dismisses the confirmation without converting.

During conversion, the page shows progress. Wait for the final result and review **Tasks**, **Converted**, and **Unverified** counts. Unverified means the result cannot yet be established safely; it must not be treated as successful conversion.

After completion, inspect a few converted tasks in their notes or Task Editor. Open another batch by adjusting the file/folder selection and clicking **Scan** again.

## What the conversion preserves and changes

Eligible lines receive Operon identities and supported task fields. Dates, priority, supported recurrence, and supported time information are translated into Operon's representation. Unsupported metadata is retained in the task's Note when the converter can preserve it there; read the information messages rather than assuming every source expression became active behavior.

Supported Tasks dependency references can be linked between tasks in the same conversion set. References outside that set are not a promise of cross-batch dependency linking. If related tasks need different templates, consider this tradeoff before splitting them into separate batches.

Converted tasks remain **independent**. Indentation does not create parent links, and neither a containing File Task nor a template supplies inherited parent fields through this bulk flow. This differs from creation and selection flows that support parent inference or inheritance.

## Example — different templates for different folders

Suppose your work tasks need a Project template, while personal tasks need a Personal template. Use two separate batches:

| Batch | Default inline task template | Selected scope |
|---|---|---|
| First | Project | `Work/Imported Tasks` |
| Second | Personal | `Personal/Imported Tasks`, or specific personal files |

1. Set **Default inline task template** to Project.
2. Select only the work folder, choose whether to include subfolders, then **Scan**.
3. Review the messages, confirm, and wait for successful completion and view refresh.
4. Change the default template to Personal.
5. Remove the previous work selection and select the personal folder or files. If the page was reopened, check its current selections rather than assuming they were retained.
6. **Scan again**, review the new batch, and confirm its conversion.
7. Restore your usual default template afterward if these were temporary migration choices.

Each batch uses one default Inline template. There is no folder-to-template assignment within a single batch. Changing the default afterward does not retheme tasks already converted.

## When you must scan again

A scan belongs to the source contents, conversion settings, and template it read. Run a new **Scan** after changing the selected template, editing that template, changing relevant conversion settings, or changing the selected scope. Do not reuse the old result for a different template.

If a source file changed after scanning, Operon stops before applying the stale batch. Scan again to include its latest content. When offered, **Review unchanged files** instead prepares a reduced batch that excludes the changed files; review and confirm the revised result. It does not overwrite the changed sources.

An unavailable or invalid selected template must be corrected before retrying. Operon does not silently substitute another template just to complete the batch.

## Cancel and interrupted conversion

**Cancel** requests that the operation stop. Before source writing begins, no task-line conversion is applied. If writes have started, Operon attempts a conditional restoration of the source changes it can verify. Wait for the final status: clicking Cancel alone is not proof that everything was restored.

If restoration cannot be verified, or the process is interrupted, the Settings page reports **An interrupted conversion needs attention.** Resolve that state before starting another batch.

| Recovery control | What it does |
|---|---|
| **Check again** | Rechecks recovery evidence and current source files without repeating conversion |
| **Restore original sources** | Restores recorded source content when current files and task identities pass the safety checks |
| **Complete conversion** | Keeps the converted result when every recorded source already matches its converted state, then resolves recovery |
| **Retry cleanup** | Retries cleanup after a conversion or restoration has been resolved; it does not convert the sources again |
| **Retry view refresh** | Refreshes views after sources have been processed; do not repeat conversion to fix a pending refresh |

**Complete conversion does not resume a partly written batch.** It is enabled only when all recorded files already match the converted result. A mixture of original and converted files may allow restoration, subject to the safety checks.

If a source now differs from both its recorded original and converted content, or identity checks fail, restoration can be unavailable. Operon will not overwrite later edits to force recovery. Preserve the current files and the recovery evidence shown on the page; investigate the conflict before making another change. Missing or unreadable recovery data also requires attention rather than deleting the evidence to bypass the check.

Recovery evidence lives under the plugin's `state/tasks-conversion` directory inside the vault's configuration folder. The page displays its actual path. This is operational recovery data, separate from a settings backup. Restoring original sources is not a rollback of all settings changes or of a default template you chose manually.

## FAQ

**Can I use a different template for every folder?** Yes, by changing the default and running a separate fresh scan and conversion for each group. One batch does not assign multiple templates by folder.

**Why must I scan after changing templates?** The prepared result was calculated using the previous template and settings. A new scan makes the next conversion match the new choice.

**Does the Creator review toggle affect this page?** No. It applies to the two Live Preview conversion icons, not bulk conversion or commands.

**Can I undo a completed batch here later?** This page's recovery controls handle unresolved operations; they are not a permanent Undo button. Use your backup strategy for a completed migration you later decide to reverse.

**The tasks were converted but views have not refreshed. Should I convert again?** No. Use **Retry view refresh** when offered.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-049 Obsidian Tasks migration|Obsidian Tasks migration]]
- [[DOCS-023 Create tasks from selected text|Create tasks from selected text]]
- [[DOCS-024 Task templates|Task templates]]
- [[DOCS-011 Inline tasks|Inline tasks]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-046 Plugin data and state files|Plugin data and state files]]
