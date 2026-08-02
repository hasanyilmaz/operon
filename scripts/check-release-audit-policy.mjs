#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateReleaseAuditPolicy } from './release/audit-policy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
	return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function runAudit(arguments_) {
	const result = spawnSync('npm', ['audit', ...arguments_, '--json'], {
		cwd: rootDir,
		encoding: 'utf8',
	});
	let report;
	try {
		report = JSON.parse(result.stdout);
	} catch {
		return {
			report: null,
			error: result.error?.message || result.stderr.trim() || 'npm audit returned non-JSON output',
		};
	}
	if (report?.error) {
		return {
			report: null,
			error: report.error.summary || report.error.code || 'npm audit registry error',
		};
	}
	return { report, error: null };
}

function buildArtifactMetafiles() {
	const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'operon-release-audit-'));
	try {
		const definitions = [
			{
				artifact: 'plugin',
				arguments: ['esbuild.config.mjs', 'production'],
				environmentKey: 'OPERON_ESBUILD_METAFILE',
			},
		];
		const metafiles = {};
		for (const definition of definitions) {
			const metafilePath = path.join(temporaryRoot, `${definition.artifact}.json`);
			const result = spawnSync(process.execPath, definition.arguments, {
				cwd: rootDir,
				encoding: 'utf8',
				env: {
					...process.env,
					[definition.environmentKey]: metafilePath,
				},
			});
			if (result.error || result.status !== 0) {
				return {
					metafiles: null,
					error: `${definition.artifact} provenance build failed: ${
						result.error?.message
						|| result.stderr.trim()
						|| result.stdout.trim()
						|| `exit ${result.status ?? 'signal'}`
					}`,
				};
			}
			try {
				metafiles[definition.artifact] = JSON.parse(readFileSync(metafilePath, 'utf8'));
			} catch (error) {
				return {
					metafiles: null,
					error: `${definition.artifact} provenance metafile is unreadable: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
		}
		return { metafiles, error: null };
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
}

const production = runAudit(['--omit=dev']);
const full = runAudit([]);
if (production.error || full.error) {
	console.error(JSON.stringify({
		status: 'unavailable',
		production: production.error,
		full: full.error,
	}, null, 2));
	process.exit(2);
}

const provenance = buildArtifactMetafiles();
if (provenance.error) {
	console.error(JSON.stringify({
		status: 'mismatch',
		failures: [provenance.error],
	}, null, 2));
	process.exit(1);
}

const result = evaluateReleaseAuditPolicy({
	policy: readJson('contracts/release/dev-audit-policy-v1.json'),
	productionReport: production.report,
	fullReport: full.report,
	packageLock: readJson('package-lock.json'),
	rootPackage: readJson('package.json'),
	rootDir,
	artifactMetafiles: provenance.metafiles,
});
const output = JSON.stringify(result, null, 2);
if (result.status === 'accepted-clean') {
	console.log(output);
} else {
	console.error(output);
	process.exit(result.status === 'unavailable' ? 2 : 1);
}
