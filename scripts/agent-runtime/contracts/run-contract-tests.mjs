import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const schemaRoot = path.join(pluginRoot, 'contracts/agent-runtime/v1');
const fixturePath = path.join(scriptDirectory, 'fixtures/cases.json');
const sourceRoot = path.join(pluginRoot, 'src/agent-runtime/contracts/v1');
const productionContractImporters = new Set([
	'main.ts',
	'src/core/settings-backup-apply.ts',
	'src/core/settings-backup-export.ts',
	'src/core/settings-backup-format.ts',
	'src/core/settings-backup-group-validation.ts',
	'src/core/settings-backup-preflight.ts',
	'src/agent-runtime/developer-api/grant-controller.ts',
	'src/agent-runtime/developer-api/grants.ts',
	'src/agent-runtime/developer-api/runtime.ts',
	'src/agent-runtime/developer-api/recovery-store.ts',
	'src/agent-runtime/developer-api/security/policy.ts',
	'src/agent-runtime/developer-api/security/types.ts',
	'src/agent-runtime/extensions/task-workflows-v1/contracts.ts',
	'src/agent-runtime/extensions/task-workflows-v1/decode.ts',
	'src/agent-runtime/extensions/task-workflows-v1/developer-api.ts',
	'src/agent-runtime/extensions/task-workflows-v1/task-workflow-mutation-session.ts',
	'src/agent-runtime/extensions/task-workflows-v1/gateway.ts',
	'src/agent-runtime/runtime/types.ts',
	'src/agent-runtime/runtime/catalog-builder.ts',
	'src/agent-runtime/runtime/lifecycle.ts',
	'src/agent-runtime/runtime/mutation-gateway.ts',
	'src/agent-runtime/runtime/mutation-request-validator.ts',
	'src/agent-runtime/runtime/receipts/indexeddb-receipt-store.ts',
	'src/agent-runtime/runtime/receipts/indexeddb-security-audit-store.ts',
	'src/agent-runtime/runtime/revision.ts',
	'src/agent-runtime/runtime/settings-fingerprint.ts',
	'src/agent-runtime/runtime/settings-freshness.ts',
	'src/agent-runtime/runtime/coherent-read.ts',
	'src/agent-runtime/runtime/settlement.ts',
	'src/agent-runtime/runtime/task-creation-adapter.ts',
	'src/agent-runtime/runtime/task-mutation-adapter.ts',
	'src/agent-runtime/runtime/task-recurrence-adapter.ts',
	'src/agent-runtime/runtime/timer-session-adapter.ts',
	'src/agent-runtime/runtime/task-relationship-adapter.ts',
	'src/agent-runtime/runtime/pinned-state-mutation.ts',
	'src/agent-runtime/runtime/semantic-transition.ts',
	'src/agent-runtime/runtime/source-transition-guards.ts',
	'src/agent-runtime/runtime/context-bridge.ts',
	'src/agent-runtime/runtime/context-cursor.ts',
	'src/agent-runtime/runtime/context-provider.ts',
	'src/agent-runtime/runtime/context-request-validator.ts',
	'src/agent-runtime/runtime/context-source.ts',
	'src/agent-runtime/runtime/facade.ts',
	'src/agent-runtime/runtime/index.ts',
	'src/agent-runtime/transport/dispatcher.ts',
	'src/agent-runtime/transport/invocation-validator.ts',
	'src/agent-runtime/transport/native-cli.ts',
	'src/agent-runtime/transport/persistent-read-server.ts',
	'src/agent-runtime/transport/secure-request-file.ts',
	'src/agent-runtime/transport/windows-broker-state.ts',
	'src/storage/operon-storage.ts',
]);

const manifest = await readJson(path.join(schemaRoot, 'schema-manifest.json'));
const fixtureDocument = await readJson(fixturePath);
assert.equal(manifest.contractVersion, 1, 'Schema manifest must be V1.');
assert.equal(fixtureDocument.fixtureVersion, 1, 'Fixture document must be V1.');
const frozenCapabilityRegistry = fixture(fixtureDocument.cases, 'valid-closed-capability-registry').value;

const ajv = new Ajv2020({
	allErrors: true,
	allowUnionTypes: true,
	strict: true,
	strictRequired: false,
	strictTypes: false,
});
ajv.addKeyword({
	keyword: 'x-operon-maxUtf8Bytes',
	schemaType: 'number',
	type: ['string', 'array', 'object'],
	errors: false,
	validate: (maximumBytes, value) => utf8Size(value) <= maximumBytes,
});
ajv.addKeyword({
	keyword: 'x-operon-knownValues',
	schemaType: 'array',
	errors: false,
	validate: () => true,
});
ajv.addKeyword({
	keyword: 'x-operon-sealedPlanSafety',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateSealedPlanForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-createGraphSafety',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateCreateGraphForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-acknowledgementBindings',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateAcknowledgementBindingsForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-receiptTimeline',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateReceiptTimelineForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-resultState',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateResultStateForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-truncationState',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateTruncationForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-cliInvocationBinding',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateCliInvocationBindingForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-cliResultBinding',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled || validateCliResultBindingForSchema(value),
});
ajv.addKeyword({
	keyword: 'x-operon-frozenCapabilityRegistry',
	schemaType: 'boolean',
	type: 'array',
	errors: false,
	validate: (enabled, value) => !enabled
		|| JSON.stringify(value) === JSON.stringify(frozenCapabilityRegistry),
});
ajv.addKeyword({
	keyword: 'x-operon-uniqueBy',
	schemaType: ['string', 'array'],
	type: 'array',
	errors: false,
	validate: (propertyNames, value) => {
		const keys = Array.isArray(propertyNames) ? propertyNames : [propertyNames];
		const seen = new Set();
		for (const item of value) {
			if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
			const identity = keys.map(propertyName => propertyName
				.split('.')
				.reduce((current, segment) => (
					current !== null && typeof current === 'object' && !Array.isArray(current)
						? current[segment]
						: undefined
				), item));
			if (identity.some(key => typeof key !== 'string')) return false;
			const combined = JSON.stringify(identity);
			if (seen.has(combined)) return false;
			seen.add(combined);
		}
		return true;
	},
});
ajv.addKeyword({
	keyword: 'x-operon-updateBatchSafety',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => {
		if (!enabled || !Array.isArray(value.items)) return !enabled;
		const paths = new Set();
		for (const item of value.items) {
			const locator = item?.target?.locator;
			if (locator?.representation !== 'inline' || typeof locator.filePath !== 'string') return false;
			paths.add(locator.filePath);
		}
		return paths.size === 1;
	},
});
ajv.addKeyword({
	keyword: 'x-operon-contiguousOrder',
	schemaType: 'boolean',
	type: 'array',
	errors: false,
	validate: (enabled, value) => !enabled
		|| value.every((item, index) => item && typeof item === 'object' && item.order === index),
});
ajv.addKeyword({
	keyword: 'x-operon-fieldCatalogSafety',
	schemaType: 'boolean',
	type: 'array',
	errors: false,
	validate: (enabled, value) => !enabled || value.every(item => {
		const mapped = item?.mappingStatus === 'mapped';
		if (item?.readable !== mapped) return false;
		return item?.mutationClass !== 'general-update'
			|| (mapped && item.readable === true && item.mutationOwner === 'tasks.update');
	}),
});
ajv.addKeyword({
	keyword: 'x-operon-catalogResultSafety',
	schemaType: 'boolean',
	type: 'object',
	errors: false,
	validate: (enabled, value) => !enabled
		|| value.ok !== true
		|| (
			value.settingsFingerprint === value.contextRevision?.settingsFingerprint
			&& value.catalogRevision === createHash('sha256').update(canonicalJsonForSchema({
				settingsFingerprint: value.settingsFingerprint,
				taxonomy: value.taxonomy,
				fields: value.fields,
				policies: value.policies,
			}), 'utf8').digest('hex')
			&& validateCatalogFilterBoundsForSchema(value.policies?.filters)
		),
});
ajv.addFormat('date', {
	type: 'string',
	validate: value => isExactCalendarDate(value),
});
ajv.addFormat('operon-local-date-time', {
	type: 'string',
	validate: value => isExactLocalDateTime(value),
});
ajv.addFormat('operon-audit-date-time', {
	type: 'string',
	validate: value => isExactAuditDateTime(value),
});

for (const document of manifest.documents) {
	const schema = await readJson(path.join(schemaRoot, document.file));
	ajv.addSchema(schema);
}

const schemaValidators = new Map();
for (const entrypoint of manifest.entrypoints) {
	const validator = ajv.getSchema(entrypoint.ref);
	assert.ok(validator, `Missing schema entrypoint: ${entrypoint.schemaId} (${entrypoint.ref})`);
	assert.ok(!schemaValidators.has(entrypoint.schemaId), `Duplicate schema id: ${entrypoint.schemaId}`);
	schemaValidators.set(entrypoint.schemaId, validator);
}

const contractModule = await bundlePortableContracts();
assert.ok(contractModule.DECODER_REGISTRY_V1, 'TypeScript decoder registry was not exported.');
assert.equal(typeof contractModule.decodeContractFixtureV1, 'function', 'Fixture decoder entrypoint was not exported.');

const schemaIds = [...schemaValidators.keys()].sort();
const decoderIds = Object.keys(contractModule.DECODER_REGISTRY_V1).sort();
assert.deepEqual(
	decoderIds,
	schemaIds,
	'JSON Schema entrypoints and TypeScript decoder registry must expose the same IDs.',
);

const failures = [];
for (const fixture of fixtureDocument.cases) {
	const validator = schemaValidators.get(fixture.schemaId);
	if (!validator) {
		failures.push(`${fixture.id}: unknown schema id ${fixture.schemaId}`);
		continue;
	}
	const schemaAccepted = validator(fixture.value);
	const decoded = contractModule.decodeContractFixtureV1(fixture.schemaId, fixture.value);
	const decoderAccepted = decoded.ok;
	if (schemaAccepted !== fixture.expected) {
		failures.push(formatSchemaFailure(fixture, validator.errors, schemaAccepted));
	}
	if (decoderAccepted !== fixture.expected) {
		const issues = decoded.ok ? [] : decoded.issues;
		failures.push(
			`${fixture.id}: TypeScript decoder accepted=${decoderAccepted}, expected=${fixture.expected}; `
			+ `${JSON.stringify(issues)}`,
		);
	}
	if (schemaAccepted !== decoderAccepted) {
		failures.push(
			`${fixture.id}: schema/decoder drift (schema=${schemaAccepted}, decoder=${decoderAccepted})`,
		);
	}
}

await runPortableSourceGuard();
await runProductionMetafileGuard();
runSemanticContractGuards(fixtureDocument.cases, contractModule, schemaValidators);
const boundaryCaseCount = runGeneratedBoundaryDifferential(
	fixtureDocument.cases,
	contractModule,
	schemaValidators,
);

if (failures.length > 0) {
	throw new Error(`Agent Runtime contract validation failed:\n- ${failures.join('\n- ')}`);
}

const categoryCounts = Object.fromEntries(
	[...new Set(fixtureDocument.cases.map(item => item.category))]
		.sort()
		.map(category => [
			category,
			fixtureDocument.cases.filter(item => item.category === category).length,
		]),
);
console.log(JSON.stringify({
	status: 'ok',
	contractVersion: 1,
	schemas: schemaIds.length,
	fixtures: fixtureDocument.cases.length,
	generatedBoundaryCases: boundaryCaseCount,
	categories: categoryCounts,
	fixtureAndBoundaryParity: true,
	portableSource: true,
	productionGraphIsolated: true,
}, null, 2));

async function bundlePortableContracts() {
	const result = await build({
		entryPoints: [path.join(sourceRoot, 'fixture-contracts.ts')],
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		target: 'es2020',
		write: false,
		treeShaking: true,
		logLevel: 'silent',
		metafile: true,
	});
	assert.equal(result.outputFiles.length, 1, 'Portable contract build must produce one module.');
	const output = result.outputFiles[0].text;
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
	return import(moduleUrl);
}

