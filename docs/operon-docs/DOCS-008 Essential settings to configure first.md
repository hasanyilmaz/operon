---
Notes: The few settings to set before real use
Icon: sliders-horizontal
Color: "#16a34a"
Updated: 2026-07-23T16:45:34
---

# Essential settings to configure first

You do not need to configure everything before using Operon. But five settings shape how every task behaves, so it is worth a few minutes in **Settings → Operon** before you create a lot of tasks. Set them once and the rest can wait.

> **MEDIA-DOCS-008-1:** The Operon settings tabs (Core, Tasks, Pipelines, Priority, Keymapping).

![MEDIA-DOCS-008-1 - The Operon settings tabs (Core, Tasks, Pipelines, Priority, Keymapping)](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-008-1.png)

## 1. Where inline tasks are written

Under the **Tasks** settings, decide where a new inline task goes when there is no obvious target. If you use Daily Notes, you can capture into the daily note. If you do not, choose a fixed target file. This is the difference between quick capture landing somewhere sensible and tasks scattering unpredictably.

> **MEDIA-DOCS-008-2:** The Tasks settings where the inline-task capture target is chosen.

![MEDIA-DOCS-008-2 - The Tasks settings where the inline-task capture target is chosen](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-008-2.png)

## 2. Where file tasks are created

Still under **Tasks**, check the file-task location rules. A file task is a real Markdown note, so its folder matters for how your vault stays organized. Decide this before you create file tasks, not after.

## 3. Your pipeline and statuses

Open the **Pipelines** tab and look at the workflow stages a task moves through. These are the columns you will see on the Kanban. You do not have to perfect them on day one, but the first status names should already make sense to you. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]].

## 4. Priorities

Open the **Priority** tab and confirm the priority levels match how you actually rank work. Priority drives sorting and filtering later. See [[DOCS-038 Task priorities|Task priorities]].

## 5. Key mappings (property names)

Open the **Keymapping** tab. Key mappings connect each Operon field to the property name written in your Markdown, both inline `{{key:: value}}` and file-task frontmatter. If you already have a property naming style in your vault, align it here so the same field means the same thing everywhere. See [[DOCS-039 Key mappings|Key mappings]], and [[DOCS-040 Custom keys|Custom keys]] if you need a field the defaults do not cover.

> **MEDIA-DOCS-008-3:** The Keymapping tab mapping canonical fields to visible property names.

![MEDIA-DOCS-008-3 - The Keymapping tab mapping canonical fields to visible property names](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-008-3.png)

## A good first pass

1. Set the inline-task capture target.
2. Set the file-task location.
3. Glance at your pipeline and status names.
4. Glance at your priority levels.
5. Align key mappings with your property naming, if you have one.

That is enough. You can refine any of these later without breaking existing tasks.

## Next step

With the basics in place, make something. See [[DOCS-009 Create your first task|Create your first task]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-007 Install and enable Operon|Install and enable Operon]]
