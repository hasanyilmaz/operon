---
Notes: Working by hand with the interactive shell, contextual help, guided wizards, and shell completion
Icon: square-terminal
Color: "#059669"
Updated: 2026-07-30T19:51:40
---

# Interactive shell and discovery

> **Maturity:** Public CLI interactive use · Obsidian Desktop · Human-facing · CLI contract V1

Everything else in this set describes commands you type in full. This page is about working by hand: the interactive shell, the help and suggestions that let you find a command without memorizing it, the guided wizards that walk a change end to end, and the completion scripts for your own shell. These forms share the same underlying contracts and safety rules as [[DOCS-127 Everyday task commands|Everyday task commands]], even when their invocation and output modes differ.

## The interactive shell

Running `operon` with no arguments opens an interactive, Obsidian-style shell where you can issue commands one after another in a single session:

```bash
operon
```

In a non-interactive context, such as a script or a pipe, the same bare command prints a short starting guide instead of trying to open a session. So the friendly entry point never gets in the way of automation.

## Finding your way: help and suggestions

You do not need a vault open, or even the Runtime running, to explore the command surface. Contextual help works at every level:

```bash
operon --help
operon task --help
operon help plan recover
```

A group's help lists only its own commands, so you narrow from the whole surface down to the exact command and its options. If you mistype, the CLI answers with a command-specific usage error (exit code `2`) and, for a near miss, suggests the command it thinks you meant. All of this is local and safe: it neither opens a vault nor contacts the Runtime.

## Tab completion, history, and cancellation

Inside the shell, pressing Tab completes commands, options, and their safe values from the same registry the CLI uses, so there is no second list to drift out of date. The session keeps a history you can recall, filtered so sensitive values are not retained. Cancelling before dispatch exits without an uncertain mutation. If apply may have been dispatched, cancellation follows the same exit `5` and same-plan recovery rule as a direct command. The shell is a convenience over the same commands, not a different mode.

## Human-readable output and `--json`

Most result-producing direct commands print a short, readable result by default and accept `--json` for the full machine-readable envelope. `completion` is the deliberate exception: it prints only the requested shell script. Guided wizards require an interactive terminal and do not turn into JSON mode. For automation, use the command's typed `--input <file|-> --json` form or its documented machine route; that reaches the same Runtime contract without running the wizard.

## Guided task creation

When you run `task create` without compact fields, the CLI opens a creation wizard instead of asking you to know the syntax up front. It uses the vault's live targets, pipelines, statuses, priorities, templates, and supported custom fields, so the choices it offers are the real ones for this vault. At the end it shows a sealed preview and asks whether to apply it, following the model in [[DOCS-122 Changing tasks safely|Changing tasks safely]].

Guided creation makes one task. Compact line batches use explicit file or stdin commands, stay preview-only, and are documented in [[DOCS-126 Compact task syntax|Compact task syntax]].

## Guided Task Finder

`task find` is a read-only guided finder over the live index. It offers the current workflow and priority filters, ranks and pages the matches, and revalidates the exact task you select before showing its details. Because it only reads, it is a safe way to locate the task you want before acting on it with a command from [[DOCS-127 Everyday task commands|Everyday task commands]].

## Guided edits and lifecycle

The same guided style covers changes. Running the update, transition, reminder, and timer commands without their flags walks you through them: guided field updates, semantic status transitions, fixed and relative reminder maintenance, and starting or stopping the timer against a task you pick interactively. Each is driven by the vault's live Catalog and ends in a reviewed sealed plan, so a guided edit is as verified as a typed one.

## Guided relocation, conversion, deletion, and recovery

Guided flows also cover the source transitions and recovery. Relocation, inline-and-file conversion, and deletion present live placement candidates and exact targets, show the reviewed effects, and ask for the operation-specific confirmation where one is required, such as `CONVERT` or `DELETE`. If an apply was interrupted, the guided recovery flow continues through the same stored plan rather than starting over; the underlying rules are in [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]].

## Shell completion scripts

To get the same completion outside the interactive shell, in your own Zsh, Bash, or Fish, generate a script:

```bash
operon completion zsh
operon completion bash
operon completion fish
```

Each prints a static completion script built only from the command registry, including the compact task representation and input-format choices. It never modifies your shell profile and never reads a vault; you install it the way your shell installs any completion script, for example by sourcing it from your shell configuration.

## FAQ

**What does the shell keep in its history?** Very little, on purpose. History lives only in the current session, and it works as an allowlist rather than a filter: a small set of safe commands is remembered, and even those only when what follows is help or `--json`. Anything carrying a value, such as an id, an input path, a profile, a vault path, or a confirmation, is treated as sensitive and is not retained.

**Does a command behave differently inside the shell?** No. The shell resolves and runs the same commands from the same registry, against the same contracts, with the same results. It is a convenience over the command surface, not a separate mode with its own rules.

**Can I run a guided wizard from a script?** No. Guided flows need an interactive terminal and do not fall back to JSON. For automation, use the same operation's typed form with `--input <file|-> --json`, which reaches the identical Runtime contract without prompting.

**What happens if I press Ctrl+C in the middle of a command?** If nothing was dispatched, the command exits with the interrupted code and leaves no uncertain change behind. If an apply may already have been dispatched, the exit reports a runtime failure instead, and you continue through same-plan recovery rather than rerunning the command.

**Does the shell talk to the network?** Only to tell you when a newer CLI exists, when the shell opens. That check sends nothing about your vault, is cached, and can be turned off entirely by setting `OPERON_CLI_UPDATE_CHECK=0` or `NO_UPDATE_NOTIFIER=1`.

**Do I need to regenerate the completion script after an upgrade?** Yes, if the command surface changed. The script is generated from the command registry at the moment you run `operon completion`, so regenerating it is how new commands and options appear. It never edits your shell profile and never reads a vault, so regenerating is safe to repeat.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-126 Compact task syntax|Compact task syntax]]
- [[DOCS-127 Everyday task commands|Everyday task commands]]
