import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
	OPERON_CLI_EXECUTABLE_HARD_LIMIT_BYTES,
	OPERON_CLI_EXECUTABLE_REVIEW_DELTA_BYTES,
	OPERON_CLI_EXECUTABLE_SOFT_LIMIT_BYTES,
	classifyOperonCliExecutableSize,
	requiresOperonCliBundleContributorReview,
} from '../../../packages/operon-cli/size-policy.mjs';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const packageRoot = path.join(pluginRoot, 'packages', 'operon-cli');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-package-'));
const cacheRoot = path.join(tempRoot, 'npm-cache');
const packRoot = path.join(tempRoot, 'pack');
const prefixRoot = path.join(tempRoot, 'prefix');
const homeRoot = path.join(tempRoot, 'home');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = {
	...process.env,
	HOME: homeRoot,
	npm_config_cache: cacheRoot,
	OPERON_CONFIG_HOME: path.join(tempRoot, 'config'),
};
let typedGoldenCaseIds = [];

try {
	execFileSync(process.execPath, ['build.mjs'], { cwd: packageRoot, env, stdio: 'inherit' });
	const packageDocument = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
	const typedCreateGolden = JSON.parse(await readFile(
		path.join(pluginRoot, 'scripts', 'agent-runtime', 'fixtures', 'typed-create-golden.json'),
		'utf8',
	));
	assert.equal(packageDocument.name, 'operon-cli');
		assert.match(packageDocument.version, /^\d+\.\d+\.\d+$/u);
	assert.equal(packageDocument.license, 'GPL-3.0-or-later');
	assert.equal(packageDocument.private, undefined);
	assert.equal(packageDocument.engines.node, '^22.0.0 || ^24.0.0 || ^26.0.0');
	assert.deepEqual(packageDocument.bin, { operon: './dist/operon.mjs' });
	assert.deepEqual(packageDocument.exports, {
		'./contracts/v1': {
			types: './types/src/agent-runtime/public/v1/index.d.ts',
			default: null,
		},
		'./contracts/v1/developer-api': {
			types: './types/src/agent-runtime/public/v1/developer-api.d.ts',
			default: null,
		},
		'./contracts/v1/cli': {
			types: './types/src/agent-runtime/public/v1/cli.d.ts',
			default: null,
		},
	});
	assert.deepEqual(packageDocument.typesVersions, {
		'*': {
			'contracts/v1': ['types/src/agent-runtime/public/v1/index.d.ts'],
			'contracts/v1/developer-api': [
				'types/src/agent-runtime/public/v1/developer-api.d.ts',
			],
			'contracts/v1/cli': ['types/src/agent-runtime/public/v1/cli.d.ts'],
			'*': ['types/not-exported.d.ts'],
		},
	});
	assert.deepEqual(packageDocument.publishConfig, { access: 'public', provenance: true });
	assert.deepEqual(packageDocument.repository, {
		type: 'git',
		url: 'git+https://github.com/hasanyilmaz/operon.git',
		directory: 'packages/operon-cli',
	});
	assert.equal(packageDocument.dependencies, undefined);
	assert.equal(packageDocument.optionalDependencies, undefined);
	assert.deepEqual(packageDocument.scripts, {
		build: 'node build.mjs',
		prepack: 'npm run build',
		'types:write': 'node type-build.mjs --write',
		'types:check': 'node type-build.mjs --check',
		'types:consumer:test': 'node type-consumer.test.mjs',
	});
	assert.deepEqual(packageDocument.files, [
		'dist/**/*.mjs',
		'schemas/v1/*.json',
		'types/**/*.d.ts',
		'examples/developer-api-consumer/**',
		'cli-manifest-v1.json',
		'README.md',
		'LICENSE',
	]);

	const executablePath = path.join(packageRoot, 'dist', 'operon.mjs');
	assert.equal(classifyOperonCliExecutableSize(899_999), 'ok');
	assert.equal(classifyOperonCliExecutableSize(900_000), 'warn');
	assert.equal(classifyOperonCliExecutableSize(999_999), 'warn');
	assert.equal(classifyOperonCliExecutableSize(1_000_000), 'fail');
	assert.equal(OPERON_CLI_EXECUTABLE_SOFT_LIMIT_BYTES, 900_000);
	assert.equal(OPERON_CLI_EXECUTABLE_HARD_LIMIT_BYTES, 1_000_000);
	assert.equal(OPERON_CLI_EXECUTABLE_REVIEW_DELTA_BYTES, 25_000);
	assert.equal(requiresOperonCliBundleContributorReview(25_000), false);
	assert.equal(requiresOperonCliBundleContributorReview(25_001), true);
	assert.notEqual(
		classifyOperonCliExecutableSize((await stat(executablePath)).size),
		'fail',
	);
	const sourceFiles = await readdir(path.join(packageRoot, 'src'));
	for (const fileName of sourceFiles) {
		const source = await readFile(path.join(packageRoot, 'src', fileName), 'utf8');
		assert.ok(
			!source.includes(packageDocument.version),
			`CLI version must not be duplicated in production source: ${fileName}`,
		);
	}

	const manifest = JSON.parse(await readFile(path.join(packageRoot, 'cli-manifest-v1.json'), 'utf8'));
	const manifestSchema = JSON.parse(
		await readFile(path.join(packageRoot, 'schemas', 'v1', 'cli-manifest.schema.json'), 'utf8'),
	);
	const manifestAjv = new Ajv2020({ strict: true });
	manifestAjv.addKeyword({ keyword: 'x-operon-uniqueBy', schemaType: 'string' });
	manifestAjv.addKeyword({ keyword: 'x-operon-knownValues', schemaType: 'array' });
	const validateManifest = manifestAjv.compile(manifestSchema);
	assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
	const legacyManifest = structuredClone(manifest);
	delete legacyManifest.convenienceContracts['task.update'].compactUpdateVersion;
	delete legacyManifest.convenienceContracts['task.update'].compactUpdateFeatures;
	delete legacyManifest.convenienceContracts['task.update'].compactUpdateBatchVersion;
	delete legacyManifest.convenienceContracts['task.update'].compactUpdateBatchInputFormat;
	delete legacyManifest.convenienceContracts['task.update'].compactUpdateBatchMaxItems;
	delete legacyManifest.convenienceContracts['task.update'].compactUpdateBatchFeatures;
	for (const command of ['task.transition', 'task.complete', 'task.reopen', 'task.cancel']) {
		delete legacyManifest.convenienceContracts[command].directTransitionVersion;
		delete legacyManifest.convenienceContracts[command].directTransitionActions;
	}
	for (const command of ['reminder.add', 'reminder.replace', 'reminder.remove']) {
		delete legacyManifest.convenienceContracts[command].directReminderVersion;
		delete legacyManifest.convenienceContracts[command].directReminderFeatures;
	}
	for (const command of ['task.pin', 'task.unpin']) {
		delete legacyManifest.convenienceContracts[command].directPinnedVersion;
		delete legacyManifest.convenienceContracts[command].directPinnedActions;
		delete legacyManifest.convenienceContracts[command].directPinnedFeatures;
	}
	for (const command of ['task.relocate', 'task.convert', 'task.delete']) {
		delete legacyManifest.convenienceContracts[command].sourceTransitionRecoveryVersion;
		delete legacyManifest.convenienceContracts[command].sourceTransitionRecoveryFeatures;
	}
	assert.equal(validateManifest(legacyManifest), true, JSON.stringify(validateManifest.errors));
	const convenienceContractAjv = new Ajv2020({ strict: true });
	convenienceContractAjv.addKeyword({ keyword: 'x-operon-uniqueBy', schemaType: 'string' });
	convenienceContractAjv.addKeyword({ keyword: 'x-operon-knownValues', schemaType: 'array' });
	convenienceContractAjv.addSchema(manifestSchema);
	const validateGenericConvenienceContract = convenienceContractAjv.getSchema(
		manifestSchema.$id + '#/$defs/convenienceContract',
	);
	assert.ok(validateGenericConvenienceContract);
	assert.equal(validateGenericConvenienceContract({
		mutationKind: 'task.update',
		targetPolicy: 'required',
		intentSchema: 'mutation-intent',
		previewResultSchema: 'mutation-preview-result',
		applyResultSchema: 'mutation-result',
	}), true, JSON.stringify(validateGenericConvenienceContract.errors));
	for (const invalid of [
		{ ...structuredClone(manifest), projections: [...manifest.projections, 'arbitrary'] },
		{ ...structuredClone(manifest), exitCodes: { ...manifest.exitCodes, success: 99 } },
		{
			...structuredClone(manifest),
			runtimeCapabilities: { ...manifest.runtimeCapabilities, health: 'rm.everything' },
		},
		{
			...structuredClone(manifest),
			runtimeContracts: {
				...manifest.runtimeContracts,
				health: { ...manifest.runtimeContracts.health, resultSchema: 'bogus' },
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.update': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['task.update'],
				).filter(([key]) => key !== 'compactUpdateFeatures')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.update': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['task.update'],
				).filter(([key]) => key !== 'compactUpdateBatchMaxItems')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.relocate': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['task.relocate'],
				).filter(([key]) => key !== 'sourceTransitionRecoveryFeatures')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.convert': {
					...manifest.convenienceContracts['task.convert'],
					sourceTransitionRecoveryFeatures: [
						'same-plan-forward-continuation',
						'terminal-after-state-verification',
						'compare-aware-compensation',
						'cross-file-transition-journal',
					],
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.pin': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['task.pin'],
				).filter(([key]) => key !== 'directPinnedFeatures')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.transition': {
					...manifest.convenienceContracts['task.transition'],
					directTransitionActions: ['complete', 'cancel', 'reopen'],
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.complete': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['task.complete'],
				).filter(([key]) => key !== 'directTransitionVersion')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'reminder.add': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['reminder.add'],
				).filter(([key]) => key !== 'directReminderVersion')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.update': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['task.update'],
				).filter(([key]) => key !== 'compactUpdateVersion')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					inputFormats: ['compact', 'json'],
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					compactGrammarVersion: 2,
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					compactBatchMaxItems: 63,
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					typedCreateVersion: 2,
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					typedCreateFeatures: [
						'exact-file-target',
						'exact-inline-placement',
						'deterministic-file-template',
						'file-body-replacement',
						'same-source-task-graph',
						'cross-source-parent-related',
					],
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					temporalCreateVersion: 2,
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					temporalCreateKeys: [
						'reminderRules',
						'reminderDatetimes',
						'repeat',
						'datetimeRepeatEnd',
					],
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					graphTransactionVersion: 2,
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': {
					...manifest.convenienceContracts['task.create'],
					graphTransactionFeatures: [
						'compare-aware-compensation',
						'vault-wide-graph-transaction',
						'same-plan-safe-continuation',
						'cross-source-reciprocal-dependency',
					],
				},
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'task.create': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['task.create'],
				).filter(([key]) => key !== 'inputFormats')),
			},
		},
		{
			...structuredClone(manifest),
			convenienceContracts: {
				...manifest.convenienceContracts,
				'timer.session.add': Object.fromEntries(Object.entries(
					manifest.convenienceContracts['timer.session.add'],
				).filter(([key]) => key !== 'directTimerSessionFeatures')),
			},
		},
	]) {
		assert.equal(validateManifest(invalid), false, 'Strict manifest schema must reject routing drift.');
	}
	assert.equal(manifest.package.version, packageDocument.version);
	assert.equal(manifest.package.name, packageDocument.name);
	assert.equal(
		manifest.convenienceContracts['task.create'].typedCreateVersion,
		typedCreateGolden.contract.typedCreateVersion,
	);
	assert.deepEqual(
		manifest.convenienceContracts['task.create'].typedCreateFeatures,
		typedCreateGolden.contract.typedCreateFeatures,
	);
	assert.deepEqual(
		[...new Set(typedCreateGolden.cases.map(testCase => testCase.feature))].sort(),
		[...new Set(typedCreateGolden.contract.typedCreateFeatures)].sort(),
	);
	assert.deepEqual(manifest.platforms, {
		darwin: 'supported',
		linux: 'acceptance-required',
		win32: 'acceptance-required',
		wsl: 'unsupported',
	});
	assert.equal('captureAgent' in manifest.protocols, false);
	assert.equal(manifest.runtimeContracts['task.get'].capability, 'tasks.read');
	assert.equal(manifest.runtimeContracts['task.get'].requestSchema, 'task-get-request');
	assert.equal(manifest.convenienceContracts['reminder.add'].mutationKind, 'task.reminder-item');
	assert.deepEqual(
		manifest.convenienceContracts['task.create'].inputFormats,
		['json', 'compact', 'compact-lines'],
	);
	assert.equal(manifest.convenienceContracts['task.create'].compactGrammarVersion, 1);
	assert.equal(manifest.convenienceContracts['task.create'].compactBatchVersion, 1);
	assert.equal(
		manifest.convenienceContracts['task.create'].compactBatchInputFormat,
		'compact-lines',
	);
	assert.equal(manifest.convenienceContracts['task.create'].compactBatchMaxItems, 64);
	assert.equal(manifest.convenienceContracts['task.create'].typedCreateVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['task.create'].typedCreateFeatures, [
		'exact-inline-placement',
		'exact-file-target',
		'deterministic-file-template',
		'file-body-replacement',
		'same-source-task-graph',
		'cross-source-parent-related',
	]);
	assert.equal(manifest.convenienceContracts['task.create'].temporalCreateVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['task.create'].temporalCreateKeys, [
		'reminderDatetimes',
		'reminderRules',
		'repeat',
		'datetimeRepeatEnd',
	]);
	assert.equal(manifest.convenienceContracts['task.create'].graphTransactionVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['task.create'].graphTransactionFeatures, [
		'vault-wide-graph-transaction',
		'compare-aware-compensation',
		'same-plan-safe-continuation',
		'cross-source-reciprocal-dependency',
	]);
	assert.equal(manifest.convenienceContracts['task.update'].compactUpdateVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['task.update'].compactUpdateFeatures, [
		'exact-id-target',
		'exact-description-target',
		'multi-field-update',
		'explicit-field-clear',
		'safe-auto-apply',
	]);
	assert.equal(manifest.convenienceContracts['task.update'].compactUpdateBatchVersion, 1);
	assert.equal(
		manifest.convenienceContracts['task.update'].compactUpdateBatchInputFormat,
		'compact-lines',
	);
	assert.equal(manifest.convenienceContracts['task.update'].compactUpdateBatchMaxItems, 64);
	assert.deepEqual(manifest.convenienceContracts['task.update'].compactUpdateBatchFeatures, [
		'exact-id-targets',
		'heterogeneous-general-updates',
		'explicit-field-clear',
		'single-source-atomic-plan',
		'per-target-postflight',
		'same-plan-recovery',
	]);
	assert.equal(manifest.convenienceContracts['task.update'].directRelationshipVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['task.update'].directRelationshipKeys, [
		'parentTask',
		'blocking',
		'blockedBy',
	]);
	assert.deepEqual(manifest.convenienceContracts['task.update'].directRelationshipFeatures, [
		'exact-source-selector',
		'exact-id-targets',
		'whole-list-replace',
		'explicit-field-clear',
		'reciprocal-dependency',
		'compare-aware-graph-transaction',
		'safe-auto-apply',
	]);
	assert.equal(manifest.convenienceContracts['task.update'].directRecurrenceVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['task.update'].directRecurrenceKeys, [
		'repeat',
		'datetimeRepeatEnd',
		'dateScheduled',
		'dateStarted',
		'dateDue',
		'datetimeStart',
		'datetimeEnd',
		'estimate',
	]);
	assert.deepEqual(manifest.convenienceContracts['task.update'].directRecurrenceScopes, [
		'this-task',
		'this-and-following',
	]);
	assert.deepEqual(manifest.convenienceContracts['task.update'].directRecurrenceFeatures, [
		'exact-source-selector',
		'multi-field-update',
		'explicit-field-clear',
		'scoped-temporal-update',
		'start-recurrence-default-scope',
		'compare-aware-recurrence-state',
		'safe-auto-apply',
	]);
	assert.equal(manifest.convenienceContracts['task.transition'].directTransitionVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['task.transition'].directTransitionActions, [
		'complete',
		'reopen',
		'cancel',
	]);
	for (const command of ['task.complete', 'task.reopen', 'task.cancel']) {
		assert.equal(manifest.convenienceContracts[command].directTransitionVersion, 1);
		assert.deepEqual(manifest.convenienceContracts[command].directTransitionActions, [
			'complete',
			'reopen',
			'cancel',
		]);
	}
	assert.equal(manifest.convenienceContracts['reminder.add'].directReminderVersion, 1);
	assert.deepEqual(manifest.convenienceContracts['reminder.add'].directReminderFeatures, [
		'exact-id-target',
		'exact-description-target',
		'single-item-add',
		'sealed-item-replace',
		'sealed-item-remove',
		'safe-auto-apply',
	]);
	for (const command of ['task.pin', 'task.unpin']) {
		assert.equal(manifest.convenienceContracts[command].directPinnedVersion, 1);
		assert.deepEqual(manifest.convenienceContracts[command].directPinnedActions, [
			'pin',
			'unpin',
		]);
		assert.deepEqual(manifest.convenienceContracts[command].directPinnedFeatures, [
			'exact-id-target',
			'exact-description-target',
			'compare-aware-state',
			'safe-auto-apply',
		]);
		assert.equal(manifest.convenienceContracts[command].mutationKind, 'task.pinned-state');
	}
	for (const command of ['timer.session.add', 'timer.session.update', 'timer.session.remove']) {
		assert.equal(manifest.convenienceContracts[command].directTimerSessionVersion, 1);
		assert.deepEqual(manifest.convenienceContracts[command].directTimerSessionActions, [
			'add',
			'update',
			'remove',
		]);
		assert.deepEqual(manifest.convenienceContracts[command].directTimerSessionFeatures, [
			'oldest-first-session-number',
			'expected-range-cas',
			'duration-recalculation',
			'parent-aggregate-update',
			'same-plan-recovery',
		]);
		assert.equal(manifest.convenienceContracts[command].mutationKind, 'timer.session');
	}
	for (const command of ['task.relocate', 'task.convert', 'task.delete']) {
		assert.equal(
			manifest.convenienceContracts[command].sourceTransitionRecoveryVersion,
			1,
		);
		assert.deepEqual(
			manifest.convenienceContracts[command].sourceTransitionRecoveryFeatures,
			[
				'terminal-after-state-verification',
				'same-plan-forward-continuation',
				'compare-aware-compensation',
				'cross-file-transition-journal',
			],
		);
	}
	assert.equal(manifest.convenienceContracts['task.complete'].mutationKind, 'task.transition');
	assert.equal(manifest.convenienceContracts['task.reopen'].mutationKind, 'task.transition');
	assert.equal(manifest.convenienceContracts['task.cancel'].mutationKind, 'task.transition');
	for (const item of manifest.schemas) {
		const bytes = await readFile(path.join(packageRoot, 'schemas', 'v1', item.file));
		assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
	}
	assert.equal(Object.keys(manifest.mutationCapabilities).length, 12);
	assert.equal(manifest.mutationCapabilities['task.create'].preview, 'tasks.create.preview');
	assert.equal(manifest.mutationCapabilities['task.recurrence'].apply, 'tasks.recurrence.apply');
	assert.equal(manifest.mutationCapabilities['task.relationship'].apply, 'tasks.relationship.apply');
	assert.equal(manifest.mutationCapabilities['task.pinned-state'].apply, 'tasks.pinned.apply');
	assert.equal(manifest.mutationCapabilities['timer.session'].apply, 'timers.session.apply');
	assert.equal(manifest.mutationCapabilities['task.delete'].apply, 'tasks.delete.apply');
	for (const entrypoint of manifest.schemaEntrypoints) {
		const bytes = await readFile(path.join(packageRoot, 'schemas', 'v1', entrypoint.file));
		assert.equal(createHash('sha256').update(bytes).digest('hex'), entrypoint.sha256);
	}

	await rm(packRoot, { recursive: true, force: true });
	await mkdir(packRoot, { recursive: true });
	const packJson = execFileSync(
		npmCommand,
		['pack', '--json', '--pack-destination', packRoot],
		{ cwd: packageRoot, env, encoding: 'utf8' },
	);
	const packResult = JSON.parse(packJson)[0];
	assert.ok(packResult.size < 1_000_000);
	const paths = packResult.files.map(item => item.path);
	assert.ok(paths.includes('dist/operon.mjs'));
	assert.equal(
		paths.some(item => item.startsWith('dist/chunks/capture-')),
		false,
	);
	assert.ok(paths.includes('cli-manifest-v1.json'));
	assert.ok(paths.includes('README.md'));
	assert.ok(paths.includes('LICENSE'));
	assert.ok(paths.includes('package.json'));
	const expectedTypePaths = (await snapshotTree(path.join(packageRoot, 'types')))
		.filter(item => item.kind === 'file')
		.map(item => `types/${item.path.replaceAll(path.sep, '/')}`)
		.sort();
	assert.deepEqual(
		paths.filter(item => item.startsWith('types/')).sort(),
		expectedTypePaths,
		'Tarball TypeScript declaration inventory must exactly match the generated artifact.',
	);
	assert.deepEqual(
		paths.filter(item => item.startsWith('schemas/v1/')).sort(),
		manifest.schemas.map(item => `schemas/v1/${item.file}`).sort(),
		'Tarball schema inventory must exactly match the published manifest.',
	);
	assert.deepEqual(
		paths.filter(item => item.startsWith('examples/developer-api-consumer/')).sort(),
		[
			'examples/developer-api-consumer/README.md',
			'examples/developer-api-consumer/main.ts',
			'examples/developer-api-consumer/manifest.json',
			'examples/developer-api-consumer/package.json',
			'examples/developer-api-consumer/tsconfig.json',
		],
		'Tarball must contain only the reviewed Developer API consumer source example.',
	);
	assert.ok(paths.every(item => (
		['cli-manifest-v1.json', 'README.md', 'LICENSE', 'package.json'].includes(item)
		|| (item.startsWith('dist/') && item.endsWith('.mjs'))
		|| item.startsWith('schemas/v1/')
		|| item.startsWith('types/')
		|| item.startsWith('examples/developer-api-consumer/')
	)));

	const tarball = path.join(packRoot, packResult.filename);
	const forbidden = [
		'/Users/',
		'Dropbox',
		'Stratejya',
		'.codex/skills',
		'marketplace',
		'cachebuster',
	];
	for (const item of packResult.files) {
		const bytes = await readFile(path.join(packageRoot, item.path));
		for (const marker of forbidden) {
			assert.ok(
				!bytes.toString('utf8').includes(marker),
				`Packed file ${item.path} contains private marker: ${marker}`,
			);
		}
	}
	const fixtureRoot = path.join(tempRoot, 'prior-version');
	await mkdir(path.join(fixtureRoot, 'dist'), { recursive: true });
	await writeFile(path.join(fixtureRoot, 'package.json'), JSON.stringify({
		name: 'operon-cli',
		version: '0.1.0-beta.0',
		type: 'module',
		bin: { operon: './dist/operon.mjs' },
	}));
	await writeFile(
		path.join(fixtureRoot, 'dist', 'operon.mjs'),
		'#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({version:"0.1.0-beta.0"})+"\\n");\n',
		{ mode: 0o755 },
	);
	const priorPackRoot = path.join(tempRoot, 'prior-pack');
	await mkdir(priorPackRoot, { recursive: true });
	const priorPack = JSON.parse(execFileSync(
		npmCommand,
		['pack', '--json', '--pack-destination', priorPackRoot],
		{ cwd: fixtureRoot, env, encoding: 'utf8' },
	))[0];
	const priorTarball = path.join(priorPackRoot, priorPack.filename);
	execFileSync(npmCommand, ['install', '--global', '--prefix', prefixRoot, priorTarball], {
		env,
		stdio: 'inherit',
	});
	execFileSync(npmCommand, ['install', '--global', '--prefix', prefixRoot, tarball], {
		env,
		stdio: 'inherit',
	});
	const installedGlobalRoot = execFileSync(
		npmCommand,
		['root', '--global', '--prefix', prefixRoot],
		{ env, encoding: 'utf8' },
	).trim();
	const installedArtifactRoot = path.join(installedGlobalRoot, 'operon-cli');
	const installedManifestFile = JSON.parse(await readFile(
		path.join(installedArtifactRoot, 'cli-manifest-v1.json'),
		'utf8',
	));
	assert.equal(installedManifestFile.contractDigest, manifest.contractDigest);
	for (const item of installedManifestFile.schemas) {
		const bytes = await readFile(
			path.join(installedArtifactRoot, 'schemas', 'v1', item.file),
		);
		assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
	}
	for (const entrypoint of installedManifestFile.schemaEntrypoints) {
		const item = installedManifestFile.schemas.find(candidate => candidate.file === entrypoint.file);
		assert.ok(item, `Installed entrypoint file missing: ${entrypoint.schemaId}`);
		assert.equal(item.sha256, entrypoint.sha256);
		const document = JSON.parse(await readFile(
			path.join(installedArtifactRoot, 'schemas', 'v1', entrypoint.file),
			'utf8',
		));
		const fragment = entrypoint.ref.includes('#') ? entrypoint.ref.split('#', 2)[1] : '';
		assert.notEqual(
			resolveJsonPointer(document, fragment),
			undefined,
			`Installed entrypoint fragment missing: ${entrypoint.schemaId}`,
		);
	}
	const executableShim = process.platform === 'win32'
		? path.join(prefixRoot, 'operon.cmd')
		: path.join(prefixRoot, 'bin', 'operon');
	const executable = process.platform === 'win32'
		? path.join(installedArtifactRoot, 'dist', 'operon.mjs')
		: executableShim;
	const version = runJson(executable, ['version', '--json'], env);
	assert.equal(version.result.version, packageDocument.version);
	if (process.platform === 'win32') {
		assert.equal(runWindowsShimJson(executableShim, ['version', '--json'], env).result.version, packageDocument.version);
	}
	await mkdir(env.OPERON_CONFIG_HOME, { recursive: true, mode: 0o700 });
	const retiredCaptureConfig = '{"version":1,"retired":"config"}\n';
	const retiredCaptureConsent = '{"version":1,"retired":"consent"}\n';
	await writeFile(
		path.join(env.OPERON_CONFIG_HOME, 'capture-agent-v1.json'),
		retiredCaptureConfig,
	);
	await writeFile(
		path.join(env.OPERON_CONFIG_HOME, 'capture-agent-consent-v1.json'),
		retiredCaptureConsent,
	);
	for (const argv of [
		['capture', '--json'],
		['capture-agent', 'status', '--json'],
	]) {
		const removedCommand = runProcess(executable, argv, env);
		assert.equal(removedCommand.status, 2);
	}
	assert.equal(
		await readFile(path.join(env.OPERON_CONFIG_HOME, 'capture-agent-v1.json'), 'utf8'),
		retiredCaptureConfig,
	);
	assert.equal(
		await readFile(
			path.join(env.OPERON_CONFIG_HOME, 'capture-agent-consent-v1.json'),
			'utf8',
		),
		retiredCaptureConsent,
	);
	if (process.platform !== 'win32') {
		execFileSync(
			'python3',
			[
				path.join(pluginRoot, 'scripts', 'agent-runtime', 'cli', 'guided-setup-pty.test.py'),
				executable,
			],
			{ env, stdio: 'inherit' },
		);
	}
	const lifecycleVault = path.join(tempRoot, 'lifecycle-vault');
	await mkdir(path.join(lifecycleVault, '.obsidian', 'plugins', 'operon'), { recursive: true });
	await writeFile(
		path.join(lifecycleVault, '.obsidian', 'plugins', 'operon', 'manifest.json'),
		JSON.stringify({
			id: 'operon',
			version: '2.6.0',
			minAppVersion: '1.7.2',
		}),
	);
	const setup = runJson(executable, [
		'setup',
		'--vault',
		lifecycleVault,
		'--name',
		'lifecycle',
		'--default',
		'--json',
	], env);
	assert.equal(setup.ok, true);
	const lifecycleRecoveryRecord = await createLifecycleRecoveryRecord(lifecycleVault);
	const clientIdentityPath = path.join(env.OPERON_CONFIG_HOME, 'client-v1.json');
	await writeFile(
		clientIdentityPath,
		`${JSON.stringify({
			version: 1,
			clientInstanceId: lifecycleRecoveryRecord.clientInstanceId,
		})}\n`,
		{ mode: 0o600 },
	);
	secureWindowsFixturePath(clientIdentityPath, 'file');
	const clientIdentityMarkerPath = path.join(
		env.OPERON_CONFIG_HOME,
		'client-v1.json.initialized',
	);
	await writeFile(
		clientIdentityMarkerPath,
		'operon-cli-client-identity-v1\n',
		{ mode: 0o600 },
	);
	secureWindowsFixturePath(clientIdentityMarkerPath, 'file');
	typedGoldenCaseIds = typedCreateGolden.cases.map(testCase => testCase.id);
	assert.equal(
		new Set(typedGoldenCaseIds).size,
		typedGoldenCaseIds.length,
		'Typed create golden case IDs must be unique before CLI admission.',
	);
	for (const fixtureCase of typedCreateGolden.cases) {
		const admitted = runProcess(
			executable,
			['task', 'create', '--input', '-', '--vault', lifecycleVault, '--json'],
			env,
			{ input: `${JSON.stringify(fixtureCase.intent)}\n` },
		);
		assert.notEqual(
			admitted.status,
			2,
			`${fixtureCase.id}: typed golden intent must pass CLI argument and schema admission`,
		);
		assert.equal(
			admitted.stderr,
			'',
			`${fixtureCase.id}: JSON mode must keep diagnostics in the result envelope`,
		);
		const envelope = JSON.parse(admitted.stdout);
		assert.equal(
			envelope.command,
			'mutation.preview',
			`${fixtureCase.id}: typed golden intent must route to mutation preview`,
		);
		assert.equal(
			envelope.ok,
			false,
			`${fixtureCase.id}: the intentionally closed lifecycle vault must stop at transport`,
		);
		assert.equal(
			envelope.failure?.stage,
			'transport',
			`${fixtureCase.id}: local admission must precede the expected closed-vault transport failure`,
		);
	}
	const plansRoot = path.join(env.OPERON_CONFIG_HOME, 'plans');
	await mkdir(plansRoot, { recursive: true, mode: 0o700 });
	secureWindowsFixturePath(plansRoot, 'directory');
	const lifecyclePlanPath = path.join(
		plansRoot,
		`${lifecycleRecoveryRecord.planRef}.json`,
	);
	await writeFile(
		lifecyclePlanPath,
		`${JSON.stringify(lifecycleRecoveryRecord)}\n`,
		{ mode: 0o600 },
	);
	secureWindowsFixturePath(lifecyclePlanPath, 'file');
	const lifecyclePlanShow = runJson(executable, [
		'plan',
		'show',
		lifecycleRecoveryRecord.planRef,
		'--json',
	], env);
	assert.equal(lifecyclePlanShow.ok, true);
	assert.equal(lifecyclePlanShow.result.planRef, lifecycleRecoveryRecord.planRef);
	assert.equal(lifecyclePlanShow.result.lastOutcome.status, 'outcome-unknown');
	const durableStateBeforeLifecycle = await snapshotTree(env.OPERON_CONFIG_HOME);
	if (process.platform !== 'win32') {
		execFileSync(
			'python3',
			[
				path.join(pluginRoot, 'scripts', 'agent-runtime', 'cli', 'interactive-shell-pty.test.py'),
				executable,
			],
			{ env, stdio: 'inherit' },
		);
	}
	const noArgs = runProcess(executable, [], env);
	assert.equal(noArgs.status, 0);
	assert.match(noArgs.stdout, /^Operon CLI\n/u);
	assert.equal(noArgs.stderr, '');
	const rootHelp = runProcess(executable, ['--help'], env);
	assert.equal(rootHelp.status, 0);
	assert.match(rootHelp.stdout, /System and setup:/u);
	assert.equal(rootHelp.stderr, '');
	const groupHelp = runProcess(executable, ['task', '--help'], env);
	assert.equal(groupHelp.status, 0);
	assert.match(groupHelp.stdout, /Operon task commands/u);
	assert.match(groupHelp.stdout, /create\s+Create one task or preview a compact line batch/u);
	assert.match(groupHelp.stdout, /relocate\s+Move an exact inline task to a live blank-line candidate/u);
	assert.match(groupHelp.stdout, /convert\s+Convert an exact inline or File Task through a guided or typed preview/u);
	assert.match(groupHelp.stdout, /delete\s+Select and preview exact task deletion interactively or from typed input/u);
	const leafHelp = runProcess(executable, ['task', 'create', '--help'], env);
	assert.equal(leafHelp.status, 0);
	assert.match(leafHelp.stdout, /Contract: task\.create/u);
	assert.match(leafHelp.stdout, /--input-format <json\|compact\|compact-lines>/u);
	assert.match(leafHelp.stdout, /Human compact argv automatically applies/u);
	assert.match(leafHelp.stdout, /Agent compact and compact-lines stdin always preview only/u);
	assert.match(leafHelp.stdout, /shell history and process listings/u);
	const updateHelp = runProcess(executable, ['task', 'update', '--help'], env);
	assert.equal(updateHelp.status, 0);
	assert.match(updateHelp.stdout, /parentTask::"<operon-id>"/u);
	assert.match(updateHelp.stdout, /blocking::"<operon-id>; \.\.\."/u);
	assert.match(updateHelp.stdout, /--clear "blockedBy"/u);
	assert.match(updateHelp.stdout, /cannot be mixed with general field updates/u);
	assert.match(updateHelp.stdout, /General fields: task\.update/u);
	assert.match(updateHelp.stdout, /Relationship keys: task\.relationship/u);
	for (const [command, contract] of [
		[['task', 'relocate', '--help'], 'task.relocate'],
		[['task', 'convert', '--help'], 'task.convert'],
		[['task', 'delete', '--help'], 'task.delete'],
		[['plan', 'recover', '--help'], 'plan.recover'],
	]) {
		const help = runProcess(executable, command, env);
		assert.equal(help.status, 0);
		assert.match(help.stdout, new RegExp(`Contract: ${contract.replace('.', '\\.')}`, 'u'));
	}
	const nonInteractiveCreate = runProcess(executable, ['task', 'create'], env);
	assert.equal(nonInteractiveCreate.status, 2);
	assert.match(nonInteractiveCreate.stderr, /requires an interactive terminal/u);
	const invalidUpdateBatch = runProcess(
		executable,
		['task', 'update', '--input-format', 'compact-lines', '--input', '-', '--json'],
		env,
		{
			input: [
				'--id "abc1234" note::"One"',
				'--id "abc1234" note::"Two"',
			].join('\n'),
		},
	);
	assert.equal(invalidUpdateBatch.status, 2);
	assert.equal(invalidUpdateBatch.stderr, '');
	const invalidUpdateBatchError = JSON.parse(invalidUpdateBatch.stdout).error;
	assert.equal(invalidUpdateBatchError.code, 'invalid-request');
	assert.equal(
		invalidUpdateBatchError.details.reasonCode,
		'compact-update-batch-duplicate-id',
	);
	for (const command of [
		['task', 'relocate'],
		['task', 'convert'],
		['task', 'delete'],
		['plan', 'recover'],
	]) {
		const result = runProcess(executable, command, env);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /interactive .*terminal|requires an interactive terminal/iu);
	}
	const typo = runProcess(executable, ['task', 'udpate'], env);
	assert.equal(typo.status, 2);
	assert.equal(typo.stdout, '');
	assert.match(typo.stderr, /Did you mean "task update"\?/u);
	const unknownJson = runProcess(executable, ['frobnicate', '--json'], env);
	assert.equal(unknownJson.status, 2);
	assert.equal(unknownJson.stderr, '');
	const unknownJsonError = JSON.parse(unknownJson.stdout).error;
	assert.equal(unknownJsonError.code, 'invalid-request');
	assert.equal(unknownJsonError.details.reasonCode, 'unknown-command');
	const installedManifest = runJson(executable, ['manifest', '--json'], env);
	assert.equal(installedManifest.result.package.name, 'operon-cli');
	assert.equal(installedManifest.result.package.version, packageDocument.version);
	assert.equal(
		installedManifest.result.convenienceContracts['task.update'].directRelationshipVersion,
		1,
	);
	assert.deepEqual(
		installedManifest.result.convenienceContracts['task.update'].directRelationshipKeys,
		['parentTask', 'blocking', 'blockedBy'],
	);
	assert.deepEqual(
		installedManifest.result.convenienceContracts['task.update'].directRelationshipFeatures,
		[
			'exact-source-selector',
			'exact-id-targets',
			'whole-list-replace',
			'explicit-field-clear',
			'reciprocal-dependency',
			'compare-aware-graph-transaction',
			'safe-auto-apply',
		],
	);
	assert.equal(
		installedManifest.result.convenienceContracts['task.update'].directRecurrenceVersion,
		1,
	);
	assert.deepEqual(
		installedManifest.result.convenienceContracts['task.update'].directRecurrenceScopes,
		['this-task', 'this-and-following'],
	);
	assert.deepEqual(
		installedManifest.result.convenienceContracts['task.update'].directRecurrenceFeatures,
		[
			'exact-source-selector',
			'multi-field-update',
			'explicit-field-clear',
			'scoped-temporal-update',
			'start-recurrence-default-scope',
			'compare-aware-recurrence-state',
			'safe-auto-apply',
		],
	);
	assert.deepEqual(
		installedManifest.result.mutationCapabilities['task.recurrence'],
		{
			preview: 'tasks.recurrence.preview',
			apply: 'tasks.recurrence.apply',
		},
	);
	assert.deepEqual(
		installedManifest.result.mutationCapabilities['task.relationship'],
		{
			preview: 'tasks.relationship.preview',
			apply: 'tasks.relationship.apply',
		},
	);
	assert.deepEqual(
		installedManifest.result.mutationCapabilities['timer.session'],
		{
			preview: 'timers.session.preview',
			apply: 'timers.session.apply',
		},
	);
	const schemaList = runJson(executable, ['schema', 'list', '--json'], env);
	assert.ok(schemaList.result.entrypoints.some(item => item.schemaId === 'mutation-preview-request'));
	const schema = runJson(executable, ['schema', 'get', 'mutation-preview-request', '--json'], env);
	assert.equal(schema.result.schemaId, 'mutation-preview-request');
	const intentSchema = runJson(executable, ['schema', 'get', 'mutation-intent', '--json'], env);
	assert.equal(intentSchema.result.schemaId, 'mutation-intent');
	const installedPackageRoot = installedArtifactRoot;
	await writeFile(
		path.join(installedPackageRoot, 'schemas', 'v1', 'undeclared.schema.json'),
		'{"type":"object"}\n',
	);
	const manifestBoundList = runJson(executable, ['schema', 'list', '--json'], env);
	assert.ok(!manifestBoundList.result.files.includes('undeclared.schema.json'));
	const catalogSchemaPath = path.join(installedPackageRoot, 'schemas', 'v1', 'catalog.schema.json');
	const catalogSchemaBytes = await readFile(catalogSchemaPath);
	await writeFile(catalogSchemaPath, `${catalogSchemaBytes.toString('utf8')}\n`);
	assert.throws(
		() => runJson(executable, ['schema', 'get', 'catalog.schema.json', '--json'], env),
		/PACKAGE_ASSET_INVALID|Command failed/u,
	);

	execFileSync(npmCommand, ['install', '--global', '--prefix', prefixRoot, priorTarball], {
		env,
		stdio: 'inherit',
	});
	assert.equal(runJson(executable, [], env).version, '0.1.0-beta.0');
	if (process.platform === 'win32') {
		assert.equal(runWindowsShimJson(executableShim, [], env).version, '0.1.0-beta.0');
	}
	assert.deepEqual(
		await snapshotTree(env.OPERON_CONFIG_HOME),
		durableStateBeforeLifecycle,
		'Exact-version rollback must preserve profiles, client identity, and recovery plans.',
	);
	execFileSync(npmCommand, ['install', '--global', '--prefix', prefixRoot, tarball], {
		env,
		stdio: 'inherit',
	});
	assert.equal(runJson(executable, ['version', '--json'], env).result.version, packageDocument.version);
	if (process.platform === 'win32') {
		assert.equal(runWindowsShimJson(executableShim, ['version', '--json'], env).result.version, packageDocument.version);
	}
	assert.deepEqual(
		await snapshotTree(env.OPERON_CONFIG_HOME),
		durableStateBeforeLifecycle,
		'Re-upgrading to the beta candidate must preserve durable CLI state.',
	);
	execFileSync(npmCommand, ['uninstall', '--global', '--prefix', prefixRoot, 'operon-cli'], {
		env,
		stdio: 'inherit',
	});
	assert.deepEqual(
		await snapshotTree(env.OPERON_CONFIG_HOME),
		durableStateBeforeLifecycle,
		'Uninstall must remove the executable without deleting user-owned CLI state.',
	);
	await assert.rejects(stat(executable), error => error?.code === 'ENOENT');
	await assert.rejects(stat(executableShim), error => error?.code === 'ENOENT');
	console.log(JSON.stringify({
		status: 'ok',
		package: `${packageDocument.name}@${packageDocument.version}`,
		executableBytes: (await stat(executablePath)).size,
		tarballBytes: packResult.size,
		entries: packResult.entryCount,
		lifecycle: {
			steps: ['install', 'rollback', 're-upgrade', 'uninstall'],
			durableStateFiles: durableStateBeforeLifecycle.length,
			durableStatePreserved: true,
		},
		typedGoldenCaseIds,
	}, null, 2));
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

