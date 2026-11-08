import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBundlePath = path.join(rootDir, 'main.js');
const numberFormatter = new Intl.NumberFormat('en-US');

function formatByteCount(bytes) {
	return `${numberFormatter.format(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
}

export function evaluateBundleSize(actualBytes) {
	if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
		throw new TypeError('actualBytes must be a non-negative safe integer.');
	}
	return { ok: true, status: 'pass', actualBytes };
}

export function inspectBundleFile(bundlePath = defaultBundlePath, statSync = fs.statSync) {
	try {
		const stats = statSync(bundlePath);
		if (!stats.isFile()) {
			return { ok: false, reason: 'missing', bundlePath };
		}
		return { ...evaluateBundleSize(stats.size), bundlePath };
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return { ok: false, reason: 'missing', bundlePath };
		}
		return {
			ok: false,
			reason: 'read-error',
			bundlePath,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export function formatBundleSizeResult(result) {
	if (result.reason === 'missing') {
		return 'Operon main.js bundle size failed: main.js not found. Run npm run build first.';
	}
	if (result.reason === 'read-error') {
		return `Operon main.js bundle size failed: could not inspect main.js (${result.message}).`;
	}

	return `Operon main.js bundle size: ${formatByteCount(result.actualBytes)}.`;
}

export function runBundleSizeCheck(
	bundlePath = defaultBundlePath,
	logger = console,
	inspect = inspectBundleFile,
) {
	const result = inspect(bundlePath);
	const output = formatBundleSizeResult(result);
	if (result.status === 'pass') {
		logger.log(output);
		return 0;
	}

	logger.error(output);
	return 1;
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
	process.exitCode = runBundleSizeCheck();
}
