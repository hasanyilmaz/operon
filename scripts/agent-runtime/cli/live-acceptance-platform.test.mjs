import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	assertLiveAcceptanceInputsV1,
	execNpmV1,
	officialObsidianCliIdentityV1,
	resolveAcceptanceExecutableV1,
	resolveAcceptanceWindowsPowerShellV1,
	resolveNpmInvocationV1,
	runAcceptanceProofV1,
	validateDisposableAcceptanceVaultV1,
	windowsAuthenticodeIdentityV1,
} from './live-acceptance-platform.mjs';

test('npm invocation bypasses Windows command shims through the current Node runtime', () => {
	assert.deepEqual(
		resolveNpmInvocationV1(
			['--version'],
			'win32',
			'C:\\Program Files\\nodejs\\node.exe',
		),
		{
			executable: 'C:\\Program Files\\nodejs\\node.exe',
			args: [
				'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
				'--version',
			],
		},
	);
	assert.deepEqual(
		resolveNpmInvocationV1(['--version'], 'linux', '/usr/bin/node'),
		{ executable: 'npm', args: ['--version'] },
	);
});

test('npm execution keeps shell mode disabled when caller options request a shell', () => {
	let captured;
	const result = execNpmV1(
		['--version'],
		{ encoding: 'utf8', shell: true },
		(...arguments_) => {
			captured = arguments_;
			return '11.12.1\n';
		},
	);
	assert.equal(result, '11.12.1\n');
	assert.equal(captured[2].encoding, 'utf8');
	assert.equal(captured[2].shell, false);
	assert.equal(captured[2].windowsHide, true);
});

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
		const executable = await realpath(process.execPath);
		const versionBootstrap = path.join(root, 'obsidian-version.cjs');
		await writeFile(
			versionBootstrap,
			'require("node:fs").writeSync(1, "Obsidian 1.12.7\\n"); process.exit(0);\n',
		);
		const bootstrapSpecifier = versionBootstrap.split(path.sep).join('/');
		const identity = officialObsidianCliIdentityV1('1.12.7', {
			executable,
			platform: 'linux',
			env: { ...process.env, NODE_OPTIONS: `--require="${bootstrapSpecifier}"` },
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

test('Windows acceptance executable resolution admits only regular exe and com files', () => {
	const files = new Set([
		'C:\\Tools\\obsidian.exe',
		'C:\\Tools\\obsidian.com',
		'C:\\Tools\\obsidian.cmd',
		'C:\\Tools\\obsidian.bat',
	]);
	const dependencies = {
		cwd: 'C:\\Work',
		realpath: candidate => candidate,
		lstat: candidate => {
			if (!files.has(candidate)) {
				const error = new Error('missing');
				error.code = 'ENOENT';
				throw error;
			}
			return { isFile: () => true, isSymbolicLink: () => false };
		},
	};
	const environment = {
		PATH: 'C:\\Tools;C:\\Other',
		PATHEXT: '.CMD;.BAT;.EXE;.COM',
	};
	assert.equal(
		resolveAcceptanceExecutableV1('obsidian', 'win32', environment, dependencies),
		'C:\\Tools\\obsidian.exe',
	);
	files.delete('C:\\Tools\\obsidian.exe');
	assert.equal(
		resolveAcceptanceExecutableV1('obsidian', 'win32', environment, dependencies),
		'C:\\Tools\\obsidian.com',
	);
	for (const forbidden of ['obsidian.cmd', 'obsidian.bat', 'C:\\Tools\\obsidian.cmd']) {
		assert.throws(
			() => resolveAcceptanceExecutableV1(forbidden, 'win32', environment, dependencies),
			/OFFICIAL_OBSIDIAN_CLI_EXECUTABLE_INVALID/u,
		);
	}
});

test('Windows acceptance executable resolution rejects symlink candidates', () => {
	assert.throws(
		() => resolveAcceptanceExecutableV1('obsidian.exe', 'win32', {
			PATH: 'C:\\Tools',
		}, {
			realpath: candidate => candidate,
			lstat: () => ({ isFile: () => true, isSymbolicLink: () => true }),
		}),
		/OFFICIAL_OBSIDIAN_CLI_EXECUTABLE_NOT_FOUND/u,
	);
});

test('Windows acceptance binds PowerShell to the canonical SystemRoot executable', () => {
	const visited = [];
	const resolved = resolveAcceptanceWindowsPowerShellV1({
		SystemRoot: 'C:\\Windows\\',
		WINDIR: 'c:\\windows',
	}, {
		lstat: candidate => {
			visited.push(candidate);
			return {
				isFile: () => candidate.endsWith('powershell.exe'),
				isSymbolicLink: () => false,
			};
		},
	});
	assert.equal(
		resolved.executable,
		'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
	);
	assert.equal(resolved.systemRoot, 'C:\\Windows');
	assert.ok(visited.includes('C:\\Windows'));
	assert.throws(
		() => resolveAcceptanceWindowsPowerShellV1({
			SystemRoot: 'C:\\Windows',
			WINDIR: 'D:\\Windows',
		}),
		/ACCEPTANCE_WINDOWS_POWERSHELL_UNAVAILABLE/u,
	);
});

test('Windows acceptance validates exe and com Authenticode with bounded strict JSON', () => {
	const calls = [];
	const environment = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' };
	const dependencies = {
		lstat: candidate => ({
			isFile: () => candidate.endsWith('powershell.exe'),
			isSymbolicLink: () => false,
		}),
		spawnSync: (executable, args, options) => {
			calls.push({ executable, args, options });
			return {
				status: 0,
				stdout: JSON.stringify({ Status: 'Valid', Thumbprint: 'A'.repeat(40) }),
				stderr: '',
			};
		},
	};
	for (const extension of ['exe', 'com']) {
		const identity = windowsAuthenticodeIdentityV1(
			`C:\\Tools\\obsidian.${extension}`,
			environment,
			dependencies,
		);
		assert.equal(identity.backend, 'windows-authenticode');
		assert.equal(identity.signerThumbprint, 'a'.repeat(40));
	}
	assert.equal(calls.length, 2);
	for (const call of calls) {
		assert.equal(
			call.executable,
			'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
		);
		assert.deepEqual(call.args.slice(0, 6), [
			'-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
		]);
		assert.equal(call.options.shell, false);
		assert.equal(call.options.timeout, 30_000);
		assert.equal(call.options.maxBuffer, 16_384);
		assert.equal(call.options.killSignal, 'SIGKILL');
		assert.deepEqual(Object.keys(call.options.env).sort(), [
			'OPERON_ACCEPTANCE_EXECUTABLE', 'SystemRoot', 'WINDIR',
		]);
	}
	assert.throws(
		() => windowsAuthenticodeIdentityV1('C:\\Tools\\obsidian.cmd', environment, dependencies),
		/must use \.exe or \.com/u,
	);
});

test('Windows Authenticode admission fails closed on malformed or expanded output', () => {
	const environment = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' };
	const lstat = candidate => ({
		isFile: () => candidate.endsWith('powershell.exe'),
		isSymbolicLink: () => false,
	});
	for (const stdout of [
		'not-json',
		JSON.stringify({ Status: 'Valid', Thumbprint: 'A'.repeat(40), Subject: 'unexpected' }),
		JSON.stringify({ Status: 'NotSigned', Thumbprint: '' }),
	]) {
		assert.throws(() => windowsAuthenticodeIdentityV1(
			'C:\\Tools\\obsidian.exe',
			environment,
			{
				lstat,
				spawnSync: () => ({ status: 0, stdout, stderr: '' }),
			},
		));
	}
});

test('Windows Authenticode admission fails closed on PowerShell execution failures', () => {
	const environment = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' };
	const lstat = candidate => ({
		isFile: () => candidate.endsWith('powershell.exe'),
		isSymbolicLink: () => false,
	});
	for (const result of [
		{ status: 1, stdout: '', stderr: '' },
		{ status: 0, stdout: '{}', stderr: 'diagnostic' },
		{ status: null, stdout: '', stderr: '', error: new Error('timeout') },
	]) {
		assert.throws(
			() => windowsAuthenticodeIdentityV1(
				'C:\\Tools\\obsidian.exe',
				environment,
				{ lstat, spawnSync: () => result },
			),
			/ACCEPTANCE_WINDOWS_POWERSHELL_UNAVAILABLE/u,
		);
	}
});
