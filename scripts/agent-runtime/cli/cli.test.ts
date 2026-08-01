import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
	buildInvocationV1,
	createCliClientErrorV1,
	createCliUsageFailureV1,
	executeCliV1,
	exitCodeForEnvelopeV1,
	isPersistentReadCommandV1,
	parseCliArgsV1,
	renderHumanV1,
	runObsidianProcessV1,
	sanitizeProcessDiagnosticV1,
	sanitizeTerminalTextV1,
	validateCliMutationApplyResultBindingV1,
	type ProcessRunnerV1,
} from '../../../packages/operon-cli/src/client';
import { runPublicCommandLineV1 } from '../../../packages/operon-cli/src/command-line';
import { getOrCreateOperonCliClientIdV1 } from '../../../packages/operon-cli/src/client-identity';
import {
	isPlatformPathWithinV1,
	normalizedPlatformPathV1,
	samePlatformPathV1,
} from '../../../packages/operon-cli/src/config';
import { renderLocalHumanV1 } from '../../../packages/operon-cli/src/human-renderer';
import {
	buildGuidedCreationModelV1,
	type GuidedCreationPortV1,
	runGuidedCreationWizardV1,
} from '../../../packages/operon-cli/src/guided-creation';
import {
	runGuidedReminderWizardV1,
	runGuidedTaskUpdateWizardV1,
	runGuidedTimerStartWizardV1,
	runGuidedTimerStopWizardV1,
	runGuidedTransitionWizardV1,
} from '../../../packages/operon-cli/src/guided-maintenance';
import {
	completeInteractiveShellLineV1,
	type InteractiveShellSessionV1,
	renderUpdateNoticeV1,
	runInteractiveShellV1,
	shouldRetainShellHistoryV1,
	tokenizeShellLineV1,
} from '../../../packages/operon-cli/src/interactive-shell';
import {
	checkForCliUpdateV1,
	OPERON_CLI_DIST_TAGS_URL,
	selectCliUpdateNoticeV1,
} from '../../../packages/operon-cli/src/update-check';
import {
	runGuidedTaskFinderV1,
	type TaskFinderRuntimePortV1,
} from '../../../packages/operon-cli/src/task-finder';
import { OPERON_CLI_COMMAND_DEFINITIONS_V1 } from '../../../packages/operon-cli/src/command-registry';
import {
	cleanupSecureInvocationV1,
	ensureSecureRequestRootV1,
	fixedRequestRootV1,
	readInputFileSafelyV1,
	requestPathForTokenV1,
	REQUEST_TOKEN_PATTERN_V1,
	writeSecureInvocationV1,
	createCanonicalVaultFenceV1,
} from '../../../packages/operon-cli/src/protocol';
import {
	PersistentReadTransportErrorV1,
	type PersistentReadTransportV1,
} from '../../../packages/operon-cli/src/persistent-read-client';
import {
	resolveObsidianExecutableV1,
} from '../../../packages/operon-cli/src/process-platform';
import {
	inspectCliStorageSecurityV1,
	repairCliStorageSecurityV1,
	resolveWindowsPowerShellV1,
	secureCreatedFileV1,
	WINDOWS_ACL_TIMEOUT_MS_V1,
	writeSecureJsonAtomicV1,
} from '../../../packages/operon-cli/src/secure-storage';
import {
	decodeCliInvocationV1,
	decodeCliClientErrorEnvelopeV1,
	decodeCliResultEnvelopeV1,
} from '../../../src/agent-runtime/contracts/v1/decode';
import { computeSealedMutationPlanHashV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import type {
	CliInvocationV1,
	CliResultEnvelopeV1,
} from '../../../src/agent-runtime/contracts/v1/cli';
import type {
	ContextRevisionV1,
	OperonCatalogV1,
	TaskContextV1,
	TaskFinderRequestV1,
	TaskFinderResultV1 as RuntimeTaskFinderResultV1,
	TaskGetResultV1,
	TaskQueryFiltersV1,
	TaskQueryResultV1,
	TimerStateV1,
	MutationApplyRequestV1,
	MutationResultV1,
} from '../../../src/agent-runtime/contracts/v1';
import { validateCliInvocationForTransportV1 } from '../../../src/agent-runtime/transport/invocation-validator';
import {
	isCanonicalPathWithinRootV1,
	normalizeCanonicalVaultPathForIdentityV1,
} from '../../../src/agent-runtime/transport/vault-path-identity';

declare global {
	var __operonAgentRuntimeCliTestRun: Promise<void> | undefined;
}

globalThis.__operonAgentRuntimeCliTestRun = Promise.resolve().then(run);

async function run(): Promise<void> {
	testArgumentMatrix();
	testCrossPlatformCliStorageAndPaths();
	testWindowsPowerShellResolutionSecurity();
	testContractDecoders();
	testProductionInvocationValidatorParity();
	if (process.platform !== 'win32') testSecureRequestFile();
	await testInvocationConstruction();
	await testOneShotExecutionAndCleanup();
	if (process.platform !== 'win32') {
		await testOneShotPersistentReadRouting();
		await testAbortTransportGuards();
	}
	testRenderingAndExitCodes();
	testHumanRendererCoverage();
	await testGuidedCreationModel();
	await testGuidedMaintenanceModels();
	await testGuidedTaskFinder();
	testInteractiveShellLexingAndCompletion();
	await testCliUpdateCheck();
	await testInteractiveShellState();
	console.log('Agent Runtime CLI tests passed');
}

function testCrossPlatformCliStorageAndPaths(): void {
	assert.equal(
		normalizedPlatformPathV1('C:\\VAULTS\\İşler\\..\\İşler', 'win32'),
		normalizedPlatformPathV1('c:\\vaults\\İşler', 'win32'),
	);
	assert.equal(
		samePlatformPathV1('C:\\Vaults\\Café', 'c:\\vaults\\Cafe\u0301', 'win32'),
		true,
	);
	assert.equal(
		isPlatformPathWithinV1('C:\\Vaults\\Work', 'c:\\vaults\\work\\Projects\\A.md', 'win32'),
		true,
	);
	assert.equal(
		isPlatformPathWithinV1('C:\\Vaults\\Work', 'C:\\Vaults\\Work-copy\\A.md', 'win32'),
		false,
	);
	assert.equal(
		isPlatformPathWithinV1(
			'\\\\server\\share\\Vault',
			'\\\\SERVER\\SHARE\\vault\\Türkçe\\😀.md',
			'win32',
		),
		true,
	);
	assert.equal(
		normalizeCanonicalVaultPathForIdentityV1(
			'\\\\?\\C:\\VAULTS\\Cafe\u0301\\Türkçe\\😀',
			'win32',
		),
		'c:\\vaults\\café\\türkçe\\😀',
	);
	assert.equal(
		normalizeCanonicalVaultPathForIdentityV1(
			'\\\\?\\UNC\\SERVER\\Share\\Vault',
			'win32',
		),
		'\\\\server\\share\\vault',
	);
	assert.equal(
		isCanonicalPathWithinRootV1(
			'C:\\Vaults\\Operon',
			'c:\\vaults\\operon\\Tasks\\File.md',
			'win32',
		),
		true,
	);
	assert.equal(
		isCanonicalPathWithinRootV1(
			'C:\\Vaults\\Operon',
			'C:\\Vaults\\Operon-copy\\Tasks\\File.md',
			'win32',
		),
		false,
	);
	assert.equal(
		isCanonicalPathWithinRootV1(
			'\\\\?\\UNC\\SERVER\\Share\\Vault',
			'\\\\server\\share\\vault\\Inline\\Task.md',
			'win32',
		),
		true,
	);
	assert.equal(
		isCanonicalPathWithinRootV1('/vault', '/vault/Tasks/File.md', 'linux'),
		true,
	);
	assert.equal(
		isCanonicalPathWithinRootV1('/vault', '/vault-copy/Tasks/File.md', 'linux'),
		false,
	);
	assert.equal(
		isCanonicalPathWithinRootV1('/tmp/Caf\u00e9', '/tmp/Cafe\u0301/escape.md', 'linux'),
		false,
	);
	assert.equal(
		isCanonicalPathWithinRootV1(
			'C:\\Vaults\\Caf\u00e9',
			'C:\\Vaults\\Cafe\u0301\\escape.md',
			'win32',
		),
		false,
	);
	if (process.platform !== 'win32') {
		const fenceRoot = mkdtempSync(path.join(tmpdir(), 'operon-vault-fence-'));
		try {
			const vaultPath = path.join(fenceRoot, 'vault');
			const outsidePath = path.join(fenceRoot, 'vault-copy');
			mkdirSync(vaultPath);
			mkdirSync(outsidePath);
			symlinkSync(outsidePath, path.join(vaultPath, 'escape'));
			assert.equal(
				isCanonicalPathWithinRootV1(
					realpathSync(vaultPath),
					realpathSync(path.join(vaultPath, 'escape')),
					process.platform,
				),
				false,
			);
		} finally {
			rmSync(fenceRoot, { force: true, recursive: true });
		}
	}
	assert.equal(resolveObsidianExecutableV1('obsidian', { platform: 'linux' }), 'obsidian');
	assert.throws(
		() => resolveObsidianExecutableV1('obsidian.cmd', {
			platform: 'win32',
			env: { PATH: '' },
		}),
		/OBSIDIAN_BIN_INVALID/u,
	);

	const root = mkdtempSync(path.join(tmpdir(), 'operon-cli-security-'));
	try {
		chmodSync(root, 0o700);
		writeSecureJsonAtomicV1(path.join(root, 'config-v1.json'), {
			version: 1,
			profiles: [],
		});
			assert.deepEqual(inspectCliStorageSecurityV1(root), {
				backend: process.platform === 'win32' ? 'windows-dacl' : 'posix-mode',
				secure: true,
			});
			const staleAtomicTemp = path.join(
				root,
				'config-v1.json.123.12345678-1234-4123-8123-123456789abc.tmp',
			);
			writeFileSync(staleAtomicTemp, '{}\n', { encoding: 'utf8', mode: 0o600 });
			secureCreatedFileV1(staleAtomicTemp);
			assert.equal(inspectCliStorageSecurityV1(root).secure, true);
			assert.equal(repairCliStorageSecurityV1(root).secure, true);
			assert.equal(lstatSync(staleAtomicTemp, { throwIfNoEntry: false }), undefined);
			writeFileSync(
				path.join(root, 'foreign.json.123.12345678-1234-4123-8123-123456789abc.tmp'),
				'{}\n',
				{ encoding: 'utf8', mode: 0o600 },
			);
			assert.throws(
				() => repairCliStorageSecurityV1(root),
				/SECURITY_FOREIGN_CONTENT/u,
			);
			unlinkSync(path.join(root, 'foreign.json.123.12345678-1234-4123-8123-123456789abc.tmp'));
		if (process.platform === 'win32') {
			broadenWindowsPathAclForTest(root, 'directory');
			assert.equal(inspectCliStorageSecurityV1(root).secure, false);
			assert.equal(repairCliStorageSecurityV1(root).secure, true);
			broadenWindowsPathAclForTest(path.join(root, 'config-v1.json'), 'file');
			assert.equal(inspectCliStorageSecurityV1(root).secure, false);
			assert.equal(repairCliStorageSecurityV1(root).secure, true);
		} else {
			chmodSync(path.join(root, 'config-v1.json'), 0o644);
			assert.equal(inspectCliStorageSecurityV1(root).secure, false);
			assert.equal(repairCliStorageSecurityV1(root).secure, true);
		}
		writeFileSync(path.join(root, 'foreign.txt'), 'not Operon CLI state\n', 'utf8');
		assert.throws(
			() => repairCliStorageSecurityV1(root),
			/SECURITY_FOREIGN_CONTENT/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	const doctor = OPERON_CLI_COMMAND_DEFINITIONS_V1.find(definition => definition.id === 'doctor');
	assert.ok(doctor?.options?.some(option => option.includes('--repair-security')));
}

function testWindowsPowerShellResolutionSecurity(): void {
	assert.equal(WINDOWS_ACL_TIMEOUT_MS_V1, 30_000);
	const regular = {
		isFile: () => true,
		isSymbolicLink: () => false,
	};
	const resolved = resolveWindowsPowerShellV1({
		env: { SystemRoot: 'C:\\Windows', WINDIR: 'c:\\windows\\' },
		lstat: () => regular,
	});
	assert.equal(
		resolved.executable,
		'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
	);
	for (const env of [
		{},
		{ SystemRoot: 'C:\\Windows', WINDIR: 'D:\\Windows' },
		{ SystemRoot: 'Windows', WINDIR: 'Windows' },
		{ SystemRoot: 'C:\\Windows\0fake', WINDIR: 'C:\\Windows\0fake' },
	]) {
		assert.throws(
			() => resolveWindowsPowerShellV1({ env, lstat: () => regular }),
			/SECURITY_ACL_UNAVAILABLE/u,
		);
	}
	assert.throws(
		() => resolveWindowsPowerShellV1({
			env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' },
			lstat: candidate => ({
				isFile: () => true,
				isSymbolicLink: () => candidate.endsWith('\\System32'),
			}),
		}),
		/SECURITY_ACL_UNAVAILABLE/u,
	);
}

function broadenWindowsPathAclForTest(
	target: string,
	kind: 'file' | 'directory',
): void {
	const { executable, systemRoot } = resolveWindowsPowerShellV1();
	const getAccessControl = kind === 'directory'
		? '[IO.Directory]::GetAccessControl($p)'
		: '[IO.File]::GetAccessControl($p)';
	const setAccessControl = kind === 'directory'
		? '[IO.Directory]::SetAccessControl($p, $acl)'
		: '[IO.File]::SetAccessControl($p, $acl)';
	const inheritance = kind === 'directory'
		? 'ContainerInherit,ObjectInherit'
		: 'None';
	const script = [
		'$ErrorActionPreference = "Stop"',
		'$p = [Environment]::GetEnvironmentVariable("OPERON_TEST_SECURITY_PATH", "Process")',
		`$acl = ${getAccessControl}`,
		'$users = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-545")',
		`$rule = [Security.AccessControl.FileSystemAccessRule]::new($users, [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.InheritanceFlags]"${inheritance}", [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)`,
		'[void]$acl.AddAccessRule($rule)',
		setAccessControl,
	].join('; ');
	execFileSync(executable, [
		'-NoLogo',
		'-NoProfile',
		'-NonInteractive',
		'-ExecutionPolicy',
		'Bypass',
		'-Command',
		script,
	], {
		env: {
			SystemRoot: systemRoot,
			WINDIR: systemRoot,
			OPERON_TEST_SECURITY_PATH: target,
		},
		stdio: 'ignore',
		windowsHide: true,
		timeout: WINDOWS_ACL_TIMEOUT_MS_V1,
	});
}

async function testGuidedTaskFinder(): Promise<void> {
	const revision = finderRevision();
	const task = finderTask('abc1234', 'Release notes', {
		representation: 'inline',
		filePath: '20 Projects/Release.md',
		lineNumber: 3,
	}, revision);
	const answers = ['1'];
	const output: string[] = [];
	const seenFinderRequests: Array<Omit<
		TaskFinderRequestV1,
		'contractVersion' | 'requestId' | 'kind' | 'consistency'
	>> = [];
	let seenSelector: unknown;
	const runtime: TaskFinderRuntimePortV1 = {
		finder: async request => {
			seenFinderRequests.push(structuredClone(request));
			return {
				ok: true,
				value: finderQuery([task], revision),
				opaque: { finder: true },
			};
		},
		read: async selector => {
			seenSelector = structuredClone(selector);
			return {
				ok: true,
				value: finderGet(task, revision),
				opaque: { exact: true },
			};
		},
		catalog: async () => {
			throw new Error('Catalog must remain lazy for an unfiltered selection.');
		},
	};
	const result = await runGuidedTaskFinderV1({
		initialQuery: 'release notes',
		port: {
			ask: async () => answers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime,
	});
	assert.equal(result.status, 'selected');
	assert.deepEqual(seenFinderRequests, [{
		text: 'release notes',
		filters: { checkbox: ['open'] },
		scope: 'normal',
		limit: 10,
	}]);
	assert.deepEqual(seenSelector, {
		kind: 'exact-locator',
		locator: task.locator,
		expectedOperonId: 'abc1234',
	});
	assert.match(output.join(''), /Release notes/u);

	const staleAnswers = ['n', '1'];
	let queryCalls = 0;
	const staleResult = await runGuidedTaskFinderV1({
		initialQuery: '',
		port: {
			ask: async () => staleAnswers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime: {
			...runtime,
				finder: async request => {
					queryCalls += 1;
					if (request.cursor) {
						return {
							ok: false,
							code: 'stale-cursor',
							failure: { stale: true },
						};
					}
				return {
					ok: true,
					value: finderQuery([task], revision, queryCalls === 1 ? 'next-page' : undefined),
					opaque: { query: true },
				};
			},
		},
	});
	assert.equal(staleResult.status, 'selected');
	assert.equal(queryCalls, 3);
	assert.match(output.join(''), /results restarted from page 1/u);

	const menuAnswers = ['r', '2', 'v', '2', 'j', '2', '1', '1'];
	const menuRequests: Array<Omit<
		TaskFinderRequestV1,
		'contractVersion' | 'requestId' | 'kind' | 'consistency'
	>> = [];
	const menuResult = await runGuidedTaskFinderV1({
		initialQuery: '',
		port: {
			ask: async () => menuAnswers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime: {
			...runtime,
			finder: async request => {
				menuRequests.push(structuredClone(request));
				if (request.project && !request.project.rootOperonId) {
					const base = finderQuery([], revision);
					return {
						ok: true,
						value: {
							...base,
							rows: [{
								kind: 'project' as const,
								task,
								score: 1,
								directTaskCount: 1,
								treeTaskCount: 1,
								visibleDirectTaskCount: 1,
								visibleTreeTaskCount: 1,
							}],
							page: {
								...base.page,
								actualCount: 1,
								returnedCount: 1,
							},
						},
						opaque: { project: true },
					};
				}
				return {
					ok: true,
					value: finderQuery([task], revision),
					opaque: { task: true },
				};
			},
		},
	});
	assert.equal(menuResult.status, 'selected');
	assert.deepEqual(menuRequests.at(-1), {
		filters: { checkbox: ['open'] },
		representations: ['inline'],
		scope: 'overdue',
		project: { mode: 'direct', rootOperonId: 'abc1234' },
		limit: 10,
	});
	assert.ok(menuRequests.some(request => (
		request.scope === 'overdue'
		&& request.representations?.[0] === 'inline'
		&& request.project?.mode === 'direct'
		&& request.project.rootOperonId === undefined
	)));

	const invalidSearchAnswers = ['release notes', '1'];
	const invalidSearchResult = await runGuidedTaskFinderV1({
		initialQuery: '--',
		port: {
			ask: async () => invalidSearchAnswers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime,
	});
	assert.equal(invalidSearchResult.status, 'selected');
	assert.match(output.join(''), /requires 2-4,096 characters/u);

	const oversizedSearchAnswers = ['release notes', '1'];
	const oversizedSearchResult = await runGuidedTaskFinderV1({
		initialQuery: 'x'.repeat(4_097),
		port: {
			ask: async () => oversizedSearchAnswers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime,
	});
	assert.equal(oversizedSearchResult.status, 'selected');
	assert.match(output.join(''), /2-4,096 characters/u);

	const searchScopeRequests: Array<Omit<
		TaskFinderRequestV1,
		'contractVersion' | 'requestId' | 'kind' | 'consistency'
	>> = [];
	const searchScopeAnswers = ['v', '2', 's', 'release', '1'];
	const searchScopeResult = await runGuidedTaskFinderV1({
		initialQuery: '',
		port: {
			ask: async () => searchScopeAnswers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime: {
			...runtime,
			finder: async request => {
				searchScopeRequests.push(structuredClone(request));
				return {
					ok: true,
					value: finderQuery([task], revision),
					opaque: { task: true },
				};
			},
		},
	});
	assert.equal(searchScopeResult.status, 'selected');
	assert.equal(searchScopeRequests.at(-1)?.scope, 'normal');
	assert.equal(searchScopeRequests.at(-1)?.text, 'release');

	const terminalFilterRequests: Array<Omit<
		TaskFinderRequestV1,
		'contractVersion' | 'requestId' | 'kind' | 'consistency'
	>> = [];
	const terminalFilterAnswers = ['v', '2', 'f', '1', '2', 'b', '1'];
	const terminalFilterResult = await runGuidedTaskFinderV1({
		initialQuery: '',
		port: {
			ask: async () => terminalFilterAnswers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime: {
			...runtime,
			catalog: async () => ({
				ok: true,
				value: finderCatalog(),
				opaque: { catalog: true },
			}),
			finder: async request => {
				terminalFilterRequests.push(structuredClone(request));
				return {
					ok: true,
					value: finderQuery([task], revision),
					opaque: { task: true },
				};
			},
		},
	});
	assert.equal(terminalFilterResult.status, 'selected');
	assert.equal(terminalFilterRequests.at(-1)?.scope, 'normal');
	assert.deepEqual(terminalFilterRequests.at(-1)?.filters?.checkbox, ['done']);

	const legacyTask: TaskContextV1 = {
		...task,
		identity: {
			operonId: 'legacy-id',
			validity: 'legacy-invalid',
			mutationAllowed: false,
		},
	};
	let legacySelector: unknown;
	const legacyResult = await runGuidedTaskFinderV1({
		initialQuery: 'legacy',
		port: {
			ask: async () => '1',
			write: value => output.push(value),
		},
		runtime: {
			...runtime,
			finder: async () => ({
				ok: true,
				value: finderQuery([legacyTask], revision),
				opaque: { query: true },
			}),
			read: async selector => {
				legacySelector = structuredClone(selector);
				return {
					ok: true,
					value: finderGet(legacyTask, revision),
					opaque: { exact: true },
				};
			},
		},
	});
	assert.equal(legacyResult.status, 'selected');
	assert.deepEqual(legacySelector, {
		kind: 'exact-locator',
		locator: legacyTask.locator,
	});

	let mutationReadCalls = 0;
	const mutationAnswers = ['1', 'q'];
	const mutationResult = await runGuidedTaskFinderV1({
		initialQuery: 'legacy',
		purpose: 'mutation-target',
		port: {
			ask: async () => mutationAnswers.shift() ?? null,
			write: value => output.push(value),
		},
		runtime: {
			...runtime,
			finder: async () => ({
				ok: true,
				value: finderQuery([legacyTask], revision),
				opaque: { query: true },
			}),
			read: async selector => {
				mutationReadCalls += 1;
				return await runtime.read(selector);
			},
		},
	});
	assert.equal(mutationResult.status, 'cancelled');
	assert.equal(mutationReadCalls, 0);
}

function finderRevision(): ContextRevisionV1 {
	return {
		index: {
			sessionId: 'finder-session',
			ramGeneration: 7,
			durable: { status: 'missing' },
		},
		settingsFingerprint: 'a'.repeat(64),
		pinnedGeneration: 0,
		activeTrackerGeneration: 0,
		repeatSeriesRevision: 0,
		projectSerialGeneration: 0,
		projectSerialSignature: 'b'.repeat(64),
	};
}

function finderFreshness() {
	return {
		source: 'live-runtime' as const,
		coherence: 'verified' as const,
		observedAt: '2026-07-25T10:00:00.000Z',
		settled: true,
	};
}

function finderCatalog(): Extract<OperonCatalogV1, { ok: true }> {
	return {
		ok: true,
		taxonomy: {
			pipelines: [],
			priorities: [],
		},
	} as unknown as Extract<OperonCatalogV1, { ok: true }>;
}

function finderTask(
	operonId: string,
	description: string,
	locator: TaskContextV1['locator'],
	contextRevision: ContextRevisionV1,
): TaskContextV1 {
	return {
		identity: { operonId, validity: 'canonical', mutationAllowed: true },
		description,
		representation: locator.representation,
		locator,
		checkbox: 'open',
		workflow: {
			pipeline: { id: 'work', label: 'Work' },
			status: { id: 'active', label: 'Active' },
		},
		priority: { id: 'normal', label: 'Normal' },
		dates: {},
		datetimes: {},
		relationships: {
			childOperonIds: [],
			blockingOperonIds: [],
			blockedByOperonIds: [],
			relatedOperonIds: [],
		},
		recurrence: { repeating: false },
		tracker: { active: false, sessionCount: 0 },
		pinned: false,
		sourceRevision: { algorithm: 'sha256', contentDigest: 'c'.repeat(64) },
		contextRevision,
	};
}

function finderQuery(
	tasks: TaskContextV1[],
	contextRevision: ContextRevisionV1,
	nextCursor?: string,
): Extract<RuntimeTaskFinderResultV1, { ok: true }> {
	return {
		contractVersion: 1,
		requestId: 'finder-query',
		kind: 'task-finder-result',
		freshness: finderFreshness(),
		warnings: [],
		ok: true,
		contextRevision,
		rows: tasks.map(task => ({ kind: 'task', task, score: 1 })),
		page: {
			actualCount: tasks.length + (nextCursor ? 1 : 0),
			returnedCount: tasks.length,
			truncated: Boolean(nextCursor),
			...(nextCursor ? { nextCursor } : {}),
			asOf: '2026-07-25T10:00:00.000Z',
		},
		provenance: [],
		truncations: [],
	};
}

function finderGet(
	task: TaskContextV1,
	contextRevision: ContextRevisionV1,
): TaskGetResultV1 {
	return {
		contractVersion: 1,
		requestId: 'finder-get',
		kind: 'task-get-result',
		freshness: finderFreshness(),
		warnings: [],
		ok: true,
		contextRevision,
		task,
		provenance: [],
		truncations: [],
	};
}

function testInteractiveShellLexingAndCompletion(): void {
	assert.deepEqual(tokenizeShellLineV1('task create "quoted task"'), [
		'task',
		'create',
		'quoted task',
	]);
	assert.deepEqual(tokenizeShellLineV1("schema get 'mutation intent'"), [
		'schema',
		'get',
		'mutation intent',
	]);
	assert.deepEqual(tokenizeShellLineV1('task\\ create "" a\\\\b'), [
		'task create',
		'',
		'a\\b',
	]);
	assert.deepEqual(tokenizeShellLineV1('health;touch /tmp/never'), [
		'health;touch',
		'/tmp/never',
	]);
	assert.deepEqual(tokenizeShellLineV1('health $(touch /tmp/never)'), [
		'health',
		'$(touch',
		'/tmp/never)',
	]);
	assert.throws(() => tokenizeShellLineV1('health "unterminated'), /SHELL_UNTERMINATED_QUOTE/u);
	assert.throws(() => tokenizeShellLineV1('health \u202e'), /SHELL_INPUT_UNSAFE/u);
	assert.throws(() => tokenizeShellLineV1(`health ${'a'.repeat(16_385)}`), /SHELL_LINE_TOO_LARGE/u);
	assert.equal(shouldRetainShellHistoryV1(['health']), true);
	assert.equal(shouldRetainShellHistoryV1(['task', 'create']), true);
	assert.equal(shouldRetainShellHistoryV1(['task', 'create', 'secret']), false);
	assert.equal(shouldRetainShellHistoryV1(['task', 'get', '--id', 'abc1234']), false);
	assert.equal(shouldRetainShellHistoryV1(['plan', 'show', 'opaque-ref']), false);
	assert.equal(shouldRetainShellHistoryV1(['unknown', 'secret']), false);
	assert.equal(shouldRetainShellHistoryV1(['task', 'get', '--id=abc1234']), false);
	for (const definition of OPERON_CLI_COMMAND_DEFINITIONS_V1) {
		assert.equal(
			shouldRetainShellHistoryV1([...definition.path, 'phase4-secret']),
			false,
			`${definition.id} must not retain an arbitrary positional value.`,
		);
	}
	assert.deepEqual(completeInteractiveShellLineV1('ta')[0], ['task']);
	assert.deepEqual(completeInteractiveShellLineV1('task ')[0], [
		'cancel',
		'complete',
		'convert',
		'create',
		'delete',
		'find',
		'get',
		'pin',
		'relocate',
		'reopen',
		'transition',
		'unpin',
		'update',
	]);
	assert.deepEqual(completeInteractiveShellLineV1('task create --j')[0], ['--json']);
	assert.deepEqual(completeInteractiveShellLineV1('task update --cl')[0], ['--clear']);
	assert.deepEqual(completeInteractiveShellLineV1('task update --scope ')[0], [
		'this-and-following',
		'this-task',
	]);
	assert.deepEqual(completeInteractiveShellLineV1('task create --profile ')[0], []);
	assert.deepEqual(completeInteractiveShellLineV1('task get --id ')[0], []);
	assert.deepEqual(completeInteractiveShellLineV1('ex')[0], ['exit']);
	const completionRoot = mkdtempSync(path.join(tmpdir(), 'operon-shell-completion-'));
	const outsideRoot = mkdtempSync(path.join(tmpdir(), 'operon-shell-completion-outside-'));
	try {
		writeFileSync(path.join(completionRoot, 'inside.json'), '{}');
		writeFileSync(path.join(outsideRoot, 'private.json'), '{}');
		symlinkSync(outsideRoot, path.join(completionRoot, 'outside'));
		symlinkSync(path.join(completionRoot, 'inside.json'), path.join(completionRoot, 'linked.json'));
		assert.deepEqual(
			completeInteractiveShellLineV1('query --input in', completionRoot)[0],
			['inside.json'],
		);
		assert.deepEqual(
			completeInteractiveShellLineV1('query --input outside/', completionRoot)[0],
			[],
		);
		assert.deepEqual(
			completeInteractiveShellLineV1('query --input link', completionRoot)[0],
			[],
		);
	} finally {
		rmSync(completionRoot, { recursive: true, force: true });
		rmSync(outsideRoot, { recursive: true, force: true });
	}
}

async function testInteractiveShellState(): Promise<void> {
	const root = mkdtempSync(path.join(tmpdir(), 'operon-shell-'));
	const stdout: string[] = [];
	const stderr: string[] = [];
	const forgotten: string[] = [];
	const prompts: string[] = [];
	const calls: string[][] = [];
	const events = [
		{ kind: 'line', value: 'health' },
		{ kind: 'line', value: 'unknown secret' },
		{ kind: 'line', value: 'query --input -' },
		{ kind: 'interrupt' },
		{ kind: 'line', value: 'operon version --json' },
		{ kind: 'line', value: 'exit' },
	] as const;
	let eventIndex = 0;
	let closed = false;
	let activeController: AbortController | null = null;
	const session: InteractiveShellSessionV1 = {
		guidedPort: {
			ask: async () => null,
			write: text => stdout.push(text),
		},
		get closed() {
			return closed;
		},
		readCommand: async prompt => {
			prompts.push(prompt);
			return events[eventIndex++] ?? { kind: 'eof' };
		},
		forgetLatest: line => forgotten.push(line),
		setActiveCommand: controller => {
			activeController = controller;
		},
		writeStdout: text => stdout.push(text),
		writeStderr: text => stderr.push(text),
		close: () => {
			closed = true;
		},
	};
	try {
		const exitCode = await runInteractiveShellV1({
			session,
			configRoot: path.join(root, 'config'),
			cwd: root,
			version: '0.1.0-test',
			updateNotice: {
				currentVersion: '0.1.0-beta.23',
				availableVersion: '0.1.0',
				channel: 'latest',
				updateCommand: 'npm install --global @stratejya/operon-cli',
				releaseUrl: 'https://www.npmjs.com/package/@stratejya/operon-cli/v/0.1.0',
			},
			runCommand: async tokens => {
				calls.push([...tokens]);
				const ok = tokens[0] !== 'unknown';
				return {
					exitCode: ok ? 0 : 2,
					json: tokens.includes('--json'),
					envelope: {
						contractVersion: 1,
						kind: 'operon-cli-local-result',
						command: tokens.join('.'),
						ok,
						...(ok ? { result: { tokens } } : {
							error: {
								contractVersion: 1,
								code: 'invalid-request',
								reason: 'Unknown command.',
								retryable: false,
								action: 'fix-request',
								details: { reasonCode: 'unknown-command' },
							},
						}),
					},
					human: ok ? `ran ${tokens.join(' ')}` : 'Error: Unknown command.',
				};
			},
		});
		assert.equal(exitCode, 0);
		assert.deepEqual(calls, [
			['health'],
			['unknown', 'secret'],
			['version', '--json'],
		]);
		assert.ok(stdout.join('').includes('Operon CLI 0.1.0-test'));
		assert.ok(stdout.join('').includes('✨ Update available! 0.1.0-beta.23 → 0.1.0'));
		assert.ok(stdout.join('').includes('npm install --global @stratejya/operon-cli'));
		assert.ok(!stdout.join('').includes('operon-cli@beta'));
		assert.ok(stdout.join('').includes('"command":"version.--json"'));
		assert.ok(stderr.join('').includes('Error: Unknown command.'));
		assert.ok(stderr.join('').includes('stdin input is unavailable'));
		assert.ok(forgotten.includes('unknown secret'));
		assert.ok(forgotten.includes('query --input -'));
		assert.ok(forgotten.includes('exit'));
		assert.ok(prompts.every(prompt => prompt === 'operon[unresolved]> '));
		assert.equal(activeController, null);
		assert.equal(closed, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

async function testCliUpdateCheck(): Promise<void> {
	assert.equal(
		OPERON_CLI_DIST_TAGS_URL,
		'https://registry.npmjs.org/-/package/%40stratejya%2Foperon-cli/dist-tags',
	);
	const stable = selectCliUpdateNoticeV1('0.1.0-beta.23', {
		latest: '0.1.0',
		beta: '0.1.0-beta.24',
	});
	assert.equal(stable?.channel, 'latest');
	assert.equal(stable?.availableVersion, '0.1.0');
	assert.equal(stable?.updateCommand, 'npm install --global @stratejya/operon-cli');

	const beta = selectCliUpdateNoticeV1('0.1.0-beta.23', {
		beta: '0.1.0-beta.24',
	});
	assert.equal(beta?.channel, 'beta');
	assert.equal(beta?.updateCommand, 'npm install --global @stratejya/operon-cli@beta');

	assert.equal(selectCliUpdateNoticeV1('0.1.0', {
		latest: '0.1.0',
		beta: '0.2.0-beta.1',
	}), null);
	assert.equal(selectCliUpdateNoticeV1('0.2.0-beta.1', {
		latest: '0.1.0',
		beta: '0.2.0-beta.10',
	})?.availableVersion, '0.2.0-beta.10');
	assert.equal(selectCliUpdateNoticeV1('0.1.0-beta.23', {
		latest: 'not-semver',
		beta: '0.1.0-beta.24',
	})?.channel, 'beta');

	const rendered = renderUpdateNoticeV1(stable as NonNullable<typeof stable>);
	assert.match(rendered, /^╭─/u);
	assert.match(rendered, /See release details:/u);
	assert.match(rendered, /operon-cli\/v\/0\.1\.0/u);

	const root = mkdtempSync(path.join(tmpdir(), 'operon-update-check-'));
	let requests = 0;
	try {
		const first = await checkForCliUpdateV1({
			currentVersion: '0.1.0-beta.23',
			configRoot: root,
			now: new Date('2026-07-29T12:00:00.000Z'),
			requestJson: async () => {
				requests += 1;
				return { latest: '0.1.0', beta: '0.1.0-beta.24' };
			},
		});
		assert.equal(first?.channel, 'latest');
		assert.equal(requests, 1);
		const cachePath = path.join(root, 'update-check-v1.json');
		if (process.platform === 'win32') {
			assert.deepEqual(inspectCliStorageSecurityV1(root), {
				backend: 'windows-dacl',
				secure: true,
			});
		} else {
			assert.equal(lstatSync(cachePath).mode & 0o077, 0);
		}

		const cached = await checkForCliUpdateV1({
			currentVersion: '0.1.0-beta.23',
			configRoot: root,
			now: new Date('2026-07-29T13:00:00.000Z'),
			requestJson: async () => {
				requests += 1;
				throw new Error('fresh cache must skip the network');
			},
		});
		assert.equal(cached?.channel, 'latest');
		assert.equal(requests, 1);

		writeFileSync(cachePath, 'x'.repeat(16_385), { mode: 0o600 });
		const oversizedCacheRecovery = await checkForCliUpdateV1({
			currentVersion: '0.1.0-beta.23',
			configRoot: root,
			now: new Date('2026-07-29T13:01:00.000Z'),
			requestJson: async () => {
				requests += 1;
				return { latest: '0.1.0' };
			},
		});
		assert.equal(oversizedCacheRecovery?.channel, 'latest');
		assert.equal(requests, 2);

		const disabled = await checkForCliUpdateV1({
			currentVersion: '0.1.0-beta.23',
			configRoot: path.join(root, 'disabled'),
			env: { OPERON_CLI_UPDATE_CHECK: '0' },
			requestJson: async () => {
				throw new Error('disabled check must skip the network');
			},
		});
		assert.equal(disabled, null);
		assert.equal(lstatMissing(path.join(root, 'disabled')), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function testArgumentMatrix(): void {
	const vault = '/tmp/vault';
	assert.equal(parseCliArgsV1(['health', '--vault', vault]).command, 'health');
	assert.equal(parseCliArgsV1(['capabilities', '--vault', vault]).command, 'capabilities');
	assert.equal(parseCliArgsV1(['catalog', '--vault', vault, '--consistency', 'best-effort']).command, 'catalog');
	assert.throws(
		() => parseCliArgsV1(['catalog', '--vault', vault, '--input', '-']),
		/CATALOG_DOES_NOT_ACCEPT_INPUT/u,
	);
	assert.equal(parseCliArgsV1(['entity', 'resolve', '--vault', vault, '--input', '-']).command, 'entity.resolve');
	assert.equal(parseCliArgsV1(['task', 'get', '--vault', vault, '--id', 'abc1234']).command, 'task.get');
	assert.equal(parseCliArgsV1(['query', '--vault', vault, '--input', '-']).command, 'tasks.query');
	assert.equal(parseCliArgsV1(['relationships', '--vault', vault, '--input', '-']).command, 'relationships.get');
	assert.equal(parseCliArgsV1(['context', '--vault', vault, '--input', '-']).command, 'context.build');
	assert.equal(parseCliArgsV1(['timer', 'state', '--vault', vault]).command, 'timers.read');
	assert.equal(parseCliArgsV1(['timer', 'get', '--vault', vault]).command, 'timers.read');
	assert.equal(parseCliArgsV1(['mutation', 'preview', '--vault', vault, '--input', '-']).command, 'mutation.preview');
	assert.equal(parseCliArgsV1(['mutation', 'apply', '--vault', vault, '--input', '-']).command, 'mutation.apply');
	assert.throws(
		() => parseCliArgsV1(['task', 'get', '--vault', vault, '--id', 'abc1234', '--input', '-']),
		/TASK_GET_REQUIRES_EXACTLY_ONE_SELECTOR_INPUT/u,
	);
	assert.throws(
		() => parseCliArgsV1(['health', '--vault', vault, '--timeout-ms', '30001']),
		/READINESS_TIMEOUT_OUT_OF_RANGE/u,
	);
	assert.throws(
		() => parseCliArgsV1(['catalog', '--vault', vault, '--consistency', 'offline']),
		/INVALID_CONSISTENCY/u,
	);
}

function testProductionInvocationValidatorParity(): void {
	const validHealth = healthInvocation();
	const validCatalog: CliInvocationV1 = {
		...validHealth,
		requestId: 'cli-catalog-001',
		command: 'catalog',
		request: {
			contractVersion: 1,
			requestId: 'cli-catalog-001',
			kind: 'catalog',
			consistency: 'best-effort',
		},
	};
	const cases: unknown[] = [
		validHealth,
		validCatalog,
		{ ...validCatalog, request: { ...validCatalog.request, requestId: 'mismatch' } },
		{ ...validHealth, unknown: true },
		{ ...validHealth, readinessTimeoutMs: 30_001 },
		JSON.parse('{"contractVersion":1,"kind":"cli-invocation","requestId":"x","command":"health","mode":"live","clientVersion":"0.1.0","compatibility":{"contractVersion":1,"runtimeApi":{"min":1,"max":1}},"cliContract":{"min":1,"max":1},"expectedVaultSha256":"0000000000000000000000000000000000000000000000000000000000000000","readinessTimeoutMs":15000,"__proto__":{}}'),
	];
	for (const value of cases) {
		assert.equal(
			validateCliInvocationForTransportV1(value).ok,
			decodeCliInvocationV1(value).ok,
			'Production transport admission must match the portable contract decoder.',
		);
	}
}

function testContractDecoders(): void {
	const invocation = healthInvocation();
	assert.equal(decodeCliInvocationV1(invocation).ok, true);
	assert.equal(decodeCliInvocationV1({ ...invocation, requestId: 'invalid request' }).ok, false);
	assert.equal(decodeCliInvocationV1({ ...invocation, request: {} }).ok, false);
	assert.equal(decodeCliInvocationV1({ ...invocation, __proto__: { polluted: true } }).ok, false);

	const failure = failureEnvelope(invocation, 12);
	assert.equal(decodeCliResultEnvelopeV1(failure).ok, true);
	assert.equal(
		decodeCliResultEnvelopeV1({ ...failure, futureOptionalField: 'additive-v1' }).ok,
		true,
	);
	assert.equal(decodeCliClientErrorEnvelopeV1(createCliClientErrorV1('Invalid command.')).ok, true);

	const cases = JSON.parse(readFileSync(
		path.join(process.cwd(), 'scripts/agent-runtime/contracts/fixtures/cases.json'),
		'utf8',
	)) as { cases: Array<{ id: string; value: unknown }> };
	const applyRequest = cases.cases.find(item => item.id === 'valid-destructive-delete-apply')?.value;
	const partialResult = cases.cases.find(item => item.id === 'valid-partial-atomic-group-result')?.value;
	assert.ok(applyRequest && partialResult);
	const applyRecord = applyRequest as { requestId: string };
	const invocationWithPlan: CliInvocationV1 = {
		...invocation,
		requestId: applyRecord.requestId,
		command: 'mutation.apply',
		request: applyRequest as CliInvocationV1['request'],
	};
	const substitutedResult = structuredClone(partialResult) as Record<string, unknown>;
	substitutedResult.requestId = applyRecord.requestId;
	const groupResults = substitutedResult.groupResults as Array<Record<string, unknown>>;
	groupResults[0].groupId = 'substituted-group';
	const substitutedEnvelope = {
		...failure,
		requestId: applyRecord.requestId,
		command: 'mutation.apply',
		ok: true,
		result: substitutedResult,
		warnings: [],
	} as unknown as CliResultEnvelopeV1;
	assert.equal(
		validateCliMutationApplyResultBindingV1(invocationWithPlan, substitutedEnvelope),
		false,
		'CLI must reject structurally valid mutation results that are not bound to the submitted plan.',
	);
}

function testSecureRequestFile(): void {
	const root = mkdtempSync(path.join(tmpdir(), 'operon-cli-request-test-'));
	rmSync(root, { recursive: true, force: true });
	try {
		const request = writeSecureInvocationV1(healthInvocation(), { root });
		assert.match(request.token, REQUEST_TOKEN_PATTERN_V1);
		assert.equal(request.path, requestPathForTokenV1(request.token, root));
		assert.equal(lstatSync(root).mode & 0o777, 0o700);
		assert.equal(lstatSync(request.path).mode & 0o777, 0o600);
		assert.equal(JSON.parse(readFileSync(request.path, 'utf8')).kind, 'cli-invocation');
		assert.equal(cleanupSecureInvocationV1(request.token, {
			root,
			fileIdentity: { ...request.fileIdentity, ctimeMs: request.fileIdentity.ctimeMs + 1 },
		}), false);
		assert.equal(cleanupSecureInvocationV1(request.token, {
			root,
			fileIdentity: { ...request.fileIdentity, size: request.fileIdentity.size + 1 },
		}), false);
		assert.equal(cleanupSecureInvocationV1(request.token, {
			root,
			fileIdentity: request.fileIdentity,
		}), true);
		assert.equal(cleanupSecureInvocationV1(request.token, { root }), false);

		const replaced = writeSecureInvocationV1(healthInvocation(), { root });
		unlinkSync(replaced.path);
		writeFileSync(replaced.path, '{"replacement":true}', { mode: 0o600 });
		assert.equal(cleanupSecureInvocationV1(replaced.token, {
			root,
			fileIdentity: replaced.fileIdentity,
		}), false);
		assert.equal(JSON.parse(readFileSync(replaced.path, 'utf8')).replacement, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	assert.match(fixedRequestRootV1(), /operon-agent-runtime-uid-(?:\d+|unavailable)$/u);

	const linkRoot = mkdtempSync(path.join(tmpdir(), 'operon-cli-input-link-'));
	try {
		const target = path.join(linkRoot, 'target.json');
		const link = path.join(linkRoot, 'request.json');
		writeFileSync(target, '{}', { mode: 0o600 });
		symlinkSync(target, link);
		assert.throws(() => readInputFileSafelyV1(link), /INPUT_FILE_NOT_REGULAR/u);
	} finally {
		rmSync(linkRoot, { recursive: true, force: true });
	}

	const rootParent = mkdtempSync(path.join(tmpdir(), 'operon-cli-root-link-'));
	try {
		const target = path.join(rootParent, 'target');
		const link = path.join(rootParent, 'root');
		mkdirSync(target, { mode: 0o700 });
		symlinkSync(target, link);
		assert.throws(() => ensureSecureRequestRootV1(link), /REQUEST_ROOT_NOT_SECURE/u);
	} finally {
		rmSync(rootParent, { recursive: true, force: true });
	}
}

async function testInvocationConstruction(): Promise<void> {
	const vault = mkdtempSync(path.join(tmpdir(), 'operon-cli-vault-'));
	try {
		await assert.rejects(
			() => buildInvocationV1(parseCliArgsV1([
				'health',
				'--vault',
				path.join(vault, 'missing'),
			])),
			/VAULT_PATH_UNAVAILABLE/u,
		);
		const catalogOptions = parseCliArgsV1([
			'catalog',
			'--vault',
			vault,
			'--consistency',
			'best-effort',
			'--request-id',
			'cli-catalog-001',
		]);
		const catalogBuilt = await buildInvocationV1(catalogOptions);
		assert.equal(catalogBuilt.invocation.request?.kind, 'catalog');
		assert.equal(catalogBuilt.invocation.request?.consistency, 'best-effort');
		assert.equal(decodeCliInvocationV1(catalogBuilt.invocation).ok, true);

		const options = parseCliArgsV1([
			'task',
			'get',
			'--vault',
			vault,
			'--id',
			'abc1234',
			'--request-id',
			'cli-task-001',
		]);
		const built = await buildInvocationV1(options);
		assert.equal(built.invocation.command, 'task.get');
		assert.equal(built.invocation.request?.kind, 'task-get');
		assert.equal(built.invocation.requestId, 'cli-task-001');
		assert.equal(decodeCliInvocationV1(built.invocation).ok, true);

		const offlineRequest = Buffer.from(JSON.stringify({
			contractVersion: 1,
			requestId: 'offline-query',
			kind: 'task-query',
			consistency: 'offline-unverified',
		}));
		const queryOptions = parseCliArgsV1(['query', '--vault', vault, '--input', '-']);
		await assert.rejects(
			() => buildInvocationV1(queryOptions, offlineRequest),
			/OFFLINE_MODE_UNSUPPORTED/u,
		);
		await assert.rejects(
			() => buildInvocationV1(
				queryOptions,
				Buffer.alloc(786_433, 0x61),
			),
			/INPUT_TOO_LARGE/u,
		);
		const unicodeInput = Buffer.from(JSON.stringify({
			contractVersion: 1,
			requestId: 'unicode-entity',
			kind: 'entity-resolve',
			consistency: 'live-verified',
			selector: { kind: 'exact-name', noteName: 'İş görüşmesi é' },
		}));
		const entityOptions = parseCliArgsV1(['entity', 'resolve', '--vault', vault, '--input', '-']);
		const unicodeBuilt = await buildInvocationV1(entityOptions, unicodeInput);
		assert.equal(unicodeBuilt.invocation.request?.kind, 'entity-resolve');
		assert.equal(decodeCliInvocationV1(unicodeBuilt.invocation).ok, true);

		const mutationOptions = parseCliArgsV1([
			'mutation',
			'preview',
			'--vault',
			vault,
			'--input',
			'-',
		]);
		await assert.rejects(
			() => buildInvocationV1(mutationOptions, Buffer.from(JSON.stringify({
				contractVersion: 1,
				requestId: 'missing-idempotency',
				kind: 'mutation-preview',
			}))),
			/IDEMPOTENCY_KEY_REQUIRED/u,
		);

		const clientStatePath = path.join(vault, 'client-state', 'identity.json');
		const firstClientId = getOrCreateOperonCliClientIdV1(clientStatePath);
		assert.equal(getOrCreateOperonCliClientIdV1(clientStatePath), firstClientId);
		if (process.platform !== 'win32') {
			assert.equal(lstatSync(path.dirname(clientStatePath)).mode & 0o777, 0o700);
			assert.equal(lstatSync(clientStatePath).mode & 0o777, 0o600);
			chmodSync(clientStatePath, 0o644);
			assert.throws(
				() => getOrCreateOperonCliClientIdV1(clientStatePath),
				/owner-only validation/u,
			);
		}
	} finally {
		rmSync(vault, { recursive: true, force: true });
	}
}

async function testOneShotExecutionAndCleanup(): Promise<void> {
	const vault = mkdtempSync(path.join(tmpdir(), 'operon-cli-execution-vault-'));
	const requestRoot = path.join(tmpdir(), `operon-cli-execution-request-${Date.now()}`);
	let calls = 0;
	let seenCwd = '';
	let seenArgs: string[] = [];
	const runner: ProcessRunnerV1 = async (_executable, args, processOptions) => {
		calls += 1;
		seenCwd = processOptions.cwd;
		seenArgs = args;
		const token = args.find(value => value.startsWith('requestToken='))?.slice('requestToken='.length);
		assert.ok(token);
		const requestPath = requestPathForTokenV1(token, requestRoot);
		const invocation = JSON.parse(readFileSync(requestPath, 'utf8')) as CliInvocationV1;
		const result = capabilitiesSuccessEnvelope(invocation, lstatSync(requestPath).size);
		return {
			exitCode: 0,
			signal: null,
			stdout: Buffer.from(JSON.stringify(result)),
			stderr: Buffer.alloc(0),
			totalMs: 2,
			timedOut: false,
			overflow: false,
		};
	};
	try {
		const options = parseCliArgsV1(['capabilities', '--vault', vault, '--json']);
		if (process.platform === 'win32') options.obsidianBin = process.execPath;
		if (process.platform !== 'win32') {
			const outcome = await executeCliV1(options, {
				runProcess: runner,
				requestRoot,
				platform: 'darwin',
			});
			assert.equal(outcome.exitCode, 0);
			assert.equal(outcome.envelope.ok, true);
			assert.equal(calls, 1);
			assert.equal(seenCwd, realpathSync(vault));
			assert.deepEqual(seenArgs.slice(0, 2), [
				`vault=${path.basename(realpathSync(vault))}`,
				'operon:capabilities',
			]);
			assert.match(seenArgs[2], /^requestToken=[A-Za-z0-9_-]{32}$/u);
			const token = seenArgs[2].slice('requestToken='.length);
			assert.equal(lstatMissing(requestPathForTokenV1(token, requestRoot)), true);
		}
		let stagedInvocation: CliInvocationV1 | null = null;
		let brokerClosed = false;
		const brokerToken = 'w'.repeat(32);
		const windowsBroker = {
			async stage(candidate: CliInvocationV1) {
				stagedInvocation = candidate;
				return { requestToken: brokerToken, stagingReceipt: 'a'.repeat(64) };
			},
			async status() {
				return { state: 'consumed' as const };
			},
			async cancel() {
				return { cancelled: false, state: 'consumed' as const };
			},
			close() {
				brokerClosed = true;
			},
		};
		const windowsOutcome = await executeCliV1(options, {
			platform: 'win32',
			windowsBrokerClient: windowsBroker,
			requestRoot: path.join(requestRoot, 'must-not-exist'),
			runProcess: async (_executable, args) => {
				assert.equal(args.at(-1), `requestToken=${brokerToken}`);
				assert.ok(stagedInvocation);
				return {
					exitCode: 0,
					signal: null,
					stdout: Buffer.from(JSON.stringify(capabilitiesSuccessEnvelope(
						stagedInvocation,
						Buffer.byteLength(JSON.stringify(stagedInvocation), 'utf8'),
					))),
					stderr: Buffer.alloc(0),
					totalMs: 2,
					timedOut: false,
					overflow: false,
				};
			},
		});
		assert.equal(windowsOutcome.exitCode, 0);
		assert.equal(brokerClosed, true);
		assert.equal(lstatMissing(path.join(requestRoot, 'must-not-exist')), true);
		const missingWindowsDescriptor = await executeCliV1(options, {
			platform: 'win32',
			windowsBrokerClient: {
				async stage() {
					throw new PersistentReadTransportErrorV1(
						'PERSISTENT_DESCRIPTOR_MISSING',
						false,
					);
				},
				async status() {
					return { state: 'unknown' as const };
				},
				async cancel() {
					return { cancelled: false, state: 'unknown' as const };
				},
				close() {},
			},
		});
		assert.equal(missingWindowsDescriptor.exitCode, 3);
		assert.equal(missingWindowsDescriptor.envelope.ok, false);
		if (!missingWindowsDescriptor.envelope.ok) {
			assert.equal(missingWindowsDescriptor.envelope.failure.stage, 'transport');
			assert.equal(
				missingWindowsDescriptor.envelope.failure.error.code,
				'transport-unavailable',
			);
			assert.equal(missingWindowsDescriptor.envelope.failure.error.retryable, true);
			assert.equal(
				missingWindowsDescriptor.envelope.failure.error.details?.reasonCode,
				'persistent-descriptor-missing',
			);
		}
		const insecureWindowsDescriptor = await executeCliV1(options, {
			platform: 'win32',
			windowsBrokerClient: {
				async stage() {
					throw new PersistentReadTransportErrorV1(
						'PERSISTENT_DESCRIPTOR_INSECURE',
						false,
					);
				},
				async status() {
					return { state: 'unknown' as const };
				},
				async cancel() {
					return { cancelled: false, state: 'unknown' as const };
				},
				close() {},
			},
		});
		assert.equal(insecureWindowsDescriptor.exitCode, 3);
		assert.equal(insecureWindowsDescriptor.envelope.ok, false);
		if (!insecureWindowsDescriptor.envelope.ok) {
			assert.equal(
				insecureWindowsDescriptor.envelope.failure.error.code,
				'desktop-unavailable',
			);
			assert.equal(insecureWindowsDescriptor.envelope.failure.error.retryable, false);
			assert.equal(insecureWindowsDescriptor.envelope.failure.error.action, 'fix-environment');
		}
		if (process.platform !== 'win32') {
			const mismatchedRequest = await executeCliV1(options, {
				requestRoot,
				platform: 'darwin',
				runProcess: async (...args) => {
					const result = await runner(...args);
					const envelope = JSON.parse(result.stdout.toString('utf8')) as CliResultEnvelopeV1;
					return {
						...result,
						stdout: Buffer.from(JSON.stringify({ ...envelope, requestId: 'other-request' })),
					};
				},
			});
			assert.equal(mismatchedRequest.exitCode, 70);
			assert.equal(mismatchedRequest.envelope.ok, false);

			const healthOptions = parseCliArgsV1(['health', '--vault', vault, '--json']);
			const mismatchedCommand = await executeCliV1(healthOptions, {
				requestRoot,
				platform: 'darwin',
				runProcess: async (_executable, args) => {
					const token = args.find(value => value.startsWith('requestToken='))
						?.slice('requestToken='.length);
					assert.ok(token);
					const requestPath = requestPathForTokenV1(token, requestRoot);
					const invocation = JSON.parse(readFileSync(requestPath, 'utf8')) as CliInvocationV1;
					return {
						exitCode: 0,
						signal: null,
						stdout: Buffer.from(JSON.stringify({
							...capabilitiesSuccessEnvelope(invocation, lstatSync(requestPath).size),
							command: 'capabilities',
						})),
						stderr: Buffer.alloc(0),
						totalMs: 2,
						timedOut: false,
						overflow: false,
					};
				},
			});
			assert.equal(mismatchedCommand.exitCode, 70);
			assert.equal(mismatchedCommand.envelope.ok, false);
			const unavailable = await executeCliV1(options, {
				requestRoot,
				platform: 'darwin',
				runProcess: async () => ({
					exitCode: 0,
					signal: null,
					stdout: Buffer.from('Error: command not found'),
					stderr: Buffer.alloc(0),
					totalMs: 2,
					timedOut: false,
					overflow: false,
				}),
			});
			assert.equal(unavailable.exitCode, 3);
			assert.equal(unavailable.envelope.ok, false);
			assert.equal(
				unavailable.envelope.ok ? undefined : unavailable.envelope.failure.error.code,
				'transport-unavailable',
			);
			if (!unavailable.envelope.ok) {
				assert.equal(
					unavailable.envelope.failure.error.details?.reasonCode,
					'obsidian-cli-handler-unavailable',
				);
				assert.equal(
					unavailable.envelope.failure.error.details?.diagnosticSummary,
					'The requested Obsidian CLI command is unavailable; its plugin may be disabled.',
				);
			}
			const sensitiveToken = 'A'.repeat(32);
			const hostUnavailable = await executeCliV1(options, {
				requestRoot,
				platform: 'darwin',
				runProcess: async () => ({
					exitCode: 1,
					signal: null,
					stdout: Buffer.alloc(0),
					stderr: Buffer.from(
						`The CLI is unable to find Obsidian.\u001b[31m requestToken=${sensitiveToken}\r\n`,
					),
					totalMs: 2,
					timedOut: false,
					overflow: false,
				}),
			});
			assert.equal(hostUnavailable.envelope.ok, false);
			if (!hostUnavailable.envelope.ok) {
				assert.equal(
					hostUnavailable.envelope.failure.error.details?.reasonCode,
					'obsidian-cli-host-unreachable',
				);
				assert.equal(hostUnavailable.envelope.failure.error.details?.processExitCode, 1);
				const diagnosticSummary = hostUnavailable.envelope.failure.error.details?.diagnosticSummary;
				assert.equal(diagnosticSummary, 'The CLI is unable to find Obsidian.');
			}
			const genericFailure = await executeCliV1(options, {
				requestRoot,
				platform: 'darwin',
				runProcess: async () => ({
					exitCode: 9,
					signal: null,
					stdout: Buffer.alloc(0),
					stderr: Buffer.from(
						`Unexpected failure in /Users/example/Private Vault requestToken=${sensitiveToken}`,
					),
					totalMs: 2,
					timedOut: false,
					overflow: false,
				}),
			});
			assert.equal(genericFailure.envelope.ok, false);
			if (!genericFailure.envelope.ok) {
				assert.equal(
					genericFailure.envelope.failure.error.details?.reasonCode,
					'obsidian-cli-exit-failed',
				);
				assert.equal(genericFailure.envelope.failure.error.details?.processExitCode, 9);
				assert.equal(genericFailure.envelope.failure.error.details?.diagnosticSummary, undefined);
				assert.doesNotMatch(
					renderHumanV1(genericFailure.envelope),
					/Private Vault|Diagnostic:/u,
				);
			}
			for (const [spawnErrorCode, reasonCode] of [
				['ENOENT', 'obsidian-cli-bin-not-found'],
				['EACCES', 'obsidian-cli-execution-denied'],
			] as const) {
				const spawnFailure = await executeCliV1(options, {
					requestRoot,
					platform: 'darwin',
					runProcess: async () => ({
						exitCode: null,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
						totalMs: 1,
						timedOut: false,
						overflow: false,
						spawnErrorCode,
					}),
				});
				assert.equal(spawnFailure.envelope.ok, false);
				if (!spawnFailure.envelope.ok) {
					assert.equal(spawnFailure.envelope.failure.error.details?.reasonCode, reasonCode);
				}
			}
			const timedOut = await executeCliV1(options, {
				requestRoot,
				platform: 'darwin',
				runProcess: async () => ({
					exitCode: null,
					signal: 'SIGKILL',
					stdout: Buffer.alloc(0),
					stderr: Buffer.alloc(0),
					totalMs: 20_000,
					timedOut: true,
					overflow: false,
				}),
			});
			assert.equal(timedOut.exitCode, 3);
			assert.equal(timedOut.envelope.ok, false);
			assert.equal(timedOut.envelope.ok ? undefined : timedOut.envelope.failure.error.code, 'live-settling');
		}
		const contractCases = JSON.parse(readFileSync(
			path.join(process.cwd(), 'scripts/agent-runtime/contracts/fixtures/cases.json'),
			'utf8',
		)) as { cases: Array<{ id: string; value: unknown }> };
		const applyRequest = contractCases.cases.find(
			item => item.id === 'valid-destructive-delete-apply',
		)?.value;
		assert.ok(applyRequest);
		const boundApplyRequest = structuredClone(applyRequest) as MutationApplyRequestV1;
		const applyClientIdentityPath = path.join(vault, 'client-state', 'client-v1.json');
		boundApplyRequest.plan.clientInstanceId = getOrCreateOperonCliClientIdV1(
			applyClientIdentityPath,
			path.join(vault, 'legacy-client-state', 'client-v1.json'),
		);
		boundApplyRequest.plan.planHash = computeSealedMutationPlanHashV1(boundApplyRequest.plan);
		for (const acknowledgement of boundApplyRequest.acknowledgements) {
			acknowledgement.planHash = boundApplyRequest.plan.planHash;
		}
		const applyOptions = parseCliArgsV1([
			'mutation', 'apply', '--vault', vault, '--input', '-', '--json',
		]);
		if (process.platform === 'win32') applyOptions.obsidianBin = process.execPath;
		applyOptions.requestId = boundApplyRequest.requestId;
		if (process.platform !== 'win32') {
			const uncertainApply = await executeCliV1(
				applyOptions,
				{
					requestRoot,
					platform: 'darwin',
					clientIdentityPath: applyClientIdentityPath,
					input: Buffer.from(JSON.stringify(boundApplyRequest)),
					runProcess: async (_executable, args) => {
						const token = args.find(value => value.startsWith('requestToken='))
							?.slice('requestToken='.length);
						assert.ok(token);
						unlinkSync(requestPathForTokenV1(token, requestRoot));
						return {
							exitCode: null,
							signal: 'SIGKILL',
							stdout: Buffer.alloc(0),
							stderr: Buffer.alloc(0),
							totalMs: 20_000,
							timedOut: true,
							overflow: false,
						};
					},
				},
			);
			assert.equal(uncertainApply.envelope.ok, false);
			if (!uncertainApply.envelope.ok) {
				assert.equal(uncertainApply.envelope.failure.error.retryable, false);
				assert.match(uncertainApply.envelope.failure.error.reason, /recover the same stored plan/u);
			}
		}
		let cancelledBeforeDispatch = false;
		const stagedOnlyApply = await executeCliV1(applyOptions, {
			platform: 'win32',
			clientIdentityPath: applyClientIdentityPath,
			input: Buffer.from(JSON.stringify(boundApplyRequest)),
			windowsBrokerClient: {
				async stage() {
					return { requestToken: brokerToken, stagingReceipt: 'b'.repeat(64) };
				},
				async status() {
					return { state: 'staged' as const };
				},
				async cancel() {
					cancelledBeforeDispatch = true;
					return { cancelled: true, state: 'staged' as const };
				},
				close() {},
			},
			runProcess: async () => ({
				exitCode: null,
				signal: 'SIGBREAK',
				stdout: Buffer.alloc(0),
				stderr: Buffer.alloc(0),
				totalMs: 10,
				timedOut: true,
				overflow: false,
			}),
		});
		assert.equal(cancelledBeforeDispatch, true);
		assert.equal(stagedOnlyApply.exitCode, 3);
		assert.equal(
			stagedOnlyApply.envelope.ok
				? undefined
				: stagedOnlyApply.envelope.failure.error.code,
			'live-settling',
		);
		const abortController = new AbortController();
		let cancelledAbortedStage = false;
		const abortedBeforeDispatch = await executeCliV1(applyOptions, {
			platform: 'win32',
			clientIdentityPath: applyClientIdentityPath,
			input: Buffer.from(JSON.stringify(boundApplyRequest)),
			signal: abortController.signal,
			windowsBrokerClient: {
				async stage() {
					return { requestToken: brokerToken, stagingReceipt: 'c'.repeat(64) };
				},
				async status() {
					return { state: 'staged' as const };
				},
				async cancel() {
					cancelledAbortedStage = true;
					return { cancelled: true, state: 'staged' as const };
				},
				close() {},
			},
			runProcess: async () => {
				abortController.abort();
				return {
					exitCode: null,
					signal: 'SIGBREAK',
					stdout: Buffer.alloc(0),
					stderr: Buffer.alloc(0),
					totalMs: 10,
					timedOut: false,
					overflow: false,
					spawnErrorCode: 'ABORTED',
				};
			},
		});
		assert.equal(cancelledAbortedStage, true);
		assert.equal(abortedBeforeDispatch.exitCode, 130);
		assert.equal(abortedBeforeDispatch._applyDispatchEvidence, 'not-started');
		if (process.platform !== 'win32') {
			const mismatchedApplyResponse = await executeCliV1(
				applyOptions,
				{
					requestRoot,
					platform: 'darwin',
					clientIdentityPath: applyClientIdentityPath,
					input: Buffer.from(JSON.stringify(boundApplyRequest)),
					runProcess: async (_executable, args) => {
						const token = args.find(value => value.startsWith('requestToken='))
							?.slice('requestToken='.length);
						assert.ok(token);
						const requestPath = requestPathForTokenV1(token, requestRoot);
						const invocation = JSON.parse(readFileSync(requestPath, 'utf8')) as CliInvocationV1;
						unlinkSync(requestPath);
						return {
							exitCode: 0,
							signal: null,
							stdout: Buffer.from(JSON.stringify({
								...failureEnvelope(invocation, 2),
								requestId: 'mismatched-apply-response',
							})),
							stderr: Buffer.alloc(0),
							totalMs: 2,
							timedOut: false,
							overflow: false,
						};
					},
				},
			);
			assert.equal(mismatchedApplyResponse.exitCode, 5);
			assert.equal(mismatchedApplyResponse.envelope.ok, false);
			if (!mismatchedApplyResponse.envelope.ok) {
				assert.equal(mismatchedApplyResponse.envelope.failure.error.code, 'outcome-unknown');
				assert.equal(mismatchedApplyResponse.envelope.failure.error.retryable, false);
				assert.equal(mismatchedApplyResponse.envelope.failure.error.action, 'recover-same-plan');
			}
			const overflow = await executeCliV1(options, {
				requestRoot,
				platform: 'darwin',
				runProcess: async () => ({
					exitCode: null,
					signal: 'SIGKILL',
					stdout: Buffer.alloc(0),
					stderr: Buffer.alloc(0),
					totalMs: 2,
					timedOut: false,
					overflow: true,
				}),
			});
			assert.equal(overflow.exitCode, 70);
			assert.equal(overflow.envelope.ok, false);
			assert.equal(overflow.envelope.ok ? undefined : overflow.envelope.failure.error.code, 'result-too-large');

			const insecureRoot = path.join(tmpdir(), `operon-cli-insecure-root-${Date.now()}`);
			mkdirSync(insecureRoot, { mode: 0o755 });
			chmodSync(insecureRoot, 0o755);
			const insecureTransport = await executeCliV1(options, {
				requestRoot: insecureRoot,
				platform: 'darwin',
				runProcess: runner,
			});
			assert.equal(insecureTransport.exitCode, 3);
			assert.equal(insecureTransport.envelope.ok, false);
			assert.equal(
				insecureTransport.envelope.ok ? undefined : insecureTransport.envelope.failure.stage,
				'transport',
			);
			rmSync(insecureRoot, { recursive: true, force: true });
		}
	} finally {
		rmSync(vault, { recursive: true, force: true });
		rmSync(requestRoot, { recursive: true, force: true });
	}
}

async function testOneShotPersistentReadRouting(): Promise<void> {
	assert.equal(isPersistentReadCommandV1('health'), true);
	assert.equal(isPersistentReadCommandV1('task.get'), true);
	assert.equal(isPersistentReadCommandV1('tasks.query'), true);
	assert.equal(isPersistentReadCommandV1('context.build'), true);
	assert.equal(isPersistentReadCommandV1('capabilities'), false);
	assert.equal(isPersistentReadCommandV1('mutation.apply'), false);

	const vault = mkdtempSync(path.join(tmpdir(), 'operon-cli-persistent-routing-vault-'));
	const requestRoot = path.join(tmpdir(), `operon-cli-persistent-routing-${Date.now()}`);
	const configRoot = path.join(tmpdir(), `operon-cli-persistent-config-${Date.now()}`);
	let factoryCalls = 0;
	let persistentCalls = 0;
	let processCalls = 0;
	let closeCalls = 0;
	try {
		mkdirSync(configRoot, { recursive: true, mode: 0o700 });
		chmodSync(configRoot, 0o700);
		const pluginRoot = path.join(vault, '.obsidian', 'plugins', 'operon');
		mkdirSync(pluginRoot, { recursive: true });
		writeFileSync(
			path.join(pluginRoot, 'manifest.json'),
			JSON.stringify({ id: 'operon', version: '3.0.0', minAppVersion: '1.8.9' }),
		);
		const transport = {
			async invoke(invocation: {
				requestToken: string;
			}) {
				persistentCalls += 1;
				const requestPath = requestPathForTokenV1(invocation.requestToken, requestRoot);
				const request = JSON.parse(readFileSync(requestPath, 'utf8')) as CliInvocationV1;
				return {
					result: Buffer.from(JSON.stringify(failureEnvelope(request, 1))),
					totalMs: 1,
				};
			},
			noteFallback() {
				throw new Error('successful persistent read must not fall back');
			},
			close() {
				closeCalls += 1;
			},
		} as unknown as PersistentReadTransportV1;
		const health = await runPublicCommandLineV1([
			'health',
			'--vault',
			vault,
			'--json',
		], {
			configRoot,
			requestRoot,
			_createPersistentReadTransport: () => {
				factoryCalls += 1;
				return transport;
			},
			runProcess: async () => {
				processCalls += 1;
				throw new Error('eligible read must try the persistent transport first');
			},
		});
		assert.equal(health.exitCode, 3, health.human);
		assert.equal(factoryCalls, 1);
		assert.equal(persistentCalls, 1);
		assert.equal(processCalls, 0);
		assert.equal(closeCalls, 1);

		const capabilities = await runPublicCommandLineV1([
			'capabilities',
			'--vault',
			vault,
			'--json',
		], {
			configRoot,
			requestRoot,
			_createPersistentReadTransport: () => {
				factoryCalls += 1;
				return transport;
			},
			runProcess: async (_executable, args) => {
				processCalls += 1;
				const token = args.find(value => value.startsWith('requestToken='))
					?.slice('requestToken='.length);
				assert.ok(token);
				const requestPath = requestPathForTokenV1(token, requestRoot);
				const request = JSON.parse(readFileSync(requestPath, 'utf8')) as CliInvocationV1;
				return {
					exitCode: 0,
					signal: null,
					stdout: Buffer.from(JSON.stringify(capabilitiesSuccessEnvelope(
						request,
						lstatSync(requestPath).size,
					))),
					stderr: Buffer.alloc(0),
					totalMs: 1,
					timedOut: false,
					overflow: false,
				};
			},
		});
		assert.equal(capabilities.exitCode, 0, capabilities.human);
		assert.equal(factoryCalls, 1);
		assert.equal(persistentCalls, 1);
		assert.equal(processCalls, 1);
		assert.equal(closeCalls, 1);

		const doctor = await runPublicCommandLineV1([
			'doctor',
			'--vault',
			vault,
			'--live',
			'--repair-security',
		], {
			configRoot,
			requestRoot,
			runProcess: async () => ({
				exitCode: 1,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.from(
					'The CLI is unable to find Obsidian. Please make sure Obsidian is running.',
				),
				totalMs: 1,
				timedOut: false,
				overflow: false,
			}),
		});
		assert.equal(doctor.exitCode, 3, `${doctor.human}\n${JSON.stringify(doctor.envelope)}`);
		assert.equal(doctor.json, false);
		assert.match(doctor.human, /Diagnostic: The CLI is unable to find Obsidian/u);
		assert.match(doctor.human, /sandboxed or isolated/u);
	} finally {
		rmSync(vault, { recursive: true, force: true });
		rmSync(requestRoot, { recursive: true, force: true });
		rmSync(configRoot, { recursive: true, force: true });
	}
}

async function testAbortTransportGuards(): Promise<void> {
	const vault = mkdtempSync(path.join(tmpdir(), 'operon-cli-abort-vault-'));
	const requestRoot = path.join(tmpdir(), `operon-cli-abort-request-${Date.now()}`);
	try {
		const options = parseCliArgsV1(['health', '--vault', realpathSync(vault), '--json']);
		const preAborted = new AbortController();
		preAborted.abort();
		let spawnCalls = 0;
		const preAbortedOutcome = await executeCliV1(options, {
			requestRoot,
			platform: 'darwin',
			signal: preAborted.signal,
			runProcess: async () => {
				spawnCalls += 1;
				throw new Error('pre-aborted execution must not spawn');
			},
		});
		assert.equal(spawnCalls, 0);
		assert.equal(preAbortedOutcome.envelope.ok, false);
		if (!preAbortedOutcome.envelope.ok) {
			assert.equal(
				preAbortedOutcome.envelope.failure.stage,
				'transport',
				'pre-aborted execution classification',
			);
			assert.equal(preAbortedOutcome.envelope.failure.error.retryable, false);
		}
		assert.equal(lstatMissing(requestRoot), true);

		const sentAbort = new AbortController();
		let fallbackCalls = 0;
		let invokeCalls = 0;
		const transport = {
			async invoke() {
				invokeCalls += 1;
				sentAbort.abort();
				throw new PersistentReadTransportErrorV1('PERSISTENT_ABORTED', true);
			},
			noteFallback() {
				fallbackCalls += 1;
			},
		} as unknown as PersistentReadTransportV1;
		const postSendOutcome = await executeCliV1(options, {
			requestRoot,
			platform: 'darwin',
			signal: sentAbort.signal,
			resolvedVaultFence: createCanonicalVaultFenceV1(vault),
			persistentReadTransport: transport,
			runProcess: async () => {
				spawnCalls += 1;
				throw new Error('aborted persistent execution must not fall back');
			},
		});
		assert.equal(fallbackCalls, 0);
		assert.equal(spawnCalls, 0);
		assert.equal(invokeCalls, 1);
		assert.equal(postSendOutcome.envelope.ok, false);
		if (!postSendOutcome.envelope.ok) {
			assert.equal(
				postSendOutcome.envelope.failure.stage,
				'transport',
				'post-send aborted persistent classification',
			);
			assert.equal(postSendOutcome.envelope.failure.error.retryable, false);
		}
		assert.deepEqual(readdirSync(requestRoot), []);

		const processAbort = new AbortController();
		processAbort.abort();
		const processResult = await runObsidianProcessV1(
			'/definitely/not/an/executable',
			[],
			{ cwd: vault, timeoutMs: 1_000, signal: processAbort.signal },
		);
		assert.equal(processResult.spawnErrorCode, 'ABORTED');
		assert.equal(processResult.totalMs, 0);
	} finally {
		rmSync(vault, { recursive: true, force: true });
		rmSync(requestRoot, { recursive: true, force: true });
	}
}

function testRenderingAndExitCodes(): void {
	const invocation = healthInvocation();
	const failure = failureEnvelope(invocation, 0);
	assert.equal(exitCodeForEnvelopeV1(failure), 3);
	assert.match(renderHumanV1(failure), /readiness/u);
	const capabilities: CliResultEnvelopeV1 = {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: 'capabilities',
		ok: true,
		transport: { channel: 'request-file', inputBytes: 128 },
		vaultIdentity: { expectedMatch: true },
		compatibility: {
			contractVersion: 1,
			compatible: true,
			runtimeApi: 1,
		},
		cliContract: 1,
		runtime: {
			appVersion: '1.13.3',
			plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
			apiVersion: 1,
		},
		timing: { handlerMs: 1, totalMs: 2 },
		warnings: [],
		result: [
			{ id: 'system.health', availability: 'available', stability: 'stable' },
			{
				id: 'catalog.read',
				availability: 'contract-only',
				stability: 'stable',
				reason: 'Not published.',
			},
		],
	};
	assert.equal(exitCodeForEnvelopeV1(capabilities), 0);
	assert.equal(renderHumanV1(capabilities), [
		'Operon capabilities: 1/2 available, 0 degraded, 1 contract-only, 0 unavailable',
		'ID | Availability | Reason',
		'system.health | available | -',
		'catalog.read | contract-only | Not published.',
	].join('\n'));
	const warnedCapabilities: CliResultEnvelopeV1 = {
		...capabilities,
		warnings: [{
			code: 'best-effort-consistency',
			message: 'Best-effort result.',
		}],
	};
	assert.match(renderHumanV1(warnedCapabilities), /Warnings:\n- best-effort-consistency: Best-effort result\./u);
	const uncertainApply: CliResultEnvelopeV1 = {
		...capabilities,
		command: 'mutation.apply',
		result: {
			contractVersion: 1,
			requestId: invocation.requestId,
			kind: 'mutation-result',
			status: 'outcome-unknown',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: [{
				groupId: 'task-source:Tasks.md',
				status: 'outcome-unknown',
				error: {
					contractVersion: 1,
					code: 'outcome-unknown',
					reason: 'The final source state could not be verified.',
					retryable: false,
					action: 'recover-same-plan',
				},
			}],
			ambiguitySource: 'group-outcome',
			error: {
				contractVersion: 1,
				code: 'outcome-unknown',
				reason: 'The final source state could not be verified.',
				retryable: false,
				action: 'recover-same-plan',
			},
		} satisfies MutationResultV1,
	};
	assert.equal(exitCodeForEnvelopeV1(uncertainApply), 5);
	assert.match(renderHumanV1(uncertainApply), /May have applied: yes/u);
	assert.match(renderHumanV1(uncertainApply), /The final source state could not be verified\./u);
	assert.match(renderHumanV1(uncertainApply), /Do not retry or create a replacement mutation\. Recover the same plan reference\./u);
	const verifiedApply = successEnvelope('mutation.apply', {
		ok: true,
		status: 'applied',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
		postflight: {
			status: 'verified',
			observedAt: '2026-07-25T10:00:00Z',
		},
	});
	assert.doesNotMatch(
		renderHumanV1(verifiedApply),
		/Recover the same plan reference/u,
	);
	const interruptedApply = {
		...failureEnvelope(invocation, 15),
		command: 'mutation.apply',
		client: { planRef: 'recovery-plan-ref' },
	} as CliResultEnvelopeV1;
	assert.match(
		renderHumanV1(interruptedApply),
		/operon plan recover recovery-plan-ref/u,
	);
	const receiptPersistFailure = {
		...uncertainApply,
		result: {
			...uncertainApply.result as Record<string, unknown>,
			groupResults: [],
			ambiguitySource: 'receipt-persist-failure',
		},
	} as unknown as CliResultEnvelopeV1;
	assert.match(renderHumanV1(receiptPersistFailure), /Status: outcome-unknown/u);
	assert.doesNotMatch(renderHumanV1(receiptPersistFailure), /Group \| Status/u);
	assert.equal(
		sanitizeTerminalTextV1('Task\u001b]8;;https://evil.example\u0007spoof\r\nnext\t\u061c\u200e\u200f\u202e'),
		'Task]8;;https://evil.examplespoof next',
	);
	const diagnosticToken = 'Z'.repeat(32);
	const sanitizedDiagnostic = sanitizeProcessDiagnosticV1(
		`requestToken=${diagnosticToken}\n${'🧭'.repeat(300)}`,
	);
	assert.doesNotMatch(sanitizedDiagnostic, new RegExp(diagnosticToken, 'u'));
	assert.match(sanitizedDiagnostic, /^requestToken=\[redacted\] /u);
	assert.ok([...sanitizedDiagnostic].length <= 240);
	assert.ok(sanitizedDiagnostic.endsWith('…'));
	const trailingHyphenToken = `${'A'.repeat(31)}-`;
	const leadingHyphenToken = `-${'B'.repeat(31)}`;
	assert.equal(
		sanitizeProcessDiagnosticV1(`requestToken=${trailingHyphenToken}`),
		'requestToken=[redacted]',
	);
	assert.equal(
		sanitizeProcessDiagnosticV1(`${leadingHyphenToken} ${trailingHyphenToken}`),
		'[redacted] [redacted]',
	);
	assert.equal(decodeCliResultEnvelopeV1(capabilities).ok, true);
	const usageFailure = createCliUsageFailureV1('task.get');
	assert.equal(exitCodeForEnvelopeV1(usageFailure), 2);
	assert.equal(decodeCliResultEnvelopeV1(usageFailure).ok, true);
}

function testHumanRendererCoverage(): void {
	const task = {
		identity: { operonId: 'abc1234', validity: 'canonical', mutationAllowed: true },
		description: `Review | ${'🧭'.repeat(120)}\nsecond line\u202e`,
		representation: 'inline',
		checkbox: 'open',
		workflow: {
			pipeline: { id: 'work', label: 'Work' },
			status: { id: 'doing', label: 'Doing' },
		},
		priority: { id: 'high', label: 'High' },
		dates: { due: '2026-07-25', scheduled: '2026-07-24' },
		datetimes: {},
		locator: { representation: 'inline', filePath: '20 Projects/CLI.md', lineNumber: 4 },
		relationships: {
			parentOperonId: 'par1234',
			childOperonIds: ['chi1234'],
			blockingOperonIds: [],
			blockedByOperonIds: ['blk1234'],
			relatedOperonIds: [],
		},
		recurrence: { repeating: false },
		tracker: { active: false, sessionCount: 2 },
		pinned: true,
		note: 'PRIVATE_NOTE_SENTINEL',
		sourceMarkdown: 'PRIVATE_SOURCE_SENTINEL',
		customFields: { Secret: 'PRIVATE_CUSTOM_SENTINEL' },
	};
	const catalog = successEnvelope('catalog', {
		ok: true,
		taxonomy: {
			pipelines: [{
				id: 'work',
				name: 'Work',
				description: 'User-defined workflow',
				statuses: [{
					id: 'doing',
					label: 'Doing',
					description: 'Currently active',
					isFinished: false,
					isCancelled: false,
				}],
			}],
			priorities: [{
				id: 'high',
				label: 'High',
				isDefault: true,
				description: 'Needs prompt attention',
				identityStatus: 'resolved',
			}],
		},
		fields: [{
			displayName: 'Customer',
			canonicalKey: 'Customer',
			valueType: 'text',
			source: 'custom',
			mutationOwner: 'general-update',
			description: 'Customer name',
		}],
		freshness: { source: 'live-runtime', coherence: 'verified', settled: true },
	});
	const catalogText = renderHumanV1(catalog);
	assert.match(catalogText, /User-defined workflow/u);
	assert.match(catalogText, /Needs prompt attention/u);
	assert.match(catalogText, /Customer name/u);
	assert.match(renderLocalHumanV1('profile.list', {
		defaultProfile: 'main',
		profiles: [{
			name: 'main',
			canonicalPath: '/Vault/Main',
			verifiedAt: '2026-07-25T12:00:00Z',
		}],
	}, 'fallback'), /main \(default\).*\/Vault\/Main/u);
	assert.match(renderLocalHumanV1('doctor', {
		platform: { name: 'darwin', liveTransport: 'supported' },
		security: { backend: 'posix-mode', secure: true, repaired: false },
		vault: { profile: 'main', canonicalPath: '/Vault/Main' },
		plugin: { id: 'operon', version: '2.6.0' },
	}, 'fallback'), /Runtime: not requested/u);
	assert.match(renderLocalHumanV1('doctor', {
		platform: { name: 'linux', liveTransport: 'acceptance-required' },
		security: { backend: 'posix-mode', secure: true, repaired: false },
		vault: { profile: 'main', canonicalPath: '/Vault/Main' },
		plugin: { id: 'operon', version: '2.6.0' },
	}, 'fallback'), /public beta \/ best-effort; this native environment is not certified/u);
	const largeCatalogText = renderHumanV1(successEnvelope('catalog', {
		ok: true,
		taxonomy: {
			pipelines: Array.from({ length: 50 }, (_value, pipelineIndex) => ({
				id: `pipeline-${pipelineIndex}`,
				name: `Pipeline ${pipelineIndex}`,
				description: 'Synthetic pipeline',
				statuses: Array.from({ length: 50 }, (_statusValue, statusIndex) => ({
					id: `status-${pipelineIndex}-${statusIndex}`,
					label: `Status ${statusIndex}`,
				})),
			})),
			priorities: [],
		},
		fields: [],
		warnings: [{ code: 'catalog-warning', message: 'Important final warning' }],
	}));
	assert.ok(largeCatalogText.split('\n').length <= 200);
	assert.match(largeCatalogText, /additional output lines omitted/u);
	assert.match(largeCatalogText, /Important final warning/u);

	const entityText = renderHumanV1(successEnvelope('entity.resolve', {
		ok: true,
		resolution: 'ambiguous',
		candidates: [{
			identity: { operonId: 'abc1234' },
			description: 'Review CLI',
			locator: task.locator,
			confidence: 0.91,
			reasons: ['text-match'],
		}],
	}));
	assert.match(entityText, /Resolution: ambiguous/u);
	assert.match(entityText, /0\.91/u);

	const taskEnvelope = successEnvelope('task.get', {
		ok: true,
		task,
		freshness: { source: 'live-runtime', coherence: 'verified', settled: true },
		warnings: [{ code: 'sample', message: 'Visible warning' }],
	});
	const taskEnvelopeBefore = JSON.stringify(taskEnvelope);
	const taskText = renderHumanV1(taskEnvelope);
	assert.equal(JSON.stringify(taskEnvelope), taskEnvelopeBefore);
	assert.match(taskText, /Workflow: Work \/ Doing/u);
	assert.match(taskText, /Task: Review ¦/u);
	assert.match(taskText, /20 Projects\/CLI\.md:5/u);
	assert.match(taskText, /Freshness: live-runtime \/ verified \/ settled/u);
	assert.match(taskText, /Additional hydrated fields are omitted/u);
	assert.doesNotMatch(taskText, /PRIVATE_(?:NOTE|SOURCE|CUSTOM)_SENTINEL/u);
	assert.doesNotMatch(taskText, /[\n\r].*second line/u);

	const tasks = Array.from({ length: 51 }, (_value, index) => ({
		...task,
		identity: { operonId: `id${String(index).padStart(5, '0')}` },
		description: `Task ${index}`,
	}));
	const queryText = renderHumanV1(successEnvelope('tasks.query', {
		ok: true,
		tasks,
		page: {
			returnedCount: 51,
			actualCount: 80,
			asOf: '2026-07-25T12:00:00Z',
			nextCursor: 'PRIVATE_CURSOR_SENTINEL',
		},
		truncations: [{ path: 'tasks', returnedCount: 51, actualCount: 80, limit: 51 }],
	}));
	assert.match(queryText, /… 1 more items omitted/u);
	assert.match(queryText, /More results are available/u);
	assert.doesNotMatch(queryText, /PRIVATE_CURSOR_SENTINEL/u);

	const relationshipsText = renderHumanV1(successEnvelope('relationships.get', {
		ok: true,
		relationships: {
			explicit: [{
				kind: 'parent',
				sourceOperonId: 'abc1234',
				targetOperonId: 'par1234',
				reason: 'parentTask',
				confidence: 1,
			}],
			derived: [],
			inferred: [],
		},
		tasks: [task],
	}));
	assert.match(relationshipsText, /Explicit \(1\)/u);
	assert.match(relationshipsText, /parentTask/u);

	for (const projection of [
		'exact-task',
		'task-neighborhood',
		'project-analysis',
		'planning-workload',
		'creation-context',
		'mutation-preview',
	]) {
		const contextText = renderHumanV1(successEnvelope('context.build', {
			ok: true,
			projection,
			purpose: 'analysis',
			entities: [task],
			relationships: { explicit: [], derived: [], inferred: [] },
			catalog: {},
			policies: {},
			asOf: '2026-07-25T12:00:00Z',
			execution: { source: 'live-runtime', coherence: 'verified', settled: true },
		}));
		assert.match(contextText, new RegExp(`Projection: ${projection}`, 'u'));
		assert.doesNotMatch(contextText, /PRIVATE_(?:NOTE|SOURCE|CUSTOM)_SENTINEL/u);
	}

	assert.match(
		renderHumanV1(successEnvelope('timers.read', { ok: true, state: {} })),
		/State: idle/u,
	);
	assert.match(
		renderHumanV1(successEnvelope('timers.read', {
			ok: true,
			state: {
				active: {
					operonId: 'abc1234',
					start: '2026-07-25T10:00:00Z',
					elapsedSeconds: 3_661,
				},
			},
		})),
		/Elapsed: 1h 1m 1s/u,
	);

	const exactPlanPath = `${'Long Folder/'.repeat(8)}2026-07-25.md`;
	const plan = {
		planId: 'PRIVATE_PLAN_ID',
		planHash: 'PRIVATE_PLAN_HASH',
		receiptTargetDigest: 'PRIVATE_RECEIPT_DIGEST',
		clientInstanceId: 'PRIVATE_CLIENT_ID',
		idempotencyKeyHash: 'PRIVATE_IDEMPOTENCY_HASH',
		mutationKind: 'task.create',
		riskLevel: 'routine',
		expiresAt: '2026-07-25T12:05:00Z',
		requiresConfirmation: false,
		requiredAcknowledgements: [],
		targets: [{
			operonId: 'new1234',
			locator: { representation: 'inline', filePath: exactPlanPath, lineNumber: 8 },
			targetDigest: 'PRIVATE_TARGET_DIGEST',
		}],
		predictedEffects: [{
			action: 'create',
			resourceKind: 'task-source',
			resourceKey: 'Daily/2026-07-25.md',
			summary: 'Create one inline task',
		}],
		atomicGroups: [{
			groupId: 'task-source:Daily/2026-07-25.md',
			resources: [{ resourceKind: 'task-source', resourceKey: 'Daily/2026-07-25.md' }],
		}],
		createEffects: [{
			itemRef: 'task-1',
			operonId: 'new1234',
			locator: { representation: 'inline', filePath: 'Daily/2026-07-25.md', lineNumber: 8 },
		}],
		spec: { secret: 'PRIVATE_RAW_SPEC' },
	};
	const previewText = renderHumanV1({
		...successEnvelope('mutation.preview', { ok: true, plan }),
		client: { planRef: 'plan-safe-ref' },
	} as CliResultEnvelopeV1);
	const showText = renderLocalHumanV1('plan.show', {
		planRef: 'plan-safe-ref',
		expiresAt: plan.expiresAt,
		plan,
	}, 'fallback');
	for (const expected of [
		'Plan reference: plan-safe-ref',
		'Mutation: task.create',
		'Created tasks (1)',
		'new1234',
		exactPlanPath,
	]) {
		assert.match(previewText, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
		assert.match(showText, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
	}
	for (const secret of [
		'PRIVATE_PLAN_ID',
		'PRIVATE_PLAN_HASH',
		'PRIVATE_RECEIPT_DIGEST',
		'PRIVATE_CLIENT_ID',
		'PRIVATE_IDEMPOTENCY_HASH',
		'PRIVATE_TARGET_DIGEST',
		'PRIVATE_RAW_SPEC',
	]) {
		assert.doesNotMatch(previewText, new RegExp(secret, 'u'));
		assert.doesNotMatch(showText, new RegExp(secret, 'u'));
	}
	assert.doesNotMatch(previewText, /Atomic groups/u);
	assert.doesNotMatch(showText, /Atomic groups/u);
	const updateText = renderHumanV1({
		...successEnvelope('mutation.preview', {
			ok: true,
			plan: {
				...plan,
				mutationKind: 'task.update',
				spec: {
					operation: 'update',
					changes: [{ field: 'note', valueType: 'text', value: 'PRIVATE_UPDATE_VALUE' }],
				},
				createEffects: undefined,
			},
		}),
		client: { planRef: 'update-plan-ref' },
	} as CliResultEnvelopeV1);
	assert.match(updateText, /Update fields: note/u);
	assert.doesNotMatch(updateText, /PRIVATE_UPDATE_VALUE/u);
	const createSummaryText = renderHumanV1({
		...successEnvelope('mutation.preview', {
			ok: true,
			plan: {
				...plan,
				spec: {
					operation: 'create',
					items: [{
						itemRef: 'task-1',
						description: 'Create summary task',
						target: { representation: 'file', mode: 'configured-default' },
						fields: [],
						dependencies: [{
							relation: 'blocked-by',
							target: { kind: 'existing', operonId: 'dependency-1' },
						}],
						bodyMarkdown: 'PRIVATE_FILE_TASK_BODY',
					}],
				},
				createEffects: [{
					...plan.createEffects[0],
					resolvedDependencies: [{ relation: 'blocked-by', operonId: 'dependency-1' }],
					bodyMarkdownSummary: { utf8Bytes: 22, sha256: 'PRIVATE_BODY_DIGEST' },
				}],
			},
		}),
		client: { planRef: 'create-summary-plan-ref' },
	} as CliResultEnvelopeV1);
	assert.match(createSummaryText, /file \| configured-default/u);
	assert.match(createSummaryText, /dependencies 1/u);
	assert.match(createSummaryText, /body 22 UTF-8 bytes/u);
	assert.match(createSummaryText, /body set \(content omitted\)/u);
	assert.doesNotMatch(createSummaryText, /PRIVATE_FILE_TASK_BODY|PRIVATE_BODY_DIGEST/u);
	const configuredDefaultText = renderHumanV1({
		...successEnvelope('mutation.preview', {
			ok: true,
			plan: {
				...plan,
				spec: {
					operation: 'create',
					items: [{
						itemRef: 'task-1',
						description: 'Configured default task',
						target: { mode: 'configured-default' },
						fields: [],
					}],
				},
			},
		}),
		client: { planRef: 'configured-default-plan-ref' },
	} as CliResultEnvelopeV1);
	assert.match(configuredDefaultText, /Configured default task \| configured-default/u);
}

async function testGuidedCreationModel(): Promise<void> {
	const context = {
		ok: true,
		projection: 'creation-context',
		catalog: {
			taxonomy: {
				defaultPipeline: { status: 'resolved', configuredValue: 'Work', id: 'pipeline-work' },
				defaultPriority: { status: 'resolved', configuredValue: 'Medium', id: 'priority-medium' },
				pipelines: [{
					id: 'pipeline-work',
					name: 'Work',
					description: 'Work tasks',
					order: 1,
					identityStatus: 'resolved',
					statuses: [{
						id: 'status-open',
						label: 'Open',
						order: 1,
						color: '#000000',
						isFinished: false,
						isCancelled: false,
						isScheduledTarget: false,
						isTrackingTarget: false,
						identityStatus: 'resolved',
					}, {
						id: 'status-ready',
						label: 'Ready',
						order: 2,
						color: '#000000',
						isFinished: false,
						isCancelled: false,
						isScheduledTarget: false,
						isTrackingTarget: false,
						identityStatus: 'resolved',
					}],
				}],
				priorities: [{
					id: 'priority-medium',
					label: 'Medium',
					description: 'Normal priority',
					order: 1,
					color: '#000000',
					isDefault: true,
					identityStatus: 'resolved',
				}],
			},
			fields: [
				fieldDescriptor('dateDue', 'Due', 'date', 'built-in'),
				fieldDescriptor('datetimeStart', 'Starts at', 'datetime', 'built-in'),
				fieldDescriptor('Customer', 'Customer', 'text', 'custom'),
				{
					...fieldDescriptor('Reserved', 'Reserved', 'text', 'custom'),
					mappingStatus: 'reserved',
				},
			],
		},
		policies: {
			creation: {
				descriptionRequired: true,
				assigneesRequired: false,
				defaultEstimateMinutes: 30,
				defaultToFileTask: false,
				fileTaskTargetFolder: 'Tasks',
				fileTaskTemplateFolder: 'Templates',
				inlineTaskSaveMode: 'specific-file',
				inlineTaskTargetFile: 'Tasks.md',
				inlineTaskHeading: 'Tasks',
				dailyNoteAddsStartDate: false,
				dailyNoteAddsScheduledDate: false,
				createDailyNotesAsFileTasks: false,
				calendarInlineTaskHeading: 'Tasks',
				builtInTemplateCandidates: [{
					id: 'builtin:pipeline-work',
					pipelineId: 'pipeline-work',
					initialStatusId: 'status-ready',
				}],
			},
		},
	} as unknown as Parameters<typeof buildGuidedCreationModelV1>[0];
	const model = buildGuidedCreationModelV1(context);
	const scripted = scriptedGuidedPort([
		'', // Inline representation.
		'', // Configured target.
		'', // Configured pipeline.
		'', // Configured status.
		'', // Configured priority.
		'?', // List the live, eligible properties.
		'dateDue',
		'26-07-2026',
		'2026-02-29',
		'2026-07-26',
		'Customer',
		'\u202ePrivate customer value',
		'Private customer value',
		'datetimeStart',
		'2026-07-26T14:30+02:00',
		'2026-07-26T14:30',
		'',
		'', // Preview.
	]);
	const result = await runGuidedCreationWizardV1({
		model,
		port: scripted.port,
		itemRef: 'guided-task',
		initialDescription: 'Guided test task',
	});
	assert.equal(result.status, 'ready');
	if (result.status !== 'ready') throw new Error('GUIDED_TEST_FAILED');
	const item = result.intent.spec.items[0];
	assert.equal(item.description, 'Guided test task');
	assert.deepEqual(item.target, { representation: 'inline', mode: 'configured-default' });
	assert.equal(item.statusId, undefined);
	assert.equal(item.priorityId, undefined);
	assert.deepEqual(item.fields, [
		{ kind: 'date', field: 'dateDue', value: '2026-07-26' },
		{
			kind: 'custom',
			field: 'Customer',
			valueType: 'text',
			value: 'Private customer value',
		},
		{ kind: 'datetime', field: 'datetimeStart', value: '2026-07-26T14:30' },
	]);
	assert.match(scripted.output(), /Due: 2026-07-26/u);
	assert.match(scripted.output(), /Workflow: Work \/ Ready/u);
	assert.match(scripted.output(), /Customer: set/u);
	assert.match(scripted.output(), /Starts at: 2026-07-26T14:30/u);
	assert.match(scripted.output(), /Use YYYY-MM-DD/u);
	assert.match(scripted.output(), /Use a local ISO datetime/u);
	assert.match(scripted.output(), /terminal control characters/u);
	assert.doesNotMatch(scripted.output(), /\[Reserved\]/u);
	assert.doesNotMatch(scripted.output(), /Private customer value/u);

	const cancelledPort = scriptedGuidedPort(['q']);
	const cancelled = await runGuidedCreationWizardV1({
		model,
		port: cancelledPort.port,
		itemRef: 'cancelled-task',
	});
	assert.equal(cancelled.status, 'cancelled');

	const exactTargetModel: typeof model = {
		...model,
		policies: {
			...model.policies,
			creation: {
				...model.policies.creation,
				inlineTaskSaveMode: 'active-file',
			},
		},
	};
	const exactTargetPort = scriptedGuidedPort([
		'', // Inline representation.
		'', // Exact target is the only available option.
		'C:/Tasks.md',
		'../outside.md',
		'Inbox/Tasks.md',
		'', // Configured pipeline.
		'', // Configured status.
		'', // Configured priority.
		'', // No additional properties.
		'', // Preview.
	]);
	const exactTarget = await runGuidedCreationWizardV1({
		model: exactTargetModel,
		port: exactTargetPort.port,
		itemRef: 'exact-target-task',
		initialDescription: 'Exact target task',
	});
	assert.equal(exactTarget.status, 'ready');
	if (exactTarget.status !== 'ready') throw new Error('GUIDED_EXACT_TARGET_TEST_FAILED');
	assert.deepEqual(exactTarget.intent.spec.items[0].target, {
		representation: 'inline',
		mode: 'exact-path',
		filePath: 'Inbox/Tasks.md',
	});
	assert.match(exactTargetPort.output(), /safe vault-relative path/u);

	const assigneeModel: typeof model = {
		...model,
		policies: {
			...model.policies,
			creation: {
				...model.policies.creation,
				assigneesRequired: true,
			},
		},
	};
	const assigneePort = scriptedGuidedPort([
		'', // Inline representation.
		'', // Configured target.
		'', // Configured pipeline.
		'', // Configured status.
		'', // Configured priority.
		'', // Invalid empty required list.
		'Alice',
		'', // Finish the required list.
		'', // No additional properties.
		'', // Preview.
	]);
	const assigned = await runGuidedCreationWizardV1({
		model: assigneeModel,
		port: assigneePort.port,
		itemRef: 'assigned-task',
		initialDescription: 'Assigned task',
	});
	assert.equal(assigned.status, 'ready');
	if (assigned.status !== 'ready') throw new Error('GUIDED_ASSIGNEE_TEST_FAILED');
	assert.deepEqual(assigned.intent.spec.items[0].fields[0], {
		kind: 'list',
		field: 'assignees',
		value: ['Alice'],
	});
	assert.match(assigneePort.output(), /At least one assignee is required/u);
	assert.match(assigneePort.output(), /Assignees: 1 set/u);

	const runtimeTemplateModel: typeof model = {
		...model,
		policies: {
			...model.policies,
			creation: {
				...model.policies.creation,
				defaultToFileTask: true,
				builtInTemplateCandidates: [],
			},
		},
	};
	const runtimeTemplate = await runGuidedCreationWizardV1({
		model: runtimeTemplateModel,
		port: scriptedGuidedPort([
			'', // File representation.
			'', // Runtime-configured target and template.
			'', // Configured pipeline.
			'', // Configured status.
			'', // Configured priority.
			'', // No additional properties.
			'', // Preview.
		]).port,
		itemRef: 'runtime-template-task',
		initialDescription: 'Runtime template task',
	});
	assert.equal(runtimeTemplate.status, 'ready');
	if (runtimeTemplate.status !== 'ready') throw new Error('GUIDED_RUNTIME_TEMPLATE_TEST_FAILED');
	assert.deepEqual(runtimeTemplate.intent.spec.items[0].target, {
		representation: 'file',
		mode: 'configured-default',
	});
}

async function testGuidedMaintenanceModels(): Promise<void> {
	const revision = finderRevision();
	const baseTask = finderTask('abc1234', 'Maintain this task', {
		representation: 'inline',
		filePath: 'Tasks.md',
		lineNumber: 2,
	}, revision);
	const task = {
		...baseTask,
		workflow: {
			pipeline: { id: 'pipeline-work', label: 'Work' },
			status: { id: 'status-open', label: 'Open' },
		},
		priority: { id: 'priority-medium', label: 'Medium' },
		dates: { due: '2026-07-30', scheduled: '2026-07-29' },
		datetimes: { start: '2026-07-29T09:00:00' },
		writableFields: [{
			canonicalKey: 'description',
			valueType: 'text',
			present: true,
			value: 'Maintain this task',
			canClear: false,
		}, {
			canonicalKey: 'note',
			valueType: 'text',
			present: true,
			value: 'Private existing note',
			canClear: true,
		}, {
			canonicalKey: 'priority',
			valueType: 'text',
			present: true,
			value: 'priority-medium',
			canClear: true,
		}, {
			canonicalKey: 'estimate',
			valueType: 'number',
			present: false,
			canClear: true,
		}, {
			canonicalKey: 'dateDue',
			valueType: 'date',
			present: true,
			value: '2026-07-30',
			canClear: true,
		}],
		reminderItems: [{
			collection: 'reminderDatetimes',
			itemId: 'reminder-fixed-1',
			expectedValue: '2026-07-30T08:00:00',
		}, {
			collection: 'reminderRules',
			itemId: 'reminder-rule-1',
			expectedValue: 'dateDue.1d',
		}],
	} as unknown as TaskContextV1;
	const catalog = {
		ok: true,
		taxonomy: {
			defaultPipeline: { status: 'resolved', configuredValue: 'Work', id: 'pipeline-work' },
			defaultPriority: { status: 'resolved', configuredValue: 'Medium', id: 'priority-medium' },
			pipelines: [{
				id: 'pipeline-work',
				name: 'Work',
				description: 'Work tasks',
				order: 1,
				identityStatus: 'resolved',
				statuses: [{
					id: 'status-open',
					label: 'Open',
					order: 1,
					color: '#000000',
					isFinished: false,
					isCancelled: false,
					isScheduledTarget: false,
					isTrackingTarget: false,
					identityStatus: 'resolved',
				}, {
					id: 'status-done',
					label: 'Done',
					order: 2,
					color: '#000000',
					isFinished: true,
					isCancelled: false,
					isScheduledTarget: false,
					isTrackingTarget: false,
					identityStatus: 'resolved',
				}],
			}],
			priorities: [{
				id: 'priority-medium',
				label: 'Medium',
				description: 'Normal priority',
				order: 1,
				color: '#000000',
				isDefault: true,
				identityStatus: 'resolved',
			}, {
				id: 'priority-high',
				label: 'High',
				description: 'Important work',
				order: 0,
				color: '#ff0000',
				isDefault: false,
				identityStatus: 'resolved',
			}],
		},
		fields: [{
			...fieldDescriptor('description', 'Description', 'text', 'built-in'),
		}, {
			...fieldDescriptor('note', 'Note', 'text', 'built-in'),
		}, {
			...fieldDescriptor('priority', 'Priority', 'text', 'built-in'),
			requiresStableTaxonomyId: true,
		}, {
			...fieldDescriptor('estimate', 'Estimate', 'number', 'built-in'),
		}, {
			...fieldDescriptor('dateDue', 'Due', 'date', 'built-in'),
		}],
		policies: {
			reminders: {
				fields: [{
					canonicalKey: 'reminderDatetimes',
					availability: 'available',
				}, {
					canonicalKey: 'reminderRules',
					availability: 'available',
				}],
				ruleAnchors: ['datetimeStart', 'dateScheduled', 'dateDue'],
				itemActions: ['add', 'replace', 'remove'],
			},
		},
	} as unknown as OperonCatalogV1;

	const updatePort = scriptedGuidedPort(['1', 'Updated task', '', '']);
	const update = await runGuidedTaskUpdateWizardV1({
		port: updatePort.port,
		task,
		catalog,
	});
	assert.equal(update.status, 'ready');
	if (update.status !== 'ready') throw new Error('GUIDED_UPDATE_TEST_FAILED');
	assert.deepEqual(update.intent.spec, {
		operation: 'update',
		changes: [{ field: 'description', valueType: 'text', value: 'Updated task' }],
	});
	assert.doesNotMatch(updatePort.output(), /Private existing note/u);

	const clearPort = scriptedGuidedPort(['2', '2', '', '']);
	const clear = await runGuidedTaskUpdateWizardV1({
		port: clearPort.port,
		task,
		catalog,
	});
	assert.equal(clear.status, 'ready');
	if (clear.status !== 'ready') throw new Error('GUIDED_CLEAR_TEST_FAILED');
	assert.deepEqual(clear.intent.spec, {
		operation: 'update',
		changes: [{ operation: 'clear', field: 'note', valueType: 'text' }],
	});

	const priorityPort = scriptedGuidedPort(['3', '', '1', '', '']);
	const priorityUpdate = await runGuidedTaskUpdateWizardV1({
		port: priorityPort.port,
		task,
		catalog,
	});
	assert.equal(priorityUpdate.status, 'ready');
	if (priorityUpdate.status !== 'ready') throw new Error('GUIDED_PRIORITY_UPDATE_TEST_FAILED');
	assert.deepEqual(priorityUpdate.intent.spec, {
		operation: 'update',
		changes: [{ field: 'priority', valueType: 'text', value: 'priority-high' }],
	});

	const numberPort = scriptedGuidedPort(['4', '', '15', '', '']);
	const numberUpdate = await runGuidedTaskUpdateWizardV1({
		port: numberPort.port,
		task,
		catalog,
	});
	assert.equal(numberUpdate.status, 'ready');
	if (numberUpdate.status !== 'ready') throw new Error('GUIDED_NUMBER_UPDATE_TEST_FAILED');
	assert.deepEqual(numberUpdate.intent.spec, {
		operation: 'update',
		changes: [{ field: 'estimate', valueType: 'number', value: 15 }],
	});
	assert.match(numberPort.output(), /Enter a finite number/u);

	const recurringPort = scriptedGuidedPort(['q']);
	const recurring = {
		...task,
		recurrence: { repeating: true, seriesId: 'rs12345' },
	};
	const recurringCancelled = await runGuidedTaskUpdateWizardV1({
		port: recurringPort.port,
		task: recurring,
		catalog,
	});
	assert.equal(recurringCancelled.status, 'cancelled');
	assert.doesNotMatch(recurringPort.output(), /Due description/u);

	await assert.rejects(
		runGuidedTaskUpdateWizardV1({
			port: scriptedGuidedPort([]).port,
			task: { ...task, writableFields: undefined },
			catalog,
		}),
		/GUIDED_WRITABLE_FIELDS_INCOMPLETE/u,
	);

	const transitionPort = scriptedGuidedPort(['2', '']);
	const transition = await runGuidedTransitionWizardV1({
		port: transitionPort.port,
		task,
		catalog,
	});
	assert.equal(transition.status, 'ready');
	if (transition.status !== 'ready') throw new Error('GUIDED_TRANSITION_TEST_FAILED');
	assert.deepEqual(transition.intent.spec, {
		operation: 'transition',
		targetStatusId: 'status-done',
		expectedStatusId: 'status-open',
	});
	assert.match(transitionPort.output(), /finished/u);
	await assert.rejects(
		runGuidedTransitionWizardV1({
			port: scriptedGuidedPort([]).port,
			task: { ...task, workflow: undefined },
			catalog,
		}),
		/GUIDED_STATUS_UNAVAILABLE/u,
	);

	const reminderAddPort = scriptedGuidedPort(['2', '1', '2', '']);
	const reminderAdd = await runGuidedReminderWizardV1({
		port: reminderAddPort.port,
		task,
		catalog,
		operation: 'add',
	});
	assert.equal(reminderAdd.status, 'ready');
	if (reminderAdd.status !== 'ready') throw new Error('GUIDED_REMINDER_ADD_TEST_FAILED');
	assert.deepEqual(reminderAdd.intent.spec, {
		operation: 'add',
		collection: 'reminderRules',
		value: 'datetimeStart.10m',
	});
	const fixedPort = scriptedGuidedPort(['1', '2026-07-31T08:30', '']);
	const fixed = await runGuidedReminderWizardV1({
		port: fixedPort.port,
		task,
		catalog,
		operation: 'add',
	});
	assert.equal(fixed.status, 'ready');
	if (fixed.status !== 'ready') throw new Error('GUIDED_FIXED_REMINDER_TEST_FAILED');
	assert.deepEqual(fixed.intent.spec, {
		operation: 'add',
		collection: 'reminderDatetimes',
		value: '2026-07-31T08:30:00',
	});
	const relativeOnlyCatalog = {
		...catalog,
		policies: {
			...(catalog.ok ? catalog.policies : {}),
			reminders: {
				fields: [{
					canonicalKey: 'reminderDatetimes',
					availability: 'unavailable',
				}, {
					canonicalKey: 'reminderRules',
					availability: 'available',
				}],
				ruleAnchors: ['datetimeStart'],
				itemActions: ['add', 'replace', 'remove'],
			},
		},
	} as unknown as OperonCatalogV1;
	const relativeOnlyPort = scriptedGuidedPort(['1', '1', '1', '']);
	const relativeOnly = await runGuidedReminderWizardV1({
		port: relativeOnlyPort.port,
		task,
		catalog: relativeOnlyCatalog,
		operation: 'add',
	});
	assert.equal(relativeOnly.status, 'ready');
	if (relativeOnly.status !== 'ready') throw new Error('GUIDED_REMINDER_POLICY_TEST_FAILED');
	assert.equal(relativeOnly.intent.spec.collection, 'reminderRules');
	assert.doesNotMatch(relativeOnlyPort.output(), /Fixed Reminder/u);

	const reminderRemovePort = scriptedGuidedPort(['2', '']);
	const reminderRemove = await runGuidedReminderWizardV1({
		port: reminderRemovePort.port,
		task,
		catalog,
		operation: 'remove',
	});
	assert.equal(reminderRemove.status, 'ready');
	if (reminderRemove.status !== 'ready') throw new Error('GUIDED_REMINDER_REMOVE_TEST_FAILED');
	assert.deepEqual(reminderRemove.intent.spec, {
		operation: 'remove',
		collection: 'reminderRules',
		itemId: 'reminder-rule-1',
		expectedValue: 'dateDue.1d',
	});

	const reminderReplacePort = scriptedGuidedPort(['1', '2026-07-31T09:00', '']);
	const reminderReplace = await runGuidedReminderWizardV1({
		port: reminderReplacePort.port,
		task,
		catalog,
		operation: 'replace',
	});
	assert.equal(reminderReplace.status, 'ready');
	if (reminderReplace.status !== 'ready') throw new Error('GUIDED_REMINDER_REPLACE_TEST_FAILED');
	assert.deepEqual(reminderReplace.intent.spec, {
		operation: 'replace',
		collection: 'reminderDatetimes',
		itemId: 'reminder-fixed-1',
		expectedValue: '2026-07-30T08:00:00',
		value: '2026-07-31T09:00:00',
	});

	const legacyTask = {
		...task,
		reminderItems: [{
			collection: 'reminderRules' as const,
			itemId: 'legacy-rule',
			expectedValue: 'legacy invalid token',
		}],
	};
	const legacyRemove = await runGuidedReminderWizardV1({
		port: scriptedGuidedPort(['1', '']).port,
		task: legacyTask,
		catalog,
		operation: 'remove',
	});
	assert.equal(legacyRemove.status, 'ready');
	if (legacyRemove.status !== 'ready') throw new Error('GUIDED_LEGACY_REMINDER_TEST_FAILED');
	assert.equal(legacyRemove.intent.spec.expectedValue, 'legacy invalid token');

	const reminderNoChange = await runGuidedReminderWizardV1({
		port: scriptedGuidedPort([]).port,
		task: { ...task, reminderItems: [] },
		catalog,
		operation: 'remove',
	});
	assert.equal(reminderNoChange.status, 'no-change');
	await assert.rejects(
		runGuidedReminderWizardV1({
			port: scriptedGuidedPort([]).port,
			task: { ...task, reminderItems: undefined },
			catalog,
			operation: 'replace',
		}),
		/GUIDED_REMINDER_ITEMS_UNAVAILABLE/u,
	);

	const activeState: TimerStateV1 = {
		active: {
			operonId: 'def5678',
			start: '2026-07-25T10:00:00.000Z',
			source: 'manual',
			elapsedSeconds: 60,
			isUnassigned: false,
		},
		transition: null,
	};
	const timerStartPort = scriptedGuidedPort(['1', '']);
	const timerStart = await runGuidedTimerStartWizardV1({
		port: timerStartPort.port,
		state: activeState,
		selectTask: async () => task,
	});
	assert.equal(timerStart.status, 'ready');
	if (timerStart.status !== 'ready') throw new Error('GUIDED_TIMER_START_TEST_FAILED');
	assert.deepEqual(timerStart.intent.spec, {
		operation: 'start',
		expectedActiveStart: '2026-07-25T10:00:00.000Z',
	});
	assert.equal(timerStart.intent.target?.operonId, 'abc1234');

	const unassignedStart = await runGuidedTimerStartWizardV1({
		port: scriptedGuidedPort(['2', '']).port,
		state: { active: null, transition: null },
		selectTask: async () => {
			throw new Error('UNASSIGNED_TIMER_MUST_NOT_SELECT_TASK');
		},
	});
	assert.equal(unassignedStart.status, 'ready');
	if (unassignedStart.status !== 'ready') throw new Error('GUIDED_UNASSIGNED_TIMER_TEST_FAILED');
	assert.equal(unassignedStart.intent.target, undefined);
	assert.deepEqual(unassignedStart.intent.spec, { operation: 'start' });

	const timerStopPort = scriptedGuidedPort(['']);
	const timerStop = await runGuidedTimerStopWizardV1({
		port: timerStopPort.port,
		state: activeState,
	});
	assert.equal(timerStop.status, 'ready');
	if (timerStop.status !== 'ready') throw new Error('GUIDED_TIMER_STOP_TEST_FAILED');
	assert.deepEqual(timerStop.intent.spec, {
		operation: 'stop',
		expectedActiveStart: '2026-07-25T10:00:00.000Z',
	});
	assert.equal(timerStop.intent.target, undefined);

	const idle = await runGuidedTimerStopWizardV1({
		port: scriptedGuidedPort([]).port,
		state: { active: null, transition: null },
	});
	assert.equal(idle.status, 'no-change');
	await assert.rejects(
		runGuidedTimerStartWizardV1({
			port: scriptedGuidedPort([]).port,
			state: {
				active: null,
				transition: {
					kind: 'starting',
					operonId: 'abc1234',
					start: '2026-07-25T10:00:00.000Z',
				},
			},
			selectTask: async () => task,
		}),
		/GUIDED_TIMER_TRANSITION_IN_PROGRESS/u,
	);
	await assert.rejects(
		runGuidedTimerStopWizardV1({
			port: scriptedGuidedPort([]).port,
			state: {
				active: activeState.active,
				transition: {
					kind: 'stopping',
					operonId: 'def5678',
					start: '2026-07-25T10:00:00.000Z',
				},
			},
		}),
		/GUIDED_TIMER_TRANSITION_IN_PROGRESS/u,
	);
}

function fieldDescriptor(
	canonicalKey: string,
	displayName: string,
	valueType: 'text' | 'number' | 'date' | 'datetime' | 'list' | 'checkbox',
	source: 'built-in' | 'custom',
) {
	return {
		canonicalKey,
		displayName,
		description: `${displayName} description`,
		valueType,
		source,
		mappingStatus: 'mapped' as const,
		readable: true,
		mutationClass: 'general-update' as const,
		mutationOwner: 'tasks.update',
		requiresStableTaxonomyId: false,
	};
}

function scriptedGuidedPort(answers: Array<string | null>): {
	port: GuidedCreationPortV1;
	output(): string;
} {
	let output = '';
	let index = 0;
	return {
		port: {
			ask(prompt: string): Promise<string | null> {
				output += prompt;
				const answer = answers[index] ?? null;
				index += 1;
				return Promise.resolve(answer);
			},
			write(text: string): void {
				output += text;
			},
		},
		output: () => output,
	};
}

function successEnvelope(
	command: CliResultEnvelopeV1['command'],
	result: unknown,
): CliResultEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: 'human-renderer-001',
		command,
		ok: true,
		transport: { channel: 'request-file', inputBytes: 128 },
		vaultIdentity: { expectedMatch: true },
		compatibility: {
			contractVersion: 1,
			compatible: true,
			runtimeApi: 1,
		},
		cliContract: 1,
		runtime: {
			appVersion: '1.13.3',
			plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
			apiVersion: 1,
		},
		timing: { handlerMs: 1, totalMs: 2 },
		warnings: [],
		result,
	} as CliResultEnvelopeV1;
}

function capabilitiesSuccessEnvelope(
	invocation: CliInvocationV1,
	inputBytes: number,
): CliResultEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: invocation.command,
		ok: true,
		transport: {
			channel: 'request-file',
			inputBytes,
		},
		vaultIdentity: { expectedMatch: true },
		compatibility: {
			contractVersion: 1,
			compatible: true,
			runtimeApi: 1,
		},
		cliContract: 1,
		runtime: {
			appVersion: '1.13.3',
			plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
			apiVersion: 1,
		},
		timing: { handlerMs: 1.25 },
		warnings: [],
		result: [],
	};
}

function healthInvocation(): CliInvocationV1 {
	return {
		contractVersion: 1,
		kind: 'cli-invocation',
		requestId: 'cli-health-001',
		command: 'health',
		mode: 'live',
		clientVersion: '0.1.0',
		compatibility: {
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
		},
		cliContract: { min: 1, max: 1 },
		expectedVaultSha256: '0'.repeat(64),
		readinessTimeoutMs: 15_000,
	};
}

function failureEnvelope(invocation: CliInvocationV1, totalMs: number): CliResultEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: invocation.command,
		ok: false,
		transport: { channel: 'request-file', inputBytes: 512 },
		vaultIdentity: { expectedMatch: true },
		timing: { handlerMs: 1, totalMs },
		warnings: [],
		failure: {
			stage: 'readiness',
			error: {
				contractVersion: 1,
				code: 'live-settling',
				reason: 'Runtime is settling.',
				retryable: true,
				action: 'wait-and-retry',
			},
		},
	};
}

function lstatMissing(filePath: string): boolean {
	try {
		lstatSync(filePath);
		return false;
	} catch (error) {
		return error instanceof Error && 'code' in error && error.code === 'ENOENT';
	}
}
