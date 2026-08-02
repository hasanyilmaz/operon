import assert from 'node:assert/strict';

import {
	loadPublishedCliBinding,
	verifyPublishedCliExecutablePath,
} from './published-cli-v1.mjs';

export async function requirePublishedCliExecutable(pluginRoot, environment = process.env) {
	const executable = environment.OPERON_PUBLISHED_CLI_EXECUTABLE;
	assert.ok(executable, 'OPERON_PUBLISHED_CLI_EXECUTABLE_REQUIRED');
	const { binding } = await loadPublishedCliBinding({ pluginRoot });
	return verifyPublishedCliExecutablePath(executable, binding);
}
