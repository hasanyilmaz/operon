---
Notes: Choose the right CLI read for a real task, from the Catalog to queries, relationships, and Context Packs
Icon: book-open
Color: "#059669"
Updated: 2026-07-30T19:32:00
---

# Reading tasks and building context

> **Maturity:** Public CLI read path · Reads live · Obsidian Desktop · CLI contract V1

Once you can read one task ([[DOCS-120 Your first safe task read|Your first safe task read]]), the next skill is choosing the right read for the situation. This page maps each read operation to the case it fits. You rarely need all of them. Some commands, `catalog`, `task get`, and `timer state`, build their request from flags. The others, `query`, `finder`, `relationships`, and `context`, take a JSON request through `--input`. The examples below supply those requests through real stdin with `--input -`, so search text and filters never sit on the command line or remain in persistent request files. Use a fresh unique `requestId` for every call. Every example uses `--profile main --json`. Each of these reads also prints a short readable line by default; `--json` is what you add when an agent or script will parse the output, and you can drop it when you are reading the result yourself.

If a manual workflow truly needs a file, use an owner-only temporary file outside the synchronized vault and delete it immediately after the command finishes.

## Start from the Catalog

Before reading tasks, read your conventions. The Catalog is the machine-readable view of the settings you already configured:

```bash
operon catalog --profile main --json
```

It reports your pipelines and statuses, priorities, key mappings, custom-key descriptions, reminder policy, saved filters, and task policies, without scanning a single task. This is where an agent learns *this* vault's vocabulary: the exact pipeline, status, priority, and tier ids to use in a filter, and what your custom keys mean. It is the read-side counterpart to [[DOCS-037 Pipelines and statuses|Pipelines and statuses]], [[DOCS-039 Key mappings|Key mappings]], and [[DOCS-040 Custom keys|Custom keys]]. Read it once, then use its ids everywhere else on this page.

## Read one exact task

When you want a specific task, resolve a reference to an `operonId` and read it, as in [[DOCS-120 Your first safe task read|Your first safe task read]]. The selector you choose decides how exact the match is:

- `operon-id` and `exact-locator` point at one known task.
- `exact-name` and `exact-path` match one note precisely.
- `search` matches by text and can return more than one candidate.

A `search` that matches several tasks resolves as **ambiguous**. That is a signal, not an error: narrow the query, or switch to an exact selector kind. Reach for `task get --id` whenever you already hold the id.

## Query a bounded set

To read a group of tasks, use a query. It takes a request through `--input`:

```bash
operon query --input - --profile main --json
```

A minimal request filters open tasks due by a date:

```json
{
  "contractVersion": 1,
  "requestId": "11111111-1111-1111-1111-111111111111",
  "kind": "task-query",
  "filters": { "checkbox": ["open"], "due": { "to": "2026-07-31" } },
  "limit": 50,
  "consistency": "live-verified"
}
```

Filters combine checkbox state (`open`, `done`, `cancelled`), pipeline, status, priority, and tier ids, a file path, a parent task, a due-date range, and free text. Use ids taken from the Catalog rather than guessing them. A query never returns your whole vault; it returns a bounded page.

## Paging and limits

A query result carries its own page information: how many tasks actually matched, how many were returned, whether the result was truncated, a cursor for the next page, and the moment the page reflects. When a result is truncated, pass its cursor back to read the next page:

```json
{
  "contractVersion": 1,
  "requestId": "22222222-2222-2222-2222-222222222222",
  "kind": "task-query",
  "filters": { "checkbox": ["open"], "due": { "to": "2026-07-31" } },
  "limit": 50,
  "cursor": "<returned-next-cursor>",
  "consistency": "live-verified"
}
```

Keep the original filters and consistency unchanged, preserve the page limit when you want the same page size, use the returned `nextCursor`, and generate a fresh `requestId`. Bounds exist so a single read stays predictable in size and time. Treat "read the next page" as the normal way to walk a large set, not as an error path. If the Runtime returns `stale-cursor`, restart from page one and never combine pages from different Context revisions.

## Search the way the Task Finder does

A query filters; the Finder searches. When you want Operon's own Task Finder behavior, its matching, ranking, scopes, and project modes, rather than a plain filtered set, use the typed finder read:

```bash
operon finder --input - --profile main --json
```

A request states the search text and how to bound it:

```json
{
  "contractVersion": 1,
  "requestId": "33333333-3333-3333-3333-333333333333",
  "kind": "task-finder",
  "text": "release notes",
  "scope": "overdue",
  "limit": 25,
  "consistency": "live-verified"
}
```

`text` is the search phrase, and `scope` narrows to `normal`, `overdue`, `happens-today`, or `recent`. You can also restrict `representations` to inline or file tasks, and set `project` to `direct` or `tree` to search within one project. Filters work as they do in a query, except that text, file path, and parent belong to the Finder's own fields rather than the filter block. Results rank and page the same way. On a Finder continuation, keep `text`, `filters`, `representations`, `scope`, and `project` unchanged, use the returned cursor, and generate a fresh `requestId`.

There is also an interactive `operon task find`, which is the human, TTY version of this same search; it is covered in [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]]. For an agent or a script, use the typed `finder` read above.

