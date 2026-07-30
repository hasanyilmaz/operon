---
Notes: What the Runtime verifies before it trusts a request, and what stays your responsibility
Icon: shield-check
Color: "#059669"
Updated: 2026-07-30T20:01:33
---

# Security and trust boundaries

> **Maturity:** Public Runtime trust boundary · Applies to CLI and Developer API · Local desktop use · Runtime API V1

This page describes what Operon verifies before it acts on a request, and where your own responsibility begins. It is about the guarantees the trust boundary gives you, not about calling any internal channel yourself. Reading it is the best way to understand why the write path asks for previews and confirmations instead of just doing what it is told.

## Two local trust boundaries

There is no network service, remote endpoint, or Runtime account. `operon-cli` reaches Operon inside your running Obsidian through a local owner-only channel. The in-process Developer API is available only to another enabled Obsidian plugin whose live instance Operon verifies. Your tasks and settings do not leave the machine as part of using either public Runtime surface.

## Owner-only access

The channel the CLI uses to reach the Runtime is private to your operating-system user account. It is scoped to your user and rejected if its ownership or location is not what Operon expects. Another user on the same machine, or a process running as someone else, cannot drive your Runtime through it. This is a guarantee Operon enforces; it is not something you configure or invoke.

## Developer API identity and grants

Developer API identity comes from the live Obsidian plugin registry. A copied manifest or caller-supplied plugin id is not identity proof. Health and capability discovery are available to a verified consumer without a grant. Other reads and all mutations require an exact active capability grant approved in Operon settings. New capabilities require separate approval, and a revoked or suspended grant closes new reads, previews, and applies.

Routine mutations can proceed under their exact grant. Elevated and destructive plans require Operon-owned consent bound to that plan, target, and disclosed effect. Caller-supplied identity, authorization, consent, acknowledgement, or idempotency values do not create authority. See [[DOCS-130 Developer API identity and capability grants|Developer API identity and capability grants]].

## Vault identity

Every request is bound to a specific vault by its identity, not just its path. If a vault is moved, replaced, or its identity no longer matches the profile that named it, requests fail instead of acting on the wrong vault. This is why the CLI asks you to run `setup` again after a vault moves: the identity check would rather stop than guess.

## Admission: only when ready

The Runtime admits reads and writes only when it is healthy. Right after Obsidian starts, or during a large reindex, it reports that it is still settling and declines rather than acting on a half-built view. You saw this from the read side as a retry hint in [[DOCS-120 Your first safe task read|Your first safe task read]]; the same admission gate protects writes. A refused request is the system working, not failing.

## Preview, seal, and expiration

No change is applied from a raw instruction. A change is first previewed, and the preview is sealed into a plan that captures exactly what would happen. You or an eligible routine CLI flow then applies that same plan through its reference, never by resubmitting a raw payload. An undispatched routine or elevated plan expires within five minutes, while a destructive plan expires within 60 seconds, so an intention you formed and then walked away from cannot quietly fire much later. If a plan expires before dispatch, preview again. Once dispatch may have begun, do not re-preview; recover the same plan within the 24-hour recovery window described below.

## Revision checks

A sealed plan is tied to the exact state the preview saw. Before an apply completes, the source revision of the task and the context it depends on must still match. If the task changed underneath you between preview and apply, the apply fails closed rather than overwriting the newer state. This is what makes "preview then apply" safe even when other edits are happening in the vault.

## Destructive actions need fresh confirmation

Some changes cannot be undone by reading a previous value back. Deleting a task, converting a file task into an inline task, removing a recorded timer session, and relocating an inline task when that relocation is gated each require a fresh confirmation bound to that exact target, including the disclosed content that would be lost. You cannot broadly pre-authorize these; each one asks again, against the specific task in front of it. If the target or its disclosed losses do not match the confirmation, the action does not proceed.

## Replay fencing and uncertain outcomes

A completed change is recorded so that replaying the same plan does not apply it twice. When dispatch may have begun but the result cannot be confirmed, Operon does not report success and does not silently retry. It returns `outcome-unknown` with same-plan recovery guidance. CLI recovery is bound to the original `planRef`; Developer API recovery is bound to the original consumer and opaque plan or `recoveryRef`. Recovery evidence is retained for 24 hours. See [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]] and [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors, and audit]].

## Fail-closed by default

When something does not line up, the write path refuses rather than proceeds. It fails closed on:

- a stale revision, where the task changed after the preview;
- a changed or mismatched vault identity;
- an unsupported platform or unsafe local transport;
- a raw apply payload instead of a sealed plan reference;
- an unconfirmed destructive action.

The common thread is that uncertainty produces a refusal, never a guess.

## Local data boundaries

The CLI keeps its own small records, including vault profiles, sealed plans, and receipts, on your machine and owner-only. Operon keeps Developer API grants, redacted security audit metadata, receipts, and private recovery records in its plugin storage. The audit does not expose task content, file paths, consent tokens, sealed plans, or authorization secrets. If durable audit storage is unavailable, new writes fail closed.

## What stays your responsibility

The boundary handles verification; judgment stays with you. Use `--preview-only` when you want to read a routine CLI preview before it can apply, review every retained warning or confirmation-gated plan, and confirm destructive actions deliberately rather than reflexively. Keep your operating-system account secure, since owner-only access is only as strong as that account. And do not script around the confirmations: the point of a fresh, target-bound confirmation is that a person decided, so automating past it removes the protection it exists to give.

## FAQ

**What does owner-only actually check?** The local request area must belong to your operating-system user and carry owner-only permissions, and individual request files are written owner-only as well. If the ownership or the permissions are not what Operon expects, the client refuses with a specific error rather than continuing on a channel it cannot vouch for. There is nothing to configure; the check simply has to pass.

**How is vault identity verified, if not by the path?** Setup records a hash of the vault alongside its canonical path, and later commands compare against that recorded identity. A vault that was moved or replaced no longer matches, so the command stops and asks you to run `setup` again instead of acting on whatever now sits at that path.

**What happens if Operon cannot write its security audit?** Writes stop. When the audit store is unavailable, mutation admission is closed, so a change is refused rather than applied without a durable record. Reads are unaffected, which is why an audit problem shows up as writes failing while everything else still answers.

**Can a plugin declare its own identity or its own consent?** No. Identity comes from the live Obsidian plugin registry rather than from anything the caller supplies, and grants are approved in Operon settings. Revoking or suspending a grant closes new reads, previews, and applies for that consumer, and elevated or destructive plans need Operon-owned consent bound to that exact plan and target.

**What if the task changes between preview and apply?** The apply fails closed. The sealed plan is tied to the exact revision the preview saw, so a task edited underneath you no longer matches and the newer state is never overwritten. Preview again to see the change and decide with current information.

**Can I script past a destructive confirmation?** No, and the design makes it deliberate rather than difficult. Each confirmation is bound to that one plan, its exact target, and the losses it disclosed, so it cannot be pre-authorized or reused. In JSON and non-interactive contexts nothing is confirmed at all; the plan is retained for a person to review.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-121 Reading tasks and building context|Reading tasks and building context]]
- [[DOCS-122 Changing tasks safely|Changing tasks safely]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-130 Developer API identity and capability grants|Developer API identity and capability grants]]
- [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors, and audit]]
