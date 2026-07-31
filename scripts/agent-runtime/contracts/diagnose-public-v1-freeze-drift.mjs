import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublicV1FreezeIndex } from './public-v1-freeze.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../../..');
const freezePath = path.join(pluginRoot, 'contracts/agent-runtime/public-v1-freeze.json');

export function diffJsonLeavesV1(frozen, observed, currentPath = '$', output = []) {
	if (Object.is(frozen, observed)) return output;
	if (
		frozen === null
		|| observed === null
		|| typeof frozen !== 'object'
		|| typeof observed !== 'object'
		|| Array.isArray(frozen) !== Array.isArray(observed)
	) {
		output.push({
			path: currentPath,
			frozen: diagnosticValue(frozen),
			observed: diagnosticValue(observed),
		});
		return output;
	}
	if (Array.isArray(frozen)) {
		if (frozen.length !== observed.length) {
			output.push({
				path: `${currentPath}.length`,
				frozen: diagnosticValue(frozen.length),
				observed: diagnosticValue(observed.length),
			});
		}
		const length = Math.max(frozen.length, observed.length);
		for (let index = 0; index < length; index += 1) {
			diffJsonLeavesV1(frozen[index], observed[index], `${currentPath}[${index}]`, output);
		}
		return output;
	}
	const keys = [...new Set([...Object.keys(frozen), ...Object.keys(observed)])].sort();
	for (const key of keys) {
		diffJsonLeavesV1(frozen[key], observed[key], `${currentPath}.${key}`, output);
	}
	return output;
}

function diagnosticValue(value) {
	return value === undefined ? { present: false } : { present: true, value };
}

export async function diagnosePublicV1FreezeDrift() {
	const frozen = JSON.parse(await readFile(freezePath, 'utf8'));
	const observed = await buildPublicV1FreezeIndex({ pluginRoot });
	const differences = diffJsonLeavesV1(frozen, observed);
	return {
		status: differences.length === 0 ? 'current' : 'drift',
		platform: process.platform,
		architecture: process.arch,
		node: process.version,
		differenceCount: differences.length,
		differences: differences.slice(0, 64),
		truncated: differences.length > 64,
	};
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	try {
		console.log(JSON.stringify(await diagnosePublicV1FreezeDrift(), null, 2));
	} catch (error) {
		console.log(JSON.stringify({
			status: 'diagnostic-unavailable',
			platform: process.platform,
			architecture: process.arch,
			node: process.version,
			error: error instanceof Error ? error.message : String(error),
		}, null, 2));
	}
}
