---
Notes: How a change goes from intent to a verified result through one sealed preview-and-apply model
Icon: square-pen
Color: "#059669"
Updated: 2026-07-30T19:36:17
---

# Changing tasks safely

> **Maturity:** Public Runtime write model · Writes live behind a sealed preview · Obsidian Desktop · Runtime API V1

Reading is only half of what the Runtime does. This page is about the other half: how a change goes from an intention to a verified result without ever writing from a raw instruction. Every write from the CLI or Developer API runs through the same model. The step-by-step CLI commands live in [[DOCS-127 Everyday task commands|Everyday task commands]] and the compact `key::"VALUE"` syntax in [[DOCS-126 Compact task syntax|Compact task syntax]]. Typed plugin calls are covered in [[DOCS-131 Developer API reads and typed mutations|Developer API reads and typed mutations]].

## The write model in one line

Every change follows the same four beats: **preview → sealed plan → apply → receipt**. You describe what you want, the Runtime shows exactly what that would do and seals it, you or an eligible routine CLI flow applies that same sealed plan, and you get back a receipt of what happened. Nothing skips a step.

## Two ways to drive a write

The Runtime exposes this model through two public surfaces:

- **CLI:** a readable command such as `operon task complete --id <id>`, compact fields, or a JSON intent through `--input`.
- **Developer API:** a typed mutation preview from another registry-verified Obsidian plugin.

They obey the same preview, apply, receipt, postflight, and same-plan recovery rules. Their handles differ. The CLI gives its local plan a `planRef`; the Developer API returns an opaque plan handle that includes a consumer-bound `recoveryRef`. That reference becomes usable only after durable dispatch. Do not pass a CLI `planRef` to the Developer API or treat a `recoveryRef` as a new mutation request.

## Preview before apply

No change is applied from a raw instruction. A write is first previewed, and the preview reports exactly what would happen: the fields that would change, the effects that ripple out, and anything that would be lost. Eligible routine direct CLI commands may apply an unchanged safe preview without a separate manual stop. Warnings, acknowledgements, confirmations, destructive actions, `--preview-only`, and typed or agent input stop for review or explicit handling as described below.

## The sealed plan

The preview is sealed into a plan that captures precisely the state it saw. In the CLI it is addressed by a `planRef`, shown in commands below as `<plan-ref>`. The Developer API keeps the sealed plan opaque. You or an eligible routine CLI flow applies the sealed plan, never a resubmitted raw payload. An undispatched routine or elevated plan expires within five minutes, while a destructive plan expires within 60 seconds, so an intention you formed and then walked away from cannot fire much later. If it expires before dispatch, preview again. Once dispatch may have begun, do not re-preview. Recover the same plan within the 24-hour recovery window. The guarantees behind the seal, vault identity, source revisions, and surface-specific access are described in [[DOCS-123 Security and trust boundaries|Security and trust boundaries]].

## When it applies automatically, and when it stops

Human write commands differ in whether they finish the change or stop at the preview, and the rule is worth knowing so a result never surprises you:

- An eligible **routine direct command** previews and then applies its plan automatically, but only when that plan is unchanged from what was sealed and carries no warning, acknowledgement, or confirmation.
- **`--preview-only`**, typed `--input`, and agent compact or compact-lines stdin stop at the preview and store the plan without applying it.
- **`--json` changes output only** for routine direct commands; it does not disable their safe auto-apply. Destructive JSON or non-interactive flows retain the plan because they cannot simulate fresh confirmation.
- Anything with a **warning, acknowledgement, or confirmation**, and any **destructive** action, stops instead of applying automatically.
- Cancelling a **guided or interactive** command before its confirmation applies nothing at all.

If you are ever unsure what happened, `operon plan show <plan-ref> --json` reports the stored plan's recorded state.

## Destructive changes need a fresh confirmation

Some changes cannot be undone by reading a previous value back. Deleting a task, converting a file task into an inline task, and removing a recorded timer session each require a fresh confirmation bound to that exact target and its disclosed losses, with the token the command asks for: `DELETE`, `CONVERT`, or `REMOVE`. You cannot broadly pre-authorize these; each asks again against the specific task in front of it, and automating past that confirmation removes the protection it exists to give.

## Working with stored plans

A sealed plan is a real object you can inspect and manage:

