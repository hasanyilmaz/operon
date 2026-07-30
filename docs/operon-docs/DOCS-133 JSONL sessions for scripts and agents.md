---
Notes: Run sequential command frames and concurrent ordered read groups through one machine-readable CLI session
Icon: rows-3
Color: "#059669"
Updated: 2026-07-30T19:58:24
---

# JSONL sessions for scripts and agents

> **Maturity:** Public CLI JSONL session protocol · Obsidian Desktop · CLI contract V1

`operon session --jsonl` keeps one machine-readable CLI process open for sequential commands and small concurrent read groups.

Use it when an agent or script needs several operations without starting a new CLI process for each one. Every stdin line is one closed JSON object. Every stdout line is one result or failure envelope. Do not mix human output or shell syntax into the stream.

## Single frames

A frame contains an `id`, an argument array, and optional structured stdin data:

```json
{"id":"health-1","argv":["health","--json"]}
{"id":"task-1","argv":["task","get","--input","-","--json"],"input":{"contractVersion":1,"requestId":"task-1","consistency":"live-verified","kind":"task-get","selector":{"kind":"operon-id","operonId":"<operon-id>"}}}
```

The session executes ordinary frames sequentially. It returns the same machine-readable command envelope with the frame ID and command exit code:

```json
{"id":"health-1","exitCode":0,"result":{"contractVersion":1,"kind":"cli-result"}}
```

The shortened result above shows the outer shape only. Consume the complete command envelope defined by the shipped session and command schemas.

## Concurrent ordered read groups

A read group contains between 2 and 8 child frames:

```json
{"id":"planning-reads","reads":[{"id":"health","argv":["health","--json"]},{"id":"query","argv":["query","--input","-","--json"],"input":{"contractVersion":1,"requestId":"query","consistency":"live-verified","kind":"task-query","limit":20}}]}
```

Read-group admission uses these canonical protocol IDs and CLI argument prefixes:

| Canonical protocol ID | Accepted `argv` prefix |
| --- | --- |
| `health` | `["health"]` |
| `task.get` | `["task", "get"]` |
| `tasks.query` | `["query"]` |
| `context.build` | `["context"]` |

Admission recognizes the CLI argument prefixes directly. Literal argument values such as `["tasks.query"]` or `["context.build"]` are not commands. All children must resolve to the same vault and compatible profile target.

Children run concurrently, but stdout preserves request order. A fast later child waits until every earlier child has produced its line. Each child has its own success or failure envelope, and the group ID does not receive a separate response. A complete group produces one output line per child. One child failure does not erase already ordered sibling results and does not turn the group into a mutation transaction.

Mutation commands are never allowed inside a read group. Submit them as ordinary sequential frames.

## Failure and abort behavior

Malformed JSON, invalid group bounds, unsupported grouped commands, and target drift produce structured frame-level usage failures, normally with exit `2`. Within one read group, child IDs must be unique and the group ID must differ from every child ID. Reusing an ID in a separate top-level frame is valid, although globally unique IDs make client correlation safer.

A frame failure does not normally terminate the JSONL process. After consuming its input, the process may exit `0` even when individual frames reported failures. Inspect every response envelope's `exitCode` and structured error instead of relying only on the process exit code or the human-readable `reason`.

If the process is interrupted before any mutation dispatch possibility, the session exits `130` and emits no recovery metadata. This means the interrupted operation did not cross the apply boundary.

After apply may have started, interruption, timeout, or transport loss is different. The affected frame emits exit `5`, `outcome-unknown`, and a recovery envelope containing the same `planRef`:

```json
{"id":"apply-1","exitCode":5,"error":{"contractVersion":1,"code":"outcome-unknown","reason":"Apply may have started.","retryable":false,"action":"recover-same-plan"},"recovery":{"required":true,"planRef":"<same-plan-ref>","action":"recover-same-plan","mutationMayHaveApplied":true}}
```

Recover only that stored plan:

```json
{"id":"recover-1","argv":["plan","recover","<same-plan-ref>","--json"]}
```

Do not submit a replacement preview, ordinary apply, or discard while the outcome is uncertain. CLI recovery records use `planRef`; Developer API recovery uses a separate opaque `recoveryRef`.

## Discover the live protocol

Read the shipped manifest and schemas instead of copying limits into an integration:

```bash
operon manifest --json
operon schema get session-frame --json
operon schema get session-read-group --json
operon schema get session-uncertain-result --json
```

## FAQ

**How many commands can a read group hold, and which ones?** Between two and eight children, drawn from exactly four commands: health, the exact task read, the bounded task query, and the context build. Anything else is not admitted into a group, and the manifest publishes both the bounds and the allowed set so a client can check rather than assume.

**Can I put a mutation in a read group?** No. Mutations are submitted as ordinary sequential frames. A read group is a way to overlap reads, not a transaction, so grouping writes would imply an atomicity the protocol deliberately does not offer.

**If children run concurrently, what order do results arrive in?** Request order, always. A child that finishes early waits until every earlier child has written its line, so you can correlate output positionally as well as by id. Each child gets its own envelope, and the group id itself never receives a response line.

**Does a failed frame kill the session?** Normally no, and this is the trap worth knowing: the process can still exit `0` after consuming its input even though individual frames failed. Inspect each response envelope's own exit code and structured error rather than trusting the process exit code alone.

**What are the rules for frame ids?** Inside a group, every child id must be unique and none may equal the group id. Reusing an id in a separate top-level frame is allowed, but globally unique ids make correlating responses safer, especially once groups and sequential frames are interleaved.

**What if I stop the session in the middle?** The protocol reports an interrupted abort. That is safe for reads, but if an apply had already been dispatched, the usual uncertainty rules apply: the outcome stays unknown and you continue through same-plan recovery rather than resubmitting the frame.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-121 Reading tasks and building context|Reading tasks and building context]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-128 Interactive shell and discovery|Interactive shell and discovery]]
- [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors and audit]]
