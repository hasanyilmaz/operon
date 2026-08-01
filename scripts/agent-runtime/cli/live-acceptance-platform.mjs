import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	accessSync,
	constants as fsConstants,
	lstatSync,
	readFileSync,
	realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACCEPTANCE_FIXTURE_MARKER_V1 = '.operon-developer-api-native-fixture.json';
const ACCEPTANCE_FIXTURE_KIND_V1 = 'operon-developer-api-native-fixture-vault';
const ACCEPTED_OBSIDIAN_VERSIONS_V1 = new Set(['1.12.2', '1.12.7']);
const ACCEPTED_OS_REFS_V1 = new Set([
	'macos-26.5.2-arm64',
	'macos-15.7.7-arm64',
	'macos-14.8.7-arm64',
	'ubuntu-24.04.4-amd64',
	'ubuntu-26.04-amd64',
	'windows-11-25h2-26200.8875-x64',
]);
const WINDOWS_EXECUTABLE_EXTENSIONS_V1 = new Set(['.exe', '.com']);
const WINDOWS_POWERSHELL_RESULT_LIMIT_V1 = 16_384;
const WINDOWS_POWERSHELL_TIMEOUT_MS_V1 = 30_000;

export function assertLiveAcceptanceInputsV1(input, runtime = {
	nodeMajor: Number(process.versions.node.split('.')[0]),
}) {
	assert.match(input.cellId, /^[a-z0-9][a-z0-9._-]{2,95}$/u, 'Invalid --cell-id.');
	assert.ok(
		input.profile === 'full' || input.profile === 'smoke',
		'--profile must be full or smoke.',
	);
	assert.ok(
		ACCEPTED_OBSIDIAN_VERSIONS_V1.has(input.expectedObsidianVersion),
		'Obsidian acceptance must use frozen 1.12.2 or 1.12.7.',
	);
	assert.ok(
		ACCEPTED_OS_REFS_V1.has(input.expectedOsRef),
		'--expected-os-ref is outside the frozen native acceptance matrix.',
	);
	const { nodeMajor } = runtime;
	assert.ok([22, 24, 26].includes(nodeMajor), 'Acceptance requires Node 22, 24, or 26.');
	if (input.profile === 'full') {
		assert.equal(nodeMajor, 24, 'Full native acceptance requires Node 24.');
	} else {
		assert.ok(nodeMajor === 22 || nodeMajor === 26, 'Smoke acceptance requires Node 22 or 26.');
	}
}

export function nativePlatformIdentityV1(options = {}) {
	const platform = options.platform ?? process.platform;
	const environment = options.env ?? process.env;
	const common = {
		platform,
		arch: process.arch,
		release: os.release(),
	};
	if (platform === 'darwin') {
		const version = execFileSync('sw_vers', ['-productVersion'], {
			encoding: 'utf8',
		}).trim();
		const build = execFileSync('sw_vers', ['-buildVersion'], {
			encoding: 'utf8',
		}).trim();
		return {
			...common,
			osRef: `macos-${version}-${process.arch}`,
			version,
			build,
		};
	}
	if (platform === 'linux') {
		const fields = Object.fromEntries(readFileSync('/etc/os-release', 'utf8')
			.split(/\r?\n/u)
			.map(line => line.split('=', 2))
			.filter(parts => parts.length === 2)
			.map(([key, value]) => [key, value.replace(/^"|"$/gu, '')]));
		assert.equal(fields.ID, 'ubuntu', 'Native Linux reference must be Ubuntu.');
		assert.ok(fields.VERSION_ID === '24.04' || fields.VERSION_ID === '26.04');
		const pointVersion = fields.VERSION?.match(/\b(24\.04(?:\.[0-9]+)?|26\.04)\b/u)?.[1]
			?? fields.VERSION_ID;
		return {
			...common,
			osRef: `ubuntu-${pointVersion}-amd64`,
			version: pointVersion,
			build: pointVersion,
		};
	}
	if (platform === 'win32') {
		const document = runWindowsPowerShellJsonV1(
			'$v=Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";'
				+ '[ordered]@{DisplayVersion=[string]$v.DisplayVersion;'
				+ 'CurrentBuild=[string]$v.CurrentBuild;UBR=[int]$v.UBR}|ConvertTo-Json -Compress',
			environment,
			{},
			options.dependencies,
		);
		assert.deepEqual(
			Object.keys(document).sort(),
			['CurrentBuild', 'DisplayVersion', 'UBR'],
			'Native Windows identity returned unexpected fields.',
		);
		assert.equal(typeof document.DisplayVersion, 'string');
		assert.match(document.CurrentBuild, /^[0-9]{5,6}$/u);
		assert.ok(Number.isSafeInteger(document.UBR) && document.UBR >= 0);
		const build = `${document.CurrentBuild}.${document.UBR}`;
		assert.ok(Number(document.CurrentBuild) >= 22_000, 'Native Windows reference must be Windows 11.');
		const display = String(document.DisplayVersion).toLowerCase();
		return {
			...common,
			osRef: `windows-11-${display}-${build}-${process.arch}`,
			version: `11-${document.DisplayVersion}`,
			build,
		};
	}
	throw new Error('LIVE_ACCEPTANCE_PLATFORM_UNSUPPORTED');
}

