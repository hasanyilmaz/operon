# Operon Phase 1 transport harness

This directory contains development-only transport measurement tools. It is not
part of the Operon production runtime and must not be imported from `main.ts`.

## Safety model

- Live calls require both an explicit Obsidian vault reference and a local vault
  path used only to compute a canonical SHA-256 identity.
- Request-file transport uses a random token under the fixed per-user OS temp
  root returned by `fixedRequestRoot()`. The CLI never supplies an arbitrary
  file path to the plugin.
- The request directory is `0700`; one-shot request files are `0600`, regular,
  owner-matched files written through an atomic hard-link publication step.
- Both handler and client attempt cleanup. Failure never falls back to argv.
- Argv transport is rejected unless the caller explicitly asserts that the
  payload is synthetic and non-sensitive.
- Evidence stores byte counts, hashes, timings, and structured probe results,
  never payload bytes, stderr text, CLI arguments, or physical vault paths.

The development handler must resolve `requestToken` using the same fixed root,
repeat the regular-file/owner/mode checks, open with `O_NOFOLLOW` when available,
and consume the file after reading it.

## Probe invocation contract

Request-file:

```text
obsidian vault=<name-or-id> operon:transport-probe \
  channel=request-file requestToken=<32-character-token>
```

Argv:

```text
obsidian vault=<name-or-id> operon:transport-probe \
  channel=argv probeVersion=1 requestId=<id> operation=digest \
  expectedVaultSha256=<sha256> payload=<base64url> \
  inputBytes=<bytes> inputSha256=<sha256> outputBytes=0 delayMs=0
```

For `operation=generate`, the development handler may include an additional
base64url `generatedPayload` field. The client verifies its exact byte size and
digest in memory and persists only that digest record.

## Local commands

Pure tests:

```sh
node --test scripts/agent-runtime/transport/transport.test.mjs
```

Dry-run evidence:

```sh
node scripts/agent-runtime/transport/client.mjs \
  --dry-run --vault-path /path/to/sanitized-vault
```

Warm measurements default to 30 calls:

```sh
node scripts/agent-runtime/transport/benchmark.mjs warm \
  --vault-ref <name-or-id> --vault-path /path/to/sanitized-vault
```

Size measurements:

```sh
node scripts/agent-runtime/transport/benchmark.mjs sizes \
  --vault-ref <name-or-id> --vault-path /path/to/sanitized-vault
```

Cold launch measurements are deliberately interactive and require explicit
opt-in. The harness never closes or kills Obsidian:

```sh
node scripts/agent-runtime/transport/benchmark.mjs cold \
  --allow-cold-launch --count 5 \
  --vault-ref <name-or-id> --vault-path /path/to/sanitized-vault
```

Synthetic argv visibility can be confirmed without storing the process list:

```sh
node scripts/agent-runtime/transport/benchmark.mjs argv-visibility \
  --allow-process-inspection \
  --vault-ref <name-or-id> --vault-path /path/to/sanitized-vault
```

This mode asks the probe to delay for three seconds, checks the process list for
the fixed synthetic sentinel and its base64url form, then persists only booleans
and a digest of the process-list snapshot.

`--output` accepts only a safe JSON basename. Raw machine evidence is written
with mode `0600` under the fixed owner-only local directory:

```text
/private/tmp/operon-agent-runtime-results/phase1-transport.json
```

Example:

```sh
node scripts/agent-runtime/transport/benchmark.mjs warm \
  --output phase1-transport.json \
  --vault-ref <name-or-id> --vault-path /path/to/sanitized-vault
```
