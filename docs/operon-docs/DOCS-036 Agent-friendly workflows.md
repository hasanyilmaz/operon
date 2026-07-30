---
Notes: Why Operon's data works well for AI agents, and the rules that keep edits correct
Icon: bot-message-square
Color: "#9333ea"
Updated: 2026-07-30T11:46:09
---

# Agent-friendly workflows

Operon's data is a good fit for an AI agent, and for a concrete reason: tasks are plain Markdown with stable identity and stable field names. That makes them **legible** (an agent can read them as text), **stable** (the same task stays recognizable across edits), and **self-describing** (the meaning of each field is fixed and written down). An agent can read and change tasks reliably on that footing.

An agent works with the same task files and settings you do. There is no separate interface to learn; the same structure that keeps your tasks coherent is what an agent reads. There are now two paths for that work, and it is worth choosing between them up front.

## Two ways to work with Operon

An agent can work with Operon in either of two ways:

- **Directly in Markdown.** The agent reads and edits the task files in your vault, exactly as this page describes. It is simple and needs nothing installed, but it carries no version contract: the agent is responsible for reading correctly and not corrupting a task.
- **Through the Agent Runtime.** An agent or script can use `operon-cli`, while an Obsidian plugin can use the in-process Developer API. Both public surfaces report their capabilities, speak in canonical terms, and apply changes only after a preview. Start at [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]. For the CLI, continue to [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]] and [[DOCS-120 Your first safe task read|Your first safe task read]]. Plugin developers should start at [[DOCS-129 In-process Developer API overview|In-process Developer API overview]].

On that second path, a change does not have to be composed as JSON: readable commands such as `operon task complete --id <id>`, and compact fields such as `dateDue::"2026-08-01"`, drive the same verified writes, in [[DOCS-127 Everyday task commands|Everyday task commands]] and [[DOCS-126 Compact task syntax|Compact task syntax]].

The rest of this page describes the direct-Markdown path, which is what the guidance below assumes.

## Why it works well for agents

Four properties carry it:

- **Plain text.** Tasks are Markdown and YAML in your vault, so an agent reads and edits them directly, with nothing to integrate. This comes from Operon keeping tasks in your notes, the same thing that makes them readable to you.
- **Stable identity.** The `operonId` stays with a task through edits, moves, and renames, so an agent can refer to the same task again and not create a duplicate by mistake. See [[DOCS-015 Task identity and operonId|Task identity and operonId]].
- **Fixed field meanings.** Canonical keys keep `status`, `priority`, `dateDue`, and the rest meaning the same thing everywhere, so an agent targets a known field instead of guessing one. See [[DOCS-005 Operon core concepts|Operon core concepts]].
- **Self-describing settings.** Pipeline, priority, and custom-key descriptions say in plain words when each should be used. Filling them in puts your intent into the data itself, where an agent reads it. See [[DOCS-037 Pipelines and statuses|Pipelines and statuses]] and [[DOCS-038 Task priorities|Task priorities]].

## How an agent works with Operon

On the direct-Markdown path, an agent reads and writes the Markdown task files, and reads Operon's settings to learn your conventions. To act on a specific task by its `operonId`, it finds that task by searching the vault's Markdown. The work happens in the files, which is why the legibility above matters: the clearer and more consistent your tasks and settings, the more reliably an agent can work with them.

## The rule that keeps edits correct: match the property names

This is the one rule worth getting right, because field names depend on where the task lives:

- **Inline tasks** use the **canonical** key in `{{key:: value}}`. Canonical keys are fixed and identical in every vault, so an agent writing inline tasks just uses the canonical names. See [[DOCS-012 Inline task syntax|Inline task syntax]].
- **File-task frontmatter** uses your **visible** property names, which you can rename through [[DOCS-039 Key mappings|Key mappings]] (for example `priority` shown as `Tier`). An agent writing or reading file tasks reads your key mappings first to learn those names.

Operon's settings, including the key mappings, are stored in the plugin's data. See [[DOCS-044 Where Operon stores data|Where Operon stores data]] for the location.

## Recommended practices

These are habits for whoever runs the agent, not behaviors Operon enforces:

- **Read before writing.** Have the agent read the current task and the relevant settings first, so edits fit what is already there.
- **Let Operon assign identity.** Do not copy an `operonId` to make a second task; a fresh task gets its own id. See [[DOCS-055 Duplicate IDs|Duplicate IDs]].
- **Use `parentTask` for hierarchy.** When a task belongs under another, set the link rather than only indenting. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].
- **Generate repeatable trees with templates.** For linked structures, [[DOCS-061 operonId template variables|operonId template variables]] are steadier than writing ids by hand.

## When direct Markdown is the right choice

Direct Markdown is not a lesser option; it is the right tool for some cases:

- a quick, human-supervised edit you are watching happen;
- a setup where the CLI is not installed, or you do not want the dependency;
- a setup where the CLI transport is not suitable, including WSL;
- a simple one-off change where a full preview-and-apply cycle would be overhead.

For a repeatable, unattended, or higher-stakes integration, prefer the Runtime path. See [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]].

## Feeding these docs to an assistant

These pages are plain text that each stand on their own, so you can give the folder to an assistant as reference when you want it to work with your tasks using correct Operon conventions. See [[DOCS-002 How to use these docs|How to use these docs]].

## FAQ

**Why is Operon a good fit for agents?** Its tasks are plain, identified, and consistent, so an agent can read and change them reliably.

**What must an agent read before writing a file task?** Your key mappings, so it uses this vault's property names. Inline tasks need only the canonical keys.

**How does an agent find a task by `operonId`?** On the direct-Markdown path, by searching the vault's Markdown for the id. Through the Runtime, it resolves the id to an exact task instead; see [[DOCS-120 Your first safe task read|Your first safe task read]].

**Should my agent use the CLI, the Developer API, or edit Markdown directly?** Use `operon-cli` for a repeatable agent or script workflow. Use the Developer API inside an Obsidian plugin. For a quick edit you are supervising, direct Markdown is fine. See [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]].

**Is direct Markdown going away?** No. It stays a supported way to work. The Runtime adds a verified path where you want stronger guarantees; it does not replace editing your own notes.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]]
- [[DOCS-120 Your first safe task read|Your first safe task read]]
- [[DOCS-126 Compact task syntax|Compact task syntax]]
- [[DOCS-127 Everyday task commands|Everyday task commands]]
- [[DOCS-129 In-process Developer API overview|In-process Developer API overview]]