export function npmCommandV1(platform = process.platform) {
	return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function validateDisposableAcceptanceVaultV1(vaultArgument) {
	const resolvedVault = path.resolve(vaultArgument);
	const canonicalVault = realpathSync(resolvedVault);
	assert.equal(
		canonicalVault,
		resolvedVault,
		'Native acceptance vault must be a canonical path without symlink or reparse indirection.',
	);
	const vaultStats = lstatSync(canonicalVault);
	assert.ok(
		vaultStats.isDirectory() && !vaultStats.isSymbolicLink(),
		'Native acceptance vault must be a real directory.',
	);
	const configRoot = path.join(canonicalVault, '.obsidian');
	assert.equal(realpathSync(configRoot), configRoot, 'Acceptance vault .obsidian path must be canonical.');
	const configStats = lstatSync(configRoot);
	assert.ok(
		configStats.isDirectory() && !configStats.isSymbolicLink(),
		'Acceptance vault .obsidian path must be a real directory.',
	);
	const markerPath = path.join(canonicalVault, ACCEPTANCE_FIXTURE_MARKER_V1);
	assert.equal(realpathSync(markerPath), markerPath, 'Acceptance fixture marker must be canonical.');
	const markerStats = lstatSync(markerPath);
	assert.ok(
		markerStats.isFile() && !markerStats.isSymbolicLink() && markerStats.nlink === 1,
		'Acceptance fixture marker must be a single-link regular file.',
	);
	const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
	assert.deepEqual(
		Object.keys(marker).sort(),
		['kind', 'nonce', 'runId'],
		'Acceptance fixture marker has unexpected fields.',
	);
	assert.equal(
		marker.kind,
		ACCEPTANCE_FIXTURE_KIND_V1,
		'Native acceptance refuses a vault without the disposable fixture marker.',
	);
	assert.match(marker.runId, /^[A-Za-z0-9._-]{1,160}$/u, 'Fixture runId is invalid.');
	assert.match(marker.nonce, /^[A-Za-z0-9._-]{16,160}$/u, 'Fixture nonce is invalid.');
	return {
		vaultPath: canonicalVault,
		marker: {
			kind: marker.kind,
			runId: marker.runId,
			nonceSha256: createHash('sha256').update(marker.nonce, 'utf8').digest('hex'),
		},
	};
}

export function officialObsidianCliIdentityV1(expectedVersion, options = {}) {
	const requestedExecutable = options.executable
		?? process.env.OPERON_ACCEPTANCE_OBSIDIAN_BIN
		?? 'obsidian';
	const platform = options.platform ?? process.platform;
	const environment = options.env ?? process.env;
	const executable = resolveAcceptanceExecutableV1(
		requestedExecutable,
		platform,
		environment,
		options.dependencies,
	);
	const executableStats = lstatSync(executable);
	assert.ok(
		executableStats.isFile() && !executableStats.isSymbolicLink(),
		'The resolved Obsidian CLI executable must be a regular canonical file.',
	);
	if (platform !== 'win32') {
		accessSync(executable, fsConstants.X_OK);
	}
	const executableBytes = readFileSync(executable);
	const nativeIdentity = nativeExecutableIdentityV1(
		executable,
		platform,
		environment,
		options.dependencies,
	);
	assert.equal(
		nativeIdentity.verified,
		true,
		'The resolved Obsidian CLI executable did not pass its platform-native identity check.',
	);
	const result = spawnSync(executable, ['version'], {
		encoding: 'utf8',
		windowsHide: true,
		env: environment,
	});
	assert.equal(
		result.status,
		0,
		'The official Obsidian CLI must be enabled and connected to the prestarted app.',
	);
	const rawVersion = result.stdout.trim();
	assert.ok(rawVersion.length > 0, 'The official Obsidian CLI returned no version identity.');
	assert.ok(
		rawVersion.includes(expectedVersion),
		`The official Obsidian CLI is not connected to Obsidian ${expectedVersion}.`,
	);
	return {
		executable,
		executableSha256: createHash('sha256').update(executableBytes).digest('hex'),
		identityBackend: nativeIdentity.backend,
		identityVerified: nativeIdentity.verified,
		identityDigest: createHash('sha256')
			.update(JSON.stringify(nativeIdentity), 'utf8')
			.digest('hex'),
		rawVersion,
	};
}

export function resolveNpmInvocationV1(
	args,
	platform = process.platform,
	nodeExecutable = process.execPath,
	pinnedNpmCliPath,
) {
	const pathApi = platform === 'win32' ? path.win32 : path;
	if (
		platform === 'win32'
		&& (
			typeof pinnedNpmCliPath !== 'string'
			|| !pathApi.isAbsolute(pinnedNpmCliPath)
			|| /[\0\r\n]/u.test(pinnedNpmCliPath)
			|| pathApi.basename(pinnedNpmCliPath).toLowerCase() !== 'npm-cli.js'
		)
	) {
		throw new Error('OPERON_ACCEPTANCE_NPM_CLI_INVALID');
	}
	return platform === 'win32'
		? {
			executable: nodeExecutable,
			args: [
				pinnedNpmCliPath,
				...args,
			],
		}
		: { executable: npmCommandV1(platform), args };
}

export function execNpmV1(args, options = {}, runner = execFileSync) {
	const invocation = resolveNpmInvocationV1(
		args,
		process.platform,
		process.execPath,
		(options.env ?? process.env).OPERON_ACCEPTANCE_NPM_CLI_JS,
	);
	return runner(invocation.executable, invocation.args, {
		...options,
		shell: false,
		windowsHide: true,
	});
}

export function installedCliArtifactV1(prefixRoot, env) {
	const globalRoot = execNpmV1(
		['root', '--global', '--prefix', prefixRoot],
		{ env, encoding: 'utf8' },
	).trim();
	return path.join(globalRoot, 'operon-cli', 'dist', 'operon.mjs');
}

export function runCliJsonV1(executable, args, env, input) {
	const result = spawnSync(process.execPath, [executable, ...args], {
		env,
		input,
		encoding: 'utf8',
		maxBuffer: 8 * 1_024 * 1_024,
	});
	if (result.stderr) process.stderr.write(result.stderr);
	assert.equal(result.status, 0, `${args.join(' ')} failed.`);
	return JSON.parse(result.stdout);
}

export function runAcceptanceProofV1(input) {
	const hook = bindRepositoryProofHookV1(
		input.hookPath,
		input.cwd,
		input.testOnlyAllowUncommittedHook === true && Boolean(process.env.NODE_TEST_CONTEXT),
	);
	const hookPath = path.join(input.cwd, hook.path);
	const result = spawnSync(process.execPath, [hookPath], {
		cwd: input.cwd,
		env: {
			...process.env,
			...input.env,
			OPERON_ACCEPTANCE_PROOF_KIND: input.kind,
			OPERON_ACCEPTANCE_CELL_ID: input.cellId,
			OPERON_ACCEPTANCE_PROFILE: input.profile,
			OPERON_ACCEPTANCE_TARBALL_SHA256: input.tarballSha256,
		},
		encoding: 'utf8',
		maxBuffer: 64 * 1_024 * 1_024,
	});
	assert.equal(
		result.status,
		0,
		`${input.kind} acceptance proof failed (stdout ${sha256Text(result.stdout)}, `
			+ `stderr ${sha256Text(result.stderr)}).`,
	);
	const parsed = parseLastJsonV1(result.stdout);
	assert.ok(parsed, `${input.kind} proof must emit a terminal JSON object.`);
	assert.ok(parsed.status === 'ok' || parsed.status === 'passed');
	const summary = strictProofSummaryV1(input.kind, parsed);
	return {
		status: 'passed',
		kind: input.kind,
		hook,
		outputSha256: sha256Text(result.stdout),
		result: summary,
	};
}

export function runCliJsonlV1(executable, frames, env) {
	const input = `${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`;
	const result = spawnSync(process.execPath, [executable, 'session', '--jsonl'], {
		env,
		input,
		encoding: 'utf8',
		maxBuffer: 16 * 1_024 * 1_024,
	});
	if (result.stderr) process.stderr.write(result.stderr);
	assert.equal(result.status, 0, 'session --jsonl failed.');
	const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
	assert.equal(lines.length, frames.reduce(
		(count, frame) => count + (Array.isArray(frame.reads) ? frame.reads.length : 1),
		0,
	));
	return lines.map(line => JSON.parse(line));
}

function parseLastJsonV1(output) {
	const trimmed = output.trim();
	if (!trimmed) return null;
	for (let index = trimmed.lastIndexOf('{'); index >= 0; index = trimmed.lastIndexOf('{', index - 1)) {
		try {
			return JSON.parse(trimmed.slice(index));
		} catch {
			// Continue to an earlier object boundary.
		}
	}
	return null;
}

function bindRepositoryProofHookV1(hookArgument, repositoryRoot, testOnlyAllowUncommitted) {
	const root = realpathSync(repositoryRoot);
	const hookPath = realpathSync(path.resolve(repositoryRoot, hookArgument));
	const relativePath = path.relative(root, hookPath).split(path.sep).join('/');
	assert.ok(
		relativePath.startsWith('scripts/agent-runtime/')
			&& !relativePath.includes('/../'),
		'Native proof hooks must be repository-owned Agent Runtime scripts.',
	);
	assert.equal(lstatSync(hookPath).isFile(), true, 'Native proof hook must be a regular file.');
	const workingBytes = readFileSync(hookPath);
	if (!testOnlyAllowUncommitted) {
		execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
			cwd: root,
			stdio: 'ignore',
		});
		const committedBytes = execFileSync('git', ['show', `HEAD:${relativePath}`], {
			cwd: root,
			encoding: 'buffer',
			maxBuffer: 64 * 1_024 * 1_024,
		});
		assert.deepEqual(
			workingBytes,
			committedBytes,
			'Native proof hook bytes must match the checked-out source commit.',
		);
	}
	return {
		path: relativePath,
		sha256: createHash('sha256').update(workingBytes).digest('hex'),
	};
}

