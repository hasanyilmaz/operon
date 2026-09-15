---
Notes: Show a person image on assignee chips using a property in the linked person note
Icon: contact
Color: "#0F766E"
Updated: 2026-09-15T12:10:53+02:00
---

# How to show assignee images

An assignee chip can show a person's image beside their name. You keep the image reference in that person's note, then tell Operon which property to read. There is no image upload inside Operon: the chip uses an existing image in your vault or a direct web image URL.

This guide uses **Bobby** and a property named `photo`. You can choose another property name. The setting applies only to assignees; it does not change other fields or the task's own [[DOCS-138 Task images and galleries|Task Image and Task Gallery]].

> **MEDIA-DOCS-143-1:** Bobby's image displayed in an assignee chip, alongside the person note's photo property and the Assignee image property setting.

## Step 1: Add an image reference to Bobby's note

Create or open `Bobby.md`. The person note can be an ordinary note; it does not need to be a File Task. Put Bobby's image in your vault, for example at `Assets/bobby.jpg`, then add a **Text** property called `photo` to the note.

In Source Mode, its frontmatter would look like this:

```yaml
---
photo: "[[Assets/bobby.jpg]]"
---
```

If Bobby's note already has properties, add `photo` to its existing frontmatter rather than adding a second frontmatter block. Keep the quotes around a wikilink in YAML so it remains a text value.

You can also use a local image path or a direct image URL as the property's single value:

```yaml
photo: "https://example.com/bobby.jpg"
```

Replace that example address with a working image URL. A profile page URL is not an image source: Operon does not extract a person's photo from a web page. Local references are resolved from Bobby's note, not from the task's note.

## Step 2: Choose the source property

Open **Settings → Operon → Interface → Task Chips → General Chip Settings**, at the bottom of the Task Chips list. In **Assignee image property**, enter `photo`.

Suggestions help you find existing vault property names, but you can type a name that is not suggested. Use the exact property name from the person note. This is one shared setting: each linked person's note supplies its own image from that property.

The setting is empty by default. Clearing it restores the usual assignee icons without removing any images or properties from your notes.

## Step 3: Assign the linked person

Set the task's **Assignees** value to `[[Bobby]]`, using the assignees field or the task's stored metadata. An inline task example is:

```md
- [ ] Review the launch checklist {{operonId:: {{operonId}}}} {{assignees:: [[Bobby]]}}
```

The `{{operonId}}` template variable lets Operon supply the task ID when you paste the example. See [[DOCS-061 operonId template variables|operonId template variables]].

Use a wikilink, not just the text `Bobby`. Plain names remain valid assignees, but Operon does not guess which note they refer to. For File Tasks, set the same linked value through the Assignees field; your visible property name follows your [[DOCS-039 Key mappings|key mappings]].

## What you will see

Where an assignee chip is shown, a valid image replaces its usual field icon. The person's name and existing link behavior remain available. Chip visibility still follows your per-surface [[DOCS-041 Task chips display and behavior|Task Chips settings]].

In Table and embedded Table assignee columns:

- **Detailed cells** show each person separately, with their image or usual icon beside the name.
- **Compact cells with one assignee** show that person's image when available.
- **Compact cells with multiple assignees** keep the usual assignees icon; the tooltip shows the names.

## If the usual icon still appears

The usual icon is the fallback, including while an image loads. Check that:

- **Assignee image property** contains the exact property name.
- The assignee is a wikilink to an existing Markdown note.
- That note's property contains one nonempty text value, not a list or object.
- The referenced image exists and can load. For a web image, the URL must return an image the app can access.

A missing note, empty property, unsupported value, or failed image load keeps the usual icon. Operon does not show a broken image in its place.

## FAQ

**Must the property be called photo or avatar?** No. Choose the name you already use and enter it in Assignee image property.

**Does Operon copy or upload the image?** No. It reads the reference from the person note and displays the image from that source.

**Can each person have a different image?** Yes. Use the same property name in each person's note, with a different image value.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-041 Task chips display and behavior|Task chips: display and behavior]]
- [[DOCS-069 Task link and list pickers|Task link and list pickers]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
