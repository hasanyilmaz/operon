import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

declare const __OPERON_PLAN_STORE_CAPACITY_WORKER_SOURCE__: string;

import type {
	MutationPreviewRequestV1,
	MutationResultV1,
	SealedMutationPlanV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	computeReceiptTargetDigestV1,
	computeSealedMutationPlanHashV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	decodeCliInvocationV1,
	decodeMutationApplyRequestV1,
	decodeSealedMutationPlanV1,
} from '../../../src/agent-runtime/contracts/v1/decode';
import { validateCliInvocationForTransportV1 } from '../../../src/agent-runtime/transport/invocation-validator';
import {
	buildInvocationV1,
	sanitizeTerminalTextV1,
	type WindowsBrokerClientPortV1,
} from '../../../packages/operon-cli/src/client';
import { runPublicCommandLineV1 } from '../../../packages/operon-cli/src/command-line';
import {
	OPERON_CLI_COMMAND_DEFINITIONS_V1,
	completionCandidatesV1,
} from '../../../packages/operon-cli/src/command-registry';
import { renderShellCompletionV1 } from '../../../packages/operon-cli/src/shell-completion';
import { getOrCreateOperonCliClientIdV1 } from '../../../packages/operon-cli/src/client-identity';
import { secureCreatedFileV1 } from '../../../packages/operon-cli/src/secure-storage';
import {
	OPERON_CLI_CONVENIENCE_COMMANDS_V1,
	OPERON_CLI_CONVENIENCE_CONTRACTS_V1,
	OPERON_CLI_LOCAL_COMMANDS_V1,
	OPERON_CLI_LOCAL_CONTRACTS_V1,
	OPERON_CLI_RUNTIME_COMMANDS_V1,
	OPERON_CLI_RUNTIME_CONTRACTS_V1,
} from '../../../packages/operon-cli/src/manifest-data';
import {
	assertResolvedVaultCommandScopeV1,
	createResolvedVaultCommandScopeV1,
	loadOperonCliConfigV1,
	removeVaultProfileV1,
	resolveVaultV1,
	saveOperonCliConfigV1,
	setDefaultVaultProfileV1,
	upsertVaultProfileV1,
	validateOperonManifestV1,
} from '../../../packages/operon-cli/src/config';
import {
	deriveProfileAliasV1,
	discoverOperonVaultFromCwdV1,
} from '../../../packages/operon-cli/src/guided-setup';
import {
	buildMutationApplyRequestV1,
	confirmationTokenForPlanV1,
	discardMutationPlanV1,
	markMutationPlanDispatchedV1,
	MUTATION_RECOVERY_RECORD_LIMIT_V1,
	MUTATION_RECOVERY_RETENTION_MS_V1,
	pruneExpiredMutationPlansV1,
	readMutationPlanV1,
	recordMutationOutcomeV1,
	storeMutationPlanV1,
	writeStoredPlanV1,
} from '../../../packages/operon-cli/src/plan-store';
import {
	assertLiveTransportPlatformV1,
	canonicalVaultIdentityV1,
	liveTransportPlatformStatusV1,
} from '../../../packages/operon-cli/src/protocol';

