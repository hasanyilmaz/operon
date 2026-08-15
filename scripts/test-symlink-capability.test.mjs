import assert from 'node:assert/strict';
import test from 'node:test';

import { createSymlinkCapabilityUnavailableReason } from './test-symlink-capability.mjs';

function createHarness({
	platform = 'win32',
	directoryError,
	fileError,
	symlinkError,
	symlinkErrorType = 'dir',
	cleanupError,
} = {}) {
	const calls = [];
	return {
		calls,
		probe: createSymlinkCapabilityUnavailableReason({
			platform,
			createTemporaryRoot: () => {
				calls.push('root');
				return '/tmp/symlink-probe';
			},
			createDirectory: () => {
				calls.push('directory-target');
				if (directoryError) throw directoryError;
			},
			writeFile: () => {
				calls.push('file-target');
				if (fileError) throw fileError;
			},
			createSymlink: (_target, _link, type) => {
				calls.push(`symlink:${type}`);
				if (symlinkError && type === symlinkErrorType) throw symlinkError;
			},
			removeRoot: () => {
				calls.push('cleanup');
				if (cleanupError) throw cleanupError;
			},
		}),
	};
}

test('non-Windows hosts retain full coverage without probing filesystem capability', () => {
	const harness = createHarness({ platform: 'darwin' });
	assert.equal(harness.probe(), undefined);
	assert.equal(harness.probe(), undefined);
	assert.deepEqual(harness.calls, []);
});

test('capable Windows probes file and directory symlinks once', () => {
	const harness = createHarness();
	assert.equal(harness.probe(), undefined);
	assert.equal(harness.probe(), undefined);
	assert.deepEqual(harness.calls, ['root', 'directory-target', 'file-target', 'symlink:dir', 'symlink:file', 'cleanup']);
});

test('recognized Windows capability errors at either symlink kind return and memoize one diagnostic', () => {
	for (const code of ['EACCES', 'ENOSYS', 'EPERM']) {
		for (const type of ['dir', 'file']) {
			const error = Object.assign(new Error('not permitted'), { code });
			const harness = createHarness({ symlinkError: error, symlinkErrorType: type });
			const expected = `Windows symbolic-link creation is unavailable (${code}).`;
			assert.equal(harness.probe(), expected);
			assert.equal(harness.probe(), expected);
			assert.equal(harness.calls.filter(call => call === 'root').length, 1);
			assert.equal(harness.calls.filter(call => call === 'cleanup').length, 1);
			assert.equal(harness.calls.includes(`symlink:${type}`), true);
		}
	}
});

test('unexpected probe failures are never cached as an available capability', () => {
	const error = Object.assign(new Error('unexpected'), { code: 'EIO' });
	const harness = createHarness({ symlinkError: error });
	assert.throws(() => harness.probe(), error);
	assert.throws(() => harness.probe(), error);
	assert.equal(harness.calls.filter(call => call === 'root').length, 2);
	assert.equal(harness.calls.filter(call => call === 'cleanup').length, 2);
});

test('target setup permission errors fail closed and are never cached as symlink capability results', () => {
	for (const code of ['EACCES', 'ENOSYS', 'EPERM']) {
		for (const operation of ['directory', 'file']) {
			const error = Object.assign(new Error('setup failed'), { code });
			const harness = createHarness(operation === 'directory'
				? { directoryError: error }
				: { fileError: error });
			assert.throws(() => harness.probe(), error);
			assert.throws(() => harness.probe(), error);
			assert.equal(harness.calls.filter(call => call === 'root').length, 2);
			assert.equal(harness.calls.filter(call => call === 'cleanup').length, 2);
		}
	}
});

test('cleanup failures leave the capability result uncached', () => {
	const cleanupError = new Error('cleanup failed');
	const harness = createHarness({ cleanupError });
	assert.throws(() => harness.probe(), cleanupError);
	assert.throws(() => harness.probe(), cleanupError);
	assert.equal(harness.calls.filter(call => call === 'root').length, 2);
});