async function runPortableSourceGuard() {
	const files = await listFiles(sourceRoot, filePath => filePath.endsWith('.ts'));
	assert.ok(files.length > 0, 'Portable TypeScript contract sources are missing.');
	const bannedImports = /\bfrom\s+['"](?:obsidian|electron|node:|fs(?:\/|['"])|path(?:\/|['"])|child_process(?:\/|['"])|os(?:\/|['"]))/;
	const bannedRuntimeTypes = /\b(?:App|Plugin|Vault|TFile|HTMLElement|Window|Document|IDBDatabase|Storage)\b/;
	for (const file of files) {
		const source = await readFile(file, 'utf8');
		assert.ok(!bannedImports.test(source), `Portable contract imports a host dependency: ${relative(file)}`);
		assert.ok(!bannedRuntimeTypes.test(source), `Portable contract exposes a host/runtime type: ${relative(file)}`);
	}

	const sourceFiles = await listFiles(path.join(pluginRoot, 'src'), filePath => filePath.endsWith('.ts'));
	const productionReferences = [];
	for (const file of sourceFiles) {
		if (file.startsWith(sourceRoot + path.sep)) continue;
		const source = await readFile(file, 'utf8');
		if (/agent-runtime\/contracts|agent-runtime\\contracts/.test(source)) {
			productionReferences.push(relative(file));
		}
	}
	const mainSource = await readFile(path.join(pluginRoot, 'main.ts'), 'utf8');
	if (/agent-runtime\/contracts|agent-runtime\\contracts/.test(mainSource)) productionReferences.push('main.ts');
	const unexpectedReferences = productionReferences.filter(file => !productionContractImporters.has(file));
	assert.deepEqual(
		unexpectedReferences,
		[],
		`Only allowlisted Runtime modules may import portable contracts: ${productionReferences.join(', ')}`,
	);
}

async function runProductionMetafileGuard() {
	const result = await build({
		entryPoints: [path.join(pluginRoot, 'main.ts')],
		bundle: true,
		format: 'cjs',
		platform: 'browser',
		target: 'es2018',
		write: false,
		treeShaking: true,
		logLevel: 'silent',
		metafile: true,
		define: {
			OPERON_AGENT_RUNTIME_PROBE_ENABLED: 'false',
		},
		external: [
			'obsidian',
			'electron',
			'@codemirror/autocomplete',
			'@codemirror/collab',
			'@codemirror/commands',
			'@codemirror/language',
			'@codemirror/lint',
			'@codemirror/search',
			'@codemirror/state',
			'@codemirror/view',
			'@lezer/common',
			'@lezer/highlight',
			'@lezer/lr',
			...builtinModules,
			...builtinModules.map(moduleName => `node:${moduleName}`),
		],
	});
	const inputs = result.metafile?.inputs ?? {};
	for (const [input, metadata] of Object.entries(inputs)) {
		const normalizedInput = input.replaceAll('\\', '/');
		assert.ok(
			!normalizedInput.includes('contracts/agent-runtime/v1/')
			&& !normalizedInput.includes('scripts/agent-runtime/')
			&& !normalizedInput.includes('packages/operon-cli/')
			&& !normalizedInput.endsWith('/fixture-contracts.ts')
			&& !normalizedInput.endsWith('/fixture-decoders.ts')
			&& !normalizedInput.endsWith('/mutation-acceptance.ts')
			&& !normalizedInput.includes('node_modules/ajv/'),
			`Development-only schema, test, or portable CLI source entered the production graph: ${normalizedInput}`,
		);
		for (const imported of metadata.imports ?? []) {
			const normalizedImport = imported.path.replaceAll('\\', '/');
			if (!normalizedImport.includes('src/agent-runtime/contracts/v1/')) continue;
			const importer = relative(path.resolve(pluginRoot, normalizedInput));
			if (importer.startsWith('src/agent-runtime/contracts/v1/')) continue;
			assert.ok(
				productionContractImporters.has(importer),
				`Non-allowlisted production module imported portable contracts: ${importer}`,
			);
		}
	}
}

function runSemanticContractGuards(fixtures, module, validators) {
	const incompatible = fixture(fixtures, 'incompatible-positive-remote-range').value;
	const localOffer = {
		contractVersion: 1,
		runtimeApi: { min: 1, max: 1 },
	};
	const negotiation = module.negotiateCompatibilityV1(localOffer, incompatible);
	assert.equal(negotiation.compatible, false, 'Disjoint positive ranges must negotiate as incompatible.');
	const overlapping = module.negotiateCompatibilityV1(
		{ contractVersion: 1, runtimeApi: { min: 1, max: 2 } },
		{ contractVersion: 1, runtimeApi: { min: 1, max: 1 } },
	);
	assert.deepEqual(
		overlapping,
		{ contractVersion: 1, compatible: true, runtimeApi: 1 },
		'Runtime API 1 must be selected from the 1..2 and 1..1 overlap.',
	);
	assert.equal(
		module.decodeCompatibilityOfferV1({
			contractVersion: 1,
			runtimeApi: { min: 2, max: 1 },
		}).ok,
		false,
		'Compatibility admission must reject min greater than max.',
	);
	assert.equal(
		module.negotiateCompatibilityV1(
			{ contractVersion: 1, runtimeApi: { min: 2, max: 2 } },
			{ contractVersion: 1, runtimeApi: { min: 1, max: 1 } },
		).compatible,
		false,
		'Product or package SemVer cannot bypass a disjoint Runtime API range.',
	);
	const futureError = {
		contractVersion: 1,
		code: 'future-safe-error',
		reason: 'A future Runtime error requires inspection.',
		retryable: false,
		action: 'do-not-retry',
	};
	assert.equal(
		module.decodeContractFixtureV1('structured-error', futureError).ok,
		true,
		'Pattern-valid additive error codes must remain decodable.',
	);
	assert.deepEqual(
		module.errorPolicyForCodeV1(futureError.code),
		{
			code: 'future-safe-error',
			action: 'do-not-retry',
			retryable: false,
			recovery: 'none',
			exitClass: 'internal',
		},
		'Unknown error codes must never authorize retry or apply.',
	);
	assert.equal(
		module.decodeContractFixtureV1('structured-error', {
			...futureError,
			retryable: true,
			action: 'wait-and-retry',
		}).ok,
		false,
		'Unknown error codes must not carry retry authority through the decoder.',
	);
	const futureCapability = {
		id: 'future.safe.read',
		availability: 'available',
		stability: 'stable',
	};
	assert.equal(
		module.decodeCapabilityAdvertisementsV1([futureCapability]).ok,
		true,
		'Pattern-valid additive capabilities must remain decodable.',
	);
	assert.equal(
		module.isCapabilityIdV1(futureCapability.id),
		false,
		'Unknown capability advertisements must not become authority evidence.',
	);

	const registry = fixture(fixtures, 'valid-closed-capability-registry').value;
	assert.deepEqual(
		registry,
		module.CAPABILITY_REGISTRY_V1,
		'Closed JSON capability fixture drifted from the immutable TypeScript registry.',
	);
	const fullCapabilityAdvertisements = module.CAPABILITY_REGISTRY_V1.map(capability => ({
		id: capability.id,
		availability: 'available',
		stability: 'stable',
	}));
	const fullCapabilityHealth = {
		...fixture(fixtures, 'valid-ready-runtime-health-with-durable-revision').value,
		capabilities: fullCapabilityAdvertisements,
	};
	assert.equal(
		module.decodeContractFixtureV1('runtime-health', fullCapabilityHealth).ok,
		true,
		'Runtime health must admit the complete 35-capability V1 registry.',
	);
	const additiveCompatibilityHealth = structuredClone(fullCapabilityHealth);
	additiveCompatibilityHealth.compatibility.futureOptionalField = 'safe-to-ignore';
	assert.equal(
		validators.get('runtime-health')(additiveCompatibilityHealth),
		true,
		'Runtime health compatibility advertisements must tolerate additive response fields.',
	);
	assert.equal(
		module.decodeContractFixtureV1('runtime-health', additiveCompatibilityHealth).ok,
		true,
		'Runtime health decoder must tolerate additive compatibility advertisement fields.',
	);
	assert.equal(
		module.decodeContractFixtureV1('runtime-diagnostics', {
			contractVersion: 1,
			kind: 'runtime-diagnostics',
			health: fullCapabilityHealth,
			capabilities: fullCapabilityAdvertisements,
			transport: {
				endpointKind: 'windows-named-pipe',
				securityBackend: 'windows-dacl',
				persistentTransportAvailable: false,
				failureReason: 'persistent-read-server-starting',
			},
			warnings: [],
		}).ok,
		true,
		'Runtime diagnostics must admit the complete 35-capability V1 registry.',
	);
	const partialMutationResult = structuredClone(
		fixture(fixtures, 'valid-partial-atomic-group-result').value,
	);
	const recoverablePartialEnvelope = {
		...structuredClone(fixture(fixtures, 'valid-cli-capabilities-result').value),
		requestId: partialMutationResult.requestId,
		command: 'mutation.apply',
		client: { planRef: `p${'a'.repeat(31)}` },
		result: partialMutationResult,
		recovery: {
			required: true,
			planRef: `p${'a'.repeat(31)}`,
			action: 'recover-same-plan',
			mutationMayHaveApplied: true,
		},
	};
	assert.equal(validators.get('cli-result')(recoverablePartialEnvelope), true);
	assert.equal(module.decodeContractFixtureV1('cli-result', recoverablePartialEnvelope).ok, true);
	for (const terminalStatus of ['applied', 'already-applied']) {
		const terminalRecovery = structuredClone(recoverablePartialEnvelope);
		terminalRecovery.result.status = terminalStatus;
		assertSchemaDecoderRejects(
			'cli-result',
			terminalRecovery,
			module,
			validators,
			`Recovery metadata must be rejected for ${terminalStatus}.`,
		);
	}
	const finderFailure = {
		...structuredClone(fixture(fixtures, 'valid-task-get-failure').value),
		kind: 'task-finder-result',
	};
	const finderCliEnvelope = {
		...structuredClone(fixture(fixtures, 'valid-cli-capabilities-result').value),
		requestId: finderFailure.requestId,
		command: 'tasks.finder',
		result: finderFailure,
	};
	assert.equal(
		validators.get('cli-result')(finderCliEnvelope),
		true,
		`CLI schema rejected a valid Task Finder result: ${JSON.stringify(
			validators.get('cli-result').errors,
		)}`,
	);
	assert.equal(module.decodeContractFixtureV1('cli-result', finderCliEnvelope).ok, true);
	assert.equal(
		module.CAPABILITY_REGISTRY_V1.find(item => item.id === 'tasks.convert.apply').destructive,
		false,
		'Convert capability cannot be globally destructive; file-to-inline risk is spec-derived.',
	);
	assert.equal(
		module.requiredRiskForSpecV1({
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'exact-line',
				filePath: 'Tasks/Converted.md',
				lineNumber: 0,
			},
		}),
		'destructive',
		'File-to-inline conversion must be destructive.',
	);
	assert.equal(
		module.requiredRiskForSpecV1({
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId: 'template:default',
			targetPath: 'Tasks/Converted.md',
		}),
		'elevated',
		'Inline-to-file conversion must be elevated, not destructive.',
	);

	const validApply = fixture(fixtures, 'valid-destructive-delete-apply').value;
	for (const acknowledgement of validApply.acknowledgements) {
		assert.equal(acknowledgement.planHash, validApply.plan.planHash, 'Acknowledgement must bind to the sealed plan hash.');
		assert.ok(
			validApply.plan.targets.some(target => target.targetDigest === acknowledgement.targetDigest),
			'Acknowledgement must bind to a sealed target digest.',
		);
	}

	const outcomeStatuses = module.ATOMIC_GROUP_STATUSES_V1;
	assert.ok(!outcomeStatuses.includes('compensated'), 'V1 must not emit compensated atomic-group results.');
	assert.deepEqual(
		module.ATOMIC_GROUP_OUTCOME_VOCABULARY_V1,
		['committed', 'failed', 'compensated', 'outcome-unknown'],
		'Reserved outcome vocabulary must remain explicit without making compensation emit-capable.',
	);

	const receipt = fixture(fixtures, 'valid-metadata-only-receipt').value;
	for (const forbidden of ['description', 'note', 'tasks', 'context', 'sourceMarkdown']) {
		assert.ok(!Object.hasOwn(receipt, forbidden), `Receipt leaked forbidden task/context field: ${forbidden}`);
	}
	const effectiveAt = Date.parse(receipt.effectiveAt);
	const completedAt = Date.parse(receipt.completedAt);
	const expiresAt = Date.parse(receipt.expiresAt);
	assert.ok(effectiveAt <= completedAt, 'Receipt completion cannot precede the effective mutation time.');
	assert.equal(expiresAt - completedAt, 24 * 60 * 60 * 1000, 'Receipt fixture must encode the V1 24-hour TTL.');

	assert.equal(
		module.sha256HexV1(''),
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		'Pure SHA-256 must match the empty-string standard vector.',
	);
	assert.equal(
		module.sha256HexV1('abc'),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		'Pure SHA-256 must match the abc standard vector.',
	);
	assert.equal(
		module.canonicalJsonV1({ '\u0065\u0301': 'decomposed', a: 1 }),
		'{"a":1,"é":"decomposed"}',
		'Canonical JSON must normalize strings and keys to NFC before hashing.',
	);

	const inherited = Object.assign(Object.create({ polluted: true }), localOffer);
	const prototypeResult = module.decodeContractFixtureV1('compatibility-offer', inherited);
	assert.equal(prototypeResult.ok, false, 'Strict decoders must reject inherited prototypes.');
	const explicitPrototypeKey = JSON.parse(
		'{"contractVersion":1,"runtimeApi":{"min":1,"max":1},"__proto__":{"polluted":true}}',
	);
	const prototypeKeyResult = module.decodeContractFixtureV1('compatibility-offer', explicitPrototypeKey);
	assert.equal(prototypeKeyResult.ok, false, 'Strict decoders must reject explicit prototype keys.');

	const canonicalReadOnly = structuredClone(fixture(fixtures, 'valid-legacy-invalid-task-context').value);
	canonicalReadOnly.identity = {
		operonId: 'abc1234',
		validity: 'canonical',
		mutationAllowed: false,
	};
	assertSchemaDecoderRejects(
		'task-context',
		canonicalReadOnly,
		module,
		validators,
		'Canonical identity cannot claim mutationAllowed=false.',
	);
	const malformedDuplicate = structuredClone(fixture(fixtures, 'valid-legacy-invalid-task-context').value);
	malformedDuplicate.identity = {
		operonId: 'LEGACY-ID',
		validity: 'duplicate',
		mutationAllowed: false,
	};
	assertSchemaDecoderRejects(
		'task-context',
		malformedDuplicate,
		module,
		validators,
		'Duplicate validity requires canonical operonId shape.',
	);
	const oversizedReminderValue = structuredClone(
		fixture(fixtures, 'valid-legacy-invalid-task-context').value,
	);
	oversizedReminderValue.reminderItems[0].expectedValue = 'x'.repeat(4_097);
	assertSchemaDecoderRejects(
		'task-context',
		oversizedReminderValue,
		module,
		validators,
		'Reminder item references enforce the 4 KiB expected-value cap.',
	);
	const excessiveReminderItems = structuredClone(
		fixture(fixtures, 'valid-legacy-invalid-task-context').value,
	);
	excessiveReminderItems.reminderItems = Array.from({ length: 257 }, (_, index) => ({
		collection: 'reminderRules',
		itemId: `item-${index}-${'a'.repeat(64)}`,
		expectedValue: `legacy-${index}`,
	}));
	assertSchemaDecoderRejects(
		'task-context',
		excessiveReminderItems,
		module,
		validators,
		'Reminder item hydration enforces the 256-item cap.',
	);
	const oversizedReminderHydration = structuredClone(
		fixture(fixtures, 'valid-legacy-invalid-task-context').value,
	);
	oversizedReminderHydration.reminderItems = Array.from({ length: 17 }, (_, index) => ({
		collection: 'reminderRules',
		itemId: `item-${index}-${'b'.repeat(64)}`,
		expectedValue: `${index}-${'x'.repeat(4_000)}`,
	}));
	assertSchemaDecoderRejects(
		'task-context',
		oversizedReminderHydration,
		module,
		validators,
		'Reminder item hydration enforces the 64 KiB task cap.',
	);
}

