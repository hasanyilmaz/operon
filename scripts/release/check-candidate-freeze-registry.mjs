#!/usr/bin/env node

import { checkCandidateFreezeRegistry } from './check-release-freeze-registry.mjs';

const result = await checkCandidateFreezeRegistry();
console.log(
	`Operon ${result.freeze.pluginArtifact.version} / CLI ${result.binding.package.version} candidate evidence registry verified.`,
);
