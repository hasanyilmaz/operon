import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadPublishedCliBinding,
	verifyCanonicalPluginInputs,
} from './published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);

export async function checkPublishedCliBinding(options = {}) {
	const loaded = await loadPublishedCliBinding(options);
	await verifyCanonicalPluginInputs(loaded.binding, options);
	return Object.freeze({
		package: `${loaded.binding.package.name}@${loaded.binding.package.version}`,
		tarballSha256: loaded.binding.tarball.sha256,
		inventoryEntries: loaded.binding.artifact.inventoryEntries,
		runtimeContractDigest: loaded.binding.runtime.contractDigest,
	});
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await checkPublishedCliBinding();
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
}