function runGeneratedBoundaryDifferential(fixtures, module, validators) {
	let count = 0;
	const assertPair = (schemaId, value, expected, label) => {
		const validator = validators.get(schemaId);
		assert.ok(validator, `Missing boundary schema: ${schemaId}`);
		const schemaAccepted = validator(value);
		const decoded = module.decodeContractFixtureV1(schemaId, value);
		assert.equal(
			schemaAccepted,
			expected,
			`JSON Schema boundary mismatch: ${label}; ${JSON.stringify(validator.errors ?? [])}`,
		);
		assert.equal(
			decoded.ok,
			expected,
			`TypeScript boundary mismatch: ${label}; ${JSON.stringify(decoded.ok ? [] : decoded.issues)}`,
		);
		assert.equal(schemaAccepted, decoded.ok, `Boundary schema/decoder drift: ${label}`);
		count += 1;
	};
	const assertSchemaAndSafetyReject = (schemaId, value, safetyValidator, label) => {
		const validator = validators.get(schemaId);
		assert.ok(validator, `Missing safety schema: ${schemaId}`);
		assert.equal(
			validator(value),
			false,
			`JSON Schema safety extension accepted invalid value: ${label}`,
		);
		assert.ok(safetyValidator(value).length > 0, `TypeScript safety validator accepted invalid value: ${label}`);
		count += 1;
	};

	const exactRequest = fixture(fixtures, 'valid-exact-context-request').value;
	const exactWithoutSelector = structuredClone(exactRequest);
	delete exactWithoutSelector.selector;
	assertPair('context-request', exactWithoutSelector, false, 'exact-task requires selector');
	const exactWithQuery = structuredClone(exactRequest);
	exactWithQuery.filters = { text: 'query must not accompany exact-task' };
	assertPair('context-request', exactWithQuery, false, 'exact-task forbids query filters');
	for (const projection of ['task-neighborhood', 'project-analysis', 'mutation-preview']) {
		const missingSelector = structuredClone(exactRequest);
		missingSelector.projection = projection;
		if (projection === 'mutation-preview') {
			missingSelector.purpose = 'mutation-readiness';
			missingSelector.mutationKind = 'task.update';
		}
		delete missingSelector.selector;
		delete missingSelector.limit;
		delete missingSelector.depth;
		assertPair('context-request', missingSelector, false, `${projection} requires selector`);
	}
	const exactWithCursor = structuredClone(exactRequest);
	exactWithCursor.cursor = 'cursor-boundary-value';
	assertPair('context-request', exactWithCursor, false, 'exact-task forbids cursor');
	const contextWithWritableFields = structuredClone(exactRequest);
	contextWithWritableFields.include = ['writable-fields'];
	assertPair('context-request', contextWithWritableFields, false, 'context request forbids task-get-only writable fields');
	const taskGetWithWritableFields = structuredClone(fixture(fixtures, 'valid-task-get-request').value);
	taskGetWithWritableFields.include = ['writable-fields'];
	assertPair('task-get-request', taskGetWithWritableFields, true, 'exact task get permits writable fields');
	const planningQuery = structuredClone(exactRequest);
	planningQuery.projection = 'planning-workload';
	planningQuery.purpose = 'planning';
	planningQuery.filters = { text: 'bounded planning query' };
	delete planningQuery.selector;
	delete planningQuery.limit;
	delete planningQuery.depth;
	assertPair('context-request', planningQuery, true, 'planning-workload permits query without selector');
	const planningWithSelector = structuredClone(planningQuery);
	planningWithSelector.selector = structuredClone(exactRequest.selector);
	assertPair('context-request', planningWithSelector, false, 'planning-workload forbids selector');
	const planningWithDepth = structuredClone(planningQuery);
	planningWithDepth.depth = 1;
	assertPair('context-request', planningWithDepth, false, 'planning-workload forbids depth');
	for (const projection of ['task-neighborhood', 'project-analysis', 'creation-context', 'mutation-preview']) {
		const queryOutsidePlanning = structuredClone(exactRequest);
		queryOutsidePlanning.projection = projection;
		queryOutsidePlanning.filters = { text: 'query outside planning' };
		if (projection === 'creation-context') queryOutsidePlanning.purpose = 'creation';
		if (projection === 'mutation-preview') {
			queryOutsidePlanning.purpose = 'mutation-readiness';
			queryOutsidePlanning.mutationKind = 'task.update';
		}
		delete queryOutsidePlanning.limit;
		delete queryOutsidePlanning.depth;
		if (projection === 'creation-context') delete queryOutsidePlanning.selector;
		assertPair('context-request', queryOutsidePlanning, false, `${projection} forbids query filters`);
	}
	const mutationWithCursor = structuredClone(exactRequest);
	mutationWithCursor.projection = 'mutation-preview';
	mutationWithCursor.purpose = 'mutation-readiness';
	mutationWithCursor.mutationKind = 'task.update';
	mutationWithCursor.cursor = 'cursor-boundary-value';
	delete mutationWithCursor.limit;
	delete mutationWithCursor.depth;
	assertPair('context-request', mutationWithCursor, false, 'mutation-preview forbids cursor');
	const mutationWithDepth = structuredClone(mutationWithCursor);
	delete mutationWithDepth.cursor;
	mutationWithDepth.depth = 1;
	assertPair('context-request', mutationWithDepth, false, 'mutation-preview forbids depth');
	const multiReadiness = structuredClone(mutationWithDepth);
	delete multiReadiness.selector;
	delete multiReadiness.depth;
	multiReadiness.operonIds = ['root001', 'child01'];
	assertPair('context-request', multiReadiness, true, 'mutation-preview accepts two exact update ids');
	const multiReadinessWithSelector = structuredClone(multiReadiness);
	multiReadinessWithSelector.selector = structuredClone(exactRequest.selector);
	assertPair('context-request', multiReadinessWithSelector, false, 'multi readiness rejects selector');
	const multiReadinessDuplicate = structuredClone(multiReadiness);
	multiReadinessDuplicate.operonIds = ['root001', 'root001'];
	assertPair('context-request', multiReadinessDuplicate, false, 'multi readiness rejects duplicate ids');
	const multiReadinessOne = structuredClone(multiReadiness);
	multiReadinessOne.operonIds = ['root001'];
	assertPair('context-request', multiReadinessOne, false, 'multi readiness rejects one id');
	const multiReadinessWrongKind = structuredClone(multiReadiness);
	multiReadinessWrongKind.mutationKind = 'task.transition';
	assertPair('context-request', multiReadinessWrongKind, false, 'multi readiness is update only');
	for (const [label, cursor, expected] of [
		['cursor at 16 characters', 'c'.repeat(16), true],
		['cursor below 16 characters', 'c'.repeat(15), false],
		['cursor at 4096 characters', 'c'.repeat(4096), true],
		['cursor above 4096 characters', 'c'.repeat(4097), false],
	]) {
		const candidate = structuredClone(exactRequest);
		candidate.projection = 'task-neighborhood';
		delete candidate.limit;
		delete candidate.depth;
		candidate.cursor = cursor;
		assertPair('context-request', candidate, expected, label);
	}
	const compatibility = fixture(fixtures, 'valid-compatibility-offer-v1').value;
	const maximumCompatibility = structuredClone(compatibility);
	maximumCompatibility.runtimeApi.max = Number.MAX_SAFE_INTEGER;
	assertPair('compatibility-offer', maximumCompatibility, true, 'compatibility range at MAX_SAFE_INTEGER');
	const unsafeCompatibility = structuredClone(compatibility);
	unsafeCompatibility.runtimeApi.max = Number.MAX_SAFE_INTEGER + 1;
	assertPair('compatibility-offer', unsafeCompatibility, false, 'compatibility range above MAX_SAFE_INTEGER');

	const catalogFixture = fixture(fixtures, 'valid-built-in-and-custom-field-catalog').value;
	const catalogAtCap = Array.from({ length: 512 }, (_, index) => ({
		...structuredClone(catalogFixture[1]),
		canonicalKey: `custom-${index}`,
	}));
	assertPair('field-catalog', catalogAtCap, true, 'field catalog at 512 descriptors');
	const catalogAboveCap = structuredClone(catalogAtCap);
	catalogAboveCap.push({ ...structuredClone(catalogFixture[1]), canonicalKey: 'custom-overflow' });
	assertPair('field-catalog', catalogAboveCap, false, 'field catalog above 512 descriptors');
	for (const [label, propertyName, value, expected] of [
		['catalog canonical key at 256 characters', 'canonicalKey', 'k'.repeat(256), true],
		['catalog canonical key above 256 characters', 'canonicalKey', 'k'.repeat(257), false],
		['catalog display name at 256 characters', 'displayName', 'D'.repeat(256), true],
		['catalog display name above 256 characters', 'displayName', 'D'.repeat(257), false],
		['catalog description at 4096 characters', 'description', 'd'.repeat(4096), true],
		['catalog description above 4096 characters', 'description', 'd'.repeat(4097), false],
		['catalog mutation owner at 256 characters', 'mutationOwner', 'm'.repeat(256), true],
		['catalog mutation owner above 256 characters', 'mutationOwner', 'm'.repeat(257), false],
		['catalog canonical key at 256 Unicode characters', 'canonicalKey', '😀'.repeat(256), true],
		['catalog canonical key above 256 Unicode characters', 'canonicalKey', '😀'.repeat(257), false],
	]) {
		const candidate = [structuredClone(catalogFixture[1])];
		if (propertyName === 'mutationOwner') candidate[0].mutationClass = 'runtime-owned';
		candidate[0][propertyName] = value;
		assertPair('field-catalog', candidate, expected, label);
	}

	const context = fixture(fixtures, 'valid-legacy-invalid-task-context').value;
	for (const [label, mutate, expected] of [
		['task context valid leap date', candidate => { candidate.dates.due = '2024-02-29'; }, true],
		['task context invalid calendar date', candidate => { candidate.dates.due = '2026-02-29'; }, false],
		['task context valid local datetime', candidate => { candidate.datetimes.start = '2026-07-23T23:59:59'; }, true],
		['task context invalid local datetime', candidate => { candidate.datetimes.start = '2026-07-23T24:00'; }, false],
		['task context canonical repeat series id', candidate => { candidate.recurrence.seriesId = 'rsabc12'; }, true],
		['task context invalid repeat series id', candidate => { candidate.recurrence.seriesId = 'series-1'; }, false],
		['task context valid occurrence date', candidate => { candidate.recurrence.occurrenceDate = '2024-02-29'; }, true],
		['task context invalid occurrence date', candidate => { candidate.recurrence.occurrenceDate = '2026-02-29'; }, false],
		['task context empty description', candidate => { candidate.description = ''; }, false],
		['task context empty hydrated link', candidate => { candidate.links = ['']; }, false],
		['writable field description cannot clear', candidate => { candidate.writableFields[0].canClear = true; }, false],
		['present writable field requires value', candidate => { delete candidate.writableFields[0].value; }, false],
		['absent writable field forbids value', candidate => { candidate.writableFields[1].value = '2026-07-25'; }, false],
		['writable field value follows declared type', candidate => { candidate.writableFields[1] = {
			canonicalKey: 'dateDue',
			valueType: 'date',
			present: true,
			value: '2026-02-30',
			canClear: true,
		}; }, false],
		['writable canonical key at 256 Unicode characters', candidate => {
			candidate.writableFields[1].canonicalKey = '😀'.repeat(256);
		}, true],
		['writable canonical key above 256 Unicode characters', candidate => {
			candidate.writableFields[1].canonicalKey = '😀'.repeat(257);
		}, false],
	]) {
		const candidate = structuredClone(context);
		mutate(candidate);
		assertPair('task-context', candidate, expected, label);
	}
	for (const [label, field, value, expected] of [
		['note ASCII at 8 KiB', 'note', 'a'.repeat(8 * 1024), true],
		['note ASCII above 8 KiB', 'note', 'a'.repeat(8 * 1024 + 1), false],
		['note four-byte Unicode at 8 KiB', 'note', '😀'.repeat(2 * 1024), true],
		['note four-byte Unicode above 8 KiB', 'note', '😀'.repeat(2 * 1024 + 1), false],
		['source Markdown ASCII at 64 KiB', 'sourceMarkdown', 'a'.repeat(64 * 1024), true],
		['source Markdown ASCII above 64 KiB', 'sourceMarkdown', 'a'.repeat(64 * 1024 + 1), false],
		['source Markdown Unicode at 64 KiB', 'sourceMarkdown', '😀'.repeat(16 * 1024), true],
		['source Markdown Unicode above 64 KiB', 'sourceMarkdown', '😀'.repeat(16 * 1024 + 1), false],
		['description ASCII at 64 KiB', 'description', 'a'.repeat(64 * 1024), true],
		['description ASCII above 64 KiB', 'description', 'a'.repeat(64 * 1024 + 1), false],
	]) {
		const candidate = structuredClone(context);
		candidate[field] = value;
		assertPair('task-context', candidate, expected, label);
	}
	const linksAtCap = structuredClone(context);
	linksAtCap.links = Array.from({ length: 50 }, (_, index) => `https://example.invalid/${index}`);
	assertPair('task-context', linksAtCap, true, 'links at 50 items');
	const linksAboveCap = structuredClone(linksAtCap);
	linksAboveCap.links.push('https://example.invalid/overflow');
	assertPair('task-context', linksAboveCap, false, 'links above 50 items');
	const writableFieldsAtCap = structuredClone(context);
	writableFieldsAtCap.writableFields = Array.from({ length: 512 }, (_, index) => ({
		canonicalKey: `custom-${index}`,
		valueType: 'text',
		present: false,
		canClear: true,
	}));
	assertPair('task-context', writableFieldsAtCap, true, 'writable fields at 512 items');
	const writableFieldsAboveCap = structuredClone(writableFieldsAtCap);
	writableFieldsAboveCap.writableFields.push({
		canonicalKey: 'custom-overflow',
		valueType: 'text',
		present: false,
		canClear: true,
	});
	assertPair('task-context', writableFieldsAboveCap, false, 'writable fields above 512 items');
	const oversizedWritableFields = structuredClone(context);
	oversizedWritableFields.writableFields = Array.from({ length: 5 }, (_, index) => ({
		canonicalKey: `large-${index}`,
		valueType: 'text',
		present: true,
		value: 'w'.repeat(60 * 1024),
		canClear: true,
	}));
	assertPair('task-context', oversizedWritableFields, false, 'writable fields above 256 KiB encoded');

	const emptyCustomFieldsBytes = utf8Size({ boundary: '' });
	const customFieldsAtCap = structuredClone(context);
	customFieldsAtCap.customFields = { boundary: 'a'.repeat(32 * 1024 - emptyCustomFieldsBytes) };
	assertPair('task-context', customFieldsAtCap, true, 'custom fields at 32 KiB encoded');
	const customFieldsAboveCap = structuredClone(customFieldsAtCap);
	customFieldsAboveCap.customFields.boundary += 'a';
	assertPair('task-context', customFieldsAboveCap, false, 'custom fields above 32 KiB encoded');

	const trackerHistoryAsciiAtCap = structuredClone(context);
	trackerHistoryAsciiAtCap.trackerHistory = [
		'a'.repeat(4093),
		'a'.repeat(4093),
		'a'.repeat(4093),
		'a'.repeat(4093),
		'a'.repeat(4093),
		'a'.repeat(4093),
		'a'.repeat(4093),
		'a'.repeat(4092),
	];
	assert.equal(utf8Size(trackerHistoryAsciiAtCap.trackerHistory), 32 * 1024);
	assertPair('task-context', trackerHistoryAsciiAtCap, true, 'tracker history ASCII at 32 KiB encoded');
	const trackerHistoryAsciiAboveCap = structuredClone(trackerHistoryAsciiAtCap);
	trackerHistoryAsciiAboveCap.trackerHistory[7] += 'a';
	assertPair('task-context', trackerHistoryAsciiAboveCap, false, 'tracker history ASCII above 32 KiB encoded');

	const trackerHistoryUnicodeAtCap = structuredClone(context);
	trackerHistoryUnicodeAtCap.trackerHistory = [
		'😀'.repeat(4096),
		'😀'.repeat(4089),
		'😀',
		'😀',
		'😀',
	];
	assert.equal(utf8Size(trackerHistoryUnicodeAtCap.trackerHistory), 32 * 1024);
	assertPair('task-context', trackerHistoryUnicodeAtCap, true, 'tracker history Unicode at 32 KiB encoded');
	const trackerHistoryUnicodeAboveCap = structuredClone(trackerHistoryUnicodeAtCap);
	trackerHistoryUnicodeAboveCap.trackerHistory[4] += '😀';
	assertPair('task-context', trackerHistoryUnicodeAboveCap, false, 'tracker history Unicode above 32 KiB encoded');

	const relationshipAtCap = structuredClone(context);
	relationshipAtCap.relationships.childOperonIds = Array.from(
		{ length: 100 },
		(_, index) => index.toString(36).padStart(7, '0'),
	);
	assertPair('task-context', relationshipAtCap, true, 'relationship ids at 100');
	const relationshipAboveCap = structuredClone(relationshipAtCap);
	relationshipAboveCap.relationships.childOperonIds.push('000002s');
	assertPair('task-context', relationshipAboveCap, false, 'relationship ids above 100');
	const invalidRelationshipId = structuredClone(context);
	invalidRelationshipId.relationships.relatedOperonIds = ['NOT-CANONICAL'];
	assertPair('task-context', invalidRelationshipId, false, 'relationship requires canonical operonId');
	const duplicateRelationshipId = structuredClone(context);
	duplicateRelationshipId.relationships.blockingOperonIds = ['abc1234', 'abc1234'];
	assertPair('task-context', duplicateRelationshipId, false, 'relationship operonIds must be unique');
	const safeSessionCount = structuredClone(context);
	safeSessionCount.tracker.sessionCount = Number.MAX_SAFE_INTEGER;
	assertPair('task-context', safeSessionCount, true, 'session count at MAX_SAFE_INTEGER');
	const unsafeSessionCount = structuredClone(context);
	unsafeSessionCount.tracker.sessionCount = Number.MAX_SAFE_INTEGER + 1;
	assertPair('task-context', unsafeSessionCount, false, 'session count above MAX_SAFE_INTEGER');
	for (const [label, field, value, expected] of [
		['taxonomy id at 256 characters', 'id', 'a'.repeat(256), true],
		['taxonomy id above 256 characters', 'id', 'a'.repeat(257), false],
		['taxonomy label at 256 characters', 'label', 'a'.repeat(256), true],
		['taxonomy label above 256 characters', 'label', 'a'.repeat(257), false],
	]) {
		const candidate = structuredClone(context);
		candidate.priority = { id: 'priority-id', label: 'Priority' };
		candidate.priority[field] = value;
		assertPair('task-context', candidate, expected, label);
	}

	const exactResult = structuredClone(fixture(fixtures, 'valid-stale-cursor-context-pack').value);
	exactResult.requestId = 'ctx-exact-result-boundary';
	exactResult.ok = true;
	exactResult.purpose = 'read';
	exactResult.projection = 'exact-task';
	exactResult.execution = {
		source: 'live-runtime',
		coherence: 'verified',
		observedAt: '2026-07-23T08:01:00.000Z',
		settled: true,
	};
	exactResult.entities = [structuredClone(context)];
	exactResult.relationships = { explicit: [], derived: [], inferred: [] };
	exactResult.provenance = [];
	exactResult.truncations = [];
	exactResult.contextRevision = structuredClone(context.contextRevision);
	delete exactResult.error;
	assertPair('context-pack', exactResult, true, 'exact-task result at one task');
	const exactResultWithoutRevision = structuredClone(exactResult);
	delete exactResultWithoutRevision.contextRevision;
	assertPair('context-pack', exactResultWithoutRevision, false, 'successful context result requires context revision');
	for (const [label, truncation, expected] of [
		['valid truncation relation', { path: '/tasks', actualCount: 2, returnedCount: 1, limit: 1 }, true],
		['truncation actual equals returned', { path: '/tasks', actualCount: 1, returnedCount: 1, limit: 1 }, false],
		['truncation returned exceeds actual', { path: '/tasks', actualCount: 1, returnedCount: 2, limit: 2 }, false],
		['truncation returned exceeds limit', { path: '/tasks', actualCount: 3, returnedCount: 2, limit: 1 }, false],
	]) {
		const candidate = structuredClone(exactResult);
		candidate.truncations = [truncation];
		assertPair('context-pack', candidate, expected, label);
	}
	for (const [label, code, expected] of [
		['warning code canonical', 'projection-truncated', true],
		['warning code uppercase forbidden', 'Projection-Truncated', false],
		['warning code trailing hyphen forbidden', 'projection-', false],
	]) {
		const candidate = structuredClone(exactResult);
		candidate.warnings = [{ code, message: 'Boundary warning.' }];
		assertPair('context-pack', candidate, expected, label);
	}
	const errorDetailsAtCap = structuredClone(fixture(fixtures, 'valid-stale-cursor-context-pack').value);
	errorDetailsAtCap.error.details = Object.fromEntries(
		Array.from({ length: 32 }, (_, index) => [`key-${index}`, index]),
	);
	assertPair('context-pack', errorDetailsAtCap, true, 'structured error details at 32 properties');
	const errorDetailsAboveCap = structuredClone(errorDetailsAtCap);
	errorDetailsAboveCap.error.details['key-overflow'] = true;
	assertPair('context-pack', errorDetailsAboveCap, false, 'structured error details above 32 properties');
	const nestedJsonAtCap = structuredClone(errorDetailsAtCap);
	nestedJsonAtCap.error.details = {
		nested: Object.fromEntries(Array.from({ length: 128 }, (_, index) => [`key-${index}`, index])),
	};
	assertPair('context-pack', nestedJsonAtCap, true, 'nested JSON object at 128 properties');
	const nestedJsonAboveCap = structuredClone(nestedJsonAtCap);
	nestedJsonAboveCap.error.details.nested['key-overflow'] = true;
	assertPair('context-pack', nestedJsonAboveCap, false, 'nested JSON object above 128 properties');
	const exactResultWithoutTask = structuredClone(exactResult);
	exactResultWithoutTask.entities = [];
	assertPair('context-pack', exactResultWithoutTask, false, 'successful exact-task result requires one task');
	const exactResultAboveCap = structuredClone(exactResult);
	exactResultAboveCap.entities.push(structuredClone(context));
	assertPair('context-pack', exactResultAboveCap, false, 'exact-task result above one task');

	const encodedCaps = [786_432, 3_145_728];
	for (const maximum of encodedCaps) {
		const validator = ajv.compile({ type: 'string', 'x-operon-maxUtf8Bytes': maximum });
		for (const [label, value, expected] of [
			[`ASCII at ${maximum} bytes`, 'a'.repeat(maximum), true],
			[`ASCII above ${maximum} bytes`, 'a'.repeat(maximum + 1), false],
			[`Unicode at ${maximum} bytes`, '😀'.repeat(maximum / 4), true],
			[`Unicode above ${maximum} bytes`, '😀'.repeat(maximum / 4 + 1), false],
		]) {
			assert.equal(validator(value), expected, `Encoded-byte keyword mismatch: ${label}`);
			assert.equal(module.utf8ByteLengthV1(value) <= maximum, expected, `UTF-8 implementation mismatch: ${label}`);
			count += 1;
		}
	}

	for (const [label, filePath, expected] of [
		['safe nested path', 'Tasks/Fixture.md', true],
		['absolute POSIX path', '/Tasks/Fixture.md', false],
		['drive path', 'C:/Tasks/Fixture.md', false],
		['UNC path', '\\\\server\\share\\Fixture.md', false],
		['backslash path', 'Tasks\\Fixture.md', false],
		['leading traversal', '../Fixture.md', false],
		['middle traversal', 'Tasks/../Fixture.md', false],
		['dot segment', 'Tasks/./Fixture.md', false],
		['empty segment', 'Tasks//Fixture.md', false],
		['control character', 'Tasks/\u0000Fixture.md', false],
	]) {
		assertPair('task-source-locator', { representation: 'file', filePath }, expected, label);
	}

	const preview = fixture(fixtures, 'valid-update-preview').value;
	for (const [label, mutate, expected] of [
		['preview requires client instance', candidate => { delete candidate.clientInstanceId; }, false],
		['preview bounds client instance', candidate => { candidate.clientInstanceId = 'x'.repeat(129); }, false],
		['preview requires idempotency key', candidate => { delete candidate.idempotencyKey; }, false],
		['preview validates idempotency key', candidate => { candidate.idempotencyKey = 'too-short'; }, false],
		['preview accepts optional correlation', candidate => { candidate.correlationId = 'correlation-boundary-001'; }, true],
		['preview validates optional correlation', candidate => { candidate.correlationId = 'bad/correlation'; }, false],
	]) {
		const candidate = structuredClone(preview);
		mutate(candidate);
		assertPair('mutation-preview-request', candidate, expected, label);
	}
	const updateCases = [
		['valid calendar date', { field: 'dateDue', valueType: 'date', value: '2024-02-29' }, true],
		['invalid calendar date', { field: 'dateDue', valueType: 'date', value: '2026-02-29' }, false],
		['valid local datetime minute', { field: 'datetimeStart', valueType: 'datetime', value: '2026-07-23T23:59' }, true],
		['valid local datetime second', { field: 'datetimeStart', valueType: 'datetime', value: '2026-07-23T23:59:59' }, true],
		['timezone forbidden in task datetime', { field: 'datetimeStart', valueType: 'datetime', value: '2026-07-23T23:59:59Z' }, false],
		['built-in value type mismatch', { field: 'estimate', valueType: 'text', value: '5' }, false],
		['null update forbidden', { field: 'description', valueType: 'text', value: null }, false],
		['semantic field forbidden', { field: 'status', valueType: 'text', value: 'done' }, false],
		['clear allowlisted field', { operation: 'clear', field: 'dateDue', valueType: 'date' }, true],
		['clear description forbidden', { operation: 'clear', field: 'description', valueType: 'text' }, false],
		['clear value forbidden', { operation: 'clear', field: 'dateDue', valueType: 'date', value: '2026-07-25' }, false],
		['clear built-in type mismatch', { operation: 'clear', field: 'estimate', valueType: 'text' }, false],
		['set field at 256 characters', { field: 's'.repeat(256), valueType: 'text', value: 'x' }, true],
		['set field above 256 characters', { field: 's'.repeat(257), valueType: 'text', value: 'x' }, false],
		['clear field at 256 characters', { operation: 'clear', field: 'c'.repeat(256), valueType: 'text' }, true],
		['clear field above 256 characters', { operation: 'clear', field: 'c'.repeat(257), valueType: 'text' }, false],
	];
	for (const [label, item, expected] of updateCases) {
		const candidate = structuredClone(preview);
		candidate.spec.changes = [item];
		assertPair('mutation-preview-request', candidate, expected, label);
	}
	const duplicateUpdate = structuredClone(preview);
	duplicateUpdate.spec.changes = [
		{ field: 'description', valueType: 'text', value: 'A' },
		{ field: 'description', valueType: 'text', value: 'B' },
	];
	assertPair('mutation-preview-request', duplicateUpdate, false, 'duplicate update field');

	const maximumUpdate = structuredClone(preview);
	maximumUpdate.spec.changes = Array.from({ length: 512 }, (_, index) => ({
		field: `custom-${index}`,
		valueType: 'text',
		value: 'x',
	}));
	assertPair('mutation-preview-request', maximumUpdate, true, 'update items at 512');
	const aboveMaximumUpdate = structuredClone(maximumUpdate);
	aboveMaximumUpdate.spec.changes.push({ field: 'custom-overflow', valueType: 'text', value: 'x' });
	assertPair('mutation-preview-request', aboveMaximumUpdate, false, 'update items above 512');
	const batchUpdate = structuredClone(preview);
	delete batchUpdate.target;
	batchUpdate.spec = {
		operation: 'update-batch',
		items: [
			{
				itemRef: 'first',
				target: {
					operonId: 'root001',
					locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 1 },
				},
				changes: [{ field: 'note', valueType: 'text', value: 'one' }],
			},
			{
				itemRef: 'second',
				target: {
					operonId: 'child01',
					locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 2 },
				},
				changes: [{ field: 'note', valueType: 'text', value: 'two' }],
			},
		],
	};
	assertPair('mutation-preview-request', batchUpdate, true, 'update-batch accepts two owned exact targets');
	const batchUpdateWithOuterTarget = structuredClone(batchUpdate);
	batchUpdateWithOuterTarget.target = structuredClone(preview.target);
	assertPair('mutation-preview-request', batchUpdateWithOuterTarget, false, 'update-batch rejects outer target');
	const batchUpdateDuplicateTarget = structuredClone(batchUpdate);
	batchUpdateDuplicateTarget.spec.items[1].target.operonId = 'root001';
	assertPair('mutation-preview-request', batchUpdateDuplicateTarget, false, 'update-batch rejects duplicate target');
	const batchUpdateOne = structuredClone(batchUpdate);
	batchUpdateOne.spec.items.pop();
	assertPair('mutation-preview-request', batchUpdateOne, false, 'update-batch rejects one item');
	const batchUpdateCrossSource = structuredClone(batchUpdate);
	batchUpdateCrossSource.spec.items[1].target.locator.filePath = 'Other.md';
	assertPair('mutation-preview-request', batchUpdateCrossSource, false, 'update-batch rejects cross-source targets');
	const batchUpdateFileTask = structuredClone(batchUpdate);
	batchUpdateFileTask.spec.items[1].target.locator = { representation: 'file', filePath: 'Tasks/Child.md' };
	assertPair('mutation-preview-request', batchUpdateFileTask, false, 'update-batch rejects file tasks');

	const createInline = structuredClone(preview);
	delete createInline.target;
	createInline.capability = 'tasks.create.preview';
	createInline.mutationKind = 'task.create';
	createInline.spec = {
		operation: 'create',
		items: [{
			itemRef: 'root',
			description: 'Boundary create',
			target: {
				representation: 'inline',
				mode: 'exact-path',
				filePath: 'Tasks/Fixture.md',
				lineNumber: 0,
			},
			fields: [],
			tags: [],
		}],
	};
	assertPair('mutation-preview-request', createInline, true, 'inline create exact target line');
	const createInlineAtSafeLine = structuredClone(createInline);
	createInlineAtSafeLine.spec.items[0].target.lineNumber = Number.MAX_SAFE_INTEGER;
	assertPair('mutation-preview-request', createInlineAtSafeLine, true, 'inline create line at MAX_SAFE_INTEGER');
	const createInlineAtUnsafeLine = structuredClone(createInline);
	createInlineAtUnsafeLine.spec.items[0].target.lineNumber = Number.MAX_SAFE_INTEGER + 1;
	assertPair('mutation-preview-request', createInlineAtUnsafeLine, false, 'inline create line above MAX_SAFE_INTEGER');
	const createInlineAppend = structuredClone(createInline);
	delete createInlineAppend.spec.items[0].target.lineNumber;
	assertPair('mutation-preview-request', createInlineAppend, true, 'inline exact path may append');
	const createFile = structuredClone(createInline);
	createFile.spec.items[0].target = {
		representation: 'file',
		mode: 'exact-path',
		filePath: 'Tasks/Fixture.md',
	};
	assertPair('mutation-preview-request', createFile, true, 'file create without line');
	const createConfiguredDefault = structuredClone(createInline);
	createConfiguredDefault.spec.items[0].target = { mode: 'configured-default' };
	assertPair(
		'mutation-preview-request',
		createConfiguredDefault,
		true,
		'configured-default create may defer representation to live policy',
	);
	const createConfiguredDefaultWithPath = structuredClone(createConfiguredDefault);
	createConfiguredDefaultWithPath.spec.items[0].target.filePath = 'Tasks/Fixture.md';
	assertPair(
		'mutation-preview-request',
		createConfiguredDefaultWithPath,
		false,
		'unscoped configured-default create cannot contain a path',
	);
	const createConfiguredDefaultWithTemplate = structuredClone(createConfiguredDefault);
	createConfiguredDefaultWithTemplate.spec.items[0].target.templateId = 'template:default';
	assertPair(
		'mutation-preview-request',
		createConfiguredDefaultWithTemplate,
		false,
		'unscoped configured-default create cannot contain a template',
	);
	const createFileBody = structuredClone(createFile);
	createFileBody.spec.items[0].bodyMarkdown = '# Details\n\n- Supporting note\n';
	assertPair('mutation-preview-request', createFileBody, true, 'file create accepts bounded Markdown body');
	const createInlineBody = structuredClone(createInline);
	createInlineBody.spec.items[0].bodyMarkdown = 'Inline body is unsupported.';
	assertPair('mutation-preview-request', createInlineBody, false, 'inline create rejects bodyMarkdown');
	const createUnresolvedBody = structuredClone(createConfiguredDefault);
	createUnresolvedBody.spec.items[0].bodyMarkdown = 'Representation must be explicit.';
	assertPair(
		'mutation-preview-request',
		createUnresolvedBody,
		false,
		'unscoped configured-default create rejects bodyMarkdown',
	);
	const createBodyAtUtf8Cap = structuredClone(createFile);
	createBodyAtUtf8Cap.spec.items[0].bodyMarkdown = 'é'.repeat(32_768);
	assertPair('mutation-preview-request', createBodyAtUtf8Cap, true, 'file body at 64 KiB UTF-8 cap');
	const createBodyAboveUtf8Cap = structuredClone(createFile);
	createBodyAboveUtf8Cap.spec.items[0].bodyMarkdown = `${'é'.repeat(32_768)}x`;
	assertPair('mutation-preview-request', createBodyAboveUtf8Cap, false, 'file body above 64 KiB UTF-8 cap');
	const createBodyWithUnsafeControl = structuredClone(createFile);
	createBodyWithUnsafeControl.spec.items[0].bodyMarkdown = 'safe\nunsafe\u0000';
	assertPair('mutation-preview-request', createBodyWithUnsafeControl, false, 'file body rejects unsafe control');
	const createFileWithLine = structuredClone(createFile);
	createFileWithLine.spec.items[0].target.lineNumber = 0;
	assertPair('mutation-preview-request', createFileWithLine, false, 'file create with line');
	const createGraph = structuredClone(createInline);
	createGraph.spec.items.push({
		itemRef: 'child',
		description: 'Child create',
		target: { representation: 'file', mode: 'configured-default' },
		fields: [{ kind: 'date', field: 'dateDue', value: '2026-07-24' }],
		tags: ['phase7'],
		statusId: 'status-open',
		priorityId: 'priority-normal',
		parent: { kind: 'created', itemRef: 'root' },
		related: [{ kind: 'existing', operonId: 'abc1234' }],
		dependencies: [
			{ relation: 'blocks', target: { kind: 'created', itemRef: 'root' } },
			{ relation: 'blocked-by', target: { kind: 'existing', operonId: 'def5678' } },
		],
	});
	assertPair('mutation-preview-request', createGraph, true, 'bounded create graph with parent and dependency references');
	const createGraphMissingRef = structuredClone(createGraph);
	createGraphMissingRef.spec.items[1].parent.itemRef = 'missing';
	assertPair('mutation-preview-request', createGraphMissingRef, false, 'created reference must resolve locally');
	const createGraphCycle = structuredClone(createGraph);
	createGraphCycle.spec.items[0].parent = { kind: 'created', itemRef: 'child' };
	assertPair('mutation-preview-request', createGraphCycle, false, 'create parent graph must be acyclic');
	const createGraphDuplicateRef = structuredClone(createGraph);
	createGraphDuplicateRef.spec.items[1].itemRef = 'root';
	assertPair('mutation-preview-request', createGraphDuplicateRef, false, 'create item refs must be unique');
	const createGraphMissingDependency = structuredClone(createGraph);
	createGraphMissingDependency.spec.items[1].dependencies[0].target.itemRef = 'missing';
	assertPair(
		'mutation-preview-request',
		createGraphMissingDependency,
		false,
		'created dependency target must resolve locally',
	);
	const createGraphSelfDependency = structuredClone(createGraph);
	createGraphSelfDependency.spec.items[1].dependencies[0].target.itemRef = 'child';
	assertPair('mutation-preview-request', createGraphSelfDependency, false, 'create dependency cannot target itself');
	const createGraphDuplicateDependency = structuredClone(createGraph);
	createGraphDuplicateDependency.spec.items[1].dependencies.push(
		structuredClone(createGraphDuplicateDependency.spec.items[1].dependencies[0]),
	);
	assertPair(
		'mutation-preview-request',
		createGraphDuplicateDependency,
		false,
		'create dependencies must be unique by relation and target',
	);
	const createGraphDependencyAtCap = structuredClone(createGraph);
	createGraphDependencyAtCap.spec.items[1].dependencies = Array.from({ length: 64 }, (_, index) => ({
		relation: index % 2 === 0 ? 'blocks' : 'blocked-by',
		target: { kind: 'existing', operonId: index.toString(36).padStart(7, 'a').slice(-7) },
	}));
	assertPair('mutation-preview-request', createGraphDependencyAtCap, true, 'create dependencies at V1 cap');
	const createGraphDependencyAboveCap = structuredClone(createGraphDependencyAtCap);
	createGraphDependencyAboveCap.spec.items[1].dependencies.push({
		relation: 'blocks',
		target: { kind: 'existing', operonId: 'zzzzzzz' },
	});
	assertPair('mutation-preview-request', createGraphDependencyAboveCap, false, 'create dependencies above V1 cap');
	const createWithCallerId = structuredClone(createInline);
	createWithCallerId.spec.items[0].operonId = 'new1234';
	assertPair('mutation-preview-request', createWithCallerId, false, 'caller cannot allocate operonId');

	const convert = structuredClone(preview);
	convert.capability = 'tasks.convert.preview';
	convert.mutationKind = 'task.convert';
	convert.spec = {
		operation: 'convert',
		from: 'file',
		to: 'inline',
		target: {
			mode: 'exact-line',
			filePath: 'Tasks/Target.md',
			lineNumber: 0,
		},
	};
	assertPair('mutation-preview-request', convert, true, 'file-to-inline conversion with line');
	const convertMissingLine = structuredClone(convert);
	delete convertMissingLine.spec.target.lineNumber;
	assertPair('mutation-preview-request', convertMissingLine, false, 'inline conversion target missing line');
	const convertFile = structuredClone(convert);
	convertFile.spec = {
		operation: 'convert',
		from: 'inline',
		to: 'file',
		templateId: 'template:default',
		targetPath: 'Tasks/Target.md',
	};
	assertPair('mutation-preview-request', convertFile, true, 'inline-to-file conversion without line');
	const convertFileWithLine = structuredClone(convertFile);
	convertFileWithLine.spec.target = {
		mode: 'exact-line',
		filePath: 'Tasks/Target.md',
		lineNumber: 0,
	};
	assertPair('mutation-preview-request', convertFileWithLine, false, 'file conversion target with line');

	const reminder = structuredClone(preview);
	reminder.capability = 'tasks.reminder.preview';
	reminder.mutationKind = 'task.reminder-item';
	for (const [label, spec, expected] of [
		['reminder add value only', { operation: 'add', collection: 'reminderDatetimes', value: '2026-07-24T09:00' }, true],
		['reminder add with item id', { operation: 'add', collection: 'reminderDatetimes', itemId: 'r1', value: '2026-07-24T09:00' }, false],
		['reminder replace full guard', { operation: 'replace', collection: 'reminderRules', itemId: 'r1', expectedValue: 'old', value: 'new' }, true],
		['reminder replace missing expected', { operation: 'replace', collection: 'reminderRules', itemId: 'r1', value: 'new' }, false],
		['reminder remove guarded', { operation: 'remove', collection: 'reminderRules', itemId: 'r1', expectedValue: 'old' }, true],
		['reminder remove with value', { operation: 'remove', collection: 'reminderRules', itemId: 'r1', expectedValue: 'old', value: 'new' }, false],
	]) {
		const candidate = structuredClone(reminder);
		candidate.spec = spec;
		assertPair('mutation-preview-request', candidate, expected, label);
	}

	const catalog = fixture(fixtures, 'valid-built-in-and-custom-field-catalog').value;
	assert.deepEqual(
		module.validateGeneralUpdateItemsAgainstCatalogV1(
			[{ field: 'clientReference', valueType: 'text' }],
			catalog,
		),
		[],
		'Mapped custom general-update field must be writable.',
	);
	const collisionCatalog = structuredClone(catalog);
	collisionCatalog[1].mappingStatus = 'collision';
	assert.ok(
		module.validateGeneralUpdateItemsAgainstCatalogV1(
			[{ field: 'clientReference', valueType: 'text' }],
			collisionCatalog,
		).some(issue => issue.code === 'field-not-writable'),
		'Collision custom field must not be writable.',
	);
	assert.ok(
		module.validateGeneralUpdateItemsAgainstCatalogV1(
			[{ field: 'missingCustom', valueType: 'text' }],
			catalog,
		).some(issue => issue.code === 'field-not-cataloged'),
		'Unknown custom field must fail catalog-aware validation.',
	);
	count += 3;

	const plan = fixture(fixtures, 'valid-destructive-delete-plan').value;
	assertPair('sealed-mutation-plan', plan, true, 'sealed plan valid canonical hash');
	const conversionPlan = structuredClone(plan);
	conversionPlan.planId = 'plan-convert-001';
	conversionPlan.capability = 'tasks.convert.preview';
	conversionPlan.mutationKind = 'task.convert';
	conversionPlan.targets = [{
		operonId: 'abc1234',
		locator: {
			representation: 'inline',
			filePath: 'Daily/Fixture.md',
			lineNumber: 2,
		},
		targetDigest: 'd'.repeat(64),
	}];
	conversionPlan.receiptTargetDigest = module.computeReceiptTargetDigestV1(conversionPlan.targets);
	conversionPlan.affectedResources = [
		{ resourceKind: 'task-source', resourceKey: 'Daily/Fixture.md', revision: 'e'.repeat(64) },
		{ resourceKind: 'task-source', resourceKey: 'Tasks/Converted.md', revision: 'f'.repeat(64) },
	];
	conversionPlan.atomicGroups = conversionPlan.affectedResources.map((resource, order) => ({
		groupId: `task-source:${resource.resourceKey}`,
		order,
		resources: [{ resourceKind: resource.resourceKind, resourceKey: resource.resourceKey }],
	}));
	conversionPlan.predictedEffects = [
		{
			resourceKind: 'task-source',
			resourceKey: 'Tasks/Converted.md',
			action: 'create',
			summary: 'Create the exact File Task target.',
		},
		{
			resourceKind: 'task-source',
			resourceKey: 'Daily/Fixture.md',
			action: 'update',
			summary: 'Replace the exact inline task with a wikilink.',
		},
	];
	conversionPlan.riskLevel = 'elevated';
	conversionPlan.requiresConfirmation = false;
	conversionPlan.requiredAcknowledgements = [];
	conversionPlan.spec = {
		operation: 'convert',
		from: 'inline',
		to: 'file',
		templateId: 'template:default',
		targetPath: 'Tasks/Converted.md',
	};
	conversionPlan.conversionEffect = {
		direction: 'inline-to-file',
		operonId: 'abc1234',
		beforeLocator: conversionPlan.targets[0].locator,
		afterLocator: {
			representation: 'file',
			filePath: 'Tasks/Converted.md',
		},
		plannedTargetDigest: 'c'.repeat(64),
		plannedSourceDigest: 'd'.repeat(64),
		settingsFingerprint: 'b'.repeat(64),
		templateId: 'template:default',
		templateRevision: 'a'.repeat(64),
		resolvedFieldDiff: [{
			field: 'priority',
			source: 'default',
			after: 'Normal',
		}],
		lossManifest: [],
		lossManifestDigest: module.sha256HexV1('[]'),
	};
	conversionPlan.planHash = module.computeSealedMutationPlanHashV1(conversionPlan);
	assertPair('sealed-mutation-plan', conversionPlan, true, 'sealed conversion plan binds canonical effect');
	const conversionPlanMissingEffect = structuredClone(conversionPlan);
	delete conversionPlanMissingEffect.conversionEffect;
	conversionPlanMissingEffect.planHash = module.computeSealedMutationPlanHashV1(conversionPlanMissingEffect);
	assertPair(
		'sealed-mutation-plan',
		conversionPlanMissingEffect,
		false,
		'sealed conversion plan requires canonical effect',
	);
	const conversionPlanMissingTemplateSeal = structuredClone(conversionPlan);
	delete conversionPlanMissingTemplateSeal.conversionEffect.templateId;
	delete conversionPlanMissingTemplateSeal.conversionEffect.templateRevision;
	conversionPlanMissingTemplateSeal.planHash = module.computeSealedMutationPlanHashV1(
		conversionPlanMissingTemplateSeal,
	);
	assertPair(
		'sealed-mutation-plan',
		conversionPlanMissingTemplateSeal,
		false,
		'inline-to-file conversion effect requires template metadata',
	);
	const conversionPlanTamperedLoss = structuredClone(conversionPlan);
	conversionPlanTamperedLoss.conversionEffect.lossManifest = [{
		kind: 'body-content',
		digest: 'e'.repeat(64),
	}];
	conversionPlanTamperedLoss.planHash = module.computeSealedMutationPlanHashV1(
		conversionPlanTamperedLoss,
	);
	assertPair(
		'sealed-mutation-plan',
		conversionPlanTamperedLoss,
		false,
		'conversion loss manifest digest binds itemized loss',
	);
	assert.equal(module.verifySealedMutationPlanHashV1(plan), true, 'Valid fixture plan hash must verify.');
	count += 1;
	const tamperedPlan = structuredClone(plan);
	tamperedPlan.predictedEffects[0].summary = 'Tampered after sealing.';
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		tamperedPlan,
		module.validateSealedMutationPlanSafetyV1,
		'sealed plan material tamper',
	);
	const tamperedReceiptTarget = structuredClone(plan);
	tamperedReceiptTarget.receiptTargetDigest = '9'.repeat(64);
	tamperedReceiptTarget.planHash = module.computeSealedMutationPlanHashV1(tamperedReceiptTarget);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		tamperedReceiptTarget,
		module.validateSealedMutationPlanSafetyV1,
		'receipt target digest must derive from canonical targets',
	);
	const lowRiskPlan = structuredClone(plan);
	lowRiskPlan.riskLevel = 'routine';
	lowRiskPlan.planHash = module.computeSealedMutationPlanHashV1(lowRiskPlan);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		lowRiskPlan,
		module.validateSealedMutationPlanSafetyV1,
		'spec-derived risk downgrade',
	);
	const longDestructivePlan = structuredClone(plan);
	longDestructivePlan.expiresAt = '2026-07-23T08:03:01.000Z';
	longDestructivePlan.planHash = module.computeSealedMutationPlanHashV1(longDestructivePlan);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		longDestructivePlan,
		module.validateSealedMutationPlanSafetyV1,
		'destructive plan TTL above 60 seconds',
	);
	const unboundAtomicPlan = structuredClone(plan);
	unboundAtomicPlan.atomicGroups[0].resources[0].resourceKey = 'Tasks/Other.md';
	unboundAtomicPlan.planHash = module.computeSealedMutationPlanHashV1(unboundAtomicPlan);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		unboundAtomicPlan,
		module.validateSealedMutationPlanSafetyV1,
		'atomic group resource not covered by revision map',
	);
	const createPlan = fixture(fixtures, 'valid-create-graph-plan').value;
	const resealCreateEffect = (candidate, effectIndex) => {
		candidate.targets[effectIndex].targetDigest = module.sha256HexV1(
			module.canonicalJsonV1(candidate.createEffects[effectIndex]),
		);
		candidate.receiptTargetDigest = module.computeReceiptTargetDigestV1(candidate.targets);
		candidate.planHash = module.computeSealedMutationPlanHashV1(candidate);
	};
	assertPair('sealed-mutation-plan', createPlan, true, 'sealed create graph plan with exact effects');
	const explicitTemplateMismatchPlan = structuredClone(createPlan);
	explicitTemplateMismatchPlan.createEffects[1].templateId = 'template:other';
	resealCreateEffect(explicitTemplateMismatchPlan, 1);
	assertPair(
		'sealed-mutation-plan',
		explicitTemplateMismatchPlan,
		false,
		'explicit file template must match the sealed create effect',
	);
	const configuredDefaultCreatePlan = structuredClone(createPlan);
	configuredDefaultCreatePlan.spec.items[0].target = { mode: 'configured-default' };
	configuredDefaultCreatePlan.planHash = module.computeSealedMutationPlanHashV1(configuredDefaultCreatePlan);
	assertPair(
		'sealed-mutation-plan',
		configuredDefaultCreatePlan,
		true,
		'sealed create plan may resolve configured-default representation at preview time',
	);
	const configuredDefaultWithoutTemplatePlan = structuredClone(createPlan);
	configuredDefaultWithoutTemplatePlan.spec.items[1].target = {
		representation: 'file',
		mode: 'configured-default',
	};
	delete configuredDefaultWithoutTemplatePlan.createEffects[1].templateId;
	delete configuredDefaultWithoutTemplatePlan.createEffects[1].templateDigest;
	resealCreateEffect(configuredDefaultWithoutTemplatePlan, 1);
	assertPair(
		'sealed-mutation-plan',
		configuredDefaultWithoutTemplatePlan,
		true,
		'configured-default may resolve without a file template',
	);
	const exactPathWithoutRequestedTemplatePlan = structuredClone(createPlan);
	delete exactPathWithoutRequestedTemplatePlan.spec.items[1].target.templateId;
	resealCreateEffect(exactPathWithoutRequestedTemplatePlan, 1);
	assertPair(
		'sealed-mutation-plan',
		exactPathWithoutRequestedTemplatePlan,
		false,
		'exact-path cannot seal an unrequested file template',
	);
	for (const missingTemplateField of ['templateId', 'templateDigest']) {
		const incompleteTemplateSealPlan = structuredClone(createPlan);
		incompleteTemplateSealPlan.spec.items[1].target = {
			representation: 'file',
			mode: 'configured-default',
		};
		delete incompleteTemplateSealPlan.createEffects[1][missingTemplateField];
		resealCreateEffect(incompleteTemplateSealPlan, 1);
		assertPair(
			'sealed-mutation-plan',
			incompleteTemplateSealPlan,
			false,
			`file template seal requires ${missingTemplateField}`,
		);
	}
	const inlineTemplateSealPlan = structuredClone(createPlan);
	inlineTemplateSealPlan.createEffects[0].templateId = 'template:invalid-inline';
	inlineTemplateSealPlan.createEffects[0].templateDigest = '9'.repeat(64);
	resealCreateEffect(inlineTemplateSealPlan, 0);
	assertPair(
		'sealed-mutation-plan',
		inlineTemplateSealPlan,
		false,
		'inline create effects cannot seal file template metadata',
	);
	const configuredDefaultTemplatePlan = structuredClone(createPlan);
	configuredDefaultTemplatePlan.spec.items[1].target = {
		representation: 'file',
		mode: 'configured-default',
	};
	configuredDefaultTemplatePlan.planHash =
		module.computeSealedMutationPlanHashV1(configuredDefaultTemplatePlan);
	assertPair(
		'sealed-mutation-plan',
		configuredDefaultTemplatePlan,
		true,
		'configured-default may seal the Runtime-resolved file template',
	);
	const explicitConfiguredDefaultTemplatePlan = structuredClone(createPlan);
	explicitConfiguredDefaultTemplatePlan.spec.items[1].target = {
		representation: 'file',
		mode: 'configured-default',
		templateId: createPlan.spec.items[1].target.templateId,
	};
	explicitConfiguredDefaultTemplatePlan.planHash =
		module.computeSealedMutationPlanHashV1(explicitConfiguredDefaultTemplatePlan);
	assertPair(
		'sealed-mutation-plan',
		explicitConfiguredDefaultTemplatePlan,
		true,
		'configured-default preserves an explicitly requested matching template',
	);
	const explicitConfiguredDefaultTemplateMismatchPlan = structuredClone(explicitConfiguredDefaultTemplatePlan);
	explicitConfiguredDefaultTemplateMismatchPlan.createEffects[1].templateId = 'template:other';
	resealCreateEffect(explicitConfiguredDefaultTemplateMismatchPlan, 1);
	assertPair(
		'sealed-mutation-plan',
		explicitConfiguredDefaultTemplateMismatchPlan,
		false,
		'configured-default rejects an explicitly requested mismatched template',
	);
	const unscopedConfiguredDefaultTemplatePlan = structuredClone(createPlan);
	unscopedConfiguredDefaultTemplatePlan.spec.items[1].target = { mode: 'configured-default' };
	unscopedConfiguredDefaultTemplatePlan.planHash =
		module.computeSealedMutationPlanHashV1(unscopedConfiguredDefaultTemplatePlan);
	assertPair(
		'sealed-mutation-plan',
		unscopedConfiguredDefaultTemplatePlan,
		true,
		'unscoped configured-default may resolve a file template',
	);
	const sameLineCreatePlan = structuredClone(createPlan);
	sameLineCreatePlan.spec.items[1].target = {
		representation: 'inline',
		mode: 'exact-path',
		filePath: 'Tasks/Fixture.md',
		lineNumber: 3,
	};
	sameLineCreatePlan.targets[1].locator = {
		representation: 'inline',
		filePath: 'Tasks/Fixture.md',
		lineNumber: 4,
	};
	sameLineCreatePlan.affectedResources = [{
		resourceKind: 'task-source',
		resourceKey: 'Tasks/Fixture.md',
		revision: '3333333333333333333333333333333333333333333333333333333333333333',
	}];
	sameLineCreatePlan.atomicGroups = [{
		groupId: 'group-0',
		order: 0,
		resources: [{
			resourceKind: 'task-source',
			resourceKey: 'Tasks/Fixture.md',
		}],
	}];
	sameLineCreatePlan.predictedEffects = [{
		resourceKind: 'task-source',
		resourceKey: 'Tasks/Fixture.md',
		action: 'update',
		summary: 'Insert the exact same-source task graph.',
	}];
	sameLineCreatePlan.createEffects[1].locator = {
		representation: 'inline',
		filePath: 'Tasks/Fixture.md',
		lineNumber: 4,
	};
	sameLineCreatePlan.createEffects[1].targetBeforeDigest =
		'3333333333333333333333333333333333333333333333333333333333333333';
	sameLineCreatePlan.createEffects[1].plannedSourceDigest =
		sameLineCreatePlan.createEffects[0].plannedSourceDigest;
	delete sameLineCreatePlan.createEffects[1].expectedAbsence;
	delete sameLineCreatePlan.createEffects[1].templateId;
	delete sameLineCreatePlan.createEffects[1].templateDigest;
	sameLineCreatePlan.receiptTargetDigest = createHash('sha256')
		.update(canonicalJsonForSchema(sameLineCreatePlan.targets), 'utf8')
		.digest('hex');
	sameLineCreatePlan.planHash = module.computeSealedMutationPlanHashV1(sameLineCreatePlan);
	assertPair(
		'sealed-mutation-plan',
		sameLineCreatePlan,
		true,
		'same-source exact inserts seal final locators inside the bounded insertion window',
	);
	for (const invalidLine of [2, 5]) {
		const invalidInsertionWindow = structuredClone(sameLineCreatePlan);
		invalidInsertionWindow.createEffects[1].locator.lineNumber = invalidLine;
		invalidInsertionWindow.targets[1].locator.lineNumber = invalidLine;
		invalidInsertionWindow.receiptTargetDigest = createHash('sha256')
			.update(canonicalJsonForSchema(invalidInsertionWindow.targets), 'utf8')
			.digest('hex');
		invalidInsertionWindow.planHash =
			module.computeSealedMutationPlanHashV1(invalidInsertionWindow);
		assertSchemaAndSafetyReject(
			'sealed-mutation-plan',
			invalidInsertionWindow,
			module.validateSealedMutationPlanSafetyV1,
			`same-source exact insert outside the bounded window at line ${invalidLine}`,
		);
	}
	const invalidCreateRepeatSeries = structuredClone(createPlan);
	invalidCreateRepeatSeries.createEffects[0].repeatSeriesId = '';
	invalidCreateRepeatSeries.planHash = module.computeSealedMutationPlanHashV1(invalidCreateRepeatSeries);
	assertPair(
		'sealed-mutation-plan',
		invalidCreateRepeatSeries,
		false,
		'sealed create repeat series ids must be non-empty',
	);
	const successfulPreviewResult = {
		contractVersion: 1,
		requestId: 'preview-create-result-001',
		kind: 'mutation-preview-result',
		ok: true,
		plan: createPlan,
		warnings: [],
	};
	assertPair('mutation-preview-result', successfulPreviewResult, true, 'structured successful preview result');
	const failedPreviewResult = fixture(fixtures, 'valid-mutation-preview-failure').value;
	assertPair('mutation-preview-result', failedPreviewResult, true, 'structured failed preview result');
	const failedPreviewWithPlan = structuredClone(failedPreviewResult);
	failedPreviewWithPlan.plan = createPlan;
	assertPair('mutation-preview-result', failedPreviewWithPlan, false, 'failed preview cannot carry a plan');
	const createApply = {
		contractVersion: 1,
		requestId: 'apply-create-001',
		kind: 'mutation-apply',
		plan: createPlan,
		authorization: {
			basis: 'user-explicit-request',
			reason: 'Apply the unchanged create plan.',
		},
		idempotencyKey: 'fixture-create-001',
		acknowledgements: [],
	};
	assertPair('mutation-apply-request', createApply, true, 'create apply binds the preview idempotency key');
	const createEffectMissing = structuredClone(createPlan);
	createEffectMissing.createEffects.pop();
	createEffectMissing.planHash = module.computeSealedMutationPlanHashV1(createEffectMissing);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		createEffectMissing,
		module.validateSealedMutationPlanSafetyV1,
		'create effects must cover every create item',
	);
	const createEffectTargetFork = structuredClone(createPlan);
	createEffectTargetFork.createEffects[0].locator.lineNumber = 4;
	createEffectTargetFork.planHash = module.computeSealedMutationPlanHashV1(createEffectTargetFork);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		createEffectTargetFork,
		module.validateSealedMutationPlanSafetyV1,
		'create effects must bind exact allocated targets',
	);
	const createEffectRelationFork = structuredClone(createPlan);
	createEffectRelationFork.createEffects[0].resolvedRelatedOperonIds = [];
	createEffectRelationFork.planHash = module.computeSealedMutationPlanHashV1(createEffectRelationFork);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		createEffectRelationFork,
		module.validateSealedMutationPlanSafetyV1,
		'create effects must bind resolved graph relations',
	);
	const createDependencyBodyPlan = structuredClone(createPlan);
	createDependencyBodyPlan.spec.items[1].dependencies = [{
		relation: 'blocked-by',
		target: { kind: 'created', itemRef: 'root' },
	}];
	createDependencyBodyPlan.spec.items[1].bodyMarkdown = '# Child body\n\nFixture details.\n';
	createDependencyBodyPlan.createEffects[1].resolvedDependencies = [{
		relation: 'blocked-by',
		operonId: 'aaa1111',
	}];
	createDependencyBodyPlan.createEffects[1].bodyMarkdownSummary = {
		utf8Bytes: Buffer.byteLength(createDependencyBodyPlan.spec.items[1].bodyMarkdown, 'utf8'),
		sha256: createHash('sha256')
			.update(createDependencyBodyPlan.spec.items[1].bodyMarkdown, 'utf8')
			.digest('hex'),
	};
	createDependencyBodyPlan.planHash = module.computeSealedMutationPlanHashV1(createDependencyBodyPlan);
	assertPair(
		'sealed-mutation-plan',
		createDependencyBodyPlan,
		true,
		'sealed create plan binds dependencies and File Task body summary',
	);
	const createDependencyEffectFork = structuredClone(createDependencyBodyPlan);
	createDependencyEffectFork.createEffects[1].resolvedDependencies[0].relation = 'blocks';
	createDependencyEffectFork.planHash = module.computeSealedMutationPlanHashV1(createDependencyEffectFork);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		createDependencyEffectFork,
		module.validateSealedMutationPlanSafetyV1,
		'sealed create dependency summary must match the create graph',
	);
	const createBodyEffectFork = structuredClone(createDependencyBodyPlan);
	createBodyEffectFork.createEffects[1].bodyMarkdownSummary.utf8Bytes += 1;
	createBodyEffectFork.planHash = module.computeSealedMutationPlanHashV1(createBodyEffectFork);
	assertSchemaAndSafetyReject(
		'sealed-mutation-plan',
		createBodyEffectFork,
		module.validateSealedMutationPlanSafetyV1,
		'sealed File Task body summary must match the requested body',
	);

	const apply = fixture(fixtures, 'valid-destructive-delete-apply').value;
	assertPair('mutation-apply-request', apply, true, 'exact destructive acknowledgements');
	const rebindApplyIdempotency = (candidate, idempotencyKey) => {
		candidate.idempotencyKey = idempotencyKey;
		candidate.plan.idempotencyKeyHash = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
		candidate.plan.planHash = module.computeSealedMutationPlanHashV1(candidate.plan);
		candidate.acknowledgements.forEach(acknowledgement => {
			acknowledgement.planHash = candidate.plan.planHash;
		});
	};
	for (const [label, idempotencyKey, expected] of [
		['idempotency key at 16 characters', 'a'.repeat(16), true],
		['idempotency key below 16 characters', 'a'.repeat(15), false],
		['idempotency key at 256 characters', 'a'.repeat(256), true],
		['idempotency key above 256 characters', 'a'.repeat(257), false],
		['idempotency key illegal slash', 'abcdefghijklmn/p', false],
	]) {
		const candidate = structuredClone(apply);
		rebindApplyIdempotency(candidate, idempotencyKey);
		assertPair('mutation-apply-request', candidate, expected, label);
	}
	const mismatchedIdempotencyKey = structuredClone(apply);
	mismatchedIdempotencyKey.idempotencyKey = 'fixture-delete-mismatch';
	assertSchemaAndSafetyReject(
		'mutation-apply-request',
		mismatchedIdempotencyKey,
		module.validateMutationApplySafetyV1,
		'raw idempotency key must match sealed hash',
	);
	for (const [label, mutate] of [
		['acknowledgement wrong plan hash', candidate => { candidate.acknowledgements[0].planHash = '9'.repeat(64); }],
		['acknowledgement wrong target digest', candidate => { candidate.acknowledgements[0].targetDigest = '8'.repeat(64); }],
		['acknowledgement before plan', candidate => { candidate.acknowledgements[0].acknowledgedAt = '2026-07-23T08:01:59.000Z'; }],
		['missing required acknowledgement', candidate => { candidate.acknowledgements.pop(); }],
	]) {
		const candidate = structuredClone(apply);
		mutate(candidate);
		assertSchemaAndSafetyReject(
			'mutation-apply-request',
			candidate,
			module.validateMutationApplySafetyV1,
			label,
		);
	}
	for (const [label, nowEpochMs, expected] of [
		['apply admission inside plan and acknowledgement interval', Date.parse('2026-07-23T08:02:45.000Z'), true],
		['apply admission at exact expiry boundary', Date.parse('2026-07-23T08:03:00.000Z'), false],
		['apply admission before plan creation', Date.parse('2026-07-23T08:01:59.999Z'), false],
		['apply admission after plan expiry', Date.parse('2026-07-23T08:03:00.001Z'), false],
		['apply admission before acknowledgement', Date.parse('2026-07-23T08:02:15.000Z'), false],
		['apply admission rejects non-finite clock', Number.NaN, false],
	]) {
		assert.equal(
			module.admitMutationApplyV1(apply, nowEpochMs).ok,
			expected,
			`Clock-aware admission mismatch: ${label}`,
		);
		assert.equal(
			module.validateMutationApplyAdmissionV1(apply, nowEpochMs).length === 0,
			expected,
			`Clock-aware admission issue mismatch: ${label}`,
		);
		count += 1;
	}

	const receipt = fixture(fixtures, 'valid-metadata-only-receipt').value;
	const appliedResult = {
		contractVersion: 1,
		requestId: 'result-applied-boundary',
		kind: 'mutation-result',
		status: 'applied',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [{ groupId: 'group-0', status: 'committed' }],
		receipt: { ...receipt, terminalOutcome: 'applied' },
		postflight: {
			status: 'verified',
			observedAt: '2026-07-23T08:02:32.000Z',
			contextRevision: structuredClone(apply.plan.contextRevision),
		},
	};
	assertPair('mutation-result', appliedResult, true, 'applied result state');
	const appliedWithoutPostflight = structuredClone(appliedResult);
	delete appliedWithoutPostflight.postflight;
	assertPair(
		'mutation-result',
		appliedWithoutPostflight,
		false,
		'applied result requires verified postflight',
	);
	const failedWithPostflight = {
		contractVersion: 1,
		requestId: 'result-failed-postflight-boundary',
		kind: 'mutation-result',
		status: 'failed',
		mutationMayHaveApplied: false,
		retryAllowed: false,
		groupResults: [],
		postflight: structuredClone(appliedResult.postflight),
		error: {
			contractVersion: 1,
			code: 'stale-source',
			reason: 'The source changed before commit.',
			retryable: false,
			action: 'refresh-state',
		},
	};
	assertPair(
		'mutation-result',
		failedWithPostflight,
		false,
		'failed result cannot claim verified postflight',
	);
	const admissionScope = {
		vaultIdentityHash: '1'.repeat(64),
		clientInstanceId: 'fixture-client',
	};
	const admittedAppliedResult = structuredClone(appliedResult);
	admittedAppliedResult.receipt = {
		contractVersion: 1,
		vaultIdentityHash: admissionScope.vaultIdentityHash,
		clientInstanceId: admissionScope.clientInstanceId,
		idempotencyKeyHash: apply.plan.idempotencyKeyHash,
		planHash: apply.plan.planHash,
		mutationKind: apply.plan.mutationKind,
		targetDigest: apply.plan.receiptTargetDigest,
		terminalOutcome: 'applied',
		effectiveAt: '2026-07-23T08:02:31.000Z',
		completedAt: '2026-07-23T08:02:32.000Z',
		expiresAt: '2026-07-24T08:02:32.000Z',
	};
	for (const [label, mutate, expected] of [
		['result admission exact binding', () => {}, true],
		['result admission rejects target substitution', candidate => { candidate.receipt.targetDigest = '8'.repeat(64); }, false],
		['result admission rejects plan fork', candidate => { candidate.receipt.planHash = '7'.repeat(64); }, false],
		['result admission rejects idempotency substitution', candidate => { candidate.receipt.idempotencyKeyHash = '6'.repeat(64); }, false],
		['result admission rejects mutation-kind substitution', candidate => { candidate.receipt.mutationKind = 'task.update'; }, false],
		['result admission rejects group id substitution', candidate => { candidate.groupResults[0].groupId = 'group-other'; }, false],
	]) {
		const candidate = structuredClone(admittedAppliedResult);
		mutate(candidate);
		assert.equal(
			module.admitMutationResultV1(candidate, apply, admissionScope).ok,
			expected,
			`Context-aware result admission mismatch: ${label}`,
		);
		assert.equal(
			module.validateMutationResultAdmissionV1(candidate, apply, admissionScope).length === 0,
			expected,
			`Context-aware result admission issue mismatch: ${label}`,
		);
		count += 1;
	}
	for (const [label, scope] of [
		['result admission rejects vault substitution', { ...admissionScope, vaultIdentityHash: '9'.repeat(64) }],
		['result admission rejects client fork', { ...admissionScope, clientInstanceId: 'other-client' }],
	]) {
		assert.equal(
			module.admitMutationResultV1(admittedAppliedResult, apply, scope).ok,
			false,
			label,
		);
		count += 1;
	}
	const duplicateGroupResult = structuredClone(admittedAppliedResult);
	duplicateGroupResult.groupResults.push(structuredClone(duplicateGroupResult.groupResults[0]));
	assertPair('mutation-result', duplicateGroupResult, false, 'mutation result group ids must be unique');

	const multiGroupApply = structuredClone(apply);
	multiGroupApply.plan.affectedResources.push({
		resourceKind: 'task-source',
		resourceKey: 'Tasks/Zeta.md',
		revision: '5'.repeat(64),
	});
	multiGroupApply.plan.atomicGroups.push({
		groupId: 'group-1',
		order: 1,
		resources: [{ resourceKind: 'task-source', resourceKey: 'Tasks/Zeta.md' }],
	});
	multiGroupApply.plan.predictedEffects.push({
		resourceKind: 'task-source',
		resourceKey: 'Tasks/Zeta.md',
		action: 'trash',
		summary: 'Move the second exact source to Obsidian trash.',
	});
	multiGroupApply.plan.planHash = module.computeSealedMutationPlanHashV1(multiGroupApply.plan);
	multiGroupApply.acknowledgements.forEach(acknowledgement => {
		acknowledgement.planHash = multiGroupApply.plan.planHash;
	});
	assertPair('mutation-apply-request', multiGroupApply, true, 'multi-group apply for admission ordering');
	const multiGroupResult = structuredClone(admittedAppliedResult);
	multiGroupResult.groupResults = [
		{ groupId: 'group-0', status: 'committed' },
		{ groupId: 'group-1', status: 'committed' },
	];
	multiGroupResult.receipt.planHash = multiGroupApply.plan.planHash;
	assert.equal(
		module.admitMutationResultV1(multiGroupResult, multiGroupApply, admissionScope).ok,
		true,
		'Ordered execution prefix must pass result admission.',
	);
	count += 1;
	const outOfOrderGroups = structuredClone(multiGroupResult);
	outOfOrderGroups.groupResults.reverse();
	assert.equal(
		module.admitMutationResultV1(outOfOrderGroups, multiGroupApply, admissionScope).ok,
		false,
		'Out-of-order group results must fail admission.',
	);
	count += 1;
	const arbitraryGroup = structuredClone(multiGroupResult);
	arbitraryGroup.groupResults[1].groupId = 'group-arbitrary';
	assert.equal(
		module.admitMutationResultV1(arbitraryGroup, multiGroupApply, admissionScope).ok,
		false,
		'Arbitrary group ids must fail admission.',
	);
	count += 1;

	const admittedPartial = structuredClone(fixture(fixtures, 'valid-partial-atomic-group-result').value);
	delete admittedPartial.groupResults[0].resourceRevisions;
	admittedPartial.continuation.originPlanHash = multiGroupApply.plan.planHash;
	admittedPartial.continuation.plan = structuredClone(multiGroupApply.plan);
	admittedPartial.continuation.plan.planId = 'plan-continuation-admission';
	admittedPartial.continuation.plan.createdAt = '2026-07-23T08:04:00.000Z';
	admittedPartial.continuation.plan.expiresAt = '2026-07-23T08:05:00.000Z';
	admittedPartial.continuation.plan.affectedResources = [
		structuredClone(multiGroupApply.plan.affectedResources[1]),
	];
	admittedPartial.continuation.plan.atomicGroups = [
		{ ...structuredClone(multiGroupApply.plan.atomicGroups[1]), order: 0 },
	];
	admittedPartial.continuation.plan.predictedEffects = [
		structuredClone(multiGroupApply.plan.predictedEffects[1]),
	];
	admittedPartial.continuation.plan.planHash = module.computeSealedMutationPlanHashV1(
		admittedPartial.continuation.plan,
	);
	assertPair('mutation-result', admittedPartial, true, 'partial continuation structurally valid');
	assert.equal(
		module.admitMutationResultV1(admittedPartial, multiGroupApply, admissionScope).ok,
		true,
		'Exact untouched suffix continuation must pass admission.',
	);
	count += 1;
	const wrongContinuationOrigin = structuredClone(admittedPartial);
	wrongContinuationOrigin.continuation.originPlanHash = '8'.repeat(64);
	assert.equal(
		module.admitMutationResultV1(wrongContinuationOrigin, multiGroupApply, admissionScope).ok,
		false,
		'Continuation with wrong origin must fail admission.',
	);
	count += 1;
	const semanticContinuationFork = structuredClone(admittedPartial);
	semanticContinuationFork.continuation.plan.targets[0].locator.filePath = 'Tasks/Fork.md';
	semanticContinuationFork.continuation.plan.receiptTargetDigest = module.canonicalPlanHashV1(
		module.toJsonValueV1(semanticContinuationFork.continuation.plan.targets),
	);
	semanticContinuationFork.continuation.plan.planHash = module.computeSealedMutationPlanHashV1(
		semanticContinuationFork.continuation.plan,
	);
	assert.equal(
		module.admitMutationResultV1(semanticContinuationFork, multiGroupApply, admissionScope).ok,
		false,
		'Continuation semantic fork must fail admission.',
	);
	count += 1;
	const nonSuffixContinuation = structuredClone(admittedPartial);
	for (const resource of nonSuffixContinuation.continuation.plan.affectedResources) {
		resource.resourceKey = 'Tasks/Other.md';
	}
	for (const group of nonSuffixContinuation.continuation.plan.atomicGroups) {
		for (const resource of group.resources) resource.resourceKey = 'Tasks/Other.md';
	}
	for (const effect of nonSuffixContinuation.continuation.plan.predictedEffects) {
		effect.resourceKey = 'Tasks/Other.md';
	}
	nonSuffixContinuation.continuation.plan.planHash = module.computeSealedMutationPlanHashV1(
		nonSuffixContinuation.continuation.plan,
	);
	assert.equal(
		module.admitMutationResultV1(nonSuffixContinuation, multiGroupApply, admissionScope).ok,
		false,
		'Continuation non-suffix resources must fail admission.',
	);
	count += 1;
	const unknownContinuation = structuredClone(admittedPartial);
	unknownContinuation.groupResults[1].status = 'outcome-unknown';
	unknownContinuation.groupResults[1].error = {
		contractVersion: 1,
		code: 'outcome-unknown',
		reason: 'Outcome is ambiguous.',
		retryable: false,
		action: 'recover-same-plan',
	};
	assert.equal(
		module.admitMutationResultV1(unknownContinuation, multiGroupApply, admissionScope).ok,
		false,
		'Outcome-unknown groups cannot be continued.',
	);
	count += 1;
	const alreadyAppliedResult = {
		...structuredClone(appliedResult),
		requestId: 'result-already-boundary',
		status: 'already-applied',
		groupResults: [],
		receipt: { ...receipt, terminalOutcome: 'already-applied' },
		postflight: { status: 'receipt-replay' },
	};
	assertPair('mutation-result', alreadyAppliedResult, true, 'already-applied result state');
	const groupAfterTerminal = structuredClone(fixture(fixtures, 'valid-partial-atomic-group-result').value);
	groupAfterTerminal.groupResults.push({ groupId: 'group-2', status: 'committed' });
	assertPair('mutation-result', groupAfterTerminal, false, 'group result after first terminal outcome');
	const partialWithoutContinuation = structuredClone(
		fixture(fixtures, 'valid-partial-atomic-group-result').value,
	);
	delete partialWithoutContinuation.continuation;
	assertPair('mutation-result', partialWithoutContinuation, true, 'partial result may omit unsafe continuation');
	const partialWithReceipt = structuredClone(fixture(fixtures, 'valid-partial-atomic-group-result').value);
	partialWithReceipt.receipt = { ...receipt, terminalOutcome: 'outcome-unknown' };
	assertPair('mutation-result', partialWithReceipt, false, 'partial result forbids receipt');
	const partialWithUnknownGroup = structuredClone(fixture(fixtures, 'valid-partial-atomic-group-result').value);
	partialWithUnknownGroup.groupResults[1] = {
		groupId: 'group-1',
		status: 'outcome-unknown',
		error: {
			contractVersion: 1,
			code: 'outcome-unknown',
			reason: 'The second resource outcome is ambiguous.',
			retryable: false,
			action: 'recover-same-plan',
		},
	};
	assertPair('mutation-result', partialWithUnknownGroup, false, 'partial result cannot contain ambiguous groups');
	const continuationWrongStart = structuredClone(fixture(fixtures, 'valid-partial-atomic-group-result').value);
	continuationWrongStart.continuation.remainingGroupIds = ['group-other'];
	assertPair('mutation-result', continuationWrongStart, false, 'continuation starts at stopped group');
	const continuationSameOrigin = structuredClone(fixture(fixtures, 'valid-partial-atomic-group-result').value);
	continuationSameOrigin.continuation.originPlanHash = continuationSameOrigin.continuation.plan.planHash;
	assertPair('mutation-result', continuationSameOrigin, false, 'continuation must be freshly sealed');
	const appliedWithFailedGroup = structuredClone(appliedResult);
	appliedWithFailedGroup.groupResults = [{
		groupId: 'group-0',
		status: 'failed',
		error: {
			contractVersion: 1,
			code: 'internal-error',
			reason: 'Fixture failure.',
			retryable: false,
			action: 'report-bug',
		},
	}];
	assertPair('mutation-result', appliedWithFailedGroup, false, 'applied result with failed group');

	const unknownError = {
		contractVersion: 1,
		code: 'outcome-unknown',
		reason: 'Durable outcome could not be proven.',
		retryable: false,
		action: 'recover-same-plan',
	};
	const groupOutcomeUnknown = {
		contractVersion: 1,
		requestId: 'result-group-ambiguity',
		kind: 'mutation-result',
		status: 'outcome-unknown',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [{ groupId: 'group-0', status: 'outcome-unknown', error: unknownError }],
		ambiguitySource: 'group-outcome',
		error: unknownError,
	};
	assertPair('mutation-result', groupOutcomeUnknown, true, 'group outcome ambiguity source');
	const receiptPersistUnknown = {
		...structuredClone(groupOutcomeUnknown),
		requestId: 'result-receipt-persist-ambiguity',
		groupResults: [],
		ambiguitySource: 'receipt-persist-failure',
		postflight: structuredClone(appliedResult.postflight),
	};
	assertPair('mutation-result', receiptPersistUnknown, true, 'receipt persist ambiguity source');
	const receiptPersistWithoutPostflight = structuredClone(receiptPersistUnknown);
	delete receiptPersistWithoutPostflight.postflight;
	assertPair('mutation-result', receiptPersistWithoutPostflight, false, 'receipt persist ambiguity requires verified postflight');
	const missingAmbiguitySource = structuredClone(groupOutcomeUnknown);
	delete missingAmbiguitySource.ambiguitySource;
	assertPair('mutation-result', missingAmbiguitySource, false, 'outcome unknown requires ambiguity source');
	const receiptPersistWithReceipt = structuredClone(receiptPersistUnknown);
	receiptPersistWithReceipt.receipt = { ...receipt, terminalOutcome: 'outcome-unknown' };
	assertPair('mutation-result', receiptPersistWithReceipt, false, 'receipt persist ambiguity forbids receipt');

	const invalidReceiptDate = structuredClone(receipt);
	invalidReceiptDate.effectiveAt = '2026-02-30T08:04:00.000Z';
	assertPair('mutation-receipt', invalidReceiptDate, false, 'invalid audit calendar date');
	const receiptWithoutFraction = structuredClone(receipt);
	receiptWithoutFraction.effectiveAt = '2026-07-23T08:04:00Z';
	assertPair('mutation-receipt', receiptWithoutFraction, true, 'audit timestamp without fractional seconds');
	const receiptWithOffset = structuredClone(receipt);
	receiptWithOffset.effectiveAt = '2026-07-23T10:04:00.000+02:00';
	assertPair('mutation-receipt', receiptWithOffset, false, 'audit timestamp forbids timezone offsets');
	const receiptWithShortFraction = structuredClone(receipt);
	receiptWithShortFraction.effectiveAt = '2026-07-23T08:04:00.1Z';
	assertPair('mutation-receipt', receiptWithShortFraction, false, 'audit timestamp fraction must use three digits');
	const receiptWithLongFraction = structuredClone(receipt);
	receiptWithLongFraction.effectiveAt = '2026-07-23T08:04:00.0000Z';
	assertPair('mutation-receipt', receiptWithLongFraction, false, 'audit timestamp fraction cannot exceed three digits');
	const expiredReceipt = structuredClone(receipt);
	expiredReceipt.expiresAt = '2026-07-24T08:04:01.001Z';
	assertPair('mutation-receipt', expiredReceipt, false, 'receipt TTL above 24 hours');

	return count;
}

