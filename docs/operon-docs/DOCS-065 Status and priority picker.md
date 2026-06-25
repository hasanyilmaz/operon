---
Up:
  - "[[DOCS-037 Pipelines and statuses|Pipelines and statuses]]"
  - "[[DOCS-038 Task priorities|Task priorities]]"
  - "[[DOCS-062 Field pickers overview|Field pickers overview]]"
Notes: Set a task's status and priority by picking from your own lists
Icon: list-filter
Color: "#db2777"
tags:
  - operon
  - pickers
  - status
  - priority
Updated: 2026-06-25T16:47:21
---

# Status and priority picker

Status and priority are the two fields you set most, and each has a picker that draws straight from your own setup. The status picker lists the stages of your pipelines; the priority picker lists your levels. Both are kept on one page because they are the core task selectors and they work the same way: search, pick, or clear.

Both fields are property type **Text**. The status picker writes a `Pipeline.Status` value; the priority picker writes a level label like `A`. See [[DOCS-012 Inline task syntax|Inline task syntax]].

## The status picker

Opening the `status` field shows every status across your [[DOCS-037 Pipelines and statuses|pipelines]], each with its color dot so you can tell stages apart at a glance. Type to filter the list, then pick one. Because the value is `Pipeline.Status`, the picker shows both the pipeline and the stage, so a `Project.InProgress` is never confused with another pipeline's `InProgress`.

A **Clear** action empties the field. The options come from your pipeline configuration, so the picker always matches the statuses you actually use.

> **MEDIA-DOCS-065-1:** The status picker  listing the user's own options.

![MEDIA-DOCS-065-1 - Status picker options](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-065-1.png)

## The priority picker

Opening the `priority` field shows your [[DOCS-038 Task priorities|priority levels]] in order, plus a **None** option to leave it unset. Type to filter, or pick a level. A **Clear** action removes the priority. Like statuses, the levels are yours: whatever you defined in settings is what the picker offers.

> **MEDIA-DOCS-065-2:** The priority picker listing the configured levels.

![MEDIA-DOCS-065-2 - Priority picker options](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-065-2.png)

## Why they draw from your setup

Neither picker has a fixed list baked in. The status picker reflects your pipelines and the priority picker reflects your levels, so when you rename, reorder, or recolor them, the pickers follow. This is why setting up [[DOCS-037 Pipelines and statuses|pipelines]] and [[DOCS-038 Task priorities|priorities]] early pays off: the pickers you use every day are shaped by that setup.

## FAQ

**Why does the status show a pipeline name too?** The value is `Pipeline.Status`, so the picker shows both. It keeps same-named stages in different pipelines distinct.

**How do I remove a priority?** Use Clear, or pick None. The field becomes empty.

**Can I add a status from the picker?** The picker selects from your existing statuses. To add one, edit your pipeline. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

## Settings

The options come from your taxonomy: statuses in **Settings → Operon → Core → Pipelines**, and priority levels in **Settings → Operon → Core → Priority**.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-021 Task Editor|Task Editor]]