async function createLifecycleRecoveryRecord(vaultPath) {
	const now = Date.now();
	const recoveryStartedAt = new Date(now).toISOString();
	const recoveryExpiresAt = new Date(now + 24 * 60 * 60 * 1_000).toISOString();
	const fixtures = JSON.parse(await readFile(
		path.join(pluginRoot, 'scripts', 'agent-runtime', 'contracts', 'fixtures', 'cases.json'),
		'utf8',
	));
	const applyRequest = fixtures.cases.find(
		item => item.id === 'valid-destructive-delete-apply',
	)?.value;
	assert.ok(applyRequest);
	const { plan, idempotencyKey } = applyRequest;
	return {
		version: 1,
		planRef: 'p1234567890123456789012345678901',
		vaultPath,
		vaultSha256: createHash('sha256').update(vaultPath).digest('hex'),
		profile: 'lifecycle',
		clientInstanceId: plan.clientInstanceId,
		idempotencyKey,
		plan,
		createdAt: plan.createdAt,
		expiresAt: plan.expiresAt,
		applyRequest,
		recoveryStartedAt,
		recoveryExpiresAt,
		lastOutcome: {
			status: 'outcome-unknown',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			ambiguitySource: 'group-outcome',
		},
	};
}

function runJson(executable, args, childEnv) {
	const result = runProcess(executable, args, childEnv);
	assert.equal(
		result.status,
		0,
		`Command failed: ${JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr })}`,
	);
	return JSON.parse(result.stdout);
}

