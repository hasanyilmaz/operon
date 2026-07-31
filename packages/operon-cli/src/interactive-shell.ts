import {
	readdirSync,
	realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
	createInterface,
	type Interface,
	type ReadLineOptions,
} from 'node:readline';

import {
	type PublicCommandOutcomeV1,
	type PublicCommandPortsV1,
	runPublicCommandLineV1,
} from './command-line';
import { writePublicCommandOutcomeV1 } from './command-output';
import { OPERON_CLI_VERSION } from './client';
import {
	commandOptionRequiresValueV1,
	completionCandidatesV1,
	isCommandGroupV1,
	resolveCommandDefinitionV1,
} from './command-registry';
import {
	loadOperonCliConfigV1,
	operonCliConfigRootV1,
	resolveVaultV1,
} from './config';
import { sanitizeTerminalTextV1 } from './terminal-text';
import type { InteractiveTerminalPortV1 } from './terminal-port';
import type { CliUpdateNoticeV1 } from './update-check';

const SHELL_LINE_BYTE_LIMIT = 16_384;
const SHELL_TOKEN_LIMIT = 128;
const SHELL_COMPLETION_LIMIT = 100;
const SHELL_HISTORY_LIMIT = 100;
const PROFILE_LABEL_LIMIT = 48;

const SENSITIVE_OPTIONS = new Set([
	'--confirm',
	'--id',
	'--input',
	'--obsidian-bin',
	'--plan-ref',
	'--profile',
	'--request-id',
	'--vault',
]);

const SAFE_HISTORY_COMMANDS = new Set([
	'capabilities',
	'catalog',
	'diagnostics',
	'health',
	'help',
	'manifest',
	'profile.list',
	'schema.list',
	'task.create',
	'timers.read',
	'version',
]);

export type ShellReadResultV1 =
	| { kind: 'line'; value: string }
	| { kind: 'interrupt' }
	| { kind: 'eof' };

export interface InteractiveShellSessionV1 {
	readonly guidedPort: InteractiveTerminalPortV1;
	readonly closed: boolean;
	readCommand(prompt: string): Promise<ShellReadResultV1>;
	forgetLatest(line: string): void;
	setActiveCommand(controller: AbortController | null): void;
	writeStdout(text: string): void;
	writeStderr(text: string): void;
	close(): void;
}

export interface InteractiveShellOptionsV1 {
	session: InteractiveShellSessionV1;
	configRoot?: string;
	cwd?: string;
	commandPorts?: Omit<PublicCommandPortsV1, 'configRoot' | 'cwd' | 'interactive' | 'signal'>;
	runCommand?: typeof runPublicCommandLineV1;
	version?: string;
	updateNotice?: CliUpdateNoticeV1 | null;
}

