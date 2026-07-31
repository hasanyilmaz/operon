import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const numberFormatter = new Intl.NumberFormat('en-US');

const FORBIDDEN_PRODUCTION_INPUTS = Object.freeze([
	{
		id: 'cli-package',
		pattern: /(?:^|\/)packages\/operon-cli(?:\/|$)/u,
	},
	{
		id: 'build-or-test-script',
		pattern: /(?:^|\/)scripts(?:\/|$)/u,
	},
	{
		id: 'canonical-schema-document',
		pattern: /(?:^|\/)contracts\/agent-runtime(?:\/|$)/u,
	},
	{
		id: 'generated-documentation',
		pattern: /(?:^|\/)docs(?:\/|$)/u,
	},
	{
		id: 'test-or-fixture',
		pattern: /(?:^|\/)(?:__tests__|test|tests|testing|fixtures)(?:\/|$)|(?:^|\/)(?:fixture|test)-[^/]*\.[cm]?[jt]sx?$|(?:^|\/)[^/]*(?:-fixture|\.fixture|\.test-helper)\.[cm]?[jt]sx?$|(?:^|\/)fixtures\.[^/]*\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/u,
	},
	{
		id: 'detailed-acceptance-metadata',
		pattern: /(?:^|\/)mutation-acceptance\.[cm]?[jt]sx?$/u,
	},
]);

function normalizeInputPath(inputPath) {
	return inputPath.replaceAll('\\', '/');
}

function subgroupForAgentRuntimeInput(inputPath) {
	const marker = 'src/agent-runtime/';
	const markerIndex = inputPath.indexOf(marker);
	const relativePath = markerIndex >= 0 ? inputPath.slice(markerIndex + marker.length) : '';
	const [firstSegment] = relativePath.split('/');
	if (
		firstSegment === 'contracts'
		|| firstSegment === 'developer-api'
		|| firstSegment === 'public'
		|| firstSegment === 'runtime'
		|| firstSegment === 'transport'
	) {
		return firstSegment;
	}
	return 'other';
}

export function analyzeProductionBundleMetafile(metafile, topCount = 20) {
	if (!metafile || typeof metafile !== 'object' || !metafile.outputs) {
		throw new Error('OPERON_PRODUCTION_METAFILE_INVALID');
	}
	if (!Number.isSafeInteger(topCount) || topCount < 1) {
		throw new Error('OPERON_PRODUCTION_METAFILE_TOP_COUNT_INVALID');
	}

	const outputEntries = Object.entries(metafile.outputs);
	const mainEntryOutputs = outputEntries.filter(([, output]) => {
		const entryPoint = normalizeInputPath(output.entryPoint ?? '');
		return entryPoint === 'main.ts' || entryPoint.endsWith('/main.ts');
	});
	if (mainEntryOutputs.length === 0) throw new Error('OPERON_PRODUCTION_MAIN_OUTPUT_MISSING');
	if (mainEntryOutputs.length > 1) throw new Error('OPERON_PRODUCTION_MAIN_OUTPUT_AMBIGUOUS');

	const [outputPath, output] = mainEntryOutputs[0];
	const normalizedOutputPath = normalizeInputPath(outputPath);
	if (normalizedOutputPath !== 'main.js' && !normalizedOutputPath.endsWith('/main.js')) {
		throw new Error('OPERON_PRODUCTION_MAIN_OUTPUT_INVALID');
	}
	if (!Number.isSafeInteger(output.bytes) || output.bytes < 0 || !output.inputs) {
		throw new Error('OPERON_PRODUCTION_MAIN_OUTPUT_INVALID');
	}

	const inputs = Object.entries(output.inputs).map(([inputPath, contribution]) => ({
		path: normalizeInputPath(inputPath),
		bytes: contribution.bytesInOutput ?? 0,
	}));
	const agentRuntimeInputs = inputs.filter(input => (
		input.path.startsWith('src/agent-runtime/')
		|| input.path.includes('/src/agent-runtime/')
	));
	const subgroupBytes = Object.fromEntries(
		['contracts', 'developer-api', 'public', 'runtime', 'transport', 'other']
			.map(subgroup => [
				subgroup,
				agentRuntimeInputs
					.filter(input => subgroupForAgentRuntimeInput(input.path) === subgroup)
					.reduce((total, input) => total + input.bytes, 0),
			]),
	);
	const forbiddenInputs = inputs.flatMap(input => (
		FORBIDDEN_PRODUCTION_INPUTS
			.filter(definition => definition.pattern.test(input.path))
			.map(definition => ({ id: definition.id, path: input.path }))
	));
	const agentRuntimeBytes = agentRuntimeInputs.reduce((total, input) => total + input.bytes, 0);

	return {
		outputPath: normalizedOutputPath,
		totalBytes: output.bytes,
		agentRuntime: {
			bytes: agentRuntimeBytes,
			percent: output.bytes === 0 ? 0 : (agentRuntimeBytes / output.bytes) * 100,
			subgroups: subgroupBytes,
			topContributors: agentRuntimeInputs
				.toSorted((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path))
				.slice(0, topCount),
		},
		forbiddenInputs,
	};
}