function runProcess(executable, args, childEnv, options = {}) {
	const command = executable.endsWith('.mjs') ? process.execPath : executable;
	const commandArgs = executable.endsWith('.mjs') ? [executable, ...args] : args;
	const result = spawnSync(command, commandArgs, {
		env: childEnv,
		encoding: 'utf8',
		...options,
	});
	if (result.error) throw result.error;
	return result;
}

function runWindowsShimJson(executableShim, args, childEnv) {
	const quote = value => `"${value.replaceAll('"', '""')}"`;
	const command = [executableShim, ...args].map(quote).join(' ');
	return JSON.parse(execFileSync(
		process.env.ComSpec ?? 'cmd.exe',
		['/d', '/s', '/c', command],
		{ env: childEnv, encoding: 'utf8' },
	));
}

function secureWindowsFixturePath(targetPath, kind) {
	if (process.platform !== 'win32') return;
	const script = [
		'$ErrorActionPreference = "Stop"',
		'$p = [Environment]::GetEnvironmentVariable("OPERON_TEST_SECURITY_PATH", "Process")',
		'$kind = [Environment]::GetEnvironmentVariable("OPERON_TEST_SECURITY_KIND", "Process")',
		'$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User',
		'$acl = if ($kind -eq "directory") { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }',
		'$acl.SetOwner($sid)',
		'$acl.SetAccessRuleProtection($true, $false)',
		'$inherit = if ($kind -eq "directory") { [Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit" } else { [Security.AccessControl.InheritanceFlags]::None }',
		'$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)',
		'$acl.AddAccessRule($rule)',
		'Set-Acl -LiteralPath $p -AclObject $acl',
	].join('; ');
	execFileSync('powershell.exe', [
		'-NoLogo',
		'-NoProfile',
		'-NonInteractive',
		'-ExecutionPolicy',
		'Bypass',
		'-Command',
		script,
	], {
		env: {
			...process.env,
			OPERON_TEST_SECURITY_PATH: targetPath,
			OPERON_TEST_SECURITY_KIND: kind,
		},
		stdio: 'inherit',
		windowsHide: true,
	});
}

