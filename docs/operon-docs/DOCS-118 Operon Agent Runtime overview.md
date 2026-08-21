---
Notes: What the Agent Runtime is, why it exists, and how its two public surfaces differ
Icon: bot-message-square
Color: "#059669"
Updated: 2026-08-21T16:12:57
---

# Operon Agent Runtime overview

> **Maturity:** Public Runtime contract · Reads and writes live · Obsidian Desktop · Runtime API V1

The Agent Runtime is how an outside program, an agent, a script, or another Obsidian plugin works with your Operon tasks through a stable, verified doorway instead of editing your Markdown by hand. It reads Operon's live state, your settings and its task index, and it accepts changes only as explicit intentions that are previewed and sealed before apply. It has two public surfaces: `operon-cli` and the in-process Developer API.

## What the Agent Runtime is

Operon already keeps your tasks as plain Markdown, which is what makes them workable for an agent at all. The Runtime adds a second, safer path on top of that same data: a versioned interface that answers questions about your tasks and settings, and that applies changes only through a previewed and sealed plan.

It exists because direct file editing, while supported, gives an agent no guarantees. Field names can differ between vaults, an index can be mid-rebuild, and a half-understood edit can quietly corrupt a task. The Runtime removes that guesswork. It reports its own health, it speaks in Operon's canonical vocabulary, and it refuses to apply a change it cannot verify. You get the legibility of plain Markdown with the safety of a checked contract.

## Two public surfaces

Use **`operon-cli`** when a person, agent, or script works from a terminal or subprocess. The CLI requires running Obsidian, the official Obsidian CLI, and its local owner-only transport.

Use the **in-process Developer API** when another enabled Obsidian plugin integrates with Operon. It requires running Operon but does not use the official Obsidian CLI. The host verifies the calling plugin, and access beyond health and capability discovery requires exact capability grants. Start at [[DOCS-129 In-process Developer API overview|In-process Developer API overview]].

The two surfaces share Runtime API V1, capabilities, structured errors, mutation safety, receipts, and postflight verification. Their trust and recovery handles are deliberately different. CLI plans use a local `planRef`. Developer API calls use an opaque plan handle during the session and a consumer-bound `recoveryRef` for restart-safe recovery. Neither surface is a shortcut into Operon's private internals.

## The layers behind the public surfaces

When you use either public surface, four internal layers do the work. You do not address them yourself, but knowing they exist makes the Runtime's behavior and safety rules easier to understand:

- **Property Catalog** reports your conventions: pipelines, priorities, key mappings, custom-key descriptions, reminder policy, and saved filters. It is the machine-readable view of settings you already configured, so an agent uses your names and rules instead of guessing them.
- **Context Engine** answers read questions: resolve a task from a loose reference, read one exact task, run a bounded query, follow relationships, or assemble a focused context pack for a specific purpose.
- **Mutation Gateway** handles every change through the same preview-and-apply discipline, so nothing is written directly from a raw request.
- **Surface-specific trust boundary** verifies either the local CLI owner or the calling Obsidian plugin. It is covered in [[DOCS-123 Security and trust boundaries|Security and trust boundaries]].

## Reads and writes

The Runtime does both halves through the CLI and Developer API, and reads are still where you start.

**Reads are live and usable now.** Reading the catalog, resolving and reading tasks, querying, following relationships, building context, and reading timer state are available through the appropriate public surface.

**Writes are live too, behind a sealed preview.** Creating, updating, transitioning, converting, relocating, and deleting tasks all go through the Mutation Gateway's preview-to-apply model. The Runtime computes exactly what a change would do, seals that plan, and applies only that same plan. Nothing is written from a raw request. Eligible routine direct CLI commands may apply an unchanged warning-free plan without a separate manual stop. Typed CLI input, agent stdin, `--preview-only`, and any warning, acknowledgement, confirmation, or destructive gate retain the plan for review or explicit handling. Developer API callers use typed mutation inputs and their own capability and consent rules. The read journey never depends on the write path, so you can rely on reads on their own.

