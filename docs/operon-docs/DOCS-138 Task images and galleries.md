---
Notes: Add one image or an ordered gallery to a task and use that media across Operon surfaces
Icon: images
Color: "#db2777"
Updated: 2026-08-21T16:52:15
---

# Task images and galleries

Task Image and Task Gallery attach visual references to the task itself. A single cover can make a Kanban card recognizable at a glance; an ordered gallery can keep several mockups, receipts, screenshots, or reference images with the work they belong to.

These are canonical task fields, so the same values follow an inline or File Task through the Task Creator, Task Editor, chips, overlays, Tables, filters, Runtime, and CLI.

## Two fields, two shapes

- **Task Image** uses canonical key `taskImage` and stores one scalar **Text** value.
- **Task Gallery** uses canonical key `taskGallery` and stores an ordered **List** of values.

Task Image is the natural choice for a cover or primary image. Task Gallery is for several references whose order matters.

## Supported references

Each value may be:

- a safe vault-relative path, such as `Assets/cover.png`;
- a wikilink or embedded wikilink, such as `[[Assets/cover.png]]` or `![[Assets/cover.png]]`;
- an `http://` or `https://` URL.

Operon resolves the reference without fetching it merely to classify it. An unsafe or unrecognized value remains stored as text but is treated as unresolved rather than opened as a path or URL.

## Gallery order and escaping

An inline `taskGallery` list uses semicolons between items and preserves the first occurrence of each distinct value:

```md
{{taskGallery:: Assets/front.png; Assets/back.png; https://example.com/detail.png}}
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

**Can I use a web image?** Yes, with an HTTP or HTTPS URL.

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