function assertSchemaDecoderRejects(schemaId, value, module, validators, message) {
	const validator = validators.get(schemaId);
	assert.ok(validator, `Missing semantic-guard schema: ${schemaId}`);
	assert.equal(validator(value), false, `JSON Schema accepted invalid value: ${message}`);
	assert.equal(module.decodeContractFixtureV1(schemaId, value).ok, false, `Decoder accepted invalid value: ${message}`);
}

function fixture(fixtures, id) {
	const found = fixtures.find(item => item.id === id);
	assert.ok(found, `Missing fixture: ${id}`);
	return found;
}

async function listFiles(directory, predicate) {
	const output = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) output.push(...await listFiles(fullPath, predicate));
		else if (predicate(fullPath)) output.push(fullPath);
	}
	return output;
}

async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, 'utf8'));
}

function formatSchemaFailure(fixtureCase, errors, accepted) {
	return `${fixtureCase.id}: JSON Schema accepted=${accepted}, expected=${fixtureCase.expected}; `
		+ `${JSON.stringify(errors ?? [])}`;
}

function relative(filePath) {
	return path.relative(pluginRoot, filePath).replaceAll(path.sep, '/');
}

function utf8Size(value) {
	const serialized = typeof value === 'string' ? value : JSON.stringify(value);
	return Buffer.byteLength(serialized, 'utf8');
}

