import { appendFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
	runPublicCommandLineV1,
} from './command-line';
import { writePublicCommandOutcomeV1 } from './command-output';
import {
	createProcessInteractiveShellSessionV1,
	runInteractiveShellV1,
} from './interactive-shell';
import {
	isJsonlSessionArgsV1,
	runJsonlSessionV1,
} from './session-jsonl';
import { checkForCliUpdateV1 } from './update-check';

declare const __OPERON_CLI_FRAME_TIMING__: boolean;

export async function mainV1(argv: string[] = process.argv.slice(2)): Promise<number> {
	try {
		if (isJsonlSessionArgsV1(argv)) {
			const abortController = new AbortController();
			const abort = () => {
				abortController.abort();
				process.stdin.destroy();
			};
			process.once('SIGINT', abort);
			process.once('SIGTERM', abort);
			if (process.platform === 'win32') process.once('SIGBREAK', abort);
			try {
				return await runJsonlSessionV1({
					input: process.stdin,
					output: process.stdout,
					signal: abortController.signal,
					...persistentTransportEvidencePort(),
					...(__OPERON_CLI_FRAME_TIMING__
						&& process.env.OPERON_CLI_STAGE51_TIMING_FD === '3'
						? {
							frameTiming: (batch: unknown) => {
								writeFileSync(3, `${JSON.stringify(batch)}\n`, { encoding: 'utf8' });
							},
						}
						: {}),
				});
			} finally {
				process.removeListener('SIGINT', abort);
				process.removeListener('SIGTERM', abort);
				if (process.platform === 'win32') process.removeListener('SIGBREAK', abort);
			}
		}
			if (argv.length === 0) {
				const session = createProcessInteractiveShellSessionV1();
				if (session) {
					const updateNotice = await checkForCliUpdateV1().catch(() => null);
					return await runInteractiveShellV1({ session, updateNotice });
				}
			}
		const abortController = new AbortController();
		const abort = () => abortController.abort();
		process.once('SIGINT', abort);
		process.once('SIGTERM', abort);
		if (process.platform === 'win32') process.once('SIGBREAK', abort);
		try {
			const outcome = await runPublicCommandLineV1(argv, { signal: abortController.signal });
			writePublicCommandOutcomeV1(outcome, {
				stdout: process.stdout,
				stderr: process.stderr,
			});
			return outcome.exitCode;
		} finally {
			process.removeListener('SIGINT', abort);
			process.removeListener('SIGTERM', abort);
			if (process.platform === 'win32') process.removeListener('SIGBREAK', abort);
		}
	} catch {
		const message = 'Operon CLI encountered an unexpected internal failure.';
		if (argv.includes('--json')) {
			process.stdout.write(`${JSON.stringify({
				contractVersion: 1,
				kind: 'operon-cli-local-result',
				command: 'unknown',
				ok: false,
				error: { code: 'internal-error', reason: message },
			})}\n`);
		} else {
			process.stderr.write(`${message}\n`);
		}
		return 70;
	}
}

function persistentTransportEvidencePort(): {
	persistentTransportEvidence?: (evidence: unknown) => void;
} {
	const tracePath = process.env.OPERON_CLI_BENCHMARK_TRACE_PATH;
	if (
		!tracePath
		|| process.env.OPERON_CLI_BENCHMARK_TRANSPORT_EVIDENCE !== '1'
	) return {};
	if (
		!/^\/private\/tmp\/operon-cli-speed-[^/]+\/runtime-dispatches\.jsonl$/u.test(
			tracePath,
		)
	) return {};
	const destination = tracePath.replace(
		/runtime-dispatches\.jsonl$/u,
		'transport-selections.jsonl',
	);
	return {
		persistentTransportEvidence: evidence => {
			try {
				appendFileSync(
					destination,
					`${JSON.stringify(evidence)}\n`,
					{ encoding: 'utf8', mode: 0o600 },
				);
			} catch {
				// Benchmark-only evidence must never change the public session outcome.
			}
		},
	};
}

if (isMainModuleV1()) {
	void mainV1().then(exitCode => {
		process.exitCode = exitCode;
	}).catch(() => {
		process.exitCode = 70;
	});
}

function isMainModuleV1(): boolean {
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
	} catch {
		return false;
	}
}
