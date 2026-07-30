---
Notes: Symptom-to-action guide for setup, availability, freshness, and uncertain outcomes
Icon: wrench
Color: "#059669"
Updated: 2026-07-30T20:01:33
---

# Troubleshooting and recovery

> **Maturity:** Public CLI diagnostics and recovery · Obsidian Desktop · CLI contract V1

This page goes from symptom to action using supported `operon-cli` commands. Keep one thing in mind as you read: most refusals are the system working correctly, not failing (see [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]). The real skill here is choosing the right recovery command, especially when a change committed but its result is uncertain.

## Start with doctor

Whatever the symptom, start here:

```bash
operon doctor --profile main --live
```

In one command this checks your platform and its live-transport status, that the profile resolves to a real vault, that Operon is installed there, and that the Runtime answers. A clean `doctor --live` rules out most setup and availability problems at once. If it fails, its output points at which of those layers is wrong.

## Runtime not ready or unavailable

If a command reports the Runtime is unavailable, read health directly:

```bash
operon health --profile main --json
```

The usual causes are Obsidian not running, the Runtime still settling right after startup, or a large reindex in progress. Health tells you whether reads and writes are admitted and, when it is settling, roughly how long to wait. Wait that long and try again. This is a temporary state, not a fault.

## A request was refused

A refusal means a request failed closed on purpose. Match the cause to the fix:

- **Stale revision:** the task changed after your preview. Preview again and re-apply.
- **Changed vault identity:** the profile no longer matches its vault. See "Vault moved" below.
- **Unconfirmed destructive action:** deletion (`DELETE`), file-to-inline conversion (`CONVERT`), removing a recorded timer session (`REMOVE`), and a gated inline relocation (`MOVE`) each need a fresh, target-bound confirmation. Confirm against the exact target with the token the command asks for.
- **Raw apply payload:** apply goes through a sealed plan reference, not a raw request. Preview to get a plan, then apply that.

None of these are retried by force; each is fixed by addressing the cause.

## A command was not recognized

A misspelled or misused command fails fast with a usage error (exit code `2`) rather than doing anything. The message names the specific problem and, for a near miss, suggests the command it thinks you meant. These checks are local: they work without opening a vault or contacting the Runtime. When you are unsure of the exact form, narrow down with help instead of guessing:

```bash
operon task --help
```

A group's help lists only its own commands, so you can walk from `operon --help` to the exact command and its options.

## Degraded or unavailable capabilities

If a command says a capability is degraded or unavailable, confirm the current picture:

```bash
operon capabilities --profile main --json
```

A degraded capability is available but constrained; an unavailable one cannot run right now. Both are usually tied to Runtime readiness, so the fix is often to wait and retry, exactly as in the availability case. If a capability stays unavailable while health is otherwise good, treat that operation as not offered in this state and defer it.

Some newer write features, such as compact creation with reminders or recurrence, relationship replacement, source transitions, and timer-session edits, are additionally gated behind an advertised capability version that both the CLI and Operon must agree on. If they disagree, the command fails closed before touching anything, rather than acting on a half-supported feature. The fix is to bring both sides up to date so they advertise the same version: update `operon-cli`, and update Operon in the vault.

## Stale or unexpected data

If a read looks older than you expect, check its freshness, the "as of" moment in the result. Right after edits or during settling, the index may briefly lag. Re-read as of a fresh moment first. If data still looks wrong after the Runtime reports it is ready, rebuild the index from inside Obsidian and read again; see [[DOCS-091 Rebuild full index|Rebuild full index]]. Reads are safe to repeat, so re-reading is always a reasonable first move.

## Vault moved or identity changed

If you see that the configured vault identity changed, the client is refusing to act on what might be the wrong vault. This is expected after moving or replacing a vault. Fix it by running setup again for that vault:

```bash
operon setup --vault "/new/path/to/vault" --name main --default
```

## Platform support

The platform section of `doctor` shows the current transport status. macOS is supported. Native Linux and Windows 11 are public beta and best-effort, so `doctor` warns that the environment is not native-certified but still checks and uses the transport. Include the platform, Obsidian and Node versions, `doctor --json` output, and structured error code when reporting beta feedback. WSL is unsupported, and a live transport refusal there is a platform limit rather than a setup error.

## Reading exit codes

Every command sets an exit code. For scripting, branch on the code, not the text:

- `0` success
- `2` usage error
- `3` unavailable
- `4` refused
- `5` runtime failure
- `70` internal error
- `130` interrupted before dispatch, with no uncertain outcome

The full, authoritative list lives in [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]. A `3` says a read or preview dependency is temporarily unavailable. A `4` says to fix the request, capability, authority, or policy condition. Exit `130` applies only when interruption happened before dispatch and no mutation outcome is uncertain. Once apply may have been dispatched, interruption, timeout, or transport loss uses exit `5` with `outcome-unknown` and same-plan recovery.

