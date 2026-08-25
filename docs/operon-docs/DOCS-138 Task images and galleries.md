---
Notes: Add one media item or an ordered gallery to a task and preview it across Operon surfaces
Icon: images
Color: "#db2777"
Updated: 2026-08-25T10:42:38+0200
---

# Task images and galleries

Task Image and Task Gallery attach media references to the task itself. A single cover can make a Kanban card recognizable at a glance; an ordered gallery can keep several images, videos, PDFs, or reference links with the work they belong to.

These are canonical task fields, so the same values follow an inline or File Task through the Task Creator, Task Editor, chips, overlays, Tables, filters, Runtime, and CLI.

## Two fields, two shapes

- **Task Image** uses canonical key `taskImage` and stores one scalar **Text** value.
- **Task Gallery** uses canonical key `taskGallery` and stores an ordered **List** of values.

Task Image is the natural choice for a cover or primary image. Task Gallery is for several references whose order matters.

## Supported references

Each value may be:

- a safe vault-relative path, such as `Assets/cover.png`;
- a wikilink or embedded wikilink, such as `[[Assets/cover.png]]` or `![[Assets/cover.png]]`;
- an `http://` or `https://` URL;
- a named Markdown link, such as `[Launch brief](Assets/launch.pdf)` or `[Walkthrough](https://www.youtube.com/watch?v=VIDEO_ID)`.

For a named Markdown link, the assigned label appears on the chip and preview header while the link target remains the media source. Operon resolves the reference without fetching it merely to classify it. An unsafe or unrecognized value remains stored as text but is treated as unresolved rather than opened as a path or URL.

## Usage examples

Use a plain path, wikilink, embed, or URL when the file name or address is a useful label. Use a wikilink alias or named Markdown link when you want the chip and preview header to show your own title instead. Both forms open the same preview and lightbox behavior.

| Media | Without a custom title | With a custom title |
|---|---|---|
| Local image | `Assets/cover.png`, `[[Assets/cover.png]]`, or `![[Assets/cover.png]]` | `[[Assets/cover.png\|Launch cover]]` or `[Launch cover](Assets/cover.png)` |
| Local video | `Assets/demo.mp4` or `[[Assets/demo.mp4]]` | `[Product demo](Assets/demo.mp4)` |
| Local PDF | `Assets/brief.pdf` or `[[Assets/brief.pdf]]` | `[Launch brief](Assets/brief.pdf)` |
| Web image | `https://example.com/cover.jpg` | `[Launch cover](https://example.com/cover.jpg)` |
| Web video | `https://example.com/demo.mp4` | `[Product demo](https://example.com/demo.mp4)` |
| Web PDF | `https://example.com/brief.pdf#page=3` | `[Launch brief](https://example.com/brief.pdf#page=3)` |
| YouTube | `https://youtu.be/qYfTS1kDkAc?t=90` | `[The Only Trait For Success in the AI World](https://www.youtube.com/watch?v=qYfTS1kDkAc&t=90)` |

Task Image stores one of these references. Task Gallery stores several references in order, separated by semicolons in an inline task:

```md
{{taskGallery:: Assets/cover.png; [Launch brief](Assets/brief.pdf); [Product walkthrough](https://www.youtube.com/watch?v=qYfTS1kDkAc)}}
```

In a File Task, place the same values as separate YAML list items under the mapped Task Gallery property. If a local target contains spaces, either use a wikilink or wrap the Markdown-link target in angle brackets, for example `[Launch brief](<Assets/Launch brief.pdf>)`.

Without a custom title, the chip and preview header use the local label, file name, or web address. With a wikilink alias or named Markdown link, they show the title you supplied while the preview and lightbox continue to load the underlying target.

## Gallery order and escaping

An inline `taskGallery` list uses semicolons between items and preserves the first occurrence of each distinct value:

```md
{{taskGallery:: Assets/front.png; [Launch brief](Assets/launch.pdf); [Walkthrough](https://www.youtube.com/watch?v=VIDEO_ID)}}
```

Escape a literal semicolon inside one item with `\;`, and escape a literal backslash with `\\`. Empty items and later duplicates are removed when the value is normalized. Order is otherwise preserved exactly, which is why Kanban can reliably choose the first or last gallery image.

## Inline and File Task storage

Inline tasks use the canonical keys directly:

```md
- [ ] Prepare launch card {{operonId:: {{operonId}}}} {{taskImage:: Assets/launch-cover.png}} {{taskGallery:: Assets/front.png; Assets/back.png}}
```

