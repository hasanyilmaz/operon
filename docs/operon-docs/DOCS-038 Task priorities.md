---
Up:
  - "[[DOCS-037 Pipelines and statuses|Pipelines and statuses]]"
  - "[[DOCS-025 Filter View|Filter View]]"
  - "[[DOCS-012 Inline task syntax|Inline task syntax]]"
Notes: Rank tasks by importance for sorting and planning
Icon: flag
Color: "#ca8a04"
tags:
  - operon
  - settings
  - priority
  - configure
Updated: 2026-06-25T16:47:21
---

# Task priorities

Priority is how important a task is, expressed as a single ranked level. It is not the same as status, which is how far along the work is, and not the same as pinning, which is a personal "keep this in front of me" choice. Priority drives sorting, filtering, and planning, so a clear priority scale is what lets a long list surface the few things that matter most.

> **MEDIA-DOCS-038-1:** The Priority settings showing the ranked levels with their colors.

![MEDIA-DOCS-038-1 - The Priority settings showing the ranked levels with their colors](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-038-1.png)

## How priority is written

Priority is one value on the task, stored as a short label:

```md
- [ ] Draft release notes {{operonId:: {{operonId}}}} {{priority:: A}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
```

Every real task also carries an `operonId`, its durable identity, which Operon fills in for you. The `{{datetime}}` variable stamps the creation moment on paste, and Operon maintains `datetimeModified` for you afterward. See [[DOCS-015 Task identity and operonId|Task identity and operonId]] and [[DOCS-061 operonId template variables|operonId template variables]].

The levels are **ordered**, and the order is what matters: the top level is the most important, and importance falls as you go down. See [[DOCS-012 Inline task syntax|Inline task syntax]].

## The default levels

Operon ships with seven levels, from highest to lowest, so you have a working scale immediately:

| Level | Use it for |
|---|---|
| **S** | Highest-impact or urgent work, where delay creates real cost. |
| **A** | Important committed work to plan or do soon. |
| **B** | Valuable planned work that can follow S and A. |
| **C** | Normal operational work with no urgent timing. |
| **D** | Low-priority maintenance or cleanup, easy to defer. |
| **E** | Backlog or someday work, worth keeping but not active. |
| **F** | Lowest-priority or reference work, parked or optional. |

You can rename levels, change their colors and icons, reorder them, and set which level new tasks get by default.

## What priority drives

Because the levels are ranked, Operon can use them wherever order matters:

- **Sorting**: lists and views can sort by importance, so the top of the list is the most important work.
- **Filtering**: a filter can select a priority or a range, such as "S and A only." See [[DOCS-025 Filter View|Filter View]].
- **Planning**: when you decide what to schedule or work on next, priority is the quick signal of what deserves attention first.

## Priority is not status

Keep the two apart. A task can be high priority and barely started, or low priority and almost done. Status moves a task through a workflow; priority ranks it against everything else. They answer different questions and are set independently. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

## Describe a level

Each priority level can carry an optional **description**: a short note on when that level applies. It is never required, since you understand your own scale, but writing it down pays off twice. It makes the level unambiguous for you later, and it gives an agent the shared context to pick the right priority instead of guessing from the letter alone. The default levels ship with descriptions, for example S for highest-impact or urgent work and C for normal operational work, and you can rewrite them or describe levels of your own.

## FAQ

**Do I have to use seven levels?** No. The default scale is a starting point. Trim or rename it to match how you really triage.

**What priority does a new task get?** The default level you set in settings, unless you choose another at creation.

**Is priority the same as pinning?** No. Pinning keeps a task visible on the [[DOCS-032 Pinned Task Dock|Pinned Task Dock]]; priority is a ranked field used for sorting and filtering.

## Settings

Operon settings for this live in **Settings → Operon → Core → Priority**, which defines the priority levels, their order, colors, and icons, and the default priority for new tasks.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
