import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	assertLiveAcceptanceInputsV1,
	officialObsidianCliIdentityV1,
	runAcceptanceProofV1,
	validateDisposableAcceptanceVaultV1,
} from './live-acceptance-platform.mjs';

const full = {
	profile: 'full',
	cellId: 'macos-26.5.2-arm64--obsidian-current-stable-1.12.7--node-24',
	expectedObsidianVersion: '1.12.7',
	expectedOsRef: 'macos-26.5.2-arm64',
};

test('Node 24 is the only full native acceptance profile', () => {
	assert.doesNotThrow(() => assertLiveAcceptanceInputsV1(full, { nodeMajor: 24 }));
	for (const nodeMajor of [22, 26]) {
		assert.throws(
			() => assertLiveAcceptanceInputsV1(full, { nodeMajor }),
			/Full native acceptance requires Node 24/u,
		);
	}
});

test('Node 22 and 26 are compatibility-smoke profiles', () => {
	const smoke = {
		...full,
		profile: 'smoke',
		cellId: 'windows-11-25h2-26200.8875-x64--obsidian-minimum-1.12.2--node-22',
		expectedObsidianVersion: '1.12.2',
		expectedOsRef: 'windows-11-25h2-26200.8875-x64',
	};
	for (const nodeMajor of [22, 26]) {
		assert.doesNotThrow(() => assertLiveAcceptanceInputsV1(smoke, { nodeMajor }));
	}
	assert.throws(
		() => assertLiveAcceptanceInputsV1(smoke, { nodeMajor: 24 }),
		/Smoke acceptance requires Node 22 or 26/u,
	);
});

test('only the frozen Obsidian versions and safe cell identifiers are admitted', () => {
	assert.throws(
		() => assertLiveAcceptanceInputsV1({
			...full,
			expectedObsidianVersion: '1.12.8',
		}, { nodeMajor: 24 }),
		/frozen 1\.12\.2 or 1\.12\.7/u,
	);
	assert.throws(
		() => assertLiveAcceptanceInputsV1({
			...full,
			cellId: '../unsafe',
		}, { nodeMajor: 24 }),
		/Invalid --cell-id/u,
	);
	assert.throws(
		() => assertLiveAcceptanceInputsV1({
			...full,
			expectedOsRef: 'macos-26',
		}, { nodeMajor: 24 }),
		/outside the frozen native acceptance matrix/u,
	);
});

test('native proof hooks must succeed and emit terminal machine-readable evidence', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-native-hook-contract-'));
	try {
		const hookRoot = path.join(root, 'scripts', 'agent-runtime', 'fixtures');
		await mkdir(hookRoot, { recursive: true });
		const valid = path.join(hookRoot, 'valid.mjs');
		const empty = path.join(hookRoot, 'empty.mjs');
		const leaking = path.join(hookRoot, 'leaking.mjs');
		await writeFile(valid, 'process.stdout.write(JSON.stringify({status:\"passed\",tests:1}));\n');
		await writeFile(empty, 'process.stdout.write(\"human-only output\\\\n\");\n');
		await writeFile(
			leaking,
			'process.stdout.write(JSON.stringify({status:\"passed\",tests:1,taskBody:\"secret\"}));\n',
		);
		const common = {
			cwd: root,
			env: {},
			cellId: full.cellId,
			profile: 'full',
			tarballSha256: 'a'.repeat(64),
		};
		assert.equal(runAcceptanceProofV1({
			...common,
			kind: 'fixture',
			hookPath: valid,
			testOnlyAllowUncommittedHook: true,
		}).result.tests, 1);
		assert.throws(
			() => runAcceptanceProofV1({
				...common,
				kind: 'empty-fixture',
				hookPath: empty,
				testOnlyAllowUncommittedHook: true,
			}),
			/must emit a terminal JSON object/u,
		);
		assert.throws(
			() => runAcceptanceProofV1({
				...common,
				kind: 'fixture',
				hookPath: leaking,
				testOnlyAllowUncommittedHook: true,
			}),
			/non-public or unredacted fields/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('native acceptance requires a canonical disposable marker-bound vault', async () => {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), 'operon-native-fixture-vault-')));
	try {
		await mkdir(path.join(root, '.obsidian'));
		await assert.rejects(
			async () => validateDisposableAcceptanceVaultV1(root),
			/disposable fixture marker|ENOENT/u,
		);
		await writeFile(
			path.join(root, '.operon-developer-api-native-fixture.json'),
			`${JSON.stringify({
				kind: 'operon-developer-api-native-fixture-vault',
				runId: 'native-test-run',
				nonce: '0123456789abcdef0123456789abcdef',
			})}\n`,
		);
		const identity = validateDisposableAcceptanceVaultV1(root);
		assert.equal(identity.vaultPath, root);
		assert.match(identity.marker.nonceSha256, /^[a-f0-9]{64}$/u);
		const alias = `${root}-alias`;
		await symlink(root, alias);
		assert.throws(
			() => validateDisposableAcceptanceVaultV1(alias),
			/canonical path/u,
		);
		await rm(alias);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Obsidian CLI identity binds a canonical executable and digest', async () => {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), 'operon-obsidian-cli-identity-')));
	try {
		const executable = path.join(root, 'obsidian');
		await writeFile(
			executable,
			'#!/usr/bin/env node\nprocess.stdout.write(\"Obsidian 1.12.7\\\\n\");\n',
		);
		await chmod(executable, 0o700);
		const identity = officialObsidianCliIdentityV1('1.12.7', {
			executable,
			platform: 'linux',
			env: process.env,
		});
		assert.equal(identity.executable, executable);
		assert.equal(identity.identityBackend, 'linux-canonical-executable');
		assert.equal(identity.identityVerified, true);
		assert.match(identity.executableSha256, /^[a-f0-9]{64}$/u);
		assert.match(identity.identityDigest, /^[a-f0-9]{64}$/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
