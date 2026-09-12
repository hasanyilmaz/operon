---
Notes: Place a live task card inside a note, with local layout options and shared task controls
Icon: panels-top-left
Color: "#0284c7"
Updated: 2026-09-12T01:13:01+02:00
---

# Embedded Task Cards

Embedded Task Cards place one Operon task inside a note as a live, interactive card. Use a card beside a project brief, inside a meeting note, or on a dashboard when you want the task's status, progress, and controls close to the text that explains the work.

The card points to an existing **Inline Task** or **File Task** by its `operonId`. It does not create another task or move the source. You can display the same task in several notes and on [[DOCS-141 Canvas Task Cards|Canvas]], with each card showing the same underlying work.

> **MEDIA-DOCS-142-1:** An embedded Northstar launch task card inside a project note, showing its image, task fields, progress, and surrounding planning text.

![MEDIA-DOCS-142-1 - Embedded Task Card inside a project note](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-142-1.png)

## Copy a card from Task Editor

1. Open the task in [[DOCS-021 Task Editor|Task Editor]].
2. Use **Copy task card embed**, beside the existing Copy operonId control.
3. Paste the copied block into the note where the card belongs.

Operon renders the card in Live Preview and Reading view. In Source mode, the embed remains an ordinary code block that you can inspect and edit.

The copy action supplies the correct task ID and includes the current card layout and visibility preferences. It does not create a task. If the task is missing or its ID is invalid or duplicated, resolve that problem before copying its card.

## The code block

An embedded task card uses an `operon` block with `view: card` and `taskId`:

````md
```operon
view: card
taskId: abc1234
```
````

Here, `abc1234` illustrates the ID format. Replace it with the ID of an existing task, or use **Copy task card embed** to obtain a working block. Do not generate a new ID for an embed: the card needs to point to the task that already exists.

The ID must contain exactly seven lowercase letters or digits. Each option appears once, on its own `key: value` line. Keep option names and values such as `view: card`, `left`, and `true` in English even when Operon's interface uses another language. Comments starting with `#` are allowed outside quoted values.

## Set the layout for one card

Add optional lines to control this embed without changing other cards:

````md
```operon
view: card
taskId: abc1234
width: 350
align: right
wrap: true
image: true
chips: true
progress: true
```
````

| Option | Accepted values | What it controls |
| --- | --- | --- |
| `width` | Whole number from 1 to 2000 | Requested card width in pixels; the card is constrained to the available space |
| `align` | `left`, `center`, `right` | Horizontal position in the note |
| `wrap` | `true`, `false` | Whether following text may flow beside a left- or right-aligned card |
| `image` | `true`, `false` | `false` hides the image for this card; `true` allows the configured image source when media is available |
| `chips` | `true`, `false` | Overrides whether the card's configured chip section is shown |
| `progress` | `true`, `false` | `false` hides progress displays for this card; `true` allows the enabled progress displays when data is available |

With no local width, alignment, or wrapping option, the card follows the corresponding general Task Cards setting. With no local visibility option, it follows the general image, chip, and progress preferences.

**Copy task card embed writes explicit options.** Those lines remain in the note when you later change general settings. For example, `width: 350` keeps that card's requested width at 350 px. Remove the line if you want that card to follow the global width again.

Local visibility does not replace the underlying configuration: `image: true` cannot supply an image when Image source is None or the task has no suitable media. Likewise, `progress: true` does not turn on a globally disabled task-progress or checkbox-progress track. `chips: true` shows the configured chip section, but does not add individual fields that you have hidden.

## Place text beside a card

Use `align: left` or `align: right` with `wrap: true` to let following paragraphs flow beside the card. Headings and lists can also continue beside it. Put the embed before the text you want to accompany it.

Wrapping needs enough room for both the card and readable text. In a narrow pane, Operon places the text below the card instead of squeezing it into a thin column. Tables, code blocks, blockquotes, and other complex blocks end the surrounding text flow.

A centered card requires `wrap: false`:

````md
```operon
view: card
taskId: abc1234
align: center
wrap: false
```
````

Use this layout for a standalone project summary. Use a left- or right-aligned wrapped card when the task belongs beside explanatory text. These placement options apply to notes; Canvas cards use their Canvas positions and dimensions.

> **MEDIA-DOCS-142-2:** Another example of Embedded Task Cards in a note, showing how task cards fit alongside project content.

![MEDIA-DOCS-142-2 - Embedded Task Cards example in a note](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-142-2.png)

## Work with the embedded task

Click the task title to open Task Editor. **Cmd-click** on macOS or **Ctrl-click** on other platforms opens its source in a new tab. This differs from a native Canvas task card, where clicking the description opens its compact text editor.

