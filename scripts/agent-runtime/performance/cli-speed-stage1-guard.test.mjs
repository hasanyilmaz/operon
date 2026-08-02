import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertCliSpeedStage1Vault,
	CLI_SPEED_STAGE1_VAULT,
} from './cli-speed-stage1-core.mjs';

const directoryMetadata = {
	isDirectory: () => true,
	isSymbolicLink: () => false,
};

function guardDependencies(overrides = {}) {
	return {
		lstatSync: () => directoryMetadata,
		realpathSync: value => value,
		...overrides,
	};
}

test('published performance admits only the fixed disposable vault', () => {
	assert.equal(
		assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies()),
		CLI_SPEED_STAGE1_VAULT,
	);
	for (const rejected of [
		'/private/tmp/other-vault',
		'/private/tmp/cli-test-vault/..',
		'/tmp/cli-test-vault',
		'/Users/example/cli-test-vault',
	]) {
		assert.throws(
			() => assertCliSpeedStage1Vault(rejected, guardDependencies()),
			/Refusing vault|exact guarded path/u,
		);
	}
});

test('published performance rejects symlink, non-directory, and realpath drift', () => {
	assert.throws(() => assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies({
		lstatSync: () => ({ ...directoryMetadata, isSymbolicLink: () => true }),
	})), /symbolic link/u);
	assert.throws(() => assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies({
		lstatSync: () => ({ ...directoryMetadata, isDirectory: () => false }),
	})), /must be a directory/u);
	assert.throws(() => assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies({
		realpathSync: value => value === CLI_SPEED_STAGE1_VAULT ? '/private/tmp/elsewhere' : value,
	})), /realpath does not match/u);
});