export async function runInteractiveShellV1(options: InteractiveShellOptionsV1): Promise<number> {
	const {
		session,
		configRoot = operonCliConfigRootV1(),
		cwd = process.cwd(),
		commandPorts = {},
		runCommand = runPublicCommandLineV1,
		version = OPERON_CLI_VERSION,
		updateNotice = null,
	} = options;
	const initialProfile = resolveShellProfileLabelV1(configRoot, cwd);
	const hasProfiles = hasConfiguredProfilesV1(configRoot);
	session.writeStdout([
		...(updateNotice ? [renderUpdateNoticeV1(updateNotice), ''] : []),
		`Operon CLI ${version}`,
		`Profile: ${initialProfile}`,
		...(!hasProfiles ? ['No Operon vault configured. Run: setup'] : []),
		'Tab to complete, ↑/↓ for session history, Ctrl+D to quit.',
		'Type help to list commands.',
		'',
		'',
	].join('\n'));
	try {
		while (!session.closed) {
			const profile = resolveShellProfileLabelV1(configRoot, cwd);
			const input = await session.readCommand(`operon[${profile}]> `);
			if (input.kind === 'eof') break;
			if (input.kind === 'interrupt') continue;
			const line = input.value.trim();
			if (!line) {
				session.forgetLatest(input.value);
				continue;
			}
			let tokens: string[];
			try {
				tokens = normalizeShellCommandTokensV1(tokenizeShellLineV1(input.value));
			} catch (error) {
				session.forgetLatest(input.value);
				session.writeStderr(`${shellErrorMessage(error)}\n`);
				continue;
			}
			if (!shouldRetainShellHistoryV1(tokens)) session.forgetLatest(input.value);
			if (tokens.length === 1 && (tokens[0] === 'exit' || tokens[0] === 'quit')) break;
			if (tokens.length === 0) continue;
			if (usesShellStdin(tokens)) {
				session.writeStderr(
					'stdin input is unavailable inside the Operon shell.\n'
					+ 'Use an owner-controlled input file or run this command outside the shell.\n',
				);
				continue;
			}
			const controller = new AbortController();
			session.setActiveCommand(controller);
			try {
				const outcome = await runCommand(tokens, {
					...commandPorts,
					configRoot,
					cwd,
					interactive: session.guidedPort,
					signal: controller.signal,
				});
				if (controller.signal.aborted && !hasRecoveryPlan(outcome)) {
					session.writeStderr('Command cancelled.\n');
				} else {
					writePublicCommandOutcomeV1(outcome, {
						stdout: { write: text => session.writeStdout(text) },
						stderr: { write: text => session.writeStderr(text) },
					});
				}
			} catch {
				session.writeStderr('Operon CLI encountered an unexpected internal failure.\n');
			} finally {
				session.setActiveCommand(null);
			}
		}
		return 0;
	} finally {
		session.close();
	}
}

export function renderUpdateNoticeV1(notice: CliUpdateNoticeV1): string {
	const lines = [
		`✨ Update available! ${notice.currentVersion} → ${notice.availableVersion}`,
		`Run ${notice.updateCommand} to update.`,
		'',
		'See release details:',
		notice.releaseUrl,
	];
	const width = Math.max(...lines.map(terminalDisplayWidthV1));
	const horizontal = '─'.repeat(width + 2);
	return [
		`╭${horizontal}╮`,
		...lines.map(line => `│ ${line}${' '.repeat(width - terminalDisplayWidthV1(line))} │`),
		`╰${horizontal}╯`,
	].join('\n');
}

function terminalDisplayWidthV1(value: string): number {
	return [...value].reduce((width, character) => width + (character === '✨' ? 2 : 1), 0);
}

export function tokenizeShellLineV1(line: string): string[] {
	if (Buffer.byteLength(line, 'utf8') > SHELL_LINE_BYTE_LIMIT) throw new Error('SHELL_LINE_TOO_LARGE');
	if (hasUnsafeTerminalInput(line)) throw new Error('SHELL_INPUT_UNSAFE');
	const tokens: string[] = [];
	let token = '';
	let tokenStarted = false;
	let quote: 'single' | 'double' | null = null;
	let escaping = false;
	for (const character of line) {
		if (escaping) {
			token += character;
			tokenStarted = true;
			escaping = false;
			continue;
		}
		if (quote !== 'single' && character === '\\') {
			escaping = true;
			tokenStarted = true;
			continue;
		}
		if (quote === 'single') {
			if (character === "'") quote = null;
			else token += character;
			continue;
		}
		if (quote === 'double') {
			if (character === '"') quote = null;
			else token += character;
			continue;
		}
		if (character === "'") {
			quote = 'single';
			tokenStarted = true;
			continue;
		}
		if (character === '"') {
			quote = 'double';
			tokenStarted = true;
			continue;
		}
		if (/\s/u.test(character)) {
			if (tokenStarted) {
				tokens.push(token);
				token = '';
				tokenStarted = false;
				if (tokens.length > SHELL_TOKEN_LIMIT) throw new Error('SHELL_TOO_MANY_TOKENS');
			}
			continue;
		}
		token += character;
		tokenStarted = true;
	}
	if (escaping) throw new Error('SHELL_TRAILING_ESCAPE');
	if (quote) throw new Error('SHELL_UNTERMINATED_QUOTE');
	if (tokenStarted) tokens.push(token);
	if (tokens.length > SHELL_TOKEN_LIMIT) throw new Error('SHELL_TOO_MANY_TOKENS');
	return tokens;
}

