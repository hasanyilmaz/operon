import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, lstatSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_NODE_VERSION = 'v24.18.0';
const EXPECTED_NPM_VERSION = '11.12.1';
const PORTABILITY_NEEDLE = 'new URL(import.meta.url).pathname';

export function assertCanonicalWindowsCandidateContext(context) {
	if (context.platform !== 'win32') {
		throw new Error('Windows candidate validation requires a native Windows host.');
	}
	if (context.nodeVersion !== EXPECTED_NODE_VERSION) {
		throw new Error(`Expected Node ${EXPECTED_NODE_VERSION}, received ${context.nodeVersion}.`);
	}
	if (context.npmVersion !== EXPECTED_NPM_VERSION) {
		throw new Error(`Expected npm ${EXPECTED_NPM_VERSION}, received ${context.npmVersion}.`);
	}
	if (!/^[0-9a-f]{40}$/u.test(context.headSha)) {
		throw new Error(`Expected an exact 40-character Git HEAD SHA, received ${context.headSha}.`);
	}
}

export function runCandidateValidationSteps(operations) {
	let validationError = null;
	try {
		operations.assertTrackedClean('preflight');
		operations.installDependencies();
		operations.assertTrackedClean('post-install');
		operations.assertUrlPortable();
		operations.runCandidateCheck();
		operations.runRequiredNativeTransport();
	} catch (error) {
		validationError = error;
	}

	let postflightError = null;
	try {
		operations.assertTrackedClean('postflight');
	} catch (error) {
		postflightError = error;
	}

	if (validationError && postflightError) {
		throw new AggregateError(
			[validationError, postflightError],
			'Windows candidate validation and tracked-state postflight both failed.',
		);
	}
	if (validationError) throw validationError;
	if (postflightError) throw postflightError;
}

function execute(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}.`);
	}
	return (result.stdout ?? '').trim();
}

function executeInherited(command, args, env = process.env) {
	execute(command, args, { env, stdio: 'inherit' });
}

function executeCapturedAndForwarded(command, args, env = process.env) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		env,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}.`);
	}
	return result.stdout ?? '';
}

function resolveNpmVersion() {
	const npmExecPath = process.env.npm_execpath;
	if (!npmExecPath) {
		throw new Error('npm_execpath is unavailable; run this validator through npm.');
	}
	return execute(process.execPath, [npmExecPath, '--version']);
}

function assertTrackedClean(label) {
	try {
		executeInherited('git', ['diff', '--exit-code']);
		executeInherited('git', ['diff', '--cached', '--exit-code']);
	} catch (error) {
		throw new Error(`Tracked worktree is not clean during ${label}.`, { cause: error });
	}
}