The additive task-workflow extension also supports Daily and Weekly semantic creation and scheduled-date parent realignment. The caller states intent; Operon owns settings, templates, Markdown, container registration, and recovery. Updating a periodic relationship never physically moves the existing task. See [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]].

## Who this is for

Four readers arrive here, and each has a short route:

- **An Operon user working with an agent** who wants to understand the safer path. Start at [[DOCS-036 Agent-friendly workflows|Agent-friendly workflows]] for the plain-Markdown model, then return here.
- **A CLI operator** who wants to install the tool and get a result, using readable human commands rather than raw JSON. Go straight to [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]], then [[DOCS-120 Your first safe task read|Your first safe task read]].
- **An integration developer** building against the CLI's JSON contract. Read this page, then [[DOCS-123 Security and trust boundaries|Security and trust boundaries]] and [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]].
- **An Obsidian plugin developer** using the in-process API. Continue to [[DOCS-129 In-process Developer API overview|In-process Developer API overview]].

## The direct-Markdown boundary

Reading and editing Operon's Markdown directly is still a legitimate way to work, for you and for an agent, and it is not going away. It is simply not a versioned integration contract: there is no health signal, no capability list, and no verified apply behind it. For a supported agent or automation integration, `operon-cli` is the recommended path. For a quick, human-supervised edit in your own vault, plain Markdown is often the simplest thing. [[DOCS-036 Agent-friendly workflows|Agent-friendly workflows]] explains where each one fits.

## Maturity and platform at a glance

- **Agent Runtime foundation:** shipped.
- **Property Catalog and Context Engine:** live.
- **Mutation Gateway:** live through both public surfaces, every change behind a sealed preview-and-apply.
- **macOS:** supported.
- **Native Linux and Windows 11:** public beta and best-effort while native feedback is collected.
- **WSL:** unsupported.

Requirements and platform support in detail live in [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]] and [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]].

## FAQ

**Which surface should I use, the CLI or the Developer API?** Use the CLI when the caller is a person, an agent, or a script running from a terminal or a subprocess. Use the Developer API when the caller is another enabled Obsidian plugin running inside the same app. If both would work, the CLI is the simpler one to reason about, because its trust boundary is your own user account rather than a capability grant.

**Do I need the Runtime to work with an agent at all?** No. An agent can still read and edit Operon's Markdown directly, and that stays supported. The Runtime is what you reach for when you want guarantees rather than good intentions: health before use, canonical field names, and a change that is verified before it is written.

**Can I call the Property Catalog, Context Engine, or Mutation Gateway directly?** No. They are internal layers, not parallel public APIs, and they carry no compatibility promise of their own. Everything you build against goes through one of the two public surfaces.

**Are writes safe to rely on now, or should I stay with reads?** Writes are live, and every one of them goes through the same sealed preview-and-apply. Reads are still the sensible place to start, and they never depend on the write path, so you can adopt the two in whatever order suits you.

**Does the Runtime work when Obsidian is closed?** No. The Runtime lives inside Operon inside a running Obsidian, and the CLI is a thin client that reaches it. With Obsidian closed, local commands such as version and help still work, but nothing that needs live data.

**Is any of my data sent anywhere?** Your tasks and settings are not. Both Runtime surfaces are local, with no remote endpoint and no account, which is covered in [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]. The one outbound request the CLI makes is unrelated to your vault: opening the interactive shell checks the published package versions to tell you when a newer CLI exists. It sends nothing about your vault, caches the answer for a day, and you can switch it off by setting `OPERON_CLI_UPDATE_CHECK=0` or `NO_UPDATE_NOTIFIER=1`.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-036 Agent-friendly workflows|Agent-friendly workflows]]
- [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]]
- [[DOCS-120 Your first safe task read|Your first safe task read]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-127 Everyday task commands|Everyday task commands]]
- [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]]
- [[DOCS-129 In-process Developer API overview|In-process Developer API overview]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
