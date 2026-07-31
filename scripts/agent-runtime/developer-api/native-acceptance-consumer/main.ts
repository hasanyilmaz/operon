import { Plugin } from 'obsidian';
import { createHash } from 'node:crypto';
import {
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type {
	OperonDeveloperApiAccessorV1,
} from 'operon-cli/contracts/v1/developer-api';

import { runAcceptanceV1 } from './acceptance.js';
import {
	ACCEPTANCE_RECOVERY_INPUT_FILE_V1,
	ACCEPTANCE_RECOVERY_OUTPUT_FILE_V1,
	ACCEPTANCE_ROUTINE_INPUT_FILE_V1,
	ACCEPTANCE_ROUTINE_OUTPUT_FILE_V1,
	ACCEPTANCE_RUNNER_DIRECTORY_V1,
	failedOutputV1,
	parseRunnerInputV1,
	parseVaultMarkerV1,
	type AcceptanceRunnerInputV1,
	type AcceptanceRunnerOutputV1,
} from './runner-contract.js';

const FIXTURE_MARKER_FILE_V1 = '.operon-developer-api-native-fixture.json';
const ROUTINE_COMMAND_ID_V1 = 'run-native-acceptance-routine';
const RECOVERY_COMMAND_ID_V1 = 'run-native-acceptance-recovery';

export default class OperonDeveloperApiNativeAcceptanceConsumer extends Plugin {
	onload(): void {
		this.addCommand({
			id: ROUTINE_COMMAND_ID_V1,
			name: 'Run native Developer API acceptance routine',
			callback: () => {
				void this.runFixedPhase('routine');
			},
		});
		this.addCommand({
			id: RECOVERY_COMMAND_ID_V1,
			name: 'Run native Developer API acceptance recovery',
			callback: () => {
				void this.runFixedPhase('recovery');
			},
		});
	}

	private async runFixedPhase(phase: 'routine' | 'recovery'): Promise<void> {
		const vaultRoot = this.app.vault.adapter.getBasePath?.();
		if (!vaultRoot) throw new Error('FIXTURE_REQUIRES_FILESYSTEM_VAULT');
		const inputFile = phase === 'routine'
			? ACCEPTANCE_ROUTINE_INPUT_FILE_V1
			: ACCEPTANCE_RECOVERY_INPUT_FILE_V1;
		const outputFile = phase === 'routine'
			? ACCEPTANCE_ROUTINE_OUTPUT_FILE_V1
			: ACCEPTANCE_RECOVERY_OUTPUT_FILE_V1;
		let output: AcceptanceRunnerOutputV1;
		let partial: { runId: string; phase: AcceptanceRunnerOutputV1['phase'] } = {
			runId: 'unknown',
			phase,
		};
		try {
			const paths = await fixedRunnerPaths(vaultRoot, this.app.vault.configDir, this.manifest.id);
			const inputPath = path.join(paths.runnerRoot, inputFile);
			const outputPath = path.join(paths.runnerRoot, outputFile);
			await requireSafeExistingFile(inputPath, paths.runnerRoot, 'INPUT');
			const inputBytes = await readFile(inputPath);
			const rawInput = JSON.parse(new TextDecoder().decode(inputBytes)) as unknown;
			const input = parseRunnerInputV1(rawInput);
			partial = { runId: input.runId, phase: input.phase };
			if (input.phase !== phase) throw new Error('RUNNER_PHASE_COMMAND_MISMATCH');
			await this.requireFixtureIdentity(input, paths.vaultRoot);
			if (phase === 'recovery') {
				await requireRoutineEvidenceBinding(
					input as Extract<AcceptanceRunnerInputV1, { phase: 'recovery' }>,
					paths.runnerRoot,
				);
			}
			const registeredConsumer = this.app.plugins.getPlugin(this.manifest.id);
			const operon = this.app.plugins.getPlugin('operon');
			if (!isDeveloperApiAccessor(operon)) {
				output = failedOutputV1(input.runId, input.phase, 'OPERON_ACCESSOR_UNAVAILABLE');
			} else {
				output = await runAcceptanceV1(input, {
					accessor: operon,
					consumerPlugin: this,
					registeredConsumer,
				});
			}
			await writeEvidence(outputPath, paths.runnerRoot, output);
		} catch (error) {
			output = failedOutputV1(partial.runId, partial.phase, safeErrorCode(error));
			const paths = await fixedRunnerPaths(vaultRoot, this.app.vault.configDir, this.manifest.id);
			await writeEvidence(path.join(paths.runnerRoot, outputFile), paths.runnerRoot, output);
		}
	}

	private async requireFixtureIdentity(
		input: AcceptanceRunnerInputV1,
		canonicalVaultRoot: string,
	): Promise<void> {
		if (
			this.manifest.id !== input.expectedConsumer.id
			|| this.manifest.version !== input.expectedConsumer.version
		) throw new Error('FIXTURE_MANIFEST_MISMATCH');
		if (await realpath(input.fixtureVault.root) !== canonicalVaultRoot) {
			throw new Error('FIXTURE_VAULT_ROOT_MISMATCH');
		}
		const markerPath = path.join(canonicalVaultRoot, FIXTURE_MARKER_FILE_V1);
		await requireSafeExistingFile(markerPath, canonicalVaultRoot, 'FIXTURE_MARKER');
		const marker = JSON.parse(await readFile(markerPath, 'utf8')) as unknown;
		parseVaultMarkerV1(marker, input);
	}
}

async function fixedRunnerPaths(
	vaultRoot: string,
	configDir: string,
	pluginId: string,
): Promise<{ vaultRoot: string; pluginRoot: string; runnerRoot: string }> {
	const canonicalVaultRoot = await realpath(vaultRoot);
	const expectedPluginRoot = path.join(
		canonicalVaultRoot,
		configDir,
		'plugins',
		pluginId,
	);
	const canonicalPluginRoot = await realpath(expectedPluginRoot);
	if (canonicalPluginRoot !== expectedPluginRoot) throw new Error('PLUGIN_ROOT_CANONICAL_MISMATCH');
	await requireSafeDirectory(canonicalPluginRoot, canonicalVaultRoot, 'PLUGIN_ROOT');
	const runnerRoot = path.join(canonicalPluginRoot, ACCEPTANCE_RUNNER_DIRECTORY_V1);
	await mkdir(runnerRoot, { recursive: true, mode: 0o700 });
	const canonicalRunnerRoot = await realpath(runnerRoot);
	if (canonicalRunnerRoot !== runnerRoot) throw new Error('RUNNER_ROOT_CANONICAL_MISMATCH');
	await requireSafeDirectory(canonicalRunnerRoot, canonicalPluginRoot, 'RUNNER_ROOT');
	return {
		vaultRoot: canonicalVaultRoot,
		pluginRoot: canonicalPluginRoot,
		runnerRoot: canonicalRunnerRoot,
	};
}

async function requireSafeDirectory(
	directory: string,
	parent: string,
	label: string,
): Promise<void> {
	if (path.dirname(directory) === directory || !isWithin(directory, parent)) {
		throw new Error(`${label}_OUTSIDE_PARENT`);
	}
	const stats = await lstat(directory);
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		throw new Error(`${label}_UNSAFE`);
	}
}

