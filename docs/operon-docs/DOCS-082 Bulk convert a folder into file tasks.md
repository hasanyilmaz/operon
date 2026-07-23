---
Notes: Adopt many existing notes as Operon file tasks in one pass
Icon: folder-input
Color: "#0F766E"
Updated: 2026-07-23T16:45:34
---

# Bulk convert a folder into file tasks

When you already have a lot of notes that are really tasks, you do not have to open each one. Operon's **Convert notes** tool adopts many notes as [[DOCS-013 File tasks|file tasks]] in a single pass, matching them by a rule you choose. It is the fastest way to bring an existing system in, and it is the engine behind [[DOCS-093 How to migrate from TaskNotes|migrating from TaskNotes]].

> **MEDIA-DOCS-082-1:** The Convert notes panel with a match rule chosen and a scan result.

![MEDIA-DOCS-082-1 - Convert notes scan result](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-082-1.png)

## Where it lives

Open **Settings → Operon → Tasks → File Tasks** and find **Convert notes** (Convert notes to file tasks).

## Choose a match rule

You convert by selecting which notes qualify. There are three rules:

| Rule | Matches notes that | Good for |
|---|---|---|
| Folder | live inside a chosen folder | a folder that holds your task notes |
| Tag | carry a chosen tag | tasks marked by a tag |
| Property | have a frontmatter property with an exact value | notes flagged by a property |

Excluded folders are always skipped, whatever the rule. You must choose a rule before scanning.

## Scan, review, convert

The flow is deliberately a scan first, then a confirmed conversion:

1. **Scan vault.** Operon reports the result: how many files match the selection, how many can be converted, how many already are file tasks, and how many sit in excluded folders.
2. **Review** the list of eligible files so you know exactly what will change.
3. **Convert Files.** Operon converts the eligible notes.

If the result or any target file changes between the scan and the conversion, Operon asks you to scan and confirm again, so you never convert a stale list. After converting, it rebuilds the index.

## What conversion does

Conversion is additive and safe. For each eligible note, Operon **adds an `operonId` and the mapped modified-time property, and preserves your existing frontmatter values**. The note keeps its body and properties; it simply becomes a file task. Nothing is renamed or removed.

This is why mapping comes first when you migrate: if you set your [[DOCS-039 Key mappings|key mappings]] and any [[DOCS-040 Custom keys|custom keys]] before the scan, your existing property names are already understood when the notes are adopted.

## FAQ

**Does it overwrite my frontmatter?** No. It preserves your existing values and adds only what Operon needs to treat the note as a task.

**What if I run it twice?** Notes that already are file tasks are reported as such and not converted again.

**Can I convert just part of my vault?** Yes. Use a folder, tag, or property rule to target exactly the notes you mean, and convert in batches.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
