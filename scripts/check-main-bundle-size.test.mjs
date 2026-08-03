import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	HARD_MAIN_BUNDLE_BYTES,
	MAX_MAIN_BUNDLE_BYTES,
	WARN_MAIN_BUNDLE_BYTES,
	evaluateBundleSize,
	formatBundleSizeResult,
	inspectBundleFile,
	runBundleSizeCheck,
} from './check-main-bundle-size.mjs';

test('bundle size guard passes below the 4.5 MB review threshold', () => {
	const result = evaluateBundleSize(WARN_MAIN_BUNDLE_BYTES - 1);
	assert.equal(result.status, 'pass');
	assert.equal(result.remainingBeforeWarningBytes, 1);
});

test('bundle size guard requires review at exactly 4.5 MB', () => {
	const result = evaluateBundleSize(WARN_MAIN_BUNDLE_BYTES);
	assert.equal(result.status, 'warning');
	assert.equal(result.overWarningBytes, 0);
	assert.match(formatBundleSizeResult(result), /review is required/u);
});

test('bundle size guard warns through exactly 4.7 MB', () => {
	const result = evaluateBundleSize(MAX_MAIN_BUNDLE_BYTES);
	assert.equal(result.status, 'warning');
	assert.equal(result.remainingBeforeLimitBytes, 0);
});

test('bundle size guard rejects one byte above 4.7 MB', () => {
	const result = evaluateBundleSize(MAX_MAIN_BUNDLE_BYTES + 1);
	assert.equal(result.ok, false);
	assert.equal(result.status, 'fail');
	assert.equal(result.overBytes, 1);
	assert.match(formatBundleSizeResult(result), /acceptance limit by 1 byte/u);
});

test('bundle size guard rejects one byte below the 4.9 MB hard limit', () => {
	assert.equal(evaluateBundleSize(HARD_MAIN_BUNDLE_BYTES - 1).status, 'fail');
});

test('bundle size guard rejects exactly the 4.9 MB hard limit', () => {
	assert.equal(evaluateBundleSize(HARD_MAIN_BUNDLE_BYTES).status, 'fail');
});

test('bundle size guard reports a distinct hard failure above 4.9 MB', () => {
	const result = evaluateBundleSize(HARD_MAIN_BUNDLE_BYTES + 1);
	assert.equal(result.status, 'hard-fail');
	assert.equal(result.overHardBytes, 1);
	assert.match(formatBundleSizeResult(result), /hard limit by 1 byte/u);
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

test('acceptance failure uses the error channel and exits with code 1', t => {
	const { bundlePath } = createBundleFixture(t, MAX_MAIN_BUNDLE_BYTES + 1);
	const messages = createMessages();
	assert.equal(runBundleSizeCheck(bundlePath, messages.logger, {}), 1);
	assert.equal(messages.error.length, 1);
	assert.deepEqual(messages.warn, []);
});

test('bundle size guard rejects invalid sizes and threshold configurations', () => {
	assert.throws(() => evaluateBundleSize(-1), /actualBytes/u);
	assert.throws(() => evaluateBundleSize(0, -1), /maxBytes/u);
	assert.throws(() => evaluateBundleSize(0, MAX_MAIN_BUNDLE_BYTES, -1), /warningBytes/u);
	assert.throws(
		() => evaluateBundleSize(0, MAX_MAIN_BUNDLE_BYTES, WARN_MAIN_BUNDLE_BYTES, -1),
		/hardBytes/u,
	);
	assert.throws(() => evaluateBundleSize(0, 100, 101, 200), /warningBytes must not exceed maxBytes/u);
	assert.throws(() => evaluateBundleSize(0, 201, 100, 200), /maxBytes must not exceed hardBytes/u);
});

test('bundle size guard reports missing and unreadable bundle paths', t => {
	const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-bundle-size-path-'));
	t.after(() => fs.rmSync(temporaryDir, { recursive: true, force: true }));
	const missingPath = path.join(temporaryDir, 'missing.js');
	assert.equal(inspectBundleFile(missingPath).reason, 'missing');
	assert.match(formatBundleSizeResult(inspectBundleFile(missingPath)), /not found/u);

	const unreadablePath = path.join(temporaryDir, 'invalid\0main.js');
	assert.equal(inspectBundleFile(unreadablePath).reason, 'read-error');
	const messages = createMessages();
	assert.equal(runBundleSizeCheck(unreadablePath, messages.logger, {}), 1);
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
