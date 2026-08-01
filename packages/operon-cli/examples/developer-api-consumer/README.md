# Developer API consumer example

This minimal Obsidian plugin demonstrates the public, in-process Operon
Developer API V1. It imports only type declarations from
`@stratejya/operon-cli/contracts/v1/developer-api`; `@stratejya/operon-cli` is not a runtime SDK.

## Try it

1. Install this folder's development dependencies.
2. Run `npm run check`.
3. Bundle `main.ts` using your normal Obsidian plugin build.
4. Enable Operon and this example plugin in the same desktop vault.
5. Run **Operon Developer API example: Discover API access**.
6. If the request is pending, approve its exact capabilities under
   **Operon Settings > Developer API Integrations**, then run the command again.

`runRoutineUpdate(target, note)` contains an exact task read, a routine
`task.update` preview, apply, and write-free receipt replay. Call it only with a
target read from the same live Runtime. If apply returns `outcome-unknown`, keep
the returned `recoveryRef` and call `recoverAfterRestart(recoveryRef)` after
reconnecting. Do not create a replacement preview or call ordinary apply again.

The example passes its actual plugin instance to Operon. Copying its manifest
fields cannot establish consumer identity.

The example intentionally contains no lockfile, bundled output, SDK helper,
private Operon import, raw mutation request, authorization value, consent token,
acknowledgement, or idempotency key.
