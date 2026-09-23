---
Notes: Find, favorite, and apply property values to tasks on Canvas
Icon: layers
Color: "#0284c7"
Updated: 2026-09-23T11:08:07+02:00
---

# Canvas Property Value Pool

Canvas Property Value Pool finds property values you can reuse on existing Canvas task cards. The Canvas Task Pool adds existing tasks to the board; this pool changes their properties.

## Open the pool

With a Canvas active, open **Canvas Property Value Pool** from its controls or run **Operon: Open Canvas Property Value Pool**. The command requires an active Canvas. The panel opens on its first visible shortcut.

## Search and favorite values

Choose **All values**, **Favorites**, or a property shortcut. All values searches supported fields together; a property shortcut narrows the search. To search within a property using the keyboard:

1. Choose **All values** and type at least two characters of the property's name, for example `st` for Status. Matching property suggestions appear before value results. Names follow your key mappings.
2. Use `Up` or `Down` to select the property suggestion, then press `Enter`. This opens that property's search scope and clears the query. Typing two characters alone does not switch scopes.
3. Type the value you want to find within that property.

Among value results, matching favorites come first. In All values and Favorites, properties follow your configured shortcut order, including hidden shortcuts; unassigned properties follow the standard order. Dates gives date fields a shared position, with the first occurrence winning when individual date shortcuts also exist. Unavailable favorites follow usable results and can still be removed.

Use a row's star to add or remove a favorite. Favorites are shared across Canvases in the vault. Switching shortcuts preserves your query; Clear returns to the first visible shortcut.

## Apply a value to a task

Drag a value onto an Operon task card and inspect the change preview before releasing. On a tablet, press and hold the row before dragging; an ordinary swipe scrolls results.

Single-value properties replace the existing value. List properties append missing items without duplicates:

```text
Priority: C → A
Tags: planning → planning; launch
```

> **MEDIA-DOCS-145-1:** Dragging the launch tag from Canvas Property Value Pool onto a task card, with the preview showing it added to the existing planning tag.

Drops update the source task. Canvas Undo/Redo includes related changes recorded with the drop; later task changes may prevent replay.

Supported values can also create Canvas groups or extend a matching list group's rule. Changing that rule does not bulk-update the tasks inside the group. See [[DOCS-146 Operon Groups in Canvas|Operon Groups in Canvas]].

## Dates, reminders, and media

Dates offers relative choices such as Tomorrow. A favorite retains the relative rule, and the displayed date updates as time passes. Scheduled changes follow existing Daily and Weekly Notes parent rules when applicable.

Reminder rules append to the task with a reminder-time preview. Missing reference dates or reminders that would already be past prevent the drop. Links, task images, and gallery items reuse existing references; gallery additions preserve their order.

The pool reuses configured or existing values and supported date/reminder choices; it does not create arbitrary values.

## Use the keyboard and arrange the panel

While the search box has focus, use `Up` and `Down` to select results. To move through the property shortcuts above it:

1. Move to the first result, then press `Up` again to focus the active shortcut above the search box.
2. Use `Left` and `Right` to switch between available shortcuts. The results change with the selected shortcut, and your search text is preserved.
3. Press `Down` to return to the search box and continue typing. `Enter` or `Space` on a shortcut also selects it and returns to search.

With an empty search box, `Left` and `Right` switch shortcuts directly without moving focus out of search. `Enter` on a selected value toggles its favorite; on a property suggestion it opens that property's scope. `Escape` closes the panel.

In the separate **Create group** context, `Enter` creates the group instead of changing favorites.

Drag the header to move the panel. Pin it to keep it open when clicking elsewhere; an unpinned panel closes on an outside click. Interacting with either Canvas pool brings that panel forward.

## Tips

> [!tip] Keep frequent values close while planning
> Favorite the statuses, priorities, and tags you use most, then pin the pool beside your Canvas. You can apply them to task cards without repeating the same searches.

## Settings

Open **Settings → Operon → Views → Task Cards**, then **Canvas Property Value Pool**.

`Property shortcuts` provides nine slots with visibility and ordering controls. Initially all are enabled: All values, Favorites, Status, Dates, ReminderRules, Contexts, Tags, Assignees, and Type. Property shortcuts retain their canonical identities but display your [[DOCS-039 Key mappings|mapped property names]]; a context mapping named Up appears as Up.

`Panel width` offers 240, 280, 320, 360, or 400 px, constrained by available space. `Visible rows` offers 5, 7, 11, or 13. Defaults are 320 px and 5 rows.

## FAQ

**Why does Enter not change the task?** In normal pool use it manages favorites. Drag a value onto the task to apply it.

**Why is a drop unavailable?** Check the preview, Canvas write access, and whether the value still exists. Changes requiring additional workflow actions must use [[DOCS-021 Task Editor|Task Editor]].

**Are searches limited to visible rows?** No. Search covers matching values; scrolling loads more results.

## Related

- [[DOCS-141 Canvas Task Cards|Canvas Task Cards]]
- [[DOCS-146 Operon Groups in Canvas|Operon Groups in Canvas]]
- [[DOCS-062 Field pickers overview|Field pickers overview]]
- [[DOCS-063 Date and time picker|Date and time picker]]
- [[DOCS-117 Reminder rules|Reminder rules]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