function resolveJsonPointer(document, fragment) {
	if (fragment === '') return document;
	if (!fragment.startsWith('/')) return undefined;
	let current = document;
	for (const rawToken of fragment.slice(1).split('/')) {
		const token = rawToken.replaceAll('~1', '/').replaceAll('~0', '~');
		if (current === null || typeof current !== 'object' || !(token in current)) return undefined;
		current = current[token];
	}
	return current;
}

async function snapshotTree(root) {
	const entries = [];
	await walk(root, '');
	return entries;

	async function walk(directory, relativeDirectory) {
		const names = await readdir(directory);
		names.sort((left, right) => left.localeCompare(right));
		for (const name of names) {
			const relativePath = relativeDirectory ? path.join(relativeDirectory, name) : name;
			const absolutePath = path.join(directory, name);
			const metadata = await stat(absolutePath);
			if (metadata.isDirectory()) {
				entries.push({ path: `${relativePath}/`, kind: 'directory' });
				await walk(absolutePath, relativePath);
				continue;
			}
			assert.equal(metadata.isFile(), true, `Unexpected durable-state entry: ${relativePath}`);
			entries.push({
				path: relativePath,
				kind: 'file',
				sha256: createHash('sha256').update(await readFile(absolutePath)).digest('hex'),
			});
		}
	}
}
