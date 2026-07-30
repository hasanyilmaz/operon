---
Notes: Read one real task end to end with operon-cli, from health to task get
Icon: play
Color: "#059669"
Updated: 2026-07-30T19:32:00
---

# Your first safe task read

> **Maturity:** Public CLI read path · Reads live · Obsidian Desktop · CLI contract V1

This page walks one real read from start to finish: confirm the Runtime is ready, see what you are allowed to read, find a task, and read it. Every command is copyable. You should be able to finish without opening a reference page. The examples use a profile named `main` and pass `--json`. Every command also prints a short readable line by default, so `--json` is the form you add when a script or agent will read the output; working by hand, you can leave it off and read the line.

## Before you begin

You need a verified installation from [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]], with `operon doctor --profile main --live` passing, and Obsidian open so the Runtime is live. If `doctor` is green, you are ready.

## Step 1: Check the Runtime is ready

Never assume the Runtime can be read; ask it.

```bash
operon health --profile main --json
```

A healthy result reports that the Runtime is live, that it will admit reads, and how fresh its view of your vault is. If it reports that it is still settling, it also tells you how long to wait before retrying. Reading health first means a later command does not fail for a reason you could have seen up front.

## Step 2: See what you can read

Capabilities are discovered, not assumed. Ask which operations are available right now:

```bash
operon capabilities --profile main --json
```

The result lists each capability and whether it is available, degraded, or unavailable. For this read you are looking for the task read and resolution capabilities to be available. Discovering capabilities keeps your workflow honest: you act on what the Runtime says it can do at this moment, not on what you expect it to support.

## Step 3: Find the task you want

If you already know a task's `operonId`, skip to Step 4. Otherwise, turn a loose reference into an exact id with `entity resolve`. Resolution takes a small JSON selector. For a script or agent, supply it through real stdin so that search text never sits on the command line or remains in a persistent request file:

```json
{
  "contractVersion": 1,
  "requestId": "11111111-1111-1111-1111-111111111111",
  "kind": "entity-resolve",
  "selector": { "kind": "search", "query": "quarterly report" },
  "consistency": "live-verified"
}
```

Use a fresh unique value for `requestId` on every call. Send the JSON block through real stdin and resolve:

```bash
operon entity resolve --input - --profile main --json
```

When working manually with a file instead, use an owner-only temporary file outside the synchronized vault and delete it immediately after the command finishes.

A **resolved** result gives you one exact task and its `operonId`. An **ambiguous** result means the reference matched more than one task; narrow the query, or use a more exact selector kind such as `exact-name` or `exact-path`. You can see the full selector shape any time with `operon schema get entity-resolve-request --json`, and worked selector examples are in [[DOCS-121 Reading tasks and building context|Reading tasks and building context]].

## Step 4: Read the exact task

With an `operonId` in hand, read the task itself. This one needs no JSON request body; the id goes in a flag:

```bash
operon task get --id <operonId> --profile main --json
```

The result is the exact task, read straight from Operon's live index and verified against its source, with its canonical fields, status, priority, dates, and relationships. This is the core outcome of the page: one task, read reliably, without parsing any Markdown yourself.

## Understanding the result

Every runtime command returns the same envelope. `ok` tells you whether the call succeeded. `result` holds the payload, here the task. A freshness section tells you how current the underlying view was when the read ran. Because the read is source-verified, a successful `task get` reflects what is actually in your vault, not a stale cache. The default human line is a deliberately compact readable summary of that same result; for scripting, branch on the exit code and read `result` from the `--json` output rather than parsing the line.

## One common failure

The failure you are most likely to hit first is a Runtime that is not ready yet. Right after Obsidian starts, or during a large reindex, `health` may report that reads are not admitted and give a short retry hint. Wait that long and try again. The other common one is an **ambiguous** resolve in Step 3, which is not an error so much as a signal to be more specific. For anything beyond these, including availability, freshness, and uncertain outcomes, see [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]].

## What you just avoided

In four commands you read a task without opening a note, without parsing frontmatter or inline syntax, and without guessing this vault's field names. The Runtime spoke in canonical terms, confirmed it was ready before you leaned on it, and verified the read against the source. That is the difference between reading through the Runtime and editing Markdown by hand: the same data, with the guessing removed.

## FAQ

**Do I have to run `health` and `capabilities` before every read?** No. Check them the first time, and again when a long-running process resumes after a pause or after Obsidian restarts. For a series of reads in one sitting, one check at the start is enough; the point is never to assume readiness that you have not confirmed at least once.

**If I already know a task's `operonId`, do I still need `entity resolve`?** No. Resolution exists to turn a loose reference into an exact id. With the id in hand, go straight to `task get --id`, which is both faster and unambiguous.

**Can I reuse the same `requestId` to keep my scripts simple?** No. Generate a fresh unique value on every call. It identifies that one request, so repeating a value makes results harder to match to the call that produced them.

**Why send the JSON through stdin instead of a file?** Search text passed on the command line can show up in shell history and process listings, and a request file left behind keeps that text on disk. Real stdin avoids both. When you do need a file while working by hand, keep it outside the synchronized vault and delete it as soon as the command finishes.

**Is an ambiguous result an error?** No, it is the system declining to guess. Your reference matched more than one task, so narrow the query or switch to a more exact selector kind such as `exact-name` or `exact-path`.

**How current is the result I just read?** It is a snapshot as of the moment the read reports, verified against its source in your vault rather than served from a stale cache. It is not a live subscription, so if something must not change between reading and acting, read again just before you act.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]]
- [[DOCS-121 Reading tasks and building context|Reading tasks and building context]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
