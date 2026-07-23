---
Notes: Detect and resolve two tasks that share one operonId
Icon: copy
Color: "#dc2626"
Updated: 2026-07-23T16:45:34
---

# Duplicate IDs

Every Operon task is anchored by a unique `operonId`. When two tasks end up carrying the same id, Operon has a conflict: it can no longer tell which line is the real task. This is not a disaster and not something you have to avoid at all costs. Operon detects it for you and gives you a dedicated tool, the **Operon ID Conflict** manager, to clean it up. See [[DOCS-015 Task identity and operonId|Task identity and operonId]] for why identity matters.

> **MEDIA-DOCS-055-1:** The Operon ID Conflict manager listing a duplicated task with its copies and per-copy actions.

![MEDIA-DOCS-055-1 - The Operon ID Conflict manager listing a duplicated task with its copies and per-copy actions](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-055-1.png)

## How duplicates happen

The usual cause is copying. If you copy and paste a task line, or duplicate a file task, the `operonId` comes along, and now two places claim one identity. Templates that reuse a fixed id can do the same if used outside their intended pattern. Syncing a vault across devices can also surface a copy that was made elsewhere.

None of these are forbidden. They simply produce a state Operon will flag and help you resolve.

## How Operon tells you

When Operon indexes your vault and finds an id on more than one task instance, it raises a duplicate alert:

- A **status bar** alert appears: `2 duplicate task copies detected. Open duplicate manager.`
- If you try to edit a conflicted task, Operon blocks the edit with `Resolve duplicate operonId copies before editing this task.`, because it will not guess which copy you meant.
- Optionally, the manager can open on its own after a short delay. This is off by default; you turn it on in settings (see below).

The alert is a signal, not an error you broke. The task data is safe; Operon is just waiting for you to say which copy is which.

## What you cannot do until it is resolved

While an `operonId` is in conflict, Operon will not act on either copy, because it cannot tell which line you mean. This is why a conflicted task suddenly stops responding to normal actions. Until you resolve it, these are blocked on the affected task:

- **Changing its status**, including cycling its status.
- **Toggling completion**, the checkbox done or cancelled state.
- **Editing its fields**, in the [[DOCS-021 Task Editor|Task Editor]] or as inline `{{key:: value}}` edits.
- **Opening it in the Task Editor** for normal editing; the command sends you to the conflict manager instead.
- **Starting a timer** or any [[DOCS-034 Time tracking|time tracking]] on it.
- **Adding a subtask** to it.
- **Linking dependencies** (`blocking` or `blockedBy`) that touch it.
- **Converting it** between inline and file form.

This is deliberate, not a bug. Acting on a duplicated id could write your change to the wrong task, so Operon holds these operations until the identity is unique again. So if a status will not change or a timer will not start on a task, check whether it is in a duplicate conflict.

What still works, so you can fix it: you can **open the file** and **reveal the line** to inspect each copy, and the conflict manager's own actions, **Regenerate new ID** and **Delete this copy**, always run. The moment the id is unique again, every blocked action works normally.

## The Operon ID Conflict manager

Open it from the command palette with **Open duplicate operonId manager**, or by clicking the status bar alert. The manager lists each conflicted `operonId` and, under it, every copy that claims it, with its title and when it was last updated. For each copy you have these actions:

- **Open file**: jump to the note that holds this copy.
- **Reveal line**: go straight to the exact line, for an inline task.
- **Open task editor**: inspect the copy's fields in the [[DOCS-021 Task Editor|Task Editor]].
- **Regenerate new ID**: give this copy a fresh, unique `operonId`, making it its own independent task. This is the usual fix when both copies should survive as separate tasks.
- **Delete this copy**: remove this copy from the vault, when it was an accidental duplicate you do not want to keep.

Work through each conflict until the list is empty. When the last one is cleared, Operon confirms with `Duplicate task copies resolved.` and the status bar alert disappears.

## Which action to choose

- **Both are real tasks?** Use **Regenerate new ID** on one of them. They split into two independent tasks, each with its own identity.
- **One was an accident?** Use **Delete this copy** on the unwanted one.

Either way you keep control. Operon never silently merges or discards a task on its own.

## Settings

Operon settings for this live in **Settings → Operon → Core → General**, under the duplicate alerts: `Auto-open duplicate manager` opens the manager automatically after the alert delay if conflicts remain, and `Duplicate alert delay` sets how long Operon waits before showing the notice, status bar alert, and optional popup.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-054 Missing tasks|Missing tasks]]
- [[DOCS-057 Operon FAQ|Operon FAQ]]