export function resolveAcceptanceExecutableV1(
	requestedExecutable,
	platform,
	environment,
	dependencies = {},
) {
	if (!requestedExecutable || requestedExecutable.includes('\0')) {
		throw new Error('OFFICIAL_OBSIDIAN_CLI_EXECUTABLE_INVALID');
	}
	const platformPath = platform === 'win32' ? path.win32 : path;
	const lstat = dependencies.lstat ?? lstatSync;
	const realpath = dependencies.realpath ?? realpathSync;
	const cwd = dependencies.cwd ?? process.cwd();
	const hasSeparator = requestedExecutable.includes('/')
		|| requestedExecutable.includes('\\')
		|| platformPath.isAbsolute(requestedExecutable);
	const candidates = [];
	if (hasSeparator) {
		candidates.push(platformPath.resolve(cwd, requestedExecutable));
	} else {
		const pathEntries = String(environment.PATH ?? '')
			.split(platformPath.delimiter)
			.filter(Boolean);
		const requestedExtension = platformPath.extname(requestedExecutable).toLowerCase();
		if (
			platform === 'win32'
			&& requestedExtension
			&& !WINDOWS_EXECUTABLE_EXTENSIONS_V1.has(requestedExtension)
		) throw new Error('OFFICIAL_OBSIDIAN_CLI_EXECUTABLE_INVALID');
		const extensions = platform === 'win32' && !requestedExtension
			? [...WINDOWS_EXECUTABLE_EXTENSIONS_V1]
			: [''];
		for (const directory of pathEntries) {
			for (const extension of extensions) {
				candidates.push(platformPath.join(
					directory,
					`${requestedExecutable}${extension}`,
				));
			}
		}
	}
	if (
		platform === 'win32'
		&& !WINDOWS_EXECUTABLE_EXTENSIONS_V1.has(
			platformPath.extname(candidates[0] ?? requestedExecutable).toLowerCase(),
		)
	) throw new Error('OFFICIAL_OBSIDIAN_CLI_EXECUTABLE_INVALID');
	for (const candidate of candidates) {
		try {
			const candidateStats = lstat(candidate);
			if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) continue;
			const canonical = realpath(candidate);
			const canonicalStats = lstat(canonical);
			if (!canonicalStats.isFile() || canonicalStats.isSymbolicLink()) continue;
			if (
				platform === 'win32'
				&& !WINDOWS_EXECUTABLE_EXTENSIONS_V1.has(platformPath.extname(canonical).toLowerCase())
			) continue;
			return canonical;
		} catch {
			// Continue to the next deterministic PATH candidate.
		}
	}
	throw new Error('OFFICIAL_OBSIDIAN_CLI_EXECUTABLE_NOT_FOUND');
}