## Did it apply, or only preview?

Direct convenience mutation commands can differ in whether they finish the change or stop at a preview, and the rule is worth knowing so a result never surprises you. A routine selector or compact argv command, such as `task complete` or a simple `task update`, previews and then automatically applies that plan only when it is unchanged and carries no warning, acknowledgement, or confirmation. Passing `--json` changes output only and does not turn an otherwise eligible direct argv command into preview-only mode. Passing `--preview-only`, using typed `--input`, or feeding raw compact or `compact-lines` stdin stops at the preview and stores the plan without applying it. Anything with a warning, acknowledgement, or confirmation also stops. Destructive JSON or non-interactive calls retain the plan instead of simulating a fresh confirmation. Cancelling a guided or interactive command before its confirmation applies nothing at all.

Explicit execution and recovery commands follow the same output distinction. `plan apply`, `plan recover`, and `mutation apply` can dispatch an already reviewed plan while returning JSON. In every case, `--json` selects the output format; it is not a promise that a command is preview-only. If you are unsure what happened, `operon plan show <plan-ref> --json` reports the stored plan's recorded state.

## A sealed plan expired

Undispatched routine and elevated plans expire within five minutes; destructive plans expire within 60 seconds. If you preview a change and apply it too late, the apply is refused because the plan expired. Inspect what you had with:

```bash
operon plan show <plan-ref> --json
```

If the plan was never dispatched, preview again to get a fresh plan and apply that. Expiry is a safety feature: it stops a stale intention from firing long after you formed it. If dispatch may have begun, do not create a new preview. Use same-plan recovery instead.

## Outcome unknown and lost responses

This is the case to handle carefully. Sometimes an apply commits but its confirmation is lost, the response never arrives, or the result comes back as `outcome-unknown`. **Do not blindly re-apply**, which risks doubling the change. Instead, recover through the stored plan, which is idempotent:

```bash
operon plan recover <plan-ref> --json
```

`plan recover` re-drives the same stored apply rather than issuing a new one, so a change that already committed is not applied twice. Use `operon plan show <plan-ref> --json` first if you want to see the plan's recorded state, and `operon plan discard <plan-ref> --json` to drop a plan you have resolved and no longer need.

CLI recovery evidence is retained for 24 hours after dispatch. Recover within that window using the same `planRef`. After it expires, the CLI reports `plan-expired` rather than presenting the mutation as recoverable. This `planRef` is specific to the CLI. Developer API consumers use an opaque plan handle or consumer-bound `recoveryRef`, as described in [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors, and audit]].

## Safe retry rules

The rules are simple and worth internalizing:

- **Reads** can be retried freely; they change nothing.
- **A raw apply** is never automatically retried. Fix the cause and preview again.
- **An uncertain apply** is recovered with `plan recover`, not re-issued from scratch.
- **An interrupted pre-dispatch command** can end with exit `130` and has nothing to recover.
- **An interrupted post-dispatch command** ends with exit `5`, `outcome-unknown`, and same-plan recovery.
- **Confirmations** must be fresh and target-bound; a stale confirmation does not carry over.

## FAQ

**What separates exit `3`, `5`, and `130`?** They answer different questions. `3` means the operation could not start, so trying later is reasonable. `5` means an apply may already have been dispatched and the result is not certain, so recovery is the next step rather than a retry. `130` appears only when a command was interrupted before dispatch, which is why it is safe: nothing was in flight to leave behind.

**Do I have to guess which errors are worth retrying?** No, and you should not. The manifest publishes an error registry that states, for each error code, whether it is retryable, what action it expects, whether recovery applies, and which exit code it maps to. Read that once with `operon manifest --json` and let your scripts branch on it instead of on message text.

**What happens if I miss the 24-hour recovery window?** The stored record is removed and the plan reports as expired. Recovery evidence is deliberately not kept forever, so an uncertain outcome should be resolved the same day rather than left. After that point the honest move is to read the current state of the task and decide from what is actually there.

**Can I just discard a plan whose outcome is unknown?** No. Discard refuses for a plan that still needs recovery, so you cannot clear an uncertain result out of the way without resolving it. Recover it first; discard is for plans you have already settled.

**A plan expired, but it might have been applied. Should I preview again?** Only if nothing was dispatched. An undispatched plan simply expires and re-previewing is correct. If dispatch may have begun, the plan refuses ordinary use and tells you recovery is required, because a second preview would risk applying the same change twice.

**Why did a `plan` command fail with an ownership or permission error?** Stored plans are kept owner-only, so the CLI checks both who owns the plan file and that its permissions are not broader than your own account. If either check fails, it refuses rather than trusting a plan that another account could have touched. Fix the ownership or permissions of the CLI's local files, and do not place them on a share that relaxes them.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-119 Install and verify Operon CLI|Install and verify Operon CLI]]
- [[DOCS-121 Reading tasks and building context|Reading tasks and building context]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors, and audit]]