function isExactCalendarDate(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const [, year, month, day] = match.map(Number);
	const candidate = new Date(Date.UTC(year, month - 1, day));
	return candidate.getUTCFullYear() === year
		&& candidate.getUTCMonth() === month - 1
		&& candidate.getUTCDate() === day;
}

function isExactAuditDateTime(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(value);
	if (!match) return false;
	const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
	if (!isExactCalendarDate(`${yearText}-${monthText}-${dayText}`)) return false;
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	if (hour > 23 || minute > 59 || second > 59) return false;
	return Number.isFinite(Date.parse(value));
}

function isExactLocalDateTime(value) {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
	if (!match || !isExactCalendarDate(match[1])) return false;
	return Number(match[2]) <= 23
		&& Number(match[3]) <= 59
		&& (match[4] === undefined || Number(match[4]) <= 59);
}

function validateCreateGraphForSchema(spec) {
	if (!spec || !Array.isArray(spec.items)) return false;
	const refs = new Set(spec.items.map(item => item?.itemRef));
	if (refs.size !== spec.items.length || refs.has(undefined)) return false;
	const parents = new Map();
	for (const item of spec.items) {
		const createdReferences = [];
		if (item?.parent?.kind === 'created') {
			parents.set(item.itemRef, item.parent.itemRef);
			createdReferences.push(item.parent.itemRef);
		}
		for (const reference of item?.related ?? []) {
			if (reference?.kind === 'created') createdReferences.push(reference.itemRef);
		}
		for (const dependency of item?.dependencies ?? []) {
			if (dependency?.target?.kind === 'created') createdReferences.push(dependency.target.itemRef);
		}
		if (createdReferences.some(reference => reference === item.itemRef || !refs.has(reference))) return false;
		const relationIdentities = (item?.related ?? []).map(reference => (
			reference?.kind === 'existing'
				? `existing:${reference.operonId}`
				: `created:${reference?.itemRef}`
		));
		if (new Set(relationIdentities).size !== relationIdentities.length) return false;
		const dependencyIdentities = (item?.dependencies ?? []).map(dependency => {
			const reference = dependency?.target;
			const targetIdentity = reference?.kind === 'existing'
				? `existing:${reference.operonId}`
				: `created:${reference?.itemRef}`;
			return `${dependency?.relation}:${targetIdentity}`;
		});
		if (new Set(dependencyIdentities).size !== dependencyIdentities.length) return false;
		const fieldIdentities = (item?.fields ?? []).map(field => (
			field?.kind === 'custom'
				? `custom:${field.field}`
				: ['text', 'date', 'datetime', 'number', 'list'].includes(field?.kind)
					? `${field.kind}:${field.field}`
					: field?.kind
		));
		if (new Set(fieldIdentities).size !== fieldIdentities.length) return false;
	}
	for (const itemRef of refs) {
		const visited = new Set();
		let current = itemRef;
		while (current !== undefined) {
			if (visited.has(current)) return false;
			visited.add(current);
			current = parents.get(current);
		}
	}
	return true;
}

