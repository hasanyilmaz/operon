import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateReleaseAuditPolicy } from './audit-policy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = relativePath => JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8'));
const policy = readJson('contracts/release/dev-audit-policy-v1.json');
const production = readJson('scripts/release/fixtures/production-clean.json');
const rootPackage = readJson('package.json');
const packageLock = readJson('package-lock.json');
const cleanArtifactMetafiles = {
	plugin: { inputs: { 'main.ts': { bytes: 1 } } },
};

function cleanFullReport() {
	return structuredClone(production);
}

function evaluate(overrides = {}) {
	return evaluateReleaseAuditPolicy({
		policy,
		productionReport: production,
		fullReport: cleanFullReport(),
		packageLock,
		rootPackage,
		artifactMetafiles: cleanArtifactMetafiles,
		...overrides,
	});
}

test('accepts zero production and development findings with exact patched backports', () => {
	assert.deepEqual(evaluate(), {
		status: 'accepted-clean',
		failures: [],
		productionVulnerabilities: 0,
		developmentVulnerabilities: 0,
		directRoot: 'eslint-plugin-obsidianmd',
	});
});

test('rejects a production vulnerability', () => {
	const report = structuredClone(production);
	report.vulnerabilities.prod = { severity: 'high' };
	report.metadata.vulnerabilities.high = 1;
	report.metadata.vulnerabilities.total = 1;
	assert.equal(evaluate({ productionReport: report }).status, 'mismatch');
});

test('rejects any development vulnerability after the exception is retired', () => {
	const report = cleanFullReport();
	report.vulnerabilities.future = {
		name: 'future',
		severity: 'high',
		isDirect: false,
		via: [],
		nodes: [],
		fixAvailable: false,
	};
	report.metadata.vulnerabilities.high = 1;
	report.metadata.vulnerabilities.total = 1;
	assert.match(
		evaluate({ fullReport: report }).failures.join('\n'),
		/Development dependency audit must contain zero vulnerabilities/u,
	);
});

test('rejects resolved advisory version drift', () => {
	const changedLock = structuredClone(packageLock);
	changedLock.packages['node_modules/brace-expansion'].version = '5.0.7';
	assert.match(
		evaluate({ packageLock: changedLock }).failures.join('\n'),
		/brace-expansion installed versions changed/u,
	);
});

test('rejects a resolved advisory package outside dev dependencies', () => {
	const changedLock = structuredClone(packageLock);
	changedLock.packages['node_modules/brace-expansion'].dev = false;
	assert.match(
		evaluate({ packageLock: changedLock }).failures.join('\n'),
		/brace-expansion node is not dev-only/u,
	);
});

test('rejects a missing or production audit root', () => {
	const missing = structuredClone(rootPackage);
	delete missing.devDependencies['eslint-plugin-obsidianmd'];
	assert.match(evaluate({ rootPackage: missing }).failures.join('\n'), /direct development dependency/u);
	const productionRoot = structuredClone(rootPackage);
	productionRoot.dependencies = { 'eslint-plugin-obsidianmd': '0.4.1' };
	assert.match(evaluate({ rootPackage: productionRoot }).failures.join('\n'), /must not enter production/u);
});

test('distinguishes unavailable audit output from a policy mismatch', () => {
	assert.equal(evaluate({ fullReport: { error: { code: 'ENETUNREACH' } } }).status, 'unavailable');
});

test('rejects malformed or arithmetically inconsistent audit count metadata', () => {
	for (const counts of [
		{},
		{ info: 0, low: 0, moderate: 0, high: -1, critical: 0, total: 0 },
		{ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 1 },
	]) {
		const report = cleanFullReport();
		report.metadata.vulnerabilities = counts;
		assert.equal(evaluate({ fullReport: report }).status, 'unavailable');
	}
});

test('rejects a forbidden package marker in a shipped runtime artifact', () => {
	const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'operon-audit-policy-'));
	try {
		writeFileSync(path.join(fixtureRoot, 'main.js'), 'const bundled = "eslint-plugin-obsidianmd";\n');
		assert.match(
			evaluate({ rootDir: fixtureRoot }).failures.join('\n'),
			/main\.js contains development audit package marker/u,
		);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test('rejects forbidden packages in plugin bundle provenance', () => {
	const artifactMetafiles = structuredClone(cleanArtifactMetafiles);
	artifactMetafiles.plugin.inputs['node_modules/minimatch/dist/commonjs/index.js'] = { bytes: 1 };
	assert.match(
		evaluate({ artifactMetafiles }).failures.join('\n'),
		/plugin bundle includes development audit package minimatch/u,
	);
});

test('root release audit does not require or inspect standalone CLI bundle provenance', () => {
	const result = evaluate({
		artifactMetafiles: {
			...cleanArtifactMetafiles,
			cli: {
				inputs: { 'node_modules/minimatch/dist/commonjs/index.js': { bytes: 1 } },
			},
		},
	});
	assert.deepEqual(result.failures, []);
});

test('fails closed when bundle provenance is unavailable', () => {
	assert.match(
		evaluate({ artifactMetafiles: {} }).failures.join('\n'),
		/plugin bundle metafile is unavailable or malformed/u,
	);
});