export function formatProductionBundleAnalysis(analysis) {
	const lines = [
		`Operon production bundle: ${numberFormatter.format(analysis.totalBytes)} bytes (${analysis.outputPath})`,
		`Agent Runtime: ${numberFormatter.format(analysis.agentRuntime.bytes)} bytes `
			+ `(${analysis.agentRuntime.percent.toFixed(2)}%)`,
		'Agent Runtime subgroups:',
	];
	for (const [subgroup, bytes] of Object.entries(analysis.agentRuntime.subgroups)) {
		lines.push(`  ${subgroup}: ${numberFormatter.format(bytes)} bytes`);
	}
	lines.push('Top Agent Runtime contributors:');
	for (const contributor of analysis.agentRuntime.topContributors) {
		lines.push(`  ${numberFormatter.format(contributor.bytes)} bytes  ${contributor.path}`);
	}
	if (analysis.forbiddenInputs.length === 0) {
		lines.push('Forbidden production inputs: none');
	} else {
		lines.push('Forbidden production inputs:');
		for (const input of analysis.forbiddenInputs) {
			lines.push(`  ${input.id}: ${input.path}`);
		}
	}
	return lines.join('\n');
}

async function buildProductionMetafile(metafilePath) {
	const result = spawnSync(
		process.execPath,
		['esbuild.config.mjs', 'production'],
		{
			cwd: pluginRoot,
			env: { ...process.env, OPERON_ESBUILD_METAFILE: metafilePath },
			stdio: 'inherit',
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`OPERON_PRODUCTION_BUILD_FAILED:${result.status ?? 'signal'}`);
	}
}

function parseArguments(argv) {
	let metafilePath = '';
	let json = false;
	let topCount = 20;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--json') {
			json = true;
		} else if (argument === '--metafile') {
			metafilePath = argv[index + 1] ?? '';
			index += 1;
		} else if (argument === '--top') {
			topCount = Number(argv[index + 1]);
			index += 1;
		} else {
			throw new Error(`OPERON_PRODUCTION_ANALYSIS_ARGUMENT_UNKNOWN:${argument}`);
		}
	}
	if (!Number.isSafeInteger(topCount) || topCount < 1) {
		throw new Error('OPERON_PRODUCTION_METAFILE_TOP_COUNT_INVALID');
	}
	return { json, metafilePath, topCount };
}

export async function runProductionBundleAnalysis(argv = process.argv.slice(2)) {
	const options = parseArguments(argv);
	const generatedMetafilePath = path.join(
		tmpdir(),
		`operon-production-metafile-${process.pid}-${Date.now()}.json`,
	);
	const metafilePath = options.metafilePath
		? path.resolve(pluginRoot, options.metafilePath)
		: generatedMetafilePath;
	try {
		if (!options.metafilePath) await buildProductionMetafile(metafilePath);
		const metafile = JSON.parse(await readFile(metafilePath, 'utf8'));
		const analysis = analyzeProductionBundleMetafile(metafile, options.topCount);
		console.log(options.json
			? JSON.stringify(analysis, null, 2)
			: formatProductionBundleAnalysis(analysis));
		if (analysis.forbiddenInputs.length > 0) {
			throw new Error('OPERON_PRODUCTION_FORBIDDEN_INPUT');
		}
		return analysis;
	} finally {
		if (!options.metafilePath) await rm(generatedMetafilePath, { force: true });
	}
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
	await runProductionBundleAnalysis();
}