export function normalizeShellCommandTokensV1(tokens: readonly string[]): string[] {
	return tokens[0] === 'operon' ? [...tokens.slice(1)] : [...tokens];
}

export function shouldRetainShellHistoryV1(tokens: readonly string[]): boolean {
	const normalized = normalizeShellCommandTokensV1(tokens);
	if (normalized.length === 0) return false;
	if (normalized.some(token => (
		SENSITIVE_OPTIONS.has(token)
		|| [...SENSITIVE_OPTIONS].some(option => token.startsWith(`${option}=`))
	))) return false;
	if (normalized[0] === 'exit' || normalized[0] === 'quit') return false;
	if (
		normalized.length === 2
		&& normalized[1] === '--help'
		&& isCommandGroupV1(normalized[0])
	) return true;
	const resolved = resolveCommandDefinitionV1(normalized);
	if (!resolved || !SAFE_HISTORY_COMMANDS.has(resolved.definition.id)) return false;
	const trailing = normalized.slice(resolved.consumed);
	if (resolved.definition.id === 'task.create') return trailing.length === 0;
	return trailing.every(token => token === '--help' || token === '-h' || token === '--json');
}

export function completeInteractiveShellLineV1(
	line: string,
	cwd: string = process.cwd(),
): [string[], string] {
	if (Buffer.byteLength(line, 'utf8') > SHELL_LINE_BYTE_LIMIT || hasUnsafeTerminalInput(line)) {
		return [[], ''];
	}
	const endsWithWhitespace = /\s$/u.test(line);
	let tokens: string[];
	try {
		tokens = tokenizeShellLineV1(line);
	} catch {
		return [[], completionFragment(line)];
	}
	if (endsWithWhitespace) tokens.push('');
	const normalized = normalizeShellCommandTokensV1(tokens);
	const fragment = normalized.at(-1) ?? '';
	const previousToken = normalized.at(-2);
	const resolved = resolveCommandDefinitionV1(normalized);
	if (
		previousToken
		&& resolved
		&& commandOptionRequiresValueV1(resolved.definition, previousToken)
	) {
		const candidates = previousToken === '--input' && fragment !== '-'
			? completeInputFiles(fragment, cwd)
			: (resolved.definition.completion?.optionValues?.[previousToken] ?? [])
				.filter(value => value.startsWith(fragment))
				.sort();
		return [candidates, completionFragment(line)];
	}
	let candidates = completionCandidatesV1(normalized);
	if (normalized.length <= 1) {
		const prefix = normalized[0] ?? '';
		candidates = [...candidates, ...['exit', 'quit'].filter(candidate => candidate.startsWith(prefix))]
			.filter((candidate, index, values) => values.indexOf(candidate) === index)
			.sort();
	}
	return [candidates.slice(0, SHELL_COMPLETION_LIMIT), completionFragment(line)];
}

export function resolveShellProfileLabelV1(configRoot: string, cwd: string): string {
	try {
		const config = loadOperonCliConfigV1(configRoot);
		const resolved = resolveVaultV1(config, { cwd });
		return boundedProfileLabel(resolved.profile ?? 'unresolved');
	} catch {
		return 'unresolved';
	}
}

function hasConfiguredProfilesV1(configRoot: string): boolean {
	try {
		return loadOperonCliConfigV1(configRoot).profiles.length > 0;
	} catch {
		return false;
	}
}

export function createProcessInteractiveShellSessionV1(options: {
	cwd?: string;
	input?: NodeJS.ReadableStream;
	stdout?: NodeJS.WritableStream;
	stderr?: NodeJS.WritableStream;
} = {}): InteractiveShellSessionV1 | null {
	const input = options.input ?? process.stdin;
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	if (!isTtyStream(input) || !isTtyStream(stdout)) return null;
	return new ProcessInteractiveShellSessionV1({
		input,
		stdout,
		stderr,
		cwd: options.cwd ?? process.cwd(),
	});
}

