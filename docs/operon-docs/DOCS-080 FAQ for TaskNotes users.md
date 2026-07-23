---
Notes: Common questions from users moving from the TaskNotes plugin
Icon: circle-question-mark
Color: "#2563eb"
Updated: 2026-07-23T16:45:34
---

# FAQ for TaskNotes users

The questions TaskNotes users ask most when they try Operon, with short answers and links to the full pages. For the step-by-step move, follow [[DOCS-093 How to migrate from TaskNotes|How to migrate from TaskNotes]].

## My notes and properties

**Will converting change my notes?** It is additive. The scan adds an `operonId` and the mapped modified-time property and preserves your existing frontmatter and body. See [[DOCS-082 Bulk convert a folder into file tasks|Bulk convert a folder into file tasks]].

**Will my own property names work?** Yes. Map each TaskNotes property name into the matching Operon canonical key's Property area, and Operon reads and writes your names in file tasks. The value types must match. See [[DOCS-039 Key mappings|Key mappings]].

**What about a property with no Operon field?** Add a Custom Key with the same name and type, so the data is kept rather than ignored. See [[DOCS-040 Custom keys|Custom keys]].

**Do I have to give up one-note-per-task?** No. That is exactly what an Operon file task is. You also gain inline tasks for quick capture, but your notes stay notes. See [[DOCS-013 File tasks|File tasks]].

## Time and focus

**Is there a Pomodoro timer?** Operon does not include a Pomodoro timer. For focused work it offers FlowTime, a session with a target, breaks, and overtime, and TrackTime, a count-up timer. See [[DOCS-035 FlowTime focus sessions|FlowTime focus sessions]].

**Does my tracked-time history come across?** Time you record going forward lands on the Operon task. The conversion adopts the note and its frontmatter; it does not import a separate time-tracking history. See [[DOCS-034 Time tracking|Time tracking]].

**Why does a shared time value look wrong?** Operon stores `estimate` and `duration` in seconds, not minutes. A tool that uses a different unit would misread the same raw value, so do not map a single duration or estimate property between the two systems. See [[DOCS-034 Time tracking|Time tracking]].

## Identity and views

**Why must every task have an `operonId`?** It is the durable identity that keeps a task recognizable across the Filter View, Calendar, and Kanban. There is no option to turn it off. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].

**What replaces my TaskNotes views?** Operon has its own [[DOCS-025 Filter View|Filter View]], [[DOCS-028 Calendar overview|Calendar]], and [[DOCS-030 Kanban overview|Kanban]], and your file tasks and inline tasks appear in all of them together.

## Running both, and going back

**Can I keep TaskNotes installed while I move?** Yes, but treat it as a temporary bridge. The two overlap in a few places, so run both with care rather than as a permanent setup. The full list is under "Running both at once" in [[DOCS-093 How to migrate from TaskNotes|How to migrate from TaskNotes]].

**Can both plugins manage the same note?** It works best if they do not. Operon manages the note as its own file task, with its own status pipeline that differs from another plugin's statuses. Let one system own a given note and its status, so their writes do not overwrite each other. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

**A nested property did not map.** Operon's fields use Obsidian's flat property types (text, number, date, date and time, list, checkbox). A nested or structured property has no Operon field type, so move that data into separate flat keys. See [[DOCS-040 Custom keys|Custom keys]].

**If I uninstall Operon, do I lose anything?** No. Your tasks remain Markdown notes with their frontmatter; they keep the `operonId` as a property. You lose the views and automation, not the notes. See [[DOCS-045 Markdown task storage|Markdown task storage]].

**If I uninstall Operon, do I lose anything?** No. Your tasks remain Markdown notes with their frontmatter; they keep the `operonId` as a property. You lose the views and automation, not the notes. See [[DOCS-045 Markdown task storage|Markdown task storage]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
