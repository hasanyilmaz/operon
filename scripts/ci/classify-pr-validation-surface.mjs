import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_SENSITIVE_FILES = new Set([
	'CHANGELOG.md',
	'esbuild.config.mjs',
	'manifest.json',
	'package-lock.json',
	'package.json',
	'scripts/check-release-audit-policy.mjs',
	'scripts/check-release-audit-policy.test.mjs',
	'scripts/release-guard.mjs',
	'src/generated/locale-pack-catalog.json',
	'src/generated/reminder-sound-pack-catalog.json',
	'styles.css',
	'versions.json',
]);

const RELEASE_SENSITIVE_PREFIXES = [
	'.github/workflows/',
	'i18n/locales/',
	'release-assets/',
	'scripts/ci/',
	'scripts/release/',
	'scripts/agent-runtime/cli/check-cli-compat',
	'scripts/validate-windows-plugin',
];

const CLI_COMPATIBILITY_FILES = new Set([
	'contracts/agent-runtime/cli-cutover-v1.json',
	'contracts/agent-runtime/cli-cutover-v1.schema.json',
	'contracts/agent-runtime/public-v1-external-freeze.json',
	'contracts/agent-runtime/public-v1-external-freeze.schema.json',
	'contracts/agent-runtime/public-v1-live-acceptance.json',
	'.github/workflows/cli-external-compatibility.yml',
	'contracts/agent-runtime/public-v1-release-freezes.json',
]);

const CLI_COMPATIBILITY_PREFIXES = [
	'contracts/agent-runtime/public-v1-freeze',
	'contracts/agent-runtime/releases/',
	'contracts/agent-runtime/published-cli-v1',
	'scripts/agent-runtime/cli/check-cli-cutover',
	'scripts/agent-runtime/cli/check-package-contracts',
	'scripts/agent-runtime/cli/check-published-cli-',
	'scripts/agent-runtime/cli/cli-cutover-v1',
	'scripts/agent-runtime/cli/external-cli-workflow',
	'scripts/agent-runtime/cli/published-cli-v1',
	'scripts/agent-runtime/cli/public-docs',
	'scripts/agent-runtime/cli/run-meeting-agent-acceptance',
	'scripts/agent-runtime/cli/schema-entrypoints',
	'scripts/release/fixtures/legacy-cli-',
	'scripts/release/check-accepted-freeze',
	'scripts/release/check-release-freeze-registry',
	'scripts/release/run-published-cli-live-acceptance',
	'scripts/release/write-external-freeze',
	'scripts/release/evidence-seal-v3',
];

const RUNTIME_CONTRACT_SENSITIVE_FILES = new Set([
	'contracts/agent-runtime/contract-evolution-v1.md',
	'contracts/agent-runtime/public-v1-baseline.json',
	'contracts/agent-runtime/public-v1-scope.md',
]);

const RUNTIME_CONTRACT_SENSITIVE_PREFIXES = [
	'contracts/agent-runtime/v1/',
	'scripts/agent-runtime/contracts/',
	'src/agent-runtime/contracts/',
];

function isPrefixedBy(relativePath, prefixes) {
	return prefixes.some(prefix => relativePath.startsWith(prefix));
}

export function classifyPullRequestValidationSurface(paths) {
	const changedPaths = [...new Set(paths)]
		.filter(relativePath => typeof relativePath === 'string' && relativePath.length > 0)
		.sort();
	const cliCompatibilityPaths = changedPaths.filter(relativePath => (
		CLI_COMPATIBILITY_FILES.has(relativePath)
		|| isPrefixedBy(relativePath, CLI_COMPATIBILITY_PREFIXES)
	));
	const pluginReleasePaths = changedPaths.filter(relativePath => (
		!cliCompatibilityPaths.includes(relativePath)
		&& (
			RELEASE_SENSITIVE_FILES.has(relativePath)
			|| isPrefixedBy(relativePath, RELEASE_SENSITIVE_PREFIXES)
		)
	));
	const runtimeContractPaths = changedPaths.filter(relativePath => (
		!cliCompatibilityPaths.includes(relativePath)
		&& (
			RUNTIME_CONTRACT_SENSITIVE_FILES.has(relativePath)
			|| isPrefixedBy(relativePath, RUNTIME_CONTRACT_SENSITIVE_PREFIXES)
		)
	));
	const cliCompatReview = cliCompatibilityPaths.length > 0;
	const runtimeContractReview = !cliCompatReview && runtimeContractPaths.length > 0;
	const runtimeBaselineMutation = runtimeContractPaths.includes('contracts/agent-runtime/public-v1-baseline.json');
	const pluginReleaseGuard = !cliCompatReview && (
		pluginReleasePaths.length > 0 || runtimeContractReview
	);
	return Object.freeze({
		classification: cliCompatReview
			? 'cli-compat-required'
			: runtimeContractReview
				? 'runtime-contract-sensitive'
			: pluginReleaseGuard
				? 'plugin-release-sensitive'
				: 'normal-plugin',
		pluginReleaseGuard,
		cliCompatReview,
		runtimeContractReview,
		runtimeBaselineMutation,
	});
}

export function parseCliArguments(arguments_) {
	if (arguments_.length !== 4 || arguments_[0] !== '--base' || arguments_[2] !== '--head') {
		throw new Error('Usage: classify-pr-validation-surface.mjs --base <40-character-sha> --head <40-character-sha>');
	}
	const [, baseSha, , headSha] = arguments_;
	for (const [label, value] of [['base', baseSha], ['head', headSha]]) {
		if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be a 40-character lowercase Git SHA.`);
	}
	return { baseSha, headSha };
}

export function changedPathsBetween(baseSha, headSha, executeGit = defaultExecuteGit) {
	try {
		return executeGit([
			'diff',
			'--no-ext-diff',
			'--no-renames',
			'--name-only',
			'-z',
			'--merge-base',
			baseSha,
			headSha,
		]).toString('utf8').split('\0').filter(Boolean);
	} catch (error) {
		throw new Error('OPERON_PR_MERGE_BASE_UNAVAILABLE: update the branch with its target base before classifying validation paths.', { cause: error });
	}
}

function defaultExecuteGit(arguments_) {
	return execFileSync('git', arguments_, { encoding: 'buffer' });
}

export function formatGitHubOutput(classification) {
	return [
		`classification=${classification.classification}`,
		`plugin_release_guard=${classification.pluginReleaseGuard}`,
		`cli_compat_review=${classification.cliCompatReview}`,
		`runtime_contract_review=${classification.runtimeContractReview}`,
		`runtime_baseline_mutation=${classification.runtimeBaselineMutation}`,
	].join('\n');
}

export function main(options = {}) {
	const { baseSha, headSha } = parseCliArguments(options.argv ?? process.argv.slice(2));
	const changedPaths = changedPathsBetween(baseSha, headSha, options.executeGit);
	const output = `${formatGitHubOutput(classifyPullRequestValidationSurface(changedPaths))}\n`;
	(options.write ?? process.stdout.write.bind(process.stdout))(output);
}

const scriptPath = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] ?? '') === scriptPath) main();