async function requireSafeExistingFile(
	filePath: string,
	parent: string,
	label: string,
): Promise<void> {
	if (!isWithin(filePath, parent) || path.dirname(filePath) !== parent) {
		throw new Error(`${label}_PATH_INVALID`);
	}
	const stats = await lstat(filePath);
	if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
		throw new Error(`${label}_FILE_UNSAFE`);
	}
	if (await realpath(filePath) !== filePath) throw new Error(`${label}_CANONICAL_MISMATCH`);
}

async function requireRoutineEvidenceBinding(
	input: Extract<AcceptanceRunnerInputV1, { phase: 'recovery' }>,
	runnerRoot: string,
): Promise<void> {
	const routineOutputPath = path.join(runnerRoot, ACCEPTANCE_ROUTINE_OUTPUT_FILE_V1);
	await requireSafeExistingFile(routineOutputPath, runnerRoot, 'ROUTINE_OUTPUT');
	const bytes = await readFile(routineOutputPath);
	if (sha256(bytes) !== input.routineEvidence.sha256) {
		throw new Error('ROUTINE_EVIDENCE_DIGEST_MISMATCH');
	}
	const value = JSON.parse(new TextDecoder().decode(bytes)) as {
		runId?: unknown;
		phase?: unknown;
		status?: unknown;
		runtimeSessionId?: unknown;
		registryIdentity?: { instanceEpoch?: unknown };
		routine?: { recoveryRef?: unknown; planDigest?: unknown };
	};
	if (
		value.runId !== input.runId
		|| value.phase !== 'routine'
		|| value.status !== 'passed'
		|| value.routine?.recoveryRef !== input.routineEvidence.recoveryRef
		|| value.routine?.planDigest !== input.routineEvidence.planDigest
		|| value.runtimeSessionId !== input.routineEvidence.sessionId
		|| value.registryIdentity?.instanceEpoch !== input.routineEvidence.instanceEpoch
	) throw new Error('ROUTINE_EVIDENCE_BINDING_INVALID');
}

function isWithin(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function isDeveloperApiAccessor(value: unknown): value is OperonDeveloperApiAccessorV1 {
	return Boolean(
		value
		&& typeof value === 'object'
		&& typeof (value as { getDeveloperApiV1?: unknown }).getDeveloperApiV1 === 'function',
	);
}

async function writeEvidence(
	outputPath: string,
	runnerRoot: string,
	output: AcceptanceRunnerOutputV1,
): Promise<void> {
	if (!isWithin(outputPath, runnerRoot) || path.dirname(outputPath) !== runnerRoot) {
		throw new Error('OUTPUT_PATH_INVALID');
	}
	const temporaryPath = path.join(
		runnerRoot,
		`.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
	);
	await writeFile(
		temporaryPath,
		`${JSON.stringify(output, null, 2)}\n`,
		{ encoding: 'utf8', flag: 'wx', mode: 0o600 },
	);
	await rename(temporaryPath, outputPath);
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function safeErrorCode(error: unknown): string {
	const message = error instanceof Error ? error.message : 'UNKNOWN_FAILURE';
	return /^[A-Z0-9_]{1,120}$/u.test(message) ? message : 'UNEXPECTED_FAILURE';
}
