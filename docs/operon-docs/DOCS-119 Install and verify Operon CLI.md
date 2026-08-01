---
Notes: Install operon-cli, point it at your vault, and confirm it with doctor
Icon: terminal
Color: "#059669"
Updated: 2026-07-30T19:29:41
---

# Install and verify Operon CLI

> **Maturity:** Public CLI setup · Obsidian Desktop · Node 22, 24, or 26 · CLI contract V1

By the end of this page you have `operon-cli` installed, pointed at your vault through a saved profile, and confirmed with a live `doctor` check. This page only covers getting to a working, verified installation. Reading and changing tasks come afterward, starting with [[DOCS-120 Your first safe task read|Your first safe task read]].

## Before you start

`operon-cli` is a thin client. It does not hold its own copy of your tasks; it reaches Operon inside a running Obsidian and reads the live index. That means a few things have to be in place first:

- **Node.js 22, 24, or 26.** The CLI supports these major lines and refuses unsupported versions.
- **Obsidian desktop with the official Obsidian CLI enabled.** The client talks to Operon through Obsidian's own command-line interface, so that has to be turned on. See the next section.
- **Operon with Agent Runtime API V1.** The vault you point at must have Operon installed and current enough to expose the V1 Runtime.
- **A supported or beta platform.** macOS is supported. Native Linux and Windows 11 are public beta and best-effort. WSL is unsupported. On WSL, setup and offline checks may run, but live transport does not.

## Enable the official Obsidian CLI

The client depends on Obsidian's own command-line interface being active. If it is off, `operon-cli` can still read its local files, but no command that needs the live Runtime, including a live `doctor`, will reach the plugin. Turn the Obsidian CLI on before you continue. If the `obsidian` executable is not on your `PATH`, you can point the client at it with `--obsidian-bin` on any command.

## Install the package

Install globally:

```bash
npm install --global @stratejya/operon-cli
```

Confirm the install and your Node version in one step:

```bash
operon version --json
```

A successful result reports the CLI version and the Node version it is running on. This command is fully local; it does not touch your vault. Like every command, it prints a short readable line by default, so `--json` is only needed when a script will parse the output.

## Create a vault profile

A profile is a saved alias for one vault, so later commands can say `--profile main` instead of repeating the full path. Create one with `setup`:

```bash
operon setup --vault "/path/to/your/vault" --name main --default
```

`--name` is the alias, and `--default` makes this the profile used when you do not name one. `setup` checks that Operon is actually installed at that path before saving anything. Add `--live` to also verify the running Runtime during setup:

```bash
operon setup --vault "/path/to/your/vault" --name main --default --live
```

## What setup stores, and what it does not

`setup` writes a small, owner-only profile record. It stores only the alias, the canonical vault path, a hash of that path, and the time it verified the vault. It does not copy your tasks, and it does not read or change any Operon setting. Removing a profile later never touches the vault it pointed at.

## Verify with doctor

`doctor` is how you confirm everything lines up. Run it against your profile with a live check:

```bash
operon doctor --profile main --live
```

A healthy result confirms three things: your platform and its live-transport status, that the profile resolves to a real vault with Operon installed, and, because of `--live`, that the Runtime answered a diagnostics request. The command exits with code `0` on success and prints a line like `Operon doctor: vault and plugin valid, Runtime verified.`

On native Linux or Windows 11, `doctor` also identifies the platform as public beta and best-effort. Include the platform, Obsidian and Node versions, `doctor --json` output, and structured error code when reporting a problem.

You can also run `doctor` without `--live` to check the platform, the vault, and the plugin without contacting the Runtime, which is useful when Obsidian is not open.

## Reading the result

Every command prints a short human-readable line by default and a full machine-readable object with `--json`. That is the same two-track split you will see throughout: read the plain line when you are working by hand, add `--json` when an agent or script consumes the result. Success is exit code `0`. A non-zero exit means the command was refused, the Runtime was unavailable, or something failed; the exit codes and their meanings are listed in [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]. For scripting, always pass `--json` and read the exit code rather than the text.

## Manage your profiles

If you work with more than one vault, or on more than one machine, you can keep several profiles:

```bash
operon profile list
operon profile default main
operon profile remove old-vault
```

`profile list` shows what is configured, `profile default` changes which profile is used when none is named, and `profile remove` deletes a profile record. None of these touch a vault's contents.

## If verification fails

The most common first-run failures are:

- **Obsidian is not running, or the Obsidian CLI is not enabled.** A live command cannot reach the Runtime. Open Obsidian and enable its CLI.
- **The vault path or its identity does not match.** If you moved the vault, its stored identity no longer matches and the client will ask you to run `setup` again.
- **The platform does not support live transport.** `doctor` reports this in its platform section.

For the full symptom-to-action guide, including availability, freshness, and uncertain outcomes, see [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]].

## Discover commands

You do not have to memorize the command surface. Running `operon` with no arguments opens an interactive session, and help is available at every level without opening a vault or contacting the Runtime:

```bash
operon --help
operon task --help
```

A group like `operon task --help` lists just its own commands, so you can find your way by narrowing down. The interactive session, its Tab completion, and the guided flows have their own page: [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]].

## FAQ

**Does Obsidian have to be open for every command?** Only for the ones that need live data. `version`, help, `profile list`, and `doctor` without `--live` are local and run with Obsidian closed. Anything that reads or changes tasks needs a running Obsidian with its CLI enabled.

**Can one installation serve several vaults?** Yes. Keep a profile per vault and name it with `--profile` on each command. The one case that is refused is two separately registered vaults whose folders have the same name, because Obsidian's own CLI selects a vault by folder name; rename one folder before setup.

**What happens if I move or rename my vault?** The stored identity no longer matches, so live commands stop instead of acting on what might be the wrong vault. Run `setup` again for the new path and the profile is valid once more.

**Does setup change anything in my vault or in Operon?** No. It writes an owner-only profile record holding the alias, the canonical path, a hash of that path, and the time it verified the vault. It never copies tasks and never touches an Operon setting, and removing a profile later leaves the vault untouched.

**Why does `doctor` pass without `--live` but fail with it?** Without `--live` it checks only what it can see locally: the platform, the vault path, and that Operon is installed there. Adding `--live` also requires the Runtime to answer, so a failure there points at Obsidian not running, its CLI being off, or the Runtime still settling rather than at your setup.

**Can I target a vault without creating a profile?** Yes. Any command accepts `--vault "/path/to/your/vault"` directly. Profiles exist so you do not have to repeat the path, not because the CLI requires one.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-120 Your first safe task read|Your first safe task read]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]]