- `operon plan show <plan-ref> --json` shows the plan's recorded state and what it would do.
- `operon plan apply <plan-ref> --json` applies a stored plan you previewed earlier, preserving identity, confirmation, and idempotency.
- `operon plan recover <plan-ref> --json` re-drives a plan whose outcome is uncertain, without issuing a new change.
- `operon plan discard <plan-ref> --json` drops a plan you have resolved and no longer need.

These are CLI commands. A Developer API consumer applies its opaque plan handle in the current session, and uses `recoveryRef` only for restart-safe same-plan recovery. See [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors, and audit]].

## Idempotency and uncertain outcomes

A completed change is recorded so that replaying the same plan does not apply it twice. When an apply commits but its confirmation is lost, the result comes back as `outcome-unknown`, is not normally retryable, and carries same-plan recovery guidance. The correct move is never to re-issue the change from scratch. CLI callers recover the same `planRef`; Developer API callers recover the same opaque plan or its `recoveryRef`. Recovery evidence is retained for 24 hours. The full CLI symptom-to-action guide is in [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]].

## What you can change

The write surface covers the same operations you would perform by hand, each through the model above:

- **Create** a task, inline or file, on its own or as part of a small graph.
- **Update** fields, and **clear** them, on an exact task.
- Move a task through its lifecycle: **complete**, **reopen**, **cancel**, or an explicit **transition**.
- **Pin** and **unpin**.
- Maintain **reminders** and **recurrence**.
- Set **relationships**: parent, blocking, and blocked-by.
- **Relocate** an inline task, **convert** between inline and file, and **delete**.
- Control the **timer**, and edit completed **timer sessions**.

The exact commands and their targeting rules are in [[DOCS-127 Everyday task commands|Everyday task commands]]; the compact field syntax they share is in [[DOCS-126 Compact task syntax|Compact task syntax]]. For the authoritative list of mutation kinds and their capability versions, see [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]].

## FAQ

**Exactly how long does a sealed plan live?** A routine or elevated plan expires five minutes after it is created, and a destructive plan expires after 60 seconds, because a destructive intention should not sit around waiting. Those are deadlines for dispatch, not for how long you may think: once dispatch may have begun the plan stops being re-previewable and becomes recoverable instead, and its recovery evidence is kept for 24 hours.

**What exactly has to be true before a command applies on its own?** All of it, together: the stored plan still matches what was sealed, the preview and the plan carry no warnings, the plan requires no confirmation, it lists no required acknowledgements, and its risk level is routine. If any one of those fails, the command stops and keeps the plan for you.

**Is the confirmation word always `DELETE`?** No, it matches the action. Deleting a task asks for `DELETE`, removing a recorded timer session asks for `REMOVE`, converting a file task into an inline task asks for `CONVERT`, and relocating an inline task asks for `MOVE` when that relocation is destructive or otherwise confirmation-gated.

**Does adding `--json` stop a command from applying?** No. For routine direct commands `--json` changes the output format only, and the safe auto-apply still happens. What changes behavior is the nature of the plan: a destructive action in a JSON or non-interactive context cannot ask for a fresh confirmation, so it keeps the plan instead of applying it.

**An apply came back uncertain. Can I just preview again?** No. An uncertain result is reported as `outcome-unknown` and is deliberately not retryable, because re-issuing the change could apply it twice. Continue with the same plan through recovery, which re-drives that exact stored plan rather than creating a new one.

**Can I hand a CLI `planRef` to the Developer API, or the other way around?** No. The two surfaces keep deliberately separate handles: the CLI stores a local `planRef`, while the Developer API returns an opaque plan handle with a consumer-bound `recoveryRef`. A `recoveryRef` is a way back to one specific plan for the consumer that created it, not a mutation request you can replay elsewhere.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-118 Operon Agent Runtime overview|Operon Agent Runtime overview]]
- [[DOCS-121 Reading tasks and building context|Reading tasks and building context]]
- [[DOCS-123 Security and trust boundaries|Security and trust boundaries]]
- [[DOCS-124 Troubleshooting and recovery|Troubleshooting and recovery]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-126 Compact task syntax|Compact task syntax]]
- [[DOCS-127 Everyday task commands|Everyday task commands]]
- [[DOCS-131 Developer API reads and typed mutations|Developer API reads and typed mutations]]
- [[DOCS-132 Developer API recovery, errors and audit|Developer API recovery, errors, and audit]]