function nativeExecutableIdentityV1(executable, platform, environment, dependencies) {
	if (platform === 'darwin') {
		const verification = spawnSync('/usr/bin/codesign', [
			'--verify',
			'--strict',
			'--verbose=2',
			executable,
		], {
			encoding: 'utf8',
		});
		return {
			backend: 'macos-codesign',
			verified: verification.status === 0,
			status: verification.status,
		};
	}
	if (platform === 'win32') {
		return windowsAuthenticodeIdentityV1(executable, environment, dependencies);
	}
	return {
		backend: platform === 'linux' ? 'linux-canonical-executable' : 'canonical-executable',
		verified: true,
		status: 'canonical-regular-executable',
	};
}

export function windowsAuthenticodeIdentityV1(executable, environment, dependencies = {}) {
	const extension = path.win32.extname(executable).toLowerCase();
	assert.ok(
		WINDOWS_EXECUTABLE_EXTENSIONS_V1.has(extension),
		'Obsidian CLI Windows executable must use .exe or .com.',
	);
	const document = runWindowsPowerShellJsonV1(
		'$p=[Environment]::GetEnvironmentVariable("OPERON_ACCEPTANCE_EXECUTABLE", "Process");'
			+ '$s=Get-AuthenticodeSignature -LiteralPath $p;'
			+ '[ordered]@{Status=[string]$s.Status;'
			+ 'Thumbprint=[string]$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress',
		environment,
		{ OPERON_ACCEPTANCE_EXECUTABLE: executable },
		dependencies,
	);
	assert.deepEqual(
		Object.keys(document).sort(),
		['Status', 'Thumbprint'],
		'Authenticode verification returned unexpected fields.',
	);
	assert.equal(document.Status, 'Valid', 'Obsidian CLI Authenticode signature is not valid.');
	assert.match(document.Thumbprint, /^[A-Fa-f0-9]{40,128}$/u);
	return {
		backend: 'windows-authenticode',
		verified: true,
		status: document.Status,
		signerThumbprint: document.Thumbprint.toLowerCase(),
	};
}

