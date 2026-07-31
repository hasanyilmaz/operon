# Operon CLI Speed Stage 1

This directory contains the fail-closed aggregation layer for the live CLI
performance suite. The aggregation runner cannot start Obsidian or mutate a
vault. `cli-speed-stage1-live.mjs` is the separate live collector/orchestrator.

The only accepted vault is `/private/tmp/cli-test-vault`. The guard requires an
exact path, exact realpath, `/private/tmp` parent, `cli-test-vault` basename,
directory type, and a non-symlink target.

The runner consumes normalized samples:

```sh
node scripts/agent-runtime/performance/cli-speed-stage1.mjs \
  --vault /private/tmp/cli-test-vault \
  --samples /private/tmp/operon-agent-runtime-results/samples.json \
  --compare /private/tmp/operon-agent-runtime-results/prior-baseline.json
```

It writes the canonical result to
`/private/tmp/operon-agent-runtime-results/cli-speed-stage1.json` and emits the
same JSON on stdout. Probe stage timings are diagnostic only; performance gates
use production-run sample timings.

The live collector covers cold health/capabilities/catalog/creation context;
warm task get/query/small Context Pack; compact and typed create; inline and
File Task update; transition, reminder, timer, relocation, inline-to-file
conversion, delete; and same-source batch create. Every mutation family gets a
fresh production fixture. Apply verification covers the unchanged stored plan,
postflight, final live state, unrelated fixture digest, and settings
fingerprint. Workflow summaries report both wall time and the measured number
of Runtime `obsidian` dispatches.

Tail and concurrency characterization are opt-in:

```sh
node scripts/agent-runtime/performance/cli-speed-stage1-live.mjs --tail --concurrency
```

`--tail` runs a 64-item write burst followed by at least 100 reads; p99 is
reported only for this tail sample. `--concurrency` compares isolated 3- and
6-writer sequential/parallel scenarios. It never blindly retries an apply;
uncertain outcomes recover only the same stored plan before the next reset.
Disabled optional modes remain explicitly `notCollected`.

`OPERON_CLI_SPEED_SMOKE=1` reduces core families to one sample and skips
warmups. Full sample counts can be overridden with:

- `OPERON_CLI_SPEED_COLD_SAMPLES`
- `OPERON_CLI_SPEED_WARM_SAMPLES`
- `OPERON_CLI_SPEED_WARMUPS`
- `OPERON_CLI_SPEED_BATCH_SAMPLES`
- `OPERON_CLI_SPEED_BATCH_WARMUPS`
- `OPERON_CLI_SPEED_TAIL_SAMPLES` (minimum 100)

## Stage 7 compact multi-update

Stage 7 measures the compact-lines update surface:

```sh
operon task update --input-format compact-lines --input - --json
```

It accepts only the guarded `/private/tmp/cli-test-vault`. The live runner
writes its resumable unit checkpoint to
`/private/tmp/operon-agent-runtime-results/stage7-close/checkpoint.json` and
the canonical final evidence to
`/private/tmp/operon-agent-runtime-results/cli-speed-stage7.json`.

The fixed profile collects five probe samples; 20 paired single, update-5, and
update-20 workflows; five update-64 retention samples; a 75-logical-update
mixed workload; and a 300-logical-update soak. The soak uses bounded batch
transactions and counts logical targets, rather than running 300 separate
transactions. Gates retain every raw sample and require exact plan
correctness, three Runtime dispatches, one source write/reindex/settlement/
receipt/postflight parse per successful batch, the approved speed floors, and
zero leak deltas.
