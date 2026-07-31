#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const consumerSourceRoot = path.join(
	pluginRoot,
	'scripts/agent-runtime/developer-api/native-acceptance-consumer',
);
const CONSUMER_ID = 'operon-developer-api-native-acceptance-consumer';
const MARKER_FILE = '.operon-developer-api-native-fixture.json';
const MARKER_KIND = 'operon-developer-api-native-fixture-vault';
const RUNNER_DIRECTORY = 'native-acceptance-runner';
const ROUTINE_INPUT = 'routine-input.json';
const ROUTINE_OUTPUT = 'routine-output.json';
const RECOVERY_INPUT = 'recovery-input.json';
const RECOVERY_OUTPUT = 'recovery-output.json';
const DIGEST = /^[0-9a-f]{64}$/u;
const OPERON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECOVERY_REF = /^dvr1_[0-9a-f]{48}$/u;

export async function runNativeDeveloperApiAcceptance(options) {
	const vaultRoot = await requireCanonicalDirectory(options.vault, 'VAULT');
	const artifactRoot = await requireCanonicalDirectory(
		options.operonArtifactRoot,
		'OPERON_ARTIFACT',
	);
	const tarballPath = await requireCanonicalFile(options.tarball, 'TARBALL');
	const cliExecutable = await requireCanonicalFile(options.cliExecutable, 'CLI_EXECUTABLE');
	const candidateEvidencePath = await requireCanonicalFile(
		options.candidateEvidence,
		'CANDIDATE_EVIDENCE',
	);
	const candidateEvidence = JSON.parse(await readFile(candidateEvidencePath, 'utf8'));
	assert.ok(
		candidateEvidence.kind === 'operon-cli-release-candidate'
			|| candidateEvidence.kind === 'operon-cli-native-candidate',
		'Candidate evidence kind is invalid.',
	);
	const tarballBytes = await readFile(tarballPath);
	assert.equal(sha256(tarballBytes), candidateEvidence.sha256);
	const expectedPlugin = candidateEvidence.compatiblePublicPlugin;
	assert.ok(
		expectedPlugin?.kind === 'operon-public-plugin-release'
			|| expectedPlugin?.kind === 'operon-plugin-native-candidate',
		'Candidate evidence has no compatible Operon plugin binding.',
	);
	for (const [fileName, digestKey] of [
		['main.js', 'mainJsSha256'],
		['manifest.json', 'manifestSha256'],
		['styles.css', 'stylesCssSha256'],
	]) {
		const sourcePath = path.join(artifactRoot, fileName);
		await requireDirectRegularFile(sourcePath, artifactRoot, `OPERON_${fileName}`);
		assert.equal(
			sha256(await readFile(sourcePath)),
			expectedPlugin[digestKey],
			`Operon artifact ${fileName} is not candidate-bound.`,
		);
	}
	assert.match(options.operonId, OPERON_ID, 'A canonical --operon-id is required.');
	assert.ok(
		options.representation === 'inline' || options.representation === 'file',
		'--representation must be inline or file.',
	);
	assert.ok(
		typeof options.taskFile === 'string'
			&& options.taskFile.endsWith('.md')
			&& options.taskFile === options.taskFile.split(path.sep).join('/')
			&& !path.posix.isAbsolute(options.taskFile)
			&& !options.taskFile.split('/').includes('..'),
		'--task-file must be a normalized vault-relative Markdown path.',
	);
	const lineNumber = options.representation === 'inline'
		? Number(options.lineNumber)
		: null;
	if (options.representation === 'inline') {
		assert.ok(
			Number.isSafeInteger(lineNumber) && lineNumber >= 0,
			'Inline acceptance requires a zero-based --line-number.',
		);
	} else {
		assert.equal(options.lineNumber, undefined, 'File tasks must not supply --line-number.');
	}
	const locator = options.representation === 'inline'
		? {
			representation: 'inline',
			filePath: options.taskFile,
			lineNumber,
		}
		: {
			representation: 'file',
			filePath: options.taskFile,
		};
	const markerPath = path.join(vaultRoot, MARKER_FILE);
	await requireDirectRegularFile(markerPath, vaultRoot, 'FIXTURE_MARKER');
	const markerBytes = await readFile(markerPath);
	const marker = JSON.parse(markerBytes.toString('utf8'));
	assert.deepEqual(
		Object.keys(marker).sort(),
		['kind', 'nonce', 'runId'].sort(),
		'Fixture marker keys changed.',
	);
	assert.equal(marker.kind, MARKER_KIND, 'Acceptance vault marker kind is invalid.');
	assert.match(marker.runId, /^[A-Za-z0-9._-]{1,160}$/u);
	assert.match(marker.nonce, /^[A-Za-z0-9._-]{1,160}$/u);

	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-native-developer-api-'));
	const commandTranscript = [];
	try {
		const vaultIdentity = runProcess(
			options.obsidianBin,
			[`vault=${path.basename(vaultRoot)}`, 'vault', 'info=path'],
			vaultRoot,
		);
		commandTranscript.push(commandEvidence('vault-identity', vaultIdentity));
		requireSuccess(vaultIdentity, 'vault-identity');
		assert.equal(
			await realpath(vaultIdentity.stdout.trim()),
			vaultRoot,
			'Official Obsidian CLI resolved a different acceptance vault.',
		);
		const consumerBuildRoot = path.join(temporaryRoot, 'consumer-build');
		const buildCommand = runProcess(
			process.execPath,
			[
				path.join(consumerSourceRoot, 'build.mjs'),
				'--tarball',
				tarballPath,
				'--outdir',
				consumerBuildRoot,
			],
			pluginRoot,
		);
		commandTranscript.push(commandEvidence('consumer-build', buildCommand));
		requireSuccess(buildCommand, 'Consumer build');
		const buildEvidencePath = path.join(consumerBuildRoot, 'build-evidence.json');
		const buildEvidenceBytes = await readFile(buildEvidencePath);
		const buildEvidence = JSON.parse(buildEvidenceBytes.toString('utf8'));
		assert.equal(buildEvidence.kind, 'operon-developer-api-native-consumer-build');
		assert.match(buildEvidence.mainJsSha256, DIGEST);

		const configRoot = path.join(vaultRoot, '.obsidian');
		const pluginConfigRoot = path.join(configRoot, 'plugins');
		const installedOperonRoot = path.join(pluginConfigRoot, 'operon');
		const installedConsumerRoot = path.join(pluginConfigRoot, CONSUMER_ID);
		await requireCanonicalDirectory(installedOperonRoot, 'INSTALLED_OPERON');
		await mkdir(installedConsumerRoot, { recursive: true, mode: 0o700 });
		await requireExactCanonicalPath(installedConsumerRoot, 'INSTALLED_CONSUMER');
		const stageEntries = [];
		for (const fileName of ['main.js', 'manifest.json', 'styles.css']) {
			const sourcePath = path.join(artifactRoot, fileName);
			await requireDirectRegularFile(sourcePath, artifactRoot, `OPERON_${fileName}`);
			stageEntries.push({
				sourcePath,
				destinationPath: path.join(installedOperonRoot, fileName),
				destinationRoot: installedOperonRoot,
			});
		}
		for (const fileName of ['main.js', 'manifest.json', 'build-evidence.json']) {
			const sourcePath = path.join(consumerBuildRoot, fileName);
			await requireDirectRegularFile(sourcePath, consumerBuildRoot, `CONSUMER_${fileName}`);
			stageEntries.push({
				sourcePath,
				destinationPath: path.join(installedConsumerRoot, fileName),
				destinationRoot: installedConsumerRoot,
			});
		}
		await stageExactFiles(stageEntries);
		const installedConsumerMain = await readFile(path.join(installedConsumerRoot, 'main.js'));
		assert.equal(sha256(installedConsumerMain), buildEvidence.mainJsSha256);
		const consumerManifest = JSON.parse(await readFile(
			path.join(installedConsumerRoot, 'manifest.json'),
			'utf8',
		));
		assert.equal(consumerManifest.id, CONSUMER_ID);

		const runnerRoot = path.join(installedConsumerRoot, RUNNER_DIRECTORY);
		await mkdir(runnerRoot, { recursive: true, mode: 0o700 });
		await requireExactCanonicalPath(runnerRoot, 'RUNNER_ROOT');
		const note = `native-developer-api-${marker.runId}-${randomUUID()}`;
		const exactRead = {
			contractVersion: 1,
			requestId: `native-read-${randomUUID()}`,
			kind: 'task-get',
			consistency: 'strict',
			selector: { kind: 'operon-id', operonId: options.operonId },
		};
		const inputBase = {
			contractVersion: 1,
			kind: 'operon-developer-api-native-consumer-input',
			runId: marker.runId,
			expectedConsumer: {
				id: CONSUMER_ID,
				version: consumerManifest.version,
			},
			fixtureVault: {
				root: vaultRoot,
				markerNonce: marker.nonce,
			},
			requestedCapabilities: [
				'system.health',
				'system.capabilities',
				'tasks.read',
				'tasks.update.preview',
				'tasks.update.apply',
			],
			expectedTask: {
				operonId: options.operonId,
				representation: options.representation,
			},
			expectedFinalState: { note },
		};
		const routineInput = {
			...inputBase,
			phase: 'routine',
			exactRead,
			mutation: {
				capability: 'tasks.update.preview',
				mutationKind: 'task.update',
				target: { operonId: options.operonId, locator },
				spec: {
					operation: 'update',
					changes: [{ field: 'note', valueType: 'text', value: note }],
				},
			},
		};
		await writeRunnerInput(path.join(runnerRoot, ROUTINE_INPUT), routineInput);
		await removeFixedOutput(path.join(runnerRoot, ROUTINE_OUTPUT), runnerRoot);

		await reloadAndRun({
			options,
			cliExecutable,
			commandTranscript,
			phase: 'routine',
			outputPath: path.join(runnerRoot, ROUTINE_OUTPUT),
			runId: marker.runId,
		});
		const routineBytes = await readFile(path.join(runnerRoot, ROUTINE_OUTPUT));
		const routine = JSON.parse(routineBytes.toString('utf8'));
		requirePassedRoutine(routine, marker.runId, options.operonId, options.representation);
		const routineSha256 = sha256(routineBytes);

		const recoveryInput = {
			...inputBase,
			phase: 'recovery',
			exactRead: {
				...exactRead,
				requestId: `native-recovery-read-${randomUUID()}`,
			},
			recoveryRef: routine.routine.recoveryRef,
			routineEvidence: {
				runId: marker.runId,
				sha256: routineSha256,
				recoveryRef: routine.routine.recoveryRef,
				planDigest: routine.routine.planDigest,
				sessionId: routine.runtimeSessionId,
				instanceEpoch: routine.registryIdentity.instanceEpoch,
			},
		};
		await writeRunnerInput(path.join(runnerRoot, RECOVERY_INPUT), recoveryInput);
		await removeFixedOutput(path.join(runnerRoot, RECOVERY_OUTPUT), runnerRoot);

		await reloadAndRun({
			options,
			cliExecutable,
			commandTranscript,
			phase: 'recovery',
			outputPath: path.join(runnerRoot, RECOVERY_OUTPUT),
			runId: marker.runId,
		});
		const recoveryBytes = await readFile(path.join(runnerRoot, RECOVERY_OUTPUT));
		const recovery = JSON.parse(recoveryBytes.toString('utf8'));
		requirePassedRecovery(
			recovery,
			marker.runId,
			options.operonId,
			options.representation,
			routine,
			routineSha256,
		);
		const transcriptBytes = Buffer.from(`${JSON.stringify(commandTranscript, null, 2)}\n`);
		const evidence = {
			status: 'passed',
			skipped: 0,
			inconclusive: 0,
			tests: 1,
			consumerArtifactSha256: buildEvidence.mainJsSha256,
			registryIdentity: true,
			healthCapabilities: true,
			exactRead: true,
			previewApplyReplay: true,
			recoveryRef: true,
			rawEvidence: {
				build: rawDigest('operon-developer-api-native-consumer-build', buildEvidenceBytes),
				routine: rawDigest('operon-developer-api-native-consumer-output', routineBytes),
				recovery: rawDigest('operon-developer-api-native-consumer-output', recoveryBytes),
				commandTranscript: rawDigest(
					'operon-developer-api-native-command-transcript',
					transcriptBytes,
				),
			},
		};
		await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`, {
			encoding: 'utf8',
			flag: 'wx',
			mode: 0o600,
		});
		return evidence;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

async function reloadAndRun({
	options,
	cliExecutable,
	commandTranscript,
	phase,
	outputPath,
	runId,
}) {
	for (const [label, command] of [
		[`reload-operon-${phase}`, ['plugin:reload', 'id=operon']],
		[`enable-consumer-${phase}`, ['plugin:enable', `id=${CONSUMER_ID}`]],
		[`reload-consumer-${phase}`, ['plugin:reload', `id=${CONSUMER_ID}`]],
		[
			`command-consumer-${phase}`,
			[
				'command',
				`id=${CONSUMER_ID}:run-native-acceptance-${phase}`,
			],
		],
	]) {
		const result = runProcess(
			options.obsidianBin,
			[`vault=${path.basename(options.vault)}`, ...command],
			options.vault,
		);
		commandTranscript.push(commandEvidence(label, result));
		requireSuccess(result, label);
		if (label === `reload-operon-${phase}`) {
			const ready = await waitForReadyRuntime(cliExecutable, options.vault);
			commandTranscript.push(commandEvidence(`ready-operon-${phase}`, ready));
		}
	}
	await waitForEvidence(outputPath, runId);
}

async function waitForReadyRuntime(cliExecutable, vaultRoot) {
	const deadline = Date.now() + 30_000;
	let last;
	while (Date.now() < deadline) {
		last = runProcess(
			cliExecutable,
			['health', '--vault', vaultRoot, '--json'],
			vaultRoot,
		);
		if (last.status === 0) {
			try {
				const value = JSON.parse(last.stdout);
				if (
					value.ok === true
					&& value.result?.lifecyclePhase === 'ready'
					&& value.result?.v8PersistencePhase === 'idle'
				) return last;
			} catch {
				// Continue until a complete JSON response is available.
			}
		}
		await delay(250);
	}
	requireSuccess(last, 'Operon ready/idle health');
	throw new Error('Operon Runtime did not become ready/idle after plugin reload.');
}

async function waitForEvidence(filePath, runId) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const value = JSON.parse(await readFile(filePath, 'utf8'));
			if (value.runId === runId) return;
		} catch (error) {
			if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
		}
		await delay(250);
	}
	throw new Error(`Timed out waiting for fixed acceptance evidence ${path.basename(filePath)}.`);
}

function requirePassedRoutine(value, runId, operonId, representation) {
	assert.equal(value.kind, 'operon-developer-api-native-consumer-output');
	assert.equal(value.runId, runId);
	assert.equal(value.phase, 'routine');
	assert.equal(value.status, 'passed');
	assert.equal(value.exactRead?.operonId, operonId);
	assert.equal(value.exactRead?.representation, representation);
	assert.match(value.runtimeSessionId ?? '', /^[A-Za-z0-9._-]{1,160}$/u);
	assert.match(value.registryIdentity?.instanceEpoch ?? '', /^[A-Za-z0-9._-]{1,160}$/u);
	assert.match(value.routine?.recoveryRef ?? '', RECOVERY_REF);
	assert.ok(typeof value.routine?.planDigest === 'string' && value.routine.planDigest.length > 0);
	for (const key of [
		'writeFreeReplay',
		'applyPlanDigestMatched',
		'applyReceiptOutcomeMatched',
		'replayPlanDigestMatched',
		'applyPostflightVerified',
		'replayPostflightVerified',
		'finalStateVerified',
	]) assert.equal(value.routine[key], true, `Routine proof did not verify ${key}.`);
}

function requirePassedRecovery(value, runId, operonId, representation, routine, routineSha256) {
	assert.equal(value.kind, 'operon-developer-api-native-consumer-output');
	assert.equal(value.runId, runId);
	assert.equal(value.phase, 'recovery');
	assert.equal(value.status, 'passed');
	assert.equal(value.exactRead?.operonId, operonId);
	assert.equal(value.exactRead?.representation, representation);
	assert.equal(value.recovery?.recoveryRef, routine.routine.recoveryRef);
	assert.equal(value.recovery?.planDigest, routine.routine.planDigest);
	assert.equal(value.recovery?.routineEvidenceSha256, routineSha256);
	for (const key of [
		'receiptReplayed',
		'receiptPlanDigestMatched',
		'sessionChanged',
		'instanceChanged',
		'finalStateVerified',
	]) assert.equal(value.recovery[key], true, `Recovery proof did not verify ${key}.`);
	assert.notEqual(value.runtimeSessionId, routine.runtimeSessionId);
	assert.notEqual(
		value.registryIdentity?.instanceEpoch,
		routine.registryIdentity?.instanceEpoch,
	);
}

async function writeRunnerInput(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'wx',
		mode: 0o600,
	});
}

async function removeFixedOutput(filePath, runnerRoot) {
	assert.equal(path.dirname(filePath), runnerRoot);
	try {
		const stats = await lstat(filePath);
		assert.ok(stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1);
		await unlink(filePath);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
}

export async function stageExactFile(sourcePath, destinationPath, destinationRoot) {
	return stageExactFiles([{ sourcePath, destinationPath, destinationRoot }]);
}

export async function stageExactFiles(entries) {
	assert.ok(Array.isArray(entries) && entries.length > 0);
	const staged = [];
	for (const entry of entries) {
		assert.equal(path.dirname(entry.destinationPath), entry.destinationRoot);
		await requireDirectRegularFile(
			entry.sourcePath,
			path.dirname(entry.sourcePath),
			'STAGE_SOURCE',
		);
		try {
			const destinationStats = await lstat(entry.destinationPath);
			assert.ok(
				destinationStats.isFile()
					&& !destinationStats.isSymbolicLink()
					&& destinationStats.nlink === 1,
				'Existing staged artifact must be a single-link regular file.',
			);
			assert.equal(
				await realpath(entry.destinationPath),
				entry.destinationPath,
				'Existing staged artifact must be canonical.',
			);
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		staged.push({
			...entry,
			temporaryPath: path.join(
				entry.destinationRoot,
				`.${path.basename(entry.destinationPath)}.${process.pid}.${randomUUID()}.tmp`,
			),
			backupPath: path.join(
				entry.destinationRoot,
				`.${path.basename(entry.destinationPath)}.${process.pid}.${randomUUID()}.previous`,
			),
			displaced: false,
			installed: false,
		});
	}
	try {
		for (const item of staged) {
			await writeFile(item.temporaryPath, await readFile(item.sourcePath), {
				flag: 'wx',
				mode: 0o600,
			});
		}
		for (const item of staged) {
			try {
				await rename(item.destinationPath, item.backupPath);
				item.displaced = true;
			} catch (error) {
				if (error?.code !== 'ENOENT') throw error;
			}
		}
		for (const item of staged) {
			await rename(item.temporaryPath, item.destinationPath);
			item.installed = true;
		}
		for (const item of staged) {
			await requireDirectRegularFile(
				item.destinationPath,
				item.destinationRoot,
				'STAGED_ARTIFACT',
			);
		}
	} catch (error) {
		for (const item of [...staged].reverse()) {
			if (item.installed) {
				try {
					await unlink(item.destinationPath);
				} catch {
					// Continue the rollback attempt for every staged artifact.
				}
			}
			if (item.displaced) {
				try {
					await rename(item.backupPath, item.destinationPath);
				} catch {
					// Preserve the primary failure; the disposable vault remains failed closed.
				}
			}
			try {
				await unlink(item.temporaryPath);
			} catch {
				// Preserve the primary failure.
			}
		}
		throw error;
	}
	for (const item of staged) {
		if (!item.displaced) continue;
		try {
			await unlink(item.backupPath);
		} catch {
			// The committed artifact set is authoritative; a same-directory backup is harmless.
		}
	}
}

function rawDigest(kind, bytes) {
	return { kind, bytes: bytes.length, sha256: sha256(bytes) };
}

function commandEvidence(label, result) {
	return {
		label,
		exitCode: result.status,
		signal: result.signal,
		stdout: rawDigest('stdout', Buffer.from(result.stdout)),
		stderr: rawDigest('stderr', Buffer.from(result.stderr)),
	};
}

function runProcess(command, args, cwd) {
	return spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
		env: {
			...process.env,
			NO_COLOR: '1',
		},
	});
}

function requireSuccess(result, label) {
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`${label} failed: ${result.stderr || result.stdout || `signal ${result.signal}`}`,
	);
}

async function requireCanonicalDirectory(value, label) {
	const resolved = path.resolve(value);
	const canonical = await realpath(resolved);
	assert.equal(canonical, resolved, `${label} must be a canonical, reparse-free path.`);
	const stats = await lstat(canonical);
	assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), `${label} must be a directory.`);
	return canonical;
}

async function requireCanonicalFile(value, label) {
	const resolved = path.resolve(value);
	const canonical = await realpath(resolved);
	assert.equal(canonical, resolved, `${label} must be a canonical, reparse-free path.`);
	const stats = await lstat(canonical);
	assert.ok(
		stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1,
		`${label} must be a single-link regular file.`,
	);
	return canonical;
}

async function requireDirectRegularFile(filePath, parent, label) {
	assert.equal(path.dirname(filePath), parent, `${label} must be a direct child.`);
	const canonical = await realpath(filePath);
	assert.equal(canonical, filePath, `${label} must be canonical.`);
	const stats = await lstat(filePath);
	assert.ok(
		stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1,
		`${label} must be a single-link regular file.`,
	);
}

async function requireExactCanonicalPath(value, label) {
	assert.equal(await realpath(value), value, `${label} must be canonical.`);
	const stats = await lstat(value);
	assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), `${label} must be a directory.`);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function parseArguments(args) {
	const options = {};
	const exact = new Map([
		['--tarball', 'tarball'],
		['--vault', 'vault'],
		['--operon-artifact-root', 'operonArtifactRoot'],
		['--operon-id', 'operonId'],
		['--representation', 'representation'],
		['--task-file', 'taskFile'],
		['--line-number', 'lineNumber'],
		['--output', 'output'],
		['--obsidian-bin', 'obsidianBin'],
		['--cli-executable', 'cliExecutable'],
		['--candidate-evidence', 'candidateEvidence'],
	]);
	for (let index = 0; index < args.length; index += 2) {
		const key = exact.get(args[index]);
		assert.ok(key, `Unknown argument ${String(args[index])}.`);
		const value = args[index + 1];
		assert.ok(value && !value.startsWith('--'), `${args[index]} requires a value.`);
		assert.equal(options[key], undefined, `${args[index]} may be specified only once.`);
		options[key] = value;
	}
	for (const key of [
		'tarball',
		'vault',
		'operonArtifactRoot',
		'operonId',
		'representation',
		'taskFile',
		'output',
		'cliExecutable',
		'candidateEvidence',
	]) assert.ok(options[key], `Missing required --${key.replace(/[A-Z]/gu, match => `-${match.toLowerCase()}`)}.`);
	options.obsidianBin ??= 'obsidian';
	options.output = path.resolve(options.output);
	return options;
}

async function main() {
	try {
		const evidence = await runNativeDeveloperApiAcceptance(parseArguments(process.argv.slice(2)));
		process.stdout.write(`${JSON.stringify(evidence)}\n`);
		return 0;
	} catch (error) {
		process.stderr.write(`${JSON.stringify({
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
		})}\n`);
		return 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exitCode = await main();
}