class ProcessInteractiveShellSessionV1 implements InteractiveShellSessionV1 {
	readonly guidedPort: InteractiveTerminalPortV1;
	private readonly input: Interface;
	private readonly stdout: NodeJS.WritableStream;
	private readonly stderr: NodeJS.WritableStream;
	private readonly events: ShellReadResultV1[] = [];
	private waiter: {
		sensitive: boolean;
		resolve(value: ShellReadResultV1): void;
	} | null = null;
	private activeCommand: AbortController | null = null;
	private didClose = false;
	private readonly onSigterm: () => void;

	constructor(options: {
		input: NodeJS.ReadableStream;
		stdout: NodeJS.WritableStream;
		stderr: NodeJS.WritableStream;
		cwd: string;
	}) {
		this.stdout = options.stdout;
		this.stderr = options.stderr;
		const readlineOptions: ReadLineOptions = {
			input: options.input,
			output: options.stdout,
			terminal: true,
			historySize: SHELL_HISTORY_LIMIT,
			removeHistoryDuplicates: true,
			completer: (line: string) => completeInteractiveShellLineV1(line, options.cwd),
		};
		this.input = createInterface(readlineOptions);
		this.input.on('history', history => this.filterHistory(history));
		this.input.on('line', line => this.emit({ kind: 'line', value: line }));
		this.input.on('SIGINT', () => this.handleSigint());
		this.input.on('close', () => this.handleClose());
		this.onSigterm = () => this.close();
		process.once('SIGTERM', this.onSigterm);
		this.guidedPort = {
			ask: async prompt => {
				const event = await this.read(prompt, true);
				return event.kind === 'line' ? event.value : null;
			},
			write: text => this.writeStdout(text),
		};
	}

	get closed(): boolean {
		return this.didClose;
	}

	async readCommand(prompt: string): Promise<ShellReadResultV1> {
		return await this.read(prompt, false);
	}

	forgetLatest(_line: string): void {
		// The readline history event filters entries before its navigation state is committed.
	}

	setActiveCommand(controller: AbortController | null): void {
		this.activeCommand = controller;
	}

	writeStdout(text: string): void {
		this.stdout.write(text);
	}

	writeStderr(text: string): void {
		this.stderr.write(text);
	}

	close(): void {
		if (this.didClose) return;
		this.didClose = true;
		this.activeCommand?.abort();
		this.activeCommand = null;
		process.removeListener('SIGTERM', this.onSigterm);
		this.input.close();
		this.resolveWaiter({ kind: 'eof' });
	}

	private async read(prompt: string, sensitive: boolean): Promise<ShellReadResultV1> {
		if (this.didClose) return { kind: 'eof' };
		const queued = this.events.shift();
		if (queued) return queued;
		if (this.waiter) throw new Error('SHELL_INPUT_ALREADY_PENDING');
		this.input.setPrompt(prompt);
		this.input.prompt();
		return await new Promise(resolve => {
			this.waiter = { sensitive, resolve };
		});
	}

	private emit(event: ShellReadResultV1): void {
		if (event.kind === 'line' && this.waiter?.sensitive) this.forgetLatest(event.value);
		if (this.waiter) {
			this.resolveWaiter(event);
			return;
		}
		if (event.kind === 'line') {
			this.forgetLatest(event.value);
			return;
		}
		this.events.push(event);
	}

	private resolveWaiter(event: ShellReadResultV1): void {
		const waiter = this.waiter;
		this.waiter = null;
		waiter?.resolve(event);
	}

	private handleSigint(): void {
		if (this.waiter) {
			this.input.write(null, { ctrl: true, name: 'u' });
			this.stdout.write('\n');
			this.resolveWaiter({ kind: 'interrupt' });
			return;
		}
		if (this.activeCommand && !this.activeCommand.signal.aborted) {
			this.input.write(null, { ctrl: true, name: 'u' });
			this.stdout.write('\n');
			this.activeCommand.abort();
			return;
		}
		this.events.push({ kind: 'interrupt' });
	}

