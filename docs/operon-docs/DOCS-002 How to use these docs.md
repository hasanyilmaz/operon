---
Up:
  - "[[DOCS-001 Operon Docs MOC|Operon Docs MOC]]"
  - "[[DOCS-003 Getting started with Operon|Getting started with Operon]]"
  - "[[DOCS-004 Operon system map|Operon system map]]"
Notes: How to read this bundle in Obsidian or hand it to an LLM
Icon: book-open
Color: "#334155"
tags:
  - operon
  - start
  - navigation
  - agent
Updated: 2026-07-11T13:50:20
---

# How to use these docs

This folder is the complete user documentation for Operon. It is written to be read three ways: inside Obsidian, as a downloaded folder, or by an AI assistant. Pick whichever fits how you work.

## Get these docs inside your vault

Operon can download the official docs directly into your vault. Open **Settings → Operon → Core → General**, find **Operon Docs**, use the searchable **Operon Docs folder** picker to choose an existing vault folder, then select **Download / update docs**. The default folder is `Operon/Docs`. Operon writes the managed docs there as normal Markdown files, so you can browse them with Obsidian links, search, graph view, or an AI assistant.

If the docs are already downloaded and you choose a different folder, Operon asks whether you want to move its managed `DOCS-*.md` files. Confirming moves those files to the new folder; cancelling keeps both the files and the setting in the current folder. Personal files are never moved, and a filename conflict in the new folder stops the change rather than overwriting anything.

If you want Operon to refresh the docs after plugin updates, enable **Automatically update Operon Docs** in the same section. It refreshes the selected folder, and only managed `DOCS-*.md` files are overwritten. If you want to edit a docs page for your own notes, copy it somewhere else first.

## Read it inside Obsidian

Open [[DOCS-001 Operon Docs MOC|Operon Docs MOC]] and follow the **Start here** path. The pages link to each other with normal Obsidian links, so you can click through related topics and use graph view to see how features connect. This is the best way to learn Operon step by step.

> **MEDIA-DOCS-002-1:** The selected Operon Docs folder open in Obsidian.

![MEDIA-DOCS-002-1 - Operon Docs folder in Obsidian](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-002-1.png)

## Read it as a downloaded folder

The folder is self-contained. You can copy it out of your vault, keep it anywhere, and read the files as plain Markdown in any editor. Every page is written to make sense on its own, so you do not need Obsidian to understand it.

## Ask an AI assistant about Operon

Because every page is plain text that stands on its own, you can hand the whole folder to an AI assistant and ask questions about Operon: how a feature works, which approach fits your case, or how to fix a problem.

A good way to do this:

1. Give the assistant this folder (or the files relevant to your question).
2. Ask in plain language, for example:
   - "I have a lot of small to-dos and a few big projects. Should I use inline tasks or file tasks?"
   - "How do I make a task repeat every Monday?"
   - "My tasks are not showing up in the Calendar. What should I check?"
3. Start from [[DOCS-003 Getting started with Operon|Getting started with Operon]] and [[DOCS-004 Operon system map|Operon system map]] if you want the assistant to understand the big picture before the details.

## What these docs cover

These docs are for **using** Operon. They do not cover building or contributing to the plugin. Operon changes between releases, so if a detail does not match what you see, your version may be newer or older than when a page was last updated; each page carries its own update date.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
