---
Up:
  - "[[DOCS-033 Recurring tasks|Recurring tasks]]"
Notes: What is inherited between tasks and when
Icon: git-branch-plus
Color: "#7c3aed"
tags:
  - operon
  - taskmodel
  - inheritance
  - subtasks
Updated: 2026-07-20T15:56:48
---

# Operon inheritance rules

Operon has three separate inheritance mechanisms, and it matters which one you are looking at. One copies fields into a new subtask at creation, one carries fields forward when a recurring task rolls to its next run, and one borrows a parent's color and icon for display only. They behave differently, so this page treats each on its own and then names the distinction that ties them together.

> **MEDIA-DOCS-058-1:** A parent task and a new subtask side by side, with arrows showing which fields were copied and which were left blank.

<iframe
  title="MEDIA-DOCS-058-1 - Parent-child task inheritance video"
  width="100%"
  height="420"
  src="https://www.youtube-nocookie.com/embed/B2DbVtOf53w"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen>
</iframe>

## The three mechanisms at a glance

| Mechanism | When it happens | Between whom | Copy or live |
|---|---|---|---|
| Parent to child | When you create a subtask | Parent task to its new child | One-time copy |
| Recurrence carry-forward | When a recurring task completes | A completed occurrence to its successor | One-time copy |
| Display inheritance | Every time a task bar renders | A task to its nearest ancestor | Live lookup |

## 1. Parent to child (subtask creation)

When you create a subtask, Operon copies a chosen set of the parent's fields into the new child once, at the moment of creation. This is a snapshot, not a live link: editing the parent later does not change a subtask that already exists.

- The `parentTask` link itself is always added separately. It is the structural connection, not one of the inherited metadata fields.
- **Default inherited fields:** `status`, `priority`, `taskIcon`, `taskColor`.
- **You choose the list.** In **Settings → Operon → Tasks → Relationships**, the **Parent-Child task inheritance** setting decides which parent fields are copied into a new child. You can add or remove fields, including your own custom keys, and you can include tags.
- **Status is special.** When `status` is inherited, the child does not copy the parent's exact stage. It starts at the *first* status of a pipeline. The **Status pipeline** setting decides which pipeline supplies that starting status: `Parent's pipeline` (the default) or `Default pipeline`.
- **Priority** copies the parent's priority, or falls back to your default priority when the parent has none.

Some fields can never be inherited, whatever the setting says, because they must stay unique or be recomputed: `operonId`, `parentTask`, `datetimeCreated`, `datetimeModified`, `blocking`, `blockedBy`, `duration`, `totalEstimate`, `totalDuration`, the subtask counts, `repeatSeriesId`, `repeatOccurrenceDate`, `reminderDatetimes`, `reminderRules`, `timezone`, `trackers`, `activeTracker`, and `related`.

Reminders are on that list for a practical reason rather than a technical one: a subtask is rarely due when its parent is, so inheriting the parent's reminders would fire notifications about the wrong work at the wrong time. Give a subtask its own reminders when it needs them. See [[DOCS-116 Reminders|Reminders]].

## 2. Recurrence carry-forward (next occurrence)

When a recurring task is completed, Operon generates the next occurrence and copies fields forward from the run you just finished. See [[DOCS-033 Recurring tasks|Recurring tasks]].

- **Carried forward** (intent and shape): `assignees`, `priority`, `status`, `contexts`, `parentTask`, `repeat`, `datetimeRepeatEnd`, `reminderRules`, `estimate`, `note`, `taskIcon`, `taskColor`, `dateStarted`, `dateDue`, and the timed block `datetimeStart` and `datetimeEnd` (the relative dates are shifted to the next occurrence).
- **Reset** (the reality of one run): `dateCompleted`, `dateCancelled`, `duration`, `trackers`, `activeTracker`, `progress`, the subtask counts, `totalEstimate`, and `totalDuration`. Dependencies (`blocking`, `blockedBy`) are not carried forward either.
- **Fresh each time:** a new `operonId`, a new `datetimeCreated`, the next `dateScheduled`, and an updated `datetimeModified`.

The two reminder fields intentionally behave differently. **ReminderRules carry forward** because they describe a relationship, such as 15 minutes before Start time; Operon resolves that same rule against the new occurrence's shifted dates when the referenced date is available. **ReminderDatetimes do not carry forward** because they are fixed moments that belong to the occurrence where you created them. See [[DOCS-116 Reminders|Reminders]].

## 3. Display inheritance (color and icon)

For display only, a task with no color or icon of its own borrows from its ancestors. If `taskColor` or `taskIcon` is blank, Operon walks up the `parentTask` chain and uses the nearest ancestor that has a value. This affects what the inline task bar shows, not what is stored on the task.

This lookup is live. It is resolved every time the bar renders, so changing an ancestor's color updates how a colorless descendant looks right away. The walk is bounded, so a long or broken chain cannot stall rendering.

> **MEDIA-DOCS-058-2:** Inheritance rules.

![MEDIA-DOCS-058-2 - Inheritance rules](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-058-2.png)

## Copy versus live: the key distinction

Mechanisms 1 and 2 write a value into the new task at one moment. Mechanism 3 writes nothing and borrows the value at render time. That is why changing a parent's priority does not touch a subtask you already made, while changing a parent's color does change how a colorless child appears.

## FAQ

**I changed the parent after creating a subtask. Did the subtask update?** Not for copied metadata like status or priority, which were taken once at creation. Yes for displayed color and icon, if the child has none of its own.

**Why did my new subtask start at the first status instead of the parent's stage?** Inherited status always starts at the first status of a pipeline, not the parent's exact status.

**Can I turn off parent to child inheritance?** Yes. Clear the Parent-Child task inheritance list in settings. The parent link is still added; no metadata is copied.

**Can custom fields be inherited?** Yes, as long as they are not internal. Add them to the inheritance list.

## Settings

Operon settings for this live in **Settings → Operon → Tasks → Relationships**, which configures which fields a new subtask inherits from its parent.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-018 Task properties|Task properties]]
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
- [[DOCS-116 Reminders|Reminders]]