function validateSealedPlanForSchema(plan) {
	if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) return false;
	if (typeof plan.planHash !== 'string' || plan.planHash !== computePlanHashForSchema(plan)) return false;
	if (
		typeof plan.receiptTargetDigest !== 'string'
		|| plan.receiptTargetDigest !== createHash('sha256')
			.update(canonicalJsonForSchema(plan.targets), 'utf8')
			.digest('hex')
	) return false;
	const requiredRisk = requiredRiskForSchema(plan.spec);
	const riskOrder = ['none', 'routine', 'elevated', 'destructive'];
	if (riskOrder.indexOf(plan.riskLevel) < riskOrder.indexOf(requiredRisk)) return false;
	const createdAt = Date.parse(plan.createdAt);
	const expiresAt = Date.parse(plan.expiresAt);
	if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) return false;
	const maximumTtl = plan.riskLevel === 'destructive' ? 60_000 : 300_000;
	if (expiresAt - createdAt > maximumTtl) return false;
	if (
		plan.riskLevel === 'destructive'
		&& (
			plan.requiresConfirmation !== true
			|| !Array.isArray(plan.requiredAcknowledgements)
			|| plan.requiredAcknowledgements.length === 0
		)
	) return false;
	if (!validatePlanResourceBindingsForSchema(plan)) return false;
	if (plan.mutationKind === 'task.convert') {
		if (plan.createEffects !== undefined || !plan.conversionEffect) return false;
		const manifestDigest = createHash('sha256')
			.update(canonicalJsonForSchema(plan.conversionEffect.lossManifest), 'utf8')
			.digest('hex');
		return plan.conversionEffect.lossManifestDigest === manifestDigest;
	}
	if (plan.mutationKind !== 'task.create') return plan.createEffects === undefined;
	if (!validateCreateGraphForSchema(plan.spec) || !Array.isArray(plan.createEffects)) return false;
	const specRefs = new Set(plan.spec.items.map(item => item.itemRef));
	const effectRefs = new Set(plan.createEffects.map(effect => effect.itemRef));
	if (
		specRefs.size !== effectRefs.size
		|| [...specRefs].some(itemRef => !effectRefs.has(itemRef))
	) return false;
	const effectTargets = new Set(plan.createEffects.map(effect => (
		`${effect.operonId}\0${JSON.stringify(effect.locator)}`
	)));
	const planTargets = plan.targets.map(target => `${target.operonId}\0${JSON.stringify(target.locator)}`);
	if (effectTargets.size !== planTargets.length || !planTargets.every(target => effectTargets.has(target))) {
		return false;
	}
	const effectsByRef = new Map(plan.createEffects.map(effect => [effect.itemRef, effect]));
	const allocatedByRef = new Map(plan.createEffects.map(effect => [effect.itemRef, effect.operonId]));
	const inlineEffectCountByFile = new Map();
	for (const effect of plan.createEffects) {
		if (
			effect.locator?.representation === 'inline'
			&& typeof effect.locator.filePath === 'string'
		) {
			inlineEffectCountByFile.set(
				effect.locator.filePath,
				(inlineEffectCountByFile.get(effect.locator.filePath) ?? 0) + 1,
			);
		}
	}
	for (const item of plan.spec.items) {
		const effect = effectsByRef.get(item.itemRef);
		if (
			!effect
			|| (
				item.target?.representation !== undefined
				&& item.target.representation !== effect.locator?.representation
			)
		) return false;
		if (item.target?.mode === 'exact-path' && item.target.filePath !== effect.locator?.filePath) return false;
		if (
			item.target?.representation === 'inline'
			&& item.target.lineNumber !== undefined
			&& (
				typeof effect.locator?.lineNumber !== 'number'
				|| effect.locator.lineNumber < item.target.lineNumber
				|| effect.locator.lineNumber >= item.target.lineNumber
					+ (inlineEffectCountByFile.get(effect.locator.filePath) ?? 1)
			)
		) return false;
		const mayResolveConfiguredDefaultTemplate = item.target?.mode === 'configured-default'
			&& item.target?.templateId === undefined;
		if (!mayResolveConfiguredDefaultTemplate && item.target?.templateId !== effect.templateId) return false;
		const resolveReference = reference => (
			reference?.kind === 'existing' ? reference.operonId : allocatedByRef.get(reference?.itemRef)
		);
		if (resolveReference(item.parent) !== effect.resolvedParentOperonId) return false;
		const expectedRelated = (item.related ?? []).map(resolveReference).sort();
		const actualRelated = [...(effect.resolvedRelatedOperonIds ?? [])].sort();
		if (
			expectedRelated.length !== actualRelated.length
			|| expectedRelated.some((operonId, index) => operonId !== actualRelated[index])
		) return false;
		const expectedDependencies = (item.dependencies ?? []).map(dependency => ({
			relation: dependency.relation,
			operonId: resolveReference(dependency.target),
		})).sort(compareResolvedDependencyForSchema);
		const actualDependencies = [...(effect.resolvedDependencies ?? [])]
			.sort(compareResolvedDependencyForSchema);
		if (
			expectedDependencies.length !== actualDependencies.length
			|| expectedDependencies.some((dependency, index) => (
				dependency.relation !== actualDependencies[index]?.relation
				|| dependency.operonId !== actualDependencies[index]?.operonId
			))
		) return false;
		if (typeof item.bodyMarkdown === 'string') {
			const expectedSummary = {
				utf8Bytes: Buffer.byteLength(item.bodyMarkdown, 'utf8'),
				sha256: createHash('sha256').update(item.bodyMarkdown, 'utf8').digest('hex'),
			};
			if (
				effect.bodyMarkdownSummary?.utf8Bytes !== expectedSummary.utf8Bytes
				|| effect.bodyMarkdownSummary?.sha256 !== expectedSummary.sha256
			) return false;
		} else if (effect.bodyMarkdownSummary !== undefined) {
			return false;
		}
	}
	return true;
}