export function resolveAcceptanceWindowsPowerShellV1(environment, dependencies = {}) {
	const lstat = dependencies.lstat ?? lstatSync;
	const systemRoot = environment.SystemRoot;
	const windowsDirectory = environment.WINDIR;
	if (
		!systemRoot
		|| !windowsDirectory
		|| systemRoot.includes('\0')
		|| windowsDirectory.includes('\0')
		|| !path.win32.isAbsolute(systemRoot)
		|| !path.win32.isAbsolute(windowsDirectory)
	) throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_UNAVAILABLE');
	const normalizedRoot = path.win32.normalize(systemRoot).replace(/[\\/]+$/u, '');
	const normalizedWindowsDirectory = path.win32.normalize(windowsDirectory).replace(/[\\/]+$/u, '');
	if (normalizedRoot.toLowerCase() !== normalizedWindowsDirectory.toLowerCase()) {
		throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_UNAVAILABLE');
	}
	const executable = path.win32.join(
		normalizedRoot,
		'System32',
		'WindowsPowerShell',
		'v1.0',
		'powershell.exe',
	);
	let cursor = executable;
	while (true) {
		let stats;
		try {
			stats = lstat(cursor);
		} catch {
			throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_UNAVAILABLE');
		}
		if (stats.isSymbolicLink() || (cursor === executable && !stats.isFile())) {
			throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_UNAVAILABLE');
		}
		const parent = path.win32.dirname(cursor);
		if (parent === cursor) break;
		cursor = parent;
	}
	return { executable, systemRoot: normalizedRoot };
}