## Follow relationships

To see how a task connects to others, read its relationships:

```bash
operon relationships --input - --profile main --json
```

Supply a minimal exact-task request through stdin:

```json
{
  "contractVersion": 1,
  "requestId": "44444444-4444-4444-4444-444444444444",
  "kind": "relationship",
  "selector": { "kind": "operon-id", "operonId": "abc1234" },
  "consistency": "live-verified"
}
```

Edges come in kinds: parent, child, blocking, blocked-by, related, ancestor, and project-member. Each edge also carries a **provenance class** that tells you how it was known: `explicit` (you wrote the link), `derived` (Operon computed it from structure, such as an ancestor chain), or `inferred` (a weaker signal, which may carry a reason and a confidence). Trust `explicit` and `derived` edges for decisions; treat `inferred` ones as hints to confirm.

## Build a Context Pack

When you need the situation around a task rather than a single record, build a Context Pack:

```bash
operon context --input - --profile main --json
```

A Context Pack is a single bounded bundle assembled for one **purpose**. You state the purpose, `read`, `analysis`, `planning`, `creation`, or `mutation-readiness`, and the pack is shaped and sized for it. This is the read you use to hand an agent everything it needs for one decision in a single call, instead of stitching together many small reads.

## Choose a projection

Alongside the purpose, a Context Pack takes a **projection** that decides its shape and reach:

- **exact-task**: one task, no neighbors.
- **task-neighborhood**: a task and its immediate links.
- **project-analysis**: a whole project tree, the deepest and widest reach.
- **planning-workload**: a bounded planning view across matching tasks. It does not accept a depth parameter and returns at most 250 tasks.
- **creation-context**: the surroundings needed to create a new task correctly.
- **mutation-preview**: the context needed to prepare a specific change.
- **placement-candidates**: the live insertion points used to place a task at an exact inline line.

Each projection has its own default and hard item limits. Projections that traverse relationships also have depth limits; projections such as planning-workload do not accept a depth parameter. A minimal request names purpose and projection:

```json
{
  "contractVersion": 1,
  "requestId": "55555555-5555-5555-5555-555555555555",
  "kind": "context",
  "purpose": "planning",
  "projection": "planning-workload",
  "consistency": "live-verified"
}
```

For the exact current limits of each projection, see [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]] or read the schema with `operon schema get context-request --json`.

## Ask for the right amount of detail

Reads return a task's core fields by default. When you need more, ask for it explicitly through the `include` list: notes, links, custom fields, source Markdown, tracker history, or reminder items. Each of these is capped per task, so a read cannot balloon. Request only what the current decision needs; hydrating everything on every read is slower and rarely necessary.

## Read timer state

To see the current timer without touching it:

```bash
operon timer state --profile main --json
```

This tells you whether a timer is running and, if so, which task it is assigned to, or that it is unassigned, as a readable line by default or as `--json`. It only reads. Starting and stopping a timer is a change, covered in [[DOCS-122 Changing tasks safely|Changing tasks safely]].

## Freshness and source verification

Every read reports how current its view was, an "as of" moment, and exact reads are verified against their source in your vault. For an agent, this matters: a result is a snapshot as of a stated time, not a live subscription. If you need to be sure nothing moved between reading and acting, read again as of a fresh moment, and lean on the same freshness signals the mutation path checks before it writes. See [[DOCS-123 Security and trust boundaries|Security and trust boundaries]].

## Choosing the right read

- One known task: `task get --id`.
- A reference you are not sure of: `entity resolve`, then `task get`.
- A group by state, date, or field: `query`, then page through it.
- A ranked search with Operon's own Finder behavior: `finder`.
- How a task connects to others: `relationships`.
- Everything around a task for one decision: `context` with the fitting projection.
- The current timer: `timer state`.
- This vault's ids and conventions: `catalog`, first.

## FAQ

**What is the difference between `query` and `finder`?** A query filters: you state conditions and get a bounded page of everything that matches. The finder searches: it applies Operon's own matching, ranking, scopes, and project modes, so it is what you want when you are looking for something rather than listing a known set.

**When should I build a Context Pack instead of making several reads?** Use a pack when one decision needs the situation around a task, because it arrives as a single bounded bundle shaped for that purpose. Use individual reads when you need one narrow fact, such as a task's current status, where a pack would be more than the question deserves.

**I got `stale-cursor` while paging. What now?** Start again from the first page. That signal means the underlying Context revision moved, and pages from different revisions must never be combined into one result set.

**Do I need to read the Catalog before every read?** No. Read it once for the ids and conventions of this vault, then reuse them. Read it again when settings may have changed, such as after someone edits pipelines, priorities, or key mappings.

**Why not just request every `include` field on every read?** Each hydration field is capped per task, so asking for everything makes reads slower without making them more complete. Request what the current decision needs, and add fields when a later step actually requires them.

**Can I act on an `inferred` relationship?** Treat it as a hint to confirm rather than a fact. `explicit` edges are ones you wrote and `derived` edges are computed from structure, so those are the ones to base a decision on.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-120 Your first safe task read|Your first safe task read]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]]
