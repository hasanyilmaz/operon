import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	evaluateBundleSize,
	formatBundleSizeResult,
	inspectBundleFile,
	runBundleSizeCheck,
} from './check-main-bundle-size.mjs';

for (const bytes of [4_999_999, 5_000_000, 5_000_001, 10_000_000]) {
	test(`bundle size reports ${bytes} bytes without a size warning`, t => {
		assert.deepEqual(evaluateBundleSize(bytes), { ok: true, status: 'pass', actualBytes: bytes });
		const { bundlePath } = createBundleFixture(t, bytes);
		const messages = createMessages();
		assert.equal(inspectBundleFile(bundlePath).actualBytes, bytes);
		assert.equal(runBundleSizeCheck(bundlePath, messages.logger), 0);
		assert.deepEqual(messages.log, [`Operon main.js bundle size: ${new Intl.NumberFormat('en-US').format(bytes)} bytes.`]);
		assert.deepEqual(messages.warn, []);
		assert.deepEqual(messages.error, []);
	});
}

test('GitHub Actions also reports size without a warning annotation', t => {
	const { bundlePath } = createBundleFixture(t, 6_705_272);
	const modulePath = fileURLToPath(new URL('./check-main-bundle-size.mjs', import.meta.url));
	const child = spawnSync(process.execPath, ['--input-type=module', '-e',
		`import { runBundleSizeCheck } from ${JSON.stringify(new URL('./check-main-bundle-size.mjs', import.meta.url).href)}; process.exitCode = runBundleSizeCheck(${JSON.stringify(bundlePath)});`,
	], { cwd: path.dirname(modulePath), env: { ...process.env, GITHUB_ACTIONS: 'true' }, encoding: 'utf8' });
	assert.ifError(child.error);
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout.trim(), 'Operon main.js bundle size: 6,705,272 bytes.');
	assert.equal(child.stderr, '');
});

test('bundle size measurement validates numeric sizes', () => {
	for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '5000000']) {
		assert.throws(() => evaluateBundleSize(value), /actualBytes/u);
	}
	assert.equal(formatBundleSizeResult(evaluateBundleSize(0)), 'Operon main.js bundle size: 0 bytes.');
	assert.equal(formatBundleSizeResult(evaluateBundleSize(1)), 'Operon main.js bundle size: 1 byte.');
});

test('missing, directory and unreadable bundle paths still fail validation', t => {
	const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-bundle-size-path-'));
	t.after(() => fs.rmSync(temporaryDir, { recursive: true, force: true }));
	const missingPath = path.join(temporaryDir, 'missing.js');
	for (const bundlePath of [missingPath, temporaryDir]) {
		assert.equal(inspectBundleFile(bundlePath).reason, 'missing');
		const messages = createMessages();
		assert.equal(runBundleSizeCheck(bundlePath, messages.logger), 1);
		assert.match(messages.error[0], /not found/u);
		assert.deepEqual(messages.log, []);
		assert.deepEqual(messages.warn, []);
	}
	const unreadablePath = path.join(temporaryDir, 'unreadable.js');
	const accessError = Object.assign(new Error('access denied'), { code: 'EACCES' });
	const unreadableResult = inspectBundleFile(unreadablePath, () => { throw accessError; });
	assert.equal(unreadableResult.reason, 'read-error');
	const messages = createMessages();
	assert.equal(runBundleSizeCheck(unreadablePath, messages.logger, () => unreadableResult), 1);
	assert.match(messages.error[0], /could not inspect/u);
	assert.deepEqual(messages.log, []);
	assert.deepEqual(messages.warn, []);
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
