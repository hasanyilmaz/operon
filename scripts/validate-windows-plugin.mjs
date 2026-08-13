import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EXPECTED_NODE_VERSION = 'v24.18.0';
const EXPECTED_NPM_VERSION = '11.12.1';
const PORTABILITY_NEEDLE = ['new URL(import.meta.url)', '.pathname'].join('');

export function assertCanonicalWindowsPluginContext(context) {
	if (context.platform !== 'win32') throw new Error('Windows Plugin validation requires a native Windows host.');
	if (context.nodeVersion !== EXPECTED_NODE_VERSION) throw new Error(`Expected Node ${EXPECTED_NODE_VERSION}, received ${context.nodeVersion}.`);
	if (context.npmVersion !== EXPECTED_NPM_VERSION) throw new Error(`Expected npm ${EXPECTED_NPM_VERSION}, received ${context.npmVersion}.`);
	if (!/^[0-9a-f]{40}$/u.test(context.headSha)) throw new Error(`Expected an exact 40-character Git HEAD SHA, received ${context.headSha}.`);
}

export function runWindowsPluginValidationSteps(operations) {
	let validationError = null;
	try {
		operations.assertTrackedClean('preflight');
		operations.installDependencies();
		operations.assertTrackedClean('post-install');
		operations.assertUrlPortable();
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
		throw new AggregateError([validationError, postflightError], 'Windows Plugin validation and tracked-state postflight both failed.');
	}
	if (validationError) throw validationError;
	if (postflightError) throw postflightError;
}

function execute(command, arguments_, options = {}) {
	const result = spawnSync(command, arguments_, { cwd: process.cwd(), encoding: 'utf8', ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${arguments_.join(' ')} exited with status ${result.status ?? 'unknown'}.`);
	return (result.stdout ?? '').trim();
}

function npmInvocation() {
	if (!process.env.npm_execpath) throw new Error('npm_execpath is unavailable; run this validator through npm.');
	return process.env.npm_execpath;
}

function runNpmScript(name, extraEnvironment = {}, captureOutput = false) {
	const environment = { ...process.env, ...extraEnvironment };
	const arguments_ = [npmInvocation(), 'run', name];
	if (captureOutput) {
		const result = spawnSync(process.execPath, arguments_, {
			cwd: process.cwd(),
			encoding: 'utf8',
			env: environment,
			maxBuffer: 64 * 1024 * 1024,
		});
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`npm run ${name} exited with status ${result.status ?? 'unknown'}.`);
		return result.stdout ?? '';
	}
	execute(process.execPath, arguments_, { env: environment, stdio: 'inherit' });
	return '';
}

function assertTrackedClean(label) {
	try {
		execute('git', ['diff', '--exit-code'], { stdio: 'inherit' });
		execute('git', ['diff', '--cached', '--exit-code'], { stdio: 'inherit' });
	} catch (error) {
		throw new Error(`Tracked worktree is not clean during ${label}.`, { cause: error });
	}
}

function assertUrlPortable() {
	const result = spawnSync('git', ['grep', '-n', '-F', PORTABILITY_NEEDLE, '--', '*.mjs', '*.ts'], {
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

function installDependencies() {
	execute(process.execPath, [npmInvocation(), 'ci'], { stdio: 'inherit' });
}

function parseRequiredNativeSummary(output) {
	const summaries = output.split(/\r?\n/u)
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
	if (summaries.length !== 1) throw new Error(`Expected exactly one native transport summary, received ${summaries.length}.`);
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
	) throw new Error('Native transport summary does not prove required Windows validation with zero skips.');
	return { tests: summary.tests, fail: summary.fail, cancelled: summary.cancelled, skipped: summary.skipped };
}

export function main() {
	const headSha = execute('git', ['rev-parse', 'HEAD']);
	const npmVersion = execute(process.execPath, [npmInvocation(), '--version']);
	assertCanonicalWindowsPluginContext({
		platform: process.platform,
		nodeVersion: process.version,
		npmVersion,
		headSha,
	});
	let nativeSummary;
	runWindowsPluginValidationSteps({
		assertTrackedClean,
		installDependencies,
		assertUrlPortable,
		runRequiredNativeTransport: () => {
			nativeSummary = parseRequiredNativeSummary(runNpmScript('agent-runtime:transport:native:test', {
				OPERON_REQUIRE_NATIVE_TRANSPORT: '1',
			}, true));
		},
	});
	process.stdout.write(`${JSON.stringify({
		kind: 'operon-windows-plugin-validation',
		status: 'passed',
		headSha,
		nativeSummary,
	})}\n`);
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
