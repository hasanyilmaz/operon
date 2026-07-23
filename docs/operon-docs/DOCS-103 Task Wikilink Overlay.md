---
Notes: Render task chips and actions on a task wikilink, for file and inline tasks
Icon: link
Color: "#ca8a04"
Updated: 2026-07-23T16:45:34
---

# Task Wikilink Overlay

A **Task Wikilink Overlay** turns an ordinary wikilink into a live view of the task it points to. When a note links to a task, Operon decorates that link in place with the task's progress, its compact [[DOCS-041 Task chips display and behavior|chips]], and a row of quick actions, so you can read and act on the task without leaving the note you are in. It renders in both Reading View and Live Preview.

## Two link forms

The overlay works for both kinds of task, which differ only in how the link is written:

- **File task**: a normal link to the note, like `[[Renew the car insurance]]`. The note is the task.

```md
Reminder: [[Renew the car insurance]] before it lapses on Friday.
```

- **Inline task**: a link to an inline task inside its source file, written as `[[File#-operonId]]`. The `#-operonId` part points at one inline task by its [[DOCS-015 Task identity and operonId|operonId]], so the link does not depend on a line number.

```md
Still chasing the plumber about [[Home tasks#-k3m9p2q]] this week.
```

Both render the same overlay controls. The inline form is what lets you link to a task that lives inside a note rather than in its own note. The `k3m9p2q` above stands for the task's real [[DOCS-015 Task identity and operonId|operonId]], which the [[DOCS-104 Add Task Wikilink Overlay|Add Task Wikilink Overlay]] command fills in for you.

> **MEDIA-DOCS-103-1:** A file-task link and an inline `[[File#-operonId]]` link, side by side, each showing the overlay.

![MEDIA-DOCS-103-1 - File and inline task wikilink overlays](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-103-1.png)

## Insert one

The quickest way is the [[DOCS-104 Add Task Wikilink Overlay|Add Task Wikilink Overlay]] command. It opens [[DOCS-027 Task Finder|Task Finder]], you pick a task, and Operon inserts the right link at the cursor: a normal link for a file task, or a `[[File#-operonId]]` link for an inline task. You can also write the link by hand if you already know the target.

## In everyday notes

The overlay is most useful where you already plan in prose: a daily note, a weekly review, a project page. You drop a link to a task and it brings the task's live state with it, so the planning note becomes a place you can act, not just a list of names.

A Monday planning note that pulls a few tasks together, mixing file tasks and inline ones:

```md
## This week

- Health: [[Book the dentist checkup]]
- Money: [[Renew the car insurance]] before Friday
- Home: waiting on a quote for [[Home tasks#-k3m9p2q]]
- Trip: confirm the dates on [[Summer plans#-7d4f1a8]]
```

A daily note that links one task you want in front of you, so you can tick it off without opening it:

```md
## Today

Pick up the parcel and finish [[Errands#-b8n2v5w]] on the way home.
```

Meeting notes are where this earns its keep. As you write up a meeting, each action item can be a link to its task, so the notes double as a live tracker: you see each item's status and owner right in the minutes, and you can tick one off or start its timer without leaving the page.

```md
## Project sync notes

Decided to ship the beta next week. Action items:

- Sam follows up on [[Launch checklist#-p4r7t2k]]
- Budget sign-off still pending on [[Q3 budget#-m9k3x6b]]
- Revisit scope at [[Project plan]] before the next sync
```

Next meeting, the same note tells you at a glance what moved and what is still open, because the links show current state, not the state at the time you wrote them.

Each of these links renders with the task's progress, chips, and actions inline, so you read and update the task right from the note you are writing.

## What the overlay shows

On a decorated link, Operon shows, in order:

- A **status** button before the label, which can cycle the task status and expose the overlay's contextual actions.
- The task **label**, using an explicit link alias if you wrote one, otherwise the task description.
- A **progress** indicator for a parent task, summarizing its subtasks.
- The **Open checkboxes** action, when enabled, for regular Markdown checkboxes associated with the task.
- The configured **chips**, the same compact metadata chips used elsewhere.
- Optional **actions**: start or stop the timer, pin or unpin, show a note indicator when the task has a `note`, and add a subtask.
- An **edit** action that opens the task in Task Editor.

Terminal tasks (done or cancelled) show their state and drop the actions that no longer apply.

## Configure it

The overlay's chips and configurable actions are set in **Settings → Operon → Interface → Task Chips → Task Wikilink Overlay Chips**. There you choose which chips appear and their order, and toggle each configurable action: the checkbox action, the timer, pin, note, and subtask. The status and edit buttons remain part of the overlay. The chips follow the same rules as every other surface, covered in [[DOCS-041 Task chips display and behavior|Task chips: display and behavior]].

> **MEDIA-DOCS-103-2:** The Task Wikilink Overlay Chips settings, with chip order and the action toggles.

![MEDIA-DOCS-103-2 - Task Wikilink Overlay Chips settings](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-103-2.png)

## Links that stay current

An inline task can move inside the same note without changing the link, because the link does not store a line number. When the task moves to another file, Operon can still resolve the stale link through the task's unique operonId and repair the file target when it can match the task safely. If a link does go stale, the **Repair Task Wikilink Overlay Links** command scans your vault and repairs the inline links it can match, so the overlays come back without hand-editing. Links in a duplicate `operonId` conflict are left alone until the conflict is resolved.

## Tips

> [!tip] Plan where you think, not where the task lives
> The overlay frees a task from its file. Inline task or file task, no matter which folder or note holds it, you can pull it into whatever note your thinking is happening in. Decide where tasks are stored once, then surface them by context as often as you need.

## FAQ

**Is this the same as Page Preview?** No. Page Preview shows a hover preview of a note. The Task Wikilink Overlay renders live task controls on the link itself, so you can act on the task, not just preview it.

**Why does one link have no overlay?** The link may not resolve to a single task, or the task may be in a duplicate `operonId` conflict, which Operon will not decorate until you resolve it. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].

**Does it need another plugin?** No. The overlay is part of Operon and renders on its own.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-104 Add Task Wikilink Overlay|Add Task Wikilink Overlay]]
- [[DOCS-041 Task chips display and behavior|Task chips: display and behavior]]
- [[DOCS-013 File tasks|File tasks]]
