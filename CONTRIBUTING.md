# Contributing to Operon

Thank you for considering a contribution to Operon.

## License

By contributing to Operon, you agree that your contribution is licensed under the same license as the project: GNU General Public License version 3 or later (`GPL-3.0-or-later`).

You must have the right to submit the work you contribute. Do not submit code, assets, text, or other material that you do not have permission to license under `GPL-3.0-or-later`.

## Development Checks

Before submitting a Plugin change, run the Plugin-only source checks from this directory:

```bash
npm run check
```

This runs strict ESLint validation, the Plugin Runtime contract checks, and one
production build. It does not require an Operon CLI checkout, package, tarball,
or published CLI binding.

`npm run check:cli-compat` is a separate, manual compatibility lane. Run it
only when the work explicitly changes CLI integration support or when reviewing
historical CLI compatibility evidence. A CLI follow-up never blocks a Plugin
change or Plugin release.

Use `npm run lint:report` to inspect the current Obsidian ESLint warning state.

The maintainer vault may also include `npm run phase5:regression` for local validation. The Phase 5 harness is not part of the public source repo or release assets.

Keep changes focused, preserve existing vault data compatibility, and avoid unrelated formatting or refactoring.

## Branding

Contributions to the official project may use Operon branding as part of the official codebase. Forks and modified distributions must follow [TRADEMARK.md](TRADEMARK.md).