function compareResolvedDependencyForSchema(left, right) {
	return String(left?.relation).localeCompare(String(right?.relation))
		|| String(left?.operonId).localeCompare(String(right?.operonId));
}

function validatePlanResourceBindingsForSchema(plan) {
	if (!Array.isArray(plan.affectedResources) || !Array.isArray(plan.atomicGroups)) return false;
	const affectedKeys = plan.affectedResources.map(resourceIdentityForSchema);
	if (new Set(affectedKeys).size !== affectedKeys.length) return false;
	const flattened = [];
	for (let index = 0; index < plan.atomicGroups.length; index++) {
		const group = plan.atomicGroups[index];
		if (group.order !== index || !Array.isArray(group.resources)) return false;
		flattened.push(...group.resources);
	}
	const flattenedKeys = flattened.map(resourceIdentityForSchema);
	if (
		flattenedKeys.length !== affectedKeys.length
		|| new Set(flattenedKeys).size !== flattenedKeys.length
		|| affectedKeys.some(key => !flattenedKeys.includes(key))
	) return false;
	const sorted = [...flattened].sort(compareResourcesForSchema).map(resourceIdentityForSchema);
	if (flattenedKeys.some((key, index) => key !== sorted[index])) return false;
	if (affectedKeys.some((key, index) => key !== sorted[index])) return false;
	return Array.isArray(plan.predictedEffects)
		&& plan.predictedEffects.every(effect => affectedKeys.includes(resourceIdentityForSchema(effect)));
}

