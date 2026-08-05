import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	assertCanonicalWindowsCandidateContext,
	parseRequiredNativeSummary,
	runCandidateValidationSteps,
	writeReceiptAtomically,
} from './validate-windows-candidate.mjs';

const VALID_CONTEXT = {
	platform: 'win32',
	nodeVersion: 'v24.18.0',
	npmVersion: '11.12.1',
	headSha: 'a'.repeat(40),
};

test('canonical Windows candidate context requires the exact host, toolchain, and SHA', () => {
	assert.doesNotThrow(() => assertCanonicalWindowsCandidateContext(VALID_CONTEXT));
	for (const context of [
		{ ...VALID_CONTEXT, platform: 'darwin' },
		{ ...VALID_CONTEXT, nodeVersion: 'v24.17.0' },
		{ ...VALID_CONTEXT, npmVersion: '11.12.0' },
		{ ...VALID_CONTEXT, headSha: 'abc123' },
	]) {
		assert.throws(() => assertCanonicalWindowsCandidateContext(context));
	}
});

test('required native summary must prove Windows execution with zero skips', () => {
	const valid = {
		kind: 'operon-native-transport-summary',
		platform: 'win32',
		requiredNative: true,
		summaryParseable: true,
		tests: 22,
		fail: 0,
		cancelled: 0,
		skipped: 0,
	};
	assert.deepEqual(parseRequiredNativeSummary(`${JSON.stringify(valid)}\n`), {
		tests: 22,
		fail: 0,
		cancelled: 0,
		skipped: 0,
	});
	for (const invalid of [
		{ ...valid, platform: 'darwin' },
		{ ...valid, requiredNative: false },
		{ ...valid, skipped: 1 },
		{ ...valid, fail: 1 },
	]) {
		assert.throws(() => parseRequiredNativeSummary(`${JSON.stringify(invalid)}\n`));
	}
});

test('candidate validation preserves gate order and runs the postflight', () => {
	const calls = [];
	runCandidateValidationSteps({
		assertTrackedClean: phase => calls.push(`clean:${phase}`),
		installDependencies: () => calls.push('npm-ci'),
		assertUrlPortable: () => calls.push('url-portable'),
		runCandidateCheck: () => calls.push('candidate-check'),
		runRequiredNativeTransport: () => calls.push('required-native'),
	});
	assert.deepEqual(calls, [
		'clean:preflight',
		'npm-ci',
		'clean:post-install',
		'url-portable',
		'candidate-check',
		'required-native',
		'clean:postflight',
	]);
});

test('candidate validation still checks tracked state after a validation failure', () => {
	const calls = [];
	assert.throws(
		() => runCandidateValidationSteps({
			assertTrackedClean: phase => calls.push(`clean:${phase}`),
			installDependencies: () => calls.push('npm-ci'),
			assertUrlPortable: () => calls.push('url-portable'),
			runCandidateCheck: () => {
				calls.push('candidate-check');
				throw new Error('candidate failed');
			},
			runRequiredNativeTransport: () => calls.push('required-native'),
		}),
		/candidate failed/u,
	);
	assert.deepEqual(calls, [
		'clean:preflight',
		'npm-ci',
		'clean:post-install',
		'url-portable',
		'candidate-check',
		'clean:postflight',
	]);
});

test('candidate validation reports validation and postflight failures together', () => {
	assert.throws(
		() => runCandidateValidationSteps({
			assertTrackedClean: phase => {
				if (phase === 'postflight') throw new Error('dirty postflight');
			},
			installDependencies: () => undefined,
			assertUrlPortable: () => undefined,
			runCandidateCheck: () => {
				throw new Error('candidate failed');
			},
			runRequiredNativeTransport: () => undefined,
		}),
		error => {
			assert.equal(error instanceof AggregateError, true);
			assert.equal(error.errors.length, 2);
			return true;
		},
	);
});

test('candidate receipt is written atomically only outside the repository', () => {
	const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'operon-windows-candidate-receipt-'));
	const repositoryRoot = path.join(fixtureRoot, 'repository');
	const receiptPath = path.join(fixtureRoot, 'receipt.json');
	const receipt = { kind: 'operon-windows-candidate-validation', headSha: 'a'.repeat(40) };
	try {
		mkdirSync(path.join(repositoryRoot, 'receipts'), { recursive: true });
		writeReceiptAtomically(receipt, receiptPath, repositoryRoot);
		assert.deepEqual(JSON.parse(readFileSync(receiptPath, 'utf8')), receipt);
		assert.deepEqual(readdirSync(fixtureRoot).sort(), ['receipt.json', 'repository']);
		assert.throws(
			() => writeReceiptAtomically(receipt, path.join(repositoryRoot, 'receipt.json'), repositoryRoot),
			/outside the repository/u,
		);
		assert.throws(
			() => writeReceiptAtomically(receipt, receiptPath, repositoryRoot),
			/already exists/u,
		);
		const linkedAncestor = path.join(fixtureRoot, 'linked-repository');
		symlinkSync(repositoryRoot, linkedAncestor, process.platform === 'win32' ? 'junction' : 'dir');
		assert.throws(
			() => writeReceiptAtomically(
				receipt,
				path.join(linkedAncestor, 'receipts', 'escaped-receipt.json'),
				repositoryRoot,
			),
			/outside the repository/u,
		);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test('Windows PR workflow delegates candidate gates to the canonical runner', () => {
	const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
	assert.match(
		workflow,
		/- name: Run canonical Windows candidate validation\s+if: github\.event_name == 'pull_request'\s+run: npm run validate:windows:candidate/u,
	);
	for (const stepName of [
		'Run required native transport validation',
		'Verify tracked runner URL portability',
		'Verify tracked worktree remains clean',
	]) {
		assert.match(
			workflow,
			new RegExp(`- name: ${stepName}\\s+if: github\\.event_name == 'push'`, 'u'),
		);
	}
	const windowsJob = workflow.slice(workflow.indexOf('  windows-native:'));
	assert.match(
		windowsJob,
		/- name: Install dependencies\s+if: github\.event_name == 'push'\s+run: npm ci/u,
	);
});
