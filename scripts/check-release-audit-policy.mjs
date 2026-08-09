#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateReleaseAuditPolicy } from './release/audit-policy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
	return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
	encoding: 'utf8',
});

let report;
try {
	report = JSON.parse(result.stdout);
} catch {
	console.error(JSON.stringify({
		status: 'unavailable',
		failures: [result.error?.message || result.stderr.trim() || 'npm audit returned non-JSON output'],
	}, null, 2));
	process.exit(2);
}

let bundleMetafile;
try {
	bundleMetafile = readJson('build/release/main-metafile.json');
} catch (error) {
	console.error(JSON.stringify({
		status: 'mismatch',
		failures: [`Production bundle dependency evidence is unavailable: ${error.message}`],
	}, null, 2));
	process.exit(1);
}

const evaluation = evaluateReleaseAuditPolicy({
	productionReport: report,
	bundleMetafile,
	packageLock: readJson('package-lock.json'),
});
const output = JSON.stringify(evaluation, null, 2);
if (evaluation.status === 'accepted-clean') {
	console.log(output);
} else {
	console.error(output);
	process.exit(evaluation.status === 'unavailable' ? 2 : 1);
}