function runWindowsPowerShellJsonV1(
	script,
	environment,
	commandEnvironment,
	dependencies = {},
) {
	const spawn = dependencies.spawnSync ?? spawnSync;
	const { executable, systemRoot } = resolveAcceptanceWindowsPowerShellV1(
		environment,
		dependencies,
	);
	const result = spawn(executable, [
		'-NoLogo',
		'-NoProfile',
		'-NonInteractive',
		'-ExecutionPolicy',
		'Bypass',
		'-Command',
		script,
	], {
		encoding: 'utf8',
		windowsHide: true,
		shell: false,
		env: {
			SystemRoot: systemRoot,
			WINDIR: systemRoot,
			...commandEnvironment,
		},
		maxBuffer: WINDOWS_POWERSHELL_RESULT_LIMIT_V1,
		timeout: WINDOWS_POWERSHELL_TIMEOUT_MS_V1,
		killSignal: 'SIGKILL',
	});
	if (result.error || result.status !== 0 || result.stderr?.trim()) {
		throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_UNAVAILABLE');
	}
	if (typeof result.stdout !== 'string') {
		throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_INVALID_RESULT');
	}
	let document;
	try {
		document = JSON.parse(result.stdout.trim());
	} catch {
		throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_INVALID_RESULT');
	}
	if (!document || typeof document !== 'object' || Array.isArray(document)) {
		throw new Error('ACCEPTANCE_WINDOWS_POWERSHELL_INVALID_RESULT');
	}
	return document;
}

