import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { developmentDependencyClosure, evaluateReleaseAuditPolicy } from './audit-policy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = relativePath => JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8'));
const policy = readJson('contracts/release/dev-audit-policy-v1.json');
const production = readJson('scripts/release/fixtures/production-clean.json');
const rootPackage = readJson('package.json');
const packageLock = readJson('package-lock.json');
const cliPackage = readJson('packages/operon-cli/package.json');
const cleanArtifactMetafiles = {
	plugin: { inputs: { 'main.ts': { bytes: 1 } } },
	cli: { inputs: { 'packages/operon-cli/src/main.ts': { bytes: 1 } } },
};

function fullReport() {
	const closure = [...developmentDependencyClosure(packageLock, policy.developmentException.directRoot)];
	const vulnerabilities = Object.fromEntries(
		policy.developmentException.vulnerabilityNames.map(name => [name, {
			name,
			severity: 'high',
			isDirect: name === policy.developmentException.directRoot,
			via: name === 'brace-expansion'
				? policy.developmentException.advisories.map(advisory => ({ ...advisory }))
				: [],
			nodes: [closure.find(location => (
				location === `node_modules/${name}`
				|| location.endsWith(`/node_modules/${name}`)
			))],
			fixAvailable: false,
		}]),
	);
	return {
		auditReportVersion: 2,
		vulnerabilities,
		metadata: {
			vulnerabilities: { ...policy.developmentException.expectedCounts },
		},
	};
}

function evaluate(overrides = {}) {
	return evaluateReleaseAuditPolicy({
		policy,
		productionReport: production,
		fullReport: fullReport(),
		packageLock,
		rootPackage,
		cliPackage,
		artifactMetafiles: cleanArtifactMetafiles,
		...overrides,
	});
}

test('accepts only the frozen dev-tool exception with a clean production audit', () => {
	assert.equal(evaluate().status, 'accepted-development-exception');
});

test('rejects a production vulnerability', () => {
	const report = structuredClone(production);
	report.vulnerabilities.prod = { severity: 'high' };
	report.metadata.vulnerabilities.high = 1;
	report.metadata.vulnerabilities.total = 1;
	assert.equal(evaluate({ productionReport: report }).status, 'mismatch');
});

test('rejects new vulnerability inventory and critical severity', () => {
	const report = fullReport();
	report.vulnerabilities.future = {
		name: 'future',
		severity: 'critical',
		isDirect: false,
		via: [],
		nodes: [],
		fixAvailable: false,
	};
	report.metadata.vulnerabilities.high = 11;
	report.metadata.vulnerabilities.critical = 1;
	report.metadata.vulnerabilities.total = 12;
	assert.equal(evaluate({ fullReport: report }).status, 'mismatch');
});

test('rejects exception-root fix availability', () => {
	const report = fullReport();
	report.vulnerabilities['eslint-plugin-obsidianmd'].fixAvailable = true;
	assert.match(
		evaluate({ fullReport: report }).failures.join('\n'),
		/fix availability changed/u,
	);
});

test('accepts wrapper-level fix metadata when advisory leaf and direct root remain unfixable', () => {
	const report = fullReport();
	report.vulnerabilities.minimatch.fixAvailable = {
		name: 'minimatch',
		version: '10.0.3',
		isSemVerMajor: false,
	};
	assert.equal(evaluate({ fullReport: report }).status, 'accepted-development-exception');
});

test('rejects fix availability for the advisory-bearing package', () => {
	const report = fullReport();
	report.vulnerabilities['brace-expansion'].fixAvailable = {
		name: 'brace-expansion',
		version: '5.0.8',
		isSemVerMajor: false,
	};
	assert.match(
		evaluate({ fullReport: report }).failures.join('\n'),
		/brace-expansion fix availability changed/u,
	);
});

test('rejects a missing no-fix requirement for an advisory-bearing package', () => {
	const changedPolicy = structuredClone(policy);
	changedPolicy.developmentException.requiredNoFixPackages = ['eslint-plugin-obsidianmd'];
	assert.match(
		evaluate({ policy: changedPolicy }).failures.join('\n'),
		/Advisory-bearing package lacks a no-fix requirement/u,
	);
});

test('rejects changed advisory inventory', () => {
	const report = fullReport();
	report.vulnerabilities['brace-expansion'].via[0].source += 1;
	assert.match(
		evaluate({ fullReport: report }).failures.join('\n'),
		/advisory inventory changed/u,
	);
});

test('rejects vulnerable nodes outside the approved dev dependency closure', () => {
	const report = fullReport();
	report.vulnerabilities.minimatch.nodes = ['node_modules/not-in-approved-closure'];
	assert.match(
		evaluate({ fullReport: report }).failures.join('\n'),
		/outside the eslint-plugin-obsidianmd dependency closure/u,
	);
});

test('distinguishes unavailable audit output from a policy mismatch', () => {
	assert.equal(evaluate({ fullReport: { error: { code: 'ENETUNREACH' } } }).status, 'unavailable');
});

test('rejects malformed or arithmetically inconsistent audit count metadata', () => {
	for (const counts of [
		{},
		{ ...policy.developmentException.expectedCounts, high: -1 },
		{ ...policy.developmentException.expectedCounts, total: 12 },
	]) {
		const report = fullReport();
		report.metadata.vulnerabilities = counts;
		assert.equal(evaluate({ fullReport: report }).status, 'unavailable');
	}
});

test('rejects CLI runtime inclusion of an exception package', () => {
	const cli = structuredClone(cliPackage);
	cli.dependencies = { minimatch: '10.0.2' };
	assert.match(
		evaluate({ cliPackage: cli }).failures.join('\n'),
		/operon-cli runtime dependency includes/u,
	);
});

test('rejects an exception package marker in a shipped runtime artifact', () => {
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

test('rejects an exception package in plugin or CLI bundle provenance', () => {
	for (const artifact of ['plugin', 'cli']) {
		const artifactMetafiles = structuredClone(cleanArtifactMetafiles);
		artifactMetafiles[artifact].inputs['node_modules/minimatch/dist/commonjs/index.js'] = { bytes: 1 };
		assert.match(
			evaluate({ artifactMetafiles }).failures.join('\n'),
			new RegExp(`${artifact} bundle includes development audit package minimatch`, 'u'),
		);
	}
});

test('fails closed when bundle provenance is unavailable', () => {
	assert.match(
		evaluate({ artifactMetafiles: { plugin: cleanArtifactMetafiles.plugin } }).failures.join('\n'),
		/cli bundle metafile is unavailable or malformed/u,
	);
});
