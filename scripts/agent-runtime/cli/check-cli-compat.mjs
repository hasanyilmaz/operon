import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../../..');

/**
 * The consumer compatibility lane is deliberately explicit. Plugin CI never
 * enters this command; callers supply the exact CLI tarball they want to audit.
 */
export async function runCliCompatibilityCheck(options = {}) {
	const arguments_ = parseCliCompatibilityArguments(options.argv ?? process.argv.slice(2));
	if (!existsSync(arguments_.tarballPath)) {
		throw new Error(`OPERON_CLI_COMPAT_TARBALL_NOT_FOUND:${arguments_.tarballPath}`);
	}
	const run = options.run ?? runNode;
	const script = relative => path.join(pluginRoot, relative);
	const tests = (...relativePaths) => run([
		'--test',
		...relativePaths.map(script),
	]);
	await tests(
		'scripts/agent-runtime/contracts/check-public-v1-baseline.test.mjs',
		'scripts/agent-runtime/contracts/check-historical-public-v1-freeze.test.mjs',
		'scripts/agent-runtime/cli/published-cli-v1.test.mjs',
		'scripts/agent-runtime/cli/cli-cutover-v1.test.mjs',
		'scripts/agent-runtime/cli/external-cli-workflow.test.mjs',
		'scripts/agent-runtime/cli/schema-entrypoints.test.mjs',
		'scripts/agent-runtime/cli/public-docs.test.mjs',
		'scripts/agent-runtime/cli/run-meeting-agent-acceptance.test.mjs',
		'scripts/release/run-published-cli-live-acceptance.test.mjs',
		'scripts/release/run-published-cli-stage7-performance.test.mjs',
	);
	await run([script('scripts/agent-runtime/cli/check-published-cli-binding.mjs')]);
	await run([script('scripts/agent-runtime/cli/check-cli-cutover.mjs')]);
	await run([script('scripts/agent-runtime/cli/check-package-contracts.mjs')]);
	await run([script('scripts/agent-runtime/contracts/check-public-v1-baseline.mjs'), '--check']);
	await run([script('scripts/agent-runtime/contracts/check-historical-public-v1-freeze.mjs')]);
	await run([
		script('scripts/agent-runtime/cli/check-published-cli-artifact.mjs'),
		'--tarball', arguments_.tarballPath,
		...(arguments_.legacyTarballPath ? ['--legacy-tarball', arguments_.legacyTarballPath] : []),
	]);
	await run([script('scripts/agent-runtime/cli/check-published-cli-public-proof.mjs')]);
	return Object.freeze({ status: 'ok', tarballPath: arguments_.tarballPath });
}

export function parseCliCompatibilityArguments(argv) {
	const allowed = new Set(['--tarball', '--legacy-tarball']);
	const values = {};
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		const value = argv[index + 1];
		if (!allowed.has(name) || typeof value !== 'string' || value.startsWith('--') || Object.hasOwn(values, name)) {
			throw new Error('OPERON_CLI_COMPAT_USAGE');
		}
		values[name] = value;
	}
	if (!values['--tarball']) throw new Error('OPERON_CLI_COMPAT_USAGE');
	return Object.freeze({
		tarballPath: path.resolve(values['--tarball']),
		...(values['--legacy-tarball'] ? { legacyTarballPath: path.resolve(values['--legacy-tarball']) } : {}),
	});
}

function runNode(arguments_) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, arguments_, {
			cwd: pluginRoot,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('close', code => {
			if (code === 0) resolve();
			else reject(new Error(`OPERON_CLI_COMPAT_STEP_FAILED:${code ?? 'signal'}`));
		});
	});
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await runCliCompatibilityCheck();
	process.stdout.write(`${JSON.stringify(result)}\n`);
}