The card can show configured field chips, task and checklist progress, and action controls for time tracking, pinning, Notes, creating subtasks, and opening checkboxes. Available controls depend on the task, the enabled settings, and the local visibility options.

- Use field chips to edit or inspect their values through the normal Operon controls.
- Use the task icon's contextual menu for available task actions, including opening the editor or source.
- Use the descendant count to open the task's [[DOCS-059 Dynamic Subtasks Filter|subtree]] when it has subtasks.
- Use the checkbox action to work with the task's [[DOCS-017 Plain checkbox lists|plain checklist]].

These actions update the source task, not a private copy inside the note. Changing a date or completing the task from a card is reflected in the other Operon surfaces that display it. Editing the embed's width, alignment, or visibility changes only its presentation.

Removing the embed block removes the card from that note. It does not delete the source task.

## Choose a card, filter, or table

Each embed answers a different question:

| Embed | Use it for | Reference |
| --- | --- | --- |
| Task Card | One specific task, with its own controls and progress | `taskId` in an `operon` block with `view: card` |
| Filter | A live list of tasks matching saved conditions | `filterId` in an `operon` block |
| Table | Many tasks displayed as configurable rows and columns | `presetId` in an `operon-table` block |

Use separate blocks when a project note needs both its main task card and a filtered list of work. Do not combine `filter` or `filterId` with Task Card options in the same block. See [[DOCS-083 Embed a filter in a note|Embed a filter in a note]] and [[DOCS-110 Embed a table in a note|Embed a table in a note]].

## Settings

Open **Settings → Operon → Views → Task Cards** for shared card appearance.

| Setting | Purpose |
| --- | --- |
| Default width | Starting width when the embed omits `width`; 350 px by default |
| Default alignment and Wrap text | Default placement when the corresponding embed options are omitted |
| Color source | Choose the task field or color system used for the card accent in notes |
| Image source | Choose the task media field, or None to hide images |
| Image ratio | Original proportions, Landscape (16:9), Square (1:1), or Portrait (2:3) |
| Card item order | Arrange the image, header, task progress, chips, and checkbox progress; the task header stays visible |
| Task progress, chips, and checkbox progress | Choose the optional sections to display when their data is available |

The default-width dropdown offers 300, 325, 350, 375, and 400 px. A local `width` option can use the wider supported range documented above. Fixed image ratios crop around the center; Original shows the full image. See [[DOCS-138 Task images and galleries|Task images and galleries]] for media fields.

Under **Settings → Operon → Interface → Task Chips**, configure **Task Card Chips** and **Task Card Actions** independently of Inline, Filter, or Kanban chips. Under **Interface → Context Menu**, use the **Task Cards** surface to configure its task-icon menu. See [[DOCS-041 Task chips display and behavior|Task chips]] and [[DOCS-042 Contextual menu actions|Contextual menu actions]].

The Canvas Task Pool settings on the Task Cards page apply to Canvas, not to embedded cards in notes.

## FAQ

**Why does the card say the task was not found?** Check that `taskId` is the ID of an existing indexed task. It is not a file path, title, or newly generated ID. If the source was deleted, the embed does not recreate it. See [[DOCS-054 Missing tasks|Missing tasks]].

**Why does it report multiple tasks with the same ID?** Operon cannot choose a unique source. Resolve the [[DOCS-055 Duplicate IDs|ID conflict]] rather than relying on the card to select one copy.

**Why is the card loading or unable to read the task?** Cards wait for the task index. Let Operon finish starting; if the problem persists, check the task source and index. An error does not mean the card created or deleted a task.

**Why does my block show an option error?** Check `view: card`, the ID, accepted option values, and duplicate lines. `align: center` cannot be combined with `wrap: true`. An invalid option needs correction rather than being silently ignored.

**Why is the text below my wrapped card?** The pane may be too narrow, a complex block may end the text flow, or Operon may be unable to resolve the editor's source range. Keep wrapping to a left- or right-aligned card followed by ordinary text; check any displayed layout message.

**Why did changing the default width not change this card?** The copied embed includes its own `width` line. Edit it or remove it to inherit the global setting.

**Does copying the embed duplicate the task?** No. Both blocks refer to the same task. Create a new Inline Task or File Task if you need independent work.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-141 Canvas Task Cards|Canvas Task Cards]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-015 Task identity and operonId|Task identity and operonId]]
- [[DOCS-041 Task chips display and behavior|Task chips]]
- [[DOCS-083 Embed a filter in a note|Embed a filter in a note]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
