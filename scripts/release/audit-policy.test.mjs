import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateReleaseAuditPolicy } from './audit-policy.mjs';

function cleanReport() {
	return {
		auditReportVersion: 2,
		vulnerabilities: {},
		metadata: {
			vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
		},
	};
}

const cleanBundleMetafile = {
	inputs: {
		'main.ts': { bytes: 1 },
		'node_modules/runtime-package/index.js': { bytes: 1 },
	},
};
const cleanPackageLock = {
	packages: {
		'': {},
		'node_modules/runtime-package': { version: '1.0.0' },
		'node_modules/dev-package': { version: '1.0.0', dev: true },
	},
};

function evaluate(overrides = {}) {
	return evaluateReleaseAuditPolicy({
		productionReport: cleanReport(),
		bundleMetafile: cleanBundleMetafile,
		packageLock: cleanPackageLock,
		...overrides,
	});
}

test('accepts a clean production dependency audit', () => {
	assert.deepEqual(evaluate(), {
		status: 'accepted-clean',
		failures: [],
		productionVulnerabilities: 0,
	});
});

test('rejects a production dependency vulnerability', () => {
	const report = cleanReport();
	report.vulnerabilities.prod = { severity: 'high' };
	report.metadata.vulnerabilities.high = 1;
	report.metadata.vulnerabilities.total = 1;
	assert.deepEqual(evaluate({ productionReport: report }), {
		status: 'mismatch',
		failures: ['Production dependency audit must contain zero vulnerabilities.'],
		productionVulnerabilities: 1,
	});
});

test('does not inspect development-only audit findings', () => {
	const report = cleanReport();
	assert.equal(evaluate({
		fullReport: { error: { code: 'DEV_FINDING' } },
	}).status, 'accepted-clean');
});

test('rejects a development-only package in the production bundle', () => {
	const bundleMetafile = structuredClone(cleanBundleMetafile);
	bundleMetafile.inputs['node_modules/dev-package/index.js'] = { bytes: 1 };
	assert.deepEqual(evaluate({ bundleMetafile }), {
		status: 'mismatch',
		failures: ['Development-only package entered the production bundle: node_modules/dev-package.'],
		productionVulnerabilities: 0,
	});
});

test('fails closed when production bundle evidence is unavailable', () => {
	assert.match(evaluate({ bundleMetafile: {} }).failures.join('\n'), /evidence is unavailable/u);
});

test('distinguishes unavailable or malformed production audit output', () => {
	for (const report of [
		null,
		{ error: { code: 'ENETUNREACH' } },
		{ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: {} } },
		{
			auditReportVersion: 2,
			vulnerabilities: {},
			metadata: {
				vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 1 },
			},
		},
	]) {
		assert.equal(evaluate({ productionReport: report }).status, 'unavailable');
	}
});