File Tasks use their visible mapped property names in frontmatter. The defaults are `OperonTaskImage` and `OperonTaskGallery`, and you may rename those visible names through [[DOCS-039 Key mappings|Key mappings]] without changing the canonical fields.

```yaml
---
OperonTaskImage: Assets/launch-cover.png
OperonTaskGallery:
  - Assets/front.png
  - Assets/back.png
  - "[[Assets/detail-closeup.png]]"
---
```

Quote a wikilink when you place it in YAML so the square brackets are stored as the gallery value rather than interpreted as YAML collection syntax.

## Editing the fields

Task Creator and Task Editor provide the same task-data picker for Task Type, Task Image, and Task Gallery. Task Image accepts one reference. Task Gallery adds and orders multiple references without collapsing them into an unordered set.

On compact task surfaces, Task Image and Task Gallery may appear as configured media chips. A supported reference can open its local file or external URL; an unresolved value remains visible without becoming an unsafe link. Task Wikilink Overlay uses the same configured chip behavior.

## Tables

Add Task Image or Task Gallery as normal editable Table columns. Detailed cells show the media reference values; Task Gallery keeps one ordered chip per item. Supported media fields can also use their compact display where available, while editing still writes back to the same canonical field.

These columns are unrelated to **Task Data Type**, the read-only Table helper that says whether a task is inline or file. See [[DOCS-106 Table columns|Table columns]] and [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]].

## Preview and lightbox

Hovering a Task Image or Task Gallery chip in a supported task or Table surface opens one compact Operon-owned media preview. It supports local and HTTP or HTTPS images, local or direct web videos, local or direct web PDFs, and supported YouTube links. Video files include common formats such as MP4, WebM, MOV, MKV, and OGV. YouTube watch, short, live, and embed links use the privacy-enhanced player without autoplay.

Every preview has the same full-width header. Its left-side open control and the rest of the header surface open the media in a centered, near-fullscreen lightbox; the media title stays centered. A named Markdown link shows its assigned label, while an unnamed reference shows its local label, file name, or web address. Moving the pointer from the chip into the preview keeps the preview available long enough to reach its controls.

Images keep their direct double-click shortcut and support trackpad pinch and **Cmd/Ctrl + wheel** zooming, double-click zoom toggling, and drag or scroll panning. Videos open with their playback controls, PDFs in a large scrollable viewer, and YouTube in a privacy-enhanced 16:9 player. Close any lightbox with its **X**, **Escape**, or a click on the backdrop. Closing stops video playback and releases embedded PDF or YouTube content. Preview and lightbox actions never edit Task Image, reorder Task Gallery, or change the underlying file.

## Kanban card images

A Kanban preset can choose one card image source:

- **None**: show no card image.
- **Task Image**: use `taskImage`.
- **Task Gallery First**: use the first resolved gallery item.
- **Task Gallery Last**: use the last resolved gallery item.

The source changes what the card displays; it does not rewrite Task Image or reorder Task Gallery. If the selected value is empty or unresolved, the card has no image from that source.

## Runtime and CLI parity

Runtime V1 and the CLI treat the fields by their canonical shapes:

- `taskType`: Text
- `taskImage`: Text
- `taskGallery`: ordered List

Create, update, and read preserve the scalar/list distinction and gallery order. The internal `__taskDataType` helper is Table-only, absent from the writable Runtime catalog, and rejected as CLI input. See [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]] and [[DOCS-126 Compact task syntax|Compact task syntax]].

## FAQ

**Should I put several values in Task Image?** No. Task Image is scalar. Use Task Gallery for multiple references.

**Does Task Gallery sort my images?** No. It preserves your order after removing empty values and duplicate later occurrences.

**Can I use web media?** Yes. Direct image, video, and PDF URLs are supported, along with supported YouTube URLs.

**Can I give media a readable title?** Yes. Store it as a named Markdown link such as `[Launch brief](Assets/launch.pdf)`. The title appears on the chip and preview header without replacing the underlying target.

**Does adding media copy the file?** No. The field stores a reference; it does not duplicate the asset.

**Is Task Data Type another media or Task Type field?** No. It is a read-only Table helper for inline-versus-file identity.

## Settings

Visible property names and icons for Task Image and Task Gallery live under **Settings → Operon → Core → Keymapping**. Chip visibility and order are configured per surface under **Interface → Task Chips**. Kanban card image source belongs to each Kanban preset.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-018 Task properties|Task properties]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-030 Kanban overview|Kanban overview]]
- [[DOCS-041 Task chips display and behavior|Task chips: display and behavior]]
- [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
