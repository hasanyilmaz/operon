import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	installAndVerifyPublishedCli,
	loadPublishedCliBinding,
	verifyCanonicalPluginInputs,
	verifyPublishedCliLifecycle,
} from './published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);

export async function checkPublishedCliArtifact(options = {}) {
	const arguments_ = options.tarballPath
		? { tarballPath: options.tarballPath, legacyTarballPath: options.legacyTarballPath }
		: readArtifactArguments(options.argv ?? process.argv.slice(2));
	const loaded = await loadPublishedCliBinding(options);
	await verifyCanonicalPluginInputs(loaded.binding, options);
	const installed = await installAndVerifyPublishedCli(arguments_.tarballPath, loaded.binding, options);
	const lifecycle = arguments_.legacyTarballPath
		? await verifyPublishedCliLifecycle(
			arguments_.tarballPath,
			arguments_.legacyTarballPath,
			loaded.binding,
			options,
		)
		: null;
	return Object.freeze({
		package: `${loaded.binding.package.name}@${loaded.binding.package.version}`,
		tarballSha256: loaded.binding.tarball.sha256,
		inventoryEntries: loaded.binding.artifact.inventoryEntries,
		npmVersion: installed.npmVersion,
		...(lifecycle ? { lifecycleTransitions: lifecycle.transitions } : {}),
	});
}

export function readArtifactArguments(argv) {
	const allowed = new Set(['--tarball', '--legacy-tarball']);
	const values = {};
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		const value = argv[index + 1];
		if (!allowed.has(name) || typeof value !== 'string' || value.startsWith('--')) {
			throw new Error('OPERON_PUBLISHED_CLI_ARTIFACT_USAGE');
		}
		if (Object.hasOwn(values, name)) throw new Error('OPERON_PUBLISHED_CLI_ARTIFACT_USAGE');
		values[name] = value;
	}
	if (!values['--tarball']) throw new Error('OPERON_PUBLISHED_CLI_ARTIFACT_USAGE');
	return {
		tarballPath: values['--tarball'],
		legacyTarballPath: values['--legacy-tarball'],
	};
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await checkPublishedCliArtifact();
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
}