function validateAcknowledgementBindingsForSchema(request) {
	if (!request || typeof request !== 'object' || !request.plan || !Array.isArray(request.acknowledgements)) return false;
	if (
		typeof request.idempotencyKey !== 'string'
		|| request.plan.idempotencyKeyHash !== createHash('sha256').update(request.idempotencyKey, 'utf8').digest('hex')
	) return false;
	const required = new Set(request.plan.requiredAcknowledgements ?? []);
	const codes = request.acknowledgements.map(item => item.code);
	if (new Set(codes).size !== codes.length || codes.length !== required.size) return false;
	const targets = new Set((request.plan.targets ?? []).map(target => target.targetDigest));
	const createdAt = Date.parse(request.plan.createdAt);
	const expiresAt = Date.parse(request.plan.expiresAt);
	return request.acknowledgements.every(item => {
		const acknowledgedAt = Date.parse(item.acknowledgedAt);
		return required.has(item.code)
			&& item.planHash === request.plan.planHash
			&& targets.has(item.targetDigest)
			&& Number.isFinite(acknowledgedAt)
			&& acknowledgedAt >= createdAt
			&& acknowledgedAt <= expiresAt;
	});
}

function validateReceiptTimelineForSchema(receipt) {
	const effectiveAt = Date.parse(receipt.effectiveAt);
	const completedAt = Date.parse(receipt.completedAt);
	const expiresAt = Date.parse(receipt.expiresAt);
	return Number.isFinite(effectiveAt)
		&& Number.isFinite(completedAt)
		&& Number.isFinite(expiresAt)
		&& completedAt >= effectiveAt
		&& expiresAt > completedAt
		&& expiresAt - completedAt <= 86_400_000;
}

function validateTruncationForSchema(truncation) {
	return Number.isSafeInteger(truncation.actualCount)
		&& Number.isSafeInteger(truncation.returnedCount)
		&& Number.isSafeInteger(truncation.limit)
		&& truncation.actualCount > truncation.returnedCount
		&& truncation.returnedCount <= truncation.limit;
}

function validateResultStateForSchema(result) {
	if (!Array.isArray(result.groupResults)) return false;
	const statuses = result.groupResults.map(group => group.status);
	const allCommitted = statuses.length > 0 && statuses.every(status => status === 'committed');
	const anyCommitted = statuses.includes('committed');
	const anyFailed = statuses.includes('failed');
	const anyUnknown = statuses.includes('outcome-unknown');
	const receiptOutcome = result.receipt?.terminalOutcome;
	const continuationValid = result.continuation === undefined
		|| validateContinuationForSchema(result.continuation, result.groupResults);
	let valid = false;
	if (result.status === 'applied') {
		valid = allCommitted
			&& result.mutationMayHaveApplied === true
			&& result.retryAllowed === false
			&& result.error === undefined
			&& result.continuation === undefined
			&& result.ambiguitySource === undefined
			&& receiptOutcome === 'applied'
			&& result.postflight?.status === 'verified';
	} else if (result.status === 'already-applied') {
		valid = statuses.length === 0
			&& result.mutationMayHaveApplied === true
			&& result.retryAllowed === false
			&& result.error === undefined
			&& result.continuation === undefined
			&& result.ambiguitySource === undefined
			&& receiptOutcome === 'already-applied'
			&& result.postflight?.status === 'receipt-replay';
	} else if (result.status === 'failed') {
		valid = !anyCommitted
			&& !anyUnknown
			&& result.mutationMayHaveApplied === false
			&& result.error !== undefined
			&& result.receipt === undefined
			&& result.postflight === undefined
			&& result.continuation === undefined
			&& result.ambiguitySource === undefined;
	} else if (result.status === 'partial') {
		valid = anyCommitted
			&& anyFailed
			&& !anyUnknown
			&& result.mutationMayHaveApplied === true
			&& result.retryAllowed === false
			&& result.error !== undefined
			&& result.receipt === undefined
			&& result.postflight === undefined
			&& result.ambiguitySource === undefined;
	} else if (result.status === 'outcome-unknown') {
		valid = result.mutationMayHaveApplied === true
			&& result.retryAllowed === false
			&& result.error !== undefined
			&& result.continuation === undefined
			&& (
				(
					result.ambiguitySource === 'group-outcome'
					&& statuses.length > 0
					&& anyUnknown
					&& (result.receipt === undefined || receiptOutcome === 'outcome-unknown')
					&& result.postflight === undefined
				)
				|| (
					result.ambiguitySource === 'receipt-persist-failure'
					&& statuses.length === 0
					&& result.receipt === undefined
					&& result.postflight?.status === 'verified'
				)
			);
	}
	if (!valid || !continuationValid) return false;
	const firstTerminal = statuses.findIndex(status => status !== 'committed');
	return firstTerminal < 0 || firstTerminal === statuses.length - 1;
}

function validateContinuationForSchema(continuation, groupResults) {
	if (
		!continuation
		|| typeof continuation !== 'object'
		|| !continuation.plan
		|| !Array.isArray(continuation.remainingGroupIds)
		|| continuation.remainingGroupIds.length === 0
		|| continuation.plan.planHash === continuation.originPlanHash
		|| !Array.isArray(continuation.plan.atomicGroups)
	) return false;
	const planGroupIds = continuation.plan.atomicGroups.map(group => group.groupId);
	if (
		planGroupIds.length !== continuation.remainingGroupIds.length
		|| planGroupIds.some((groupId, index) => groupId !== continuation.remainingGroupIds[index])
	) return false;
	const committedIds = new Set(groupResults.filter(result => result.status === 'committed').map(result => result.groupId));
	if (continuation.remainingGroupIds.some(groupId => committedIds.has(groupId))) return false;
	const stoppedGroup = groupResults.find(result => result.status !== 'committed');
	return !stoppedGroup || continuation.remainingGroupIds[0] === stoppedGroup.groupId;
}

function requiredRiskForSchema(spec) {
	if (!spec || typeof spec !== 'object') return 'destructive';
	if (spec.operation === 'delete') return 'destructive';
	if (spec.operation === 'convert') return spec.from === 'file' && spec.to === 'inline' ? 'destructive' : 'elevated';
	if (spec.operation === 'relocate-inline') {
		return spec.source?.locator?.filePath === spec.destination?.locator?.filePath ? 'routine' : 'elevated';
	}
	if (['start', 'stop', 'transition'].includes(spec.operation)) return 'elevated';
	return 'routine';
}

function computePlanHashForSchema(plan) {
	const { planHash: _planHash, ...material } = plan;
	return createHash('sha256').update(canonicalJsonForSchema(material), 'utf8').digest('hex');
}

function canonicalJsonForSchema(value) {
	return serializeCanonicalForSchema(normalizeCanonicalForSchema(value));
}

function validateCatalogFilterBoundsForSchema(filters) {
	if (!Array.isArray(filters)) return false;
	let count = 0;
	const pending = filters.map(filter => ({ node: filter?.root, depth: 0 }));
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current?.node || typeof current.node !== 'object' || Array.isArray(current.node)) return false;
		if (current.depth > 64 || ++count > 2_048) return false;
		if (current.node.kind === 'group') {
			if (!Array.isArray(current.node.children)) return false;
			for (const child of current.node.children) {
				pending.push({ node: child, depth: current.depth + 1 });
			}
		}
	}
	return true;
}

function validateCliInvocationBindingForSchema(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	if (value.command === 'health' || value.command === 'capabilities') {
		return value.request === undefined;
	}
	if (!value.request || typeof value.request !== 'object' || Array.isArray(value.request)) {
		return false;
	}
	return value.request.requestId === value.requestId;
}

function validateCliResultBindingForSchema(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	if (value.ok !== true) return value.result === undefined;
	if (
		value.compatibility?.compatible !== true
		|| value.vaultIdentity?.expectedMatch !== true
		|| value.result === undefined
	) return false;
	if (
		value.result
		&& typeof value.result === 'object'
		&& !Array.isArray(value.result)
		&& typeof value.result.requestId === 'string'
	) {
		return value.result.requestId === value.requestId;
	}
	return true;
}

function normalizeCanonicalForSchema(value) {
	if (typeof value === 'string') return value.normalize('NFC');
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Non-finite canonical number.');
		return Object.is(value, -0) ? 0 : value;
	}
	if (value === null || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.map(normalizeCanonicalForSchema);
	const output = {};
	const normalizedKeys = new Set();
	for (const originalKey of Object.keys(value).sort(compareCodeUnitsForSchema)) {
		const key = originalKey.normalize('NFC');
		if (normalizedKeys.has(key)) throw new Error('Canonical key collision.');
		normalizedKeys.add(key);
		output[key] = normalizeCanonicalForSchema(value[originalKey]);
	}
	return output;
}

function serializeCanonicalForSchema(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(serializeCanonicalForSchema).join(',')}]`;
	const keys = Object.keys(value).sort(compareCodeUnitsForSchema);
	return `{${keys.map(key => `${JSON.stringify(key)}:${serializeCanonicalForSchema(value[key])}`).join(',')}}`;
}

function compareCodeUnitsForSchema(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function resourceIdentityForSchema(resource) {
	return `${String(resource.resourceKind)}\u0000${String(resource.resourceKey)}`;
}

function compareResourcesForSchema(left, right) {
	const order = {
		timer: 0,
		'repeat-series': 1,
		'active-tracker': 2,
		pinned: 3,
		'project-serial': 4,
		'task-source': 5,
	};
	const kindDelta = (order[left.resourceKind] ?? Number.MAX_SAFE_INTEGER)
		- (order[right.resourceKind] ?? Number.MAX_SAFE_INTEGER);
	if (kindDelta !== 0) return kindDelta;
	return String(left.resourceKey).localeCompare(String(right.resourceKey));
}