function strictProofSummaryV1(kind, value) {
	const allowedByKind = {
		'all-mutation-families': [
			'status', 'tests', 'skipped', 'inconclusive', 'publishedFamilies',
			'exactPostflight', 'receiptReplay', 'performanceReference',
		],
		'node-compatibility-mutation': [
			'status', 'tests', 'skipped', 'inconclusive',
			'previewApplyReceiptReplay', 'postDispatchSamePlanRecovery',
		],
		'native-full-proof': [
			'status', 'tests', 'skipped', 'inconclusive', 'interruptionRecovery',
			'restartSamePlanRecovery', 'installRollbackReupgradeUninstall',
			'interruption', 'developerApi', 'platformSecurity',
		],
		'native-smoke-proof': [
			'status', 'tests', 'skipped', 'inconclusive',
			'postDispatchSamePlanRecovery', 'interruption',
		],
		fixture: ['status', 'tests'],
		'empty-fixture': ['status', 'tests'],
	};
	const allowed = allowedByKind[kind];
	assert.ok(allowed, `Unknown native proof kind ${kind}.`);
	const actualKeys = Object.keys(value).sort();
	const unexpected = actualKeys.filter(key => !allowed.includes(key));
	assert.deepEqual(
		unexpected,
		[],
		`${kind} proof emitted non-public or unredacted fields: ${unexpected.join(', ')}`,
	);
	const summary = {};
	for (const key of allowed) {
		if (Object.hasOwn(value, key)) summary[key] = structuredClone(value[key]);
	}
	if (summary.interruption) validateInterruptionSummaryV1(summary.interruption);
	if (summary.developerApi) validateDeveloperApiSummaryV1(summary.developerApi);
	if (summary.platformSecurity) {
		requireExactObjectKeysV1(summary.platformSecurity, [
			'status', 'skipped', 'inconclusive', 'passedChecks',
		], `${kind}.platformSecurity`);
	}
	if (summary.performanceReference) {
		requireExactObjectKeysV1(summary.performanceReference, [
			'status', 'samples', 'previewP95Ms', 'routineApplyP95Ms', 'otherApplyP95Ms',
		], `${kind}.performanceReference`);
	}
	return summary;
}

function validateInterruptionSummaryV1(interruption) {
	const expected = Object.hasOwn(interruption, 'preDispatch')
		? ['preDispatch', 'postDispatch']
		: ['postDispatch'];
	requireExactObjectKeysV1(interruption, expected, 'interruption');
	if (interruption.preDispatch) {
		requireExactObjectKeysV1(
			interruption.preDispatch,
			['exitCode', 'recoveryPresent'],
			'interruption.preDispatch',
		);
	}
	requireExactObjectKeysV1(
		interruption.postDispatch,
		['exitCode', 'status', 'samePlanRecovery'],
		'interruption.postDispatch',
	);
}

function validateDeveloperApiSummaryV1(developerApi) {
	requireExactObjectKeysV1(developerApi, [
		'status', 'skipped', 'inconclusive', 'tests', 'consumerArtifactSha256',
		'registryIdentity', 'healthCapabilities', 'exactRead', 'previewApplyReplay',
		'recoveryRef', 'rawEvidence',
	], 'developerApi');
	requireExactObjectKeysV1(
		developerApi.rawEvidence,
		['build', 'routine', 'recovery', 'commandTranscript'],
		'developerApi.rawEvidence',
	);
	for (const [key, digest] of Object.entries(developerApi.rawEvidence)) {
		requireExactObjectKeysV1(
			digest,
			['kind', 'bytes', 'sha256'],
			`developerApi.rawEvidence.${key}`,
		);
	}
}

function requireExactObjectKeysV1(value, expectedKeys, label) {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
	const actual = Object.keys(value).sort();
	const expected = [...expectedKeys].sort();
	assert.deepEqual(actual, expected, `${label} emitted non-public or unredacted fields.`);
}

function sha256Text(value) {
	return createHash('sha256').update(value ?? '', 'utf8').digest('hex');
}
