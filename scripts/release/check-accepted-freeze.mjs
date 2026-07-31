#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	checkPublicV1FreezeIndex,
	preparePublicV1FreezeArtifacts,
} from '../agent-runtime/contracts/public-v1-freeze.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), '../..');

export function assertAcceptedReleaseFreeze(index) {
	if (
		index?.state !== 'accepted'
		|| index?.audit?.validation?.status !== 'passed'
		|| index?.audit?.validation?.result?.status !== 'accepted-clean'
		|| index?.maintainerAcceptance?.status !== 'accepted'
		|| typeof index.maintainerAcceptance.acceptedBy !== 'string'
		|| index.maintainerAcceptance.acceptedBy.trim() === ''
		|| !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
			index.maintainerAcceptance.acceptedAt ?? '',
		)
	) {
		throw new Error('OPERON_RELEASE_ACCEPTED_FREEZE_REQUIRED');
	}
	return index;
}

export async function checkAcceptedReleaseFreeze(options = {}) {
	const pluginRoot = options.pluginRoot ?? defaultPluginRoot;
	const prepareArtifacts = options.prepareArtifacts === false
		? null
		: options.prepareArtifacts ?? preparePublicV1FreezeArtifacts;
	if (prepareArtifacts) {
		await prepareArtifacts(pluginRoot, options.prepareOptions);
	}
	const checkFreeze = options.checkFreeze ?? checkPublicV1FreezeIndex;
	const index = await checkFreeze({
		pluginRoot,
		...(options.freezePath ? { freezePath: options.freezePath } : {}),
	});
	return assertAcceptedReleaseFreeze(index);
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	await checkAcceptedReleaseFreeze();
	console.log('Operon accepted release freeze verified.');
}