test('command registry is the unique manifest and future completion authority', () => {
	const ids = OPERON_CLI_COMMAND_DEFINITIONS_V1.map(definition => definition.id);
	const paths = OPERON_CLI_COMMAND_DEFINITIONS_V1.map(definition => definition.path.join(' '));
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(new Set(paths).size, paths.length);
	assert.deepEqual(
		OPERON_CLI_COMMAND_DEFINITIONS_V1
			.filter(definition => definition.route === 'local')
			.map(definition => definition.id),
		OPERON_CLI_LOCAL_COMMANDS_V1,
	);
	assert.deepEqual(
		OPERON_CLI_COMMAND_DEFINITIONS_V1
			.filter(definition => definition.route === 'runtime')
			.map(definition => definition.id),
		OPERON_CLI_RUNTIME_COMMANDS_V1,
	);
	assert.deepEqual(
		OPERON_CLI_COMMAND_DEFINITIONS_V1
			.filter(definition => definition.route === 'convenience')
			.map(definition => definition.id),
		OPERON_CLI_CONVENIENCE_COMMANDS_V1,
	);
	assert.deepEqual(OPERON_CLI_LOCAL_COMMANDS_V1, [
		'version', 'manifest', 'schema.list', 'schema.get', 'setup', 'doctor',
		'completion', 'profile.list', 'profile.default',
		'profile.remove', 'plan.show', 'plan.apply', 'plan.recover', 'plan.discard',
		'task.find',
	]);
	assert.deepEqual(OPERON_CLI_RUNTIME_COMMANDS_V1, [
		'health', 'capabilities', 'diagnostics', 'catalog', 'entity.resolve',
		'task.get', 'tasks.query', 'tasks.finder', 'relationships.get', 'context.build',
		'timers.read', 'mutation.preview', 'mutation.apply',
	]);
	assert.deepEqual(OPERON_CLI_CONVENIENCE_COMMANDS_V1, [
		'task.create', 'task.update', 'task.complete', 'task.reopen', 'task.cancel',
		'task.pin', 'task.unpin', 'task.transition', 'task.delete',
		'task.convert', 'task.relocate', 'reminder.add', 'reminder.replace',
		'reminder.remove', 'timer.session.add', 'timer.session.update',
		'timer.session.remove', 'timer.start', 'timer.stop',
	]);
	for (const definition of OPERON_CLI_COMMAND_DEFINITIONS_V1) {
		if (definition.route === 'runtime') {
			assert.deepEqual(
				definition.contract,
				OPERON_CLI_RUNTIME_CONTRACTS_V1[definition.id],
				definition.id,
			);
		}
		if (definition.route === 'convenience') {
			const contract = OPERON_CLI_CONVENIENCE_CONTRACTS_V1[definition.id];
			assert.equal(definition.contract?.mutationKind, contract.mutationKind, definition.id);
			assert.equal(definition.contract?.targetPolicy, contract.targetPolicy, definition.id);
		}
		if (definition.id === 'plan.show') {
			assert.deepEqual(definition.contract, OPERON_CLI_LOCAL_CONTRACTS_V1['plan.show']);
		}
	}
	assert.equal(
		OPERON_CLI_COMMAND_DEFINITIONS_V1.some(
			definition => String(definition.id) === 'capture'
				|| String(definition.id).startsWith('capture-agent.'),
		),
		false,
	);
	assert.ok(
		OPERON_CLI_COMMAND_DEFINITIONS_V1
			.find(definition => definition.id === 'task.update')
			?.usage.includes(
				'operon task update (--id <operon-id>|--description <exact-description>) {key::"VALUE"|--clear <key>}... [--preview-only] [--json]',
			),
	);
	assert.deepEqual(completionCandidatesV1([]).slice(0, 6), [
		'capabilities',
		'catalog',
		'completion',
		'context',
		'diagnostics',
		'doctor',
	]);
	assert.deepEqual(completionCandidatesV1(['task', '']), [
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
	assert.deepEqual(completionCandidatesV1(['task', 'cr']), ['create']);
	assert.deepEqual(completionCandidatesV1(['task', 'create', '']), [
		'file',
		'inline',
	]);
	assert.deepEqual(completionCandidatesV1(['task', 'create', '--']), [
		'--help',
		'--input',
		'--input-format',
		'--json',
		'--preview-only',
		'--profile',
		'--vault',
	]);
	assert.deepEqual(
		completionCandidatesV1(['task', 'create', '--input-format', '']),
		['compact', 'compact-lines', 'json'],
	);
	assert.deepEqual(
		completionCandidatesV1(['task', 'create', '--input-format', 'j']),
		['json'],
	);
	assert.ok(completionCandidatesV1(['task', 'update', '--']).includes('--clear'));
	assert.ok(
		completionCandidatesV1(['task', 'update', '--clear', 'dateDue', '--'])
			.includes('--clear'),
	);
	assert.ok(
		!completionCandidatesV1(['task', 'update', '--id', 'abc1234', '--'])
			.includes('--id'),
	);
	assert.deepEqual(
		completionCandidatesV1(['task', 'complete', '--']),
		['--description', '--help', '--id', '--json', '--preview-only', '--profile', '--vault'],
	);
	assert.deepEqual(
		completionCandidatesV1(['task', 'pin', '--']),
		['--description', '--help', '--id', '--input', '--json', '--preview-only', '--profile', '--vault'],
	);
	assert.deepEqual(
		completionCandidatesV1(['reminder', 'replace', '--']),
		[
			'--current',
			'--description',
			'--help',
			'--id',
			'--input',
			'--json',
			'--preview-only',
			'--profile',
			'--vault',
		],
	);
	assert.deepEqual(completionCandidatesV1(['timer', '']), ['session', 'start', 'state', 'stop']);
	assert.deepEqual(
		completionCandidatesV1(['timer', 'session', '']),
		['add', 'remove', 'update'],
	);
	assert.deepEqual(
		completionCandidatesV1(['timer', 'session', 'update', '--']),
		[
			'--description',
			'--end',
			'--help',
			'--id',
			'--input',
			'--json',
			'--preview-only',
			'--profile',
			'--session',
			'--start',
			'--vault',
		],
	);
	assert.deepEqual(
		completionCandidatesV1(['catalog', '--consistency', '']),
		['best-effort', 'live-verified'],
	);
	assert.deepEqual(completionCandidatesV1(['completion', '']), ['zsh', 'bash', 'fish'].sort());
	assert.deepEqual(completionCandidatesV1(['completion', 'z']), ['zsh']);
	assert.ok(completionCandidatesV1([]).includes('help'));
	assert.ok(OPERON_CLI_COMMAND_DEFINITIONS_V1.every(definition => (
		!Object.keys(definition).some(key => ['taxonomy', 'priorities', 'pipelines', 'customKeys'].includes(key))
	)));
});

test('external shell completion is deterministic, registry-derived, and local-only', async context => {
	const scripts = {
		zsh: renderShellCompletionV1('zsh'),
		bash: renderShellCompletionV1('bash'),
		fish: renderShellCompletionV1('fish'),
	};
	for (const [shell, script] of Object.entries(scripts)) {
		assert.equal(script, renderShellCompletionV1(shell as 'zsh' | 'bash' | 'fish'));
		assert.match(script, /Generated from the installed command registry/u);
		assert.match(script, /task/u);
		assert.match(script, /task(?:\\ | )complete/u);
		assert.match(script, /reminder(?:\\ | )replace/u);
		assert.match(script, /timer(?:\\ | )session(?:\\ | )update/u);
		assert.match(script, shell === 'fish' ? /-l current/u : /--current/u);
		assert.match(script, shell === 'fish' ? /-l description/u : /--description/u);
		assert.match(script, shell === 'fish' ? /-l input/u : /--input/u);
		assert.match(script, shell === 'fish' ? /-l vault/u : /--vault/u);
		for (const supportedShell of ['zsh', 'bash', 'fish']) {
			assert.match(script, new RegExp(supportedShell, 'u'));
		}
		for (const forbidden of [
			'operonId',
			'receiptTargetDigest',
			'priorityRoles',
			'customKeys',
			'data.json',
		]) {
			assert.doesNotMatch(script, new RegExp(forbidden, 'u'), `${shell}:${forbidden}`);
		}
	}
	assert.match(scripts.zsh, /^#compdef operon/u);
	assert.match(scripts.zsh, /autoload -Uz compinit && compinit -i/u);
	assert.match(scripts.bash, /complete -F _operon_completion operon/u);
	assert.match(scripts.fish, /complete -c operon/u);
	if (!shellAvailableForTest('bash') || !shellAvailableForTest('zsh')) {
		context.skip('executable Bash and Zsh completion acceptance requires both shells');
		return;
	}

	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-completion-'));
	try {
		const bashScript = path.join(root, 'operon-completion.bash');
		const zshScript = path.join(root, '_operon');
		await writeFile(bashScript, scripts.bash, 'utf8');
		await writeFile(zshScript, scripts.zsh, 'utf8');
		await writeFile(path.join(root, 'input file.json'), '{}\n', 'utf8');

		const bashFirstPosition = spawnSync('bash', ['-c', [
			`source ${shellQuoteForTest(bashScript)}`,
			'COMP_WORDS=(operon completion "")',
			'COMP_CWORD=2',
			'_operon_completion',
			'printf "%s\\n" "${COMPREPLY[@]}"',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(bashFirstPosition.status, 0, bashFirstPosition.stderr);
		assert.deepEqual(bashFirstPosition.stdout.trim().split('\n').sort(), ['bash', 'fish', 'zsh']);

		const bashCreateRepresentation = spawnSync('bash', ['-c', [
			`source ${shellQuoteForTest(bashScript)}`,
			'COMP_WORDS=(operon task create "")',
			'COMP_CWORD=3',
			'_operon_completion',
			'printf "%s\\n" "${COMPREPLY[@]}"',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(bashCreateRepresentation.status, 0, bashCreateRepresentation.stderr);
		assert.deepEqual(
			bashCreateRepresentation.stdout.trim().split('\n').sort(),
			['file', 'inline'],
		);

		const bashCreateInputFormat = spawnSync('bash', ['-c', [
			`source ${shellQuoteForTest(bashScript)}`,
			'COMP_WORDS=(operon task create --input-format "")',
			'COMP_CWORD=4',
			'_operon_completion',
			'printf "%s\\n" "${COMPREPLY[@]}"',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(bashCreateInputFormat.status, 0, bashCreateInputFormat.stderr);
		assert.deepEqual(
			bashCreateInputFormat.stdout.trim().split('\n').sort(),
			['compact', 'compact-lines', 'json'],
		);

		const bashTimerSession = spawnSync('bash', ['-c', [
			`source ${shellQuoteForTest(bashScript)}`,
			'COMP_WORDS=(operon timer session "")',
			'COMP_CWORD=3',
			'_operon_completion',
			'printf "%s\\n" "${COMPREPLY[@]}"',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(bashTimerSession.status, 0, bashTimerSession.stderr);
		assert.deepEqual(
			bashTimerSession.stdout.trim().split('\n').sort(),
			['add', 'remove', 'update'],
		);

		const bashAfterValue = spawnSync('bash', ['-c', [
			`source ${shellQuoteForTest(bashScript)}`,
			'COMP_WORDS=(operon completion zsh "")',
			'COMP_CWORD=3',
			'_operon_completion',
			'printf "%s\\n" "${COMPREPLY[@]}"',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(bashAfterValue.status, 0, bashAfterValue.stderr);
		assert.doesNotMatch(bashAfterValue.stdout, /^(?:bash|fish|zsh)$/mu);

		const bashSpacedFile = spawnSync('bash', ['-c', [
			`source ${shellQuoteForTest(bashScript)}`,
			'COMP_WORDS=(operon query --input "in")',
			'COMP_CWORD=3',
			'_operon_completion',
			'printf "<%s>\\n" "${COMPREPLY[@]}"',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(bashSpacedFile.status, 0, bashSpacedFile.stderr);
		assert.equal(bashSpacedFile.stdout.trim(), '<input file.json>');

		const zshFirstPosition = spawnSync('zsh', ['-c', [
			`source ${shellQuoteForTest(zshScript)}`,
			'_describe() { print -rl -- "${candidates[@]}" }',
			'words=(operon completion "")',
			'CURRENT=3',
			'_operon_completion',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(zshFirstPosition.status, 0, zshFirstPosition.stderr);
		assert.deepEqual(zshFirstPosition.stdout.trim().split('\n').sort(), ['bash', 'fish', 'zsh']);

		const zshCreateRepresentation = spawnSync('zsh', ['-c', [
			`source ${shellQuoteForTest(zshScript)}`,
			'_describe() { print -rl -- "${candidates[@]}" }',
			'words=(operon task create "")',
			'CURRENT=4',
			'_operon_completion',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(zshCreateRepresentation.status, 0, zshCreateRepresentation.stderr);
		assert.deepEqual(
			zshCreateRepresentation.stdout.trim().split('\n').sort(),
			['file', 'inline'],
		);

		const zshCreateInputFormat = spawnSync('zsh', ['-c', [
			`source ${shellQuoteForTest(zshScript)}`,
			'_describe() { print -rl -- "${candidates[@]}" }',
			'words=(operon task create --input-format "")',
			'CURRENT=5',
			'_operon_completion',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(zshCreateInputFormat.status, 0, zshCreateInputFormat.stderr);
		assert.deepEqual(
			zshCreateInputFormat.stdout.trim().split('\n').sort(),
			['compact', 'compact-lines', 'json'],
		);

		const zshTimerSession = spawnSync('zsh', ['-c', [
			`source ${shellQuoteForTest(zshScript)}`,
			'_describe() { print -rl -- "${candidates[@]}" }',
			'words=(operon timer session "")',
			'CURRENT=4',
			'_operon_completion',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(zshTimerSession.status, 0, zshTimerSession.stderr);
		assert.deepEqual(
			zshTimerSession.stdout.trim().split('\n').sort(),
			['add', 'remove', 'update'],
		);

		const zshAfterValue = spawnSync('zsh', ['-c', [
			`source ${shellQuoteForTest(zshScript)}`,
			'_describe() { print -rl -- "${candidates[@]}" }',
			'words=(operon completion zsh "")',
			'CURRENT=4',
			'_operon_completion',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(zshAfterValue.status, 0, zshAfterValue.stderr);
		assert.doesNotMatch(zshAfterValue.stdout, /^(?:bash|fish|zsh)$/mu);

		const cleanZsh = spawnSync('zsh', ['-f', '-c', [
			`source ${shellQuoteForTest(zshScript)}`,
			'whence -w compdef',
			'whence -w _operon_completion',
		].join('\n')], { encoding: 'utf8', cwd: root });
		assert.equal(cleanZsh.status, 0, cleanZsh.stderr);
		assert.equal(cleanZsh.stderr, '');
		assert.match(cleanZsh.stdout, /compdef: function/u);
		assert.match(cleanZsh.stdout, /_operon_completion: function/u);

		const insecureZshFpath = path.join(root, 'insecure-zsh-fpath');
		await mkdir(insecureZshFpath);
		await chmod(insecureZshFpath, 0o777);
		const insecureFpathZsh = spawnSync('zsh', ['-f', '-c', [
			`fpath=(${shellQuoteForTest(insecureZshFpath)} $fpath)`,
			`source ${shellQuoteForTest(zshScript)}`,
			'whence -w compdef',
			'whence -w _operon_completion',
			'_describe() { print -rl -- "${candidates[@]}" }',
			'words=(operon completion "")',
			'CURRENT=3',
			'_operon_completion',
		].join('\n')], { encoding: 'utf8', cwd: root, timeout: 5_000 });
		assert.equal(insecureFpathZsh.error, undefined);
		assert.equal(insecureFpathZsh.status, 0, insecureFpathZsh.stderr);
		assert.equal(insecureFpathZsh.stderr, '');
		assert.match(insecureFpathZsh.stdout, /compdef: function/u);
		assert.match(insecureFpathZsh.stdout, /_operon_completion: function/u);
		for (const candidate of ['bash', 'fish', 'zsh']) {
			assert.match(insecureFpathZsh.stdout, new RegExp(`^${candidate}$`, 'mu'));
		}

		assert.match(scripts.fish, /__operon_at_command task/u);
		assert.match(scripts.fish, /__operon_at_command completion/u);
		const fishVersion = spawnSync('fish', ['--version'], { encoding: 'utf8' });
		if (fishVersion.status === 0) {
			const fishScript = path.join(root, 'operon-completion.fish');
			await writeFile(fishScript, scripts.fish, 'utf8');
			const fishSyntax = spawnSync('fish', ['-n', fishScript], { encoding: 'utf8' });
			assert.equal(fishSyntax.status, 0, fishSyntax.stderr);
			const completeFish = (line: string) => {
				const result = spawnSync('fish', ['-c', [
					`source ${shellQuoteForTest(fishScript)}`,
					`complete -C ${shellQuoteForTest(line)}`,
				].join('\n')], { encoding: 'utf8', cwd: root });
				assert.equal(result.status, 0, result.stderr);
				return result.stdout
					.trim()
					.split('\n')
					.filter(Boolean)
					.map(candidate => candidate.split('\t', 1)[0] ?? candidate);
			};
			assert.ok(completeFish('operon ').includes('task'));
			assert.ok(completeFish('operon task ').includes('create'));
			assert.deepEqual(
				completeFish('operon task create ')
					.filter(value => ['file', 'inline'].includes(value))
					.sort(),
				['file', 'inline'],
			);
			assert.deepEqual(
				completeFish('operon task create --input-format ')
					.filter(value => ['compact', 'compact-lines', 'json'].includes(value))
					.sort(),
				['compact', 'compact-lines', 'json'],
			);
			assert.deepEqual(
				completeFish('operon timer session ')
					.filter(value => ['add', 'remove', 'update'].includes(value))
					.sort(),
				['add', 'remove', 'update'],
			);
			assert.deepEqual(
				completeFish('operon completion ')
					.filter(value => ['bash', 'fish', 'zsh'].includes(value))
					.sort(),
				['bash', 'fish', 'zsh'],
			);
			assert.equal(
				completeFish('operon completion zsh ')
					.some(value => ['bash', 'fish', 'zsh'].includes(value)),
				false,
			);
			assert.ok(
				completeFish('operon query --input in')
					.some(value => value.includes('input file.json')),
			);
		}

		let processCalls = 0;
		const runProcess = async () => {
			processCalls += 1;
			throw new Error('COMPLETION_MUST_NOT_SPAWN');
		};
		for (const shell of ['zsh', 'bash', 'fish'] as const) {
			const outcome = await runPublicCommandLineV1(['completion', shell], {
				configRoot: path.join(root, 'missing-config'),
				runProcess,
			});
			assert.equal(outcome.exitCode, 0, shell);
			assert.equal(outcome.json, false, shell);
			assert.equal(outcome.human, scripts[shell], shell);
		}
		assert.equal(processCalls, 0);

		const missing = await runPublicCommandLineV1(['completion'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(missing.exitCode, 2);
		assert.match(missing.human, /Choose exactly one supported shell/u);

		const json = await runPublicCommandLineV1(['completion', 'zsh', '--json'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(json.exitCode, 2);
		assert.equal(json.json, true);
		assert.equal(processCalls, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function shellQuoteForTest(value: string): string {
	return `'${value.split("'").join("'\\''")}'`;
}

function shellAvailableForTest(shell: 'bash' | 'zsh'): boolean {
	const result = spawnSync(shell, ['--version'], { encoding: 'utf8' });
	return result.status === 0 && result.error === undefined;
}

test('help and unknown commands are resolved locally before vault or Runtime access', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-help-'));
	try {
		let processCalls = 0;
		const runProcess = async () => {
			processCalls += 1;
			throw new Error('HELP_MUST_NOT_SPAWN');
		};
		const rootHelp = await runPublicCommandLineV1([], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(rootHelp.exitCode, 0);
		assert.equal(rootHelp.json, false);
		assert.equal(rootHelp.human, [
			'Operon CLI',
			'',
			'Usage:',
			'  operon <command> [options]',
			'  operon help [command]',
			'',
			'Get started:',
			'  operon setup           Configure an Operon vault.',
			'  operon doctor --live   Verify the configured vault and live Runtime.',
			'  operon health          Check current Runtime health.',
			'  operon task --help     Explore task commands.',
			'',
			'Run "operon --help" to see all commands.',
			'',
		].join('\n'));

		const fullHelp = await runPublicCommandLineV1(['--help', '--json'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(fullHelp.exitCode, 0);
		assert.equal(fullHelp.json, false);
		assert.match(fullHelp.human, /System and setup:/u);
		assert.match(fullHelp.human, /Tasks, reminders, and timers:/u);

		for (const group of ['entity', 'mutation', 'plan', 'profile', 'reminder', 'schema', 'task', 'timer']) {
			const groupHelp = await runPublicCommandLineV1([group, '--help'], {
				configRoot: path.join(root, 'missing-config'),
				runProcess,
			});
			assert.equal(groupHelp.exitCode, 0, group);
			assert.match(groupHelp.human, new RegExp(`Operon ${group} commands`, 'u'));
		}
		const taskGroup = await runPublicCommandLineV1(['task'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(taskGroup.human, [
			'Operon task commands',
			'',
			'Usage:',
			'  operon task <command> [options]',
			'',
			'Commands:',
			'  find             Find and exactly verify one task through an interactive live-index picker.',
			'  get              Read one exact Operon task.',
			'  create           Create one task or preview a compact line batch.',
			'  update           Update an exact task through guided, compact, or typed input.',
			'  complete         Complete one exact task through a sealed semantic transition.',
			'  reopen           Reopen one exact terminal task in its first resolved non-terminal status.',
			'  cancel           Cancel one exact task through its pipeline cancellation status.',
			'  pin              Pin one exact task through compare-aware Operon state.',
			'  unpin            Unpin one exact task through compare-aware Operon state.',
			'  transition       Transition an exact task interactively or preview a typed status change.',
			'  delete           Select and preview exact task deletion interactively or from typed input.',
			'  convert          Convert an exact inline or File Task through a guided or typed preview.',
			'  relocate         Move an exact inline task to a live blank-line candidate.',
			'',
			'Run "operon task <command> --help" for command details.',
			'',
		].join('\n'));

		const leafHelp = await runPublicCommandLineV1([
			'task',
			'create',
			'--invalid-before-help',
			'--help',
		], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(leafHelp.exitCode, 0);
		assert.equal(leafHelp.human, [
			'Operon task create',
			'',
			'Create one task or preview a compact line batch.',
			'',
			'Usage:',
			'  operon task create [description] [--preview-only] [--vault <path>|--profile <alias>]',
			'  operon task create [inline|file] "Description" [key::"VALUE"...] [--preview-only] [--json]',
			'  operon task create --input-format compact --input <file|-> [--json]',
			'  operon task create --input-format compact-lines --input <file|-> [--json]',
			'  operon task create --input <file|-> [--vault <path>|--profile <alias>] [--json]',
			'',
			'Options:',
			'  --input <file|->     Read the typed request from a file or stdin.',
			'  --vault <path>       Use an explicit Obsidian vault.',
			'  --profile <alias>    Use a configured vault profile.',
			'  --json               Emit exactly one JSON result envelope.',
			'  --input-format <json|compact|compact-lines>  Parse typed JSON, one compact record, or 1-64 compact lines.',
			'  --preview-only        Keep the reviewed create plan without applying it.',
			'  description            Optional guided-mode task text.',
			'',
			'Examples:',
			'  operon task create',
			'  operon task create inline "CLI test task" status::"EXACT LIVE PIPELINE.STATUS"',
			'  operon task create "Follow up" dateDue::"2026-08-01" reminderRules::"dateDue.30m"',
			'  operon task create --input-format compact --input - --json',
			'  operon task create --input-format compact-lines --input - --json',
			'  operon task create --input intent.json --json',
			'',
			'Safety:',
			'  Human compact argv automatically applies one unchanged safe preview unless --preview-only is used. Agent compact and compact-lines stdin always preview only; compact-lines parses and compiles every record before one preview and never auto-applies multi-source plans. Apply the returned unchanged planRef separately. Temporal, compact-batch, and advanced typed create features require matching versioned advertisements in both the CLI manifest and live Runtime creation Catalog. Cross-source graph operations require the matching graph transaction gate, fresh confirmation, and same-plan recovery. Positional text may appear in shell history and process listings.',
			'',
			'Contract: task.create',
			'Mutation kind: task.create',
			'',
		].join('\n'));

		const taskUpdateHelp = await runPublicCommandLineV1(['task', 'update', '--help'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(taskUpdateHelp.exitCode, 0);
		assert.match(taskUpdateHelp.human, /estimate::"SECONDS"/u);
		assert.match(taskUpdateHelp.human, /estimate::"3600"/u);
		assert.doesNotMatch(taskUpdateHelp.human, /estimate::"MINUTES"/u);

		const completeHelp = await runPublicCommandLineV1(['task', 'complete', '--help'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(completeHelp.exitCode, 0);
		assert.match(
			completeHelp.human,
			/operon task complete .* \[--vault <path>\|--profile <alias>\] \[--json\]/u,
		);
		for (const action of ['pin', 'unpin']) {
			const pinnedHelp = await runPublicCommandLineV1(['task', action, '--help'], {
				configRoot: path.join(root, 'missing-config'),
				runProcess,
			});
			assert.equal(pinnedHelp.exitCode, 0);
			assert.match(
				pinnedHelp.human,
				new RegExp(`operon task ${action} \\(--id <operon-id>\\|--description <exact-description>\\)`, 'u'),
			);
			assert.match(
				pinnedHelp.human,
				new RegExp(`operon task ${action} --input <file\\|->`, 'u'),
			);
			assert.match(
				pinnedHelp.human,
				/Direct human selector argv automatically applies one warning-free unchanged plan/u,
			);
			assert.match(
				pinnedHelp.human,
				/Typed --input only previews and returns a planRef for separate apply/u,
			);
		}
		const reminderHelp = await runPublicCommandLineV1(['reminder', 'replace', '--help'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(reminderHelp.exitCode, 0);
		assert.match(
			reminderHelp.human,
			/operon reminder replace .* \[--vault <path>\|--profile <alias>\] \[--json\]/u,
		);

		const typo = await runPublicCommandLineV1(['task', 'udpate'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(typo.exitCode, 2);
		assert.match(typo.human, /Did you mean "task update"\?/u);

		const unknown = await runPublicCommandLineV1(['frobnicate', '--json'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(unknown.exitCode, 2);
		assert.equal(unknown.json, true);
		assert.equal(unknown.envelope.kind, 'operon-cli-local-result');
		assert.equal(unknown.envelope.command, 'unknown');
		assert.equal(unknown.envelope.ok, false);
		if (unknown.envelope.kind === 'operon-cli-local-result' && !unknown.envelope.ok) {
			assert.equal(unknown.envelope.error?.code, 'invalid-request');
			assert.equal(
				(unknown.envelope.error?.details as { reasonCode?: string } | undefined)?.reasonCode,
				'unknown-command',
			);
		}

		const nestedUnknownHelp = await runPublicCommandLineV1(['task', 'frob', '--help'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(nestedUnknownHelp.exitCode, 2);
		assert.doesNotMatch(nestedUnknownHelp.human, /System and setup:/u);
		const nestedUnknownJsonHelp = await runPublicCommandLineV1([
			'task',
			'frob',
			'--help',
			'--json',
		], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(nestedUnknownJsonHelp.exitCode, 2);
		assert.equal(nestedUnknownJsonHelp.json, true);
		assert.equal(nestedUnknownJsonHelp.envelope.command, 'unknown');
		const unknownJsonHelp = await runPublicCommandLineV1([
			'help',
			'frobnicate',
			'--json',
		], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(unknownJsonHelp.exitCode, 2);
		assert.equal(unknownJsonHelp.json, true);
		assert.equal(unknownJsonHelp.envelope.command, 'unknown');
		const helpLeafHelp = await runPublicCommandLineV1(['help', '--help'], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(helpLeafHelp.exitCode, 0);
		assert.match(helpLeafHelp.human, /Operon help/u);
		const spoofed = await runPublicCommandLineV1(['task', `ud\u2028pate\u206a`], {
			configRoot: path.join(root, 'missing-config'),
			runProcess,
		});
		assert.equal(spoofed.exitCode, 2);
		assert.doesNotMatch(spoofed.human, /[\u2028\u206a]/u);
		assert.equal(sanitizeTerminalTextV1('left\u2029right\u206a'), 'leftright');
		assert.equal(processCalls, 0);
		assert.equal((await readdir(root)).length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('benchmark-only CLI subspans use a sibling trace without changing public output', {
	skip: process.platform !== 'darwin',
}, async () => {
	// Benchmark telemetry is deliberately restricted to the private macOS benchmark root.
	const root = await mkdtemp('/private/tmp/operon-cli-speed-unit-');
	const previousTracePath = process.env.OPERON_CLI_BENCHMARK_TRACE_PATH;
	const previousSubspans = process.env.OPERON_CLI_BENCHMARK_SUBSPANS;
	const previousBenchmarkRequestId = process.env.OPERON_CLI_BENCHMARK_REQUEST_ID;
	try {
		delete process.env.OPERON_CLI_BENCHMARK_TRACE_PATH;
		const baseline = await runPublicCommandLineV1(['help', '--json']);
		process.env.OPERON_CLI_BENCHMARK_TRACE_PATH = path.join(root, 'runtime-dispatches.jsonl');
		process.env.OPERON_CLI_BENCHMARK_SUBSPANS = '1';
		process.env.OPERON_CLI_BENCHMARK_REQUEST_ID = 'benchmark-unit-request';
		const outcome = await runPublicCommandLineV1(['help', '--json']);
		assert.deepEqual(outcome, baseline);
		const records = (await readFile(path.join(root, 'cli-subspans.jsonl'), 'utf8'))
			.trim()
			.split('\n')
			.map(line => JSON.parse(line) as Record<string, unknown>);
		assert.equal(records.length, 1);
		assert.equal(records[0].kind, 'cli-subspan');
		assert.equal(records[0].span, 'command-resolution');
		assert.deepEqual(records[0].command, ['help', '--json']);
		assert.equal(records[0].requestId, 'benchmark-unit-request');
		assert.equal(typeof records[0].durationMs, 'number');
	} finally {
		if (previousTracePath === undefined) {
			delete process.env.OPERON_CLI_BENCHMARK_TRACE_PATH;
		} else {
			process.env.OPERON_CLI_BENCHMARK_TRACE_PATH = previousTracePath;
		}
		if (previousSubspans === undefined) {
			delete process.env.OPERON_CLI_BENCHMARK_SUBSPANS;
		} else {
			process.env.OPERON_CLI_BENCHMARK_SUBSPANS = previousSubspans;
		}
		if (previousBenchmarkRequestId === undefined) {
			delete process.env.OPERON_CLI_BENCHMARK_REQUEST_ID;
		} else {
			process.env.OPERON_CLI_BENCHMARK_REQUEST_ID = previousBenchmarkRequestId;
		}
		await rm(root, { recursive: true, force: true });
	}
});

test('local usage failures include leaf-specific usage without dumping root help', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-leaf-usage-'));
	try {
		const missingPlan = await runPublicCommandLineV1(['plan', 'show'], {
			configRoot: root,
		});
		assert.equal(missingPlan.exitCode, 2);
		assert.match(missingPlan.human, /Specify exactly one stored Operon plan reference/u);
		assert.match(missingPlan.human, /Usage: operon plan show <plan-ref>/u);
		assert.doesNotMatch(missingPlan.human, /System and setup:/u);

		const missingInput = await runPublicCommandLineV1(['task', 'create'], {
			configRoot: root,
		});
		assert.equal(missingInput.exitCode, 2);
		assert.match(missingInput.human, /requires an interactive terminal/u);
		assert.match(missingInput.human, /Usage: operon task create \[description\]/u);
		const positionalJson = await runPublicCommandLineV1([
			'task',
			'create',
			'Sensitive task text',
			'--json',
		], { configRoot: root });
		assert.equal(positionalJson.exitCode, 2);
		assert.equal(positionalJson.json, true);
		assert.doesNotMatch(positionalJson.human, /Sensitive task text/u);

		const conflictingCreateArgv = await compactGoldenArgv('compact-positional-input-conflict');
		const conflictingCreateInput = await runPublicCommandLineV1(conflictingCreateArgv, {
			configRoot: root,
			input: Buffer.from(JSON.stringify({
				contractVersion: 1,
				kind: 'mutation-intent',
				spec: {
					operation: 'create',
					items: [{
						itemRef: 'task-1',
						description: 'Typed task',
						target: { mode: 'configured-default' },
						fields: [],
					}],
				},
			})),
		});
		assert.equal(conflictingCreateInput.exitCode, 2);
		assert.match(conflictingCreateInput.human, /Do not combine compact argv with --input/u);
		assert.doesNotMatch(conflictingCreateInput.human, /Test task/u);
		const inputFormatWithoutInput = await runPublicCommandLineV1([
			...await compactGoldenArgv('input-format-requires-input'),
			'--json',
		], { configRoot: root });
		assert.equal(inputFormatWithoutInput.exitCode, 2);
		assert.equal(
			inputFormatWithoutInput.envelope.kind === 'operon-cli-local-result'
				? inputFormatWithoutInput.envelope.error?.code
				: undefined,
			'invalid-request',
		);
		assert.equal(
			inputFormatWithoutInput.envelope.kind === 'operon-cli-local-result'
				? (inputFormatWithoutInput.envelope.error?.details as {
					reasonCode?: string;
				} | undefined)?.reasonCode
				: undefined,
			'input-format-requires-input',
		);
		const unsupportedInputFormat = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'yaml',
			'--input',
			'-',
			'--json',
		], {
			configRoot: root,
			input: Buffer.from('{}'),
		});
		assert.equal(unsupportedInputFormat.exitCode, 2);
		assert.equal(
			unsupportedInputFormat.envelope.kind === 'operon-cli-local-result'
				? unsupportedInputFormat.envelope.error?.code
				: undefined,
			'invalid-request',
		);
		assert.equal(
			unsupportedInputFormat.envelope.kind === 'operon-cli-local-result'
				? (unsupportedInputFormat.envelope.error?.details as {
					reasonCode?: string;
				} | undefined)?.reasonCode
				: undefined,
			'input-format-unsupported',
		);
		const previewOnlyJson = await runPublicCommandLineV1([
			'task',
			'create',
			'--preview-only',
			'--json',
		], { configRoot: root });
		assert.equal(previewOnlyJson.exitCode, 2);
		assert.match(previewOnlyJson.human, /available only in guided TTY mode/u);
		const previewOnlyInput = await runPublicCommandLineV1([
			'task',
			'create',
			'--preview-only',
			'--input',
			'-',
		], {
			configRoot: root,
			input: Buffer.from('{}'),
		});
		assert.equal(previewOnlyInput.exitCode, 2);
		assert.match(previewOnlyInput.human, /cannot be combined with --input or --json/u);

		const vault = await createVault(root, 'Runtime Usage Vault');
		const runtimeMissingInput = await runPublicCommandLineV1([
			'query',
			'--vault',
			vault,
		], { configRoot: path.join(root, 'config') });
		assert.equal(runtimeMissingInput.exitCode, 2);
		assert.match(runtimeMissingInput.human, /requires typed JSON through --input/u);
		assert.match(runtimeMissingInput.human, /Usage: operon query --input/u);

		let processCalls = 0;
		const unexpectedPositional = await runPublicCommandLineV1([
			'task',
			'delete',
			'accidental',
			'--vault',
			vault,
			'--input',
			'-',
		], {
			configRoot: path.join(root, 'config'),
			input: Buffer.from('{}'),
			runProcess: async () => {
				processCalls += 1;
				throw new Error('MUST_NOT_RUN');
			},
		});
		assert.equal(unexpectedPositional.exitCode, 2);
		assert.match(
			unexpectedPositional.human,
			/Usage: operon task delete \[--vault <path>\|--profile <alias>\]/u,
		);
		assert.equal(processCalls, 0);

		const blockedConfigRoot = path.join(root, 'blocked-config');
		await mkdir(blockedConfigRoot, { recursive: true });
		const blockedConfigPath = path.join(blockedConfigRoot, 'config-v1.json');
		await writeFile(blockedConfigPath, '{not-json\n', { mode: 0o600 });
		secureCreatedFileV1(blockedConfigPath);
		const internal = await runPublicCommandLineV1(['profile', 'list'], {
			configRoot: blockedConfigRoot,
		});
		assert.equal(internal.exitCode, 70);

		const missingFlagValue = await runPublicCommandLineV1([
			'health',
			'--vault',
			vault,
			'--timeout-ms',
		], {
			configRoot: path.join(root, 'config'),
		});
		assert.equal(missingFlagValue.exitCode, 2);
		assert.match(missingFlagValue.human, /Usage: operon health/u);

		const invalidConsistency = await runPublicCommandLineV1([
			'health',
			'--vault',
			vault,
			'--consistency',
			'stale',
		], {
			configRoot: path.join(root, 'config'),
		});
		assert.equal(invalidConsistency.exitCode, 2);

		const missingProfileChoice = await runPublicCommandLineV1(['health'], {
			configRoot: path.join(root, 'empty-config'),
		});
		assert.equal(missingProfileChoice.exitCode, 3);
		assert.equal(missingProfileChoice.envelope.ok, false);

		const missingVault = path.join(root, 'missing-vault');
		const missingDoctorVault = await runPublicCommandLineV1([
			'doctor',
			'--vault',
			missingVault,
		], {
			configRoot: path.join(root, 'config'),
		});
		assert.equal(missingDoctorVault.exitCode, 2);
		assert.match(missingDoctorVault.human, /vault path is unavailable/u);

		const missingSetupVault = await runPublicCommandLineV1([
			'setup',
			'--vault',
			missingVault,
			'--name',
			'missing',
		], {
			configRoot: path.join(root, 'config'),
		});
		assert.equal(missingSetupVault.exitCode, 2);
		assert.match(missingSetupVault.human, /vault path is unavailable/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('profile setup is portable, owner-only and follows explicit precedence', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-profile-'));
	try {
		const vaultA = await createVault(root, 'Vault A');
		const vaultB = await createVault(root, 'Vault B');
		let config = loadOperonCliConfigV1(path.join(root, 'config'));
		config = upsertVaultProfileV1(config, { name: 'a', vaultPath: vaultA, makeDefault: true });
		config = upsertVaultProfileV1(config, { name: 'b', vaultPath: vaultB });
		saveOperonCliConfigV1(config, path.join(root, 'config'));
		assert.equal(resolveVaultV1(config, { explicitProfile: 'b' }).canonicalPath, vaultB);
		assert.equal(resolveVaultV1(config, { explicitVault: vaultA, explicitProfile: 'b' }).canonicalPath, vaultA);
		assert.equal(resolveVaultV1(config, { cwd: path.join(vaultB, 'Notes') }).profile, 'b');
		assert.equal(resolveVaultV1(config, {}).profile, 'a');
		const duplicateParentA = path.join(root, 'duplicate-a');
		const duplicateParentB = path.join(root, 'duplicate-b');
		const duplicateA = await createVault(duplicateParentA, 'Shared Vault');
		const duplicateB = await createVault(duplicateParentB, 'Shared Vault');
		const withDuplicateName = upsertVaultProfileV1(
			{ version: 1, profiles: [] },
			{ name: 'duplicate-a', vaultPath: duplicateA },
		);
		assert.throws(
			() => upsertVaultProfileV1(
				withDuplicateName,
				{ name: 'duplicate-b', vaultPath: duplicateB },
			),
			/VAULT_NAME_AMBIGUOUS/u,
		);
		config = setDefaultVaultProfileV1(config, 'b');
		assert.equal(resolveVaultV1(config, {}).profile, 'b');
		config = removeVaultProfileV1(config, 'b');
		assert.equal(config.profiles.length, 1);
		if (process.platform !== 'win32') {
			const mode = (await stat(path.join(root, 'config', 'config-v1.json'))).mode & 0o777;
			assert.equal(mode, 0o600);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('guided setup discovers the current vault and saves the first default profile', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-guided-setup-'));
	try {
		const vault = await createVault(root, 'İş Vault');
		const nested = path.join(vault, 'Projects', 'Nested');
		await mkdir(nested, { recursive: true });
		assert.equal(discoverOperonVaultFromCwdV1(nested), vault);
		assert.equal(deriveProfileAliasV1('İş Vault'), 'is-vault');
		const answers = ['', 'n'];
		let output = '';
		let processCalls = 0;
		const configRoot = path.join(root, 'config');
		const result = await runPublicCommandLineV1(['setup'], {
			configRoot,
			cwd: nested,
			interactive: {
				ask(prompt: string): Promise<string | null> {
					output += prompt;
					return Promise.resolve(answers.shift() ?? null);
				},
				write(value: string): void {
					output += value;
				},
			},
			runProcess: async () => {
				processCalls += 1;
				throw new Error('SETUP_SKIP_LIVE_MUST_NOT_RUN');
			},
		});
		assert.equal(result.exitCode, 0);
		assert.match(result.human, /Profile saved as default/u);
		assert.match(result.human, /Live Runtime verification skipped/u);
		assert.match(output, /Found an Operon vault in the current workspace/u);
		assert.equal(processCalls, 0);
		const config = loadOperonCliConfigV1(configRoot);
		assert.equal(config.defaultProfile, 'is-vault');
		assert.equal(config.profiles[0].canonicalPath, vault);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('guided setup preserves local profile when optional live verification fails', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-guided-setup-live-'));
	try {
		const vault = await createVault(root, 'Live Check Vault');
		const answers = ['', ''];
		const configRoot = path.join(root, 'config');
		const result = await runPublicCommandLineV1(['setup'], {
			configRoot,
			cwd: vault,
			requestRoot: path.join(root, 'requests'),
			interactive: {
				ask(): Promise<string | null> {
					return Promise.resolve(answers.shift() ?? null);
				},
				write(): void {},
			},
			runProcess: async () => ({
				exitCode: 1,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.from('synthetic transport failure'),
				totalMs: 1,
				timedOut: false,
				overflow: false,
			}),
		});
		assert.notEqual(result.exitCode, 0);
		assert.match(result.human, /Local setup saved; live verification incomplete/u);
		assert.match(result.human, /operon doctor --live/u);
		const config = loadOperonCliConfigV1(configRoot);
		assert.equal(config.defaultProfile, 'live-check-vault');
		assert.equal(config.profiles[0].canonicalPath, vault);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('explicit setup preserves local profile when optional live verification fails', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-explicit-setup-live-'));
	try {
		const vault = await createVault(root, 'Explicit Live Check Vault');
		const configRoot = path.join(root, 'config');
		const result = await runPublicCommandLineV1([
			'setup',
			'--vault',
			vault,
			'--name',
			'explicit-live',
			'--live',
		], {
			configRoot,
			requestRoot: path.join(root, 'requests'),
			runProcess: async () => ({
				exitCode: 1,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.from('synthetic transport failure'),
				totalMs: 1,
				timedOut: false,
				overflow: false,
			}),
		});
		assert.notEqual(result.exitCode, 0);
		assert.match(result.human, /Local setup saved; live verification incomplete/u);
		assert.match(result.human, /operon doctor --live/u);
		const config = loadOperonCliConfigV1(configRoot);
		assert.equal(config.profiles[0].name, 'explicit-live');
		assert.equal(config.profiles[0].canonicalPath, vault);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('setup discovers a custom Obsidian configuration directory by the exact Operon manifest', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-custom-config-dir-'));
	try {
		const vault = path.join(root, 'Custom Config Vault');
		await mkdir(path.join(vault, '.custom-obsidian', 'plugins', 'operon'), { recursive: true });
		await writeFile(
			path.join(vault, '.custom-obsidian', 'plugins', 'operon', 'manifest.json'),
			JSON.stringify({ id: 'operon', version: '2.6.0', minAppVersion: '1.8.9' }),
		);
		const canonicalVaultPath = canonicalVaultIdentityV1(vault).canonicalPath;
		assert.equal(discoverOperonVaultFromCwdV1(vault), canonicalVaultPath);
		const answers = ['', 'n'];
		const result = await runPublicCommandLineV1(['setup'], {
			configRoot: path.join(root, 'config'),
			cwd: vault,
			interactive: {
				ask(): Promise<string | null> {
					return Promise.resolve(answers.shift() ?? null);
				},
				write(): void {},
			},
		});
		assert.equal(result.exitCode, 0);
		const config = loadOperonCliConfigV1(path.join(root, 'config'));
		assert.equal(config.profiles.length, 1);
		assert.equal(config.profiles[0].canonicalPath, canonicalVaultPath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Operon config discovery rejects ambiguity and intermediate symlink escapes', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-config-discovery-safety-'));
	try {
		const ambiguousVault = await createVault(root, 'Ambiguous Config Vault');
		await mkdir(path.join(ambiguousVault, '.second-config', 'plugins', 'operon'), { recursive: true });
		await writeFile(
			path.join(ambiguousVault, '.second-config', 'plugins', 'operon', 'manifest.json'),
			JSON.stringify({ id: 'operon', version: '2.6.0', minAppVersion: '1.8.9' }),
		);
		assert.equal(discoverOperonVaultFromCwdV1(ambiguousVault), null);
		assert.throws(
			() => validateOperonManifestV1(ambiguousVault),
			/OPERON_CONFIG_DIRECTORY_AMBIGUOUS/u,
		);

		const escapedVault = path.join(root, 'Escaped Config Vault');
		const externalPlugins = path.join(root, 'external-plugins');
		await mkdir(path.join(escapedVault, '.custom-config'), { recursive: true });
		await mkdir(path.join(externalPlugins, 'operon'), { recursive: true });
		await writeFile(
			path.join(externalPlugins, 'operon', 'manifest.json'),
			JSON.stringify({ id: 'operon', version: '2.6.0', minAppVersion: '1.8.9' }),
		);
		await symlink(externalPlugins, path.join(escapedVault, '.custom-config', 'plugins'));
		assert.equal(discoverOperonVaultFromCwdV1(escapedVault), null);
		assert.throws(
			() => validateOperonManifestV1(escapedVault),
			/OPERON_PLUGIN_NOT_FOUND/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('profile resolution canonicalizes symlinks and fails closed for moved or corrupt vault state', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-profile-safety-'));
	try {
		const vault = await createVault(root, 'Canonical Vault');
		const alias = path.join(root, 'Vault Alias');
		await symlink(vault, alias);
		let config = upsertVaultProfileV1(
			{ version: 1, profiles: [] },
			{ name: 'canonical', vaultPath: alias },
		);
		assert.equal(config.profiles[0].canonicalPath, vault);
		const configRoot = path.join(root, 'config');
		saveOperonCliConfigV1(config, configRoot);
		await rm(vault, { recursive: true, force: true });
		assert.throws(() => resolveVaultV1(config, { explicitProfile: 'canonical' }), /VAULT_PROFILE_MOVED/u);
		await writeFile(path.join(configRoot, 'config-v1.json'), '{"version":1,"profiles":"invalid"}\n', { mode: 0o600 });
		await chmod(path.join(configRoot, 'config-v1.json'), 0o600);
		assert.throws(() => loadOperonCliConfigV1(configRoot), /CONFIG_MALFORMED/u);
		config = { version: 1, profiles: [] };
		await writeFile(path.join(configRoot, 'config-v1.json'), `${JSON.stringify(config)}\n`, { mode: 0o644 });
		if (process.platform !== 'win32') {
			await chmod(path.join(configRoot, 'config-v1.json'), 0o644);
			assert.throws(() => loadOperonCliConfigV1(configRoot), /CONFIG_FILE_WRONG_MODE/u);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('command-scope targets fail closed on profile and vault inode drift', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-command-scope-'));
	try {
		const vault = await createVault(root, 'Scoped Vault');
		const configRoot = path.join(root, 'config');
		const configured = upsertVaultProfileV1(
			loadOperonCliConfigV1(configRoot),
			{ name: 'scoped', vaultPath: vault, makeDefault: true },
		);
		saveOperonCliConfigV1(configured, configRoot);
		const profileScope = createResolvedVaultCommandScopeV1(
			{ explicitProfile: 'scoped' },
			configRoot,
		);
		assert.doesNotThrow(() => assertResolvedVaultCommandScopeV1(profileScope));

		saveOperonCliConfigV1({ ...configured, defaultProfile: 'scoped' }, configRoot);
		assert.throws(
			() => assertResolvedVaultCommandScopeV1(profileScope),
			/CONFIG_TARGET_CHANGED/u,
		);

		const explicitScope = createResolvedVaultCommandScopeV1(
			{ explicitVault: vault },
			configRoot,
		);
		const displaced = `${vault}-old`;
		await rename(vault, displaced);
		await mkdir(vault);
		assert.throws(
			() => assertResolvedVaultCommandScopeV1(explicitScope),
			/VAULT_TARGET_CHANGED/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('production diagnostics invocation matches the shared strict V1 decoder', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-diagnostics-'));
	const previousConfigHome = process.env.OPERON_CONFIG_HOME;
	try {
		const vault = await createVault(root, 'Diagnostics Vault');
		process.env.OPERON_CONFIG_HOME = path.join(root, 'config');
		const built = await buildInvocationV1({
			command: 'diagnostics',
			vaultPath: vault,
			json: true,
			consistency: 'live-verified',
			readinessTimeoutMs: 15_000,
			obsidianBin: 'obsidian',
		});
		const decoded = decodeCliInvocationV1(built.invocation);
		assert.equal(decoded.ok, true, decoded.ok ? undefined : JSON.stringify(decoded.issues));
		assert.equal(validateCliInvocationForTransportV1(built.invocation).ok, true);
		assert.equal(built.invocation.request, undefined);
	} finally {
		if (previousConfigHome === undefined) delete process.env.OPERON_CONFIG_HOME;
		else process.env.OPERON_CONFIG_HOME = previousConfigHome;
		await rm(root, { recursive: true, force: true });
	}
});

test('legacy client identity migrates once and missing initialized identity fails closed', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-identity-'));
	try {
		const legacy = path.join(root, 'legacy', 'client-v1.json');
		const current = path.join(root, 'current', 'client-v1.json');
		await mkdir(path.dirname(legacy), { recursive: true, mode: 0o700 });
		const clientInstanceId = `operon-cli-${randomUUID()}`;
		await writeFile(legacy, `${JSON.stringify({ version: 1, clientInstanceId })}\n`, { mode: 0o600 });
		await chmod(legacy, 0o600);
		secureCreatedFileV1(legacy);
		assert.equal(getOrCreateOperonCliClientIdV1(current, legacy), clientInstanceId);
		assert.equal(JSON.parse(await readFile(current, 'utf8')).clientInstanceId, clientInstanceId);
		await rm(current);
		assert.throws(
			() => getOrCreateOperonCliClientIdV1(current, legacy),
			/CLIENT_IDENTITY_MISSING/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('plan store uses opaque references and target-bound destructive confirmation', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-plan-'));
	try {
		const vault = await createVault(root, 'Plan Vault');
		const now = Date.now();
		const plan = fakePlan(
			new Date(now - 1_000).toISOString(),
			new Date(now + 60_000).toISOString(),
			'phase9-idempotency-key',
		);
		const previewRequest: MutationPreviewRequestV1 = {
			contractVersion: 1,
			requestId: randomUUID(),
			kind: 'mutation-preview',
			clientInstanceId: plan.clientInstanceId,
			idempotencyKey: 'phase9-idempotency-key',
			capability: 'tasks.delete.preview',
			mutationKind: 'task.delete',
			target: {
				operonId: 'abc1234',
				locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
			},
			spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
			authorization: { basis: 'user-explicit-request' },
		};
		const stored = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: previewRequest,
			plan,
		}, root);
		assert.match(stored.planRef, /^[A-Za-z0-9][A-Za-z0-9_-]{31}$/u);
		assert.ok(!stored.planRef.includes('/'));
		assert.throws(() => buildMutationApplyRequestV1(stored, {}), /PLAN_CONFIRMATION_REQUIRED/u);
		const apply = buildMutationApplyRequestV1(stored, {
			confirmationToken: confirmationTokenForPlanV1(plan),
		});
		const decodedApply = decodeMutationApplyRequestV1(apply);
		assert.equal(decodedApply.ok, true, decodedApply.ok ? undefined : JSON.stringify(decodedApply.issues));
		assert.equal(apply.authorization.basis, 'user-explicit-confirmation');
		assert.deepEqual(
			apply.acknowledgements.map(item => item.code),
			plan.requiredAcknowledgements,
		);
		assert.equal(apply.acknowledgements[0].targetDigest, plan.targets[0].targetDigest);
		assert.equal(readMutationPlanV1(stored.planRef, root).plan.planHash, plan.planHash);
		if (process.platform !== 'win32') {
			const mode = (await stat(path.join(root, 'plans', `${stored.planRef}.json`))).mode & 0o777;
			assert.equal(mode, 0o600);
		}
		assert.equal(discardMutationPlanV1(stored.planRef, root), true);
		assert.equal(discardMutationPlanV1(stored.planRef, root), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('plan show exposes a strict public summary without local routing or idempotency secrets', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-plan-show-'));
	try {
		const vault = await createVault(root, 'Plan Show Vault');
		const plan = fakePlan(
			new Date(Date.now() - 1_000).toISOString(),
			new Date(Date.now() + 60_000).toISOString(),
			'phase9-plan-show-secret',
		);
		const stored = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: {
				contractVersion: 1,
				requestId: randomUUID(),
				kind: 'mutation-preview',
				clientInstanceId: plan.clientInstanceId,
				idempotencyKey: 'phase9-plan-show-secret',
				capability: 'tasks.delete.preview',
				mutationKind: 'task.delete',
				target: {
					operonId: 'abc1234',
					locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
				},
				spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
				authorization: { basis: 'user-explicit-request' },
			},
			plan,
		}, root);
		const shown = await runPublicCommandLineV1([
			'plan',
			'show',
			stored.planRef,
			'--json',
		], { configRoot: root });
		assert.equal(shown.exitCode, 0);
		assert.equal(shown.envelope.kind, 'operon-cli-local-result');
		const encoded = JSON.stringify(shown.envelope);
		assert.match(encoded, new RegExp(confirmationTokenForPlanV1(plan), 'u'));
		assert.doesNotMatch(encoded, new RegExp(plan.receiptTargetDigest, 'u'));
		assert.doesNotMatch(encoded, /phase9-plan-show-secret/u);
		assert.doesNotMatch(encoded, new RegExp(escapeRegExp(vault), 'u'));
		assert.doesNotMatch(encoded, /clientInstanceId|idempotencyKey|applyRequest|vaultPath/u);
		assert.equal(shown.envelope.kind, 'operon-cli-local-result');
		if (shown.envelope.kind === 'operon-cli-local-result' && shown.envelope.ok) {
			const validation = await validatePublishedPlanShowResult(shown.envelope.result);
			assert.equal(validation.valid, true, JSON.stringify(validation.errors));
		}
		const humanShown = await runPublicCommandLineV1([
			'plan',
			'show',
			stored.planRef,
		], { configRoot: root });
		assert.equal(humanShown.exitCode, 0);
		assert.match(humanShown.human, /Operon mutation plan/u);
		assert.match(humanShown.human, /Mutation: task\.delete/u);
		assert.match(humanShown.human, /Risk: destructive/u);
		assert.match(humanShown.human, new RegExp(`Plan reference: ${stored.planRef}`, 'u'));
		assert.doesNotMatch(humanShown.human, new RegExp(plan.receiptTargetDigest, 'u'));
		assert.doesNotMatch(humanShown.human, /phase9-plan-show-secret|planHash|idempotencyKey|clientInstanceId/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('public mutation apply requires a stored plan reference and plan apply rechecks vault identity', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-public-apply-'));
	try {
		const raw = await runPublicCommandLineV1([
			'mutation',
			'apply',
			'--input',
			'-',
			'--json',
		], { configRoot: root, input: Buffer.from('{}') });
		assert.equal(raw.exitCode, 2);
		assert.equal(raw.envelope.kind, 'operon-cli-local-result');
		assert.equal(raw.envelope.ok, false);
		assert.equal(
			raw.envelope.kind === 'operon-cli-local-result' ? raw.envelope.error?.code : undefined,
			'invalid-request',
		);
		assert.equal(
			raw.envelope.kind === 'operon-cli-local-result'
				? (raw.envelope.error?.details as { reasonCode?: string } | undefined)?.reasonCode
				: undefined,
			'raw-mutation-apply-disabled',
		);

		const vault = await createVault(root, 'Original Vault');
		const plan = fakePlan(
			new Date(Date.now() - 1_000).toISOString(),
			new Date(Date.now() + 60_000).toISOString(),
			'identity-mismatch',
		);
		const stored = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: 'f'.repeat(64),
			request: {
				contractVersion: 1,
				requestId: randomUUID(),
				kind: 'mutation-preview',
				clientInstanceId: plan.clientInstanceId,
				idempotencyKey: 'identity-mismatch',
				capability: 'tasks.delete.preview',
				mutationKind: 'task.delete',
				target: {
					operonId: 'abc1234',
					locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
				},
				spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
				authorization: { basis: 'user-explicit-request' },
			},
			plan,
		}, root);
		const mismatch = await runPublicCommandLineV1([
			'plan',
			'apply',
			stored.planRef,
			'--confirm',
			confirmationTokenForPlanV1(plan),
			'--json',
		], { configRoot: root });
		assert.equal(mismatch.exitCode, 4);
		assert.equal(mismatch.envelope.kind, 'operon-cli-local-result');
		assert.equal(mismatch.envelope.ok, false);
		assert.equal(
			mismatch.envelope.kind === 'operon-cli-local-result' ? mismatch.envelope.error?.code : undefined,
			'vault-mismatch',
		);
		assert.equal(
			mismatch.envelope.kind === 'operon-cli-local-result'
				? (mismatch.envelope.error?.details as { reasonCode?: string } | undefined)?.reasonCode
				: undefined,
			'plan-vault-mismatch',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('a transport-interrupted plan apply is recovery-only and cannot be discarded', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-plan-recovery-'));
	try {
		const vault = await createVault(root, 'Recovery Vault');
		const plan = fakePlan(
			new Date(Date.now() - 1_000).toISOString(),
			new Date(Date.now() + 60_000).toISOString(),
			'transport-interrupted-delete',
		);
		await writeFile(
			path.join(root, 'client-v1.json'),
			`${JSON.stringify({ version: 1, clientInstanceId: plan.clientInstanceId })}\n`,
			{ mode: 0o600 },
		);
		secureCreatedFileV1(path.join(root, 'client-v1.json'));
		const stored = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: {
				contractVersion: 1,
				requestId: randomUUID(),
				kind: 'mutation-preview',
				clientInstanceId: plan.clientInstanceId,
				idempotencyKey: 'transport-interrupted-delete',
				capability: 'tasks.delete.preview',
				mutationKind: 'task.delete',
				target: {
					operonId: 'abc1234',
					locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
				},
				spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
				authorization: { basis: 'user-explicit-request' },
			},
			plan,
		}, root);
		const requestRoot = path.join(root, 'requests');
		const preDispatchBroker = fakeWindowsBrokerV1('staged');
		const postDispatchBroker = fakeWindowsBrokerV1('dispatch-started');
		const transportFailure = async (_executable: string, args: string[]) => {
			const token = args.find(value => value.startsWith('requestToken='))
				?.slice('requestToken='.length);
			assert.ok(token);
			if (process.platform !== 'win32') {
				await unlink(path.join(requestRoot, `${token}.request.json`));
			}
			return {
				exitCode: 1,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.from('synthetic transport interruption'),
				totalMs: 1,
				timedOut: false,
				overflow: false,
			};
		};
		const missingConsent = await runPublicCommandLineV1([
			'plan',
			'apply',
			stored.planRef,
			'--json',
		], { configRoot: root });
		assert.equal(missingConsent.exitCode, 4);
		assert.equal(
			missingConsent.envelope.kind === 'operon-cli-local-result'
				? missingConsent.envelope.error?.code
				: undefined,
			'confirmation-required',
		);
		assert.equal(
			missingConsent.envelope.kind === 'operon-cli-local-result'
				? missingConsent.envelope.error?.action
				: undefined,
			'request-consent',
		);
		const beforeDispatch = await runPublicCommandLineV1([
			'plan',
			'apply',
			stored.planRef,
			'--confirm',
			confirmationTokenForPlanV1(plan),
			...(process.platform === 'win32'
				? ['--obsidian-bin', process.execPath]
				: []),
			'--json',
		], {
			configRoot: root,
			requestRoot,
			...(process.platform === 'win32'
				? { _windowsBrokerClient: preDispatchBroker }
				: {}),
			runProcess: async () => ({
				exitCode: 1,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.from('synthetic pre-dispatch transport refusal'),
				totalMs: 1,
				timedOut: false,
				overflow: false,
			}),
		});
		assert.equal(beforeDispatch.exitCode, 3);
		assert.equal(beforeDispatch.envelope.recovery, undefined);
			assert.equal(
				readMutationPlanV1(stored.planRef, root, { allowExpired: true }).applyRequest,
				undefined,
			);
			assert.doesNotMatch(beforeDispatch.human, /Do not retry|plan recover/u);
			assert.match(beforeDispatch.human, /Apply was not dispatched/u);
			assert.match(beforeDispatch.human, new RegExp(`operon plan apply ${stored.planRef}`, 'u'));
		const first = await runPublicCommandLineV1([
			'plan',
			'apply',
			stored.planRef,
			'--confirm',
			confirmationTokenForPlanV1(plan),
			...(process.platform === 'win32'
				? ['--obsidian-bin', process.execPath]
				: []),
			'--json',
		], {
			configRoot: root,
			requestRoot,
			...(process.platform === 'win32'
				? { _windowsBrokerClient: postDispatchBroker }
				: {}),
			runProcess: transportFailure,
		});
		assert.notEqual(first.exitCode, 0);
		assert.equal(first.exitCode, 5, JSON.stringify(first));
		assert.equal(first.envelope.recovery?.required, true);
		assert.equal(first.envelope.recovery?.planRef, stored.planRef);
		assert.equal(first.envelope.recovery?.action, 'recover-same-plan');
		assert.equal(first.envelope.recovery?.mutationMayHaveApplied, true);
		assert.ok(
			readMutationPlanV1(stored.planRef, root, { allowExpired: true }).applyRequest,
			JSON.stringify(first),
		);

		const repeated = await runPublicCommandLineV1([
			'plan',
			'apply',
			stored.planRef,
			'--confirm',
			confirmationTokenForPlanV1(plan),
			'--json',
		], { configRoot: root });
		assert.equal(repeated.exitCode, 5);
		assert.equal(
			repeated.envelope.kind === 'operon-cli-local-result' ? repeated.envelope.error?.code : undefined,
			'outcome-unknown',
		);
		assert.equal(
			repeated.envelope.kind === 'operon-cli-local-result'
				? (repeated.envelope.error?.details as { reasonCode?: string } | undefined)?.reasonCode
				: undefined,
			'plan-recovery-required',
		);
		assert.deepEqual(repeated.envelope.recovery, {
			required: true,
			planRef: stored.planRef,
			action: 'recover-same-plan',
			mutationMayHaveApplied: true,
		});

		const discarded = await runPublicCommandLineV1([
			'plan',
			'discard',
			stored.planRef,
			'--json',
		], { configRoot: root });
		assert.equal(discarded.exitCode, 5);
		assert.equal(
			discarded.envelope.kind === 'operon-cli-local-result' ? discarded.envelope.error?.code : undefined,
			'outcome-unknown',
		);
		assert.equal(
			discarded.envelope.kind === 'operon-cli-local-result'
				? (discarded.envelope.error?.details as { reasonCode?: string } | undefined)?.reasonCode
				: undefined,
			'plan-recovery-required',
		);
		assert.deepEqual(discarded.envelope.recovery, {
			required: true,
			planRef: stored.planRef,
			action: 'recover-same-plan',
			mutationMayHaveApplied: true,
		});

		let promptOutput = '';
		const cancelledAnswers = ['1', 'a', 'not-abandon'];
		const cancelledAbandon = await runPublicCommandLineV1(['plan', 'recover'], {
			configRoot: root,
			interactive: {
				ask(prompt: string): Promise<string | null> {
					promptOutput += prompt;
					return Promise.resolve(cancelledAnswers.shift() ?? null);
				},
				write(value: string): void {
					promptOutput += value;
				},
			},
		});
		assert.equal(cancelledAbandon.exitCode, 0);
		assert.match(cancelledAbandon.human, /Recovery record was preserved/u);
		assert.match(promptOutput, /Type ABANDON to remove this recovery record/u);
		assert.equal(
			readMutationPlanV1(stored.planRef, root, { allowExpired: true }).planRef,
			stored.planRef,
		);

		promptOutput = '';
		const confirmedAnswers = ['1', 'a', 'ABANDON'];
		const confirmedAbandon = await runPublicCommandLineV1(['plan', 'recover'], {
			configRoot: root,
			interactive: {
				ask(prompt: string): Promise<string | null> {
					promptOutput += prompt;
					return Promise.resolve(confirmedAnswers.shift() ?? null);
				},
				write(value: string): void {
					promptOutput += value;
				},
			},
		});
		assert.equal(confirmedAbandon.exitCode, 0);
		assert.match(confirmedAbandon.human, /Abandoned recovery for Operon plan/u);
		assert.match(promptOutput, /even if the mutation may have applied/u);
		assert.throws(
			() => readMutationPlanV1(stored.planRef, root, { allowExpired: true }),
			/ENOENT/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('live transport admits native acceptance platforms and rejects WSL', () => {
	assert.equal(liveTransportPlatformStatusV1('darwin', {}, '23.0.0'), 'supported');
	assert.equal(liveTransportPlatformStatusV1('linux', {}, '6.8.0'), 'acceptance-required');
	assert.equal(
		liveTransportPlatformStatusV1('linux', { WSL_DISTRO_NAME: 'Ubuntu' }, '6.8.0'),
		'unsupported',
	);
	assert.equal(liveTransportPlatformStatusV1('linux', {}, '5.15.0-microsoft-standard'), 'unsupported');
	assert.equal(liveTransportPlatformStatusV1('win32', {}, '10.0'), 'acceptance-required');
	assert.doesNotThrow(() => assertLiveTransportPlatformV1('darwin'));
	assert.doesNotThrow(() => assertLiveTransportPlatformV1('linux'));
	assert.doesNotThrow(() => assertLiveTransportPlatformV1('win32'));
});

test('convenience target policy permits targetless timers and rejects unsafe target shapes locally', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-target-policy-'));
	const previousConfigHome = process.env.OPERON_CONFIG_HOME;
	try {
		const vault = await createVault(root, 'Target Policy Vault');
		process.env.OPERON_CONFIG_HOME = path.join(root, 'config');
		let processCalls = 0;
		const transportFailure = async () => {
			processCalls += 1;
			return {
				exitCode: 1,
				signal: null,
				stdout: Buffer.alloc(0),
				stderr: Buffer.from('synthetic transport stop'),
				totalMs: 1,
				timedOut: false,
				overflow: false,
			};
		};
		const targetlessTimer = await runPublicCommandLineV1([
			'timer',
			'stop',
			'--vault',
			vault,
			'--input',
			'-',
			...(process.platform === 'win32'
				? ['--obsidian-bin', process.execPath]
				: []),
			'--json',
		], {
			configRoot: path.join(root, 'config'),
			input: Buffer.from(JSON.stringify({
				contractVersion: 1,
				kind: 'mutation-intent',
				idempotencyKey: 'targetless-timer-stop',
				spec: { operation: 'stop' },
			})),
			runProcess: transportFailure,
			requestRoot: path.join(root, 'requests'),
			...(process.platform === 'win32'
				? { _windowsBrokerClient: fakeWindowsBrokerV1('staged') }
				: {}),
		});
		assert.equal(processCalls, 1, JSON.stringify(targetlessTimer));
		assert.notEqual(
			targetlessTimer.envelope.kind === 'operon-cli-local-result'
				? (targetlessTimer.envelope.error?.details as {
					reasonCode?: string;
				} | undefined)?.reasonCode
				: undefined,
			'exact-target-required',
		);

		const missingTaskTarget = await runPublicCommandLineV1([
			'task',
			'update',
			'--vault',
			vault,
			'--input',
			'-',
			'--json',
		], {
			configRoot: path.join(root, 'config'),
			input: Buffer.from(JSON.stringify({
				contractVersion: 1,
				kind: 'mutation-intent',
				idempotencyKey: 'missing-task-target',
				spec: {
					operation: 'update',
					changes: [{ field: 'description', valueType: 'text', value: 'Synthetic' }],
				},
			})),
			runProcess: transportFailure,
		});
		assert.equal(processCalls, 1);
		assert.equal(
			missingTaskTarget.envelope.kind === 'operon-cli-local-result'
				? (missingTaskTarget.envelope.error?.details as {
					reasonCode?: string;
				} | undefined)?.reasonCode
				: undefined,
			'exact-target-required',
		);
	} finally {
		if (previousConfigHome === undefined) delete process.env.OPERON_CONFIG_HOME;
		else process.env.OPERON_CONFIG_HOME = previousConfigHome;
		await rm(root, { recursive: true, force: true });
	}
});

test('normal expired plans are pruned while prior apply attempts remain recoverable', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-plan-expiry-'));
	try {
		const vault = await createVault(root, 'Expiry Vault');
		const expiredPlan = fakePlan(
			new Date(Date.now() - 120_000).toISOString(),
			new Date(Date.now() - 60_000).toISOString(),
			'expired-unused',
		);
		const previewRequest: MutationPreviewRequestV1 = {
			contractVersion: 1,
			requestId: randomUUID(),
			kind: 'mutation-preview',
			clientInstanceId: expiredPlan.clientInstanceId,
			idempotencyKey: 'expired-unused',
			capability: 'tasks.delete.preview',
			mutationKind: 'task.delete',
			target: {
				operonId: 'abc1234',
				locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
			},
			spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
			authorization: { basis: 'user-explicit-request' },
		};
		const unused = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: previewRequest,
			plan: expiredPlan,
		}, root);
		const expiredApply = await runPublicCommandLineV1([
			'plan',
			'apply',
			unused.planRef,
			'--json',
		], { configRoot: root });
		assert.equal(expiredApply.exitCode, 4);
		assert.equal(
			expiredApply.envelope.kind === 'operon-cli-local-result'
				? expiredApply.envelope.error?.code
				: undefined,
			'plan-expired',
		);
		assert.equal(pruneExpiredMutationPlansV1(root), 0);
		assert.throws(() => readMutationPlanV1(unused.planRef, root), /ENOENT/u);

		const recoverablePlan = fakePlan(
			expiredPlan.createdAt,
			expiredPlan.expiresAt,
			'expired-recoverable',
		);
		const recoverable = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: { ...previewRequest, idempotencyKey: 'expired-recoverable' },
			plan: recoverablePlan,
		}, root);
		const applyRequest = buildMutationApplyRequestV1(recoverable, {
			confirmationToken: confirmationTokenForPlanV1(recoverablePlan),
			now: recoverablePlan.createdAt,
		});
		writeStoredPlanV1({ ...recoverable, applyRequest }, root);
		assert.throws(
			() => readMutationPlanV1(recoverable.planRef, root),
			/PLAN_RECOVERY_REQUIRED/u,
		);
		assert.equal(readMutationPlanV1(recoverable.planRef, root, { allowExpired: true }).planRef, recoverable.planRef);
		assert.equal(pruneExpiredMutationPlansV1(root), 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('terminal apply results remain as 24-hour recovery tombstones and expire honestly', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-terminal-tombstone-'));
	try {
		const vault = await createVault(root, 'Terminal Tombstone Vault');
		const dispatchedAt = Date.now();
		const plan = fakePlan(
			new Date(dispatchedAt - 1_000).toISOString(),
			new Date(dispatchedAt + 60_000).toISOString(),
			'terminal-tombstone',
		);
		const stored = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: fakeDeletePreviewRequest(plan, 'terminal-tombstone'),
			plan,
		}, root);
		const applyRequest = buildMutationApplyRequestV1(stored, {
			confirmationToken: confirmationTokenForPlanV1(plan),
			now: new Date(dispatchedAt).toISOString(),
		});
		const dispatched = markMutationPlanDispatchedV1(stored, applyRequest, root, dispatchedAt);
		assert.equal(
			Date.parse(dispatched.recoveryExpiresAt ?? '') - Date.parse(dispatched.recoveryStartedAt ?? ''),
			MUTATION_RECOVERY_RETENTION_MS_V1,
		);
		const terminal = fakeAppliedMutationResult(plan, dispatchedAt);
		assert.equal(recordMutationOutcomeV1(dispatched, applyRequest, terminal, root), 'retained');

		const afterPlanExpiry = readMutationPlanV1(stored.planRef, root, {
			allowExpired: true,
			now: dispatchedAt + 120_000,
		});
		assert.equal(afterPlanExpiry.terminalResult?.status, 'applied');
		assert.equal(afterPlanExpiry.applyRequest?.requestId, applyRequest.requestId);
		assert.throws(() => discardMutationPlanV1(stored.planRef, root), /PLAN_RECOVERY_REQUIRED/u);
		assert.equal(
			pruneExpiredMutationPlansV1(root, dispatchedAt + MUTATION_RECOVERY_RETENTION_MS_V1 - 1),
			0,
		);
		assert.throws(
			() => readMutationPlanV1(stored.planRef, root, {
				allowExpired: true,
				now: dispatchedAt + MUTATION_RECOVERY_RETENTION_MS_V1,
			}),
			/PLAN_EXPIRED/u,
		);
		assert.throws(
			() => readMutationPlanV1(stored.planRef, root, { allowExpired: true }),
			/ENOENT/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('terminal tombstone accepts receipt replay without changing the exact apply request', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-terminal-replay-'));
	try {
		const vault = await createVault(root, 'Terminal Replay Vault');
		const dispatchedAt = Date.now();
		const plan = fakePlan(
			new Date(dispatchedAt - 1_000).toISOString(),
			new Date(dispatchedAt + 60_000).toISOString(),
			'terminal-replay-plan',
		);
		const stored = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: fakeDeletePreviewRequest(plan, 'terminal-replay-plan'),
			plan,
		}, root);
		const applyRequest = buildMutationApplyRequestV1(stored, {
			confirmationToken: confirmationTokenForPlanV1(plan),
			now: new Date(dispatchedAt).toISOString(),
		});
		const dispatched = markMutationPlanDispatchedV1(stored, applyRequest, root, dispatchedAt);
		recordMutationOutcomeV1(
			dispatched,
			applyRequest,
			fakeAppliedMutationResult(plan, dispatchedAt),
			root,
		);
		const terminal = readMutationPlanV1(stored.planRef, root, { allowExpired: true });
		const replay = fakeAlreadyAppliedMutationResult(
			plan,
			randomUUID(),
			dispatchedAt,
			canonicalVaultIdentityV1(vault).sha256,
		);
		recordMutationOutcomeV1(terminal, applyRequest, replay, root);
		const replayed = readMutationPlanV1(stored.planRef, root, { allowExpired: true });
		assert.equal(JSON.stringify(replayed.applyRequest), JSON.stringify(applyRequest));
		assert.equal(
			replayed.terminalResult?.status,
			'already-applied',
		);
		assert.equal(replayed.terminalResult?.postflight?.status, 'receipt-replay');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('concurrent dispatch capacity reservation never protects more than 256 records', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-recovery-capacity-'));
	try {
		const vault = await createVault(root, 'Recovery Capacity Vault');
		const preloadDispatchedAt = Date.now();
		const vaultSha256 = canonicalVaultIdentityV1(vault).sha256;
		for (let index = 0; index < MUTATION_RECOVERY_RECORD_LIMIT_V1 - 1; index += 1) {
			const idempotencyKey = `protected-recovery-record-${index}`;
			const plan = fakePlan(
				new Date(preloadDispatchedAt - 1_000).toISOString(),
				new Date(preloadDispatchedAt + 60_000).toISOString(),
				idempotencyKey,
			);
			const stored = process.platform === 'win32'
				? {
					version: 1 as const,
					planRef: randomUUID().split('-').join(''),
					vaultPath: vault,
					vaultSha256,
					clientInstanceId: plan.clientInstanceId,
					idempotencyKey,
					plan,
					createdAt: plan.createdAt,
					expiresAt: plan.expiresAt,
				}
				: storeMutationPlanV1({
					vaultPath: vault,
					vaultSha256,
					request: fakeDeletePreviewRequest(plan, idempotencyKey),
					plan,
				}, root);
			const applyRequest = buildMutationApplyRequestV1(stored, {
				confirmationToken: confirmationTokenForPlanV1(plan),
				now: new Date(preloadDispatchedAt).toISOString(),
			});
			if (process.platform === 'win32') {
				writeStoredPlanV1({
					...stored,
					applyRequest,
					recoveryStartedAt: new Date(preloadDispatchedAt).toISOString(),
					recoveryExpiresAt: new Date(
						preloadDispatchedAt + MUTATION_RECOVERY_RETENTION_MS_V1,
					).toISOString(),
				}, root);
			} else {
				markMutationPlanDispatchedV1(stored, applyRequest, root, preloadDispatchedAt);
			}
		}
		const contenderPlanCreatedAt = Date.now();
		const contenders = ['protected-contender-a', 'protected-contender-b'].map(idempotencyKey => {
			const plan = fakePlan(
				new Date(contenderPlanCreatedAt - 1_000).toISOString(),
				new Date(contenderPlanCreatedAt + 60_000).toISOString(),
				idempotencyKey,
			);
			return storeMutationPlanV1({
				vaultPath: vault,
				vaultSha256,
				request: fakeDeletePreviewRequest(plan, idempotencyKey),
				plan,
			}, root);
		});
		const dispatchedAt = Date.now();
		const releasePath = path.join(root, 'release-capacity-workers');
		const workerPath = path.join(root, 'plan-store-capacity-worker.mjs');
		await writeFile(workerPath, __OPERON_PLAN_STORE_CAPACITY_WORKER_SOURCE__);
		const outcomes = await runConcurrentCapacityWorkersV1(
			contenders.map(record => record.planRef),
			root,
			workerPath,
			releasePath,
			dispatchedAt,
		);
		assert.equal(
			outcomes.filter(outcome => outcome.ok).length,
			1,
			JSON.stringify(outcomes),
		);
		assert.deepEqual(
			outcomes.filter(outcome => !outcome.ok).map(outcome => outcome.code),
			['RECOVERY_STORE_UNAVAILABLE'],
		);
		const refusedPlanRef = outcomes.find(outcome => !outcome.ok)?.planRef;
		assert.equal(typeof refusedPlanRef, 'string');
		assert.equal(
			readMutationPlanV1(refusedPlanRef as string, root).applyRequest,
			undefined,
			'capacity refusal must happen before dispatch evidence is written',
		);
		const protectedCount = (await readdir(path.join(root, 'plans')))
			.filter(name => /^[A-Za-z0-9_-]{32}\.json$/u.test(name))
			.map(name => readMutationPlanV1(name.slice(0, -5), root, { allowExpired: true }))
			.filter(record => record.applyRequest !== undefined)
			.length;
		assert.equal(protectedCount, MUTATION_RECOVERY_RECORD_LIMIT_V1);
		let processCalls = 0;
		const refused = await runPublicCommandLineV1([
			'plan',
			'apply',
			refusedPlanRef as string,
			'--confirm',
			confirmationTokenForPlanV1(
				readMutationPlanV1(refusedPlanRef as string, root).plan,
			),
			'--json',
		], {
			configRoot: root,
			runProcess: async () => {
				processCalls += 1;
				throw new Error('MUST_NOT_DISPATCH');
			},
		});
		assert.equal(refused.exitCode, 5);
		assert.equal(
			refused.envelope.kind === 'operon-cli-local-result'
				? refused.envelope.error?.code
				: undefined,
			'receipt-store-unavailable',
		);
		assert.equal(refused.envelope.recovery, undefined);
		assert.equal(processCalls, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Windows dispatch mutex publishes concurrent low-cardinality admissions atomically', {
	skip: process.platform !== 'win32' ? 'Windows named-mutex coverage.' : false,
}, async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-windows-dispatch-mutex-'));
	try {
		const vault = await createVault(root, 'Windows Dispatch Mutex Vault');
		const planCreatedAt = Date.now();
		const vaultSha256 = canonicalVaultIdentityV1(vault).sha256;
		const contenders = ['windows-mutex-a', 'windows-mutex-b'].map(idempotencyKey => {
			const plan = fakePlan(
				new Date(planCreatedAt - 1_000).toISOString(),
				new Date(planCreatedAt + 60_000).toISOString(),
				idempotencyKey,
			);
			return storeMutationPlanV1({
				vaultPath: vault,
				vaultSha256,
				request: fakeDeletePreviewRequest(plan, idempotencyKey),
				plan,
			}, root);
		});
		const dispatchedAt = Date.now();
		const releasePath = path.join(root, 'release-windows-mutex-workers');
		const workerPath = path.join(root, 'plan-store-windows-mutex-worker.mjs');
		await writeFile(workerPath, __OPERON_PLAN_STORE_CAPACITY_WORKER_SOURCE__);
		const outcomes = await runConcurrentCapacityWorkersV1(
			contenders.map(record => record.planRef),
			root,
			workerPath,
			releasePath,
			dispatchedAt,
		);
		assert.equal(outcomes.every(outcome => outcome.ok), true, JSON.stringify(outcomes));
		for (const contender of contenders) {
			assert.notEqual(
				readMutationPlanV1(contender.planRef, root, { allowExpired: true }).applyRequest,
				undefined,
			);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('dispatch capacity lock safely recovers a stale lock from a dead owner', {
	skip: process.platform === 'win32'
		? 'Windows uses an owner-process named mutex instead of the POSIX stale lock file.'
		: false,
}, async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-recovery-stale-lock-'));
	try {
		const vault = await createVault(root, 'Recovery Stale Lock Vault');
		const now = Date.now();
		const plan = fakePlan(
			new Date(now - 1_000).toISOString(),
			new Date(now + 60_000).toISOString(),
			'stale-lock-recovery',
		);
		const stored = storeMutationPlanV1({
			vaultPath: vault,
			vaultSha256: canonicalVaultIdentityV1(vault).sha256,
			request: fakeDeletePreviewRequest(plan, 'stale-lock-recovery'),
			plan,
		}, root);
		const deadOwner = spawnSync(process.execPath, ['--eval', 'process.exit(0)']);
		assert.equal(deadOwner.status, 0);
		assert.equal(typeof deadOwner.pid, 'number');
		const lockPath = path.join(root, 'plans', '.dispatch-capacity.lock');
		const old = new Date(now - 60_000);
		await writeFile(lockPath, `${JSON.stringify({
			version: 1,
			pid: deadOwner.pid,
			token: randomUUID(),
			createdAt: old.toISOString(),
		})}\n`, { mode: 0o600 });
		await chmod(lockPath, 0o600);
		await utimes(lockPath, old, old);
		const applyRequest = buildMutationApplyRequestV1(stored, {
			confirmationToken: confirmationTokenForPlanV1(plan),
			now: new Date(now).toISOString(),
		});
		const dispatched = markMutationPlanDispatchedV1(stored, applyRequest, root, now);
		assert.equal(dispatched.applyRequest?.requestId, applyRequest.requestId);
		await assert.rejects(stat(lockPath), /ENOENT/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

interface CapacityWorkerOutcomeV1 {
	ok: boolean;
	planRef: string;
	code?: string;
	stage?: 'read' | 'build' | 'decode' | 'mark';
	issues?: unknown;
}

function fakeWindowsBrokerV1(
	state: 'staged' | 'dispatch-started',
): WindowsBrokerClientPortV1 {
	return {
		async stage() {
			return {
				requestToken: 'w'.repeat(32),
				stagingReceipt: 'a'.repeat(64),
			};
		},
		async status() {
			return { state };
		},
		async cancel() {
			return { cancelled: state === 'staged', state };
		},
		close() {},
	};
}

async function runConcurrentCapacityWorkersV1(
	planRefs: string[],
	root: string,
	workerPath: string,
	releasePath: string,
	now: number,
): Promise<CapacityWorkerOutcomeV1[]> {
	const workers = planRefs.map(planRef => {
		const child = spawn(process.execPath, [
			workerPath,
			root,
			planRef,
			releasePath,
			String(now),
		], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let markReady: (() => void) | null = null;
		const ready = new Promise<void>(resolve => {
			markReady = resolve;
		});
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
			if (stdout.includes('ready\n')) markReady?.();
		});
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});
		const completed = new Promise<CapacityWorkerOutcomeV1>((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', code => {
				if (code !== 0) {
					reject(new Error(`Capacity worker exited ${String(code)}: ${stderr}`));
					return;
				}
				const line = stdout.trim().split('\n').at(-1);
				try {
					resolve(JSON.parse(line ?? '') as CapacityWorkerOutcomeV1);
				} catch {
					reject(new Error(`Capacity worker returned malformed output: ${stdout}`));
				}
			});
		});
		return { ready, completed };
	});
	await Promise.all(workers.map(worker => worker.ready));
	await writeFile(releasePath, 'release\n');
	return await Promise.all(workers.map(worker => worker.completed));
}

async function createVault(root: string, name: string): Promise<string> {
	const vault = path.join(root, name);
	await mkdir(path.join(vault, '.obsidian', 'plugins', 'operon'), { recursive: true });
	await mkdir(path.join(vault, 'Notes'), { recursive: true });
	await writeFile(
		path.join(vault, '.obsidian', 'plugins', 'operon', 'manifest.json'),
		JSON.stringify({ id: 'operon', version: '2.6.0', minAppVersion: '1.8.9' }),
	);
	return await realpath(vault);
}

function fakePlan(
	createdAt: string,
	expiresAt: string,
	idempotencyKey: string,
): SealedMutationPlanV1 {
	const boundedExpiresAt = Date.parse(expiresAt) - Date.parse(createdAt) > 60_000
		? new Date(Date.parse(createdAt) + 60_000).toISOString()
		: expiresAt;
	const plan = {
		contractVersion: 1,
		planId: 'phase9-plan',
		planHash: '',
		clientInstanceId: 'operon-cli-phase9',
		correlationId: 'phase9-correlation',
		idempotencyKeyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
		receiptTargetDigest: '',
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		createdAt,
		expiresAt: boundedExpiresAt,
		targets: [{
			operonId: 'abc1234',
			locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 0 },
			targetDigest: '7'.repeat(64),
		}],
		contextRevision: {
			index: {
				sessionId: 'phase9',
				ramGeneration: 1,
				durable: { status: 'missing' },
			},
			settingsFingerprint: '5'.repeat(64),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: '6'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source',
			resourceKey: 'Tasks.md',
			revision: '8'.repeat(64),
		}],
		atomicGroups: [{
			groupId: 'task-source:Tasks.md',
			order: 0,
			resources: [{ resourceKind: 'task-source', resourceKey: 'Tasks.md' }],
		}],
		predictedEffects: [{
			resourceKind: 'task-source',
			resourceKey: 'Tasks.md',
			action: 'trash',
			summary: 'Trash the exact task source.',
		}],
		riskLevel: 'destructive',
		requiresConfirmation: true,
		requiredAcknowledgements: ['confirm-delete'],
		warnings: [],
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
	} satisfies Omit<SealedMutationPlanV1, 'planHash' | 'receiptTargetDigest'> & {
		planHash: string;
		receiptTargetDigest: string;
	};
	plan.receiptTargetDigest = computeReceiptTargetDigestV1(plan.targets);
	plan.planHash = computeSealedMutationPlanHashV1(plan);
	const decoded = decodeSealedMutationPlanV1(plan);
	assert.equal(decoded.ok, true, decoded.ok ? undefined : JSON.stringify(decoded.issues));
	return plan;
}

function fakeDeletePreviewRequest(
	plan: SealedMutationPlanV1,
	idempotencyKey: string,
): MutationPreviewRequestV1 {
	return {
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'mutation-preview',
		clientInstanceId: plan.clientInstanceId,
		idempotencyKey,
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
		},
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
		authorization: { basis: 'user-explicit-request' },
	};
}

function fakeAppliedMutationResult(
	plan: SealedMutationPlanV1,
	now: number,
): MutationResultV1 {
	return {
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'mutation-result',
		status: 'applied',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [{
			groupId: plan.atomicGroups[0].groupId,
			status: 'committed',
			resourceRevisions: plan.affectedResources,
		}],
		receipt: {
			contractVersion: 1,
			vaultIdentityHash: '4'.repeat(64),
			clientInstanceId: plan.clientInstanceId,
			idempotencyKeyHash: plan.idempotencyKeyHash,
			planHash: plan.planHash,
			mutationKind: plan.mutationKind,
			targetDigest: plan.receiptTargetDigest,
			terminalOutcome: 'applied',
			effectiveAt: new Date(now).toISOString(),
			completedAt: new Date(now).toISOString(),
			expiresAt: new Date(now + MUTATION_RECOVERY_RETENTION_MS_V1).toISOString(),
		},
		postflight: {
			status: 'verified',
			observedAt: new Date(now).toISOString(),
			contextRevision: plan.contextRevision,
		},
	};
}

function fakeAlreadyAppliedMutationResult(
	plan: SealedMutationPlanV1,
	requestId: string,
	now: number,
	vaultIdentityHash: string,
): MutationResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'mutation-result',
		status: 'already-applied',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
		receipt: {
			contractVersion: 1,
			vaultIdentityHash,
			clientInstanceId: plan.clientInstanceId,
			idempotencyKeyHash: plan.idempotencyKeyHash,
			planHash: plan.planHash,
			mutationKind: plan.mutationKind,
			targetDigest: plan.receiptTargetDigest,
			terminalOutcome: 'already-applied',
			effectiveAt: new Date(now).toISOString(),
			completedAt: new Date(now).toISOString(),
			expiresAt: new Date(now + MUTATION_RECOVERY_RETENTION_MS_V1).toISOString(),
		},
		postflight: { status: 'receipt-replay' },
	};
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function compactGoldenArgv(caseId: string): Promise<string[]> {
	const golden = JSON.parse(await readFile(
		path.resolve(process.cwd(), 'scripts/agent-runtime/fixtures/compact-create-golden.json'),
		'utf8',
	)) as { cases: Array<{ id: string; argv?: string[] }> };
	const testCase = golden.cases.find(candidate => candidate.id === caseId);
	assert.ok(testCase?.argv, `Missing compact golden argv case: ${caseId}`);
	return testCase.argv;
}

async function validatePublishedPlanShowResult(
	value: unknown,
): Promise<{ valid: boolean; errors: unknown }> {
	const schemaRoots = [
		path.join(process.cwd(), 'contracts', 'agent-runtime', 'v1'),
		path.join(process.cwd(), 'packages', 'operon-cli', 'schema-source'),
	];
	const ajv = new Ajv2020({ strict: false, logger: false });
	for (const schemaRoot of schemaRoots) {
		for (const fileName of await readdir(schemaRoot)) {
			if (!fileName.endsWith('.json')) continue;
			const document = JSON.parse(await readFile(path.join(schemaRoot, fileName), 'utf8'));
			if (typeof document.$id === 'string') ajv.addSchema(document);
		}
	}
	const validate = ajv.getSchema(
		'urn:operon:schema:cli:v1:operon-cli-local.schema.json#/$defs/planShowResult',
	);
	assert.ok(validate, 'Published plan-show schema must be registered.');
	return { valid: Boolean(validate(value)), errors: validate.errors };
}
