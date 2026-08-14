# Operon Agent Runtime V1 contract validation

`run-contract-tests.mjs` treats the JSON Schemas and pure TypeScript decoders as
two implementations of the same transport-neutral contract.

The runner:

- compiles every Draft 2020-12 schema entrypoint;
- runs the same valid and invalid fixtures through JSON Schema and TypeScript;
- rejects schema/decoder registry drift;
- checks capability and mutation invariants that JSON Schema cannot express;
- rejects Obsidian, Electron, Node filesystem, DOM, storage and production graph
  dependencies in the portable contract source.

Run from the Operon plugin root:

```sh
node scripts/agent-runtime/contracts/run-contract-tests.mjs
```

The Plugin-provider integration command is `agent-runtime:contracts:plugin`.
`agent-runtime:contracts` remains a backwards-compatible alias for that
Plugin-only lane. The exact published-CLI binding, tarball, and historical
freeze checks live in the separate manual `check:cli-compat` lane and never
block normal Plugin validation. Ajv 8 is an explicit development dependency;
it is test-only and is not imported by production Operon code.
