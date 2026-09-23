---
Notes: Create Canvas groups with property rules, apply them to tasks, and follow changes across the board
Icon: group
Color: "#0284c7"
Updated: 2026-09-23T19:01:57+02:00
---

# Operon Groups in Canvas

An Operon group is an Obsidian Canvas group whose title contains one property rule. Use it to organize task cards and apply values when moving tasks into the group. Groups work only in Canvas. They do not create a new task type or a parent–child relationship.

## Create a group

Open an editable Canvas and choose **Add Operon Group** from its creation menu. [[DOCS-145 Canvas Property Value Pool|Canvas Property Value Pool]] opens in the **Create group** context. Search for a supported value, then click it or press `Enter` to create and select the group. `Escape` or an outside click cancels creation.

Alternatively, drag a supported value from the normal pool into empty Canvas space. The preview shows the proposed title and size. The entire group rectangle must fit without overlapping existing cards or groups; touching edges is allowed. A successful drop leaves the pool open.

## Read and edit the group rule

The whole title represents one property, with one value for a text field or several values for a list field:

```text
{{priority:: A}}
{{status:: Project.Planned}}
{{tags:: planning; launch}}
```

Priority and status values must match your configured definitions. Supported rules include priority, status, tags, contexts, assignees, task type, icon, color, location, links, images, galleries, and managed custom text/list fields. Not every field available in the pool supports group rules; creation filters out unsupported values.

Property names can use their canonical keys or your configured mappings. Edit an Operon group title in its text editor, using semicolons to separate list items. `Enter` saves, `Escape` cancels, and clicking outside saves if the change is allowed. Replacing the rule with an ordinary title makes the group a normal Canvas group. An invalid rule cannot apply values to tasks.

## Add values to a list group

Drag a value from the same property onto the group's empty interior. For example, drop the tag `release` into `{{tags:: planning; launch}}` to produce:

```text
{{tags:: planning; launch; release}}
```

> **MEDIA-DOCS-146-1:** Dragging the release tag onto the empty interior of the planning and launch group, with the preview showing the extended group rule.

![MEDIA-DOCS-146-1 - Add a value to an Operon list group](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-146-1.png)

New values go at the end. An existing value produces an already-present message without another save or Undo step. Different properties and single-value groups do not accept this operation.

Dropping onto a task card changes that task instead. In nested or overlapping groups, the smallest group under the pointer is targeted; an incompatible inner group does not fall back to the outer group.

## Apply a rule to a task

Drag one existing Operon task card into a valid group and review the preview before dropping. A single-value rule replaces that task's value. A list rule adds its missing values while keeping existing items. A blocked drop returns the card to its prior position; use Task Editor when the change requires additional workflow actions.

Editing the group title or adding a value to its list rule does not bulk-update the tasks already inside. Applying a rule by moving a task is a separate operation that changes the source task. Rule changes can also affect whether existing cards still match and where they are routed.

## Automatic routing and Group Mismatches

When an existing card no longer matches its single-value group, Operon looks for a matching normal group with room. It can expand a destination safely without moving surrounding cards. If no suitable normal destination is available, the card goes into a matching subgroup inside **Group Mismatches**. Cleared values, or values that cannot form a valid rule, go directly into Group Mismatches.

Cards there can be reconsidered when suitable normal groups become available. Empty routing groups are cleaned up when safe. This routing works in open and closed Canvases while Operon is running, subject to write access and safe saving. List groups do not trigger automatic routing.

Routing rearranges existing cards; it does not discover tasks and add new cards to the board, or change task properties to fit a destination.

> **MEDIA-DOCS-146-2:** Group Mismatches containing several task cards that no longer match their original groups, with value-specific subgroups and a card whose property value was cleared.

![MEDIA-DOCS-146-2 - Group Mismatches on Canvas](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-146-2.png)

## Colors, layout, and Undo

Valid single-value priority/status groups use their shared Settings color. Changing that color with Canvas's native palette updates the shared definition, other matching groups, and Operon indicators. Resetting the Canvas color sets the shared value to neutral `#6b7280`. Selecting only groups is supported, including ordinary groups; mixing a linked group with a task or ordinary card blocks the color operation.

Groups using the same single-value property cannot gain new overlap through creation, movement, or resizing. Edge contact is allowed. List groups do not have this overlap restriction.

A successful task drop records the card movement and task changes together in Canvas Undo/Redo. A rule edit records the title change. Undoing automatic routing restores the layout without reverting the source task change or immediately repeating that move. Later changes can prevent history replay; shared-color Undo/Redo will not overwrite a color changed afterward. Closed Canvases use available file history rather than an open Canvas Undo stack.

## Tips

> [!tip] Start with one property
> Begin with a few groups for one property, such as priority A, B, and C. Move one task into a group and review the change before organizing the rest of the board. This makes it easier to understand how group rules affect your tasks.

## Settings

There is no separate group settings page. Use **Settings → Operon → Core → Keymapping** for property names, **Core → Priority** for priority definitions and colors, and **Core → Pipelines** for statuses and their colors.

## FAQ

**Why is creation or a drop blocked?** Check the preview, available space, rule compatibility, and Canvas write access.

**Why did my task move?** Its card no longer matched a single-value group. Routing changed the layout, not the task's value.

**Why does my list group not route cards?** List rules add values when applied; they do not drive automatic movement.

**Why did other groups change color?** Priority/status groups share the definition's color, rather than a separate local color.

## Related

- [[DOCS-145 Canvas Property Value Pool|Canvas Property Value Pool]]
- [[DOCS-141 Canvas Task Cards|Canvas Task Cards]]
- [[DOCS-039 Key mappings|Key mappings]]
- [[DOCS-038 Task priorities|Task priorities]]
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