	private handleClose(): void {
		if (this.didClose) return;
		this.didClose = true;
		this.activeCommand?.abort();
		this.activeCommand = null;
		process.removeListener('SIGTERM', this.onSigterm);
		this.resolveWaiter({ kind: 'eof' });
	}

	private filterHistory(history: string[]): void {
		const latest = history[0];
		if (!latest) return;
		if (this.waiter?.sensitive) {
			history.shift();
			return;
		}
		try {
			if (!shouldRetainShellHistoryV1(tokenizeShellLineV1(latest))) history.shift();
		} catch {
			history.shift();
		}
	}
}

function usesShellStdin(tokens: readonly string[]): boolean {
	return tokens.some((token, index) => token === '--input' && tokens[index + 1] === '-');
}

function hasRecoveryPlan(outcome: PublicCommandOutcomeV1): boolean {
	return outcome.envelope.kind === 'cli-result' && Boolean(outcome.envelope.client?.planRef);
}

function hasUnsafeTerminalInput(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) as number;
		if (character === '\t') continue;
		if (
			codePoint <= 31
			|| (codePoint >= 127 && codePoint <= 159)
			|| codePoint === 0x061c
			|| codePoint === 0x200e
			|| codePoint === 0x200f
			|| (codePoint >= 0x202a && codePoint <= 0x202e)
			|| (codePoint >= 0x2066 && codePoint <= 0x2069)
			|| /[\p{Cf}\p{Zl}\p{Zp}]/u.test(character)
		) return true;
	}
	return false;
}

function completeInputFiles(fragment: string, cwd: string): string[] {
	if (!fragment || fragment === '-' || isAbsolute(fragment)) return [];
	const directoryFragment = dirname(fragment);
	const nameFragment = basename(fragment);
	const directory = resolve(cwd, directoryFragment === '.' ? '' : directoryFragment);
	try {
		const canonicalCwd = realpathSync(cwd);
		const canonicalDirectory = realpathSync(directory);
		if (
			canonicalDirectory !== canonicalCwd
			&& !canonicalDirectory.startsWith(`${canonicalCwd}${sep}`)
		) return [];
		return readdirSync(canonicalDirectory, { withFileTypes: true })
			.filter(entry => entry.name.startsWith(nameFragment) && !entry.isSymbolicLink())
			.sort((left, right) => left.name.localeCompare(right.name))
			.slice(0, SHELL_COMPLETION_LIMIT)
			.map(entry => {
				const absolute = join(canonicalDirectory, entry.name);
				const candidate = relative(canonicalCwd, absolute) + (entry.isDirectory() ? '/' : '');
				return escapeShellToken(candidate);
			});
	} catch {
		return [];
	}
}

function escapeShellToken(value: string): string {
	return value.replace(/([\\\s"'`$|&;<>*?()[\]{}])/gu, '\\$1');
}

function completionFragment(line: string): string {
	return /[^\s]*$/u.exec(line)?.[0] ?? '';
}

function boundedProfileLabel(value: string): string {
	return [...sanitizeTerminalTextV1(value)].slice(0, PROFILE_LABEL_LIMIT).join('') || 'unresolved';
}

function shellErrorMessage(error: unknown): string {
	const code = error instanceof Error ? error.message : 'SHELL_INPUT_INVALID';
	const messages: Record<string, string> = {
		SHELL_INPUT_UNSAFE: 'The command contains unsafe terminal formatting characters.',
		SHELL_LINE_TOO_LARGE: 'The command exceeds the 16 KiB shell input limit.',
		SHELL_TOO_MANY_TOKENS: 'The command contains too many arguments.',
		SHELL_TRAILING_ESCAPE: 'The command ends with an incomplete escape.',
		SHELL_UNTERMINATED_QUOTE: 'The command contains an unterminated quote.',
	};
	return `Error: ${messages[code] ?? 'The shell command is invalid.'}`;
}

function isTtyStream(stream: NodeJS.ReadableStream | NodeJS.WritableStream): boolean {
	return 'isTTY' in stream && stream.isTTY === true;
}
