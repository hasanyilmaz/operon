import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectRuntimeProviderV1Baseline } from './runtime-provider-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);

/**
 * Reports the likely state of the existing CLI without invoking it, reading its
 * repository, fetching a package, or affecting Plugin eligibility.
 */
export async function inspectCliImpactV1(options = {}) {
	try {
		const inspection = options.inspection ?? await inspectRuntimeProviderV1Baseline(options);
		return classifyCliImpactV1(inspection?.changes);
	} catch {
		return cliImpact('unknown', 'runtime-baseline-unavailable');
	}
}

export function classifyCliImpactV1(changes) {
	if (!Array.isArray(changes)) return cliImpact('unknown', 'runtime-baseline-unavailable');
	if (changes.some(change => change?.classification !== 'additive')) {
		return cliImpact('incompatible', 'runtime-v2-required');
	}
	if (changes.length > 0) return cliImpact('lagging', 'additive-runtime-surface-added');
	return cliImpact('current', 'known-runtime-surface-unchanged');
}

function cliImpact(status, reason) {
	return Object.freeze({ status, reason, runtimeApi: 'V1', blocking: false });
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	process.stdout.write(`${JSON.stringify(await inspectCliImpactV1())}\n`);
}