function assertUrlPortable() {
	const result = spawnSync('git', [
		'grep',
		'-n',
		'-F',
		PORTABILITY_NEEDLE,
		'--',
		'*.mjs',
		'*.ts',
	], {
		cwd: process.cwd(),
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	if (result.status === 1) return;
	if (result.status === 0) {
		if (result.stdout) process.stderr.write(result.stdout);
		throw new Error('Tracked runner still uses URL.pathname.');
	}
	throw new Error(`git grep portability guard exited with status ${result.status ?? 'unknown'}.`);
}

function runNpmScript(name, extraEnvironment = {}, captureOutput = false) {
	const npmExecPath = process.env.npm_execpath;
	if (!npmExecPath) {
		throw new Error('npm_execpath is unavailable; run this validator through npm.');
	}
	const environment = {
		...process.env,
		...extraEnvironment,
	};
	if (captureOutput) {
		return executeCapturedAndForwarded(process.execPath, [npmExecPath, 'run', name], environment);
	}
	executeInherited(process.execPath, [npmExecPath, 'run', name], environment);
	return '';
}

function installDependencies() {
	const npmExecPath = process.env.npm_execpath;
	if (!npmExecPath) {
		throw new Error('npm_execpath is unavailable; run this validator through npm.');
	}
	executeInherited(process.execPath, [npmExecPath, 'ci']);
}

export function writeReceiptAtomically(receipt, requestedPath, repositoryRoot) {
	if (!requestedPath) return;
	if (!path.isAbsolute(requestedPath)) {
		throw new Error('OPERON_WINDOWS_CANDIDATE_RECEIPT must be an absolute path.');
	}
	const targetPath = path.resolve(requestedPath);
	const physicalRepositoryRoot = realpathSync.native(repositoryRoot);
	const physicalTargetPath = path.join(realpathSync.native(path.dirname(targetPath)), path.basename(targetPath));
	const relativePath = path.relative(physicalRepositoryRoot, physicalTargetPath);
	const insideRepository = relativePath === '' || (
		relativePath !== '..'
		&& !relativePath.startsWith(`..${path.sep}`)
		&& !path.isAbsolute(relativePath)
	);
	if (insideRepository) {
		throw new Error('OPERON_WINDOWS_CANDIDATE_RECEIPT must be outside the repository.');
	}
	if (existsSync(targetPath)) {
		throw new Error('OPERON_WINDOWS_CANDIDATE_RECEIPT already exists.');
	}
	const parentStat = lstatSync(path.dirname(targetPath));
	if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
		throw new Error('OPERON_WINDOWS_CANDIDATE_RECEIPT parent must be a real directory.');
	}
	const temporaryPath = path.join(
		path.dirname(targetPath),
		`.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
		linkSync(temporaryPath, targetPath);
	} finally {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// The temporary receipt was never created or was already removed.
		}
	}
}

export function parseRequiredNativeSummary(output) {
	const summaries = output
		.split(/\r?\n/u)
		.map(line => line.trim())
		.filter(line => line.startsWith('{'))
		.flatMap(line => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		})
		.filter(value => value?.kind === 'operon-native-transport-summary');
	if (summaries.length !== 1) {
		throw new Error(`Expected exactly one native transport summary, received ${summaries.length}.`);
	}
	const [summary] = summaries;
	if (
		summary.platform !== 'win32'
		|| summary.requiredNative !== true
		|| summary.summaryParseable !== true
		|| !Number.isSafeInteger(summary.tests)
		|| summary.tests <= 0
		|| summary.fail !== 0
		|| summary.cancelled !== 0
		|| summary.skipped !== 0
	) {
		throw new Error('Native transport summary does not prove required Windows validation with zero skips.');
	}
	return {
		tests: summary.tests,
		fail: summary.fail,
		cancelled: summary.cancelled,
		skipped: summary.skipped,
	};
}

function artifactEvidence(filePath, includeBytes = false) {
	const contents = readFileSync(filePath);
	return {
		...(includeBytes ? { bytes: statSync(filePath).size } : {}),
		sha256: createHash('sha256').update(contents).digest('hex'),
	};
}

export function main() {
	const repositoryRoot = execute('git', ['rev-parse', '--show-toplevel']);
	const headSha = execute('git', ['rev-parse', 'HEAD']);
	const npmVersion = resolveNpmVersion();
	assertCanonicalWindowsCandidateContext({
		platform: process.platform,
		nodeVersion: process.version,
		npmVersion,
		headSha,
	});

	let nativeSummary = null;
	runCandidateValidationSteps({
		assertTrackedClean,
		installDependencies,
		assertUrlPortable,
		runCandidateCheck: () => runNpmScript('check:candidate', {
			OPERON_TASK_FINDER_PERFORMANCE_MODE: 'diagnostic',
		}),
		runRequiredNativeTransport: () => {
			const output = runNpmScript('agent-runtime:transport:native:test', {
				OPERON_REQUIRE_NATIVE_TRANSPORT: '1',
			}, true);
			nativeSummary = parseRequiredNativeSummary(output);
		},
	});

	const receipt = {
		kind: 'operon-windows-candidate-validation',
		receiptVersion: 1,
		schemaVersion: 1,
		status: 'passed',
		repository: 'hasanyilmaz/operon',
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.version,
		npmVersion,
		toolchain: { node: process.version, npm: npmVersion },
		headSha,
		dependencyInstall: 'passed',
		trackedState: 'clean',
		urlPortability: 'passed',
		candidateCheck: 'passed',
		requiredNativeTransport: 'passed',
		nativeSummary,
		artifacts: {
			mainJs: artifactEvidence(path.join(repositoryRoot, 'main.js'), true),
			manifestJson: artifactEvidence(path.join(repositoryRoot, 'manifest.json')),
			stylesCss: artifactEvidence(path.join(repositoryRoot, 'styles.css')),
		},
		releaseEligible: false,
	};
	writeReceiptAtomically(
		receipt,
		process.env.OPERON_WINDOWS_CANDIDATE_RECEIPT,
		repositoryRoot,
	);
	process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
