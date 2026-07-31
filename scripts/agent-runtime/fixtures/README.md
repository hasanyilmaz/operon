# Operon Agent Runtime Phase 1 fixtures

This directory is a development-only, sanitized behavior baseline. Nothing here
is imported by Operon's production runtime.

The baseline deliberately has two layers:

- `legacy-skill-output` records the observable behavior of the current
  `operon-task` Python renderer without copying its personal profile.
- `canonical-plugin-creation` locks the relevant behavior of Operon's current
  TypeScript creation primitives.

Every behavior is classified in `parity-delta-manifest.json` as:

- `must-preserve`
- `intentional-correction`
- `obsolete`

The old `reminders` field is recorded only as legacy drift. The canonical
baseline uses `reminderDatetimes` and `reminderRules`.

`compact-create-golden.json` is a development-only syntax contract for the
planned CLI compact-create compiler. It does not enable a public command or
change vault inline syntax. Its cases lock optional `inline`/`file`
representation routing, canonical-key-only field names, semantic inline-value
parity, strict raw-stdin quoting, list delimiter/escaping rules, and currently
unavailable temporal creation capabilities. Its stable case IDs are the future
link points for CLI parser, Runtime, and skill-template snapshot tests; those
surfaces must not copy the examples into separate sources of truth.

`compact-update-golden.json` locks the CLI-only direct-update parser cases for
mixed assignments and clears, scalar `::`, Unicode normalization, duplicate
keys, set/clear conflicts, and empty mutations. Runtime update schemas remain
unchanged; the fixture is consumed only by development validators and CLI
tests.

`human-cli-command-golden.json` is the development-only authority for the
human-first CLI cookbook. It locks each copyable command, public command ID,
route, behavior, confirmation class, and category minimum. Compact-create
entries point back to `compact-create-golden.json`; skill validators compare
the marked cookbook fences byte-for-byte rather than treating prose as a
second command source.

`typed-create-golden.json` is the single development-only source for advanced
typed create recipes. It locks exact inline/File targets, deterministic
templates, File Task body replacement, same-source graph atomics, cross-source
parent/related confirmation, and the cross-source reciprocal-dependency
blocker. Contract, Runtime, CLI, and skill validators link to its case IDs
instead of maintaining independent example payloads.

## Validate

```bash
python3 scripts/agent-runtime/fixtures/validate_fixtures.py
node scripts/agent-runtime/fixtures/run-fixture-tests.mjs
```

The Python validator checks fixture schemas, digests, required coverage, and
privacy. The TypeScript contract test exercises Operon's current serializer,
custom field ordering, reminder keys, inheritance, file-task template merge,
and the compact-create syntax contract against the canonical goldens.
