import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	WARN_MAIN_BUNDLE_BYTES,
	evaluateBundleSize,
	formatBundleSizeResult,
	inspectBundleFile,
	runBundleSizeCheck,
} from './check-main-bundle-size.mjs';

test('bundle size guard passes below the 5,000,000-byte review threshold', () => {
	const result = evaluateBundleSize(WARN_MAIN_BUNDLE_BYTES - 1);
	assert.equal(result.status, 'pass');
	assert.equal(result.remainingBeforeWarningBytes, 1);
});

test('bundle size guard requires review at exactly 5,000,000 bytes', () => {
	const result = evaluateBundleSize(WARN_MAIN_BUNDLE_BYTES);
	assert.equal(result.status, 'warning');
	assert.equal(result.overWarningBytes, 0);
	assert.match(formatBundleSizeResult(result), /review is required/u);
});

test('bundle size guard continues to warn above the threshold without a rejection limit', () => {
	const result = evaluateBundleSize(WARN_MAIN_BUNDLE_BYTES + 1);
	assert.equal(result.status, 'warning');
	assert.equal(result.ok, true);
	assert.equal(result.overWarningBytes, 1);
	assert.match(formatBundleSizeResult(result), /review is required/u);
});

test('review warning uses the warning channel and returns success', t => {
	const { bundlePath } = createBundleFixture(t, WARN_MAIN_BUNDLE_BYTES);
	const messages = createMessages();
	assert.equal(runBundleSizeCheck(bundlePath, messages.logger, {}), 0);
	assert.equal(messages.warn.length, 1);
	assert.deepEqual(messages.error, []);
});

test('review warning emits a GitHub Actions annotation', t => {
	const { bundlePath } = createBundleFixture(t, WARN_MAIN_BUNDLE_BYTES);
	const messages = createMessages();
	assert.equal(runBundleSizeCheck(bundlePath, messages.logger, { GITHUB_ACTIONS: 'true' }), 0);
	assert.equal(messages.warn.length, 2);
	assert.match(messages.warn[1], /^::warning title=Operon main\.js bundle size::/u);
});

test('large bundles use the warning channel and still exit successfully', t => {
	const { bundlePath } = createBundleFixture(t, WARN_MAIN_BUNDLE_BYTES + 1);
	const messages = createMessages();
	assert.equal(runBundleSizeCheck(bundlePath, messages.logger, {}), 0);
	assert.equal(messages.warn.length, 1);
	assert.deepEqual(messages.error, []);
});

test('bundle size guard rejects invalid sizes and threshold configurations', () => {
	assert.throws(() => evaluateBundleSize(-1), /actualBytes/u);
	assert.throws(() => evaluateBundleSize(0, -1), /warningBytes/u);
});

test('bundle size guard reports missing and unreadable bundle paths', t => {
	const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-bundle-size-path-'));
	t.after(() => fs.rmSync(temporaryDir, { recursive: true, force: true }));
	const missingPath = path.join(temporaryDir, 'missing.js');
	assert.equal(inspectBundleFile(missingPath).reason, 'missing');
	assert.match(formatBundleSizeResult(inspectBundleFile(missingPath)), /not found/u);

	const unreadablePath = path.join(temporaryDir, 'unreadable.js');
	const accessError = Object.assign(new Error('access denied'), { code: 'EACCES' });
	const unreadableResult = inspectBundleFile(unreadablePath, () => { throw accessError; });
	assert.equal(unreadableResult.reason, 'read-error');
	assert.match(formatBundleSizeResult(unreadableResult), /could not inspect/u);
	const messages = createMessages();
	assert.equal(runBundleSizeCheck(unreadablePath, messages.logger, {}, () => unreadableResult), 1);
	assert.match(messages.error[0], /could not inspect/u);
});

function createBundleFixture(t, bytes) {
	const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-bundle-size-'));
	t.after(() => fs.rmSync(temporaryDir, { recursive: true, force: true }));
	const bundlePath = path.join(temporaryDir, 'main.js');
	fs.writeFileSync(bundlePath, '');
	fs.truncateSync(bundlePath, bytes);
	return { bundlePath };
}

function createMessages() {
	const messages = { log: [], warn: [], error: [] };
	messages.logger = {
		log(message) { messages.log.push(message); },
		warn(message) { messages.warn.push(message); },
		error(message) { messages.error.push(message); },
	};
	return messages;
}
